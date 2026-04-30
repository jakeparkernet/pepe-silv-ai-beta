// import { ArticleApiService } from "./services/ArticleApiService.js";
// import { ChromeController } from "./controllers/ChromeController.js";
// import { PageBackgroundController } from "./controllers/PageBackgroundController.js";
// import { VisualizationController } from "./controllers/VisualizationController.js";
// import { DetailPanelController } from "./controllers/DetailPanelController.js";
// import { SummaryBannerController } from "./controllers/SummaryBannerController.js";
// import { DebugController } from "./controllers/DebugController.js";
// import { ArticleSubmissionController } from "./controllers/ArticleSubmissionController.js";
// import { TextService } from "./services/TextService.js";
// import { InstancedMeshPool } from "./utils/AssetPool.js";
// import { TrashMan } from "./utils/TrashMan.js";
// import { ArticleD3Graph } from "./components/ArticleD3Graph.js";
// import { ArticleModel } from "./models/ArticleModel.js";
// import { EntityModel } from "./models/EntityModel.js";
// import { RelationshipModel } from "./models/RelationshipModel.js";
// import { EvidenceModel } from "./models/EvidenceModel.js";
// import { ViewPool } from "./utils/ViewPool.js";
// import { PAPER_MATERIAL_CONFIG, applyPaperMaterialConfig } from "./components/Paper.js";
// import { CORKBOARD_MATERIAL_CONFIG, applyCorkboardMaterialConfig } from "./components/Corkboard.js";
// import { STICKY_NOTE_MATERIAL_CONFIG, applyStickyNoteMaterialConfig } from "./components/StickyNote.js";
// import { INDEX_CARD_MATERIAL_CONFIG, applyIndexCardMaterialConfig } from "./components/IndexCard.js";
// import { TAPE_LABEL_MATERIAL_CONFIG, applyTapeLabelMaterialConfig } from "./components/TapeLabel.js";
// import { RAISED_LABEL_MATERIAL_CONFIG, applyRaisedLabelMaterialConfig } from "./components/RaisedLabel.js";
// import { THREAD_MATERIAL_CONFIG, applyThreadMaterialConfig } from "./views/ThreadView.js";

let ArticleApiService;
let ChromeController;
let PageBackgroundController;
let VisualizationController;
let DetailPanelController;
let SummaryBannerController;
let DebugController;
let ArticleSubmissionController;
let TextService;
let InstancedMeshPool;
let TrashMan;
let ArticleD3Graph;
let ArticleModel;
let EntityModel;
let RelationshipModel;
let EvidenceModel;
let ViewPool;
let PAPER_MATERIAL_CONFIG;
let applyPaperMaterialConfig;
let CORKBOARD_MATERIAL_CONFIG;
let applyCorkboardMaterialConfig;
let STICKY_NOTE_MATERIAL_CONFIG;
let applyStickyNoteMaterialConfig;
let INDEX_CARD_MATERIAL_CONFIG;
let applyIndexCardMaterialConfig;
let TAPE_LABEL_MATERIAL_CONFIG;
let applyTapeLabelMaterialConfig;
let RAISED_LABEL_MATERIAL_CONFIG;
let applyRaisedLabelMaterialConfig;
let THREAD_MATERIAL_CONFIG;
let applyThreadMaterialConfig;

let MATERIAL_GUI_CONFIGS = null;

const LOADER_STAGE_EVENT = "pepe-loader-stage";
const LOADER_PROGRESS_EVENT = "pepe-loader-progress";

const TEXT_GUI_CONFIGS = {
    title: {
        ambientStrength: 0.1,
        diffuseStrength: 0.2,
        specularStrength: 0.2,
        sheenStrength: 0.04,
        sheenPower: 500,
        lightIntensityScale: 0.01
    },
    "title-white": {
        ambientStrength: 1.0,
        diffuseStrength: 1.0,
        specularStrength: 0.85,
        sheenStrength: 0.26,
        sheenPower: 30,
        lightIntensityScale: 0.01
    },
    "typewriter-black": {
        ambientStrength: 1.0,
        diffuseStrength: 1.0,
        specularStrength: 0,
        sheenStrength: 0,
        sheenPower: 0,
        lightIntensityScale: 0
    },
    "typewriter-white": {
        ambientStrength: 0.2,
        diffuseStrength: 1.0,
        specularStrength: 0.2,
        sheenStrength: 0.2,
        sheenPower: 10,
        lightIntensityScale: 0.01
    }
};

