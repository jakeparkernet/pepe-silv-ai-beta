from __future__ import annotations

import asyncio
import logging
import os
import signal
import subprocess
import time as time_module
from datetime import datetime
from typing import Any, Dict, List, Optional, Set, Tuple

from pydantic import PrivateAttr

from app.core.db.database_service import DatabaseService
from app.core.db.models import Entity
from app.core.jobs.job import Job
from app.core.jobs.job_status import JobStatus
from app.core.jobs.openrouter_cost import InvestigationFundingPaused, OpenrouterCost, _send_funding_notices
from app.util.common_owner_frontier import COMMON_OWNER_RULESET, serialize_common_owner_results
from app.util.get_value_safe import get_value_safe
from app.util.markers import returns_awaitable

logger = logging.getLogger(__name__)


def _get_supabase_service_client():
    from supabase import create_client

    url = os.getenv("SUPABASE_URL")
    service_role_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

    if not url:
        raise RuntimeError("SUPABASE_URL is not set")
    if not service_role_key:
        raise RuntimeError("SUPABASE_SERVICE_ROLE_KEY is not set")

    return create_client(url, service_role_key)


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


def _serialize_entity(entity: Any) -> Optional[Dict[str, Any]]:
    if entity is None:
        return None
    if hasattr(entity, "to_serializeable_object"):
        return entity.to_serializeable_object()
    if isinstance(entity, dict):
        return entity
    return None


def _collect_evidence_ids(obj: Any, out: Set[str]) -> None:
    if obj is None:
        return
    if isinstance(obj, dict):
        evidence_ids = obj.get("evidence_ids")
        if isinstance(evidence_ids, list):
            for evidence_id in evidence_ids:
                if evidence_id:
                    out.add(str(evidence_id))
        for value in obj.values():
            _collect_evidence_ids(value, out)
        return
    if isinstance(obj, list):
        for item in obj:
            _collect_evidence_ids(item, out)


