from datetime import datetime
from typing import Any, Dict
from app.core.jobs.job import Job
from app.core.jobs.jobs.llm_callback_job import LlmCallbackJob
from app.core.jobs.job_status import JobStatus
from app.edge.edge_runner_factory import get_edge_runner
from app.functions.get_llm_response import get_llm_response
from app.util.get_value_safe import get_value_safe
from app.core.db.database_service import DatabaseService
from pydantic import PrivateAttr
from app.core.db import Entity
import os
from app.config import NetConfig
from app.util.markers import returns_awaitable
from app.util.get_searchable_name_prefix import get_searchable_name_prefix
from app.util.dedupe_by_property import dedupe_by_property

@Job.register(name="get_or_create_entity_job")
class GetOrCreateEntityCallback(Job):
    requirements: Dict[str, Any] = {
        "cpu": 1,
        "gpu": 1,
    }

    label: str = "Get Or Create Entity"
    description: str = "Gets or creates an entity from Weaviate."

    async def run(self, platform: str):
        await super().run(platform)

        validate_like_with_llm = True

        name = get_value_safe(self.input, "name", None)
        tags = get_value_safe(self.input, "tags", None)
        near_text = get_value_safe(self.input, "near_text", None)
        context = get_value_safe(self.input, "context", "")
        entity_type = get_value_safe(self.input, "entity_type", None)
        min_confidence = get_value_safe(self.input, "min_confidence", 0.95)

        service = DatabaseService.get()
            
        entity = await service.get_entity_by_name(name)

        if entity is not None:
            self._set_output({"result": entity})
            self.complete()
            return

        entities = await service.get_entities_with_alias(name)

        if len(entities) >= 1:
            entity = entities[0]
            self._set_output({"result": entity})
            self.complete()
            return

        entities = await service.get_entities_like(name)

        if len(entities) == 1:
            entity = entities[0]

            if validate_like_with_llm:
                @returns_awaitable
                def on_compare_wrapper (result):
                    return on_compare(result)

                async def on_compare (compare_job):
                    same_entity = compare_job.output["same_entity"]

                    if same_entity:
                        self._set_output({"result": entity})
                        self.complete()
                    else:
                        await self.run_deep_search()

                compare_entities_spec = {
                    "type": "compare_entities",
                    "params": {
                        "parent_id": self.id,
                        "input": {
                            "source_entity": {
                                "name": name,
                                "tags": tags,
                                "context": context,
                                "entity_type": entity_type
                            },
                            "target_entity": entity.to_serializeable_object(),
                            "min_confidence": min_confidence
                        }
                    }
                }

                self.create_child_job(
                    child_label="compare_entities",
                    spec=compare_entities_spec,
                    on_complete=on_compare_wrapper)
            else:
                self._set_output({"result": entity})
                self.complete()
                return
        else:
            await self.run_deep_search()
        
    async def run_deep_search (self):
        name = get_value_safe(self.input, "name", None)
        tags = get_value_safe(self.input, "tags", None)
        near_text = get_value_safe(self.input, "near_text", None)
        context = get_value_safe(self.input, "context", "")
        entity_type = get_value_safe(self.input, "entity_type", None)
        min_confidence = get_value_safe(self.input, "min_confidence", 0.95)

        service = DatabaseService.get()
        entities = None
        if near_text is not None:
            entities_near_text =await service.get_entities_near_text(near_text)
        
        entities_near_text_name = await service.get_entities_near_text(name)

        entities_contains = await service.get_entities_contains(name)

        searchable_name = get_searchable_name_prefix(name, 8)
        entities_starts_with = await service.get_entities_starts_with(searchable_name)

        entities = entities_near_text_name + entities_near_text_name + entities_contains + entities_starts_with
        entities = dedupe_by_property(entities, "id")
        
        if entities is not None and len(entities) > 0:
            transportable_entities = []
            for entity in entities:
                transportable_entity = {
                    "id": entity.id,
                    "name": entity.name,
                    "aliases": get_value_safe(entity, "aliases", []),
                    "entity_type": get_value_safe(entity, "entity_type", "ORG"),
                    "tags": get_value_safe(entity, "tags", []),
                    "context": get_value_safe(entity, "context", ""),
                }
                
                transportable_entities.append(transportable_entity)
            get_most_likely_entity_spec = {
                "type": "get_most_likely_entity_from_llm_callback",
                "params": {
                    "parent_id": self.id,
                    "input": {
                        "entities": transportable_entities,
                        "entity_name": name,
                        "tags": tags,
                        "context": context,
                        "min_confidence": min_confidence,
                    }
                }
            }

            headers = {"Content-Type": "application/json"}

            @returns_awaitable
            def on_likely_entity_result_wrapper(result):
                return on_likely_entity_result(result)

            async def on_likely_entity_result (likely_entity_job):
                result_is_none = (likely_entity_job.output is None or
                                  "result" not in likely_entity_job.output or
                                  likely_entity_job.output["result"] is None)

                service = DatabaseService.get()

                if result_is_none:

                    entity_id = await service.add_entity(
                        Entity(
                            name=name,
                            tags=tags,
                            context=context,
                            entity_type=entity_type
                        )
                    )
                    
                    entity = await service.get_entity(entity_id)
                    self._set_output({"result": entity})
                    self.complete()
                    return
                else:
                    entity_id = likely_entity_job.output["result"]["id"]

                    entity = await service.get_entity(entity_id)
                    entity.add_alias(name)
                    
                    self._set_output({"result": entity})
                    self.complete()
                    return

            self.create_child_job(
                child_label="get_most_likely_entity_from_llm_callback",
                spec=get_most_likely_entity_spec,
                on_complete=on_likely_entity_result_wrapper)
        else:
            entity_id = await service.add_entity(
                Entity(
                    name=name,
                    context=context,
                    entity_type=entity_type
                )
            )

            entity = await service.get_entity(entity_id)

            self._set_output({"result": entity})
            self.complete()
            return
