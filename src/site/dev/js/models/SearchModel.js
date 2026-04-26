import { JobModel } from "./JobModel.js";
import { SearchResultsModel } from "./SearchResultsModel.js";

class SearchModel extends JobModel {

    onJobComplete () {
        if (this.searchResultsModel == null) {
            this.searchResultsModel = new SearchResultsModel(this.job.output);
        }
    }
}

export { SearchModel };