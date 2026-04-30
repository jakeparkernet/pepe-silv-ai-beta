from __future__ import annotations

from collections import deque
from datetime import datetime
from typing import Any, Awaitable, Callable, Dict, Iterable, List, Optional, Set, Tuple


COMMON_OWNER_RULESET = "first_mutual_frontier_v1"

EntityFetcher = Callable[[str], Awaitable[Any]]
RelationshipFetcher = Callable[[str], Awaitable[List[Any]]]


def get_obj_value(obj: Any, key: str, default: Any = None) -> Any:
    if isinstance(obj, dict):
        return obj.get(key, default)
    return getattr(obj, key, default)


def get_entity_id(entity: Any) -> Optional[str]:
    entity_id = get_obj_value(entity, "id")
    if entity_id is None:
        return None
    return str(entity_id)


def get_relationship_id(relationship: Any) -> Optional[str]:
    relationship_id = get_obj_value(relationship, "id")
    if relationship_id is None:
        return None
    return str(relationship_id)


def get_relationship_source_id(relationship: Any) -> Optional[str]:
    source_id = get_obj_value(relationship, "source_entity_id") or get_obj_value(relationship, "source")
    if source_id is None:
        return None
    return str(source_id)


def get_relationship_target_id(relationship: Any) -> Optional[str]:
    target_id = get_obj_value(relationship, "target_entity_id") or get_obj_value(relationship, "target")
    if target_id is None:
        return None
    return str(target_id)


def serialize_value(value: Any) -> Any:
    if hasattr(value, "to_serializeable_object"):
        return value.to_serializeable_object()
    return value


def serialize_dict_values(values: Dict[str, Any]) -> Dict[str, Any]:
    return {key: serialize_value(value) for key, value in values.items()}


def serialize_ownership_tree(tree: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "target_entity": serialize_value(tree.get("target_entity")),
        "owner_entities": serialize_dict_values(tree.get("owner_entities") or {}),
        "relationships": serialize_dict_values(tree.get("relationships") or {}),
    }


def serialize_common_owner_results(results: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "entity_a": serialize_value(results.get("entity_a")),
        "entity_b": serialize_value(results.get("entity_b")),
        "a_ownership_tree": serialize_ownership_tree(results.get("a_ownership_tree") or {}),
        "b_ownership_tree": serialize_ownership_tree(results.get("b_ownership_tree") or {}),
        "relationships": serialize_dict_values(results.get("relationships") or {}),
        "owner_entities": serialize_dict_values(results.get("owner_entities") or {}),
        "common_owners": serialize_dict_values(results.get("common_owners") or {}),
        "metadata": dict(results.get("metadata") or {}),
    }


def is_frontier_ruleset(results: Dict[str, Any]) -> bool:
    metadata = results.get("metadata") if isinstance(results, dict) else None
    if not isinstance(metadata, dict):
        return False
    return metadata.get("common_owner_ruleset") == COMMON_OWNER_RULESET


class _SideSearch:
    def __init__(self, root_entity: Any):
        root_id = get_entity_id(root_entity)
        if not root_id:
            raise ValueError("Root entity must have an id")

        self.root_entity = root_entity
        self.root_id = root_id
        self.seen: Set[str] = {root_id}
        self.distance: Dict[str, int] = {root_id: 0}
        self.entities: Dict[str, Any] = {root_id: root_entity}
        self.relationship_by_id: Dict[str, Any] = {}
        self.parent: Dict[str, Tuple[str, Any]] = {}
        self.frontier: deque[str] = deque([root_id])

    def has_frontier(self) -> bool:
        return len(self.frontier) > 0


async def _expand_one_level(
    side: _SideSearch,
    *,
    fetch_ownership_relationships: RelationshipFetcher,
    fetch_entity: EntityFetcher,
    max_depth: int,
    terminal_ids: Set[str],
) -> None:
    current_level_count = len(side.frontier)
    if current_level_count == 0:
        return

    for _ in range(current_level_count):
        entity_id = side.frontier.popleft()
        depth = side.distance.get(entity_id, 0)

        if depth >= max_depth:
            continue
        if entity_id in terminal_ids and entity_id != side.root_id:
            continue

        relationships = await fetch_ownership_relationships(entity_id) or []
        for relationship in relationships:
            source_id = get_relationship_source_id(relationship)
            target_id = get_relationship_target_id(relationship)
            relationship_id = get_relationship_id(relationship)

            if not source_id or not target_id or target_id != entity_id:
                continue
            if relationship_id:
                side.relationship_by_id.setdefault(relationship_id, relationship)

            if source_id in side.seen:
                continue

            owner_entity = await fetch_entity(source_id)
            if owner_entity is None:
                continue

            side.seen.add(source_id)
            side.distance[source_id] = depth + 1
            side.entities[source_id] = owner_entity
            side.parent[source_id] = (entity_id, relationship)
            side.frontier.append(source_id)