class App {
    constructor() {
        this.windowRef = window;
        this.documentRef = document;
        this.performanceRef = performance;
        this.onWindowResize = this.onWindowResize.bind(this);
        this.onSubmitButtonPointerDown = this.onSubmitButtonPointerDown.bind(this);
        this.onSubmitClicked = this.onSubmitClicked.bind(this);
        this.onUrlInputChanged = this.onUrlInputChanged.bind(this);
        this.onUrlInputPasted = this.onUrlInputPasted.bind(this);
        this.handleResolvedArticle = this.handleResolvedArticle.bind(this);
        this.onLoaderStage = this.onLoaderStage.bind(this);

        this.foreground = document.getElementById("foreground");
        this.pageBackground = document.getElementById("page-background");
        this.pageBackgroundPlane = this.pageBackground?.querySelector(".page-background-plane") ?? null;
        this.pageBackgroundSharpLayer = this.pageBackground?.querySelector(".page-background-layer-sharp") ?? null;
        this.pageBackgroundBlurLayer = this.pageBackground?.querySelector(".page-background-layer-blur") ?? null;
        this.urlInput = document.getElementById("url-input");
        this.urlInputContainer = document.getElementById("url-input-container");
        this.submitButton = document.getElementById("url-submit-button");
        this.submitButtonContainer = document.getElementById("url-submit-button-container");
        this.submitStatusMessage = document.getElementById("submit-status-message");
        this.submitStatusTimer = document.getElementById("submit-status-timer");
        this.supportedSites = document.getElementById("supported-sites");
        this.threeCanvas = document.getElementById("three-canvas");
        this.d3CanvasContainer = document.getElementById("d3-canvas-container");
        this.viewToggleContainer = document.getElementById("view-toggle-container");
        this.visualizationButtons = {
            three: document.getElementById("toggle-three-view"),
            d3: document.getElementById("toggle-d3-view")
        };
        this.articleActionToolbar = document.getElementById("article-action-toolbar");
        this.newSearchButton = document.getElementById("new-search-button");
        this.newSearchContainer = document.getElementById("new-search-container");
        this.shareButton = document.getElementById("share-button");
        this.shareContainer = document.getElementById("share-container");
        this.shareFeedback = document.getElementById("share-feedback");
        this.relationshipKey = document.getElementById("relationship-key");
        this.supportButtons = document.getElementById("support-buttons");
        this.supportCtaButton = document.getElementById("support-cta-button");
        this.detailPanel = document.getElementById("detail-panel");
        this.detailPanelTitle = document.getElementById("detail-panel-title");
        this.detailPanelBody = document.getElementById("detail-panel-body");
        this.detailPanelCloseButton = document.getElementById("detail-panel-close");
        this.articleUrlDisplay = document.getElementById("article-url-display");
        this.summaryBanner = document.getElementById("summary-banner");
        this.pageTitle = document.getElementById("page-title");
        this.attribution = document.getElementById("attribution");

        this.loaderState = {
            retrieval: false,
            d3: false,
            three: false
        };
        this.runtimeState = {
            d3: false,
            three: false
        };

        this.entities = {};
        this.relationships = {};
        this.evidenceIds = new Set();
        this.evidence = {};
        this.articleView = null;
        this.pendingResolvedArticle = null;

        this.apiService = new ArticleApiService({
            supportedSitesText: this.supportedSites?.textContent ?? "",
            logger: console
        });

        this.detailPanelController = new DetailPanelController({
            detailPanel: this.detailPanel,
            detailPanelTitle: this.detailPanelTitle,
            detailPanelBody: this.detailPanelBody,
            detailPanelCloseButton: this.detailPanelCloseButton,
            resolveEntityById: (entityId) => this.resolveEntityById(entityId),
            resolveEvidenceById: (evidenceId) => this.resolveEvidenceById(evidenceId)
        });

        this.summaryBannerController = new SummaryBannerController({
            summaryBanner: this.summaryBanner
        });

        this.pageBackgroundController = new PageBackgroundController({
            dom: {
                pageBackground: this.pageBackground,
                pageBackgroundPlane: this.pageBackgroundPlane,
                pageBackgroundSharpLayer: this.pageBackgroundSharpLayer,
                pageBackgroundBlurLayer: this.pageBackgroundBlurLayer,
                threeCanvas: this.threeCanvas
            }
        });

        this.chromeController = new ChromeController({
            dom: {
                foreground: this.foreground,
                urlInputContainer: this.urlInputContainer,
                newSearchButton: this.newSearchButton,
                newSearchContainer: this.newSearchContainer,
                shareButton: this.shareButton,
                shareContainer: this.shareContainer,
                shareFeedback: this.shareFeedback,
                supportButtons: this.supportButtons,
                supportCtaButton: this.supportCtaButton,
                relationshipKey: this.relationshipKey,
                articleActionToolbar: this.articleActionToolbar,
                threeCanvas: this.threeCanvas,
                d3CanvasContainer: this.d3CanvasContainer,
                visualizationButtons: this.visualizationButtons,
                submitButton: this.submitButton,
                submitButtonContainer: this.submitButtonContainer,
                articleUrlDisplay: this.articleUrlDisplay,
                submitStatusMessage: this.submitStatusMessage,
                submitStatusTimer: this.submitStatusTimer,
                detailPanel: this.detailPanel,
                pageTitle: this.pageTitle,
                attribution: this.attribution,
                lightModeTargets: [this.articleActionToolbar].filter(Boolean)
            },
            skipInitialVisualizationMode: true,
            callbacks: {
                onVisualizationModeChange: (mode) => this.visualizationController?.setVisualizationMode?.(mode)
            }
        });

        this.submissionController = new ArticleSubmissionController({
            dom: {
                foreground: this.foreground,
                urlInput: this.urlInput,
                submitButton: this.submitButton,
                submitButtonContainer: this.submitButtonContainer,
                submitStatusMessage: this.submitStatusMessage,
                submitStatusTimer: this.submitStatusTimer,
                supportedSites: this.supportedSites
            },
            api: {
                normalizeUserUrl: (raw) => this.normalizeUserUrl(raw),
                isSupportedSiteUrl: (rawUrl) => this.isSupportedSiteUrl(rawUrl),
                getArticleByUrl: (targetUrl) => this.getArticleByUrl(targetUrl),
                getArticleQueueRowByUrl: (targetUrl) => this.getArticleQueueRowByUrl(targetUrl),
                fetchOwnershipTreeById: (ownershipTreeId) => this.fetchOwnershipTreeById(ownershipTreeId),
                parseJsonRecursively: (value) => this.parseJsonRecursively(value)
            },
            chrome: {
                showForeground: () => this.chromeController.showForeground(),
                hideForeground: () => this.chromeController.hideForeground(),
                setForegroundInteractive: (isInteractive) => this.chromeController.setForegroundInteractive(isInteractive),
                hidePageBackground: () => this.hidePageBackground(),
                activateThreeCanvas: () => this.activateThreeCanvas(),
                updateAddressBarUrlParam: (urlValue) => this.updateAddressBarUrlParam(urlValue)
            },
            visualization: {
                startArticleLightingIntro: () => this.startArticleLightingIntro(),
                stopPageBackgroundFocusLoop: () => this.stopPageBackgroundFocusLoop(),
                clearCurrentArticleView: () => this.clearCurrentArticleView(),
                applyResolvedArticleCameraView: () => this.applyResolvedArticleCameraView(),
                applyArticleStatusCameraZoom: () => this.applyArticleStatusCameraZoom(),
                ensureArticleStatusViews: () => this.ensureArticleStatusViews(),
                hideArticleStatusProgress: () => this.hideArticleStatusProgress(),
                updateArticleStatusProgress: (articleObject) => this.updateArticleStatusProgress(articleObject),
                setArticleStatusSpotlightEnabled: (enabled) => this.setArticleStatusSpotlightEnabled(enabled)
            },
            callbacks: {
                onResolvedArticle: (articleObject, meta) => this.handleResolvedArticle(articleObject, meta),
                onAfterResolvedArticle: async () => {
                    await this.submissionController.fadeOutForeground();
                    this.stopPageBackgroundFocusLoop();
                }
            }
        });

        this.debugControlsVisible = false;
        this.statsVisible = false;
        this.bootstrapPromise = this.init().catch((error) => {
            console.error(error);
        });
    }

    async init() {
        new TrashMan(this);
        this.exposeGlobalApp();
        this.windowRef.addEventListener(LOADER_STAGE_EVENT, this.onLoaderStage);
        this.pageBackgroundController.initialize();
        this.chromeController.initialize();
        this.setVisualizationAvailability({ d3: false, three: false });
        this.bindRuntimeListeners();
        this.updateViewportMetrics();
        this.chromeController.showForeground();
        this.focusAndSelectUrlInput();
        this.handleInitialUrlParam();
    }

