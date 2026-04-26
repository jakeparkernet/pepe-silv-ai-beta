from datetime import datetime
from typing import Any, Dict
from app.core.jobs.job import Job
from app.core.jobs.jobs.llm_callback_job import LlmCallbackJob
from app.core.jobs.job_status import JobStatus
from app.edge.edge_runner_factory import get_edge_runner
from app.functions.get_llm_response import get_llm_response
from fast_json_repair import loads
from app.util.clean_json_response import custom_repair_json

@Job.register(name="ensure_top_down_relationships")
class FindArticleEntities(LlmCallbackJob):
    requirements: Dict[str, Any] = {
        "cpu": 1,
        "gpu": 1,
    }

    label: str = "Ensure Top-Down Relationships"
    description: str = "Make sure the relationships are directionally correct"
    
    async def run(self, platform: str):
        await super().run(platform)

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

                                 The parent company is always the source_entity.

                                 It's possible for all of the relationships to be top-down already.

                                 If the relationship indicates ANY kind of financial dominance, such as owns, invests in, etc, mark the is_ownership as true,
                                 and mark it false if not.

                                 RESPOND ONLY WITH JSON IN THE FOLLOWING FORMAT:
                                 {{
                                    "relationships": [
                                        {{
                                            "source_entity": "Person Name",
                                            "target_entity": "Company Name",
                                            "relation": "owns",
                                            "evidence": [
                                                "Person Name, owner of Company Name, announced a new product on Tuesday."
                                            ],
                                            is_ownership: true
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

            if len(results_obj[key]) == 0:
                return False