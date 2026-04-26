import * as THREE from "three";
import { SDFTextMaterialReference } from "../text/SDFTextMaterialReference.js";
import { InputService } from "../services/InputService.js";

const _arrowTextureLoader = new THREE.TextureLoader();
const _arrowTextureCache = new Map();
const ARROW_X_AXIS = new THREE.Vector3(1, 0, 0);

const ARROW_TEXTURE_PATHS = {
    tail: {
        sdf: "resources/arrow_tail_sdf.png",
        basic: "resources/arrow_tail.png"
    },
    head: {
        sdf: "resources/arrow_head_sdf.png",
        basic: "resources/arrow_head.png"
    },
    middle: {
        sdf: "resources/arrow_middle_sdf.png",
        basic: "resources/arrow_middle.png"
    }
};

function _normalizeSize(size) {
    if (size?.isVector3) {
        return size.clone();
    }

    if (Array.isArray(size)) {
        return new THREE.Vector3(size[0] ?? 1, size[1] ?? 1, size[2] ?? 1);
    }

    if (typeof size === "number") {
        return new THREE.Vector3(size, size, size);
    }

    return new THREE.Vector3(1, 1, 1);
}

function _getArrowTexture(path) {
    let texture = _arrowTextureCache.get(path);
    if (texture) {
        return texture;
    }

    texture = _arrowTextureLoader.load(path);
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    texture.needsUpdate = true;

    _arrowTextureCache.set(path, texture);
    return texture;
}

function _createRepeatableArrowTexture(path) {
    const texture = _getArrowTexture(path).clone();
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    texture.needsUpdate = true;
    return texture;
}

function _createArrowMaterial({
    kind,
    useSdf,
    color,
    opacity,
    threshold,
    softness,
    outlineColor,
    outlineThickness,
    outlineOpacity,
    alphaTest,
    ambientStrength,
    diffuseStrength,
    specularStrength,
    sheenStrength,
    sheenPower,
    lightIntensityScale,
    texture = null
}) {
    texture = texture || _getArrowTexture(ARROW_TEXTURE_PATHS[kind][useSdf ? "sdf" : "basic"]);

    if (useSdf) {
        return new SDFTextMaterialReference({
            map: texture,
            color,
            opacity,
            threshold,
            softness,
            outlineColor,
            outlineThickness,
            outlineOpacity,
            useInstancing: false,
            ambientStrength,
            diffuseStrength,
            specularStrength,
            sheenStrength,
            sheenPower,
            lightIntensityScale
        }).getMaterial();
    }

    return new THREE.MeshBasicMaterial({
        map: texture,
        color,
        opacity,
        transparent: true,
        alphaTest,
        side: THREE.DoubleSide
    });
}

class Arrow {
    constructor(options = {}) {
        this.rootGroup = new THREE.Group();

        this.size = _normalizeSize(options.size ?? new THREE.Vector3(2, 1, 1));
        this.length = this.size.x;
        this.baseThickness = this.size.y;
        this.scaleMult = options.scale ?? 1;
        this.useSdf = options.useSdf ?? true;
        this.seamOverlap = options.seamOverlap ?? 0.04;
        this.tailAspect = options.tailAspect ?? 1.0;
        this.headAspect = options.headAspect ?? 1.0;
        this.materialOptions = {
            // Match the baked arrow assets unless a caller explicitly overrides the tint.
            color: options.color ?? "#982222",
            opacity: options.opacity ?? 1.0,
            threshold: options.threshold ?? 0.72,
            softness: options.softness ?? 0.3,
            outlineColor: options.outlineColor ?? 0x000000,
            outlineThickness: options.outlineThickness ?? 0.0,
            outlineOpacity: options.outlineOpacity ?? 0.0,
            alphaTest: options.alphaTest ?? 0.00,
            ambientStrength: options.ambientStrength ?? 0.32,
            diffuseStrength: options.diffuseStrength ?? 0.38,
            specularStrength: options.specularStrength ?? 0.18,
            sheenStrength: options.sheenStrength ?? 0.14,
            sheenPower: options.sheenPower ?? 20.0,
            lightIntensityScale: options.lightIntensityScale ?? 0.02
        };
        this._tmpFrom = new THREE.Vector3();
        this._tmpTo = new THREE.Vector3();
        this._tmpDir = new THREE.Vector3();
        this._tmpMid = new THREE.Vector3();
        this._tmpQuat = new THREE.Quaternion();
        this._tmpFromAdjusted = new THREE.Vector3();
        this._tmpToAdjusted = new THREE.Vector3();

        this._rebuildMeshes();
        this.refreshTransform();
    }

    _disposeMesh(mesh) {
        if (!mesh) {
            return;
        }

        if (mesh.parent) {
            mesh.parent.remove(mesh);
        }

        mesh.geometry?.dispose?.();
        if (mesh.userData.__ownedTexture) {
            mesh.userData.__ownedTexture.dispose?.();
        }
        mesh.material?.dispose?.();
    }

