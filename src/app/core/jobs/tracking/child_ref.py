from pydantic import BaseModel
from app.core.jobs.job_status import JobStatus

class ChildRef(BaseModel):
    label: str
    job_type: str
    dedupe_key: str
    child_job_id: str | None = None
    status: JobStatus = JobStatus.UNKNOWN
    created_at: float | None = None
    updated_at: float | None = None
    result_digest: dict | None = None
