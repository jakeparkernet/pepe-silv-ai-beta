import json
from datetime import datetime
from typing import Any, Dict
from app.core.jobs.job import Job
from app.core.jobs.jobs.llm_callback_job import LlmCallbackJob
from app.core.jobs.job_status import JobStatus
from app.edge.edge_runner_factory import get_edge_runner
from app.functions.get_llm_response import get_llm_response
from fast_json_repair import loads
from app.util.clean_json_response import custom_repair_json
from app.util.get_value_safe import get_value_safe

@Job.register(name="identify_from_search")
class IdentifyFromSearchResults(LlmCallbackJob):
    requirements: Dict[str, Any] = {
        "cpu": 1,
        "gpu": 1,
    }

    label: str = "Identify a company from search results"
    description: str = "Takes its best guess based on the results and infobox alone, no scraping."
    
    async def run(self, platform: str):
        await super().run(platform)

        self._model = "x-ai/grok-4.1-fast"

        domain = self.input["domain"]
        search_results = self.input["search_results"]
        tag_instructions = get_value_safe(self.input, "tag_instructions", "No additional instructions")

        self._system_message = f"""You are a grounded entity-identification engine.

                                CRITICAL CONSTRAINTS:
                                - Use ONLY the provided SEARCH_RESULTS JSON (infobox + web results). Do NOT use prior knowledge.
                                - Do NOT browse, scrape, or assume facts not present in the provided text.
                                - The output "name" MUST be the BRAND the domain represents publicly (what people recognize).
                                - Never output parent/owner names as "name" unless the provided data explicitly shows the domain is the parent's official site.

                                METHOD:
                                1) Extract candidate brand names from:
                                - infobox.results[*].title
                                - infobox.results[*].website_url / found_in_urls
                                - web.results[*].title (especially those whose url hostname matches the domain)
                                - web.results[*].profile.name / profile.long_name
                                2) Prefer candidates with strongest domain alignment (url hostname matches domain) + strongest prominence (top results, infobox).
                                3) Produce 3-5 descriptive tags supported by explicit phrases in the data.

                                Output MUST be valid JSON only, matching the required schema exactly.
                                """
        
        self._user_message = f"""
                                TASK
                                Identify the most likely PUBLIC BRAND NAME represented by this domain, using ONLY SEARCH_RESULTS.

                                DOMAIN
                                {domain}

                                SEARCH_RESULTS (Brave JSON)
                                {search_results}

                                TAG INSTRUCTIONS (optional)
                                {tag_instructions}

                                HOW TO DECIDE (follow in order)
                                A) Domain alignment (highest priority)
                                - Treat results whose url hostname equals the DOMAIN (or www.DOMAIN) as direct evidence of the brand.
                                - Strong signals include:
                                - web.results[*].title containing the brand name AND url is on the domain
                                - web.results[*].profile.name / long_name on the domain
                                - infobox.website_url equals the domain or is found_in_urls contains the domain

                                B) Infobox prominence (2nd priority)
                                - If an infobox exists, its primary "title" is usually the canonical brand.
                                - Use infobox attributes (e.g., "Owner", "Parent") ONLY as context, NOT as the "name".

                                C) Disambiguation rules
                                - If multiple brands appear (e.g., similar names, different orgs), choose the one most directly tied to the domain via hostname match and/or website_url.
                                - Do NOT expand acronyms unless an expanded form appears verbatim in SEARCH_RESULTS.
                                - If evidence is weak or conflicting, pick the best-supported brand and lower confidence.

                                TAGS (3-5)
                                - Tags must be descriptive only.
                                - Each tag must be supported by explicit words/phrases present in SEARCH_RESULTS (title/description/long_desc/attributes/category).
                                - Format: lowercase, 1-3 words each.

                                OUTPUT
                                Return ONLY JSON (no prose, no markdown). Exactly this schema:

                                {{
                                "name": string,
                                "tags": [string, string, string],
                                "confidence": number,
                                "evidence": {{
                                    "chosen_from": "infobox|web|both",
                                    "name_signals": [
                                    {{"text": string, "source_path": string}}
                                    ],
                                    "tag_signals": [
                                    {{"tag": string, "text": string, "source_path": string}}
                                    ]
                                }}
                                }}

                                Rules:
                                - confidence must be between 0.0 and 1.0
                                - tags length must be 3 to 5
                                - source_path must be a JSON-path-like pointer into SEARCH_RESULTS (example: "infobox.results[0].title", "web.results[0].title")
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
        results_obj = {}

        cleaned_result = custom_repair_json(result)
        results_obj = loads(cleaned_result)

        self._set_output(results_obj)
        self.complete()

    def is_valid_result (self, result):
        if super().is_valid_result(result) == False:
            return False

        results_obj = {}

        try:
            cleaned_result = custom_repair_json(result)
            results_obj = loads(cleaned_result)
        except Exception as e:
            return False

        if self.contains_valid_keys(results_obj,
            ["name",
            "tags",
            "evidence"]
            ) == False:
            
            return False

        return True

    def contains_valid_keys (self, results_obj, keys):
        for key in keys:
            if key not in results_obj:
                return False