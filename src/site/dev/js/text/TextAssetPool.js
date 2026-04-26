import { makeGlyphQuadGeometry } from "./makeGlyphQuadGeometry.js";
import { SDFTextMaterialReference } from "./SDFTextMaterialReference.js";
import { InstancedMesh, InstancedBufferAttribute, Matrix4 } from "three";

class TextAssetPool {

    constructor() {
        this.geometries = {};   // styleKey → shared quad geometry
        this.materials = {};    // styleKey → shared SDF material
        this.meshes = {};       // meshId → InstancedMesh instance
        this._meshIdCounter = 1;
    }

    /**
     * Register a text style.
     * Creates shared quad geometry + SDF material for that style.
     */
    registerStyle(styleKey, params) {
        if (!this.geometries[styleKey]) {
            this.geometries[styleKey] = makeGlyphQuadGeometry();
        }
        if (!this.materials[styleKey]) {
            this.materials[styleKey] = new SDFTextMaterialReference(params).getMaterial();
        }
    }

    /**
     * Create a new InstancedMesh for a specific text object.
     * Returns a meshId.
     */
    createTextMesh(styleKey, glyphCount) {
        const quad = this.geometries[styleKey];
        const material = this.materials[styleKey];
        const meshId = this._meshIdCounter++;

        const mesh = new InstancedMesh(quad, material, glyphCount);

        // Initialize instance matrices
        const dummy = new Matrix4();
        for (let i = 0; i < glyphCount; i++) {
            mesh.setMatrixAt(i, dummy);
        }

        // Add the glyph-level instanced attributes
        mesh.geometry.setAttribute(
            "aGlyphPos",
            new InstancedBufferAttribute(new Float32Array(glyphCount * 2), 2)
        );

        mesh.geometry.setAttribute(
            "aGlyphScale",
            new InstancedBufferAttribute(new Float32Array(glyphCount * 2), 2)
        );

        mesh.geometry.setAttribute(
            "aGlyphUVRect",
            new InstancedBufferAttribute(new Float32Array(glyphCount * 4), 4)
        );

        mesh.geometry.setAttribute(
            "aInstanceVisible",
            new InstancedBufferAttribute(new Float32Array(glyphCount), 1)
        );

        this.meshes[meshId] = mesh;
        return meshId;
    }

    /**
     * Update the instanced attributes of the mesh for new glyph layout data.
     */
    updateTextMesh(meshId, glyphs) {
        const mesh = this.meshes[meshId];
        if (!mesh) return;

        const posAttr = mesh.geometry.getAttribute("aGlyphPos");
        const scaleAttr = mesh.geometry.getAttribute("aGlyphScale");
        const uvAttr = mesh.geometry.getAttribute("aGlyphUVRect");
        const visAttr = mesh.geometry.getAttribute("aInstanceVisible");

        for (let i = 0; i < glyphs.length; i++) {
            const g = glyphs[i];
            posAttr.setXY(i, g.x, g.y);
            scaleAttr.setXY(i, g.w, g.h);

            posAttr.setXY(i, i * 0.1, 0);
            scaleAttr.setXY(i, 0.1, 0.1);

            uvAttr.setXYZW(i, g.u0, g.v0, g.u1, g.v1);
            visAttr.setX(i, g.visible ? 1 : 0);
        }

        posAttr.needsUpdate =
            scaleAttr.needsUpdate =
            uvAttr.needsUpdate =
            visAttr.needsUpdate = true;

        mesh.instanceMatrix.needsUpdate = true;

    }

    /**
     * Free GPU memory for a text object.
     */
    disposeTextMesh(meshId) {
        const mesh = this.meshes[meshId];
        if (!mesh) return;

        mesh.geometry.dispose();
        mesh.material.dispose();
        delete this.meshes[meshId];
    }

    /**
     * Retrieve the InstancedMesh object for adding to your scene.
     */
    getMesh(meshId) {
        return this.meshes[meshId];
    }
}

export { TextAssetPool };