import asyncio
from datetime import datetime
from typing import Any, Dict
from app.core.jobs.job import Job
from app.core.jobs.job_status import JobStatus
from app.edge.edge_runner_factory import get_edge_runner
from app.functions.scrape_page import scrape_page
from app.util.set_timeout import set_timeout
from pydantic import Field, PrivateAttr

@Job.register(name="scrape_page_callback")
class ScrapeCallbackJob(Job):
    requirements: Dict[str, Any] = {
        "cpu": 1,
        "net": 1
    }

    label: str = "Scrape"
    description: str = "Scrapes a web page"

    _is_waiting_on_result: bool = PrivateAttr(default=False)

    async def run(self, platform: str):
        await super().run(platform)

        url = self.input["url"]
        self.description = f"Scrapes the page {url}"

        self._append_history({
            "timestamp": datetime.now().isoformat(),
            "event": "RUN_START",
            "details": {"url": url},
        })
        
        try:
            if platform == "local":
                pass
            elif platform == "edge":
                options = {}
                if "options" in self.input:
                    options = self.input["options"]

                self._is_waiting_on_result = True
                def call_edge ():
                    if not self._is_waiting_on_result:
                        return

                    get_edge_runner().scrape_page_callback(self.id, url, options)
                    set_timeout(call_edge, 25)

                call_edge()
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
        
        self._is_waiting_on_result = False
        self._append_history({
            "timestamp": datetime.now().isoformat(),
            "event": "RUN_END",
            "details": {"job": self.status},
        })
        self._set_output(result)
        return self.complete(result)