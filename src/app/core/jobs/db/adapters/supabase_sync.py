"""
Fire-and-forget Supabase sync sidecar for the JSONL adapter.

Behavior:
- sync_created(job): create the row once using a full-record upsert
- sync_completed(job): write final state when a job completes
- writes are serialized through a single background worker so ordering is preserved

Why this shape:
- avoids high-frequency writes while jobs are still running
- preserves non-blocking behavior for the caller
- tolerates duplicate "created" events
"""

import json
import logging
import os
from concurrent.futures import ThreadPoolExecutor
from typing import TYPE_CHECKING, Any, Dict, List, Optional

from app.util.sync_config import get_sync_backend

if TYPE_CHECKING:
    from app.core.jobs.job import Job

logger = logging.getLogger(__name__)

_TABLE = "all_jobs"
_client = None
_pool = ThreadPoolExecutor(max_workers=1)
_enabled: Optional[bool] = None
_machine_id: Optional[str] = None
_SERIALIZATION_FAILED = object()


def _is_enabled() -> bool:
    global _enabled
    if _enabled is None:
        _enabled = get_sync_backend() == "supabase"
    return _enabled


def _get_machine_id() -> str:
    global _machine_id
    if _machine_id is None:
        from app.util.sync_config import get_machine_id
        _machine_id = get_machine_id()
    return _machine_id


def _get_client():
    global _client
    if _client is None:
        from supabase import create_client

        _client = create_client(
            os.getenv("SUPABASE_URL"),
            os.getenv("SUPABASE_SERVICE_ROLE_KEY"),
        )
    return _client


def _status_value(job: "Job") -> Any:
    return job.status.value if hasattr(job.status, "value") else job.status


def _serialization_error(value: Any) -> str:
    return f"{type(value).__name__}: could not serialize"


def _try_model_dump(value: Any) -> Any:
    model_dump = getattr(value, "model_dump", None)
    if not callable(model_dump):
        return _SERIALIZATION_FAILED

    for kwargs in ({"mode": "json"}, {}):
        try:
            return model_dump(**kwargs) if kwargs else model_dump()
        except Exception:
            continue

    return _SERIALIZATION_FAILED


def _try_serialize(value: Any) -> Any:
    serialize = getattr(value, "serialize", None)
    if not callable(serialize):
        return _SERIALIZATION_FAILED
    try:
        return serialize()
    except Exception:
        return _SERIALIZATION_FAILED


def _try_stringify(value: Any) -> Any:
    try:
        return str(value)
    except Exception:
        return _SERIALIZATION_FAILED


def _try_shallow_props(value: Any) -> Any:
    try:
        props = vars(value)
    except Exception:
        props = None

    if not isinstance(props, dict) or not props:
        return _SERIALIZATION_FAILED

    shallow: Dict[str, str] = {}
    for key, prop_value in props.items():
        prop_as_str = _try_stringify(prop_value)
        shallow[str(key)] = (
            prop_as_str
            if prop_as_str is not _SERIALIZATION_FAILED
            else _serialization_error(prop_value)
        )
    return shallow


def _json_fallback(value: Any) -> Any:
    dumped = _try_model_dump(value)
    if dumped is not _SERIALIZATION_FAILED:
        return dumped

    serialized = _try_serialize(value)
    if serialized is not _SERIALIZATION_FAILED:
        return serialized

    stringified = _try_stringify(value)
    if stringified is not _SERIALIZATION_FAILED:
        return stringified

    shallow_props = _try_shallow_props(value)
    if shallow_props is not _SERIALIZATION_FAILED:
        return shallow_props

    return _serialization_error(value)


def _json_or_none(value: Any) -> Optional[str]:
    if value is None:
        return None

    try:
        return json.dumps(value)
    except Exception:
        pass

    try:
        return json.dumps(value, default=_json_fallback)
    except Exception:
        return json.dumps(_serialization_error(value))


def _history_texts(job: "Job") -> List[str]:
    if not job.history:
        return []

    history_texts: List[str] = []
    for event in job.history:
        event_text = _json_or_none(event)
        if event_text is None:
            event_text = json.dumps(_serialization_error(event))
        history_texts.append(event_text)
    return history_texts


def _full_record(job: "Job") -> Dict[str, Any]:
    return {
        "job_id": job.id,
        "type": job.job_type or job.__class__.__name__,
        "status": _status_value(job),
        "input": _json_or_none(job.input),
        "output": _json_or_none(job.output),
        "history": _history_texts(job),
        "parent_id": job.parent_id,
        "session_id": job.session_id,
        "label": job.label,
        "description": job.description,
        "updated_at": job.updated_at,
        "machine_id": _get_machine_id(),
    }


def _submit_create(record: Dict[str, Any]):
    if not _is_enabled():
        return
    _pool.submit(_safe_create, record)


def _submit_update(job_id: str, patch: Dict[str, Any], full_record: Optional[Dict[str, Any]] = None):
    if not _is_enabled():
        return
    _pool.submit(_safe_update, job_id, patch, full_record)


def _safe_create(record: Dict[str, Any]):
    try:
        logger.debug("supabase_sync create record job_id=%s payload=%s", record.get("job_id"), record)
        _get_client().table(_TABLE).upsert(record, on_conflict="job_id").execute()
    except Exception as e:
        logger.warning("supabase_sync create error: %s", e)


def _safe_update(job_id: str, patch: Dict[str, Any], full_record: Optional[Dict[str, Any]] = None):
    try:
        logger.debug("supabase_sync update patch job_id=%s patch=%s", job_id, patch)

        result = (
            _get_client()
            .table(_TABLE)
            .update(patch)
            .eq("job_id", job_id)
            .execute()
        )

        data = getattr(result, "data", None)

        if not data:
            logger.warning(
                "supabase_sync update found no existing row for job_id=%s patch=%s",
                job_id,
                patch,
            )

            if full_record is not None:
                logger.warning(
                    "supabase_sync falling back to create for missing row job_id=%s",
                    job_id,
                )
                _safe_create(full_record)

    except Exception as e:
        logger.warning("supabase_sync update error: %s", e)


# ── public API ──────────────────────────────────────────────────────────────

def sync_created(job: "Job"):
    """
    Create the row once using a full-record upsert.

    We intentionally use upsert here so duplicate create events do not explode.
    """
    _submit_create(_full_record(job))


def sync_completed(job: "Job"):
    full_record = _full_record(job)
    _submit_update(
        job.id,
        full_record,
        full_record=full_record,
    )


def sync_status(_job: "Job"):
    return


def sync_history(_job: "Job"):
    return


def sync_output(_job: "Job"):
    return


def sync_full(job: "Job"):
    sync_completed(job)
