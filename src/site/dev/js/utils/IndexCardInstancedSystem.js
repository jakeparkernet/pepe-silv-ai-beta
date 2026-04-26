import * as THREE from "three";
import { IndexCardStripGenerator } from "./IndexCardStripGenerator.js";
class IndexCardInstancedSystem {
    /**
     * Manages:
     * - One InstancedMesh of index cards
     * - Per-instance UV transforms into the shared atlas
     */
    constructor({
        atlasManager,
        cardWidth = 1,
        cardHeight = 0.6,
        materialOptions = {},
    }) {
        this.atlasManager = atlasManager;

        const { atlasCanvas, maxSlots } = atlasManager;

        // Create CanvasTexture from atlas
        this.atlasTexture = new THREE.CanvasTexture(atlasCanvas);
        this.atlasTexture.flipY = false;         // 👈 important
        this.atlasTexture.needsUpdate = true;
        this.atlasTexture.minFilter = THREE.LinearMipMapLinearFilter;
        this.atlasTexture.magFilter = THREE.LinearFilter;
        this.atlasTexture.wrapS = THREE.ClampToEdgeWrapping;
        this.atlasTexture.wrapT = THREE.ClampToEdgeWrapping;
        this.atlasTexture.needsUpdate = true;

        // Base plane geometry
        this.geometry = new THREE.PlaneGeometry(cardWidth, cardHeight);

        // Instanced UV transform buffer
        // (uOffset, vOffset, uScale, vScale) per instance
        this.uvArray = new Float32Array(maxSlots * 4);
        this.uvTransformAttr = new THREE.InstancedBufferAttribute(this.uvArray, 4);
        this.geometry.setAttribute('instanceUVTransform', this.uvTransformAttr);

        // Shared PBR material
        this.material = new THREE.MeshStandardMaterial({
            map: this.atlasTexture,
            roughness: 0.9,
            metalness: 0.0,
            ...materialOptions,
        });

        // Patch shader for per-instance UV transform
        this.material.onBeforeCompile = (shader) => {
            // --- 1. Add our varying + attribute declarations ---
            shader.vertexShader =
                `
    varying vec2 vUvAtlas;
    attribute vec4 instanceUVTransform;
    ` + shader.vertexShader;

            shader.fragmentShader =
                `
    varying vec2 vUvAtlas;
    ` + shader.fragmentShader;

            // --- 2. Compute vUvAtlas in the vertex shader ---
            // instanceUVTransform = (uOffset, vOffset, uScale, vScale)
            shader.vertexShader = shader.vertexShader.replace(
                'void main() {',
                `
    void main() {
      // Base UV directly from attribute
      vec2 baseUv = uv;

      // We only care about vertical variation; U is uniform across the strip.
      float uCenter = instanceUVTransform.x + 0.5 * instanceUVTransform.z;
      float vMapped = instanceUVTransform.y + baseUv.y * instanceUVTransform.w;

      vUvAtlas = vec2(0, 0.1);
    `
            );

            // --- 3. Use vUvAtlas for the base map sampling in the fragment shader ---
            shader.fragmentShader = shader.fragmentShader.replace(
                'vec4 texelColor = texture2D( map, vUv );',
                'vec4 texelColor = texture2D( map, vUvAtlas );'
            );
        };

        // Instanced mesh with max capacity; start with 0 visible instances
        this.mesh = new THREE.InstancedMesh(this.geometry, this.material, maxSlots);
        this.mesh.count = 0;

        this._dummy = new THREE.Object3D();
    }

    /**
     * Internal: set UV transform for one rect/index
     */
    _setUVForRect(rect) {
        const { u0, v0, u1, v1, index } = rect;
        const offsetU = u0;
        const offsetV = v0;
        const scaleU = u1 - u0;
        const scaleV = v1 - v0;

        const baseIndex = index * 4;
        this.uvArray[baseIndex + 0] = offsetU;
        this.uvArray[baseIndex + 1] = offsetV;
        this.uvArray[baseIndex + 2] = scaleU;
        this.uvArray[baseIndex + 3] = scaleV;
        this.uvTransformAttr.needsUpdate = true;
    }

    /**
     * Public: add a new index card instance
     * stripOptions: passed to IndexCardStripGenerator.createStrip
     * position: THREE.Vector3
     * rotation: THREE.Euler
     * scale:    THREE.Vector3
     */
    addCard(stripOptions, position, rotation, scale) {
        const atlas = this.atlasManager;
        if (atlas.getCount() >= atlas.maxSlots) {
            console.warn('IndexCardInstancedSystem: atlas full, cannot add more cards');
            return null;
        }

        const strip = IndexCardStripGenerator.createStrip({
            height: atlas.stripHeight,
            ...stripOptions,
        });

        const rect = atlas.addStrip(strip);

        // Update texture on GPU
        this.atlasTexture.needsUpdate = true;

        // Update UV transform for this instance
        this._setUVForRect(rect);

        // Instance transform
        const index = rect.index;
        const dummy = this._dummy;
        dummy.position.copy(position || new THREE.Vector3());
        dummy.rotation.copy(rotation || new THREE.Euler());
        dummy.scale.copy(scale || new THREE.Vector3(1, 1, 1));
        dummy.updateMatrix();
        this.mesh.setMatrixAt(index, dummy.matrix);
        this.mesh.instanceMatrix.needsUpdate = true;

        // Increase visible count if needed
        if (index + 1 > this.mesh.count) {
            this.mesh.count = index + 1;
        }

        return index;
    }
}

export { IndexCardInstancedSystem };