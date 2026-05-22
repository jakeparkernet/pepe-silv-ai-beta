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

        self._model = "x-ai/grok-4.3"

        entity_name = self.input["entity_name"]

        self._parameters["extra_headers"] = {
            "X-Reasoning-Enabled": "true",
            "X-Reasoning-Effort": "high"
        }

        self._parameters["plugins"] = [{ "id": "web" }]
        
        self._system_message = f"""
            You are a TOP INVESTOR TARGETING AGENT.

            YOUR ONLY JOB:
            Identify the most important UPSTREAM INVESTORS OR CORPORATE STAKEHOLDERS associated with a target company, for the purpose of guiding further investigation.

            THIS IS A TARGETING TASK, NOT A FORENSIC OWNERSHIP DETERMINATION.

            CRITICAL CONSTRAINTS:
            - You may use web search and reading tools.
            - Do NOT rely solely on prior knowledge.
            - You MAY synthesize across multiple reputable sources.
            - You MUST distinguish between:
            - confirmed facts
            - commonly reported relationships
            - approximate or inferred prominence
            - Output MUST be JSON ONLY.

            SCOPE & INTENT:
            - The target company is privately held and not an investment fund.
            - The goal is to identify WHO MATTERS MOST UPSTREAM, not to produce a precise cap table.
            - It is acceptable if exact ownership percentages are unknown or approximate.
            - It is acceptable if some entities are minority investors.
            - It is acceptable if ordering is approximate rather than exact.

            INCLUDE:
            - Major institutional or corporate investors
            - Strategic investors
            - Private equity or venture capital firms
            - Media conglomerates or corporate stakeholders
            - Entities frequently cited as “largest”, “major”, or “key” investors

            EXCLUDE:
            - Individuals (unless they are acting as an institutional vehicle)
            - Retail shareholders
            - Vague “backed by investors” with no names
            - Entities that appear only as acquirers of assets (not equity)

            IMPORTANT DISTINCTION:
            - Do NOT treat historical parents or former owners as current investors unless explicitly stated.
            - Do NOT assume control or ownership unless stated.
            - This task is about prominence, not control.

            ORDERING RULE:
            Rank investors by their apparent prominence based on:
            - reported stake size (if available)
            - strategic role
            - board representation
            - frequency of mention across sources

            UNCERTAINTY RULE:
            If information is incomplete or approximate, say so explicitly in notes.
            """
        
        self._user_message = f"""
            TASK
            Identify the top upstream investors or corporate stakeholders associated with the target company.

            TARGET_COMPANY
            {entity_name}

            OUTPUT
            Return ONLY JSON matching this schema exactly:

            {{
            "company": {{
                "name": string
            }},
            "status": "FOUND|LIMITED|NOT_FOUND",
            "top_investors": [
                {{
                "name": string,
                "investor_type": "corporate|private_equity|venture_capital|institutional|strategic|other",
                "prominence_reason": string,
                "approximate_stake": string|null,
                "timeframe": string|null,
                "confidence_level": "high|medium|low",
                "source_summary": [string]
                }}
            ],
            "exclusions": [
                {{
                "name": string,
                "reason": string
                }}
            ],
            "notes": [string]
            }}

            RULES
            - top_investors should contain 1-5 entities, ranked by prominence.
            - approximate_stake may be null or qualitative (e.g., "~20%", "major minority stake").
            - source_summary should briefly cite the types of sources used (e.g., "press releases", "business news", "Crunchbase summaries").
            - exclusions may list entities commonly confused as owners/investors but excluded (e.g., former parents, asset buyers).
            - If information is sparse or fragmented, set status = LIMITED and explain why.
            - Output JSON ONLY. No prose, no markdown.
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