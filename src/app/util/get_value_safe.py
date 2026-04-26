def get_value_safe (obj, key, default_value):
    return_value = getattr(obj, key, None)

    if isinstance(obj, dict):
        return_value = obj.get(key, None)

    if return_value is not None:
        return return_value
    
    return default_value