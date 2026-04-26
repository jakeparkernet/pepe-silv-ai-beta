from __future__ import annotations
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field

class LocalCapabilitiesConfig(BaseModel):
    capabilities: Dict[str, int]

class EdgeCapabilitiesConfig(BaseModel):
    capabilities: Dict[str, int]