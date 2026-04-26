import { NodeView } from "./NodeView.js";
import * as THREE from "three";
import { StickyNote } from "../components/StickyNote.js";

class StickyNoteView extends NodeView {
    constructor({ node = null, options = {} }) {
        super({ node: node, options: options });

        this.stickyNote = new StickyNote();
        this.addToRoot(this.stickyNote.getRootGroup());
    }

    show() {
        super.show();
        this.stickyNote?.show?.();
    }

    hide() {
        this.stickyNote?.hide?.();
        super.hide();
    }

    setNode (node) {
        super.setNode(node);

        this.stickyNote.updateLines(node.data.lines);
        this.obbMesh.visible = false;
    }

    refreshSize() {
        if (this.size == null) {
            this.size = this.stickyNote.getSize();
            return true;
        }
        else if (this.stickyNote.getSize().equals(this.size) === false) {
            this.size = this.stickyNote.getSize();
            return true;
        }

        return false;
    }
}

export { StickyNoteView };
