from datetime import datetime
from typing import Any, Dict
from app.core.jobs.job import Job
from app.core.jobs.job_status import JobStatus
from app.edge.edge_runner_factory import get_edge_runner
from app.functions.brave_search import brave_search

@Job.register(name="search_callback")
class Search(Job):
    requirements: Dict[str, Any] = {
        "cpu": 1,
        "net": 1
    }

    label: str = "Search"
    description: str = "Searches Brave"

    async def run(self, platform: str):
        await super().run(platform)
        self._append_history({
            "timestamp": datetime.now().isoformat(),
            "event": "RUN_START",
            "details": {"query": self.input["query"]},
        })

        self.description = f"Searches Brave for {self.input}"

        try:
            if platform == "local":
                pass
            elif platform == "edge":

                options = {}
                if "options" in self.input:
                    options = self.input["options"]

                get_edge_runner().brave_search_callback(
                    self.id,
                    self.input["query"],
                    options
                )
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
        finally:
            self._append_history({
                "timestamp": datetime.now().isoformat(),
                "event": "RUN_END",
                "details": {"status": self.status},
            })

    def apply_result (self, result):
        super().apply_result(result)
        
        self._append_history({
            "timestamp": datetime.now().isoformat(),
            "event": "RUN_END",
            "details": {"job": self.status},
        })
        self._set_output(result)
        return self.complete(result)