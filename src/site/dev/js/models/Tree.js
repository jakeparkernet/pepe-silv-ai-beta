import { Edge } from "./Edge.js";

class Tree {
  constructor() {
    this.nodes = new Map();
    this.edges = new Map();
    this.levels = new Map();

    this.rootId = null;
  }

  // NEW: compute depth of a node relative to this tree only
  getDepth(node, visited = new Set()) {
    if (!node) {
      return 0;
    }

    // Prevent infinite loops if there is an unexpected cycle
    if (visited.has(node.id)) {
      return 0;
    }
    visited.add(node.id);

    let maxParentDepth = -1;

    // node.inputs is a Map<id, Node> :contentReference[oaicite:1]{index=1}
    node.inputs.forEach((inputNode) => {
      // only consider inputs that are also part of THIS tree
      if (!this.nodes.has(inputNode.id)) {
        return;
      }

      const parentDepth = this.getDepth(inputNode, new Set(visited));
      if (parentDepth > maxParentDepth) {
        maxParentDepth = parentDepth;
      }
    });

    // If no parents in this tree, this node is a root (for this tree)
    if (maxParentDepth === -1) {
      return 0;
    }

    return maxParentDepth + 1;
  }

  addNode(node) {

    if (this.nodes.has(node.id)) return;

    this.nodes.set(node.id, node);
    if (!this.rootId) {
      this.rootId = node.id;
    }

    const depth = this.getDepth(node);
    if (this.levels.has(depth) == false) {
      this.levels.set(depth, []);
    }

    this.levels.get(depth).push(node);

    this.recalculate();

    return node;
  }

  getNode(nodeId) {
    return this.nodes.get(nodeId);
  }

  getRoot() {
    if (this.levels.has(0) == false ||
        this.levels.get(0).length < 0) {
          return null;
        }
        
    return this.levels.get(0)[0];
  }

  getNodeAt(index, depth) {
    let levelNodes = this.levels.get(depth);
    return levelNodes[index];
  }

  getSiblings(node) {
    const depth = this.getDepth(node);
    return this.levels.get(depth);
  }

  getIndex(node) {
    let siblings = this.getSiblings(node);
    return siblings.indexOf(node);
  }

  addEdge(edge) {
    this.edges.set(edge.id, edge);
    return edge;
  }

  getEdge(edgeId) {
    return this.edges[edgeId] || null;
  }

  inputsOf(nodeId) {
    const n = this.nodes.get(nodeId);
    return n ? n.inputs.slice() : [];
  }

  outputsOf(nodeId) {
    const n = this.nodes.get(nodeId);
    return n ? n.outputs.slice() : [];
  }

  recalculate() {
    this.levels.clear();
    this.nodes.forEach((node, nodeId) => {
      const depth = this.getDepth(node);
      if (this.levels.has(depth) == false) {
        this.levels.set(depth, []);
      }

      this.levels.get(depth).push(node);
      this.recalculateEdges(node);
    });
  }

  recalculateEdges(node) {
    node.inputs.forEach((nodeInput) => {
      let edge = null;
      this.edges.forEach((existingEdge) => {
        if (edge) return;

        if (existingEdge.connects(node, nodeInput)) {
          edge = existingEdge;
        }
      });

      if (edge == null) {
        edge = new Edge({
          id: null,
          fromNode: nodeInput,
          toNode: node
        });
        this.edges.set(edge.id, edge);
      }
    });

    node.outputs.forEach((nodeOutput) => {
      let edge = null;
      this.edges.forEach((existingEdge) => {
        if (edge) return;

        if (existingEdge.connects(node, nodeOutput)) {
          edge = existingEdge;
        }
      });

      if (edge == null) {
        edge = new Edge({
          id: null,
          fromNode: node,
          toNode: nodeOutput
        });

        this.edges.set(edge.id, edge);
      }
    });
  }
}

export { Tree };
