import asyncio
import threading
import inspect
from typing import Callable, Any

class TimeoutHandle:
    """Unified handle returned by set_timeout()."""
    __slots__ = ("_cancel", "_repr")

    def __init__(self, cancel: Callable[[], None], repr_str: str):
        self._cancel = cancel
        self._repr = repr_str

    def cancel(self) -> None:
        """Cancel the scheduled callback if it hasn't run yet."""
        self._cancel()

    def __repr__(self) -> str:
        return self._repr

def set_timeout(callback: Callable[..., Any], delay: float, *args, **kwargs) -> TimeoutHandle:
    """
    Schedule `callback(*args, **kwargs)` to run after `delay` seconds.

    - If called from within a running asyncio event loop, attaches to *that* loop (thread-local).
    - Otherwise, falls back to a threading.Timer in the current thread.
    - `callback` may be a regular function OR an async function.
    - Returns a handle with `.cancel()`.

    Example:
        set_timeout(lambda: print("hi"), 1.5)
    """
    try:
        # Works only if *this thread* has a running loop.
        loop = asyncio.get_running_loop()
        is_coro = inspect.iscoroutinefunction(callback)

        if is_coro:
            def runner():
                # Schedule the coroutine on the same loop
                asyncio.create_task(callback(*args, **kwargs))
        else:
            def runner():
                callback(*args, **kwargs)

        handle = loop.call_later(delay, runner)

        def cancel():
            handle.cancel()

        return TimeoutHandle(cancel, f"<TimeoutHandle asyncio when={getattr(handle, 'when', lambda: None)()}>")

    except RuntimeError:
        # No running loop in this thread → use a standard timer.
        is_coro = inspect.iscoroutinefunction(callback)

        if is_coro:
            # Run the coroutine in a fresh, private loop inside the timer thread.
            # (No loop exists to "attach" to in this sync context.)
            def timer_runner():
                asyncio.run(callback(*args, **kwargs))
        else:
            def timer_runner():
                callback(*args, **kwargs)

        t = threading.Timer(delay, timer_runner)
        t.daemon = True  # don't block interpreter exit
        t.start()

        def cancel():
            t.cancel()

        return TimeoutHandle(cancel, "<TimeoutHandle threading.Timer>")
