from datetime import datetime
from typing import Any, Dict, List
from app.core.jobs.job import Job
from app.core.jobs.jobs.llm_callback_job import LlmCallbackJob
from app.core.jobs.job_status import JobStatus
from app.edge.edge_runner_factory import get_edge_runner
from app.functions.get_llm_response import get_llm_response
from fast_json_repair import loads
from app.util.clean_json_response import custom_repair_json
from pydantic import PrivateAttr

@Job.register(name="get_relevant_owner_links_callback")
class GetRelevantOwnerLinksJob(LlmCallbackJob):
    requirements: Dict[str, Any] = {
        "cpu": 1,
        "gpu": 1,
    }

    label: str = "Get Relevant Owner Links"
    description: str = "Finds the most likely links to contain information about ownership."

    _ignored_domains: List[str] = PrivateAttr(default_factory=lambda: [
        "tipranks.com"
    ])

    async def run(self, platform: str):
        await super().run(platform)

        self._max_retries = 1

        self._model = "x-ai/grok-4.3"

        company = self.input["company"]

        filtered_results = []
        for search_result in self.input["search_results"]["web"]:
            filtered_results.append({
                "url": search_result["url"],
                "title": search_result["title"],
                "description": search_result["description"]
            })
        search_results = self.filter_ignored_domains(filtered_results, self._ignored_domains)

        self._append_history({
            "timestamp": datetime.now().isoformat(),
            "event": "RUN_START",
            "details": {
                "company": company,
                "search_results": search_results
            },
        })

        self._system_message = """You are a corporate-ownership triage classifier. You must be consistent and conservative about scraping.
                                    Use the rubric and include only results that meet the threshold. Output only valid JSON with the required schema.
                                    """

        self._user_message = f"""Score each result for likelihood it contains explicit ownership/investor information about COMPANY.

                                Rubric (0-5):
                                5 = Direct ownership/investor page likely (who owns, parent company, shareholders, investors, acquisition/funding details)
                                4 = Strong company profile likely to list owners/investors (business database profile, SEC/filings index, major business bio)
                                3 = Possibly relevant (credible news article about acquisition/funding, but unclear)
                                2 = Weak (generic about page, leadership, history without ownership cues)
                                1 = Very unlikely (product/pricing/docs/careers/support/homepage)
                                0 = Unrelated

                                Selection rule:
                                - Include only links with score >= 4.
                                - If that yields fewer than 3 links, also include score 3 links until you have 3-10 links total.
                                - Never exceed 10 links.

                                Additional rules:
                                - Prefer sources likely to name owners/investors explicitly.
                                - Avoid pages that require login or are obviously navigational unless they clearly lead to filings/ownership.

                                Output ONLY valid JSON of this exact form:
                                {{
                                "links": ["url0","url1",...]
                                }}

                                COMPANY: {company}
                                SEARCH_RESULTS:
                                {search_results}

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
    
    def filter_ignored_domains(self, search_results, ignored_domains):
        ignored = [d.lower() for d in ignored_domains]

        return [
            result
            for result in search_results
            if not any(domain in result["url"].lower() for domain in ignored)
        ]


    def got_valid_result (self, result):
        self._append_history({
            "timestamp": datetime.now().isoformat(),
            "event": "RUN_END",
            "details": {"status": self.status},
        })
        
        cleaned_result = custom_repair_json(result)
        results_obj = loads(cleaned_result)

        self._set_output(results_obj)
        self.complete(results_obj)

    def is_valid_result (self, result):
        if super().is_valid_result(result) == False:
            return False

        results_obj = {}

        try:
            cleaned_result = custom_repair_json(result)
            results_obj = loads(cleaned_result)
        except Exception as e:
            return False

        if "links" not in results_obj:
            return False

        if len(results_obj["links"]) == 0:
            return False

        return True