from ..resource_managenent.local_manager import LocalManager
from ..resource_managenent.edge_manager import EdgeManager

class ResourceManager:

    def __init__ (self, local_capabilities, edge_capabilities):
        self.local_manager = LocalManager(local_capabilities)
        self.edge_manager = EdgeManager(edge_capabilities)

    def can_use (self, requirements):
        if self.can_use_local(requirements):
            return "local"

        if self.can_use_edge(requirements):
            return "edge"

        return "unavailble"

    def checkout (self, id, requirements):
        if self.can_use_local(requirements):
            if self.local_manager.checkout(id, requirements):
                return "local"
                
        if self.can_use_edge(requirements):
            if self.edge_manager.checkout(id, requirements):
                return "edge"
        
        return "unavailble"

    def checkin (self, id):
        if self.local_manager.is_using(id):
            return self.local_manager.checkin(id)

        if self.edge_manager.is_using(id):
            return self.edge_manager.checkin(id)

        return False

    def can_use_local (self, requirements):
        return self.local_manager.can_use(requirements)

    def can_use_edge (self, requirements):
        return self.edge_manager.can_use(requirements)