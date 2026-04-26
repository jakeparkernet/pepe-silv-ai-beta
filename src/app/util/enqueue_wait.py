
from __future__ import annotations

import json
import threading
import time
from typing import Callable, Optional
import httpx

from app.core.events.static_events_factory import StaticEventsFactory
from app.util.callback_dispatch import dispatch_callback
from app.util.get_value_safe import get_value_safe
from app.config import NetConfig

def _http_post_json(url: str, body: dict, headers: Optional[dict] = None) -> dict:
    """
    POST JSON using httpx if present; otherwise urllib. Returns parsed JSON object.
    Raises on non-2xx or invalid JSON.
    """
    headers = headers or {}
    payload = json.dumps(body).encode("utf-8")

    if httpx is not None:
        resp = httpx.post(url, content=payload, headers=headers, timeout=None)
        resp.raise_for_status()
        return resp.json()


def enqueue_wait(
    base_url: str = "",
    *,
    job_spec: dict | None = None,
    job_id: str | None = None,
    headers: dict | None = None,
    timeout: float | None = None,
    on_update: Optional[Callable] = None,
    on_complete: Optional[Callable] = None,
):
    """
    Enqueue (or attach to) a job and block until completion using the internal events bus.

    Behavior:
      - If job_spec is provided (preferred), POST to {base}/api/enqueue and capture job_id.
      - If job_id is provided, do not enqueue; simply subscribe to events for that job.
      - Subscribes to get_events("job").subscribe(job_id, handler).
      - Calls on_update on every event for this job.
      - Calls on_complete on ON_COMPLETE, then unsubscribes and returns a result dict.

    Returns:
      { "job_id": str, "status": str | None, "result": Any, "raw": dict }
    """
    if not (job_spec or job_id):
        raise ValueError("Provide job_spec or job_id")

    if headers is None:
        headers = {"Content-Type": "application/json"}

    if len(base_url) == 0:
        base_url = NetConfig.get_base_url()

    # 1) Ensure we have a job_id (create if needed, via /api/enqueue)
    if job_id is None:
        url = f"{base_url.rstrip('/')}/enqueue"
        # Keep the body simple; coordinator can accept job_spec as-is.
        body = {"job_spec": job_spec, "close_on_terminal": True}
        resp = _http_post_json(url, body, headers=headers or None)
        # Accept either {"id": "..."} or {"job": {"id": "..."}}
        job_id = resp.get("id") or (resp.get("job") or {}).get("id")
        if not job_id:
            raise RuntimeError(f"enqueue returned unexpected response: {resp!r}")

    # 2) Subscribe to the events bus for this job_id
    events = StaticEventsFactory.get_events("job")
    done = threading.Event()
    result_holder: dict = {}

    # ---- stub logging hook (no-op for now) ----
    def _log_event_stub(evt: dict) -> None:
        # Placeholder for future event persistence / metrics.
        # Intentionally a no-op for now.
        return

    def _handler(evt: dict):
        # Filter strictly by job_id (bus key already scopes this, but be safe)
        evt_job_id = evt.get("job_id") or ((evt.get("payload") or {}).get("job") or {}).get("id")
        if evt_job_id and evt_job_id != job_id:
            return

        _log_event_stub(evt)

        # Fire on_update for every event
        if on_update:
            dispatch_callback(on_update, evt)

        # On completion → call on_complete, capture return object, and signal done
        if evt.get("event_type") == "ON_COMPLETE":
            job_obj = (evt.get("payload") or {}).get("job") or {}
            return_obj = {
                "job_id": get_value_safe(job_obj, "id", None),
                "status": get_value_safe(job_obj, "status", None),
                "result": get_value_safe(job_obj, "output", None),
                "raw": evt,
            }
            if on_complete:
                dispatch_callback(on_complete, return_obj)
            result_holder.update(return_obj)
            done.set()

    # Record the subscription and ensure we can unsubscribe
    events.subscribe(job_id, _handler)  # type: ignore[attr-defined]

    # 3) Block until completion or timeout
    try:
        if timeout is not None:
            finished = done.wait(timeout)
            if not finished:
                raise TimeoutError(f"Timed out waiting for job {job_id}")
        else:
            while not done.is_set():
                # light sleep to yield; Events implementation is callback-driven
                time.sleep(0.01)
    finally:
        # Attempt to unsubscribe; ignore if API differs or absent
        try:
            events.unsubscribe(job_id, _handler)  # type: ignore[attr-defined]
        except Exception:
            pass

    # 4) Return the completion object (even if empty; callers can inspect 'raw')
    return result_holder or {"job_id": job_id, "status": None, "result": None, "raw": {}}
