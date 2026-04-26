# src/app/core/db/__init__.py
"""Database abstraction layer for Pepe Silv.AI"""

from .database_factory import DatabaseFactory, get_database
from .models import Entity, Article, Evidence, NewsSite, Relationship, BaseModel
from .adapters import DatabaseAdapter, WeaviateAdapter
from .exceptions import (
    DatabaseError, EntityNotFoundError, ArticleNotFoundError,
    EvidenceNotFoundError, NewsSiteNotFoundError, RelationshipNotFoundError,
    DatabaseConnectionError, DuplicateEntityError
)

__all__ = [
    # Factory and convenience functions
    'DatabaseFactory',
    'get_database',
    
    # Domain models
    'BaseModel',
    'Entity',
    'Article',
    'Evidence', 
    'NewsSite',
    'Relationship',
    
    # Adapters
    'DatabaseAdapter',
    'WeaviateAdapter',
    
    # Exceptions
    'DatabaseError',
    'EntityNotFoundError',
    'ArticleNotFoundError',
    'EvidenceNotFoundError',
    'NewsSiteNotFoundError',
    'RelationshipNotFoundError',
    'DatabaseConnectionError',
    'DuplicateEntityError'
]