import asyncio
import inspect
import logging
import threading
from concurrent.futures import ThreadPoolExecutor
from typing import Callable, Optional
from app.util.enqueue_wait import enqueue_wait

logger = logging.getLogger(__name__)

def _make_dispatcher(cb: Optional[Callable], caller_loop: Optional[asyncio.AbstractEventLoop]):
    """
    Wrap a user callback (sync or async) so that:
      - If async & we have the caller's loop → schedule on that loop.
      - If async & no caller loop → run with a temporary loop in this thread.
      - If sync → call directly.
    """
    if cb is None:
        return None

    is_coro_fn = inspect.iscoroutinefunction(cb)

    if not is_coro_fn:
        # Plain sync function
        def _dispatch(arg):
            try:
                cb(arg)
            except Exception:
                logger.exception("enqueue callback raised")
        return _dispatch

    # Async callback
    def _dispatch_async(arg):
        try:
            if caller_loop and caller_loop.is_running():
                fut = asyncio.run_coroutine_threadsafe(cb(arg), caller_loop)

                def _log_done(f):
                    try:
                        f.result()
                    except Exception:
                        logger.exception("enqueue async callback raised")

                fut.add_done_callback(_log_done)
            else:
                # No ambient loop from caller; run it here
                asyncio.run(cb(arg))
        except Exception:
            logger.exception("enqueue async callback scheduling failed")

    return _dispatch_async

def enqueue_async(
    base_url: str = "",
    *,
    job_spec=None,
    job_id: str | None = None,
    headers: dict | None = None,
    timeout=None,
    on_update: Optional[Callable] = None,
    on_complete: Optional[Callable] = None,
    executor: ThreadPoolExecutor | None = None,
    thread_name: Optional[str] = None,
):
    """
    Fire-and-forget wrapper. Immediately returns while work continues in background.

    - If called from async code: runs blocking work in a threadpool and returns an asyncio.Future.
    - If called from sync code: starts a daemon Thread and returns the Thread.

    You may ignore the returned handle for true fire-and-forget.
    """
    caller_loop = None
    in_async = False
    try:
        caller_loop = asyncio.get_running_loop()
        in_async = True
    except RuntimeError:
        in_async = False

    # Wrap callbacks so they work regardless of sync/async nature
    _on_update = _make_dispatcher(on_update, caller_loop)
    _on_complete = _make_dispatcher(on_complete, caller_loop)

    def _runner():
        try:
            enqueue_wait(
                base_url,
                job_spec=job_spec,
                job_id=job_id,
                headers=headers,
                timeout=timeout,
                on_update=_on_update,
                on_complete=_on_complete,
            )
        except Exception:
            # Log and swallow to avoid noisy global asyncio logging
            logger.exception("enqueue worker crashed")

    if in_async:
        # Use caller's loop to delegate blocking work to a thread
        # Note: returning the Future is optional; caller can ignore it.
        if executor is None:
            # A shared process-wide executor is fine; default loop's executor is also okay.
            fut = caller_loop.run_in_executor(None, _runner)
        else:
            fut = caller_loop.run_in_executor(executor, _runner)

        # Optional: attach logging for unhandled worker exceptions (already logged inside)
        # but keep a done-callback so asyncio doesn't complain in some setups.
        def _done(_f):
            try:
                _f.result()
            except Exception:
                # Already logged in _runner; no re-raise to keep it quiet.
                pass

        fut.add_done_callback(_done)
        return fut

    # SYNC path: spawn a daemon thread
    t = threading.Thread(target=_runner, daemon=True, name=thread_name or "enqueue-worker")
    t.start()
    return t
