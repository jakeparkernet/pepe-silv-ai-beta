// SDFont.js

class SDFont {
  /**
   * metadata shape (example):
   * {
   *   family: "MyFont",
   *   style: "Regular",
   *   size: 48,                // "em" size used to generate SDF
   *   lineHeight: 52,
   *   ascender: 40,
   *   descender: -12,
   *   atlasWidth: 1024,
   *   atlasHeight: 1024,
   *   glyphs: {
   *     "A": { x:0, y:0, width:50, height:50, xOffset:1, yOffset:38, xAdvance:49, u0:0.0, v0:0.0, u1:0.05, v1:0.05 },
   *     ...
   *   },
   *   kerning: {
   *     "A": { "V": -3, "W": -2 },
   *     "T": { "o": -2 }
   *   }
   * }
   */
  constructor(metadata, texture) {
    this.family = metadata.family || "";
    this.style = metadata.style || "";
    this.size = metadata.size; // font units / em size used to generate SDF
    this.lineHeight = metadata.lineHeight;
    this.ascender = metadata.ascender;
    this.descender = metadata.descender;

    this.atlasWidth = metadata.atlasWidth;
    this.atlasHeight = metadata.atlasHeight;

    // Map from char -> glyph metrics
    this._glyphs = metadata.glyphs || {};

    // Kerning: { [prevChar]: { [char]: kerningValue } }
    this._kerning = metadata.kerning || {};

    // Optional THREE.Texture (not used by layout engine, but handy to store here)
    this.texture = texture || null;
  }

  /**
   * Get glyph metrics for a character.
   * Returns:
   * { x, y, width, height, xOffset, yOffset, xAdvance, u0, v0, u1, v1 }
   * or null if not found.
   */
  getGlyph(char) {
    const glyph = this._glyphs[char];
    if (glyph) return glyph;

    // You can choose to fall back to "?" or simply return null.
    const fallback = this._glyphs["?"];
    return fallback || null;
  }

  /**
   * Get kerning adjustment (in font units) between two characters.
   */
  getKerning(prevChar, char) {
    if (!prevChar || !char) return 0;
    const row = this._kerning[prevChar];
    if (!row) return 0;
    const value = row[char];
    return typeof value === "number" ? value : 0;
  }

  /**
   * Optional helper: create SDFont from raw JSON and an optional texture.
   */
  static fromJSON(json, texture) {
    return new SDFont(json, texture);
  }
}

export { SDFont };
