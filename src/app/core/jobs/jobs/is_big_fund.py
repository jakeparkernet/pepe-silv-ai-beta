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

# TODO: Fix this, test some different prompts with results we know we should and shouldn't get.
@Job.register(name="is_big_fund")
class IsBigFund(LlmCallbackJob):
    requirements: Dict[str, Any] = {
        "cpu": 1,
        "gpu": 1,
    }

    label: str = "Is Big Fund?"
    description: str = "Checks to see if this company is a big fund."
    
    async def run(self, platform: str):
        await super().run(platform)

        self._phase = "extraction"
        self._max_retries = 1

        self._model = "google/gemma-4-31b-it"

        entity_name = self.input["entity_name"]
        search_results = self.input["search_results"]
        
        self._system_message = f"""
            You are a grounded TERMINAL CORPORATE ENTITY DETECTOR.

            YOUR ONLY JOB:
            Determine whether an entity should be classified as TERMINAL for company-level financial influence research.

            The unit of analysis is the COMPANY AS AN ENTITY.
            People, boards, families, trusts, and governance structures are OUT OF SCOPE.

            CRITICAL CONSTRAINTS:
            - Use ONLY the provided SEARCH_RESULTS JSON (infobox + web results).
            - Do NOT use prior knowledge.
            - Do NOT browse, scrape, or assume facts not present in SEARCH_RESULTS.
            - Do NOT infer ownership or control beyond explicit descriptions.
            - Output must be evidence-backed and conservative.

            DEFINITION: TERMINAL ENTITY
            An entity is TERMINAL if it represents CONSOLIDATED CORPORATE OR FINANCIAL INFLUENCE, meaning it is already an aggregation point in the company-to-company influence graph.

            TERMINAL ENTITIES INCLUDE:

            A) CAPITAL MANAGERS
            Entities whose primary role is managing pooled capital:
            - Asset managers
            - Investment firms
            - Hedge funds
            - Private equity firms
            - Venture capital firms
            - Institutional investment managers
            - Index fund providers
            - ETF providers

            B) CONGLOMERATES / HOLDING STRUCTURES
            Entities whose primary role is owning or controlling multiple companies:
            - Conglomerates
            - Holding companies
            - Diversified holding companies
            - Corporate groups that own multiple brands or subsidiaries
            - Groups described primarily as owning companies across sectors

            STRONG TERMINAL SIGNALS (explicit phrases):
            - "asset manager"
            - "investment management"
            - "hedge fund"
            - "private equity firm"
            - "venture capital firm"
            - "institutional investor"
            - "index fund"
            - "ETF provider"
            - "manages assets"
            - "assets under management"
            - "AUM"
            - "conglomerate"
            - "holding company"
            - "diversified holding company"
            - "group that owns"
            - "owns multiple companies"
            - "portfolio of companies"
            - "parent company of multiple brands"
            - "controls subsidiaries"
            - "one of the world's largest"
            - "global investment firm"

            These phrases may appear in:
            - infobox descriptions
            - infobox attributes
            - web result titles
            - web result descriptions

            IMPORTANT NON-TERMINAL CASES:
            The following do NOT make an entity terminal by themselves:
            - Being publicly traded
            - Being large or multinational
            - Having many shareholders
            - Having institutional investors
            - Being an operating company that primarily produces goods or services

            DEFAULT BIAS:
            - Be conservative.
            - If evidence is weak or ambiguous → NOT_TERMINAL.
            - False positives (incorrect TERMINAL) are worse than false negatives.

            OUTPUT RULES:
            - Output JSON ONLY.
            - No prose, no markdown.
            - Cite explicit evidence with source_path pointers.
            """
        
        self._user_message = f"""
            TASK
            Determine whether the following entity is TERMINAL for company-level financial influence research.

            ENTITY_NAME
            {entity_name}

            SEARCH_RESULTS (Brave JSON)
            {search_results}

            OUTPUT
            Return ONLY JSON matching this schema exactly:

            {{
            "decision": "TERMINAL|NOT_TERMINAL",
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
            - source_path must be a JSON-path-like pointer into SEARCH_RESULTS
            (e.g., "infobox.results[0].description", "web[3].description")
            - If decision is TERMINAL:
            - evidence MUST include at least one explicit terminal signal
            - If no strong terminal signals are present:
            - decision MUST be NOT_TERMINAL
            - notes may briefly explain ambiguity or why the entity was classified as TERMINAL

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