    onLoaderStage(event) {
        const stage = event?.detail?.stage ?? event?.detail?.name ?? event?.detail ?? null;
        const available = event?.detail?.available ?? null;

        if (available != null && typeof available === "object") {
            this.loaderState = {
                ...this.loaderState,
                ...available
            };
        }

        if (stage == null) {
            return;
        }

        if (stage === "retrieval") {
            this.loaderState.retrieval = true;
            this.exposeGlobalApp();
            this.focusAndSelectUrlInput();
            return;
        }

        if (stage === "d3") {
            bindD3Modules();
            if (!this.runtimeState.d3) {
                this.initializeD3Runtime();
            }
            return;
        }

        if (stage === "three") {
            bindVisualModules();
            if (!this.runtimeState.three) {
                this.initializeThreeRuntime();
            }
        }
    }

    initializeD3Runtime() {
        if (this.runtimeState.d3) {
            return;
        }

        if (typeof ArticleD3Graph !== "function") {
            return;
        }

        this.d3Graph = new ArticleD3Graph("#d3-canvas", "#d3-canvas-container");
        this.runtimeState.d3 = true;
        this.loaderState.d3 = true;

        this.renderPendingResolvedArticle();
    }

    async initializeThreeRuntime() {
        if (this.runtimeState.three) {
            return;
        }

        bindVisualModules();

        if (typeof VisualizationController !== "function" || typeof DebugController !== "function") {
            return;
        }

        if (!this.runtimeState.d3) {
            this.initializeD3Runtime();
        }

        if (this.d3Graph == null) {
            return;
        }

        this.visualizationController = new VisualizationController({
            canvas: this.threeCanvas,
            getRenderDimensions: () => this.getRenderDimensions(),
            d3Graph: this.d3Graph,
            onModeChange: () => {},
            onShowNewSearchContainer: () => this.showNewSearchContainer(),
            onShowShareContainer: () => this.showShareContainer(),
            onSetForegroundInteractive: (isInteractive) => this.setForegroundInteractive(isInteractive),
            onFrame: ({ phase }) => {
                if (phase === "begin") {
                    this.debugController?.updateCameraGuiState?.();
                }
            },
            getActiveArticleUrl: () => this.submissionController?.getActiveArticleUrl?.() ?? null
        });

        await this.visualizationController.init();
        InstancedMeshPool.setDefaultParent(this.visualizationController.scene);

        TextService.init({
            renderer: this.visualizationController.renderer,
            parent: this.visualizationController.scene,
            light: this.visualizationController.spotLight,
            lightTarget: this.visualizationController.spotLight?.target ?? null,
            camera: this.visualizationController.camera
        });

        await this.loadTextFonts();

        this.debugController = new DebugController({
            camera: this.visualizationController.camera,
            cameraController: this.visualizationController.cameraController,
            textGuiConfigs: TEXT_GUI_CONFIGS,
            materialGuiConfigs: MATERIAL_GUI_CONFIGS,
            onLutTextureLoaded: (texture3D) => this.visualizationController.applyLutTexture(texture3D),
            onGuiVisibilityChange: (visible) => {
                this.debugControlsVisible = visible;
            },
            onStatsVisibilityChange: (visible) => {
                this.statsVisible = visible;
            }
        });

        await this.debugController.init();
        this.setupLutControls();
        this.detailPanelController.initializeDetailPanel();
        this.initializeVisualizationToggle();
        this.visualizationController.start();
        this.runtimeState.three = true;
        this.loaderState.three = true;
        this.setVisualizationAvailability({
            d3: true,
            three: true
        });
        this.chromeController.applyInitialVisualizationMode();
        this.renderPendingResolvedArticle();
    }

    setVisualizationAvailability({ d3 = false, three = false } = {}) {
        const ready = d3 && three;

        if (this.viewToggleContainer != null) {
            this.viewToggleContainer.classList.toggle("is-visible", ready);
            this.viewToggleContainer.style.display = ready ? "" : "none";
        }

        if (this.threeCanvas != null) {
            this.threeCanvas.style.display = ready ? "" : "none";
        }

        if (this.d3CanvasContainer != null) {
            this.d3CanvasContainer.style.display = ready ? "" : "none";
        }

        if (!ready) {
            if (this.threeCanvas != null) {
                this.threeCanvas.style.opacity = "0";
            }

            if (this.d3CanvasContainer != null) {
                this.d3CanvasContainer.style.opacity = "0";
            }
        } else {
            this.chromeController?.updateRelationshipKeyVisibility();
        }
    }

    renderPendingResolvedArticle() {
        if (this.pendingResolvedArticle == null) {
            return;
        }

        if (!this.runtimeState.three || !this.runtimeState.d3) {
            return;
        }

        const pending = this.pendingResolvedArticle;
        this.pendingResolvedArticle = null;
        void this.handleResolvedArticle(pending.articleObject, pending.meta);
    }

    exposeGlobalApp() {
        const key = `apps_${this.performanceRef.timeOrigin}`;
        this.windowRef[key] ??= {};
        this.windowRef[key].pepe = this;
    }

    bindRuntimeListeners() {
        this.windowRef.addEventListener("resize", this.onWindowResize);
        this.windowRef.visualViewport?.addEventListener("resize", this.onWindowResize);
        this.windowRef.visualViewport?.addEventListener("scroll", this.onWindowResize);
    }

    initializeVisualizationToggle() {
        this.visualizationButtons.three?.addEventListener("click", () => {
            this.setVisualizationMode("three");
        });

        this.visualizationButtons.d3?.addEventListener("click", () => {
            this.setVisualizationMode("d3");
        });
    }

