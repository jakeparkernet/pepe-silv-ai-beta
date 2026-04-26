// DynamicSDFont.js

import { Texture, LinearFilter, LinearMipMapLinearFilter } from "three";
import TinySDF from "./TinySDF.js";

class DynamicSDFont {
  constructor({
    family,
    style,
    size,
    lineHeight,
    ascender,
    descender,
    atlasSize,
    tinySdf,
    renderer,
    // NEW optional fields for imported-atlas mode:
    texture = null,
    glyphs = null,
    atlasCanvas = null,
    kerning = null
  }) {
    this.family = family || "";
    this.style = style || "normal";
    this.size = size; // font units (px used for SDF generation)
    this.lineHeight = lineHeight;
    this.ascender = ascender;
    this.descender = descender;

    this._tinySdf = tinySdf || null;

    // Shelf packing state (used only in dynamic mode)
    this._penX = 0;
    this._penY = 0;
    this._rowHeight = 0;

    // Glyph map: char -> metrics
    this._glyphs = {};
    // Original (unadjusted) glyph metrics
    this._baseGlyphs = {};
    // Per-glyph metric adjustments (xOffset, yOffset, xAdvance, etc.)
    this._glyphAdjustments = {};
    // Kerning map (not implemented yet, but preserve if passed in)
    this._kerning = kerning || {};

    // --- IMPORTED ATLAS MODE ---
    // If both a texture and glyph map are provided, we treat this as an
    // already-baked atlas and skip creating canvas + TinySDF.
    if (texture && glyphs) {
      this.texture = texture;

      // Derive atlas size from the texture’s image if possible
      const img = texture.image;
      if (img && img.width && img.height) {
        this.atlasWidth = img.width;
        this.atlasHeight = img.height;
      } else {
        // Fallback: use provided atlasSize if image dims are unavailable
        this.atlasWidth = atlasSize;
        this.atlasHeight = atlasSize;
      }

      // Use the provided atlas canvas if given; otherwise try to use the
      // texture’s image if it is a canvas. We will *not* write to this in
      // imported mode, only read via atlasCanvas getter / previews.
      this._atlasCanvas = atlasCanvas || (img instanceof HTMLCanvasElement ? img : null);
      this._atlasCtx = null; // no drawing required in imported mode

      // Seed base glyphs and current glyphs from the provided map
      this._baseGlyphs = { ...glyphs };
      for (const [ch, metrics] of Object.entries(glyphs)) {
        this._glyphs[ch] = { ...metrics };
      }

      return; // IMPORTANT: skip dynamic canvas/TinySDF setup
    }

    // --- DYNAMIC GENERATION MODE (existing behavior) ---

    this.atlasWidth = atlasSize;
    this.atlasHeight = atlasSize;

    // Atlas canvas
    const canvas = document.createElement("canvas");
    canvas.width = this.atlasWidth;
    canvas.height = this.atlasHeight;
    const ctx = canvas.getContext("2d");
    // Start transparent
    ctx.clearRect(0, 0, this.atlasWidth, this.atlasHeight);

    this._atlasCanvas = canvas;
    this._atlasCtx = ctx;

    const dynTexture = new Texture(canvas);
    dynTexture.minFilter = LinearMipMapLinearFilter;
    dynTexture.magFilter = LinearFilter;
    dynTexture.flipY = false;
    dynTexture.needsUpdate = true;

    if (renderer) {
      dynTexture.anisotropy = renderer.capabilities.getMaxAnisotropy();
    }

    this.texture = dynTexture;
  }

