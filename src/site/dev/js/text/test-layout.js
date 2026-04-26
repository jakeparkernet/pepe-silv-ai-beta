// test-layout.js

import { SDFont } from "./SDFont.js";
import { TextLayoutEngine } from "./TextLayoutEngine.js";

// --- 1. Minimal fake font metadata ---

const mockFontMetadata = {
  family: "MockSans",
  style: "Regular",
  size: 48,          // font units (em-size used when generating SDF)
  lineHeight: 56,
  ascender: 40,
  descender: -16,
  atlasWidth: 256,
  atlasHeight: 256,
  glyphs: {
    "H": { x: 0,   y: 0,  width: 30, height: 40, xOffset: 0, yOffset: 40, xAdvance: 32, u0: 0.00, v0: 0.00, u1: 0.12, v1: 0.16 },
    "e": { x: 32,  y: 0,  width: 25, height: 35, xOffset: 0, yOffset: 35, xAdvance: 27, u0: 0.13, v0: 0.00, u1: 0.22, v1: 0.14 },
    "l": { x: 64,  y: 0,  width: 10, height: 40, xOffset: 0, yOffset: 40, xAdvance: 12, u0: 0.23, v0: 0.00, u1: 0.27, v1: 0.16 },
    "o": { x: 80,  y: 0,  width: 26, height: 35, xOffset: 0, yOffset: 35, xAdvance: 28, u0: 0.28, v0: 0.00, u1: 0.38, v1: 0.14 },
    "W": { x: 0,   y: 48, width: 40, height: 40, xOffset: 0, yOffset: 40, xAdvance: 42, u0: 0.00, v0: 0.19, u1: 0.16, v1: 0.35 },
    "r": { x: 48,  y: 48, width: 18, height: 35, xOffset: 0, yOffset: 35, xAdvance: 20, u0: 0.17, v0: 0.19, u1: 0.24, v1: 0.33 },
    "d": { x: 72,  y: 48, width: 25, height: 40, xOffset: 0, yOffset: 40, xAdvance: 27, u0: 0.25, v0: 0.19, u1: 0.34, v1: 0.35 },
    " ": { x: 0,   y: 96, width: 10, height: 10, xOffset: 0, yOffset: 10, xAdvance: 16, u0: 0.00, v0: 0.38, u1: 0.04, v1: 0.42 },
    "?": { x: 16,  y: 96, width: 20, height: 35, xOffset: 0, yOffset: 35, xAdvance: 22, u0: 0.05, v0: 0.38, u1: 0.13, v1: 0.52 }
  },
  kerning: {
    // Example: small kerning between "H" and "e"
    "H": { "e": -1 }
  }
};

// No texture needed for layout test; pass null.
const mockFont = new SDFont(mockFontMetadata, null);

// --- 2. Example text + options ---

const text = "Hello\nWorld";

const options = {
  fontSize: 1,          // world units
  maxWidth: null,       // no wrapping
  wrapMode: "none",     // just respect '\n'
  align: "left",
  letterSpacing: 0,
  lineHeightMult: 1.0
};

// --- 3. Run the layout engine ---

const { glyphs, metrics } = TextLayoutEngine.layoutText(mockFont, text, options);

// --- 4. Log results ---

console.log("=== Layout Metrics ===");
console.log("width:", metrics.width.toFixed(4));
console.log("height:", metrics.height.toFixed(4));
console.log("lineCount:", metrics.lineCount);
console.log("lineWidths:", metrics.lineWidths.map(w => w.toFixed(4)));
console.log("bounds:", {
  minX: metrics.minX.toFixed(4),
  maxX: metrics.maxX.toFixed(4),
  minY: metrics.minY.toFixed(4),
  maxY: metrics.maxY.toFixed(4)
});

console.log("\n=== First few glyphs ===");
glyphs.slice(0, 10).forEach((g, i) => {
  console.log(
    `#${i}`,
    `char="${g.char}"`,
    `line=${g.lineIndex}`,
    `x=${g.x.toFixed(4)}`,
    `y=${g.y.toFixed(4)}`,
    `w=${g.w.toFixed(4)}`,
    `h=${g.h.toFixed(4)}`
  );
});
