# app/util/build_load_order_from_child_jobs.py
from __future__ import annotations
from typing import List, Dict, Any, Tuple
from app.core.jobs.persistence.edges import load_edges

def _build_graph(
    states: List[Dict[str, Any]],
    edges: List[Dict[str, Any]]
) -> Tuple[
    Dict[str, Dict[str, Any]],   # id → state
    Dict[str, List[Tuple[str, str]]],  # parent_id → [(label, child_id), …]
    set                          # all ids that appear as a child
]:
    """Create the lookup tables using edges for relationships."""
    id_to_state = {s["id"]: s for s in states}
    parent_to_children: Dict[str, List[Tuple[str, str]]] = {}
    children_set: set = set()

    for edge in edges:
        parent_id = edge.get("parent_id")
        child_label = edge.get("child_label", "")
        child_id = edge.get("child_job_id")
        if parent_id and child_id in id_to_state:
            parent_to_children.setdefault(parent_id, []).append((child_label, child_id))
            children_set.add(child_id)

    # Fallback: If no edges, reconstruct from parent_id (without labels)
    if not parent_to_children:
        for state in states:
            job_id = state["id"]
            parent_id = state.get("parent_id")
            if parent_id and parent_id != job_id and parent_id in id_to_state:
                label = state.get("label", f"unnamed_{job_id}")
                parent_to_children.setdefault(parent_id, []).append((label, job_id))
                children_set.add(job_id)

    return id_to_state, parent_to_children, children_set

def _dfs_postorder(
    job_id: str,
    parent_to_children: Dict[str, List[Tuple[str, str]]],
    visited: set,
    order: List[str],
) -> None:
    """Depth-first post-order: visit children before the parent."""
    if job_id in visited:
        return  # cycle guard
    visited.add(job_id)
    for _, child_id in parent_to_children.get(job_id, []):
        _dfs_postorder(child_id, parent_to_children, visited, order)
    order.append(job_id)

def build_load_order_from_child_jobs(
    states: List[Dict[str, Any]],
    session_id: str
) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    """
    Updated to build graph and tree from persistent edges (primary) or parent_id (fallback).
    This ensures the tree is reconstructed correctly even if child_jobs is empty/missing.
    Falls back to parent_id with synthetic labels if no edges found.
    Load order is leaf-first (children before parents).
    """
    if not states:
        return [], {}

    edges = load_edges(session_id)
    id_to_state, parent_to_children, children_set = _build_graph(states, edges)
    all_ids = set(id_to_state.keys())

    # --------------------------------------------------------------
    # 1. Leaf-first load order (post-order without reverse = leaves first)
    # --------------------------------------------------------------
    visited: set = set()
    post_order: List[str] = []

    # Roots = jobs not appearing as children (includes self-parents and orphans)
    roots = set()
    orphans = set()

    for jid in all_ids:
        state = id_to_state[jid]
        parent_id = state.get("parent_id")

        # 1. Self-parent = explicit root (your "Test_root")
        if parent_id == jid:
            roots.add(jid)

        # 3. Not a child of anyone = potential orphan root
        elif jid not in children_set:
            orphans.add(jid)

    # Final roots = explicit roots + orphans (but NOT leaves)
    roots = roots.union(orphans)
    roots = list(roots)

    for root_id in roots:
        _dfs_postorder(root_id, parent_to_children, visited, post_order)

    for orphan_id in all_ids - visited:
        _dfs_postorder(orphan_id, parent_to_children, visited, post_order)

    load_order_ids = post_order
    load_order = [id_to_state[jid] for jid in load_order_ids if jid in id_to_state]

    # --------------------------------------------------------------
    # 2. Build nested tree (CYCLE-SAFE)
    # --------------------------------------------------------------
    def build_node(job_id: str, visited: set | None = None) -> Dict[str, Any]:
        if visited is None:
            visited = set()

        if job_id in visited:
            print(f"Cycle detected in job tree at job_id={job_id}. Breaking link.")
            return {
                "state": {"id": job_id, "label": "CYCLE", "status": "ERROR"},
                "children": {}
            }

        visited.add(job_id)
        state = id_to_state[job_id]
        children_dict: Dict[str, Any] = {}

        for label, child_id in parent_to_children.get(job_id, []):
            if child_id == job_id:
                continue
            children_dict[child_id] = build_node(child_id, visited)

        visited.remove(job_id)
        return {"state": state, "children": children_dict}

    tree: Dict[str, Any] = {}
    for root_id in roots:
        tree[root_id] = build_node(root_id, visited=set())

    # Orphans that were not attached to any root
    for orphan_id in all_ids - visited - set(roots):
        tree[orphan_id] = build_node(orphan_id)

    print("ROOTS:", roots)
    print("TREE KEYS:", list(tree.keys()))

    return load_order, tree