from dataclasses import dataclass
from typing import Dict, Any, Callable, Optional

@dataclass
class JobBatchItem:
    job_spec: Dict[str, Any]
    job_id: str
    on_update: Optional[Callable] = None
    on_complete: Optional[Callable] = None
    on_error: Optional[Callable] = None