  _applyAdjustments(char, metrics) {
    const adj = this._glyphAdjustments[char];
    if (!adj) return;

    const base = this._baseGlyphs[char] || metrics;
    const baseU0 = base.u0 ?? metrics.u0;
    const baseV0 = base.v0 ?? metrics.v0;
    const baseU1 = base.u1 ?? metrics.u1;
    const baseV1 = base.v1 ?? metrics.v1;

    // 1) Start from base metrics each time so sliders are absolute, not cumulative
    for (const [key, value] of Object.entries(base)) {
      metrics[key] = adj[key] != null ? adj[key] : base[key];
    }

    if (adj.scale != null && adj.scale !== 1) {
      const scale = adj.scale;
      const uRange = baseU1 - baseU0;
      const vRange = baseV1 - baseV0;

      metrics.u0 = baseU0 + uRange * (1 - 1 / scale) / 2;
      metrics.v0 = baseV0 + vRange * (1 - 1 / scale) / 2;
      metrics.u1 = baseU1 - uRange * (1 - 1 / scale) / 2;
      metrics.v1 = baseV1 - vRange * (1 - 1 / scale) / 2;

      metrics.width *= scale;
      metrics.height *= scale;
      metrics.xOffset *= scale;
      metrics.yOffset *= scale;
      metrics.xAdvance *= scale;
    }
  }

  setGlyphAdjustments(char, adjustments) {
    this._glyphAdjustments[char] = {
      ...(this._glyphAdjustments[char] || {}),
      ...adjustments,
    };

    // If the glyph has already been generated, apply immediately.
    const existing = this._glyphs[char];
    if (existing) {
      this._applyAdjustments(char, existing);
    }
  }

  /**
   * Return glyph metrics for a character, generating SDF if needed.
   * Metrics shape matches what TextLayoutEngine expects:
   * { width, height, xOffset, yOffset, xAdvance, u0, v0, u1, v1 }
   */
  getGlyph(char) {
    // If we already have glyph metrics, just return those
    if (this._glyphs[char]) return this._glyphs[char];

    // IMPORTED MODE: no TinySDF / no atlas context -> we cannot generate new glyphs
    if (!this._tinySdf || !this._atlasCtx) {
      console.warn(
        "DynamicSDFont: getGlyph called for char not in imported atlas and no TinySDF available:",
        char
      );
      return null;
    }

    // --- DYNAMIC MODE: generate SDF glyph on demand ---

    const glyphBitmap = this._tinySdf.draw(char);
    const { width, height, glyphAdvance } = glyphBitmap;

    // Handle empty glyph (e.g., space)
    if (width === 0 || height === 0) {
      const metrics = {
        scale: 1,
        width: 0,
        height: 0,
        xOffset: 0,
        yOffset: 0,
        xAdvance: glyphAdvance || 0,
        u0: 0,
        v0: 0,
        u1: 0,
        v1: 0
      };

      // Save original metrics for padding / adjustments
      this._baseGlyphs[char] = { ...metrics };

      this._applyAdjustments(char, metrics);
      this._glyphs[char] = metrics;
      return metrics;
    }

    // Simple shelf packing
    const w = width;
    const h = height;

    if (this._penX + w > this.atlasWidth) {
      // New row
      this._penX = 0;
      this._penY += this._rowHeight;
      this._rowHeight = 0;
    }

    if (this._penY + h > this.atlasHeight) {
      console.warn(
        "DynamicSDFont: atlas full, cannot pack more glyphs (char:",
        char,
        ")"
      );
      // Fallback: mark glyph as empty advance-only
      const metrics = {
        scale: 1,
        width: 0,
        height: 0,
        xOffset: 0,
        yOffset: 0,
        xAdvance: glyphAdvance || 0,
        u0: 0,
        v0: 0,
        u1: 0,
        v1: 0
      };

      // Save original metrics for padding / adjustments
      this._baseGlyphs[char] = { ...metrics };

      this._applyAdjustments(char, metrics);
      this._glyphs[char] = metrics;

      return metrics;
    }

    const x = this._penX;
    const y = this._penY;

    // Copy grayscale SDF into RGBA image
    const imageData = this._atlasCtx.createImageData(w, h);
    const src = glyphBitmap.data;
    const dst = imageData.data;
    const len = src.length;

    for (let i = 0; i < len; i++) {
      const v = src[i]; // 0..255
      const j = i * 4;
      dst[j + 0] = v; // R
      dst[j + 1] = v; // G
      dst[j + 2] = v; // B
      dst[j + 3] = v; // A (SDF encoded as alpha)
    }

    this._atlasCtx.putImageData(imageData, x, y);
    this.texture.needsUpdate = true;

    const u0 = x / this.atlasWidth;
    const v0 = y / this.atlasHeight;
    const u1 = (x + w) / this.atlasWidth;
    const v1 = (y + h) / this.atlasHeight;

    // NOTE: vertical metrics are approximate; we treat top-aligned glyph quads.
    const metrics = {
      scale: 1,
      width: w,
      height: h,
      xOffset: 0,
      yOffset: 0,
      xAdvance: glyphAdvance || w,
      u0,
      v0,
      u1,
      v1
    };

    // Save original metrics for padding / adjustments
    this._baseGlyphs[char] = { ...metrics };

    this._glyphs[char] = metrics;

    this._penX += w;
    if (h > this._rowHeight) this._rowHeight = h;

    this._applyAdjustments(char, metrics);
    this._glyphs[char] = metrics;
    return metrics;
  }