    async loadTextFonts() {
        await TextService.setFont("title", {
            jsonPath: "./resources/fonts/permanent_marker_regular_sdf.json",
            pngPath: "./resources/fonts/permanent_marker_regular_sdf.png",
            fontSize: 1,
            align: "center",
            anchor: "center",
            threshold: 0.72,
            color: "#000000",
            softness: 1.2,
            outlineOpacity: 0.0,
            outlineThickness: 0.0,
            outlineColor: "#000000",
            ambientStrength: 0.1,
            diffuseStrength: 0.2,
            specularStrength: 0.2,
            sheenStrength: 0.04,
            sheenPower: 500,
            lightIntensityScale: 0.01,
            maxGlyphs: 10000
        });

        await TextService.setFont("title-white", {
            jsonPath: "./resources/fonts/permanent_marker_regular_sdf.json",
            pngPath: "./resources/fonts/permanent_marker_regular_sdf.png",
            fontSize: 1,
            align: "center",
            anchor: "center",
            threshold: 0.72,
            color: "#FFFFFF",
            softness: 1.2,
            outlineOpacity: 0.0,
            outlineThickness: 0.0,
            outlineColor: "#000000",
            ambientStrength: 1.0,
            diffuseStrength: 1.0,
            specularStrength: 0.85,
            sheenStrength: 0.26,
            sheenPower: 30,
            lightIntensityScale: 0.01,
            maxGlyphs: 10000
        });

        await TextService.setFont("typewriter-black", {
            jsonPath: "./resources/fonts/special_elite.json",
            pngPath: "./resources/fonts/special_elite.png",
            fontSize: 1,
            align: "center",
            anchor: "center",
            threshold: 0.73,
            color: "#000000",
            softness: 0.3,
            outlineOpacity: 0.0,
            outlineThickness: 0.0,
            outlineColor: "#000000",
            ambientStrength: 1.0,
            diffuseStrength: 1.0,
            specularStrength: 0,
            sheenStrength: 0,
            sheenPower: 0,
            lightIntensityScale: 0,
            maxGlyphs: 100000
        });

        await TextService.setFont("typewriter-white", {
            jsonPath: "./resources/fonts/special_elite.json",
            pngPath: "./resources/fonts/special_elite.png",
            fontSize: 1,
            align: "center",
            anchor: "center",
            threshold: 0.73,
            color: "#FFFFFF",
            softness: 0.3,
            outlineOpacity: 0.0,
            outlineThickness: 0.0,
            outlineColor: "#FFFFFF",
            ambientStrength: 0.43,
            diffuseStrength: 1.0,
            specularStrength: 0.2,
            sheenStrength: 0.2,
            sheenPower: 10,
            lightIntensityScale: 0.01,
            maxGlyphs: 1000
        });
    }

    setupLutControls() {
        if (this.debugController?.gui == null) {
            return;
        }

        const lutFolder = this.debugController.gui.addFolder("lut");
        const lutState = this.debugController.lutParams;

        lutFolder.add(lutState, "skipComposer").name("skip effects").onChange((value) => {
            this.visualizationController.setSkipComposer(value);
        });
        lutFolder.add(lutState, "enabled").onChange((value) => {
            this.visualizationController.setLutEnabled(value);
        });
        lutFolder.add(lutState, "lut", this.debugController.lutPaths ?? []).onChange((value) => {
            lutState.lut = value;
            this.debugController.loadLut(value);
        });
        lutFolder.add(lutState, "intensity").min(0).max(1).onChange((value) => {
            this.visualizationController.setLutIntensity(value);
        });
    }

    focusAndSelectUrlInput() {
        if (this.urlInput == null) {
            return;
        }

        this.windowRef.requestAnimationFrame(() => {
            this.urlInput.focus();
            this.urlInput.select();
            this.showSupportedSites();
        });
    }

    getRenderDimensions() {
        const canvasRect = this.threeCanvas?.getBoundingClientRect?.();

        if (canvasRect != null && canvasRect.width > 0 && canvasRect.height > 0) {
            return {
                width: Math.floor(canvasRect.width),
                height: Math.floor(canvasRect.height)
            };
        }

        return {
            width: this.windowRef.visualViewport?.width ?? this.windowRef.innerWidth,
            height: this.windowRef.visualViewport?.height ?? this.windowRef.innerHeight
        };
    }

    onWindowResize() {
        this.updateViewportMetrics();
        this.visualizationController?.resize?.();
        this.updateArticleActionToolbarPosition();
        this.debugController?.updateCameraGuiState?.();
    }

    updateViewportMetrics() {
        this.chromeController.updateViewportMetrics();
    }

    normalizeUserUrl(raw) {
        return this.apiService.normalizeUserUrl(raw);
    }

    isSupportedSiteUrl(rawUrl) {
        return this.apiService.isSupportedSiteUrl(rawUrl);
    }

    getSupportedSiteDomains() {
        return this.apiService.getSupportedSiteDomains(this.supportedSites?.textContent ?? "");
    }

    handleInitialUrlParam() {
        const params = new URLSearchParams(this.windowRef.location.search);
        const initialUrl = params.get("url");

        if (!initialUrl || this.urlInput == null) {
            return;
        }

        this.urlInput.value = "";
        this.resetUrlInputMode();
        this.urlInput.value = initialUrl;
        this.onUrlInputChanged();
        this.updateSubmitButtonVisibility();

        if (this.normalizeUserUrl(initialUrl) != null) {
            this.onSubmitClicked();
        }
    }

    parseJsonRecursively(value) {
        return this.apiService.parseJsonRecursively(value);
    }

    makeQueueUrlKey(rawUrl) {
        return this.apiService.makeQueueUrlKey(rawUrl);
    }

    healthCheck() {
        return this.apiService.healthCheck();
    }

    getArticleByUrl(targetUrl) {
        return this.apiService.getArticleByUrl(targetUrl);
    }

    getArticleQueueRowByUrl(targetUrl) {
        return this.apiService.getArticleQueueRowByUrl(targetUrl);
    }

    fetchOwnershipTreeById(ownershipTreeId) {
        return this.apiService.fetchOwnershipTreeById(ownershipTreeId);
    }

    collectEvidence(ids) {
        return this.apiService.collectEvidence(ids);
    }

    collectEvidenceIds(obj) {
        if (!obj || typeof obj !== "object") {
            return;
        }

        if (Array.isArray(obj.evidence_ids)) {
            for (const id of obj.evidence_ids) {
                this.evidenceIds.add(id);
            }
        }

        if (Array.isArray(obj)) {
            for (const item of obj) {
                this.collectEvidenceIds(item);
            }
            return;
        }

        for (const key of Object.keys(obj)) {
            this.collectEvidenceIds(obj[key]);
        }
    }

    collectEntities(obj) {
        if (!obj || typeof obj !== "object") {
            return;
        }

        if (obj.id && obj.name && obj.entity_type) {
            if (obj.evidence_ids) {
                obj.evidence = this.getEvidence(obj.evidence_ids);
            }

            this.entities[obj.id] = new EntityModel(obj);
        }

        if (Array.isArray(obj)) {
            for (const item of obj) {
                this.collectEntities(item);
            }
            return;
        }

        for (const key of Object.keys(obj)) {
            this.collectEntities(obj[key]);
        }
    }

    collectRelationships(obj) {
        if (!obj || typeof obj !== "object") {
            return;
        }

        if (obj.id && obj.source_entity_id && obj.target_entity_id && obj.relation) {
            if (obj.evidence_ids) {
                obj.evidence = this.getEvidence(obj.evidence_ids);
            }

            this.relationships[obj.id] = new RelationshipModel({
                id: obj.id,
                source: obj.source_entity_id,
                target: obj.target_entity_id,
                relation: obj.relation,
                evidence: obj.evidence
            });
        }

        if (Array.isArray(obj)) {
            for (const item of obj) {
                this.collectRelationships(item);
            }
            return;
        }

        for (const key of Object.keys(obj)) {
            this.collectRelationships(obj[key]);
        }
    }

