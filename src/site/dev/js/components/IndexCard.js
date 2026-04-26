import { createPooledMesh } from "../utils/AssetPool.js";
import * as THREE from "three";
import { TextService } from "../services/TextService.js";
import { InputService } from "../services/InputService.js";

const INDEX_CARD_MATERIAL_CONFIG = {
    color: 0xffffff,
    roughness: 0.38,
    metalness: 0.0
};

let _indexCardMaterial = null;

function applyIndexCardMaterialConfig(nextConfig = {}) {
    Object.assign(INDEX_CARD_MATERIAL_CONFIG, nextConfig);

    if (_indexCardMaterial == null) return;

    _indexCardMaterial.color.set(INDEX_CARD_MATERIAL_CONFIG.color);
    _indexCardMaterial.roughness = INDEX_CARD_MATERIAL_CONFIG.roughness;
    _indexCardMaterial.metalness = INDEX_CARD_MATERIAL_CONFIG.metalness;
    _indexCardMaterial.needsUpdate = true;
}

class IndexCard {
    constructor() {
        const textures = {
            "map": {
                texture: "resources/index_card.png",
                params: {
                    wrapS: THREE.RepeatWrapping,
                    wrapT: THREE.RepeatWrapping
                }
            }
        }

        const geometryParams = { width: 1, height: 1 };
        const materialParams = {
            ...INDEX_CARD_MATERIAL_CONFIG,
            textures: textures,
        };

        const scaleMult = 1;
        this.size = new THREE.Vector3(5, 3, 1).multiplyScalar(scaleMult);
        this.rootGroup = new THREE.Group();
        this.meshVisible = true;

        this.meshInstance = createPooledMesh({
            geomType: "plane",
            geomParams: geometryParams,
            matType: "standard",
            matParams: materialParams,
            instanced: true,
            maxInstancesHint: 512
        });
        _indexCardMaterial ??= this.meshInstance?._entry?.material ?? null;

        this.getRootGroup().add(this.meshInstance.group);

        this.meshInstance
            .setScale(this.size)
            .setPosition(0, 0, 0)
            .setQuaternion(0, 0, 0, 1);

        this.textContainer = new THREE.Group();
        this.rootGroup.add(this.textContainer);

        this.textContainer.position.set(0, 0, 0);
        this.textContainer.scale.set(1, 1, 1);
        this.textContainer.quaternion.set(0, 0, 0, 1);
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

    getCollider() {
        return InputService.createWorldObbFromObject(
            this.meshInstance.group,
            new THREE.Vector3(1, 1, 1)
        );
    }
}

export { IndexCard, INDEX_CARD_MATERIAL_CONFIG, applyIndexCardMaterialConfig };
