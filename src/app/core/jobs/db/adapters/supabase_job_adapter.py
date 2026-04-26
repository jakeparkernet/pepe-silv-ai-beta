import json
import os
import time
from typing import TYPE_CHECKING, Any, Dict, List, Optional

if TYPE_CHECKING:
    from supabase import Client

from app.core.jobs.db.base_job_database_adapter import BaseJobDatabaseAdapter
from app.core.jobs.db.adapters.in_memory_job_adapter import InMemoryJobAdapter
from app.core.jobs.job_status import JobStatus
from app.core.jobs.historical_event import HistoricalEvent
from app.core.jobs.db.job_event_types import EventType
from app.core.jobs.transport.event_mapper import EventMapper


def _get_supabase_client() -> "Client":
    from supabase import create_client

    url = os.getenv("SUPABASE_URL")
    service_role_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

    if not url:
        raise RuntimeError("SUPABASE_URL is not set")
    if not service_role_key:
        raise RuntimeError("SUPABASE_SERVICE_ROLE_KEY is not set")

    return create_client(url, service_role_key)


def _serialize_job(job: "Job") -> str:
    return json.dumps({
        "timestamp": job.updated_at or time.time(),
        "job": job.model_dump(mode="json")
    })


def _job_to_record(job: "Job") -> Dict[str, Any]:
    history_texts = [json.dumps(h.model_dump(mode="json")) for h in job.history] if job.history else []
    return {
        "uuid": job.id,
        "type": job.job_type or job.__class__.__name__,
        "status": job.status,
        "input": json.dumps(job.input) if job.input else None,
        "output": json.dumps(job.output) if job.output else None,
        "history": history_texts,
        "parent_id": job.parent_id,
        "session_id": job.session_id,
        "label": job.label,
        "description": job.description,
        "updated_at": job.updated_at,
        "dedupe_key": job.dedupe_key,
    }


class SupabaseJobAdapter(BaseJobDatabaseAdapter):
    def __init__(self, inner: Optional[InMemoryJobAdapter] = None):
        self._inner = inner or InMemoryJobAdapter()
        self._client: Optional["Client"] = None
        self._table_name = "all_jobs"

    @property
    def client(self) -> "Client":
        if self._client is None:
            self._client = _get_supabase_client()
        return self._client

    def _upsert(self, job: "Job") -> None:
        record = _job_to_record(job)
        self.client.table(self._table_name).upsert(record).execute()

    def add_job(self, job: "Job") -> bool:
        result = self._inner.add_job(job)
        try:
            self._upsert(job)
        except Exception as e:
            print(f"Supabase sync error on add_job: {e}")
        return result

    def get_job(self, id: str):
        return self._inner.get_job(id)

    def get_jobs(self, job_ids: List[str]):
        return self._inner.get_jobs(job_ids)

    def get_jobs_by_status(self, status: "JobStatus"):
        return self._inner.get_jobs_by_status(status)

    def update_job_status(self, id: str, status: "JobStatus") -> None:
        self._inner.update_job_status(id, status)
        job = self._inner.get_job(id)
        if job:
            try:
                self._upsert(job)
            except Exception as e:
                print(f"Supabase sync error on update_job_status: {e}")

    def append_history(self, id: str, historical_event: "HistoricalEvent") -> None:
        self._inner.append_history(id, historical_event)
        job = self._inner.get_job(id)
        if job:
            try:
                self._upsert(job)
            except Exception as e:
                print(f"Supabase sync error on append_history: {e}")

    def update_output(self, id: str, output: Any) -> None:
        self._inner.update_output(id, output)
        job = self._inner.get_job(id)
        if job:
            try:
                self._upsert(job)
            except Exception as e:
                print(f"Supabase sync error on update_output: {e}")

    def update_job(self, job: "Job", metadata: Dict = None) -> Dict:
        result = self._inner.update_job(job, metadata)
        try:
            self._upsert(job)
        except Exception as e:
            print(f"Supabase sync error on update_job: {e}")
        return result

    def complete_job(self, job: "Job") -> None:
        self._inner.complete_job(job)
        try:
            self._upsert(job)
        except Exception as e:
            print(f"Supabase sync error on complete_job: {e}")

    def subscribe(self, id: str, event_type: EventType = None, key: str = None, callback=None):
        self._inner.subscribe(id, event_type, key, callback)

    def unsubscribe(self, id: str, event_type: EventType = None, key: str = None):
        self._inner.unsubscribe(id, event_type, key)

    def is_connected(self) -> bool:
        try:
            self.client.table(self._table_name).select("uuid").limit(1).execute()
            return True
        except Exception:
            return False

    def apply_status(self, job_id: str, status: JobStatus) -> None:
        self._inner.apply_status(job_id, status)

    def apply_history_append(self, job_id: str, ev: HistoricalEvent) -> None:
        self._inner.apply_history_append(job_id, ev)

    def apply_output(self, job_id: str, output: Any) -> None:
        self._inner.apply_output(job_id, output)