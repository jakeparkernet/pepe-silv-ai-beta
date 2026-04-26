from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Set, Tuple

import boto3
import httpx
import uvicorn
from fastapi import Body, FastAPI, Header, HTTPException, Query, Request, Response
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.core.events.static_events_factory import StaticEventsFactory
from app.core.jobs.db.job_database_factory import get_job_database
from app.core.jobs.db.job_event_types import EventType
from app.core.jobs.job import Job
from app.core.jobs.job_factory import get_job_factory
from app.core.jobs.job_sse_streamer import JobSseStreamer
from app.core.jobs.job_status import JobStatus
from app.core.jobs.persistence.edges import append_edge, get_edge_by_dedupe, get_edge_by_label
from app.core.jobs.persistence.events import read_events_range, read_events_since
from app.core.jobs.persistence.manifest import load_manifest
from app.core.jobs.persistence.snapshots import materialize_to_seq
from app.core.jobs.transport.event_mapper import EventMapper
from app.core.runtime.enqueue_payload import EnqueuePayload
from app.core.runtime.job_runner import JobRunner
from app.core.runtime.sqlite_indempotency import SQLiteIdempotency
from app.util.build_load_order_from_child_jobs import build_load_order_from_child_jobs
from app.util.generate_dedupe_key import generate_dedupe_key
from app.util.hmac_utils import validate_hmac
from app.core.jobs.openrouter_cost import OpenrouterCost
from app.util.s3_log_forwarder import S3LogForwarder

PEPE_API_KEY = os.getenv("PEPE_API_KEY")
if not PEPE_API_KEY:
    raise RuntimeError("PEPE_API_KEY not set in environment")

LAMBDA_ARN = os.getenv(
    "LAMBDA_ARN",
    "arn:aws:lambda:us-east-2:900232986494:function:echo_callback",
)
CALLBACK_URL = os.getenv(
    "CALLBACK_URL",
    "https://callback.pepesilv.ai",
)
MESSAGE = os.getenv("TEST_MESSAGE", "Echo Test!")
STARTUP_DELAY_SECONDS = float(os.getenv("STARTUP_DELAY_SECONDS", "3"))
IDEMPOTENCY_DB_PATH = os.getenv("IDEMPOTENCY_DB_PATH", "idempotency.db")

lambda_client = boto3.client("lambda",
    aws_access_key_id=os.getenv("AWS_ACCESS_KEY_ID_LAMBDA"),
    aws_secret_access_key=os.getenv("AWS_SECRET_ACCESS_KEY_LAMBDA"),
    region_name=os.getenv("AWS_DEFAULT_REGION_LAMBDA"))


