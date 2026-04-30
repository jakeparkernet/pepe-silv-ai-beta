# store a set of owners found
# make sure the same other isn't added twice in find_owners
# also make sure the owners are finally merged in find_owners
# store each other in the set
# only recursively search for owners until a common owner is found
#  which means every time an owner is added, we do the common owner check
# afterward, add an identification job to identify a website and add a new news site
# then, fully async/callback find_owners and investigation_job flow
import asyncio
import json
import os
import requests
import signal
import subprocess
import threading
import queue
from types import SimpleNamespace
from uuid import uuid4
from collections import deque
from time import sleep
import time as time_module
from datetime import datetime
from typing import Any, Dict, List, Optional, Deque, Set, Tuple, Callable
from app.core.jobs.job import Job
from app.core.jobs.jobs.llm_callback_job import LlmCallbackJob
from app.core.jobs.job_status import JobStatus
from app.core.jobs.openrouter_cost import OpenrouterCost
from app.edge.edge_runner_factory import get_edge_runner
from app.functions.clean_brave_results import clean_results
from app.core.runtime.job_batcher import get_batcher
from app.core.db.database_service import DatabaseService
from app.core.db.models import Evidence, Relationship, Entity
from pydantic import PrivateAttr
from concurrent.futures import ThreadPoolExecutor, as_completed
from app.config import NetConfig
from app.util.common_owner_frontier import COMMON_OWNER_RULESET
from app.util.markers import returns_awaitable
from app.util.get_value_safe import get_value_safe
from urllib.parse import urlsplit, urlunsplit
import re
from fast_json_repair import loads
import logging

logger = logging.getLogger(__name__)

