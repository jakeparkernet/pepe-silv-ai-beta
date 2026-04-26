// GlyphEditorUI.js
import { GLYPH_METRIC_CONTROLS } from "./GlyphState.js";

class GlyphEditorUI {
    constructor(options) {
        const {
            rootElement,
            glyphState,
            getFont,
            onGlyphAdjustmentsChanged,
            onGlyphSetChanged,
            getCurrentText
        } = options;

        this.rootElement = rootElement;
        this.glyphState = glyphState;
        this.getFont = getFont;
        this.onGlyphAdjustmentsChanged = onGlyphAdjustmentsChanged;
        this.onGlyphSetChanged = onGlyphSetChanged;
        this.getCurrentText = getCurrentText;
    }

    buildGrid() {
        if (!this.rootElement) return;
        const font = this.getFont();
        if (!font) return;

        const grid = this.rootElement;
        grid.innerHTML = "";

        const chars = this.glyphState.getAllChars();
        const activeSet = new Set(this.glyphState.getActiveChars());

        chars.forEach((glyphChar) => {
            const cell = document.createElement("div");
            cell.className = "glyph-cell";

            const active = activeSet.has(glyphChar);
            if (!active) {
                cell.classList.add("glyph-inactive");
            }

            const left = document.createElement("div");
            left.className = "glyph-cell-left";

            const charSpan = document.createElement("span");
            charSpan.className = "glyph-char-span";
            charSpan.textContent = glyphChar === " " ? 'sp' : glyphChar;
            left.appendChild(charSpan);

            const right = document.createElement("div");
            right.className = "glyph-cell-right";

            const header = document.createElement("div");
            header.className = "glyph-header";

            const toggleBtn = document.createElement("button");
            toggleBtn.textContent = active ? "Active" : "Inactive";
            toggleBtn.className = active ? "glyph-active-btn" : "glyph-inactive-btn";

            toggleBtn.addEventListener("click", () => {
                this.glyphState.toggleCharActive(glyphChar);
                if (this.onGlyphSetChanged) {
                    this.onGlyphSetChanged();
                }
                this.buildGrid();
            });

            header.appendChild(toggleBtn);
            right.appendChild(header);

            const glyph = font.getGlyph(glyphChar);
            const metrics = glyph || {};

            const inputsByProp = {};

            const applyAdjustments = () => {
                const adjustments = {};
                for (const [propName, pair] of Object.entries(inputsByProp)) {
                    const numInput = pair.number;
                    const val = parseFloat(numInput.value);
                    if (!Number.isNaN(val)) {
                        adjustments[propName] = val;
                    }
                }

                if (typeof font.setGlyphAdjustments === "function") {
                    font.setGlyphAdjustments(glyphChar, adjustments);
                }

                if (this.onGlyphAdjustmentsChanged) {
                    this.onGlyphAdjustmentsChanged(this.getCurrentText());
                }
            };

            for (const [propName, config] of Object.entries(GLYPH_METRIC_CONTROLS)) {
                const row = document.createElement("div");
                row.className = "glyph-input-row";

                const label = document.createElement("label");
                label.textContent = config.label;

                const slider = document.createElement("input");
                slider.type = "range";
                if (config.min !== undefined) slider.min = String(config.min);
                if (config.max !== undefined) slider.max = String(config.max);
                if (config.step !== undefined) slider.step = String(config.step);

                const numberInput = document.createElement("input");
                numberInput.type = "number";
                if (config.min !== undefined) numberInput.min = String(config.min);
                if (config.max !== undefined) numberInput.max = String(config.max);
                if (config.step !== undefined) numberInput.step = String(config.step);

                let defaultValue = 0;
                if (propName === "scale") {
                    defaultValue = 1;
                } else if (metrics && typeof metrics[propName] === "number") {
                    defaultValue = metrics[propName];
                }

                slider.value = String(defaultValue);
                numberInput.value = String(defaultValue);

                const syncFromSlider = () => {
                    numberInput.value = slider.value;
                    applyAdjustments();
                };

                const syncFromNumber = () => {
                    slider.value = numberInput.value;
                    applyAdjustments();
                };

                slider.addEventListener("input", syncFromSlider);
                numberInput.addEventListener("change", syncFromNumber);

                row.appendChild(label);
                row.appendChild(slider);
                row.appendChild(numberInput);
                right.appendChild(row);

                inputsByProp[propName] = { slider, number: numberInput };
            }

            cell.appendChild(left);
            cell.appendChild(right);
            grid.appendChild(cell);
        });

        // Add "Add character" cell
        const addCell = document.createElement("div");
        addCell.className = "glyph-cell glyph-add-cell";

        const label = document.createElement("div");
        label.textContent = "Add characters:";
        addCell.appendChild(label);

        const addInput = document.createElement("input");
        addInput.type = "text";
        addInput.placeholder = "e.g. äöü!?";
        addCell.appendChild(addInput);

        const addButton = document.createElement("button");
        addButton.textContent = "Add";
        addButton.addEventListener("click", () => {
            const text = addInput.value || "";
            if (!text) return;
            this.glyphState.addChars(text);
            addInput.value = "";
            if (this.onGlyphSetChanged) {
                this.onGlyphSetChanged();
            }
            this.buildGrid();
        });

        addCell.appendChild(addButton);
        grid.appendChild(addCell);
    }

    selectGlyph(char) {
        if (!this.rootElement) return;

        if (this._selectedCell) {
            this._selectedCell.classList.remove("glyph-selected");
        }

        const grid = this.rootElement;
        const cells = grid.querySelectorAll(".glyph-cell");
        let targetCell = null;

        for (const cell of cells) {
            const left = cell.querySelector(".glyph-cell-left");
            if (!left) continue;
            const charSpan = left.querySelector(".glyph-char-span");
            if (charSpan && charSpan.textContent === char) {
                targetCell = cell;
                break;
            }
        }

        if (targetCell) {
            this._selectedCell = targetCell;
            targetCell.classList.add("glyph-selected");

            targetCell.scrollIntoView({ behavior: "smooth", block: "center" });
        }
    }
}

export { GlyphEditorUI };
