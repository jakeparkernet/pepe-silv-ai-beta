# app/util/callback_dispatch.py
import inspect
from app.util.async_runner import submit  # the background loop singleton

def dispatch_callback(cb, *args, **kwargs):
    """
    Call sync callbacks directly.
    Schedule async callbacks on a dedicated background loop.
    Exceptions bubble to the caller (so enqueue_async can log).
    """
    if cb is None:
        return
    if inspect.iscoroutinefunction(cb):
        # run on the background loop; wait for completion so errors are visible
        submit(cb(*args, **kwargs)).result()
    else:
        cb(*args, **kwargs)