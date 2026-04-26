import * as THREE from "three";
import { NodeView } from "./NodeView.js";
import { IndexCard } from "../components/IndexCard.js";
import { getTiltQuaternion } from "../utils/getTiltQuaternion.js";

class JobView extends NodeView {
    constructor() {
        super();
        this.indexCard = new IndexCard();
        this.addToRoot(this.indexCard.getRootGroup(), {
            resetScale: false,
            resetTransform: true
        });

        this.indexCard.meshInstance.setScale(5, 3, 1);

        this.getRootGroup().quaternion.copy(getTiltQuaternion());
    }

    show() {
        super.show();
        this.indexCard?.show?.();
    }

    hide() {
        this.indexCard?.hide?.();
        super.hide();
    }

    getDefaultSize () {
        return new THREE.Vector3(5, 3, 1);
    }

    refreshSize() {
        if (this.size == null) {
            this.size = this.indexCard.getSize();
            return true;
        }
        else if (this.indexCard.getSize().equals(this.size) === false) {

            this.size = this.indexCard.getSize();
            return true;
        }

        return false;
    }

    updateLabel(key, params) {
        this.indexCard.updateLine(key, params);
    }

    update () {
        super.update();
        this.applyJobData(this.model.job);
    }

    applyJobData(job) {
        if (job == null) {
            console.log(`Error: Got null job data! NodeView: ${this.id}`);
            return;
        }

        this.updateLabel("job_id", {
            text: job.id,
            position: [0, -1.4, 0],
            size: 0.1
        });

        this.updateLabel("label", {
            text: job.label,
            position: [0, 1.13, 0],
            size: 0.5
        });

        this.updateLabel("description", {
            text: job.description,
            position: [0, 0.5, 0],
            size: 0.2
        });

        if (job.status) {
            this.updateLabel("status", {
                text: job.status,
                position: [0, 0, 0],
                size: 0.1
            });
        }
    }


}

export { JobView };
