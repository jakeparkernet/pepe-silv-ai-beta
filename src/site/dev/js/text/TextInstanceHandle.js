export class TextInstanceHandle {
    constructor({ layer, entry, glyphIndices, textIndex }) {
        this._layer = layer;
        this._entry = entry;
        this._glyphIndices = glyphIndices; // shared array reference
        this.index = textIndex;
        this._released = false;
        this._instance = null; // will be attached after SDFTextInstance is created
    }

    attachInstance(instance) {
        this._instance = instance;
    }

    setMatrix(worldMatrix) {
        if (this._released) return;
        const mesh = this._entry.mesh;
        for (const idx of this._glyphIndices) {
            mesh.setMatrixAt(idx, worldMatrix);
        }
        mesh.instanceMatrix.needsUpdate = true;
    }

    setVisible(vis) {
        if (this._released) return;
        const v = vis ? 1 : 0;
        for (const idx of this._glyphIndices) {
            this._entry.setInstanceAttribute(idx, "aInstanceVisible", v);
        }
    }

    release() {
        if (this._released) return;
        this._released = true;

        if (this._instance) {
            this._layer._disposeTextInstance(this._instance, { fromHandle: true });
            this._instance = null;
        }
    }
}
