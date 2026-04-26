import * as THREE from "three";
import { NodeView } from "./NodeView.js";
import { RaisedLabel } from "../components/RaisedLabel.js";

class EntityView extends NodeView {

    constructor() {
        super();
        this.raisedLabel = new RaisedLabel();

        this.addToRoot(this.raisedLabel.getRootGroup());
    }

    show() {
        super.show();
        this.raisedLabel?.show?.();
    }

    hide() {
        this.raisedLabel?.hide?.();
        super.hide();
    }

    update () {
        super.update();
        this.raisedLabel.setText(this.model.name);
    }

    refreshSize() {
        if (this.size == null) {
            this.size = this.raisedLabel.getSize();
            return true;
        }
        else if (this.raisedLabel.getSize().equals(this.size) === false) {

            this.size = this.raisedLabel.getSize();
            return true;
        }

        return false;
    }

    getDefaultSize () {
        return new THREE.Vector3(8, 1, 1);
    }
}

export { EntityView };
