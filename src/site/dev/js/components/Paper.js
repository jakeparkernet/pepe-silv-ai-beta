// import { createPooledMesh } from "../utils/AssetPool.js";
import * as THREE from "three";
// import { getTiltQuaternion } from "../utils/getTiltQuaternion.js";
// 
const appModules = window[`apps_${performance.timeOrigin}`].modules;
const { createPooledMesh } = appModules.utils.AssetPool;
const { getTiltQuaternion } = appModules.utils.getTiltQuaternion;

const PAPER_TEXTURE_PATHS = [
    "resources/handmade-paper-tiling.jpg",
    "resources/handmade-paper-with-subtle-elements-tiling.jpg",
    "resources/white-paper-with-fibers-tiling.jpg",
    "resources/old-white-paper-used-by-rubens-tiling.jpg",
    "resources/paper-crumbled-tiling.jpg",
    "resources/plain-white-paper-tiling.jpg",
    "resources/uneven-white-handmade-paper-tiling.jpg",
    "resources/rough-paper-tiling.jpg",
    "resources/handmade-white-paper-with-fibers-tiling.jpg",
    "resources/subtle-white-paper-tiling.jpg"
];

const PAPER_TEXTURE_INTENSITY_RANGE = {
    min: 0.18,
    max: 0.92
};

const _paperTextureLoader = new THREE.TextureLoader();

let _paperPlaceholderTexture = null;
let _paperTextures = null;
let _paperTexturesRequested = false;
let _paperMaterial = null;
const PAPER_MATERIAL_CONFIG = {
    color: 0xffffff,
    roughness: 0.62,
    metalness: 0.0,
    tintAmount: 0.0
};

function getPaperPlaceholderTexture() {
    if (_paperPlaceholderTexture != null) {
        return _paperPlaceholderTexture;
    }

    const data = new Uint8Array([255, 255, 255, 255]);
    const texture = new THREE.DataTexture(data, 1, 1, THREE.RGBAFormat);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.needsUpdate = true;
    _paperPlaceholderTexture = texture;
    return _paperPlaceholderTexture;
}

function configurePaperTexture(texture) {
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.needsUpdate = true;
    return texture;
}

function getPaperTextures() {
    if (_paperTextures == null) {
        _paperTextures = PAPER_TEXTURE_PATHS.map(() => getPaperPlaceholderTexture());
    }

    if (_paperTexturesRequested) {
        return _paperTextures;
    }

    _paperTexturesRequested = true;

    PAPER_TEXTURE_PATHS.forEach((path, index) => {
        _paperTextureLoader.load(
            path,
            (texture) => {
                _paperTextures[index] = configurePaperTexture(texture);

                if (_paperMaterial?.userData?.__paperShaderRefs) {
                    for (const shader of _paperMaterial.userData.__paperShaderRefs) {
                        shader.uniforms[`paperTexture${index}`].value = _paperTextures[index];
                    }
                }
            },
            undefined,
            (error) => {
                console.warn(`[Paper] Failed to load texture: ${path}`, error);
            }
        );
    });

    return _paperTextures;
}

