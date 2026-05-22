from datetime import datetime
from typing import Any, Dict
from app.core.jobs.job import Job
from app.core.jobs.jobs.llm_callback_job import LlmCallbackJob
from app.core.jobs.job_status import JobStatus
from fast_json_repair import loads
from app.util.clean_json_response import custom_repair_json

@Job.register(name="project_dedupe_to_final_graph")
class ProjectDedupeToFinalGraph(LlmCallbackJob):
    requirements: Dict[str, Any] = {
        "cpu": 1,
        "gpu": 1,
    }

    label: str = "Project Dedupe To Final Graph"
    description: str = "Projects the dedupe pass output back into the final_pass graph JSON shape."

    async def run(self, platform: str):
        await super().run(platform)

        self._max_retries = 1
        self._model = "x-ai/grok-4.3"

        # IMPORTANT: no web tool, this is purely a structural projection.
        # (Do not set plugins.)

        dedupe_output = self.input.get("dedupe", self.input)

        self._system_message = f"""
You are a deterministic JSON-to-JSON projection engine.

GOAL
Transform the provided INPUT_JSON (dedupe pass output) into exactly this output structure:

{{
  "entities": [ ...Entity ],
  "relationships": [ ...Relationship ]
}}

Where:
Entity = {{ "name": string, "entity_type": "ORG"|"PER" }}

Evidence = {{ "excerpt": string, "source": string }}

Relationship =
{{
  "target_entity": string,
  "source_entity": string,
  "relation": "owns"|"invested in",
  "is_ownership": boolean,
  "evidence": [ ...Evidence ]
}}

CRITICAL RULES
1) STRICTLY GROUNDED: Use ONLY strings already present in INPUT_JSON. Do not browse. Do not use prior knowledge.
2) OUTPUT JSON ONLY: Return a single JSON object. No markdown, no code fences, no commentary.
3) EXACT RELATION VOCAB: relationship.relation MUST be exactly "owns" or "invested in".
4) DO NOT MODIFY SEMANTICS:
   - Do not change relation types.
   - Do not change is_ownership values.
   - Do not rewrite evidence excerpts/sources.
   - Only select/forward the correct objects and ensure the required output shape.
5) ENTITY UNIQUENESS:
   - Entities must be unique by exact "name" (case-sensitive).
6) RELATIONSHIP UNIQUENESS:
   - Relationships must be unique by tuple (source_entity, target_entity, relation).
   - If duplicates exist, merge evidence arrays and dedupe identical Evidence objects.
7) SELF-RELATIONSHIP REMOVAL:
   - If source_entity == target_entity, omit that relationship.

HOW TO INTERPRET INPUT_JSON
- Prefer INPUT_JSON.final_entities and INPUT_JSON.final_relationships as the authoritative post-dedupe graph.
- If those keys are missing, you may fall back to:
  - Entities: INPUT_JSON.entities (if present)
  - Relationships: INPUT_JSON.relationships (if present)
- Ignore other keys (canonical_entities, merge_decisions, removed_relationships) except as debugging context; do not emit them.

FINAL OUTPUT CONSTRAINTS
- Return ONLY the final JSON object with keys "entities" and "relationships".
- No extra keys.
- Ensure JSON is valid and parseable.
"""

        self._user_message = f"""
INPUT_JSON
{dedupe_output}

TASK
Project the dedupe output back into the final graph format:

{{
  "entities": [
    {{ "name": "...", "entity_type": "ORG" }},
    {{ "name": "...", "entity_type": "PER" }}
  ],
  "relationships": [
    {{
      "target_entity": "...",
      "source_entity": "...",
      "relation": "owns" | "invested in",
      "is_ownership": true | false,
      "evidence": [
        {{ "excerpt": "...", "source": "https://..." }}
      ]
    }}
  ]
}}

REQUIREMENTS
- Prefer `final_entities` and `final_relationships` from INPUT_JSON if present.
- Do not invent new entities, relationships, or evidence.
- Enforce dedupe rules and remove self-relationships.
- Return JSON ONLY (no markdown, no explanations).
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

        self._set_output(result_obj)
        self.complete(result_obj)

    def is_valid_result(self, result):
        if super().is_valid_result(result) == False:
            return False

        try:
            cleaned_result = custom_repair_json(result)
            loads(cleaned_result)
        except Exception:
            return False

        return True
