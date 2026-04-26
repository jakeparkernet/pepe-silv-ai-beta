import { JobModel } from "./JobModel.js";
import { EntityModel } from "./EntityModel.js";

class IdentifyNewsSiteModel extends JobModel {

    onJobComplete () {
        super.onJobComplete();

        this.entityModel = new EntityModel(
            this.job.output.entity
        )
    }
}

export { IdentifyNewsSiteModel };