function patchPaperMaterial(material) {
    if (material.userData.__paperTexturePatched) {
        return material;
    }

    const previousOnBeforeCompile = material.onBeforeCompile;
    const previousCustomProgramCacheKey = material.customProgramCacheKey;
    material.userData.__paperShaderRefs = [];

    material.onBeforeCompile = (shader, renderer) => {
        if (typeof previousOnBeforeCompile === "function") {
            previousOnBeforeCompile(shader, renderer);
        }

        const shaderRefs = material.userData.__paperShaderRefs;
        if (!shaderRefs.includes(shader)) {
            shaderRefs.push(shader);
        }

        shader.uniforms.paperTintAmount = { value: PAPER_MATERIAL_CONFIG.tintAmount };

        const textureUniformBlock = getPaperTextures()
            .map((texture, index) => {
                shader.uniforms[`paperTexture${index}`] = { value: texture };
                return `uniform sampler2D paperTexture${index};`;
            })
            .join("\n");

        const sampleFunction = `
vec4 samplePaperTexture(vec2 uv, float textureIndex) {
    int paperTextureIndex = int(floor(textureIndex + 0.5));
    ${PAPER_TEXTURE_PATHS.map((_, index) => {
        const prefix = index === 0 ? "if" : "else if";
        return `${prefix} (paperTextureIndex == ${index}) return texture2D(paperTexture${index}, uv);`;
    }).join("\n    ")}
    return texture2D(paperTexture0, uv);
}
`;

        shader.vertexShader =
            `
#ifdef USE_INSTANCING
attribute float instancePaperTextureIndex;
attribute float instancePaperTextureIntensity;
#endif
varying float vPaperTextureIndex;
varying float vPaperTextureIntensity;
` + shader.vertexShader;

        shader.vertexShader = shader.vertexShader.replace(
            "#include <uv_vertex>",
            `
#include <uv_vertex>
#ifdef USE_INSTANCING
vPaperTextureIndex = instancePaperTextureIndex;
vPaperTextureIntensity = instancePaperTextureIntensity;
#else
vPaperTextureIndex = 0.0;
vPaperTextureIntensity = 1.0;
#endif
`
        );

        shader.fragmentShader =
            `
varying float vPaperTextureIndex;
varying float vPaperTextureIntensity;
uniform float paperTintAmount;
${textureUniformBlock}
${sampleFunction}
` + shader.fragmentShader;

        shader.fragmentShader = shader.fragmentShader.replace(
            "#include <map_fragment>",
            `
#ifdef USE_MAP
    vec4 sampledDiffuseColor = samplePaperTexture(vMapUv, vPaperTextureIndex);
    #ifdef DECODE_VIDEO_TEXTURE
        sampledDiffuseColor = sRGBTransferEOTF(sampledDiffuseColor);
    #endif
    diffuseColor.rgb *= mix(vec3(1.0), sampledDiffuseColor.rgb, clamp(vPaperTextureIntensity, 0.0, 1.0));
#endif
`
        );

        shader.fragmentShader = shader.fragmentShader.replace(
            "#include <color_fragment>",
            `
#include <color_fragment>
#ifdef USE_MAP
diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.5, clamp(paperTintAmount, 0.0, 1.0));
#endif
`
        );
    };

    material.customProgramCacheKey = () => {
        const previousKey =
            typeof previousCustomProgramCacheKey === "function"
                ? previousCustomProgramCacheKey.call(material)
                : "";

        return `${previousKey}|paperTextureBlend:v1`;
    };

    material.userData.__paperTexturePatched = true;
    material.needsUpdate = true;

    return material;
}

function getPaperMaterial() {
    if (_paperMaterial != null) {
        return _paperMaterial;
    }

    _paperMaterial = new THREE.MeshStandardMaterial({
        color: PAPER_MATERIAL_CONFIG.color,
        map: getPaperPlaceholderTexture(),
        roughness: PAPER_MATERIAL_CONFIG.roughness,
        metalness: PAPER_MATERIAL_CONFIG.metalness
    });

    return patchPaperMaterial(_paperMaterial);
}

function applyPaperMaterialConfig(nextConfig = {}) {
    Object.assign(PAPER_MATERIAL_CONFIG, nextConfig);

    if (_paperMaterial == null) return;

    _paperMaterial.color.set(PAPER_MATERIAL_CONFIG.color);
    _paperMaterial.roughness = PAPER_MATERIAL_CONFIG.roughness;
    _paperMaterial.metalness = PAPER_MATERIAL_CONFIG.metalness;

    if (_paperMaterial.userData.__paperShaderRefs) {
        for (const shader of _paperMaterial.userData.__paperShaderRefs) {
            if (shader.uniforms.paperTintAmount) {
                shader.uniforms.paperTintAmount.value = PAPER_MATERIAL_CONFIG.tintAmount;
            }
        }
    }

    _paperMaterial.needsUpdate = true;
}

function normalizeTextureIndex(texture) {
    if (typeof texture === "number" && Number.isFinite(texture)) {
        return THREE.MathUtils.clamp(Math.round(texture), 0, PAPER_TEXTURE_PATHS.length - 1);
    }

    if (typeof texture === "string") {
        const normalizedPath = texture.startsWith("./") ? texture.slice(2) : texture;
        const pathIndex = PAPER_TEXTURE_PATHS.indexOf(normalizedPath);
        if (pathIndex >= 0) {
            return pathIndex;
        }
    }

    return null;
}

