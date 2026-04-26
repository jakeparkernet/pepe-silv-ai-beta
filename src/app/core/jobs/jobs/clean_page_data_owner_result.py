from datetime import datetime
from typing import Any, Dict
from app.core.jobs.job import Job
from app.core.jobs.jobs.llm_callback_job import LlmCallbackJob
from app.core.jobs.job_status import JobStatus
from app.edge.edge_runner_factory import get_edge_runner
from app.functions.get_llm_response import get_llm_response
from fast_json_repair import loads
from app.util.clean_json_response import custom_repair_json

@Job.register(name="clean_page_data_owner_result")
class CleanPageDataOwnerResult(LlmCallbackJob):
    requirements: Dict[str, Any] = {
        "cpu": 1,
        "gpu": 1,
    }

    label: str = "Clean data result"
    description: str = "Clean find owners from page data"
    
    async def run(self, platform: str):
        await super().run(platform)

        company = self.input["company"]
        owners_obj = {
            "owners": self.input["owners"]
        }
        
        self._model = "x-ai/grok-4.1-fast"

        self._system_message = f"""
            You are a validation and filtering engine.

            Your role is to REMOVE invalid entries from a structured dataset.
            You must not add, infer, or modify any information.

            CRITICAL RULES:
            - Use ONLY the provided JSON and excerpts.
            - Do NOT use outside knowledge or assumptions.
            - Do NOT reinterpret or expand excerpts.
            - Do NOT preserve entries unless they are explicitly justified.

            VALIDATION STANDARD:
            An entry is valid ONLY if a reasonable reader,
            given ONLY the excerpt,
            would clearly conclude that a financial ownership, investment,
            acquisition, parent/subsidiary, or control relationship is explicitly stated.

            If there is ambiguity, implication, or uncertainty:
            REMOVE the entry.

            OUTPUT REQUIREMENTS:
            - Return the JSON in the exact same format.
            - Only remove invalid entries.
            - Do not add new entries or commentary.

            FAIL-SAFE BEHAVIOR:
            - When uncertain, remove the entry.
            - It is acceptable and expected to return an empty result.
            """
        
        self._user_message = f"""
            You are validating extracted financial control relationships.
            You must be extremely strict.

            You are given a JSON object containing candidate ownership/control relationships.
            Your task is to REMOVE any entry that does not meet ALL criteria below.

            ──────────────
            ENTITY VALIDATION (REQUIRED)

            REMOVE an entry if source_entity is:
            - A person
            - A role or title
            - A vague or generic collective noun (e.g. "shareholders", "investors", "lenders")
            - A descriptive phrase rather than a named organization
            - Anything that is not clearly a specific company or legal entity

            ──────────────
            EXPLICITNESS VALIDATION (REQUIRED)

            REMOVE an entry if the excerpt does NOT, on its own, explicitly state a financial
            ownership, investment, acquisition, parent/subsidiary, or control relationship
            between source_entity and the target company.

            The relationship MUST be directly stated in the excerpt.
            Do NOT allow:
            - Implication
            - Assumption
            - Contextual inference
            - Relationships that require combining information from multiple sentences

            Examples of INVALID excerpts:
            - "Company A partnered with Company B"
            - "Company A works closely with Company B"
            - "Company B is one of Company A's key clients"
            - "Company A supports Company B"
            - "Company B announced a deal with Company A" (no control stated)

            Examples of VALID excerpts:
            - "Company A owns 10% of Company B"
            - "Company B is a subsidiary of Company A"
            - "Company A acquired Company B in 2022"
            - "Company B is backed by Company A"
            - "Company A invested $50M in Company B"

            ──────────────
            EVIDENCE INTEGRITY (REQUIRED)

            REMOVE an entry if:
            - The excerpt does not clearly reference BOTH the source_entity and the target company
            - The excerpt is vague, indirect, or ambiguous about the nature of the relationship
            - The excerpt discusses a relationship type outside ownership, investment, acquisition, or control

            ──────────────
            OUTPUT RULES

            - Do NOT add new entries
            - Do NOT modify valid entries
            - Only REMOVE invalid entries
            - Return the JSON in the SAME FORMAT, with invalid entries removed

            RETURN EXACTLY:

            {{
                "owners": [
                    ...
                ]
            }}

            OWNERS_JSON:
            {owners_obj}
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

        result_obj["metadata"] = self.metadata

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