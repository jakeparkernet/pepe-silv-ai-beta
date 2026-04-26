import asyncio
import inspect
import logging
import threading
from concurrent.futures import ThreadPoolExecutor
from typing import Callable, Optional
from uuid import uuid4
import httpx
import time
from app.core.events.static_events_factory import StaticEventsFactory
from app.core.jobs.db.job_database_factory import get_job_database
from app.core.jobs.job_status import JobStatus
from app.util.get_value_safe import get_value_safe
from app.config import NetConfig
from app.util.set_timeout import set_timeout
import os

logger = logging.getLogger(__name__)

def _make_dispatcher(cb: Optional[Callable], caller_loop: Optional[asyncio.AbstractEventLoop]):
    if cb is None:
        return None

    is_coro_fn = inspect.iscoroutinefunction(cb)

    if not is_coro_fn:
        def _dispatch(arg):
            try: cb(arg)
            except Exception: logger.exception("enqueue callback raised")
        return _dispatch

    def _dispatch_async(arg):
        try:
            if caller_loop and caller_loop.is_running():
                fut = asyncio.run_coroutine_threadsafe(cb(arg), caller_loop)
                fut.add_done_callback(lambda f: f.result())
            else:
                asyncio.run(cb(arg))
        except Exception:
            logger.exception("enqueue async callback scheduling failed")
    return _dispatch_async

def _post_with_retry(url, body, headers, batch_id, max_retries=5):
    if headers is None:
        headers = {}
    else:
        headers = dict(headers)

    headers.setdefault("Content-Type", "application/json")

    pepe_api_key = os.getenv("PEPE_API_KEY")
    if pepe_api_key:
        headers["Authorization"] = f"Bearer {pepe_api_key}"

    timeout = httpx.Timeout(30.0, connect=10.0)

    for attempt in range(max_retries):
        try:
            resp = httpx.post(
                url,
                json=body,
                headers=headers,
                timeout=timeout,
            )
            resp.raise_for_status()
            logger.debug(f"Batch {batch_id} POST success")
            return True

        except Exception as e:
            logger.warning(f"Batch {batch_id} attempt {attempt + 1} failed: {e}")

            if attempt < max_retries - 1:
                time.sleep(1 * (2 ** attempt))  # exponential backoff
            else:
                logger.error(f"Batch {batch_id} failed permanently: {e}")
                return False

    return False

def enqueue_callback(
    base_url: str = "",
    *,
    job_spec: dict | None = None,
    job_id: str | None = None,
    headers: dict | None = None,
    post_timeout: float = 5.0,        # HTTP timeout
    event_timeout: float = 30.0,      # Max wait for ON_COMPLETE
    on_update: Optional[Callable] = None,
    on_complete: Optional[Callable] = None,
    on_error: Optional[Callable] = None,
    executor: ThreadPoolExecutor | None = None,
    thread_name: Optional[str] = None,
):
    """
    Fire-and-forget enqueue with client-generated job_id.
    - Generates job_id if None.
    - Subscribes to events *before* POST.
    - Sends POST in background thread.
    - Calls on_complete on ON_COMPLETE.
    - Auto-unsubscribes.
    """
    caller_loop = None
    in_async = False
    try:
        caller_loop = asyncio.get_running_loop()
        in_async = True
    except RuntimeError:
        in_async = False

    _on_update = _make_dispatcher(on_update, caller_loop)
    _on_complete = _make_dispatcher(on_complete, caller_loop)
    _on_error = _make_dispatcher(on_error, caller_loop)

    if len(base_url) == 0:
        base_url = NetConfig.get_base_url()

    if job_id is None:
        if "job_id" in job_spec:
            job_id = job_spec["job_id"]
        else:
            if ("params" in job_spec and
                "id" in job_spec["params"]):
                job_id = job_spec["params"]["id"]

    job_id_local = job_id or str(uuid4())

    def _runner():
        try:
            events = StaticEventsFactory.get_events("job")
            timeout_handle = None

            def _handler(evt: dict):
                nonlocal timeout_handle

                # Cancel timeout on any activity
                if timeout_handle:
                    timeout_handle.cancel()
                    timeout_handle = None

                evt_job_id = evt.get("job_id") or ((evt.get("payload") or {}).get("job") or {}).get("id")
                if evt_job_id != job_id_local:
                    return

                if _on_update:
                    _on_update(evt)

                if evt.get("event_type") == "ON_COMPLETE":
                    job_obj = (evt.get("payload") or {}).get("job") or {}
                    return_obj = {
                        "job_id": get_value_safe(job_obj, "id", None),
                        "status": get_value_safe(job_obj, "status", None),
                        "result": get_value_safe(job_obj, "output", None),
                        "raw": evt,
                    }
                    if _on_complete:
                        _on_complete(return_obj)

                    # Unsubscribe
                    try:
                        events.unsubscribe(job_id_local, _handler)
                    except Exception:
                        pass

            # Subscribe BEFORE posting
            events.subscribe(job_id_local, _handler)

            # Set event timeout
            def _event_timeout():
                try:
                    events.unsubscribe(job_id_local, _handler)
                except Exception:
                    pass
                if _on_error:
                    _on_error({"error": "Timeout waiting for job completion", "job_id": job_id_local})

            timeout_handle = set_timeout(_event_timeout, event_timeout)

            def _handle_post_result(success: bool):
                if not success:
                    # POST failed permanently → fail the child
                    # We can't access parent directly, so use ChildRunner
                    # But we need a way to mark failure from outside...
                    # → We'll add a `fail_callback` to make_callbacks
                    if hasattr(on_complete, "fail"):  # We'll monkey-patch this
                        on_complete.fail("Enqueue POST failed")
                    else:
                        logger.error(f"Cannot fail job {job_id_local}: no fail callback")

            def _post():
                url = f"{base_url.rstrip('/')}/enqueue"
                body = {
                    "job_spec": job_spec,
                    "job_id": job_id_local,  # Tell server the ID
                    "close_on_terminal": True
                }
                return _post_with_retry(url, body, headers, job_id_local)

            post_thread = threading.Thread(target=lambda: _handle_post_result(_post()), daemon=True)
            post_thread.start()

            # Optional: Immediate DB check (race where job already done)
            db = get_job_database()
            job_obj = db.get_job(job_id_local)
            if job_obj and job_obj.status in [JobStatus.COMPLETE, JobStatus.FAILED]:
                synthetic_evt = {
                    "event_type": "ON_COMPLETE",
                    "payload": {"job": job_obj.dict()},
                }
                _handler(synthetic_evt)

        except Exception as e:
            logger.exception("enqueue_callback setup failed")
            if _on_error:
                _on_error({"error": str(e)})

    # Async or sync spawn
    if in_async:
        fut = caller_loop.run_in_executor(executor, _runner)
        return fut
    else:
        t = threading.Thread(target=_runner, daemon=True, name=thread_name or "enqueue-cb")
        t.start()
        return t