@Job.register(name="company_pair_investigation")
class CompanyPairInvestigation(Job):
    requirements: Dict[str, Any] = {
        "cpu": 1,
        "net": 1,
    }

    label: str = "Company Pair Investigation"
    description: str = "Builds ownership trees for two companies and persists common influence results."

    _request_id: str = PrivateAttr(default="")
    _credit_reservation_id: Optional[str] = PrivateAttr(default=None)
    _credit_feature_enabled: bool = PrivateAttr(default=False)
    _start_time: float = PrivateAttr(default=0.0)
    _fly_io_cost_per_second: float = PrivateAttr(default=0.00001196)
    _max_depth: int = PrivateAttr(default=50)
    _entities: Dict[str, Entity] = PrivateAttr(default_factory=dict)
    _tree_outputs: Dict[str, Dict[str, Any]] = PrivateAttr(default_factory=dict)
    _search_sides: Dict[str, Dict[str, Any]] = PrivateAttr(default_factory=dict)
    _next_expansion_side: str = PrivateAttr(default="a")
    _active_level_side: Optional[str] = PrivateAttr(default=None)
    _active_level_ids: List[str] = PrivateAttr(default_factory=list)
    _active_level_index: int = PrivateAttr(default=0)

    async def run(self, platform: str):
        await super().run(platform)

        self._start_time = time_module.time()
        OpenrouterCost.get_instance().reset()

        self._request_id = str(self.input.get("request_id") or "")
        self._credit_reservation_id = self.input.get("credit_reservation_id")
        if not self._request_id:
            self._fail_request("company_pair_investigation requires input.request_id")
            return

        try:
            self._credit_feature_enabled = self._is_feature_enabled("investigation_credits", False)
            self._fly_io_cost_per_second = self._get_money_setting("fly_io_cost_per_second", 0.00001196)
            self._max_depth = self._get_int_setting("company_pair_max_owner_depth", 50)
            self._mark_request({
                "status": "in-progress",
                "started_at": datetime.now().isoformat(),
                "machine_id": os.getenv("FLY_MACHINE_ID", "local"),
            })
            self._resolve_entity("a")
        except Exception as exc:
            self._fail_request(str(exc))

    def _get_company_input(self, side: str) -> Dict[str, str]:
        key = "company_a" if side == "a" else "company_b"
        raw = self.input.get(key) or {}
        return {
            "name": str(raw.get("name") or "").strip(),
            "context": str(raw.get("context") or "").strip(),
        }

    def _get_money_setting(self, key: str, fallback: float) -> float:
        try:
            supabase = _get_supabase_service_client()
            res = supabase.table("settings").select("value").eq("key", key).limit(1).execute()
            row = (res.data or [None])[0]
            if row is None:
                return fallback
            value = row.get("value")
            parsed = float(value)
            return parsed if parsed >= 0 else fallback
        except Exception:
            logger.warning("Failed to read money setting %s", key, exc_info=True)
            return fallback

    def _get_int_setting(self, key: str, fallback: int) -> int:
        try:
            supabase = _get_supabase_service_client()
            res = supabase.table("settings").select("value").eq("key", key).limit(1).execute()
            row = (res.data or [None])[0]
            if row is None:
                return fallback
            parsed = int(row.get("value"))
            return parsed if parsed > 0 else fallback
        except Exception:
            logger.warning("Failed to read integer setting %s", key, exc_info=True)
            return fallback

    def _is_feature_enabled(self, key: str, fallback: bool = False) -> bool:
        try:
            supabase = _get_supabase_service_client()
            res = supabase.table("site_feature_flags").select("enabled").eq("key", key).limit(1).execute()
            row = (res.data or [None])[0]
            if row is None:
                return fallback
            return bool(row.get("enabled"))
        except Exception:
            logger.warning("Failed to read feature flag %s", key, exc_info=True)
            return fallback

    def _mark_request(self, patch: Dict[str, Any]) -> None:
        patch = {
            **patch,
            "updated_at": datetime.now().isoformat(),
        }
        _get_supabase_service_client().table("company_pair_requests").update(patch).eq("id", self._request_id).execute()

    def on_credit_cost_updated(self) -> None:
        if self._update_costs_and_pause_if_needed():
            raise InvestigationFundingPaused("Investigation paused: more funding is required.")

    def _resolve_entity(self, side: str) -> None:
        company = self._get_company_input(side)
        if not company["name"]:
            self._fail_request(f"Missing company {side.upper()} name")
            return

        spec = {
            "type": "get_or_create_entity_job",
            "params": {
                "parent_id": self.id,
                "input": {
                    "name": company["name"],
                    "context": company["context"],
                    "entity_type": "ORG",
                    "tags": ["company_pair_search"],
                    "min_confidence": 0.95,
                },
                "metadata": {
                    "view_data": {
                        "note": f"resolve company {side.upper()}",
                        "nodeType": "get_or_create_entity",
                    }
                },
            },
        }

        self.create_child_job(
            child_label=f"resolve_company_{side}",
            spec=spec,
            on_complete=self.on_resolve_entity_complete_wrapper(side),
        )

    def on_resolve_entity_complete_wrapper(self, side: str):
        @returns_awaitable
        def _wrapper(job):
            return self.on_resolve_entity_complete(side, job)

        return _wrapper

    async def on_resolve_entity_complete(self, side: str, job):
        try:
            entity = _entity_from_any(get_value_safe(job, "output", {}).get("result"))
            if entity is None:
                self._fail_request(f"Could not resolve company {side.upper()}")
                return

            self._entities[side] = entity
            self._mark_request({
                f"company_{side}_entity_id": entity.id,
            })
            if self._update_costs_and_pause_if_needed():
                return

            if side == "a":
                self._resolve_entity("b")
                return

            self._start_frontier_search()
        except Exception as exc:
            self._fail_request(str(exc))

    def _start_frontier_search(self) -> None:
        entity_a = self._entities.get("a")
        entity_b = self._entities.get("b")
        if entity_a is None or entity_b is None:
            self._fail_request("Both entities must resolve before common-owner search")
            return

        self._search_sides = {
            "a": self._make_search_side(entity_a),
            "b": self._make_search_side(entity_b),
        }
        self._next_expansion_side = "a"
        self._continue_frontier_search()

    def _make_search_side(self, root_entity: Entity) -> Dict[str, Any]:
        root_id = str(root_entity.id)
        return {
            "root_entity": root_entity,
            "root_id": root_id,
            "seen": {root_id},
            "distance": {root_id: 0},
            "entities": {root_id: root_entity},
            "relationships": {},
            "parent": {},
            "frontier": [root_id],
        }

    def _continue_frontier_search(self) -> None:
        terminal_common_ids = self._find_terminal_common_ids()
        if terminal_common_ids:
            self._finalize_from_frontier(terminal_common_ids, exhausted=False)
            return

        if not self._side_has_frontier("a") and not self._side_has_frontier("b"):
            self._finalize_from_frontier(set(), exhausted=True)
            return

        side = self._next_expansion_side
        if not self._side_has_frontier(side):
            side = "b" if side == "a" else "a"
        self._expand_side_level(side)

    def _side_has_frontier(self, side: str) -> bool:
        return len(self._search_sides.get(side, {}).get("frontier") or []) > 0

    def _expand_side_level(self, side: str) -> None:
        search_side = self._search_sides.get(side)
        if not search_side:
            self._fail_request(f"Missing search side {side}")
            return

        self._active_level_side = side
        self._active_level_ids = list(search_side.get("frontier") or [])
        self._active_level_index = 0
        search_side["frontier"] = []
        self._process_next_level_entity()

    def _process_next_level_entity(self) -> None:
        side = self._active_level_side
        if side is None:
            self._continue_frontier_search()
            return

        search_side = self._search_sides.get(side)
        if not search_side:
            self._fail_request(f"Missing active search side {side}")
            return

        while self._active_level_index < len(self._active_level_ids):
            entity_id = self._active_level_ids[self._active_level_index]
            self._active_level_index += 1

            depth = int(search_side.get("distance", {}).get(entity_id, 0))
            if depth >= self._max_depth:
                continue

            entity = search_side.get("entities", {}).get(entity_id)
            if entity is None:
                continue
            if bool(getattr(entity, "top_dog", False)) and entity_id != search_side.get("root_id"):
                continue

            spec = {
                "type": "find_owners_llm",
                "params": {
                    "parent_id": self.id,
                    "input": {
                        "entity": entity.to_serializeable_object(),
                    },
                    "metadata": {
                        "view_data": {
                            "note": f"expand company {side.upper()} owner frontier",
                            "nodeType": "find_owners",
                        }
                    },
                },
            }

            self.create_child_job(
                child_label=f"expand_company_{side}_owner_frontier_{entity_id}",
                spec=spec,
                on_complete=self.on_frontier_owners_found_wrapper(side, entity_id),
            )
            return

        self._complete_side_level(side)

    def on_frontier_owners_found_wrapper(self, side: str, entity_id: str):
        @returns_awaitable
        def _wrapper(job):
            return self.on_frontier_owners_found(side, entity_id, job)

        return _wrapper

    async def on_frontier_owners_found(self, side: str, entity_id: str, job):
        try:
            await self._record_frontier_owner_results(side, entity_id, get_value_safe(job, "output", {}) or {})
            if self._update_costs_and_pause_if_needed():
                return
            self._process_next_level_entity()
        except Exception as exc:
            self._fail_request(str(exc))

    async def _record_frontier_owner_results(self, side: str, entity_id: str, owners_output: Dict[str, Any]) -> None:
        search_side = self._search_sides.get(side)
        if not search_side:
            return

        owner_entities_by_id: Dict[str, Entity] = {}
        for entity_raw in owners_output.get("entities", []) or []:
            owner_entity = _entity_from_any(entity_raw)
            if owner_entity is None or owner_entity.entity_type != "ORG" or not owner_entity.id:
                continue
            owner_entities_by_id[owner_entity.id] = owner_entity

        service = DatabaseService.get()
        for relationship_raw in owners_output.get("relationships", []) or []:
            source_id = self._get_relationship_source_id(relationship_raw)
            target_id = self._get_relationship_target_id(relationship_raw)
            relationship_id = self._get_relationship_id(relationship_raw)

            if not source_id or not target_id or target_id != entity_id:
                continue
            if relationship_id:
                search_side["relationships"][relationship_id] = relationship_raw
            if source_id in search_side["seen"]:
                continue

            owner_entity = owner_entities_by_id.get(source_id)
            if owner_entity is None:
                owner_entity = await service.get_entity(source_id)
            if owner_entity is None or owner_entity.entity_type != "ORG":
                continue

            search_side["seen"].add(source_id)
            search_side["distance"][source_id] = int(search_side["distance"].get(entity_id, 0)) + 1
            search_side["entities"][source_id] = owner_entity
            search_side["parent"][source_id] = (entity_id, relationship_raw)
            search_side["frontier"].append(source_id)

    def _complete_side_level(self, side: str) -> None:
        self._active_level_side = None
        self._active_level_ids = []
        self._active_level_index = 0

        terminal_common_ids = self._find_terminal_common_ids()
        if terminal_common_ids:
            self._finalize_from_frontier(terminal_common_ids, exhausted=False)
            return

        self._next_expansion_side = "b" if side == "a" else "a"
        self._continue_frontier_search()

    def _find_terminal_common_ids(self) -> Set[str]:
        side_a = self._search_sides.get("a") or {}
        side_b = self._search_sides.get("b") or {}
        seen_a = set(side_a.get("seen") or set())
        seen_b = set(side_b.get("seen") or set())
        root_a = side_a.get("root_id")
        root_b = side_b.get("root_id")
        return (seen_a - {root_a}) & (seen_b - {root_b})

    def _get_relationship_id(self, relationship: Any) -> Optional[str]:
        relationship_id = get_value_safe(relationship, "id", None)
        return str(relationship_id) if relationship_id else None

    def _get_relationship_source_id(self, relationship: Any) -> Optional[str]:
        source_id = get_value_safe(relationship, "source_entity_id", None) or get_value_safe(relationship, "source", None)
        return str(source_id) if source_id else None

    def _get_relationship_target_id(self, relationship: Any) -> Optional[str]:
        target_id = get_value_safe(relationship, "target_entity_id", None) or get_value_safe(relationship, "target", None)
        return str(target_id) if target_id else None

    def _path_ids_to_root(self, search_side: Dict[str, Any], owner_id: str) -> Tuple[Set[str], Dict[str, Any]]:
        entity_ids: Set[str] = set()
        relationships: Dict[str, Any] = {}
        current_id = owner_id
        root_id = search_side.get("root_id")

        while current_id != root_id:
            parent_info = search_side.get("parent", {}).get(current_id)
            if parent_info is None:
                break
            child_id, relationship = parent_info
            entity_ids.add(current_id)
            relationship_id = self._get_relationship_id(relationship)
            if relationship_id:
                relationships[relationship_id] = relationship
            current_id = child_id

        return entity_ids, relationships

    def _build_side_tree(self, side: str, terminal_common_ids: Set[str]) -> Dict[str, Any]:
        search_side = self._search_sides.get(side) or {}
        owner_entities: Dict[str, Any] = {}
        relationships: Dict[str, Any] = {}
        root_id = search_side.get("root_id")

        if terminal_common_ids:
            for common_id in terminal_common_ids:
                path_entity_ids, path_relationships = self._path_ids_to_root(search_side, common_id)
                for entity_id in path_entity_ids:
                    if entity_id != root_id and entity_id in search_side.get("entities", {}):
                        owner_entities[entity_id] = search_side["entities"][entity_id]
                relationships.update(path_relationships)
        else:
            for entity_id, entity in (search_side.get("entities") or {}).items():
                if entity_id != root_id:
                    owner_entities[entity_id] = entity
            relationships.update(search_side.get("relationships") or {})

        return {
            "target_entity": search_side.get("root_entity"),
            "owner_entities": owner_entities,
            "relationships": relationships,
        }

    def _finalize_from_frontier(self, terminal_common_ids: Set[str], exhausted: bool) -> None:
        common_owner_results = self._serialize_frontier_results(terminal_common_ids, exhausted)
        asyncio.create_task(self._finalize(common_owner_results))

    def _serialize_frontier_results(self, terminal_common_ids: Set[str], exhausted: bool) -> Dict[str, Any]:
        entity_a = self._entities.get("a")
        entity_b = self._entities.get("b")
        a_tree = self._build_side_tree("a", terminal_common_ids)
        b_tree = self._build_side_tree("b", terminal_common_ids)

        relationships = dict(a_tree.get("relationships") or {})
        relationships.update(b_tree.get("relationships") or {})
        owner_entities = dict(a_tree.get("owner_entities") or {})
        owner_entities.update(b_tree.get("owner_entities") or {})
        common_owners = {
            owner_id: owner_entities[owner_id]
            for owner_id in terminal_common_ids
            if owner_id in owner_entities
        }

        results = {
            "entity_a": entity_a,
            "entity_b": entity_b,
            "a_ownership_tree": a_tree,
            "b_ownership_tree": b_tree,
            "relationships": relationships,
            "owner_entities": owner_entities,
            "common_owners": common_owners,
            "metadata": {
                "common_owner_ruleset": COMMON_OWNER_RULESET,
                "common_owner_strategy": "paired owner frontier; terminal common owners are not expanded",
                "max_depth": self._max_depth,
                "terminal_common_owner_ids": sorted(terminal_common_ids),
                "terminal_depth_a": min(
                    [self._search_sides["a"]["distance"].get(owner_id, self._max_depth + 1) for owner_id in terminal_common_ids],
                    default=None,
                ),
                "terminal_depth_b": min(
                    [self._search_sides["b"]["distance"].get(owner_id, self._max_depth + 1) for owner_id in terminal_common_ids],
                    default=None,
                ),
                "exhausted": exhausted,
                "created_at": datetime.now().isoformat(),
            },
        }
        return serialize_common_owner_results(results)

    def _build_tree(self, side: str) -> None:
        entity = self._entities.get(side)
        if entity is None:
            self._fail_request(f"Cannot build tree before company {side.upper()} resolves")
            return

        spec = {
            "type": "build_entity_ownership_tree",
            "params": {
                "parent_id": self.id,
                "input": {
                    "entity": entity.to_serializeable_object(),
                },
                "metadata": {
                    "view_data": {
                        "note": f"build ownership tree for company {side.upper()}",
                        "nodeType": "build_entity_ownership_tree",
                    }
                },
            },
        }

        self.create_child_job(
            child_label=f"build_company_{side}_ownership_tree",
            spec=spec,
            on_complete=self.on_build_tree_complete_wrapper(side),
        )

    def on_build_tree_complete_wrapper(self, side: str):
        @returns_awaitable
        def _wrapper(job):
            return self.on_build_tree_complete(side, job)

        return _wrapper

    async def on_build_tree_complete(self, side: str, job):
        try:
            self._tree_outputs[side] = get_value_safe(job, "output", {}) or {}
            if self._update_costs_and_pause_if_needed():
                return

            if side == "a":
                self._build_tree("b")
                return

            service = DatabaseService.get()
            common_owner_results = serialize_common_owner_results(
                await service.find_common_owners_between_entities(
                    self._entities.get("a"),
                    self._entities.get("b"),
                    max_depth=self._max_depth,
                )
            )
            await self._finalize(common_owner_results)
        except Exception as exc:
            self._fail_request(str(exc))

    async def _finalize(self, common_owner_results: Dict[str, Any]):
        service = DatabaseService.get()
        entity_a = self._entities.get("a")
        entity_b = self._entities.get("b")
        if entity_a is None or entity_b is None:
            self._fail_request("Both entities must be resolved before finalizing")
            return

        common_owners = common_owner_results.get("common_owners") or {}
        top_owner = next(iter(common_owners.values()), None)

        entity_a_obj = _serialize_entity(entity_a)
        entity_b_obj = _serialize_entity(entity_b)
        top_owner_name = top_owner.get("name") if isinstance(top_owner, dict) else None
        if top_owner_name:
            summary = f"{top_owner_name} owns or influences both {entity_a.name} and {entity_b.name}"
        else:
            summary = f"No common owner found between {entity_a.name} and {entity_b.name}"

        investigation_data = {
            "mode": "company_pair",
            "article_subject": entity_a_obj,
            "news_site": entity_b_obj,
            "company_a": entity_a_obj,
            "company_b": entity_b_obj,
            "common_owner_results": common_owner_results,
            "final_ranking": {
                "entities": common_owners,
                "ranking": list(common_owners.keys()),
            },
            "top_owner": top_owner,
        }

        evidence_ids: Set[str] = set()
        _collect_evidence_ids(investigation_data, evidence_ids)
        if evidence_ids:
            try:
                evidence_list = await service.get_evidence_batch(sorted(evidence_ids))
                investigation_data["evidence"] = [
                    evidence.to_serializeable_object()
                    for evidence in evidence_list or []
                    if evidence is not None
                ]
            except Exception:
                logger.warning("Failed to collect company pair evidence", exc_info=True)

        ownership_tree_id = self._persist_ownership_tree(
            company_a_id=entity_a.id,
            company_b_id=entity_b.id,
            ownership_tree=common_owner_results,
            investigation_data=investigation_data,
            summary=summary,
        )

        costs = self._calculate_costs()
        self._mark_request({
            "status": "complete",
            "ownership_tree_id": ownership_tree_id,
            "openrouter_cost": costs["openrouter_cost"],
            "fly_io_investigation_cost": costs["fly_io_investigation_cost"],
            "markup_cost": costs["markup_cost"],
            "total_cost": costs["total_cost"],
            "ended_at": datetime.now().isoformat(),
            "error": None,
        })
        if self._settle_credits(costs):
            return

        output = {
            "request_id": self._request_id,
            "ownership_tree_id": ownership_tree_id,
            "ownership_tree": common_owner_results,
            "investigation_data": investigation_data,
            "summary": summary,
            "costs": costs,
        }
        self._set_output(output)
        self.complete(output)
        self._shutdown_or_stop()

    def _persist_ownership_tree(
        self,
        *,
        company_a_id: str,
        company_b_id: str,
        ownership_tree: Dict[str, Any],
        investigation_data: Dict[str, Any],
        summary: str,
    ) -> str:
        supabase = _get_supabase_service_client()
        existing = supabase.table("ownership_trees").select("id, company_a, company_b").execute()
        ownership_tree_id = None
        for row in existing.data or []:
            a = row.get("company_a")
            b = row.get("company_b")
            if (a == company_a_id and b == company_b_id) or (a == company_b_id and b == company_a_id):
                ownership_tree_id = row["id"]
                break

        payload = {
            "company_a": company_a_id,
            "company_b": company_b_id,
            "ownership_tree": ownership_tree,
            "investigation_data": investigation_data,
            "summary": summary,
        }
        if ownership_tree_id is None:
            res = supabase.table("ownership_trees").insert(payload).execute()
            return res.data[0]["id"]

        supabase.table("ownership_trees").update(payload).eq("id", ownership_tree_id).execute()
        return ownership_tree_id

    def _calculate_costs(self) -> Dict[str, float]:
        openrouter_cost = float(OpenrouterCost.get_instance().get_cost() or 0)
        runtime_seconds = max(0, time_module.time() - self._start_time)
        fly_cost = runtime_seconds * self._fly_io_cost_per_second
        minimum = self._get_money_setting(
            "company_pair_minimum_credit_usd",
            self._get_money_setting("investigation_start_flat_cost_usd", 0.05),
        )
        total = openrouter_cost + fly_cost + minimum
        return {
            "openrouter_cost": openrouter_cost,
            "fly_io_investigation_cost": fly_cost,
            "markup_cost": minimum,
            "total_cost": total,
            "runtime_seconds": runtime_seconds,
        }

    def _settle_credits(self, costs: Dict[str, float]) -> bool:
        if self._credit_feature_enabled:
            if self._apply_shared_credit_usage():
                self._pause_request("Investigation paused: more funding is required.")
                return True
            return False

        if not self._credit_reservation_id:
            return False

        try:
            _get_supabase_service_client().rpc("settle_credit_reservation", {
                "p_reservation_id": self._credit_reservation_id,
                "p_actual_amount_usd": costs["total_cost"],
                "p_metadata": {
                    "request_id": self._request_id,
                    "openrouter_cost": costs["openrouter_cost"],
                    "fly_io_investigation_cost": costs["fly_io_investigation_cost"],
                    "markup_cost": costs["markup_cost"],
                },
            }).execute()
        except Exception:
            logger.warning("Failed to settle credit reservation", exc_info=True)
        return False

    def _apply_shared_credit_usage(self) -> bool:
        if not self._credit_feature_enabled or not self._request_id:
            return False

        try:
            res = _get_supabase_service_client().rpc("apply_company_pair_credit_usage", {
                "p_request_id": self._request_id,
            }).execute()
            rows = res.data if isinstance(res.data, list) else []
            row = rows[0] if rows else res.data
            if isinstance(row, dict) and row.get("paused") is True:
                return True
        except Exception:
            logger.warning("Failed to apply company-pair shared credit usage", exc_info=True)
        return False

    def _update_costs_and_pause_if_needed(self) -> bool:
        if not self._request_id:
            return False

        costs = self._calculate_costs()
        self._mark_request({
            "openrouter_cost": costs["openrouter_cost"],
            "fly_io_investigation_cost": costs["fly_io_investigation_cost"],
            "markup_cost": costs["markup_cost"],
            "total_cost": costs["total_cost"],
        })

        if self._apply_shared_credit_usage():
            self._pause_request("Investigation paused: more funding is required.")
            return True
        return False

    def _pause_request(self, message: str) -> None:
        logger.info("[COMPANY PAIR INVESTIGATION PAUSED] request_id=%s reason=%s", self._request_id, message)
        if self._request_id:
            try:
                costs = self._calculate_costs()
                self._mark_request({
                    "status": "paused",
                    "funding_status": "needs_funding",
                    "openrouter_cost": costs["openrouter_cost"],
                    "fly_io_investigation_cost": costs["fly_io_investigation_cost"],
                    "markup_cost": costs["markup_cost"],
                    "total_cost": costs["total_cost"],
                    "error": message,
                })
            except Exception:
                logger.warning("Failed to mark company pair request paused", exc_info=True)
        self._set_output({"status": "paused", "reason": message, "request_id": self._request_id})
        self._set_status(JobStatus.PAUSED)
        _send_funding_notices()
        self._shutdown_or_stop()

    def _release_credits(self, reason: str) -> None:
        if not self._credit_reservation_id:
            return

        try:
            _get_supabase_service_client().rpc("release_credit_reservation", {
                "p_reservation_id": self._credit_reservation_id,
                "p_metadata": {
                    "request_id": self._request_id,
                    "reason": reason,
                },
            }).execute()
        except Exception:
            logger.warning("Failed to release credit reservation", exc_info=True)

    def _fail_request(self, message: str) -> None:
        logger.error("[COMPANY PAIR INVESTIGATION FAILED] request_id=%s error=%s", self._request_id, message)
        if self._request_id:
            try:
                self._mark_request({
                    "status": "failed",
                    "error": message,
                    "ended_at": datetime.now().isoformat(),
                })
            except Exception:
                logger.warning("Failed to mark company pair request failed", exc_info=True)
        self._release_credits(message)
        self._set_output({"error": message, "request_id": self._request_id})
        self._set_status(JobStatus.FAILED)
        self.complete({"error": message})
        self._shutdown_or_stop()

    def _shutdown_or_stop(self):
        fly_machine_id = os.getenv("FLY_MACHINE_ID")
        if fly_machine_id and fly_machine_id != "local":
            try:
                result = subprocess.run(["which", "fly"], capture_output=True, text=True)
                if result.returncode != 0:
                    os.kill(os.getpid(), signal.SIGTERM)
                    return
                subprocess.run(["fly", "machine", "stop", fly_machine_id], check=True)
            except Exception:
                os.kill(os.getpid(), signal.SIGTERM)
        else:
            os.kill(os.getpid(), signal.SIGTERM)
