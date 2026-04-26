from typing import TYPE_CHECKING, Any, Dict, Callable, Optional, List
from datetime import datetime, timezone

from app.core.jobs.db.base_job_database_adapter import BaseJobDatabaseAdapter
from app.core.jobs.db.job_event_types import EventType
from app.core.jobs.transport.event_mapper import EventMapper
from app.core.jobs.job_status import JobStatus
from app.core.jobs.historical_event import HistoricalEvent
from app.core.jobs.persistence.events import append_event
from app.core.jobs.persistence.snapshots import record_full_snapshot, record_patch_snapshot, compute_patch
from app.core.jobs.persistence.manifest import save_manifest
from app.core.jobs.persistence.jsonl_store import ensure_session_dirs, read_json, atomic_write_json
from app.core.jobs.persistence.edges import append_edge
from app.core.jobs.db.adapters.in_memory_job_adapter import InMemoryJobAdapter
from app.core.jobs.db.adapters import supabase_sync, s3_sync
from app.util.sync_config import get_sync_backend
import time

FULL_SNAPSHOT_EVERY_N = int(__import__("os").environ.get("FULL_SNAPSHOT_EVERY_N", "50"))

def _now_iso():
    return datetime.now(timezone.utc).isoformat()

class JsonlJobAdapter(BaseJobDatabaseAdapter):
    """
    Durable adapter: writes events + snapshots to JSONL, and mirrors state in-memory
    so your existing event emissions and queries keep working.
    """
    def __init__(self):
        self._mem = InMemoryJobAdapter()
        self._last_full_seq: Dict[str, int] = {}  # job_id -> last full snapshot seq

    # --- Helper: generic emit that reuses your existing mapper/broadcaster ---
    def _emit(self, id: str, event_type: str, payload: Dict[str, Any]):
        self._mem._emit(id, event_type, payload)

    def _current_seq(self, id: str) -> int:
        return self._mem._current_seq(id)

    # --- BaseJobDatabaseAdapter methods ---
    def add_job(self, job: "Job"):
        ensure_session_dirs(job.session_id)
        added = self._mem.add_job(job)
        if not added:
            return False

        # seq & persist
        seq = self._current_seq(job.id)
        append_event(job.session_id, job.id, seq, EventType.FULL_UPDATE.value, {"job": job.model_dump()})
        record_full_snapshot(job.session_id, job.id, seq, job.model_dump(), _serialize_history(job.history))
        self._last_full_seq[job.id] = seq
        if get_sync_backend() == "supabase":
            supabase_sync.sync_created(job)
        elif get_sync_backend() == "s3":
            s3_sync.sync_created(job)

        return True

    def get_job(self, id: str):
        return self._mem.get_job(id)

    def get_jobs (self, job_ids: List[str]):
        jobs = {}
        for job_id in job_ids:
            job = self.get_job(job_id)
            jobs[job_id] = job

        return jobs

    def apply_status(self, job_id: str, status: JobStatus) -> None:
        self._mem.apply_status(job_id, status)

    def apply_history_append(self, job_id: str, ev: HistoricalEvent) -> None:
        self._mem.apply_history_append(job_id, ev)

    def apply_output(self, job_id: str, output: Any) -> None:
        self._mem.apply_output(job_id, output)

    def get_jobs_by_status(self, status: "JobStatus"):
        return self._mem.get_jobs_by_status(status)

    def get_session_job_ids(self, session_id: str, offset: int, max_length: int) -> List[str]:
        return self._mem.get_session_job_ids(session_id, offset, max_length)

    def update_job_status(self, id: str, status: JobStatus):
        job = self._mem.get_job(id)
        if not job:
            return
        prev = job.model_dump()
        self.apply_status(id, status)
        job = self._mem.get_job(id)
        seq = self._current_seq(id)
        append_event(job.session_id, id, seq, EventType.STATUS_UPDATE.value, {"status": status})
        patch = compute_patch(prev, job.model_dump())
        record_patch_snapshot(job.session_id, id, seq, seq-1, patch)

    def append_history(self, id: str, event: "HistoricalEvent"):
        job = self._mem.get_job(id)
        if not job: return
        prev = job.model_dump()
        self._mem.append_history(id, event)
        job = self._mem.get_job(id)
        seq = self._current_seq(id)
        append_event(job.session_id, id, seq, EventType.HISTORY_APPEND.value, {
            "event": event.model_dump() if hasattr(event, "model_dump") else event
        })
        patch = compute_patch(prev, job.model_dump())
        record_patch_snapshot(job.session_id, id, seq, seq-1, patch, history_append=[
            event.model_dump() if hasattr(event, "model_dump") else event
        ])

    def update_output(self, id: str, output: Any):
        job = self._mem.get_job(id)
        if not job: return
        prev = job.model_dump()
        self._mem.update_output(id, output)
        job = self._mem.get_job(id)
        seq = self._current_seq(id)
        append_event(job.session_id, id, seq, EventType.OUTPUT_UPDATE.value, {"output": output})
        patch = compute_patch(prev, job.model_dump())
        record_patch_snapshot(job.session_id, id, seq, seq-1, patch)

    def update_job(self, job: "Job", metadata = {}):
        prev = self._mem.get_job(job.id).model_dump() if self._mem.get_job(job.id) else {}
        self._mem.update_job(job)
        seq = self._current_seq(job.id)
        append_event(job.session_id, job.id, seq, EventType.FULL_UPDATE.value, {"job": job.model_dump()})
        # Decide full vs patch
        last_full = self._last_full_seq.get(job.id, 0)
        if seq - last_full >= FULL_SNAPSHOT_EVERY_N:
            record_full_snapshot(job.session_id, job.id, seq, job.model_dump(), _serialize_history(job.history))
            self._last_full_seq[job.id] = seq
        else:
            patch = compute_patch(prev, job.model_dump())
            record_patch_snapshot(job.session_id, job.id, seq, seq-1, patch)

        if "called_from_job" not in metadata:
            job._trigger_checkpoint()

    def complete_job(self, job: "Job"):
        prev = self._mem.get_job(job.id).model_dump() if self._mem.get_job(job.id) else {}
        self._mem.complete_job(job)
        seq = self._current_seq(job.id)
        append_event(job.session_id, job.id, seq, EventType.ON_COMPLETE.value, {"status": job.status})
        patch = compute_patch(prev, job.model_dump())
        record_patch_snapshot(job.session_id, job.id, seq=seq, prev_seq=seq-1, patch=patch)
        if get_sync_backend() == "supabase":
            supabase_sync.sync_completed(job)
        elif get_sync_backend() == "s3":
            s3_sync.sync_completed(job)

        job._trigger_checkpoint()

    # DAG edge persist when parent spawns child
    def record_edge(
        self,
        *,
        session_id: str,
        parent_id: str,
        child_job_id: str,
        child_label: str,  # ← Required, no default
        child_type: Optional[str] = None,
        dedupe_key: Optional[str] = None,
        spec_min: Optional[dict] = None,
    ) -> None:
        """
        Record a parent->child edge. Accepts optional metadata so callers that
        don't have it (e.g., generic add_job) won't crash. When provided, we forward
        it to the persistence layer.
        """
        if not parent_id:
            # Nothing to persist if there's no parent edge
            return

        # Build kwargs for persistence; only include fields that are not None.
        kwargs = dict(session_id=session_id, child_job_id=child_job_id, parent_id=parent_id)
        if child_label is not None:
            kwargs["child_label"] = child_label
        if child_type is not None:
            kwargs["child_type"] = child_type
        if dedupe_key is not None:
            kwargs["dedupe_key"] = dedupe_key
        if spec_min is not None:
            kwargs["spec_min"] = spec_min

        if len(dedupe_key) == 0:
            print("no dedupe key")

        append_edge(**kwargs)

    def get_callbacks(self, id: str, event_type: EventType):
        return self._mem.get_callbacks(id, event_type)

    # Subscriptions/broadcasts reuse in-memory
    def subscribe(self, id, event_type=None, key=None, callback=None):
        if event_type is None:
            # Wildcard
            self._mem.subscribe(id, callback=callback)
        else:
            self._mem.subscribe(id, event_type, key, callback)

    def unsubscribe(self, id, event_type=None, key=None):
        if event_type is None:
            self._mem.unsubscribe(id, key or "default")
        else:
            self._mem.unsubscribe(id, event_type, key)

    def is_connected(self):
        return True

    # Save session manifest (explicit admin action)
    def save_session_manifest(self, session_id: str):
        # collect last_seq from memory adapter
        hwms = {jid: seq for jid, seq in self._mem._sequences.items()}
        save_manifest(session_id, hwms)

def _serialize_history(history_list):
    out = []
    for ev in history_list:
        if hasattr(ev, "model_dump"):
            out.append(ev.model_dump())
        elif isinstance(ev, dict):
            out.append(ev)
        else:
            out.append({"event": str(ev)})
    return out