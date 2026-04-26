from pydantic import BaseModel, Field
from datetime import datetime
from typing import Dict, Any
from pydantic import BaseModel

class HistoricalEvent(BaseModel):
    created_at: datetime = Field(default_factory=datetime.utcnow)
    event: str = "NOT_DECLARED"
    details: Dict[str, Any] | None = None