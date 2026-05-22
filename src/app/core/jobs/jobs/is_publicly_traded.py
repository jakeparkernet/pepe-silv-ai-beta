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

@Job.register(name="is_publicly_traded")
class IsPubliclyTraded(LlmCallbackJob):
    requirements: Dict[str, Any] = {
        "cpu": 1,
        "gpu": 1,
    }

    label: str = "Is Publicly Traded?"
    description: str = "Checks to see if a company is publicly traded."
    
    async def run(self, platform: str):
        await super().run(platform)

        self._phase = "extraction"
        self._max_retries = 1

        self._model = "x-ai/grok-4.3"

        entity_name = self.input["entity_name"]
        search_results = self.input["search_results"]

        self._system_message = f"""
            You are a GROUNDED PUBLIC COMPANY DETECTOR.

            YOUR ONLY JOB:
            Determine whether an entity is EXPLICITLY CONFIRMED as publicly traded.

            CRITICAL CONSTRAINTS:
            - Use ONLY the provided SEARCH_RESULTS JSON.
            - Do NOT use prior knowledge.
            - Do NOT infer public status from size, revenue, or prominence.
            - Do NOT assume ticker symbols imply public trading unless explicitly stated.
            - Absence of evidence means NO_PUBLIC_EVIDENCE.

            DEFINITION: PUBLICLY TRADED (CONFIRMED)
            An entity is PUBLICLY TRADED only if SEARCH_RESULTS explicitly state that:
            - it is publicly traded or a public company, OR
            - it is listed on a named stock exchange, OR
            - it files mandatory public-market regulatory disclosures (e.g., SEC filings).

            STRONG PUBLIC SIGNALS (explicit phrases):
            - "publicly traded"
            - "public company"
            - "listed on the [exchange]"
            - "trades on the [exchange]"
            - "shares trade on"
            - "files with the SEC"
            - "SEC filings"
            - "Form 10-K"
            - "Form 10-Q"
            - "Form 8-K"

            NON-SIGNALS (do NOT count):
            - Stock price mentions without exchange
            - Ticker-like symbols without listing language
            - Ownership by investors or institutions
            - IPO rumors without confirmation
            - Financial media coverage

            DEFAULT BIAS:
            - Conservative.
            - If no explicit public signal is found → NO_PUBLIC_EVIDENCE.

            OUTPUT RULES:
            - Output JSON ONLY.
            - Cite exact phrases as evidence.
            """
        
        self._user_message = f"""
            TASK
            Determine whether the following entity is EXPLICITLY CONFIRMED as publicly traded.

            ENTITY_NAME
            {entity_name}

            SEARCH_RESULTS (Brave JSON)
            {search_results}

            OUTPUT
            Return ONLY JSON matching this schema exactly:

            {{
            "decision": "PUBLIC_CONFIRMED|NO_PUBLIC_EVIDENCE",
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
            - If decision is PUBLIC_CONFIRMED:
            - evidence MUST include an explicit public signal phrase
            - If no explicit public signal is present:
            - decision MUST be NO_PUBLIC_EVIDENCE
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
            "event": "RUN_END - " + self._phase,
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