class CoordinatorServer:
    def __init__(self) -> None:
        self.ready_event = asyncio.Event()
        self.db_ready_event = asyncio.Event()
        self.job_event = asyncio.Event()
        self.job_id: str | None = None
        self.job_result: Dict[str, Any] | None = None
        self.startup_delay_seconds = STARTUP_DELAY_SECONDS

        self.logger = logging.getLogger(__name__)
        self.job_runner = JobRunner.get_instance()
        self.event_mapper = EventMapper()
        self.job_sse_streamer = JobSseStreamer(
            mapper=self.event_mapper,
            close_on_terminal=False,
        )

        self.idempotency: SQLiteIdempotency | None = None
        self.auto_save_task: asyncio.Task[Any] | None = None
        self._server: uvicorn.Server | None = None
        self._serve_task: asyncio.Task[Any] | None = None
        self._routes_registered = False
        self._base_path = "/api"

        # Preserve attributes referenced by legacy helper/property code.
        self.job_spec: Dict[str, Any] | None = None
        self.job_specs: List[Dict[str, Any]] | None = None

        self.app = FastAPI(
            title="My Coordinator",
            lifespan=self._build_lifespan(),
        )

    def _build_lifespan(self):
        @asynccontextmanager
        async def lifespan(app: FastAPI):
            self.job_runner.start()
            self.auto_save_task = asyncio.create_task(self._auto_save_loop())
            self.idempotency = SQLiteIdempotency(IDEMPOTENCY_DB_PATH, ttl_seconds=600)
            self.db_ready_event.set()
            try:
                yield
            finally:
                self.db_ready_event.clear()
                if self.auto_save_task is not None:
                    self.auto_save_task.cancel()
                    try:
                        await self.auto_save_task
                    except asyncio.CancelledError:
                        pass
                    self.auto_save_task = None

        return lifespan

    def _register_routes(self, base_path: str, allowed_origins: List[str] | None = None) -> None:
        if self._routes_registered:
            return

        self._base_path = base_path

        self.app.add_middleware(
            CORSMiddleware,
            allow_origins=["*"],
            allow_credentials=False,
            allow_methods=["*"],
            allow_headers=["*"],
            expose_headers=["*"],
        )

        @self.app.exception_handler(StarletteHTTPException)
        async def starlette_http_exception_handler(request: Request, exc: StarletteHTTPException):
            logger = logging.getLogger("coordinator.http")
            if exc.status_code in (404, 405):
                body = (await request.body() or b"").decode("utf-8", "ignore")
                logger.info(
                    "HTTPException",
                    extra={
                        "status": exc.status_code,
                        "path": request.url.path,
                        "method": request.method,
                        "detail": exc.detail,
                        "query": request.url.query,
                        "client": getattr(request.client, "host", None),
                        "body_preview": body[:1000],
                    },
                )
            return JSONResponse({"detail": exc.detail}, status_code=exc.status_code)

        @self.app.exception_handler(Exception)
        async def generic_exception_handler(request: Request, exc: Exception):
            logger = logging.getLogger("coordinator.http")
            logger.exception(f"Unhandled exception: {exc}")
            return JSONResponse({"detail": {"error": "internal_error", "message": str(exc)}}, status_code=500)

        @self.app.get(f"{base_path}/health")
        async def health() -> Dict[str, Any]:
            return {
                "ok": True,
                "ready": self.ready_event.is_set(),
                "db_ready": self.db_ready_event.is_set(),
                "job_id": self.job_id,
                "got_response": self.job_event.is_set(),
            }

        @self.app.get(f"{base_path}/health_supa")
        async def health_supa() -> Dict[str, Any]:
            return {"ok": True}

        @self.app.post(f"{base_path}/job/response")
        async def on_job_response(
            request: Request,
            idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
        ) -> JSONResponse:

            logging.info("hit job response endpoint")
            raw = await request.body()
            S3LogForwarder.get_instance().forward(raw.decode("utf-8"))

            try:
                payload = json.loads(raw.decode("utf-8"))
            except Exception:
                return JSONResponse(
                    status_code=400,
                    content={"ok": False, "error": "bad_json"},
                )

            logging.info("got job response: %s", payload)

            if not self.ready_event.is_set():
                return JSONResponse(
                    status_code=503,
                    content={"ok": False, "error": "app not ready"},
                )

            incoming_job_id = payload.get("job_id")
            if self.job_id is not None and incoming_job_id != self.job_id:
                return JSONResponse(
                    status_code=400,
                    content={
                        "ok": False,
                        "error": "job_id mismatch",
                        "expected_job_id": self.job_id,
                        "received_job_id": incoming_job_id,
                    },
                )

            self.job_result = payload
            self.job_event.set()

            asyncio.create_task(
                self._process_job_response(
                    request=request,
                    raw=raw,
                    payload=payload,
                    idempotency_key=idempotency_key,
                )
            )
            
            return JSONResponse({"ok": True})

        @self.app.post(f"{base_path}/jobs/batch")
        async def jobs_batch(body: Dict[str, Any] = Body(...)) -> Dict[str, Any]:
            ids = body.get("ids") or []
            if not isinstance(ids, list) or not ids:
                raise HTTPException(status_code=400, detail={"status": "error", "reason": "ids must be a non-empty list"})
            fields = body.get("fields")
            if_changed_since = body.get("if_changed_since") or {}
            if len(ids) > 500:
                raise HTTPException(status_code=400, detail={"status": "error", "reason": "too many ids"})

            db = get_job_database()
            include_history = body.get("include_history", False)
            jobs_map = db.get_jobs(ids)
            not_found: List[str] = []
            unchanged: List[str] = []
            jobs_out: List[Dict[str, Any]] = []

            for _id in ids:
                job = jobs_map.get(_id)
                if job is None:
                    not_found.append(_id)
                    continue

                since = if_changed_since.get(_id) if isinstance(if_changed_since, dict) else None
                updated_at = getattr(job, "updated_at", 0.0)
                if since is not None and updated_at <= since:
                    unchanged.append(_id)
                    continue

                proj = job.model_dump()
                if fields:
                    proj = {k: proj.get(k) for k in fields if k in proj}

                if include_history:
                    proj["history"] = job.history

                jobs_out.append(proj)

            return {"jobs": jobs_out, "unchanged": unchanged, "not_found": not_found}

        @self.app.post("/api/sessions/{session_id}/save")
        async def save_session(session_id: str) -> Dict[str, Any]:
            db = get_job_database()
            if hasattr(db, "save_session_manifest"):
                db.save_session_manifest(session_id)
                return {"ok": True}
            return {"ok": False, "error": "adapter_missing_method"}

        @self.app.post("/api/sessions/{session_id}/load")
        async def load_session(session_id: str, resume: bool = Query(False)) -> Dict[str, Any]:
            if not session_id:
                raise HTTPException(status_code=400, detail={"status": "error", "reason": "missing session_id"})

            db = get_job_database()
            manifest = load_manifest(session_id)
            if not manifest:
                return {"status": "error", "reason": "no manifest found"}

            high_water_marks = manifest["high_water_marks"]
            states: List[Dict[str, Any]] = []
            for job_id, target_seq in high_water_marks.items():
                state = materialize_to_seq(session_id, job_id, target_seq)
                if state:
                    if "status" in state and isinstance(state["status"], str):
                        try:
                            state["status"] = JobStatus(state["status"].upper())
                        except ValueError:
                            state["status"] = JobStatus.INIT
                    states.append(state)

            if not states:
                return {"status": "error", "reason": "no jobs materialized"}

            ordered_states, job_tree = build_load_order_from_child_jobs(states, session_id=session_id)

            loaded_jobs: List[str] = []
            for state in ordered_states:
                spec = job_spec_from_state(state)
                creation_result = get_job_factory().create_job_from_spec(spec)
                job = creation_result["job"]
                if db.add_job(job):
                    job.status = state.get("status", job.status)
                    job.output = state.get("output", job.output)
                    job.history = state.get("history", job.history)
                    db.update_job(job)
                    loaded_jobs.append(job.id)

                    if job.status != JobStatus.COMPLETE:
                        job.status = JobStatus.QUEUED

            has_children = any(bool(node["children"]) for node in job_tree.values())
            logging.info("Session %s tree validation: has_children=%s", session_id, has_children)

            return {
                "status": "ok",
                "session_id": session_id,
                "loaded_jobs": loaded_jobs,
                "load_order": [s["id"] for s in ordered_states],
                "job_tree": job_tree,
            }

        @self.app.post(f"{base_path}/resume")
        async def resume(body: Dict[str, Any] = Body(...)) -> Dict[str, Any]:
            job_id = body["job_id"]
            platform = body.get("platform", "local")
            db = get_job_database()
            job = db.get_job(job_id)
            if job and job.status not in (JobStatus.COMPLETE, JobStatus.FAILED):
                from app.core.runtime.job_runner import get_job_runner

                get_job_runner().queue_job(job_id, platform)
            return {"status": "queued"}

        @self.app.get("/api/jobs/events")
        async def get_job_events(
            session_id: str = Query(...),
            job_id: str = Query(...),
            since_seq: int | None = Query(None),
            from_seq: int | None = Query(None),
            to_seq: int | None = Query(None),
            limit: int = Query(1000),
        ) -> Dict[str, Any]:
            if since_seq is not None:
                return {"events": read_events_since(session_id, job_id, since_seq, limit)}
            if from_seq is not None and to_seq is not None:
                return {"events": read_events_range(session_id, job_id, from_seq, to_seq)}
            raise HTTPException(400, "Provide since_seq or from_seq&to_seq")

        @self.app.post(f"{base_path}/jobs/events")
        async def jobs_events(body: Dict[str, Any] = Body(...)) -> Dict[str, Any]:
            since_seq = body.get("since_seq") or {}
            next_since: Dict[str, Any] = {}
            events: Dict[str, List[Any]] = {}
            if isinstance(since_seq, dict):
                for jid, seq in since_seq.items():
                    events[jid] = []
                    next_since[jid] = seq
            return {"events": events, "next_since_seq": next_since}

        @self.app.get(f"{base_path}/get-session-jobs")
        async def get_session_jobs(request: Request) -> Dict[str, Any]:
            qs = dict(request.query_params)
            session_id = qs.get("session_id")
            if not session_id:
                raise HTTPException(status_code=400, detail={"status": "error", "reason": "missing session_id"})

            try:
                offset = int(qs.get("offset", 0))
                max_length = int(qs.get("max_length", 200))
            except ValueError:
                raise HTTPException(status_code=400, detail={"status": "error", "reason": "bad offset/max_length"})

            if offset < 0 or max_length < 0:
                raise HTTPException(status_code=400, detail={"status": "error", "reason": "offset/max_length must be >= 0"})

            db = get_job_database()
            job_ids_result = db.get_session_job_ids(session_id, offset=offset, max_length=max_length)
            job_ids = job_ids_result["job_ids"]

            return {
                "session_id": session_id,
                "offset": offset,
                "count": len(job_ids),
                "result": job_ids_result,
            }

        @self.app.post(f"{base_path}/enqueue")
        async def enqueue(
            request: Request,
            payload: EnqueuePayload = Body(...),
            close_on_terminal: bool = Query(default=True),
        ):
            logging.info("enqueue endpoint hit")
            try:
                auth_header = request.headers.get("authorization")

                if not auth_header or not auth_header.startswith("Bearer "):
                    raise HTTPException(status_code=401, detail="Missing or invalid Authorization header")

                token = auth_header.removeprefix("Bearer ").strip()

                if token != PEPE_API_KEY:
                    raise HTTPException(status_code=401, detail="Invalid API key")

                result = await self.enqueue_payload(payload)
                # Always return a dict, never None, and sanitize for JSON
                if not isinstance(result, dict):
                    logging.warning("enqueue_payload returned non-dict: %s, converting", type(result))
                    result = {"result": result}
                
                # Sanitize the result to ensure it's JSON serializable
                def sanitize_for_json(obj):
                    if hasattr(obj, 'model_dump'):
                        return sanitize_for_json(obj.model_dump())
                    if hasattr(obj, 'dict'):
                        return sanitize_for_json(obj.dict())
                    if hasattr(obj, '__dict__'):
                        return sanitize_for_json(obj.__dict__)
                    if isinstance(obj, list):
                        return [sanitize_for_json(x) for x in obj]
                    if isinstance(obj, dict):
                        return {k: sanitize_for_json(v) for k, v in obj.items()}
                    return obj
                
                result = sanitize_for_json(result)
                return JSONResponse(content=result)
            except HTTPException:
                raise
            except Exception as e:
                logging.exception("enqueue endpoint error: %s", e)
                raise HTTPException(status_code=500, detail={"error": str(e)})

        @self.app.get(f"{base_path}/sse/stream")
        async def sse_stream() -> StreamingResponse:
            generator = self.job_sse_streamer.stream()
            return StreamingResponse(
                generator,
                media_type="text/event-stream",
                headers={
                    "Cache-Control": "no-cache, no-transform",
                    "Connection": "keep-alive",
                    "Access-Control-Allow-Origin": "*",
                    "X-Accel-Buffering": "no",
                },
            )

        @self.app.post(f"{base_path}/sse/event")
        async def sse_event(body: dict = Body(...)) -> Dict[str, Any]:
            db = get_job_database()
            job_payload = body.get("job") or {}
            if job_payload:
                job = Job.model_validate(job_payload)
                ev = db.update_job(job)
                self.job_sse_streamer.add_event(ev)
                return {"status": "queued", "job_id": job.id, "seq": ev.get("seq")}

            self.job_sse_streamer.add_event(body)
            return {"status": "queued"}

        @self.app.get("/api/sessions/recent")
        async def recent_sessions(limit: int = 5) -> Dict[str, Any]:
            manifests: List[Dict[str, Any]] = []
            try:
                from app.core.jobs.persistence.jsonl_store import get_state_dir

                manifest_dir = os.path.join(get_state_dir(), "sessions")
                if os.path.exists(manifest_dir):
                    for filename in os.listdir(manifest_dir):
                        if filename.endswith(".json"):
                            path = os.path.join(manifest_dir, filename)
                            with open(path) as manifest_file:
                                data = json.load(manifest_file)
                            manifests.append(
                                {
                                    "session_id": filename.replace(".json", ""),
                                    "saved_at": data.get("saved_at", 0),
                                    "job_count": len(data.get("high_water_marks", {})),
                                }
                            )
            except Exception as exc:
                logging.exception("Error scanning sessions: %s", exc)

            manifests.sort(key=lambda x: x["saved_at"], reverse=True)
            return {"sessions": manifests[:limit]}

        self._routes_registered = True

    async def _process_job_response(
        self,
        *,
        request: Request,
        raw: bytes,
        payload: Dict[str, Any],
        idempotency_key: str | None,
    ) -> None:
        logging.info("processing job response")
        try:
            ok, err = validate_hmac(
                method="POST",
                path=f"{self._base_path}/job/response",
                query=request.url.query,
                body_bytes=raw,
                headers={k: v for k, v in request.headers.items()},
                skew_seconds=300,
            )

            if not ok:
                logging.warning("Rejected callback due to invalid HMAC: %s", err)
                return

            if not isinstance(payload, dict):
                logging.warning("Rejected callback: payload is not a dict")
                return

            job_id = payload.get("job_id")
            if not job_id:
                logging.warning("Rejected callback: missing job_id")
                return

            if self.idempotency is None:
                logging.error("Idempotency store is not initialized")
                return

            if not idempotency_key:
                idempotency_key = hashlib.sha256(raw).hexdigest()

            scope = f"{request.method}:{request.url.path}"
            idemp_key = f"{scope}:{idempotency_key}"

            replay = await self.idempotency.claim_or_replay(idemp_key)
            if replay is not None:
                logging.info("Duplicate callback replay for job_id=%s", job_id)
                return

            db = get_job_database()
            job = db.get_job(job_id)

            if job is None:
                body = {
                    "status": "ok",
                    "job_id": job_id,
                    "idempotent": True,
                    "reason": "unknown_job",
                }
                await self.idempotency.store_done(idemp_key, 200, body)
                logging.info("Callback for unknown job %s; treating as idempotent OK", job_id)
                return

            if getattr(job, "status", None) == "complete":
                body = {
                    "status": "ok",
                    "job_id": job_id,
                    "idempotent": True,
                    "reason": "already_complete",
                }
                await self.idempotency.store_done(idemp_key, 200, body)
                return

            result_data = payload.get("result")

            full_completion = payload.get("full_completion")

            if full_completion is not None:
                logging.info(full_completion)

            if full_completion and isinstance(full_completion, dict):
                usage = full_completion.get("usage", {})
                cost = usage.get("cost")
                if cost is not None:
                    OpenrouterCost.get_instance().add_cost(cost)

            if isinstance(result_data, dict) and result_data.get("ok") is False:
                body = {
                    "status": "error",
                    "job_id": job_id,
                    "reason": "apply_failed",
                    "detail": json.dumps(result_data),
                }
                await self.idempotency.store_done(idemp_key, 500, body)
                logging.error("result_data not ok for job %s: %s", job_id, body["detail"])
                return

            try:
                job.apply_result(result_data)
            except Exception as exc:
                body = {
                    "status": "error",
                    "job_id": job_id,
                    "reason": "apply_failed",
                    "detail": str(exc),
                }
                await self.idempotency.store_done(idemp_key, 500, body)
                logging.exception("Exception when applying result to job %s", job_id)
                return

            body = {"status": "ok", "job_id": job_id}
            await self.idempotency.store_done(idemp_key, 200, body)
            logging.info(
                "job_response_complete: job_id=%s status=%s result_type=%s",
                job_id,
                getattr(job, "status", None),
                type(result_data).__name__ if result_data else "none",
            )
        except Exception:
            logging.exception("Unexpected failure while processing job callback")

    def _invoke_lambda(self) -> str:
        current_job_id = str(uuid.uuid4())

        payload: Dict[str, Any] = {
            "job_id": current_job_id,
            "message": MESSAGE,
            "callback_url": CALLBACK_URL,
        }

        fly_machine_id = os.getenv("FLY_MACHINE_ID")
        if fly_machine_id:
            payload["fly_force_instance_id"] = fly_machine_id

        logging.info("Invoking lambda with payload: %s", json.dumps(payload))

        lambda_client.invoke(
            FunctionName=LAMBDA_ARN,
            InvocationType="Event",
            Payload=json.dumps(payload).encode("utf-8"),
        )

        return current_job_id

    async def invoke_lambda_and_wait(self, timeout: float = 60.0) -> Dict[str, Any]:
        if not self.ready_event.is_set():
            raise RuntimeError("Server is not ready. Call start() first.")

        self.job_event.clear()
        self.job_result = None
        self.job_id = self._invoke_lambda()

        try:
            await asyncio.wait_for(self.job_event.wait(), timeout=timeout)
        except asyncio.TimeoutError:
            return {
                "status": "error",
                "reason": "lambda_callback_timeout",
                "job_id": self.job_id,
            }

        return {
            "status": "ok",
            "job_id": self.job_id,
            "result": self.job_result,
        }

    async def wait_until_ready(self) -> None:
        await self.ready_event.wait()

    async def _wait_for_health(self, url: str, timeout: float = 10.0) -> None:
        loop = asyncio.get_running_loop()
        start_time = loop.time()

        async with httpx.AsyncClient() as client:
            while True:
                try:
                    response = await client.get(url)
                    if response.status_code == 200:
                        return
                except Exception:
                    pass

                if loop.time() - start_time > timeout:
                    raise TimeoutError(f"Health check did not become ready in time: {url}")

                await asyncio.sleep(0.2)

    async def start(
        self,
        host: str = "0.0.0.0",
        port: int = 8080,
        base_path: str = "/api",
        allowed_origins: List[str] | None = None,
    ) -> Dict[str, Any]:
        self._register_routes(base_path, allowed_origins=allowed_origins)

        config = uvicorn.Config(
            self.app,
            host=host,
            port=port,
            log_level="info",
            loop="asyncio",
            workers=1,
        )
        self._server = uvicorn.Server(config)
        self._serve_task = asyncio.create_task(self._server.serve())

        while not self._server.started:
            await asyncio.sleep(0.1)

        logging.info("Coordinator server started on http://%s:%s", host, port)

        health_url = f"http://127.0.0.1:{port}{base_path}/health"
        await self._wait_for_health(health_url)

        if self.startup_delay_seconds > 0:
            logging.info(
                "Health check passed, waiting %ss before marking coordinator ready...",
                self.startup_delay_seconds,
            )
            await asyncio.sleep(self.startup_delay_seconds)

        self.ready_event.set()
        logging.info("Coordinator marked ready")

        return {
            "status": "ok",
            "server": {
                "host": host,
                "port": port,
                "base_path": base_path,
                "health_url": health_url,
            },
        }

    async def enqueue_payload(self, payload: EnqueuePayload) -> Dict[str, Any]:
        creation_results: List[Dict[str, Any]] = []

        logging.info("got enqueue payload: %s", payload.model_dump())

        for raw_spec in payload.specs_to_process:
            try:
                logging.info("got raw spec: %s", raw_spec)
                result = self._process_one_spec(raw_spec, payload)
                logging.info("creation_results passed: %s", result)
                creation_results.append(result)
            except HTTPException:
                raise
            except Exception as exc:
                creation_results.append(
                    {
                        "status": "error",
                        "job": None,
                        "edge": None,
                        "creation_result": None,
                        "error": str(exc),
                    }
                )
                logging.info("creation_results failed: %s", exc)

        logging.info("returning creation_results: %s", creation_results)

        if payload.job_spec is not None and payload.job_specs is None:
            result = creation_results[0]
            logging.info("returning single result: %s", result)
            return result

        result = {"creation_results": creation_results}
        logging.info("returning batch result: %s", result)
        return result

    def _has_active_investigation_job(self) -> bool:
        db = get_job_database()
        active_jobs = [
            *db.get_jobs_by_status(JobStatus.QUEUED),
            *db.get_jobs_by_status(JobStatus.RUNNING),
        ]

        for job in active_jobs:
            if getattr(job, "job_type", None) == "investigation":
                return True

        return False

    async def _auto_save_loop(self) -> None:
        while True:
            await asyncio.sleep(300)
            db = get_job_database()
            active_sessions = set()
            for job in db.get_jobs_by_status(JobStatus.RUNNING):
                if job.session_id and job.session_id != "UNKNOWN":
                    active_sessions.add(job.session_id)
            for session_id in active_sessions:
                try:
                    db.save_session_manifest(session_id)
                except Exception as exc:
                    logging.exception("Auto-save failed for %s: %s", session_id, exc)

    @property
    def specs_to_process(self) -> List[Dict[str, Any]]:
        if self.job_specs is not None:
            return self.job_specs
        if self.job_spec is not None:
            return [self.job_spec]
        return []

    def _process_one_spec(self, job_spec: Dict[str, Any], payload: EnqueuePayload) -> Dict[str, Any]:
        if not isinstance(job_spec, dict):
            raise HTTPException(status_code=400, detail={"status": "error", "reason": "job_spec must be a dict"})

        session_id = _normalize_and_infer_session_id(job_spec, payload.session_id)

        parent_id = job_spec.get("params", {}).get("parent_id")
        child_label = job_spec.get("child_label")
        if parent_id and not child_label:
            raise HTTPException(
                status_code=400,
                detail={"status": "error", "reason": "child_label is required when parent_id is provided"},
            )

        job_type = job_spec.get("type")
        if not job_type:
            raise HTTPException(status_code=400, detail={"status": "error", "reason": "job_spec.type is required"})

        if job_type == "investigation" and not parent_id:
            if self._has_active_investigation_job():
                raise HTTPException(
                    status_code=409,
                    detail={
                        "status": "error",
                        "reason": "active_investigation_exists",
                    },
                )

        dedupe_key = job_spec.get("dedupe_key")
        if not dedupe_key:
            dedupe_key = job_spec.get("params", {}).get("dedupe_key")
        if not dedupe_key:
            dedupe_key = generate_dedupe_key(
                {
                    "job_type": job_type,
                    "input": job_spec.get("params", {}).get("input"),
                }
            )
        if not dedupe_key:
            raise HTTPException(status_code=400, detail={"status": "error", "reason": "job_spec must contain a dedupe_key"})

        spec_min = job_spec.get("spec_min", {})
        db = get_job_database()

        job_id = self._extract_job_id(job_spec.get("params", {}))
        attached_existing = False
        edge = None
        if _pre_attach_checks(session_id, parent_id, child_label, dedupe_key):
            edge, attached_existing = _record_edge_with_race_handling(
                session_id=session_id,
                parent_id=parent_id,
                child_label=child_label,
                job_id=job_id,
                job_spec=job_spec,
                dedupe_key=dedupe_key,
                spec_min=spec_min,
            )
            if attached_existing:
                job_id = edge.get("child_job_id")
                if db.get_job(job_id) is not None:
                    _best_effort_persist_and_emit(session_id, job_id)
                    return {
                        "status": "ok",
                        "job": {"id": job_id, "session_id": session_id},
                        "edge": edge,
                        "creation_result": {"status": "existing"},
                    }
                else:
                    attached_existing = False

        creation_result = get_job_factory().create_job_from_spec(job_spec)
        if creation_result.get("status") != "success":
            return {
                "status": "error",
                "job": {"id": job_id, "session_id": session_id},
                "edge": edge,
                "creation_result": {"status": creation_result.get("status"), "error": creation_result.get("error")},
            }

        job = creation_result["job"]
        job_id = job.id

        if parent_id and child_label:
            edge, _ = _record_edge_with_race_handling(
                session_id=session_id,
                parent_id=parent_id,
                child_label=child_label,
                job_id=job_id,
                job_spec=job_spec,
                dedupe_key=dedupe_key,
                spec_min=spec_min,
            )

        if db.add_job(job):
            job.set_status(JobStatus.QUEUED)

        _best_effort_persist_and_emit(session_id, job_id)

        return {
            "status": "ok",
            "job": {"id": job_id, "session_id": session_id},
            "edge": edge,
            "creation_result": {"status": creation_result.get("status"), "job_id": job.id},
        }

    def _create_job_or_raise(self, job_spec: Dict[str, Any]) -> Tuple[str, Dict[str, Any]]:
        try:
            creation_result = get_job_factory().create_job_from_spec(job_spec)
            if isinstance(creation_result, dict) and creation_result.get("status") == "error":
                raise HTTPException(status_code=400, detail=creation_result)

            job_id = self._extract_job_id(creation_result.get("job", creation_result))
            if not job_id:
                raise HTTPException(status_code=500, detail={"status": "error", "reason": "failed to extract job_id"})
        except Exception as exc:
            self.logger.error(str(exc))
            raise
        return job_id, creation_result

    def _parse_event_types(self, names: List[str]) -> Set[EventType]:
        parsed: Set[EventType] = set()
        for name in names:
            try:
                parsed.add(EventType[name])
                continue
            except Exception:
                pass
            try:
                parsed.add(EventType(name))
            except Exception:
                pass
        return parsed

    def _extract_job_id(self, result: Any) -> Optional[str]:
        if isinstance(result, dict):
            if "id" in result and isinstance(result["id"], str):
                return result["id"]
            job = result.get("job")
            if isinstance(job, dict) and "id" in job and isinstance(job["id"], str):
                return job["id"]
            if hasattr(job, "id"):
                return getattr(job, "id")
        if hasattr(result, "id"):
            return getattr(result, "id")
        return None

    async def stop(self) -> None:
        if self._server is not None:
            self._server.should_exit = True

        if self._serve_task is not None:
            try:
                await self._serve_task
            except asyncio.CancelledError:
                pass

        self._server = None
        self._serve_task = None
        self.ready_event.clear()
        self.job_event.clear()
        self.job_id = None
        self.job_result = None


