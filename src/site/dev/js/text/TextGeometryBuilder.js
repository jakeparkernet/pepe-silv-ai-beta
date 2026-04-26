// TextGeometryBuilder.js

import { BufferGeometry, BufferAttribute, PlaneGeometry } from "three";

class TextGeometryBuilder {
  /**
   * Build a THREE.BufferGeometry from a layout result.
   *
   * @param {{ glyphs: Array, metrics: Object }} layoutResult
   *        Result of TextLayoutEngine.layoutText(...)
   * @param {Object} options
   * @param {string} [options.anchor='top-left']
   *        One of:
   *        'top-left', 'top-center', 'top-right',
   *        'center-left', 'center', 'center-right',
   *        'bottom-left', 'bottom-center', 'bottom-right'
   * @param {boolean} [options.includeLineIndex=false]
   *        If true, adds a 'lineIndex' attribute (float) per vertex.
   * @param {boolean} [options.includeCharIndex=false]
   *        If true, adds a 'charIndex' attribute (float) per vertex.
   */
  static build(layoutResult, options = {}) {
    const {
      anchor = "center",
      includeLineIndex = false,
      includeCharIndex = false
    } = options;

    if (!layoutResult || !layoutResult.glyphs || !layoutResult.metrics) {
      throw new Error("TextGeometryBuilder.build: invalid layoutResult.");
    }

    const glyphs = layoutResult.glyphs;
    const metrics = layoutResult.metrics;

    const glyphCount = glyphs.length;
    const geometry = new BufferGeometry();

    if (glyphCount === 0) {
      // Empty geometry; still valid, just no vertices.
      return geometry;
    }

    const geometryScale = 1;

    // Compute anchor offset so that the chosen anchor is at (0,0).
    const { offsetX, offsetY } = TextGeometryBuilder.computeAnchorOffset(
      metrics,
      anchor
    );

    // Allocate typed arrays.
    const vertexCount = glyphCount * 4;   // 4 vertices per glyph
    const indexCount = glyphCount * 6;    // 6 indices per glyph (2 triangles)

    const positions = new Float32Array(vertexCount * 3); // x,y,z
    const uvs = new Float32Array(vertexCount * 2);       // u,v

    const IndexArrayType = vertexCount > 65535 ? Uint32Array : Uint16Array;
    const indices = new IndexArrayType(indexCount);

    let lineIndexAttr = null;
    let charIndexAttr = null;

    if (includeLineIndex) {
      lineIndexAttr = new Float32Array(vertexCount); // 1 float per vertex
    }
    if (includeCharIndex) {
      charIndexAttr = new Float32Array(vertexCount); // 1 float per vertex
    }

    // Fill arrays.
    for (let i = 0; i < glyphCount; i++) {
      const g = glyphs[i];

      if (!g) {
        console.warn("TextGeometryBuilder: glyph is null/undefined at index", i);
        continue;
      }

      // Base indices into the arrays for this glyph.
      const vertBase = i * 4;
      const posBase = vertBase * 3;
      const uvBase = vertBase * 2;
      const idxBase = i * 6;

      // Apply anchor offset to glyph origin.
      const gx = g.x;
      const gy = g.y;
      const gw = g.w;
      const gh = g.h;

      // Guard against NaNs coming from the layout engine / font metrics.
      if (
        !Number.isFinite(gx) ||
        !Number.isFinite(gy) ||
        !Number.isFinite(gw) ||
        !Number.isFinite(gh)
      ) {
        console.warn(
          "TextGeometryBuilder: skipping glyph with invalid metrics",
          { index: i, glyph: g }
        );
        // Leave positions/uvs/indices for this glyph at their default (0),
        // so they don't introduce NaNs into the geometry.
        continue;
      }

      const ogx = gx + offsetX;
      const ogy = gy + offsetY;

      // Vertex positions (z = 0)
      //
      // v0: top-left
      // v1: top-right
      // v2: bottom-left
      // v3: bottom-right
      //
      // Note: layout uses y as top, height extends downward (negative y).
      const x0 = ogx;
      const y0 = ogy;
      const x1 = ogx + gw;
      const y1 = ogy;
      const x2 = ogx;
      const y2 = ogy - gh;
      const x3 = ogx + gw;
      const y3 = ogy - gh;

      // Positions
      positions[posBase + 0] = x0;
      positions[posBase + 1] = y0;
      positions[posBase + 2] = 0;

      positions[posBase + 3] = x1;
      positions[posBase + 4] = y1;
      positions[posBase + 5] = 0;

      positions[posBase + 6] = x2;
      positions[posBase + 7] = y2;
      positions[posBase + 8] = 0;

      positions[posBase + 9] = x3;
      positions[posBase + 10] = y3;
      positions[posBase + 11] = 0;

      // UVs
      const u0 = g.u0;
      const v0 = g.v0;
      const u1 = g.u1;
      const v1 = g.v1;

      uvs[uvBase + 0] = u0;
      uvs[uvBase + 1] = v0;

      uvs[uvBase + 2] = u1;
      uvs[uvBase + 3] = v0;

      uvs[uvBase + 4] = u0;
      uvs[uvBase + 5] = v1;

      uvs[uvBase + 6] = u1;
      uvs[uvBase + 7] = v1;

      // Indices (two triangles: 0-2-1, 2-3-1)
      const v0i = vertBase + 0;
      const v1i = vertBase + 1;
      const v2i = vertBase + 2;
      const v3i = vertBase + 3;

      indices[idxBase + 0] = v0i;
      indices[idxBase + 1] = v2i;
      indices[idxBase + 2] = v1i;

      indices[idxBase + 3] = v2i;
      indices[idxBase + 4] = v3i;
      indices[idxBase + 5] = v1i;

      // Optional attributes
      if (lineIndexAttr) {
        const line = g.lineIndex || 0;
        lineIndexAttr[vertBase + 0] = line;
        lineIndexAttr[vertBase + 1] = line;
        lineIndexAttr[vertBase + 2] = line;
        lineIndexAttr[vertBase + 3] = line;
      }

      if (charIndexAttr) {
        const ci = i;
        charIndexAttr[vertBase + 0] = ci;
        charIndexAttr[vertBase + 1] = ci;
        charIndexAttr[vertBase + 2] = ci;
        charIndexAttr[vertBase + 3] = ci;
      }
    }

    for (let i = 0; i < positions.length; i++) {
      positions[i] *= geometryScale;
    }

    // Attach attributes to geometry.
    geometry.setAttribute("position", new BufferAttribute(positions, 3));
    geometry.setAttribute("uv", new BufferAttribute(uvs, 2));
    geometry.setIndex(new BufferAttribute(indices, 1));

    if (lineIndexAttr) {
      geometry.setAttribute("lineIndex", new BufferAttribute(lineIndexAttr, 1));
    }

    if (charIndexAttr) {
      geometry.setAttribute("charIndex", new BufferAttribute(charIndexAttr, 1));
    }

    // Compute bounding box for convenience (after anchoring).
    geometry.computeBoundingBox();

    //return new PlaneGeometry(1,1);
    return geometry;
  }

