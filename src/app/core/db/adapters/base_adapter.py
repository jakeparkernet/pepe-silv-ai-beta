# src/app/core/db/adapters/base_adapter.py
"""Abstract base class for database adapters"""

from abc import ABC, abstractmethod
from typing import List, Optional, Any
from ..models import Entity, Article, Evidence, NewsSite, Relationship

class DatabaseAdapter(ABC):
    """Abstract interface for database operations"""
    
    @staticmethod
    async def initialize (self):
        pass

    # Entity operations
    @abstractmethod
    async def add_entity (self, entity: Entity, overwrite: bool = False) -> str:
        """Add an entity and return its ID"""
        pass
    
    @abstractmethod
    async def get_entity (self, id: str) -> Optional[Entity]:
        """Get an entity by id"""
        pass

    @abstractmethod
    async def get_entities_near_text (self, entity_name: str):
        """Get an entity with near text entity_name"""
        pass

    @abstractmethod
    async def get_entity_by_name (self, entity_name) -> Entity:
        pass

    @abstractmethod
    async def get_entities_like (self, entity_name) -> List[Entity]:
        pass
    
    @abstractmethod
    async def get_entities_with_any_alias (self, aliases: str) -> List[Entity]:
        """Get an entity with any of these aliases"""
        pass

    @abstractmethod
    async def get_entities_with_alias (self, alias: str) -> List[Entity]:
        """Get an entity with the alias"""
        pass

    @abstractmethod
    async def get_entities (self, entity_name: str) -> List[Entity]:
        """Get an entity with a name like the entity_name"""
        pass

    @abstractmethod
    async def get_all_entities (self):
        """Get all entities in the database"""
        pass

    @abstractmethod
    async def update_entity(self, entity: Entity) -> bool:
        """Update an entity"""
        pass
    
    @abstractmethod
    async def delete_entity(self, id: str) -> bool:
        """Delete an entity by ID"""
        pass

    @abstractmethod
    async def get_entity_evidence (self):
        """Get evidence of the entity"""
        pass
    
    @abstractmethod
    def find_entities_by_type(self, entity_type: str) -> List[Entity]:
        """Find entities by type"""
        pass
    
    @abstractmethod
    async def find_entities_by_name(self, name: str) -> List[Entity]:
        """Find entities by name (exact or partial match)"""
        pass
    
    # Article operations
    @abstractmethod
    async def add_article (self, article: Article, overwrite: bool = False) -> str:
        """Add an article and return its ID"""
        pass
    
    @abstractmethod
    async def get_article(self, id: str) -> Optional[Article]:
        """Get an article by ID"""
        pass
    
    @abstractmethod
    async def get_all_articles (self):
        """Get all articles in the database"""
        pass

    @abstractmethod
    async def update_article(self, article: Article) -> bool:
        """Update an article"""
        pass
    
    @abstractmethod
    async def delete_article(self, id: str) -> bool:
        """Delete an article by ID"""
        pass
    
    @abstractmethod
    async def find_article_by_url(self, url: str) -> Optional[Article]:
        """Find article by URL"""
        pass
    
    @abstractmethod
    async def find_articles_by_news_site(self, news_site_id: str) -> List[Article]:
        """Find articles by news site ID"""
        pass
    
    # Evidence operations
    @abstractmethod
    async def add_evidence (self, evidence: Evidence, overwrite: bool = False) -> str:
        """Add evidence and return its ID"""
        pass
    
    @abstractmethod
    async def get_evidence(self, id: str) -> Optional[Evidence]:
        """Get evidence by ID"""
        pass

    @abstractmethod
    async def get_evidence_batch(self, ids: List[str]) -> List[Evidence]:
        """Get multiple evidence by IDs"""
        pass
    
    @abstractmethod
    async def get_all_evidence (self):
        """Get all evidence in the database"""
        pass

    @abstractmethod
    async def update_evidence(self, evidence: Evidence) -> bool:
        """Update evidence"""
        pass
    
    @abstractmethod
    async def delete_evidence(self, id: str) -> bool:
        """Delete evidence by ID"""
        pass
    
    @abstractmethod
    async def find_evidence_by_source(self, source: str) -> List[Evidence]:
        """Find evidence by source"""
        pass
    
    # NewsSite operations
    @abstractmethod
    async def add_news_site (self, news_site: NewsSite, overwrite: bool = False) -> str:
        """Add a news site and return its ID"""
        pass
    
    @abstractmethod
    async def get_news_site(self, id: str) -> Optional[NewsSite]:
        """Get a news site by ID"""
        pass
    
    @abstractmethod
    async def get_all_news_sites (self):
        """Get all news sites in the database"""
        pass

    @abstractmethod
    async def update_news_site(self, news_site: NewsSite) -> bool:
        """Update a news site"""
        pass
    
    @abstractmethod
    async def delete_news_site(self, id: str) -> bool:
        """Delete a news site by ID"""
        pass
    
    @abstractmethod
    async def find_news_site_by_domain(self, domain: str) -> Optional[NewsSite]:
        """Find news site by domain"""
        pass
    
    # Relationship operations
    @abstractmethod
    async def add_relationship (self, relationship: Relationship, overwrite: bool = False) -> str:
        """Add a relationship and return its ID"""
        pass
    
    @abstractmethod
    async def get_relationship(self, id: str) -> Optional[Relationship]:
        """Get a relationship by ID"""
        pass
    
    @abstractmethod
    async def get_all_relationships (self):
        """Get all relationships in the database"""
        pass

    @abstractmethod
    async def update_relationship(self, relationship: Relationship) -> bool:
        """Update a relationship"""
        pass
    
    @abstractmethod
    async def delete_relationship(self, id: str) -> bool:
        """Delete a relationship by ID"""
        pass
    
    @abstractmethod
    async def find_relationships_by_source(self, source_id: str) -> List[Relationship]:
        """Find relationships where entity is the source"""
        pass
    
    @abstractmethod
    async def find_relationships_by_target(self, target_id: str) -> List[Relationship]:
        """Find relationships where entity is the target"""
        pass
    
    @abstractmethod
    async def find_relationships_by_evidence(self, evidence_id: str) -> List[Relationship]:
        """Find relationships that reference specific evidence"""
        pass
    
    @abstractmethod
    async def find_relationships_by_type(self, relation_type: str) -> List[Relationship]:
        """Find relationships by type (e.g., 'OWNS', 'REPORTS_ON')"""
        pass

    @abstractmethod
    async def find_ownership_relationships(self, entity_id: str) -> List[Relationship]:
        """Find ownership relationships"""
        pass

    @abstractmethod
    async def delete_database (self):
        pass