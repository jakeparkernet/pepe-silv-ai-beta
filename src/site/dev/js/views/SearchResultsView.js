import { NodeView } from "./NodeView.js";
import * as THREE from "three";
import { StickyNote } from "../components/StickyNote.js";
import { TapeLabel } from "../components/TapeLabel.js";

class SearchResultsView extends NodeView {
    constructor() {
        super();
        this.stickyNotes = new Map();

        let area = 4;
        this.size = new THREE.Vector3(area, area, 1);

        this.tapeLabel = new TapeLabel();
        this.tapeLabel.setText("Search Results!");

        this.addToRoot(this.tapeLabel.getRootGroup());

        let tapeLabelSpacing = 0.5;
        this.tapeLabel.getRootGroup().position.setComponent(1, area + tapeLabelSpacing);

        let tapeLabelScale = 0.69;
        this.tapeLabel.getRootGroup().scale.set(tapeLabelScale, tapeLabelScale, tapeLabelScale);
        this.tapeLabel.markDirty?.();
    }

    show() {
        super.show();
        this.tapeLabel?.show?.();
        for (const stickyNote of this.stickyNotes.values()) {
            stickyNote?.show?.();
        }
    }

    hide() {
        this.tapeLabel?.hide?.();
        for (const stickyNote of this.stickyNotes.values()) {
            stickyNote?.hide?.();
        }
        super.hide();
    }

    setModel (model) {
        super.setModel(model);

        let count = 0;
        model.results.forEach((searchResult) => {
            this.updateStickyNote(searchResult, count);
            count++;
        });
    }

    updateStickyNote (searchResult, count) {
        let stickyNote = this.stickyNotes.get(searchResult.url);
        if (stickyNote == null) {
            stickyNote = new StickyNote();
            this.stickyNotes.set(searchResult.url, stickyNote);

            this.addToRoot(stickyNote.getRootGroup());
            stickyNote.getRootGroup().position.set(
                THREE.MathUtils.randFloat(-this.size.x * 0.5, this.size.x * 0.5),
                THREE.MathUtils.randFloat(-this.size.y * 0.5, this.size.y * 0.5),
                count * 0.01
            );

            if (this.getRootGroup().visible === false) {
                stickyNote.hide();
            }
        }

        stickyNote.updateLines({
            url: { 
                text: searchResult.url,
                position: [0, 0.5, 0],
                size: 0.1
            },
            description: { 
                text: searchResult.description,
                position: [0, -0.5, 0],
                size: 0.1
            }
        });
    }
}

export { SearchResultsView };
