from enum import Enum

class JobStatus(str, Enum):
    INIT = "INIT"
    QUEUED = "QUEUED"
    RUNNING = "RUNNING"
    PAUSED = "PAUSED"
    SUBSCRIBED = "SUBSCRIBED"
    CANCELED = "CANCELED"
    FAILED = "FAILED"
    COMPLETE = "COMPLETE",
    UNKNOWN = "UNKNOWN"