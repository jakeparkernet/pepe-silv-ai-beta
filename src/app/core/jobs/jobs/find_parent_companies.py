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

@Job.register(name="find_parent_companies")
class FindParentCompanies(LlmCallbackJob):
    requirements: Dict[str, Any] = {
        "cpu": 1,
        "gpu": 1,
    }

    label: str = "Find Parent Companies"
    description: str = "Finds the parent companies of a company."

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
            You are a GROUNDED PARENT COMPANY DETECTOR.

            YOUR ONLY JOB:
            Using web search and page-reading tools, determine whether the target company has an explicit parent company / owner / controlling entity, and extract it if present.

            INPUT GUARANTEES:
            - The target company is NOT publicly traded.
            - The target company is NOT an investment firm or fund.

            CRITICAL CONSTRAINTS:
            - You MUST use web search and page-reading tools.
            - Do NOT rely on prior knowledge.
            - Do NOT infer ownership from hints, funding, or business relationships.
            - Only accept ownership/control when explicitly stated.
            - Be conservative: false positives are worse than NOT_FOUND.

            DEFINITION: PARENT COMPANY (CONFIRMED)
            A parent company is an entity explicitly described as owning or controlling the target company, including via:
            - "subsidiary of"
            - "owned by"
            - "parent company"
            - "a division of"
            - "part of [group]"
            - "acquired by" (if clearly acquisition of the company, not just an asset/product)
            - "wholly owned by"
            - "controlled by"

            DO NOT COUNT as parent evidence:
            - "partnered with"
            - "backed by" (investors belong in a different task)
            - customer/vendor relationships
            - board memberships
            - individuals/founders
            - “major shareholder” unless it explicitly says owner/parent/subsidiary/control

            SEARCH STRATEGY:
            1) Find the company's official website and check About/Company pages for "subsidiary", "part of", "owned by".
            2) Search: "[Company] subsidiary of", "[Company] owned by", "[Company] acquired by", "[Company] parent company".
            3) Prefer primary or high-quality sources: company site, press releases, reputable business news.
            4) Use aggregators only as leads unless they contain explicit ownership language on the page.

            OUTPUT REQUIREMENTS:
            - Every claimed parent must be backed by a verbatim quote from a source page.
            - Provide the source URL for each quote.
            - Output JSON ONLY. No prose.
            """
        
        self._user_message = f"""
            TASK
            Identify the explicit parent company / owner of the target company (if any).

            TARGET_COMPANY
            {entity_name}

            OUTPUT
            Return ONLY JSON matching this schema exactly:

            {{
            "company": {{ "name": string }},
            "decision": "PARENT_FOUND|NO_PARENT_EVIDENCE|AMBIGUOUS",
            "confidence": number,
            "parent": {{
                "name": string,
                "relationship": "subsidiary_of|owned_by|acquired_by|division_of|part_of|controlled_by|other",
                "source_url": string,
                "evidence_quote": string
            }} | null,
            "sources_considered": [
                {{ "source_url": string, "notes": string }}
            ],
            "notes": [string]
            }}

            RULES
            - confidence must be between 0.0 and 1.0
            - If decision is PARENT_FOUND:
            - parent must be non-null
            - evidence_quote must explicitly state the ownership/control relationship
            - If decision is NO_PARENT_EVIDENCE:
            - parent must be null
            - If sources conflict or multiple parents are claimed without clarity:
            - decision MUST be AMBIGUOUS
            - parent may be null or the best-supported one; explain in notes
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