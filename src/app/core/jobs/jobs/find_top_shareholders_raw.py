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

@Job.register(name="find_top_shareholders_raw")
class FindTopShareholdersStacked(Job):
    requirements: Dict[str, Any] = {
        "cpu": 1,
        "gpu": 1,
    }

    label: str = "Find Top Shareholders Raw"
    description: str = "It's fucking RAW!!!"
    
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

    def on_top_shareholders_llm(self, top_shareholders_llm_job):
        llm_response = top_shareholders_llm_job.output
        self._results["top_shareholders_llm"] = llm_response

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
        self._results["normalization"] = child_job.output
        
        try:
            self._set_output(child_job.output)
            self.complete(child_job.output)

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
