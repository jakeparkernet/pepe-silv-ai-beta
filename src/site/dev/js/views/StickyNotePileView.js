import { NodeView } from "./NodeView.js";
import * as THREE from "three";
import { StickyNote } from "../components/StickyNote.js";

class StickyNotePileView extends NodeView {
    constructor({ node = null, options = {} }) {
        super({ node: node, options: options });
        this.stickyNotes = new Map();

        let area = 4;
        this.size = new THREE.Vector3(area, area, 1);
    }

    setNode (node) {
        super.setNode(node);

        let key = 0;
        node.data.stickNotes.forEach((lineData) => {
            this.updateStickyNote(lineData, key);
            key++;
        });
    }

    updateStickyNote (lineData, key) {
        let stickyNote = this.stickyNotes.get(key);

        if (stickyNote == null) {
            stickyNote = new StickyNote();
            this.stickyNotes.set(key, stickyNote);

            this.addToRoot(stickyNote.getRootGroup());

            stickyNote.getRootGroup().position.set(
                THREE.MathUtils.randFloat(-this.size.x * 0.5, this.size.x * 0.5),
                THREE.MathUtils.randFloat(-this.size.y * 0.5, this.size.y * 0.5),
                count * 0.01
            );
        }

        stickyNote.updateLines(lineData);
    }
}

export { StickyNotePileView };