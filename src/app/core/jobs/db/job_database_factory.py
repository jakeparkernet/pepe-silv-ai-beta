# src/app/core/db/database_factory.py
"""Database factory for creating and managing database adapter instances"""

from typing import Optional, TYPE_CHECKING, Any, Dict
import logging

if TYPE_CHECKING:
    from .base_job_database_adapater import BaseJobDatabaseAdapter

logger = logging.getLogger(__name__)
DEFAULT_ADAPTER_TYPE = "memory"
    
class JobDatabaseFactory:
    """Singleton factory for database adapters"""
    
    _adapter: Optional["BaseJobDatabaseAdapter"] = None
    _adapter_type: Optional[str] = None

    @classmethod
    def get_adapter(cls) -> "BaseJobDatabaseAdapter":
        """Get the database adapter instance (singleton)"""
        if cls._adapter is None:
            cls._adapter = cls._create_adapter()
        return cls._adapter
    
    @classmethod
    def _create_adapter(cls) -> "BaseJobDatabaseAdapter":
        """Create the appropriate database adapter based on configuration"""
        try:
            # Try to load from config
            adapter_type = cls._get_adapter_type_from_config()
            
            if adapter_type == "supabase":
                from .adapters.supabase_job_adapter import SupabaseJobAdapter
                logger.info("Creating Supabase database adapter")
                return SupabaseJobAdapter()
            if adapter_type == "jsonl":
                from .adapters.jsonl_job_adapter import JsonlJobAdapter
                logger.info("Creating JSONL database adapter")
                return JsonlJobAdapter()
            else:
                # Default to In-Memory if no config or unknown type
                logger.warning(f"Unknown adapter type '{adapter_type}', defaulting to {DEFAULT_ADAPTER_TYPE}")
                from .adapters.in_memory_job_adapter import InMemoryJobAdapter
                return InMemoryJobAdapter()
                
        except Exception as e:
            logger.error(f"Failed to create database adapter: {e}")
            raise Exception(f"Could not create database adapter: {e}")
    
    @classmethod
    def _get_adapter_type_from_config(cls) -> str:
        """Get the adapter type from configuration"""
        try:
            # Try to import Settings from the app config
            from app.config import Settings
            settings = Settings.load()
            
            # Look for database.adapter in the config
            job_database_config = getattr(settings, 'job_database', None)
            if job_database_config:
                adapter_type = getattr(job_database_config, 'adapter', DEFAULT_ADAPTER_TYPE)
                logger.info(f"Database adapter from config: {adapter_type}")
                return adapter_type
            else:
                logger.info("No database config found, using default adapter: {DEFAULT_ADAPTER_TYPE}")
                return DEFAULT_ADAPTER_TYPE
                
        except ImportError:
            logger.warning("Could not import Settings, using default adapter: {DEFAULT_ADAPTER_TYPE}")
            return DEFAULT_ADAPTER_TYPE
        except Exception as e:
            logger.warning(f"Error reading config: {e}, using default adapter: {DEFAULT_ADAPTER_TYPE}")
            return DEFAULT_ADAPTER_TYPE
    
    @classmethod
    def reset_adapter(cls):
        """Reset the adapter instance (useful for testing)"""
        cls._adapter = None
        cls._adapter_type = None
        logger.info("Database adapter reset")
    
    @classmethod
    def set_adapter(cls, adapter: "BaseJobDatabaseAdapter"):
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
            return adapter.is_connected()
        except Exception:
            return False


def get_job_database() -> "BaseJobDatabaseAdapter":
    """Convenience function to get the database adapter"""
    return JobDatabaseFactory.get_adapter()