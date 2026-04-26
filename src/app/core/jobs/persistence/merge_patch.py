# Minimal RFC 7386 JSON Merge Patch utilities (dict-focused)
from copy import deepcopy
from typing import Any, Dict

def _is_primitive(x: Any) -> bool:
    return not isinstance(x, (dict, list))

def diff_merge_patch(src: Dict, dst: Dict) -> Dict:
    """Compute merge-patch to turn src into dst."""
    patch: Dict = {}
    src_keys = set(src.keys())
    dst_keys = set(dst.keys())
    for k in dst_keys:
        if k not in src:
            patch[k] = dst[k]
        else:
            sv, dv = src[k], dst[k]
            if isinstance(sv, dict) and isinstance(dv, dict):
                sub = diff_merge_patch(sv, dv)
                if sub:
                    patch[k] = sub
            elif sv != dv:
                patch[k] = dv
    for k in src_keys - dst_keys:
        patch[k] = None
    return patch

def apply_merge_patch(doc: Dict, patch: Dict) -> Dict:
    """Apply merge-patch to a JSON object and return a new object."""
    out = deepcopy(doc)
    for k, v in patch.items():
        if v is None:
            out.pop(k, None)
        elif isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = apply_merge_patch(out[k], v)
        else:
            out[k] = v
    return out
