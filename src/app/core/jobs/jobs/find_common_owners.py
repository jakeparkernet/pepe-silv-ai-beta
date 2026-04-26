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
import requests
import threading
import queue
from time import sleep
from datetime import datetime
from typing import Any, Dict, List
from app.core.jobs.job import Job
from app.core.jobs.jobs.llm_callback_job import LlmCallbackJob
from app.core.jobs.job_status import JobStatus
from app.edge.edge_runner_factory import get_edge_runner
from app.functions.clean_brave_results import clean_results
from app.core.runtime.job_batcher import get_batcher
from app.core.db.database_service import DatabaseService
from app.core.db.models import Evidence, Relationship, Entity
from pydantic import PrivateAttr
from concurrent.futures import ThreadPoolExecutor, as_completed
from app.config import NetConfig
from app.util.markers import returns_awaitable
from app.util.get_value_safe import get_value_safe

@Job.register(name="find_common_owners")
class FindCommonOwners(Job):
    
    label: str = "Find Common Owners"
    description: str = "Finds the common owners betwixt two companies."

    async def run(self, platform: str):
        await super().run(platform)

        entity_a = self.input.get("entity_a")
        entity_b = self.input.get("entity_b")

        service = DatabaseService.get()
            
        if isinstance(self.input.get("entity_a"), str):
            entity_a = await service.get_entity_by_name(self.input.get("entity_a"))

            if entity_a is None:
                entities = await service.get_entities_with_alias(entity_a)

                if len(entities) >= 1:
                    entity_a = entities[0]
        elif isinstance(entity_a, dict):
            entity_a = Entity()
            entity_a.deserialize(self.input.get("entity_a"))

        if isinstance(self.input.get("entity_b"), str):
            entity_b = await service.get_entity_by_name(self.input.get("entity_b"))

            if entity_b is None:
                entities = await service.get_entities_with_alias(entity_b)

                if len(entities) >= 1:
                    entity_b = entities[0]
        elif isinstance(entity_b, dict):
            entity_b = Entity()
            entity_b.deserialize(self.input.get("entity_b"))

        if entity_a is None or entity_b is None:
            print("One or both entities could not be found")

        common_owner_data = await service.find_common_owners_between_entities(
            entity_a=entity_a,
            entity_b=entity_b
        )
        self.set_output(common_owner_data)
        self.complete()