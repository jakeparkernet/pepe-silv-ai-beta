import * as THREE from "three";
import { Paper } from "../components/Paper.js";
import { JobView } from "./JobView.js";
import { getTiltQuaternion } from "../utils/getTiltQuaternion.js";

const placementRange = {
    x: 10,
    y: 2
}
class ScrapeView extends JobView {
    constructor({ node = null, options = {} }) {
        super({ node: node, options: options });

        this.paper = new Paper();
        this.addToRoot(this.paper.getRootGroup());

        let indexCardOffset = +this.paper.getSize().y * 0.5;
        indexCardOffset -= this.indexCard.getSize().y / 2;

        this.indexCard.getRootGroup().position.set(0, indexCardOffset, 0);

        this.paper.getRootGroup().position.set(0, 0, -0.01);
        this.paper.getRootGroup().quaternion.copy(getTiltQuaternion());

        this.indexCard.getRootGroup().quaternion.copy(getTiltQuaternion());

        let textContainer = new THREE.Group();
        this.addToRoot(textContainer);
    }

    show() {
        super.show();
        this.paper?.show?.();
    }

    hide() {
        this.paper?.hide?.();
        super.hide();
    }

    refreshSize() {
        if (this.size == null) {
            this.size = this.getDefaultSize();
            return true;
        }

        return false;
    }

    getDefaultSize() {
        return new THREE.Vector3(8.5, 11, 1);
    }

    getPlacementPosition(defaultPosition, index = 0, length = 1) {
        return new THREE.Vector3(
            THREE.MathUtils.randFloat(-placementRange.x, placementRange.x),
            THREE.MathUtils.randFloat(-placementRange.y, placementRange.y),
            0
        )
    }
}

export { ScrapeView };
