# src/app/core/db/models/entity.py
"""Entity domain model"""

from dataclasses import dataclass, field
from typing import List, Optional
from uuid import uuid4
from .base import BaseModel
from .relationship import Relationship
from app.util.get_value_safe import get_value_safe
from app.util.normalize_letters_only import normalize_letters_only

@dataclass
class Entity(BaseModel):
    """Represents an entity (company, person, etc.)"""
    name: str = ""
    aliases: List[str] = field(default_factory=list)
    entity_type: str = ""
    tags: List[str] = field(default_factory=list)
    context: str = ""
    evidence_ids: List[str] = field(default_factory=list)
    flatname: str = ""
    top_dog: bool = False
    
    def __post_init__(self):
        super().__post_init__()
        self.flatname = normalize_letters_only(self.name)

    def add_alias(self, alias: str) -> None:
        """Add an alias if not already present"""
        if alias not in self.aliases:
            self.aliases.append(alias)

    def remove_alias(self, alias: str) -> None:
        """Remove an alias"""
        if alias in self.aliases:
            self.aliases.remove(alias)
    
    def has_alias(self, alias: str) -> bool:
        """Check if entity has a specific alias"""
        return alias in self.aliases

    async def get_evidence_objects(self) -> List['Evidence']:
        """Get full Evidence objects for all referenced evidence"""
        from app.core.db.database_service import DatabaseService
        service = DatabaseService.get()
        
        evidence_list = []
        for evidence_id in self.evidence_ids:
            evidence = db.get_evidence(evidence_id)
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
    
    async def get_relationships(self) -> List['Relationship']:
        """Get all relationships for this entity"""
        from app.core.db.database_service import DatabaseService
        service = DatabaseService.get()
        source_relationships = await service.find_relationships_by_source(self.id)
        target_relationships = await service.find_relationships_by_target(self.id)

        return source_relationships + target_relationships
    
    async def get_ownership_relationships(self) -> List['Relationship']:
        """Get all relationships for this entity"""
        from app.core.db.database_service import DatabaseService
        service = DatabaseService.get()
        return await service.find_ownership_relationships(self.id)

    async def get_outgoing_relationships(self) -> List['Relationship']:
        """Get relationships where this entity is the source"""
        from app.core.db.database_service import DatabaseService
        service = DatabaseService.get()
        return await service.find_relationships_by_source(self.id)
    
    async def get_incoming_relationships(self) -> List['Relationship']:
        """Get relationships where this entity is the target"""
        from app.core.db.database_service import DatabaseService
        service = DatabaseService.get()
        return await service.find_relationships_by_target(self.id)
    
    async def get_related_entities (self) -> List['Entity']:
        """Get all entities related to this one"""
        related_ids = set()
        relationships = await self.get_relationships()
        
        for relationship in relationships:
            if relationship.source_entity_id != self.id:
                related_ids.add(relationship.source_entity_id)
            if relationship.target_entity_id != self.id:
                related_ids.add(relationship.target_entity_id)

        entities = []
        for entity_id in related_ids:
            entity = await service.get_entity(entity_id)
            if entity:
                entities.append(entity)
        
        return entities

    async def sync_to_database (self):
        from app.core.db.database_service import DatabaseService
        service = DatabaseService.get()
        await service.update_entity(self, self)

    def _norm(s):
        # Case-insensitive + trims whitespace; returns None if not a stringy value
        if s is None:
            return None
        s = str(s).strip()
        return s.casefold() if s else None

    def has_matching_names_entity(self, other_entity):
        other_name = get_value_safe(other_entity, "name", uuid4())
        return self.has_matching_names(other_name)

    def has_matching_names(self, other_name):
        self_name = get_value_safe(self, "name", uuid4())
        self_name_n = _norm(self_name)
        other_name_n = _norm(other_name)

        # If either name is missing/blank, don't treat as equal
        if self_name_n is not None and other_name_n is not None and self_name_n == other_name_n:
            return True

        # Aliases: explicitly treat missing/None/[] as "no aliases" (and therefore no alias-based match)
        self_aliases = get_value_safe(self, "aliases", []) or []
        other_aliases = get_value_safe(other_entity, "aliases", []) or []

        # If either side has zero aliases, do NOT match by aliases
        if len(self_aliases) == 0 or len(other_aliases) == 0:
            return False

        # Case-insensitive alias ↔ alias
        for a in self_aliases:
            a_n = _norm(a)
            if a_n is None:
                continue
            for b in other_aliases:
                b_n = _norm(b)
                if b_n is None:
                    continue
                if a_n == b_n:
                    return True

        # Optional: name ↔ alias cross-checks (often desirable)
        if self_name_n is not None:
            for b in other_aliases:
                b_n = _norm(b)
                if b_n is not None and self_name_n == b_n:
                    return True

        if other_name_n is not None:
            for a in self_aliases:
                a_n = _norm(a)
                if a_n is not None and other_name_n == a_n:
                    return True

        return False
    
    def to_serializeable_object (self):
        super_obj = super().to_serializeable_object()        
        return super_obj | {
            "name": self.name,
            "aliases": self.aliases,
            "entity_type": self.entity_type,
            "tags": self.tags,
            "context": self.context,
            "evidence_ids": self.evidence_ids,
            "flatname": self.flatname,
            "top_dog": self.top_dog
        }

    def deserialize (self, obj):
        super().deserialize(obj)

        if isinstance(obj, str):
            obj = loads(obj)

        self.name = obj["name"]
        self.aliases = obj["aliases"]
        self.entity_type = obj["entity_type"]
        self.tags = obj["tags"]
        self.context = obj["context"]
        self.evidence_ids = obj["evidence_ids"]
        self.flatname = obj["flatname"]
        self.top_dog = obj["top_dog"]