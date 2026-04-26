import * as THREE from "three";
import { NodeView } from "./NodeView.js";
import { ViewPool } from "../utils/ViewPool.js";

class FindOwnersFromPageDataView extends NodeView {

    constructor() {
        super();

        this.entityViews = new Map();

        this.childRoot = new THREE.Group();
        this.addToRoot(this.childRoot);

        this.viewPadding = 0.5;
        this.cursorY = 0;
    }

    update() {
        super.update();

        if (this.model.entities == null) {
            return;
        }

        if (this.model.error &&
            this.hasLogged == false) {
            console.log("error detected:");
            console.log(this.model.job);

            this.hasLogged = true;
            return;
        }

        if (this.entityViews.size == 0) {

            for (let i = 0; i < this.model.entities.length; i++) {
                let entityView = this.entityViews.get(this.model.entities[i]);
                if (entityView == null) {
                    entityView = ViewPool.getView("entity");
                    entityView.setModel(this.model.entities[i]);

                    this.childRoot.add(entityView.getRootGroup());
                    entityView.getRootGroup().position.set(
                        0,
                        this.cursorY,
                        0
                    );

                    this.cursorY += entityView.getSize().y + this.viewPadding;

                    this.entityViews.set(this.model.entities[i], entityView);
                }
            }
        }
        else {
            this.entityViews.forEach((view) => {
                view.update();
            });
        }
    }

    getSize() {
        return new THREE.Vector3(8, this.cursorY, 0);
    }
}

export { FindOwnersFromPageDataView };