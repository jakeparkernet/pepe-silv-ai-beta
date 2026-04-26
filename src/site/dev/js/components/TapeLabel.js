import { createPooledMesh } from "../utils/AssetPool.js";
import * as THREE from "three";
import { TextService } from "../services/TextService.js";
import { getTiltQuaternion } from "../utils/getTiltQuaternion.js";
import { InputService } from "../services/InputService.js";

const TAPE_LABEL_MATERIAL_CONFIG = {
    color: "#fbf6c7",
    roughness: 0.375,
    metalness: 0.0
};
const TAPE_LABEL_SURFACE_Z = 0.001;
const TAPE_LABEL_TEXT_Z = 0.002;

let _tapeLabelMaterial = null;

function applyTapeLabelMaterialConfig(nextConfig = {}) {
    Object.assign(TAPE_LABEL_MATERIAL_CONFIG, nextConfig);

    if (_tapeLabelMaterial == null) return;

    _tapeLabelMaterial.color.set(TAPE_LABEL_MATERIAL_CONFIG.color);
    _tapeLabelMaterial.roughness = TAPE_LABEL_MATERIAL_CONFIG.roughness;
    _tapeLabelMaterial.metalness = TAPE_LABEL_MATERIAL_CONFIG.metalness;
    _tapeLabelMaterial.needsUpdate = true;
}

class TapeLabel {
    constructor(options = {}) {
        const geometryParams = { width: 1, height: 1 };
        const materialParams = { ...TAPE_LABEL_MATERIAL_CONFIG };

        const scaleMult = 1;
        this.size = new THREE.Vector3(8, 1, 1).multiplyScalar(scaleMult);
        this.rootGroup = new THREE.Group();
        this.meshVisible = true;
        this.tiltQuaternion = getTiltQuaternion(options.tiltOptions);

        this.meshInstance = createPooledMesh({
            geomType: "plane",
            geomParams: geometryParams,
            matType: "standard",
            matParams: materialParams,
            instanced: true,
            maxInstancesHint: 16
        });
        _tapeLabelMaterial ??= this.meshInstance?._entry?.material ?? null;

        this.getRootGroup().add(this.meshInstance.group);

        this.meshInstance
            .setScale(this.size)
            .setPosition(0, 0, TAPE_LABEL_SURFACE_Z)
            .setQuaternion(this.tiltQuaternion.clone());


        this.textContainer = new THREE.Group();
        this.getRootGroup().add(this.textContainer);
        this.textContainer.position.setComponent(2, TAPE_LABEL_TEXT_Z);
        this.textContainer.quaternion.copy(this.tiltQuaternion.clone());
        this.setVisible(true);
    }

    syncTextVisibility() {
        const visible = this.meshVisible;
        this.textContainer.visible = visible;
        this.label?.userData?.__sdfTextInstance?.setVisible?.(visible);
    }

    setText(text) {
        if (typeof text === "string") {
            text = { 
                text: text,
                autoScale: true,
                wrapMode: "word",
                maxWidth: this.getSize().x,
                maxHeight: this.getSize().y,
                padding: 0,
                breakLongWords: false,
                align: "center",
                anchor: "center"
            }
        }

        const labelText = text?.text ?? "";

        if (this.label == null) {
            this.label = TextService.getText("title", text);
            this.textContainer.add(this.label);
            this.label.userData.__sdfTextInstance?.setVisible?.(this.meshVisible);
            this.syncTextVisibility();
            this.markDirty();
            return;
        }

        if (labelText != this.label.userData.__sdfTextInstance.text) {
            this.label.userData.__sdfTextInstance.updateText(labelText, text);
        }

        this.syncTextVisibility();
        this.markDirty();
    }

    refreshTransform() {
        this.meshInstance
            .setScale(this.size)
            .setPosition(0, 0, TAPE_LABEL_SURFACE_Z)
            .setQuaternion(this.tiltQuaternion.clone());

        this.textContainer.position.set(0, 0, TAPE_LABEL_TEXT_Z);
        this.textContainer.quaternion.copy(this.tiltQuaternion.clone());
        
        this.setVisible(this.meshVisible);
        this.markDirty();
    }

    getSize() {
        return this.size;
    }

    getRootGroup() {
        return this.rootGroup;
    }

    setVisible(visible = true) {
        this.meshVisible = !!visible;
        this.syncTextVisibility();
        this.meshInstance?.setVisible(this.meshVisible);

        if (this.meshVisible) {
            this.meshInstance?.markDirty();
        }

        return this;
    }

    show() {
        return this.setVisible(true);
    }

    hide() {
        return this.setVisible(false);
    }

    markDirty() {
        this.meshInstance?.markDirty?.();
        this.label?.userData?.__sdfTextInstance?.markDirty?.();
        return this;
    }

    getCollider() {
        return InputService.createWorldObbFromObject(
            this.meshInstance.group,
            new THREE.Vector3(1, 1, 1)
        );
    }
}

export { TapeLabel, TAPE_LABEL_MATERIAL_CONFIG, applyTapeLabelMaterialConfig };
