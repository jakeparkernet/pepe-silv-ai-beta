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

@Job.register(name="find_investors")
class FindInvestors(LlmCallbackJob):
    requirements: Dict[str, Any] = {
        "cpu": 1,
        "gpu": 1,
    }

    label: str = "Find Investors"
    description: str = "Finds the investors in a company."

    async def run(self, platform: str):
        await super().run(platform)

        self._max_retries = 1

        self._model = "x-ai/grok-4.1-fast"

        entity_name = self.input["entity_name"]

        self._parameters["extra_headers"] = {
            "X-Reasoning-Enabled": "true",
            "X-Reasoning-Effort": "high"
        }

        self._parameters["plugins"] = [{ "id": "web" }]
        
        self._system_message = f"""
            You are a GROUNDED INVESTOR EXTRACTOR.

            YOUR ONLY JOB:
            Using web search and page-reading tools, extract NAMED ORGANIZATIONAL INVESTORS that have explicitly invested in or backed the target company.

            INPUT GUARANTEES:
            - The target company is NOT publicly traded.
            - The target company is NOT an investment firm or fund.

            CRITICAL CONSTRAINTS:
            - You MUST use web search and page-reading tools.
            - Do NOT rely on prior knowledge.
            - Do NOT infer investors from context or industry norms.
            - Only extract investors if explicitly named in a funding/investment context.
            - Be conservative: false positives are worse than missing investors.

            DEFINITION: INVESTOR (CONFIRMED)
            A confirmed investor is a named organization explicitly described as having invested in, backed, led a round for, or participated in funding for the company, using phrases like:
            - "raised from"
            - "backed by"
            - "investment from"
            - "funding led by"
            - "Series [A/B/etc.] led by"
            - "participated in the round"
            - "investors include"

            EXCLUDE:
            - individuals, founders, angels (unless explicitly an institutional entity)
            - customers/partners
            - acquirers (those belong to parent/ownership task unless the page clearly calls them an investor only)
            - vague statements like "backed by leading investors" without names

            SEARCH STRATEGY:
            1) Search for funding announcements:
            - "[Company] funding", "[Company] raised", "[Company] Series", "[Company] backed by", "[Company] investment"
            2) Prefer primary sources:
            - company press releases / blog
            - reputable business news
            3) Aggregators may be used as leads; only treat as evidence if they explicitly state investors on the page.

            OUTPUT REQUIREMENTS:
            - Each investor must be backed by a verbatim quote naming the investor and the investment context.
            - Provide the source URL.
            - Output JSON ONLY. No prose.
            """
        
        self._user_message = f"""
            TASK
            Extract named organizational investors for the target company, if explicitly stated.

            TARGET_COMPANY
            {entity_name}

            OUTPUT
            Return ONLY JSON matching this schema exactly:

            {{
            "company": {{ "name": string }},
            "decision": "INVESTORS_FOUND|NO_INVESTOR_EVIDENCE|AMBIGUOUS",
            "confidence": number,
            "as_of_date": string|null,
            "investors": [
                {{
                "name": string,
                "investor_type": "private_equity|venture_capital|corporate|institutional|accelerator|other",
                "relationship": "backed_by|invested_in|funding_led_by|participated_in_round|other",
                "round": string|null,
                "date": string|null,
                "source_url": string,
                "evidence_quote": string
                }}
            ],
            "sources_considered": [
                {{ "source_url": string, "notes": string }}
            ],
            "notes": [string]
            }}

            RULES
            - confidence must be between 0.0 and 1.0
            - investors may be empty only if decision is NO_INVESTOR_EVIDENCE
            - If decision is INVESTORS_FOUND:
            - investors must contain at least 1 item
            - every investor must have an evidence_quote that explicitly names the investor in an investment context
            - If sources conflict or investor names/rounds are unclear:
            - decision MUST be AMBIGUOUS and explain why in notes
            - evidence_quote must be verbatim (≤ 50 words)
            - Output JSON ONLY.
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

        return True

    def contains_valid_keys (self, results_obj, keys):
        for key in keys:
            if key not in results_obj:
                return False