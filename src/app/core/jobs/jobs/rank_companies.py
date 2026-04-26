from typing import Any, Dict, List, Optional
from pydantic import PrivateAttr
import re
import logging
from datetime import datetime

from app.core.jobs.job import Job
from app.core.jobs.jobs.llm_callback_job import LlmCallbackJob

from fast_json_repair import loads
from app.util.clean_json_response import custom_repair_json

logger = logging.getLogger(__name__)

@Job.register(name="rank_companies")
class RankCompanies(LlmCallbackJob):
    label: str = "Rank Companies"
    description: str = "Determines the order in which to find owners of companies."

    _max_retries = 3

    async def run(self, platform: str):
        await super().run(platform)

        self._model = "x-ai/grok-4.1-fast"
        self._parameters["extra_headers"] = {
            "X-Reasoning-Enabled": "true",
            "X-Reasoning-Effort": "high"
        }
        self._parameters["plugins"] = [{"id": "web"}]
        
        self._system_message = f"""
       You are a comparative ranking engine used to prioritize investigative resource allocation.

Your task is to evaluate multiple companies together and rank them by likelihood of large-scale capital influence, using:

Provided metadata and descriptions

Web search results

Hard constraints:

You MAY use web search to gather high-level, reputable information.

You MUST NOT attempt precise financial valuation.

You MUST prioritize relative ordering, not exact figures.

You MUST output a strict total order (no ties).

You MUST explain why each company ranks above the next.

This output will be used to decide which companies receive deeper ownership / investor tracing.

What You Are Ranking (Operational Goal)

You are ranking companies by expected leverage over capital flows, inferred from signals such as:

Assets under management (AUM) or custodial scale

Market or infrastructure centrality

Institutional reach

Global vs regional footprint

Descriptions indicating systemic importance

This is not about:

Brand popularity

Revenue from consumer sales

Moral judgment

Ranking Rules (Apply in Order)

Capital Centrality Rule
Companies that manage, allocate, custody, or route capital for others rank higher than those that merely earn revenue.

Scale Rule
Prefer signals indicating:

Global operations

Large institutional clients

“Largest,” “one of the largest,” “trillions,” “systemically important”

Infrastructure Rule
Capital plumbing outranks capital participants.

Comparative Rule
Rankings MUST be justified relative to other companies in the list, not in isolation.

Forced Ordering Rule
You MUST produce a strict ranking, even if confidence is uneven.

When uncertain between two companies, rank the one with broader inferred reach higher and flag uncertainty.
        """

        entities = self.input["entities"]

        self._user_message = f"""
        {{
            "task": "rank_companies_by_capital_influence",
            "instructions": "Evaluate all companies together and produce a strict ranking for investigative resource allocation. Use web search and provided metadata. Follow system rules exactly.",
            "companies": {entities},
            "ranking_goal": {{
                "objective": "Identify which companies are most likely to exert large-scale influence over capital flows",
                "selection_target": "top 3 to 5 companies" - if there are only 2 companies just rank the list of 2,
                "output_requirement": "Produce a strict total order with no ties",
                "prefer_false_positives": true,
                "break_ties_by": "infrastructure > scale > reach"
            }},
            "required_output_schema": {{
                "ranking": [
                {{
                    "rank": "integer starting at 1",
                    "company_id": "string",
                    "company_name": "string",
                    "capital_influence_level": "Very High | High | Medium",
                    "justification": "string",
                    "key_signals": ["string"],
                    "confidence": "number between 0 and 1"
                }}
                ],
                "recommended_focus_set": {{
                    "top_n": "integer",
                    "company_ids": ["string"],
                    "reasoning": "string"
                }},
                "global_uncertainty_notes": ["string"]
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

        cleaned_result = custom_repair_json(result)
        result_obj = loads(cleaned_result)
        
        entities = self.input["entities"]
        entity_dict = {}
        
        for entity in entities:
            entity_dict[entity["id"]] = entity

        ranking = result_obj.get("ranking", [])
        valid_ranking = []
        for rank_entry in ranking:
            company_id = rank_entry.get("company_id")
            if not company_id:
                alt_company = rank_entry.get("company")
                if alt_company:
                    company_id = alt_company.get("id")
                if not company_id:
                    logger.warning(f"Skipping invalid rank entry, missing company_id: {rank_entry}")
                    continue
            
            if company_id not in entity_dict:
                company_name = rank_entry.get("company_name", "").lower()
                matched_id = None
                for eid, entity in entity_dict.items():
                    if entity.get("name", "").lower() == company_name:
                        matched_id = eid
                        break
                if matched_id:
                    rank_entry["company_id"] = matched_id
                    company_id = matched_id
                else:
                    logger.warning(f"Skipping rank entry with unknown company_id: {company_id}")
                    continue
            valid_ranking.append(rank_entry)
        
        if not valid_ranking:
            raise ValueError(f"No valid ranking entries found. Original ranking: {ranking}")
        
        result_obj["ranking"] = valid_ranking
        result_obj["entities"] = entity_dict
        self._set_output(result_obj)
        self.complete(result_obj)
