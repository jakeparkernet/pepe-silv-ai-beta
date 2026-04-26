def has_attribute(obj, attr_name):
    """
    Check if an object has an attribute with a specific name.
    Works with both regular objects (using hasattr) and dictionaries (checking keys).
    
    Args:
        obj: The object to check
        attr_name (str): The name of the attribute to look for
    
    Returns:
        bool: True if the attribute exists, False otherwise
    """
    if isinstance(obj, dict):
        return attr_name in obj
    else:
        return hasattr(obj, attr_name)