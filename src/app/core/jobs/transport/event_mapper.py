# app/core/jobs/transport/event_mapper.py
from __future__ import annotations

from dataclasses import dataclass, asdict
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Set, Union, TYPE_CHECKING
from zoneinfo import ZoneInfo  # NEW: for America/Chicago timezone

# Import only for type checking to avoid hard runtime deps if the module layout differs in tests.
if TYPE_CHECKING:
    from app.core.jobs.job import Job
    from app.core.jobs.job_status import JobStatus
    from app.core.jobs.historical_event import HistoricalEvent
    from app.core.jobs.db.job_event_types import EventType


def _iso(timestamp: Optional[datetime] = None) -> str:
    """
    Return an ISO8601 timestamp with timezone.
    - If `timestamp` is None, use current datetime in America/Chicago.
    - If `timestamp` is naive, keep prior behavior (assume UTC for stability).
    """
    if timestamp is None:
        timestamp = datetime.now(ZoneInfo("America/Chicago"))
    elif timestamp.tzinfo is None:
        timestamp = timestamp.replace(tzinfo=timezone.utc)
    return timestamp.isoformat()


@dataclass
class TransportEvent:
    """Canonical envelope for anything we send over transports (SSE, adapters, etc.)."""
    event_type: "EventType"      # enum instance; mapper will convert to its value in dict()
    job_id: str
    seq: Optional[int]           # Monotonic per-job sequence number; can be None for best-effort
    ts: str                      # ISO8601 timestamp string
    payload: Dict[str, Any]      # Type-specific payload
    version: int = 1             # Schema version
    emitter_node: Optional[str] = None
    parent_id: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        event_dict = asdict(self)
        # Convert enums to their value for wire-format stability
        event_type_value = event_dict.get("event_type")
        try:
            event_dict["event_type"] = event_type_value.value  # if it's an Enum
        except Exception:
            event_dict["event_type"] = event_type_value
        return event_dict

