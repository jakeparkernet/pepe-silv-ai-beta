import * as THREE from "three";
import { NodeView } from "./NodeView.js";
import { getTiltQuaternion } from "../utils/getTiltQuaternion.js";
import { TextService } from "../services/TextService.js";
import { InputService } from "../services/InputService.js";

class EntityViewBig extends NodeView {
    constructor() {
        super();
        this.getDimensions = this.getDimensions.bind(this);
        this.getTextCollider = this.getTextCollider.bind(this);
        this.onClick = this.onClick.bind(this);
        this.setScale = this.setScale.bind(this);

        this.scale = 1;

        this.textContainer = new THREE.Group();
        this.rootGroup.add(this.textContainer);
        this.textContainer.quaternion.copy(getTiltQuaternion({
            tiltRangeMin: -5,
            tiltRangeMax: 5
        }));

        this.textContainer.position.set(0, 0, 0);
        this.textContainer.scale.set(1, 1, 1);
        this.textObjects = new Map();
    }

    syncTextVisibility(visible = true) {
        this.textContainer.visible = !!visible;

        for (const label of this.textObjects.values()) {
            label?.userData?.__sdfTextInstance?.setVisible?.(visible);
        }
    }

    show() {
        super.show();
        this.syncTextVisibility(true);
    }

    hide() {
        this.syncTextVisibility(false);
        super.hide();
    }

    setScale(scale) {
        this.scale = scale;
        this.getRootGroup().scale.setScalar(this.scale);
    }

    getDimensions() {
        this.textContainer.updateMatrixWorld(true);

        const box = new THREE.Box3();
        const childBox = new THREE.Box3();

        for (const label of this.textObjects.values()) {
            const textInstance = label?.userData?.__sdfTextInstance;
            if (!textInstance || typeof textInstance.getBounds !== "function") {
                continue;
            }

            textInstance.getBounds(childBox, { space: "local" });
            if (childBox.isEmpty() === false) {
                box.union(childBox);
            }
        }

        if (box.isEmpty()) {
            return { width: 0, height: 0 };
        }

        const size = box.getSize(new THREE.Vector3());
        return {
            width: size.x * this.scale,
            height: size.y * this.scale
        };
    }
    
    update() {
        super.update();

        this.updateLine("name", {
            text: this.model.name,
            position: [0, 0, 0],
            size: 0.05,
            wrapMode: "word",
            maxWidth: 600,
            maxHeight: 180,
            breakLongWords: false,
            align: "center",
            anchor: "center"
        });

    }

    updateLines(lines) {
        if (lines == null) return;

        for (const [key, text] of Object.entries(lines)) {
            this.updateLine(key, text);
        }
    }

    updateLine(key, params) {
        let label = this.textObjects.get(key);

        if (typeof params === "string") {
            params = { text: params }
        }

        if (label == null) {
            label = TextService.getText("title", params);
            this.textObjects.set(key, label);
            this.textContainer.add(label);

            if (params.position) {
                label.position.fromArray(params.position);
            }

            if (params.size) {
                label.scale.multiplyScalar(params.size);
            }

            label.userData.__sdfTextInstance?.setVisible?.(this.textContainer.visible);
        }

        if (label.userData.__sdfTextInstance.text != params.text) {
            label.userData.__sdfTextInstance.updateText(params.text, params);
        }
    }

    getTextCollider() {
        this.textContainer.updateMatrixWorld(true);

        const bounds = new THREE.Box3();
        const childBounds = new THREE.Box3();

        for (const label of this.textObjects.values()) {
            const textInstance = label?.userData?.__sdfTextInstance;
            if (!textInstance || typeof textInstance.getBounds !== "function") {
                continue;
            }

            textInstance.getBounds(childBounds, { space: "local" });
            if (childBounds.isEmpty() === false) {
                bounds.union(childBounds);
            }
        }

        if (bounds.isEmpty()) {
            return null;
        }

        return InputService.createWorldObbFromObject(
            this.textContainer,
            bounds.getSize(new THREE.Vector3()),
            bounds.getCenter(new THREE.Vector3())
        );
    }

    onClick(payload = {}) {
        const detailData = this.model;
        window[`apps_${performance.timeOrigin}`]?.pepe?.openDetailPanel?.({
            title: "Entity Details",
            kind: "entity",
            data: detailData
        });
        console.log("Entity clicked", detailData);
    }
}

export { EntityViewBig };
