# src/app/core/db/models/newssite.py
"""NewsSite domain model"""

from dataclasses import dataclass, field
from typing import List, Optional
import uuid
from .base import BaseModel

@dataclass
class NewsSite(BaseModel):
    """Represents a news website/publication"""
    domain: str = ""
    entity_ids: List[str] = field(default_factory=list)
    
    @classmethod
    def generate_id (cls, **kwargs) -> str:
        """Generate deterministic UUID based on domain"""
        domain = kwargs.get('domain')
        if domain:
            return NewsSite.get_uuid_from_domain(domain)
        return str(uuid.uuid4())
    
    def __post_init__(self):
        """Set ID based on domain if not provided"""
        if not self.id and self.domain:
            self.id = self.generate_id(domain=self.domain)
        elif not self.id:
            self.id = self.generate_id()
    
    def add_entity (self, entity_id: str) -> None:
        """Add an entity ID if not already present"""
        if entity_id not in self.entity_ids:
            self.entity_ids.append(entity_id)
    
    def remove_entity (self, entity_id: str) -> None:
        """Remove an entity ID"""
        if entity_id in self.entity_ids:
            self.entity_ids.remove(entity_id)
    
    def has_entity (self, entity_id: str) -> bool:
        """Check if news site is associated with a specific entity"""
        return entity_id in self.entity_ids
    
    async def get_entity_objects(self) -> List['Entity']:
        """Get full Entity objects for all associated entities"""
        from app.core.db.database_service import DatabaseService
        service = DatabaseService.get()
        
        entities = []
        for entity_id in self.entity_ids:
            entity = await service.get_entity(entity_id)
            if entity:
                entities.append(entity)
        
        return entities
    
    async def get_articles(self) -> List['Article']:
        """Get all articles from this news site"""
        from app.core.db.database_service import DatabaseService
        service = DatabaseService.get()
        return await service.find_articles_by_news_site(self.id)
    
    def get_url(self) -> str:
        """Get the full URL for this news site"""
        if not self.domain:
            return ""
        
        if not self.domain.startswith(('http://', 'https://')):
            return f"https://{self.domain}"
        
        return self.domain

    async def sync_to_database (self):
        from app.core.db.database_service import DatabaseService
        service = DatabaseService.get()
        await service.update_news_site(self)

    @staticmethod
    def get_uuid_from_domain (domain):
        return str(uuid.uuid5(uuid.NAMESPACE_DNS, domain))