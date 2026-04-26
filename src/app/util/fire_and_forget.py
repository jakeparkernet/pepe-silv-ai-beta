import asyncio
import threading
import time
import logging
import functools
from concurrent.futures import Future
from contextvars import copy_context
from typing import Callable, Awaitable, Optional, Union
from collections.abc import Awaitable
import inspect

_bg_loop = None
_bg_thread = None
_bg_lock = threading.Lock()
_bg_semaphore = None

def _loop_worker():
    global _bg_loop
    _bg_loop = asyncio.new_event_loop()
    asyncio.set_event_loop(_bg_loop)
    _bg_loop.run_forever()
    _bg_loop.close()

def _ensure_bg_loop(max_concurrency: Optional[int]):
    """Start or reuse background loop; optionally add concurrency limit."""
    global _bg_thread, _bg_semaphore
    with _bg_lock:
        if _bg_thread is None or not _bg_thread.is_alive():
            _bg_thread = threading.Thread(target=_loop_worker, name="asyncio-bg-loop", daemon=True)
            _bg_thread.start()
            while _bg_loop is None:
                time.sleep(0.001)
            if max_concurrency:
                asyncio.run_coroutine_threadsafe(
                    _create_semaphore(max_concurrency), _bg_loop
                ).result()
        elif max_concurrency and _bg_semaphore is None:
            asyncio.run_coroutine_threadsafe(
                _create_semaphore(max_concurrency), _bg_loop
            ).result()

async def _create_semaphore(n):
    global _bg_semaphore
    _bg_semaphore = asyncio.Semaphore(n)

def shutdown_fire_and_forget_loop():
    """Stop the background loop when the app exits."""
    if _bg_loop and _bg_loop.is_running():
        _bg_loop.call_soon_threadsafe(_bg_loop.stop)

def fire_and_forget(
    fn_or_coro,
    *args,
    max_concurrency=None,
    log_exceptions=True,
    **kwargs,
):
    def _is_async_callable(f):
        while isinstance(f, functools.partial):
            f = f.func
        # Optional: unwrap decorators that set __wrapped__
        f = getattr(f, "__wrapped__", f)
        f = getattr(f, "__call__", f)
        return asyncio.iscoroutinefunction(f)

    # NEW: explicit opt-in flag
    may_return_awaitable = getattr(fn_or_coro, "__returns_awaitable__", False)

    is_async = asyncio.iscoroutine(fn_or_coro) or (
        callable(fn_or_coro) and _is_async_callable(fn_or_coro)
    )

    if not is_async:
        try:
            if callable(fn_or_coro):
                # Only call early if the caller opted in
                if may_return_awaitable:
                    result = fn_or_coro(*args, **kwargs)
                    if isinstance(result, Awaitable):
                        # Re-enter to schedule via the normal async path
                        return fire_and_forget(
                            result,
                            max_concurrency=max_concurrency,
                            log_exceptions=log_exceptions,
                        )
                    return result
                # original behavior for truly sync callables
                return fn_or_coro(*args, **kwargs)
            else:
                raise TypeError("Expected callable or coroutine object")
        except Exception:
            if log_exceptions:
                logging.exception("Exception in sync fire-and-forget call")
            return None

    # ...everything below stays as in your file...
    coro_factory = (
        (lambda: fn_or_coro(*args, **kwargs))
        if callable(fn_or_coro) and not asyncio.iscoroutine(fn_or_coro)
        else lambda: fn_or_coro
    )

    async def _runner(coro):
        try:
            return await coro
        except Exception:
            if log_exceptions:
                logging.exception("Unhandled exception in async fire-and-forget task")

    ctx = copy_context()

    try:
        loop = asyncio.get_running_loop()
        task = loop.create_task(_runner(coro_factory()))
        return task
    except RuntimeError:
        _ensure_bg_loop(max_concurrency)
        coro = ctx.run(coro_factory)
        if _bg_semaphore:
            async def _bounded():
                async with _bg_semaphore:
                    return await _runner(coro)
            coro = _bounded()
        fut = asyncio.run_coroutine_threadsafe(coro, _bg_loop)
        if log_exceptions:
            def _done(f: Future):
                try:
                    f.result()
                except Exception:
                    logging.exception("Unhandled exception in background task")
            fut.add_done_callback(_done)
        return fut
