from typing import Any, Dict, List, Optional
from pydantic import BaseModel, model_validator, computed_field

class EnqueuePayload(BaseModel):
    job_spec: Optional[Dict[str, Any]] = None
    job_specs: Optional[List[Dict[str, Any]]] = None

    session_id: Optional[str] = None
    parent_id: Optional[str] = None
    label: Optional[str] = None
    dedupe_key: Optional[str] = None
    spec_min: Optional[Dict[str, Any]] = None

    @model_validator(mode="after")
    def _must_have_specs(self):
        if not self.job_spec and not self.job_specs:
            raise ValueError("Either 'job_spec' or 'job_specs' must be supplied")
        return self

    @computed_field
    @property
    def specs_to_process(self) -> List[Dict[str, Any]]:
        if self.job_specs is not None:
            return self.job_specs
        if self.job_spec is not None:
            return [self.job_spec]
        return []
