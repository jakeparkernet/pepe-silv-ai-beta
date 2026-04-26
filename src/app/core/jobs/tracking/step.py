from pydantic import BaseModel, Field
from typing import Any, Dict, List

class Step(BaseModel):
    label: str = ""
    phases: List[str] = Field(default_factory=list)
    cur_phase: str = ""