// TreeView.js
import * as THREE from "three";
import { View } from "./View.js";
import { LevelView } from "./LevelView.js";
import { ViewPool } from "../utils/ViewPool.js";

class TreeView extends View {
  constructor() {
    super();

    this.nodeViewToLevelView = new Map();
    this.nodeViews = new Map();
    this.edgeViews = new Map();

    this.levelGroups = new Map();
    this.levelSpacing = 5;

    this.tree = null;
    this.rootLevel = null;
  }

  displayTree(tree, rootDirection = "up") {
    this.tree = tree;
    this.rootDirection = rootDirection;

    const root = tree.getRoot();
    const rootView = this.getNodeView(root);

    if (!this.rootLevel) {
      this.rootLevel = new LevelView();
      this.addToRoot(this.rootLevel.getRootGroup());
      this.levelGroups.set(0, this.rootLevel);
    }

    this.rootLevel.setTravelDirection(rootDirection);

    const existingRootLevel = this.nodeViewToLevelView.get(rootView.id);
    if (existingRootLevel !== this.rootLevel) {
      this.rootLevel.addChildNodeView(rootView, tree);
      this.nodeViewToLevelView.set(rootView.id, this.rootLevel);
    }
  }

  refreshView() {
    this.tree.levels.forEach((level, depth) => {
      if (depth === 0) return;

      let levelView = this.levelGroups.get(depth);
      const isNewLevel = !levelView;

      if (isNewLevel) {
        let levelViewType = level.length > 0 ? level[0].data.levelType ?? "level" : "level";
        levelView = ViewPool.getView(levelViewType);
        this.levelGroups.set(depth, levelView);

        this.addToRoot(levelView.getRootGroup(), { resetTransform: false });

        const parentLevel = this.levelGroups.get(depth - 1);
        if (parentLevel) {
          parentLevel.addToRoot(levelView.getRootGroup());
          levelView.setParentLevelView(parentLevel);
        }
      }

      for (let i = 0; i < level.length; i++) {
        const node = level[i];
        const nodeView = this.getNodeView(node);

        const existingLevelForNode = this.nodeViewToLevelView.get(nodeView.id);
        if (existingLevelForNode !== levelView) {
          levelView.addChildNodeView(nodeView, this.tree);
          this.nodeViewToLevelView.set(nodeView.id, levelView);
        }
      }
    });

    this.tree.nodes.forEach((node) => {
      //if (node.isDirty()) {
        const nodeView = this.getNodeView(node);
        nodeView.updateNodeView();

        // upate all for now - TODO: Optimize this, and subscribe to parent tree views
        //  or do something else to ensure that we only updat the node view when necessary
        node.markClean();
      //}
    });

    this.tree.levels.forEach((level, depth) => {
      const levelView = this.levelGroups.get(depth);
      if (!levelView) return;

      if (depth === 0) {
        // Root level stays at origin
        levelView.getRootGroup().position.set(0, 0, 0);
        return;
      }

      const parentLevel = this.levelGroups.get(depth - 1);
      if (!parentLevel) return;

      const parentHeight = parentLevel.getHeight();
      const ownHeight = levelView.getHeight();
      const padding = levelView.getPadding();

      const centerOffset =
        (parentHeight * 0.5) + this.levelSpacing 
        + (ownHeight * 0.5) + padding;

      levelView.getRootGroup().position.set(0, centerOffset, 0);
    });

    this.tree.edges.forEach((edge) => {
      const isNewEdge = !this.edgeViews.has(edge.id);
      const edgeView = this.getEdgeView(edge);

      if (isNewEdge) {
        this.addToRoot(edgeView.getRootGroup(), { resetTransform: false });
      }

      const fromNodeView = this.nodeViews.get(edge.fromNode.id);
      const toNodeView = this.nodeViews.get(edge.toNode.id);

      if (fromNodeView == null ||
          toNodeView == null) {
            return;
          }

      const fromPoint = fromNodeView.getAttachPoint("output");
      const toPoint = toNodeView.getAttachPoint("input");

      edgeView.setEndpoints(fromPoint, toPoint);
    });
  }

  getNodeView(node) {
    if (this.nodeViews.has(node.id)) {
      return this.nodeViews.get(node.id);
    }

    const nodeView = ViewPool.getView(node.data.nodeType || "node");
    nodeView.setNode(node);

    this.nodeViews.set(node.id, nodeView);

    return nodeView;
  }

  getEdgeView(edge) {
    if (this.edgeViews.has(edge.id)) {
      return this.edgeViews.get(edge.id);
    }

    const edgeView = ViewPool.getView(edge.data.edgeType || "thread");
    edgeView.setEdge(edge);

    this.edgeViews.set(edge.id, edgeView);

    return edgeView;
  }
}

export { TreeView };
