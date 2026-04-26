import json
from datetime import datetime
from decimal import Decimal

def make_json_safe(obj):
    if obj is None or isinstance(obj, (str, int, float, bool)):
        return obj

    if isinstance(obj, set):
        # convert to a stable, deterministic list
        return sorted(make_json_safe(v) for v in obj)

    if isinstance(obj, (list, tuple)):
        return [make_json_safe(v) for v in obj]

    if isinstance(obj, dict):
        return {str(k): make_json_safe(v) for k, v in obj.items()}

    if isinstance(obj, datetime):
        return obj.isoformat()

    if isinstance(obj, Decimal):
        return float(obj)

    # fallback for unknown/custom objects
    return str(obj)