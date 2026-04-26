# database_service.py
"""
DatabaseService: single-threaded actor that owns the DB adapter and
auto-exposes adapter methods as **both** async and sync helpers.

Usage:
    service = DatabaseService.get()

    # Async callers (same signature as adapter)
    eid = await service.add_entity(Entity(...))
    rows = await service.find_entities_by_name("Tesla")

    # Sync callers (same signature as adapter) via .sync facade
    eid = service.sync.add_entity(Entity(...))
    rows = service.sync.find_entities_by_name("Tesla")

Implementation details:
- The adapter is created lazily on the service loop/thread.
- Adapter methods are not imported explicitly here; instead, the service
  dynamically proxies unknown attributes to adapter methods and injects
  the adapter-owned event loop/thread via call()/acall().
- Works for adapter methods that are either async or sync.
"""

import asyncio
import threading
import concurrent.futures
import inspect
import uuid
from typing import Any, Awaitable, Callable, Optional, Dict
from app.core.db.database_factory import DatabaseFactory

class _SyncFacade:
    """Synchronous facade: exposes adapter methods to sync callers.

    Example:
        service = DatabaseService.get()
        result = service.sync.add_entity(Entity(...))
    """
    def __init__(self, service: "DatabaseService") -> None:
        self._service = service

    def __getattr__(self, name: str):
        # Return a sync function that will run on the service loop
        def _sync_proxy(*args, **kwargs):
            async def _job(adapter):
                attr = getattr(adapter, name)
                result = attr(*args, **kwargs)
                if inspect.isawaitable(result):
                    return await result
                return result
            return self._service.call(_job)
        return _sync_proxy


class DatabaseService:
    """
    Process-wide singleton service ("actor") that:
      - Runs a dedicated asyncio event loop on its own daemon thread.
      - Lazily creates and owns the database adapter on that loop.
      - Exposes adapter methods directly for async callers (await service.method(...)).
      - Exposes the same methods for sync callers via the `.sync` facade.
    """

    _instance: Optional["DatabaseService"] = None
    _lock = threading.Lock()

    def __init__(self) -> None:
        self._loop: Optional[asyncio.AbstractEventLoop] = None
        self._adapter = None
        self._loop_ready = threading.Event()
        self._shutdown = threading.Event()
        self._thread = threading.Thread(target=self._run_loop, name="DatabaseService", daemon=True)
        self._thread.start()
        self._loop_ready.wait()

        # cache for dynamically generated async callables
        self._async_cache: Dict[str, Callable[..., Awaitable[Any]]] = {}
        self._sync_facade = _SyncFacade(self)

    # ---------- Singleton access ----------

    @classmethod
    def get(cls) -> "DatabaseService":
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = DatabaseService()
        return cls._instance

    # ---------- Public sync/async bridges ----------

    def call(self, fn: Callable[..., Awaitable[Any]], *args, timeout: Optional[float] = None, **kwargs) -> Any:
        """Thread-safe, blocking bridge for synchronous contexts."""
        fut = self._submit(fn, *args, **kwargs)
        return fut.result(timeout=timeout)

    async def acall(self, fn: Callable[..., Awaitable[Any]], *args, timeout: Optional[float] = None, **kwargs) -> Any:
        """Thread-safe, awaitable bridge for asynchronous contexts."""
        fut = self._submit(fn, *args, **kwargs)
        if timeout is None:
            return await asyncio.wrap_future(fut)
        return await asyncio.wait_for(asyncio.wrap_future(fut), timeout=timeout)

    def shutdown(self) -> None:
        """Gracefully stop the service loop/thread (idempotent)."""
        if self._shutdown.is_set():
            return
        self._shutdown.set()
        if self._loop is not None:
            self._loop.call_soon_threadsafe(self._loop.stop)
        if self._thread.is_alive():
            self._thread.join(timeout=2)

    @property
    def sync(self) -> _SyncFacade:
        """Access synchronous versions of adapter methods."""
        return self._sync_facade

    # ---------- Dynamic adapter method exposure ----------

    def __getattr__(self, name: str):
        """
        Dynamically create an async proxy for any adapter method.
        Example:
            await service.add_entity(...)
        """
        # Serve cached proxy if we've created it before
        if name in self._async_cache:
            return self._async_cache[name]

        async def _async_proxy(*args, **kwargs):
            async def _job(adapter):
                attr = getattr(adapter, name)
                result = attr(*args, **kwargs)
                if inspect.isawaitable(result):
                    return await result
                return result
            return await self.acall(_job)

        # Cache and return
        self._async_cache[name] = _async_proxy
        return _async_proxy

    async def list_adapter_methods(self) -> Dict[str, str]:
        """Introspect adapter and list public methods -> 'async' | 'sync'."""
        import inspect as _inspect

        async def _job(adapter):
            methods = {}
            for attr_name in dir(adapter):
                if attr_name.startswith("_"):
                    continue
                try:
                    attr = getattr(adapter, attr_name)
                except Exception:
                    continue
                if callable(attr):
                    # Determine if it's async or sync
                    is_async = _inspect.iscoroutinefunction(attr)
                    methods[attr_name] = "async" if is_async else "sync"
            return methods

        return await self.acall(_job)

    # ---------- Internals ----------

    def _submit(self, fn: Callable[..., Awaitable[Any]], *args, **kwargs) -> "concurrent.futures.Future[Any]":
        if self._shutdown.is_set() or self._loop is None:
            raise RuntimeError("DatabaseService is not running")

        async def _job_wrapper():
            if self._adapter is None:
                self._adapter = await DatabaseFactory.get_adapter()
            return await fn(self._adapter, *args, **kwargs)

        return asyncio.run_coroutine_threadsafe(_job_wrapper(), self._loop)

    async def ensure_adapter ():
        if self._adapter is None:
            self._adapter = await DatabaseFactory.get_adapter()

    def _run_loop(self) -> None:
        self._loop = asyncio.new_event_loop()
        asyncio.set_event_loop(self._loop)
        self._loop_ready.set()
        try:
            self._loop.run_forever()
        finally:
            # Optional: adapter teardown here if available
            try:
                if self._adapter is not None:
                    self._loop.run_until_complete(self._adapter.close())
                    pass
            except Exception:
                pass
            self._loop.close()
