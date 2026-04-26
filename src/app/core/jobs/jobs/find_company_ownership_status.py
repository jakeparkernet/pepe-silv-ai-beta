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

@Job.register(name="find_company_ownership_status")
class FindCompanyOwnershipStatus(Job):
    requirements: Dict[str, Any] = {
        "cpu": 1,
        "gpu": 1,
    }

    label: str = "Traversal Investigation"
    description: str = "Should we look for a parent company or for shareholders?"

    _results: Dict[str, Any] = PrivateAttr(default_factory=dict)
    
    def update_handler(self, event):
        pass

    async def run(self, platform: str):
        await super().run(platform)

        is_publicly_traded_spec = {
            "type": "is_publicly_traded",
            "params": {
                "parent_id": self.parent_id,
                    "input": self.input
                },
                "metadata": {
                    "internal_job_key": "public",
                    "view_data": {
                        "note": "is publicly traded"
                    }
                }
            }

        self.create_child_job(
            child_label="is publicly traded",
            spec=is_publicly_traded_spec,
            on_update=self.update_handler,
            on_complete=self.on_internal_job_result,
        )

        is_privately_held_spec = {
            "type": "is_privately_held",
            "params": {
                "parent_id": self.parent_id,
                    "input": self.input
                },
                "metadata": {
                    "internal_job_key": "private",
                    "view_data": {
                        "note": "is privately held"
                    }
                }
            }

        self.create_child_job(
            child_label="is privately held",
            spec=is_privately_held_spec,
            on_update=self.update_handler,
            on_complete=self.on_internal_job_result,
        )

    def on_internal_job_result(self, job):
        print(job.output)
        key = job.metadata["internal_job_key"]
        self._results[key] = job.output
        
        if len(self._results.keys()) == 2:
            self._set_output({"results": self._results})
            self.complete()
        else:
            pass