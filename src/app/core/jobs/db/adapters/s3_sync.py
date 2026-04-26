"""
Fire-and-forget S3 sync sidecar for the JSONL adapter.

Behavior:
- sync_created(job): create the object once using a full-record put
- sync_completed(job): write final state when a job completes
- writes are serialized through a single background worker so ordering is preserved

Why this shape:
- avoids high-frequency writes while jobs are still running
- preserves non-blocking behavior for the caller
"""

import json
import logging
import os
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from typing import TYPE_CHECKING, Any, Dict, List, Optional

if TYPE_CHECKING:
    from app.core.jobs.job import Job

logger = logging.getLogger(__name__)

_client = None
_pool = ThreadPoolExecutor(max_workers=1)
_enabled: Optional[bool] = None
_machine_id: Optional[str] = None
_SERIALIZATION_FAILED = object()


def _is_enabled() -> bool:
    global _enabled
    if _enabled is None:
        from app.util.sync_config import get_sync_backend
        _enabled = get_sync_backend() == "s3"
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
        import boto3

        _client = boto3.client(
            "s3",
            aws_access_key_id=os.getenv("AWS_ACCESS_KEY_ID_SYNC"),
            aws_secret_access_key=os.getenv("AWS_SECRET_ACCESS_KEY_SYNC"),
            region_name=os.getenv("AWS_DEFAULT_REGION_SYNC", "us-east-2"),
        )
    return _client


def _get_bucket() -> str:
    return os.getenv("S3_BUCKET_SYNC", "")


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
        "updated_at": str(job.updated_at) if job.updated_at else None,
        "machine_id": _get_machine_id(),
    }


def _s3_key(job_or_record: "Job | Dict[str, Any]") -> str:
    from datetime import datetime, timezone

    if hasattr(job_or_record, "id"):
        job_id = job_or_record.id
        parent_id = getattr(job_or_record, "parent_id", None)
    else:
        job_id = job_or_record.get("job_id")
        parent_id = job_or_record.get("parent_id")

    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%f")
    prefix = os.getenv("S3_JOBS_PREFIX", "jobs")

    if parent_id:
        return f"{prefix}/{parent_id}/{job_id}-{ts}.json"
    else:
        return f"{prefix}/{job_id}-{ts}/{job_id}-{ts}.json"


def _fetch_existing(client, job_id: str) -> list[Dict[str, Any]]:
    prefix = os.getenv("S3_JOBS_PREFIX", "jobs")
    paginator = client.get_paginator("list_objects_v2")
    try:
        for page in paginator.paginate(Bucket=_get_bucket(), Prefix=f"{prefix}/{job_id}-"):
            for obj in page.get("Contents", []):
                key = obj["Key"]
                try:
                    resp = client.get_object(Bucket=_get_bucket(), Key=key)
                    body = resp["Body"].read().decode("utf-8")
                    data = json.loads(body)
                    if isinstance(data, list):
                        return data
                    elif isinstance(data, dict):
                        return [data]
                except Exception:
                    continue
    except Exception:
        pass
    return []


def _submit_create(record: Dict[str, Any]):
    if not _is_enabled():
        return
    _pool.submit(_safe_create, record)


def _submit_update(job_id: str, record: Dict[str, Any]):
    if not _is_enabled():
        return
    _pool.submit(_safe_update, job_id, record)


def _safe_create(record: Dict[str, Any]):
    client = _get_client()
    job_id = record.get("job_id")
    try:
        logger.debug("s3_sync create record job_id=%s payload=%s", job_id, record)
        existing = _fetch_existing(client, job_id)
        existing.append(record)
        client.put_object(
            Bucket=_get_bucket(),
            Key=_s3_key(record),
            Body=json.dumps(existing).encode("utf-8"),
            ContentType="application/json",
        )
    except Exception as e:
        logger.warning("s3_sync create error: %s", e)


def _safe_update(job_id: str, record: Dict[str, Any]):
    client = _get_client()
    try:
        logger.debug("s3_sync update record job_id=%s", job_id)
        existing = _fetch_existing(client, job_id)
        existing.append(record)
        client.put_object(
            Bucket=_get_bucket(),
            Key=_s3_key(record),
            Body=json.dumps(existing).encode("utf-8"),
            ContentType="application/json",
        )
    except Exception as e:
        logger.warning("s3_sync update error: %s", e)


# ── public API ──────────────────────────────────────────────────────────────

def sync_created(job: "Job"):
    """
    Create the object once using a full-record put.
    """
    _submit_create(_full_record(job))


def sync_completed(job: "Job"):
    full_record = _full_record(job)
    _submit_update(job.id, full_record)


def sync_status(_job: "Job"):
    return


def sync_history(_job: "Job"):
    return


def sync_output(_job: "Job"):
    return


def sync_full(job: "Job"):
    sync_completed(job)