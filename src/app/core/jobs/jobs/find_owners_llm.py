from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from pydantic import PrivateAttr

from app.core.db.models import Evidence, Relationship, Entity
from app.core.jobs.job import Job
from app.core.jobs.job_status import JobStatus
from app.util.get_value_safe import get_value_safe
from app.util.markers import returns_awaitable
from app.core.db.database_service import DatabaseService

from fast_json_repair import loads

logger = logging.getLogger(__name__)

@Job.register(name="find_owners_llm")
class FindOwnersLlm(Job):
    """
    LLM-first replacement for `find_owners_callback`.

    Pipeline:
      1) Resolve/ensure the target Entity (get_or_create_entity_job).
      2) Spawn `find_company_parents_and_investors` as a child job.
      3) Convert/merge its results into the same output shape used by `FindOwnersCallback`
         (target_entity/entities/evidence_links/relationships), without changing existing field structures.
         Extra raw data may be included under additional top-level keys.
    """

    requirements: Dict[str, Any] = {"cpu": 1, "net": 1}

    label: str = "Find Owners - LLM"
    description: str = "Find owners (and optionally investors) of a company using LLM agents."

    _company: str = PrivateAttr(default="")
    _context: str = PrivateAttr(default="")
    _entity: Optional[Entity] = PrivateAttr(default=None)
    _entity_id: str = PrivateAttr(default="")

    async def run(self, platform: str):
        await super().run(platform)

        # If an Entity object is already provided, skip the get_or_create step.
        input_entity = get_value_safe(self.input, "entity", None)
        if input_entity is not None:
            entity = Entity()
            entity.deserialize(input_entity)
            self._entity_id = entity.id
            await self.on_target_entity_found(entity)
            return

        self._entity_id = self.input.get("entity_id", None)

        if self._entity_id is None:
            self._company = self.input.get("company", None) or ""
            self._context = self.input.get("context", None) or ""

        if self._entity_id:
            get_entity_spec = {
                "type": "get_or_create_entity_job",
                "params": {
                    "parent_id": self.id,
                    "input": {
                        "entity_id": self._entity_id,
                        "name": self._company or None,
                        "context": self._context or None,
                        "entity_type": "ORG",
                    },
                },
            }

            @returns_awaitable
            async def on_target_entity_found_wrapper(result):
                return await on_target_entity_found(result)

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
            return

        # If we didn't have an entity_id, we still need an Entity so we can match callback output shape.
        # Use the same get_or_create flow.
        if not self._company:
            raise ValueError("find_owners_llm requires either entity/entity_id OR company name in input.")

        get_entity_spec = {
            "type": "get_or_create_entity_job",
            "params": {
                "parent_id": self.id,
                "input": {
                    "entity_id": None,
                    "name": self._company,
                    "context": self._context,
                    "entity_type": "ORG",
                },
            },
        }

        @returns_awaitable
        async def on_target_entity_found_wrapper(result):
            return await on_target_entity_found(result)

        async def on_target_entity_found(result):
            output = getattr(result, "output", result)
            self._entity_id = output.id
            await self.on_target_entity_found(output)

        self.create_child_job(
            child_label=f"get_entity {self._company}",
            spec=get_entity_spec,
            on_update=self.update_handler,
            on_complete=on_target_entity_found_wrapper,
        )

    def update_handler(self, event):
        pass

    async def on_target_entity_found(self, entity: Entity):

        service = DatabaseService.get()
        last_owner_search = entity.metadata.get("last_owner_search", """{"status": "none"}""")
        last_owner_search = loads(last_owner_search)
        owner_relationships = await service.find_ownership_relationships(entity.id)

        if last_owner_search["status"] == "complete":
            owner_entities = {}

            output = {
                "target_entity": entity.to_serializeable_object(),
                "entities": [],
                "relationships": []
            }

            for relationship in owner_relationships:
                if relationship.source_entity_id not in owner_entities.keys():
                    source_entity = await service.get_entity(relationship.source_entity_id)
                    owner_entities[relationship.source_entity_id] = source_entity.to_serializeable_object()

                output["relationships"].append(relationship.to_serializeable_object())

            for owner_entity in owner_entities.values():
                output["entities"].append(owner_entity)

            self._set_output(output)
            self.complete(output)
            return
        else:
            entity.metadata["last_owner_search"] = {
                "status": "started",
                "date": str(datetime.now().isoformat())
            }
            await service.update_entity(entity, self)

        self._entity = entity
        self._entity_id = entity.id

        # Normalize company/context for downstream jobs.
        self._company = entity.name or self._company
        self._context = getattr(entity, "context", None) or self._context

        self.description = f"Find owners of {self._company}"

        # Spawn the consolidated child job.
        spec = {
            "type": "find_company_parents_and_investors_2",
            "params": {
                "parent_id": self.id,
                "input": {
                    # Shared input forwarded to `find_parent_companies` and `find_investors`.
                    "entity_name": self._company,
                    "context": self._context or None,
                    # Optional context passthrough (future-proofing)
                    "country": self.input.get("country", None),
                    "industry": self.input.get("industry", None),
                    "known_aliases": self.input.get("known_aliases", None),
                    # Keep original fields too (harmless, may help future agents)
                    "company": self.input.get("company", None),
                    "entity_id": self._entity_id,
                },
                "metadata": {
                    "view_data": {
                        "note": "find company parents and investors"
                    }
                },
            },
        }

        self.create_child_job(
            child_label=f"find_company_parents_and_investors - {self._company}",
            spec=spec,
            on_update=self.update_handler,
            on_complete=self.on_llm_results_wrapper,
        )

    def _utc_now_iso(self) -> str:
        return datetime.now(timezone.utc).isoformat()

    async def _finalize_owner_output(
        self,
        *,
        service: DatabaseService,
        entities_resolved: Dict[str, Dict[str, Any]],
        relationships: List[Relationship],
    ) -> None:
        target_entity = self._entity
        if target_entity is not None:
            target_entity.metadata["last_owner_search"] = {
                "status": "complete",
                "date": str(datetime.now().isoformat()),
            }
            await service.update_entity(target_entity, self)
            target_entity_serialized = target_entity.to_serializeable_object()
        else:
            logger.warning(
                "[find_owners_llm] Missing target entity during finalize; entity_id=%r company=%r",
                self._entity_id,
                self._company,
            )
            target_entity_serialized = {
                "id": self._entity_id,
                "name": self._company,
                "entity_type": "ORG",
                "aliases": [],
                "tags": [],
                "context": self._context,
                "metadata": {},
            }

        serialized_entities = []
        for resolved_entity in entities_resolved.values():
            entity_obj = resolved_entity["entity"]
            if hasattr(entity_obj, "to_serializeable_object"):
                serialized_entities.append(entity_obj.to_serializeable_object())
            elif isinstance(entity_obj, dict):
                serialized_entities.append(entity_obj)

        serialized_relationships = []
        for relationship in relationships:
            if hasattr(relationship, "to_serializeable_object"):
                serialized_relationships.append(relationship.to_serializeable_object())
            elif isinstance(relationship, dict):
                serialized_relationships.append(relationship)

        output = {
            "target_entity": target_entity_serialized,
            "entities": serialized_entities,
            "relationships": serialized_relationships,
        }

        self._set_output(output)
        self.complete(output)

    @returns_awaitable
    def on_llm_results_wrapper(self, child_job):
        return self.on_llm_results(child_job)

    async def on_llm_results(self, child_job):
        """
        Convert the consolidated child job output to the classic callback output structure:
          {
            "target_entity": Entity,
            "entities": [Entity],
            "evidence_links": [Evidence],
            "relationships": [Relationship],
            ...optional extra keys...
          }
        """
        try:
            raw_output = get_value_safe(child_job, "output", {}) or {}
            raw = get_value_safe(raw_output, "result", raw_output)
            if not isinstance(raw, dict):
                logger.warning(
                    "[find_owners_llm] Unexpected aggregate result type=%s; defaulting to empty graph",
                    type(raw).__name__,
                )
                raw = {}

            raw_entities = get_value_safe(raw, "entities", [])
            raw_relationships = get_value_safe(raw, "relationships", [])

            if not isinstance(raw_entities, list):
                logger.warning(
                    "[find_owners_llm] aggregate result 'entities' is not list; type=%s",
                    type(raw_entities).__name__,
                )
                raw_entities = []

            if not isinstance(raw_relationships, list):
                logger.warning(
                    "[find_owners_llm] aggregate result 'relationships' is not list; type=%s",
                    type(raw_relationships).__name__,
                )
                raw_relationships = []

            service = DatabaseService.get()

            if len(raw_entities) == 0:
                logger.info(
                    "[find_owners_llm] aggregate returned entities=0; continuing with empty owners. target=%r relationships=%s",
                    self._company or self._entity_id,
                    len(raw_relationships),
                )
                self._append_history(
                    {
                        "timestamp": datetime.now().isoformat(),
                        "event": "ZERO_OWNER_ENTITIES",
                        "details": {
                            "target": self._company or self._entity_id,
                            "relationships_count": len(raw_relationships),
                        },
                    }
                )
                if len(raw_relationships) > 0:
                    logger.warning(
                        "[find_owners_llm] relationships present without entities; skipping relationship persistence. target=%r",
                        self._company or self._entity_id,
                    )
                await self._finalize_owner_output(service=service, entities_resolved={}, relationships=[])
                return

            entities_to_resolve: List[Dict[str, Any]] = []
            seen_entity_keys: set[str] = set()
            for index, raw_entity in enumerate(raw_entities):
                if not isinstance(raw_entity, dict):
                    logger.warning(
                        "[find_owners_llm] Skipping non-object aggregate entity index=%s value=%r",
                        index,
                        raw_entity,
                    )
                    continue

                entity_name = str(get_value_safe(raw_entity, "name", "") or "").strip()
                if len(entity_name) == 0:
                    logger.warning(
                        "[find_owners_llm] Skipping aggregate entity with empty name index=%s value=%s",
                        index,
                        raw_entity,
                    )
                    continue

                entity_type = str(get_value_safe(raw_entity, "entity_type", "ORG") or "ORG")
                dedupe_key = f"{entity_name.casefold()}::{entity_type.casefold()}"
                if dedupe_key in seen_entity_keys:
                    logger.info(
                        "[find_owners_llm] Skipping duplicate aggregate entity name=%r type=%r",
                        entity_name,
                        entity_type,
                    )
                    continue

                seen_entity_keys.add(dedupe_key)
                entities_to_resolve.append(
                    {
                        "name": entity_name,
                        "entity_type": entity_type,
                        "entity_raw": raw_entity,
                    }
                )

            if len(entities_to_resolve) == 0:
                logger.warning(
                    "[find_owners_llm] aggregate entities became empty after validation; continuing with empty owners. target=%r",
                    self._company or self._entity_id,
                )
                self._append_history(
                    {
                        "timestamp": datetime.now().isoformat(),
                        "event": "ZERO_VALID_OWNER_ENTITIES",
                        "details": {
                            "target": self._company or self._entity_id,
                            "raw_entities_count": len(raw_entities),
                        },
                    }
                )
                await self._finalize_owner_output(service=service, entities_resolved={}, relationships=[])
                return

            entities_resolved: Dict[str, Dict[str, Any]] = {}
            relationships: List[Relationship] = []
            expected_callbacks = len(entities_to_resolve)
            callbacks_seen = 0
            finalized = False

            def _norm_name(value: Any) -> str:
                if value is None:
                    return ""
                return str(value).strip().casefold()

            def get_entity(name) -> Optional[Entity]:
                nonlocal entities_resolved

                lookup = _norm_name(name)
                if not lookup:
                    return None

                for entity_link in entities_resolved.values():
                    entity = entity_link["entity"]
                    entity_name = get_value_safe(entity, "name", "")
                    entity_aliases = get_value_safe(entity, "aliases", []) or []

                    if lookup == _norm_name(entity_name):
                        return entity

                    for alias in entity_aliases:
                        if lookup == _norm_name(alias):
                            return entity

                    raw_name = get_value_safe(entity_link["entity_raw"], "name", "")
                    if lookup == _norm_name(raw_name):
                        return entity

                return None

            async def finalize_if_ready():
                nonlocal finalized
                if finalized:
                    return
                if callbacks_seen < expected_callbacks:
                    return

                finalized = True

                if len(entities_resolved) < expected_callbacks:
                    logger.warning(
                        "[find_owners_llm] Entity resolution partial; resolved=%s expected=%s target=%r",
                        len(entities_resolved),
                        expected_callbacks,
                        self._company or self._entity_id,
                    )
                    self._append_history(
                        {
                            "timestamp": datetime.now().isoformat(),
                            "event": "PARTIAL_ENTITY_RESOLUTION",
                            "details": {
                                "resolved": len(entities_resolved),
                                "expected": expected_callbacks,
                                "target": self._company or self._entity_id,
                            },
                        }
                    )

                for relationship in raw_relationships:
                    if not isinstance(relationship, dict):
                        logger.warning(
                            "[find_owners_llm] Skipping non-object relationship value=%r",
                            relationship,
                        )
                        continue

                    target_entity = get_entity(relationship.get("target_entity"))
                    source_entity = get_entity(relationship.get("source_entity"))

                    source_entity_id = get_value_safe(source_entity, "id", "")
                    target_entity_id = get_value_safe(target_entity, "id", "")

                    source_entity_id = str(source_entity_id or "").strip()
                    target_entity_id = str(target_entity_id or "").strip()

                    if len(source_entity_id) == 0 or len(target_entity_id) == 0:
                        logger.warning(
                            "[find_owners_llm] Skipping invalid relationship. source_lookup=%r target_lookup=%r relationship=%s",
                            relationship.get("source_entity"),
                            relationship.get("target_entity"),
                            relationship,
                        )

                        self._append_history(
                            {
                                "timestamp": datetime.now().isoformat(),
                                "event": "INVALID_RELATIONSHIP",
                                "details": {
                                    "reason": "unresolved_or_empty_endpoint_id",
                                    "relationship": relationship,
                                    "source_lookup": relationship.get("source_entity"),
                                    "target_lookup": relationship.get("target_entity"),
                                    "source_entity_id": source_entity_id,
                                    "target_entity_id": target_entity_id,
                                    "resolved_entities": [
                                        get_value_safe(resolved["entity"], "name", "") for resolved in entities_resolved.values()
                                    ],
                                },
                            }
                        )
                        continue

                    evidence_ids = []
                    evidence_list = get_value_safe(relationship, "evidence", [])
                    if not isinstance(evidence_list, list):
                        evidence_list = []

                    for evidence in evidence_list:
                        if not isinstance(evidence, dict):
                            continue

                        excerpt = str(get_value_safe(evidence, "excerpt", "") or "").strip()
                        source = str(get_value_safe(evidence, "source", "") or "").strip()
                        if len(excerpt) == 0 or len(source) == 0:
                            continue

                        evidence_id = await service.add_evidence(
                            Evidence(
                                excerpt=excerpt,
                                source=source,
                            )
                        )

                        evidence_ids.append(evidence_id)

                    try:
                        added_relationship_id = await service.add_relationship(
                            Relationship(
                                source_entity_id=source_entity_id,
                                target_entity_id=target_entity_id,
                                relation=str(get_value_safe(relationship, "relation", "owns") or "owns"),
                                evidence_ids=evidence_ids,
                                is_ownership=True,
                            )
                        )
                        added_relationship = await service.get_relationship(added_relationship_id)
                        if added_relationship is not None:
                            relationships.append(added_relationship)
                    except Exception as exc:
                        logger.exception(
                            "[find_owners_llm] Failed adding relationship. relationship=%s source_entity_id=%s target_entity_id=%s",
                            relationship,
                            source_entity_id,
                            target_entity_id,
                        )
                        self._append_history(
                            {
                                "timestamp": datetime.now().isoformat(),
                                "event": "RELATIONSHIP_PERSIST_FAILED",
                                "details": {
                                    "error": str(exc),
                                    "relationship": relationship,
                                    "source_entity_id": source_entity_id,
                                    "target_entity_id": target_entity_id,
                                },
                            }
                        )

                await self._finalize_owner_output(
                    service=service,
                    entities_resolved=entities_resolved,
                    relationships=relationships,
                )

            @returns_awaitable
            def on_entity_resolved_wrapper (result):
                return on_entity_resolved(result)

            async def on_entity_resolved (get_entity_job):
                nonlocal callbacks_seen
                callbacks_seen += 1

                job_output = get_value_safe(get_entity_job, "output", {}) or {}
                entity = get_value_safe(job_output, "result", None)
                job_input = get_value_safe(get_entity_job, "input", {}) or {}
                if not isinstance(job_input, dict):
                    job_input = {}
                entity_raw = get_value_safe(job_input, "entity_raw", {})

                if entity is None:
                    logger.warning(
                        "[find_owners_llm] get_or_create_entity_job returned no entity; callback=%s/%s entity_raw=%s",
                        callbacks_seen,
                        expected_callbacks,
                        entity_raw,
                    )
                    self._append_history(
                        {
                            "timestamp": datetime.now().isoformat(),
                            "event": "ENTITY_RESOLUTION_EMPTY",
                            "details": {
                                "callback_index": callbacks_seen,
                                "expected_callbacks": expected_callbacks,
                                "entity_raw": entity_raw,
                            },
                        }
                    )
                    await finalize_if_ready()
                    return

                nonlocal entities_resolved
                entity_id = str(get_value_safe(entity, "id", "") or "").strip()
                if len(entity_id) == 0:
                    logger.warning(
                        "[find_owners_llm] Resolved entity missing id; callback=%s/%s entity=%s",
                        callbacks_seen,
                        expected_callbacks,
                        entity,
                    )
                    self._append_history(
                        {
                            "timestamp": datetime.now().isoformat(),
                            "event": "ENTITY_RESOLUTION_MISSING_ID",
                            "details": {
                                "callback_index": callbacks_seen,
                                "expected_callbacks": expected_callbacks,
                                "entity": entity,
                            },
                        }
                    )
                    await finalize_if_ready()
                    return

                entities_resolved[entity_id] = {
                    "entity": entity,
                    "entity_raw": entity_raw,
                }

                await finalize_if_ready()

            for index, entity in enumerate(entities_to_resolve):
                get_entity_spec = {
                    "type": "get_or_create_entity_job",
                    "params": {
                        "parent_id": self.id,
                        "input": {
                            "name": entity["name"],
                            "entity_type": entity["entity_type"],
                            "entity_raw": entity
                        },
                    },
                }

                self.create_child_job(
                    child_label=f"get_entity -- {entity['name']} -- {index}",
                    spec=get_entity_spec,
                    on_update=self.update_handler,
                    on_complete=on_entity_resolved_wrapper,
                )

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
