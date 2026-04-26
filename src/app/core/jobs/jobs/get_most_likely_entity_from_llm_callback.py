from datetime import datetime
from typing import Any, Dict
import logging
from app.core.jobs.job import Job
from app.core.jobs.jobs.llm_callback_job import LlmCallbackJob
from app.core.jobs.job_status import JobStatus
from app.edge.edge_runner_factory import get_edge_runner
from app.functions.get_llm_response import get_llm_response
from app.util.get_value_safe import get_value_safe
from fast_json_repair import loads
from app.util.clean_json_response import custom_repair_json
from pydantic import PrivateAttr

logger = logging.getLogger(__name__)

@Job.register(name="get_most_likely_entity_from_llm_callback")
class GetMostLikelyEntityFromLlm(LlmCallbackJob):
    requirements: Dict[str, Any] = {
        "cpu": 1,
        "gpu": 1,
    }

    label: str = "Get Most Likely Entity From LLM"
    description: str = "Finds the most likely entity in a list given a name and context."

    _min_confidence: float = PrivateAttr(default=0.95)

    async def run(self, platform: str):
        await super().run(platform)

        self._model = "x-ai/grok-4.1-fast"

        entities = self.input["entities"]
        if len(entities) == 0:
            entity_name = get_value_safe(self.input, "entity_name", None)
            logger.warning(
                "[get_most_likely_entity_from_llm_callback] Input entities list is empty; entity_name=%r",
                entity_name,
            )
            self._append_history(
                {
                    "timestamp": datetime.now().isoformat(),
                    "event": "EMPTY_INPUT_ENTITIES",
                    "details": {"entity_name": entity_name},
                }
            )
            self._set_output(None)
            self.complete(None)
            return

        entity_name = self.input["entity_name"]
        tags = get_value_safe(self.input, "tags", [])
        context = get_value_safe(self.input, "context", "")
        self._min_confidence = get_value_safe(self.input, "min_confidence", self._min_confidence)

        self._append_history({
            "timestamp": datetime.now().isoformat(),
            "event": "RUN_START",
            "details": {
                "entities": entities,
                "entity_name": entity_name
            },
        })

        if entities is None:
            raise ValueError("entities parameter is null")

        self._system_message = """
            You are a strict entity selection engine.

            Goal:
            Select up to 3 entities from the provided Entities list that most likely refer to the same intended entity as QUERY_NAME, using only the provided data.

            Rules:
            - Use ONLY the information in this prompt and the Entities list. Do not use outside knowledge.
            - Prefer false negatives over false positives. If no entity is a strong match, return an empty entities array.
            - Similar names alone are not sufficient. Tags/context must not contradict.
            - If there is any plausible ambiguity (multiple candidates fit similarly, or evidence is weak), reduce confidence.

            Scoring:
            - confidence is a number from 0 to 1 representing P(this candidate is the intended match | provided data).
            - Only include candidates with confidence >= 0.55. If none meet this threshold, return {"entities": []}.
            - Rank candidates by confidence descending. Return at most 3.

            Output:
            Return ONLY valid JSON with exactly this shape:
            {"entities":[{"id":ID,"name":NAME,"confidence":CONFIDENCE}, ...]}
            No extra keys, no prose, no markdown.
            """

        self._user_message = f"""
            Task:
            Given QUERY_NAME and QUERY_TAGS, choose the best matching entities from Entities list. The correct match may be absent.

            QUERY_NAME:
            {entity_name}

            QUERY_TAGS:
            {tags}

            Decision criteria (use all that apply):
            - Name match strength: exact match, prefix match, substring match, token overlap, common abbreviations (only if evidenced in context/tags).
            - Tag alignment: overlapping or compatible tags increase confidence; conflicting tags decrease confidence sharply.
            - Context alignment: if context strongly suggests a different domain/meaning, lower confidence.
            - Ambiguity: if multiple entities could match, lower confidence for all; do NOT guess.

            Return:
            Return ONLY JSON in this exact format:
            {{"entities": [{{"id": ID, "name": NAME, "confidence": YOUR_CONFIDENCE_SCORE}},
                        {{"id": ID, "name": NAME, "confidence": YOUR_CONFIDENCE_SCORE}},
                        {{"id": ID, "name": NAME, "confidence": YOUR_CONFIDENCE_SCORE}}]}}

            If no candidate is strong enough, return:
            {{"entities": []}}

            Entities list:
            {entities}
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

        result_entities = results_obj["entities"]
        if len(result_entities) == 0:
            entity_name = get_value_safe(self.input, "entity_name", None)
            logger.info(
                "[get_most_likely_entity_from_llm_callback] LLM returned zero candidates; entity_name=%r min_confidence=%.2f",
                entity_name,
                self._min_confidence,
            )
            self._append_history(
                {
                    "timestamp": datetime.now().isoformat(),
                    "event": "ZERO_CANDIDATES_RETURNED",
                    "details": {
                        "entity_name": entity_name,
                        "min_confidence": self._min_confidence,
                    },
                }
            )

        if len(result_entities) == 1 and result_entities[0]["confidence"] >= self._min_confidence:
            results_obj["entity"] = result_entities[0]
            self._set_output(results_obj["entity"])
            self.complete(results_obj)
            return
        
        if len(result_entities) > 1:
            result_entities = sorted(result_entities, key=lambda entity: entity["confidence"], reverse=True)
            if result_entities[0]["confidence"] >= self._min_confidence:
                results_obj["entity"] = result_entities[0]
                self._set_output(result_entities[0])
                self.complete(results_obj)
                return

        self._set_output({"result": None})
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

        if "entities" not in results_obj:
            return False

        return True
