import json
from datetime import datetime
from typing import Any, Dict
from app.core.jobs.job import Job
from app.core.jobs.jobs.llm_callback_job import LlmCallbackJob
from app.core.jobs.job_status import JobStatus
from fast_json_repair import loads
from app.util.clean_json_response import custom_repair_json


@Job.register(name="extract_article_companies")
class ExtractArticleCompanies(LlmCallbackJob):
    requirements: Dict[str, Any] = {
        "cpu": 1,
        "gpu": 1,
    }

    label: str = "Extract Article Companies"
    description: str = "Extracts all companies mentioned in an article."

    async def run(self, platform: str):
        self._platform = platform
        self._model = "x-ai/grok-4.3"

        await super().run(platform)

        article_text = self.input["article_text"]
        article_title = self.input.get("article_title", "")
        title_for_prompt = article_title if article_title else "No title provided"

        self._system_message = """You are a GROUNDED CORPORATE ENTITY EXTRACTOR.

YOUR ONLY JOB: Extract every company, corporation, or organization that is mentioned or clearly implicated in the article body. Do NOT assess relevance or applicability. Do NOT filter. Just extract.

Return ONLY valid JSON. No markdown, no commentary.

INPUT CONTEXT:
- The article text you receive is SCRAPED MARKDOWN from a web page.
- Scraped markdown often includes boilerplate such as:
  - navigation menus
  - header/footer links
  - newsletter prompts
  - related article links
  - commerce widgets
  - repeated site branding
- You MUST mentally separate probable article content from surrounding boilerplate before extracting.
- Do NOT extract company names that appear ONLY in navigation/boilerplate/footer.
- The article title is a strong signal for the article's actual content.

WHAT COUNTS AS A COMPANY:
- Publicly or privately traded corporations
- Subsidiaries named in the article
- Organizations with commercial operations
- Government agencies ONLY if they are the subject of a financial action (e.g. a contract, fine, or acquisition)

WHAT DOES NOT COUNT:
- Individuals (people are not companies)
- Generic industry references ("tech companies", "automakers")
- Companies mentioned ONLY in boilerplate/nav/footer
- Non-commercial organizations (charities, universities) UNLESS they are the article's primary subject

ERROR ASYMMETRY:
- False negatives are worse than false positives.
- If in doubt whether something is a company, INCLUDE it.
- The downstream system will resolve and disambiguate.

PROMINENCE DEFINITIONS:
- "primary": The article's headline or central narrative is about this company
- "secondary": Significant discussion (multiple paragraphs or a key role in the story)
- "mention": Named once or twice, peripheral to the main story

OUTPUT JSON schema (STRICT):
{
  "companies": [
    {
      "name": "Exact company name as it appears in the article",
      "prominence": "primary|secondary|mention",
      "context": "One sentence: what role does this company play in the article"
    }
  ]
}

RULES:
- Return ALL companies found in the article body, not just the primary one.
- If no companies are found, return {"companies": []}.
- Do NOT invent companies not present in the article.
- Use the exact name as it appears in the article text.
- Order companies by prominence: primary first, then secondary, then mention.
"""

        self._user_message = f"""Extract all companies mentioned in this article.

Respond ONLY with JSON in the exact format specified in the system message.

Article Title:
{title_for_prompt}

Article Text:
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

        try:
            cleaned_result = custom_repair_json(result)
            results_obj = loads(cleaned_result)
        except Exception as e:
            results_obj = {"companies": []}

        if "companies" not in results_obj:
            results_obj["companies"] = []

        # Ensure each company has required fields
        cleaned_companies = []
        for company in results_obj["companies"]:
            if isinstance(company, dict) and company.get("name"):
                cleaned_companies.append({
                    "name": company.get("name", ""),
                    "prominence": company.get("prominence", "mention"),
                    "context": company.get("context", ""),
                })
        results_obj["companies"] = cleaned_companies

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

        if "companies" not in results_obj:
            return False

        if not isinstance(results_obj["companies"], list):
            return False

        return True
