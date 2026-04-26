from __future__ import annotations

import json
import os
from typing import Optional

_BACKENDS = {"supabase", "s3", "none"}


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


def get_sync_backend() -> str:
    env_val = os.getenv("SYNC_BACKEND")
    if env_val:
        return env_val.lower()
    if os.getenv("FLY_MACHINE_ID"):
        metadata_val = _fly_metadata_value("sync_backend")
        if metadata_val:
            return metadata_val.lower()
    return "none"


def get_log_forwarder_backend() -> str:
    env_val = os.getenv("LOG_FORWARDER_BACKEND")
    if env_val:
        return env_val.lower()
    if os.getenv("FLY_MACHINE_ID"):
        metadata_val = _fly_metadata_value("log_forwarder_backend")
        if metadata_val:
            return metadata_val.lower()
    return "none"


def get_machine_id() -> str:
    return os.getenv("FLY_MACHINE_ID", "local")