// LevelView.js
import { View } from "./View.js";
import * as THREE from "three";
import { TravelDirections } from "../utils/travelDirectionHelpers.js";
import { forward } from "../utils/vectorConstants.js";

class LevelView extends View {

    constructor() {
        super();

        this.parentLevelView = null;
        this.travelDirection = TravelDirections.up;
        this.spacing = 1;
        this.childViews = [];

        this.childrenRoot = new THREE.Group();
        this.addToRoot(this.childrenRoot);
    }

    setParentLevelView(levelView) {
        this.parentLevelView = levelView;
    }

    getParentLevelView() {
        return this.parentLevelView;
    }

    addChildNodeView(nodeView, tree) {
        if (this.childViews.includes(nodeView)) return;

        this.childrenRoot.add(nodeView.getRootGroup());

        let node = nodeView.node;

        let totalChildWidth = this.getWidthAt(this.childViews.length-1)

        let defaultPos = new THREE.Vector3(
            totalChildWidth +
            this.spacing, 0, 0);

        let nodeViewPos = nodeView.getPlacementPosition(
            defaultPos,
            this.childViews.length,
            this.childViews.length + 1
        );

        nodeView.getRootGroup().position.copy(nodeViewPos);

        this.childViews.push(nodeView);
        this.centerChildren();

        let accumulatedTravelDirection = this.getAccumulatedTravelDirection();

        if (nodeView.alignToWorldUp) {
            nodeView.alignToWorldUp();
            nodeView.setTravelDirection(accumulatedTravelDirection);
        }
    }

    getHeight() {
        if (this.childViews.length === 0) {
            return 0;
        }

        const dir = this.getTravelDirection();
        let maxHeight = 0;

        for (let i = 0; i < this.childViews.length; i++) {
            const size = this.childViews[i].getSize();
            const offset = this.childViews[i].getRootGroup().position.clone();

            let h = (dir === "left" || dir === "right") ? size.x : size.y;
            h += (dir === "left" || dir === "right") ? Math.abs(offset.x) * 0.5 : Math.abs(offset.y * 0.5);

            if (h > maxHeight) {
                maxHeight = h;
            }
        }

        return maxHeight;
    }

    getWidth() {
        if (this.childViews.length === 0) return 0;

        let contentWidth = 0;
        this.childViews.forEach((nodeView) => {
            contentWidth += nodeView.getSize().x;
        });

        const gaps = this.childViews.length - 1;
        return contentWidth + gaps * this.spacing;
    }

    getWidthAt(index) {
        if (index < 0) {
            return 0;
        }

        let totalWidth = 0;

        for (let i = 0; i < this.childViews.length; i++) {
            let nodeView = this.childViews[i];

            let dir = this.getTravelDirection();
            let size = nodeView.getSize();
            let nodeViewWidth = (dir === "left" || dir === "right") ? size.y : size.x
            
            totalWidth += nodeViewWidth;
        }

        return totalWidth;
    }

    getPadding() {
        let padding = 0;
        for (let i = 0; i < this.childViews.length; i++) {
            if (this.childViews[i].getPadding() > padding) {
                padding = this.childViews[i].getPadding();
            }
        }

        return padding;
    }

    centerChildren() {
        if (this.childViews.length === 0) return;

        let width = this.getWidth();

        if (this.childViews.length === 1) {
            width = 0;
        }
        
        this.childrenRoot.position.setComponent(0, -width * 0.5);
    }

    /**
     * Returns the accumulated travel direction from the root down to this
     * LevelView, as a string: "up" | "right" | "down" | "left".
     *
     * Assumes this.travelDirection is the direction of this level's "up"
     * relative to its parent level's local directions.
     */
    getAccumulatedTravelDirection() {
        // Map string -> index
        const DIR_TO_INDEX = {
            up: 0,
            right: 1,
            down: 2,
            left: 3,
        };

        // Map index -> string
        const INDEX_TO_DIR = ["up", "right", "down", "left"];

        const ownDir = this.getTravelDirection();
        const ownIndex = DIR_TO_INDEX[ownDir] ?? 0;

        const parent = this.getParentLevelView();

        // Base case: no parent → this is the root level.
        // Its accumulated direction is just its own direction.
        if (!parent) {
            return ownDir;
        }

        // Recursive step:
        // 1. Get the parent's accumulated direction.
        // 2. Convert both to indices.
        // 3. Add them (mod 4) to accumulate quarter-turns.
        const parentAccumDir = parent.getAccumulatedTravelDirection();
        const parentIndex = DIR_TO_INDEX[parentAccumDir] ?? 0;

        const combinedIndex = (parentIndex + ownIndex) % 4;

        return INDEX_TO_DIR[combinedIndex];
    }

    setTravelDirection(travelDirection) {
        this.travelDirection = travelDirection;

        switch (travelDirection) {
            case "up":
                this.getRootGroup().quaternion.setFromAxisAngle(forward, THREE.MathUtils.degToRad(0));
                break;
            case "down":
                this.getRootGroup().quaternion.setFromAxisAngle(forward, THREE.MathUtils.degToRad(180));
                break;
            case "left":
                this.getRootGroup().quaternion.setFromAxisAngle(forward, THREE.MathUtils.degToRad(90));
                break;
            case "right":
                this.getRootGroup().quaternion.setFromAxisAngle(forward, THREE.MathUtils.degToRad(270));
                break;
        }

        let accumulatedTravelDirection = this.getAccumulatedTravelDirection();

        for (let i = 0; i < this.childViews.length; i++) {
            this.childViews[i].alignToWorldUp();
            this.childViews[i].setTravelDirection(accumulatedTravelDirection);
        }
    }

    getTravelDirection() {
        return this.travelDirection;
    }
}

export { LevelView };
