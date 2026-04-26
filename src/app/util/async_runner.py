# app/util/async_runner.py
from __future__ import annotations
import asyncio, threading
from concurrent.futures import Future

class AsyncRunner:
    _inst = None
    _lock = threading.Lock()

    def __init__(self):
        self._ready = threading.Event()
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()
        self._ready.wait()

    def _run(self):
        self.loop = asyncio.new_event_loop()
        asyncio.set_event_loop(self.loop)
        self._ready.set()
        self.loop.run_forever()

    @classmethod
    def get(cls) -> "AsyncRunner":
        if cls._inst is not None:
            return cls._inst
        with cls._lock:
            if cls._inst is None:
                cls._inst = AsyncRunner()
            return cls._inst

    def submit(self, coroutine) -> Future:
        """Thread-safe: schedule a coroutine on the runner loop, returns concurrent.futures.Future."""
        return asyncio.run_coroutine_threadsafe(coroutine, self.loop)

def submit(coroutine):
    return AsyncRunner.get().submit(coroutine)
