// import { createPooledMesh } from "../utils/AssetPool.js";
import * as THREE from "three";
// import { TextService } from "../services/TextService.js";
// import { InputService } from "../services/InputService.js";
// 
const appModules = window[`apps_${performance.timeOrigin}`].modules;
const { createPooledMesh } = appModules.utils.AssetPool;
const { TextService } = appModules.services.TextService;
const { InputService } = appModules.services.InputService;

const RAISED_LABEL_MATERIAL_CONFIG = {
    color: "#FF0000",
    roughness: 0.26,
    metalness: 0.0
};

let _raisedLabelMaterial = null;

function applyRaisedLabelMaterialConfig(nextConfig = {}) {
    Object.assign(RAISED_LABEL_MATERIAL_CONFIG, nextConfig);

    if (_raisedLabelMaterial == null) return;

    _raisedLabelMaterial.color.set(RAISED_LABEL_MATERIAL_CONFIG.color);
    _raisedLabelMaterial.roughness = RAISED_LABEL_MATERIAL_CONFIG.roughness;
    _raisedLabelMaterial.metalness = RAISED_LABEL_MATERIAL_CONFIG.metalness;
    _raisedLabelMaterial.needsUpdate = true;
}

class RaisedLabel {
    constructor(options = {}) {
        const geometryParams = { width: 1, height: 1 };
        const materialParams = { ...RAISED_LABEL_MATERIAL_CONFIG };

        const scaleMult = 1;
        this.size = new THREE.Vector3(8, 1, 1).multiplyScalar(scaleMult);
        this.rootGroup = new THREE.Group();
        this.fontKey = options.fontKey ?? "title-white";
        this.meshVisible = true;

        this.meshInstance = createPooledMesh({
            geomType: "plane",
            geomParams: geometryParams,
            matType: "standard",
            matParams: materialParams,
            instanced: true,
            maxInstancesHint: 128
        });
        _raisedLabelMaterial ??= this.meshInstance?._entry?.material ?? null;

        this.getRootGroup().add(this.meshInstance.group);

        this.meshInstance
            .setScale(this.size)
            .setPosition(0, 0, 0)
            .setQuaternion(0, 0, 0, 1);


        this.textContainer = new THREE.Group();
        this.getRootGroup().add(this.textContainer);
        this.textContainer.position.setComponent(2, 0.001);
        this.setVisible(true);
    }

    syncTextVisibility() {
        const visible = this.meshVisible;
        this.textContainer.visible = visible;
        this.label?.userData?.__sdfTextInstance?.setVisible?.(visible);
    }

    setText(labelText) {
        const params = {
            text: labelText,
            position: [0, 0, 0],
            size: 0.015,
            wrapMode: "word",
            maxWidth: this.getSize().x * 100,
            maxHeight: this.getSize().y * 100,
            padding: 0,
            align: "center",
            anchor: "center",
            breakLongWords: false,
            fitIterations: 24
        };

        if (this.label == null) {
            this.label = TextService.getText(this.fontKey, params);

            if (params.position) {
                this.label.position.fromArray(params.position);
            }

            if (params.size) {
                this.label.scale.multiplyScalar(params.size);
            }

            this.textContainer.add(this.label);
            this.syncTextVisibility();
            return;
        }

        if (labelText != this.label.userData.__sdfTextInstance.text) {
            this.label.userData.__sdfTextInstance.updateText(params.text, params);
        }

        this.syncTextVisibility();
    }

    refreshTransform() {
        this.meshInstance
            .setScale(this.size)
            .setPosition(0, 0, 0)
            .setQuaternion(0, 0, 0, 1);

        this.setVisible(this.meshVisible);
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

export { RaisedLabel, RAISED_LABEL_MATERIAL_CONFIG, applyRaisedLabelMaterialConfig };
