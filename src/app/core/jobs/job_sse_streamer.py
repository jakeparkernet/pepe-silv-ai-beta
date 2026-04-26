
import asyncio
import json
from typing import Any, Dict, Iterable, Optional, Set

from app.core.events.static_events_factory import StaticEventsFactory
from app.core.jobs.db.job_event_types import EventType
from app.core.jobs.db.base_job_database_adapter import BaseJobDatabaseAdapter

class JobSseStreamer:
    """Streams job events to HTTP SSE clients.

    Live updates come from the *events bus* (get_events("job")).
    Optional snapshot/replay comes from the provided Job DB adapter.
    """

    def __init__(
        self,
        mapper: Any = None,
        close_on_terminal: bool = False,
        max_queue_size: int = 1000,
    ) -> None:
        self.mapper = mapper  # kept for parity; snapshot/replay may use it if present
        self.close_on_terminal = close_on_terminal
        self.max_queue_size = max_queue_size
        self.lock = asyncio.Lock()
        self.subscribers: Set[asyncio.Queue[str]] = set()

    # ---------- SSE formatting helpers ----------

    @staticmethod
    def normalize_event(event_obj: Dict[str, Any]) -> Dict[str, Any]:
        """Return a dict with canonical fields for SSE packing."""
        if not isinstance(event_obj, dict):
            # Make best effort
            return {"event": "MESSAGE", "data": event_obj}

        event_type = event_obj.get("event_type") or event_obj.get("type") or "MESSAGE"
        if isinstance(event_type, EventType):
            event_type = event_type.value

        seq = event_obj.get("seq") or event_obj.get("sequence") or 0

        # `data` should be a JSON-serializable object representing the full event
        data = dict(event_obj)
        # remove ambiguous 'type' alias if present
        data.pop("type", None)

        return {
            "id": str(seq),
            "event": str(event_type),
            "data": data,
            # retry left unset → client default
        }

    @staticmethod
    def _json_default_encoder(obj: Any) -> Any:
        # Friendly encoder for enums/pydantic
        name = getattr(obj, "name", None)
        if name is not None:
            return name
        value = getattr(obj, "value", None)
        if value is not None:
            return value
        if hasattr(obj, "model_dump"):
            return obj.model_dump()
        if hasattr(obj, "dict"):
            return obj.dict()
        return str(obj)

    @staticmethod
    def _pack_sse(normalized: Dict[str, Any]) -> str:
        parts: list[str] = []
        if normalized.get("id") is not None:
            parts.append(f"id: {normalized['id']}")
        if normalized.get("event") is not None:
            parts.append(f"event: {normalized['event']}")
        data = normalized.get("data")
        parts.append("data: " + json.dumps(data, default=JobSseStreamer._json_default_encoder))
        parts.append("")  # blank line terminator
        return "\n".join(parts)

    # ---------- Public API ----------
    # Legacy compatibility: some older endpoints may try to inject events.
    # In the new architecture, the SSE streamer is a sink-only and does not republish.
    def add_event(self, event: Dict[str, Any]) -> None:
        # Intentionally a no-op to avoid feedback loops.
        return

    @property
    def stream(self):
        """Alias for stream_broadcast for backward compatibility."""
        return self.stream_broadcast


    async def stream_for_job(
        self,
        job_id: str,
        event_types: Optional[Iterable[EventType]],
        job_database: BaseJobDatabaseAdapter,
        *,
        replay: bool = True,
        snapshot_first: bool = True,
        since_sequence: Optional[int] = None,
    ):
        """Async generator yielding SSE frames for a specific job.

        - Subscribes to get_events("job") under key == job_id for *live* events.
        - Optionally sends a lightweight snapshot first.
        - Does not republish events to the bus.
        """
        queue: asyncio.Queue[str] = asyncio.Queue(self.max_queue_size)

        async with self.lock:
            self.subscribers.add(queue)

        # Filter set for quick checks (None → no filter)
        type_filter: Optional[Set[str]] = None
        if event_types:
            type_filter = { (et.value if isinstance(et, EventType) else str(et)) for et in event_types }

        done_event = asyncio.Event()

        # subscribe to the internal events bus
        bus = StaticEventsFactory.get_events("job")

        loop = asyncio.get_running_loop()

        def _on_bus_event(evt: Dict[str, Any]) -> None:
            try:
                evt_type = evt.get("event_type")
                if isinstance(evt_type, EventType):
                    evt_type = evt_type.value
                if type_filter is not None and str(evt_type) not in type_filter:
                    return

                norm = self.normalize_event(evt)
                sse = self._pack_sse(norm)

                # Put into the asyncio queue from any thread
                loop.call_soon_threadsafe(lambda: queue.put_nowait(sse))

                # Close policy on terminal
                if self.close_on_terminal and str(evt_type) == EventType.ON_COMPLETE.value:
                    loop.call_soon_threadsafe(done_event.set)

            except Exception:
                # Never break the publisher path
                pass

        # Attach subscription
        bus.subscribe(job_id, _on_bus_event)

        # Snapshot-first behavior (best-effort)
        if snapshot_first and since_sequence is None:
            try:
                job = job_database.get_job(job_id)
                if job is not None:
                    snapshot_evt = {
                        "event_type": EventType.FULL_UPDATE.value,
                        "seq": 0,
                        "payload": {"job": getattr(job, "model_dump", lambda: getattr(job, "dict", lambda: job)())() if hasattr(job, "model_dump") or hasattr(job, "dict") else job},
                        "job_id": job_id,
                    }
                    await queue.put(self._pack_sse(self.normalize_event(snapshot_evt)))
            except Exception:
                # Snapshot is best-effort; ignore failures
                pass

        try:
            # Drain until closed by client or terminal (if close_on_terminal)
            while True:
                if done_event.is_set():
                    break
                sse = await queue.get()
                yield sse
        finally:
            # Cleanup
            try:
                bus.unsubscribe(job_id, _on_bus_event)
            except Exception:
                pass
            async with self.lock:
                self.subscribers.discard(queue)


    async def stream_for_session(self, session_id: str):
        """Async generator yielding SSE frames for a session channel (e.g., 'session:<id>')."""

        queue: asyncio.Queue[str] = asyncio.Queue(self.max_queue_size)

        async with self.lock:
            self.subscribers.add(queue)

        bus = StaticEventsFactory.get_events("job")
        loop = asyncio.get_running_loop()
        key = f"session:{session_id}"

        def _on_bus_event(evt: Dict[str, Any]) -> None:
            try:
                norm = self.normalize_event(evt)
                sse = self._pack_sse(norm)
                loop.call_soon_threadsafe(lambda: queue.put_nowait(sse))
            except Exception:
                pass

        bus.subscribe(key, _on_bus_event)
        try:
            while True:
                sse = await queue.get()
                yield sse
        finally:
            try:
                bus.unsubscribe(key, _on_bus_event)
            except Exception:
                pass
            async with self.lock:
                self.subscribers.discard(queue)

    # Convenience for broadcast use-cases (not currently used by CoordinatorServer)
    async def stream_broadcast(self):
        queue: asyncio.Queue[str] = asyncio.Queue(self.max_queue_size)
        async with self.lock:
            self.subscribers.add(queue)

        done_event = asyncio.Event()
        bus = StaticEventsFactory.get_events("job")
        loop = asyncio.get_running_loop()

        def _on_bus_event(evt: Dict[str, Any]) -> None:
            try:
                norm = self.normalize_event(evt)
                sse = self._pack_sse(norm)
                loop.call_soon_threadsafe(lambda: queue.put_nowait(sse))
            except Exception:
                pass

        bus.subscribe("*", _on_bus_event)

        try:
            while True:
                sse = await queue.get()
                yield sse
        finally:
            try:
                bus.unsubscribe("*", _on_bus_event)
            except Exception:
                pass
            async with self.lock:
                self.subscribers.discard(queue)