class EventMapper:
    """
    Stateless mapping layer between domain objects (Job, history entries) and transport events.

    Usage patterns:
      - Live emission (adapter):
            event = mapper.map_status_update(job_id, status, seq=seq_from_db)
            adapter.emit(event)

      - Replay (SSE streamer):
            events = mapper.map_history(job, event_types={...}, since_seq=last_seq_seen)
            for event in events: sse.send(event)

      - Snapshot on subscribe:
            snapshot = mapper.map_snapshot(job, event_types={...})
            for event in snapshot: sse.send(event)
    """

    def __init__(self, *, schema_version: int = 1, emitter_node: Optional[str] = None):
        self._schema_version = schema_version
        self._emitter_node = emitter_node

    def map_status_update(
        self,
        job_id: str,
        status: "JobStatus",
        *,
        seq: Optional[int],
        ts: Optional[datetime] = None,
        parent_id: Optional[str] = None
    ) -> Dict[str, Any]:
        from app.core.jobs.db.job_event_types import EventType  # runtime import
        transport_event = TransportEvent(
            event_type=EventType.STATUS_UPDATE,
            job_id=job_id,
            seq=seq,
            ts=_iso(ts),
            payload=
            {
                "status": getattr(status, "value", status)},
            version=self._schema_version,
            emitter_node=self._emitter_node,
            parent_id=parent_id,
        )
        return transport_event.to_dict()

    def map_output_update(
        self,
        job_id: str,
        output: Any,
        *,
        seq: Optional[int],
        ts: Optional[datetime] = None,
        parent_id: Optional[str] = None
    ) -> Dict[str, Any]:
        from app.core.jobs.db.job_event_types import EventType
        transport_event = TransportEvent(
            event_type=EventType.OUTPUT_UPDATE,
            job_id=job_id,
            seq=seq,
            ts=_iso(ts),
            payload={"output": output},
            version=self._schema_version,
            emitter_node=self._emitter_node,
            parent_id=parent_id,
        )
        return transport_event.to_dict()

    def map_history_append(
        self,
        job_id: str,
        historical_event: Union["HistoricalEvent", Dict[str, Any]],
        *,
        seq: Optional[int],
        ts: Optional[datetime] = None,
        parent_id: Optional[str] = None
    ) -> Dict[str, Any]:
        from app.core.jobs.db.job_event_types import EventType

        # Normalize the historical event to a dict and preserve original timestamp if present.
        if hasattr(historical_event, "model_dump"):
            historical_event_dict = historical_event.model_dump()
        elif hasattr(historical_event, "dict"):
            historical_event_dict = historical_event.dict()
        else:
            historical_event_dict = dict(historical_event)

        historical_event_timestamp = (
            historical_event_dict.get("ts") or historical_event_dict.get("timestamp")
        )

        # If an explicit `ts` wasn't supplied, prefer the event's own timestamp when present,
        # otherwise default to "now" in America/Chicago via _iso(None).
        derived_timestamp = None
        if ts is not None:
            derived_timestamp = ts
        elif isinstance(historical_event_timestamp, str):
            try:
                derived_timestamp = datetime.fromisoformat(historical_event_timestamp)
            except Exception:
                derived_timestamp = None  # fall back to _iso(None)

        transport_event = TransportEvent(
            event_type=EventType.HISTORY_APPEND,
            job_id=job_id,
            seq=seq,
            ts=_iso(derived_timestamp),
            payload={"event": historical_event_dict},
            version=self._schema_version,
            emitter_node=self._emitter_node,
            parent_id=parent_id,
        )
        return transport_event.to_dict()

    # --------- Replay / snapshot helpers ---------

    def map_history(
        self,
        job: "Job",
        *,
        event_types: Optional[Set["EventType"]] = None,
        since_seq: Optional[int] = None,
        include_status: bool = True,
        include_output: bool = True
    ) -> List[Dict[str, Any]]:
        """
        Create a replay list for a job starting after `since_seq` (exclusive).
        If the job's history items don't carry `seq`, they will be assigned by index (1-based).
        """
        from app.core.jobs.db.job_event_types import EventType

        events_list: List[Dict[str, Any]] = []
        job_id = getattr(job, "id")
        job_status = getattr(job, "status", None)
        job_output = getattr(job, "output", None)
        job_parent_id = getattr(job, "parent_id", None)
        current_seq = len(getattr(job, "history", []) or [])

        # Optional "snapshot-ish" prelude: current status/output
        if include_status and (event_types is None or EventType.STATUS_UPDATE in event_types):
            events_list.append(
                self.map_status_update(job_id, job_status, seq=current_seq, parent_id=job_parent_id)
            )
        if (
            include_output
            and job_output is not None
            and (event_types is None or EventType.OUTPUT_UPDATE in event_types)
        ):
            events_list.append(
                self.map_output_update(job_id, job_output, seq=current_seq, parent_id=job_parent_id)
            )

        history_items = getattr(job, "history", None) or []
        for index, history_item in enumerate(history_items, start=1):
            sequence_value = history_item.get("seq") if isinstance(history_item, dict) else getattr(history_item, "seq", None)
            effective_sequence = sequence_value if isinstance(sequence_value, int) else index
            if since_seq is not None and effective_sequence <= since_seq:
                continue
            if event_types is not None and EventType.HISTORY_APPEND not in event_types:
                continue
            events_list.append(
                self.map_history_append(
                    job_id,
                    history_item,
                    seq=effective_sequence,
                    parent_id=job_parent_id
                )
            )

        def _sort_key(event: Dict[str, Any]):
            return (event.get("seq") or 0, event.get("ts") or "")

        events_list.sort(key=_sort_key)
        return events_list

    def map_job(
        self,
        *,
        job: "Job" = None,
        job_payload: Dict[str, Any] | None = None,
        seq: Optional[int] = None,
        ts: Optional[datetime] = None,
    ) -> Dict[str, Any]:
        from app.core.jobs.db.job_event_types import EventType

        parent_id_value = None

        if job_payload is None:
            assert job is not None, "Provide either job or job_payload"
            job_payload = job.model_dump() if hasattr(job, "model_dump") else job.dict()
            job_id = getattr(job, "id", None)
            parent_id_value = getattr(job, "parent_id", None)
        else:
            job_id = job_payload.get("id")
            parent_id_value = job_payload.get("parent_id", None)

        transport_event = TransportEvent(
            event_type=EventType.FULL_UPDATE,
            job_id=job_id,
            seq=seq,
            ts=_iso(ts),
            payload={"job": job_payload},
            version=self._schema_version,
            emitter_node=self._emitter_node,
            parent_id=parent_id_value,
        )
        return transport_event.to_dict()

    def map_snapshot(
        self,
        job: "Job",
        *,
        event_types: Optional[Set["EventType"]] = None
    ) -> List[Dict[str, Any]]:
        """A compact snapshot as a short sequence: STATUS, OUTPUT (if any), then last few history events."""
        from app.core.jobs.db.job_event_types import EventType

        job_id = getattr(job, "id")
        job_status = getattr(job, "status", None)
        job_output = getattr(job, "output", None)
        job_parent_id = getattr(job, "parent_id", None)
        history_tail = (getattr(job, "history", None) or [])[-50:]  # cap for safety

        output_events: List[Dict[str, Any]] = []
        if event_types is None or EventType.STATUS_UPDATE in event_types:
            output_events.append(
                self.map_status_update(job_id, job_status, seq=None, parent_id=job_parent_id)
            )
        if job_output is not None and (event_types is None or EventType.OUTPUT_UPDATE in event_types):
            output_events.append(
                self.map_output_update(job_id, job_output, seq=None, parent_id=job_parent_id)
            )

        if event_types is None or EventType.HISTORY_APPEND in event_types:
            for index, history_item in enumerate(history_tail, start=max(1, len(history_tail) - len(history_tail) + 1)):
                sequence_value = history_item.get("seq") if isinstance(history_item, dict) else getattr(history_item, "seq", None)
                effective_sequence = sequence_value if isinstance(sequence_value, int) else index
                output_events.append(
                    self.map_history_append(
                        job_id,
                        history_item,
                        seq=effective_sequence,
                        parent_id=job_parent_id
                    )
                )
        return output_events
