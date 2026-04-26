from dataclasses import dataclass, field
from datetime import datetime
from typing import Dict, Optional
import uuid
from abc import abstractmethod
from fast_json_repair import loads
from app.util.get_value_safe import get_value_safe

@dataclass
class BaseModel:
    id: str = field(default="")
    created_at: Optional[datetime] = None
    metadata: Dict[str, str] = field(default_factory=dict)
    status: str = ""
    notes: str = ""

    def __post_init__(self):
        # Normalize to string or generate one
        if not self.id or len(str(self.id)) == 0:
            self.id = self.generate_id()
        else:
            self.id = str(self.id)

    def __setattr__(self, name, value):
        if name == "id" and value is not None:
            value = str(value)
        super().__setattr__(name, value)

    @classmethod
    def generate_id(cls) -> str:
        """Override in subclasses for custom ID generation"""
        return str(uuid.uuid4())

    def add_metadata(self, key: str, value: str) -> None:
        """Add a metadata key-value pair"""
        self.metadata[key] = value
    
    def get_metadata(self, key: str, default: Optional[str] = None) -> Optional[str]:
        """Get a metadata value by key"""
        return self.metadata.get(key, default)
    
    def remove_metadata(self, key: str) -> None:
        """Remove a metadata key"""
        self.metadata.pop(key, None)

    @abstractmethod
    async def sync_to_database (self):
        pass

    def to_serializeable_object (self):
        return {
            "id": self.id,
            "created_at": str(self.created_at),
            "metadata": {str(k): v for k, v in self.metadata.items()},
            "notes": self.notes
        }

    def deserialize (self, obj):
        
        if isinstance(obj, str):
            obj = loads(obj)

        self.id = obj["id"]
        self.created_at = obj["created_at"]
        self.metadata = obj["metadata"]
        self.notes = get_value_safe(obj, "notes", "")