// TextSceneController.js
import * as THREE from "three";
import { TextService } from "../services/TextService.js";
import { loadDynamicSDFont } from "./DynamicSDFont.js";

const DEFAULT_FONT_CONFIG = {
    url: "../../resources/fonts/PermanentMarker-Regular.ttf",
    family: "Regular",
    fontSize: 48,
    buffer: 5,
    radius: 10,
    cutoff: 0.25,
    atlasSize: 512
};

const STYLE_KEY = "sdf-exporter:preview";

class TextSceneController {
    constructor(scene, renderer) {
        this.scene = scene;
        this.renderer = renderer;

        this.textContainer = new THREE.Group();
        this.scene.add(this.textContainer);

        this.sdfFont = null;
        this.textGroup = null;
        this.styleKey = STYLE_KEY;

        this.sdfMaterial = null;
        this.textMeshRef = null;

        this.rotationYDeg = 0;
        this.align = "center";
        this.anchor = "center";
        this.fontSize = 1;
        this.currentText = "";

        TextService.init({
            renderer: this.renderer,
            parent: this.textContainer
        });
    }

    async loadDynamicFont(config = DEFAULT_FONT_CONFIG) {
        const font = await loadDynamicSDFont({
            url: config.url,
            family: config.family,
            fontSize: config.fontSize,
            buffer: config.buffer,
            radius: config.radius,
            cutoff: config.cutoff,
            atlasSize: config.atlasSize,
            renderer: this.renderer
        });

        await this.applyLoadedFont(font);
        return this.sdfFont;
    }

    async applyAtlasFont(fontObj) {
        await this.applyLoadedFont(fontObj);
        return this.sdfFont;
    }

    async applyLoadedFont(font) {
        this.disposeResources();

        this.sdfFont = font;

        await TextService.setFont(this.styleKey, {
            font: this.sdfFont,
            color: "#ffffff",
            opacity: 1.0,
            threshold: 0.5,
            softness: 0.2,
            outlineColor: "#000000",
            outlineThickness: 0.0,
            outlineOpacity: 1.0,
            maxGlyphs: 4096
        });

        this._rebuildText();
    }

    _rebuildText() {
        if (!this.sdfFont) return;

        if (this.textGroup) {
            if (this.textGroup.parent === this.scene) {
                this.scene.remove(this.textGroup);
            }
            TextService.disposeText(this.textGroup);
            this.textGroup = null;
        }

        this.textGroup = TextService.getText(this.styleKey, {
            text: this.currentText || "",
            fontSize: this.fontSize,
            wrapMode: "none",
            align: this.align,
            anchor: this.anchor
        });

        if (this.textGroup) {
            this.scene.add(this.textGroup);
            this.textGroup.position.set(0, 0, 0);
            this.textGroup.scale.set(1, 1, 1);
        }
    }

    disposeResources() {
        if (this.textGroup) {
            if (this.textGroup.parent === this.scene) {
                this.scene.remove(this.textGroup);
            }
            TextService.disposeText(this.textGroup);
            this.textGroup = null;
        }
    }


    _getMesh() {
        if (!this.textMeshRef) return null;
        return this.textMeshRef.getMesh ? this.textMeshRef.getMesh() : this.textMeshRef;
    }

    getFont() { return this.sdfFont; }
    getAtlasCanvas() { return this.sdfFont ? this.sdfFont.atlasCanvas : null; }

    buildInitialAtlas(activeChars) {
        if (!this.sdfFont || !Array.isArray(activeChars)) return;
        activeChars.forEach((ch) => {
            try { this.sdfFont.getGlyph(ch); }
            catch (e) { console.warn("Glyph build failed:", ch, e); }
        });
    }

    setThreshold(v) {
        TextService.updateStyle(this.styleKey, { threshold: v });
    }

    setSoftness(v) {
        TextService.updateStyle(this.styleKey, { softness: v });
    }

    setOutlineThickness(v) {
        TextService.updateStyle(this.styleKey, { outlineThickness: v });
    }

    setColor(hex) {
        TextService.updateStyle(this.styleKey, { color: new THREE.Color(hex) });
    }

    setOutlineColor(hex) {
        TextService.updateStyle(this.styleKey, { outlineColor: new THREE.Color(hex) });
    }

    setText(text, forceLayout = false) {
        this.currentText = text;
        this._rebuildText();
    }

    setFontSize(size) {
        this.fontSize = size;
        this._rebuildText();
    }

    setAlign(align) {
        this.align = align;
        this._rebuildText();
    }

    setAnchor(anchor) {
        this.anchor = anchor;
        this._rebuildText();
    }
    setRotationY(deg) { this.rotationYDeg = deg; }

    update() {
        this.textContainer.quaternion.setFromAxisAngle(
            new THREE.Vector3(0, 1, 0),
            THREE.MathUtils.degToRad(this.rotationYDeg)
        );
    }

    toJSON(activeChars) {
        if (!this.sdfFont?.toJSON) return null;
        const base = this.sdfFont.toJSON();
        if (Array.isArray(activeChars)) {
            return { ...base, meta: { ...(base.meta || {}), exportedGlyphs: activeChars } };
        }
        return base;
    }
}

export { TextSceneController, DEFAULT_FONT_CONFIG };
