from typing import Dict, Any, TYPE_CHECKING

from ..config.loader import load_local_capabilities_config, load_edge_capabilities_config
from ..runtime.resource_managenent.resource_manager import ResourceManager

if TYPE_CHECKING:
    from ..jobs.job import Job

class JobRouter:

    def __init__ (self):
        local_capabilties = load_local_capabilities_config().capabilities
        edge_capabilties = load_edge_capabilities_config().capabilities

        self.resource_manager = ResourceManager(local_capabilties, edge_capabilties)

    def can_run (self, job: "Job"):
        return self.resource_manager.can_use(job.requirements)

    def run(self, job: "Job"):
        return self.resource_manager.checkout(job.id, job.requirements)

    def complete (self, id: int):
        return self.resource_manager.checkin(id)