    getEvidence(ids) {
        const evidence = {};

        for (const id of ids ?? []) {
            evidence[id] = this.evidence[id];
        }

        return evidence;
    }

    resolveEntityById(entityId) {
        return this.entities?.[entityId] ?? null;
    }

    resolveEvidenceById(evidenceId) {
        return this.evidence?.[evidenceId] ?? null;
    }

    openDetailPanel(options = {}) {
        return this.detailPanelController.openDetailPanel(options);
    }

    closeDetailPanel() {
        return this.detailPanelController.closeDetailPanel();
    }

    openEntityDetailById(entityId) {
        return this.detailPanelController.openEntityDetailById(entityId);
    }

    openEvidenceDetailById(evidenceId) {
        return this.detailPanelController.openEvidenceDetailById(evidenceId);
    }

    renderSummaryBanner(text) {
        return this.summaryBannerController.renderSummaryBanner(text);
    }

    showNewSearchContainer() {
        return this.chromeController.showNewSearchContainer();
    }

    hideNewSearchContainer() {
        return this.chromeController.hideNewSearchContainer();
    }

    showShareContainer() {
        return this.chromeController.showShareContainer();
    }

    hideShareContainer() {
        return this.chromeController.hideShareContainer();
    }

    showSupportedSites() {
        return this.submissionController.showSupportedSites();
    }

    hideSupportedSites() {
        return this.submissionController.hideSupportedSites();
    }

    showForeground() {
        this.chromeController.showForeground();
        this.hideArticleStatusProgress();
    }

    hideForeground() {
        return this.chromeController.hideForeground();
    }

    setForegroundInteractive(isInteractive = true) {
        return this.chromeController.setForegroundInteractive(isInteractive);
    }

    hidePageBackground() {
        return this.pageBackgroundController?.hidePageBackground?.();
    }

    activateThreeCanvas() {
        return this.pageBackgroundController?.activateThreeCanvas?.();
    }

    startPageBackgroundFocusLoop() {
        return this.pageBackgroundController?.startPageBackgroundFocusLoop?.();
    }

    stopPageBackgroundFocusLoop() {
        return this.pageBackgroundController?.stopPageBackgroundFocusLoop?.();
    }

    clearCurrentArticleView() {
        this.chromeController.clearRelationshipKey();

        if (this.articleView == null) {
            this.visualizationController?.clearCurrentArticleView?.();
            return;
        }

        this.articleView.cleanupDynamicViews?.();
        this.articleView.hide?.();
        this.visualizationController?.scene?.remove?.(this.articleView.getRootGroup?.());
        ViewPool.returnView(this.articleView);
        this.articleView = null;
        this.visualizationController?.clearCurrentArticleView?.();
        this.startPageBackgroundFocusLoop();
    }

    ensureArticleStatusViews() {
        return this.visualizationController?.ensureArticleStatusViews?.();
    }

    hideArticleStatusProgress() {
        return this.visualizationController?.hideArticleStatusProgress?.();
    }

    updateArticleStatusProgress(articleObject) {
        return this.visualizationController?.updateArticleStatusProgress?.(articleObject);
    }

    applyArticleStatusCameraZoom() {
        return this.visualizationController?.applyArticleStatusCameraZoom?.();
    }

    applyResolvedArticleCameraView() {
        return this.visualizationController?.applyResolvedArticleCameraView?.();
    }

    setArticleStatusSpotlightEnabled(enabled = true) {
        return this.visualizationController?.setArticleStatusSpotlightEnabled?.(enabled);
    }

    startArticleLightingIntro() {
        return this.visualizationController?.startArticleLightingIntro?.();
    }

    setVisualizationMode(mode) {
        return this.chromeController.setVisualizationMode(mode);
    }

    updateArticleActionToolbarPosition() {
        return this.chromeController.updateArticleActionToolbarPosition();
    }

    updateSupportButtonsScale() {
        return this.chromeController.updateSupportButtonsScale();
    }

    updateMobileViewportAnchors() {
        return this.chromeController.updateMobileViewportAnchors();
    }

    updateRelationshipKeyVisibility(forceVisible = null) {
        return this.chromeController.updateRelationshipKeyVisibility(forceVisible);
    }

    renderRelationshipKey(items = []) {
        return this.chromeController.renderRelationshipKey(items);
    }

    clearRelationshipKey() {
        return this.chromeController.clearRelationshipKey();
    }

    updateAddressBarUrlParam(urlValue) {
        const normalizedUrl = this.normalizeUserUrl(urlValue);

        if (normalizedUrl == null) {
            return;
        }

        const nextUrl = new URL(this.windowRef.location.href);
        nextUrl.searchParams.set("url", normalizedUrl);
        this.windowRef.history.replaceState({}, "", nextUrl.toString());
    }

    onSubmitButtonPointerDown() {
        return this.submissionController.onSubmitButtonPointerDown();
    }

    onSubmitClicked(event) {
        return this.submissionController.onSubmitClicked(event);
    }

    onUrlInputChanged(event) {
        return this.submissionController.onUrlInputChanged(event);
    }

    onUrlInputPasted() {
        return this.submissionController.onUrlInputPasted();
    }

    updateSubmitButtonVisibility() {
        return this.submissionController.updateSubmitButtonVisibility();
    }

    resetUrlInputMode() {
        return this.submissionController.resetUrlInputMode();
    }

    cancelPendingSubmitStatusReset() {
        return this.submissionController.cancelPendingSubmitStatusReset();
    }

    scheduleSubmitStatusReset(options = {}) {
        return this.submissionController.scheduleSubmitStatusReset(options);
    }

    hideSubmitStatusTimer() {
        return this.submissionController.hideSubmitStatusTimer();
    }

    startSubmitStatusTimer(durationMs) {
        return this.submissionController.startSubmitStatusTimer(durationMs);
    }

    hideSubmitStatusMessage() {
        return this.submissionController.hideSubmitStatusMessage();
    }

    showSubmitStatusMessage(message) {
        return this.submissionController.showSubmitStatusMessage(message);
    }

    stopArticleStatusPolling() {
        return this.submissionController.stopArticleStatusPolling();
    }

    getActiveArticleUrl() {
        return this.submissionController.getActiveArticleUrl();
    }

    handlePendingArticleState(targetUrl, articleObject) {
        return this.submissionController.handlePendingArticleState(targetUrl, articleObject);
    }

    pollArticleStatus(targetUrl) {
        return this.submissionController.pollArticleStatus(targetUrl);
    }

