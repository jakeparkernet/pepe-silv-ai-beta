import json
from datetime import datetime
from typing import Any, Dict
from app.core.jobs.job import Job
from app.core.jobs.jobs.llm_callback_job import LlmCallbackJob
from app.core.jobs.job_status import JobStatus
from app.edge.edge_runner_factory import get_edge_runner
from app.functions.get_llm_response import get_llm_response
from fast_json_repair import loads
from app.util.clean_json_response import custom_repair_json

@Job.register(name="ensure_top_down_relationships_id")
class FindArticleEntities(LlmCallbackJob):
    requirements: Dict[str, Any] = {
        "cpu": 1,
        "gpu": 1,
    }

    label: str = "Ensure Top-Down Relationships with IDs"
    description: str = "Make sure the relationships are directionally correct"
    
    # TODO: FINISH PROMPT
    async def run(self, platform: str):
        await super().run(platform)

        self._model = "x-ai/grok-4.3"

        relationships = self.input["relationships"]

        self._system_message = f"""You are an expert data analyst.
                Your answers are correct and concise and you ALWAYS follow instructions EXACTLY!!"""
        
        self._user_message = f"""Examine the RELATIONPSHIPS below and return with a JSON object
                                 that structures the RELATIONSHIPS to be TOP-DOWN ONLY!!

                                 If a relationship is something like "owned by", "employed by", etc,
                                 change it to it's top-down version of "owns" and "employs" and swap the target_entity
                                 and the source_entity.

                                 The goal is to make sure every source_entity is the financially dominant entity
                                 and every target_entity is the entity that is beneath it in the relationship.

                                 The parent company/entity in the position of financial dominance is always the source_entity.

                                 IF THE RELATIONSHIP IS MUTUAL ASSUME IT IS DOMINANT OVER THE target_entity

                                 It's possible for all of the relationships to be top-down already.

                                 ONLY RESPOND WITH THE CORRECTED RELATIONSHIPS!!

                                 If every single relationship is already top-down, respond with an empty relationships array in the json.

                                 RESPOND ONLY WITH JSON IN THE FOLLOWING FORMAT:
                                 {{
                                    "relationships": [
                                        {{
                                            "id": EXISTING ID
                                            "source_entity": "Person Name",
                                            "target_entity": "Company Name",
                                            "relation": "owns",
                                        }}
                                    ]
                                }}

                                RELATIONSHIPS:
                                {relationships}
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
        results_obj = {}

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

        if self.contains_valid_keys(results_obj,
            ["relationships"]
            ) == False:
            
            return False

        return True

    def contains_valid_keys (self, results_obj, keys):
        for key in keys:
            if key not in results_obj:
                return False