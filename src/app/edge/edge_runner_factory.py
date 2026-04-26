"""Edge factory for creating and managing edge runner instances"""

from typing import Optional
import logging
from app.edge.base_edge_runner import EdgeRunner

logger = logging.getLogger(__name__)
DEFAULT_ADAPTER_TYPE = "aws"

class EdgeRunnerFactory:
    """Singleton factory for edge runners"""
    
    _adapter: Optional[EdgeRunner] = None
    _adapter_type: Optional[str] = None
    
    @classmethod
    def get_adapter(cls) -> EdgeRunner:
        """Get the edge runner instance (singleton)"""
        if cls._adapter is None:
            cls._adapter = cls._create_adapter()
        return cls._adapter
    
    @classmethod
    def _create_adapter(cls) -> EdgeRunner:
        """Create the appropriate edge runner based on configuration"""
        try:
            # Try to load from config
            adapter_type = cls._get_adapter_type_from_config()
            
            if adapter_type == "aws":
                from app.edge.aws.aws_adapter import AwsAdapter
                logger.info("Creating AWS edge runner")
                return AwsAdapter()
            else:
                # Default to AWS if no config or unknown type
                logger.warning(f"Unknown adapter type '{adapter_type}', defaulting to {DEFAULT_ADAPTER_TYPE}")
                from app.edge.aws.aws_adapter import AwsAdapter
                return AwsAdapter()
                
        except Exception as e:
            logger.error(f"Failed to create edge runner: {e}")
            raise Exception(f"Could not create edge runner: {e}")
    
    @classmethod
    def _get_adapter_type_from_config(cls) -> str:
        """Get the adapter type from configuration"""
        try:
            # Try to import Settings from the app config
            from ..config import Settings
            settings = Settings.load()
            
            # Look for edge.adapter in the config
            edge_config = getattr(settings, 'edge', None)
            if edge_config:
                adapter_type = getattr(edge_config, 'adapter', 'aws')
                logger.info(f"Edge adapter from config: {adapter_type}")
                return adapter_type
            else:
                logger.info("No edge config found, using default adapter: aws")
                return 'aws'
                
        except ImportError:
            logger.warning("Could not import Settings, using default adapter: aws")
            return 'aws'
        except Exception as e:
            logger.warning(f"Error reading config: {e}, using default adapter: aws")
            return 'aws'
    
    @classmethod
    def reset_adapter(cls):
        """Reset the adapter instance (useful for testing)"""
        cls._adapter = None
        cls._adapter_type = None
        logger.info("Edge adapter reset")
    
    @classmethod
    def set_adapter(cls, adapter: EdgeRunner):
        """Manually set the adapter instance (useful for testing)"""
        cls._adapter = adapter
        logger.info(f"Edge adapter manually set to: {type(adapter).__name__}")
    
    @classmethod
    def get_adapter_type(cls) -> str:
        """Get the current adapter type"""
        if cls._adapter_type is None:
            cls._adapter_type = cls._get_adapter_type_from_config()
        return cls._adapter_type

def get_edge_runner() -> EdgeRunner:
    """Convenience function to get the edge adapter"""
    return EdgeRunnerFactory.get_adapter()