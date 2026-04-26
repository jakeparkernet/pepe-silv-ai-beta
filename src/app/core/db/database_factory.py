# src/app/core/db/database_factory.py
"""Database factory for creating and managing database adapter instances"""

from typing import Optional
import logging
from .adapters.base_adapter import DatabaseAdapter
from .exceptions import DatabaseConnectionError
import threading

logger = logging.getLogger(__name__)
_lock = threading.Lock()

class DatabaseFactory:
    """Singleton factory for database adapters"""
    
    _adapter: Optional[DatabaseAdapter] = None
    _adapter_type: Optional[str] = None

    @classmethod
    async def get_adapter(cls) -> DatabaseAdapter:
        return await cls._create_adapter()
        
    @classmethod
    async def _create_adapter(cls) -> DatabaseAdapter:
        """Create the appropriate database adapter based on configuration"""
        try:
            # Try to load from config
            adapter_type = cls._get_adapter_type_from_config()
            
            if adapter_type == "weaviate":
                from .adapters.weaviate_adapter import WeaviateAdapter
                logger.info("Creating Weaviate database adapter")
                weaviate_adapter = WeaviateAdapter()
                await weaviate_adapter.initialize()

                return weaviate_adapter
            else:
                # Default to Weaviate if no config or unknown type
                from .adapters.weaviate_adapter import WeaviateAdapter
                logger.warning(f"Unknown adapter type '{adapter_type}', defaulting to Weaviate")
                weaviate_adapter = WeaviateAdapter()
                await weaviate_adapter.initialize()

                return weaviate_adapter
                
        except Exception as e:
            logger.error(f"Failed to create database adapter: {e}")
            raise DatabaseConnectionError(f"Could not create database adapter: {e}")
    
    @classmethod
    def _get_adapter_type_from_config(cls) -> str:
        """Get the adapter type from configuration"""
        try:
            # Try to import Settings from the app config
            from ..config import Settings
            settings = Settings.load()
            
            # Look for database.adapter in the config
            database_config = getattr(settings, 'database', None)
            if database_config:
                adapter_type = getattr(database_config, 'adapter', 'weaviate')
                logger.info(f"Database adapter from config: {adapter_type}")
                return adapter_type
            else:
                logger.info("No database config found, using default adapter: weaviate")
                return 'weaviate'
                
        except ImportError:
            logger.warning("Could not import Settings, using default adapter: weaviate")
            return 'weaviate'
        except Exception as e:
            logger.warning(f"Error reading config: {e}, using default adapter: weaviate")
            return 'weaviate'
    
    @classmethod
    def reset_adapter(cls):
        """Reset the adapter instance (useful for testing)"""
        cls._adapter = None
        cls._adapter_type = None
        logger.info("Database adapter reset")
    
    @classmethod
    def set_adapter(cls, adapter: DatabaseAdapter):
        """Manually set the adapter instance (useful for testing)"""
        cls._adapter = adapter
        logger.info(f"Database adapter manually set to: {type(adapter).__name__}")
    
    @classmethod
    def get_adapter_type(cls) -> str:
        """Get the current adapter type"""
        if cls._adapter_type is None:
            cls._adapter_type = cls._get_adapter_type_from_config()
        return cls._adapter_type
    
    @classmethod
    def is_connected(cls) -> bool:
        """Check if the database adapter is connected and working"""
        try:
            adapter = cls.get_adapter()
            # Try a simple operation to test connectivity
            # For now, we'll just check if the adapter exists
            return adapter is not None
        except Exception:
            return False

# Convenience function for getting the database adapter
async def get_database() -> DatabaseAdapter:
    """Convenience function to get the database adapter"""
    return await DatabaseFactory.get_adapter()