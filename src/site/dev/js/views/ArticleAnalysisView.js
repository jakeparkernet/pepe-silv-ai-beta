import * as THREE from "three";
import { TapeLabel } from "../components/TapeLabel.js";
import { Paper } from "../components/Paper.js";
import { getTiltQuaternion } from "../utils/getTiltQuaternion.js";
import { JobView } from "./JobView.js";

class ArticleAnalysisView extends JobView {
    constructor() {
        super();
        
        this.paper = new Paper();
        this.addToRoot(this.paper.getRootGroup());

        let indexCardOffset = +this.paper.getSize().y * 0.5;
        indexCardOffset -= this.indexCard.getSize().y / 2;

        this.indexCard.getRootGroup().position.set(0, indexCardOffset, 0);

        this.paper.getRootGroup().position.set(0, 0, -0.01);
        this.paper.getRootGroup().quaternion.copy(getTiltQuaternion());

        this.indexCard.getRootGroup().quaternion.copy(getTiltQuaternion());

        this.tapeLabel = new TapeLabel({tiltOptions: {
            tiltRangeMin: 20,
            tiltRangeMax: 39
        }});

        this.tapeLabel.setText({
            text: "What's in this article??",
            fontSize: 0.5
        });

        this.addToRoot(this.tapeLabel.getRootGroup());
        this.tapeLabel.getRootGroup().position.set(
            -this.tapeLabel.getSize().x * 0.5,
            this.getSize().y * 0.5 + 0.35,
            0);
        this.tapeLabel.markDirty?.();
    }

    show() {
        super.show();
        this.paper?.show?.();
        this.tapeLabel?.show?.();
    }

    hide() {
        this.paper?.hide?.();
        this.tapeLabel?.hide?.();
        super.hide();
    }

    refreshSize() {
        if (this.size == null) {
            this.size = this.getDefaultSize();
            return true;
        }

        return false;
    }

    getDefaultSize () {
        return new THREE.Vector3(8.5, 11, 1);
    }
}

export { ArticleAnalysisView };
