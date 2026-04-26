// AssetPool.js
// ES6, no external libs. Assumes global THREE is available.
import * as THREE from "three";
import { applyTextureProperties } from "./ThreeJSUtils.js"
import { MeshInstance } from "./MeshInstance.js";

const _assetPoolTextureLoader = new THREE.TextureLoader();

const _ASSETPOOL_TEXTURE_PARAM_FIELDS = new Set([
    // generic & widely used
    "map", "alphaMap", "aoMap", "bumpMap", "displacementMap", "emissiveMap",
    "lightMap", "metalnessMap", "normalMap", "roughnessMap", "specularMap",
    "gradientMap",
    // material-specific
    "matcap",   // MeshMatcapMaterial
    "envMap"    // Equirectangular supported via TextureLoader (see mapping below)
]);

class _KeyUtil {
    static makeKey(ctor, params) {
        return `${ctor.name}:${JSON.stringify(this.normalize(params))}`;
    }
    static normalize(value) {
        if (value == null) return value;
        const t = typeof value;

        if (t === 'string' || t === 'number' || t === 'boolean') return value;

        // THREE-specific shapes
        if (value.isColor) return `Color#${value.getHexString()}`;
        if (value.isTexture) return `Texture#${value.uuid || value.id || 'noid'}`;
        if (value.isVector2 ||
            value.isVector3 ||
            value.isVector4) return `${value.type}#${value.toArray().join(',')}`;
        if (value.isEuler) return `Euler#${value.toArray().join(',')}`;
        if (value.isQuaternion) return `Quaternion#${value.toArray().join(',')}`;
        if (value.isMatrix3 ||
            value.isMatrix4) return `${value.type}#${Array.from(value.elements).join(',')}`;
        if (value.isBufferGeometry) return `Geometry#${value.uuid || 'noid'}`;
        if (value.isMaterial) return `Material#${value.uuid || 'noid'}`;

        if (Array.isArray(value)) return value.map(v => this.normalize(v));

        if (t === 'object') {
            const out = {};
            for (const k of Object.keys(value).sort()) {
                const v = value[k];
                if (typeof v === 'function' || typeof v === 'symbol') continue;
                out[k] = this.normalize(v);
            }
            return out;
        }

        return undefined;
    }
}

/* -------------------- MATERIAL POOL -------------------- */

export class MaterialPool {
    static _cache = new Map();       // key -> { material, refCount, key }
    static _rev = new WeakMap();   // material -> entry

    /**
     * Get (or create) a pooled THREE.Material by type + params.
     * `type` can be a string alias or a THREE material constructor.
     * Example: getMaterial('standard', { color: 0x00ff00, roughness: 0.5 })
     */
    static getMaterial(type = 'standard', params = {}) {
        const Ctor = this._resolveCtor(type);
        const key = _KeyUtil.makeKey(Ctor, params);
        const finalParams = { ...params };

        let texturesParam = null;
        if (finalParams["textures"]) {
            texturesParam = finalParams["textures"];
            delete finalParams["textures"];
        }

        let entry = this._cache.get(key);
        if (!entry) {
            const material = new Ctor(finalParams);

            if (texturesParam) {
                MaterialPool._loadAndApply(texturesParam, material);
            }

            entry = { material: material, refCount: 0, key };
            this._cache.set(key, entry);
            this._rev.set(material, entry);
        }

        entry.refCount++;
        return entry.material;
    }

    /** Release a pooled material (decrements refCount; disposes at 0). */
    static release(material) {
        if (!material) return;
        const entry = this._rev.get(material);
        if (!entry) return; // not from this pool or already released

        entry.refCount--;
        if (entry.refCount <= 0) {
            this._disposeMaterial(material);
            this._rev.delete(material);
            this._cache.delete(entry.key);
        }
    }

    /** Dispose EVERYTHING in this pool. */
    static disposeAll() {
        for (const entry of this._cache.values()) {
            this._disposeMaterial(entry.material);
            this._rev.delete(entry.material);
        }
        this._cache.clear();
    }

    // --- internals ---