  /**
   * Compute anchor offset so that the chosen anchor point lies at (0,0).
   * @private
   */
  static computeAnchorOffset(metrics, anchor) {
    let { minX, maxX, minY, maxY } = metrics;

    // If metrics are uninitialized (Infinity/-Infinity/NaN), clamp them to 0
    // so we don't produce NaNs when averaging.
    if (!Number.isFinite(minX)) minX = 0;
    if (!Number.isFinite(maxX)) maxX = 0;
    if (!Number.isFinite(minY)) minY = 0;
    if (!Number.isFinite(maxY)) maxY = 0;

    // Parse anchor string into vertical + horizontal parts.
    let horiz = "center";
    let vert = "center";

    if (typeof anchor === "string") {
      const parts = anchor.split("-");

      let rawH = null;
      let rawV = null;

      for (let i = 0; i < parts.length; i++) {
        const token = parts[i].toLowerCase();
        if (token === "left" || token === "center" || token === "right") {
          rawH = token;
        } else if (
          token === "top" ||
          token === "bottom" ||
          token === "middle" ||
          token === "center"
        ) {
          rawV = token;
        }
      }

      if (rawH) horiz = rawH;
      if (rawV) vert = rawV;
      if (vert === "middle") vert = "center";
    }

    let ax;
    let ay;

    // Horizontal
    if (horiz === "left") {
      ax = minX;
    } else if (horiz === "right") {
      ax = maxX;
    } else {
      ax = (minX + maxX) * 0.5;
    }

    // Vertical
    if (vert === "top") {
      ay = maxY;
    } else if (vert === "bottom") {
      ay = minY;
    } else {
      ay = (minY + maxY) * 0.5;
    }

    if (!Number.isFinite(ax)) ax = 0;
    if (!Number.isFinite(ay)) ay = 0;

    return {
      x: ax != 0 ? -ax : 0,
      y: ay != 0 ? -ay : 0
    };
  }
}

export { TextGeometryBuilder };
