import importlib
import runpy
import json
from pathlib import Path
from typing import Any, Dict
from app.core.jobs.job import Job
from pydantic import ValidationError

class JobFactory:
    _instance = None

    def __init__(self):
        jobs_path = Path(__file__).parent / "jobs"
        for path in jobs_path.glob("*.py"):
            print(f"loading: {path}")
            self.load_job_module(str(path))

    def load_job_module(self, module_or_path: str):
        if module_or_path.endswith(".py") or Path(module_or_path).exists():
            runpy.run_path(module_or_path, run_name="__main__")
        else:
            importlib.import_module(module_or_path)

    def create_job(self, **kwargs):
        try:
            
            if "job_type" not in kwargs:
                raise ValueError("Missing job type!")

            job_type = kwargs["job_type"]

            if not isinstance(job_type, str) or not job_type:
                raise ValueError("Invalid job type")
            if job_type not in Job.registry:
                raise ValueError(f"Unknown job type: {job_type}")

            if "parent_id" not in kwargs:
                kwargs["parent_id"] = None

            job = Job.registry[job_type](**kwargs)
            return {"status": "success", "job": job}
        except ValidationError as exc:
            print(_debug_validation(exc))
            raise ValueError(_debug_validation(exc)) from exc
        except Exception as e:
            return {"status": "error", "message": str(e)}
            raise

    def create_job_from_spec(self, spec):
        try:
            if isinstance(spec, str):
                spec = json.loads(spec)
            if not isinstance(spec, dict):
                raise ValueError("Spec must be a dictionary")
            job_type = spec.get("type")
            if not isinstance(job_type, str) or not job_type:
                raise ValueError("Missing job type in spec")
            params = spec.get("params", {})

            if "session_id" not in params:
                params["session_id"] = spec["session_id"]
            if "dedupe_key" not in params:
                params["dedupe_key"] = spec["dedupe_key"]
            if "job_type" not in params:
                params["job_type"] = job_type
            if "metadata" not in params:
                if "metadata" in spec:
                    params["metadata"] = spec["metadata"]

            if not isinstance(params, dict):
                raise ValueError("Params must be a dictionary")
            return self.create_job(**params)
        except Exception as e:
            return {"status": "error", "message": str(e)}
            raise

def get_job_factory():
    if JobFactory._instance is None:
        JobFactory._instance = JobFactory()
    return JobFactory._instance

def _debug_validation(exc: ValidationError) -> str:
    """Pretty-print a ValidationError – copy-paste this wherever you need it."""
    lines = ["Validation failed!"]
    for err in exc.errors():
        loc = " -> ".join(str(p) for p in err["loc"])
        lines.append(f"  • {loc}: {err['msg']} (type={err['type']})")
        if "ctx" in err:
            lines.append(f"    ctx: {err['ctx']}")
    return "\n".join(lines)