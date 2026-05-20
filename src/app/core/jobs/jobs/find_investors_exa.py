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

@Job.register(name="find_investors_exa")
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

        self._model = "google/gemma-4-31b-it"

        entity_name = self.input["entity_name"]

        self._parameters["extra_headers"] = {
            "X-Reasoning-Enabled": "true",
            "X-Reasoning-Effort": "high"
        }

        self._parameters["plugins"] = [{ 
            "id": "web",
            "engine": "exa",
            "max_results": 5
        }]
        
        self._system_message = f"""
            You are a fact-finding extraction agent. Your job is to identify the top investors of a specified company and output ONLY valid JSON that exactly matches the required schema.

            Core requirements:
            - Use web sources to verify every investor entry.
            - Every investor in "investors" MUST have:
            - a working "source_url"
            - an "evidence_quote" that is a direct, verbatim snippet from that source supporting the investor-company relationship
            - Prefer primary/authoritative sources first:
            1) Company website (press/news), official filings, investor relations
            2) Regulator filings (SEC/EDGAR etc.) when relevant
            3) Reputable finance databases / firm portfolio pages
            4) High-quality journalism (major outlets)
            - Avoid low-quality / user-generated sources unless nothing else exists; if used, note that in sources_considered.

            Decision rules:
            - INVESTORS_FOUND:
            - Use when you find at least one investor with strong evidence (verbatim quote) tying the investor to the company (e.g., “led the Series B”, “invested in”, “backed by”, “participant in”).
            - NO_INVESTOR_EVIDENCE:
            - Use when you cannot find credible evidence of investors after reasonable searching.
            - AMBIGUOUS:
            - Use when there are conflicting claims, unclear identity (e.g., name collision), or only weak/indirect hints (e.g., “rumored”, “reportedly” without substantiation).

            Investor selection:
            - “Top investors” means the most prominent/backing investors you can substantiate:
            - For private companies: lead investors, major participants in notable rounds, strategic/corporate investors, accelerators.
            - For public companies: major institutional holders may be considered investors ONLY if your evidence clearly supports holdings/ownership AND you label them as "institutional" and relationship as "invested_in" or "other" with correct wording in notes.
            - If you mix “funding investors” and “public shareholders,” explain the distinction in notes.

            Classification constraints:
            - investor_type must be exactly one of:
            private_equity | venture_capital | corporate | institutional | accelerator | other
            - relationship must be exactly one of:
            backed_by | invested_in | funding_led_by | participated_in_round | other

            Evidence requirements:
            - evidence_quote must be <= 25 words and copied verbatim from the source.
            - source_url must be the exact page where the quote appears.
            - date fields should be ISO-8601 (YYYY-MM-DD) when known; otherwise null.
            - as_of_date:
            - If the sources provide an “as of” date (e.g., “as of Sept 30, 2025”), capture it.
            - Otherwise set null.

            Output constraints:
            - Output ONLY JSON.
            - No markdown, no commentary, no extra keys, no trailing commas.
            - confidence is 0.0[1.0, reflecting evidence strength and source quality.
            - Include all sources you relied on in sources_considered, plus any high-signal sources you checked that didn't confirm investors (with notes).
            - Put any caveats, disambiguation steps, or reasoning summaries in notes (as strings).
            """
        
        self._user_message = f"""
            Find the top investors of the following company and return ONLY JSON matching the exact schema below.

            Company:
            - Name: {entity_name}

            Instructions:
            - Focus on the most prominent/meaningful investors you can prove with direct quotes.
            - For each investor, include exactly one best supporting quote and the source URL it came from.
            - If the company name is ambiguous (multiple companies share the name), resolve it using authoritative identifiers (website, location, ticker, product) and note what you did in notes.
            - If you cannot find credible investor evidence, set decision accordingly and keep investors as an empty array.

            Required JSON schema (must match exactly):
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