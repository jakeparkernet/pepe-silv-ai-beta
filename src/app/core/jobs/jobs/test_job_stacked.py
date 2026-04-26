from datetime import datetime
import asyncio
from typing import Any, Dict, List, Optional
import random
from uuid import uuid4
import itertools

from app.core.jobs.job import Job
from app.core.jobs.job_status import JobStatus
from app.core.jobs.tracking.step import Step
from app.core.jobs.tracking.cursor import Cursor
from app.core.jobs.tracking.child_runner import ChildRunner
from app.edge.edge_runner_factory import get_edge_runner
from pydantic import Field, PrivateAttr
from app.core.runtime.job_batcher import get_batcher
from app.util.set_timeout import set_timeout
from app.core.jobs.db.job_database_factory import get_job_database
from app.util.generate_dedupe_key import generate_dedupe_key
from app.core.jobs.persistence.edges import get_edge_by_label

@Job.register(name="test_job_stacked")
class TestJobStacked(Job):

    requirements: Dict[str, Any] = {"cpu": 1}
    label: str = "Test"
    description: str = "Echo with a delay"

    delay_min: float = 2.0
    delay_max: float = 5.0
    levels_min: int = 2
    levels_max: int = 2
    max_depth: int = 3
    cur_depth: int = 0
    level_specs: Dict[str, Any] = Field(default_factory=dict)

    delay: float = 0
    message: str = ""

    _child_runner: ChildRunner = PrivateAttr(default=None)
    _completed_levels: set = PrivateAttr(default_factory=set)

    @property
    def children(self) -> Dict[str, str]:
        """Computed property: Load child jobs from edges (label -> id)."""
        db = get_job_database()
        edges = db.load_edges(self.session_id)  # Assuming load_edges is exposed; adjust if needed
        return {
            e["child_label"]: e["child_job_id"]
            for e in edges
            if e.get("parent_id") == self.id
        }

    async def run(self, platform: str):
        await super().run(platform)

        self.delay = random.uniform(self.delay_min, self.delay_max)
        self.message = self.input.get("message", "test")
        self.description = f"Echoes '{self.message}' after {self.delay}s and after child jobs complete."

        # Always generate steps (fresh or resume)
        if not self.was_loaded or not self.checkpoint:
            self.generate_steps()
        else:
            self.load_checkpoint(self.checkpoint, registry=None)
        self._trigger_checkpoint()

        # Setup children via runner (unified for fresh and resume)
        labels_to_wait = set(self.level_specs.keys()) - self._completed_levels
        if not labels_to_wait:
            self.on_children_completed()
            return

        self._child_runner = ChildRunner(parent=self)
        on_completes = {label: self.on_child_completed for label in labels_to_wait}
        on_updates = {label: self.on_child_updated for label in labels_to_wait}
        runner_checkpoint = self.checkpoint.get("runner", {}) if self.was_loaded else None
        self._child_runner.bind(
            labels_to_wait_for=labels_to_wait,
            specs={label: self.level_specs[label] for label in labels_to_wait},
            on_completes=on_completes,
            on_updates=on_updates,
            mode="parallel",
            on_all_done=self.on_children_completed
        )
        self._child_runner.start(checkpoint=runner_checkpoint)

        self._trigger_checkpoint()  # After setup

    def load_checkpoint(self, checkpoint: dict, registry=None) -> None:
        if checkpoint.get("version") == 1:
            self._completed_levels = set(checkpoint.get("completed_levels", []))
            self.level_specs.update(checkpoint.get("level_specs", {}))
            self.delay = checkpoint.get("delay", self.delay)
            self.message = checkpoint.get("message", self.message)

    def on_children_completed(self, summary: Dict[str, Any] | None = None):

        self._append_history({
            "timestamp": datetime.now().isoformat(),
            "event": "CHILD_JOBS_COMPLETE",
            "details": {"summary": f"{summary}"},
        })

        self._append_history({
            "timestamp": datetime.now().isoformat(),
            "event": "STARTING_ECHO_TEST",
            "details": {"delay_seconds": self.delay, "message": self.message},
        })

        set_timeout(self.run_echo, self.delay)

    def run_echo (self):
        try:
            if self.input.get("crash"):
                raise ValueError(f"Simulated crash at depth {self.cur_depth}")

            if self.platform == "edge":
                get_edge_runner().echo_callback(self.id, self.message)
            elif self.platform != "local":
                raise ValueError(f"Unknown platform: {self.platform}")

        except Exception as e:
            self.fail(e)
            raise

    def generate_steps(self):
        if self.cur_depth >= self.max_depth:
            return

        level_breadth = random.randint(self.levels_min, self.levels_max)
        next_depth = self.cur_depth + 1

        for i in range(level_breadth):
            child_label = f"{next_depth},{i}"
            step = Step(label=child_label, phases=["init", "queued", "waiting", "complete"])
            self.steps[child_label] = step

            spec = self.create_level_spec(child_label, next_depth, i)
            self.level_specs[child_label] = spec

        self._trigger_checkpoint()

    def create_level_spec (self, child_label, depth, breadth):

        if child_label in self.level_specs.keys():
            return self.level_specs[child_label]

        job_id = str(uuid4())

        job_type = "test_job_stacked"
        input = {
            "message": f"position: {depth}, {breadth}"
        }

        dedupe_key = generate_dedupe_key({
            "job_type": job_type,
            "input": input
        })

        return {
            "type": job_type,
            "child_label": child_label,
            "spec_min": {},
            "dedupe_key": dedupe_key,
            "params": {
                "id": job_id,
                "parent_id": self.id,
                "session_id": self.session_id,
                "input": input,
                "dedupe_key": dedupe_key,
                "max_depth": self.max_depth,
                "cur_depth": depth,
                "levels_min": self.levels_min,
                "levels_max": self.levels_max,
                "delay_min": self.delay_min,
                "delay_max": self.delay_max
            }
        }

    def apply_result(self, result: Dict[str, Any]):
        super().apply_result(result)
        
        """Called by echo_callback to finalize."""
        self._append_history({
            "timestamp": datetime.now().isoformat(),
            "event": "RESULT_APPLIED",
            "details": {"message": result.get("message")},
        })

        self._append_history({
            "timestamp": datetime.now().isoformat(),
            "event": "RUN_END",
            "details": {"result": result},
        })

        self._set_output(result)
        self.complete()
    
    def on_child_updated (self, child_label, result=None):
        #print(f"child job updated: {child_label} - {result}")
        pass

    def on_child_completed(self, child_label, result):
        self._completed_levels.add(child_label)
        self.steps[child_label].cur_phase = "complete"
        self._trigger_checkpoint()

    def save_checkpoint(self) -> dict:
        return {
            "version": 1,
            "completed_levels": list(self._completed_levels),
            "level_specs": self.level_specs,  # Includes expected child_labels as keys
            "delay": self.delay,
            "message": self.message,
            "runner": self._child_runner.save_checkpoint() if self._child_runner else {},
        }