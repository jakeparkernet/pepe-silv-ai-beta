import logging
from datetime import datetime
from typing import Any, Dict
from app.core.jobs.job import Job
from app.core.jobs.jobs.llm_callback_job import LlmCallbackJob
from app.core.jobs.job_status import JobStatus
from fast_json_repair import loads
from app.util.clean_json_response import custom_repair_json

logger = logging.getLogger(__name__)


@Job.register(name="aggregate_owner_results")
class AggregateOwnerResults(LlmCallbackJob):
    requirements: Dict[str, Any] = {
        "cpu": 1,
        "gpu": 1,
    }

    label: str = "Aggregate Owner Results"
    description: str = "Aggregates the owner/investor results into a usable shape."

    def _is_non_empty_string(self, value: Any) -> bool:
        return isinstance(value, str) and len(value.strip()) > 0

    def _validate_result_schema(self, results_obj: Dict[str, Any]) -> None:
        if not isinstance(results_obj, dict):
            raise ValueError("aggregate_owner_results output must be an object")

        if "entities" not in results_obj or "relationships" not in results_obj:
            raise ValueError("aggregate_owner_results output must include entities and relationships")

        entities = results_obj.get("entities")
        relationships = results_obj.get("relationships")

        if not isinstance(entities, list):
            raise ValueError("aggregate_owner_results entities must be a list")

        if not isinstance(relationships, list):
            raise ValueError("aggregate_owner_results relationships must be a list")

        for index, entity in enumerate(entities):
            if not isinstance(entity, dict):
                raise ValueError(f"entity at index {index} must be an object")

            if not self._is_non_empty_string(entity.get("name")):
                raise ValueError(f"entity at index {index} has empty name: {entity}")

        for index, relationship in enumerate(relationships):
            if not isinstance(relationship, dict):
                raise ValueError(f"relationship at index {index} must be an object")

            source_entity = relationship.get("source_entity")
            target_entity = relationship.get("target_entity")
            relation = relationship.get("relation")

            if not self._is_non_empty_string(source_entity) or not self._is_non_empty_string(target_entity):
                logger.warning(
                    "[aggregate_owner_results] Invalid relationship endpoint names at index=%s payload=%s",
                    index,
                    relationship,
                )
                raise ValueError(
                    f"relationship at index {index} has empty source_entity or target_entity: {relationship}"
                )

            if relation not in ["owns", "invested in"]:
                raise ValueError(f"relationship at index {index} has invalid relation '{relation}'")

    async def run(self, platform: str):
        await super().run(platform)

        self._max_retries = 1

        self._model = "x-ai/grok-4.1-fast"

        self._system_message = f"""
            You are a deterministic JSON-to-JSON information extraction engine.

            Goal:
            Transform the provided INPUT_JSON into exactly this output structure:

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

            Critical rules:
            1) STRICTLY GROUNDED: Use ONLY facts/strings present in INPUT_JSON. Do not browse. Do not use prior knowledge. Do not invent URLs, quotes, or entities.
            2) OUTPUT JSON ONLY: Return a single JSON object. No markdown, no code fences, no commentary.
            3) EXACT RELATION VOCAB: relationship.relation MUST be exactly either "owns" or "invested in" (lowercase, with a space in "invested in").
            4) FINANCIAL DOMINANCE DIRECTION:
            - "owns": source_entity is the owner/parent; target_entity is the owned/subsidiary/brand.
            - "invested in": source_entity is the investor; target_entity is the investee company.
            5) is_ownership:
            - Any financially related relationship MUST have "is_ownership": true.
            - If you ever include a non-financial relationship (rare), set false. But prefer omitting non-financial relationships unless explicitly needed.
            6) EVIDENCE HANDLING (NO FABRICATION):
            - Evidence.excerpt MUST be a verbatim substring copied from INPUT_JSON (e.g., evidence_quote fields or other explicit quote/excerpt fields).
            - Evidence.source MUST be a URL string copied verbatim from INPUT_JSON (e.g., source_url).
            - If you cannot find BOTH a verbatim excerpt AND a URL for a relationship from INPUT_JSON, set evidence to an empty array [] for that relationship (do NOT invent either field).
            7) DEDUPLICATION:
            - Entities must be unique by exact "name" (case-sensitive). Do not output duplicates.
            - Relationships must be unique by tuple (source_entity, target_entity, relation). If duplicates arise, merge evidence arrays and dedupe identical Evidence objects.

            How to interpret INPUT_JSON:
            A) Determine the TARGET COMPANY (the company being queried):
            - Prefer INPUT_JSON.results.parents.company.name if present.
            - Else INPUT_JSON.results.investors.company.name if present.
            - Else any best available company name field present in INPUT_JSON.
            Always add the target company as an Entity.

            B) Parent ownership extraction:
            - If INPUT_JSON.results.parents.parent exists and has a "name", that is the parent/owner candidate.
            - Regardless of whether parents.parent.relationship says "subsidiary_of", "owned_by", "part_of", "division_of", "acquired_by", etc, OUTPUT must normalize this into:
                relation = "owns"
                source_entity = parent name
                target_entity = target company name
                is_ownership = true
            - Evidence for this relationship should come from:
                parents.parent.evidence_quote (excerpt) AND parents.parent.source_url (source), if both exist.

            C) Investor extraction (robust to schema variants):
            - Investors may appear under either:
                1) INPUT_JSON.results.investors.investors (list), OR
                2) INPUT_JSON.results.investors.top_investors (list), OR
                3) other similar lists that clearly contain objects with a "name" field.
            - For each investor object, extract investor "name" and create an Entity for it.

            D) Fix the "parent investors leaking into company investors" problem:
            You must decide whether each investor invested in the TARGET COMPANY or invested in the PARENT COMPANY (if a parent exists), using ONLY the strings in INPUT_JSON.

            Determine INVESTEE for each investor using this priority:
            1) If the investor object has an "evidence_quote" (or similarly named quote field):
                - If it mentions the PARENT name (substring match, case-insensitive) AND does NOT mention the TARGET name => investee = PARENT.
                - If it mentions the TARGET name (case-insensitive) AND does NOT mention the PARENT name => investee = TARGET.
                - If it mentions both, choose the one that is clearly the recipient in the quote (e.g., “investment in X”, “stake in X”, “shareholder in X”, “invested in X”).
            2) Else, use other investor fields as tie-breakers ONLY if they are present (examples: "prominence_reason", "relationship", "notes", "timeframe", "approximate_stake"):
                - If text explicitly says “shareholder in [PARENT]”, “stake in [PARENT]”, “investor in [PARENT]”, “largest shareholder in [PARENT]”, etc => investee = PARENT.
                - If text explicitly says “invested in/backed [TARGET]” => investee = TARGET.
            3) If still ambiguous, OMIT that investor relationship rather than guessing.

            E) When an “investor” is actually the parent/owner:
            - If an investor item is the same name as the detected parent, OR its text explicitly calls it “parent company” / “fully owns” / “acquired” / “owns/operates”, treat it as an "owns" relationship (parent owns target) rather than "invested in".
            - Deduplicate with the parent relationship if already created.

            F) Relationship output for true investors:
            - relation = "invested in"
            - source_entity = investor name
            - target_entity = investee chosen by the rules above (TARGET or PARENT)
            - is_ownership = true
            - Evidence:
                - If investor object contains BOTH a quote-like field (evidence_quote) and a URL field (source_url), include them as one Evidence object.
                - If multiple quotes/URLs exist for the same relationship in INPUT_JSON, include multiple Evidence objects.
                - If the investor object lacks quote+URL, evidence = [].

            Entity typing:
            - Default entity_type to "ORG".
            - Use "PER" only if INPUT_JSON explicitly indicates a person (e.g., a field says individual/person) or the name is clearly a person AND the input labels it as such. Do not guess.

            Final output constraints:
            - Return only the final JSON object with keys "entities" and "relationships".
            - No extra keys.
            - Ensure the JSON is valid and parseable.
            """
        
        self._user_message = f"""
            You will be given INPUT_JSON which is the raw output of my ownership/investor discovery pipeline.

            TASK
            Extract all entities and financial relationships from INPUT_JSON into exactly this JSON format:

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

            IMPORTANT REQUIREMENTS
            - Use ONLY information present in INPUT_JSON (copy excerpts/URLs verbatim from it).
            - Fix investor contamination:
            If investor text indicates the investor is a shareholder/investor in the PARENT company rather than the TARGET company, attach the "invested in" relationship to the PARENT.
            - Do not invent evidence. If you cannot find both a quote/excerpt and a source_url for a relationship, output evidence: [].
            - Relationship.relation must be exactly "owns" or "invested in".
            - Deduplicate entities and relationships.

            INPUT_JSON
            {self.input}

            Return JSON ONLY (no markdown, no explanations).
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

        self._validate_result_schema(result_obj)

        self._set_output(result_obj)
        self.complete(result_obj)

    def is_valid_result (self, result):
        if super().is_valid_result(result) == False:
            return False

        results_obj = {}

        try:
            cleaned_result = custom_repair_json(result)
            results_obj = loads(cleaned_result)
            self._validate_result_schema(results_obj)
        except Exception as e:
            logger.warning("[aggregate_owner_results] Invalid LLM output: %s", e)
            self._append_history(
                {
                    "timestamp": datetime.now().isoformat(),
                    "event": "INVALID_LLM_OUTPUT",
                    "details": {
                        "error": str(e),
                        "raw_result": str(result)[:2000],
                    },
                }
            )
            return False

        return True

    def contains_valid_keys (self, results_obj, keys):
        for key in keys:
            if key not in results_obj:
                return False
