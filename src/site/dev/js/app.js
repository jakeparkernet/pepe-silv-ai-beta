import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

import * as THREE from "three";
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { SSAARenderPass } from 'three/addons/postprocessing/SSAARenderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { LUTPass } from 'three/addons/postprocessing/LUTPass.js';
import { TAARenderPass } from 'three/addons/postprocessing/TAARenderPass.js';
import { LUTImageLoader } from 'three/addons/loaders/LUTImageLoader.js';
import { GUI } from 'three/addons/libs/lil-gui.module.min.js';

import { CameraController } from "./rendering/CameraController.js"
import { InstancedMeshPool } from "./utils/AssetPool.js";
import { TextService } from "./services/TextService.js";
import { InputService } from "./services/InputService.js";
import { TrashMan } from "./utils/TrashMan.js"
import { ArticleD3Graph } from "./components/ArticleD3Graph.js";
import { ArticleStatusD3 } from "./components/ArticleStatusD3.js";

import { ArticleModel } from "./models/ArticleModel.js";
import { EntityModel } from "./models/EntityModel.js";
import { RelationshipModel } from "./models/RelationshipModel.js";

import { ViewPool } from "./utils/ViewPool.js";
import { EvidenceModel } from "./models/EvidenceModel.js";
import { PAPER_MATERIAL_CONFIG, applyPaperMaterialConfig } from "./components/Paper.js";
import { CORKBOARD_MATERIAL_CONFIG, applyCorkboardMaterialConfig } from "./components/Corkboard.js";
import { STICKY_NOTE_MATERIAL_CONFIG, applyStickyNoteMaterialConfig } from "./components/StickyNote.js";
import { INDEX_CARD_MATERIAL_CONFIG, applyIndexCardMaterialConfig } from "./components/IndexCard.js";
import { TAPE_LABEL_MATERIAL_CONFIG, applyTapeLabelMaterialConfig } from "./components/TapeLabel.js";
import { RAISED_LABEL_MATERIAL_CONFIG, applyRaisedLabelMaterialConfig } from "./components/RaisedLabel.js";
import { THREAD_MATERIAL_CONFIG, applyThreadMaterialConfig } from "./views/ThreadView.js";
import { ArticleStatus } from "./views/ArticleStatus.js";

const MAIN_RENDER_LAYER = 0;
const SDF_TEXT_RENDER_LAYER = 1;
const PEPE_BG_IMAGES = [
    "./resources/pepe-bg-1.png",
    "./resources/pepe-bg-2.png",
    "./resources/pepe-bg-3.png"
];
const BACKGROUND_PERSPECTIVE_PX = 500;
const BACKGROUND_ROTATE_Y_MIN = -18;
const BACKGROUND_ROTATE_Y_MAX = 18;
const BACKGROUND_SCALE_MIN = 0.69;
const BACKGROUND_SCALE_MAX = 1.24;
const BACKGROUND_POSITION_X_MIN = 42;
const BACKGROUND_POSITION_X_MAX = 58;
const BACKGROUND_POSITION_Y_MIN = 42;
const BACKGROUND_POSITION_Y_MAX = 58;
const BACKGROUND_VIGNETTE_MIN = 0.3;
const BACKGROUND_VIGNETTE_MAX = 0.7;
const BACKGROUND_FOCUS_INTERVAL_MIN_MS = 3000;
const BACKGROUND_FOCUS_INTERVAL_MAX_MS = 5000;
const BACKGROUND_FOCUS_TRANSITION_MIN_MS = 1600;
const BACKGROUND_FOCUS_TRANSITION_MAX_MS = 2600;
const BACKGROUND_FOCUS_EASING = "cubic-bezier(0.28, 0.02, 0.18, 1)";
const BACKGROUND_RACK_FOCUS_DELAY_MS = 1000;
const BACKGROUND_SHARP_LAYER_BLUR_MIN = 0.2;
const BACKGROUND_SHARP_LAYER_BLUR_MAX = 1.2;
const BACKGROUND_BLUR_LAYER_MIN = 3;
const BACKGROUND_BLUR_LAYER_MAX = 11;
const BACKGROUND_BLUR_OPACITY_MIN = 0.05;
const BACKGROUND_BLUR_OPACITY_MAX = 0.3;
const BACKGROUND_FOCUS_SPLIT_MIN = 2;
const BACKGROUND_FOCUS_SPLIT_MAX = 20;
const BACKGROUND_FOCUS_SOFTNESS_MIN = 2;
const BACKGROUND_FOCUS_SOFTNESS_MAX = 6;
const ENABLE_PAGE_BACKGROUND = true;
const ARTICLE_LIGHTING_BLACKOUT_DURATION_MS = 500;
const ARTICLE_LIGHTING_AMBIENT_LOW_MULTIPLIER = 0.0;
const ARTICLE_LIGHTING_AMBIENT_TO_LOW_DURATION_MS = 100;
const ARTICLE_LIGHTING_AMBIENT_TO_FULL_DURATION_MS = 600;
const ARTICLE_LIGHTING_SPOTLIGHT_DELAY_MS = 100;
const ARTICLE_LIGHTING_SPOTLIGHT_FLARE_DURATION_MS = 800;
const ARTICLE_LIGHTING_SPOTLIGHT_ANGLE_FLARE_MULTIPLIER = 1.1;
const ARTICLE_LIGHTING_SPOTLIGHT_PENUMBRA_FLARE_OFFSET = 0.35;
const ARTICLE_LIGHTING_SPOTLIGHT_FLARE_INTENSITY_MULTIPLIER = 1.3;
const FOREGROUND_FADE_OUT_MS = 400;
const SUBMIT_STATUS_FADE_MS = 200;
const SUBMIT_STATUS_INPUT_CLEAR_DELAY_MS = 5000;
const ARTICLE_HOVER_PLANE_FADE_IN_MS = 120;
const ARTICLE_HOVER_PLANE_OPACITY = 0.18;

const CAMERA_MAX_FOV = 120;

const CAMERA_STATUS_ZOOM = Object.freeze({
    mode: "fov",
    fov: 30
});
const CAMERA_STATUS_FOLLOW_POSITION_OFFSET = Object.freeze({
    x: 0,
    y: 1.5
});
const CAMERA_ARTICLE_VIEW_ZOOM = Object.freeze({
    mode: "fov",
    fov: 90
});

class App {
    constructor() {
        this.onWindowResize = this.onWindowResize.bind(this);
        this.getRenderDimensions = this.getRenderDimensions.bind(this);
        this.init = this.init.bind(this);
        this.healthCheck = this.healthCheck.bind(this);
        this.getArticleByUrl = this.getArticleByUrl.bind(this);
        this.getArticleQueueRowByUrl = this.getArticleQueueRowByUrl.bind(this);
        this.fetchOwnershipTreeById = this.fetchOwnershipTreeById.bind(this);
        this.getQueueStatusMessage = this.getQueueStatusMessage.bind(this);
        this.logArticleStatusCheck = this.logArticleStatusCheck.bind(this);
        this.pollArticleStatus = this.pollArticleStatus.bind(this);
        this.handlePendingArticleState = this.handlePendingArticleState.bind(this);
        this.stopArticleStatusPolling = this.stopArticleStatusPolling.bind(this);
        this.getActiveArticleUrl = this.getActiveArticleUrl.bind(this);
        this.ensureArticleStatusViews = this.ensureArticleStatusViews.bind(this);
        this.hideArticleStatusProgress = this.hideArticleStatusProgress.bind(this);
        this.updateArticleStatusProgress = this.updateArticleStatusProgress.bind(this);
        this.renderResolvedArticle = this.renderResolvedArticle.bind(this);
        this.parseJsonRecursively = this.parseJsonRecursively.bind(this);
        this.onSubmitClicked = this.onSubmitClicked.bind(this);
        this.render = this.render.bind(this);
        this.onLutLoaded = this.onLutLoaded.bind(this);
        this.loadLut = this.loadLut.bind(this);
        this.collectEntities = this.collectEntities.bind(this);
        this.collectRelationships = this.collectRelationships.bind(this);
        this.collectEvidenceIds = this.collectEvidenceIds.bind(this);
        this.collectEvidence = this.collectEvidence.bind(this);
        this.setCustomRenderSorting = this.setCustomRenderSorting.bind(this);
        this.updateCameraGuiState = this.updateCameraGuiState.bind(this);
        this.setupTextGui = this.setupTextGui.bind(this);
        this.setupMaterialGui = this.setupMaterialGui.bind(this);
        this.setVisualizationMode = this.setVisualizationMode.bind(this);
        this.getInitialVisualizationMode = this.getInitialVisualizationMode.bind(this);
        this.applyInitialVisualizationMode = this.applyInitialVisualizationMode.bind(this);
        this.initializeVisualizationToggle = this.initializeVisualizationToggle.bind(this);
        this.initializeDetailPanel = this.initializeDetailPanel.bind(this);
        this.openDetailPanel = this.openDetailPanel.bind(this);
        this.closeDetailPanel = this.closeDetailPanel.bind(this);
        this.formatDetailPanelContent = this.formatDetailPanelContent.bind(this);
        this.renderDetailPanelContent = this.renderDetailPanelContent.bind(this);
        this.renderEntityDetail = this.renderEntityDetail.bind(this);
        this.renderRelationshipDetail = this.renderRelationshipDetail.bind(this);
        this.renderEvidenceDetail = this.renderEvidenceDetail.bind(this);
        this.createDetailLayout = this.createDetailLayout.bind(this);
        this.createDetailSection = this.createDetailSection.bind(this);
        this.createFieldListSection = this.createFieldListSection.bind(this);
        this.createField = this.createField.bind(this);
        this.createChipSection = this.createChipSection.bind(this);
        this.createRawSection = this.createRawSection.bind(this);
        this.resolveEntityById = this.resolveEntityById.bind(this);
        this.normalizeDetailInput = this.normalizeDetailInput.bind(this);
        this.isProbablyUrl = this.isProbablyUrl.bind(this);
        this.normalizeUrlForHref = this.normalizeUrlForHref.bind(this);
        this.createUrlLink = this.createUrlLink.bind(this);
        this.createDetailValueNode = this.createDetailValueNode.bind(this);
        this.openEntityDetailById = this.openEntityDetailById.bind(this);
        this.resolveEvidenceById = this.resolveEvidenceById.bind(this);
        this.openEvidenceDetailById = this.openEvidenceDetailById.bind(this);
        this.createReferenceLink = this.createReferenceLink.bind(this);
        this.renderRawValue = this.renderRawValue.bind(this);
        this.startArticleLightingIntro = this.startArticleLightingIntro.bind(this);
        this.updateArticleLightingIntro = this.updateArticleLightingIntro.bind(this);
        this.hideSubmitStatusMessage = this.hideSubmitStatusMessage.bind(this);
        this.showSubmitStatusMessage = this.showSubmitStatusMessage.bind(this);
        this.setForegroundInteractive = this.setForegroundInteractive.bind(this);
        this.applyCameraZoomPreset = this.applyCameraZoomPreset.bind(this);
        this.applyArticleStatusCameraZoom = this.applyArticleStatusCameraZoom.bind(this);
        this.applyResolvedArticleCameraZoom = this.applyResolvedArticleCameraZoom.bind(this);
        this.hideForeground = this.hideForeground.bind(this);
        this.showForeground = this.showForeground.bind(this);
        this.handleInitialUrlParam = this.handleInitialUrlParam.bind(this);
        this.updateAddressBarUrlParam = this.updateAddressBarUrlParam.bind(this);
        this.initializeNewSearch = this.initializeNewSearch.bind(this);
        this.initializeShareButton = this.initializeShareButton.bind(this);
        this.initializeSupportCta = this.initializeSupportCta.bind(this);
        this.updateSupportButtonsScale = this.updateSupportButtonsScale.bind(this);
        this.updateMobileViewportAnchors = this.updateMobileViewportAnchors.bind(this);
        this.renderRelationshipKey = this.renderRelationshipKey.bind(this);
        this.updateRelationshipKeyVisibility = this.updateRelationshipKeyVisibility.bind(this);
        this.clearRelationshipKey = this.clearRelationshipKey.bind(this);
        this.updateArticleActionToolbarPosition = this.updateArticleActionToolbarPosition.bind(this);
        this.showNewSearchContainer = this.showNewSearchContainer.bind(this);
        this.hideNewSearchContainer = this.hideNewSearchContainer.bind(this);
        this.showShareContainer = this.showShareContainer.bind(this);
        this.hideShareContainer = this.hideShareContainer.bind(this);
        this.onShareButtonClicked = this.onShareButtonClicked.bind(this);
        this.showShareFeedback = this.showShareFeedback.bind(this);
        this.hideShareFeedback = this.hideShareFeedback.bind(this);
        this.copyShareUrlToClipboard = this.copyShareUrlToClipboard.bind(this);
        this.clearCurrentArticleView = this.clearCurrentArticleView.bind(this);
        this.onSubmitButtonPointerDown = this.onSubmitButtonPointerDown.bind(this);
        this.startForegroundFadeOut = this.startForegroundFadeOut.bind(this);
        this.fadeOutForeground = this.fadeOutForeground.bind(this);
        this.onUrlInputChanged = this.onUrlInputChanged.bind(this);
        this.onUrlInputPasted = this.onUrlInputPasted.bind(this);
        this.updateSubmitButtonVisibility = this.updateSubmitButtonVisibility.bind(this);
        this.resetUrlInputMode = this.resetUrlInputMode.bind(this);
        this.cancelPendingSubmitStatusReset = this.cancelPendingSubmitStatusReset.bind(this);
        this.scheduleSubmitStatusReset = this.scheduleSubmitStatusReset.bind(this);
        this.hideSubmitStatusTimer = this.hideSubmitStatusTimer.bind(this);
        this.startSubmitStatusTimer = this.startSubmitStatusTimer.bind(this);
        this.updateAmbientDependentLabelVisibility = this.updateAmbientDependentLabelVisibility.bind(this);
        this.updateArticleStatusCameraFollow = this.updateArticleStatusCameraFollow.bind(this);
        this.setArticleStatusSpotlightEnabled = this.setArticleStatusSpotlightEnabled.bind(this);
        this.updateArticleHoverOverlay = this.updateArticleHoverOverlay.bind(this);
        this.onSupportCtaClicked = this.onSupportCtaClicked.bind(this);
        this.onDocumentPointerDown = this.onDocumentPointerDown.bind(this);
        this.showSupportMenu = this.showSupportMenu.bind(this);
        this.hideSupportMenu = this.hideSupportMenu.bind(this);
        this.isMobileViewport = this.isMobileViewport.bind(this);
        this.updateViewportMetrics = this.updateViewportMetrics.bind(this);
        this.wait = this.wait.bind(this);

        this.baseUrl = "https://callback.pepesilv.ai";

        new TrashMan(this);

        if (window[`apps_${performance.timeOrigin}`] == null) {
            window[`apps_${performance.timeOrigin}`] = {};
        }

        window[`apps_${performance.timeOrigin}`].pepe = this;

        this.investigationView = ViewPool.getView("investigation");
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
        this.d3Graph = new ArticleD3Graph("#d3-canvas", "#d3-canvas-container");
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
        this.visualizationMode = this.getInitialVisualizationMode();
        this.debugControlsVisible = false;
        this.isManualUrlSubmitMode = false;
        this.pendingSubmitStatusResetToken = 0;
        this.articleStatusPollToken = 0;
        this.hasSubmittedValidArticleUrl = false;
        this.shareFeedbackTimer = null;
        this.supportMenuOpen = false;
        this.backgroundFocusLoopTimeout = null;
        this.backgroundRackFocusTimeout = null;
        this.articleStatusView = null;
        this.articleStatusD3 = null;
        this.lastAmbientDependentLabelsVisible = null;
        this.initializeVisualizationToggle();
        this.initializeDetailPanel();
        this.initializeNewSearch();
        this.initializeShareButton();
        this.initializeSupportCta();
        this.initializePageBackground();
        this.applyInitialVisualizationMode();

        this.init().then(() => {
            this.prevFrameTime = Date.now();
            this.render();

            let foreground = document.getElementById("foreground");
            this.setForegroundInteractive(true);
            foreground.style.display = "initial";
            this.focusAndSelectUrlInput();
            this.handleInitialUrlParam();
        });
    }

