from __future__ import annotations

from typing import Any, Dict, List, Optional
from pydantic import PrivateAttr
import re
from datetime import datetime
import json

from app.core.jobs.job import Job
from app.core.jobs.jobs.llm_callback_job import LlmCallbackJob
from app.core.db.database_service import DatabaseService
from app.core.db import Entity, Evidence

from fast_json_repair import loads
from app.util.clean_json_response import custom_repair_json
from app.util.get_value_safe import get_value_safe
from app.util.markers import returns_awaitable

@Job.register(name="identify_company_from_name_multi")
class IdentifyCompanyFromNameMulti(Job):

    label: str = "Identify Company From Name (Multi-step)"
    description: str = "Identify a company using name + optional context by gathering evidence then synthesizing a profile."

    _results: Dict[str, Any] = PrivateAttr(default_factory=dict)

    def update_handler(self, event):
        pass

    async def run(self, platform: str):
        await super().run(platform)

        entity = self.input["entity"]

        gather_spec = {
            "type": "identify_company_gather_evidence",
            "params": {
                "parent_id": self.parent_id,
                "input": {
                    "entity": entity
                },
            },
            "metadata": {
                "internal_job_key": "gather",
                "view_data": {"note": "gather evidence"},
            },
        }

        self.create_child_job(
            child_label="gather evidence",
            spec=gather_spec,
            on_update=self.update_handler,
            on_complete=self.on_internal_job_result_wrapper,
        )

    def synthesize_pass(self):
        entity = self.input["entity"]

        synth_spec = {
            "type": "identify_company_synthesize_identity",
            "params": {
                "parent_id": self.parent_id,
                "input": {
                    "entity": entity,
                    "gathered": self._results["gather"],
                },
            },
            "metadata": {
                "internal_job_key": "synthesize",
                "view_data": {"note": "synthesize identity"},
            },
        }

        self.create_child_job(
            child_label="synthesize identity",
            spec=synth_spec,
            on_update=self.update_handler,
            on_complete=self.on_internal_job_result_wrapper,
        )

    def categorize_pass (self):
        synth = self._results["synthesize"]

        categorize_spec = {
            "type": "categorize_company",
            "params": {
                "parent_id": self.parent_id,
                "input": {
                    "synth": synth,
                },
            },
            "metadata": {
                "internal_job_key": "categorize",
                "view_data": {"note": "categorize identity"},
            },
        }

        self.create_child_job(
            child_label="categorize identity",
            spec=categorize_spec,
            on_update=self.update_handler,
            on_complete=self.on_internal_job_result_wrapper
        )

    @returns_awaitable
    def on_internal_job_result_wrapper(self, job):
        return self.on_internal_job_result(job)

    async def on_internal_job_result (self, job):
        if len(self._results) == 3:
            return

        key = job.metadata["internal_job_key"]
        self._results[key] = job.output

        if key == "gather":
            self.synthesize_pass()
            return

        if key == "synthesize":
            self.categorize_pass()
            return
        
        if key == "categorize":
            await self.finalize()

    async def finalize (self):
        print(json.dumps(self._results))
        synth = self._results["synthesize"]
        categorize = self._results["categorize"]

        service = DatabaseService.get()
        
        evidence_ids = []
        for evidence in synth["evidence"]:
            evidence_id = await service.add_evidence(
                Evidence(
                    excerpt=evidence["excerpt"],
                    source=evidence["source"]
                )
            )

            evidence_ids.append(evidence_id)
            
        entity = self.input["entity"]
        try:
            entity["evidence_ids"] = entity["evidence_ids"]  + evidence_ids
            entity["tags"] = entity["tags"] + synth["tags"]
            entity["aliases"] = entity["aliases"] + synth["aliases"]
            entity["aliases"].append(entity["name"])
            entity["metadata"]["last_identification"] = datetime.now().isoformat()
            entity["metadata"]["categorization"] = categorize
            entity["metadata"]["raw_identification_output"] = self._results
            entity["notes"] = synth["notes"]
            top_dog = (categorize["category"].lower().startswith("r") == False)
            entity["top_dog"] = top_dog
        except Exception as e:
            print(str(e))
            print(entity)

        updated_entity = Entity()
        updated_entity.deserialize(entity)
        
        successfully_updated = await service.update_entity(updated_entity, self)

        final_obj = {
            "results_raw": self._results,
            "entity": entity,
            "successfully_updated": successfully_updated,
        }

        self.set_output({"result": final_obj})
        self.complete()