    renderResolvedArticle(articleObject, meta = {}) {
        return this.submissionController.renderResolvedArticle(articleObject, meta);
    }

    async handleResolvedArticle(articleObject, { source = "resolved", targetUrl = null } = {}) {
        if (!this.runtimeState.three) {
            this.pendingResolvedArticle = {
                articleObject,
                meta: {
                    source,
                    targetUrl
                }
            };
            return true;
        }

        this.entities = {};
        this.relationships = {};
        this.evidenceIds = new Set();
        this.evidence = {};

        this.collectEvidenceIds(articleObject.ownershipTreeObj);
        const evidenceResult = await this.collectEvidence(this.evidenceIds);
        if (evidenceResult?.error != null || evidenceResult?.data == null) {
            console.warn("[evidence] collection failed", evidenceResult?.error ?? null);
            this.windowRef.location.reload();
            return false;
        }

        for (const [evidenceId, evidenceData] of Object.entries(evidenceResult.data)) {
            this.evidence[evidenceId] = new EvidenceModel(evidenceData);
        }

        this.collectEntities(articleObject.ownershipTreeObj);
        this.collectRelationships(articleObject.ownershipTreeObj);

        this.exposeGlobalApp();
        const store = this.windowRef[`apps_${this.performanceRef.timeOrigin}`].pepe;
        store.entities = this.entities;
        store.relationships = this.relationships;
        store.evidence = this.evidence;

        const articleModel = new ArticleModel(articleObject);
        const articleView = ViewPool.getView("article_view");
        articleView.setModel(articleModel);
        this.articleView = articleView;
        this.visualizationController.setArticleView(articleView);

        this.d3Graph.renderArticle(articleModel);
        this.renderRelationshipKey(this.d3Graph.getLegendItems?.() ?? []);
        this.updateArticleActionToolbarPosition();

        const d3Positions = this.d3Graph.getNoCommonOwnerPositions?.();
        if (d3Positions != null) {
            articleView.setD3OwnershipPositions(d3Positions, 0.1);
        }

        const articleUrl = articleModel.url ?? articleObject?.article?.url;
        if (articleUrl && this.articleUrlDisplay) {
            this.articleUrlDisplay.innerHTML = "";
            const link = this.documentRef.createElement("a");
            link.href = articleUrl.startsWith("http") ? articleUrl : `https://${articleUrl}`;
            link.target = "_blank";
            link.rel = "noopener noreferrer";
            link.textContent = articleUrl;
            this.articleUrlDisplay.appendChild(link);
        }

        const summaryText = articleObject?.ownershipTreeObj?.summary ?? articleObject?.ownership_tree?.summary;
        if (summaryText && this.summaryBanner) {
            this.renderSummaryBanner(summaryText);
        }

        this.visualizationController.scene.add(articleView.getRootGroup());
        this.startArticleLightingIntro();
        this.applyResolvedArticleCameraView();
        this.visualizationController.cameraController?.enable(true);

        return true;
    }
}

const LOADER_GROUPS = [
    [
        {
            path: "./components/ArticleStatusD3.js"
        },
        {
            path: "./components/Corkboard.js"
        },
        {
            path: "./components/NoCommonOwnerD3Chart.js"
        },
        {
            path: "./controllers/ArticleSubmissionController.js"
        },
        {
            path: "./controllers/ChromeController.js"
        },
        {
            path: "./controllers/DetailPanelController.js"
        },
        {
            path: "./controllers/PageBackgroundController.js"
        },
        {
            path: "./controllers/SummaryBannerController.js"
        },
        {
            path: "./models/EntityModel.js"
        },
        {
            path: "./models/EvidenceModel.js"
        },
        {
            path: "./models/OwnershipTreeModel.js"
        },
        {
            path: "./models/RelationshipModel.js"
        },
        {
            path: "./rendering/CameraLookSwoopPass.js"
        },
        {
            path: "./services/articleApiConfig.js"
        },
        {
            path: "./services/InputService.js"
        },
        {
            path: "./text/SDFTextMaterialReference.js"
        },
        {
            path: "./text/TextGeometryBuilder.js"
        },
        {
            path: "./text/TextInstanceHandle.js"
        },
        {
            path: "./text/TextLayoutEngine.js"
        },
        {
            path: "./text/TinySDF.js"
        },
        {
            path: "./utils/MeshInstance.js"
        },
        {
            path: "./utils/pointUtils.js"
        },
        {
            path: "./utils/Queue.js"
        },
        {
            path: "./utils/ThreeJSUtils.js"
        },
        {
            path: "./utils/TrashMan.js"
        },
        {
            path: "./utils/vectorConstants.js"
        },
        {
            path: "./views/View.js"
        }
    ],
    [
        {
            path: "./components/Arrow.js"
        },
        {
            path: "./components/ArticleD3Graph.js"
        },
        {
            path: "./models/InvestigationModel.js"
        },
        {
            path: "./models/NewsSiteModel.js"
        },
        {
            path: "./rendering/CameraPanPass.js"
        },
        {
            path: "./rendering/CameraZoomPass.js"
        },
        {
            path: "./services/ArticleApiService.js"
        },
        {
            path: "./text/DynamicSDFont.js"
        },
        {
            path: "./text/SDFTextInstance.js"
        },
        {
            path: "./utils/AssetPool.js"
        },
        {
            path: "./utils/getTiltQuaternion.js"
        },
        {
            path: "./utils/ViewPool.js"
        },
        {
            path: "./views/NodeView.js"
        }
    ],
    [
        {
            path: "./components/Paper.js"
        },
        {
            path: "./models/ArticleModel.js"
        },
        {
            path: "./rendering/CameraController.js"
        },
        {
            path: "./text/createFontFromAtlasJsonAndPng.js"
        },
        {
            path: "./text/SDFTextInstancedLayer.js"
        },
        {
            path: "./views/EdgeView.js"
        },
        {
            path: "./views/OwnershipChainView.js"
        },
        {
            path: "./views/OwnerTreeView.js"
        }
    ],
    [
        {
            path: "./services/TextService.js"
        },
        {
            path: "./views/ArticleView.js"
        },
        {
            path: "./views/ThreadView.js"
        }
    ],
    [
        {
            path: "./components/IndexCard.js"
        },
        {
            path: "./components/RaisedLabel.js"
        },
        {
            path: "./components/StickyNote.js"
        },
        {
            path: "./components/TapeLabel.js"
        },
        {
            path: "./controllers/DebugController.js"
        },
        {
            path: "./views/EntityViewBig.js"
        },
        {
            path: "./views/EvidenceView.js"
        }
    ],
    [
        {
            path: "./views/ArrowRelationshipView.js"
        },
        {
            path: "./views/EntityViewNew.js"
        },
        {
            path: "./views/EvidenceGroupView.js"
        },
        {
            path: "./views/RelationshipView.js"
        }
    ],
    [
        {
            path: "./views/ArticleStatus.js"
        }
    ],
    [
        {
            path: "./controllers/VisualizationController.js"
        }
    ],
    [
        {
            kind: "script",
            path: "./js/thirdparty/d3-7.9.0/d3.js",
            globalName: "d3",
            storePath: "thirdparty.d3"
        },
        {
            kind: "script",
            path: "./js/thirdparty/stats.min.js",
            globalName: "Stats",
            storePath: "thirdparty.Stats"
        }
    ]
];

