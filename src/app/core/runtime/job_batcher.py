# job_batcher.py
import asyncio
import threading
import logging
from typing import List, Dict, Any, Optional, Callable, TYPE_CHECKING
from uuid import uuid4
from concurrent.futures import ThreadPoolExecutor

from app.util.enqueue_batch_callback import enqueue_batch_callback
from app.util.set_timeout import set_timeout

logger = logging.getLogger(__name__)
_global_batcher = None
_lock = threading.Lock()

if TYPE_CHECKING:
    from app.core.runtime.job_batch_item import JobBatchItem

class JobBatcher:
    """
    Collects jobs and flushes them in batches after 0.1 second of no activity.
    Thread-safe and async-safe.
    Uses an expandable list of buffers (ring-like behavior).
    """
    def __init__(
        self,
        *,
        flush_interval: float = 0.1,          # Reduced from 1.0s
        max_batch_size: int = 50,
        base_url: str = "",
        headers: dict | None = None,
        post_timeout: float = 5.0,
        event_timeout: float = 60.0,
        executor: ThreadPoolExecutor | None = None,
    ):
        self.flush_interval = flush_interval
        self.max_batch_size = max_batch_size
        self.base_url = base_url
        self.headers = headers
        self.post_timeout = post_timeout
        self.event_timeout = event_timeout
        self.executor = executor

        self._buffers: List[List["JobBatchItem"]] = []
        self._timers: List[Optional[Any]] = []
        self._lock = threading.RLock()
        self._loop: Optional[asyncio.AbstractEventLoop] = None

    def model_post_init(self, __context: Any) -> None:
        pass

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------
    def enqueue(
        self,
        job_spec: Optional[Dict[str, Any]] = None,
        job_specs: Optional[List[Dict[str, Any]]] = None,
        *,
        job_id: Optional[str] = None,
        job_ids: Optional[List[str]] = None,
        on_update: Optional[Callable] = None,
        on_updates: Optional[List[Callable]] = None,
        on_complete: Optional[Callable] = None,
        on_completes: Optional[List[Callable]] = None,
        on_error: Optional[Callable] = None,
        on_errors: Optional[List[Callable]] = None,
    ):
        """
        Add one or many jobs to the batch.
        - If `job_specs` is given → batch mode.
        - If only `job_spec` → single item (converted to list).
        Generates missing job_id(s).
        """
        from app.core.runtime.job_batch_item import JobBatchItem
        if job_specs is not None:
            if not isinstance(job_specs, list):
                job_specs = [job_specs]
            items: List["JobBatchItem"] = []
            # Pad callback lists
            on_updates = on_updates or [None] * len(job_specs)
            on_completes = on_completes or [None] * len(job_specs)
            on_errors = on_errors or [None] * len(job_specs)
            job_ids = job_ids or [None] * len(job_specs)

            for i, spec in enumerate(job_specs):
                
                spec = spec.copy()
                job_id = job_ids[i]

                if not job_id:
                    job_id = spec["params"]["id"]
                
                if not job_id:
                    job_id = str(uuid4())
                    
                spec["params"] = spec.get("params", {}).copy()
                spec["params"]["id"] = job_id
                items.append(
                    JobBatchItem(
                        job_spec=spec,
                        job_id=job_id,
                        on_update=on_updates[i],
                        on_complete=on_completes[i],
                        on_error=on_errors[i],
                    )
                )
        else:
            if job_spec is None:
                return

            spec = job_spec.copy()

            if not job_id and "id" in spec["params"]:
                job_id = spec["params"]["id"]
            
            if not job_id:
                job_id = str(uuid4())

            spec["params"] = spec.get("params", {}).copy()
            spec["params"]["id"] = job_id
            items = [
                JobBatchItem(
                    job_spec=spec,
                    job_id=job_id,
                    on_update=on_update,
                    on_complete=on_complete,
                    on_error=on_error,
                )
            ]

        with self._lock:
            for item in items:
                # Create new buffer if current is full or doesn't exist
                if not self._buffers or len(self._buffers[-1]) >= self.max_batch_size:
                    self._buffers.append([])
                    self._timers.append(None)

                self._buffers[-1].append(item)

                # Restart timer for this buffer
                buffer_idx = len(self._buffers) - 1
                if self._timers[buffer_idx]:
                    self._timers[buffer_idx].cancel()
                self._schedule_flush(buffer_idx)

    def flush(self):
        """Force immediate flush of all buffers (e.g. on shutdown)."""
        with self._lock:
            for i in range(len(self._buffers) - 1, -1, -1):
                self._flush_buffer(i)

    def _schedule_flush(self, buffer_index: int):
        loop = self._get_loop()
        def flush():
            self._flush_buffer(buffer_index)
        self._timers[buffer_index] = loop.call_later(self.flush_interval, flush)

    def _flush_buffer(self, index: int):
        with self._lock:
            if index >= len(self._buffers):
                return
            batch = self._buffers.pop(index)
            self._timers.pop(index)
            if not batch:
                return

        loop = self._get_loop()
        loop.run_in_executor(self.executor, self._send_batch, batch)

    def _get_loop(self) -> asyncio.AbstractEventLoop:
        if self._loop is None:
            try:
                self._loop = asyncio.get_running_loop()
            except RuntimeError:
                self._loop = asyncio.new_event_loop()
                threading.Thread(target=self._loop.run_forever, daemon=True).start()
        return self._loop

    def _send_batch(self, batch: List["JobBatchItem"]):
        try:
            job_specs = [item.job_spec for item in batch]
            on_updates = [item.on_update for item in batch]
            on_completes = [item.on_complete for item in batch]
            on_errors = [item.on_error for item in batch]

            # Attach .fail() to completion callbacks
            for i, cb in enumerate(on_completes):
                if cb:
                    def make_fail(i=i):
                        return lambda err: (
                            on_errors[i]({"error": err}) if on_errors[i] else None
                        )

                    # TODO: LEARN MORE ABOUT FAIL AND IF IT'S WORTH INTEGRATING THE CHILD_AWAIT_HELPER_CALLBACKS CLASS INTO JOB.PY WHEN CREATING A CHILD JOB
                    if hasattr(cb, "fail"):
                        cb.fail = make_fail

            enqueue_batch_callback(
                base_url=self.base_url,
                job_specs=job_specs,
                headers=self.headers,
                post_timeout=self.post_timeout,
                event_timeout=self.event_timeout,
                on_updates=on_updates,
                on_completes=on_completes,
                on_errors=on_errors,
                executor=self.executor,
            )
            logger.debug(f"Sent batch of {len(batch)} jobs")
        except Exception as e:
            logger.error(f"Batch send failed: {e}")
            for item in batch:
                if item.on_error:
                    item.on_error({"error": "Batch send failed", "exception": str(e)})

def get_batcher() -> JobBatcher:
    global _global_batcher
    if _global_batcher is None:
        with _lock:
            if _global_batcher is None:
                _global_batcher = JobBatcher()
    return _global_batcher