    static _resolveCtor(type) {
        const T = THREE;
        const map = {
            // Mesh
            standard: T.MeshStandardMaterial,
            physical: T.MeshPhysicalMaterial,
            basic: T.MeshBasicMaterial,
            lambert: T.MeshLambertMaterial,
            phong: T.MeshPhongMaterial,
            toon: T.MeshToonMaterial,
            matcap: T.MeshMatcapMaterial,
            normal: T.MeshNormalMaterial,
            depth: T.MeshDepthMaterial,
            distance: T.MeshDistanceMaterial,
            // Lines / Points / Sprites / Shader
            line: T.LineBasicMaterial,
            lineDashed: T.LineDashedMaterial,
            points: T.PointsMaterial,
            sprite: T.SpriteMaterial,
            shader: T.ShaderMaterial,
        };
        if (typeof type === 'function') return type;
        const Ctor = map[type];
        if (!Ctor) throw new Error(`MaterialPool: unknown material type "${type}"`);
        return Ctor;
    }

    static _disposeMaterial(material) {
        // Dispose any textures on the material (flat or arrays)
        for (const k in material) {
            const v = material[k];
            if (v && v.isTexture && v.dispose) v.dispose();
            if (Array.isArray(v)) {
                for (const item of v) {
                    if (item && item.isTexture && item.dispose) item.dispose();
                }
            }
        }
        material.dispose();
    }

    static _loadAndApply(textureData, material) {
        if (textureData && typeof textureData === "object") {
            for (const [textureName, properties] of Object.entries(textureData)) {
                if (!_ASSETPOOL_TEXTURE_PARAM_FIELDS.has(textureName)) continue;

                if (typeof properties["texture"] !== "string") {
                    if (properties["texture"].length === 0) {
                        continue;
                    }
                }

                _assetPoolTextureLoader.load(
                    properties["texture"],
                    (texture) => {
                        if (textureName === "envMap") {
                            texture.mapping = THREE.EquirectangularReflectionMapping;
                        }

                        texture = applyTextureProperties(texture, properties.params ?? {});

                        material[textureName] = texture;
                        material.needsUpdate = true;

                        if (properties.onLoad) {
                            properties.onLoad(texture);
                            texture.needsUpdate = true;
                        }
                    },
                    undefined,
                    (err) => {
                        console.warn(`[AssetPool] Failed to load texture for ${textureName}:`, properties, err);
                    }
                );
            }
        }
    }
}

/* -------------------- GEOMETRY POOL -------------------- */

export class GeometryPool {
    static _cache = new Map();     // key -> { geometry, refCount, key }
    static _rev = new WeakMap(); // geometry -> entry

    /**
     * Get (or create) a pooled THREE.BufferGeometry by type + params.
     * `type` can be a string alias or a THREE geometry constructor.
     *
     * Common examples:
     *   getGeometry('box',    { width:1, height:1, depth:1, widthSegments:1, heightSegments:1, depthSegments:1 })
     *   getGeometry('sphere', { radius:1, widthSegments:16, heightSegments:12 })
     *   getGeometry(THREE.PlaneGeometry, { width: 10, height: 10, widthSegments: 10, heightSegments: 10 })
     *
     * Advanced escape hatch:
     *   getGeometry('tube',   { args: [path, 64, 1, 8, false] })
     *   getGeometry(THREE.LatheGeometry, { args: [points, 24, 0, Math.PI] })
     */
    static getGeometry(type = 'box', params = {}) {
        const Ctor = this._resolveCtor(type);
        const args = this._ctorArgs(Ctor, params);
        const key = `${Ctor.name}:${JSON.stringify(_KeyUtil.normalize(args))}`;

        let entry = this._cache.get(key);
        if (!entry) {
            const geo = new Ctor(...args);
            entry = { geometry: geo, refCount: 0, key };
            this._cache.set(key, entry);
            this._rev.set(geo, entry);
        }

        entry.refCount++;
        return entry.geometry;
    }

    /** Release a pooled geometry (decrements refCount; disposes at 0). */
    static release(geometry) {
        if (!geometry) return;
        const entry = this._rev.get(geometry);
        if (!entry) return;

        entry.refCount--;
        if (entry.refCount <= 0) {
            geometry.dispose();
            this._rev.delete(geometry);
            this._cache.delete(entry.key);
        }
    }

