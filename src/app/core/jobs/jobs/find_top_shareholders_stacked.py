from datetime import datetime
from typing import Any, Dict, Optional
from app.core.jobs.job import Job
from app.core.jobs.jobs.llm_callback_job import LlmCallbackJob
from app.core.jobs.job_status import JobStatus
from app.edge.edge_runner_factory import get_edge_runner
from app.functions.get_llm_response import get_llm_response
from fast_json_repair import loads
from app.util.clean_json_response import custom_repair_json
from pydantic import Field, PrivateAttr
from app.util.markers import returns_awaitable
from app.core.db.database_service import DatabaseService
from app.util.get_value_safe import get_value_safe
from app.core.db.models import Evidence, Relationship, Entity

@Job.register(name="find_top_shareholders_stacked")
class FindTopShareholdersStacked(Job):
    requirements: Dict[str, Any] = {
        "cpu": 1,
        "gpu": 1,
    }

    label: str = "Find Top Shareholders Stacked"
    description: str = "Finds the top shareholders in a company."
    
    _entity: Optional[Entity] = PrivateAttr(default=None)
    _results: Dict[str, Any] = PrivateAttr(default_factory=dict)

    def update_handler(self, event):
        pass

    async def run(self, platform: str):
        await super().run(platform)

        find_top_shareholders_llm_spec = {
            "type": "find_top_shareholders",
            "params": {
                "parent_id": self.parent_id,
                    "input": self.input
                },
                "metadata": {
                    "view_data": {
                        "note": "find top shareholders"
                    }
                }
            }

        self.create_child_job(
            child_label="find_top_shareholders",
            spec=find_top_shareholders_llm_spec,
            on_update=self.update_handler,
            on_complete=self.on_top_shareholders_llm,
        )

        get_entity_spec = {
            "type": "get_or_create_entity_job",
            "params": {
                "parent_id": self.id,
                "input": {
                    "name": self.input["entity_name"],
                    "entity_type": "ORG",
                },
            },
        }

        self.create_child_job(
            child_label=f"get_entity {self.input["entity_name"]}",
            spec=get_entity_spec,
            on_update=self.update_handler,
            on_complete=self.on_target_entity_found_wrapper,
        )

    def on_top_shareholders_llm(self, top_shareholders_llm_job):
        llm_response = top_shareholders_llm_job.output
        self._results["top_shareholders_llm"] = llm_response

        if len(self._results) == 2:
            self.normalization_pass(llm_response)

    @returns_awaitable
    async def on_target_entity_found_wrapper(self, result):
        return await self.on_target_entity_found(result)

    async def on_target_entity_found(self, result):
        entity = getattr(result, "output", result)
        
        self._results["target_entity"] = entity
        self._entity = entity["result"]

        if len(self._results) == 2:
            self.normalization_pass(llm_response)

    def normalization_pass (self, llm_response):
        normalization_pass_spec = {
            "type": "normalize_top_shareholders_to_owners",
            "params": {
                "parent_id": self.parent_id,
                    "input": {
                        "investors_response": llm_response
                    }
                },
                "metadata": {
                    "view_data": {
                        "note": "normalization pass"
                    }
                }
            }
        
        self.create_child_job(
            child_label="normalization",
            spec=normalization_pass_spec,
            on_update=self.update_handler,
            on_complete=self.on_normalization_pass,
        )
    
    def on_normalization_pass(self, child_job):
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
            def get_entity(all_entities, name) -> bool:
                for entity in all_entities:
                    if name == entity.name:
                        return entity

                    if name in entity.aliases:
                        return entity

                return None

            raw = getattr(child_job, "output", None) or {}
            service = DatabaseService.get()

            entities_resolved: Dict[str, Entity] = {}
            relationships = []

            @returns_awaitable
            def on_entity_resolved_wrapper (result):
                return on_entity_resolved(result)

            async def on_entity_resolved (get_entity_job):
                entity = get_entity_job.output["result"]

                nonlocal entities_resolved
                nonlocal relationships

                entities_resolved[entity.id] = entity

                if len(entities_resolved) == len(raw["entities"]):
                    for relationship in raw["relationships"]:
                        evidence_ids = []
                        for evidence in relationship["evidence"]:
                            evidence_id = await service.add_evidence(
                                Evidence(
                                    excerpt=evidence["excerpt"],
                                    source=evidence["source"]
                                )
                            )

                            evidence_ids.append(evidence_id)

                        target_entity = get_entity(
                            entities_resolved.values(),
                            relationship["target_entity"]
                        )

                        source_entity = get_entity(
                            entities_resolved.values(),
                            relationship["source_entity"]
                        )

                        added_relationship_id = await service.add_relationship(
                            Relationship(
                                source_entity_id=source_entity.id,
                                target_entity_id=target_entity.id,
                                relation=relationship["relation"],
                                evidence_ids=evidence_ids,
                                is_ownership=True
                            )
                        )

                        added_relationship = await service.get_relationship(
                            added_relationship_id
                        )

                        relationships.append(added_relationship)

                    serialized_entities = []
                    for entity in entities_resolved.values():
                        serialized_entities.append(
                            entity.to_serializeable_object()
                        )

                    serialized_relationships = []
                    for relationship in relationships:
                        serialized_relationships.append(
                            relationship.to_serializeable_object()
                        )

                    entity.metadata["last_owner_search"] = {
                        "status": "complete",
                        "date": str(datetime.now().isoformat())
                    }

                    await service.update_entity(entity, self)

                    output = {
                        "target_entity": self._entity.to_serializeable_object(),
                        "entities": serialized_entities,
                        "relationships": serialized_relationships
                    }

                    self._set_output(output)
                    self.complete(output)

            for entity in raw["entities"]:
                get_entity_spec = {
                    "type": "get_or_create_entity_job",
                    "params": {
                        "parent_id": self.id,
                        "input": {
                            "name": entity["name"],
                            "entity_type": entity["entity_type"]
                        },
                    },
                }

                self.create_child_job(
                    child_label=f"get_entity",
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
