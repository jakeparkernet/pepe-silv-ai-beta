from datetime import datetime
from typing import Any, Dict
from app.core.jobs.job import Job
from app.core.jobs.jobs.llm_callback_job import LlmCallbackJob
from app.core.jobs.job_status import JobStatus
from app.edge.edge_runner_factory import get_edge_runner
from app.functions.get_llm_response import get_llm_response
from fast_json_repair import loads
from app.util.clean_json_response import custom_repair_json
from pydantic import Field, PrivateAttr
from app.util.markers import returns_awaitable

@Job.register(name="find_owners_from_page_data_callback")
class FindOwnersFromPageData(Job):
    requirements: Dict[str, Any] = {
        "cpu": 1,
        "gpu": 1,
    }

    label: str = "Find Owners - Page Data"
    description: str = "Find owners from page data"
    
    def update_handler(self, event):
        pass

    async def run(self, platform: str):
        await super().run(platform)

        extraction_pass_spec = {
            "type": "run_extract_owners_pass",
            "params": {
                "parent_id": self.parent_id,
                    "input": self.input
                },
                "metadata": {
                    "view_data": {
                        "note": "find owners page data - extraction"
                    }
                }
            }

        self.create_child_job(
            child_label="extraction",
            spec=extraction_pass_spec,
            on_update=self.update_handler,
            on_complete=self.on_extraction_pass,
        )

    def on_extraction_pass(self, extraction_job):
        owners = extraction_job.output["owners"]

        if len(owners) == 0:
            self.set_output(extraction_job.output)
            self.complete()
        else:
            self.abduction_pass(owners)

    def abduction_pass (self, owners_json):
        abduction_pass_spec = {
            "type": "run_owner_abduction_pass",
            "params": {
                "parent_id": self.parent_id,
                    "input": {
                        "candidates_json": owners_json,
                        "company": self.input["company"],
                        "page_data": self.input["page_data"]
                    }
                },
                "metadata": {
                    "view_data": {
                        "note": "find owners page data - abduction"
                    }
                }
            }
        
        self.create_child_job(
            child_label="abduction",
            spec=abduction_pass_spec,
            on_update=self.update_handler,
            on_complete=self.on_abduction_pass,
        )
    
    def on_abduction_pass (self, abduction_job):
        self._set_output(abduction_job.output)
        self.complete(abduction_job.output)