    /** Dispose EVERYTHING in this pool. */
    static disposeAll() {
        for (const entry of this._cache.values()) {
            entry.geometry.dispose();
            this._rev.delete(entry.geometry);
        }
        this._cache.clear();
    }

    // --- internals ---

    static _resolveCtor(type) {
        const T = THREE;
        const map = {
            box: T.BoxGeometry,
            sphere: T.SphereGeometry,
            plane: T.PlaneGeometry,
            circle: T.CircleGeometry,
            ring: T.RingGeometry,
            cylinder: T.CylinderGeometry,
            cone: T.ConeGeometry,
            torus: T.TorusGeometry,
            torusKnot: T.TorusKnotGeometry,
            dodecahedron: T.DodecahedronGeometry,
            icosahedron: T.IcosahedronGeometry,
            octahedron: T.OctahedronGeometry,
            tetrahedron: T.TetrahedronGeometry,
            capsule: T.CapsuleGeometry,
            lathe: T.LatheGeometry,
            tube: T.TubeGeometry,  // requires a Curve for path -> use params.args
            wireframe: T.WireframeGeometry, // expects geometry in args
            edges: T.EdgesGeometry,     // expects geometry in args
        };
        if (typeof type === 'function') return type;
        const Ctor = map[type];
        if (!Ctor) throw new Error(`GeometryPool: unknown geometry type "${type}"`);
        return Ctor;
    }

    // Build constructor arg lists from a friendly params object.
    // For complex cases, pass params.args = [ ... ] to bypass mapping.
    static _ctorArgs(Ctor, p) {
        if (Array.isArray(p.args)) return p.args.slice(); // escape hatch

        const TWO_PI = Math.PI * 2;
        switch (Ctor) {
            case THREE.BoxGeometry:
                return [
                    p.width ?? 1, p.height ?? 1, p.depth ?? 1,
                    p.widthSegments ?? 1, p.heightSegments ?? 1, p.depthSegments ?? 1
                ];
            case THREE.SphereGeometry:
                return [
                    p.radius ?? 1, p.widthSegments ?? 16, p.heightSegments ?? 12,
                    p.phiStart ?? 0, p.phiLength ?? TWO_PI,
                    p.thetaStart ?? 0, p.thetaLength ?? Math.PI
                ];
            case THREE.PlaneGeometry:
                return [
                    p.width ?? 1, p.height ?? 1,
                    p.widthSegments ?? 1, p.heightSegments ?? 1
                ];
            case THREE.CircleGeometry:
                return [
                    p.radius ?? 1, p.segments ?? 8,
                    p.thetaStart ?? 0, p.thetaLength ?? TWO_PI
                ];
            case THREE.RingGeometry:
                return [
                    p.innerRadius ?? 0.5, p.outerRadius ?? 1,
                    p.thetaSegments ?? 8, p.phiSegments ?? 1,
                    p.thetaStart ?? 0, p.thetaLength ?? TWO_PI
                ];
            case THREE.CylinderGeometry:
                return [
                    p.radiusTop ?? 1, p.radiusBottom ?? 1, p.height ?? 1,
                    p.radialSegments ?? 8, p.heightSegments ?? 1,
                    p.openEnded ?? false,
                    p.thetaStart ?? 0, p.thetaLength ?? TWO_PI
                ];
            case THREE.ConeGeometry:
                return [
                    p.radius ?? 1, p.height ?? 1,
                    p.radialSegments ?? 8, p.heightSegments ?? 1,
                    p.openEnded ?? false, p.thetaStart ?? 0, p.thetaLength ?? TWO_PI
                ];
            case THREE.TorusGeometry:
                return [
                    p.radius ?? 1, p.tube ?? 0.4,
                    p.radialSegments ?? 8, p.tubularSegments ?? 6,
                    p.arc ?? TWO_PI
                ];
            case THREE.TorusKnotGeometry:
                return [
                    p.radius ?? 1, p.tube ?? 0.4,
                    p.tubularSegments ?? 64, p.radialSegments ?? 8,
                    p.p ?? 2, p.q ?? 3
                ];
            case THREE.DodecahedronGeometry:
            case THREE.IcosahedronGeometry:
            case THREE.OctahedronGeometry:
            case THREE.TetrahedronGeometry:
                return [p.radius ?? 1, p.detail ?? 0];
            case THREE.CapsuleGeometry:
                return [
                    p.radius ?? 1, p.length ?? 1,
                    p.capSegments ?? 4, p.radialSegments ?? 8
                ];
            case THREE.LatheGeometry:
                // points: Array<Vector2> REQUIRED for useful shape
                return [
                    p.points ?? [], p.segments ?? 12,
                    p.phiStart ?? 0, p.phiLength ?? TWO_PI
                ];
            case THREE.TubeGeometry:
                // path: THREE.Curve REQUIRED — must supply via args or p.path
                if (p.path) {
                    return [
                        p.path, p.tubularSegments ?? 64,
                        p.radius ?? 1, p.radialSegments ?? 8,
                        p.closed ?? false
                    ];
                }
                // Fallthrough to args escape hatch if no path
                return p.args ? p.args.slice() : (() => { throw new Error('TubeGeometry requires params.path or params.args'); })();
            case THREE.WireframeGeometry:
            case THREE.EdgesGeometry:
                if (!p.geometry && !p.args) {
                    throw new Error(`${Ctor.name} requires params.geometry or params.args`);
                }
                return p.args ? p.args.slice() : [p.geometry, p.thresholdAngle ?? undefined].filter(v => v !== undefined);
            default:
                // If we missed a type, allow direct args as an escape.
                if (p.args) return p.args.slice();
                throw new Error(`GeometryPool: no arg mapper for ${Ctor.name}. Use params.args.`);
        }
    }
}
// -----------------------------------------------------------------------------
// InstancedEntry / InstanceHandle / InstancedMeshPool
// -----------------------------------------------------------------------------

