import time
from typing import Any, Dict, Optional, Tuple, List
from .jsonl_store import append_jsonl, iter_jsonl, read_json, atomic_write_json, ensure_session_dirs, json_friendly
from .merge_patch import diff_merge_patch, apply_merge_patch

SNAPSHOTS_FILE = "snapshots.jsonl"
INDEX_LAST_FULL = "indexes/job_last_full.json"   # { job_id: { "seq": int, "offset": int } }

def _now() -> float:
    return time.time()

def record_full_snapshot(session_id: str, job_id: str, seq: int, full_state: Dict, full_history: list) -> None:
    ensure_session_dirs(session_id)
    rec = {
        "session_id": session_id, "job_id": job_id, "seq": seq, "ts": _now(),
        "snapshot_type": "full",
        "full_state": full_state,
        "full_history": full_history,
        "prev_seq": None
    }
    rec = json_friendly(rec)
    offset = append_jsonl(session_id, SNAPSHOTS_FILE, rec)
    # Update last-full index
    idx = read_json(session_id, INDEX_LAST_FULL) or {}
    idx[job_id] = {"seq": seq, "offset": offset}
    atomic_write_json(session_id, INDEX_LAST_FULL, idx)

def record_patch_snapshot(session_id: str, job_id: str, seq: int, prev_seq: int, patch: Dict, history_append: list | None = None) -> None:
    rec = {
        "session_id": session_id, "job_id": job_id, "seq": seq, "ts": _now(),
        "snapshot_type": "merge_patch",
        "patch": patch,
        "prev_seq": prev_seq
    }
    if history_append:
        rec["history_append"] = history_append
    rec = json_friendly(rec)
    append_jsonl(session_id, SNAPSHOTS_FILE, rec)

def materialize_to_seq(session_id: str, job_id: str, target_seq: int) -> Optional[Dict]:
    idx = read_json(session_id, INDEX_LAST_FULL) or {}
    base_state = None
    base_history = []
    base_seq = -1
    start_offset = None

    if job_id in idx and idx[job_id]["seq"] <= target_seq:
        base_seq = idx[job_id]["seq"]
        start_offset = idx[job_id]["offset"]
        for off, rec in iter_jsonl(session_id, SNAPSHOTS_FILE, start_offset):
            if (rec.get("job_id") == job_id and
                rec.get("seq") == base_seq and
                rec.get("snapshot_type") == "full"):
                base_state = rec.get("full_state")
                base_history = rec.get("full_history", []) or []
                break

    if base_state is None:
        for _, rec in iter_jsonl(session_id, SNAPSHOTS_FILE, None):
            if rec.get("job_id") == job_id and rec.get("snapshot_type") == "full" and rec.get("seq", 0) <= target_seq:
                base_state = rec.get("full_state")
                base_history = rec.get("full_history", []) or []
                base_seq = rec["seq"]

    if base_state is None:
        return None

    state = base_state
    history = list(base_history)

    for _, rec in iter_jsonl(session_id, SNAPSHOTS_FILE, None):
        if rec.get("job_id") != job_id:
            continue
        s = rec.get("seq", 0)
        if s <= base_seq or s > target_seq:
            continue

        if rec.get("snapshot_type") == "merge_patch":
            state = apply_merge_patch(state, rec["patch"])
            if "history_append" in rec and rec["history_append"]:
                history.extend(rec["history_append"])
        elif rec.get("snapshot_type") == "full":
            state = rec.get("full_state")
            history = list(rec.get("full_history", []) or [])

    state_with_history = dict(state)
    state_with_history["history"] = history
    return state_with_history

def compute_patch(prev: Dict, nxt: Dict) -> Dict:
    return diff_merge_patch(prev, nxt)
