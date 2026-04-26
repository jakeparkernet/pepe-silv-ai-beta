import inspect
import functools

def is_awaitable (fn) -> bool:
    """
    Returns True if `fn` is *defined* as an async callable — that is,
    an async function, async method, or callable class whose __call__
    is async.  Never calls the function.
    """
    def unwrap(f):
        # unwrap partials
        while isinstance(f, functools.partial):
            f = f.func
        # unwrap decorator chains
        f = inspect.unwrap(f)
        # unwrap callable objects to their __call__
        if not (inspect.isfunction(f) or inspect.ismethod(f)) and hasattr(f, "__call__"):
            return unwrap(f.__call__)
        return f

    f = unwrap(fn)
    return inspect.iscoroutinefunction(f)