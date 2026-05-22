import json
from datetime import datetime
from typing import Any, Dict
from app.core.jobs.job import Job
from app.core.jobs.jobs.llm_callback_job import LlmCallbackJob
from app.core.jobs.job_status import JobStatus
from fast_json_repair import loads
from app.util.clean_json_response import custom_repair_json


@Job.register(name="select_primary_company")
class SelectPrimaryCompany(LlmCallbackJob):
    requirements: Dict[str, Any] = {
        "cpu": 1,
        "gpu": 1,
    }

    label: str = "Select Primary Company"
    description: str = "Selects the most prominent company from a list of candidates."

    async def run(self, platform: str):
        self._platform = platform
        self._model = "x-ai/grok-4.3"

        await super().run(platform)

        article_title = self.input.get("article_title", "No title provided")
        companies = self.input.get("companies", [])
        companies_json = json.dumps(companies, ensure_ascii=False, indent=2)

        self._system_message = """You are a DETERMINISTIC COMPANY SELECTOR.

YOUR ONLY JOB: Given a list of companies extracted from a news article, select the ONE company that is most central to the article's narrative. You are NOT judging whether the article is "about" a company — it is. You are choosing which one.

Return ONLY valid JSON. No markdown, no commentary.

SELECTION RULES (Apply in order):
1. HEADLINE RULE: If exactly one company appears in the article title, select it.
2. NARRATIVE CENTRALITY RULE: Select the company whose actions, decisions, or outcomes are the article's primary subject matter.
3. SPECIFICITY RULE: Prefer a subsidiary over its parent if the article is specifically about the subsidiary's actions.
4. TIE-BREAKER: If two companies are equally central, prefer the one listed with "primary" prominence. If still tied, prefer the one that appears first in the list.

FORCED SELECTION:
- You MUST select exactly one company. There is no "none" option.
- Even if the article covers multiple companies equally, pick one.
- Even if the article is about a deal between two companies, pick the one whose actions drive the story.

OUTPUT JSON schema (STRICT):
{
  "selected_company": "Company Name exactly as it appears in the input list",
  "reason": "Brief explanation referencing which selection rule applied"
}

RULES:
- The selected_company value MUST exactly match one of the "name" values from the input companies list.
- Do NOT invent a company name not in the input.
- Keep the reason under 50 words.
"""

        self._user_message = f"""Select the primary company from this article.

Respond ONLY with JSON in the exact format specified in the system message.

Article Title:
{article_title}

Companies extracted from article:
{companies_json}
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

        try:
            cleaned_result = custom_repair_json(result)
            results_obj = loads(cleaned_result)
        except Exception as e:
            # Fallback: pick first company from input if parse fails
            companies = self.input.get("companies", [])
            if companies:
                results_obj = {
                    "selected_company": companies[0]["name"],
                    "reason": "Fallback: LLM response could not be parsed, selected first primary company",
                }
            else:
                results_obj = {
                    "selected_company": None,
                    "reason": "Failed to parse LLM response and no companies available",
                }

        if "selected_company" not in results_obj:
            companies = self.input.get("companies", [])
            if companies:
                results_obj["selected_company"] = companies[0]["name"]
                results_obj["reason"] = results_obj.get("reason", "Fallback: missing selected_company, used first candidate")

        if "reason" not in results_obj:
            results_obj["reason"] = "No reason provided"

        self._set_output(results_obj)
        self.complete()

    def is_valid_result(self, result):
        if super().is_valid_result(result) == False:
            return False

        try:
            cleaned_result = custom_repair_json(result)
            results_obj = loads(cleaned_result)
        except Exception as e:
            return False

        if "selected_company" not in results_obj:
            return False

        if not results_obj["selected_company"]:
            return False

        return True
