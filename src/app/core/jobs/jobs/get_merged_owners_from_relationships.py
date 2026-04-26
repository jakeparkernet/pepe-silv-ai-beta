import json
from datetime import datetime
from typing import Any, Dict
from app.core.jobs.jobs.llm_callback_job import LlmCallbackJob
from app.core.jobs.job import Job
from fast_json_repair import loads
from app.util.clean_json_response import custom_repair_json

@Job.register(name="get_merged_owners_from_relationships")
class MergeEntities(LlmCallbackJob):

    label: str = "Merge duplicate owners"
    description: str = "Checks entities and merges duplicates"

    async def run(self, platform: str):
        await super().run(platform)

        self._model = "x-ai/grok-4.1-fast"

        relationships = self.input["relationships"]

        self._append_history({
            "timestamp": datetime.now().isoformat(),
            "event": "RUN_START",
            "details": {
                "relationships": relationships
            },
        })

        self._system_message = f"""You are an expert at answering questions.
            Your answers are precise and concise. You follow directions exactly."""

        self._user_message = f"""Look at all of these relationships and return a json dictionary of merged entities and their aliases, using the following instructions:
                                Each key in the json should be the most straight-forward name of the entity that is
                                1. Not an abbreviation
                                2. Does not begin with an article
                                3. Does not have a coorporate designator such as .Inc, Co, LLC, etc
                                4. Is an obvious, commonly used name for the company given the context and names

                                Each value should be an array of the remaining names, plus the chosen key.

                                For example, given the following entity names:
                                "Vanguard Group", "Vanguard", "The Vanguard Group", "Vanguard, Inc." "Vanguard, LLC"

                                We should see the following output:
                                {{
                                    "entities": [
                                        "Vanguard": [
                                            "Vanguard Group",
                                            "The Vanguard Group",
                                            "Vanguard, Inc.",
                                            "Vanguard, LLC",
                                            "Vanguard"
                                        ]
                                    ]
                                }}

                                Use the RELATIONSHIPS array below to get all of the context you need.

                                RESPOND ONLY IN JSON IN THE FOLLOWING FORMAT:
                                {{
                                    "entities": {{
                                        "Company A": [
                                            "Alias A1",
                                            "Alias A2",
                                            "Company A"
                                        ],

                                        "Company B": [
                                            "Alias B1",
                                            "Alias B2",
                                            "Company B"
                                        ]
                                    }}
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
            ["entities"]
            ) == False:
            
            return False

    
    def contains_valid_keys (self, results_obj, keys):
        for key in keys:
            if key not in results_obj:
                return False