function randomPaperTextureIndex(random) {
    return Math.floor(random() * PAPER_TEXTURE_PATHS.length);
}

function randomPaperTextureIntensity(random) {
    return THREE.MathUtils.lerp(
        PAPER_TEXTURE_INTENSITY_RANGE.min,
        PAPER_TEXTURE_INTENSITY_RANGE.max,
        random()
    );
}

class Paper {
    constructor(options = {}) {
        const geometryParams = { width: 1, height: 1 };
        const random = typeof options.random === "function" ? options.random : Math.random;
        const resolvedTextureIndex = normalizeTextureIndex(options.texture) ?? randomPaperTextureIndex(random);
        const resolvedTextureIntensity = THREE.MathUtils.clamp(
            options.textureIntensity ?? randomPaperTextureIntensity(random),
            0,
            1
        );

        this.scaleMult = 1;
        this.rootGroup = new THREE.Group();
        this.rootGroup.quaternion.copy(getTiltQuaternion(options.tiltOptions));
        this.textureIndex = resolvedTextureIndex;
        this.textureIntensity = resolvedTextureIntensity;
        this.meshVisible = true;

        this.meshInstance = createPooledMesh({
            geomType: "plane",
            geomParams: geometryParams,
            material: getPaperMaterial(),
            instanced: true,
            perInstanceColor: true,
            customAttributes: [
                { name: "instancePaperTextureIndex", size: 1 },
                { name: "instancePaperTextureIntensity", size: 1 }
            ],
            renderOrder: options.renderOrder ?? 0,
            maxInstancesHint: 4096
        });

        this.getRootGroup().add(this.meshInstance.group);

        if (options.tint) {
            this.setTint(options.tint);
        }

        this.setTexture(this.textureIndex);
        this.setTextureIntensity(this.textureIntensity);
        
        this.refreshTransform();
        this.setVisible(true);
    }

    setScale (scale) {
        this.scaleMult = scale;
        this.size = new THREE.Vector3(8.5, 11, 1).multiplyScalar(this.scaleMult);
        this.meshInstance.setScale(this.size);
        this.meshInstance.syncIfDirty();
        this.setVisible(this.meshVisible);
    }

    refreshTransform() {
        this.size = new THREE.Vector3(8.5, 11, 1).multiplyScalar(this.scaleMult);
        this.meshInstance
            .setScale(this.size)
            .setPosition(0, 0, 0)
            .setQuaternion(0, 0, 0, 1);

        this.setVisible(this.meshVisible);
    }

    setTint(tint) {
        if (tint == null) {
            return this;
        }

        if (tint.isColor) {
            this.meshInstance.setColor(tint);
            return this;
        }

        if (Array.isArray(tint)) {
            this.meshInstance.setColor(tint[0], tint[1], tint[2]);
            return this;
        }

        this.meshInstance.setColor(new THREE.Color(tint));
        return this;
    }

    setTexture(texture) {
        const resolvedTextureIndex = normalizeTextureIndex(texture);
        if (resolvedTextureIndex == null) {
            return this;
        }

        this.textureIndex = resolvedTextureIndex;
        this.meshInstance.setShaderParameter("instancePaperTextureIndex", this.textureIndex);
        return this;
    }

    setTextureIntensity(textureIntensity) {
        if (textureIntensity == null || Number.isFinite(textureIntensity) === false) {
            return this;
        }

        this.textureIntensity = THREE.MathUtils.clamp(textureIntensity, 0, 1);
        this.meshInstance.setShaderParameter("instancePaperTextureIntensity", this.textureIntensity);
        return this;
    }

    getSize() {
        return this.size;
    }

    getRootGroup() {
        return this.rootGroup;
    }

    setVisible(visible = true) {
        this.meshVisible = !!visible;
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

    dispose() {
        if (this.meshInstance) {
            this.meshInstance.dispose();
            this.meshInstance = null;
        }

        if (this.rootGroup?.parent) {
            this.rootGroup.parent.remove(this.rootGroup);
        }
    }
}

export { Paper, PAPER_TEXTURE_PATHS, PAPER_MATERIAL_CONFIG, applyPaperMaterialConfig };
