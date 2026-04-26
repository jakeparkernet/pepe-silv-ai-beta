# event_poster.py
from __future__ import annotations
import os
import asyncio, threading, contextlib, json
import httpx
from typing import Optional, Tuple
from app.config import NetConfig

_singleton_lock = threading.Lock()
_singleton_instance: Optional[EventPoster] = None

class EventPoster:
    def __init__(self, base_url: str | None = None, headers: dict | None = None, timeout: float = 10.0):
        if base_url is None:
            base_url = NetConfig.get_base_url()

        self.base_url = base_url.rstrip("/")
        self.headers = headers or {"Content-Type": "application/json"}
        self.timeout = timeout

        self._q: asyncio.Queue[Tuple[str, dict]] | None = None
        self._task: asyncio.Task | None = None
        self._loop: asyncio.AbstractEventLoop | None = None
        self._lock = threading.Lock()

    async def start(self):
        if self._q is not None:
            return
        self._loop = asyncio.get_running_loop()
        self._q = asyncio.Queue()
        self._task = asyncio.create_task(self._run())

    async def stop(self):
        if not self._q:
            return
        await self._q.join()
        if self._task and not self._task.done():
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._task
        self._task = None
        self._q = None
        self._loop = None

    def emit(self, endpoint: str, payload: dict):
        """Thread-safe enqueue. Non-blocking. Safe from any thread."""
        with self._lock:
            loop = self._loop
            q = self._q
        if not loop or not q:
            raise RuntimeError("EventPoster not started")
        loop.call_soon_threadsafe(q.put_nowait, (endpoint, payload))

    async def aemit(self, endpoint: str, payload: dict):
        with self._lock:
            q = self._q
        if not q:
            raise RuntimeError("EventPoster not started")
        await q.put((endpoint, payload))

    async def _run(self):
        async with httpx.AsyncClient(timeout=httpx.Timeout(self.timeout)) as client:
            while True:
                endpoint, ev = await self._q.get()
                try:
                    await self._post_event(endpoint, client, ev)
                except Exception as e:
                    # simple retries with backoff
                    for i in range(3):
                        await asyncio.sleep(0.4 * (2 ** i))
                        try:
                            await self._post_event(endpoint, client, ev)
                            break
                        except Exception:
                            if i == 2:
                                print(f"[EventPoster] DROP after retries: {e!r}")
                finally:
                    self._q.task_done()

    async def _post_event(self, endpoint: str, client: httpx.AsyncClient, ev: dict):
        url = f"{self.base_url}{endpoint}"
        r = await client.post(url, json=ev, headers=self.headers)
        r.raise_for_status()

    async def stream_sse(self, endpoint: str, body: dict, timeout: float | None = None):
        """
        Async generator that POSTS JSON and yields parsed SSE event dicts.
        Usage:
            async for evt in poster.stream_sse("/enqueue-sse", body):
                ...
        """
        url = f"{self.base_url}{endpoint}"
        to = httpx.Timeout(timeout or self.timeout)
        async with httpx.AsyncClient(timeout=to) as client:
            async with client.stream("POST", url, json=body, headers=self.headers) as resp:
                resp.raise_for_status()
                async for line in resp.aiter_lines():
                    if not line or line.startswith(":") or not line.startswith("data:"):
                        continue
                    payload_str = line[len("data:"):].strip()
                    if not payload_str:
                        continue
                    try:
                        yield json.loads(payload_str)
                    except Exception:
                        # ignore malformed chunks
                        continue

def get_event_poster() -> EventPoster:
    """
    Thread-safe lazy initializer for the global EventPoster.
    Auto-starts it (once) on an event loop (current loop if present, or a dedicated background loop).
    """
    global _singleton_instance
    if _singleton_instance is not None:
        return _singleton_instance

    with _singleton_lock:
        if _singleton_instance is not None:
            return _singleton_instance

        poster = EventPoster()

        try:
            loop = asyncio.get_running_loop()
            loop.create_task(poster.start())
        except RuntimeError:
            def _loop_thread():
                new_loop = asyncio.new_event_loop()
                asyncio.set_event_loop(new_loop)
                new_loop.run_until_complete(poster.start())
                new_loop.run_forever()
            t = threading.Thread(target=_loop_thread, daemon=True)
            t.start()

        _singleton_instance = poster
        return _singleton_instance
