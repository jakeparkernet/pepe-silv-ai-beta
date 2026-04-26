import json
from datetime import datetime
from typing import Any, Dict, List
from app.core.jobs.job import Job
from pydantic import PrivateAttr

class LlmCallbackJob(Job):
    requirements: Dict[str, Any] = {
        "cpu": 1,
        "gpu": 1,
    }

    label: str = "LLM Job"
    description: str = "Generic LLM Job"

    _max_retries: int = PrivateAttr(default=3)
    _retries: int = PrivateAttr(default=0)
    _responses: List = PrivateAttr(default_factory=list)
    
    _platform: str = PrivateAttr(default="")
    _system_message: str = PrivateAttr(default="")
    _user_message: str = PrivateAttr(default="")
    _model: str = PrivateAttr(default="openai/gpt-oss-120b:exacto")
    _response_format: Dict[str, str] = PrivateAttr(default_factory=lambda:{ "type": "json_object" })
    _parameters: Dict[str, str] = PrivateAttr(default_factory=lambda:{  "provider": {
                                                                            "sort": "latency",
                                                                            "allow_fallbacks": True
                                                                        }})

    def run (self, platform):
        self._platform = platform
        super().run(platform)

    async def run (self, platform):
        self._platform = platform
        await super().run(platform)

    def run_llm_loop(self):
        from app.core.jobs.job_status import JobStatus

        try:
            options = {
                "system_message": self._system_message,
                "user_message": self._user_message,
                "model": self._model,
                "response_format": self._response_format,
                "parameters": self._parameters
            }
            
            self.get_llm_response_func(self._platform)(
                self.id,
                options
            )
        except Exception as e:
            self._set_status(JobStatus.FAILED)
            self._append_history({
                "timestamp": datetime.now().isoformat(),
                "event": "ERROR",
                "details": {"error": str(e)},
            })
            raise

    def got_valid_result(self, result):
        pass

    def get_llm_response_func (self, platform):
        if platform == "local":
            pass
        elif platform == "edge":
            from app.edge.edge_runner_factory import get_edge_runner
            return get_edge_runner().get_llm_response_callback
        else:
            raise ValueError(f"Unknown platform: {platform}")

    def is_valid_result (self, result):
        if result is None:
            return False

        if len(result) == 0:
            return False

        return True

    def _retry_or_fail(self, result):
        self._responses.append(result)
        self._retries += 1

        if self._retries >= self._max_retries:
            error_result = {
                "status": "error",
                "error": "Max retries reached",
                "responses": self._responses
            }

            self._set_output(error_result)
            self.complete(error_result)
        else:
            self.run_llm_loop()

    def apply_result (self, result):
        super().apply_result(result)
        
        if not self.is_valid_result(result):
            self._retry_or_fail(result)
            return

        try:
            self.got_valid_result(result)
        except (ValueError, KeyError) as e:
            import logging
            logging.getLogger(__name__).warning(f"got_valid_result failed, retrying: {e}")
            self._retry_or_fail(result)

