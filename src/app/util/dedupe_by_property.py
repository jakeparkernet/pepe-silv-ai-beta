def dedupe_by_property(items, property_name):
    seen = set()
    result = []

    for item in items:
        value = getattr(item, property_name, None) \
            if not isinstance(item, dict) \
            else item.get(property_name)

        if value not in seen:
            seen.add(value)
            result.append(item)

    return result
