from typing import Any, Dict, List, Optional
from pydantic import PrivateAttr
import re
from datetime import datetime

from app.core.jobs.job import Job
from app.core.jobs.jobs.llm_callback_job import LlmCallbackJob
from app.core.jobs.job_status import JobStatus

from fast_json_repair import loads
from app.util.clean_json_response import custom_repair_json

@Job.register(name="identify_company_synthesize_identity")
class IdentifyCompanySynthesizeIdentity(LlmCallbackJob):
    label: str = "Identify Company - Synthesize Identity"
    description: str = "Turn gathered evidence into an identified company profile with tags, aliases, and notes."

    _max_retries = 1
    
    async def run(self, platform: str):
        await super().run(platform)

        self._model = "x-ai/grok-4.3"

        entity = self.input["entity"]
        name = entity["name"]
        gathered = self.input["gathered"]

        self._system_message = f"""
        You are an entity-resolution assistant.
        You MUST output ONLY valid JSON.
        Every claim must be supported by the provided evidence array.
        Do NOT invent facts. If uncertain, write cautious notes describing ambiguity.
        Tags must be 3-5, and should help distinguish similarly named companies.
        Use only excerpts from the provided evidence; do not add new sources.

        NAMING RULES (STRICT):
        - The output field `name` MUST be the most commonly used name for the company in everyday usage.
        - `name` MUST NOT include corporate suffixes/monikers (Inc, Incorporated, Corp, Corporation, Co, Company, Ltd, LLC, LLP, PLC, AG, SA, NV, BV, GmbH, KK, SAS, etc.).
        - If the input name appears to be an acronym/initialism (e.g., "IBM", "GE", "3M"), set `name` to the most commonly used full name.
        - Put the legal name (with suffixes) and the acronym (if applicable) in `aliases`.
        """

        self._user_message = f"""
        {{
        "task": "identify_company",
        "input_name": "{name}",
        "gathered": {gathered},
        "required_output_shape": {{
            "name": "company name",
            "aliases": ["any aliases it found"],
            "tags": ["3-5 tags describing it"],
            "notes": "nature of company; what it is known for; include disambiguation if needed",
            "evidence": [
            {{
                "excerpt": "...",
                "source": "url_or_input_context"
            }}
            ]
        }},
        "rules": [
            "Use the gathered.evidence array as the evidence field in the final output (may subset, but must remain non-empty).",
            "Aliases must be names/variants found in evidence (or strongly implied by evidence excerpts).",
            "Tags must be 3-5.",
            "Notes must describe primary business and what it is known for, grounded in evidence.",
            "`name` must be the most common name without corporate suffixes.",
            "If input looks like an acronym, expand it and put the acronym in aliases.",
            "Include evidence that supports the chosen common name (e.g., official site header, Wikipedia lead, exchange profile)."
        ]
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