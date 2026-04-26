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

@Job.register(name="find_article_entities")
class FindArticleEntities(LlmCallbackJob):
    requirements: Dict[str, Any] = {
        "cpu": 1,
        "gpu": 1,
    }

    label: str = "Identify Article Subjects"
    description: str = "Finds the companies in the article."
    
    async def run(self, platform: str):
        self._platform = platform
        self._model = "openai/gpt-oss-120b:exacto"

        await super().run(platform)

        article_text = self.input["article_text"]

        self._system_message = f"""You are a precise information extraction engine.
Return ONLY valid JSON. No markdown, no commentary.
Follow the schema exactly. Do not invent entities not present in the text.
"""
        
        self._user_message = f"""Extract company entities from the news article below.

Definitions / scope:
- “Company entity” means a for-profit business or its top-level corporate parent (public or private).
- Exclude: people, governments, agencies, NGOs, universities, political groups, and generic orgs that are not companies.
- If a brand/product/division is mentioned (e.g., “iPhone”, “AWS”, “YouTube”), map it to its parent company name in the entities list (e.g., Apple, Amazon, Alphabet). You may still include the brand/division as a tag.
- If both a parent and subsidiary are mentioned, include both as separate entities, but prefer the parent for prominence scoring.
- Deduplicate by canonical company name.

Headline handling:
- The article begins with a headline line. Identify all company entities that appear in the headline (including via brand/product mentions that map to a parent).
- Headline entities must be a subset of entities.

Relevance scoring rules:
- Provide a relevance score (0.0-1.0) for every extracted entity.
- At least one entity must have relevance > 0.0.
- Exactly ONE entity must have relevance == 1.0.
- The entity with relevance == 1.0 must be the single most prominent TOP PARENT company featured in the article.
- If multiple companies are prominent, choose the one most central to the article’s main event (deal/earnings/lawsuit/product launch/controversy), and score others lower.

Output JSON schema (STRICT):
{{
  "headline_entities": ["<canonical company name>", ...],
  "entities": [
    {{
      "name": "<canonical company name>",
      "entity_type": "ORG",
      "tags": ["<short tags>", ...],
      "relevance": <number>
    }}
  ]
}}

Tag guidance:
- Tags are short, lowercase phrases like: "product", "subsidiary", "brand mentioned", "competitor", "acquirer", "target", "regulator mentioned", "partner", "customer".
- Use tags to note if the company appears in the headline ("headline") and/or if it is a parent for a mentioned brand ("parent of brand").

Article text:
{article_text}
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

        return True

    def contains_valid_keys (self, results_obj, keys):
        for key in keys:
            if key not in results_obj:
                return False

            if len(results_obj[key]) == 0:
                return False