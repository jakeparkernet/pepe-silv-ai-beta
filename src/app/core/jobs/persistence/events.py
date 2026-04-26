import time
from typing import Dict, List, Optional
from .jsonl_store import append_jsonl, iter_jsonl

EVENTS_FILE = "events.jsonl"

def _now() -> float:
    return time.time()

def append_event(session_id: str, job_id: str, seq: int, event_type: str, payload: Dict) -> None:
    rec = {
        "session_id": session_id, "job_id": job_id, "seq": seq, "ts": _now(),
        "event_type": event_type, "payload": payload
    }
    append_jsonl(session_id, EVENTS_FILE, rec)

def read_events_since(session_id: str, job_id: str, since_seq: int, limit: int = 1000) -> List[Dict]:
    out: List[Dict] = []
    for _, rec in iter_jsonl(session_id, EVENTS_FILE):
        if rec.get("job_id") == job_id and rec.get("seq", 0) > since_seq:
            out.append(rec)
            if len(out) >= limit:
                break
    return out

def read_events_range(session_id: str, job_id: str, from_seq: int, to_seq: int) -> List[Dict]:
    out: List[Dict] = []
    for _, rec in iter_jsonl(session_id, EVENTS_FILE):
        if rec.get("job_id") == job_id:
            s = rec.get("seq", 0)
            if from_seq <= s <= to_seq:
                out.append(rec)
    return out