const shownMatrix = new THREE.Matrix4();
const hiddenMatrix = new THREE.Matrix4().makeScale(0, 0, 0);

class InstancedEntry {
    constructor(key, mesh, maxCount, geometry, material, customAttributes = [], hideOnCreation = true, trimRenderedInstances = false) {
        this.key = key;
        this.mesh = mesh;
        this.maxCount = maxCount;
        this.geometry = geometry;
        this.material = material;
        this.customAttributes = customAttributes;
        this.trimRenderedInstances = trimRenderedInstances;

        this._freeList = [];
        for (let i = maxCount - 1; i >= 0; i--) {
            this._freeList.push(i);
        }

        this._instances = new Array(maxCount).fill(null);
        this._activeSlots = new Uint8Array(maxCount);
        this._highestActiveIndex = -1;
        this.mesh.count = 0;

        if (hideOnCreation) {
            for (let i = 0; i < maxCount; i++) {
                mesh.setMatrixAt(i, hiddenMatrix);
            }
        }

        this._dirtyIndices = new Set();
        this._refCount = 0;
        this._parentInverseMatrix = new THREE.Matrix4();

        this._setupOnBeforeRender();
    }

    _syncRenderCount() {
        this.mesh.count = this.trimRenderedInstances
            ? this._highestActiveIndex + 1
            : this.maxCount;
    }

    allocateIndex() {
        if (this._freeList.length === 0) {
            throw new Error(
                `InstancedEntry[${this.key}]: out of instance slots (max=${this.maxCount})`
            );
        }
        const idx = this._freeList.pop();
        this._refCount++;
        this._activeSlots[idx] = 1;
        if (idx > this._highestActiveIndex) {
            this._highestActiveIndex = idx;
        }
        this._syncRenderCount();

        return idx;
    }

    releaseIndex(index) {
        if (index == null || index < 0 || index >= this.maxCount) return;

        this._instances[index] = null;
        this._dirtyIndices.delete(index);
        this._freeList.push(index);
        this._refCount--;
        this._activeSlots[index] = 0;

        if (index === this._highestActiveIndex) {
            while (this._highestActiveIndex >= 0 && this._activeSlots[this._highestActiveIndex] === 0) {
                this._highestActiveIndex--;
            }
        }

        this._syncRenderCount();
    }

    registerInstance(index, meshInstance) {
        this._instances[index] = meshInstance;
    }

    unregisterInstance(index) {
        if (index == null || index < 0 || index >= this.maxCount) return;
        this._instances[index] = null;
        this._dirtyIndices.delete(index);
    }

