from typing import TYPE_CHECKING, Any, Dict, Callable, Optional, List
from datetime import datetime, timezone
import time
from app.core.jobs.db.job_event_types import EventType
from app.core.jobs.db.base_job_database_adapter import BaseJobDatabaseAdapter
from app.core.jobs.transport.event_mapper import EventMapper
from app.core.jobs.job_status import JobStatus
from app.core.events.static_events_factory import StaticEventsFactory
from app.core.jobs.historical_event import HistoricalEvent

if TYPE_CHECKING:
    from app.core.jobs.job import Job

def _now_iso():
    ts = datetime.now(timezone.utc)
    return ts.isoformat()

class InMemoryJobAdapter(BaseJobDatabaseAdapter):
    def __init__(self, *, mapper: Optional[EventMapper] = None, emitter_node: Optional[str] = None):
        self.jobs: Dict[str, "Job"] = {}
        self.session_index = {}

        self.subscribers: Dict[str, Dict[EventType, Dict[str, Callable]]] = {}
        self.mapper = mapper or EventMapper(emitter_node=emitter_node)
        self._sequences: Dict[str, int] = {}  # Track per-job sequence numbers

    def add_job(self, job: "Job"):
        if not hasattr(job, "id"):
            return False
        if job.id in self.jobs:
            return False
        self.jobs[job.id] = job

        if job.session_id not in self.session_index.keys():
            self.session_index[job.session_id] = []

        self.session_index[job.session_id].append(job.id)

        self._sequences[job.id] = 0  # Initialize sequence counter

        seq = self._current_seq(job.id)
        ev = self.mapper.map_job(job=job, seq=seq)
        self._emit(job.id, EventType.FULL_UPDATE, ev)

        return True

    def get_job(self, id: str):
        if id not in self.jobs.keys():
            return None
        return self.jobs[id]

    def get_jobs (self, job_ids: List[str]):
        jobs = {}
        for job_id in job_ids:
            job = self.get_job(job_id)
            jobs[job_id] = job

        return jobs

    def get_jobs_by_status(self, status: JobStatus):
        return [job for job in self.jobs.values() if getattr(job, "status", None) == status]

    def update_job_status(self, job_id: str, status: JobStatus) -> None:
        self.apply_status(job_id, status)                 # ← in-memory mutation
        seq = self._current_seq(job_id)
        corr = getattr(self.jobs.get(job_id, {}), "parent_id", None)
        ev = self.mapper.map_status_update(job_id, status, seq=seq, parent_id=corr)
        self._emit(job_id, EventType.STATUS_UPDATE, ev)

    def append_history(self, id: str, historical_event: "HistoricalEvent"):
        job = self.jobs.get(id)
        if not job:
            return
        ev = historical_event if isinstance(historical_event, HistoricalEvent) else HistoricalEvent.model_validate(historical_event)
        job.history.append(ev)
        job.updated_at = time.time()
        seq = self._current_seq(id)
        corr = getattr(job, "parent_id", None)
        ev = self.mapper.map_history_append(id, historical_event, seq=seq, parent_id=corr)
        self._emit(id, EventType.HISTORY_APPEND, ev)

    def update_output(self, id: str, output: Any):
        job = self.jobs.get(id)
        if not job:
            return
        job.output = output
        job.updated_at = time.time()
        seq = self._current_seq(id)
        corr = getattr(job, "parent_id", None)
        ev = self.mapper.map_output_update(id, output, seq=seq, parent_id=corr)
        self._emit(id, EventType.OUTPUT_UPDATE, ev)

    def update_job(self, job: "Job", metadata = {}) -> dict:
        self.jobs[job.id] = job
        seq = self._current_seq(job.id)
        ev = self.mapper.map_job(job=job, seq=seq)
        self._emit(job.id, EventType.FULL_UPDATE, ev)
        return ev

    def apply_status(self, job_id: str, status: JobStatus) -> None:
        job = self.jobs.get(job_id)
        if job:
            job.status = status
            job.updated_at = time.time()

    def apply_history_append(self, job_id: str, ev: HistoricalEvent) -> None:
        job = self.jobs.get(job_id)
        if job:
            job.history.append(ev)
            job.updated_at = time.time()

    def apply_output(self, job_id: str, output: Any) -> None:
        job = self.jobs.get(job_id)
        if job:
            job.output = output
            job.updated_at = time.time()

    def complete_job(self, job: "Job"):
        self.jobs[job.id] = job
        seq = self._current_seq(job.id)
        corr = getattr(job, "parent_id", None)
        payload = {
            "event_type": EventType.ON_COMPLETE.value if hasattr(EventType.ON_COMPLETE, "value") else EventType.ON_COMPLETE,
            "job_id": job.id,
            "seq": seq,
            "ts": _now_iso(),
            "payload": {"job": job},
            "version": 1,
            "emitter_node": getattr(self.mapper, "_emitter_node", None),
            "parent_id": corr,
        }
        self._emit(job.id, EventType.ON_COMPLETE, payload)

    def subscribe(self, id: str, event_type: EventType = None, key: str = None, callback = None):
        if event_type is None:
            # Wildcard: store under special key
            self.subscribers.setdefault(id, {}).setdefault("*", {})[key or "default"] = callback
        else:
            self.subscribers.setdefault(id, {}).setdefault(event_type, {})[key] = callback

    def unsubscribe(self, id: str, event_type: EventType = None, key: str = None):
        if id not in self.subscribers:
            return
        if event_type not in self.subscribers[id]:
            return
        self.subscribers[id][event_type].pop(key, None)
        if not self.subscribers[id][event_type]:
            del self.subscribers[id][event_type]
        if not self.subscribers[id]:
            del self.subscribers[id]

    def get_callbacks(self, id: str, event_type: EventType):
        return list(self.subscribers.get(id, {}).get(event_type, {}).values())

    def is_connected(self):
        return True

    def get_session_job_ids(self, session_id: str, offset: int = 0, max_length: int = 200) -> List[str]:
        """
        Return job_ids for a given session with optional offset/length.
        """
        return_obj = {
            "status": "unknown",
            "job_ids": []
        }
        if session_id not in self.session_index:
            return_obj["status"] = "error",
            return_obj["message"] = f"no such session id {session_id}",
            return_obj["job_ids"] = {}

            return return_obj

        def get_jobs_ids_data_from_list (job_ids):
            job_ids_obj = {}

            for job_id in job_ids:
                job = self.get_job(job_id)
                job_ids_obj[job_id] = job.model_dump()

            return job_ids_obj

        lst = self.session_index[session_id]
        if offset < 0:
            offset = 0
        if max_length is None or max_length < 0:
            return_obj["status"] = "ok"
            job_ids = lst[offset:]

            return_obj["job_ids"] = get_jobs_ids_data_from_list(job_ids)
            return return_obj

        return_obj["status"] = "ok"
        job_ids = lst[offset : offset + max_length]

        return_obj["job_ids"] = get_jobs_ids_data_from_list(job_ids)

        return return_obj

    def _emit(self, id, event_type, payload):
        # Send to wildcard subs
        for cb in self.subscribers.get(id, {}).get("*", {}).values():
            cb(payload)
        # Send to specific type
        for cb in self.subscribers.get(id, {}).get(event_type, {}).values():
            cb(payload)

    def _current_seq(self, id: str) -> int:
        """Return and increment the per-job sequence counter."""
        if id not in self._sequences:
            self._sequences[id] = 0
        self._sequences[id] += 1
        return self._sequences[id]
