import * as THREE from "three";
import { NineSlice } from "./NineSlice.js";

class StageBackground {
    constructor(scale = 0.1) {
        this.scale = scale;
        
        this.rootGroup = new THREE.Group();

        this.backgroundObj = new NineSlice();

        this.setSize(1.0 / this.scale, 1.0 / this.scale);

        this.getRootGroup().add(this.backgroundObj.getRootGroup());
    }

    setScale (scale) {
        this.scale = scale;
        this.backgroundObj.setScale(this.scale);
    }

    setSize (width, height) {
        this.backgroundObj.setWidth(width * (1.0 / this.scale));
        this.backgroundObj.setHeight(height * (1.0 / this.scale));
        this.backgroundObj.setScale(this.scale);
    }

    getNineSlice () {
        return this.backgroundObj;
    }

    getRootGroup() {
        return this.rootGroup;
    }
}

export { StageBackground };