import * as THREE from "three";
import { NodeView } from "./NodeView.js"
import { TreeView } from "./TreeView.js";
import { Node } from "../models/Node.js";
import { Tree } from "../models/Tree.js";
import { tryApplyDiff } from "../utils/objectUtils.js";
import { ViewPool } from "../utils/ViewPool.js";
import { FindOwnersFromDataModel } from "../models/FindOwnersFromDataModel.js";

class FindOwnersView extends NodeView {

    constructor() {
        super();
        this.viewPadding = 5;

        this.stubOwnersView = this.stubOwnersView.bind(this);
        this.onKeyDown = this.onKeyDown.bind(this);

        //requestAnimationFrame(this.stubOwnersView);
//
        //this.count = 0;
        //window.addEventListener("keydown", this.onKeyDown);
    }

    onKeyDown (event) {
        let keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9"]
        if (keys.includes(event.key)) {
            this.spawn = true;
            this.spawnCount = parseInt(event.key);
        }
    }

    stubOwnersView () {
        requestAnimationFrame(this.stubOwnersView);

        if (this.spawn) {
            let jobStub = {
                output: {
                    owners: []
                }
            }

            for (let i = 0; i < this.spawnCount; i++) {
                jobStub.output.owners.push(
                    {source_entity: "Test " + this.count + " : " + i}
                )
            }
            let stubModel = new FindOwnersFromDataModel(jobStub);
            stubModel.onJobComplete();
            this.updateFindOwnersFromPageDataView(stubModel);
            this.count++;
        }
        this.spawn = false;
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

    update() {
        this.model.childJobModels.forEach((jobModel, jobId) => {

            let job = jobModel.job;
            let viewData = job.metadata["view_data"];

            if (viewData) {
                switch (viewData.note) {
                    case "find owners search":
                        this.updateSearchView(jobModel);
                        break;
                    case "find relevant owner links":
                        this.updateRefineView(jobModel);
                        break;
                    case "find owners scrape":
                        this.updateScrapeView(jobModel);
                        break;
                    case "find owners page data":
                        this.updateFindOwnersFromPageDataView(jobModel);
                        break;
                }
            }
        });
    }

    updateSearchView(model) {
        if (this.searchView == null) {
            this.searchView = ViewPool.getView("job");
            this.searchView.setModel(model);

            this.searchView.setTravelDirection(this.travelDirection);

            this.addToRoot(this.searchView.getRootGroup());

            this.cursorX = this.searchView.getSize().x * 0.5 * this.getTravelAxis();

            this.searchView.getRootGroup().position.set(
                this.cursorX,
                0,
                0
            );
        }

        if (model.isDirty) {
            this.searchView.update();
            model.markClean();
        }

        if (model.job.status == "COMPLETE") {
            if (this.searchResultsView == null) {
                this.searchResultsView = ViewPool.getView("search_results");
                this.searchResultsView.setModel(model.searchResultsModel);

                this.searchResultsView.setTravelDirection(this.travelDirection);

                this.addToRoot(this.searchResultsView.getRootGroup());

                this.cursorX += this.searchResultsView.getSize().x * 0.5 * this.getTravelAxis() +
                    this.viewPadding * this.getTravelAxis();

                this.searchResultsView.getRootGroup().position.set(
                    this.cursorX,
                    0,
                    0
                );

                let edgeView = ViewPool.getView("thread");
                this.addToRoot(edgeView.getRootGroup());

                edgeView.setEndpoints(
                    this.searchView.getAttachPoint("output", this.travelDirection),
                    this.searchResultsView.getAttachPoint("input", this.travelDirection)
                );
            }
        }
    }

    updateRefineView(model) {
        if (this.searchResultsView == null) {
            return;
        }

        if (this.refineView == null) {
            this.refineView = ViewPool.getView("job");
            this.refineView.setModel(model);

            this.refineView.setTravelDirection(this.travelDirection);

            this.addToRoot(this.refineView.getRootGroup());

            this.cursorX += this.refineView.getSize().x * 0.5 * this.getTravelAxis() +
                this.viewPadding * this.getTravelAxis();

            this.refineView.getRootGroup().position.set(
                this.cursorX,
                0,
                0
            );

            let edgeView = ViewPool.getView("thread");
            this.addToRoot(edgeView.getRootGroup());

            edgeView.setEndpoints(
                this.searchResultsView.getAttachPoint("output", this.travelDirection),
                this.refineView.getAttachPoint("input", this.travelDirection)
            );
        }

        if (model.isDirty) {
            this.refineView.update();
            model.markClean();
        }

        if (model.job.status == "COMPLETE") {
            if (this.refineResultsView == null) {
                this.refineResultsView = ViewPool.getView("search_results");
                this.refineResultsView.setModel(model.searchResultsModel);

                this.refineResultsView.setTravelDirection(this.travelDirection);

                this.addToRoot(this.refineResultsView.getRootGroup());

                this.cursorX += this.refineResultsView.getSize().x * 0.5 * this.getTravelAxis() +
                    this.viewPadding * this.getTravelAxis();

                this.refineResultsView.getRootGroup().position.set(
                    this.cursorX,
                    0,
                    0
                );

                let edgeView = ViewPool.getView("thread");
                this.addToRoot(edgeView.getRootGroup());

                edgeView.setEndpoints(
                    this.refineView.getAttachPoint("output", this.travelDirection),
                    this.refineResultsView.getAttachPoint("input", this.travelDirection)
                );
            }
        }
    }

    updateScrapeView (model) {
        if (this.refineResultsView == null) {
            return;
        }

        if (this.scrapeGroupView == null) {
            this.scrapeGroupView = ViewPool.getView("scrape_group");
            this.addToRoot(this.scrapeGroupView.getRootGroup());

            this.cursorX += this.scrapeGroupView.getSize().x * 0.5 * this.getTravelAxis() +
                    this.viewPadding * this.getTravelAxis();

            this.scrapeGroupView.getRootGroup().position.set(
                this.cursorX,
                0,
                0
            );


            let edgeView = ViewPool.getView("thread");
            this.addToRoot(edgeView.getRootGroup());

            edgeView.setEndpoints(
                this.searchResultsView.getAttachPoint("output", this.travelDirection),
                this.scrapeGroupView.getAttachPoint("input", this.travelDirection)
            );
        }

        this.scrapeGroupView.updateScrapeView(model);
    }

    updateFindOwnersFromPageDataView (model) {
        if (this.scrapeGroupView == null) {
            return;
        }
        
        if (model.job.output == null) {
            return;
        }

        if (this.ownersGroupView == null) {
            this.ownersGroupView = ViewPool.getView("owners_group");
            this.addToRoot(this.ownersGroupView.getRootGroup());

            this.cursorX += this.ownersGroupView.getSize().x * 0.5 * this.getTravelAxis() +
                    this.viewPadding * this.getTravelAxis();

            this.ownersGroupView.getRootGroup().position.set(
                this.cursorX,
                0,
                0
            );
        }

        let scrapeView = this.scrapeGroupView.getScrapeView(model.job.metadata.url);
        this.ownersGroupView.updateFindOwnersFromPageDataView(model, scrapeView);
        this.ownersGroupView.update();
    }

    getTravelAxis() {
        return this.travelDirection == "left" ? -1 : 1;
    }
}

export { FindOwnersView };