    _rebuildMeshes() {
        this._disposeMesh(this.tailMesh);
        this._disposeMesh(this.middleMesh);
        this._disposeMesh(this.headMesh);

        const middleTexture = _createRepeatableArrowTexture(
            ARROW_TEXTURE_PATHS.middle[this.useSdf ? "sdf" : "basic"]
        );

        this.tailMesh = new THREE.Mesh(
            new THREE.PlaneGeometry(1, 1),
            _createArrowMaterial({
                kind: "tail",
                useSdf: this.useSdf,
                ...this.materialOptions
            })
        );

        this.middleMesh = new THREE.Mesh(
            new THREE.PlaneGeometry(1, 1),
            _createArrowMaterial({
                kind: "middle",
                useSdf: this.useSdf,
                texture: middleTexture,
                ...this.materialOptions
            })
        );
        this.middleMesh.userData.__ownedTexture = middleTexture;

        this.headMesh = new THREE.Mesh(
            new THREE.PlaneGeometry(1, 1),
            _createArrowMaterial({
                kind: "head",
                useSdf: this.useSdf,
                ...this.materialOptions
            })
        );

        this.getRootGroup().add(this.tailMesh);
        this.getRootGroup().add(this.middleMesh);
        this.getRootGroup().add(this.headMesh);
    }

    setUseSdf(useSdf) {
        const nextValue = !!useSdf;
        if (this.useSdf === nextValue) {
            return this;
        }

        this.useSdf = nextValue;
        this._rebuildMeshes();
        this.refreshTransform();
        return this;
    }

    setScale(scale) {
        this.scaleMult = Math.max(scale, 1e-4);
        this.refreshTransform();
        return this;
    }

    setLength(length) {
        this.length = Math.max(length, 1e-4);
        this.refreshTransform();
        return this;
    }

    setEndpoints(fromPoint, toPoint, nudgeFrom = 0, nudgeTo = 0) {
        const group = this.getRootGroup();

        group.position.set(0, 0, 0);
        group.quaternion.identity();
        group.updateMatrixWorld(true);

        const from = group.worldToLocal(this._tmpFrom.copy(fromPoint));
        const to = group.worldToLocal(this._tmpTo.copy(toPoint));
        const dir = this._tmpDir.subVectors(to, from);
        const dirLength = dir.length();

        if (dirLength > 0) {
            dir.multiplyScalar(1 / dirLength);
        }

        const adjustedFrom = this._tmpFromAdjusted.copy(from).addScaledVector(dir, -nudgeFrom);
        const adjustedTo = this._tmpToAdjusted.copy(to).addScaledVector(dir, nudgeTo);
        const length = Math.max(adjustedFrom.distanceTo(adjustedTo), 1e-4);

        this.length = length / Math.max(this.scaleMult, 1e-4);
        this.refreshTransform();

        const mid = this._tmpMid.addVectors(adjustedFrom, adjustedTo).multiplyScalar(0.5);
        group.position.copy(mid);

        if (dirLength > 0) {
            this._tmpQuat.setFromUnitVectors(ARROW_X_AXIS, dir);
            group.quaternion.copy(this._tmpQuat);
        }

        return this;
    }

    refreshTransform() {
        const thickness = Math.max(this.baseThickness * this.scaleMult, 1e-4);
        const tailLength = Math.max(thickness * this.tailAspect, 1e-4);
        const headLength = Math.max(thickness * this.headAspect, 1e-4);
        const totalLength = Math.max(this.length * this.scaleMult, tailLength + headLength + 1e-4);
        const middleLength = Math.max(totalLength - tailLength - headLength, 1e-4);
        const overlapBase = Math.max(thickness * this.seamOverlap, 0.01);
        const tailStartX = -totalLength * 0.5;
        const tailMiddleSeamX = tailStartX + tailLength;
        const headStartX = totalLength * 0.5 - headLength;
        const tipX = totalLength * 0.5;
        const tailOverlap = Math.min(
            overlapBase,
            middleLength * 0.5,
            tailLength * 0.5
        );
        const headOverlap = Math.min(
            overlapBase,
            middleLength * 0.5,
            headLength * 0.5
        );
        const middleRepeatX = Math.max(middleLength / (thickness * 2), 1e-4);

        this.size.set(totalLength, thickness, 1);

        this.tailMesh.scale.set(tailLength + tailOverlap, thickness, 1);
        this.tailMesh.position.set((tailStartX + tailMiddleSeamX) * 0.5 + tailOverlap * 0.5, 0, 0);

        this.middleMesh.scale.set(middleLength + tailOverlap + headOverlap, thickness, 1);
        this.middleMesh.position.set(
            (tailMiddleSeamX + headStartX) * 0.5 + (headOverlap - tailOverlap) * 0.5,
            0,
            0
        );
        if (this.middleMesh.userData.__ownedTexture) {
            this.middleMesh.userData.__ownedTexture.repeat.set(middleRepeatX, 1);
        }

        this.headMesh.scale.set(headLength + headOverlap, thickness, 1);
        this.headMesh.position.set((headStartX + tipX) * 0.5 - headOverlap * 0.5, 0, 0);
    }

    getSize() {
        return this.size;
    }

    getRootGroup() {
        return this.rootGroup;
    }

    getCollider() {
        return InputService.createWorldObbFromObject(
            this.getRootGroup(),
            this.getSize()
        );
    }
}

export { Arrow };
