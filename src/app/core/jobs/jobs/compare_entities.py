from datetime import datetime
from typing import Any, Dict
from app.core.jobs.job import Job
from app.core.jobs.jobs.llm_callback_job import LlmCallbackJob
from app.core.jobs.job_status import JobStatus
from app.edge.edge_runner_factory import get_edge_runner
from app.functions.get_llm_response import get_llm_response
from app.util.get_value_safe import get_value_safe
from fast_json_repair import loads
from app.util.clean_json_response import custom_repair_json
from pydantic import PrivateAttr

@Job.register(name="compare_entities")
class CompareEntities(LlmCallbackJob):
    requirements: Dict[str, Any] = {
        "cpu": 1,
        "gpu": 1,
    }

    label: str = "Compare Entities"
    description: str = "Gives a confidence score as to whether or not two entities are the same."

    _min_confidence: float = PrivateAttr(default=0.95)

    async def run(self, platform: str):
        await super().run(platform)

        self._model = "x-ai/grok-4.3"

        self._min_confidence = get_value_safe(self.input, "min_confidence", self._min_confidence)

        source_entity = self.input["source_entity"]
        target_entity = self.input["target_entity"]

        self._append_history({
            "timestamp": datetime.now().isoformat(),
            "event": "RUN_START",
            "details": {
                "source_entity": source_entity.to_serializeable_object(),
                "target_entity": target_entity.to_serializeable_object()
            },
        })

        self._system_message = """
            You are a strict entity-resolution judge.

            Goal: Decide whether TARGET_ENTITY and SOURCE_ENTITY refer to the exact same real-world entity.

            Rules:
            - Use ONLY the information explicitly present in the two entities (name, tags, context, and any other provided fields).
            - Do NOT use outside knowledge or assumptions.
            - Prefer false negatives over false positives. If evidence is insufficient, uncertainty must reduce confidence.
            - Different subsidiaries/brands/people/locations are NOT the same entity unless the provided data explicitly proves identity.
            - Names can be similar; similarity alone is not proof.
            - If there is any plausible ambiguity, you must lower confidence.

            Output:
            - Return ONLY valid JSON.
            - JSON must have exactly these keys:
            - "same_entity": boolean
            - "confidence": number between 0 and 1 inclusive
            - "confidence" means P(same_entity is true) given ONLY the provided data.
            - No extra keys, no prose, no markdown, no trailing comments.
            """

        self._user_message = f"""
            Task: Determine whether TARGET_ENTITY and SOURCE_ENTITY are the same entity.

            Interpretation constraints:
            - Treat all strings literally.
            - Consider "name" as weak evidence unless supported by tags/context/other fields.
            - If either entity lacks enough detail to prove identity, respond with same_entity=false and a low-to-moderate confidence.
            - Be absolutely sure to return same_entity=true only when the provided properties strongly and unambiguously match.

            Decision guidance (not exhaustive):
            - Strong positive evidence examples: identical unique identifiers, identical website/domain, identical address, identical parent org explicitly stated, identical ticker/registration ID, identical very specific tags/context that match.
            - Strong negative evidence examples: conflicting locations, different industry/type, different parent, different identifiers, incompatible descriptions.

            Return ONLY JSON:
            {{"same_entity": <true|false>, "confidence": <0..1>}}

            TARGET_ENTITY:
            {target_entity}

            SOURCE_ENTITY:
            {source_entity}
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
    
    def got_valid_result (self, result):
        self._append_history({
            "timestamp": datetime.now().isoformat(),
            "event": "RUN_END",
            "details": {"status": self.status},
        })

        cleaned_result = custom_repair_json(result)
        results_obj = loads(cleaned_result)

        self._set_output(results_obj)
        self.complete()

    def is_valid_result (self, result):
        if super().is_valid_result(result) == False:
            return False

        results_obj = {}

        try:
            cleaned_result = custom_repair_json(result)
            results_obj = loads(cleaned_result)
        except Exception as e:
            return False

        if "confidence" not in results_obj:
            return False

        return True