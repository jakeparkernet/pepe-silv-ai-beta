def find_key_values(obj, target_key):
    """Recursively find all values of target_key in a nested structure."""
    if isinstance(obj, dict):
        for k, v in obj.items():
            if k == target_key:
                yield v
            else:
                yield from find_key_values(v, target_key)
    elif isinstance(obj, list):
        for item in obj:
            yield from find_key_values(item, target_key)