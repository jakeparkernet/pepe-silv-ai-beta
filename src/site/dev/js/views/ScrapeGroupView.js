import * as THREE from "three";
import { NodeView } from "./NodeView.js";
import { ViewPool } from "../utils/ViewPool.js";

class ScrapeGroupView extends NodeView {

    constructor() {
        super();

        this.scrapeViews = new Map();

        this.childRoot = new THREE.Group();
        this.addToRoot(this.childRoot);

        this.viewPadding = 5;
    }

    getScrapeView (url) {
        let scrapeView = null;
        this.scrapeViews.forEach((view, model) => {
            if (scrapeView) return;

            if (model.job.input.url == url) {
                scrapeView = view;
            }
        });

        return scrapeView;
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

    updateScrapeView(model) {
        let scrapeView = this.scrapeViews.get(model);

        if (scrapeView == null) {
            let i = this.scrapeViews.size;

            scrapeView = ViewPool.getView("scrape");
            scrapeView.setModel(model);

            this.childRoot.add(scrapeView.getRootGroup());
            scrapeView.getRootGroup().position.set(
                0,
                i * scrapeView.getSize().y + this.viewPadding,
                0
            );

            this.scrapeViews.set(model, scrapeView);

            this.childRoot.position.set(
                0,
                -this.getSize().y * 0.5,
                0
            )
        }

        scrapeView.update();
    }

    getSize() {
        return new THREE.Vector3(8.5, (11 + this.viewPadding) * (1 + this.scrapeViews.size), 0);
    }
}

export { ScrapeGroupView };