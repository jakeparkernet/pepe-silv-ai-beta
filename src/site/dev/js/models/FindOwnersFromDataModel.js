import { JobModel } from "./JobModel.js";
import { EntityModel } from "./EntityModel.js";

class FindOwnersFromDataModel extends JobModel {

    onJobComplete () {
        this.entities = new Set();

        if (this.job.output.status == "error") {
            this.error = true;
            return;
        }

        for (let i = 0; i < this.job.output.owners.length; i++) {
            let entityModel = new EntityModel({
                name: this.job.output.owners[i].source_entity
            });
            
            this.entities.add(entityModel);
        }

        this.entities = Array.from(this.entities);
    }
}

export { FindOwnersFromDataModel };