// main.js
import { SceneManager } from "./SceneManager.js";
import { TextSceneController } from "./TextSceneController.js";
import { GlyphState } from "./GlyphState.js";
import { GlyphEditorUI } from "./GlyphEditorUI.js";
import { AtlasPreview } from "./AtlasPreview.js";
import { AtlasExporter } from "./AtlasExporter.js";
import { FontDebugUI } from "./FontDebugUI.js";
import { LayoutManager } from "./LayoutManager.js";

async function init() {
    const container = document.getElementById("threejs-canvas");
    const glyphGrid = document.getElementById("glyph-grid");
    const atlasPreviewBox = document.getElementById("atlas-preview-box");

    const appRoot = document.documentElement;
    const debugPanel = document.getElementById("debug-panel");
    const debugResizer = document.getElementById("debug-resizer");
    const atlasPanel = document.getElementById("atlas-preview");
    const atlasResizer = document.getElementById("atlas-resizer");

    const textInput = document.getElementById("textInput");

    const sceneManager = new SceneManager(container);
    const textController = new TextSceneController(
        sceneManager.getScene(),
        sceneManager.getRenderer()
    );

    const glyphState = new GlyphState();

    const glyphEditorUI = new GlyphEditorUI({
        rootElement: glyphGrid,
        glyphState,
        getFont: () => textController.getFont(),
        getCurrentText: () => textInput.value,
        onGlyphAdjustmentsChanged: (currentText) => {
            textController.setText(currentText, true);
            const active = glyphState.getActiveChars();
            textController.buildInitialAtlas(active);
            atlasPreview.render();
        },
        onGlyphSetChanged: () => {
            const active = glyphState.getActiveChars();
            textController.buildInitialAtlas(active);
            atlasPreview.render();
        }
    });

    const atlasPreview = new AtlasPreview({
        container: atlasPreviewBox,
        getFont: () => textController.getFont(),
        getActiveChars: () => glyphState.getActiveChars(),
        onGlyphClick: (char) => glyphEditorUI.selectGlyph(char)
    });

    const atlasExporter = new AtlasExporter();

    const fontDebugUI = new FontDebugUI({
        textController,
        glyphState,
        glyphEditorUI,
        atlasPreview,
        atlasExporter
    });

    fontDebugUI.init();

    const layoutManager = new LayoutManager({
        appRoot,
        container,
        debugPanel,
        debugResizer,
        atlasPanel,
        atlasResizer,
        sceneManager,
        atlasPreview
    });
    layoutManager.init();

    // Load initial dynamic font; DO NOT shrink glyph list here (fix #1)
    const font = await textController.loadDynamicFont();

    // Keep base glyph set (GlyphState default); build atlas for it
    const activeChars = glyphState.getActiveChars();
    textController.buildInitialAtlas(activeChars);

    // Build glyph editor and attach preview
    glyphEditorUI.buildGrid();
    atlasPreview.attach();

    // Start render loop
    sceneManager.setUpdateCallback(() => {
        textController.update();
    });
    sceneManager.start();
}

init().catch((err) => {
    console.error("Error initializing dynamic SDF text demo:", err);
});
