from typing import Any, Dict, List, Optional
from pydantic import PrivateAttr
import re
from datetime import datetime

from app.core.jobs.job import Job
from app.core.jobs.jobs.llm_callback_job import LlmCallbackJob

from fast_json_repair import loads
from app.util.clean_json_response import custom_repair_json

@Job.register(name="categorize_company")
class CategorizeCompany(LlmCallbackJob):
    label: str = "Identify Company - Categorize"
    description: str = "Determines if this company is an asset manager or not."

    _max_retries = 1

    async def run(self, platform: str):
        await super().run(platform)

        self._model = "x-ai/grok-4.1-fast"
        
        self._system_message = f"""
        You are a decision-support classifier whose output will be used to determine whether additional investigative resources should be spent.

Your task is to classify one company into exactly one of two categories, using only the information explicitly provided in the input.

Hard constraints:

You MUST NOT use outside knowledge, training data, or prior familiarity with the company.

You MUST base your decision strictly on the provided description, metadata, tags, notes, and evidence excerpts.

You MUST return one of the two categories, even if the information is incomplete.

When evidence is weak or ambiguous, you MUST still choose a category but explicitly flag uncertainty and missing signals.

This task prioritizes safe over-inclusion for investigative follow-up.

Categories (Operational Definitions)

Category A — Capital / Financial Infrastructure

Assign this category if the company appears likely (based on provided text) to:

Manage, allocate, or invest capital on behalf of others

Operate investment vehicles (funds, ETFs, asset management products)

Provide financial-market infrastructure (custody, clearing, settlement, risk/portfolio systems)

Generate revenue primarily from fees tied to capital, assets, or financial transactions

If there is credible textual indication of these activities — even if incomplete — classify as Category A.

Category B — Real-Economy Producer

Assign this category if the company appears primarily to:

Produce or manufacture physical goods

Create content, media, or intellectual property for consumption

Provide non-financial services directly to consumers or businesses

Generate revenue primarily from sales, subscriptions, licensing, or usage of goods/services

The existence of financing arms, treasury functions, or passive investments does NOT override this classification unless emphasized as core.

Mandatory Decision Rules (Strict Order)

Text-Bounded Rule
Use ONLY the provided input.
Do NOT rely on name recognition or assumed industry norms.

Investigative Bias Rule
If the evidence is ambiguous between A and B, choose Category A.
(Rationale: false positives are cheaper than false negatives for ownership tracing.)

Primary Signal Rule
Prefer explicit verbs and nouns (e.g., “manages assets,” “manufactures vehicles,” “produces content”) over marketing language.

Revenue Mechanism Rule
When available, treat fee-for-capital signals as stronger than sales-for-goods signals.

Uncertainty Declaration Rule
When classification confidence is low:

Still return a category

Explicitly enumerate missing or weak signals

Do NOT hedge the category label itself
        """

        synth_data = self.input["synth"]

        self._user_message = f"""
        {{
            "task": "classify_company_economic_role",
            "instructions": "Classify the company into exactly one of the allowed categories using only the provided data. Follow system rules strictly.",
            "company": {{
                "name": "{synth_data["name"]}",
                "tags": {synth_data["tags"]},
                "notes": "{synth_data["notes"]}",
                "evidence": {synth_data["evidence"]}
            }},
            "required_output_schema": {{
                "category": "Capital / Financial Infrastructure | Real-Economy Producer",
                "confidence": "number between 0 and 1",
                "decision_rationale": [
                "string"
                ],
                "uncertainty_flags": [
                "string"
                ],
                "investigation_recommendation": {{
                    "trace_ownership": "boolean" - true if this is a Real-Economy Producer,
                    "reason": "string"
                }}
            }}
        }}

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

        print("categorize:")
        print(result)

        cleaned_result = custom_repair_json(result)
        result_obj = loads(cleaned_result)
        
        self._set_output(result_obj)
        self.complete(result_obj)