def _path_ids_to_root(side: _SideSearch, owner_id: str) -> Tuple[Set[str], Dict[str, Any]]:
    entity_ids: Set[str] = set()
    relationships: Dict[str, Any] = {}
    current_id = owner_id

    while current_id != side.root_id:
        parent_info = side.parent.get(current_id)
        if parent_info is None:
            break

        child_id, relationship = parent_info
        entity_ids.add(current_id)
        relationship_id = get_relationship_id(relationship)
        if relationship_id:
            relationships[relationship_id] = relationship
        current_id = child_id

    return entity_ids, relationships


def _build_pruned_side_tree(side: _SideSearch, terminal_common_ids: Iterable[str]) -> Dict[str, Any]:
    owner_entities: Dict[str, Any] = {}
    relationships: Dict[str, Any] = {}

    for common_id in terminal_common_ids:
        path_entity_ids, path_relationships = _path_ids_to_root(side, common_id)
        for entity_id in path_entity_ids:
            if entity_id != side.root_id and entity_id in side.entities:
                owner_entities[entity_id] = side.entities[entity_id]
        relationships.update(path_relationships)

    return {
        "target_entity": side.root_entity,
        "owner_entities": owner_entities,
        "relationships": relationships,
    }


def _common_seen_owner_ids(a_side: _SideSearch, b_side: _SideSearch) -> Set[str]:
    return (a_side.seen - {a_side.root_id}) & (b_side.seen - {b_side.root_id})


async def find_first_mutual_owner_frontier(
    *,
    entity_a: Any,
    entity_b: Any,
    fetch_ownership_relationships: RelationshipFetcher,
    fetch_entity: EntityFetcher,
    max_depth: int = 50,
) -> Dict[str, Any]:
    """
    Find the first mutual owner frontier between two entities.

    The search expands ownership parents breadth-first from both roots. As soon
    as one expansion creates at least one mutual owner, those owners become
    terminal. The returned graph contains only shortest connecting paths from
    each root to that terminal frontier, so parents above a mutual owner are not
    included.
    """
    a_side = _SideSearch(entity_a)
    b_side = _SideSearch(entity_b)
    terminal_common_ids: Set[str] = set()
    exhausted = False

    for depth in range(1, max_depth + 1):
        await _expand_one_level(
            a_side,
            fetch_ownership_relationships=fetch_ownership_relationships,
            fetch_entity=fetch_entity,
            max_depth=max_depth,
            terminal_ids=terminal_common_ids,
        )
        terminal_common_ids = _common_seen_owner_ids(a_side, b_side)
        if terminal_common_ids:
            break

        await _expand_one_level(
            b_side,
            fetch_ownership_relationships=fetch_ownership_relationships,
            fetch_entity=fetch_entity,
            max_depth=max_depth,
            terminal_ids=terminal_common_ids,
        )
        terminal_common_ids = _common_seen_owner_ids(a_side, b_side)
        if terminal_common_ids:
            break

        if not a_side.has_frontier() and not b_side.has_frontier():
            exhausted = True
            break
    else:
        exhausted = True

    a_tree = _build_pruned_side_tree(a_side, terminal_common_ids)
    b_tree = _build_pruned_side_tree(b_side, terminal_common_ids)

    relationships = dict(a_tree["relationships"])
    relationships.update(b_tree["relationships"])

    owner_entities = dict(a_tree["owner_entities"])
    owner_entities.update(b_tree["owner_entities"])

    common_owners = {
        owner_id: owner_entities[owner_id]
        for owner_id in terminal_common_ids
        if owner_id in owner_entities
    }

    return {
        "entity_a": entity_a,
        "entity_b": entity_b,
        "a_ownership_tree": a_tree,
        "b_ownership_tree": b_tree,
        "relationships": relationships,
        "owner_entities": owner_entities,
        "common_owners": common_owners,
        "metadata": {
            "common_owner_ruleset": COMMON_OWNER_RULESET,
            "common_owner_strategy": "first mutual owner frontier; terminal common owners are not expanded",
            "max_depth": max_depth,
            "terminal_common_owner_ids": sorted(terminal_common_ids),
            "terminal_depth_a": min(
                [a_side.distance.get(owner_id, max_depth + 1) for owner_id in terminal_common_ids],
                default=None,
            ),
            "terminal_depth_b": min(
                [b_side.distance.get(owner_id, max_depth + 1) for owner_id in terminal_common_ids],
                default=None,
            ),
            "exhausted": exhausted,
            "created_at": datetime.now().isoformat(),
        },
    }