def _normalize_and_infer_session_id(job_spec: Dict[str, Any], payload_session_id: Optional[str]) -> Optional[str]:
    session_id = job_spec.get("session_id") or payload_session_id
    if not session_id:
        params = job_spec.get("params", {}) if isinstance(job_spec, dict) else {}
        coord_id = params.get("coordinator_id") or params.get("parent_id")
        if coord_id:
            db = get_job_database()
            parent = db.get_job(coord_id)
            if parent and getattr(parent, "session_id", None):
                session_id = parent.session_id
    job_spec["session_id"] = session_id
    return session_id


def _pre_attach_checks(session_id: Optional[str], parent_id: Optional[str], label: Optional[str], dedupe_key: Optional[str]) -> bool:
    return bool(session_id and parent_id and label and dedupe_key)


def _find_existing_attachment(session_id: str, parent_id: str, label: str, dedupe_key: str) -> Optional[Dict[str, Any]]:
    try:
        edge_by_dedupe = get_edge_by_dedupe(session_id=session_id, dedupe_key=dedupe_key)
        if edge_by_dedupe and edge_by_dedupe.get("child_job_id"):
            return edge_by_dedupe
    except Exception:
        pass
    try:
        edge_by_label = get_edge_by_label(parent_id=parent_id, session_id=session_id, child_label=label)
        if edge_by_label and edge_by_label.get("child_job_id"):
            return edge_by_label
    except Exception:
        pass
    return None


