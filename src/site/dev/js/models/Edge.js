class Edge {
  constructor(params = {}) {
    const {
      id = null,
      fromNode = null,
      toNode = null,
      data = {}
    } = params;

    this.id = id || crypto.randomUUID();
    this.fromNode = fromNode;
    this.toNode = toNode;

    this.data = Object.assign({}, data);
  }

  connects(nodeA, nodeB) {
    const aId = nodeA.id;
    const bId = nodeB.id;

    const fromId = this.fromNode?.id;
    const toId = this.toNode?.id;

    return (
      (fromId === aId && toId === bId) ||
      (fromId === bId && toId === aId)
    );
  }

  setFromNode(fromNode) {
    this.fromNode = fromNode;
  }

  setToNode(toNode) {
    this.toNode = toNode;
  }
}

export { Edge };
