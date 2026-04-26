from __future__ import annotations

import asyncio
import base64
import json
import logging
import os
import signal
import subprocess
import sys

from app.config import Settings
from app.config import NetConfig
from app.core.db.database_service import DatabaseService
from app.core.jobs.db.job_database_factory import get_job_database
from app.core.jobs.job_status import JobStatus
from app.core.runtime.coordinator_server import CoordinatorServer
from app.core.runtime.enqueue_payload import EnqueuePayload
from app.core.runtime.event_poster import get_event_poster


def _get_listen_port() -> int:
    raw_port = os.getenv("PORT", "8080")
    try:
        return int(raw_port)
    except ValueError:
        logging.warning("Invalid PORT=%s, defaulting to 8080", raw_port)
        return 8080


async def _mark_running_investigations_timed_out() -> None:
    try:
        db = get_job_database()
        for job in db.get_jobs_by_status(JobStatus.RUNNING):
            if job.job_type == "investigation":
                try:
                    job.set_timeout_status()
                except Exception as e:
                    logging.error("Failed to set timeout status on job: %s", e)
    except Exception:
        logging.exception("Failed while marking running investigation jobs as timed out")


async def _graceful_shutdown(
    *,
    stop_event: asyncio.Event,
    coordinator: CoordinatorServer,
    reason: str,
    timeout_seconds: int = 15,
) -> None:
    logging.info("Shutdown requested: %s", reason)

    stop_event.set()

    try:
        await _mark_running_investigations_timed_out()
    except Exception:
        logging.exception("Unexpected error during timeout-status marking")

    try:
        logging.info("Beginning coordinator.stop()")
        await asyncio.wait_for(coordinator.stop(), timeout=timeout_seconds)
        logging.info("Finished coordinator.stop()")
    except asyncio.TimeoutError:
        logging.error(
            "coordinator.stop() did not finish within %ss; forcing process exit",
            timeout_seconds,
        )
    except Exception:
        logging.exception("Error during coordinator.stop(); forcing process exit")

    fly_machine_id = os.getenv("FLY_MACHINE_ID")
    if fly_machine_id and fly_machine_id != "local":
        logging.info("Running on Fly machine %s, shutting down machine", fly_machine_id)
        try:
            result = subprocess.run(["which", "fly"], capture_output=True, text=True)
            if result.returncode != 0:
                logging.warning("fly CLI not found in PATH, falling back to os._exit")
            else:
                subprocess.run(["fly", "machine", "stop", fly_machine_id], check=True)
        except Exception as e:
            logging.error("Failed to stop Fly machine: %s", e)

    logging.info("Forcing process exit now")
    sys.stdout.flush()
    sys.stderr.flush()
    os._exit(0)


