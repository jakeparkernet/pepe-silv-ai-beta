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

@Job.register(name="find_top_shareholders")
class FindTopShareholders(LlmCallbackJob):
    requirements: Dict[str, Any] = {
        "cpu": 1,
        "gpu": 1,
    }

    label: str = "Find Top Shareholders"
    description: str = "Finds the top shareholders of a company."

    async def run(self, platform: str):
        await super().run(platform)

        self._max_retries = 1

        self._model = "google/gemma-4-31b-it"

        entity_name = self.input["entity_name"]

        self._parameters["extra_headers"] = {
            "X-Reasoning-Enabled": "true",
            "X-Reasoning-Effort": "high"
        }

        self._parameters["plugins"] = [{ "id": "web" }]
        
        self._system_message = f"""
            You are a GROUNDED TOP INSTITUTIONAL SHAREHOLDERS AGENT.

            YOUR ONLY JOB:
            Find and extract the TOP 3 INSTITUTIONAL SHAREHOLDERS of a given company, using web search and web page reading tools, and return ONLY evidence-backed JSON.

            DEFINITIONS:
            - "Institutional shareholder" means a non-individual organization that holds shares (e.g., Vanguard, BlackRock, State Street, pension funds, insurance companies, banks, asset managers, investment advisers).
            - EXCLUDE: individuals, insiders (unless explicitly institutional entities), founders, families, trusts, retail holders.
            - Prefer "Top Institutional Holders" (or similar) sections.

            CRITICAL RULES:
            1) You MUST use web search + reading tools. Do NOT rely on prior knowledge.
            2) You MUST be conservative and evidence-backed:
            - If you cannot find an explicit "Top Institutional Holders" list or equivalent, return NOT_FOUND (do not guess).
            3) You MUST perform entity resolution:
            - Confirm the result refers to the correct company (name + ticker and/or exchange, or a clear company profile match).
            - Avoid similarly named companies.
            4) Source quality priority:
            - Primary-ish: SEC filing sources, official exchange pages, company investor relations (if they explicitly list holders), reputable finance pages with clear labeled tables.
            - Secondary: reputable aggregators (only if they clearly show institutional holders and the company identity).
            5) Evidence requirement:
            - Each extracted holder must be supported by a verbatim quote from a source page that includes the holder name and ideally shares/%/date.
            - Provide the source URL and the quote.
            6) Ranking:
            - If the source provides an ordered "Top Institutional Holders" table, take the first 3 rows.
            - If multiple sources disagree, prefer the most recent date reported and/or the most authoritative source; mention conflicts in notes.
            7) Do NOT fabricate numbers, dates, or holder names. If missing, use null.

            SEARCH STRATEGY (follow this order):
            A) Identify the company ticker/exchange (if not provided) using search.
            B) Search specifically for pages that contain:
            - "Top Institutional Holders" OR "institutional ownership" OR "institutional holders"
            - and the company name/ticker
            C) Open candidate pages and locate the institutional holders section.
            D) Extract the top 3 institutions and their shares/%/date if shown.

            OUTPUT:
            Return JSON only, matching the schema provided by the user.
            No prose, no markdown.
            """
        
        self._user_message = f"""
            TASK
            Return the top three institutional shareholders for the target company.

            TARGET_COMPANY
            {entity_name}

            OUTPUT
            Return ONLY JSON matching this schema exactly:

            {{
            "company": {{
                "name": string,
                "ticker": string|null,
                "exchange": string|null
            }},
            "status": "FOUND|NOT_FOUND|AMBIGUOUS",
            "as_of_date": string|null,
            "shareholders": [
                {{
                "rank": 1,
                "name": string,
                "reported_shares": string|null,
                "reported_percent": string|null,
                "date_reported": string|null,
                "value": string|null,
                "source_url": string,
                "evidence_quote": string
                }}
            ],
            "sources_considered": [
                {{
                "source_url": string,
                "source_type": "exchange|sec|company_ir|finance_site|aggregator|other",
                "notes": string
                }}
            ],
            "notes": [string]
            }}

            RULES
            - shareholders must have 0 to 3 entries.
            - If FOUND: shareholders must be exactly 3 entries unless fewer than 3 are explicitly available.
            - If you find an institutional holders table but cannot confidently determine ordering/top 3, set status = AMBIGUOUS and explain why in notes.
            - evidence_quote must be a verbatim quote (<= 40 words) that includes the holder name (and ideally shares/%/date).
            - Do not output any text besides the JSON.
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