import asyncio
import threading
from dataclasses import dataclass
from typing import Any, Callable, Coroutine, Dict, List, Optional, Union

Callback = Union[Callable[..., Any], Callable[..., Coroutine[Any, Any, Any]]]

@dataclass(frozen=True)
class _Entry:
    fn: Callback
    loop: Optional[asyncio.AbstractEventLoop]  # “home” loop for async fns (captured at subscribe time)

class Events:
    def __init__(self):
        self._lock = threading.RLock()
        self._callbacks: Dict[str, List[_Entry]] = {}

    def subscribe(
        self,
        key: str,
        callback: Callback,
        allow_multiple: bool = False,
        *,
        loop: Optional[asyncio.AbstractEventLoop] = None,
    ) -> None:
        """
        Thread-safe subscribe. For async callbacks, we record their 'home' loop.
        Pass `loop=` to override; otherwise capture the current running loop if any.
        """
        if loop is None:
            try:
                loop = asyncio.get_running_loop()
            except RuntimeError:
                loop = None

        entry = _Entry(callback, loop if asyncio.iscoroutinefunction(callback) else None)

        with self._lock:
            bucket = self._callbacks.setdefault(key, [])
            if not allow_multiple and any(e.fn is callback for e in bucket):
                return
            bucket.append(entry)

    def unsubscribe(self, key: str, callback: Callback) -> None:
        """Thread-safe unsubscribe; silently ignores missing keys/callbacks."""
        with self._lock:
            bucket = self._callbacks.get(key)
            if not bucket:
                return
            # remove by identity, not equality
            for i, e in enumerate(bucket):
                if e.fn is callback:
                    del bucket[i]
                    break

    def fire(self, key: str, *args, **kwargs) -> None:
        """
        Safe to call from any thread and in/Outside an event loop.
        - Sync callbacks run immediately (or via executor if we're in an event loop).
        - Async callbacks are scheduled:
            * If we're in a loop: create_task on that loop.
            * Else if they have a 'home' loop: run_coroutine_threadsafe on that loop.
            * Else: run in a fresh background loop/thread.
        Returns immediately (does not await). Use `await_fire` if you need to await async listeners.
        """
        with self._lock:
            listeners = list(self._callbacks.get(key, []))  # copy under lock

        # Figure out if we’re in an event loop right now
        current_loop: Optional[asyncio.AbstractEventLoop]
        try:
            current_loop = asyncio.get_running_loop()
        except RuntimeError:
            current_loop = None

        # Helper to spawn a one-off loop in a background thread
        def _run_coro_in_new_loop(coro: Coroutine[Any, Any, Any]) -> None:
            def runner():
                asyncio.run(coro)
            t = threading.Thread(target=runner, daemon=True)
            t.start()

        for entry in listeners:
            fn = entry.fn

            if asyncio.iscoroutinefunction(fn):
                coro = fn(*args, **kwargs)  # don’t await here

                if current_loop is not None:
                    # We’re inside an event loop now → schedule locally
                    current_loop.create_task(coro)
                elif entry.loop is not None and entry.loop.is_running():
                    # Schedule on the callback's home loop from this thread
                    asyncio.run_coroutine_threadsafe(coro, entry.loop)
                else:
                    # No loop context available → spin up a throwaway loop/thread
                    _run_coro_in_new_loop(coro)

            else:
                # Synchronous function
                if current_loop is not None:
                    # Don’t block the loop; run in default executor
                    current_loop.run_in_executor(None, fn, *args, **kwargs)
                else:
                    # We’re in a normal thread; just call it
                    fn(*args, **kwargs)

    async def await_fire(self, key: str, *args, **kwargs) -> None:
        """
        Async variant that awaits all async callbacks.
        Sync callbacks still run off-thread if called from a loop.
        """
        with self._lock:
            listeners = list(self._callbacks.get(key, []))

        current_loop = asyncio.get_running_loop()
        pending: List[asyncio.Task] = []

        for entry in listeners:
            fn = entry.fn
            if asyncio.iscoroutinefunction(fn):
                # If the callback has a different loop recorded, use a thread-safe handoff
                if entry.loop and entry.loop is not current_loop and entry.loop.is_running():
                    fut = asyncio.run_coroutine_threadsafe(fn(*args, **kwargs), entry.loop)
                    # Wrap concurrent.futures.Future so we can await it
                    pending.append(asyncio.wrap_future(fut))
                else:
                    pending.append(current_loop.create_task(fn(*args, **kwargs)))
            else:
                # Keep sync work off the loop
                await current_loop.run_in_executor(None, fn, *args, **kwargs)

        if pending:
            await asyncio.gather(*pending)
