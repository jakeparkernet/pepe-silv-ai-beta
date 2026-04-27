import * as THREE from "three";

const CORKBOARD_MATERIAL_CONFIG = {
    corkLight: 0xb9875a,
    corkDark: 0x6b472d,
    fleckColor: 0xd7b896,
    scale: 55,
    poreScale: 180,
    bumpStrength: 0.06,
    roughness: 0.95,
    metalness: 0.0
};

let _corkboardMaterial = null;

class Corkboard {
    constructor(options = {}) {
        this.rootGroup = new THREE.Group();
        this.size = new THREE.Vector3(36, 24, 1);
        this.textureRepeatPerUnit = options.textureRepeatPerUnit ?? 0.1;
        this.geometry = new THREE.PlaneGeometry(1, 1);
        this.material = getCorkboardMaterial();
        this.mesh = new THREE.Mesh(this.geometry, this.material);
        this.mesh.position.set(0, 0, 0);
        this.mesh.quaternion.set(0, 0, 0, 1);
        this.getRootGroup().add(this.mesh);

        this.setDimensions(options.width ?? this.size.x, options.height ?? this.size.y);
    }

    setDimensions(width = this.size.x, height = this.size.y) {
        this.size.set(
            Math.max(width, 0.0001),
            Math.max(height, 0.0001),
            1
        );

        this.mesh.scale.set(this.size.x, this.size.y, 1);
        this.mesh.position.set(0, 0, 0);
        this.mesh.quaternion.set(0, 0, 0, 1);
        if (this.material.map) {
            this.material.map.repeat.set(
                this.size.x * this.textureRepeatPerUnit,
                this.size.y * this.textureRepeatPerUnit
            );
            this.material.map.needsUpdate = true;
        }

        return this;
    }

    setWidth(width) {
        return this.setDimensions(width, this.size.y);
    }

    setHeight(height) {
        return this.setDimensions(this.size.x, height);
    }

    getSize() {
        return this.size;
    }

    getRootGroup() {
        return this.rootGroup;
    }
}

export { Corkboard, CORKBOARD_MATERIAL_CONFIG };

function getCorkboardMaterial() {
    if (_corkboardMaterial != null) {
        return _corkboardMaterial;
    }

    _corkboardMaterial = createCorkboardMaterial(CORKBOARD_MATERIAL_CONFIG);
    return _corkboardMaterial;
}

function applyCorkboardMaterialConfig(nextConfig = {}) {
    Object.assign(CORKBOARD_MATERIAL_CONFIG, nextConfig);

    if (_corkboardMaterial == null) return;

    _corkboardMaterial.roughness = CORKBOARD_MATERIAL_CONFIG.roughness;
    _corkboardMaterial.metalness = CORKBOARD_MATERIAL_CONFIG.metalness;
    _corkboardMaterial.needsUpdate = true;
}

export function createCorkboardMaterial({
    corkLight = 0xb68658,
    corkDark = 0x6e4b2f,
    fleckColor = 0xd2b08a,

    scale = 80.0,
    poreScale = 220.0,
    bumpStrength = 0.08,

    roughness = 0.94,
    metalness = 0.0
} = {}) {
    const textureLoader = new THREE.TextureLoader();
    const map = textureLoader.load("resources/corkboard-tiling-2.jpg");
    map.wrapS = THREE.RepeatWrapping;
    map.wrapT = THREE.RepeatWrapping;

    const material = new THREE.MeshPhysicalMaterial({
        color: "#bababa",
        map,
        roughness,
        metalness
    });

    return material;
}

export { applyCorkboardMaterialConfig };
