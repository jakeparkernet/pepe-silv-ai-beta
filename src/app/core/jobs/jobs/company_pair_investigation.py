from __future__ import annotations

import asyncio
import logging
import os
import signal
import subprocess
import time as time_module
from datetime import datetime
from typing import Any, Dict, Optional, Set

from pydantic import PrivateAttr

from app.core.db.database_service import DatabaseService
from app.core.db.models import Entity
from app.core.jobs.job import Job
from app.core.jobs.job_status import JobStatus
from app.core.jobs.openrouter_cost import OpenrouterCost
from app.util.common_owner_frontier import serialize_common_owner_results
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
    _start_time: float = PrivateAttr(default=0.0)
    _fly_io_cost_per_second: float = PrivateAttr(default=0.00001196)
    _entities: Dict[str, Entity] = PrivateAttr(default_factory=dict)
    _tree_outputs: Dict[str, Dict[str, Any]] = PrivateAttr(default_factory=dict)

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
            self._fly_io_cost_per_second = self._get_money_setting("fly_io_cost_per_second", 0.00001196)
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

    def _mark_request(self, patch: Dict[str, Any]) -> None:
        patch = {
            **patch,
            "updated_at": datetime.now().isoformat(),
        }
        _get_supabase_service_client().table("company_pair_requests").update(patch).eq("id", self._request_id).execute()

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

            if side == "a":
                self._resolve_entity("b")
                return

            self._build_tree("a")
        except Exception as exc:
            self._fail_request(str(exc))

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

            if side == "a":
                self._build_tree("b")
                return

            await self._finalize()
        except Exception as exc:
            self._fail_request(str(exc))

    async def _finalize(self):
        service = DatabaseService.get()
        entity_a = self._entities.get("a")
        entity_b = self._entities.get("b")
        if entity_a is None or entity_b is None:
            self._fail_request("Both entities must be resolved before finalizing")
            return

        common_owner_data = await service.find_common_owners_between_entities(entity_a, entity_b)
        common_owner_results = serialize_common_owner_results(common_owner_data)
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
        self._settle_credits(costs)
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
        markup = self._get_money_setting("company_pair_markup_usd", 2.0)
        total = openrouter_cost + fly_cost + markup
        return {
            "openrouter_cost": openrouter_cost,
            "fly_io_investigation_cost": fly_cost,
            "markup_cost": markup,
            "total_cost": total,
            "runtime_seconds": runtime_seconds,
        }

    def _settle_credits(self, costs: Dict[str, float]) -> None:
        if not self._credit_reservation_id:
            return

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
