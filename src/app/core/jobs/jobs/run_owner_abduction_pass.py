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

@Job.register(name="run_owner_abduction_pass")
class RunOwnerAbductionPass(LlmCallbackJob):
    requirements: Dict[str, Any] = {
        "cpu": 1,
        "gpu": 1,
    }

    label: str = "Validate Owner Extraction"
    description: str = "Validates the extracted owners"
    
    async def run(self, platform: str):
        await super().run(platform)

        self._max_retries = 1

        self._model = "google/gemma-4-31b-it"

        candidates_json = self.input["candidates_json"]
        company = self.input["company"]
        page_data = self.input["page_data"]
        
        self._system_message = f"""
            You are a deterministic verifier for extracted relationships.

            You will be given:
            1) COMPANY
            2) DATA (the same text source)
            3) CANDIDATES (a list of proposed upstream relationships, each with an excerpt)

            Your task:
            Validate each candidate using ONLY DATA.
            Return ONLY the subset that is CURRENT, UPSTREAM, and NOT contradicted or terminated by any other statement in DATA.

            CRITICAL RULES:
            - Use ONLY the provided DATA and the candidate excerpts.
            - Do NOT use outside knowledge or inference.
            - If uncertain, reject the candidate.

            VALIDATION CHECKS (ALL REQUIRED):
            1) UPSTREAM DIRECTION:
            Confirm the excerpt clearly states source_entity has control/ownership/investment over COMPANY.
            If the excerpt could also be read as downstream, reject.

            2) CURRENT VALIDITY:
            Reject if the excerpt is past-tense, time-bounded, or historical without explicit present validity.

            3) CONTRADICTION / TERMINATION SCAN (within DATA):
            Search DATA for cues that the relationship ended or reversed:
            "sold", "divested", "spun off", "ceased", "merged into", "reorganized", "bankruptcy reorganization",
            "formerly", "until", "no longer", "ended", "terminated", "exited", "renamed", "became independent".
            If such cues apply to the same entities/relationship, reject.

            4) NON-LEGAL ENTITY / BRAND TRAP:
            Reject if source_entity is described as a brand, division, marque, or product line rather than a controlling legal entity.

            EVIDENCE RULE:
            - You may keep a candidate ONLY if its own excerpt is sufficient AND nothing in DATA invalidates it.
            - Do not add new candidates. Only filter.

            OUTPUT REQUIREMENTS:
            - Output must be valid JSON exactly matching the schema.
            - No commentary, no extra fields.
            - If none survive, return {{"owners": []}}.

            """
        
        self._user_message = f"""
            COMPANY:
            {company}

            CANDIDATES (JSON):
            {candidates_json}

            DATA:
            {page_data}

            Return ONLY those candidates that are:
            - UPSTREAM over COMPANY,
            - CURRENT / still valid today per DATA,
            - Not contradicted, terminated, or reversed anywhere else in DATA.

            If a candidate is uncertain, reject it.
            Output ONLY:
            {{
                "owners": [ ...validated candidates... ]
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

        owners = result_obj["owners"]

        for owner in result_obj["owners"][:]:
            if owner["source_entity"] == self.input["company"]:
                result_obj["owners"].remove(owner)

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

        if "owners" not in results_obj:
            return False

        return True