@Job.register(name="investigation")
class InvestigationJob(Job):
    
    _base_url: str = PrivateAttr(default="")
    _json_headers: dict = PrivateAttr(default_factory=lambda: {"Content-Type": "application/json"})
    _url: str = PrivateAttr(default="")
    
    requirements: Dict[str, Any] = {
        "cpu": 1,
        "net": 1
    }

    label: str = "Investigation"
    description: str = "Investigates a news article"

    _final_output_obj: Dict[Any, Any] = PrivateAttr(default_factory=lambda:{})

    _start_time: float = PrivateAttr(default=0.0)

    _fly_io_cost_per_second: float = PrivateAttr(default=0.00001196)

    _entities: Dict[str, Any] = PrivateAttr(default_factory=lambda:{})
    _seed_entity_id_by_side: Dict[str, str] = PrivateAttr(default_factory=dict)

    _NEWS_SIDE: str = PrivateAttr(default="news_site")
    _SUBJECT_SIDE: str = PrivateAttr(default="article_subject")

    _TWO_PART_SUFFIXES = {
        "co.uk", "org.uk", "ac.uk", "com.au", "net.au", "org.au",
        "co.nz", "org.nz", "co.jp",
    }

    _queue_url_key: str = PrivateAttr(default="")

    _prefetched_scrape_result: Optional[Dict[str, Any]] = PrivateAttr(default=None)
    _prefetched_site_data: Optional[Dict[str, Any]] = PrivateAttr(default=None)
    _prefetched_companies: List[Dict[str, Any]] = PrivateAttr(default_factory=list)
    _prefetched_domain: Optional[str] = PrivateAttr(default=None)
    _prefetched_applicability_result: Optional[Dict[str, Any]] = PrivateAttr(default=None)
    _prefetched_article_subject_entity: Optional[Dict[str, Any]] = PrivateAttr(default=None)

    _side_queues: Dict[str, Deque[List[str]]] = PrivateAttr(default_factory=lambda: {
        "news_site": deque(),
        "article_subject": deque(),
    })
    _side_pending_next: Dict[str, Dict[str, Entity]] = PrivateAttr(default_factory=lambda: {
        "news_site": {},
        "article_subject": {},
    })

    _active_side: Optional[str] = PrivateAttr(default=None)
    _active_batch_token: Optional[int] = PrivateAttr(default=None)
    _next_side: str = PrivateAttr(default="news_site")
    _batch_token_counter: int = PrivateAttr(default=0)
    _common_owner_search_started: bool = PrivateAttr(default=False)
    _common_owner_search_inflight: bool = PrivateAttr(default=False)

    _not_applicable_pending_ad_check: bool = PrivateAttr(default=False)
    _not_applicable_reason: str = PrivateAttr(default="")
    _ad_check_completed: bool = PrivateAttr(default=False)

    # If the common-owner search was triggered from a batch-complete moment,
    # store where to continue if there are NO common owners.
    _common_owner_continue_token: Optional[int] = PrivateAttr(default=None)
    _common_owner_continue_side: Optional[str] = PrivateAttr(default=None)


    # Batch bookkeeping
    _batch_remaining: Dict[int, int] = PrivateAttr(default_factory=dict)  # token -> remaining entity owner-search completions
    _batch_side: Dict[int, str] = PrivateAttr(default_factory=dict)       # token -> side
    _entity_side: Dict[str, str] = PrivateAttr(default_factory=dict)      # entity_id -> side
    _entity_batch: Dict[str, int] = PrivateAttr(default_factory=dict)     # entity_id -> token
    _skip_top_dog_early_out: bool = PrivateAttr(default=True)             # if True, skip early return when entity is top_dog

    def _collect_all_evidence_ids(self, final_output: Dict[str, Any]) -> List[str]:
        evidence_ids: Set[str] = set()

        common_results = final_output.get("common_owner_results", {})
        if not common_results:
            return []

        relationships = common_results.get("relationships", {})
        for rel in relationships.values():
            rel_evidence = get_value_safe(rel, "evidence_ids", []) or []
            evidence_ids.update(rel_evidence)

        owner_entities = common_results.get("owner_entities", {})
        for ent in owner_entities.values():
            ent_evidence = get_value_safe(ent, "evidence_ids", []) or []
            evidence_ids.update(ent_evidence)

        news_site = final_output.get("news_site")
        if news_site:
            ns_evidence = get_value_safe(news_site, "evidence_ids", []) or []
            evidence_ids.update(ns_evidence)

        article_subject = final_output.get("article_subject")
        if article_subject:
            as_evidence = get_value_safe(article_subject, "evidence_ids", []) or []
            evidence_ids.update(as_evidence)

        return list(evidence_ids)

    def _serialize_evidence(self, evidence_ids: List[str]) -> List[Dict[str, Any]]:
        from app.core.db.database_service import DatabaseService

        serialized = []
        service = DatabaseService.get()

        try:
            evidence_list = service.sync.get_evidence_batch(evidence_ids)
            for evidence in evidence_list:
                if evidence:
                    serialized.append(evidence.to_serializeable_object())
        except Exception as e:
            logger.warning(f"Failed to fetch evidence batch: {e}")

        return serialized

    async def run(self, platform: str):
        await super().run(platform)

        self._fly_io_cost_per_second = 0.00001196
        self._start_time = time_module.time()
        logger.info(f"[INVESTIGATION START] url={self.input.get('url', 'unknown')}, started_at={datetime.now().isoformat()}")

        if len(self._base_url) == 0:
            self._base_url = NetConfig.get_base_url()

        echo_spec = {
            "type": "echo_callback",
            "params": {
                "parent_id": self.id,
                "input": {
                    "message": "Echo Test!"
                }
            }
        }

        def on_echo_complete (result):
            logger.info("       ------------ GOT ECHO RESPONSE ------------------         ")
            logger.info(result)

        self.create_child_job(
            child_label=f"echo",
            spec=echo_spec,
            on_complete=on_echo_complete,
            on_update=self.update_handler
        )

        self._queue_url_key = normalize_queue_url_key(self.input["url"])

        prefetched = self.input.get("prefetched", {})
        if prefetched:
            self._prefetched_scrape_result = prefetched.get("scrape_result")
            self._prefetched_site_data = prefetched.get("site_data")
            self._prefetched_companies = prefetched.get("extracted_companies", [])
            self._prefetched_domain = prefetched.get("domain")
            self._prefetched_applicability_result = prefetched.get("applicability_result")
            self._prefetched_article_subject_entity = prefetched.get("article_subject_entity")
            logger.info(f"[PREFETCH] Using prefetched data: domain={self._prefetched_domain}, companies={len(self._prefetched_companies)}")

        supabase = _get_supabase_service_client()
        q = (
            supabase
            .table("article_queue")
            .select("id, status, ownership_tree_id")
            .eq("url", self._queue_url_key)
            .limit(1)
            .execute()
        )

        row = (q.data or [None])[0]
        logger.info(f"[DEBUG] row for {self._queue_url_key}: {row}")
        if row is not None and row["status"] != "queued":
            return

        if row is None:
            supabase.table("article_queue").insert({
                "url": self._queue_url_key,
                "status": "added"
            }).execute()
            logger.info(f"[DEBUG] inserted new row for {self._queue_url_key}")

        import os
        fly_machine_id = os.getenv("FLY_MACHINE_ID", "local")

        try:
            res = (
                supabase
                .table("article_queue")
                .update({
                    "status": "in-progress",
                    "machine_id": fly_machine_id,
                    "started_at": datetime.now().isoformat()
                })
                .eq("url", self._queue_url_key)
                .execute()
            )
        
            logger.info(f"[DEBUG] updated to in-progress: {res.data}")
        except Exception as e:
            logger.info(f"[DEBUG] error updating to in-progress: {str(e)}")

        identify_site_spec = {
            "type": "identify_news_site",
            "params": {
                "parent_id": self.id,
                "input": {
                    "url": self._queue_url_key
                },
                "metadata": {
                    "view_data": {
                        "note": "identify news site",
                        "nodeType": "identify_news_site"
                    }
                }
            }
        }

        scrape_spec = {
            "type": "scrape_page_callback",
            "params": {
                "parent_id": self.id,
                "input": {
                    "url": self._queue_url_key
                },
                "metadata": {
                    "view_data": {
                        "note": "article scrape",
                        "nodeType": "article_analysis"
                    }
                }
            }
        }

        try:
            if self._prefetched_scrape_result:
                logger.info("[PREFETCH] Skipping scrape, using prefetched data")
                synthetic_scrape_result = SimpleNamespace(
                    output=self._prefetched_scrape_result,
                    id="prefetched",
                    status="completed",
                )
                self.on_page_scraped(synthetic_scrape_result)
            else:
                self.scrape_page(scrape_spec)

            if self._prefetched_site_data and self._prefetched_domain:
                logger.info("[PREFETCH] Skipping identify_news_site, using prefetched data")
                site_entity_id = (
                    self._prefetched_site_data.get("news_site_entity_id")
                    or self._prefetched_site_data.get("site_id")
                )
                service = DatabaseService.get()
                news_site_entity = None
                if site_entity_id:
                    news_site_entity = await service.get_entity(site_entity_id)

                if news_site_entity is None:
                    news_site_entity = Entity(
                        id=site_entity_id or "",
                        name=self._prefetched_domain,
                        entity_type="ORG",
                        metadata={},
                    )

                synthetic_site_result = SimpleNamespace(
                    output={
                        "news_site": SimpleNamespace(domain=self._prefetched_domain),
                        "entity": news_site_entity,
                    },
                    id="prefetched",
                    status="completed",
                )
                await self.on_news_site_identified(synthetic_site_result)
            else:
                self.identify_news_site(identify_site_spec)
        except Exception as e:
            logger.exception("Investigation job crashed with exception")
            self._handle_crash(str(e))
            raise

        finally:
            self._append_history({
                "timestamp": datetime.now().isoformat(),
                "event": "RUN_END",
                "details": {"status": self.status},
            })

    def update_handler (self, event):
        pass

    # -----------------------
    # Queue / batch scheduler
    # -----------------------
    def _queue_key(self, side: str) -> str:
        if side not in self._side_queues:
            return self._NEWS_SIDE
        return side

    def _toggle_next_side(self):
        self._next_side = self._SUBJECT_SIDE if self._next_side == self._NEWS_SIDE else self._NEWS_SIDE

    def _enqueue_entities(self, side: str, entities: List[Entity], *, as_root_batch: bool = False):
        side = self._queue_key(side)
        unique: Dict[str, Entity] = {}

        for e in entities:
            if e is None:
                continue
            if get_value_safe(e, "entity_type", None) != "ORG":
                continue
            eid = get_value_safe(e, "id", None)
            if eid is None:
                continue

            # Skip if already complete or currently being searched.
            searching = self.is_searching_entity(e)
            if searching is not None:
                continue

            if eid in unique:
                continue
            unique[eid] = e

        if not unique:
            self._maybe_start_next_batch()
            return

        if as_root_batch and self._active_batch_token is None and len(self._side_queues[side]) == 0:
            # Start with a dedicated first batch so roots don't get merged with later discoveries.
            self._side_queues[side].append(list(unique.keys()))
                        
            # Record the seed entity for this side the first time we enqueue a root batch.
            if side not in self._seed_entity_id_by_side:
                self._seed_entity_id_by_side[side] = next(iter(unique.keys()))

            for eid, e in unique.items():
                # Stash entity object for later start; recursively_find_owners will set _entities when scheduled.
                self._entities.setdefault(eid, {"entity": e, "status": "QUEUED"})
        else:
            # Accumulate for the next batch of this side (breadth-first).
            for eid, e in unique.items():
                self._side_pending_next[side][eid] = e
                self._entities.setdefault(eid, {"entity": e, "status": "QUEUED"})

        self._maybe_start_next_batch()

    def get_seed_entity_id(self, side: str) -> Optional[str]:
        """Return the seed entity_id for a side (news_site / article_subject), if set."""
        side = self._queue_key(side)
        return self._seed_entity_id_by_side.get(side, None)

    def get_seed_entity(self, side: str) -> Optional[Entity]:
        """Return the seed Entity object for a side, if available."""
        eid = self.get_seed_entity_id(side)
        if eid is None:
            return None
        obj = self._entities.get(eid, None)
        if obj is None:
            return None
        return obj.get("entity", None)

    def get_seed_entities(self) -> Dict[str, Optional[Entity]]:
        """Return seed entities for both sides, keyed by side name."""
        return {
            self._NEWS_SIDE: self.get_seed_entity(self._NEWS_SIDE),
            self._SUBJECT_SIDE: self.get_seed_entity(self._SUBJECT_SIDE),
        }


    def _flush_pending_next_to_queue(self, side: str):
        side = self._queue_key(side)
        pending = self._side_pending_next.get(side, {})
        if not pending:
            return

        batch_ids = list(pending.keys())
        self._side_queues[side].append(batch_ids)
        self._side_pending_next[side] = {}

    def _pop_next_batch(self, side: str) -> List[Entity]:
        side = self._queue_key(side)

        # Prefer queued batches; otherwise, turn pending discoveries into a batch.
        if len(self._side_queues[side]) == 0:
            self._flush_pending_next_to_queue(side)

        if len(self._side_queues[side]) == 0:
            return []

        batch_ids = self._side_queues[side].popleft()
        batch_entities: List[Entity] = []
        for eid in batch_ids:
            entry = self._entities.get(eid, {})
            e = entry.get("entity", None)
            if e is None:
                continue
            batch_entities.append(e)
        return batch_entities

    def _maybe_start_next_batch(self):
        # If a batch is already running, do nothing.
        if self._active_batch_token is not None:
            return

        seeds = self.get_seed_entities()
        news_seed = seeds.get(self._NEWS_SIDE)
        subj_seed = seeds.get(self._SUBJECT_SIDE)

        if news_seed is None or subj_seed is None:
            logger.warning(f"[_maybe_start_next_batch] Seeds not ready: news_seed={news_seed is not None}, subj_seed={subj_seed is not None}")
            return
        elif self._common_owner_search_started == False:
            logger.info("[_maybe_start_next_batch] Starting common owner search")
            self._maybe_start_common_owner_search()
            return

        # Attempt to start on the desired next side; if empty, fall back to the other side.
        for attempt in range(2):
            side = self._next_side if attempt == 0 else (self._SUBJECT_SIDE if self._next_side == self._NEWS_SIDE else self._NEWS_SIDE)
            batch_entities = self._pop_next_batch(side)
            if batch_entities:
                logger.info(f"[_maybe_start_next_batch] Starting batch on side={side}, count={len(batch_entities)}")
                self._start_batch(side, batch_entities)
                return

        # Nothing queued on either side - check if we should do final common owner search
        if self._common_owner_search_started and not self._common_owner_search_inflight:
            logger.info("[_maybe_start_next_batch] All batches complete, running final common owner check")
            self._do_final_common_owner_check()
            return

        logger.warning(f"[_maybe_start_next_batch] Nothing queued. queues={dict(self._side_queues)}, pending={dict(self._side_pending_next)}")
        return

    def _do_final_common_owner_check(self):
        seeds = self.get_seed_entities()
        news_entity = seeds.get(self._NEWS_SIDE)
        subject_entity = seeds.get(self._SUBJECT_SIDE)

        if news_entity is None or subject_entity is None:
            logger.warning("[_do_final_common_owner_check] Missing seed entities")
            self._complete_with_no_common_owners()
            return

        find_common_owners_spec = {
            "type": "find_common_owners",
            "params": {
                "parent_id": self.id,
                "input": {
                    "entity_a": news_entity.to_serializeable_object(),
                    "entity_b": subject_entity.to_serializeable_object(),
                },
                "metadata": {
                    "view_data": {"note": "find common owners - final"}
                }
            }
        }

        self.create_child_job(
            child_label="find common owners - final",
            spec=find_common_owners_spec,
            on_complete=self.on_final_common_owner_check_wrapper,
            on_update=self.update_handler
        )

    @returns_awaitable
    def on_final_common_owner_check_wrapper(self, result):
        return self.on_final_common_owner_check(result)

    async def on_final_common_owner_check(self, result):
        common_owners = result.output.get("common_owners", {})
        if common_owners is None:
            common_owners = {}

        if len(common_owners) > 0:
            seeds = self.get_seed_entities()
            news_entity = seeds.get(self._NEWS_SIDE)
            subject_entity = seeds.get(self._SUBJECT_SIDE)

            self._final_output_obj = {
                "article_url": self._queue_url_key,
                "news_site": result.output["entity_a"],
                "article_subject": result.output["entity_b"],
                "common_owner_results": result.output
            }

            owner_entities = result.output["owner_entities"]
            companies_to_rank = []
            for co_id, co_entity in common_owners.items():
                e = owner_entities.get(co_id)
                if e:
                    companies_to_rank.append(e.to_serializeable_object())

            rank_spec = {
                "type": "rank_companies",
                "params": {
                    "parent_id": self.id,
                    "input": {"entities": companies_to_rank},
                    "metadata": {
                        "view_data": {
                            "note": "rank",
                            "nodeType": "rank_companies"
                        }
                    }
                }
            }

            self.create_child_job(
                child_label=f"rank companies - final",
                spec=rank_spec,
                on_complete=self.on_final_companies_ranked_wrapper,
                on_update=self.update_handler
            )
        else:
            self._complete_with_no_common_owners()

    def _complete_with_no_common_owners(self):
        seeds = self.get_seed_entities()
        news_entity = seeds.get(self._NEWS_SIDE)
        subject_entity = seeds.get(self._SUBJECT_SIDE)

        asyncio.create_task(self._complete_with_no_common_owners_async(news_entity, subject_entity))

    async def _complete_with_no_common_owners_async(self, news_entity, subject_entity):
        service = DatabaseService.get()
        max_depth = 3

        async def find_ownership_tree_depth_limited(entity, max_depth=3):
            ownership_tree = {
                "target_entity": entity,
                "owner_entities": {},
                "relationships": {}
            }
            visited_ids = set()

            async def walk(current_entity, depth):
                if depth > max_depth:
                    return
                entity_id = current_entity.id
                if entity_id in visited_ids:
                    return
                visited_ids.add(entity_id)

                owner_relationships = await service.find_ownership_relationships(entity_id)
                if not owner_relationships:
                    return

                for rel in owner_relationships:
                    if rel.id not in ownership_tree["relationships"]:
                        ownership_tree["relationships"][rel.id] = rel

                    if rel.source_entity_id not in ownership_tree["owner_entities"]:
                        owner = await service.get_entity(rel.source_entity_id)
                        ownership_tree["owner_entities"][rel.source_entity_id] = owner
                        await walk(owner, depth + 1)

            await walk(entity, 0)
            return ownership_tree

        a_tree = await find_ownership_tree_depth_limited(subject_entity, max_depth)
        b_tree = await find_ownership_tree_depth_limited(news_entity, max_depth)

        relationships = dict(a_tree.get("relationships", {}))
        relationships.update(b_tree.get("relationships", {}))
        owner_entities = dict(a_tree.get("owner_entities", {}))
        owner_entities.update(b_tree.get("owner_entities", {}))

        self._final_output_obj = {
            "article_url": self._queue_url_key,
            "news_site": news_entity.to_serializeable_object() if news_entity else None,
            "article_subject": subject_entity.to_serializeable_object() if subject_entity else None,
            "common_owner_results": {
                "common_owners": {},
                "a_ownership_tree": a_tree,
                "b_ownership_tree": b_tree,
                "relationships": relationships,
                "owner_entities": owner_entities,
                "entity_a": news_entity.to_serializeable_object() if news_entity else None,
                "entity_b": subject_entity.to_serializeable_object() if subject_entity else None,
                "metadata": {
                    "common_owner_ruleset": COMMON_OWNER_RULESET,
                    "common_owner_strategy": "no common owner; depth-limited context",
                    "max_depth": max_depth,
                    "terminal_common_owner_ids": [],
                    "exhausted": True,
                    "created_at": datetime.now().isoformat(),
                },
            },
            "final_ranking": {"entities": {}, "ranking": []},
            "top_owner": None
        }

        evidence_ids = self._collect_all_evidence_ids(self._final_output_obj)
        self._final_output_obj["evidence"] = self._serialize_evidence(evidence_ids)

        supabase = _get_supabase_service_client()

        def serialize_base_dict(base_dict):
            transportable_dict = {}
            for key, value in base_dict.items():
                transportable_dict[key] = value.to_serializeable_object()
            return transportable_dict

        def serialize_ownership_tree(ownership_tree):
            if not ownership_tree:
                return {}
            return {
                "target_entity": ownership_tree["target_entity"].to_serializeable_object(),
                "owner_entities": serialize_base_dict(ownership_tree["owner_entities"]),
                "relationships": serialize_base_dict(ownership_tree["relationships"])
            }

        investigation_data_transportable = {
            "article_subject": self._final_output_obj["article_subject"],
            "news_site": self._final_output_obj["news_site"],
            "common_owner_results": {
                "a_ownership_tree": serialize_ownership_tree(self._final_output_obj["common_owner_results"]["a_ownership_tree"]),
                "b_ownership_tree": serialize_ownership_tree(self._final_output_obj["common_owner_results"]["b_ownership_tree"]),
                "relationships": serialize_base_dict(self._final_output_obj["common_owner_results"]["relationships"]),
                "owner_entities": serialize_base_dict(self._final_output_obj["common_owner_results"]["owner_entities"]),
                "common_owners": {},
                "metadata": self._final_output_obj["common_owner_results"].get("metadata", {})
            },
            "final_ranking": self._final_output_obj["final_ranking"],
            "top_owner": None
        }

        company_a = self._final_output_obj["article_subject"]["id"] if self._final_output_obj["article_subject"] else None
        company_b = self._final_output_obj["news_site"]["id"] if self._final_output_obj["news_site"] else None

        existing = (
            supabase.table("ownership_trees")
            .select("id, company_a, company_b")
            .execute()
        )
        ownership_tree_id = None
        for row in existing.data:
            a = row.get("company_a")
            b = row.get("company_b")
            if (a == company_a and b == company_b) or (a == company_b and b == company_a):
                ownership_tree_id = row["id"]
                logger.info(f"Found existing ownership_tree: {ownership_tree_id}")
                break

        if ownership_tree_id is None:
            res = supabase.table("ownership_trees").insert({
                "company_a": company_a,
                "company_b": company_b,
                "ownership_tree": investigation_data_transportable["common_owner_results"],
                "investigation_data": investigation_data_transportable,
                "summary": f"No common owner found between {self._final_output_obj['article_subject']['name'] if self._final_output_obj['article_subject'] else '?'} and {self._final_output_obj['news_site']['name'] if self._final_output_obj['news_site'] else '?'}"
            }).execute()
            logger.info(res.data)
            ownership_tree_id = res.data[0]["id"]
        else:
            res = (
                supabase.table("ownership_trees")
                .update({
                    "ownership_tree": investigation_data_transportable["common_owner_results"],
                    "investigation_data": investigation_data_transportable,
                    "summary": f"No common owner found between {self._final_output_obj['article_subject']['name'] if self._final_output_obj['article_subject'] else '?'} and {self._final_output_obj['news_site']['name'] if self._final_output_obj['news_site'] else '?'}",
                })
                .eq("id", ownership_tree_id)
                .execute()
            )
            logger.info(res.data)

        res = (
            supabase
            .table("article_queue")
            .update({"ownership_tree_id": ownership_tree_id})
            .eq("url", self._queue_url_key)
            .is_("ownership_tree_id", None)
            .execute()
        )

        if not res.data:
            logger.info("No update performed (already set or row missing)")
        else:
            logger.info(f"Updated: {res.data}")

        res = (
            supabase
            .table("article_queue")
            .update({"status": "complete"})
            .eq("url", self._queue_url_key)
            .neq("status", "complete")
            .execute()
        )

        if not res.data:
            logger.info("No update performed (already set or row missing)")
        else:
            logger.info(f"Updated: {res.data}")

        total_cost = OpenrouterCost.get_instance().get_cost()
        end_time = time_module.time()
        investigation_runtime_seconds = end_time - self._start_time
        fly_io_investigation_cost = investigation_runtime_seconds * self._fly_io_cost_per_second
        supabase.table("article_queue").upsert({
            "url": self._queue_url_key,
            "status": "complete",
            "openrouter_cost": total_cost,
            "investigation_run_time": investigation_runtime_seconds,
            "fly_io_investigation_cost": fly_io_investigation_cost,
            "ended_at": datetime.now().isoformat()
        }, on_conflict="url").execute()

        self.set_output(self._final_output_obj)
        self.complete()

        duration_seconds = end_time - self._start_time
        hours = int(duration_seconds // 3600)
        minutes = int((duration_seconds % 3600) // 60)
        seconds = int(duration_seconds % 60)
        duration_str = f"{hours:02d}:{minutes:02d}:{seconds:02d}"
        logger.info(f"[INVESTIGATION COMPLETE - NO COMMON OWNERS] url={self._queue_url_key}, duration={duration_str}, ended_at={datetime.now().isoformat()}")

        self._shutdown_or_stop()

    def _finalize_ownership_tree_and_complete(self):
        supabase = _get_supabase_service_client()

        company_a = self._final_output_obj["article_subject"]["id"] if self._final_output_obj["article_subject"] else None
        company_b = self._final_output_obj["news_site"]["id"] if self._final_output_obj["news_site"] else None

        existing = (
            supabase.table("ownership_trees")
            .select("id, company_a, company_b")
            .execute()
        )
        ownership_tree_id = None
        for row in existing.data:
            a = row.get("company_a")
            b = row.get("company_b")
            if (a == company_a and b == company_b) or (a == company_b and b == company_a):
                ownership_tree_id = row["id"]
                logger.info(f"Found existing ownership_tree: {ownership_tree_id}")
                break

        if ownership_tree_id is None:
            res = supabase.table("ownership_trees").insert({
                "company_a": company_a,
                "company_b": company_b,
                "ownership_tree": self._final_output_obj["common_owner_results"],
                "investigation_data": self._final_output_obj,
                "summary": f"Reused existing ownership_tree for {self._final_output_obj['article_subject']['name'] if self._final_output_obj['article_subject'] else '?'} and {self._final_output_obj['news_site']['name'] if self._final_output_obj['news_site'] else '?'}"
            }).execute()
            logger.info(res.data)
            ownership_tree_id = res.data[0]["id"]

        res = (
            supabase
            .table("article_queue")
            .update({"ownership_tree_id": ownership_tree_id})
            .eq("url", self._queue_url_key)
            .is_("ownership_tree_id", None)
            .execute()
        )

        if not res.data:
            logger.info("No update performed (already set or row missing)")
        else:
            logger.info(f"Updated: {res.data}")

        res = (
            supabase
            .table("article_queue")
            .update({"status": "complete"})
            .eq("url", self._queue_url_key)
            .neq("status", "complete")
            .execute()
        )

        if not res.data:
            logger.info("No update performed (already set or row missing)")
        else:
            logger.info(f"Updated: {res.data}")

        total_cost = OpenrouterCost.get_instance().get_cost()
        end_time = time_module.time()
        investigation_runtime_seconds = end_time - self._start_time
        fly_io_investigation_cost = investigation_runtime_seconds * self._fly_io_cost_per_second
        supabase.table("article_queue").upsert({
            "url": self._queue_url_key,
            "status": "complete",
            "openrouter_cost": total_cost,
            "investigation_run_time": investigation_runtime_seconds,
            "fly_io_investigation_cost": fly_io_investigation_cost,
            "ended_at": datetime.now().isoformat()
        }, on_conflict="url").execute()

        self.set_output(self._final_output_obj)
        self.complete()

        duration_seconds = end_time - self._start_time
        hours = int(duration_seconds // 3600)
        minutes = int((duration_seconds % 3600) // 60)
        seconds = int(duration_seconds % 60)
        duration_str = f"{hours:02d}:{minutes:02d}:{seconds:02d}"
        logger.info(f"[INVESTIGATION COMPLETE - REUSED OWNERSHIP_TREE] url={self._queue_url_key}, duration={duration_str}, ended_at={datetime.now().isoformat()}")

        self._shutdown_or_stop()

    def _start_batch(self, side: str, entities: List[Entity]):
        side = self._queue_key(side)
        entities = [e for e in entities if e is not None]

        if not entities:
            self._toggle_next_side()
            return

        self._batch_token_counter += 1
        token = self._batch_token_counter

        self._active_side = side
        self._active_batch_token = token
        self._batch_side[token] = side
        self._batch_remaining[token] = len(entities)
        logger.info(f"[_start_batch] token={token}, side={side}, count={len(entities)}")

        if len(entities) == 1:
            e = entities[0]
            eid = get_value_safe(e, "id", None)
            if eid is None:
                # If it doesn't have an id yet, let the identify step fill it in; still count this slot.
                eid = f"temp:{get_value_safe(e, 'name', '')}:{token}"
                logger.info(f"[_start_batch] Entity has no ID, using temp_id={eid}")
            self._entity_side[str(eid)] = side
            self._entity_batch[str(eid)] = token

            # Kick off the owner search for this entity (identify-if-needed then find owners).
            self.recursively_find_owners(entity=e)
        else:
            async def on_ranked (result):
                child_output, ranked_entities, ranking, error_message = self._extract_rank_companies_output(
                    result,
                    stage=f"batch company ranking ({side})",
                )
                if error_message:
                    logger.warning(
                        "Using fallback batch ranking: url=%s side=%s token=%s error=%s",
                        self._queue_url_key,
                        side,
                        token,
                        error_message,
                    )
                    child_output = self._build_fallback_rank_companies_output(
                        companies_to_rank,
                        reason=error_message,
                        stage=f"batch_company_ranking:{side}:{token}",
                    )
                    ranked_entities = child_output["entities"]
                    ranking = child_output["ranking"]

                try:
                    ordered_entities = []
                    for rank in ranking:
                        company_id = rank.get("company_id") or (rank.get("company") or {}).get("id")
                        eid = company_id
                        e = ranked_entities[eid]

                        deserialized_entity = Entity()
                        deserialized_entity.deserialize(e)

                        ordered_entities.append((eid, deserialized_entity))

                    for eid, deserialized_entity in ordered_entities:
                        self._entity_side[str(eid)] = side
                        self._entity_batch[str(eid)] = token

                        # Kick off the owner search for this entity (identify-if-needed then find owners).
                        self.recursively_find_owners(entity=deserialized_entity)
                except Exception as e:
                    logger.warning(
                        "Batch ranking output was unusable, retrying with fallback order: url=%s side=%s token=%s error=%s",
                        self._queue_url_key,
                        side,
                        token,
                        e,
                    )
                    fallback_output = self._build_fallback_rank_companies_output(
                        companies_to_rank,
                        reason=f"Unexpected error processing ranked batch companies: {e}",
                        stage=f"batch_company_ranking:{side}:{token}",
                    )
                    try:
                        for rank in fallback_output["ranking"]:
                            company_id = rank.get("company_id") or (rank.get("company") or {}).get("id")
                            eid = company_id
                            entity_payload = fallback_output["entities"][eid]

                            deserialized_entity = Entity()
                            deserialized_entity.deserialize(entity_payload)

                            self._entity_side[str(eid)] = side
                            self._entity_batch[str(eid)] = token
                            self.recursively_find_owners(entity=deserialized_entity)
                    except Exception as fallback_error:
                        await self._fail_investigation_gracefully(
                            f"Fallback batch ranking failed: {fallback_error}",
                            stage="batch_company_ranking",
                            failure_context=fallback_output,
                        )
                        return

            @returns_awaitable
            def on_ranked_wrapper (result):
                return on_ranked(result)

            companies_to_rank = []
            for e in entities:
                companies_to_rank.append(
                    e.to_serializeable_object()
                )

            rank_spec = {
                "type": "rank_companies",
                "params": {
                    "parent_id": self.id,
                    "input": {
                        "entities": companies_to_rank
                    },
                    "metadata": {
                        "view_data": {
                            "note": "rank",
                            "nodeType": "rank_companies"
                        }
                    }
                }
            }
            self.create_child_job(
                child_label=f"rank companies - {uuid4()}",
                spec=rank_spec,
                on_complete=on_ranked_wrapper,
                on_update=self.update_handler
            )
            
    def _get_complete_org_ids_for_side(self, side: str) -> set[str]:
        side = self._queue_key(side)
        out: set[str] = set()
        for eid, rec in self._entities.items():
            if rec.get("status") != "COMPLETE":
                continue
            if self._entity_side.get(eid) != side:
                continue
            ent = rec.get("entity")
            if ent is None:
                continue
            if getattr(ent, "entity_type", None) != "ORG":
                continue
            out.add(eid)
        return out

    def _mark_entity_done(self, entity_id: str):
        token = self._entity_batch.get(entity_id, None)
        if token is None:
            logger.warning(f"[_mark_entity_done] entity_id={entity_id} has no batch token in _entity_batch. keys={list(self._entity_batch.keys())}")
            return

        remaining = self._batch_remaining.get(token, None)
        if remaining is None:
            logger.warning(f"[_mark_entity_done] token={token} has no remaining count in _batch_remaining. keys={list(self._batch_remaining.keys())}")
            return

        remaining -= 1
        self._batch_remaining[token] = remaining
        if remaining > 0:
            return

        # Batch completed
        side = self._batch_side.get(token, None) or self._active_side

        # If common-owner search hasn't happened yet, do it now and continue only if none found.
        if not self._common_owner_search_started and not self._common_owner_search_inflight:
            self._common_owner_search_inflight = True
            self._common_owner_continue_token = token
            self._common_owner_continue_side = side
            self.do_common_owner_search(
                completed_batch_token=token,
                completed_batch_side=side,
            )
            return

        # Otherwise, normal finalize
        self._finalize_completed_batch(token, side)

    def _maybe_start_common_owner_search(self):
        if self._common_owner_search_started or self._common_owner_search_inflight:
            return

        seeds = self.get_seed_entities()
        news_seed = seeds.get(self._NEWS_SIDE)
        subj_seed = seeds.get(self._SUBJECT_SIDE)

        if news_seed is None or subj_seed is None:
            return

        company_a_id = news_seed.id
        company_b_id = subj_seed.id

        supabase = _get_supabase_service_client()
        existing = (
            supabase.table("ownership_trees")
            .select("id, company_a, company_b")
            .execute()
        )

        matched_tree_id = None
        for row in existing.data:
            a = row.get("company_a")
            b = row.get("company_b")
            if (a == company_a_id and b == company_b_id) or (a == company_b_id and b == company_a_id):
                matched_tree_id = row["id"]
                logger.info(f"Found existing ownership_tree: {matched_tree_id}")
                break

        if matched_tree_id is not None:
            matched_tree = (
                supabase.table("ownership_trees")
                .select("id, ownership_tree, investigation_data, company_a, company_b")
                .eq("id", matched_tree_id)
                .limit(1)
                .execute()
            )

            matched_row = (matched_tree.data or [None])[0]
            if matched_row is not None:
                raw_investigation_data = matched_row.get("investigation_data", {})

                if isinstance(raw_investigation_data, str):
                    investigation_data = json.loads(raw_investigation_data)
                else:
                    investigation_data = raw_investigation_data

                common_owner_results = (
                    investigation_data.get("common_owner_results")
                    if isinstance(investigation_data, dict)
                    else None
                ) or matched_row.get("ownership_tree", {})
                if isinstance(common_owner_results, str):
                    try:
                        common_owner_results = json.loads(common_owner_results)
                    except Exception:
                        common_owner_results = {}

                common_owner_metadata = (
                    common_owner_results.get("metadata", {})
                    if isinstance(common_owner_results, dict)
                    else {}
                )

                if investigation_data and common_owner_metadata.get("common_owner_ruleset") == COMMON_OWNER_RULESET:
                    evidence_ids = self._collect_all_evidence_ids(investigation_data)
                    investigation_data["evidence"] = self._serialize_evidence(evidence_ids)
                    investigation_data["article_url"] = self._queue_url_key

                    self._final_output_obj = investigation_data

                    self._finalize_ownership_tree_and_complete()
                    return
                elif investigation_data:
                    logger.info(
                        "Existing ownership_tree %s uses old or missing common-owner ruleset; recomputing",
                        matched_tree_id,
                    )

        self._common_owner_search_started = True
        self._common_owner_search_inflight = True
        self.do_common_owner_search(
            completed_batch_token=None,
            completed_batch_side=None,
        )

    def _finalize_completed_batch(self, token: int, side: Optional[str]):
        logger.info(f"[_finalize_completed_batch] token={token}, side={side}")
        
        if side is None:
            side = self._active_side

        if side is not None:
            self._flush_pending_next_to_queue(side)

        self._active_side = None
        self._active_batch_token = None

        self._toggle_next_side()
        self._maybe_start_next_batch()

    def do_common_owner_search(self, completed_batch_token: Optional[int], completed_batch_side: Optional[str]):
        seeds = self.get_seed_entities()
        news_entity = seeds.get(self._NEWS_SIDE)
        subject_entity = seeds.get(self._SUBJECT_SIDE)

        # If seeds missing, treat as "no common owners" and continue if needed.
        if news_entity is None or subject_entity is None:
            self._common_owner_search_inflight = False
            if completed_batch_token is not None:
                self._finalize_completed_batch(completed_batch_token, completed_batch_side)
            return

        find_common_owners_spec = {
            "type": "find_common_owners",
            "params": {
                "parent_id": self.id,
                "input": {
                    "entity_a": news_entity.to_serializeable_object(),
                    "entity_b": subject_entity.to_serializeable_object(),
                },
                "metadata": {
                    "view_data": {"note": "find common owners"}
                }
            }
        }

        self.create_child_job(
            child_label="find common owners",
            spec=find_common_owners_spec,
            on_complete=lambda result: self.on_find_common_owners_wrapper(
                result,
                completed_batch_token=completed_batch_token,
                completed_batch_side=completed_batch_side,
            ),
            on_update=self.update_handler
        )

    @returns_awaitable
    def on_find_common_owners_wrapper(self, result, completed_batch_token: int, completed_batch_side: str | None):
        return self.on_find_common_owners(result, completed_batch_token, completed_batch_side)

    def on_find_common_owners(self, result, completed_batch_token: int, completed_batch_side: str | None):
        # Make sure inflight is cleared no matter what
        self._common_owner_search_inflight = False

        common_owners = result.output.get("common_owners", {})
        if common_owners is None:
            common_owners = {}

        if len(common_owners) > 0:
            seeds = self.get_seed_entities()
            news_entity = seeds.get(self._NEWS_SIDE)
            subject_entity = seeds.get(self._SUBJECT_SIDE)

            self._final_output_obj = {
                "article_url": self._queue_url_key,
                "news_site": result.output["entity_a"],
                "article_subject": result.output["entity_b"],
                "common_owner_results": result.output
            }

            owner_entities = result.output["owner_entities"]
            companies_to_rank = []
            for co_id, co_entity in common_owners.items():
                e = owner_entities.get(co_id)
                if e:
                    companies_to_rank.append(e.to_serializeable_object())

            rank_spec = {
                "type": "rank_companies",
                "params": {
                    "parent_id": self.id,
                    "input": {
                        "entities": companies_to_rank
                    },
                    "metadata": {
                        "view_data": {
                            "note": "rank",
                            "nodeType": "rank_companies"
                        }
                    }
                }
            }

            self.create_child_job(
                child_label=f"rank companies - final",
                spec=rank_spec,
                on_complete=self.on_final_companies_ranked_wrapper,
                on_update=self.update_handler
            )
            return

        # No common owners: continue normal traversal (flush, toggle, next batch)
        self._finalize_completed_batch(completed_batch_token, completed_batch_side)

    @returns_awaitable
    def on_final_companies_ranked_wrapper (self, result):
        return self.on_final_companies_ranked(result)

    async def _run_supabase_operation_with_retry(
        self,
        operation_name: str,
        operation: Callable[[], Any],
        *,
        attempts: int = 3,
        timeout_seconds: float = 20.0,
        initial_backoff_seconds: float = 0.5,
    ):
        last_error = None

        for attempt in range(1, attempts + 1):
            try:
                return await asyncio.wait_for(
                    asyncio.to_thread(operation),
                    timeout=timeout_seconds,
                )
            except Exception as e:
                last_error = e
                if attempt >= attempts:
                    break

                backoff_seconds = initial_backoff_seconds * (2 ** (attempt - 1))
                logger.warning(
                    "Supabase operation failed: op=%s attempt=%s/%s timeout=%ss retry_in=%ss error=%s",
                    operation_name,
                    attempt,
                    attempts,
                    timeout_seconds,
                    backoff_seconds,
                    e,
                )
                await asyncio.sleep(backoff_seconds)

        raise RuntimeError(
            f"Supabase operation failed after {attempts} attempts: {operation_name}"
        ) from last_error

    def _extract_child_job_output(self, result: Any) -> Any:
        if hasattr(result, "output"):
            return getattr(result, "output")

        if isinstance(result, dict):
            if "output" in result:
                return result.get("output")
            return result

        return None

    def _extract_rank_companies_output(
        self,
        result: Any,
        *,
        stage: str,
    ) -> Tuple[Optional[Dict[str, Any]], Optional[Dict[str, Any]], Optional[List[Dict[str, Any]]], Optional[str]]:
        child_output = self._extract_child_job_output(result)

        if not isinstance(child_output, dict):
            return None, None, None, (
                f"Rank companies job returned non-dict output during {stage}: "
                f"{type(child_output).__name__}"
            )

        if child_output.get("status") == "error":
            return child_output, None, None, (
                f"Rank companies job failed during {stage}: "
                f"{child_output.get('error', 'unknown error')}"
            )

        ranked_entities = child_output.get("entities")
        ranking = child_output.get("ranking")

        if not isinstance(ranked_entities, dict):
            return child_output, None, None, (
                f"Rank companies job returned invalid entities payload during {stage}"
            )

        if not isinstance(ranking, list):
            return child_output, None, None, (
                f"Rank companies job returned invalid ranking payload during {stage}"
            )

        if not ranking:
            return child_output, ranked_entities, ranking, (
                f"Rank companies job returned an empty ranking during {stage}"
            )

        return child_output, ranked_entities, ranking, None

    def _build_fallback_rank_companies_output(
        self,
        entities: List[Dict[str, Any]],
        *,
        reason: str,
        stage: str,
    ) -> Dict[str, Any]:
        entity_dict: Dict[str, Dict[str, Any]] = {}
        ranking: List[Dict[str, Any]] = []

        for idx, entity in enumerate(entities, start=1):
            entity_payload = dict(entity or {})
            company_id = entity_payload.get("id") or f"fallback:{stage}:{idx}"
            entity_payload["id"] = company_id
            entity_dict[company_id] = entity_payload

            ranking.append({
                "rank": idx,
                "company_id": company_id,
                "company_name": entity_payload.get("name", company_id),
                "capital_influence_level": "Unknown",
                "justification": "LLM ranking failed; using deterministic fallback order.",
                "key_signals": [],
                "confidence": 0.0,
            })

        return {
            "entities": entity_dict,
            "ranking": ranking,
            "fallback_used": True,
            "fallback_reason": reason,
        }

    def _bfs_distances_from_entity(self, relationships: Dict[str, Any], start_id: str) -> Dict[str, int]:
        """
        BFS from start_id up the ownership chain.
        Returns dict: entity_id -> distance (number of relationships to traverse).

        Relationships: source_entity_id owns target_entity_id.
        To go "up" from start_id, find relationships where target_entity_id == start_id,
        then source_entity_id is an owner (distance 1), recurse upward.
        """
        from collections import deque

        # Build reverse adjacency: entity -> list of entities that own it
        owners_of: Dict[str, List[str]] = {}
        for rel_id, rel in relationships.items():
            if isinstance(rel, dict):
                source = rel.get("source_entity_id") or rel.get("source")
                target = rel.get("target_entity_id") or rel.get("target")
            else:
                source = getattr(rel, "source_entity_id", None) or getattr(rel, "source", None)
                target = getattr(rel, "target_entity_id", None) or getattr(rel, "target", None)
            if not source or not target:
                continue
            if target not in owners_of:
                owners_of[target] = []
            owners_of[target].append(source)

        dist: Dict[str, int] = {}
        queue = deque([(start_id, 0)])

        while queue:
            entity_id, d = queue.popleft()
            if entity_id in dist:
                continue
            dist[entity_id] = d
            for owner_id in owners_of.get(entity_id, []):
                if owner_id not in dist:
                    queue.append((owner_id, d + 1))

        return dist

    def _find_top_owner_by_shortest_path(
        self,
        common_owner_results: Dict[str, Any],
        entity_a: Dict[str, Any],
        entity_b: Dict[str, Any],
        ranking: List[Dict[str, Any]],
    ) -> Optional[Tuple[Dict[str, Any], str]]:
        """
        Find the common owner with minimum total distance to entity_a and entity_b.
        Uses influence ranking as tie-breaker when distances are equal.

        Returns (top_owner_dict, company_id) or None if no valid owner found.
        """
        common_owners = common_owner_results.get("common_owners") or {}
        relationships = common_owner_results.get("relationships") or {}

        if not common_owners or not relationships:
            return None

        entity_a_id = entity_a.get("id") if isinstance(entity_a, dict) else getattr(entity_a, "id", None)
        entity_b_id = entity_b.get("id") if isinstance(entity_b, dict) else getattr(entity_b, "id", None)

        if not entity_a_id or not entity_b_id:
            return None

        # Build influence lookup from ranking: company_id -> (rank, influence_level)
        influence_map: Dict[str, Tuple[int, str]] = {}
        for idx, entry in enumerate(ranking):
            company_id = entry.get("company_id") or (entry.get("company") or {}).get("id")
            if company_id:
                influence_map[company_id] = (idx, entry.get("capital_influence_level", "Unknown"))

        dist_a = self._bfs_distances_from_entity(relationships, entity_a_id)
        dist_b = self._bfs_distances_from_entity(relationships, entity_b_id)

        best_owner = None
        best_id = None
        best_total_dist = float('inf')
        best_influence_rank = float('inf')

        for owner_id, owner in common_owners.items():
            d_a = dist_a.get(owner_id, float('inf'))
            d_b = dist_b.get(owner_id, float('inf'))
            total_dist = d_a + d_b

            if total_dist == float('inf'):
                continue

            # Get influence rank for tie-breaking
            influence_rank = float('inf')
            if owner_id in influence_map:
                influence_rank = influence_map[owner_id][0]

            # Select based on: 1) shortest total distance, 2) best influence rank
            if total_dist < best_total_dist or (total_dist == best_total_dist and influence_rank < best_influence_rank):
                best_total_dist = total_dist
                best_influence_rank = influence_rank
                best_owner = owner
                best_id = owner_id

        if best_owner is not None:
            return best_owner, best_id
        return None

    def _get_final_rank_fallback_entities(self) -> List[Dict[str, Any]]:
        common_owner_results = self._final_output_obj.get("common_owner_results") or {}
        common_owners = common_owner_results.get("common_owners") or {}
        owner_entities = common_owner_results.get("owner_entities") or {}
        companies_to_rank: List[Dict[str, Any]] = []

        for co_id in common_owners.keys():
            owner_entity = owner_entities.get(co_id)
            if not owner_entity:
                continue

            if isinstance(owner_entity, dict):
                companies_to_rank.append(dict(owner_entity))
            else:
                companies_to_rank.append(owner_entity.to_serializeable_object())

        return companies_to_rank

    async def _fail_investigation_gracefully(
        self,
        error_message: str,
        *,
        stage: str,
        failure_context: Any = None,
    ):
        logger.error(
            "Investigation failed gracefully: url=%s stage=%s error=%s",
            self._queue_url_key,
            stage,
            error_message,
        )

        failure_output = {
            "article_url": self._queue_url_key,
            "status": "failed",
            "failed_stage": stage,
            "error": error_message,
        }
        if failure_context is not None:
            failure_output["failure_context"] = failure_context

        self._final_output_obj = {
            **self._final_output_obj,
            **failure_output,
        }
        self.set_output(self._final_output_obj)

        end_time = time_module.time()
        investigation_runtime_seconds = end_time - self._start_time
        fly_io_investigation_cost = investigation_runtime_seconds * self._fly_io_cost_per_second
        total_cost = OpenrouterCost.get_instance().get_cost()

        try:
            await self._run_supabase_operation_with_retry(
                "mark article_queue as failed",
                lambda: (
                    _get_supabase_service_client()
                    .table("article_queue")
                    .update({
                        "status": "failed",
                        "openrouter_cost": total_cost,
                        "investigation_run_time": investigation_runtime_seconds,
                        "fly_io_investigation_cost": fly_io_investigation_cost,
                        "ended_at": datetime.now().isoformat(),
                    })
                    .eq("url", self._queue_url_key)
                    .neq("status", "complete")
                    .execute()
                ),
                attempts=2,
                timeout_seconds=10.0,
                initial_backoff_seconds=0.25,
            )
        except Exception:
            logger.exception(
                "Failed to mark article_queue failed for url=%s",
                self._queue_url_key,
            )

        self.fail(error_message)
        self._shutdown_or_stop()

    async def on_final_companies_ranked (self, result):
        child_output, ranked_entities, ranking, error_message = self._extract_rank_companies_output(
            result,
            stage="final company ranking",
        )
        if error_message:
            logger.warning(
                "Using fallback final ranking: url=%s error=%s",
                self._queue_url_key,
                error_message,
            )
            child_output = self._build_fallback_rank_companies_output(
                self._get_final_rank_fallback_entities(),
                reason=error_message,
                stage="final_company_ranking",
            )
            ranked_entities = child_output["entities"]
            ranking = child_output["ranking"]

        # Use BFS to find top owner by shortest path, with influence as tie-breaker
        common_owner_results = self._final_output_obj.get("common_owner_results") or {}
        article_subject = self._final_output_obj.get("article_subject")
        news_site = self._final_output_obj.get("news_site")

        top_owner_result = self._find_top_owner_by_shortest_path(
            common_owner_results,
            news_site,
            article_subject,
            ranking,
        )

        if top_owner_result:
            top_entity, company_id = top_owner_result
            # Use entity from ranked_entities if available, otherwise use the one from BFS
            if isinstance(ranked_entities, dict) and company_id in ranked_entities:
                top_entity = ranked_entities[company_id]
        else:
            # Fallback to original ranking-based selection
            try:
                top_entity_ranking = ranking[0]
                company_id = top_entity_ranking.get("company_id") or (top_entity_ranking.get("company") or {}).get("id")

                if not company_id:
                    fallback_reason = f"Invalid ranking result, missing company_id: {top_entity_ranking}"
                    logger.warning(
                        "Final ranking missing company_id, retrying with fallback order: url=%s error=%s",
                        self._queue_url_key,
                        fallback_reason,
                    )
                    child_output = self._build_fallback_rank_companies_output(
                        self._get_final_rank_fallback_entities(),
                        reason=fallback_reason,
                        stage="final_company_ranking",
                    )
                    ranked_entities = child_output["entities"]
                    ranking = child_output["ranking"]
                    top_entity_ranking = ranking[0]
                    company_id = top_entity_ranking.get("company_id")

                top_entity = ranked_entities.get(company_id) if isinstance(ranked_entities, dict) else None
                if top_entity is None:
                    fallback_reason = f"Invalid ranking result, missing top entity in entities map for company_id={company_id}"
                    logger.warning(
                        "Final ranking missing top entity, retrying with fallback order: url=%s error=%s",
                        self._queue_url_key,
                        fallback_reason,
                    )
                    child_output = self._build_fallback_rank_companies_output(
                        self._get_final_rank_fallback_entities(),
                        reason=fallback_reason,
                        stage="final_company_ranking",
                    )
                    ranked_entities = child_output["entities"]
                    ranking = child_output["ranking"]
                    top_entity_ranking = ranking[0]
                    company_id = top_entity_ranking.get("company_id")
                    top_entity = ranked_entities.get(company_id) if company_id else None

                if not company_id or top_entity is None:
                    self._final_output_obj["final_ranking"] = child_output
                    self._final_output_obj["top_owner"] = None
                    await self._fail_investigation_gracefully(
                        "Final company ranking failed and fallback order could not be constructed",
                        stage="final_company_ranking",
                        failure_context=child_output,
                    )
                    return
            except Exception as e:
                logger.warning(f"Failed to select top owner via fallback: {e}")
                self._final_output_obj["final_ranking"] = child_output
                self._final_output_obj["top_owner"] = None
                await self._fail_investigation_gracefully(
                    "Final company ranking failed",
                    stage="final_company_ranking",
                    failure_context=child_output,
                )
                return

        self._final_output_obj["final_ranking"] = child_output
        self._final_output_obj["top_owner"] = top_entity

        def serialize_base_dict (base_dict):
            transportable_dict = {}

            for key, value in base_dict.items():
                transportable_dict[key] = value.to_serializeable_object()
            
            return transportable_dict

        def serialize_ownership_tree (ownership_tree):
            transportable_ownership_tree = {
                "target_entity": ownership_tree["target_entity"].to_serializeable_object(),
                "owner_entities": serialize_base_dict(ownership_tree["owner_entities"]),
                "relationships": serialize_base_dict(ownership_tree["relationships"])
            }

            return transportable_ownership_tree

        article_subject = self._final_output_obj["article_subject"]
        news_site = self._final_output_obj["news_site"]

        investigation_data_transportable = {
            "article_subject": article_subject if isinstance(article_subject, dict) else article_subject.to_serializeable_object(),
            "news_site": news_site if isinstance(news_site, dict) else news_site.to_serializeable_object(),
            "common_owner_results": {
                "a_ownership_tree": serialize_ownership_tree(self._final_output_obj["common_owner_results"]["a_ownership_tree"]),
                "b_ownership_tree": serialize_ownership_tree(self._final_output_obj["common_owner_results"]["b_ownership_tree"]),
                "relationships": serialize_base_dict(self._final_output_obj["common_owner_results"]["relationships"]),
                "owner_entities": serialize_base_dict(self._final_output_obj["common_owner_results"]["owner_entities"]),
                "common_owners": serialize_base_dict(self._final_output_obj["common_owner_results"]["common_owners"]),
                "metadata": self._final_output_obj["common_owner_results"].get("metadata", {})
            },
            "final_ranking": self._final_output_obj["final_ranking"],
            "top_owner": self._final_output_obj["top_owner"]
        }

        evidence_ids = self._collect_all_evidence_ids(self._final_output_obj)
        self._final_output_obj["evidence"] = self._serialize_evidence(evidence_ids)

        company_a = article_subject["id"] if isinstance(article_subject, dict) else article_subject.id
        company_b = news_site["id"] if isinstance(news_site, dict) else news_site.id
        top_owner = self._final_output_obj.get("top_owner")
        article_subject_name = article_subject["name"] if isinstance(article_subject, dict) else getattr(article_subject, "name", None) or "?"
        news_site_name = news_site["name"] if isinstance(news_site, dict) else getattr(news_site, "name", None) or "?"

        if top_owner:
            top_owner_name = top_owner.get("name", "Unknown") if isinstance(top_owner, dict) else getattr(top_owner, "name", "Unknown")
            summary = f"{top_owner_name} owns both {article_subject_name} and {news_site_name}"
        else:
            summary = f"No common owner found between {article_subject_name} and {news_site_name}"

        def persist_final_results_sync():
                supabase = _get_supabase_service_client()

                existing = (
                    supabase.table("ownership_trees")
                    .select("id, company_a, company_b")
                    .execute()
                )

                ownership_tree_id = None
                for row in (existing.data or []):
                    a = row.get("company_a")
                    b = row.get("company_b")
                    if (a == company_a and b == company_b) or (a == company_b and b == company_a):
                        ownership_tree_id = row["id"]
                        logger.info(f"Found existing ownership_tree: {ownership_tree_id}")
                        break

                if ownership_tree_id is None:
                    res = supabase.table("ownership_trees").insert({
                        "company_a": company_a,
                        "company_b": company_b,
                        "ownership_tree": investigation_data_transportable["common_owner_results"],
                        "investigation_data": investigation_data_transportable,
                        "summary": summary
                    }).execute()
                    logger.info(res.data)
                    ownership_tree_id = res.data[0]["id"]
                else:
                    res = (
                        supabase.table("ownership_trees")
                        .update({
                            "ownership_tree": investigation_data_transportable["common_owner_results"],
                            "investigation_data": investigation_data_transportable,
                            "summary": summary,
                        })
                        .eq("id", ownership_tree_id)
                        .execute()
                    )
                    logger.info(res.data)

                ownership_tree_update_res = (
                    supabase
                    .table("article_queue")
                    .update({"ownership_tree_id": ownership_tree_id})
                    .eq("url", self._queue_url_key)
                    .neq("status", "complete")
                    .execute()
                )

                status_update_res = (
                    supabase
                    .table("article_queue")
                    .update({"status": "complete"})
                    .eq("url", self._queue_url_key)
                    .neq("status", "complete")
                    .execute()
                )

                return {
                    "ownership_tree_update_data": ownership_tree_update_res.data,
                    "status_update_data": status_update_res.data,
                }
        
        try:
            persistence_result = await self._run_supabase_operation_with_retry(
                "persist final ranked investigation results",
                persist_final_results_sync,
                attempts=3,
                timeout_seconds=20.0,
                initial_backoff_seconds=0.5,
            )

            ownership_tree_update_data = persistence_result.get("ownership_tree_update_data")
            if not ownership_tree_update_data:
                logger.info("No update performed (already set or row missing)")
            else:
                logger.info(f"Updated: {ownership_tree_update_data}")

            status_update_data = persistence_result.get("status_update_data")
            if not status_update_data:
                logger.info("No update performed (already set or row missing)")
            else:
                logger.info(f"Updated: {status_update_data}")

        except Exception as e:
            logger.exception(
                "Failed to finalize ranked investigation results for url=%s",
                self._queue_url_key,
            )

            try:
                await self._run_supabase_operation_with_retry(
                    "mark article_queue as crash",
                    lambda: (
                        _get_supabase_service_client()
                        .table("article_queue")
                        .update({"status": "crash"})
                        .eq("url", self._queue_url_key)
                        .neq("status", "complete")
                        .execute()
                    ),
                    attempts=2,
                    timeout_seconds=10.0,
                    initial_backoff_seconds=0.25,
                )
            except Exception:
                logger.exception(
                    "Failed to mark article_queue crash status for url=%s",
                    self._queue_url_key,
                )

            self.fail(f"terminal supabase write failed: {e}")
            self._shutdown_or_stop()
            return
        except Exception as e:
            await self._fail_investigation_gracefully(
                f"Unexpected error finalizing ranked investigation results: {e}",
                stage="final_company_ranking",
                failure_context=child_output,
            )
            return

        total_cost = OpenrouterCost.get_instance().get_cost()
        end_time = time_module.time()
        investigation_runtime_seconds = end_time - self._start_time
        fly_io_investigation_cost = investigation_runtime_seconds * self._fly_io_cost_per_second
        supabase = _get_supabase_service_client()
        supabase.table("article_queue").upsert({
            "url": self._queue_url_key,
            "status": "complete",
            "openrouter_cost": total_cost,
            "investigation_run_time": investigation_runtime_seconds,
            "fly_io_investigation_cost": fly_io_investigation_cost,
            "ended_at": datetime.now().isoformat()
        }, on_conflict="url").execute()

        self.set_output(self._final_output_obj)
        self.complete()
        
        duration_seconds = end_time - self._start_time
        hours = int(duration_seconds // 3600)
        minutes = int((duration_seconds % 3600) // 60)
        seconds = int(duration_seconds % 60)
        duration_str = f"{hours:02d}:{minutes:02d}:{seconds:02d}"
        logger.info(f"[INVESTIGATION COMPLETE] url={self._queue_url_key}, duration={duration_str}, ended_at={datetime.now().isoformat()}")

        self._shutdown_or_stop()

    def _shutdown_or_stop(self):
        logger.info("done")
        fly_machine_id = os.getenv("FLY_MACHINE_ID")
        if fly_machine_id and fly_machine_id != "local":
            logger.info(f"Running on Fly machine {fly_machine_id}, shutting down machine")
            try:
                result = subprocess.run(["which", "fly"], capture_output=True, text=True)
                if result.returncode != 0:
                    logger.warning("fly CLI not found in PATH, falling back to stop event")
                    os.kill(os.getpid(), signal.SIGTERM)
                    return
                subprocess.run(["fly", "machine", "stop", fly_machine_id], check=True)
            except Exception as e:
                logger.error(f"Failed to stop Fly machine: {e}")
                os.kill(os.getpid(), signal.SIGTERM)
        else:
            logger.info("Not on Fly machine, triggering stop event")
            os.kill(os.getpid(), signal.SIGTERM)

    def _handle_crash(self, error_message: str):
        logger.error(f"Handling crash: {error_message}")
        self._set_queue_status("crash")
        self._shutdown_or_stop()

    def _set_queue_status(self, status: str):
        try:
            supabase = _get_supabase_service_client()
            res = (
                supabase
                .table("article_queue")
                .update({"status": status})
                .eq("url", self._queue_url_key)
                .neq("status", "complete")
                .execute()
            )
            logger.info(f"Set article_queue status to {status}: {res.data}")
        except Exception as e:
            logger.error(f"Failed to set {status} status: {e}")

    def set_timeout_status(self):
        self._set_queue_status("timeout")
        investigation_runtime_seconds = time_module.time() - self._start_time
        fly_io_investigation_cost = investigation_runtime_seconds * self._fly_io_cost_per_second
        supabase = _get_supabase_service_client()
        supabase.table("article_queue").upsert({
            "url": self._queue_url_key,
            "status": "timeout",
            "investigation_run_time": investigation_runtime_seconds,
            "fly_io_investigation_cost": fly_io_investigation_cost,
            "ended_at": datetime.now().isoformat()
        }, on_conflict="url").execute()

    def _handle_not_applicable_article(self, reason: str):
        logger.info(f"[_handle_not_applicable_article] Article not applicable: {reason}")

        self._not_applicable_pending_ad_check = True
        self._not_applicable_reason = reason

        self._final_output_obj = {
            "article_url": self._queue_url_key,
            "not_applicable": True,
            "reason": reason,
            "summary": "This was not found to be about one specific company or product."
        }

    def _finalize_not_applicable_article(self):
        reason = self._not_applicable_reason
        supabase = _get_supabase_service_client()
        
        try:
            res = supabase.table("ownership_trees").insert({
                "company_a": None,
                "company_b": None,
                "ownership_tree": {},
                "investigation_data": {
                    "article_url": self._queue_url_key,
                    "not_applicable": True,
                    "reason": reason,
                    "article_subject": None,
                    "news_site": None,
                    "common_owner_results": None,
                    "final_ranking": None,
                    "top_owner": None
                },
                "summary": "This was not found to be about one specific company or product."
            }).execute()
            logger.info(res.data)

            ownership_tree_id = res.data[0]["id"]

            res = (
                supabase
                .table("article_queue")
                .update({"ownership_tree_id": ownership_tree_id})
                .eq("url", self._queue_url_key)
                .is_("ownership_tree_id", None)
                .execute()
            )

            if not res.data:
                logger.info("No update performed (already set or row missing)")
            else:
                logger.info(f"Updated: {res.data}")

            res = (
                supabase
                .table("article_queue")
                .update({"status": "not applicable"})
                .eq("url", self._queue_url_key)
                .neq("status", "complete")
                .execute()
            )

            if not res.data:
                logger.info("No update performed (already set or row missing)")
            else:
                logger.info(f"Updated: {res.data}")

        except Exception as e:
            logger.error(f"Failed to handle not applicable article: {e}")

        total_cost = OpenrouterCost.get_instance().get_cost()
        end_time = time_module.time()
        investigation_runtime_seconds = end_time - self._start_time
        fly_io_investigation_cost = investigation_runtime_seconds * self._fly_io_cost_per_second
        supabase.table("article_queue").upsert({
            "url": self._queue_url_key,
            "status": "not-applicable",
            "openrouter_cost": total_cost,
            "investigation_run_time": investigation_runtime_seconds,
            "fly_io_investigation_cost": fly_io_investigation_cost,
            "ended_at": datetime.now().isoformat()
        }, on_conflict="url").execute()

        self._final_output_obj = {
            "article_url": self._queue_url_key,
            "not_applicable": True,
            "reason": reason,
            "summary": "This was not found to be about one specific company or product."
        }

        evidence_ids = self._collect_all_evidence_ids(self._final_output_obj)
        self._final_output_obj["evidence"] = self._serialize_evidence(evidence_ids)

        self.set_output(self._final_output_obj)
        self.complete()
        
        end_time = time_module.time()
        duration_seconds = end_time - self._start_time
        hours = int(duration_seconds // 3600)
        minutes = int((duration_seconds % 3600) // 60)
        seconds = int(duration_seconds % 60)
        duration_str = f"{hours:02d}:{minutes:02d}:{seconds:02d}"
        logger.info(f"[INVESTIGATION COMPLETE - NOT APPLICABLE] url={self._queue_url_key}, duration={duration_str}, ended_at={datetime.now().isoformat()}")

        self._shutdown_or_stop()

    def scrape_page (self, scrape_spec):
        url = scrape_spec["params"]["input"]["url"]
        self.create_child_job(
            child_label=f"scrape - {url}",
            spec=scrape_spec,
            on_complete=self.on_page_scraped,
            on_update=self.update_handler
        )

    def identify_news_site (self, identify_site_spec):
        url = identify_site_spec["params"]["input"]["url"]
        self.create_child_job(
            child_label=f"identify site - {url}",
            spec=identify_site_spec,
            on_complete=self.on_news_site_identified_wrapper,
            on_update=self.update_handler
        )

    @returns_awaitable
    def on_news_site_identified_wrapper (self, result):
        return self.on_news_site_identified(result)

    async def on_news_site_identified (self, identify_news_site_job):
        output = identify_news_site_job.output
        news_site = output["news_site"]
        news_site_entity = output["entity"]

        site_domain = news_site.domain
        site_id = news_site_entity.id

        supabase = _get_supabase_service_client()

        q = (
            supabase
            .table("sites")
            .select("id, news_site")
            .eq("domain", site_domain)
            .limit(1)
            .execute()
        )

        row = (q.data or [None])[0]
        if row is None:
            logger.info("No sites row exists for that domain.")
        elif row["news_site"] is not None:
            logger.info("news_site already populated: " + row["news_site"])
        else:
            res = (
                supabase
                .table("sites")
                .update({"news_site": site_id})
                .eq("id", row["id"])
                .is_("news_site", None)
                .execute()
            )
            logger.info(f"Updated: {res.data}")

        res = (
            supabase
            .table("article_queue")
            .update({"site_id": site_id})
            .eq("url", self._queue_url_key)
            .is_("site_id", None)
            .execute()
        )

        if not res.data:
            logger.info("No update performed (already set or row missing)")
        else:
            logger.info(f"Updated: {res.data}")

        last_owner_search = news_site_entity.metadata.get("last_owner_search", """{"status": "none"}""")
        last_owner_search = loads(last_owner_search)
        
        self._enqueue_entities(self._NEWS_SIDE, [news_site_entity], as_root_batch=True)
        self._maybe_start_common_owner_search()

    def on_page_scraped (self, scrape_job):
        scrape_output = scrape_job.output
        raw_html = scrape_output.get("raw_html", "")
        article_text = scrape_job.output.get("result", "")

        title_match = re.search(r'^#\s+(.+?)(?:\n|$)', article_text)
        article_title = title_match.group(1).strip() if title_match else ""

        check_for_ad_spec = {
            "type": "check_for_ad",
            "params": {
                "parent_id": self.id,
                "input": {
                    "raw_html": raw_html,
                    "article_title": article_title,
                    "article_url": self._queue_url_key,
                    "scrape_output": scrape_output
                },
                "metadata": {
                    "view_data": {
                        "note": "check for ad"
                    }
                }
            }
        }

        self.create_child_job(
            child_label="check for ad",
            spec=check_for_ad_spec,
            on_complete=self.on_ad_checked,
            on_update=self.update_handler
        )

        if self._prefetched_applicability_result:
            logger.info("[PREFETCH] Using prefetched applicability result")
            self.on_applicability_checked_with_result(self._prefetched_applicability_result)
            return

        title_match = re.search(r'^#\s+(.+?)(?:\n|$)', article_text)
        article_title = title_match.group(1).strip() if title_match else ""

        check_applicability_spec = {
            "type": "check_article_applicability",
            "params": {
                "parent_id": self.id,
                "input": {
                    "article_text": article_text,
                    "article_title": article_title
                },
                "metadata": {
                    "view_data": {
                        "note": "check article applicability"
                    }
                }
            }
        }

        self.create_child_job(
            child_label="check article applicability",
            spec=check_applicability_spec,
            on_complete=self.on_applicability_checked,
            on_update=self.update_handler
        )

    def on_ad_checked(self, check_ad_job):
        ad_result = check_ad_job.output
        ad_check_json = json.dumps(ad_result, ensure_ascii=False)

        supabase = _get_supabase_service_client()
        res = (
            supabase
            .table("article_queue")
            .update({"ad_check_result": ad_check_json})
            .eq("url", self._queue_url_key)
            .execute()
        )
        logger.info(f"Updated ad_check_result in article_queue: {res.data}")

        self._ad_check_completed = True

        if self._not_applicable_pending_ad_check:
            logger.info(f"[on_ad_checked] Article was marked as not applicable, finalizing now")
            self._finalize_not_applicable_article()

    def on_applicability_checked(self, check_job):
        result = check_job.output
        self.process_applicability_result(result)

    def on_applicability_checked_with_result(self, result: Dict[str, Any]):
        self.process_applicability_result(result)

    def process_applicability_result(self, result: Dict[str, Any]):
        applicability_json = json.dumps(result, ensure_ascii=False)
        supabase = _get_supabase_service_client()
        res = (
            supabase
            .table("article_queue")
            .update({"applicability_result": applicability_json})
            .eq("url", self._queue_url_key)
            .execute()
        )
        logger.info(f"Updated applicability_result in article_queue: {res.data}")

        if not result.get("is_applicable", False):
            logger.info(f"[process_applicability_result] Article not applicable: {result.get('reason', 'No reason')}")
            self._handle_not_applicable_article(result.get("reason", "Article not about a specific company or product"))
            if self._ad_check_completed:
                logger.info(f"[process_applicability_result] ad_check already completed, finalizing now")
                self._finalize_not_applicable_article()
            return

        identified_company = result.get("identified_company")
        if not identified_company:
            logger.warning("[process_applicability_result] No company identified, treating as not applicable")
            self._handle_not_applicable_article("No specific company identified in article")
            if self._ad_check_completed:
                logger.info(f"[process_applicability_result] ad_check already completed, finalizing now")
                self._finalize_not_applicable_article()
            return

        logger.info(f"[process_applicability_result] Identified company: {identified_company}")

        if self._prefetched_article_subject_entity:
            logger.info("[PREFETCH] Using prefetched article subject entity")
            self._proceed_with_prefetched_entity(self._prefetched_article_subject_entity)
            return

        self._proceed_to_get_entity(identified_company)

    def _proceed_with_prefetched_entity(self, entity_raw: Dict[str, Any]):
        entity = Entity()
        entity.deserialize(entity_raw)
        self._begin_owner_search_for_entity(entity)

    def _proceed_to_get_entity(self, identified_company: str):
        get_entity_spec = {
            "type": "get_or_create_entity_job",
            "params": {
                "parent_id": self.id,
                "input": {
                    "name": identified_company,
                    "tags": ["article_subject"],
                    "entity_type": "ORG"
                },
            },
        }

        self.create_child_job(
            child_label=f"get_entity for {identified_company}",
            spec=get_entity_spec,
            on_update=self.update_handler,
            on_complete=self.find_owners_if_needed_wrapper,
        )
        
    def analyze_article (self, analyze_spec):
        self.create_child_job(
            child_label="analyze article",
            spec=analyze_spec,
            on_complete=self.on_article_analyzed,
            on_update=self.update_handler
        )

    @returns_awaitable
    def on_owners_found_immediate_wrapper(self, result):
        return self.on_owners_found(result)
            
    async def on_owners_found (self, owners_found_job):
        owned_entity_id_for_done = None

        try:
            owners_output = get_value_safe(owners_found_job, "output", {}) or {}
            owned_entity_serialized = get_value_safe(owners_output, "target_entity", None)

            if owned_entity_serialized is None:
                owned_entity_serialized = get_value_safe(
                    get_value_safe(owners_found_job, "input", {}),
                    "entity",
                    None,
                )
                logger.warning(
                    "[on_owners_found] Missing target_entity in output; falling back to input entity. job_id=%s",
                    get_value_safe(owners_found_job, "id", None),
                )

            if owned_entity_serialized is None:
                logger.error(
                    "[on_owners_found] Missing target_entity in output and input; cannot continue owner traversal. job_id=%s",
                    get_value_safe(owners_found_job, "id", None),
                )
                return

            owned_entity = Entity()
            owned_entity.deserialize(owned_entity_serialized)
            owned_entity_id_for_done = owned_entity.id
            logger.info(f"[on_owners_found] Entity: {owned_entity.name} (id={owned_entity.id})")

            self._entities[owned_entity.id] = {
                "entity": owned_entity,
                "status": "COMPLETE"
            }
            
            logger.info(f"[on_owners_found] batch_token={self._entity_batch.get(owned_entity.id)}, _batch_remaining={dict(self._batch_remaining)}")

            discovered: List[Entity] = []

            owner_entities_raw = get_value_safe(owners_output, "entities", [])
            if not isinstance(owner_entities_raw, list):
                logger.warning(
                    "[on_owners_found] owners output entities is not a list; type=%s entity_id=%s",
                    type(owner_entities_raw).__name__,
                    owned_entity.id,
                )
                owner_entities_raw = []

            if len(owner_entities_raw) == 0:
                logger.info(
                    "[on_owners_found] No owners discovered for entity_id=%s name=%r",
                    owned_entity.id,
                    owned_entity.name,
                )

            for entity_serialized in owner_entities_raw:
                entity = Entity()
                try:
                    entity.deserialize(entity_serialized)
                except Exception as exc:
                    logger.warning(
                        "[on_owners_found] Skipping malformed discovered entity for owned_entity_id=%s payload=%s error=%s",
                        owned_entity.id,
                        entity_serialized,
                        exc,
                    )
                    continue

                if entity.id == owned_entity.id:
                    continue
                if entity.entity_type != "ORG":
                    continue

                # Skip if already complete or in-progress.
                if self.is_searching_entity(entity) is not None:
                    continue

                last_owner_search = entity.metadata.get("last_owner_search", '''{"status": "none"}''')
                last_owner_search = loads(last_owner_search)

                if last_owner_search.get("status", "none") != "complete":
                    discovered.append(entity)

            # Enqueue discoveries for this same traversal side (breadth-first).
            side = self._entity_side.get(owned_entity.id, self._active_side or self._NEWS_SIDE)
            if discovered:
                self._enqueue_entities(side, discovered, as_root_batch=False)
        finally:
            if owned_entity_id_for_done is not None:
                self._mark_entity_done(owned_entity_id_for_done)
            else:
                logger.warning(
                    "[on_owners_found] Could not mark entity done: missing target entity id. job_id=%s",
                    get_value_safe(owners_found_job, "id", None),
                )


    def recursively_find_owners (self, entity, ignore_traversal_check = False):
        name = get_value_safe(entity, "name", None)

        # Allow a queued entity to proceed; otherwise, skip duplicates/in-flight work.
        existing_search = self._entities.get(entity.id, None)
        if existing_search is not None and existing_search.get("status", "") != "QUEUED":
            logger.warning(f"[recursively_find_owners] Skipping {name} (id={entity.id}): existing status={existing_search.get('status', '?')}")
            return

        logger.info(f"[recursively_find_owners] Starting for {name} (id={entity.id})")

        self._entities[entity.id] = {
            "entity": entity,
            "status": "EVALUATING"
        }

        # If this entity is being processed as part of an active batch, ensure we have bookkeeping.
        if entity.id not in self._entity_side and self._active_side is not None:
            self._entity_side[entity.id] = self._active_side
        if entity.id not in self._entity_batch and self._active_batch_token is not None:
            self._entity_batch[entity.id] = self._active_batch_token
            logger.info(f"[recursively_find_owners] Assigned batch token={self._active_batch_token} to entity_id={entity.id}")

        def find_owners (entity_to_search: Entity):
            self._entities[entity_to_search.id] = {
                "entity": entity_to_search,
                "status": "IN_PROGRESS"
            }

            metadata_entity = entity_to_search

            spec_input: Dict[str, Any] = {}
            spec_input["entity"] = entity_to_search.to_serializeable_object()
            metadata_entity = entity_to_search.to_serializeable_object()

            find_owners_spec = {
                "type": "find_owners_llm",
                "params": {
                    "parent_id": self.id,
                    "input": spec_input,
                    "metadata": {
                        "view_data": {
                            "note": "find owners",
                            "nodeType": "find_owners"
                        },
                        "entity": metadata_entity
                    }
                }
            }

            self.create_child_job(
                child_label=f"recursively find owners {name}",
                spec=find_owners_spec,
                on_complete=self.on_owners_found_immediate_wrapper,
                on_update=self.update_handler
            )

        # check identify status
        last_identification = entity.metadata.get("last_identification", {})
        if len(last_identification) == 0:
            self._entities[entity.id] = {
                "entity": entity,
                "status": "IDENTIFYING"
            }

            @returns_awaitable
            def on_identify_complete_wrapper (identify_job):
                return on_identify_complete(identify_job)

            def on_identify_complete (identify_job):
                result = identify_job.output["result"]
                entity_raw = result["entity"]
                identified_entity = Entity()
                identified_entity.deserialize(entity_raw)

                if identified_entity.top_dog and not self._skip_top_dog_early_out:
                    logger.info(f"[on_identify_complete] Entity {get_value_safe(entity, 'name', '?')} is top_dog, continuing with find_owners")
                elif identified_entity.top_dog:
                    logger.info(f"[on_identify_complete] Entity {get_value_safe(entity, 'name', '?')} is top_dog, skipping find_owners (early out enabled)")
                    # Mark entity done to properly complete the batch - use old_id since that's what was added to _entity_batch
                    old_id = get_value_safe(entity, "id", None)
                    if old_id is not None:
                        self._mark_entity_done(old_id)
                    return

                # Keep bookkeeping aligned if identification changes the ID.
                old_id = get_value_safe(entity, "id", None)
                new_id = get_value_safe(identified_entity, "id", None)
                logger.info(f"[on_identify_complete] old_id={old_id}, new_id={new_id}, old_name={get_value_safe(entity, 'name', '?')}, new_name={get_value_safe(identified_entity, 'name', '?')}")
                
                if new_id is not None:
                    # Handle case where entity had no ID (temp ID was used) - batch token
                    # may be stored under None key or old_id. Try both.
                    side = self._entity_side.get(old_id) or self._entity_side.get(None) or (self._active_side or self._NEWS_SIDE)
                    token = self._entity_batch.get(old_id) or self._entity_batch.get(None) or self._active_batch_token
                    
                    logger.info(f"[on_identify_complete] Mapping: side={side}, token={token}")

                    self._entity_side[new_id] = side
                    if token is not None:
                        self._entity_batch[new_id] = token

                find_owners(identified_entity)

            identify_spec = {
                "type": "identify_company_from_name_multi",
                "params": {
                    "parent_id": self.id,
                    "input": {
                        "entity": entity.to_serializeable_object()
                    },
                    "metadata": {
                        "view_data": {
                            "note": "identify",
                            "nodeType": "identify"
                        }
                    }
                }
            }

            self.create_child_job(
                child_label=f"identify {name}",
                spec=identify_spec,
                on_complete=on_identify_complete_wrapper,
                on_update=self.update_handler
            )
        else:
            find_owners(entity)

    def is_searching_entity (self, entity):
        for id, entity_search_obj in self._entities.items():
            if id == get_value_safe(entity, "id", None):
                return entity_search_obj["status"] != "COMPLETE"

        return None

    def entity_search_exists (self, entity):
        for id, entity_search_obj in self._entities.items():
            if id == get_value_safe(entity, "id", None):
                return True

        return False

    def get_open_searches_count (self):
        count = 0

        for entity_search_obj in self._entities.values():
            if entity_search_obj["status"] != "COMPLETE":
                count += 1
        
        return count

    @returns_awaitable
    def find_owners_if_needed_wrapper (self, result):
        return self.find_owners_if_needed(result)

    async def find_owners_if_needed (self, get_entity_job):

        entity = get_entity_job.output["result"]
        self._begin_owner_search_for_entity(entity)

    def _begin_owner_search_for_entity(self, entity: Entity):
        last_owner_search = entity.metadata.get("last_owner_search", """{"status": "none"}""")
        last_owner_search = loads(last_owner_search)

        self._enqueue_entities(self._SUBJECT_SIDE, [entity], as_root_batch=True)
        self._maybe_start_common_owner_search()

    def on_article_analyzed (self, analyze_job):
        for entity_raw in analyze_job.output["entities"]:
            if entity_raw["entity_type"] != "ORG":
                continue

            relevance = get_value_safe(entity_raw, "relevance", 0.0)
            if relevance < 0.95:
                continue

            get_entity_spec = {
                "type": "get_or_create_entity_job",
                "params": {
                    "parent_id": self.id,
                    "input": {
                        "name": entity_raw["name"],
                        "tags": entity_raw["tags"],
                        "entity_type": "ORG"
                    },
                },
            }

            self.create_child_job(
                child_label=f"get_entity",
                spec=get_entity_spec,
                on_update=self.update_handler,
                on_complete=self.find_owners_if_needed_wrapper,
            )

def _normalize_host(hostname: str) -> str:
    h = (hostname or "").strip().lower()
    return h[4:] if h.startswith("www.") else h

def _normalize_pathname(pathname: str) -> str:
    p = pathname or "/"
    p = re.sub(r"/{2,}", "/", p)
    p = p.replace("/./", "/")

    # Collapse "/a/../" repeatedly
    while True:
        nxt = re.sub(r"/[^/]+/\.\./", "/", p)
        if nxt == p:
            break
        p = nxt

    p = re.sub(r"/\.$", "/", p)
    p = re.sub(r"/[^/]+/\.\.$", "/", p)

    if len(p) > 1:
        p = re.sub(r"/+$", "", p)
    return p

def normalize_queue_url_key(raw_url: str) -> str:
    """
    Matches the Edge function's normalizeQueueUrlKey():
    - ignores protocol, query, fragment
    - strips www.
    - removes default ports (80/443) depending on scheme *if present*
    - keeps non-default port
    - normalizes path
    - returns "<host[:port]><path>"
    """
    u = urlsplit(raw_url)  # raises ValueError if invalid

    host = _normalize_host(u.hostname or "")
    if not host:
        raise ValueError("Invalid URL (missing hostname)")

    port = u.port  # None if not present
    scheme = (u.scheme or "").lower()

    is_default_port = (
        port is None or
        (scheme == "https" and port == 443) or
        (scheme == "http" and port == 80)
    )

    host_with_port = host if is_default_port else f"{host}:{port}"
    path = _normalize_pathname(u.path)

    return f"{host_with_port}{path}"

def _get_supabase_service_client():
    import os
    from supabase import create_client

    url = os.getenv("SUPABASE_URL")
    service_role_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

    if not url:
        raise RuntimeError("SUPABASE_URL is not set")
    if not service_role_key:
        raise RuntimeError("SUPABASE_SERVICE_ROLE_KEY is not set")

    # Service role key bypasses RLS; do NOT use in client-side code.
    return create_client(url, service_role_key)
