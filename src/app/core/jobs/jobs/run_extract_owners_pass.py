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

@Job.register(name="run_extract_owners_pass")
class RunExtractOwnersPass(LlmCallbackJob):
    requirements: Dict[str, Any] = {
        "cpu": 1,
        "gpu": 1,
    }

    label: str = "Extract Owners"
    description: str = "Extracts owners from page data"
    
    async def run(self, platform: str):
        await super().run(platform)

        self._max_retries = 1

        self._model = "google/gemma-4-31b-it"

        company = self.input["company"]
        context = self.input["context"]
        page_data = self.input["page_data"]
        
        self._system_message = f"""
            You are an information extraction engine operating in a deterministic pipeline.

            Your role is to extract ONLY UPSTREAM financial control relationships over COMPANY
            (meaning: some named organization has ownership, investment, acquisition, or control over COMPANY)
            ONLY when explicitly supported by the provided text.

            CRITICAL RULES:
            - Use ONLY the content provided by the user.
            - Do NOT use prior knowledge, training data, or assumptions.
            - Do NOT infer or imply relationships.
            - If a relationship is not explicitly stated in the text, it does not exist.

            UPSTREAM-ONLY CONSTRAINT (HARD):
            - Output ONLY relationships where source_entity is the controller/owner/acquirer/investor and COMPANY is the controlled/owned/acquired/invested-into entity.
            - If the excerpt states that COMPANY owns/controls/acquired/invested in another entity (downstream direction), EXCLUDE it.
            - Never reverse direction to force an upstream relationship.

            TEMPORAL VALIDITY (HARD, CURRENT-ONLY):
            - Output ONLY relationships that are presented as CURRENT (present-tense or currently true).
            - If the excerpt is clearly historical, past-tense, time-bounded, or indicates the relationship ended (e.g., “was”, “formerly”, “until”, “sold”, “divested”, “spun off”, “merged into”, “reorganized”, explicit past dates),
            then EXCLUDE it from output.

            EVIDENCE REQUIREMENT:
            Every extracted relationship MUST be justified by a SINGLE contiguous excerpt:
            one sentence OR one bullet OR one table row from the provided text.
            No multi-sentence stitching.

            DIRECTIONALITY REQUIREMENT:
            The excerpt must explicitly encode direction that source_entity controls COMPANY
            (e.g., “X owns COMPANY”, “COMPANY is owned by X”, “Parent: X”, “COMPANY is a subsidiary of X”, “X acquired COMPANY”).
            If direction is ambiguous, EXCLUDE.

            ENTITY RULE:
            source_entity MUST be a named organization / legal entity.
            Do NOT output people, roles, governments-as-collectives (“shareholders”), or generic groups unless part of a formal name.

            FAIL-SAFE BEHAVIOR:
            - When in doubt, exclude the relationship.
            - Absence of evidence is not an error.
            - Precision and explicit grounding are more important than completeness.

            OUTPUT REQUIREMENTS:
            - Output must be valid JSON exactly matching the requested schema.
            - No commentary, explanations, or extra fields.
            - If no valid relationships are found, return {{"owners": []}}.

            """
        
        self._user_message = f"""
            Use ONLY the information in DATA below.
            Do NOT use outside knowledge about any company.
            Only output relationships explicitly supported by a verbatim excerpt from DATA.

            Goal:
            Extract CURRENT, UPSTREAM evidence that some named organization has an ownership, investment, acquisition, or control relationship OVER COMPANY.

            UPSTREAM MEANS:
            source_entity -> COMPANY
            (source_entity owns/controls/acquired/invested in COMPANY)

            EXCLUDE (HARD):
            - Any downstream relationships where COMPANY owns/controls/invests in/acquires others.
            - Any statements about COMPANY owning brands, divisions, subsidiaries, products, services.
            - Any mentions of brands/divisions/marques/nameplates as “owners” of COMPANY.
            - Any historical or time-bounded relationships (“was”, “formerly”, “until”, “sold”, “divested”, “spun off”, “merged”, explicit past dates) unless the excerpt explicitly states the relationship is still true today.

            EVIDENCE REQUIREMENTS (STRICT):
            You may output a relationship ONLY if a single contiguous excerpt (one sentence OR one bullet OR one table row)
            explicitly states one of these relationship types between a named organization and COMPANY:

            A) Equity ownership / stake (including partial stakes like “10%”)
            B) Parent/subsidiary relationship where COMPANY is the subsidiary (COMPANY is a subsidiary of X / Parent: X)
            C) Acquisition / merger where the named org acquires COMPANY (and the excerpt indicates current ownership/control remains)
            D) Investment / financing into COMPANY (only if it implies ownership/control today OR explicitly states ongoing stake)
            E) Explicit control language (controls, voting rights, majority control) over COMPANY

            DIRECTION MUST BE EXPLICIT:
            The excerpt must explicitly show that the named organization is the controller and COMPANY is the controlled entity.
            If the excerpt does not clearly encode direction, DO NOT include it.

            OUTPUT JSON FORMAT (ONLY):
            {{
            "owners": [
                {{
                "source_entity": "<named org>",
                "target_entity": "<COMPANY>",
                "relation": "owns" | "invested in" | "acquired" | "parent of" | "controls",
                "excerpt": "<verbatim excerpt from DATA>"
                }}
            ]
            }}

            RELATION MAPPING (UPSTREAM-ONLY):
            - If excerpt indicates equity/stake/ownership of COMPANY -> "owns"
            - If excerpt indicates investment/funding/backing into COMPANY with ongoing stake/control -> "invested in"
            - If excerpt indicates acquisition of COMPANY with ongoing ownership/control -> "acquired"
            - If excerpt indicates COMPANY is owned by / subsidiary of / has Parent: X -> use "parent of" (source_entity is the parent)
            - If excerpt explicitly indicates control over COMPANY -> "controls"

            If no explicit CURRENT upstream evidence exists, return {{"owners": []}}.

            COMPANY:
            {company}

            CONTEXT:
            {context}

            DATA:
            {page_data}
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