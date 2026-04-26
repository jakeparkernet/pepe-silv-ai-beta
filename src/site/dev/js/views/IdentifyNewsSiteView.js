import { JobView } from "./JobView.js";
import { EntityView } from "./EntityView.js";
import { ViewPool } from "../utils/ViewPool.js";

class IdentifyNewsSiteView extends JobView {
    
    update () {
    super.update();

        if (this.model.job.output) {
            if (this.siteEntityView == null) {
                this.siteEntityView = new EntityView();
                this.siteEntityView.setModel(this.model.entityModel);

                this.addToRoot(this.siteEntityView.getRootGroup());
                this.siteEntityView.getRootGroup().position.set(
                    10,
                    0,
                    0
                );

                let edgeView = ViewPool.getView("thread");
                this.getRootGroup().add(edgeView.getRootGroup());
                
                edgeView.setEndpoints(
                    this.getAttachPoint("output", "right"),
                    this.siteEntityView.getAttachPoint("input", "right")
                );
            }
        }
    }
}

export { IdentifyNewsSiteView };