import { View } from "./View.js";
import * as THREE from "three";
import { createPooledMesh } from "../utils/AssetPool.js";

class EdgeView extends View {
    constructor(params = {}) {
        super();

        this.generateEdgeMesh = this.generateEdgeMesh.bind(this);

        this.id = params.id || crypto.randomUUID();

        this.fromPoint = new THREE.Vector3();
        this.toPoint = new THREE.Vector3();
        this.edgeMesh = null;
    }

    setEdge(edge) {
        this.edge = edge;
    }

    setEndpoints(fromPoint, toPoint) {
        this.fromPoint.copy(fromPoint);
        this.toPoint.copy(toPoint);

        this._applyEdgeTransform();

        this.update();
    }

    generateEdgeMesh() {
        try {
            const geometryParams = { width: 1, height: 1 };
            this.edgeMesh = createPooledMesh("plane", geometryParams);
            this.getRootGroup().add(this.edgeMesh);
        } catch (e) {
            console.warn("[EdgeView] Failed to create edge mesh:", e.message);
            this.edgeMesh = null;
        }
    }

    _ensureEdgeMesh() {
        if (this.edgeMesh == null) {
            this.generateEdgeMesh();
        }
    }

    getEdgeMesh() {
        this._ensureEdgeMesh();
        return this.edgeMesh;
    }

    _scaleToLength(length) {
        if (!this.edgeMesh) {
            return;
        }

        const minLength = 1e-6;
        const L = Math.max(minLength, length);

        this.edgeMesh.scale.set(L, 1, 1);
    }

    _applyEdgeTransform() {
        if (!this.edgeMesh) {
            return;
        }

        const group = this.getRootGroup();

        // 1. Reset the edge root’s transform so we’re in a known frame
        group.position.set(0, 0, 0);
        group.quaternion.identity();
        group.updateMatrixWorld(true);

        // 2. Convert world-space endpoints into this neutral local space
        const from = group.worldToLocal(this.fromPoint.clone());
        const to = group.worldToLocal(this.toPoint.clone());

        // 3. Compute direction & length in this local space
        const dir = new THREE.Vector3().subVectors(to, from);
        const length = dir.length();

        this._scaleToLength(length);

        // 4. Place the edge root at the midpoint
        const mid = new THREE.Vector3().addVectors(from, to).multiplyScalar(0.5);
        group.position.copy(mid);

        // 5. Rotate the edge root so its +X axis points from `from` to `to`
        const xAxis = new THREE.Vector3(1, 0, 0);
        if (dir.lengthSq() > 0) {
            dir.normalize();
            const q = new THREE.Quaternion().setFromUnitVectors(xAxis, dir);
            group.quaternion.copy(q);
        }
    }
}

export { EdgeView };