  /**
   * No kerning for now (Canvas doesn't expose it easily).
   */
  getKerning(_prevChar, _char) {
    return 0;
  }

  /**
   * Expose glyph map for export.
   */
  get glyphs() {
    return this._glyphs;
  }

  /**
   * Export a JSON metadata object compatible with SDFont.fromJSON.
   */
  toJSON() {
    return {
      family: this.family,
      style: this.style,
      size: this.size,
      lineHeight: this.lineHeight,
      ascender: this.ascender,
      descender: this.descender,
      atlasWidth: this.atlasWidth,
      atlasHeight: this.atlasHeight,
      glyphs: this._glyphs,
      kerning: this._kerning
    };
  }

  get atlasCanvas() {
    return this._atlasCanvas;
  }
}

/**
 * Convenience: load a dynamic SDF font from a TTF/OTF URL.
 *
 * @param {Object} opts
 * @param {string} opts.url       - Path/URL to .ttf/.otf
 * @param {string} opts.family    - Font family name to register
 * @param {number} [opts.fontSize=48]    - SDF generation size
 * @param {number} [opts.buffer=3]
 * @param {number} [opts.radius=8]
 * @param {number} [opts.cutoff=0.25]
 * @param {string} [opts.fontWeight='normal']
 * @param {string} [opts.fontStyle='normal']
 * @param {number} [opts.atlasSize=1024]
 * @param {THREE.WebGLRenderer} [opts.renderer] - optional, for anisotropy
 */
async function loadDynamicSDFont({
  url,
  family,
  fontSize = 48,
  buffer = 3,
  radius = 8,
  cutoff = 0.25,
  fontWeight = "normal",
  fontStyle = "normal",
  atlasSize = 1024,
  renderer = null,
  lang = null
}) {
  if (!url || !family) {
    throw new Error("loadDynamicSDFont: 'url' and 'family' are required.");
  }

  // Load font via FontFace
  const fontFace = new FontFace(family, `url(${url})`, {
    weight: fontWeight,
    style: fontStyle
  });
  await fontFace.load();
  document.fonts.add(fontFace);

  // Create TinySDF with that font
  const tinySdf = new TinySDF({
    fontSize,
    buffer,
    radius,
    cutoff,
    fontFamily: family,
    fontWeight,
    fontStyle,
    lang
  });

  // Approximate metrics using measureText on "Hg" (classic trick)
  const metrics = tinySdf.ctx.measureText("Hg");
  const asc = metrics.actualBoundingBoxAscent + buffer;
  const desc = -metrics.actualBoundingBoxDescent - buffer;
  const lineHeight = asc - desc;

  return new DynamicSDFont({
    family,
    style: fontStyle,
    size: fontSize,
    lineHeight,
    ascender: asc,
    descender: desc,
    atlasSize,
    tinySdf,
    renderer
  });
}

export { DynamicSDFont, loadDynamicSDFont };
