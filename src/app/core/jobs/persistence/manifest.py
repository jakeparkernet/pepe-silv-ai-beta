import time
from typing import Dict, Optional
from .jsonl_store import atomic_write_json, read_json

MANIFEST_FILE = "manifest.json"

def save_manifest(session_id: str, high_water_marks: Dict[str, int]) -> None:
    rec = {
        "session_id": session_id,
        "created_at": read_json(session_id, MANIFEST_FILE).get("created_at") if read_json(session_id, MANIFEST_FILE) else time.time(),
        "checkpoint_ts": time.time(),
        "high_water_marks": high_water_marks,
    }
    atomic_write_json(session_id, MANIFEST_FILE, rec)

def load_manifest(session_id: str) -> Optional[Dict]:
    return read_json(session_id, MANIFEST_FILE)
