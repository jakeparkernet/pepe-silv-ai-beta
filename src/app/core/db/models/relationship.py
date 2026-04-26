# src/app/core/db/models/relationship.py
"""Relationship domain model"""

from dataclasses import dataclass, field
from typing import List, Optional
from .base import BaseModel

@dataclass
class Relationship(BaseModel):
    """Represents a relationship between two entities"""
    source_entity_id: str = ""
    target_entity_id: str = ""
    relation: str = ""  # "OWNS", "INVESTOR_IN", "REPORTS_ON", etc.
    evidence_ids: List[str] = field(default_factory=list)  # Evidence IDs
    is_ownership: bool = False
    
    async def get_source_entity(self) -> Optional['Entity']:
        """Get the source Entity object"""
        if not self.source_entity_id:
            return None
        
        from app.core.db.database_service import DatabaseService
        service = DatabaseService.get()
        return await service.get_entity(self.source_entity_id)
    
    async def get_target_entity(self) -> Optional['Entity']:
        """Get the target Entity object"""
        if not self.target_entity_id:
            return None
        
        from app.core.db.database_service import DatabaseService
        service = DatabaseService.get()
        return await service.get_entity(self.target_entity_id)
    
    async def get_evidence_objects(self) -> List['Evidence']:
        """Get full Evidence objects for all referenced evidence"""
        from app.core.db.database_service import DatabaseService
        service = DatabaseService.get()
        
        evidence_list = []
        for evidence_id in self.evidence_ids:
            evidence = await service.get_evidence(evidence_id)
            if evidence:
                evidence_list.append(evidence)
        
        return evidence_list
    
    def add_evidence(self, evidence_id: str) -> None:
        """Add an evidence ID if not already present"""
        if evidence_id not in self.evidence_ids:
            self.evidence_ids.append(evidence_id)
    
    def remove_evidence(self, evidence_id: str) -> None:
        """Remove an evidence ID"""
        if evidence_id in self.evidence_ids:
            self.evidence_ids.remove(evidence_id)
    
    def has_evidence(self, evidence_id: str) -> bool:
        """Check if relationship references specific evidence"""
        return evidence_id in self.evidence_ids
    
    def is_ownership_relation(self) -> bool:
        return self.is_ownership
        
    def involves_entity(self, entity_id: str) -> bool:
        """Check if relationship involves a specific entity (as source or target)"""
        return self.source_entity_id == entity_id or self.target_entity_id == entity_id

    async def sync_to_database (self):
        from app.core.db.database_service import DatabaseService
        service = DatabaseService.get()
        await service.update_relationship(self)

    def to_serializeable_object (self):
        super_obj = super().to_serializeable_object()        
        return super_obj | {
            "source_entity_id": self.source_entity_id,
            "target_entity_id": self.target_entity_id,
            "relation": self.relation,
            "evidence_ids": self.evidence_ids,
            "is_ownership": self.is_ownership
        }

    def deserialize (self, obj):
        super().deserialize(obj)

        if isinstance(obj, str):
            obj = loads(obj)

        self.source_entity_id = obj["source_entity_id"]
        self.target_entity_id = obj["target_entity_id"]
        self.relation = obj["relation"]
        self.evidence_ids = obj["evidence_ids"]
        self.is_ownership = obj["is_ownership"]