from __future__ import annotations

import asyncio
import logging
from collections import deque
from datetime import datetime
from typing import Any, Deque, Dict, List, Optional, Set

from fast_json_repair import loads
from pydantic import PrivateAttr

from app.core.db.database_service import DatabaseService
from app.core.db.models import Entity
from app.core.jobs.job import Job
from app.util.get_value_safe import get_value_safe
from app.util.markers import returns_awaitable

logger = logging.getLogger(__name__)


def _entity_from_any(raw: Any) -> Optional[Entity]:
    if raw is None:
        return None
    if isinstance(raw, Entity):
        return raw
    if isinstance(raw, dict):
        entity = Entity()
        entity.deserialize(raw)
        return entity
    return None


def _serialize_base_dict(base_dict: Dict[str, Any]) -> Dict[str, Any]:
    out: Dict[str, Any] = {}
    for key, value in base_dict.items():
        if hasattr(value, "to_serializeable_object"):
            out[key] = value.to_serializeable_object()
        elif isinstance(value, dict):
            out[key] = value
        else:
            out[key] = value
    return out


@Job.register(name="build_entity_ownership_tree")
class BuildEntityOwnershipTree(Job):
    requirements: Dict[str, Any] = {
        "cpu": 1,
        "net": 1,
    }

    label: str = "Build Entity Ownership Tree"
    description: str = "Build the recursive ownership tree for an entity."

    _queue: Deque[Entity] = PrivateAttr(default_factory=deque)
    _records: Dict[str, Dict[str, Any]] = PrivateAttr(default_factory=dict)
    _owner_entities: Dict[str, Entity] = PrivateAttr(default_factory=dict)
    _relationships: Dict[str, Any] = PrivateAttr(default_factory=dict)
    _terminal_entities: Dict[str, Dict[str, Any]] = PrivateAttr(default_factory=dict)
    _active_entity_id: Optional[str] = PrivateAttr(default=None)
    _root_entity: Optional[Entity] = PrivateAttr(default=None)
    _root_input_entity_id: Optional[str] = PrivateAttr(default=None)

    async def run(self, platform: str):
        await super().run(platform)

        entity = _entity_from_any(self.input.get("entity"))
        entity_id = self.input.get("entity_id")

        service = DatabaseService.get()

        if entity is None and entity_id:
            entity = await service.get_entity(entity_id)

        if entity is None:
            self.fail("build_entity_ownership_tree requires input.entity or input.entity_id")
            return

        if entity.entity_type != "ORG":
            self.fail(f"Entity must be ORG, got {entity.entity_type!r}")
            return

        self._root_entity = entity
        self._root_input_entity_id = entity.id

        self._enqueue_entity(entity)
        self._process_next()

    def update_handler(self, event):
        pass

    def _enqueue_entity(self, entity: Entity) -> None:
        if entity is None or entity.entity_type != "ORG" or not entity.id:
            return

        existing = self._records.get(entity.id)
        if existing and existing.get("status") in {
            "QUEUED",
            "EVALUATING",
            "IDENTIFYING",
            "IDENTIFIED",
            "IN_PROGRESS",
            "COMPLETE",
            "TERMINAL",
        }:
            return

        self._records[entity.id] = {
            "entity": entity,
            "status": "QUEUED",
        }
        self._queue.append(entity)

    def _process_next(self) -> None:
        if self._active_entity_id is not None:
            return

        while self._queue:
            entity = self._queue.popleft()
            record = self._records.get(entity.id)
            if record and record.get("status") in {"COMPLETE", "TERMINAL"}:
                continue

            self._active_entity_id = entity.id
            self._records[entity.id] = {
                "entity": entity,
                "status": "EVALUATING",
            }

            last_identification = entity.metadata.get("last_identification", {})
            if not last_identification:
                self._identify_entity(entity)
            else:
                self._find_owners(entity)
            return

        self._finalize()

    def _identify_entity(self, entity: Entity) -> None:
        self._records[entity.id] = {
            "entity": entity,
            "status": "IDENTIFYING",
        }

        identify_spec = {
            "type": "identify_company_from_name_multi",
            "params": {
                "parent_id": self.id,
                "input": {
                    "entity": entity.to_serializeable_object(),
                },
                "metadata": {
                    "view_data": {
                        "note": "identify ownership tree entity",
                        "nodeType": "identify",
                    }
                },
            },
        }

        self.create_child_job(
            child_label=f"identify ownership tree entity {entity.id}",
            spec=identify_spec,
            on_complete=self.on_identify_complete_wrapper,
            on_update=self.update_handler,
        )

    def _find_owners(self, entity: Entity) -> None:
        self._active_entity_id = entity.id
        self._records[entity.id] = {
            "entity": entity,
            "status": "IN_PROGRESS",
        }

        find_owners_spec = {
            "type": "find_owners_llm",
            "params": {
                "parent_id": self.id,
                "input": {
                    "entity": entity.to_serializeable_object(),
                },
                "metadata": {
                    "view_data": {
                        "note": "find owners for ownership tree",
                        "nodeType": "find_owners",
                    }
                },
            },
        }

        self.create_child_job(
            child_label=f"find ownership tree owners {entity.id}",
            spec=find_owners_spec,
            on_complete=self.on_owners_found_wrapper,
            on_update=self.update_handler,
        )

    @returns_awaitable
    def on_identify_complete_wrapper(self, identify_job):
        return self.on_identify_complete(identify_job)

    async def on_identify_complete(self, identify_job):
        result = get_value_safe(identify_job.output, "result", {}) or {}
        identified = _entity_from_any(result.get("entity"))
        if identified is None:
            self.fail("identify_company_from_name_multi returned no entity")
            return

        old_input_entity = get_value_safe(identify_job, "input", {}).get("entity")
        old_id = self._active_entity_id
        if old_id is None and isinstance(old_input_entity, dict):
            old_id = old_input_entity.get("id")
        if old_id and old_id != identified.id:
            self._records.pop(old_id, None)

        self._active_entity_id = identified.id
        self._records[identified.id] = {
            "entity": identified,
            "status": "IDENTIFIED",
        }

        if self._root_input_entity_id == old_id:
            self._root_entity = identified

        if identified.top_dog:
            self._records[identified.id]["status"] = "TERMINAL"
            self._terminal_entities[identified.id] = identified.to_serializeable_object()
            logger.info(
                "[build_entity_ownership_tree] terminal entity=%s id=%s",
                identified.name,
                identified.id,
            )
            self._active_entity_id = None
            self._process_next()
            return

        self._find_owners(identified)

    @returns_awaitable
    def on_owners_found_wrapper(self, owners_job):
        return self.on_owners_found(owners_job)

    async def on_owners_found(self, owners_job):
        owners_output = get_value_safe(owners_job, "output", {}) or {}
        target_entity = _entity_from_any(owners_output.get("target_entity"))
        if target_entity is None:
            target_entity = _entity_from_any(get_value_safe(owners_job, "input", {}).get("entity"))

        if target_entity is None:
            self.fail("find_owners_llm returned no target_entity")
            return

        self._records[target_entity.id] = {
            "entity": target_entity,
            "status": "COMPLETE",
        }

        if self._root_entity and self._root_entity.id == target_entity.id:
            self._root_entity = target_entity
        elif self._root_input_entity_id == target_entity.id:
            self._root_entity = target_entity

        for relationship_raw in owners_output.get("relationships", []) or []:
            relationship_id = get_value_safe(relationship_raw, "id", None)
            if relationship_id:
                self._relationships[str(relationship_id)] = relationship_raw

        discovered: List[Entity] = []
        for entity_raw in owners_output.get("entities", []) or []:
            owner_entity = _entity_from_any(entity_raw)
            if owner_entity is None:
                continue
            if owner_entity.entity_type != "ORG":
                continue
            if owner_entity.id == target_entity.id:
                continue

            self._owner_entities[owner_entity.id] = owner_entity

            last_owner_search = owner_entity.metadata.get("last_owner_search", """{"status":"none"}""")
            if isinstance(last_owner_search, str):
                try:
                    last_owner_search_obj = loads(last_owner_search)
                except Exception:
                    last_owner_search_obj = {"status": "none"}
            else:
                last_owner_search_obj = last_owner_search
            if not isinstance(last_owner_search_obj, dict):
                last_owner_search_obj = {"status": "none"}

            if last_owner_search_obj.get("status") != "complete":
                discovered.append(owner_entity)

        self._active_entity_id = None

        for owner_entity in discovered:
            self._enqueue_entity(owner_entity)

        self._process_next()

    async def _serialize_evidence(self, evidence_ids: List[str]) -> List[Dict[str, Any]]:
        if not evidence_ids:
            return []

        serialized: List[Dict[str, Any]] = []
        service = DatabaseService.get()

        try:
            evidence_list = await service.get_evidence_batch(evidence_ids)
            for evidence in evidence_list or []:
                if evidence:
                    serialized.append(evidence.to_serializeable_object())
        except Exception as exc:
            logger.warning("Failed to fetch evidence batch: %s", exc)

        return serialized

    def _collect_all_evidence_ids(self) -> List[str]:
        evidence_ids: Set[str] = set()

        if self._root_entity:
            evidence_ids.update(self._root_entity.evidence_ids or [])

        for rel in self._relationships.values():
            evidence_ids.update(get_value_safe(rel, "evidence_ids", []) or [])

        for ent in self._owner_entities.values():
            evidence_ids.update(ent.evidence_ids or [])

        return sorted(evidence_ids)

    def _finalize(self) -> None:
        asyncio.create_task(self._finalize_async())

    async def _finalize_async(self):
        root_entity = self._root_entity
        if root_entity is None and self._root_input_entity_id:
            root_entity = await DatabaseService.get().get_entity(self._root_input_entity_id)

        if root_entity is None:
            self.fail("Could not resolve root entity for final ownership tree output")
            return

        output = {
            "target_entity": root_entity.to_serializeable_object(),
            "owner_entities": _serialize_base_dict(self._owner_entities),
            "relationships": _serialize_base_dict(self._relationships),
            "traversal": {
                "completed_at": datetime.now().isoformat(),
                "processed_entities": sorted(
                    [
                        entity_id
                        for entity_id, record in self._records.items()
                        if record.get("status") in {"COMPLETE", "TERMINAL"}
                    ]
                ),
                "terminal_entities": self._terminal_entities,
            },
        }

        evidence_ids = self._collect_all_evidence_ids()
        output["evidence"] = await self._serialize_evidence(evidence_ids)

        self._set_output(output)
        self.complete(output)