    markInstanceDirty(index) {
        if (index == null || index < 0 || index >= this.maxCount) return;
        if (this._instances[index]) {
            this._dirtyIndices.add(index);
        }
    }

    setInstanceAttribute(index, name, data) {
        const attr = this.mesh.geometry.attributes[name];
        if (!attr) {
            return;
        }

        const size = attr.itemSize;
        const offset = index * size;

        if (Array.isArray(data) || ArrayBuffer.isView(data)) {
            for (let i = 0; i < size; i++) {
                attr.array[offset + i] = data[i];
            }
        } else {
            // Single value
            attr.array[offset] = data;
        }
        attr.needsUpdate = true;
    }

    setInstanceColor(index, color) {
        if (!this.mesh.instanceColor) {
            return;
        }

        const array = this.mesh.instanceColor.array;
        const offset = index * 3;

        array[offset] = color.r;
        array[offset + 1] = color.g;
        array[offset + 2] = color.b;
        this.mesh.instanceColor.needsUpdate = true;
    }

    _setupOnBeforeRender() {
        const entry = this;

        this.mesh.onBeforeRender = function () {
            if (entry._dirtyIndices.size === 0) return;

            let parentInverse = null;
            const parent = entry.mesh.parent;
            if (parent) {
                parent.updateWorldMatrix(true, false);
                parentInverse = entry._parentInverseMatrix.copy(parent.matrixWorld).invert();
            }

            for (const idx of entry._dirtyIndices) {
                const inst = entry._instances[idx];
                if (inst) {
                    inst.syncIfDirty(parentInverse);
                }
            }

            if (entry._dirtyIndices.size > 0) {
                entry.mesh.instanceMatrix.needsUpdate = true;
            }

            entry._dirtyIndices.clear();
        };
    }
}

class InstanceHandle {
    constructor(entry, index) {
        this._entry = entry;
        this.index = index;
        this.mesh = entry.mesh;
        this._visible = true;
        this._released = false;
    }

    setMatrix(matrix4, { deferUpdate = false } = {}) {
        if (this._released) return;
        this.mesh.setMatrixAt(this.index, matrix4);
        if (!deferUpdate) {
            this.mesh.instanceMatrix.needsUpdate = true;
        }
        this._visible = matrix4 === hiddenMatrix;
    }

    setVisible(visible) {
        this.setMatrix(
            visible ?
                shownMatrix :
                hiddenMatrix
        )
    }

    setAttribute(name, data) {
        if (this._released) return;
        this._entry.setInstanceAttribute(this.index, name, data);
    }

    setColor(r, g, b) {
        if (this._released) return;

        const color =
            r && r.isColor
                ? r
                : { r, g, b };

        this._entry.setInstanceColor(this.index, color);
    }

    release() {
        if (this._released) return;
        this._released = true;
        this._entry.releaseIndex(this.index);

        this.setMatrix(hiddenMatrix);
    }
}

function _patchMaterialForPerInstanceTextureTiling(material, attributeName = "instanceTextureTiling") {
    if (!material || material.userData.__perInstanceTextureTilingPatched) return;

    const previousOnBeforeCompile = material.onBeforeCompile;
    const previousCustomProgramCacheKey = material.customProgramCacheKey;

    material.onBeforeCompile = (shader, renderer) => {
        if (typeof previousOnBeforeCompile === "function") {
            previousOnBeforeCompile(shader, renderer);
        }

        shader.vertexShader =
            `
#ifdef USE_INSTANCING
attribute vec2 ${attributeName};
#endif
varying vec2 vInstanceTextureTiling;
` + shader.vertexShader;

        shader.vertexShader = shader.vertexShader.replace(
            "#include <uv_vertex>",
            `
#include <uv_vertex>
#ifdef USE_INSTANCING
vInstanceTextureTiling = ${attributeName};
#else
vInstanceTextureTiling = vec2(1.0, 1.0);
#endif
`
        );

        shader.fragmentShader =
            `
varying vec2 vInstanceTextureTiling;
` + shader.fragmentShader;

        shader.fragmentShader = shader.fragmentShader.replace(
    "#include <map_fragment>",
    `
#ifdef USE_MAP
	vec4 sampledDiffuseColor = texture2D( map, vMapUv * vInstanceTextureTiling );
	#ifdef DECODE_VIDEO_TEXTURE
		sampledDiffuseColor = sRGBTransferEOTF( sampledDiffuseColor );
	#endif
	diffuseColor *= sampledDiffuseColor;
#endif
`
);
    };

    material.customProgramCacheKey = () => {
        const previousKey =
            typeof previousCustomProgramCacheKey === "function"
                ? previousCustomProgramCacheKey.call(material)
                : "";

        return `${previousKey}|perInstanceTextureTiling:${attributeName}`;
    };

    material.userData.__perInstanceTextureTilingPatched = true;
    material.needsUpdate = true;
}

