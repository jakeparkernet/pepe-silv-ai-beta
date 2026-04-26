import { JobModel } from "./JobModel.js";
import { SearchModel } from "./SearchModel.js";
import { RefineModel } from "./RefineModel.js";
import { ScrapeModel } from "./ScrapeModel.js";
import { FindOwnersFromDataModel } from "./FindOwnersFromDataModel.js";

class FindOwnersModel extends JobModel {
    constructor(job) {
        super(job);

        this.getModelFromJob = this.getModelFromJob.bind(this);
    }

    updateChildJob(job) {
        if (job.parent_id == this.job.id) {
            let jobModel = this.childJobModels.get(job.id);

            if (jobModel == null) {
                jobModel = this.getModelFromJob(job);
                if (jobModel) {
                    this.addChildJobModel(jobModel);
                }
            }
            else {
                jobModel.applyJob(job);
            }
        }
    }

    getModelFromJob(job) {
        switch (job.metadata.view_data.note) {
            case "find owners search":
                return new SearchModel(job);
            case "find relevant owner links":
                return new RefineModel(job);
            case "find owners scrape":
                return new ScrapeModel(job);
            case "find owners page data":
                return new FindOwnersFromDataModel(job);
        }

        return null;
    }
}

export { FindOwnersModel };