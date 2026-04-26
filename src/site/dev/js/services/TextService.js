import * as THREE from "three";
import { createFontFromAtlasJsonAndPng } from "../text/createFontFromAtlasJsonAndPng.js";
import { SDFTextMaterialReference } from "../text/SDFTextMaterialReference.js";
import { SDFTextInstancedLayer } from "../text/SDFTextInstancedLayer.js";

/**
 * Internal cache entry shape:
 * {
 *   fontPromise: Promise<DynamicSDFont>,
 *   font: DynamicSDFont | null,
 *   baseMaterialOptions: {
 *     color?, opacity?, threshold?, softness?,
 *     outlineColor?, outlineThickness?, outlineOpacity?
 *   },
 *   materialRef: SDFTextMaterialReference | null,
 *   instancedLayer: SDFTextInstancedLayer | null
 * }
 */
const _fontCache = new Map();
let _defaultRenderer = null;
let _defaultParent = null;
let _defaultLight = null;
let _defaultLightTarget = null;
let _defaultCamera = null;

/**
 * Utility: load JSON from a path/URL using fetch.
 */
async function _loadJson(jsonPath) {
    const res = await fetch(jsonPath);
    if (!res.ok) {
        throw new Error(`TextService: Failed to load JSON from "${jsonPath}" (status ${res.status})`);
    }
    return res.json();
}

/**
 * Utility: load an Image from a path/URL.
 */
function _loadImage(pngPath) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = (err) =>
            reject(new Error(`TextService: Failed to load PNG from "${pngPath}"`));
        img.src = pngPath;
    });
}

/**
 * Extract only the material-related options we care about from options.
 */
function _extractMaterialOptions(options) {
    const mat = {};
    if (options.color != null) mat.color = options.color;
    if (options.opacity != null) mat.opacity = options.opacity;
    if (options.threshold != null) mat.threshold = options.threshold;
    if (options.softness != null) mat.softness = options.softness;
    if (options.outlineColor != null) mat.outlineColor = options.outlineColor;
    if (options.outlineThickness != null) mat.outlineThickness = options.outlineThickness;
    if (options.outlineOpacity != null) mat.outlineOpacity = options.outlineOpacity;
    if (options.ambientStrength != null) mat.ambientStrength = options.ambientStrength;
    if (options.diffuseStrength != null) mat.diffuseStrength = options.diffuseStrength;
    if (options.specularStrength != null) mat.specularStrength = options.specularStrength;
    if (options.sheenStrength != null) mat.sheenStrength = options.sheenStrength;
    if (options.sheenPower != null) mat.sheenPower = options.sheenPower;
    if (options.lightIntensityScale != null) mat.lightIntensityScale = options.lightIntensityScale;
    return mat;
}

/**
 * Extract layout options we may want to pass into the layout engine.
 */
function _extractLayoutOptions(options) {
    const layout = {};
    if (options.fontSize != null) layout.fontSize = options.fontSize;
    if (options.wrapMode != null) layout.wrapMode = options.wrapMode;
    if (options.maxWidth != null) layout.maxWidth = options.maxWidth;
    if (options.maxHeight != null) layout.maxHeight = options.maxHeight;
    if (options.align != null) layout.align = options.align;
    if (options.anchor != null) layout.anchor = options.anchor;
    if (options.lineHeight != null) layout.lineHeight = options.lineHeight;

    // Auto-fitting / scaling
    if (options.autoScale != null) layout.autoScale = options.autoScale;
    if (options.minFontSize != null) layout.minFontSize = options.minFontSize;
    if (options.fitIterations != null) layout.fitIterations = options.fitIterations;

    // Convenience shorthands: fitRect / fit (alias)
    if (options.fitRect != null) layout.fitRect = options.fitRect;
    if (options.fit != null) layout.fit = options.fit;

    // Optional padding inside the fit rect.
    if (options.padding != null) layout.padding = options.padding;
    return layout;
}

class TextService {
    static init({ renderer, parent, light, lightTarget, camera } = {}) {
        _defaultRenderer = renderer;
        _defaultParent = parent;
        _defaultLight = light ?? null;
        _defaultLightTarget = lightTarget ?? null;
        _defaultCamera = camera ?? null;
    }

