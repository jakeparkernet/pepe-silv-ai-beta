from datetime import datetime
import asyncio
from typing import Any, Dict

from app.core.jobs.job import Job
from app.core.jobs.job_status import JobStatus
from app.edge.edge_runner_factory import get_edge_runner


@Job.register(name="test_job")
class TestJob(Job):
    """
    A simple delayed echo job that behaves like EchoCallbackJob but waits first.
    - Expects self.input = {"message": str, "delay_seconds": int}
    - Calls edge echo_callback after the delay (only on 'edge' platform).
    """

    requirements: Dict[str, Any] = {"cpu": 1}
    label: str = "Test"
    description: str = "Echo with a delay"

    async def run(self, platform: str):
        await super().run(platform)

        delay = float(self.input.get("delay_seconds", 1.0))
        message = self.input.get("message", "")

        self._append_history({
            "timestamp": datetime.now().isoformat(),
            "event": "RUN_START",
            "details": {"delay_seconds": delay, "message": message},
        })

        self.description = f"Echoes '{message}' after {delay}s"

        try:
            # Simulate work
            await asyncio.sleep(delay)

            if platform == "edge":
                # Only triggers the echo_callback once for live runs
                get_edge_runner().echo_callback(self.id, message)
            elif platform != "local":
                raise ValueError(f"Unknown platform: {platform}")

            self._append_history({
                "timestamp": datetime.now().isoformat(),
                "event": "RUN_END",
                "details": {"message": message},
            })

            self._set_output({"message": message})
            self.complete()

        except Exception as e:
            self._set_status(JobStatus.FAILED)
            self._append_history({
                "timestamp": datetime.now().isoformat(),
                "event": "ERROR",
                "details": {"error": str(e)},
            })
            raise

    def apply_result(self, result: Dict[str, Any]):
        super().apply_result(result)
        
        """Called by echo_callback to finalize."""
        self._append_history({
            "timestamp": datetime.now().isoformat(),
            "event": "RESULT_APPLIED",
            "details": {"message": result.get("message")},
        })
        self._set_output(result)
        return self.complete()
