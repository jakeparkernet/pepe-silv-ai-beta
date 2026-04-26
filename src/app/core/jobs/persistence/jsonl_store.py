import os, json, io
from pathlib import Path
from typing import Iterator, Optional, Tuple, Any
from app.util.json_friendly import json_friendly

def get_state_dir ():
    return os.environ.get("STATE_DIR", "./state")

def _session_dir(session_id: str) -> Path:
    p = Path(get_state_dir()) / "sessions" / session_id
    p.mkdir(parents=True, exist_ok=True)
    (p / "indexes").mkdir(parents=True, exist_ok=True)
    return p

def ensure_session_dirs(session_id: str) -> None:
    _session_dir(session_id)

def _path(session_id: str, name: str) -> Path:
    return _session_dir(session_id) / name

def append_jsonl(session_id: str, name: str, obj: dict) -> int:
    """Append one JSON object to a .jsonl file. Returns byte offset (start of line)."""
    path = _path(session_id, name)
    line = json.dumps(json_friendly(obj), separators=(",", ":")) + "\n"
    b = line.encode("utf-8")
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "ab", buffering=0) as f:
        offset = f.tell()
        f.write(b)
        f.flush()
        os.fsync(f.fileno())
    return offset

def iter_jsonl(session_id: str, name: str, start_offset: Optional[int] = None) -> Iterator[Tuple[int, dict]]:
    """Yield (offset, obj). Skips truncated/bad lines safely."""
    path = _path(session_id, name)
    if not path.exists():
        return
    with open(path, "rb") as f:
        if start_offset is not None:
            f.seek(start_offset)
        while True:
            off = f.tell()
            line = f.readline()
            if not line:
                break
            try:
                yield off, json.loads(line.decode("utf-8"))
            except Exception:
                # Truncated or malformed tail -> stop scanning
                break

def atomic_write_json(session_id: str, name: str, obj: Any) -> None:
    path = _path(session_id, name)
    tmp = str(path) + ".tmp"
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    with open(tmp, "wb") as f:
        f.write(json.dumps(obj, indent=2).encode("utf-8"))
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)

def read_json(session_id: str, name: str) -> Optional[dict]:
    path = _path(session_id, name)
    if not path.exists():
        return None
    with open(path, "rb") as f:
        return json.loads(f.read().decode("utf-8"))
