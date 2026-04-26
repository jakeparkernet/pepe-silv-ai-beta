import asyncio
import logging
import threading

from app.core.jobs.job import Job
from app.core.jobs.job_status import JobStatus
from app.core.runtime.job_router import JobRouter
from app.core.jobs.db.job_database_factory import get_job_database
from app.core.events.static_events_factory import StaticEventsFactory


class JobRunner:
    _instance = None

    def __init__(self):
        self.job_router = JobRouter()
        self.logger = logging.getLogger(__name__)
        self.FPS = 1000
        self.frameTime = 1.0 / self.FPS

        self.max_concurrency = 50
        self._sem = None

        self._tasks = set()
        self._tasks_lock = asyncio.Lock()
        self._claimed_job_ids = set()
        self._claimed_job_ids_lock = threading.Lock()
        self._main_task = None
        self._closing = False

        self._loop = None
        self._bg_thread = None

        StaticEventsFactory.get_events("job")

    @classmethod
    def get_instance(cls):
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    def queue_job(self, job_id: str, platform: str):
        pass

    def start(self):
        import os
        if self._closing:
            raise RuntimeError("JobRunner was closed; cannot start again.")
        if (self._main_task and not self._main_task.done()) or (self._bg_thread and self._bg_thread.is_alive()):
            return self._main_task

        force_inline = os.getenv("JOBRUNNER_DEBUG_INLINE", "") == "1"

        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            loop = None

        if loop is not None and not force_inline:
            self._loop = loop
            if self._sem is None:
                self._sem = asyncio.Semaphore(self.max_concurrency)
            self._main_task = loop.create_task(self.job_processor_loop(), name="job_processor_loop")
            self.logger.info("JobRunner started on existing event loop")
            return self._main_task

        def _runner():
            try:
                self._loop = asyncio.new_event_loop()
                asyncio.set_event_loop(self._loop)
                self._sem = asyncio.Semaphore(self.max_concurrency)
                self._loop.run_until_complete(self.job_processor_loop())
            except Exception:
                self.logger.error("JobRunner background loop crashed", exc_info=True)
            finally:
                try:
                    self._loop.close()
                except Exception:
                    pass
        self._bg_thread = threading.Thread(target=_runner, name="JobRunnerLoop", daemon=True)
        self._bg_thread.start()
        self.logger.info("JobRunner started in background thread")

    async def shutdown(self, *, cancel_running: bool = False, wait_timeout: float = 15.0):
        self._closing = True

        if cancel_running:
            async with self._tasks_lock:
                for t in list(self._tasks):
                    t.cancel()

        async with self._tasks_lock:
            tasks = list(self._tasks)
        if tasks:
            try:
                await asyncio.wait_for(
                    asyncio.gather(*tasks, return_exceptions=True),
                    timeout=wait_timeout,
                )
            except asyncio.TimeoutError:
                self.logger.warning("Timed out waiting for running jobs to finish during shutdown")

        self.logger.info("JobRunner shutdown complete")

    async def job_processor_loop(self):
        self.logger.info("JobRunner loop is running")

        while not self._closing:
            for job in get_job_database().get_jobs_by_status(JobStatus.QUEUED):
                with self._claimed_job_ids_lock:
                    if job.id in self._claimed_job_ids:
                        continue
                    self._claimed_job_ids.add(job.id)
                try:
                    platform = self.job_router.can_run(job)
                    if platform == "unavailable":
                        with self._claimed_job_ids_lock:
                            self._claimed_job_ids.discard(job.id)
                        continue

                    t = asyncio.create_task(self.run_job(job, platform))
                    t.add_done_callback(lambda _: self._tasks.discard(t))
                    async with self._tasks_lock:
                        self._tasks.add(t)

                except Exception:
                    with self._claimed_job_ids_lock:
                        self._claimed_job_ids.discard(job.id)
                    self.logger.error(
                        "Exception while trying to run job through job queue",
                        exc_info=True,
                    )

            await asyncio.sleep(self.frameTime)

        self.logger.info("JobRunner loop is exiting")

    async def run_job(self, job, platform):
        if self._sem is None:
            raise RuntimeError("JobRunner not started")
        async with self._sem:
            try:
                return await job.run(platform)
            except Exception:
                try:
                    get_job_database().update_job_status(job.id, JobStatus.FAILED)
                except Exception:
                    self.logger.error("Failed to update job status to FAILED", exc_info=True)
                self.logger.error("Job execution failed", exc_info=True)
                raise


def get_job_runner():
    return JobRunner.get_instance()