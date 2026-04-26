// GlyphState.js

const BASE_GLYPH_CHARS = [
    ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ",
    ..."abcdefghijklmnopqrstuvwxyz",
    ..."0123456789",
    ",", ".", "/", "?", "!", "@", "#", "$", "%", "&",
    "*", "-", "+", "=", "_", "~", "`", '"', "'", ":",
    ";", "\\", " "
];

const GLYPH_METRIC_CONTROLS = {
    scale: {
        label: "scale",
        step: 0.01,
        min: 0.5,
        max: 2
    },
    xOffset: {
        label: "xOffset",
        step: 0.1,
        min: -50,
        max: 50
    },
    yOffset: {
        label: "yOffset",
        step: 0.1,
        min: -50,
        max: 50
    },
    advance: {
        label: "advance",
        step: 0.1,
        min: 0,
        max: 200
    },
    u0: {
        label: "u0",
        step: 0.001,
        min: 0,
        max: 1,
    },
    u1: {
        label: "u1",
        step: 0.001,
        min: 0,
        max: 1,
    },
    v0: {
        label: "v0",
        step: 0.001,
        min: 0,
        max: 1,
    },
    v1: {
        label: "v1",
        step: 0.001,
        min: 0,
        max: 1,
    }
};

class GlyphState {
    constructor() {
        this.allChars = [...BASE_GLYPH_CHARS];
        this.activeSet = new Set(this.allChars);
    }

    getAllChars() {
        return [...this.allChars];
    }

    getActiveChars() {
        return this.allChars.filter((ch) => this.activeSet.has(ch));
    }

    isActive(ch) {
        return this.activeSet.has(ch);
    }

    toggleCharActive(ch) {
        if (!this.allChars.includes(ch)) return;
        if (this.activeSet.has(ch)) {
            this.activeSet.delete(ch);
        } else {
            this.activeSet.add(ch);
        }
    }

    addChars(chars) {
        const arr = Array.isArray(chars) ? chars : [...String(chars)];
        arr.forEach((ch) => {
            if (!this.allChars.includes(ch)) {
                this.allChars.push(ch);
                this.activeSet.add(ch);
            } else {
                // if it's already in list, make sure it's active
                this.activeSet.add(ch);
            }
        });
    }

    replaceCharsFromGlyphMap(glyphMap) {
        if (!glyphMap || typeof glyphMap !== "object") return;
        const uniqueChars = Object.keys(glyphMap);
        this.allChars = uniqueChars;
        this.activeSet = new Set(uniqueChars);
    }
}

export { GlyphState, GLYPH_METRIC_CONTROLS, BASE_GLYPH_CHARS };
