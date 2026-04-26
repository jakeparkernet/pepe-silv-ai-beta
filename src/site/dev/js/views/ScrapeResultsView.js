import { NodeView } from "./NodeView.js";
import { StickyNote } from "../components/StickyNote.js";

class ScrapeResultsView extends NodeView {
    constructor({ node = null, options = {} }) {
        super({ node: node, options: options });

    }
}

export { ScrapeResultsView };