from datetime import datetime
from typing import Any, Dict
from app.core.jobs.job import Job
from app.core.jobs.jobs.llm_callback_job import LlmCallbackJob
from app.core.jobs.job_status import JobStatus
from app.edge.edge_runner_factory import get_edge_runner
from app.functions.get_llm_response import get_llm_response
from fast_json_repair import loads
from app.util.clean_json_response import custom_repair_json
from pydantic import Field, PrivateAttr
from app.util.markers import returns_awaitable

@Job.register(name="structure_top_investors")
class FindInvestors(LlmCallbackJob):
    requirements: Dict[str, Any] = {
        "cpu": 1,
        "gpu": 1,
    }

    label: str = "Structure Top Investors"
    description: str = "Structure the top investors response."

    async def run(self, platform: str):
        await super().run(platform)

        self._max_retries = 1

        self._model = "x-ai/grok-4.3"

        investors_response = self.input["investors_response"]

        self._parameters["extra_headers"] = {
            "X-Reasoning-Enabled": "false"
        }
        
        self._parameters["plugins"] = [{ 
            "id": "web"
        }]

        self._system_message = f"""
        You are a strict information extraction and normalization engine.

TASK
Given an assistant-produced response that may include investors and citations, extract investors (if any), classify each as high or low priority, and output a single JSON object in EXACTLY this format:

{{
  "investors": [
    {{
      "name": "<investor name>",
      "priority": "high" | "low",
      "source": "<url that was cited>",
      "notes": "<short reason given for believing this is true>"
    }}
  ]
}}

CORE RULES
1) Output must be valid JSON. No markdown. No commentary. No trailing commas.
2) The ONLY top-level key is "investors".

PRIORITY LOGIC (CRITICAL)
Classify investors using **semantic importance**, not list placement.

Mark an investor as "high" priority if ANY of the following apply:
- Explicitly described as top, key, major, largest, or largest shareholder.
- Associated with a known or approximate ownership stake (e.g., “~20% stake”).
- Led or anchored a major funding round, especially the largest round.
- Described as a strategic investor or strategic investment with board representation.
- Named as a major corporate owner or media conglomerate.
- Identified as part of an acquisition or merger that transferred ownership
  AND the investor entity is explicitly named (e.g., “Warner Bros. Discovery”).

IMPORTANT — GROUP DECOMPOSITION RULE
If ownership is described via a GROUP (e.g., “Former Group Nine Media investors”)
AND the response explicitly names one or more recognizable investor entities within that group:
- Extract EACH named investor entity separately.
- Assign each extracted entity its own entry.
- Classify each as "high" priority if the group is described as holding a significant or collective stake.

This rule exists to ensure that major entities embedded inside acquisition language
(e.g., Warner Bros. Discovery) are not lost.

LOW PRIORITY
Mark as "low" priority only if:
- Listed under “additional”, “other”, or similar catch-all sections
- Described as early, minor, angel, or historical without importance signals
- Appears only in long enumerations without emphasis

INCLUSION LIMITS
- Always include ALL high-priority investors that meet the rules.
- Include low-priority investors only if clearly identified and cited.
- Maximum: ~10 total investors (prefer fewer, clearer entries).

SOURCE RULES
- Each investor MUST have a URL citation from the response.
- If multiple URLs are cited, choose the most authoritative:
  official announcement > regulator filing > Wikipedia/reputable reference >
  known data provider > blog.
- If no citation exists for a given investor entity, OMIT it.

NOTES RULES
- 1-2 sentences, concise.
- Must directly reflect the language or claims in the response.
- Do NOT add or infer new facts.

DEDUPLICATION
- Do not duplicate the same investor under multiple names.
- Prefer the most specific and recognizable entity name.

SORTING
- Output all "high" priority investors first.
- Within the same priority, sort by:
  ownership stake > strategic role > funding size > prominence.
- "low" priority investors come last.

EMPTY CASE
If no investors with citations are found, output:
{{ "investors": [] }}

Return ONLY the JSON object.
        """
                
        self._user_message = f"""
            Convert the following response into the required JSON format.

IMPORTANT

Extract investors with cited URLs only.
Assign priority ("high" or "low") based on the response wording.
Sort: high priority first, then low.

RESPONSE TO PARSE:
{investors_response}
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

        result_obj = {
            "result": result
        }

        self._set_output(result_obj)
        self.complete(result_obj)
