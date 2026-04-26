import json
from datetime import datetime
from typing import Any, Dict
from app.core.jobs.jobs.llm_callback_job import LlmCallbackJob
from app.core.jobs.job import Job

@Job.register(name="generate_context_callback")
class GenerateContextCallback(LlmCallbackJob):

    label: str = "Generate Context Callback"
    description: str = "Generates context from an entity and a longer context"

    async def run(self, platform: str):
        await super().run(platform)

        entity_name = self.input["entity_name"]
        long_context = self.input["long_context"]

        self._append_history({
            "timestamp": datetime.now().isoformat(),
            "event": "RUN_START",
            "details": {
                "entity_name": entity_name,
                "long_context": long_context
            },
        })

        self._system_message=f"""You are an expert at answering questions.
            Your answers are precise and concise. You follow directions exactly."""

        self._user_message = f"""Based on the following DATA, generate 3-5 keywords related to the ENTITY.
                           These keywords should be specific enough to distinguish it
                           from and entity with a similar name. The keywords should also represent the entity
                           independet of other entities (i.e., do not relationships or positions compared to
                           other companies/entities).

                           If this is a company, keywords should include the kind of company
                           (tech, medical, news, defense, automotive, etc.)
                           
                           RESPOND ONLY WITH JSON IN THE FOLLOWING FORMAT:
                           {{
                            "keywords": [
                                KEYWORD 1,
                                KEYWORD 2,
                                ...
                            ]
                           }}

                           """

        return self.run_llm_loop()

    def is_valid_response(self, response):
        if super().is_valid_response(response) == False:
            return False

        results_obj = {}

        try:
            results_obj = json.loads(response["result"])
        except Exception as e:
            return False

        if "keywords" not in results_obj:
            return False

        if len(results_obj["keywords"]) == 0:
            return False

        return True
        

    def got_valid_result(self, response):
        result_obj = json.loads(response["result"])
        self._set_output(result_obj)
        return self.complete(result_obj)