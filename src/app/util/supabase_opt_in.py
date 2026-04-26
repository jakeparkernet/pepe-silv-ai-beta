from __future__ import annotations

import json
import os
from typing import Optional


_TRUE_VALUES = {"1", "true", "t", "yes", "y", "on"}


def _is_true(value: Optional[str]) -> bool:
    if value is None:
        return False
    return value.strip().lower() in _TRUE_VALUES


def _fly_metadata_value(key: str) -> Optional[str]:
    direct_env_keys = (
        key,
        key.lower(),
        key.upper(),
        f"FLY_MACHINE_METADATA_{key.upper()}",
        f"FLY_METADATA_{key.upper()}",
    )
    for env_key in direct_env_keys:
        value = os.getenv(env_key)
        if value is not None:
            return value

    for metadata_env in ("FLY_MACHINE_METADATA", "FLY_METADATA"):
        raw_metadata = os.getenv(metadata_env)
        if not raw_metadata:
            continue
        try:
            payload = json.loads(raw_metadata)
        except Exception:
            continue
        if not isinstance(payload, dict):
            continue

        for candidate_key in (key, key.lower(), key.upper()):
            if candidate_key in payload:
                candidate_value = payload.get(candidate_key)
                if candidate_value is None:
                    return None
                return str(candidate_value)

    return None


def is_supabase_opted_in() -> bool:
    if os.getenv("FLY_MACHINE_ID"):
        return _is_true(_fly_metadata_value("log_to_supabase"))
    return _is_true(os.getenv("LOG_TO_SUPABASE"))


def is_supabase_sync_enabled() -> bool:
    if os.getenv("FLY_MACHINE_ID"):
        return _is_true(_fly_metadata_value("supabase_sync"))
    return _is_true(os.getenv("SUPABASE_SYNC"))
