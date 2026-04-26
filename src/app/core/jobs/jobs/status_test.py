from datetime import datetime
from typing import Any, Dict
from app.core.jobs.job import Job
from app.core.jobs.job_status import JobStatus
from app.edge.edge_runner_factory import get_edge_runner
from time import sleep

@Job.register(name="status_test")
class StatusTest(Job):
    requirements: Dict[str, Any] = {
        "cpu": 1
    }

    label: str = "Status Test"
    description: str = "Changes the status of the job every 2 seconds until COMPLETE"

    async def run(self, platform: str):
        await super().run(platform)
        self._append_history({
            "timestamp": datetime.now().isoformat(),
            "event": "RUN_START",
            "details": {"message": self.input},
        })

        self._set_status(JobStatus.INIT)
        sleep(2)

        self._set_status(JobStatus.PAUSED)
        sleep(2)

        self._set_status(JobStatus.SUBSCRIBED)
        sleep(2)

        self._set_status(JobStatus.CANCELED)
        sleep(2)

        self._set_status(JobStatus.FAILED)
        sleep(2)

        self._set_status(JobStatus.COMPLETE)
        sleep(2)
        
        self._set_output("done")
        return self.complete()

        self._append_history({
            "timestamp": datetime.now().isoformat(),
            "event": "RUN_END",
            "details": {"job": self.status},
        })
