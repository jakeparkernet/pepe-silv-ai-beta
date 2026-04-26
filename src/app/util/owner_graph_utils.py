from __future__ import annotations

from typing import Any, Dict, List, Tuple


def _dedupe_entities_by_name(entities: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    # Unique by exact name, case-sensitive (matches your existing rule).
    seen = set()
    out = []
    for e in entities or []:
        name = e.get("name")
        if not name or name in seen:
            continue
        seen.add(name)
        out.append({"name": name, "entity_type": e.get("entity_type", "ORG")})
    return out


def _dedupe_evidence(evidence: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    # Evidence objects unique by (excerpt, source)
    seen = set()
    out = []
    for ev in evidence or []:
        excerpt = ev.get("excerpt")
        source = ev.get("source")
        key = (excerpt, source)
        if key in seen:
            continue
        seen.add(key)
        out.append({"excerpt": excerpt, "source": source})
    return out


def build_alias_to_canonical_map(dedupe_output: Dict[str, Any]) -> Dict[str, str]:
    """
    From dedupe output:
    {
      "canonical_entities": [
         {"canonical_name": "...", "aliases": ["...", ...], ...},
         ...
      ]
    }
    Build a map alias -> canonical_name (including canonical -> canonical).
    """
    alias_to_canonical: Dict[str, str] = {}

    for ce in (dedupe_output.get("canonical_entities") or []):
        canonical = ce.get("canonical_name")
        if not canonical:
            continue
        alias_to_canonical[canonical] = canonical
        for a in (ce.get("aliases") or []):
            if a:
                alias_to_canonical[a] = canonical

    return alias_to_canonical


def project_graph_deterministic(
    *,
    input_graph: Dict[str, Any],
    dedupe_output: Dict[str, Any],
) -> Dict[str, Any]:
    """
    Deterministically projects a graph into the final structure:
      { "entities": [...], "relationships": [...] }

    Rules:
    - Rename entities/relationships using alias->canonical map.
    - Preserve all relationships except self-loops created by canonicalization.
    - Deduplicate relationships by (source_entity, target_entity, relation),
      merging evidence arrays and deduping evidence objects.
    - Entities are derived from:
        - input_graph.entities + any names referenced by relationships (after rewrite)
      then deduped by exact name.
    """
    alias_to_canonical = build_alias_to_canonical_map(dedupe_output)

    def canon(name: str) -> str:
        if not name:
            return name
        return alias_to_canonical.get(name, name)

    # --- Rewrite + keep relationships (except self-loops) ---
    merged: Dict[Tuple[str, str, str], Dict[str, Any]] = {}
    removed_self_loops: List[Dict[str, Any]] = []

    for r in (input_graph.get("relationships") or []):
        src = canon(r.get("source_entity", ""))
        tgt = canon(r.get("target_entity", ""))
        rel = r.get("relation", "")

        # Self-loop removal (the ONLY allowed drop)
        if src and tgt and src == tgt:
            removed_self_loops.append(r)
            continue

        key = (src, tgt, rel)
        existing = merged.get(key)
        if existing is None:
            merged[key] = {
                "source_entity": src,
                "target_entity": tgt,
                "relation": rel,
                "is_ownership": bool(r.get("is_ownership", False)),
                "evidence": list(r.get("evidence") or []),
            }
        else:
            # Merge evidence; preserve is_ownership conservatively as OR
            existing["is_ownership"] = bool(existing.get("is_ownership")) or bool(r.get("is_ownership", False))
            existing["evidence"].extend(list(r.get("evidence") or []))

    final_relationships: List[Dict[str, Any]] = []
    for r in merged.values():
        r["evidence"] = _dedupe_evidence(r.get("evidence") or [])
        final_relationships.append(r)

    # --- Build entities: start from input entities, rewrite names, add missing from rels ---
    rewritten_entities: List[Dict[str, Any]] = []
    for e in (input_graph.get("entities") or []):
        name = canon(e.get("name", ""))
        if not name:
            continue
        rewritten_entities.append({"name": name, "entity_type": e.get("entity_type", "ORG")})

    # Ensure all relationship endpoints exist as entities
    entity_types: Dict[str, str] = {e["name"]: e.get("entity_type", "ORG") for e in rewritten_entities}
    for r in final_relationships:
        for nm in (r.get("source_entity"), r.get("target_entity")):
            if nm and nm not in entity_types:
                entity_types[nm] = "ORG"

    final_entities = [{"name": n, "entity_type": t} for n, t in entity_types.items()]
    final_entities = _dedupe_entities_by_name(final_entities)

    return {
        "entities": final_entities,
        "relationships": final_relationships,
        # Optional: keep these for debugging/telemetry; omit if you want strict final shape only.
        # "debug_removed_self_loops": removed_self_loops,
    }
