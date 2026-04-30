import Stats from "three/addons/libs/stats.module.js";
import { GUI } from "three/addons/libs/lil-gui.module.min.js";
import { LUTImageLoader } from "three/addons/loaders/LUTImageLoader.js";

import { TextService } from "../services/TextService.js";

class DebugController {
    constructor({
        camera = null,
        cameraController = null,
        guiFactory = GUI,
        statsFactory = Stats,
        lutLoaderFactory = LUTImageLoader,
        lutBasePath = "./resources/LUT/",
        lutConfigUrl = "./resources/LUT/luts.json",
        textGuiConfigs = null,
        materialGuiConfigs = null,
        cameraGuiState = null,
        showStatsByDefault = false,
        showControlsByDefault = false,
        onLutTextureLoaded = null,
        onLutPathsLoaded = null,
        onGuiVisibilityChange = null,
        onStatsVisibilityChange = null
    } = {}) {
        this.camera = camera;
        this.cameraController = cameraController;
        this.guiFactory = guiFactory;
        this.statsFactory = statsFactory;
        this.lutLoaderFactory = lutLoaderFactory;
        this.lutBasePath = lutBasePath;
        this.lutConfigUrl = lutConfigUrl;
        this.textGuiConfigs = textGuiConfigs;
        this.materialGuiConfigs = materialGuiConfigs;
        this.cameraGuiState = cameraGuiState ?? {
            position: "",
            fov: ""
        };
        this.showStatsByDefault = showStatsByDefault;
        this.showControlsByDefault = showControlsByDefault;
        this.onLutTextureLoaded = onLutTextureLoaded;
        this.onLutPathsLoaded = onLutPathsLoaded;
        this.onGuiVisibilityChange = onGuiVisibilityChange;
        this.onStatsVisibilityChange = onStatsVisibilityChange;

        this.gui = null;
        this.stats = null;
        this.lutLoader = null;
        this.lutPaths = [];
        this.lutParams = {
            enabled: true,
            skipComposer: false,
            lut: "Base/Contrast_C.png",
            intensity: 0.8,
            load: null
        };
        this.debugControlsVisible = false;
        this.statsVisible = false;
        this.initialized = false;
        this._onKeyDown = null;
        this._cameraPositionController = null;
        this._cameraFovController = null;

        this.init = this.init.bind(this);
        this.loadLut = this.loadLut.bind(this);
        this.onLutLoaded = this.onLutLoaded.bind(this);
        this.updateCameraGuiState = this.updateCameraGuiState.bind(this);
        this.setGuiVisible = this.setGuiVisible.bind(this);
        this.setStatsVisible = this.setStatsVisible.bind(this);
        this.setupTextGui = this.setupTextGui.bind(this);
        this.setupMaterialGui = this.setupMaterialGui.bind(this);
        this.fetchLutPaths = this.fetchLutPaths.bind(this);
        this.buildGui = this.buildGui.bind(this);
        this.buildStats = this.buildStats.bind(this);
        this.handleKeydown = this.handleKeydown.bind(this);
    }

    async init() {
        if (this.initialized) {
            return this;
        }

        this.gui = new this.guiFactory();
        this.gui.width = 350;
        this.buildStats();
        this.buildGui();

        const params = new URLSearchParams(window.location.search);
        const showStats = params.get("stats");
        const showControls = params.get("controls");

        this.statsVisible = showStats ? showStats === "true" : this.showStatsByDefault;
        this.setStatsVisible(this.statsVisible);

        this.debugControlsVisible = showControls ? showControls === "true" : this.showControlsByDefault;
        this.setGuiVisible(this.debugControlsVisible);

        if (this.debugControlsVisible || this.showControlsByDefault) {
            this._onKeyDown = this.handleKeydown;
            document.addEventListener("keydown", this._onKeyDown);
        }

        this.lutLoader = new this.lutLoaderFactory();
        this.lutLoader.flip = true;
        this.lutParams.load = () => {
            this.loadLut(this.lutParams.lut);
        };

        this.lutPaths = await this.fetchLutPaths();
        this.onLutPathsLoaded?.(this.lutPaths);

        this.setupTextGui();
        this.setupMaterialGui();
        this.loadLut(this.lutParams.lut);
        this.initialized = true;
        return this;
    }