export class InstancedMeshPool {
    static _entries = new Map();

    static _defaultParent = null;

    // Helper to generate the Material portion of the key
    static _getMaterialKey(matType, matParams, materialInstance) {
        // 1. If a direct instance is provided, use its UUID.
        // This ensures distinct materials get distinct InstancedMeshes.
        if (materialInstance && materialInstance.isMaterial) {
            return `Instance:${materialInstance.uuid}`;
        }

        // 2. Otherwise, use the factory signature (Type + Params)
        const mTypeKey = typeof matType === "string" ? matType : (matType && matType.name) || "null";
        const mParamsKey = JSON.stringify(_KeyUtil.normalize(matParams || {}));
        return `${mTypeKey}|${mParamsKey}`;
    }

    static _makeKey({ geomType, geomParams, matKey, customAttributes = [], renderOrder = 0, perInstanceColor = false, trimRenderedInstances = false }) {
        // Geometry Key
        const gTypeKey = typeof geomType === "string" ? geomType : (geomType && geomType.name) || "null";
        const gParamsKey = JSON.stringify(_KeyUtil.normalize(geomParams || {}));
        const attrsKey = JSON.stringify(
            customAttributes.map((attr) => ({ name: attr.name, size: attr.size }))
        );
        const baseKey = `${gTypeKey}|${gParamsKey}|${matKey}|${attrsKey}|ro:${renderOrder}|ic:${perInstanceColor ? 1 : 0}|tri:${trimRenderedInstances ? 1 : 0}`;

        return baseKey;
    }

    static setDefaultParent(parent) {
        InstancedMeshPool._defaultParent = parent;
    }

    /**
     * Get (or create) an InstancedEntry for this (geom, mat) combo
     * and allocate a new instance slot.
     *
     * Returns { handle, entry }.
     */
    static acquireInstance({
        geomType,
        geomParams = {},
        matType,
        matParams = {},
        material,
        parent = null,
        maxInstancesHint = 1024,
        customAttributes = [],
        hideOnCreation = true,
        trimRenderedInstances = false,
        perInstanceTextureTiling = false,
        perInstanceColor = false,
        renderOrder = 0
    }) {
        const finalCustomAttributes = [...customAttributes];
        if (perInstanceTextureTiling && !finalCustomAttributes.some((attr) => attr.name === "instanceTextureTiling")) {
            finalCustomAttributes.push({ name: "instanceTextureTiling", size: 2 });
        }

        // 1. Resolve the Material Key component
        const matKey = this._getMaterialKey(matType, matParams, material);

        // 2. Generate the full Cache Key
        const key = this._makeKey({
            geomType,
            geomParams,
            matKey,
            customAttributes: finalCustomAttributes,
            renderOrder,
            perInstanceColor,
            trimRenderedInstances
        });

        let entry = this._entries.get(key);

        if (!entry) {
            // Geometry Resolution
            let geometry = GeometryPool.getGeometry(geomType, geomParams);

            // Material Resolution
            // If 'material' was passed (Option B), use it. 
            // Otherwise ask MaterialPool (Option A).
            let finalMaterial = material || MaterialPool.getMaterial(matType, matParams);

            if (perInstanceTextureTiling) {
                _patchMaterialForPerInstanceTextureTiling(finalMaterial);
            }

            // Geometry Cloning for Custom Attributes
            if (finalCustomAttributes.length > 0) {
                geometry = geometry.clone();
                for (const attrDef of finalCustomAttributes) {
                    const buffer = new Float32Array(maxInstancesHint * attrDef.size);
                    const instAttr = new THREE.InstancedBufferAttribute(buffer, attrDef.size);
                    instAttr.setUsage(THREE.DynamicDrawUsage);
                    geometry.setAttribute(attrDef.name, instAttr);
                }
            }

            const mesh = new THREE.InstancedMesh(geometry, finalMaterial, maxInstancesHint);
            mesh.frustumCulled = false;
            mesh.renderOrder = renderOrder;

            if (mesh.instanceMatrix && mesh.instanceMatrix.setUsage) {
                mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
            }

            if (perInstanceColor) {
                mesh.instanceColor = new THREE.InstancedBufferAttribute(
                    new Float32Array(maxInstancesHint * 3),
                    3
                );
                mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
            }

            const p = parent || InstancedMeshPool._defaultParent;
            if (p) {
                p.add(mesh);
            } else {
                console.warn("[AssetPool] InstancedMesh created without parent (will be invisible).");
            }

            entry = new InstancedEntry(
                key,
                mesh,
                maxInstancesHint,
                geometry,
                finalMaterial,
                finalCustomAttributes,
                hideOnCreation,
                trimRenderedInstances
            );
            this._entries.set(key, entry);
        }

        const index = entry.allocateIndex();
        const handle = new InstanceHandle(entry, index);

        if (entry.mesh.geometry.attributes.instanceTextureTiling) {
            handle.setAttribute("instanceTextureTiling", [1, 1]);
        }

        if (entry.mesh.instanceColor) {
            handle.setColor(1, 1, 1);
        }

        return { handle, entry };
    }

