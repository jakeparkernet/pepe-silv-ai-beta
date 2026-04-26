import json
from datetime import datetime
from typing import Any, Dict
from app.core.jobs.job import Job
from app.core.jobs.job_status import JobStatus
from pydantic import PrivateAttr


@Job.register(name="check_article_applicability")
class CheckArticleApplicability(Job):
    requirements: Dict[str, Any] = {
        "cpu": 1,
        "gpu": 1,
    }

    label: str = "Check Article Applicability"
    description: str = "Checks if the article is about a specific product or company."

    _results: Dict[str, Any] = PrivateAttr(default_factory=dict)

    def update_handler(self, event):
        pass

    async def run(self, platform: str):
        await super().run(platform)

        extract_spec = {
            "type": "extract_article_companies",
            "params": {
                "parent_id": self.parent_id,
                "input": self.input,
            },
            "metadata": {
                "internal_job_key": "extract",
                "view_data": {
                    "note": "extract companies from article",
                },
            },
        }

        self.create_child_job(
            child_label="extract article companies",
            spec=extract_spec,
            on_update=self.update_handler,
            on_complete=self.on_internal_job_result,
        )

    def _build_not_applicable_output(self, reason):
        return {
            "is_applicable": False,
            "reason": reason,
            "identified_company": None,
            "identified_product": None,
        }

    def _build_applicable_output(self, company_name, reason):
        return {
            "is_applicable": True,
            "reason": reason,
            "identified_company": company_name,
            "identified_product": None,
        }

    def on_internal_job_result(self, job):
        key = job.metadata["internal_job_key"]
        self._results[key] = job.output

        if len(self._results.keys()) == 1:
            self._handle_extract_result()
        elif len(self._results.keys()) == 2:
            self._handle_select_result()

    def _handle_extract_result(self):
        extract_output = self._results["extract"]
        companies = extract_output.get("companies", [])

        if len(companies) == 0:
            output = self._build_not_applicable_output("No companies found in article")
            self._set_output(output)
            self.complete()
            return

        if len(companies) == 1:
            company = companies[0]
            output = self._build_applicable_output(
                company["name"],
                f"Single company identified: {company['context']}" if company.get("context") else "Single company identified in article",
            )
            self._set_output(output)
            self.complete()
            return

        # Multiple companies — need to select the primary one
        article_title = self.input.get("article_title", "")

        select_spec = {
            "type": "select_primary_company",
            "params": {
                "parent_id": self.parent_id,
                "input": {
                    "article_title": article_title,
                    "companies": companies,
                },
            },
            "metadata": {
                "internal_job_key": "select",
                "view_data": {
                    "note": "select primary company from candidates",
                },
            },
        }

        self.create_child_job(
            child_label="select primary company",
            spec=select_spec,
            on_update=self.update_handler,
            on_complete=self.on_internal_job_result,
        )

    def _handle_select_result(self):
        select_output = self._results["select"]
        selected_company = select_output.get("selected_company")

        if not selected_company:
            # Fallback: use first company from extraction
            extract_output = self._results["extract"]
            companies = extract_output.get("companies", [])
            if companies:
                selected_company = companies[0]["name"]
                reason = "Fallback: selection failed, used most prominent extracted company"
            else:
                output = self._build_not_applicable_output("Selection failed and no companies available")
                self._set_output(output)
                self.complete()
                return
        else:
            reason = select_output.get("reason", "Selected as primary company from multiple candidates")

        output = self._build_applicable_output(selected_company, reason)
        self._set_output(output)
        self.complete()
