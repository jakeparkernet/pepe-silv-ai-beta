// FontDebugUI.js
import { DEFAULT_FONT_CONFIG } from "./TextSceneController.js";
import { createFontFromAtlasJsonAndPng } from "./createFontFromAtlasJsonAndPng.js";

class FontDebugUI {
    constructor(options) {
        const { textController, glyphState, glyphEditorUI, atlasPreview, atlasExporter } = options;
        this.textController = textController;
        this.glyphState = glyphState;
        this.glyphEditorUI = glyphEditorUI;
        this.atlasPreview = atlasPreview;
        this.atlasExporter = atlasExporter;

        // DOM references (matching HTML)
        this.textInput = document.getElementById("textInput");
        this.rotationSlider = document.getElementById("rotationSlider");
        this.rotationNum = document.getElementById("rotationNum");
        this.fontSizeSlider = document.getElementById("fontSize");
        this.fontSizeNum = document.getElementById("fontSizeNum");
        this.thresholdSlider = document.getElementById("threshold");
        this.softnessSlider = document.getElementById("softness");
        this.outlineSlider = document.getElementById("outlineThickness");
        this.colorInput = document.getElementById("color");
        this.outlineColorInput = document.getElementById("outlineColor");
        this.alignSelect = document.getElementById("alignSelect");
        this.anchorSelect = document.getElementById("anchorSelect");
        this.downloadAtlasBtn = document.getElementById("downloadAtlasBtn");

        this.fontFileInput = document.getElementById("fontFileInput");
        this.fontPathInput = document.getElementById("fontPathInput");
        this.fontFamilyInput = document.getElementById("fontFamilyInput");
        this.atlasSizeInput = document.getElementById("atlasSizeInput");
        this.loadFontBtn = document.getElementById("loadFontBtn");

        this.jsonFileInput = document.getElementById("atlasJsonInput");
        this.pngFileInput = document.getElementById("atlasPngInput");
        this.loadJsonPngBtn = document.getElementById("loadAtlasBtn");

        this.uploadedFontObjectURL = null;
    }

