import * as THREE from "three";
import { View } from "./View.js"
import { TreeView } from "./TreeView.js";
import { Node } from "../models/Node.js";
import { Tree } from "../models/Tree.js";
import { ViewPool } from "../utils/ViewPool.js";
import { tryApplyDiff } from "../utils/objectUtils.js";

class InvestigationView extends View {

    constructor() {
        super();

        this.ownerTreeViews = new Map();
        this.treeDepths = new Map();
    }

    applyModel(investigationModel) {

        if (this.investigationJobView == null) {
            this.investigationJobView = ViewPool.getView(investigationModel.job.metadata.view_data.nodeType);
            this.addToRoot(this.investigationJobView.getRootGroup());

            this.investigationJobView.setModel(investigationModel);
            this.investigationJobView.update();
        }
        else {
            if (investigationModel.isDirty) {
                this.investigationJobView.update();
                investigationModel.markClean();
            }
        }

        let articleAnalysisModel = investigationModel.getChildJobModelByNote("article scrape");
        if (articleAnalysisModel) {
            if (this.articleAnalysisView == null) {
                this.articleAnalysisView = ViewPool.getView(articleAnalysisModel.job.metadata.view_data.nodeType);

                this.articleAnalysisView.setModel(articleAnalysisModel);

                this.addToRoot(this.articleAnalysisView.getRootGroup());

                this.articleAnalysisView.getRootGroup().position.set(
                    0, -11, 0
                );

                let articleEdgeView = ViewPool.getView("thread");
                this.getRootGroup().add(articleEdgeView.getRootGroup());
                
                articleEdgeView.setEndpoints(
                    this.investigationJobView.getAttachPoint("output", "down"),
                    this.articleAnalysisView.getAttachPoint("input", "down")
                );
            }
            else {
                if (articleAnalysisModel.isDirty) {
                    this.articleAnalysisView.update();
                    articleAnalysisModel.markClean();
                }
            }
        }

        let identifyNewsSiteModel = investigationModel.getChildJobModelByNote("identify news site")
        if (identifyNewsSiteModel) {
            if (this.articleAnalysisView &&
                this.identifyNewsSiteView == null) {
                this.identifyNewsSiteView = ViewPool.getView(identifyNewsSiteModel.job.metadata.view_data.nodeType);

                this.identifyNewsSiteView.setModel(identifyNewsSiteModel);

                this.addToRoot(this.identifyNewsSiteView.getRootGroup());

                this.identifyNewsSiteView.getRootGroup().position.set(
                    15,
                    -20,
                    0
                );

                let identifyEdgeView = ViewPool.getView("thread");
                this.getRootGroup().add(identifyEdgeView.getRootGroup());

                identifyEdgeView.setEndpoints(
                    this.articleAnalysisView.getAttachPoint("output", "down"),
                    this.identifyNewsSiteView.getAttachPoint("input", "right")
                );
            }
            else {
                if (identifyNewsSiteModel.isDirty) {
                    this.identifyNewsSiteView.update();
                    identifyNewsSiteModel.markClean();
                }
            }
        }

        investigationModel.ownershipTrees.forEach((tree, key) => {
            if (tree.primaryEntity != null) {
                if (this.ownerTreeViews.has(key) == false) {

                    let edgeViewTemp = ViewPool.getView("thread");
                    this.addToRoot(edgeViewTemp.getRootGroup());

                    // store travelDirection in metadata
                    // locate target entity view based on entity
                    // anchor ownershiptree view to that entity view
                    let travelDirection = tree.travelDirection;

                    let ownerTreeView = ViewPool.getView("owner_tree");
                    ownerTreeView.setTravelDirection(travelDirection);
                    ownerTreeView.setModel(tree);

                    this.addToRoot(ownerTreeView.getRootGroup());

                    if (key == "subjects") {
                        ownerTreeView.getRootGroup().position.set(
                            -10, 
                            -20,
                            0
                        );

                        this.treeDepths.set(key, 1);
                    }
                    else if (key == "news_site") {
                        ownerTreeView.getRootGroup().position.set(
                            15, 
                            -20,
                            0
                        );

                        this.treeDepths.set(key, 1);
                    }
                    else if (key.includes("_entity_")) {
                        let investigationBranch = this.ownerTreeViews.get(tree.rootName);
                        let curDepth = this.treeDepths.get(tree.rootName);
                        curDepth += 1;
                        
                        this.treeDepths.set(tree.rootName, curDepth);

                        let treePos = investigationBranch.getRootGroup().position.clone();
                        let xMult = travelDirection == "right" ? 1 : -1;
                        treePos.x += curDepth * xMult * 40;
                        
                        ownerTreeView.getRootGroup().position.copy(treePos);
                    }

                    edgeViewTemp.setEndpoints(
                        this.articleAnalysisView.getAttachPoint("output", "down"),
                        ownerTreeView.getAttachPoint("input", ownerTreeView.travelDirection)
                    );

                    this.ownerTreeViews.set(key, ownerTreeView);
                }
            }
        });


        this.ownerTreeViews.forEach((view) => {
            view.update();
        });
    }
}

export { InvestigationView };