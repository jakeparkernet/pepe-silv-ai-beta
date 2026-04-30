import { ArticleApiService } from "./services/ArticleApiService.js";
import { ChromeController } from "./controllers/ChromeController.js";
import { PageBackgroundController } from "./controllers/PageBackgroundController.js";
import { VisualizationController } from "./controllers/VisualizationController.js";
import { DetailPanelController } from "./controllers/DetailPanelController.js";
import { SummaryBannerController } from "./controllers/SummaryBannerController.js";
import { DebugController } from "./controllers/DebugController.js";
import { ArticleSubmissionController } from "./controllers/ArticleSubmissionController.js";

import { TextService } from "./services/TextService.js";
import { InstancedMeshPool } from "./utils/AssetPool.js";
import { TrashMan } from "./utils/TrashMan.js";
import { ArticleD3Graph } from "./components/ArticleD3Graph.js";
import { ArticleModel } from "./models/ArticleModel.js";
import { EntityModel } from "./models/EntityModel.js";
import { RelationshipModel } from "./models/RelationshipModel.js";
import { EvidenceModel } from "./models/EvidenceModel.js";
import { ViewPool } from "./utils/ViewPool.js";

import { PAPER_MATERIAL_CONFIG, applyPaperMaterialConfig } from "./components/Paper.js";
import { CORKBOARD_MATERIAL_CONFIG, applyCorkboardMaterialConfig } from "./components/Corkboard.js";
import { STICKY_NOTE_MATERIAL_CONFIG, applyStickyNoteMaterialConfig } from "./components/StickyNote.js";
import { INDEX_CARD_MATERIAL_CONFIG, applyIndexCardMaterialConfig } from "./components/IndexCard.js";
import { TAPE_LABEL_MATERIAL_CONFIG, applyTapeLabelMaterialConfig } from "./components/TapeLabel.js";
import { RAISED_LABEL_MATERIAL_CONFIG, applyRaisedLabelMaterialConfig } from "./components/RaisedLabel.js";
import { THREAD_MATERIAL_CONFIG, applyThreadMaterialConfig } from "./views/ThreadView.js";

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

const MATERIAL_GUI_CONFIGS = {
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

        this.entities = {};
        this.relationships = {};
        this.evidenceIds = new Set();
        this.evidence = {};
        this.articleView = null;

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

        this.d3Graph = new ArticleD3Graph("#d3-canvas", "#d3-canvas-container");

        this.pageBackgroundController = new PageBackgroundController({
            dom: {
                pageBackground: this.pageBackground,
                pageBackgroundPlane: this.pageBackgroundPlane,
                pageBackgroundSharpLayer: this.pageBackgroundSharpLayer,
                pageBackgroundBlurLayer: this.pageBackgroundBlurLayer,
                threeCanvas: this.threeCanvas
            }
        });

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
            callbacks: {
                onVisualizationModeChange: (mode) => this.visualizationController.setVisualizationMode(mode)
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

        this.debugControlsVisible = false;
        this.statsVisible = false;
        this.bootstrapPromise = this.init().catch((error) => {
            console.error(error);
        });
    }

    async init() {
        new TrashMan(this);
        this.exposeGlobalApp();

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

        await this.debugController.init();
        this.setupLutControls();
        this.detailPanelController.initializeDetailPanel();
        this.chromeController.initialize();
        this.pageBackgroundController.initialize();

        this.bindRuntimeListeners();
        this.bindSubmitListeners();
        this.initializeVisualizationToggle();
        this.updateViewportMetrics();

        this.visualizationController.start();
        this.chromeController.showForeground();
        this.focusAndSelectUrlInput();
        this.handleInitialUrlParam();
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

    bindSubmitListeners() {
        this.submitButton?.addEventListener("pointerdown", this.onSubmitButtonPointerDown);
        this.submitButton?.addEventListener("click", this.onSubmitClicked);
        this.urlInput?.addEventListener("input", this.onUrlInputChanged);
        this.urlInput?.addEventListener("paste", this.onUrlInputPasted);
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
        this.visualizationController.resize();
        this.updateArticleActionToolbarPosition();
        this.debugController.updateCameraGuiState();
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
        return this.pageBackgroundController.hidePageBackground();
    }

    activateThreeCanvas() {
        return this.pageBackgroundController.activateThreeCanvas();
    }

    startPageBackgroundFocusLoop() {
        return this.pageBackgroundController.startPageBackgroundFocusLoop();
    }

    stopPageBackgroundFocusLoop() {
        return this.pageBackgroundController.stopPageBackgroundFocusLoop();
    }

    clearCurrentArticleView() {
        this.chromeController.clearRelationshipKey();

        if (this.articleView == null) {
            this.visualizationController.clearCurrentArticleView();
            return;
        }

        this.articleView.cleanupDynamicViews?.();
        this.articleView.hide?.();
        this.visualizationController.scene?.remove?.(this.articleView.getRootGroup?.());
        ViewPool.returnView(this.articleView);
        this.articleView = null;
        this.visualizationController.clearCurrentArticleView();
        this.startPageBackgroundFocusLoop();
    }

    ensureArticleStatusViews() {
        return this.visualizationController.ensureArticleStatusViews();
    }

    hideArticleStatusProgress() {
        return this.visualizationController.hideArticleStatusProgress();
    }

    updateArticleStatusProgress(articleObject) {
        return this.visualizationController.updateArticleStatusProgress(articleObject);
    }

    applyArticleStatusCameraZoom() {
        return this.visualizationController.applyArticleStatusCameraZoom();
    }

    applyResolvedArticleCameraView() {
        return this.visualizationController.applyResolvedArticleCameraView();
    }

    setArticleStatusSpotlightEnabled(enabled = true) {
        return this.visualizationController.setArticleStatusSpotlightEnabled(enabled);
    }

    startArticleLightingIntro() {
        return this.visualizationController.startArticleLightingIntro();
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

export { App };
