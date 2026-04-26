import uuid
import asyncio
import time
from uuid import uuid4
from typing import Any, Dict, List, Optional, Type, Callable, ClassVar, TYPE_CHECKING
from pydantic import BaseModel, Field, field_validator
from pydantic.config import ConfigDict
from app.core.jobs.job_status import JobStatus
from app.core.jobs.db.job_database_factory import get_job_database
from app.core.jobs.historical_event import HistoricalEvent
from app.core.jobs.db.job_event_types import EventType
from app.core.jobs.tracking.step import Step
from app.core.jobs.tracking.cursor import Cursor
from app.core.runtime.job_batcher import get_batcher
from app.util.generate_dedupe_key import generate_dedupe_key
from app.util.fire_and_forget import fire_and_forget
from app.core.jobs.tracking.child_runner import ChildRunner

class Job(BaseModel):
    
    model_config = ConfigDict(
        use_enum_values=True,
        populate_by_name=True,
        arbitrary_types_allowed=True,
    )

    registry: ClassVar[Dict[str, Type["Job"]]] = {}

    @classmethod
    def register(cls, subcls: Optional[Type["Job"]] = None, *, name: Optional[str] = None):
        if subcls is None:
            def wrapper(actual: Type["Job"]):
                cls.registry[name or actual.__name__] = actual
                return actual
            return wrapper
        cls.registry[name or subcls.__name__] = subcls
        return subcls

    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    status: JobStatus = Field(
        default=JobStatus.INIT,
        serialization_alias="status",
        validation_alias="status",
        json_schema_extra={"example": "RUNNING"}
    )
    history: List[HistoricalEvent] = Field(default_factory=list, exclude=True)
    input: Any = None
    output: Any | None = None
    context: str = ""
    label: str = ""
    description: str = ""
    session_id: str = "UNKNOWN"
    updated_at: float = 0.0
    last_seq: int = 0
    parent_id: str | None = None
    requirements: Dict[str, Any] = Field(default_factory=dict)
    metadata: Dict[str, Any] = Field(default_factory=dict)
    steps: Dict[str, Step] = Field(default_factory=dict)
    cursor: Optional[Cursor] = None
    job_type: str = ""
    dedupe_key: str = ""
    spec_min: Dict[str, Any] = Field(default_factory=dict)
    was_loaded: bool = Field(exclude=True, default=False)
    platform: str = ""
    checkpoint: Dict[str, Any] = Field(default_factory=dict, exclude=True)
    has_applied: bool = Field(exclude=True, default=False)

    @field_validator("parent_id", mode="before")
    @classmethod
    def _empty_str_to_none(cls, v):
        return None if v == "" else v

    @field_validator("status", mode="before")
    @classmethod
    def validate_status(cls, v):
        if isinstance(v, str):
            try:
                return JobStatus(v.upper())
            except ValueError:
                return JobStatus.INIT
        return v

    def model_post_init(self, __context: Any) -> None:
        if self.was_loaded:
            return

        self.updated_at = time.time()

    async def run(self, platform: str):
        self.platform = platform
        self._set_status(JobStatus.RUNNING)

    def set_status(self, status: JobStatus) -> None:
        """Public helper – mirrors old _set_status but does NOT touch self."""
        if status == self.status:
            return
        self.updated_at = time.time()
        get_job_database().update_job_status(self.id, status)

    def append_history(self, ev: HistoricalEvent | dict) -> None:
        ev_obj = ev if isinstance(ev, HistoricalEvent) else HistoricalEvent.model_validate(ev)
        get_job_database().append_history(self.id, ev_obj)
        self.updated_at = time.time()

    def set_output(self, output: Any) -> None:
        get_job_database().update_output(self.id, output)
        self.updated_at = time.time()

    def _set_status(self, status: JobStatus) -> None:
        self.set_status(status)

    def _append_history(self, ev: HistoricalEvent | dict) -> None:
        self.append_history(ev)

    def _set_output(self, output: Any) -> None:
        self.set_output(output)

    def complete (self, result = {}):
        self._set_status(JobStatus.COMPLETE)
        get_job_database().update_job(self)
        get_job_database().complete_job(self)
        self.updated_at = time.time()
        return result

    def create_child_job(
        self,
        child_label,
        spec: Dict[str, Any],
        *,
        on_update: Optional[Callable] = None,
        on_complete: Optional[Callable] = None,
        on_error: Optional[Callable] = None,
    ) -> str:
        job_id = spec.get("job_id") or spec.setdefault("params", {}).setdefault("id", str(uuid4()))

        if "child_label" not in spec:
            spec["child_label"] = child_label

        if "dedupe_key" not in spec:
            spec["dedupe_key"] = generate_dedupe_key({
                "job_type": spec["type"],
                "input": spec["params"]["input"]
            })

        # Persist parent → child mapping
        db = get_job_database()
        db.record_edge(
            session_id=self.session_id,
            parent_id=self.id,
            child_job_id=job_id,
            child_label=child_label,
            child_type=spec.get("type"),
            dedupe_key=spec.get("dedupe_key"),
            spec_min=spec.get("spec_min", {}),
        )

        # Check if already exists
        existing = db.get_job(job_id)
        if existing:
            # Subscribe + fire terminal state
            self._subscribe_to_child(job_id, child_label, on_update, on_complete, on_error)
            if existing.status in (JobStatus.COMPLETE, JobStatus.FAILED):
                result = existing.output or {"error": "failed"}
                if existing.status == JobStatus.FAILED:
                    if on_error:
                        on_error(result)
                    elif on_complete:
                        on_complete.fail(result.get("error"))
                else:
                    if on_complete:
                        fire_and_forget(on_complete, result)
            return job_id

        get_batcher().enqueue(
            job_spec=spec,
            on_update=on_update,
            on_complete=on_complete,
            on_error=on_error,
        )
        self._subscribe_to_child(job_id, child_label, on_update, on_complete, on_error)
        return job_id

    def _hop_to_loop(self, fn, arg):
        loop = getattr(self, "_loop", None) or asyncio.get_event_loop()

        def run_fn ():
            fire_and_forget(fn, arg)

        try:
            running = asyncio.get_running_loop()
        except RuntimeError:
            running = None
        if running is loop:
            run_fn()
        else:
            loop.call_soon_threadsafe(run_fn)

    def _subscribe_to_child(
        self,
        job_id: str,
        child_label: str,
        on_update: Optional[Callable],
        on_complete: Optional[Callable],
        on_error: Optional[Callable],
    ):
        db = get_job_database()
        prefix = f"{self.id}_{child_label}"

        def make_handler(cb, extract):
            if not cb:
                return None
            def handler(evt):
                try:
                    data = extract(evt)
                    if data is not None:
                        self._hop_to_loop(cb, data)
                except Exception as e:
                    print(f"Child callback error - {e}")
            return handler

        # Per-type subs (new API)
        if on_update:
            db.subscribe(job_id, EventType.STATUS_UPDATE, f"{prefix}_status",
                        make_handler(on_update, lambda e: e.get("payload", {}).get("status")))
            db.subscribe(job_id, EventType.OUTPUT_UPDATE, f"{prefix}_output",
                        make_handler(on_update, lambda e: e.get("payload", {}).get("output")))
        
        if on_complete:
            db.subscribe(job_id, EventType.ON_COMPLETE, f"{prefix}_complete",
                        make_handler(on_complete, lambda e: e.get("payload", {}).get("job")))

        if on_error:
            db.subscribe(job_id, EventType.HISTORY_APPEND, f"{prefix}_error",
                        make_handler(on_error, lambda e:
                            e.get("payload", {}).get("event") == "ERROR" and 
                            e.get("payload", {}).get("details")))

        # Fallback: wildcard for any missed events
        if on_update or on_complete or on_error:
            def wildcard_handler(evt):
                if evt.get("event_type") in ("STATUS_UPDATE", "OUTPUT_UPDATE") and on_update:
                    on_update(evt)
                elif evt.get("event_type") == "ON_COMPLETE" and on_complete:
                    fire_and_forget(on_complete, evt.get("payload", {}).get("job"))
                elif (evt.get("event_type") == "HISTORY_APPEND" and 
                    evt.get("payload", {}).get("event") == "ERROR" and on_error):
                    on_error(evt.get("payload", {}).get("details"))
            
            db.subscribe(job_id, wildcard_handler)  # legacy API

    def on_child_updated (self, child_label, result=None):
        #print(f"child job updated: {child_label} - {result}")
        pass

    def on_child_completed (self, child_label, result):
        print(f"child job completed: {child_label}")

    def fail(self, error: str | Exception):
        err_msg = str(error)
        self._set_status(JobStatus.FAILED)
        self._append_history({
            "event": "ERROR",
            "details": {"error": err_msg},
            "timestamp": time.time()
        })
        self.complete({"error": err_msg})

    def save_checkpoint(self) -> dict:
        """Return internal cursor + known child job ids keyed by correlation buckets."""
        return {}

    def load_checkpoint(self, checkpoint: dict, registry) -> None:
        """Restore internal cursor and bind known child ids from registry."""
        pass

    def _trigger_checkpoint(self):
        """Call after significant state changes."""
        self.checkpoint = self.save_checkpoint()
        db = get_job_database()
        if hasattr(db, "update_job"):
            db.update_job(self, metadata={"called_from_job": True})

    def apply_result (self, result):
        self.has_applied = True