def returns_awaitable(fn):
    """Mark a callable that *may* return an awaitable/coroutine object."""
    setattr(fn, "__returns_awaitable__", True)
    return fn