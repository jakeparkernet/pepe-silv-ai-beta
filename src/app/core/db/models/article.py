# src/app/core/db/models/article.py
"""Article domain model"""

from dataclasses import dataclass, field
from typing import List, Optional
import uuid
from urllib.parse import urlparse
from .base import BaseModel

@dataclass
class Article(BaseModel):
    """Represents a news article"""
    url: str = None
    title: Optional[str] = None
    content: Optional[str] = None
    entities: List[str] = field(default_factory=list)
    news_site_id: Optional[str] = None
    conflicting_relationships: List[str] = field(default_factory=list)
    
    @classmethod
    def generate_id(cls, url) -> str:
        """Generate deterministic UUID based on URL"""
        return str(uuid.uuid5(uuid.NAMESPACE_URL, url))
    
    def __post_init__(self):
        """Set ID based on URL if not provided"""
        if not self.id and self.url:
            self.id = self.generate_id(url=self.url)
    
    def get_domain(self) -> Optional[str]:
        """Extract domain from URL"""
        if not self.url:
            return None
        try:
            parsed = urlparse(self.url)
            return parsed.netloc
        except Exception:
            return None
    
    def add_entity(self, entity_id: str) -> None:
        """Add an entity ID if not already present"""
        if entity_id not in self.entities:
            self.entities.append(entity_id)
    
    def remove_entity(self, entity_id: str) -> None:
        """Remove an entity ID"""
        if entity_id in self.entities:
            self.entities.remove(entity_id)
    
    def has_entity(self, entity_id: str) -> bool:
        """Check if article references a specific entity"""
        return entity_id in self.entities
    
    async def get_entity_objects(self) -> List['Entity']:
        """Get full Entity objects for all referenced entities"""
        from app.core.db.database_service import DatabaseService
        service = DatabaseService.get()
        
        entities = []
        for entity_id in self.entities:
            entity = await service.get_entity(entity_id)
            if entity:
                entities.append(entity)
        
        return entities
    
    def add_conflicting_relationship(self, relationship_id: str) -> None:
        """Add an relationship ID if not already present"""
        if relationship_id not in self.conflicting_relationships:
            self.conflicting_relationships.append(relationship_id)
    
    def remove_conflicting_relationship(self, relationship_id: str) -> None:
        """Remove an relationship ID"""
        if relationship_id in self.conflicting_relationships:
            self.conflicting_relationships.remove(relationship_id)

    async def get_conflicting_relationships (self) -> List['Relationship']:
        """Get full Relationship objects for all referenced conflicting relationships"""
        from app.core.db.database_service import DatabaseService
        service = DatabaseService.get()
        
        relationships = []
        for relationship_id in self.conflicting_relationships:
            relationship = await service.get_entity(relationship_id)
            if relationship:
                relationships.append(entity)
        
        return relationships

    async def get_news_site (self) -> Optional['NewsSite']:
        """Get the NewsSite object for this article"""
        if not self.news_site_id:
            return None
        
        from app.core.db.database_service import DatabaseService
        service = DatabaseService.get()
        return await service.get_news_site(self.news_site_id)
    
    def set_news_site (self, news_site: 'NewsSite') -> None:
        """Set the news site for this article"""
        self.news_site_id = news_site.id

    async def sync_to_database (self):
        from app.core.db.database_service import DatabaseService
        service = DatabaseService.get()
        await service.update_article(self)