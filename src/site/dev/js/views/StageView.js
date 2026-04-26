import * as THREE from "three";
import { NodeView } from "./NodeView.js"
import { StageBackground } from "../components/StageBackground.js";
import { TextService } from "../services/TextService.js";
import { Tree } from "../models/Tree.js";
import { TreeView } from "./TreeView.js";

class StageView extends NodeView {
    setNode(node) {
        super.setNode(node);

        this.refreshFromNodeSize = this.refreshFromNodeSize.bind(this);
        this.resizeStage = this.resizeStage.bind(this);
        this.positionTitle = this.positionTitle.bind(this);

        this.obbMesh.visible = false;

        this.titleText = node.data.title;

        this.bgContainer = new THREE.Group();
        this.addToRoot(this.bgContainer);

        this.background = new StageBackground(0.1);

        this.background.setSize(this.node.size.x, this.node.size.y);

        this.bgContainer.add(this.background.getRootGroup());

        this.textContainer = new THREE.Group();
        this.addToRoot(this.textContainer);

        this.generateTitle();
    }

    refreshFromNodeSize() {
        if (super.refreshFromNodeSize()) {
            this.resizeStage();
            this.positionTitle();
        }
    }

    resizeStage() {
        if (this.background == null) return;
        this.background.setSize(this.node.size.x, this.node.size.y);
    }

    positionTitle() {
        if (this.title == null) return;
        
        let size = this.getSize();
        let titlePadding = 1;

        let x = (-size.x / 2) + titlePadding;
        let y = (size.y / 2) - titlePadding;

        this.title.position.set(x, y + 3, 0);
    }

    generateTitle() {
        this.title = TextService.getText("title-white", { text: this.titleText, anchor: "top-left" });

        this.textContainer.add(this.title);
        this.title.scale.set(2, 2, 2);
        this.positionTitle();
    }
}

export { StageView };