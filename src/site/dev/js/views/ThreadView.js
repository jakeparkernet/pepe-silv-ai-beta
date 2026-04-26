import { EdgeView } from "./EdgeView.js";
import * as THREE from "three";
import { createPooledMesh } from "../utils/AssetPool.js";
import { InputService } from "../services/InputService.js";

const THREAD_X_AXIS = new THREE.Vector3(1, 0, 0);
const THREAD_MATERIAL_CONFIG = {
    color: 0xffffff,
    roughness: 1,
    metalness: 0.0
};

let _threadMaterial = null;

function applyThreadMaterialConfig(nextConfig = {}) {
    Object.assign(THREAD_MATERIAL_CONFIG, nextConfig);

    if (_threadMaterial == null) return;

    _threadMaterial.color.set(THREAD_MATERIAL_CONFIG.color);
    _threadMaterial.roughness = THREAD_MATERIAL_CONFIG.roughness;
    _threadMaterial.metalness = THREAD_MATERIAL_CONFIG.metalness;
    _threadMaterial.needsUpdate = true;
}

class ThreadView extends EdgeView {

    constructor (params = {}) {
        super(params);

        this.getMeshInstance = this.getMeshInstance.bind(this);
        this.show = this.show.bind(this);
        this.hide = this.hide.bind(this);
        this.setThreadMeshVisible = this.setThreadMeshVisible.bind(this);

        this.threadWidth = 1.25;
        this.threadMeshVisible = true;
        this._tmpFrom = new THREE.Vector3();
        this._tmpTo = new THREE.Vector3();
        this._tmpDir = new THREE.Vector3();
        this._tmpMid = new THREE.Vector3();
        this._tmpQuat = new THREE.Quaternion();
    }

    generateEdgeMesh() {
        try {
            this.baseScale = new THREE.Vector3(1, this.threadWidth * 0.125, 1);

            const thickness = 0.1;
            const doubleSided = true;
            const color = 0xffffff;
            const opacity = 1.0;
            const materialType = "standard";

            let loadCount = 0;
            let loadTotal = 3;

            const checkScaleApply = () => {
                if (loadCount === loadTotal) {
                    this._applyEdgeTransform();
                }
            };

            this.textures = {
                "map": {
                    texture: "resources/edge_middle_albedo.png",
                    params: {
                        wrapS: THREE.RepeatWrapping
                    },
                    onLoad: (texture) => {
                        loadCount++;
                        checkScaleApply();
                    }
                },
                "alphaMap": {
                    texture: "resources/edge_middle_alpha.png",
                    params: {
                        wrapS: THREE.RepeatWrapping,
                    },
                    onLoad: (texture) => {
                        loadCount++;
                        checkScaleApply();
                    }
                },
                "normal": {
                    texture: "resources/edge_middle_normal.png",
                    params: {
                        wrapS: THREE.RepeatWrapping,
                    },
                    onLoad: (texture) => {
                        loadCount++;
                        checkScaleApply();
                    }
                }
            };

            const geometryParams = { width: 1, height: 1 * this.threadWidth };
            const materialParams = {
                color: THREAD_MATERIAL_CONFIG.color,
                transparent: true,
                side: doubleSided ? THREE.DoubleSide : THREE.FrontSide,
                textures: this.textures,
                roughness: THREAD_MATERIAL_CONFIG.roughness,
                metalness: THREAD_MATERIAL_CONFIG.metalness
            };

            this.meshInstance = createPooledMesh({
                geomType: "plane",
                geomParams: geometryParams,
                matType: materialType,
                matParams: materialParams,
                instanced: true,
                perInstanceTextureTiling: false,
                maxInstancesHint: 4096
            });
            _threadMaterial ??= this.meshInstance?._entry?.material ?? null;

            this.edgeMesh = this.meshInstance.group;
            this.getRootGroup().add(this.meshInstance.group);

            this.meshInstance
                .setScale(this.baseScale)
                .setPosition(0, 0, 0)
                .setQuaternion(0, 0, 0, 1);

            this.setThreadMeshVisible(this.threadMeshVisible);
        } catch (e) {
            console.warn("[ThreadView] Failed to create edge mesh:", e.message);
            this.meshInstance = null;
            this.edgeMesh = null;
        }
    }

    getMeshInstance () {
        return this.meshInstance;
    }

    getCollider() {
        this._ensureEdgeMesh();
        if (!this.meshInstance) {
            return null;
        }
        return InputService.createWorldObbFromObject(
            this.meshInstance.group,
            new THREE.Vector3(1, 1, 1)
        );
    }

    show() {
        this.setThreadMeshVisible(this.threadMeshVisible);
    }

    hide() {
        this._ensureEdgeMesh();
        this.meshInstance?.setVisible(false);
    }

    setThreadMeshVisible(visible = true) {
        this.threadMeshVisible = !!visible;
        this._ensureEdgeMesh();

        if (this.threadMeshVisible) {
            this.meshInstance?.setVisible(true);
            this.meshInstance?.markDirty();
            return;
        }

        this.meshInstance?.setVisible(false);
    }

    _scaleToLength(length) {
        if (!this.meshInstance) {
            return;
        }

        const safeLength = Math.max(1e-6, length);

        this.meshInstance
            .setScale(
                this.baseScale.x * safeLength,
                this.baseScale.y,
                this.baseScale.z
            )
            .setTextureTiling(safeLength, 1);
    }

_applyEdgeTransform() {
        if (!this.meshInstance) {
            return;
        }

        this._ensureEdgeMesh();
    
            const group = this.getRootGroup();
    
            // 1. Reset the edge root’s transform so we’re in a known frame
            group.position.set(0, 0, 0);
            group.quaternion.identity();
            group.updateMatrixWorld(true);
    
            // 2. Convert world-space endpoints into this neutral local space
            const from = group.worldToLocal(this._tmpFrom.copy(this.fromPoint));
            const to = group.worldToLocal(this._tmpTo.copy(this.toPoint));
    
            // 3. Compute direction & length in this local space
            const dir = this._tmpDir.subVectors(to, from);
            const length = dir.length();
    
            this._scaleToLength(length);
    
            // 4. Place the edge root at the midpoint
            const mid = this._tmpMid.addVectors(from, to).multiplyScalar(0.5);
            group.position.copy(mid);
    
// 5. Rotate the edge root so its +X axis points from `from` to `to`
        if (dir.lengthSq() > 0 && this.meshInstance) {
            dir.normalize();
            this._tmpQuat.setFromUnitVectors(THREAD_X_AXIS, dir);
            this.meshInstance.setQuaternion(this._tmpQuat);
        }
    }
}

export { ThreadView, THREAD_MATERIAL_CONFIG, applyThreadMaterialConfig };
