import threading
from typing import Dict
from app.core.events.events import Events

class StaticEventsFactory:
    _instances: Dict[str, Events] = {}
    _lock = threading.RLock()

    @staticmethod
    def get_events(key: str) -> Events:
        """
        Retrieve a shared Events instance for the given key.
        Creates a new one if it doesn't exist yet.
        """
        with StaticEventsFactory._lock:
            if key not in StaticEventsFactory._instances:
                StaticEventsFactory._instances[key] = Events()
            return StaticEventsFactory._instances[key]

    @staticmethod
    def all_keys() -> list[str]:
        """Return all keys currently stored in the factory."""
        with StaticEventsFactory._lock:
            return list(StaticEventsFactory._instances.keys())

    @staticmethod
    def clear_all() -> None:
        """Clear all stored Events instances."""
        with StaticEventsFactory._lock:
            StaticEventsFactory._instances.clear()
