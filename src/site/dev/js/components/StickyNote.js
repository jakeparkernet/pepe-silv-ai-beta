// import { createPooledMesh } from "../utils/AssetPool.js";
import * as THREE from "three";
// import { TextService } from "../services/TextService.js";
// import { getTiltQuaternion } from "../utils/getTiltQuaternion.js";
// import { InputService } from "../services/InputService.js";
// 
const appModules = window[`apps_${performance.timeOrigin}`].modules;
const { createPooledMesh } = appModules.utils.AssetPool;
const { TextService } = appModules.services.TextService;
const { getTiltQuaternion } = appModules.utils.getTiltQuaternion;
const { InputService } = appModules.services.InputService;

const STICKY_NOTE_MATERIAL_CONFIG = {
    color: "#FFED7A",
    roughness: 0.511,
    metalness: 0.0
};

let _stickyNoteMaterial = null;

function applyStickyNoteMaterialConfig(nextConfig = {}) {
    Object.assign(STICKY_NOTE_MATERIAL_CONFIG, nextConfig);

    if (_stickyNoteMaterial == null) return;

    _stickyNoteMaterial.color.set(STICKY_NOTE_MATERIAL_CONFIG.color);
    _stickyNoteMaterial.roughness = STICKY_NOTE_MATERIAL_CONFIG.roughness;
    _stickyNoteMaterial.metalness = STICKY_NOTE_MATERIAL_CONFIG.metalness;
    _stickyNoteMaterial.needsUpdate = true;
}

class StickyNote {
    constructor() {
        const geometryParams = { width: 1, height: 1 };
        const materialParams = { ...STICKY_NOTE_MATERIAL_CONFIG };

        const scaleMult = 2;
        this.size = new THREE.Vector3(1, 1, 1).multiplyScalar(scaleMult);
        this.rootGroup = new THREE.Group();
        this.rootGroup.quaternion.copy(getTiltQuaternion());
        this.meshVisible = true;

        this.meshInstance = createPooledMesh({
            geomType: "plane",
            geomParams: geometryParams,
            matType: "standard",
            matParams: materialParams,
            instanced: true,
            maxInstancesHint: 512
        });
        _stickyNoteMaterial ??= this.meshInstance?._entry?.material ?? null;

        this.getRootGroup().add(this.meshInstance.group);

        this.meshInstance
            .setScale(this.size)
            .setPosition(0, 0, 0)
            .setQuaternion(getTiltQuaternion());

        this.textContainer = new THREE.Group();
        this.rootGroup.add(this.textContainer);

        this.textContainer.position.set(0, 0, 0);
        this.textContainer.scale.set(1, 1, 1);
        this.textContainer.quaternion.copy(getTiltQuaternion());
        this.textObjects = new Map();

        this.setVisible(true);
    }

    syncTextVisibility() {
        const visible = this.meshVisible;
        this.textContainer.visible = visible;

        for (const label of this.textObjects.values()) {
            label?.userData?.__sdfTextInstance?.setVisible?.(visible);
        }
    }

    updateLines (lines) {
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

            label.userData.__sdfTextInstance?.setVisible?.(this.meshVisible);
        }

        if (label.userData.__sdfTextInstance.text != params.text) {
            label.userData.__sdfTextInstance.updateText(params.text, params);
        }
    }

    refreshTransform() {
        this.meshInstance
            .setScale(this.size)
            .setPosition(0, 0, 0)
            .setQuaternion(getTiltQuaternion());

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

        for (const label of this.textObjects.values()) {
            label?.userData?.__sdfTextInstance?.markDirty?.();
        }

        return this;
    }

    getCollider() {
        return InputService.createWorldObbFromObject(
            this.meshInstance.group,
            new THREE.Vector3(1, 1, 1)
        );
    }

    alignToWorldUp() {
        const root = this.getRootGroup();
        const parent = root.parent;
        if (!parent) return;
    
        const parentWorldQuat = parent.getWorldQuaternion(new THREE.Quaternion());
        const invParentWorldQuat = parentWorldQuat.clone().invert();
    
        root.quaternion.copy(invParentWorldQuat);
      }
}

export { StickyNote, STICKY_NOTE_MATERIAL_CONFIG, applyStickyNoteMaterialConfig };
