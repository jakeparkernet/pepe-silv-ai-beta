import * as THREE from "three";
import { NodeView } from "./NodeView.js";
import { ViewPool } from "../utils/ViewPool.js";

class OwnersGroupView extends NodeView {

    constructor() {
        super();

        this.ownersViews = new Map();

        this.childRoot = new THREE.Group();
        this.addToRoot(this.childRoot);

        this.height = 0;
    }

    update () {
        super.update();
        this.ownersViews.forEach((view) => {
            view.update();
        });
    }

    updateFindOwnersFromPageDataView(model, scrapeView) {
        let ownersView = this.ownersViews.get(model);

        if (ownersView == null) {
            let i = this.ownersViews.size;

            ownersView = ViewPool.getView("find_owners_page_data");

            let scrapeViewWorld = scrapeView.getRootGroup().localToWorld(new THREE.Vector3());
            let scrapeViewLocal = ownersView.getRootGroup().worldToLocal(scrapeViewWorld);

            this.childRoot.add(ownersView.getRootGroup());
            ownersView.getRootGroup().position.set(
                0,
                scrapeViewLocal.y,
                0
            );
            ownersView.setModel(model);

            this.ownersViews.set(model, ownersView);
            
            this.height += ownersView.getSize().y;
        }

        ownersView.update();
    }

    getSize() {
        return new THREE.Vector3(8, this.height, 0);
    }

    getAttachPoint(direction = "input", travelDirection = "auto") {
        const size = this.getSize().clone();
        const attachPoint = new THREE.Vector3();

        if (direction != "input") {
            if (travelDirection == "auto") {
                travelDirection = this.travelDirection;
            }

            switch (travelDirection) {
                case "left":
                    attachPoint.set(-size.x, 0, 0);
                    break;
                case "right":
                    attachPoint.set(size.x, 0, 0);
                    break;
                default:
                    attachPoint.set(0, 0, 0);
                    break;
            }
        }

        return this.getRootGroup().localToWorld(attachPoint);
    }
}

export { OwnersGroupView };