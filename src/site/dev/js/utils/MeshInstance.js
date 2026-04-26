import * as THREE from "three";

class MeshInstance {
    /**
     * @param {Object} params
     * @param {THREE.Group} [params.group]  - optional existing group
     * @param {InstanceHandle} params.handle
     * @param {InstancedEntry} params.entry
     */
    constructor({ group, handle, entry }) {
        if (!handle || !entry) {
            throw new Error("MeshInstance requires both handle and entry");
        }

        this.group = group || new THREE.Group();
        this.handle = handle;
        this._entry = entry;

        this._dirty = true;
        this._disposed = false;
        this._localMatrix = new THREE.Matrix4();
    }

    // ----- internal helper -----
    _markDirty() {
        if (this._disposed) return;
        this._dirty = true;
        if (this._entry && this.handle) {
            this._entry.markInstanceDirty(this.handle.index);
        }
    }

    // ----- transform API -----

    setPosition(x, y, z) {
        let isDirty = false;

        if (x.x != null) {
            isDirty = this.group.position.equals(x) === false;
            this.group.position.copy(x);
        }
        else {
            isDirty = (
                x != this.group.position.x ||
                y != this.group.position.y ||
                z != this.group.position.z);
            this.group.position.set(x, y, z);

        }

        if (isDirty) {
            this._markDirty();
        }

        return this;
    }

    setRotation(x, y, z) {
        let isDirty = false;

        if (x.x != null) {
            isDirty = this.group.rotation.equals(x) === false;
            this.group.rotation.copy(x);
        }
        else {
            isDirty = (
                x != this.group.rotation.x ||
                y != this.group.rotation.y ||
                z != this.group.rotation.z);

            this.group.rotation.set(x, y, z);
        }

        if (isDirty) {
            this._markDirty();
        }

        return this;
    }

    setQuaternion(x, y, z, w) {
        let isDirty = false;

        if (x.x != null) {
            isDirty = this.group.quaternion.equals(x) === false;
            this.group.quaternion.copy(x);
        }
        else {
            isDirty = (
                x != this.group.quaternion.x ||
                y != this.group.quaternion.y ||
                z != this.group.quaternion.z ||
                w != this.group.quaternion.w);

            this.group.quaternion.set(x, y, z, w);
        }

        if (isDirty) {
            this._markDirty();
        }

        return this;
    }

    setScale(x, y = x, z = x) {
        let isDirty = false;

        if (x.x != null) {
            isDirty = this.group.scale.equals(x) === false;
            this.group.scale.copy(x);
        }
        else {
            isDirty = (
                x != this.group.scale.x ||
                y != this.group.scale.y ||
                z != this.group.scale.z);

            this.group.scale.set(x, y, z);
        }

        if (isDirty) {
            this._markDirty();
        }

        return this;
    }

    /**
     * Call this if you mutate group.position/rotation/etc directly.
     */
    markDirty() {
        this._markDirty();
        return this;
    }

    // ----- GPU sync -----

    /**
     * Called by InstancedEntry.onBeforeRender to push transform
     * into the InstancedMesh, but only if this instance is dirty.
     */
    syncIfDirty(parentInverseMatrix = null) {
        if (this._disposed || !this._dirty) return;

        this.group.updateWorldMatrix(true, false);

        if (parentInverseMatrix) {
            // instanceMatrix = parent⁻¹ * groupWorld
            this._localMatrix
                .copy(parentInverseMatrix)
                .multiply(this.group.matrixWorld);
            this.handle.setMatrix(this._localMatrix, { deferUpdate: true });
        } else {
            const parent = this._entry.mesh.parent;
            if (parent) {
                this._localMatrix
                    .copy(parent.matrixWorld)
                    .invert()
                    .multiply(this.group.matrixWorld);
                this.handle.setMatrix(this._localMatrix, { deferUpdate: true });
            } else {
                // If the InstancedMesh is at the root with no parent,
                // local == world.
                this.handle.setMatrix(this.group.matrixWorld, { deferUpdate: true });
            }
        }

        this._dirty = false;
    }

    // ----- visibility -----

    setVisible(visible) {
        if (this._disposed) return this;

        this.handle.setVisible(visible);

        return this;
    }

    setShaderParameter(name, data) {
        if (this._disposed) return this;
        this.handle.setAttribute(name, data);
        return this;
    }

    setTextureTiling(x, y = x) {
        if (this._disposed) return this;
        this.handle.setAttribute("instanceTextureTiling", [x, y]);
        return this;
    }

    setColor(r, g, b) {
        if (this._disposed) return this;
        this.handle.setColor(r, g, b);
        return this;
    }

    // ----- disposal -----

    dispose() {
        if (this._disposed) return;
        this._disposed = true;

        if (this.group && this.group.parent) {
            this.group.parent.remove(this.group);
        }

        if (this._entry && this.handle) {
            this._entry.unregisterInstance(this.handle.index);
        }

        if (this.handle && this.handle.release) {
            this.handle.release();
        }

        this.group = null;
        this.handle = null;
        this._entry = null;
    }
}

export { MeshInstance };