const RETRIEVAL_LOADER_GROUPS = [
    [
        {
            path: "./services/articleApiConfig.js"
        }
    ],
    [
        {
            path: "./controllers/PageBackgroundController.js"
        },
        {
            path: "./controllers/ChromeController.js"
        },
        {
            path: "./controllers/DetailPanelController.js"
        },
        {
            path: "./controllers/SummaryBannerController.js"
        },
        {
            path: "./controllers/ArticleSubmissionController.js"
        },
        {
            path: "./services/ArticleApiService.js"
        },
        {
            path: "./utils/TrashMan.js"
        }
    ]
];

const D3_LOADER_GROUPS = [
    [
        {
            kind: "script",
            path: "./js/thirdparty/d3-7.9.0/d3.js",
            globalName: "d3",
            storePath: "thirdparty.d3"
        }
    ],
    [
        {
            path: "./components/NoCommonOwnerD3Chart.js"
        },
        {
            path: "./components/ArticleStatusD3.js"
        }
    ],
    [
        {
            path: "./components/ArticleD3Graph.js"
        }
    ]
];

const THREE_LOADER_GROUPS = LOADER_GROUPS.slice(0, -1);
const THREE_STATS_GROUP = [
    [
        {
            kind: "script",
            path: "./js/thirdparty/stats.min.js",
            globalName: "Stats",
            storePath: "thirdparty.Stats"
        }
    ]
];

const LOADER_PHASES = [
    {
        name: "retrieval",
        groups: RETRIEVAL_LOADER_GROUPS
    },
    {
        name: "d3",
        groups: D3_LOADER_GROUPS
    },
    {
        name: "three",
        groups: [...THREE_LOADER_GROUPS, ...THREE_STATS_GROUP]
    }
];

function getLoadedModule(relativePath) {
    const appStore = window[`apps_${performance.timeOrigin}`];
    if (appStore == null || appStore.modules == null) {
        throw new Error("App modules have not been loaded yet.");
    }

    const pathParts = relativePath.split(".");
    let current = appStore.modules;

    for (const part of pathParts) {
        current = current?.[part];
    }

    if (current == null) {
        throw new Error(`Missing loaded module: ${relativePath}`);
    }

    return current;
}

function bindCoreModules() {
    ArticleApiService = getLoadedModule("services.ArticleApiService").ArticleApiService;
    ChromeController = getLoadedModule("controllers.ChromeController").ChromeController;
    PageBackgroundController = getLoadedModule("controllers.PageBackgroundController").PageBackgroundController;
    DetailPanelController = getLoadedModule("controllers.DetailPanelController").DetailPanelController;
    SummaryBannerController = getLoadedModule("controllers.SummaryBannerController").SummaryBannerController;
    ArticleSubmissionController = getLoadedModule("controllers.ArticleSubmissionController").ArticleSubmissionController;
    TrashMan = getLoadedModule("utils.TrashMan").TrashMan;
}

function bindD3Modules() {
    ArticleD3Graph = getLoadedModule("components.ArticleD3Graph").ArticleD3Graph;
}

function bindVisualModules() {
    VisualizationController = getLoadedModule("controllers.VisualizationController").VisualizationController;
    DebugController = getLoadedModule("controllers.DebugController").DebugController;
    TextService = getLoadedModule("services.TextService").TextService;
    InstancedMeshPool = getLoadedModule("utils.AssetPool").InstancedMeshPool;
    TrashMan = getLoadedModule("utils.TrashMan").TrashMan;
    ArticleModel = getLoadedModule("models.ArticleModel").ArticleModel;
    EntityModel = getLoadedModule("models.EntityModel").EntityModel;
    RelationshipModel = getLoadedModule("models.RelationshipModel").RelationshipModel;
    EvidenceModel = getLoadedModule("models.EvidenceModel").EvidenceModel;
    ViewPool = getLoadedModule("utils.ViewPool").ViewPool;
    PAPER_MATERIAL_CONFIG = getLoadedModule("components.Paper").PAPER_MATERIAL_CONFIG;
    applyPaperMaterialConfig = getLoadedModule("components.Paper").applyPaperMaterialConfig;
    CORKBOARD_MATERIAL_CONFIG = getLoadedModule("components.Corkboard").CORKBOARD_MATERIAL_CONFIG;
    applyCorkboardMaterialConfig = getLoadedModule("components.Corkboard").applyCorkboardMaterialConfig;
    STICKY_NOTE_MATERIAL_CONFIG = getLoadedModule("components.StickyNote").STICKY_NOTE_MATERIAL_CONFIG;
    applyStickyNoteMaterialConfig = getLoadedModule("components.StickyNote").applyStickyNoteMaterialConfig;
    INDEX_CARD_MATERIAL_CONFIG = getLoadedModule("components.IndexCard").INDEX_CARD_MATERIAL_CONFIG;
    applyIndexCardMaterialConfig = getLoadedModule("components.IndexCard").applyIndexCardMaterialConfig;
    TAPE_LABEL_MATERIAL_CONFIG = getLoadedModule("components.TapeLabel").TAPE_LABEL_MATERIAL_CONFIG;
    applyTapeLabelMaterialConfig = getLoadedModule("components.TapeLabel").applyTapeLabelMaterialConfig;
    RAISED_LABEL_MATERIAL_CONFIG = getLoadedModule("components.RaisedLabel").RAISED_LABEL_MATERIAL_CONFIG;
    applyRaisedLabelMaterialConfig = getLoadedModule("components.RaisedLabel").applyRaisedLabelMaterialConfig;
    THREAD_MATERIAL_CONFIG = getLoadedModule("views.ThreadView").THREAD_MATERIAL_CONFIG;
    applyThreadMaterialConfig = getLoadedModule("views.ThreadView").applyThreadMaterialConfig;

    MATERIAL_GUI_CONFIGS = {
        paper: {
            config: PAPER_MATERIAL_CONFIG,
            apply: applyPaperMaterialConfig
        },
        corkboard: {
            config: CORKBOARD_MATERIAL_CONFIG,
            apply: applyCorkboardMaterialConfig
        },
        stickyNote: {
            config: STICKY_NOTE_MATERIAL_CONFIG,
            apply: applyStickyNoteMaterialConfig
        },
        indexCard: {
            config: INDEX_CARD_MATERIAL_CONFIG,
            apply: applyIndexCardMaterialConfig
        },
        tapeLabel: {
            config: TAPE_LABEL_MATERIAL_CONFIG,
            apply: applyTapeLabelMaterialConfig
        },
        raisedLabel: {
            config: RAISED_LABEL_MATERIAL_CONFIG,
            apply: applyRaisedLabelMaterialConfig
        },
        thread: {
            config: THREAD_MATERIAL_CONFIG,
            apply: applyThreadMaterialConfig
        }
    };
}

