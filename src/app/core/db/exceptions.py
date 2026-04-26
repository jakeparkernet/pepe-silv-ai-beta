# src/app/core/db/exceptions.py
"""Custom database exceptions for the adapter layer"""

class DatabaseError(Exception):
    """Base database exception"""
    pass

class EntityNotFoundError(DatabaseError):
    """Raised when an entity is not found"""
    pass

class ArticleNotFoundError(DatabaseError):
    """Raised when an article is not found"""
    pass

class EvidenceNotFoundError(DatabaseError):
    """Raised when evidence is not found"""
    pass

class NewsSiteNotFoundError(DatabaseError):
    """Raised when a news site is not found"""
    pass

class RelationshipNotFoundError(DatabaseError):
    """Raised when a relationship is not found"""
    pass

class DatabaseConnectionError(DatabaseError):
    """Raised when database connection fails"""
    pass

class DuplicateEntityError(DatabaseError):
    """Raised when trying to create a duplicate entity"""
    pass