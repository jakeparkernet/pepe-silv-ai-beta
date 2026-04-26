import { computeLineAlphaForRow, parseColor, blendRgb, getBleedFunction } from "./cardsUtils.js"

/* =========================
 * Class: IndexCardStripGenerator
 * (new implementation)
 * ========================= */

class IndexCardStripGenerator {
    /**
     * Create a tiny 2xH canvas containing an index-card pattern.
     * options: {
     *   height,
     *   backgroundColor,
     *   headingRule: { color, y, thickness, bleed, bleedAlgorithm },
     *   ruledLines:  { color, firstY, spacing, thickness, bleed, bleedAlgorithm }
     * }
     */
    static createStrip(options = {}) {
        const height = options.height ?? 256;
        const width = 2;

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');

        // Two high-contrast colors
        const colorA = 'rgb(255, 0, 0)';   // red
        const colorB = 'rgb(0, 0, 255)';   // blue

        // Stripe size in pixels (vertical bands)
        const stripeSize = 8;

        for (let y = 0; y < height; y += stripeSize) {
            const bandIndex = Math.floor(y / stripeSize);
            const color = bandIndex % 2 === 0 ? colorA : colorB;
            ctx.fillStyle = color;

            const bandHeight = Math.min(stripeSize, height - y);
            ctx.fillRect(0, y, width, bandHeight);
        }

        return canvas;
    }
}

export { IndexCardStripGenerator };