class Loader {
    static phases = LOADER_PHASES;
    static progressState = {
        current: 0,
        total: 0
    };

    static countDescriptors(phases = Loader.phases) {
        return phases.reduce((phaseTotal, phase) => {
            return phaseTotal + phase.groups.reduce((groupTotal, group) => groupTotal + group.length, 0);
        }, 0);
    }

    static ensureModuleRoot() {
        const key = `apps_${performance.timeOrigin}`;
        window[key] ??= {};
        window[key].modules ??= {};
        return window[key].modules;
    }

    static ensurePath(root, relativePath) {
        const cleanPath = relativePath.replace(/^\.\//, "").replace(/\.js$/, "");
        const parts = cleanPath.split("/");
        let current = root;

        for (const part of parts) {
            current[part] ??= {};
            current = current[part];
        }

        return current;
    }

    static storeModule(root, relativePath, moduleSpec) {
        const leaf = Loader.ensurePath(root, relativePath);
        for (const [exportName, value] of Object.entries(moduleSpec)) {
            leaf[exportName] = value;
        }
        return leaf;
    }

    static storeValue(root, relativePath, exportName, value) {
        const leaf = Loader.ensurePath(root, relativePath);
        leaf[exportName] = value;
        return leaf;
    }

    static dispatchStage(stage, details = {}) {
        window.dispatchEvent(new CustomEvent(LOADER_STAGE_EVENT, {
            detail: {
                stage,
                ...details
            }
        }));
    }

    static dispatchProgress(progress, details = {}) {
        window.dispatchEvent(new CustomEvent(LOADER_PROGRESS_EVENT, {
            detail: {
                current: progress.current,
                total: progress.total,
                phase: progress.phase ?? null,
                path: progress.path ?? null,
                ...details
            }
        }));
    }

    static async loadScript(src, globalName = null) {
        if (globalName != null && window[globalName] != null) {
            return;
        }

        return new Promise((resolve, reject) => {
            const existingScript = document.querySelector(`script[data-loader-src="${src}"]`);
            if (existingScript != null) {
                if (existingScript.dataset.loaderLoaded === "true") {
                    resolve();
                    return;
                }

                existingScript.addEventListener("load", resolve, { once: true });
                existingScript.addEventListener("error", () => {
                    reject(new Error(`Failed to load script: ${src}`));
                }, { once: true });
                return;
            }

            const script = document.createElement("script");
            script.async = true;
            script.src = src;
            script.dataset.loaderSrc = src;
            script.addEventListener("load", resolve, { once: true });
            script.addEventListener("error", () => {
                reject(new Error(`Failed to load script: ${src}`));
            }, { once: true });
            script.addEventListener("load", () => {
                script.dataset.loaderLoaded = "true";
            }, { once: true });
            document.head.appendChild(script);
        });
    }

    static async load(phases = Loader.phases) {
        const modulesRoot = Loader.ensureModuleRoot();
        const progress = Loader.progressState;
        progress.total = Loader.countDescriptors(Loader.phases);
        if (progress.current === 0) {
            Loader.dispatchProgress(progress, {
                started: true
            });
        }

        for (const phase of phases) {
            for (const group of phase.groups) {
                await Promise.all(group.map(async (descriptor) => {
                    if (descriptor.kind === "script") {
                        await Loader.loadScript(descriptor.path, descriptor.globalName);

                        const globalName = descriptor.globalName;
                        const globalValue = window[globalName];
                        if (globalValue == null) {
                            throw new Error(`Script loaded without exposing ${globalName}: ${descriptor.path}`);
                        }

                        Loader.storeValue(modulesRoot, descriptor.storePath ?? `thirdparty.${globalName}`, globalName, globalValue);
                        progress.current += 1;
                        progress.phase = phase.name;
                        progress.path = descriptor.path;
                        Loader.dispatchProgress(progress);
                        return;
                    }

                    const moduleSpec = await import(descriptor.path);
                    const exportMap = { ...moduleSpec };

                    if (Array.isArray(descriptor.imports)) {
                        for (const exportName of descriptor.imports) {
                            exportMap[exportName] = moduleSpec[exportName];
                        }
                    }

                    if (descriptor.className != null) {
                        exportMap[descriptor.className] = moduleSpec[descriptor.className] ?? moduleSpec.default ?? moduleSpec[descriptor.className];
                    } else if (moduleSpec.default != null) {
                        const fallbackName = descriptor.path
                            .replace(/^\.\//, "")
                            .replace(/\.js$/, "")
                            .split("/")
                            .pop();
                        exportMap[fallbackName] = moduleSpec.default;
                    }

                    Loader.storeModule(modulesRoot, descriptor.path, exportMap);
                    progress.current += 1;
                    progress.phase = phase.name;
                    progress.path = descriptor.path;
                    Loader.dispatchProgress(progress);
                }));
            }

            const available = phase.name === "retrieval"
                ? {
                    retrieval: true,
                    d3: false,
                    three: false
                }
                : phase.name === "d3"
                    ? {
                        retrieval: true,
                        d3: true,
                        three: false
                    }
                    : {
                        retrieval: true,
                        d3: true,
                        three: true
                    };

            Loader.dispatchStage(phase.name, {
                available,
                progress: {
                    current: progress.current,
                    total: progress.total
                }
            });
        }

        Loader.dispatchProgress(progress, {
            complete: true
        });
    }
}

async function bootstrapApp() {
    await Loader.load([LOADER_PHASES[0]]);
    bindCoreModules();
    const app = new App();
    await app.bootstrapPromise;
    window.__pepeApp = app;
    app.onLoaderStage({ detail: { stage: "retrieval" } });
    Loader.load(LOADER_PHASES.slice(1)).catch((error) => {
        console.error(error);
    });
    return app;
}

bootstrapApp().catch((error) => {
    console.error(error);
});

export { App, Loader };
