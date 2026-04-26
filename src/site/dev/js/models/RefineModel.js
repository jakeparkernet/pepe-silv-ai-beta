import { JobModel } from "./JobModel.js";
import { RefinedResultsModel } from "./RefineResultsModel.js";

class RefineModel extends JobModel {

    onJobComplete () {
        if (this.searchResultsModel == null) {
            this.searchResultsModel = new RefinedResultsModel(this.job.output);
        }
    }
}

export { RefineModel };