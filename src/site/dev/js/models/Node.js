class Node {
  constructor(params = {}) {
    const {
      id = null,
      inputs = [],
      outputs = [],
      data = {}
    } = params;

    this.id = id || crypto.randomUUID();

    this.inputs = new Map();
    this.outputs = new Map();

    for (let i = 0; i < inputs.length; i++) {
      this.inputs.set(inputs[i].id, inputs[i]);
    }

    for (let i = 0; i < outputs.length; i++) {
      this.outputs.set(outputs[i].id, outputs[i]);
    }

    this.data = Object.assign({}, data);
  }

  isDirty () {
    return this._isDirty === true;
  }

  tryMarkDirty (isDirty) {
    if (isDirty) {
      this.markDirty();
    }
  }

  markDirty () {
    this._isDirty = true;
  }

  markClean () {
    this._isDirty = false;
  }

  addInput(node) {
    if (this.inputs.has(node.id)) {
      return;
    }

    this.inputs.set(node.id, node);
    node.addOutput(this);
  }

  addOutput(node) {
    if (this.outputs.has(node.id)) {
      return;
    }

    this.outputs.set(node.id, node);
    node.addInput(this);
  }

  getDepth () {
    return this._calculateDepth(this);
  }

  getRoot (node) {
    let inputs = node.inputs;

    if (inputs.size > 0) {
      return this.getRoot(inputs.values().next().value);
    }

    return node;
  }

  _calculateDepth (node, depth = 0) {
    let inputs = node.inputs;

    if (inputs.size > 0) {
      depth += 1;
      return this._calculateDepth(inputs.values().next().value, depth);
    }

    return depth;
  }
}

export { Node };
