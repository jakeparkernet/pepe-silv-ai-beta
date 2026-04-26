# edges.py
import time
from typing import Dict, List, Optional, Tuple
from .jsonl_store import append_jsonl, iter_jsonl, atomic_write_json, read_json

EDGES_FILE = "edges.jsonl"
# Lightweight secondary indexes for quick lookups
IDX_BY_DEDUPE = "indexes/edges_by_dedupe.json"     # { "<session_id>": { "<dedupe_key>": edge_rec } }
IDX_BY_LABEL  = "indexes/edges_by_label.json"      # { "<parent_id>": { "<child_label>": edge_rec } }

def _now() -> float:
    return time.time()

def _load_index(session_id: str, name: str) -> dict:
    idx = read_json(session_id, name) or {}
    # Scope session-specific maps if the file is shared by session
    if name == IDX_BY_DEDUPE:
        return idx if isinstance(idx, dict) else {}
    if name == IDX_BY_LABEL:
        return idx if isinstance(idx, dict) else {}
    return {}

def _write_index(session_id: str, name: str, obj: dict) -> None:
    atomic_write_json(session_id, name, obj)

def load_edges(session_id: str) -> List[Dict]:
    out: List[Dict] = []
    for _, rec in iter_jsonl(session_id, EDGES_FILE):
        if rec.get("session_id") == session_id:
            out.append(rec)
    return out

def _rebuild_indexes_if_empty(session_id: str) -> None:
    dedupe_idx = _load_index(session_id, IDX_BY_DEDUPE)
    label_idx  = _load_index(session_id, IDX_BY_LABEL)
    if dedupe_idx and label_idx:
        return
    dedupe_idx = {}
    label_idx = {}
    for _, rec in iter_jsonl(session_id, EDGES_FILE):
        if rec.get("session_id") != session_id:
            continue
        parent_id     = rec.get("parent_id")
        child_label   = rec.get("child_label")
        dedupe_key    = rec.get("dedupe_key")
        if dedupe_key:
            dedupe_idx[dedupe_key] = rec
        if parent_id and child_label:
            label_idx.setdefault(parent_id, {})[child_label] = rec
    _write_index(session_id, IDX_BY_DEDUPE, dedupe_idx)
    _write_index(session_id, IDX_BY_LABEL, label_idx)

def get_edge_by_dedupe(session_id: str, dedupe_key: str) -> Optional[Dict]:
    _rebuild_indexes_if_empty(session_id)
    idx = _load_index(session_id, IDX_BY_DEDUPE)
    return idx.get(dedupe_key)

def get_edge_by_label(parent_id: str, session_id: str, child_label: str) -> Optional[Dict]:
    _rebuild_indexes_if_empty(session_id)
    idx = _load_index(session_id, IDX_BY_LABEL)
    by_parent = idx.get(parent_id, {})
    return by_parent.get(child_label)

def _update_indexes(session_id: str, rec: Dict) -> None:
    dedupe_idx = _load_index(session_id, IDX_BY_DEDUPE)
    label_idx  = _load_index(session_id, IDX_BY_LABEL)
    if not isinstance(dedupe_idx, dict): dedupe_idx = {}
    if not isinstance(label_idx, dict): label_idx = {}
    if rec.get("dedupe_key"):
        dedupe_idx[rec["dedupe_key"]] = rec
    if rec.get("parent_id") and rec.get("child_label"):
        label_idx.setdefault(rec["parent_id"], {})[rec["child_label"]] = rec
    _write_index(session_id, IDX_BY_DEDUPE, dedupe_idx)
    _write_index(session_id, IDX_BY_LABEL, label_idx)

def append_edge(
    session_id: str,
    child_label: str,
    child_job_id: str,
    parent_id: str,
    child_type: str,
    dedupe_key: str,
    spec_min: dict,
    edge_type: str = "spawn"
) -> Tuple[Dict, bool]:
    """
    Append a parent->child edge with uniqueness constraints:
      - UNIQUE(session_id, dedupe_key)
      - UNIQUE(parent_id, child_label)

    Returns (edge_record, attached_existing: bool)
    """

    # Fast-path: check both uniqueness constraints
    existing_by_dedupe = get_edge_by_dedupe(session_id, dedupe_key)
    if existing_by_dedupe:
        return existing_by_dedupe, True  # attach to existing child

    existing_by_label = get_edge_by_label(parent_id, session_id, child_label)
    if existing_by_label:
        return existing_by_label, True  # label already claimed under parent

    rec = {
        "session_id": session_id,
        "parent_id": parent_id,
        "child_label": child_label,
        "child_job_id": child_job_id,
        "child_type": child_type,
        "dedupe_key": dedupe_key,
        "spec_min": spec_min,
        "edge_type": edge_type,
        "ts": _now(),
    }
    append_jsonl(session_id, EDGES_FILE, rec)
    _update_indexes(session_id, rec)
    return rec, False
