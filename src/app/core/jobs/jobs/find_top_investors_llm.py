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

@Job.register(name="find_top_investors_llm")
class FindInvestors(LlmCallbackJob):
    requirements: Dict[str, Any] = {
        "cpu": 1,
        "gpu": 1,
    }

    label: str = "Find Investors"
    description: str = "Finds the investors in a company."

    async def run(self, platform: str):
        await super().run(platform)

        self._max_retries = 1

        self._model = "google/gemma-4-31b-it"

        entity_name = self.input["entity_name"]

        self._parameters["extra_headers"] = {
            "X-Reasoning-Enabled": "false"
        }

        self._parameters["plugins"] = [{ 
            "id": "web"
        }]
                
        self._user_message = f"""
            Who are the top investors in {entity_name}?

            Any investors are valid, including investors that invested in a group - better to have too much information than too little.

            Looking for companies that invested only, not individuals.

            Do not output renderer-specific tags or tool markup. Respond only with JSON in the following format:
            {{
                "investors": [
                {{
                    "name": Company/Corporation/Conglomerate/Fund,
                    "evidence": [
                    {{
                        "excerpt": Excerpt from the source indicating they invested,
                        "source": url being cited
                    }}
                    ]
                }}
                ]
            }}
        """

        try:
            self.run_llm_loop()
        except Exception as e:
            self._set_status(JobStatus.FAILED)
            self._append_history({
                "timestamp": datetime.now().isoformat(),
                "event": "ERROR",
                "details": {"error": str(e)},
            })
            raise

    def got_valid_result(self, result):
        self._append_history({
            "timestamp": datetime.now().isoformat(),
            "event": "RUN_END",
            "details": {"status": self.status},
        })

        result_obj = {
            "result": result
        }

        self._set_output(result_obj)
        self.complete(result_obj)
