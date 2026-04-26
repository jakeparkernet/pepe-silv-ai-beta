import logging
import os
from supabase import create_client
from app.util.fire_and_forget import fire_and_forget

logger = logging.getLogger(__name__)


def _get_supabase_client():
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        return None
    return create_client(url, key)


async def _update_article_cost(article_url: str, cost: float):
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
            from app.core.jobs.job_status import JobStatus
            from app.core.jobs.db.job_database_factory import get_job_database

            for job in get_job_database().get_jobs_by_status(JobStatus.RUNNING):
                if isinstance(job, InvestigationJob):
                    self._investigation_job = job
                    logger.debug(f"Found investigation job: {self._investigation_job}")
                    break

        if self._investigation_job is not None:
            article_url = getattr(self._investigation_job, "_queue_url_key", None)
            logger.debug(f"article_url from investigation job: {article_url}")
            if article_url:
                fire_and_forget(
                    _update_article_cost,
                    article_url,
                    self._total_cost,
                )

    def get_cost(self) -> float:
        return self._total_cost

    def reset(self):
        self._total_cost = 0.0
        self._investigation_job = None