    init() {
        // Set text from UI immediately (fix #2)
        this.textController.setText(this.textInput?.value ?? "");

        // Defaults
        if (this.fontPathInput) this.fontPathInput.value = DEFAULT_FONT_CONFIG.url;
        if (this.fontFamilyInput) this.fontFamilyInput.value = DEFAULT_FONT_CONFIG.family;
        if (this.atlasSizeInput) this.atlasSizeInput.value = String(DEFAULT_FONT_CONFIG.atlasSize);

        // Rotation
        const syncRotationInputs = (value) => {
            this.rotationSlider.value = value;
            this.rotationNum.value = value;
            this.textController.setRotationY(parseFloat(value));
        };
        this.rotationSlider.addEventListener("input", (e) => syncRotationInputs(e.target.value));
        this.rotationNum.addEventListener("change", (e) => {
            const val = parseFloat(e.target.value);
            syncRotationInputs(val.toString());
        });

        // Font size
        const syncFontSizeInputs = (value) => {
            this.fontSizeSlider.value = value;
            this.fontSizeNum.value = value;
            this.textController.setFontSize(parseFloat(value));
        };
        this.fontSizeSlider.addEventListener("input", (e) => syncFontSizeInputs(e.target.value));
        this.fontSizeNum.addEventListener("change", (e) => {
            let val = parseFloat(e.target.value);
            if (isNaN(val)) val = DEFAULT_FONT_CONFIG.fontSize;
            val = Math.max(4, Math.min(200, val));
            syncFontSizeInputs(val.toString());
        });

        // Text (live)
        this.textInput.addEventListener("input", () => {
            this.textController.setText(this.textInput.value);
        });

        // Material controls
        this.thresholdSlider.addEventListener("input", () => {
            this.textController.setThreshold(parseFloat(this.thresholdSlider.value));
        });
        this.softnessSlider.addEventListener("input", () => {
            this.textController.setSoftness(parseFloat(this.softnessSlider.value));
        });
        this.outlineSlider.addEventListener("input", () => {
            this.textController.setOutlineThickness(parseFloat(this.outlineSlider.value));
        });
        this.colorInput.addEventListener("input", () => {
            this.textController.setColor(this.colorInput.value);
        });
        this.outlineColorInput.addEventListener("input", () => {
            this.textController.setOutlineColor(this.outlineColorInput.value);
        });
        this.alignSelect.addEventListener("change", () => {
            this.textController.setAlign(this.alignSelect.value);
        });
        this.anchorSelect.addEventListener("change", () => {
            this.textController.setAnchor(this.anchorSelect.value);
        });

        // Upload font
        this.fontFileInput?.addEventListener("change", () => {
            const file = this.fontFileInput.files?.[0];
            if (!file) return;
            if (this.uploadedFontObjectURL) URL.revokeObjectURL(this.uploadedFontObjectURL);
            this.uploadedFontObjectURL = URL.createObjectURL(file);
            if (this.fontPathInput) this.fontPathInput.value = file.name;
        });

        // Load dynamic font (do NOT shrink glyph list — fix #1)
        this.loadFontBtn?.addEventListener("click", async () => {
            try {
                const family = (this.fontFamilyInput?.value?.trim()) || DEFAULT_FONT_CONFIG.family;
                const atlasParsed = this.atlasSizeInput ? parseInt(this.atlasSizeInput.value, 10) : NaN;
                let atlasSize = Number.isFinite(atlasParsed) ? atlasParsed : DEFAULT_FONT_CONFIG.atlasSize;
                atlasSize = Math.min(4096, Math.max(64, atlasSize));

                const url =
                    this.uploadedFontObjectURL ||
                    (this.fontPathInput?.value?.trim()) ||
                    DEFAULT_FONT_CONFIG.url;

                const config = {
                    url, family,
                    fontSize: DEFAULT_FONT_CONFIG.fontSize,
                    buffer: DEFAULT_FONT_CONFIG.buffer,
                    radius: DEFAULT_FONT_CONFIG.radius,
                    cutoff: DEFAULT_FONT_CONFIG.cutoff,
                    atlasSize
                };

                const newFont = await this.textController.loadDynamicFont(config);
                this._rebuildAfterFontLoad(newFont, { fromAtlas: false }); // keep base set
            } catch (err) {
                console.error("Failed to load font from UI:", err);
                alert("Failed to load font. Please check the font path or uploaded file.");
            }
        });

        // Load JSON + PNG atlas (here we DO replace glyph list — mirrors original behavior)
        this.loadJsonPngBtn?.addEventListener("click", async () => {
            try {
                const jsonFile = this.jsonFileInput?.files?.[0];
                const pngFile = this.pngFileInput?.files?.[0];
                if (!jsonFile || !pngFile) {
                    alert("Please select both a JSON and a PNG file.");
                    return;
                }

                const jsonText = await jsonFile.text();
                const jsonData = JSON.parse(jsonText);

                const imgUrl = URL.createObjectURL(pngFile);
                const image = await new Promise((resolve, reject) => {
                    const img = new Image();
                    img.onload = () => { URL.revokeObjectURL(imgUrl); resolve(img); };
                    img.onerror = (e) => { URL.revokeObjectURL(imgUrl); reject(e); };
                    img.src = imgUrl;
                });

                const importedFont = createFontFromAtlasJsonAndPng(jsonData, image);
                const newFont = await this.textController.applyAtlasFont(importedFont);

                this._rebuildAfterFontLoad(newFont, { fromAtlas: true });
            } catch (err) {
                console.error("Failed to load JSON+PNG:", err);
                alert("Failed to load atlas. Make sure the JSON matches the exported format.");
            }
        });

        this.downloadAtlasBtn?.addEventListener("click", () => {
            const font = this.textController.getFont();
            if (!font) return;
            const activeChars = this.glyphState.getActiveChars();
            this.atlasExporter.export(font, activeChars);
        });
    }

    _rebuildAfterFontLoad(font, { fromAtlas = false } = {}) {
        if (!font) return;

        if (fromAtlas && font.glyphs) {
            // Only when importing JSON+PNG — fix #1
            this.glyphState.replaceCharsFromGlyphMap(font.glyphs);
        }
        // For dynamic font: keep base glyphs in GlyphState.

        const activeChars = this.glyphState.getActiveChars();
        this.textController.buildInitialAtlas(activeChars);

        this.glyphEditorUI.buildGrid();
        this.atlasPreview.attach();
    }
}

export { FontDebugUI };
