class EdgeManager:

    def __init__ (self, available_resources):
        self.available_resources = available_resources
        self.checked_out_resources = {}

    def can_use (self, requirements):
        for key in requirements.keys():
            if key not in self.available_resources:
                return False

            if self.available_resources[key] < requirements[key]:
                return False

        return True

    def is_using (self, id):
        return id in self.checked_out_resources.keys()

    def checkout (self, id, requirements):
        if id in self.checked_out_resources.keys():
            return False

        for key in requirements.keys():
            self.available_resources[key] -= requirements[key]

        self.checked_out_resources[id] = requirements

        return True

    def checkin (self, id):
        if id not in self.checked_out_resources.keys():
            return False
        
        requirements = self.checked_out_resources[id]

        for key in requirements.keys():
            self.available_resources[key] += requirements[key]

        del self.checked_out_resources[id]

        return True