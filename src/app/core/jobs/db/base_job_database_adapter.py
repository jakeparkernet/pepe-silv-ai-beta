from abc import ABC, abstractmethod
from typing import TYPE_CHECKING, List
from app.core.jobs.job_status import JobStatus
from app.core.jobs.historical_event import HistoricalEvent
from typing import Any, Dict, List
import time
from app.core.jobs.db.job_event_types import EventType

if TYPE_CHECKING:
    from app.core.jobs.job import Job

class BaseJobDatabaseAdapter(ABC):

    @abstractmethod
    def add_job(self, job: "Job"):
        pass

    @abstractmethod
    def get_job(self, id: str):
        pass

    @abstractmethod
    def get_jobs (self, job_ids: List[str]):
        pass

    @abstractmethod
    def get_jobs_by_status(self, status: "JobStatus"):
        pass

    @abstractmethod
    def update_job_status(self, id: str, status: "JobStatus"):
        pass

    @abstractmethod
    def append_history (self, id: str, historical_event: "HistoricalEvent"):
        pass

    @abstractmethod
    def update_output (self, id: str, historical_event: "HistoricalEvent"):
        pass

    @abstractmethod
    def update_job (self, job: "job", metadata = {}) -> dict:
        pass

    @abstractmethod
    def complete_job (self, job: "job"):
        pass

    @abstractmethod
    def subscribe(self, id: str, event_type: EventType = None, key: str = None, callback = None):
        pass

    @abstractmethod
    def unsubscribe(self, id: str, event_type: EventType = None, key: str = None):
        pass

    @abstractmethod
    def is_connected (self):
        pass

    @abstractmethod
    def apply_status(self, job_id: str, status: JobStatus) -> None:
        """Set job.status and updated_at in-memory."""
        pass

    @abstractmethod
    def apply_history_append(self, job_id: str, ev: HistoricalEvent) -> None:
        pass

    @abstractmethod
    def apply_output(self, job_id: str, output: Any) -> None:
        pass