from __future__ import annotations
from typing import Dict, List, Optional
from threading import Lock
from app.core.jobs.job_status import JobStatus
from app.core.jobs.job import Job

class InMemoryQueue:
    def __init__(self) -> None:
        self._lock = Lock()
        self._jobs: Dict[str, Job] = {}
        self._order: List[str] = []

    def enqueue(self, job: Job) -> str:
        with self._lock:
            self._jobs[job.job_id] = job
            self._order.append(job.job_id)
            return job.job_id

    def reserve(self) -> Optional[Job]:
        with self._lock:
            if not self._order:
                return None
            job_id = self._order.pop(0)
            job = self._jobs[job_id]
            if job.status != JobStatus.queued:
                return None
            job.status = JobStatus.running
            return job

    def ack(self, job_id: str):
        # no-op for memory impl
        return

    def fail(self, job_id: str, reason: str):
        with self._lock:
            if job_id in self._jobs:
                self._jobs[job_id].status = JobStatus.failed
                self._jobs[job_id].log("failed", reason=reason)

    def get(self, job_id: str) -> Optional[Job]:
        return self._jobs.get(job_id)

    def size(self) -> int:
        return len(self._order)