async def run() -> int:
    settings = Settings.load()
    logging.basicConfig(
        level=getattr(logging, settings.app.log_level.upper(), logging.ERROR),
        format="%(asctime)s %(levelname)s %(name)s - %(message)s",
        stream=sys.stdout,
    )

    logging.info("Startup environment: FLY_MACHINE_ID=%r", os.getenv("FLY_MACHINE_ID"))
    logging.info("Startup environment: PORT=%r", os.getenv("PORT"))

    # Attach log forwarder before any other init.
    # Must not halt the app on failure.
    _log_forwarder = None
    try:
        from app.util.sync_config import get_log_forwarder_backend
        from app.util.supabase_log_forwarder import SupabaseLogForwarder
        from app.util.s3_log_forwarder import S3LogForwarder

        backend = get_log_forwarder_backend()
        if backend == "supabase":
            _log_forwarder = SupabaseLogForwarder()
            if _log_forwarder.enabled:
                logging.info("Supabase log forwarding enabled")
            else:
                logging.info("Supabase log forwarding disabled")
        elif backend == "s3":
            _log_forwarder = S3LogForwarder.get_instance()
            if _log_forwarder.enabled:
                logging.info("S3 log forwarding enabled")
            else:
                logging.info("S3 log forwarding disabled")
    except Exception as e:
        logging.error("error when starting log forwarding: %s", str(e))

    logging.getLogger("httpx").setLevel(logging.ERROR)

    await get_event_poster().start()

    coordinator = CoordinatorServer()
    host = "0.0.0.0"
    port = NetConfig.get_listen_port()

    allowed_origins = [
        f"http://localhost:{port}",
        f"https://localhost:{port}",
        f"http://0.0.0.0:{port}",
        f"https://0.0.0.0:{port}",
        "https://callback.pepesilv.ai",
        "https://pepesilv.ai",
    ]

    await coordinator.start(
        host=host,
        port=port,
        base_path="/api",
        allowed_origins=allowed_origins,
    )

    async def _warm_database() -> None:
        try:
            service = DatabaseService.get()
            await service.initialize()
            coordinator.db_ready_event.set()
            logging.info("Database adapter initialized")
        except Exception:
            logging.exception(
                "Database initialization failed after the server started. "
                "The app will keep listening on %s:%s, but DB-backed requests "
                "will fail until the database configuration is fixed.",
                host,
                port,
            )

    await _warm_database()

    get_event_poster().emit(
        "/sse/event",
        payload={
            "event_type": "MESSAGE",
            "payload": {
                "message": "emit test ok",
            },
        },
    )

    stop_event = asyncio.Event()
    shutdown_started = False

    async def request_shutdown(reason: str) -> None:
        nonlocal shutdown_started
        if shutdown_started:
            logging.info("Shutdown already in progress; ignoring duplicate request: %s", reason)
            return
        shutdown_started = True
        await _graceful_shutdown(
            stop_event=stop_event,
            coordinator=coordinator,
            reason=reason,
        )

    def _sig_handler(sig: signal.Signals) -> None:
        try:
            signame = sig.name
        except Exception:
            signame = str(sig)
        logging.info("Received signal: %s", signame)
        asyncio.create_task(request_shutdown(f"received signal {signame}"))

    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, lambda s=sig: _sig_handler(s))
        except NotImplementedError:
            pass

    logging.info("Pepe Silv.AI system started")
    logging.info("- REST API: http://%s:%s/api", host, port)
    logging.info("- Browser extension should connect to the REST API")
    logging.info("Press Ctrl+C to shutdown...")

    idle_timeout_seconds = 600
    shutdown_timer: asyncio.Task | None = None

    def _count_inflight_jobs() -> tuple[int, int]:
        db = get_job_database()
        queued_count = len(db.get_jobs_by_status(JobStatus.QUEUED))
        running_count = len(db.get_jobs_by_status(JobStatus.RUNNING))
        return queued_count, running_count

    async def _log_running_jobs(running_jobs, label: str) -> None:
        for job in running_jobs:
            try:
                logging.info(
                    "%s: still running job id=%s details=%s",
                    label,
                    job.id,
                    job.model_dump(),
                )
            except Exception as e:
                logging.info("%s: still running job id=%s (model_dump failed: %s)", label, job.id, e)

    async def _idle_shutdown_countdown() -> None:
        db = get_job_database()
        already_logged_running = False

        try:
            while True:
                await asyncio.sleep(idle_timeout_seconds)

                queued_count, running_count = _count_inflight_jobs()
                inflight_total = queued_count + running_count

                if inflight_total > 0:
                    if running_count > 0 and queued_count == 0:
                        running_jobs = db.get_jobs_by_status(JobStatus.RUNNING)
                        if not already_logged_running:
                            await _log_running_jobs(running_jobs, "Idle shutdown defer")
                            already_logged_running = True
                            continue
                        else:
                            await _log_running_jobs(running_jobs, "Idle shutdown final")
                            logging.info(
                                "No new jobs started for 2x%s secs, requesting shutdown. FLY_MACHINE_ID=%r",
                                idle_timeout_seconds,
                                os.getenv("FLY_MACHINE_ID"),
                            )
                            await request_shutdown(f"idle timeout after {2 * idle_timeout_seconds}s")
                            return
                    logging.info(
                        "Idle shutdown deferred: queued=%s running=%s idle_timeout=%ss",
                        queued_count,
                        running_count,
                        idle_timeout_seconds,
                    )
                    already_logged_running = False
                    continue

                logging.info(
                    "No jobs enqueued/inflight for %ss, requesting shutdown. FLY_MACHINE_ID=%r",
                    idle_timeout_seconds,
                    os.getenv("FLY_MACHINE_ID"),
                )
                await request_shutdown(f"idle timeout after {idle_timeout_seconds}s")
                return
        except asyncio.CancelledError:
            logging.info("Idle shutdown countdown cancelled")
        except Exception:
            logging.exception("Unexpected error in idle shutdown countdown")
            await request_shutdown("idle shutdown countdown crashed")

    async def _reset_idle_shutdown() -> None:
        nonlocal shutdown_timer
        if shutdown_timer and not shutdown_timer.done():
            shutdown_timer.cancel()
            try:
                await shutdown_timer
            except asyncio.CancelledError:
                pass
        logging.info("Resetting idle shutdown timer to %ss", idle_timeout_seconds)
        shutdown_timer = asyncio.create_task(_idle_shutdown_countdown())

    original_enqueue = coordinator.enqueue_payload

    async def tracked_enqueue(payload: EnqueuePayload):
        result = await original_enqueue(payload)
        logging.info("tracked_enqueue got result: %s", result)
        await _reset_idle_shutdown()
        return result

    coordinator.enqueue_payload = tracked_enqueue

    try:
        encoded_startup_job = os.getenv("STARTUP_JOB")

        if encoded_startup_job:
            job_seconds = int(os.getenv("JOB_SECONDS", "86400"))

            def decode_urlsafe_maybe_broken(s: str) -> bytes:
                s = s.strip()
                s += "=" * ((4 - len(s) % 4) % 4)
                return base64.urlsafe_b64decode(s)

            decoded_startup_job = decode_urlsafe_maybe_broken(encoded_startup_job)
            payload = json.loads(decoded_startup_job.decode("utf-8"))

            enqueue_payload = EnqueuePayload.model_validate(payload)

            await coordinator.wait_until_ready()
            await coordinator.enqueue_payload(enqueue_payload)

            logging.info(
                "Startup job enqueued; keeping machine alive for up to %ss",
                job_seconds,
            )
            try:
                await asyncio.wait_for(stop_event.wait(), timeout=job_seconds)
            except asyncio.TimeoutError:
                logging.info("Startup job timed out after %ss", job_seconds)
                await request_shutdown(f"startup job timeout after {job_seconds}s")
        else:
            logging.info("No startup job, starting idle shutdown timer")
            await _reset_idle_shutdown()
            await stop_event.wait()

    finally:
        # This block may still run during normal exits, but idle/signal shutdown
        # paths now force-stop from _graceful_shutdown().
        if shutdown_timer and not shutdown_timer.done():
            shutdown_timer.cancel()
            try:
                await shutdown_timer
            except asyncio.CancelledError:
                pass

        logging.info("run() finally block entered")
        logging.info("run() finally block exiting")

    return 0


if __name__ == "__main__":
    asyncio.run(run())
