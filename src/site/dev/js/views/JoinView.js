// TreeView.js
import * as THREE from "three";
import { View } from "./View.js";
import { ViewPool } from "../utils/ViewPool.js";

class JoinView extends View {

    joinNodes (fromNode, toNode, fromTreeView, toTreeView, edgeParent = null, options = {}) {
        let fromNodeView = fromTreeView.getNodeView(fromNode);

        fromNodeView.addToRoot(toTreeView.getRootGroup());
        
        let offset = options.offset ?? { x: 1, y: 1 };
        let offsetMult = options.offsetMult ?? { x: 1, y: -1};

        toTreeView.getRootGroup().position.set(
            offsetMult.x * (fromNodeView.getSize().x + offset.x), 
            offsetMult.y * (fromNodeView.getSize().y + offset.y), 0);

        // make an edge
        let edgeView = ViewPool.getView("thread");

        if (edgeParent == null) {
            edgeParent = fromTreeView.getRootGroup();
        }

        edgeParent.add(edgeView.getRootGroup());

        let toNodeView = toTreeView.getNodeView(toNode);

        let fromDirection = options.fromDirection ?? "down";
        let toDirection = options.fromDirection ?? "down";

        const fromPoint = fromNodeView.getAttachPoint("output", fromDirection);
        const toPoint = toNodeView.getAttachPoint("input", toDirection);

        edgeView.setEndpoints(fromPoint, toPoint);
    }
}

export { JoinView };