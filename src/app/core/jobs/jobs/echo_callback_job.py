from datetime import datetime
from typing import Any, Dict
from app.core.jobs.job import Job
from app.core.jobs.job_status import JobStatus
from app.edge.edge_runner_factory import get_edge_runner

@Job.register(name="echo_callback")
class EchoCallbackJob(Job):
    requirements: Dict[str, Any] = {
        "cpu": 1
    }

    label: str = "Echo"
    description: str = "Echoes the input"

    async def run(self, platform: str):
        await super().run(platform)
        self._append_history({
            "timestamp": datetime.now().isoformat(),
            "event": "RUN_START",
            "details": {"message": self.input},
        })

        self.description = f"Echoes {self.input}"

        try:
            if platform == "local":
                pass
            elif platform == "edge":
                get_edge_runner().echo_callback(self.id, self.input["message"])
            else:
                raise ValueError(f"Unknown platform: {platform}")
        except Exception as e:
            self._set_status(JobStatus.FAILED)
            self._append_history({
                "timestamp": datetime.now().isoformat(),
                "event": "ERROR",
                "details": {"error": str(e)},
            })
            raise

    def apply_result (self, result):
        super().apply_result(result)
        
        self._append_history({
            "timestamp": datetime.now().isoformat(),
            "event": "RUN_END",
            "details": {"job": self.status},
        })
        self._set_output(result["message"])
        return self.complete()