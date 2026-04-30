// createFontFromAtlasJsonAndPng.js
import * as THREE from "three";
// import { DynamicSDFont } from "./DynamicSDFont.js";
// 
const appModules = window[`apps_${performance.timeOrigin}`].modules;
const { DynamicSDFont } = appModules.text.DynamicSDFont;

/**
 * Create a DynamicSDFont from exported JSON + PNG.
 *
 * jsonData is assumed to be the result of font.toJSON().
 * image is the loaded Image corresponding to the atlas PNG.
 *
 * Optionally you can pass a renderer if you want to tweak anisotropy,
 * but it's not required for basic usage.
 */
function createFontFromAtlasJsonAndPng(jsonData, image, renderer = null) {
    // 1) Draw PNG into an internal canvas so we can treat it like atlasCanvas
    const atlasCanvas = document.createElement("canvas");
    atlasCanvas.width = image.width;
    atlasCanvas.height = image.height;
    const ctx = atlasCanvas.getContext("2d");
    ctx.drawImage(image, 0, 0);

    // 2) Wrap the canvas in a Three.js texture
    const texture = new THREE.CanvasTexture(atlasCanvas);
    texture.needsUpdate = true;
    // You can mirror the dynamic font filters if you like:
    texture.minFilter = THREE.LinearMipMapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.flipY = false;

    if (renderer) {
        texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
    }

    // 3) Pull core font metadata from JSON (with sensible fallbacks)
    const family =
        jsonData.family ||
        (jsonData.meta && jsonData.meta.familyName) ||
        "ImportedAtlas";

    const style = jsonData.style || "normal";
    const size = jsonData.size || jsonData.fontSize || 48;

    const lineHeight =
        jsonData.lineHeight != null ? jsonData.lineHeight : size;

    const ascender =
        jsonData.ascender != null ? jsonData.ascender : lineHeight;

    const descender =
        jsonData.descender != null ? jsonData.descender : 0;

    const glyphs = jsonData.glyphs || {};
    const kerning = jsonData.kerning || {};

    // JSON may carry atlasWidth/atlasHeight; otherwise use image dims.
    const atlasWidth = jsonData.atlasWidth || image.width;
    const atlasHeight = jsonData.atlasHeight || image.height;
    const atlasSize = Math.max(atlasWidth, atlasHeight);

    // 4) Construct a DynamicSDFont in "imported atlas" mode.
    // Passing both `texture` and `glyphs` tells the constructor to:
    // - skip TinySDF,
    // - skip creating its own canvas,
    // - use this texture & glyph map as the baked atlas.
    const font = new DynamicSDFont({
        family,
        style,
        size,
        lineHeight,
        ascender,
        descender,
        atlasSize,
        tinySdf: null,
        renderer,
        texture,
        glyphs,
        atlasCanvas,
        kerning
    });

    return font;
}

export { createFontFromAtlasJsonAndPng };
