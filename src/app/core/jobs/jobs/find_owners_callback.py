import asyncio
import json
import requests
import threading
import os
from time import sleep
from datetime import datetime, timezone
from typing import Any, Dict
from app.core.jobs.job import Job
from app.core.jobs.job_status import JobStatus
from app.edge.edge_runner_factory import get_edge_runner
from app.functions.clean_brave_results import clean_results
from app.functions.get_entity_async import get_entity_async
from app.core.runtime.job_batcher import get_batcher
from app.core.db.database_service import DatabaseService
from app.core.db.models import Evidence, Relationship, Entity
from pydantic import PrivateAttr
from concurrent.futures import ThreadPoolExecutor, as_completed
from app.core.runtime.event_poster import get_event_poster
from app.config import NetConfig
from app.util.markers import returns_awaitable
from app.util.get_value_safe import get_value_safe
from uuid import uuid4

@Job.register(name="find_owners_callback")
class FindOwnersCallback(Job):
    # --- Private attrs / runtime state ---
    _base_url: str = PrivateAttr(default="")
    _json_headers: dict = PrivateAttr(default_factory=lambda: {"Content-Type": "application/json"})
    _company: str = PrivateAttr(default="")
    _context: str = PrivateAttr(default="")
    _entity: Entity | None = PrivateAttr(default=None)
    _max_parallel_workers: int = PrivateAttr(default=20)
    _current_url: str = PrivateAttr(default="")
    _be_e_aggressive: bool = PrivateAttr(default=True)
    _run_immediate: bool = PrivateAttr(default=False)
    _entity_id: str = PrivateAttr(default="")

    requirements: Dict[str, Any] = {"cpu": 1, "net": 1}
    label: str = "Find Owners - Callback"
    description: str = "Find owners of a company"

    async def run(self, platform: str):
        await super().run(platform)

        if len(self._base_url) == 0:
            self._base_url = NetConfig.get_base_url()

        input_entity = get_value_safe(self.input, "entity", None)
        if input_entity is not None:
            entity = Entity()
            entity.deserialize(input_entity)

            self._entity_id = entity.id
            await self.on_target_entity_found(entity)
            return

        self._entity_id = self.input.get("entity_id", None)

        if self._entity_id is None:
            self._company = self.input.get("company", None)
            self._context = self.input.get("context", None)

        self._be_e_aggressive = self.input.get("be_e_aggressive", False)

        if  self._run_immediate:
            self.gumshoe_scrape()
        else:
            get_entity_spec = {
                "type": "get_or_create_entity_job",
                "params": {
                    "parent_id": self.id,
                    "input": {
                        "entity_id": self._entity_id,
                        "name": self._company,
                        "context": self._context,
                        "entity_type": "ORG",
                    },
                },
            }

            @returns_awaitable
            def on_target_entity_found_wrapper(result):
                return on_target_entity_found(result)

            async def on_target_entity_found(result):
                output = getattr(result, "output", result)
                self._entity_id = output.id
                await self.on_target_entity_found(output)

            self.create_child_job(
                child_label=f"get_entity {self._company or self._entity_id}",
                spec=get_entity_spec,
                on_update=self.update_handler,
                on_complete=on_target_entity_found_wrapper,
            )

    async def on_target_entity_found(self, entity):
        self._entity = entity

        if self._entity_id is not None:
            self._company = self._entity.name
            self._context = self._entity.context

        self.description = f"Find owners of {self._entity.name}"
        self._json_headers = {"Content-Type": "application/json"}

        try:
            payload = self.model_dump()
            print("about to POST /sse/event; payload keys:", list(payload.keys())[:12])
            get_event_poster().emit("/sse/event", payload)
        except Exception as e:
            import traceback
            print("ERROR posting /sse/event:", repr(e))
            traceback.print_exc()

        service = DatabaseService.get()

        if self._be_e_aggressive is False:
            ownership_relationships = await service.afind_ownership_relationships(self._entity.id)
            if len(ownership_relationships) > 0:
                self._set_output(ownership_relationships)
                self.complete(ownership_relationships)
                return {"entity": self._entity, "ownership_relationships": ownership_relationships}

        try:
            self.gumshoe_scrape()

        except Exception as e:
            self._set_status(JobStatus.FAILED)
            self._append_history(
                {
                    "timestamp": datetime.now().isoformat(),
                    "event": "ERROR",
                    "details": {"error": str(e)},
                }
            )
            raise

        finally:
            self._append_history(
                {
                    "timestamp": datetime.now().isoformat(),
                    "event": "RUN_END",
                    "details": {"status": self.status},
                }
            )

    def update_handler(self, event):
        pass

    def gumshoe_scrape(self):
        self.search_pass(self.id)

    def on_search_pass(self, search_pass_job):
        cleaned_results = clean_results(search_pass_job.output)
        self.find_relevant_owner_links(cleaned_results, self.id)

    def search_pass(self, parent_id):

        # TODO: See if the query can be improved. Using the one from the traversal is too restrictive
        query = f"Who owns {self._company} {self._context}"

        search_spec = {
            "type": "search_callback",
            "params": {
                "parent_id": parent_id,
                "input": {
                    "query": query,
                    "options": {
                        "num_pages": 1
                    }
                },
                "metadata": {
                    "view_data": {
                        "note": "find owners search"
                    }
                }
            },
        }

        self.create_child_job(
            child_label="search_pass",
            spec=search_spec,
            on_update=self.update_handler,
            on_complete=self.on_search_pass,
        )

    def on_relevant_owner_links(self, relevant_links_job):
        scrape_specs = self.create_scrape_specs(
            relevant_links_job.output["links"], self.id
        )
        self.scrape_pages(scrape_specs)

    def find_relevant_owner_links(self, search_results, parent_id):
        links_spec = {
            "type": "get_relevant_owner_links_callback",
            "params": {
                "parent_id": parent_id,
                "input": {"company": self._company, "search_results": search_results},
                "metadata": {
                    "view_data": {
                        "note": "find relevant owner links"
                    }
                }
            },
        }

        self.create_child_job(
            child_label="find relevant owner links",
            spec=links_spec,
            on_update=self.update_handler,
            on_complete=self.on_relevant_owner_links,
        )

    def create_scrape_specs(self, links, parent_id):
        scrape_specs = []
        seen = set()
        for link in links:
            if not link or link in seen:
                continue
            seen.add(link)

            scrape_specs.append(
                {
                    "type": "scrape_page_callback",
                    "params": {
                        "parent_id": parent_id,
                        "input": {"url": link},
                        "metadata": {
                            "view_data": {
                                "note": "find owners scrape"
                            }
                        }
                    },
                }
            )
        return scrape_specs
    def scrape_pages(self, scrape_specs, scrape_timeout_s: int = 30):
        """
        Fan-out scrapes. Fan-in when all scrapes are considered done.

        A scrape is considered done if:
        - its on_complete callback fires, OR
        - its watchdog timeout fires (scrape_timeout_s)

        This prevents the pipeline from hanging forever if some scrape jobs never complete.
        """

        owner_jobs_by_url = {}  # url -> owners job (result of find_owners_from_page_data_callback)
        pending_urls = set()    # urls we are still waiting on (SCRAPE JOBS ONLY)
        timers_by_url = {}      # url -> threading.Timer
        finalized = False

        def clean_owner_results(owner_jobs_map):
            source_entities = {}

            for url, owner_job in owner_jobs_map.items():
                if not getattr(owner_job, "output", None):
                    continue

                if "owners" not in owner_job.output:
                    continue

                for owner_output in owner_job.output["owners"]:
                    if "source_entity" not in owner_output:
                        continue

                    source_entity = owner_output["source_entity"]

                    if source_entity not in source_entities:
                        source_entities[source_entity] = []

                    date = datetime.now(timezone.utc).isoformat()

                    relationship_stub = {
                        "source_entity": source_entity,
                        "target_entity": owner_output["target_entity"],
                        "relation": owner_output["relation"],
                        "is_ownership": True,
                        "evidence": [{
                            "excerpt": owner_output["excerpt"],
                            "source": owner_job.metadata["url"],
                            "date": date
                        }]
                    }

                    source_entities[source_entity].append(relationship_stub)

            merged_stubs = []
            for entity_relationship_stubs in source_entities.values():
                merged = merge_relationship_stubs(entity_relationship_stubs)
                merged_stubs.extend(merged)

            top_down_id_spec = {
                "type": "ensure_top_down_relationships_id",
                "params": {
                    "parent_id": self.id,
                    "input": {
                        "relationships": merged_stubs
                    }
                }
            }

            @returns_awaitable
            async def stubs_fix_wrapper(result):
                return stubs_fix(result)

            def stubs_fix(top_down_job):
                relationships = get_value_safe(top_down_job.output, "relationships", [])
                if len(relationships) == 0:
                    relationships = merged_stubs

                merge_owners_spec = {
                    "type": "get_merged_owners_from_relationships",
                    "params": {
                        "parent_id": self.id,
                        "input": {
                            "relationships": relationships
                        },
                        "metadata": {
                            "view_data": {
                                "note": "merge duplicate owners"
                            }
                        }
                    }
                }

                self.create_child_job(
                    child_label=f"get duplicate owners",
                    spec=merge_owners_spec,
                    on_complete=self.on_get_duplicate_owners,
                    on_update=self.update_handler
                )

            self.create_child_job(
                child_label=f"ensure top down relationships with id",
                spec=top_down_id_spec,
                on_complete=stubs_fix_wrapper,
                on_update=self.update_handler
            )

        def finalize_if_ready():
            nonlocal finalized
            if finalized:
                return
            if len(pending_urls) != 0:
                return
            finalized = True

            # Best effort: cancel any leftover timers (should be none)
            for t in list(timers_by_url.values()):
                try:
                    t.cancel()
                except Exception:
                    pass
            timers_by_url.clear()

            clean_owner_results(owner_jobs_by_url)

        def mark_scrape_done(url: str, reason: str):
            """
            Idempotent: safe to call multiple times.
            """
            # Cancel timer if still pending
            t = timers_by_url.pop(url, None)
            if t is not None:
                try:
                    t.cancel()
                except Exception:
                    pass

            if url in pending_urls:
                pending_urls.remove(url)

            # Optional: log the reason for debugging
            # (You can remove this if it's too noisy)
            try:
                self._append_history({
                    "timestamp": datetime.now().isoformat(),
                    "event": "SCRAPE_DONE",
                    "details": {"url": url, "reason": reason}
                })
            except Exception:
                pass

            finalize_if_ready()

        def start_watchdog(url: str):
            """
            If the scrape job never calls back, this timer will advance the barrier.
            """
            def on_timeout():
                # We intentionally do NOT try to kill the child job here (framework dependent).
                # We just stop waiting on it so the pipeline can proceed.
                mark_scrape_done(url, reason=f"timeout_after_{scrape_timeout_s}s")

            t = threading.Timer(scrape_timeout_s, on_timeout)
            t.daemon = True
            timers_by_url[url] = t
            t.start()

        def on_owner_job_complete(url: str, owners_job):
            # Collect whatever arrives; collation happens when all scrapes are "done"
            owner_jobs_by_url[url] = owners_job

        def on_scrape(scrape_job):
            # Recover url reliably
            url = None
            try:
                url = scrape_job.output.get("url", None)
            except Exception:
                url = None
            if not url:
                url = get_value_safe(scrape_job.metadata, "url", None)

            if not url:
                # Don't block the barrier forever on unknown url
                url = f"__unknown_url__::{uuid4()}"

            try:
                status_code = get_value_safe(scrape_job.output, "status_code", None)

                if status_code == 200:
                    @returns_awaitable
                    def owners_complete_wrapper(result):
                        return owners_complete(result)

                    def owners_complete(result):
                        on_owner_job_complete(url, result)

                    # Launch owners extraction; NOTE: this does NOT affect the scrape barrier
                    self.find_owners_from_scrape(
                        page_data=scrape_job.output["result"],
                        url=scrape_job.output["url"],
                        parent_id=self.id,
                        on_complete=owners_complete_wrapper,
                    )

            finally:
                # Scrape job completed (success or not) → advance barrier
                mark_scrape_done(url, reason="scrape_on_complete")

        # ---- Fan-out: create scrape jobs and seed pending set + watchdog timers ----
        for spec in scrape_specs:
            url = spec["params"]["input"]["url"]
            if not url:
                continue
            if url in pending_urls:
                continue

            pending_urls.add(url)

            # Ensure url is always available in callback
            spec.setdefault("params", {}).setdefault("metadata", {})
            spec["params"]["metadata"]["url"] = url

            # Start watchdog BEFORE creating job, so even immediate hangs are covered
            start_watchdog(url)

            self.create_child_job(
                child_label=f"{url}",
                spec=spec,
                on_update=self.update_handler,
                on_complete=on_scrape,
            )

        # Edge case: no scrapes at all
        finalize_if_ready()


    def on_get_duplicate_owners(self, get_duplicate_owners_job):
        if "entities" not in get_duplicate_owners_job.output:
            return

        merged_entities = get_duplicate_owners_job.output["entities"]
        entities = []

        def matches_target_entity(entity):
            if entity.name == self._entity.name:
                return True

            if entity.name in self._entity.aliases:
                return True

            if self._entity.name in entity.aliases:
                return True

            return bool(set(self._entity.aliases) & set(entity.aliases))

        for entity_name, aliases in merged_entities.items():
            entity = Entity(
                name=entity_name,
                aliases=aliases,
                entity_type="ORG"
            )

            if not matches_target_entity(entity):
                entities.append(entity)

        def get_entity_from_alias(alias):
            for entity in entities:
                if entity.name == alias or alias in entity.aliases:
                    return entity

            if self._entity.name == alias or alias in self._entity.aliases:
                return self._entity
            return None

        evidence_links = []
        for relationship_stub in get_duplicate_owners_job.input["relationships"]:
            relationship_stub["evidence_ids"] = []

            for evidence_obj in relationship_stub["evidence"]:
                evidence = Evidence(
                    excerpt=evidence_obj["excerpt"],
                    source=evidence_obj["source"],
                    date=evidence_obj["date"],
                )

                relationship_stub["evidence_ids"].append(evidence.id)
                evidence_links.append(evidence)

        relationships = []
        for relationship_stub in get_duplicate_owners_job.input["relationships"]:
            source_entity = get_entity_from_alias(relationship_stub["source_entity"])
            target_entity = get_entity_from_alias(relationship_stub["target_entity"])

            if source_entity is None or target_entity is None:
                print(f"source_entity or target_entity is somehow None - {relationship_stub}")
                continue

            relationship = Relationship(
                source_entity_id=source_entity.id,
                target_entity_id=target_entity.id,
                relation=relationship_stub["relation"],
                is_ownership=True,
                evidence_ids=relationship_stub["evidence_ids"],
            )

            relationships.append(relationship)

        self.set_output({
            "target_entity": self._entity,
            "entities": entities,
            "evidence_links": evidence_links,
            "relationships": relationships
        })
        self.complete()
    
    def find_owners_from_scrape(self, page_data, url, parent_id, on_complete):
        print("finding owners from scrape")
        spec = {
            "type": "find_owners_from_page_data_callback",
            "params": {
                "parent_id": parent_id,
                "input": {"company": self._company, "context": self._context, "page_data": page_data},
                "metadata": {
                    "url": url,
                    "view_data": {
                        "note": "find owners page data"
                    }
                },
            },
        }

        self.create_child_job(
            child_label=f"find owners from data {self._company} :: {url}",
            spec=spec,
            on_update=self.update_handler,
            on_complete=on_complete
        )

def merge_relationship_stubs (relationship_stubs):
    merged = {}
    for relationship_stub in relationship_stubs:
        key = (relationship_stub["source_entity"],
               relationship_stub["target_entity"],
               relationship_stub["relation"])

        if key not in merged:
            merged[key] = {
                "id": str(uuid4()),
                "source_entity": relationship_stub["source_entity"],
                "target_entity": relationship_stub["target_entity"],
                "relation": relationship_stub["relation"],
                "evidence": []
            }

        existing_evidence = merged[key]["evidence"]
        seen = {(e["excerpt"], e["source"], e["date"]) for e in existing_evidence}

        for evidence in relationship_stub["evidence"]:
            evidence_key = (evidence["excerpt"],
                            evidence["source"],
                            evidence["date"])

            if evidence_key not in seen:
                existing_evidence.append(evidence)
                seen.add(evidence_key)

    return list(merged.values())