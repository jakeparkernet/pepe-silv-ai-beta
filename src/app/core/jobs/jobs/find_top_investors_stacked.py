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

@Job.register(name="find_top_investors_stacked")
class FindTopInvestorsStacked(Job):
    requirements: Dict[str, Any] = {
        "cpu": 1,
        "gpu": 1,
    }

    label: str = "Find Top Investors Stacked"
    description: str = "Finds the top investors in a company."
    
    def update_handler(self, event):
        pass

    async def run(self, platform: str):
        await super().run(platform)

        find_top_investors_llm_spec = {
            "type": "find_top_investors_llm",
            "params": {
                "parent_id": self.parent_id,
                    "input": self.input
                },
                "metadata": {
                    "view_data": {
                        "note": "find top investors"
                    }
                }
            }

        self.create_child_job(
            child_label="find_top_investors_llm",
            spec=find_top_investors_llm_spec,
            on_update=self.update_handler,
            on_complete=self.on_top_investors_llm,
        )

    def on_top_investors_llm(self, top_investors_llm_job):
        llm_response = top_investors_llm_job.output["result"]
        self.structure_pass(llm_response)

    def structure_pass (self, llm_response):
        structure_pass_spec = {
            "type": "structure_top_investors",
            "params": {
                "parent_id": self.parent_id,
                    "input": {
                        "investors_response": llm_response
                    }
                },
                "metadata": {
                    "view_data": {
                        "note": "structure pass"
                    }
                }
            }
        
        self.create_child_job(
            child_label="structure",
            spec=structure_pass_spec,
            on_update=self.update_handler,
            on_complete=self.on_structure_pass,
        )
    
    def on_structure_pass (self, structure_job):
        self._set_output(structure_job.output)
        self.complete(structure_job.output)