    static getText(key, options = {}) {
        const entry = _fontCache.get(key);
        
        if (!entry || !entry.font || !entry.instancedLayer) {
            throw new Error(
                `TextService.getText: no font/layer found for key "${key}". Did you call TextService.setFont first?`
            );
        }

        if (typeof options === "string") {
            options = { text: options }
        }

        const layoutOptions = _extractLayoutOptions(options);
        const textInstance = entry.instancedLayer.createTextInstance(options.text, layoutOptions);

        const group = textInstance.group;

        if (options.scale) {
            group.scale.fromArray(options.scale);
        }

        group.userData.__sdfTextInstance = textInstance;
        group.userData.__textServiceKey = key;

        return group;
    }

    static async setFont(key, options) {
        const baseMaterialOptions = _extractMaterialOptions(options);
        let fontPromise;

        if (options.font) {
            fontPromise = Promise.resolve(options.font);
        }
        else {
            fontPromise = (async () => {
                const jsonData = await _loadJson(options.jsonPath);
                const image = await _loadImage(options.pngPath);

                const font = createFontFromAtlasJsonAndPng(jsonData, image, _defaultRenderer);
                return font;
            })();
        }

        let cacheEntry = {
            fontPromise,
            font: null,
            baseMaterialOptions,
            materialRef: null,
            instancedLayer: null
        };

        cacheEntry.font = await cacheEntry.fontPromise;

        cacheEntry.materialRef = new SDFTextMaterialReference({
            map: cacheEntry.font.texture,
            color: baseMaterialOptions.color,
            opacity: baseMaterialOptions.opacity,
            threshold: baseMaterialOptions.threshold,
            softness: baseMaterialOptions.softness,
            outlineColor: baseMaterialOptions.outlineColor,
            outlineThickness: baseMaterialOptions.outlineThickness,
            outlineOpacity: baseMaterialOptions.outlineOpacity != null
                ? baseMaterialOptions.outlineOpacity
                : 1.0,
            ambientStrength: baseMaterialOptions.ambientStrength,
            diffuseStrength: baseMaterialOptions.diffuseStrength,
            specularStrength: baseMaterialOptions.specularStrength,
            sheenStrength: baseMaterialOptions.sheenStrength,
            sheenPower: baseMaterialOptions.sheenPower,
            lightIntensityScale: baseMaterialOptions.lightIntensityScale,
            light: _defaultLight,
            lightTarget: _defaultLightTarget,
            camera: _defaultCamera
        });

        cacheEntry.instancedLayer = new SDFTextInstancedLayer({
            font: cacheEntry.font,
            material: cacheEntry.materialRef.getMaterial(),
            parent: _defaultParent,
            maxGlyphs: options.maxGlyphs || 2048
        });

        _fontCache.set(key, cacheEntry);
    }

    static updateStyle(key, materialOptions = {}) {
        const entry = _fontCache.get(key);
        if (!entry || !entry.materialRef) return;

        const matRef = entry.materialRef;

        if (materialOptions.threshold != null) matRef.threshold = materialOptions.threshold;
        if (materialOptions.softness != null) matRef.softness = materialOptions.softness;
        if (materialOptions.outlineThickness != null) matRef.outlineThickness = materialOptions.outlineThickness;
        if (materialOptions.opacity != null) matRef.opacity = materialOptions.opacity;
        if (materialOptions.outlineOpacity != null) matRef.outlineOpacity = materialOptions.outlineOpacity;
        if (materialOptions.color != null) matRef.color = materialOptions.color;
        if (materialOptions.outlineColor != null) matRef.outlineColor = materialOptions.outlineColor;
        if (materialOptions.ambientStrength != null) matRef.ambientStrength = materialOptions.ambientStrength;
        if (materialOptions.diffuseStrength != null) matRef.diffuseStrength = materialOptions.diffuseStrength;
        if (materialOptions.specularStrength != null) matRef.specularStrength = materialOptions.specularStrength;
        if (materialOptions.sheenStrength != null) matRef.sheenStrength = materialOptions.sheenStrength;
        if (materialOptions.sheenPower != null) matRef.sheenPower = materialOptions.sheenPower;
        if (materialOptions.lightIntensityScale != null) matRef.lightIntensityScale = materialOptions.lightIntensityScale;
    }

    static getFont(key) {
        const entry = _fontCache.get(key);
        if (!entry || !entry.font) return null;
        return entry.font;
    }

    static clearCache() {
        _fontCache.clear();
    }

    static disposeText(group) {
        const inst = group?.userData?.__sdfTextInstance;
        if (!inst) return;
        const entry = _fontCache.get(group.userData.__textServiceKey);
        entry?.instancedLayer?._disposeTextInstance(inst);
    }
}

export { TextService };