    buildStats() {
        this.stats = new this.statsFactory();
        this.stats.showPanel(0);
        document.body.appendChild(this.stats.dom);
        this.stats.dom.style.position = "absolute";
        this.stats.dom.style.bottom = "0";
        this.stats.dom.style.right = "0";
        this.stats.dom.style.left = "auto";
        this.stats.dom.style.top = "auto";
    }

    buildGui() {
        if (this.gui == null) {
            return;
        }

        this.gui.domElement.style.display = "none";
        this.gui.domElement.style.zIndex = "2000";
    }

    async fetchLutPaths() {
        try {
            const response = await fetch(this.lutConfigUrl);
            if (!response.ok) {
                return [];
            }

            const data = await response.json();
            if (Array.isArray(data?.luts)) {
                return data.luts;
            }
        } catch (_error) {
        }

        return [];
    }

    setGuiVisible(visible = true) {
        if (this.gui == null) {
            return;
        }

        this.gui.domElement.style.display = visible ? "" : "none";
        this.onGuiVisibilityChange?.(visible);
    }

    setStatsVisible(visible = true) {
        if (this.stats == null) {
            return;
        }

        this.stats.dom.style.display = visible ? "block" : "none";
        this.onStatsVisibilityChange?.(visible);
    }

    handleKeydown(event) {
        if (event.key === "f" || event.key === "F") {
            this.debugControlsVisible = !this.debugControlsVisible;
            this.setGuiVisible(this.debugControlsVisible);
        }

        if (event.key === "s" || event.key === "S") {
            if (document.activeElement !== this.cameraController?.canvas) {
                this.statsVisible = !this.statsVisible;
                this.setStatsVisible(this.statsVisible);
            }
        }
    }

    loadLut(path) {
        if (this.lutLoader == null) {
            this.lutLoader = new this.lutLoaderFactory();
            this.lutLoader.flip = true;
        }

        this.lutLoader.load(`${this.lutBasePath}${path}`, this.onLutLoaded);
    }

    onLutLoaded(result) {
        this.onLutTextureLoaded?.(result?.texture3D ?? null);
    }

    updateCameraGuiState() {
        if (this.camera == null) {
            return;
        }

        this.cameraGuiState.position = `${this.camera.position.x.toFixed(2)}, ${this.camera.position.y.toFixed(2)}, ${this.camera.position.z.toFixed(2)}`;
        this.cameraGuiState.fov = this.camera.fov.toFixed(2);
    }

    setupTextGui() {
        if (this.gui == null || this.textGuiConfigs == null) {
            return;
        }

        const textFolder = this.gui.addFolder("text");
        const sliderDefs = [
            { key: "ambientStrength", min: 0, max: 2 },
            { key: "diffuseStrength", min: 0, max: 2 },
            { key: "specularStrength", min: 0, max: 2 },
            { key: "sheenStrength", min: 0, max: 2 },
            { key: "sheenPower", min: 0, max: 600 },
            { key: "lightIntensityScale", min: 0, max: 0.05 }
        ];

        for (const [fontKey, config] of Object.entries(this.textGuiConfigs)) {
            const fontFolder = textFolder.addFolder(fontKey);

            for (const sliderDef of sliderDefs) {
                fontFolder
                    .add(config, sliderDef.key, sliderDef.min, sliderDef.max)
                    .onChange((value) => {
                        TextService.updateStyle(fontKey, {
                            [sliderDef.key]: value
                        });
                    });
            }
        }
    }

    setupMaterialGui() {
        if (this.gui == null || this.materialGuiConfigs == null) {
            return;
        }

        const materialsFolder = this.gui.addFolder("materials");
        const sliderDefs = [
            { key: "roughness", min: 0, max: 1 },
            { key: "metalness", min: 0, max: 1 }
        ];

        for (const [materialKey, entry] of Object.entries(this.materialGuiConfigs)) {
            const materialFolder = materialsFolder.addFolder(materialKey);

            for (const sliderDef of sliderDefs) {
                if (sliderDef.key in entry.config === false) {
                    continue;
                }

                materialFolder
                    .add(entry.config, sliderDef.key, sliderDef.min, sliderDef.max)
                    .onChange((value) => {
                        entry.apply({
                            [sliderDef.key]: value
                        });
                    });
            }
        }
    }

    dispose() {
        if (this._onKeyDown != null) {
            document.removeEventListener("keydown", this._onKeyDown);
            this._onKeyDown = null;
        }

        this.gui?.destroy?.();
        this.gui = null;

        this.stats?.dom?.remove?.();
        this.stats = null;
    }
}

export { DebugController };