def _record_edge_with_race_handling(
    *,
    session_id: str,
    parent_id: str,
    child_label: str,
    job_id: str,
    job_spec: Dict[str, Any],
    dedupe_key: str,
    spec_min: Optional[Dict[str, Any]],
) -> Tuple[Optional[Dict[str, Any]], bool]:
    child_type = job_spec.get("type")
    if not child_type:
        raise HTTPException(
            status_code=400,
            detail={"status": "error", "reason": "job_spec.type is required when recording an edge"},
        )

    try:
        edge = append_edge(
            session_id=session_id,
            parent_id=parent_id,
            child_label=child_label,
            child_job_id=job_id,
            child_type=child_type,
            dedupe_key=dedupe_key,
            spec_min=spec_min or {},
        )
        return edge, False
    except Exception:
        existing = _find_existing_attachment(
            session_id=session_id,
            parent_id=parent_id,
            label=child_label,
            dedupe_key=dedupe_key,
        )
        if existing and existing.get("child_job_id"):
            return existing, True
        raise


def _best_effort_persist_and_emit(session_id: Optional[str], job_id: Optional[str]) -> None:
    try:
        if not job_id:
            return

        db = get_job_database()
        job_obj = db.get_job(job_id)
        if job_obj is not None and session_id:
            try:
                job_obj.session_id = session_id
                db.update_job(job_obj)
            except Exception:
                pass

        if session_id:
            evt = {
                "event_type": EventType.JOB_QUEUED.value if hasattr(EventType, "JOB_QUEUED") else "JOB_QUEUED",
                "seq": 0,
                "ts": datetime.now(timezone.utc).isoformat(),
                "job_id": job_id,
                "payload": {"job": {"id": job_id, "session_id": session_id}},
            }
            bus = StaticEventsFactory.get_events("job")
            try:
                bus.fire(job_id, evt)
                bus.fire(f"session:{session_id}", evt)
                bus.fire("*", evt)
            except Exception:
                pass
    except Exception:
        pass


def job_spec_from_state(state: Dict[str, Any]) -> Dict[str, Any]:
    job_type = state.get("job_type")
    if not job_type:
        raise ValueError("Saved state is missing required field 'job_type'")

    job_id = state.get("id")
    if not job_id:
        raise ValueError("Saved state is missing required field 'id'")

    params: Dict[str, Any] = dict(state)
    params["was_loaded"] = True

    spec: Dict[str, Any] = {
        "type": job_type,
        "job_id": job_id,
        "parent_id": state.get("parent_id"),
        "params": params,
    }

    if state.get("label"):
        spec["label"] = state["label"]

    return spec
