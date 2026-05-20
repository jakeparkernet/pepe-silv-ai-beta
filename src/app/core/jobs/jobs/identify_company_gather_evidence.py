from typing import Any, Dict, List, Optional
from pydantic import PrivateAttr
import re
from datetime import datetime

from app.core.jobs.job import Job
from app.core.jobs.jobs.llm_callback_job import LlmCallbackJob

from fast_json_repair import loads
from app.util.clean_json_response import custom_repair_json

@Job.register(name="identify_company_gather_evidence")
class IdentifyCompanyGatherEvidence(LlmCallbackJob):
    label: str = "Identify Company - Gather Evidence"
    description: str = "Web-search and gather evidence snippets/URLs to disambiguate a company name."

    _max_retries = 1

    async def run(self, platform: str):
        await super().run(platform)

        self._model = "google/gemma-4-31b-it"
        self._parameters["extra_headers"] = {
            "X-Reasoning-Enabled": "true",
            "X-Reasoning-Effort": "high"
        }
        self._parameters["plugins"] = [{"id": "web"}]
        
        self._system_message = f"""
        You gather evidence to identify a company.
        Return ONLY valid JSON.
        Do NOT write conclusions like "it is X" beyond what is directly supported by excerpts.
        Collect short excerpts (<=25 words) with a URL source.
        If using input context, source must be "input context".
        """

        entity = self.input["entity"]
        name = entity["name"]
        context = ", ".join([entity["context"]] + entity["tags"])

        self._user_message = f"""
        {{
        "task": "gather_disambiguation_evidence",
        "company_name": "{name}",
        "context": "{context}",
        "requirements": [
            "Use web search to find the most relevant official site and reputable profiles.",
            "Return 6-12 evidence items.",
            "Each evidence item must be {{"excerpt", "source"}}.",
            "Include at least one official/company-source excerpt when possible.",
            "If context is provided, include 1-3 evidence items from it with source='input context'."
        ],
        "output_schema": {{
            "evidence": [
            {{
                "excerpt": "string<=25_words",
                "source": "url_or_input_context"
            }}
            ],
            "candidate_names": ["string"],
            "candidate_websites": ["string"],
            "notes": "string"
        }}
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

        cleaned_result = custom_repair_json(result)
        result_obj = loads(cleaned_result)
        
        self._set_output(result_obj)
        self.complete(result_obj)