    /**
     * Optional helper for unloading everything (e.g., changing scenes).
     */
    static disposeAll() {
        for (const [key, entry] of this._entries) {
            if (entry.mesh.parent) {
                entry.mesh.parent.remove(entry.mesh);
            }
            entry.mesh.dispose();

            GeometryPool.release(entry.geometry);
            MaterialPool.release(entry.material);
        }
        this._entries.clear();
    }
}

export function createPooledMesh(geomTypeOrOptions, geomParams, matType, matParams) {
    // ----- options object path -----
    if (
        typeof geomTypeOrOptions === "object" &&
        geomTypeOrOptions !== null &&
        ("geomType" in geomTypeOrOptions)
    ) {
        const {
            geomType,
            geomParams: gParams = {},
            matType,
            matParams: mParams = {},
            material = null,
            instanced = false,
            parent = null,
            maxInstancesHint = 1024,
            customAttributes = [],
            trimRenderedInstances = false,
            perInstanceTextureTiling = false,
            perInstanceColor = false,
            renderOrder = 0
        } = geomTypeOrOptions;

        if (!instanced) {
            // Non-instanced, but using options object
            const geometry = GeometryPool.getGeometry(geomType, gParams);
            const finalMaterial = material || MaterialPool.getMaterial(matType, mParams);
            const mesh = new THREE.Mesh(geometry, finalMaterial);

            mesh.dispose = function disposePooledMesh() {
                GeometryPool.release(this.geometry);
                if (!material) {
                    MaterialPool.release(this.material);
                }
            };

            return mesh;
        }

        // ----- instanced path -----
        const { handle, entry } = InstancedMeshPool.acquireInstance({
            geomType,
            geomParams: gParams,
            matType,
            matParams: mParams,
            material,
            parent,
            maxInstancesHint,
            customAttributes,
            trimRenderedInstances,
            perInstanceTextureTiling,
            perInstanceColor,
            renderOrder
        });

        const group = new THREE.Group();
        const meshInstance = new MeshInstance({ group, handle, entry });

        // Let the entry know about this MeshInstance so it can sync it in onBeforeRender
        entry.registerInstance(handle.index, meshInstance);

        return meshInstance;
    }

    const geometry = GeometryPool.getGeometry(geomTypeOrOptions, geomParams);
    const material = MaterialPool.getMaterial(matType, matParams);
    const mesh = new THREE.Mesh(geometry, material);

    mesh.dispose = function disposePooledMesh() {
        GeometryPool.release(this.geometry);
        MaterialPool.release(this.material);
    };

    return mesh;
}

export function disposeAll() {
    GeometryPool.disposeAll();
    MaterialPool.disposeAll();
    InstancedMeshPool.disposeAll();
}
