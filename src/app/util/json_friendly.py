import datetime

def json_friendly(value):
    """
    Recursively convert any object to a JSON-serializable form.
    - datetime/date → ISO string
    - Path, Enum, bytes, etc. → str()
    - dict/list/tuple → recurse
    - objects with __dict__ → recurse into vars()
    - anything else → str()
    """
    if value is None or isinstance(value, (bool, int, float, str)):
        return value

    # datetime and date
    if isinstance(value, (datetime.datetime, datetime.date)):
        return value.isoformat()

    # bytes → utf8 string or repr
    if isinstance(value, (bytes, bytearray)):
        try:
            return value.decode("utf-8")
        except Exception:
            return repr(value)

    # Path, Enum, etc. → str()
    if hasattr(value, "__fspath__") or isinstance(value, (complex,)):
        return str(value)
    if hasattr(value, "name") and not isinstance(value, dict):
        try:
            import enum
            if isinstance(value, enum.Enum):
                return value.name
        except ImportError:
            pass

    # dict
    if isinstance(value, dict):
        return {json_friendly(k): json_friendly(v) for k, v in value.items()}

    # list/tuple/set
    if isinstance(value, (list, tuple, set)):
        return [json_friendly(v) for v in value]

    # objects with __dict__
    if hasattr(value, "__dict__"):
        return json_friendly(vars(value))

    # fallback: string
    return str(value)
