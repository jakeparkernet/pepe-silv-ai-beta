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
from app.util.owner_graph_utils import project_graph_deterministic
import json

@Job.register(name="find_company_parents_and_investors_2")
class FindCompanyParentsAndInvestors2(Job):
    requirements: Dict[str, Any] = {
        "cpu": 1,
        "gpu": 1,
    }

    label: str = "Find Company Parents and Investors 2"
    description: str = "Find the parent companies and investors in a company."

    _results: Dict[str, Any] = PrivateAttr(default_factory=dict)
    
    def update_handler(self, event):
        pass

    async def run(self, platform: str):
        await super().run(platform)

        find_parent_companies_spec = {
            "type": "find_parent_companies",
            "params": {
                "parent_id": self.parent_id,
                    "input": self.input
                },
                "metadata": {
                    "internal_job_key": "parents",
                    "view_data": {
                        "note": "find parent companies"
                    }
                }
            }

        self.create_child_job(
            child_label="find parent companies",
            spec=find_parent_companies_spec,
            on_update=self.update_handler,
            on_complete=self.on_internal_job_result,
        )

        find_investors_spec = {
            "type": "find_top_investors_stacked",
            "params": {
                "parent_id": self.parent_id,
                    "input": self.input
                },
                "metadata": {
                    "internal_job_key": "investors",
                    "view_data": {
                        "note": "find top investors"
                    }
                }
            }

        self.create_child_job(
            child_label="find investors",
            spec=find_investors_spec,
            on_update=self.update_handler,
            on_complete=self.on_internal_job_result,
        )

        find_shareholders_spec = {
            "type": "find_top_shareholders_raw",
            "params": {
                "parent_id": self.parent_id,
                    "input": self.input
                },
                "metadata": {
                    "internal_job_key": "shareholders",
                    "view_data": {
                        "note": "find top shareholders"
                    }
                }
            }

        self.create_child_job(
            child_label="find shareholders",
            spec=find_shareholders_spec,
            on_update=self.update_handler,
            on_complete=self.on_internal_job_result,
        )

    def dedupe_pass (self):
        dedupe_spec = {
            "type": "dedupe_entities_with_web",
            "params": {
                "parent_id": self.parent_id,
                    "input": self._results["aggregate"]
                },
                "metadata": {
                    "internal_job_key": "dedupe",
                    "view_data": {
                        "note": "dedupe owner results"
                    }
                }
            }

        self.create_child_job(
            child_label="dedupe",
            spec=dedupe_spec,
            on_update=self.update_handler,
            on_complete=self.on_internal_job_result,
        )

    def aggregate_pass (self):
        aggregate_spec = {
            "type": "aggregate_owner_results",
            "params": {
                "parent_id": self.parent_id,
                    "input": self._results
                },
                "metadata": {
                    "internal_job_key": "aggregate",
                    "view_data": {
                        "note": "aggregate owner results"
                    }
                }
            }

        self.create_child_job(
            child_label="aggregate",
            spec=aggregate_spec,
            on_update=self.update_handler,
            on_complete=self.on_internal_job_result,
        )

    def on_internal_job_result(self, job):
        key = job.metadata["internal_job_key"]
        self._results[key] = job.output

        if len(self._results.keys()) == 3:
            self.aggregate_pass()
        elif len(self._results.keys()) == 4:
            self.dedupe_pass()
        elif len(self._results.keys()) == 5:
            final_graph = project_graph_deterministic(
                input_graph=self._results["aggregate"], 
                dedupe_output=self._results["dedupe"]
            )

            print(json.dumps(final_graph))

            self.set_output({"result": final_graph})
            self.complete()