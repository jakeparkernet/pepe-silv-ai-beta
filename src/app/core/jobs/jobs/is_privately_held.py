from datetime import datetime
from typing import Any, Dict
from app.core.jobs.job import Job
from app.core.jobs.jobs.llm_callback_job import LlmCallbackJob
from app.core.jobs.job_status import JobStatus
from app.edge.edge_runner_factory import get_edge_runner
from app.functions.get_llm_response import get_llm_response
from fast_json_repair import loads
from app.util.clean_json_response import custom_repair_json
from pydantic import Field, PrivateAttr
from app.util.markers import returns_awaitable

@Job.register(name="is_privately_held")
class IsPrivatelyHeld(LlmCallbackJob):
    requirements: Dict[str, Any] = {
        "cpu": 1,
        "gpu": 1,
    }

    label: str = "Is Privately Held?"
    description: str = "Checks to see if a company is privately held."
    
    async def run(self, platform: str):
        await super().run(platform)

        self._max_retries = 1

        self._model = "x-ai/grok-4.3"

        entity_name = self.input["entity_name"]
        search_results = self.input["search_results"]
        
        self._system_message = f"""
            You are a GROUNDED PRIVATE COMPANY DETECTOR.

            YOUR ONLY JOB:
            Determine whether an entity is EXPLICITLY CONFIRMED as privately held.

            CRITICAL CONSTRAINTS:
            - Use ONLY the provided SEARCH_RESULTS JSON.
            - Do NOT use prior knowledge.
            - Do NOT infer private status from lack of public evidence.
            - Do NOT assume subsidiaries are private unless explicitly stated.
            - Absence of evidence means NO_PRIVATE_EVIDENCE.

            DEFINITION: PRIVATELY HELD (CONFIRMED)
            An entity is PRIVATELY HELD only if SEARCH_RESULTS explicitly state that:
            - it is privately held or privately owned, OR
            - it is family-owned, founder-owned, or employee-owned, OR
            - it is a subsidiary of another company.

            STRONG PRIVATE SIGNALS (explicit phrases):
            - "privately held"
            - "privately owned"
            - "family-owned"
            - "founder-owned"
            - "employee-owned"
            - "owned by [parent company]"
            - "subsidiary of"
            - "wholly owned by"
            - "acquired and taken private"

            NON-SIGNALS (do NOT count):
            - Absence of stock information
            - Venture backing
            - Private investors
            - PE or VC involvement alone
            - Lack of SEC filings

            DEFAULT BIAS:
            - Conservative.
            - If no explicit private signal is found → NO_PRIVATE_EVIDENCE.

            OUTPUT RULES:
            - Output JSON ONLY.
            - Cite exact phrases as evidence.
            """
        
        self._user_message = f"""
            TASK
            Determine whether the following entity is EXPLICITLY CONFIRMED as privately held.

            ENTITY_NAME
            {entity_name}

            SEARCH_RESULTS (Brave JSON)
            {search_results}

            OUTPUT
            Return ONLY JSON matching this schema exactly:

            {{
            "decision": "PRIVATE_CONFIRMED|NO_PRIVATE_EVIDENCE",
            "confidence": number,
            "evidence": [
                {{
                "text": string,
                "source_path": string
                }}
            ],
            "notes": [string]
            }}

            RULES
            - confidence must be between 0.0 and 1.0
            - source_path must point into SEARCH_RESULTS
            - If decision is PRIVATE_CONFIRMED:
            - evidence MUST include an explicit private signal phrase
            - If no explicit private signal is present:
            - decision MUST be NO_PRIVATE_EVIDENCE
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
            ["decision",
            "confidence",
            "evidence"]
            ) == False:
            
            return False

        return True

    def contains_valid_keys (self, results_obj, keys):
        for key in keys:
            if key not in results_obj:
                return False