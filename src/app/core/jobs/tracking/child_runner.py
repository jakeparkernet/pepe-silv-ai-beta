from __future__ import annotations

import asyncio
import threading
from typing import Callable, Dict, Iterable, List, Optional, Tuple, Any, TYPE_CHECKING

if TYPE_CHECKING:
    from app.core.jobs.job import Job

OnChildFn = Callable[[str, object], None]
OnSummaryFn = Callable[[Dict[str, Any]], None]

class ChildRunner:
    def __init__(self, parent: "Job") -> None:
        from app.core.jobs.job import Job
        self._parent: Job = parent
        self._loop: Optional[asyncio.AbstractEventLoop] = None
        self._expected: set[str] = set()
        self._expected_seq: List[str] = []
        self._done: set[str] = set()
        self._results: Dict[str, Any] = {}
        self._errors: Dict[str, Any] = {}

        self._on_all_done: Optional[OnSummaryFn] = None
        self._on_timeout: Optional[OnSummaryFn] = None
        self._timeout_handle: Optional[asyncio.Handle] = None

        self._lock = threading.Lock()
        self._terminal_fired: bool = False

        self._mode: str = "parallel"
        self._current_index: int = 0
        self._specs: Dict[str, Dict[str, Any]] = {}
        self._on_completes: Dict[str, OnChildFn] = {}  # Per-label on_complete for sequential/per-child handling
        self._on_updates: Dict[str, OnChildFn] = {}    # Optional per-label on_update
        self._on_errors: Dict[str, OnChildFn] = {}     # Optional per-label on_error
        self._fail_fast: bool = True  # For sequential: halt on error or continue

    # ---------------------- lifecycle ----------------------

    def bind(
        self,
        labels_to_wait_for: Iterable[str],
        specs: Optional[Dict[str, Dict[str, Any]]] = None,
        on_completes: Optional[Dict[str, OnChildFn]] = None,
        on_updates: Optional[Dict[str, OnChildFn]] = None,
        on_errors: Optional[Dict[str, OnChildFn]] = None,
        *,
        mode: str = "parallel",
        on_all_done: Optional[OnSummaryFn] = None,
        on_timeout: Optional[OnSummaryFn] = None,
        timeout_sec: Optional[float] = None,
        fail_fast: bool = True,
    ) -> None:
        if mode not in ("parallel", "sequential"):
            raise ValueError("Mode must be 'parallel' or 'sequential'")

        try:
            self._loop = asyncio.get_running_loop()
        except RuntimeError:
            self._loop = None

        with self._lock:
            self._mode = mode
            self._fail_fast = fail_fast
            self._expected = set(labels_to_wait_for)
            self._expected_seq = list(labels_to_wait_for) if mode == "sequential" else []
            self._done.clear()
            self._results.clear()
            self._errors.clear()
            self._on_all_done = on_all_done
            self._on_timeout = on_timeout
            self._terminal_fired = False
            self._current_index = 0

            self._specs = specs or {}
            self._on_completes = on_completes or {}
            self._on_updates = on_updates or {}
            self._on_errors = on_errors or {}

            # schedule timeout if requested and a loop is available
            if self._timeout_handle is not None:
                self._timeout_handle.cancel()
                self._timeout_handle = None
            if timeout_sec is not None and timeout_sec > 0:
                if self._loop is not None:
                    self._timeout_handle = self._loop.call_later(timeout_sec, self._fire_timeout)
                else:
                    # No loop to schedule on; run timeout on a background thread timer
                    import threading as _threading

                    def _timer_f():
                        self._fire_timeout()

                    t = _threading.Timer(timeout_sec, _timer_f)
                    t.daemon = True
                    t.start()

    def start(self, checkpoint: Optional[Dict[str, Any]] = None) -> None:
        """Kick off the flow: enqueue the first (sequential) or all (parallel), or resume if checkpoint provided."""
        if checkpoint is not None:
            self.resume_from_checkpoint(checkpoint)
            return

        with self._lock:
            if self._terminal_fired:
                return
            if self._mode == "sequential":
                if self._current_index < len(self._expected_seq):
                    self._enqueue_next_locked()
            elif self._mode == "parallel":
                for label in self._expected:
                    self._enqueue_child(label)
                    
    # ---------------------- callback wrapping ----------------------

    def make_callbacks(
        self,
        child_label: str,
    ) -> Tuple[Callable[[object], None], Callable[[object], None]]:
        """Return wrapped (on_update, on_complete) based on stored per-label handlers."""
        on_update = self._on_updates.get(child_label)
        on_complete = self._on_completes.get(child_label)
        on_error = self._on_errors.get(child_label)

        def wrapped_update(payload: object) -> None:
            if on_update is not None:
                self._hop_threadsafe(on_update, child_label, payload)

        def wrapped_complete(payload: object) -> None:
            if on_complete is not None:
                self._hop_threadsafe(on_complete, child_label, payload)
            self._mark_done(child_label, result=payload, error=None)

        wrapped_complete.fail = lambda error: self.mark_failed(child_label, error) if on_error else lambda error: self.mark_failed(child_label, error)

        return wrapped_update, wrapped_complete

    # ---------------------- dynamic control ----------------------

    def add_expected(self, child_label: str, spec: Optional[Dict[str, Any]] = None, *, after: Optional[str] = None, on_complete: Optional[OnChildFn] = None, on_update: Optional[OnChildFn] = None, on_error: Optional[OnChildFn] = None) -> None:
        with self._lock:
            if child_label in self._expected:
                return
            self._expected.add(child_label)
            if spec:
                self._specs[child_label] = spec
            if on_complete:
                self._on_completes[child_label] = on_complete
            if on_update:
                self._on_updates[child_label] = on_update
            if on_error:
                self._on_errors[child_label] = on_error

            if self._mode == "sequential":
                if after == "current":
                    insert_idx = self._current_index + 1
                elif after is not None:
                    insert_idx = self._expected_seq.index(after) + 1 if after in self._expected_seq else len(self._expected_seq)
                else:
                    insert_idx = len(self._expected_seq)
                self._expected_seq.insert(insert_idx, child_label)
                # Adjust current_index if insertion before it
                if insert_idx <= self._current_index:
                    self._current_index += 1

    def cancel_expected(self, child_label: str, reason: Optional[str] = None) -> None:
        with self._lock:
            self._expected.discard(child_label)
            self._done.discard(child_label)
            if child_label in self._expected_seq:
                idx = self._expected_seq.index(child_label)
                del self._expected_seq[idx]
                if idx < self._current_index:
                    self._current_index -= 1
            if reason is not None:
                self._errors[child_label] = reason
            self._maybe_fire_all_done_locked()

    def mark_failed(self, child_label: str, error: Any) -> None:
        if error is False:
            return
        self._mark_done(child_label, result=None, error=error)

    # ---------------------- resumption ----------------------

    def resume_from_checkpoint(self, checkpoint: Dict[str, Any]) -> None:
        """Resume state from checkpoint, re-subscribe to pending, enqueue if needed."""
        from app.core.jobs.db.job_database_factory import get_job_database
        from app.core.jobs.persistence.edges import get_edge_by_label

        with self._lock:
            self._mode = checkpoint.get("mode", "parallel")
            self._expected_seq = checkpoint.get("labels", [])
            self._expected = set(self._expected_seq)
            self._done = set(checkpoint.get("completed", []))
            self._current_index = len(self._done) if self._mode == "sequential" else 0
            self._specs = checkpoint.get("specs", {})
            self._on_completes = checkpoint.get("on_completes", {})  # Assuming serializable, but callbacks can't be; might need to recreate in job
            # Note: Callbacks aren't serializable; job subclass must re-provide them on load

            db = get_job_database()
            parent_id = self._parent.id  # Use stored parent
            session_id = self._parent.session_id  # Use stored parent

            remaining = self._expected - self._done
            for label in remaining:
                edge = get_edge_by_label(parent_id=parent_id, session_id=session_id, child_label=label)
                if edge:
                    child_id = edge.get("child_job_id")
                    child = db.get_job(child_id)
                    if child:
                        if child.status in (JobStatus.COMPLETE, JobStatus.FAILED):
                            # Fire immediate if terminal
                            result = child.output or {"error": "failed"}
                            if child.status == JobStatus.FAILED:
                                self.mark_failed(label, result.get("error"))
                            else:
                                self._mark_done(label, result=result, error=None)
                        else:
                            # Re-subscribe
                            update_cb, complete_cb = self.make_callbacks(label)
                            self._subscribe_to_child(child_id, label, update_cb, complete_cb, complete_cb.fail)
                else:
                    # No edge: re-enqueue
                    self._enqueue_child(label)

            # If sequential and current not started, start it
            if self._mode == "sequential" and self._current_index < len(self._expected_seq) and self._expected_seq[self._current_index] not in self._done:
                self._enqueue_next_locked()

    def _subscribe_to_child(self, job_id: str, child_label: str, on_update: Callable, on_complete: Callable, on_error: Callable):
        db = get_job_database()
        prefix = f"{self._parent.id}_{child_label}"

        def make_handler(cb, extract):
            if not cb:
                return None
            def handler(evt):
                try:
                    data = extract(evt)
                    if data is not None:
                        self._hop_threadsafe(cb, data)
                except Exception as e:
                    print(f"Child callback error - {e}")
            return handler

        # Per-type subs (new API)
        db.subscribe(job_id, EventType.STATUS_UPDATE, f"{prefix}_status",
                    make_handler(on_update, lambda e: e.get("payload", {}).get("status")))
        db.subscribe(job_id, EventType.OUTPUT_UPDATE, f"{prefix}_output",
                    make_handler(on_update, lambda e: e.get("payload", {}).get("output")))
        
        db.subscribe(job_id, EventType.ON_COMPLETE, f"{prefix}_complete",
                    make_handler(on_complete, lambda e: e.get("payload", {}).get("job")))

        db.subscribe(job_id, EventType.HISTORY_APPEND, f"{prefix}_error",
                    make_handler(on_error, lambda e:
                        e.get("payload", {}).get("event") == "ERROR" and 
                        e.get("payload", {}).get("details")))

        # Fallback: wildcard for any missed events
        def wildcard_handler(evt):
            if evt.get("event_type") in ("STATUS_UPDATE", "OUTPUT_UPDATE") and on_update:
                on_update(evt)
            elif evt.get("event_type") == "ON_COMPLETE" and on_complete:
                on_complete(evt.get("payload", {}).get("job"))
            elif (evt.get("event_type") == "HISTORY_APPEND" and 
                  evt.get("payload", {}).get("event") == "ERROR" and on_error):
                on_error(evt.get("payload", {}).get("details"))
        
        db.subscribe(job_id, wildcard_handler)

    # ---------------------- internals ----------------------

    def _mark_done(self, child_label: str, *, result: Any, error: Any) -> None:
        with self._lock:
            if child_label in self._done:
                return
            if error is not None:
                self._errors[child_label] = error
                if self._mode == "sequential" and self._fail_fast:
                    self._terminal_fired = True
                    self._cancel_timeout_locked()
                    summary = self._summary_locked(final_reason="error")
                    cb = self._on_all_done
                    if cb:
                        self._hop_threadsafe(cb, summary)
                    return
            else:
                self._results[child_label] = result
            self._done.add(child_label)
            if self._mode == "sequential":
                if child_label == self._expected_seq[self._current_index]:
                    self._current_index += 1
                    if self._current_index < len(self._expected_seq):
                        self._enqueue_next_locked()
                    else:
                        self._maybe_fire_all_done_locked()
                # Else: out-of-order done (unlikely), but ignore for seq
            self._maybe_fire_all_done_locked()

    def _enqueue_next_locked(self) -> None:
        label = self._expected_seq[self._current_index]
        self._enqueue_child(label)

    def _enqueue_child(self, label: str) -> None:
        if label not in self._specs:
            return
        spec = self._specs[label]
        update_cb, complete_cb = self.make_callbacks(label)
        self._parent.create_child_job(  # Use stored parent
            child_label=label,
            spec=spec,
            on_update=update_cb,
            on_complete=complete_cb,
            on_error=complete_cb.fail,
        )

    def _maybe_fire_all_done_locked(self) -> None:
        if self._terminal_fired:
            return
        remaining = self._expected - self._done
        if remaining:
            return
        self._terminal_fired = True
        self._cancel_timeout_locked()
        summary = self._summary_locked(final_reason="all_done")
        cb = self._on_all_done
        if cb:
            self._hop_threadsafe(cb, summary)

    def _fire_timeout(self) -> None:
        with self._lock:
            if self._terminal_fired:
                return
            self._terminal_fired = True
            self._cancel_timeout_locked()
            summary = self._summary_locked(final_reason="timeout")
            cb = self._on_timeout
        if cb:
            self._hop_threadsafe(cb, summary)

    def _cancel_timeout_locked(self) -> None:
        h = self._timeout_handle
        self._timeout_handle = None
        if h is not None:
            try:
                h.cancel()
            except Exception:
                pass

    def _summary_locked(self, *, final_reason: str) -> Dict[str, Any]:
        return {
            "final_reason": final_reason,
            "expected": list(self._expected_seq) if self._mode == "sequential" else sorted(self._expected),
            "done": sorted(self._done),
            "pending": sorted(self._expected - self._done),
            "results": dict(self._results),
            "errors": dict(self._errors),
            "total": len(self._expected),
            "completed": len(self._done),
            "mode": self._mode,
        }

    def _hop_threadsafe(self, fn: Callable, *args: Any) -> None:
        loop = self._loop
        if loop is None:
            fn(*args)
            return
        try:
            running = asyncio.get_running_loop()
        except RuntimeError:
            running = None
        if running is loop:
            fn(*args)
        else:
            loop.call_soon_threadsafe(fn, *args)

    # ---------------------- observability ----------------------

    @property
    def total(self) -> int:
        with self._lock:
            return len(self._expected)

    @property
    def completed(self) -> int:
        with self._lock:
            return len(self._done)

    @property
    def pending(self) -> int:
        with self._lock:
            return len(self._expected - self._done)

    def snapshot(self) -> Dict[str, Any]:
        with self._lock:
            return {
                "expected": list(self._expected_seq) if self._mode == "sequential" else sorted(self._expected),
                "done": sorted(self._done),
                "results_keys": sorted(self._results.keys()),
                "errors_keys": sorted(self._errors.keys()),
                "total": len(self._expected),
                "completed": len(self._done),
                "pending": len(self._expected - self._done),
                "mode": self._mode,
            }

    def save_checkpoint(self) -> Dict[str, Any]:
        """Serialize for job checkpoint."""
        with self._lock:
            return {
                "version": 1,
                "mode": self._mode,
                "labels": list(self._expected_seq) if self._mode == "sequential" else list(self._expected),
                "completed": list(self._done),
                "specs": self._specs,  # Assume specs serializable
                # Callbacks not saved; re-provide on load
                "parent_id": self._parent.id,
                "session_id": self._parent.session_id,
            }