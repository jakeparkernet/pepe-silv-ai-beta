import logging
import os
import requests
from supabase import create_client

logger = logging.getLogger(__name__)


def _get_supabase_client():
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        return None
    return create_client(url, key)


class InvestigationFundingPaused(RuntimeError):
    pass


def _update_article_cost(article_url: str, cost: float):
    supabase = _get_supabase_client()
    if supabase is None:
        logger.warning("Supabase client not available for cost update")
        return
    try:
        logger.debug(f"Updating openrouter_cost for {article_url}: {cost}")
        supabase.table("article_queue").update({
            "openrouter_cost": cost
        }).eq("url", article_url).execute()
        logger.info(f"Updated openrouter_cost for {article_url}: {cost}")
    except Exception as e:
        logger.error(f"Failed to update openrouter_cost for {article_url}: {e}")


def _send_funding_notices():
    supabase_url = os.getenv("SUPABASE_URL", "").rstrip("/")
    internal_key = os.getenv("INTERNAL_EDGE_API_KEY", "")
    if not supabase_url or not internal_key:
        logger.warning("Cannot send funding notices without SUPABASE_URL and INTERNAL_EDGE_API_KEY")
        return

    try:
        response = requests.post(
            f"{supabase_url}/functions/v1/send-funding-notices",
            headers={
                "Content-Type": "application/json",
                "x-internal-key": internal_key,
            },
            json={},
            timeout=10,
        )
        if response.status_code >= 400:
            logger.warning("Funding notice sender failed: %s %s", response.status_code, response.text[:500])
    except Exception:
        logger.warning("Failed to call funding notice sender", exc_info=True)


def _apply_article_credit_usage(article_url: str):
    supabase = _get_supabase_client()
    if supabase is None:
        return

    try:
        queue_res = (
            supabase
            .table("article_queue")
            .select("id, funding_status")
            .eq("url", article_url)
            .limit(1)
            .execute()
        )
        queue_row = queue_res.data[0] if isinstance(queue_res.data, list) and queue_res.data else None
        queue_id = queue_row.get("id") if isinstance(queue_row, dict) else None
        if not queue_id:
            return

        usage_res = supabase.rpc("apply_article_credit_usage", {
            "p_queue_id": queue_id,
        }).execute()
        usage_rows = usage_res.data if isinstance(usage_res.data, list) else []
        usage_row = usage_rows[0] if usage_rows else usage_res.data
        if isinstance(usage_row, dict) and usage_row.get("paused") is True:
            _send_funding_notices()
            raise InvestigationFundingPaused("Investigation paused: more funding is required.")
    except InvestigationFundingPaused:
        raise
    except Exception as e:
        logger.warning(f"Failed to apply article credit usage for {article_url}: {e}")


class OpenrouterCost:
    _instance = None

    def __init__(self):
        self._total_cost = 0.0
        self._investigation_job = None

    @classmethod
    def get_instance(cls):
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    def add_cost(self, cost: float):
        self._total_cost += cost

        if self._investigation_job is None:
            from app.core.jobs.jobs.investigation_job import InvestigationJob
            from app.core.jobs.jobs.company_pair_investigation import CompanyPairInvestigation
            from app.core.jobs.job_status import JobStatus
            from app.core.jobs.db.job_database_factory import get_job_database

            for job in get_job_database().get_jobs_by_status(JobStatus.RUNNING):
                if isinstance(job, (InvestigationJob, CompanyPairInvestigation)):
                    self._investigation_job = job
                    logger.debug(f"Found investigation job: {self._investigation_job}")
                    break

        if self._investigation_job is not None:
            on_credit_cost_updated = getattr(self._investigation_job, "on_credit_cost_updated", None)
            if callable(on_credit_cost_updated):
                on_credit_cost_updated()
                return

            article_url = getattr(self._investigation_job, "_queue_url_key", None)
            logger.debug(f"article_url from investigation job: {article_url}")
            if article_url:
                _update_article_cost(article_url, self._total_cost)
                _apply_article_credit_usage(article_url)

    def get_cost(self) -> float:
        return self._total_cost

    def pause_current_investigation(self, reason: str):
        if self._investigation_job is None:
            return

        try:
            from app.core.jobs.job_status import JobStatus

            self._investigation_job.set_output({
                "status": "paused",
                "reason": reason,
            })
            self._investigation_job.set_status(JobStatus.PAUSED)
        except Exception:
            logger.warning("Failed to mark current investigation job paused", exc_info=True)

    def reset(self):
        self._total_cost = 0.0
        self._investigation_job = None
