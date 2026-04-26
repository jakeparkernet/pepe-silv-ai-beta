import { NodeView } from "./NodeView.js";

class NodeViewTemplate extends NodeView {
    constructor({ node = null, options = {} }) {
        super({ node: node, options: options });

    }
}

export { NodeViewTemplate };