from datetime import datetime
from typing import Any, Dict
from app.core.jobs.job import Job
from app.core.jobs.jobs.llm_callback_job import LlmCallbackJob
from app.core.jobs.job_status import JobStatus
from fast_json_repair import loads
from app.util.clean_json_response import custom_repair_json

@Job.register(name="dedupe_entities_with_web")
class DedupeEntitiesWithWeb(LlmCallbackJob):
    requirements: Dict[str, Any] = {
        "cpu": 1,
        "gpu": 1,
    }

    label: str = "Dedupe Entities With Web"
    description: str = "Canonicalizes and deduplicates entities/relationships using web verification for identity equivalence only."

    async def run(self, platform: str):
        await super().run(platform)

        self._max_retries = 1
        self._model = "google/gemma-4-31b-it"

        # Optional: match your other web-enabled jobs
        self._parameters["extra_headers"] = {
            "X-Reasoning-Enabled": "true",
            "X-Reasoning-Effort": "high"
        }
        self._parameters["plugins"] = [{"id": "web"}]

        # Expected input: a graph JSON from your final pass
        # {
        #   "entities": [{ "name": "...", "entity_type": "ORG|PER" }, ...],
        #   "relationships": [{ "source_entity": "...", "target_entity": "...", "relation": "...", ... }, ...]
        # }
        input_graph = self.input.get("graph", self.input)

        self._system_message = f"""
You are a deterministic entity-canonicalization and deduplication engine.

GOAL
Given ENTITIES + RELATIONSHIPS, identify and merge entities that refer to the SAME real-world org/person.
You MAY use the web tool ONLY to verify identity equivalence (NOT ownership, NOT investors).

ABSOLUTE RULES
1) Do NOT invent new entities.
2) Do NOT invent new relationships.
3) Do NOT add new ownership/investment facts from the web.
4) ONLY merge when identity equivalence is strongly verifiable.
5) If uncertain, DO NOT MERGE.

WHAT "SAME ENTITY" MEANS
Two entities are the same if they refer to the same legal entity or universally recognized shorthand.

Examples of SAME:
- "General Motors" == "General Motors Company"
- "Alphabet" == "Alphabet Inc."
- "Meta" == "Meta Platforms, Inc."

Examples of DIFFERENT:
- "General Motors" != "GM Financial"
- "Alphabet" != "Google DeepMind"
- "Amazon" != "Amazon Web Services"

ALLOWED EVIDENCE FOR EQUIVALENCE (identity only)
- Official company website / investor relations: “X is the official name / X is commonly known as Y”
- Wikipedia lead sentence that equates names
- SEC filings / official registries that show legal name vs common name
- Reputable exchange/company profile pages that explicitly equate the names

DISALLOWED SIGNALS (do NOT merge based on these alone)
- Shared branding or logo
- Similar domain name
- Industry similarity
- Subsidiary / division relationships
- Name substring overlap by itself

GUARDRAILS — CHECKLIST (MUST PASS ALL BEFORE MERGING A and B)
[ ] Authoritative source explicitly equates A and B as the same entity (not parent/subsidiary)
[ ] No indication that one is a subsidiary/division/arm of the other
[ ] Equivalence is not time-bound in a way that would make them different today (e.g., spin-off)
[ ] Substring similarity is NOT the primary reason for the merge

If ANY checkbox fails => DO NOT MERGE.

ANTI-OVERMERGE RULE
Substring overlap alone is NEVER sufficient. "X" and "X Something" are different unless an authoritative source explicitly equates them.

CANONICAL NAME SELECTION
If merging:
- Prefer the most complete legal name if available (e.g., "General Motors Company" over "General Motors").
- Otherwise prefer the most commonly used name if sources indicate it is the standard reference.

RELATIONSHIP SANITY RULES
- After canonicalization, if source_entity == target_entity, DELETE that relationship (self-identity loop).
- Do NOT convert relationship types. Only update names.

RELATIONSHIP PRESERVATION (HARD REQUIREMENT)
- Treat INPUT relationships as authoritative.
- You MUST carry forward every input relationship into final_relationships,
  except relationships that become self-relationships after canonicalization
  (source_entity == target_entity), which MUST be removed.
- You are NOT allowed to omit relationships for ambiguity or uncertainty.
- You are NOT allowed to change relation/is_ownership/evidence, only entity name rewrites.

OUTPUT REQUIREMENTS
Return JSON ONLY. No markdown. No commentary.
Return the schema exactly as requested by the user message.
"""

        self._user_message = f"""
INPUT_GRAPH
{input_graph}

TASK
1) Determine merge groups of entities that are the SAME entity, using web verification ONLY for identity equivalence.
2) Apply merges by selecting a canonical name per group.
3) Rewrite all relationships to use canonical names.
4) Remove any relationship where source_entity == target_entity after rewriting.
5) Keep relationship fields (relation, is_ownership, evidence) unchanged except name rewrites.
6) Do NOT add new entities or relationships.

OUTPUT JSON SCHEMA (exactly):
{{
  "canonical_entities": [
    {{
      "canonical_name": string,
      "entity_type": "ORG"|"PER",
      "aliases": [string]
    }}
  ],
  "merge_decisions": [
    {{
      "entity_a": string,
      "entity_b": string,
      "same_entity": boolean,
      "confidence": "high"|"medium"|"low",
      "reason": string,
      "sources": [string]
    }}
  ],
  "removed_relationships": [
    {{
      "reason": "self-identity after merge",
      "original_relationship": {{
        "target_entity": string,
        "source_entity": string,
        "relation": "owns"|"invested in",
        "is_ownership": boolean,
        "evidence": [{{"excerpt": string, "source": string}}]
      }}
    }}
  ],
  "final_entities": [
    {{ "name": string, "entity_type": "ORG"|"PER" }}
  ],
  "final_relationships": [
    {{
      "target_entity": string,
      "source_entity": string,
      "relation": "owns"|"invested in",
      "is_ownership": boolean,
      "evidence": [{{"excerpt": string, "source": string}}]
    }}
  ]
}}

NOTES
- canonical_entities should contain one entry per canonical identity.
- aliases must include every merged name (excluding the canonical name is allowed but preferred to include it too).
- merge_decisions should include only the pairs you actually evaluated/merged or rejected.
- sources should be URLs you used for identity equivalence verification. If none, use [].
- If you cannot confidently merge, leave them separate and set same_entity=false.
Return JSON ONLY.
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