    focusAndSelectUrlInput() {
        if (this.urlInput == null) {
            return;
        }

        requestAnimationFrame(() => {
            this.urlInput.focus();
            this.urlInput.select();
            this.showSupportedSites();
        });
    }

    getInitialVisualizationMode() {
        if (this.visualizationButtons?.d3?.classList.contains("is-active")) {
            return "d3";
        }

        return "three";
    }

    applyInitialVisualizationMode() {
        if (this.threeCanvas) {
            this.threeCanvas.style.opacity = "0";
            this.threeCanvas.style.pointerEvents = "none";
        }

        if (this.d3CanvasContainer) {
            this.d3CanvasContainer.style.opacity = "0";
            this.d3CanvasContainer.style.pointerEvents = "none";
            this.d3CanvasContainer.setAttribute("aria-hidden", "true");
        }

        requestAnimationFrame(() => {
            this.visualizationMode = localStorage.getItem("visual-mode");
            this.setVisualizationMode(this.visualizationMode);
        });
    }

    async init() {
        return new Promise(async (resolve, reject) => {

            THREE.Cache.enabled = true;

            this.scene = new THREE.Scene();
            this.camera = new THREE.PerspectiveCamera(
                90,
                this.getRenderDimensions().width / this.getRenderDimensions().height,
                0.1,
                200
            );
            this.camera.position.set(0, 0, 30);
            this.camera.layers.enable(MAIN_RENDER_LAYER);
            this.camera.layers.enable(SDF_TEXT_RENDER_LAYER);

            const canvas = this.threeCanvas;
            this.renderer = new THREE.WebGLRenderer({ canvas, logarithmicDepthBuffer: true, antialias: true, alpha: true });
            this.renderer.shadowMap.enabled = false;
            this.renderer.setSize(this.getRenderDimensions().width, this.getRenderDimensions().height, false);
            this.renderer.sortObjects = false;
            this.renderer.setClearColor(0x000000, 0);

            InputService.init(canvas, this.scene, this.camera);

            this.spotLightParams = {
                color: new THREE.Color('white'),
                intensity: 300,
                flareIntensityMultiplier: ARTICLE_LIGHTING_SPOTLIGHT_FLARE_INTENSITY_MULTIPLIER,
                distance: 0,
                angle: 0.44,
                penumbra: 0.152,
                decay: 1.5,
                followSpeed: 2
            }

            this.spotLight = new THREE.SpotLight(
                this.spotLightParams.color,
                this.spotLightParams.intensity,
                this.spotLightParams.distance,
                this.spotLightParams.angle,
                this.spotLightParams.penumbra,
                this.spotLightParams.decay
            );

            this.spotLight.position.set(0, 0, 50);
            this.spotLight.layers.enable(MAIN_RENDER_LAYER);
            this.spotLight.layers.enable(SDF_TEXT_RENDER_LAYER);
            this.spotLight.target.layers.enable(MAIN_RENDER_LAYER);
            this.spotLight.target.layers.enable(SDF_TEXT_RENDER_LAYER);
            this.scene.add(this.spotLight);
            this.scene.add(this.spotLight.target);

            this.ambientLights = [];

            const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
            ambientLight.layers.enable(MAIN_RENDER_LAYER);
            ambientLight.layers.enable(SDF_TEXT_RENDER_LAYER);
            this.scene.add(ambientLight);
            this.ambientLights.push(ambientLight);
            this.articleLightingIntro = null;
            this.articleHoverOverlay = new THREE.Mesh(
                new THREE.PlaneGeometry(1, 1),
                new THREE.MeshBasicMaterial({
                    color: 0xFFFFFF,
                    transparent: true,
                    opacity: 0,
                    depthWrite: false,
                    toneMapped: false,
                    side: THREE.DoubleSide
                })
            );
            this.articleHoverOverlay.visible = false;
            this.articleHoverOverlay.renderOrder = 999;
            this.articleHoverOverlay.layers.enable(MAIN_RENDER_LAYER);
            this.scene.add(this.articleHoverOverlay);

            this.updateViewportMetrics();
            window.addEventListener("resize", this.onWindowResize);
            window.visualViewport?.addEventListener("resize", this.onWindowResize);
            window.visualViewport?.addEventListener("scroll", this.onWindowResize);

            this.testCube = new THREE.Mesh(
                new THREE.BoxGeometry(1, 1, 1),
                new THREE.MeshBasicMaterial({
                    color: 0xFFFF00
                })
            );
            this.testCube.position.set(0, 0, 0);
            //this.scene.add(this.testCube);

            this.cameraController = new CameraController(canvas, this.camera, {
                zoomMode: 'fov',
                initialFov: CAMERA_STATUS_ZOOM.fov,
                minFov: 24,
                maxFov: CAMERA_MAX_FOV,
                forwardZLimit: 8,
                backwardZLimit: 50
            });

            this.aaParams = {
                mode: 'none',          // 'taa' | 'ssaa' | 'none'
                sampleLevel: 6        // used by taa/ssaa
            };

            this.useComposer = true;

            this.buildComposer = () => {
                // (Re)create composer
                this.composer = new EffectComposer(this.renderer);
                this.composer.setSize(this.getRenderDimensions().width, this.getRenderDimensions().height);

                // ---- Render step (one of: TAA, SSAA, or plain RenderPass) ----
                if (this.aaParams.mode === 'taa') {
                    this.taaPass = new TAARenderPass(this.scene, this.camera);
                    this.taaPass.sampleLevel = this.aaParams.sampleLevel;
                    this.taaPass.clearColor = new THREE.Color(0x000000);
                    this.taaPass.clearAlpha = 0;
                    this.composer.addPass(this.taaPass);

                } else if (this.aaParams.mode === 'ssaa') {
                    this.ssaaPass = new SSAARenderPass(this.scene, this.camera);
                    this.ssaaPass.sampleLevel = this.aaParams.sampleLevel;
                    this.ssaaPass.clearColor = new THREE.Color(0x000000);
                    this.ssaaPass.clearAlpha = 0;
                    this.composer.addPass(this.ssaaPass);

                } else {
                    this.renderPass = new RenderPass(this.scene, this.camera);
                    this.composer.addPass(this.renderPass);
                }

                // ---- Post ----
                if (this.lutParams?.skipComposer) {
                    this.lutPass = null;
                } else {
                    this.lutPass = new LUTPass();
                    this.composer.addPass(this.lutPass);
                }

                // Output should be last
                this.outputPass = new OutputPass();
                this.composer.addPass(this.outputPass);
            };

            this.buildComposer();

            this.setAAMode = (mode) => {
                this.aaParams.mode = mode;
                this.buildComposer();
            };

            this.lutLoader = new LUTImageLoader();
            this.lutLoader.flip = true;

            this.lutParams = {
                enabled: true,
                skipComposer: false,
                lut: 'Base/Contrast_C.png',
                intensity: 0.8,
                load: function () {
                    this.loadLut(
                        this.lutParams.lut
                    );
                }.bind(this)
            };

            let lutsRequest = await fetch("./resources/LUT/luts.json");
            let lutsJson = await lutsRequest.text();
            let lutsObj = JSON.parse(lutsJson);
            this.lutPaths = lutsObj.luts;

            this.loadLut(this.lutParams.lut);

            this.gui = new GUI();
            this.gui.width = 350;
            this.cameraGuiState = {
                position: "",
                fov: ""
            };

            let lutFolder = this.gui.addFolder("lut");
            lutFolder.add(this.lutParams, 'skipComposer').name('skip effects');
            lutFolder.add(this.lutParams, 'enabled');
            lutFolder.add(this.lutParams, 'lut', this.lutPaths).onChange((val) => {
                this.loadLut(val);
            });
            lutFolder.add(this.lutParams, 'intensity').min(0).max(1);

            let spotlightFolder = this.gui.addFolder("spotlight");
            let spotLight = this.spotLight;
            spotlightFolder.add(this.spotLightParams, "intensity", 0, 500).onChange(function (val) {
                spotLight.intensity = val;
            });
            spotlightFolder.add(this.spotLightParams, "flareIntensityMultiplier", 1, 3);

            spotlightFolder.add(this.spotLightParams, "angle", 0, Math.PI / 3).onChange(function (val) {
                spotLight.angle = val;
            });
            spotlightFolder.add(this.spotLightParams, "penumbra", 0, 1).onChange(function (val) {
                spotLight.penumbra = val;
            });

            spotlightFolder.add(this.spotLightParams, "decay", 1, 2).onChange(function (val) {
                spotLight.decay = val;
            });

            spotlightFolder.add(this.spotLightParams, "followSpeed", 0, 10);

            const cameraFolder = this.gui.addFolder("camera");

            let zoomModes = [
                "positional",
                "fov"
            ];

            cameraFolder.add(this.cameraController._zoomPass, "zoomMode", zoomModes).onChange((val) => {
                this.cameraController.setZoomMode(val);
            });

            const cameraPositionController = cameraFolder.add(this.cameraGuiState, "position").listen();
            const cameraFovController = cameraFolder.add(this.cameraGuiState, "fov").listen();

            [cameraPositionController, cameraFovController].forEach((controller) => {
                controller.disable();
            });

            this.updateCameraGuiState();
            this.gui.close();

            this.stats = new Stats();
            this.stats.showPanel(0);
            document.body.appendChild(this.stats.dom);
            this.stats.dom.style.position = "absolute";
            this.stats.dom.style.bottom = "0";
            this.stats.dom.style.right = "0";
            this.stats.dom.style.left = "auto";
            this.stats.dom.style.top = "auto";

            const params = new URLSearchParams(window.location.search);
            const showStats = params.get("stats");

            this.statsVisible = showStats ? showStats == "true" : false;
            this.stats.dom.style.display = this.statsVisible ? "block" : "none";

            this.gui.domElement.style.display = "none";
            this.gui.domElement.style.zIndex = "2000";

            let showControls = params.get("controls");

            if (showControls == "true") {
                document.addEventListener("keydown", (event) => {
                    if (event.key === "f" || event.key === "F") {
                        this.debugControlsVisible = !this.debugControlsVisible;
                        this.gui.domElement.style.display = this.debugControlsVisible ? "" : "none";
                    }
                    if (event.key === "s" || event.key === "S") {
                        if (document.activeElement !== this.urlInput) {
                            this.statsVisible = !this.statsVisible;
                            this.stats.dom.style.display = this.statsVisible ? "block" : "none";
                        }
                    }
                });
            }

            InstancedMeshPool.setDefaultParent(this.scene);
            TextService.init({
                renderer: this.renderer,
                parent: this.scene,
                light: this.spotLight,
                lightTarget: this.spotLight.target,
                camera: this.camera
            });

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

            this.textGuiConfigs = {
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
            this.setupTextGui();

            this.materialGuiConfigs = {
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
            this.setupMaterialGui();

            this.submitButton.addEventListener("pointerdown", this.onSubmitButtonPointerDown);
            this.submitButton.addEventListener("click", this.onSubmitClicked);
            this.urlInput.addEventListener("input", this.onUrlInputChanged);
            this.urlInput.addEventListener("paste", this.onUrlInputPasted);

            resolve();
        });
    }

    initializeNewSearch() {
        this.hideNewSearchContainer();
        this.newSearchButton?.addEventListener("click", () => {
            const nextUrl = new URL(window.location.href);
            nextUrl.search = "";
            window.location.assign(nextUrl.toString());
        });
    }

    updateArticleActionToolbarPosition() {
        if (this.articleActionToolbar == null) {
            return;
        }

        if (this.isMobileViewport()) {
            this.articleActionToolbar.style.removeProperty("top");
            return;
        }

        const computedStyles = window.getComputedStyle(this.articleActionToolbar);
        const fallbackTop = Number.parseFloat(computedStyles.getPropertyValue("--toolbar-fallback-top")) || 180;
        const legendGap = Number.parseFloat(computedStyles.getPropertyValue("--toolbar-legend-gap")) || 44;
        const legendGroup = document.querySelector("#d3-canvas g.article-graph-legend > g");

        if (legendGroup == null || typeof legendGroup.getBBox !== "function") {
            this.articleActionToolbar.style.top = `${fallbackTop}px`;
            return;
        }

        const legendBounds = legendGroup.getBBox();
        const nextTop = Math.max(fallbackTop, legendBounds.y + legendBounds.height + legendGap);
        this.articleActionToolbar.style.top = `${Math.round(nextTop)}px`;
    }

    showNewSearchContainer() {
        this.newSearchContainer?.classList.add("is-visible");
    }

    hideNewSearchContainer() {
        this.newSearchContainer?.classList.remove("is-visible");
    }

    initializeShareButton() {
        this.hideShareContainer();
        this.hideShareFeedback();
        this.shareButton?.addEventListener("click", this.onShareButtonClicked);
    }

    initializeSupportCta() {
        this.hideSupportMenu();
        this.supportCtaButton?.addEventListener("click", this.onSupportCtaClicked);
        this.supportButtons?.querySelectorAll("a").forEach((link) => {
            link.addEventListener("click", () => {
                this.hideSupportMenu();
            });
        });
        document.addEventListener("pointerdown", this.onDocumentPointerDown);
        requestAnimationFrame(this.updateSupportButtonsScale);
    }

    onSupportCtaClicked(event) {
        event?.preventDefault?.();
        event?.stopPropagation?.();

        if (this.supportMenuOpen) {
            this.hideSupportMenu();
            return;
        }

        this.showSupportMenu();
    }

    onDocumentPointerDown(event) {
        if (!this.supportMenuOpen) {
            return;
        }

        const target = event?.target;
        if (
            this.supportButtons?.contains(target) ||
            this.supportCtaButton?.contains(target)
        ) {
            return;
        }

        this.hideSupportMenu();
    }

    showSupportMenu() {
        if (this.supportButtons == null || this.supportCtaButton == null) {
            return;
        }

        this.supportMenuOpen = true;
        this.supportButtons.classList.add("is-open");
        this.supportCtaButton.setAttribute("aria-expanded", "true");
    }

    hideSupportMenu() {
        if (this.supportButtons != null) {
            this.supportButtons.classList.remove("is-open");
        }

        if (this.supportCtaButton != null) {
            this.supportCtaButton.setAttribute("aria-expanded", "false");
        }

        this.supportMenuOpen = false;
    }

    isMobileViewport() {
        return window.matchMedia("(max-width: 768px)").matches;
    }

    updateSupportButtonsScale() {
        if (this.supportButtons == null) {
            return;
        }

        this.supportButtons.style.setProperty("--support-buttons-scale", "1");

        const availableWidth = this.supportButtons.clientWidth;
        const contentWidth = this.supportButtons.scrollWidth;

        if (availableWidth <= 0 || contentWidth <= 0) {
            return;
        }

        const scale = Math.min(1, availableWidth / contentWidth);
        this.supportButtons.style.setProperty("--support-buttons-scale", `${scale}`);
    }

    updateMobileViewportAnchors() {
        const rootStyle = document.documentElement.style;

        if (!this.isMobileViewport() || this.urlInputContainer == null) {
            rootStyle.removeProperty("--mobile-url-input-bottom");
            return;
        }

        const { bottom } = this.urlInputContainer.getBoundingClientRect();
        rootStyle.setProperty("--mobile-url-input-bottom", `${Math.round(bottom)}px`);
    }

    updateViewportMetrics() {
        const viewport = window.visualViewport;
        const top = viewport?.offsetTop ?? 0;
        const left = viewport?.offsetLeft ?? 0;
        const viewportWidth = viewport?.width ?? window.innerWidth;
        const viewportHeight = viewport?.height ?? window.innerHeight;
        const viewportBottom = top + viewportHeight;
        const bottomOffset = Math.max(0, window.innerHeight - viewportBottom);

        document.documentElement.style.setProperty("--vv-top", `${Math.round(top)}px`);
        document.documentElement.style.setProperty("--vv-left", `${Math.round(left)}px`);
        document.documentElement.style.setProperty("--vv-width", `${Math.round(viewportWidth)}px`);
        document.documentElement.style.setProperty("--vv-height", `${Math.round(viewportHeight)}px`);
        document.documentElement.style.setProperty("--vv-offset-bottom", `${Math.round(bottomOffset)}px`);
        this.updateSupportButtonsScale();
        requestAnimationFrame(this.updateMobileViewportAnchors);

        if (!this.isMobileViewport()) {
            this.hideSupportMenu();
        }
    }

    initializePageBackground() {
        if (
            !ENABLE_PAGE_BACKGROUND ||
            this.pageBackground == null ||
            this.pageBackgroundPlane == null ||
            this.pageBackgroundSharpLayer == null ||
            this.pageBackgroundBlurLayer == null
        ) {
            return;
        }

        const randomBetween = (min, max) => min + Math.random() * (max - min);
        const randomImage = PEPE_BG_IMAGES[Math.floor(Math.random() * PEPE_BG_IMAGES.length)];
        const rotateY = randomBetween(BACKGROUND_ROTATE_Y_MIN, BACKGROUND_ROTATE_Y_MAX);
        const backgroundScale = randomBetween(BACKGROUND_SCALE_MIN, BACKGROUND_SCALE_MAX);
        const backgroundPositionX = randomBetween(BACKGROUND_POSITION_X_MIN, BACKGROUND_POSITION_X_MAX);
        const backgroundPositionY = randomBetween(BACKGROUND_POSITION_Y_MIN, BACKGROUND_POSITION_Y_MAX);
        const vignette = randomBetween(BACKGROUND_VIGNETTE_MIN, BACKGROUND_VIGNETTE_MAX);
        const focusBiasClass = rotateY >= 0 ? "focus-bias-left" : "focus-bias-right";
        const backgroundPosition = `${backgroundPositionX.toFixed(2)}% ${backgroundPositionY.toFixed(2)}%`;
        const focusSplit = randomBetween(BACKGROUND_FOCUS_SPLIT_MIN, BACKGROUND_FOCUS_SPLIT_MAX);
        const focusSoftness = randomBetween(BACKGROUND_FOCUS_SOFTNESS_MIN, BACKGROUND_FOCUS_SOFTNESS_MAX);

        this.pageBackgroundSharpLayer.style.backgroundImage = `url("${randomImage}")`;
        this.pageBackgroundSharpLayer.style.backgroundPosition = backgroundPosition;
        this.pageBackgroundBlurLayer.style.backgroundImage = `url("${randomImage}")`;
        this.pageBackgroundBlurLayer.style.backgroundPosition = backgroundPosition;
        this.pageBackgroundPlane.style.setProperty(
            "--page-background-plane-transform",
            `perspective(${BACKGROUND_PERSPECTIVE_PX}px) rotateY(${rotateY.toFixed(2)}deg) scale(${backgroundScale.toFixed(3)})`
        );
        this.pageBackground.style.setProperty("--page-background-vignette-opacity", vignette.toFixed(3));
        this.pageBackground.style.setProperty("--page-background-focus-easing", BACKGROUND_FOCUS_EASING);
        this.pageBackground.style.setProperty("--page-background-focus-split", `${focusSplit.toFixed(2)}%`);
        this.pageBackground.style.setProperty("--page-background-focus-softness", `${focusSoftness.toFixed(2)}%`);
        this.pageBackground.classList.remove("focus-bias-left", "focus-bias-right");
        this.pageBackground.classList.add(focusBiasClass);
        this.applyPageBackgroundFocusState({
            sharpLayerBlur: BACKGROUND_SHARP_LAYER_BLUR_MAX,
            blurAmount: BACKGROUND_BLUR_LAYER_MAX,
            blurOpacity: BACKGROUND_BLUR_OPACITY_MAX,
            transitionMs: 0
        });
        this.startPageBackgroundFocusLoop();
    }

    hidePageBackground() {
        if (!ENABLE_PAGE_BACKGROUND || this.pageBackground == null) {
            return;
        }

        this.pageBackground.classList.add("is-hidden");
    }

    applyPageBackgroundFocusState({
        sharpLayerBlur = BACKGROUND_SHARP_LAYER_BLUR_MIN,
        blurAmount = BACKGROUND_BLUR_LAYER_MIN,
        blurOpacity = BACKGROUND_BLUR_OPACITY_MIN,
        transitionMs = BACKGROUND_FOCUS_TRANSITION_MIN_MS
    } = {}) {
        if (this.pageBackground == null) {
            return;
        }

        this.pageBackground.style.setProperty("--page-background-focus-transition-ms", `${Math.round(transitionMs)}ms`);
        this.pageBackground.style.setProperty("--page-background-sharp-layer-blur", `${sharpLayerBlur.toFixed(2)}px`);
        this.pageBackground.style.setProperty("--page-background-blur-amount", `${blurAmount.toFixed(2)}px`);
        this.pageBackground.style.setProperty("--page-background-blur-opacity", blurOpacity.toFixed(3));
    }

    scheduleNextPageBackgroundFocus() {
        if (!ENABLE_PAGE_BACKGROUND || this.pageBackground == null) {
            return;
        }

        const randomBetween = (min, max) => min + Math.random() * (max - min);
        const nextDelay = randomBetween(BACKGROUND_FOCUS_INTERVAL_MIN_MS, BACKGROUND_FOCUS_INTERVAL_MAX_MS);

        clearTimeout(this.backgroundFocusLoopTimeout);
        this.backgroundFocusLoopTimeout = window.setTimeout(() => {
            this.applyPageBackgroundFocusState({
                sharpLayerBlur: randomBetween(BACKGROUND_SHARP_LAYER_BLUR_MIN, BACKGROUND_SHARP_LAYER_BLUR_MAX),
                blurAmount: randomBetween(BACKGROUND_BLUR_LAYER_MIN, BACKGROUND_BLUR_LAYER_MAX),
                blurOpacity: randomBetween(BACKGROUND_BLUR_OPACITY_MIN, BACKGROUND_BLUR_OPACITY_MAX),
                transitionMs: randomBetween(BACKGROUND_FOCUS_TRANSITION_MIN_MS, BACKGROUND_FOCUS_TRANSITION_MAX_MS)
            });
            this.scheduleNextPageBackgroundFocus();
        }, nextDelay);
    }

    startPageBackgroundFocusLoop() {
        if (!ENABLE_PAGE_BACKGROUND || this.pageBackground == null) {
            return;
        }

        clearTimeout(this.backgroundRackFocusTimeout);
        clearTimeout(this.backgroundFocusLoopTimeout);

        this.backgroundRackFocusTimeout = window.setTimeout(() => {
            const randomBetween = (min, max) => min + Math.random() * (max - min);

            this.applyPageBackgroundFocusState({
                sharpLayerBlur: randomBetween(BACKGROUND_SHARP_LAYER_BLUR_MIN, BACKGROUND_SHARP_LAYER_BLUR_MAX * 0.65),
                blurAmount: randomBetween(BACKGROUND_BLUR_LAYER_MIN, BACKGROUND_BLUR_LAYER_MAX * 0.8),
                blurOpacity: randomBetween(BACKGROUND_BLUR_OPACITY_MIN, BACKGROUND_BLUR_OPACITY_MAX * 0.82),
                transitionMs: randomBetween(BACKGROUND_FOCUS_TRANSITION_MIN_MS, BACKGROUND_FOCUS_TRANSITION_MAX_MS)
            });
            this.scheduleNextPageBackgroundFocus();
        }, BACKGROUND_RACK_FOCUS_DELAY_MS);
    }

    activateThreeCanvas() {
        if (!ENABLE_PAGE_BACKGROUND || this.threeCanvas == null) {
            return;
        }

        this.threeCanvas.classList.add("is-active");
    }

    updatePageTitleSubmitted() {
        if (this.pageTitle == null) {
            return;
        }

        this.pageTitle.classList.add("is-submitted");
    }

    clearRelationshipKey() {
        if (this.relationshipKey == null) {
            return;
        }

        this.relationshipKey.innerHTML = "";
        this.relationshipKey.classList.remove("is-visible");
        this.relationshipKey.setAttribute("aria-hidden", "true");
    }

    renderRelationshipKey(items = []) {
        if (this.relationshipKey == null) {
            return;
        }

        if (Array.isArray(items) === false || items.length === 0) {
            this.clearRelationshipKey();
            return;
        }

        const card = document.createElement("div");
        card.className = "relationship-key-card";

        const title = document.createElement("div");
        title.className = "relationship-key-title";
        title.textContent = "RELATIONSHIP KEY";
        card.appendChild(title);

        const list = document.createElement("div");
        list.className = "relationship-key-list";

        items.forEach((item) => {
            const row = document.createElement("div");
            row.className = "relationship-key-row";

            const swatch = document.createElement("span");
            swatch.className = "relationship-key-swatch";
            swatch.style.backgroundColor = item.color ?? "#7a6a4d";

            const label = document.createElement("span");
            label.className = "relationship-key-label";
            label.textContent = item.label ?? "";

            row.appendChild(swatch);
            row.appendChild(label);
            list.appendChild(row);
        });

        card.appendChild(list);
        this.relationshipKey.replaceChildren(card);
        this.updateRelationshipKeyVisibility();
    }

    updateRelationshipKeyVisibility(forceVisible = null) {
        if (this.relationshipKey == null) {
            return;
        }

        const hasItems = this.relationshipKey.childElementCount > 0;
        const shouldShow = forceVisible ?? (this.visualizationMode === "d3" && hasItems);
        this.relationshipKey.classList.toggle("is-visible", shouldShow);
        this.relationshipKey.setAttribute("aria-hidden", shouldShow ? "false" : "true");
    }

    showShareContainer() {
        this.shareContainer?.classList.add("is-visible");
    }

    hideShareContainer() {
        this.shareContainer?.classList.remove("is-visible");
        this.hideShareFeedback();
    }

    async onShareButtonClicked() {
        const shareUrl = window.location.href;

        try {
            if (typeof navigator.share === "function") {
                await navigator.share({
                    title: document.title,
                    url: shareUrl
                });
                return;
            }
        } catch (error) {
            if (error?.name === "AbortError") {
                return;
            }
        }

        const copied = await this.copyShareUrlToClipboard(shareUrl);
        if (copied) {
            this.showShareFeedback();
            return;
        }

        console.error("Could not share article.");
    }

    async copyShareUrlToClipboard(shareUrl) {
        try {
            if (navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(shareUrl);
                return true;
            }
        } catch (_error) {
        }

        try {
            const tempInput = document.createElement("textarea");
            tempInput.value = shareUrl;
            tempInput.setAttribute("readonly", "");
            tempInput.style.position = "fixed";
            tempInput.style.opacity = "0";
            tempInput.style.pointerEvents = "none";
            document.body.appendChild(tempInput);
            tempInput.select();
            tempInput.setSelectionRange(0, tempInput.value.length);
            const copied = document.execCommand("copy");
            document.body.removeChild(tempInput);
            return copied;
        } catch (_error) {
            return false;
        }
    }

    showShareFeedback() {
        if (this.shareFeedback == null) {
            return;
        }

        if (this.shareFeedbackTimer != null) {
            window.clearTimeout(this.shareFeedbackTimer);
        }

        this.shareFeedback.classList.add("is-visible");
        this.shareFeedbackTimer = window.setTimeout(() => {
            this.hideShareFeedback();
        }, 1400);
    }

    hideShareFeedback() {
        if (this.shareFeedback == null) {
            return;
        }

        if (this.shareFeedbackTimer != null) {
            window.clearTimeout(this.shareFeedbackTimer);
            this.shareFeedbackTimer = null;
        }

        this.shareFeedback.classList.remove("is-visible");
    }

    handleInitialUrlParam() {
        const params = new URLSearchParams(window.location.search);
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

    updateAddressBarUrlParam(urlValue) {
        const normalizedUrl = this.normalizeUserUrl(urlValue);

        if (normalizedUrl == null) {
            return;
        }

        const nextUrl = new URL(window.location.href);
        nextUrl.searchParams.set("url", normalizedUrl);
        window.history.replaceState({}, "", nextUrl.toString());
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

            for (let i = 0; i < sliderDefs.length; i++) {
                const sliderDef = sliderDefs[i];
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

            for (let i = 0; i < sliderDefs.length; i++) {
                const sliderDef = sliderDefs[i];
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

    /**
     * When enabled, disables renderer object sorting so explicit renderOrder values are used.
     * Use only if your scene has deterministic renderOrder setup (especially for transparencies).
     */
    setCustomRenderSorting(enabled = false) {
        this.renderer.sortObjects = !enabled;
    }

    async healthCheck() {
        const url = new URL(`${this.baseUrl}/api/health`);

        try {
            const res = await fetch(url.toString(), { method: "GET" });

            if (!res.ok) {
                const text = await res.text().catch(() => "");
                const error = new Error(`healthCheck failed: ${res.status} ${res.statusText}`);
                throw error;
            }

            const data = await res.json();
            return data;
        }
        catch (exception) {
            console.log(exception);
            throw exception;
        }
    }

    async onSubmitClicked(event) {
        this.stopArticleStatusPolling();
        this.hideArticleStatusProgress();
        this.hasSubmittedValidArticleUrl = false;
        const normalizedUrl = this.normalizeUserUrl(this.urlInput.value);
        console.log("[submit-flow] onSubmitClicked", {
            eventType: event?.type ?? null,
            rawInput: this.urlInput?.value ?? "",
            normalizedUrl,
            isManualUrlSubmitMode: this.isManualUrlSubmitMode
        });

        if (normalizedUrl == null) {
            this.foreground.style.display = "initial";
            this.showSubmitStatusMessage("Not a valid url");
            this.updateSubmitButtonVisibility();
            return;
        }

        this.hasSubmittedValidArticleUrl = true;
        this.updateAddressBarUrlParam(normalizedUrl);
        this.startForegroundFadeOut();

        const articleObject = await this.getArticleByUrl(
            normalizedUrl
        );
        console.log("[submit-flow] getArticleByUrl resolved", {
            normalizedUrl,
            hasArticleObject: articleObject != null,
            status: articleObject?.article?.status ?? null,
            ownership_tree_id: articleObject?.article?.ownership_tree_id ?? null
        });

        if (articleObject == null) {
            this.showForeground();
            this.showSubmitStatusMessage("Could not load article status.");
            this.updateSubmitButtonVisibility();
            return;
        }

        this.logArticleStatusCheck("initial-submit", articleObject, {
            submitted_url: normalizedUrl
        });

        const articleStatus = String(articleObject?.article?.status ?? "").toLowerCase();
        const isNotApplicableArticle =
            articleStatus === "not-applicable" ||
            articleStatus === "not applicable";
        if (isNotApplicableArticle) {
            const summaryText =
                articleObject?.ownershipTreeObj?.summary
                ?? articleObject?.article?.applicability_result?.reason
                ?? "Not applicable.";

            this.showForeground();
            this.showSubmitStatusMessage(summaryText);
            await this.scheduleSubmitStatusReset({ clearInput: true });
            return;
        }

        const hasValidOwnershipTree =
            articleObject != null &&
            articleObject.article?.ownership_tree_id != null &&
            articleObject.ownershipTreeObj != null &&
            articleObject.ownership_tree != null;

        if (!hasValidOwnershipTree) {
            await this.handlePendingArticleState(normalizedUrl, articleObject);
            return;
        }

        await this.renderResolvedArticle(articleObject);
    }

    async handlePendingArticleState(targetUrl, articleObject) {
        console.log("[submit-flow] handlePendingArticleState", {
            targetUrl,
            status: articleObject?.article?.status ?? null,
            ownership_tree_id: articleObject?.article?.ownership_tree_id ?? null
        });

        const status = String(articleObject?.article?.status ?? "").toLowerCase();
        if (status === "timeout") {
            this.showForeground();
            this.showSubmitStatusMessage(this.getQueueStatusMessage(articleObject));
            this.updateSubmitButtonVisibility();
            await this.scheduleSubmitStatusReset({ clearInput: true });
            return;
        }

        this.showForeground();
        this.applyArticleStatusCameraZoom();

        const initialMessage = this.getQueueStatusMessage(articleObject);
        this.showSubmitStatusMessage(initialMessage);
        await this.updateArticleStatusProgress(articleObject);
        this.updateSubmitButtonVisibility();

        const isTerminalDeferred = status === "deferred";
        const isTerminalNotApplicable =
            status === "not-applicable" || status === "not applicable";

        if (isTerminalDeferred || isTerminalNotApplicable) {
            this.hideArticleStatusProgress();
            await this.scheduleSubmitStatusReset({ clearInput: true });
            return;
        }

        this.pollArticleStatus(targetUrl);
    }

    collectEntities(obj) {
        if (!obj || typeof obj !== 'object') return;

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
        } else {
            for (const key of Object.keys(obj)) {
                this.collectEntities(obj[key]);
            }
        }
    }

    collectRelationships(obj) {
        if (!obj || typeof obj !== 'object') return;

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
        } else {
            for (const key of Object.keys(obj)) {
                this.collectRelationships(obj[key]);
            }
        }
    }

    async collectEvidence() {
        const supabase = createClient(
            "https://ukxcjdimupajklqdxbvr.supabase.co",
            "sb_publishable_8DfgTxdV87vYWW-fBkxTng_Whoii-zo"
        );

        const { data, error } = await supabase.functions.invoke("get-evidence-batch", {
            body: { ids: Array.from(this.evidenceIds) },
        });

        if (error) {
            const status = error.context?.status ?? null;
            let text = null;

            try {
                text = await error.context?.text?.();
            } catch (_err) {
                text = null;
            }

            console.warn("[evidence] get-evidence-batch failed", {
                status,
                message: error.message,
                requestedCount: this.evidenceIds.size,
                body: text
            });

            try {
                if (text) {
                    console.warn("[evidence] parsed error body", JSON.parse(text));
                }
            } catch (_err) {
                // Best-effort logging only.
            }

            window.location.reload();
            return false;
        }

        let evidence = data.evidence;
        for (let i = 0; i < evidence.length; i++) {
            let evidenceData = evidence[i];

            this.evidence[evidenceData.uuid] = new EvidenceModel({
                id: evidenceData.uuid,
                date: evidenceData.date ? evidenceData.date : evidenceData._additional ? new Date(Number(evidenceData._additional.creationTimeUnix)) : null,
                source: evidenceData.source,
                excerpt: evidenceData.excerpt
            });
        }
        return true;
    }

    collectEvidenceIds(obj) {
        if (!obj || typeof obj !== 'object') return;

        if (Array.isArray(obj.evidence_ids)) {
            for (const id of obj.evidence_ids) {
                this.evidenceIds.add(id);
            }
        }

        if (Array.isArray(obj)) {
            for (const item of obj) {
                this.collectEvidenceIds(item);
            }
        } else {
            for (const key of Object.keys(obj)) {
                this.collectEvidenceIds(obj[key]);
            }
        }
    }

    getEvidence(ids) {
        let evidence = {};

        for (let i = 0; i < ids.length; i++) {
            evidence[ids[i]] = this.evidence[ids[i]];
        }

        return evidence;
    }

    async getArticleByUrl(targetUrl) {
        console.log("[submit-flow] getArticleByUrl start", {
            targetUrl
        });
        const supabase = createClient(
            "https://ukxcjdimupajklqdxbvr.supabase.co",
            "sb_publishable_8DfgTxdV87vYWW-fBkxTng_Whoii-zo"
        );

        let articleResult = await this.getOrEnqueueArticleQueueRow(supabase, targetUrl);
        console.log("[submit-flow] getOrEnqueueArticleQueueRow result", {
            targetUrl,
            hasData: articleResult?.data != null,
            error: articleResult?.error?.message ?? null,
            status: articleResult?.data?.status ?? null,
            ownership_tree_id: articleResult?.data?.ownership_tree_id ?? null
        });

        if (articleResult.error !== null) {
            console.error("Fetch error:", articleResult.error.message);
            return null;
        }

        if (articleResult.data === null) {
            return null;
        }

        const article = this.parseJsonRecursively(articleResult.data);
        const ownership_tree_id = article?.ownership_tree_id ?? null;
        let ownershipTreeObj = null;

        if (ownership_tree_id != null) {
            ownershipTreeObj = await this.fetchOwnershipTreeById(supabase, ownership_tree_id);
        }

        return {
            article: article,
            ownershipTreeObj: ownershipTreeObj,
            ownership_tree: ownershipTreeObj?.ownership_tree ?? null,
            investigation_prepass_results: article?.investigation_prepass_results ?? null
        };
    }

    async fetchOwnershipTreeById(supabase, ownershipTreeId) {
        const ownershipTreeResult = await supabase
            .from("ownership_trees")
            .select("*")
            .eq("id", ownershipTreeId)
            .single();

        if (ownershipTreeResult.error !== null) {
            console.error("Fetch error:", ownershipTreeResult.error.message);
            return null;
        }

        return this.parseJsonRecursively(ownershipTreeResult.data);
    }

    parseJsonRecursively(value) {
        const seen = new WeakMap();

        const walk = (v) => {
            if (v === null) return null;

            const t = typeof v;

            // Handle strings (attempt JSON.parse)
            if (t === "string") {
                const s = v.trim();
                if (s.length === 0) return v;

                const first = s[0];
                const looksJsony =
                    first === "{" ||
                    first === "[" ||
                    first === "\"" ||
                    first === "t" ||
                    first === "f" ||
                    first === "n" ||
                    first === "-" ||
                    (first >= "0" && first <= "9");

                if (!looksJsony) return v;

                try {
                    const parsed = JSON.parse(s);
                    return walk(parsed);
                } catch (_err) {
                    return v;
                }
            }

            // Primitives
            if (t !== "object") return v;

            // Handle cycles
            if (seen.has(v)) {
                return seen.get(v);
            }

            // Arrays
            if (Array.isArray(v)) {
                const copy = [];
                seen.set(v, copy);

                for (let i = 0; i < v.length; i += 1) {
                    copy[i] = walk(v[i]);
                }

                return copy;
            }

            // Only deep-clone plain objects
            const proto = Object.getPrototypeOf(v);
            const isPlain = proto === Object.prototype || proto === null;

            if (!isPlain) {
                // For Date, Map, Set, custom classes, etc.
                // Return as-is (do not attempt deep clone)
                return v;
            }

            const copy = {};
            seen.set(v, copy);

            for (const key of Object.keys(v)) {
                copy[key] = walk(v[key]);
            }

            return copy;
        };

        return walk(value);
    }

    normalizeHost(hostname) {
        const h = String(hostname).trim().toLowerCase();
        return h.startsWith("www.") ? h.slice(4) : h;
    }

    normalizePathname(pathname) {
        let p = pathname || "/";
        p = p.replace(/\/{2,}/g, "/");      // collapse multiple slashes
        if (p.length > 1) p = p.replace(/\/+$/g, ""); // remove trailing slash unless root
        return p;
    }

    normalizeUserUrl(raw) {
        let value = String(raw).trim();

        if (value.length === 0) {
            return null;
        }

        value = value.replace(/\s+/g, "");

        if (!/^[a-zA-Z]+:\/\//.test(value)) {
            value = `https://${value}`;
        }

        try {
            const u = new URL(value);

            if (u.protocol !== "http:" && u.protocol !== "https:") {
                return null;
            }

            u.hostname = u.hostname.toLowerCase();

            const hostname = u.hostname;
            const isIpv4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/.test(hostname);
            const isLocalhost = hostname === "localhost";
            const hasValidDomainShape =
                hostname.includes(".") &&
                !hostname.startsWith(".") &&
                !hostname.endsWith(".") &&
                !hostname.split(".").some((part) => part.length === 0) &&
                /^[a-z0-9.-]+$/i.test(hostname);

            if (!isIpv4 && !isLocalhost && !hasValidDomainShape) {
                return null;
            }

            return u.toString();
        } catch (_err) {
            return null;
        }
    }

    makeQueueUrlKey(rawUrl) {
        const normalized = this.normalizeUserUrl(rawUrl);

        if (normalized === null) {
            throw new Error("Invalid URL");
        }

        const u = new URL(normalized);
        const host = this.normalizeHost(u.hostname);

        const port = u.port;
        const isDefaultPort =
            port === "" ||
            (u.protocol === "https:" && port === "443") ||
            (u.protocol === "http:" && port === "80");
        const hostWithPort = isDefaultPort ? host : `${host}:${port}`;

        const path = this.normalizePathname(u.pathname);

        return `${hostWithPort}${path}`;
    }

    async getOrEnqueueArticleQueueRow(supabase, targetUrl) {
        const normalizedTargetUrl = this.normalizeUserUrl(targetUrl);

        if (normalizedTargetUrl === null) {
            return { data: null, error: new Error("Invalid URL") };
        }

        let urlKey = null;

        try {
            urlKey = this.makeQueueUrlKey(normalizedTargetUrl);
        } catch (e) {
            return { data: null, error: e };
        }

        const { data: existingRow, error: readErr } = await supabase
            .from("article_queue")
            .select("*")
            .eq("url", urlKey)
            .maybeSingle();

        if (readErr) return { data: null, error: readErr };
        if (existingRow) return { data: existingRow, error: null };

        console.log("[submit-flow] getOrEnqueueArticleQueueRow invoke start", {
            targetUrl: normalizedTargetUrl,
            urlKey
        });

        const invokePromise = supabase.functions
            .invoke("get-or-enqueue", {
                body: {
                    url: normalizedTargetUrl,
                    use_edge_pre_investigation_check: true
                },
            })
            .then(({ data, error }) => ({ data, error }))
            .catch((error) => ({ data: null, error }));

        const maxQueuePollAttempts = 20;
        const queuePollDelayMs = 150;

        for (let attempt = 0; attempt < maxQueuePollAttempts; attempt++) {
            const queueResult = await this.getArticleQueueRowByUrl(supabase, normalizedTargetUrl);

            if (queueResult.error == null && queueResult.data != null) {
                console.log("[submit-flow] getOrEnqueueArticleQueueRow queue observed", {
                    targetUrl: normalizedTargetUrl,
                    urlKey,
                    attempt,
                    status: queueResult.data.status ?? null,
                    ownership_tree_id: queueResult.data.ownership_tree_id ?? null
                });
                return queueResult;
            }

            if (queueResult.error != null) {
                console.log("[submit-flow] getOrEnqueueArticleQueueRow queue read error", {
                    targetUrl: normalizedTargetUrl,
                    urlKey,
                    attempt,
                    error: queueResult.error?.message ?? String(queueResult.error)
                });
            }

            const invokeRace = await Promise.race([
                invokePromise.then((result) => ({
                    type: "invoke",
                    result
                })),
                this.wait(queuePollDelayMs).then(() => ({
                    type: "wait"
                }))
            ]);

            if (invokeRace.type === "invoke") {
                const { data: fnData, error: fnErr } = invokeRace.result;
                console.log("[submit-flow] getOrEnqueueArticleQueueRow invoke resolved", {
                    targetUrl: normalizedTargetUrl,
                    urlKey,
                    attempt,
                    hasFnData: fnData != null,
                    error: fnErr?.message ?? null,
                    site_valid: fnData?.site_valid ?? null,
                    status: fnData?.queue?.status ?? null,
                    ownership_tree_id: fnData?.queue?.ownership_tree_id ?? null
                });

                if (fnErr) {
                    return { data: fnData, error: fnErr };
                }

                if (!fnData || fnData.site_valid !== true) {
                    return { data: null, error: null };
                }

                const finalQueueRead = await this.getArticleQueueRowByUrl(supabase, normalizedTargetUrl);
                if (finalQueueRead.error == null && finalQueueRead.data != null) {
                    return finalQueueRead;
                }

                return { data: fnData.queue ?? null, error: null };
            }
        }

        const { data: fnData, error: fnErr } = await invokePromise;
        console.log("[submit-flow] getOrEnqueueArticleQueueRow invoke fallback", {
            targetUrl: normalizedTargetUrl,
            urlKey,
            hasFnData: fnData != null,
            error: fnErr?.message ?? null,
            site_valid: fnData?.site_valid ?? null,
            status: fnData?.queue?.status ?? null,
            ownership_tree_id: fnData?.queue?.ownership_tree_id ?? null
        });

        if (fnErr) {
            return { data: fnData, error: fnErr };
        }

        if (!fnData || fnData.site_valid !== true) {
            return { data: null, error: null };
        }

        const finalQueueRead = await this.getArticleQueueRowByUrl(supabase, normalizedTargetUrl);
        if (finalQueueRead.error == null && finalQueueRead.data != null) {
            return finalQueueRead;
        }

        return { data: fnData.queue ?? null, error: null };
    }

    async getArticleQueueRowByUrl(supabase, targetUrl) {
        const normalizedTargetUrl = this.normalizeUserUrl(targetUrl);

        if (normalizedTargetUrl === null) {
            return { data: null, error: new Error("Invalid URL") };
        }

        let urlKey = null;

        try {
            urlKey = this.makeQueueUrlKey(normalizedTargetUrl);
        } catch (e) {
            return { data: null, error: e };
        }

        return await supabase
            .from("article_queue")
            .select("*")
            .eq("url", urlKey)
            .maybeSingle();
    }

    getQueueStatusMessage(articleObject) {
        const article = articleObject?.article ?? {};
        const status = String(article.status ?? "").toLowerCase();
        const prepass = articleObject?.investigation_prepass_results ?? article.investigation_prepass_results ?? null;
        const entityName =
            prepass?.article_subject_entity?.name ??
            article?.article_subject?.name ??
            null;
        const newsSiteName =
            prepass?.domain ??
            prepass?.site_data?.domain ??
            article?.site?.domain ??
            null;

        if (article.ownership_tree_id) {
            return "Ownership tree found.";
        }

        if (status === "deferred") {
            const entityLabel = entityName ?? "the identified company";
            const siteLabel = newsSiteName ?? "this news site";
            return `This article appears to be about ${entityLabel} for ${siteLabel} and has been queued for investigation.`;
        }

        if (status === "in-progress") {
            return "This article is currently being investigated.";
        }

        if (status === "timeout") {
            return "This article took too long to investigate. Please try again later.";
        }

        if (status === "not applicable" || status === "not-applicable") {
            return article?.applicability_result?.reason ?? "This article was marked as not applicable.";
        }

        if (status.startsWith("prepass:")) {
            return `This article is being researched. Status: ${article.status}`;
        }

        if (status === "queued") {
            return "This article is being researched. Status: queued for investigation.";
        }

        if (status.length > 0) {
            return `This article is being researched. Status: ${article.status}`;
        }

        return "This article is being researched.";
    }

    logArticleStatusCheck(source, articleObject, extras = {}) {
        const article = articleObject?.article ?? null;

        console.log("[article-status-check]", {
            source,
            status: article?.status ?? null,
            url: article?.url ?? extras.url ?? null,
            ownership_tree_id: article?.ownership_tree_id ?? null,
            has_ownership_tree_payload:
                articleObject?.ownershipTreeObj != null ||
                articleObject?.ownership_tree != null,
            investigation_prepass_results: articleObject?.investigation_prepass_results ?? null,
            ...extras
        });
    }

    stopArticleStatusPolling() {
        this.articleStatusPollToken += 1;
    }

    getActiveArticleUrl() {
        const inputUrl = this.normalizeUserUrl(this.urlInput?.value ?? "");
        if (inputUrl != null) {
            return inputUrl;
        }

        const params = new URLSearchParams(window.location.search);
        return this.normalizeUserUrl(params.get("url") ?? "");
    }

    async ensureArticleStatusViews() {
        if (this.articleStatusView == null) {
            this.articleStatusView = new ArticleStatus({
                statusConfigPath: "./status_states.json"
            });
            await this.articleStatusView.init();
            this.scene.add(this.articleStatusView.getRootGroup());
            this.articleStatusView.hide();
        }

        if (this.articleStatusD3 == null) {
            this.articleStatusD3 = new ArticleStatusD3({
                svgSelector: "#d3-canvas",
                containerSelector: "#d3-canvas-container",
                statusConfigPath: "./status_states.json"
            });
            await this.articleStatusD3.init();
            this.articleStatusD3.hide();
        }
    }

    hideArticleStatusProgress() {
        this.articleStatusView?.hide();
        this.articleStatusD3?.hide();
        this.setArticleStatusSpotlightEnabled(true);
        this.setForegroundInteractive(true);
        this.cameraController?.enable(true);
    }

    setArticleStatusSpotlightEnabled(enabled = true) {
        if (this.spotLight == null || this.spotLightParams == null) {
            return;
        }

        if (!enabled) {
            this.spotLight.intensity = 0;
            return;
        }

        this.spotLight.intensity = this.spotLightParams.intensity;
        this.spotLight.angle = this.spotLightParams.angle;
        this.spotLight.penumbra = this.spotLightParams.penumbra;
        this.spotLight.decay = this.spotLightParams.decay;
    }

    clearCurrentArticleView() {
        this.clearRelationshipKey();

        if (this.articleView == null) {
            return;
        }

        this.articleView.cleanupDynamicViews?.();
        this.articleView.hide?.();
        this.scene?.remove?.(this.articleView.getRootGroup?.());
        ViewPool.returnView(this.articleView);
        this.articleView = null;
    }

    async updateArticleStatusProgress(articleObject) {
        const activeUrl = this.getActiveArticleUrl();
        const status = String(articleObject?.article?.status ?? "").trim().toLowerCase();
        const hasArticle = articleObject?.article != null;
        const hasResolvedArticle =
            articleObject?.article?.ownership_tree_id != null &&
            articleObject?.ownershipTreeObj != null &&
            articleObject?.ownership_tree != null;

        console.log("[submit-flow] updateArticleStatusProgress", {
            activeUrl,
            hasSubmittedValidArticleUrl: this.hasSubmittedValidArticleUrl,
            hasArticle,
            status,
            hasResolvedArticle,
            ownership_tree_id: articleObject?.article?.ownership_tree_id ?? null
        });

        if (activeUrl == null) {
            this.hideArticleStatusProgress();
            return false;
        }

        if (!hasArticle) {
            this.hideArticleStatusProgress();
            return false;
        }

        await this.ensureArticleStatusViews();

        if (hasResolvedArticle) {
            this.hideArticleStatusProgress();
            return false;
        }

        if (
            status.length === 0 ||
            status === "deferred" ||
            status === "not applicable" ||
            status === "not-applicable" ||
            status === "timeout"
        ) {
            this.hideArticleStatusProgress();
            return false;
        }

        const [showThree, showD3] = await Promise.all([
            this.articleStatusView?.showForStatus(status) ?? false,
            this.articleStatusD3?.showForStatus(status) ?? false
        ]);

        console.log("[article-status-renderers]", {
            status,
            showThree,
            showD3
        });

        if (!showThree && !showD3) {
            this.hideArticleStatusProgress();
            return false;
        }

        this.setArticleStatusSpotlightEnabled(false);
        this.cameraController?.enable(false);
        this.articleStatusD3?.resize();
        // Keep the URL input usable while the article status view is visible.
        this.setForegroundInteractive(true);
        return true;
    }

    async renderResolvedArticle(articleObject) {
        this.hideArticleStatusProgress();
        this.hideSubmitStatusMessage();
        this.clearCurrentArticleView();

        this.entities = {};
        this.relationships = {};
        this.evidenceIds = new Set();
        this.evidence = {};

        this.collectEvidenceIds(articleObject.ownershipTreeObj);
        const collectedEvidence = await this.collectEvidence();
        if (collectedEvidence === false) {
            return;
        }
        this.collectEntities(articleObject.ownershipTreeObj);
        this.collectRelationships(articleObject.ownershipTreeObj);

        if (window[`apps_${performance.timeOrigin}`].pepe == null) {
            window[`apps_${performance.timeOrigin}`].pepe = {};
        }
        window[`apps_${performance.timeOrigin}`].pepe.entities = this.entities;
        window[`apps_${performance.timeOrigin}`].pepe.relationships = this.relationships;

        let articleModel = new ArticleModel(articleObject);
        let articleView = ViewPool.getView("article_view");
        articleView.setModel(articleModel);
        this.articleView = articleView;
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
            const link = document.createElement("a");
            const absoluteUrl = articleUrl.startsWith("http") ? articleUrl : `https://${articleUrl}`;
            link.href = absoluteUrl;
            link.target = "_blank";
            link.rel = "noopener noreferrer";
            link.textContent = articleUrl;
            this.articleUrlDisplay.appendChild(link);
        }

        const summaryText = articleObject?.ownershipTreeObj?.summary ?? articleObject?.ownership_tree?.summary;
        if (summaryText && this.summaryBanner) {
            this.renderSummaryBanner(summaryText);
        }

        this.scene.add(articleView.getRootGroup());
        this.startArticleLightingIntro();
        this.applyResolvedArticleCameraZoom();
        this.cameraController?.enable(true);
        await this.fadeOutForeground();
        console.log(articleObject);
    }

    async pollArticleStatus(targetUrl) {
        const token = ++this.articleStatusPollToken;
        const supabase = createClient(
            "https://ukxcjdimupajklqdxbvr.supabase.co",
            "sb_publishable_8DfgTxdV87vYWW-fBkxTng_Whoii-zo"
        );
        const pollDelayMs = 400;

        while (token === this.articleStatusPollToken) {
            await this.wait(pollDelayMs);

            if (token !== this.articleStatusPollToken) {
                return;
            }

            const queueResult = await this.getArticleQueueRowByUrl(supabase, targetUrl);
            if (queueResult.error || queueResult.data == null) {
                continue;
            }

            const articleObject = {
                article: this.parseJsonRecursively(queueResult.data),
                ownershipTreeObj: null,
                ownership_tree: null,
                investigation_prepass_results: this.parseJsonRecursively(
                    queueResult.data.investigation_prepass_results ?? null
                ),
            };

            this.logArticleStatusCheck("poll", articleObject, {
                poll_token: token,
                target_url: targetUrl
            });

            this.showSubmitStatusMessage(this.getQueueStatusMessage(articleObject));
            await this.updateArticleStatusProgress(articleObject);

            if (articleObject.article?.ownership_tree_id) {
                const ownershipTreeObj = await this.fetchOwnershipTreeById(
                    supabase,
                    articleObject.article.ownership_tree_id
                );

                if (ownershipTreeObj != null) {
                    this.stopArticleStatusPolling();
                    articleObject.ownershipTreeObj = ownershipTreeObj;
                    articleObject.ownership_tree = ownershipTreeObj.ownership_tree ?? null;
                    this.logArticleStatusCheck("poll-resolved", articleObject, {
                        poll_token: token,
                        target_url: targetUrl
                    });
                    await this.renderResolvedArticle(articleObject);
                    return;
                }
            }

            const status = String(articleObject?.article?.status ?? "").toLowerCase();
            if (status === "deferred" || status === "not applicable" || status === "not-applicable") {
                this.stopArticleStatusPolling();
                this.hideArticleStatusProgress();
                await this.scheduleSubmitStatusReset({ clearInput: true });
                return;
            }
        }
    }

    loadLut(path) {
        this.lutLoader.load("./resources/LUT/" + path, this.onLutLoaded);
    }

    onLutLoaded(result) {
        this.lutPass.lut = result.texture3D;
    }

    updateCameraGuiState() {
        this.cameraGuiState.position = `${this.camera.position.x.toFixed(2)}, ${this.camera.position.y.toFixed(2)}, ${this.camera.position.z.toFixed(2)}`;
        this.cameraGuiState.fov = this.camera.fov.toFixed(2);
    }

    hideSubmitStatusMessage() {
        if (this.submitStatusMessage == null) {
            return;
        }

        this.submitStatusMessage.textContent = "";
        this.submitStatusMessage.style.opacity = "0";
        this.hideSubmitStatusTimer();
    }

    showSubmitStatusMessage(message) {
        if (this.submitStatusMessage == null) {
            return;
        }

        this.submitStatusMessage.textContent = message;
        this.submitStatusMessage.style.opacity = "0";
        this.hideSupportedSites();
        requestAnimationFrame(() => {
            this.submitStatusMessage.style.opacity = "1";
        });
    }

    hideSupportedSites() {
        if (this.supportedSites == null) {
            return;
        }
        this.supportedSites.classList.add("is-hidden");
        this.supportedSites.style.opacity = "0";
    }

    showSupportedSites() {
        if (this.supportedSites == null) {
            return;
        }
        this.supportedSites.classList.remove("is-hidden");
        this.supportedSites.style.opacity = "1";
    }

    hideSubmitStatusTimer() {
        if (this.submitStatusTimer == null) {
            return;
        }

        this.submitStatusTimer.style.opacity = "0";
        this.submitStatusTimer.style.transition = "none";
        this.submitStatusTimer.style.removeProperty("--submit-status-timer-scale");
        this.submitStatusTimer.style.removeProperty("--submit-status-timer-duration");
        this.submitStatusTimer.offsetWidth;
    }

    startSubmitStatusTimer(durationMs) {
        if (this.submitStatusTimer == null) {
            return;
        }

        this.submitStatusTimer.style.transition = "opacity 120ms ease";
        this.submitStatusTimer.style.opacity = "1";
        this.submitStatusTimer.style.setProperty("--submit-status-timer-duration", `${durationMs}ms`);
        this.submitStatusTimer.style.setProperty("--submit-status-timer-scale", "1");

        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                this.submitStatusTimer.style.setProperty("--submit-status-timer-scale", "0");
            });
        });
    }

    onUrlInputChanged(event) {
        const isPasteEvent = event?.inputType === "insertFromPaste";
        console.log("[submit-flow] onUrlInputChanged", {
            inputType: event?.inputType ?? null,
            isPasteEvent,
            value: this.urlInput?.value ?? "",
            normalizedUrl: this.normalizeUserUrl(this.urlInput?.value ?? ""),
            isManualUrlSubmitMode: this.isManualUrlSubmitMode,
            hasSubmittedValidArticleUrl: this.hasSubmittedValidArticleUrl
        });

        if (!isPasteEvent) {
            this.stopArticleStatusPolling();
            this.hideArticleStatusProgress();
            this.hasSubmittedValidArticleUrl = false;
        }

        if (this.urlInput.value.trim().length === 0) {
            this.resetUrlInputMode();
            return;
        }

        if (!isPasteEvent) {
            this.isManualUrlSubmitMode = true;
        }

        this.cancelPendingSubmitStatusReset();
        this.hideSubmitStatusMessage();
        this.hideSupportedSites();
        this.updateSubmitButtonVisibility();
    }

    onUrlInputPasted() {
        this.stopArticleStatusPolling();
        this.hideArticleStatusProgress();
        this.hasSubmittedValidArticleUrl = false;
        const shouldAutoSubmit = !this.isManualUrlSubmitMode && this.urlInput.value.trim().length === 0;
        console.log("[submit-flow] onUrlInputPasted", {
            valueBeforePaste: this.urlInput?.value ?? "",
            isManualUrlSubmitMode: this.isManualUrlSubmitMode,
            shouldAutoSubmit
        });

        setTimeout(async () => {
            const normalizedUrl = this.normalizeUserUrl(this.urlInput.value);
            console.log("[submit-flow] onUrlInputPasted timeout", {
                valueAfterPaste: this.urlInput?.value ?? "",
                normalizedUrl,
                shouldAutoSubmit,
                isManualUrlSubmitMode: this.isManualUrlSubmitMode
            });

            if (this.urlInput.value.trim().length === 0) {
                this.resetUrlInputMode();
                return;
            }

            if (normalizedUrl == null) {
                this.showSubmitStatusMessage("Not a valid url");
                this.updateSubmitButtonVisibility();
                return;
            }

            if (shouldAutoSubmit) {
                await this.onSubmitClicked();
                return;
            }

            this.updateSubmitButtonVisibility();
        }, 0);
    }

    updateSubmitButtonVisibility() {
        if (this.submitButton == null || this.urlInput == null) {
            return;
        }

        const hasValue = this.urlInput.value.trim().length > 0;
        const isValidUrl = this.normalizeUserUrl(this.urlInput.value) != null;

        if (hasValue && !isValidUrl) {
            this.isManualUrlSubmitMode = true;
        }

        const shouldShowButton = hasValue && (this.isManualUrlSubmitMode || !isValidUrl);

        this.submitButton.style.visibility = shouldShowButton ? "visible" : "hidden";
        this.submitButtonContainer?.classList.toggle("is-visible", shouldShowButton);
    }

    resetUrlInputMode() {
        this.cancelPendingSubmitStatusReset();
        this.isManualUrlSubmitMode = false;
        this.hasSubmittedValidArticleUrl = false;
        this.hideSubmitStatusMessage();
        this.showSupportedSites();
        this.updateSubmitButtonVisibility();
    }

    cancelPendingSubmitStatusReset() {
        this.pendingSubmitStatusResetToken += 1;
        this.hideSubmitStatusTimer();
    }

    async scheduleSubmitStatusReset({ clearInput = true } = {}) {
        const token = ++this.pendingSubmitStatusResetToken;
        const delayMs = SUBMIT_STATUS_FADE_MS + SUBMIT_STATUS_INPUT_CLEAR_DELAY_MS;
        this.startSubmitStatusTimer(delayMs);
        await this.wait(delayMs);

        if (token !== this.pendingSubmitStatusResetToken) {
            return false;
        }

        if (clearInput) {
            this.urlInput.value = "";
        }

        this.resetUrlInputMode();
        return true;
    }

    setForegroundInteractive(isInteractive = true) {
        if (this.foreground == null) {
            return;
        }

        this.foreground.style.pointerEvents = isInteractive ? "auto" : "none";
    }

    applyCameraZoomPreset(preset) {
        this.cameraController?.setZoomImmediate?.(preset);
    }

    applyArticleStatusCameraZoom() {
        this.applyCameraZoomPreset(CAMERA_STATUS_ZOOM);
    }

    applyResolvedArticleCameraZoom() {
        this.applyCameraZoomPreset(CAMERA_ARTICLE_VIEW_ZOOM);
    }

    hideForeground() {
        this.setForegroundInteractive(false);
        this.foreground.classList.remove("is-hiding");
        this.foreground.style.opacity = "1";
        this.foreground.style.display = "none";
    }

    showForeground() {
        this.setForegroundInteractive(true);
        this.foreground.classList.remove("is-hiding");
        this.foreground.style.display = "initial";
        this.foreground.style.opacity = "1";
        this.hideNewSearchContainer();
        this.hideShareContainer();
        this.hideArticleStatusProgress();
    }

    onSubmitButtonPointerDown() {
        if (this.normalizeUserUrl(this.urlInput.value) == null) {
            return;
        }

        this.startForegroundFadeOut();
    }

    startForegroundFadeOut() {
        if (this.normalizeUserUrl(this.urlInput?.value) == null) {
            return;
        }

        this.hidePageBackground();
        this.activateThreeCanvas();
        this.hideSubmitStatusMessage();
        this.foreground.style.display = "initial";

        if (this.foreground.classList.contains("is-hiding")) {
            return;
        }

        this.foreground.classList.remove("is-hiding");
        void this.foreground.offsetWidth;
        this.foreground.classList.add("is-hiding");
    }

    async fadeOutForeground({ afterFadeOut = null } = {}) {
        this.startForegroundFadeOut();
        await this.wait(FOREGROUND_FADE_OUT_MS);
        await afterFadeOut?.();
        this.hideForeground();
    }

    wait(ms) {
        return new Promise((resolve) => {
            window.setTimeout(resolve, ms);
        });
    }

    updateAmbientDependentLabelVisibility() {
        if (this.articleView?.setLabelsVisible == null || this.ambientLights == null) {
            this.lastAmbientDependentLabelsVisible = null;
            return;
        }

        const hasAmbientLight = this.ambientLights.some((light) => (light?.intensity ?? 0) > 1e-6);

        if (this.lastAmbientDependentLabelsVisible === hasAmbientLight) {
            return;
        }

        this.lastAmbientDependentLabelsVisible = hasAmbientLight;
        this.articleView.setLabelsVisible(hasAmbientLight);
    }

    updateArticleStatusCameraFollow() {
        if (this.cameraController == null) {
            return;
        }

        if (this.visualizationMode !== "three" || this.articleStatusView?.isShown !== true) {
            this.cameraController.clearIdleHome?.();
            return;
        }

        const focusPoint = this.articleStatusView.getCurrentStatusWorldPosition?.(new THREE.Vector3());
        if (focusPoint == null) {
            this.cameraController.clearIdleHome?.();
            return;
        }

        const currentPanBase = this.cameraController.getPanBase?.(new THREE.Vector3())
            ?? this.camera.position.clone();
        const targetPanBase = currentPanBase.clone();
        targetPanBase.x = focusPoint.x + CAMERA_STATUS_FOLLOW_POSITION_OFFSET.x;
        targetPanBase.y = focusPoint.y + CAMERA_STATUS_FOLLOW_POSITION_OFFSET.y;

        this.cameraController.setIdleHome?.({
            panBase: targetPanBase,
            zoom: { ...CAMERA_STATUS_ZOOM }
        });
    }

    updateArticleHoverOverlay(deltaTimeSeconds) {
        if (this.articleHoverOverlay == null) {
            return;
        }

        const hoveredIntersection =
            this.visualizationMode === "three"
                ? InputService.getHoveredIntersection()
                : null;
        const hoveredCollider = hoveredIntersection?.collider ?? null;

        if (hoveredCollider == null) {
            this.articleHoverOverlay.visible = false;
            this.articleHoverOverlay.material.opacity = 0;
            return;
        }

        let center = null;
        let size = null;
        let quaternion = null;

        if (hoveredCollider instanceof THREE.Box3) {
            if (hoveredCollider.isEmpty()) {
                this.articleHoverOverlay.visible = false;
                this.articleHoverOverlay.material.opacity = 0;
                return;
            }

            center = hoveredCollider.getCenter(new THREE.Vector3());
            size = hoveredCollider.getSize(new THREE.Vector3());
            quaternion = new THREE.Quaternion();
        } else {
            center = hoveredCollider.center.clone();
            size = hoveredCollider.halfSize.clone().multiplyScalar(2);
            const rotationMatrix = new THREE.Matrix4().setFromMatrix3(
                new THREE.Matrix3().copy(hoveredCollider.rotation)
            );
            quaternion = new THREE.Quaternion().setFromRotationMatrix(rotationMatrix);
        }

        const overlayNormal = new THREE.Vector3(0, 0, 1).applyQuaternion(quaternion).normalize();
        center.addScaledVector(overlayNormal, 0.02);

        this.articleHoverOverlay.visible = true;
        this.articleHoverOverlay.position.copy(center);
        this.articleHoverOverlay.quaternion.copy(quaternion);

        size.x += 0.169;
        size.y += 0.169;

        this.articleHoverOverlay.scale.set(
            size.x,
            size.y,
            1
        );

        const fadeStep = (deltaTimeSeconds * 1000) / ARTICLE_HOVER_PLANE_FADE_IN_MS;
        this.articleHoverOverlay.material.opacity = THREE.MathUtils.clamp(
            this.articleHoverOverlay.material.opacity + (ARTICLE_HOVER_PLANE_OPACITY * fadeStep),
            0,
            ARTICLE_HOVER_PLANE_OPACITY
        );
    }

    startArticleLightingIntro() {
        this.articleLightingIntro = {
            elapsedMs: 0,
            blackoutDurationMs: ARTICLE_LIGHTING_BLACKOUT_DURATION_MS,
            ambientToLowDurationMs: ARTICLE_LIGHTING_AMBIENT_TO_LOW_DURATION_MS,
            ambientToFullDurationMs: ARTICLE_LIGHTING_AMBIENT_TO_FULL_DURATION_MS,
            spotlightDelayMs: ARTICLE_LIGHTING_SPOTLIGHT_DELAY_MS,
            spotlightFlareDurationMs: ARTICLE_LIGHTING_SPOTLIGHT_FLARE_DURATION_MS,
            targetAmbientIntensities: this.ambientLights.map((light) => light.intensity),
            lowAmbientIntensities: this.ambientLights.map(
                (light) => light.intensity * ARTICLE_LIGHTING_AMBIENT_LOW_MULTIPLIER
            ),
            targetSpotLightIntensity: this.spotLight.intensity,
            targetSpotLightAngle: this.spotLight.angle,
            targetSpotLightPenumbra: this.spotLight.penumbra,
            spotlightFlareElapsedMs: null,
            ambientToFullElapsedMs: null,
            spotlightPeakIntensity:
                this.spotLight.intensity * this.spotLightParams.flareIntensityMultiplier,
            spotlightPeakAngle: Math.min(
                Math.PI / 3,
                this.spotLight.angle * ARTICLE_LIGHTING_SPOTLIGHT_ANGLE_FLARE_MULTIPLIER
            ),
            spotlightPeakPenumbra: THREE.MathUtils.clamp(
                this.spotLight.penumbra + ARTICLE_LIGHTING_SPOTLIGHT_PENUMBRA_FLARE_OFFSET,
                0,
                1
            )
        };

        this.threeCanvas.style.filter = "brightness(0)";
        this.ambientLights.forEach((light) => {
            light.intensity = 0;
        });
        this.spotLight.intensity = 0;
    }

    updateArticleLightingIntro(deltaTimeSeconds) {
        if (this.articleLightingIntro == null) {
            return;
        }

        this.articleLightingIntro.elapsedMs += deltaTimeSeconds * 1000;
        const blackoutProgress = THREE.MathUtils.clamp(
            this.articleLightingIntro.elapsedMs / this.articleLightingIntro.blackoutDurationMs,
            0,
            1
        );

        if (blackoutProgress < 1) {
            return;
        }

        this.threeCanvas.style.filter = "brightness(1)";
        const ambientToLowProgress = THREE.MathUtils.clamp(
            (this.articleLightingIntro.elapsedMs - this.articleLightingIntro.blackoutDurationMs) /
            this.articleLightingIntro.ambientToLowDurationMs,
            0,
            1
        );
        const easedAmbientToLowProgress =
            1 - Math.sqrt(1 - (ambientToLowProgress * ambientToLowProgress));

        this.ambientLights.forEach((light, index) => {
            light.intensity = THREE.MathUtils.lerp(
                0,
                this.articleLightingIntro.lowAmbientIntensities[index] ?? light.intensity,
                easedAmbientToLowProgress
            );
        });

        const spotlightDelayElapsedMs =
            this.articleLightingIntro.elapsedMs -
            this.articleLightingIntro.blackoutDurationMs;

        if (
            spotlightDelayElapsedMs >= this.articleLightingIntro.spotlightDelayMs &&
            this.articleLightingIntro.spotlightFlareElapsedMs == null
        ) {
            this.articleLightingIntro.spotlightFlareElapsedMs = 0;
            this.spotLight.intensity = this.articleLightingIntro.spotlightPeakIntensity;
            this.spotLight.angle = this.articleLightingIntro.spotlightPeakAngle;
            this.spotLight.penumbra = this.articleLightingIntro.spotlightPeakPenumbra;
            this.articleUrlDisplay?.classList.add("is-visible");
            this.showNewSearchContainer();
            this.showShareContainer();
        }

        if (this.articleLightingIntro.spotlightFlareElapsedMs != null) {
            this.articleLightingIntro.spotlightFlareElapsedMs += deltaTimeSeconds * 1000;

            const flareProgress = THREE.MathUtils.clamp(
                this.articleLightingIntro.spotlightFlareElapsedMs /
                this.articleLightingIntro.spotlightFlareDurationMs,
                0,
                1
            );
            const easedFlareProgress = 1 - Math.pow(1 - flareProgress, 3);

            this.spotLight.intensity = THREE.MathUtils.lerp(
                this.articleLightingIntro.spotlightPeakIntensity,
                this.articleLightingIntro.targetSpotLightIntensity,
                easedFlareProgress
            );
            this.spotLight.angle = THREE.MathUtils.lerp(
                this.articleLightingIntro.spotlightPeakAngle,
                this.articleLightingIntro.targetSpotLightAngle,
                easedFlareProgress
            );
            this.spotLight.penumbra = THREE.MathUtils.lerp(
                this.articleLightingIntro.spotlightPeakPenumbra,
                this.articleLightingIntro.targetSpotLightPenumbra,
                easedFlareProgress
            );

            if (flareProgress >= 1) {
                this.spotLight.intensity = this.articleLightingIntro.targetSpotLightIntensity;
                this.spotLight.angle = this.articleLightingIntro.targetSpotLightAngle;
                this.spotLight.penumbra = this.articleLightingIntro.targetSpotLightPenumbra;
            }

            if (this.articleLightingIntro.ambientToFullElapsedMs == null) {
                this.articleLightingIntro.ambientToFullElapsedMs = 0;
            }
        }

        if (this.articleLightingIntro.ambientToFullElapsedMs != null) {
            this.articleLightingIntro.ambientToFullElapsedMs += deltaTimeSeconds * 1000;

            const ambientToFullProgress = THREE.MathUtils.clamp(
                this.articleLightingIntro.ambientToFullElapsedMs /
                this.articleLightingIntro.ambientToFullDurationMs,
                0,
                1
            );
            const easedAmbientToFullProgress = 1 - Math.pow(1 - ambientToFullProgress, 3);

            this.ambientLights.forEach((light, index) => {
                light.intensity = THREE.MathUtils.lerp(
                    this.articleLightingIntro.lowAmbientIntensities[index] ?? light.intensity,
                    this.articleLightingIntro.targetAmbientIntensities[index] ?? light.intensity,
                    easedAmbientToFullProgress
                );
            });

            if (ambientToFullProgress >= 1) {
                this.articleLightingIntro = null;
            }
        }
    }

    render() {
        if (ENABLE_PAGE_BACKGROUND) {
            if (!this.threeCanvas?.classList.contains("is-active")) {
                requestAnimationFrame(this.render);
                return;
            }
        }

        this.now = Date.now();

        this.deltaTime = this.now - this.prevFrameTime;
        this.deltaTime /= 1000;

        this.stats.begin();

        this.lutPass.enabled = this.lutParams.enabled;
        this.lutPass.intensity = this.lutParams.intensity;
        this.updateCameraGuiState();
        this.updateArticleLightingIntro(this.deltaTime);
        this.updateAmbientDependentLabelVisibility();
        this.updateArticleStatusCameraFollow();
        this.updateArticleHoverOverlay(this.deltaTime);

        if (this.visualizationMode === "d3") {
            this.d3Graph?.tick();
        }

        if (this.visualizationMode === "three") {
            const spotlightFollowAlpha = THREE.MathUtils.clamp(
                this.deltaTime * this.spotLightParams.followSpeed,
                0,
                1
            );
            const spotLightPosition = this.spotLight.position.clone();
            const spotLightTargetPos = this.spotLight.target.position.clone();

            spotLightPosition.x = THREE.MathUtils.lerp(
                spotLightPosition.x,
                this.camera.position.x,
                spotlightFollowAlpha
            );
            spotLightPosition.y = THREE.MathUtils.lerp(
                spotLightPosition.y,
                this.camera.position.y,
                spotlightFollowAlpha
            );
            spotLightTargetPos.x = THREE.MathUtils.lerp(
                spotLightTargetPos.x,
                this.camera.position.x,
                spotlightFollowAlpha
            );
            spotLightTargetPos.y = THREE.MathUtils.lerp(
                spotLightTargetPos.y,
                this.camera.position.y,
                spotlightFollowAlpha
            );

            this.spotLight.position.x = spotLightPosition.x;
            this.spotLight.position.y = spotLightPosition.y;
            this.spotLight.target.position.x = spotLightTargetPos.x;
            this.spotLight.target.position.y = spotLightTargetPos.y;

            this.camera.layers.set(MAIN_RENDER_LAYER);
            this.cameraController.update();

            if (this.lutParams.skipComposer) {
                this.renderer.render(this.scene, this.camera);
            } else {
                this.composer.render();
            }

            const previousAutoClear = this.renderer.autoClear;
            this.renderer.autoClear = false;
            this.camera.layers.set(SDF_TEXT_RENDER_LAYER);
            this.renderer.render(this.scene, this.camera);
            this.renderer.autoClear = previousAutoClear;
            this.camera.layers.enable(MAIN_RENDER_LAYER);
            this.camera.layers.enable(SDF_TEXT_RENDER_LAYER);
        }
        this.stats.end();

        this.animationFrameId = requestAnimationFrame(this.render);
        this.prevFrameTime = this.now;
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
            width: window.visualViewport?.width ?? window.innerWidth,
            height: window.visualViewport?.height ?? window.innerHeight
        };
    }

    onWindowResize() {
        this.updateViewportMetrics();
        const { width, height } = this.getRenderDimensions();

        this.renderer.setSize(width, height, false);
        this.composer?.setSize(width, height, false);
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.articleStatusD3?.resize();
        this.updateArticleActionToolbarPosition();

        if (this.visualizationMode === "d3") {
            this.d3Graph?.resize();
        }
    }

    initializeVisualizationToggle() {
        this.visualizationButtons.three?.addEventListener("click", () => {
            this.setVisualizationMode("three");
        });

        this.visualizationButtons.d3?.addEventListener("click", () => {
            this.setVisualizationMode("d3");
        });
    }

    initializeDetailPanel() {
        this.detailPanelCloseButton?.addEventListener("click", this.closeDetailPanel);
    }

    formatDetailPanelContent(data) {
        if (data == null) {
            return "";
        }

        if (typeof data === "string") {
            return data;
        }

        try {
            return JSON.stringify(data, null, 2);
        }
        catch (_err) {
            return String(data);
        }
    }

    normalizeDetailInput(kind, data) {
        if (kind === "entity" && data?.model) {
            return data.model;
        }

        if (kind === "relationship" && data?.model) {
            return {
                ...data.model,
                relation: data.relation ?? data.model?.relation
            };
        }

        return data;
    }

    createDetailLayout() {
        const root = document.createElement("div");
        root.className = "detail-panel-layout";
        return root;
    }

    createDetailSection(title) {
        const section = document.createElement("section");
        section.className = "detail-section";

        if (title) {
            const heading = document.createElement("div");
            heading.className = "detail-section-title";
            heading.textContent = title;
            section.appendChild(heading);
        }

        return section;
    }

    createField(label, value) {
        if (value == null || value === "" || (Array.isArray(value) && value.length === 0)) {
            return null;
        }

        const row = document.createElement("div");
        row.className = "detail-field";

        const labelEl = document.createElement("div");
        labelEl.className = "detail-field-label";
        labelEl.textContent = label;

        const valueEl = document.createElement("div");
        valueEl.className = "detail-field-value";
        valueEl.appendChild(this.createDetailValueNode(value));

        row.append(labelEl, valueEl);
        return row;
    }

    isProbablyUrl(value) {
        if (typeof value !== "string") {
            return false;
        }

        return /^(https?:\/\/|www\.|[a-z0-9-]+\.[a-z]{2,})(\/|$)/i.test(value.trim());
    }

    normalizeUrlForHref(value) {
        const text = String(value).trim();
        if (/^https?:\/\//i.test(text)) {
            return text;
        }

        if (/^www\./i.test(text)) {
            return `https://${text}`;
        }

        return `https://www.${text}`;
    }

    createUrlLink(value) {
        const link = document.createElement("a");
        link.className = "detail-link";
        link.href = this.normalizeUrlForHref(value);
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = String(value);
        return link;
    }

    resolveEvidenceById(evidenceId) {
        return this.evidence?.[evidenceId] ?? null;
    }

    openEntityDetailById(entityId) {
        const entity = this.resolveEntityById(entityId);
        if (entity == null) {
            return;
        }

        this.openDetailPanel({
            title: "Entity Details",
            kind: "entity",
            data: entity
        });
    }

    openEvidenceDetailById(evidenceId) {
        const evidence = this.resolveEvidenceById(evidenceId);
        if (evidence == null) {
            return;
        }

        this.openDetailPanel({
            title: "Evidence Details",
            kind: "evidence",
            data: evidence
        });
    }

    createReferenceLink(label, onClick) {
        const link = document.createElement("a");
        link.href = "#";
        link.className = "detail-link detail-ref-button";
        link.textContent = label;
        link.addEventListener("click", (event) => {
            event.preventDefault();
            onClick?.(event);
        });
        return link;
    }

    createDetailValueNode(value) {
        if (value instanceof Node) {
            return value;
        }

        if (Array.isArray(value)) {
            const wrapper = document.createElement("div");
            wrapper.className = "detail-inline-list";
            value.forEach((item, index) => {
                const node = this.createDetailValueNode(item);
                wrapper.appendChild(node);
                if (index < value.length - 1 && node.nodeType === Node.TEXT_NODE) {
                    wrapper.appendChild(document.createTextNode(", "));
                }
            });
            return wrapper;
        }

        if (typeof value === "string" && this.isProbablyUrl(value)) {
            return this.createUrlLink(value);
        }

        return document.createTextNode(String(value));
    }

    createFieldListSection(title, fields) {
        const validFields = fields
            .map(({ label, value }) => this.createField(label, value))
            .filter(Boolean);

        if (validFields.length === 0) {
            return null;
        }

        const section = this.createDetailSection(title);
        const list = document.createElement("div");
        list.className = "detail-field-list";
        validFields.forEach((field) => list.appendChild(field));
        section.appendChild(list);
        return section;
    }

    createChipSection(title, items) {
        if (Array.isArray(items) === false || items.length === 0) {
            return null;
        }

        const section = this.createDetailSection(title);
        const row = document.createElement("div");
        row.className = "detail-chip-row";

        items.forEach((item) => {
            const chip = document.createElement("div");
            chip.className = "detail-chip";
            chip.textContent = String(item);
            row.appendChild(chip);
        });

        section.appendChild(row);
        return section;
    }

    createRawSection(title, data) {
        if (data == null || (typeof data === "object" && Object.keys(data).length === 0)) {
            return null;
        }

        const section = this.createDetailSection(title);
        section.appendChild(this.renderRawValue(this.parseJsonRecursively(data)));
        return section;
    }

    createEvidenceSection(title, evidenceMap) {
        if (evidenceMap == null || typeof evidenceMap !== "object" || Object.keys(evidenceMap).length === 0) {
            return null;
        }

        const section = this.createDetailSection(title);
        const list = document.createElement("div");
        list.className = "detail-field-list";

        Object.entries(evidenceMap).forEach(([evidenceId, evidence]) => {
            const item = document.createElement("div");
            item.className = "detail-section";

            [
                this.createField("ID", this.createReferenceLink(String(evidenceId), () => this.openEvidenceDetailById(evidenceId))),
                this.createField("Source", evidence?.source ? this.createUrlLink(evidence.source) : null),
                this.createField("Date", evidence?.date),
                this.createField("Excerpt", evidence?.excerpt)
            ].filter(Boolean).forEach((field) => item.appendChild(field));

            list.appendChild(item);
        });

        section.appendChild(list);
        return section;
    }

    resolveEntityById(entityId) {
        return this.entities?.[entityId] ?? null;
    }

    renderRawValue(value, key = "") {
        if (value == null) {
            const div = document.createElement("div");
            div.className = "detail-field-value";
            div.textContent = "null";
            return div;
        }

        if (Array.isArray(value)) {
            const wrapper = document.createElement("div");
            wrapper.className = "detail-raw-block";

            value.forEach((item, index) => {
                const row = document.createElement("div");
                row.className = "detail-raw-row";
                const keyEl = document.createElement("div");
                keyEl.className = "detail-raw-key";
                keyEl.textContent = `${key || "item"} ${index + 1}`;
                row.appendChild(keyEl);
                row.appendChild(this.renderRawValue(item, key));
                wrapper.appendChild(row);
            });

            return wrapper;
        }

        if (typeof value === "object") {
            const wrapper = document.createElement("div");
            wrapper.className = "detail-raw-block";

            Object.entries(value).forEach(([entryKey, entryValue]) => {
                const row = document.createElement("div");
                row.className = "detail-raw-row";
                const keyEl = document.createElement("div");
                keyEl.className = "detail-raw-key";
                keyEl.textContent = entryKey;
                row.appendChild(keyEl);
                row.appendChild(this.renderRawValue(entryValue, entryKey));
                wrapper.appendChild(row);
            });

            return wrapper;
        }

        if ((key === "source" || key.endsWith("_url") || key === "url") && this.isProbablyUrl(value)) {
            const div = document.createElement("div");
            div.className = "detail-field-value";
            div.appendChild(this.createUrlLink(value));
            return div;
        }

        if ((key === "source" || key === "target" || key === "source_entity_id" || key === "target_entity_id") && this.resolveEntityById(value)) {
            const div = document.createElement("div");
            div.className = "detail-field-value";
            div.appendChild(this.createReferenceLink(
                this.resolveEntityById(value)?.name ?? String(value),
                () => this.openEntityDetailById(value)
            ));
            return div;
        }

        if ((key === "id" || key === "evidence_id") && this.resolveEvidenceById(value)) {
            const div = document.createElement("div");
            div.className = "detail-field-value";
            div.appendChild(this.createReferenceLink(
                String(value),
                () => this.openEvidenceDetailById(value)
            ));
            return div;
        }

        const pre = document.createElement("pre");
        pre.className = "detail-pre";
        pre.textContent = String(value);
        return pre;
    }

    renderEntityDetail(entity) {
        const layout = this.createDetailLayout();
        const hero = document.createElement("section");
        hero.className = "detail-hero";
        hero.innerHTML = `
            <div class="detail-kicker">Entity</div>
            <div class="detail-heading">${entity?.name ?? "Unknown Entity"}</div>
            <div class="detail-subheading">${entity?.entity_type ?? entity?.type ?? "Unknown type"}</div>
        `;
        layout.appendChild(hero);

        [
            this.createChipSection("Aliases", entity?.aliases),
            this.createFieldListSection("Narrative", [
                { label: "Notes", value: entity?.notes },
                { label: "Context", value: entity?.context }
            ]),
            this.createChipSection("Tags", entity?.tags),
            this.createEvidenceSection("Evidence", entity?.evidence),
            this.createRawSection("Relationships", entity?.relationships),
            this.createFieldListSection("Summary", [
                { label: "ID", value: entity?.id },
                { label: "Status", value: entity?.status },
                { label: "Created", value: entity?.created_at }
            ]),
            this.createRawSection("Metadata", entity?.metadata),
        ].filter(Boolean).forEach((section) => layout.appendChild(section));

        return layout;
    }

    renderRelationshipDetail(input) {
        const model = input?.model ?? input;
        const sourceEntity = this.resolveEntityById(model?.source ?? input?.source_entity_id);
        const targetEntity = this.resolveEntityById(model?.target ?? input?.target_entity_id);
        const layout = this.createDetailLayout();
        const hero = document.createElement("section");
        hero.className = "detail-hero";
        hero.innerHTML = `
            <div class="detail-kicker">Relationship</div>
            <div class="detail-heading">${model?.relation ?? input?.relation ?? "Unknown relation"}</div>
            <div class="detail-subheading">${sourceEntity?.name ?? model?.source ?? input?.source_entity_id ?? "Unknown source"} -> ${targetEntity?.name ?? model?.target ?? input?.target_entity_id ?? "Unknown target"}</div>
        `;
        layout.appendChild(hero);

        [
            this.createFieldListSection("Endpoints", [
                {
                    label: "Source",
                    value: sourceEntity
                        ? this.createReferenceLink(sourceEntity.name ?? model?.source, () => this.openEntityDetailById(sourceEntity.id))
                        : model?.source ?? input?.source_entity_id
                },
                { label: "Source ID", value: model?.source ?? input?.source_entity_id },
                {
                    label: "Target",
                    value: targetEntity
                        ? this.createReferenceLink(targetEntity.name ?? model?.target, () => this.openEntityDetailById(targetEntity.id))
                        : model?.target ?? input?.target_entity_id
                },
                { label: "Target ID", value: model?.target ?? input?.target_entity_id }
            ]),
            this.createEvidenceSection("Evidence", model?.evidence ?? input?.evidence),
            this.createRawSection("Raw Relationship", input)
        ].filter(Boolean).forEach((section) => layout.appendChild(section));

        return layout;
    }

    renderEvidenceDetail(evidence) {
        const layout = this.createDetailLayout();
        const hero = document.createElement("section");
        hero.className = "detail-hero";
        hero.innerHTML = `
            <div class="detail-kicker">Evidence</div>
            <div class="detail-heading">${evidence?.source ?? "Evidence Source"}</div>
            <div class="detail-subheading">${evidence?.date ?? "No date available"}</div>
        `;
        layout.appendChild(hero);

        [
            this.createFieldListSection("Summary", [
                { label: "ID", value: evidence?.id },
                {
                    label: "Source",
                    value: this.createUrlLink(evidence?.source)
                },
                { label: "Date", value: evidence?.date }
            ]),
            this.createFieldListSection("Excerpt", [
                { label: "Excerpt", value: evidence?.excerpt }
            ]),
            this.createRawSection("Raw Evidence", evidence?.raw ?? evidence)
        ].filter(Boolean).forEach((section) => layout.appendChild(section));

        return layout;
    }

    renderDetailPanelContent(kind, data, body = "") {
        const normalized = this.normalizeDetailInput(kind, data);

        if (kind === "entity") {
            return this.renderEntityDetail(normalized);
        }

        if (kind === "relationship") {
            return this.renderRelationshipDetail(normalized);
        }

        if (kind === "evidence") {
            return this.renderEvidenceDetail(normalized);
        }

        const pre = document.createElement("pre");
        pre.className = "detail-pre";
        pre.textContent = normalized != null ? this.formatDetailPanelContent(normalized) : body;
        return pre;
    }

    openDetailPanel({ title = "Details", body = "", data = null, kind = "" } = {}) {
        if (this.detailPanel == null) {
            return;
        }

        if (this.detailPanelTitle) {
            this.detailPanelTitle.textContent = title;
        }

        if (this.detailPanelBody) {
            this.detailPanelBody.innerHTML = "";
            this.detailPanelBody.appendChild(
                this.renderDetailPanelContent(kind, data, body)
            );
        }

        this.detailPanel.classList.add("is-open");
        this.detailPanel.setAttribute("aria-hidden", "false");
    }

    closeDetailPanel() {
        if (this.detailPanel == null) {
            return;
        }

        this.detailPanel.classList.remove("is-open");
        this.detailPanel.setAttribute("aria-hidden", "true");
    }

    setVisualizationMode(mode) {
        this.visualizationMode = mode === "d3" ? "d3" : "three";
        localStorage.setItem("visual-mode", this.visualizationMode);

        const showD3 = this.visualizationMode === "d3";

        if (this.threeCanvas) {
            this.threeCanvas.style.opacity = showD3 ? "0" : "1";
            this.threeCanvas.style.pointerEvents = showD3 ? "none" : "all";
        }

        if (this.d3CanvasContainer) {
            this.d3CanvasContainer.style.opacity = showD3 ? "1" : "0";
            this.d3CanvasContainer.style.pointerEvents = showD3 ? "auto" : "none";
            this.d3CanvasContainer.setAttribute("aria-hidden", showD3 ? "false" : "true");
        }

        this.visualizationButtons.three?.classList.toggle("is-active", showD3 === false);
        this.visualizationButtons.d3?.classList.toggle("is-active", showD3);

        if (this.detailPanel) {
            this.detailPanel.classList.toggle("light-mode", showD3);
        }

        if (this.articleUrlDisplay) {
            this.articleUrlDisplay.classList.toggle("light-mode", showD3);
        }

        if (this.submitStatusMessage) {
            this.submitStatusMessage.classList.toggle("light-mode", showD3);
        }

        if (this.submitStatusTimer) {
            this.submitStatusTimer.classList.toggle("light-mode", showD3);
        }

        this.newSearchButton.classList.toggle("light-mode", showD3);
        this.newSearchContainer?.classList.toggle("light-mode", showD3);
        this.shareButton?.classList.toggle("light-mode", showD3);
        this.shareContainer?.classList.toggle("light-mode", showD3);
        this.shareFeedback?.classList.toggle("light-mode", showD3);
        this.submitButton?.classList.toggle("light-mode", showD3);
        this.submitButtonContainer?.classList.toggle("light-mode", showD3);
        this.supportCtaButton?.classList.toggle("light-mode", showD3);
        this.supportButtons?.classList.toggle("light-mode", showD3);
        this.pageTitle?.classList.toggle("light-mode", showD3);
        this.updateRelationshipKeyVisibility();

        if (showD3) {
            this.d3Graph.resize();
            return;
        }

        if (this.renderer && this.camera && this.composer) {
            this.onWindowResize();
            this.renderer.clear(true, true, true);
            this.camera.layers.set(MAIN_RENDER_LAYER);
            this.cameraController.update();
            this.composer.render();

            const previousAutoClear = this.renderer.autoClear;
            this.renderer.autoClear = false;
            this.camera.layers.set(SDF_TEXT_RENDER_LAYER);
            this.renderer.render(this.scene, this.camera);
            this.renderer.autoClear = previousAutoClear;
            this.camera.layers.enable(MAIN_RENDER_LAYER);
            this.camera.layers.enable(SDF_TEXT_RENDER_LAYER);
        }
    }

    renderSummaryBanner(text) {
        const banner = this.summaryBanner;
        if (!banner) return;

        banner.innerHTML = "";
        banner.classList.remove("is-visible");

        const CFG = {
            baseDelayMs: 80,
            perWordStartOffsetMs: 400,
            fadeInMs: 500,
            holdMs: 300,
            settleMs: 520,
            initialOpacity: 0.78,
            settledOpacity: 0.92,
            fadeInEasing: "ease-in",
            settleEasing: "cubic-bezier(0.2, 0.8, 0.2, 1)"
        };

        const ensureStyles = () => {
            if (banner._stylesAdded) return;
            banner._stylesAdded = true;

            const style = document.createElement("style");
            style.textContent = `
                @keyframes __banner_word_fade_in {
                    from { opacity: 0; transform: translateY(1px); filter: blur(0.25px); }
                    to { opacity: ${CFG.initialOpacity}; transform: translateY(0); filter: blur(0); }
                }
                @keyframes __banner_word_settle {
                    from { opacity: ${CFG.initialOpacity}; }
                    to { opacity: ${CFG.settledOpacity}; }
                }
                #summary-banner .banner-word {
                    animation-name: __banner_word_fade_in, __banner_word_settle;
                    animation-duration: ${CFG.fadeInMs}ms, ${CFG.settleMs}ms;
                    animation-timing-function: ${CFG.fadeInEasing}, ${CFG.settleEasing};
                    animation-fill-mode: forwards, forwards;
                }
            `;
            document.head.appendChild(style);
        };
        ensureStyles();

        let trimmedText = text.trim();
        const hasPeriod = trimmedText.endsWith(".");
        const textWithoutPeriod = hasPeriod ? trimmedText.slice(0, -1).trimEnd() : trimmedText;
        const words = textWithoutPeriod.split(/\s+/);

        const container = document.createElement("div");
        container.style.display = "inline";

        for (let i = 0; i < words.length; i++) {
            const span = document.createElement("span");
            span.className = "banner-word";
            span.textContent = i < words.length - 1 ? words[i] + " " : words[i];

            const startDelay = CFG.baseDelayMs + i * CFG.perWordStartOffsetMs;
            const settleDelay = startDelay + CFG.fadeInMs + CFG.holdMs;

            span.style.animationDelay = `${startDelay}ms, ${settleDelay}ms`;
            container.appendChild(span);
        }

        if (!hasPeriod) {
            const periodSpan = document.createElement("span");
            periodSpan.className = "banner-word";
            periodSpan.textContent = ".";

            const periodIndex = words.length;
            const startDelay = CFG.baseDelayMs + periodIndex * CFG.perWordStartOffsetMs;
            const settleDelay = startDelay + CFG.fadeInMs + CFG.holdMs;

            periodSpan.style.animationDelay = `${startDelay}ms, ${settleDelay}ms`;
            container.appendChild(periodSpan);
        }

        banner.appendChild(container);

        requestAnimationFrame(() => {
            banner.classList.add("is-visible");
        });
    }

}

export { App };
