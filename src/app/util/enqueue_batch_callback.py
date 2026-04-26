import asyncio
import inspect
import logging
from datetime import datetime
from typing import List, Dict, Any, Optional
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
from app.util.fire_and_forget import fire_and_forget
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


def enqueue_batch_callback(
    base_url: str = "",
    *,
    job_specs: List[Dict[str, Any]],
    headers: dict | None = None,
    post_timeout: float = 5.0,
    event_timeout: float = 60.0,
    on_updates: List[Optional[Callable]] = None,  # List matching specs
    on_completes: List[Optional[Callable]] = None,
    on_errors: List[Optional[Callable]] = None,
    executor: ThreadPoolExecutor | None = None,
    thread_name: Optional[str] = None,
):
    if len(job_specs) == 0:
        return

    caller_loop = None
    in_async = False
    try:
        caller_loop = asyncio.get_running_loop()
        in_async = True
    except RuntimeError:
        in_async = False

    _on_updates = [_make_dispatcher(cb, caller_loop) for cb in (on_updates or [])]
    _on_completes = [_make_dispatcher(cb, caller_loop) for cb in (on_completes or [])]
    _on_errors = [_make_dispatcher(cb, caller_loop) for cb in (on_errors or [])]

    if len(_on_updates) != len(job_specs):
        _on_updates = [None] * len(job_specs)  # Pad if needed
    # Similar for completes/errors

    if len(base_url) == 0:
        base_url = NetConfig.get_base_url()

    job_ids_local = []
    for i, spec in enumerate(job_specs):
        job_id = spec["params"].get("id") or str(uuid4())
        spec["params"]["id"] = job_id
        job_ids_local.append(job_id)

    def _runner():
        try:
            events = StaticEventsFactory.get_events("job")
            timeout_handles = [None] * len(job_specs)

            handlers = []
            for idx, job_id in enumerate(job_ids_local):
                def make_handler(i=idx, jid=job_id):
                    def handler(evt: dict):
                        nonlocal timeout_handles
                        evt_job_id = evt.get("job_id") or ((evt.get("payload") or {}).get("job") or {}).get("id")
                        if evt_job_id != jid:
                            return

                        if timeout_handles[i]:
                            timeout_handles[i].cancel()
                            timeout_handles[i] = None

                        if _on_updates[i]:
                            _on_updates[i](evt)

                        if evt.get("event_type") == "ON_COMPLETE":
                            return_obj = { ... }
                            if _on_completes[i]:
                                _on_completes[i](return_obj)
                            events.unsubscribe(jid, handler)

                    return handler

                h = make_handler()
                events.subscribe(job_id, h)
                handlers.append(h)

            # Set timeouts per job
            def make_timeout(i):
                def timeout():
                    events.unsubscribe(job_ids_local[i], handlers[i])
                    if _on_errors[i]:
                        _on_errors[i]({"error": "Timeout waiting for completion", "job_id": job_ids_local[i]})

                return timeout

            for i in range(len(job_specs)):
                timeout_handles[i] = set_timeout(make_timeout(i), event_timeout)

            # POST batch
            def _post_batch():
                url = f"{base_url.rstrip('/')}/enqueue"
                body = {"job_specs": job_specs, "close_on_terminal": True}

                now_readable = datetime.now().strftime('%B %d, %Y, %H:%M:%S.%f')[:-3]
                batch_id = f"batch-{now_readable}"
                success = _post_with_retry(url, body, headers, batch_id)
                if not success:
                    for i in range(len(job_specs)):
                        if _on_errors[i]:
                            _on_errors[i]({"error": "Batch POST failed", "job_id": job_ids_local[i]})
                        # Mark failed via fail cb if attached
                        if hasattr(_on_completes[i], "fail"):
                            _on_completes[i].fail("Batch enqueue failed")

            post_thread = threading.Thread(target=_post_batch, daemon=True)
            post_thread.start()

            # DB checks for races
            db = get_job_database()
            for i, job_id in enumerate(job_ids_local):
                job_obj = db.get_job(job_id)
                if job_obj and job_obj.status in [JobStatus.COMPLETE, JobStatus.FAILED]:
                    synthetic_evt = {"event_type": "ON_COMPLETE", "payload": {"job": job_obj.dict()}}
                    handlers[i](synthetic_evt)

        except Exception as e:
            logger.exception("Batch enqueue setup failed")
            for _on_error in _on_errors:
                if _on_error:
                    _on_error({"error": str(e)})

    if in_async:
        fut = caller_loop.run_in_executor(executor, _runner)
        return fut
    else:
        t = threading.Thread(target=_runner, daemon=True, name=thread_name or "enqueue-cb")
        t.start()
        return t
