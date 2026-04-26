import json
from datetime import datetime
from typing import Any, Dict
from app.core.jobs.job import Job
from app.core.jobs.jobs.llm_callback_job import LlmCallbackJob
from app.core.jobs.job_status import JobStatus
from app.edge.edge_runner_factory import get_edge_runner
from app.functions.get_llm_response import get_llm_response

@Job.register(name="hello_llm_json_callback")
class HelloLLMCallback(LlmCallbackJob):
    requirements: Dict[str, Any] = {
        "cpu": 1,
        "gpu": 1,
    }

    label: str = "Hello LLM"
    description: str = "LLM Test Job"
    
    async def run(self, platform: str):

        self._platform = platform
        super().run(platform)

        self._system_message = f"""
            You are a helpful assistant.
            """
        
        self._user_message = f"""Hello! Response ONLY IN JSON IN THE FOLLOWING FORMAT:
            {{
                "reply": YOUR REPLY
            }}
        """

        if "user_message" in self.input:
            self._user_message = self.input["user_message"]

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
        
        self._set_output(result)
        self.complete(result)

    def is_valid_result (self, result):
        return len(result) > 0