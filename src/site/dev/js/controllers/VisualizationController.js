import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { SSAARenderPass } from "three/addons/postprocessing/SSAARenderPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { LUTPass } from "three/addons/postprocessing/LUTPass.js";
import { TAARenderPass } from "three/addons/postprocessing/TAARenderPass.js";
// 
// import { CameraController } from "../rendering/CameraController.js";
// import { InputService } from "../services/InputService.js";
// import { ArticleStatus } from "../views/ArticleStatus.js";
// import { ArticleStatusD3 } from "../components/ArticleStatusD3.js";
// 
const appModules = window[`apps_${performance.timeOrigin}`].modules;
const { CameraController } = appModules.rendering.CameraController;
const { InputService } = appModules.services.InputService;
const { ArticleStatus } = appModules.views.ArticleStatus;
const { ArticleStatusD3 } = appModules.components.ArticleStatusD3;

const MAIN_RENDER_LAYER = 0;
const SDF_TEXT_RENDER_LAYER = 1;
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

const ARTICLE_LIGHTING_BLACKOUT_DURATION_MS = 500;
const ARTICLE_LIGHTING_AMBIENT_LOW_MULTIPLIER = 0.0;
const ARTICLE_LIGHTING_AMBIENT_TO_LOW_DURATION_MS = 100;
const ARTICLE_LIGHTING_AMBIENT_TO_FULL_DURATION_MS = 600;
const ARTICLE_LIGHTING_SPOTLIGHT_DELAY_MS = 100;
const ARTICLE_LIGHTING_SPOTLIGHT_FLARE_DURATION_MS = 800;
const ARTICLE_LIGHTING_SPOTLIGHT_ANGLE_FLARE_MULTIPLIER = 1.1;
const ARTICLE_LIGHTING_SPOTLIGHT_PENUMBRA_FLARE_OFFSET = 0.35;
const ARTICLE_LIGHTING_SPOTLIGHT_FLARE_INTENSITY_MULTIPLIER = 1.3;
const ARTICLE_HOVER_PLANE_FADE_IN_MS = 120;
const ARTICLE_HOVER_PLANE_OPACITY = 0.18;

class VisualizationController {
    constructor({
        canvas = null,
        getRenderDimensions = null,
        d3Graph = null,
        onModeChange = null,
        onFrame = null,
        onShowNewSearchContainer = null,
        onShowShareContainer = null,
        onHideNewSearchContainer = null,
        onHideShareContainer = null,
        onSetForegroundInteractive = null,
        onActivateThreeCanvas = null,
        onHidePageBackground = null,
        getActiveArticleUrl = null,
        articleStatusConfigPath = "./status_states.json",
        articleStatusD3Selector = "#d3-canvas",
        articleStatusD3ContainerSelector = "#d3-canvas-container",
        cameraControllerOptions = {},
        aaMode = "none",
        aaSampleLevel = 6,
        lutParams = null,
        requireActiveCanvas = true,
        three = THREE,
        cameraControllerClass = CameraController,
        articleStatusClass = ArticleStatus,
        articleStatusD3Class = ArticleStatusD3,
        inputService = InputService
    } = {}) {
        this.three = three;
        this.canvas = canvas;
        this._getRenderDimensions = getRenderDimensions;
        this.d3Graph = d3Graph;
        this.onModeChange = onModeChange;
        this.onFrame = onFrame;
        this.onShowNewSearchContainer = onShowNewSearchContainer;
        this.onShowShareContainer = onShowShareContainer;
        this.onHideNewSearchContainer = onHideNewSearchContainer;
        this.onHideShareContainer = onHideShareContainer;
        this.onSetForegroundInteractive = onSetForegroundInteractive;
        this.onActivateThreeCanvas = onActivateThreeCanvas;
        this.onHidePageBackground = onHidePageBackground;
        this._getActiveArticleUrl = getActiveArticleUrl;
        this.articleStatusConfigPath = articleStatusConfigPath;
        this.articleStatusD3Selector = articleStatusD3Selector;
        this.articleStatusD3ContainerSelector = articleStatusD3ContainerSelector;
        this.cameraControllerOptions = cameraControllerOptions;
        this.requireActiveCanvas = requireActiveCanvas;
        this.cameraControllerClass = cameraControllerClass;
        this.articleStatusClass = articleStatusClass;
        this.articleStatusD3Class = articleStatusD3Class;
        this.inputService = inputService;

        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.composer = null;
        this.renderPass = null;
        this.taaPass = null;
        this.ssaaPass = null;
        this.lutPass = null;
        this.outputPass = null;
        this.cameraController = null;
        this.articleStatusView = null;
        this.articleStatusD3 = null;
        this.articleView = null;
        this.spotLight = null;
        this.spotLightParams = null;
        this.ambientLights = [];
        this.articleLightingIntro = null;
        this.articleHoverOverlay = null;
        this.lastAmbientDependentLabelsVisible = null;
        this.animationFrameId = null;
        this.prevFrameTime = null;
        this.now = null;
        this.deltaTime = 0;
        this.visualizationMode = "three";
        this.aaParams = {
            mode: aaMode,
            sampleLevel: aaSampleLevel
        };
        this.lutParams = {
            enabled: true,
            skipComposer: false,
            intensity: 0.8,
            texture: null,
            ...lutParams
        };
        this.initialized = false;

        this.init = this.init.bind(this);
        this.start = this.start.bind(this);
        this.stop = this.stop.bind(this);
        this.render = this.render.bind(this);
        this.resize = this.resize.bind(this);
        this.onWindowResize = this.onWindowResize.bind(this);
        this.setVisualizationMode = this.setVisualizationMode.bind(this);
        this.setCustomRenderSorting = this.setCustomRenderSorting.bind(this);
        this.setAAMode = this.setAAMode.bind(this);
        this.applyLutTexture = this.applyLutTexture.bind(this);
        this.setLutEnabled = this.setLutEnabled.bind(this);
        this.setLutIntensity = this.setLutIntensity.bind(this);
        this.setSkipComposer = this.setSkipComposer.bind(this);
        this.ensureArticleStatusViews = this.ensureArticleStatusViews.bind(this);
        this.hideArticleStatusProgress = this.hideArticleStatusProgress.bind(this);
        this.updateArticleStatusProgress = this.updateArticleStatusProgress.bind(this);
        this.setArticleStatusSpotlightEnabled = this.setArticleStatusSpotlightEnabled.bind(this);
        this.applyCameraZoomPreset = this.applyCameraZoomPreset.bind(this);
        this.applyArticleStatusCameraZoom = this.applyArticleStatusCameraZoom.bind(this);
        this.applyResolvedArticleCameraView = this.applyResolvedArticleCameraView.bind(this);
        this.setArticleView = this.setArticleView.bind(this);
        this.clearCurrentArticleView = this.clearCurrentArticleView.bind(this);
        this.updateAmbientDependentLabelVisibility = this.updateAmbientDependentLabelVisibility.bind(this);
        this.updateArticleStatusCameraFollow = this.updateArticleStatusCameraFollow.bind(this);
        this.updateArticleHoverOverlay = this.updateArticleHoverOverlay.bind(this);
        this.startArticleLightingIntro = this.startArticleLightingIntro.bind(this);
        this.updateArticleLightingIntro = this.updateArticleLightingIntro.bind(this);
        this.buildComposer = this.buildComposer.bind(this);
        this.setLutParams = this.setLutParams.bind(this);
    }

    async init() {
        if (this.initialized) {
            return this;
        }

        this.three.Cache.enabled = true;
        this.scene = new this.three.Scene();
        this.camera = new this.three.PerspectiveCamera(
            90,
            this.getRenderDimensions().width / this.getRenderDimensions().height,
            0.1,
            200
        );
        this.camera.position.set(0, 0, 30);
        this.camera.layers.enable(MAIN_RENDER_LAYER);
        this.camera.layers.enable(SDF_TEXT_RENDER_LAYER);

        this.renderer = new this.three.WebGLRenderer({
            canvas: this.canvas,
            logarithmicDepthBuffer: true,
            antialias: true,
            alpha: true
        });
        this.renderer.shadowMap.enabled = false;
        this.renderer.setSize(this.getRenderDimensions().width, this.getRenderDimensions().height, false);
        this.renderer.sortObjects = false;
        this.renderer.setClearColor(0x000000, 0);

        this.inputService.init(this.canvas, this.scene, this.camera);

        this.spotLightParams = {
            color: new this.three.Color("white"),
            intensity: 300,
            flareIntensityMultiplier: ARTICLE_LIGHTING_SPOTLIGHT_FLARE_INTENSITY_MULTIPLIER,
            distance: 0,
            angle: 0.44,
            penumbra: 0.152,
            decay: 1.5,
            followSpeed: 2
        };

        this.spotLight = new this.three.SpotLight(
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

        const ambientLight = new this.three.AmbientLight(0xffffff, 0.5);
        ambientLight.layers.enable(MAIN_RENDER_LAYER);
        ambientLight.layers.enable(SDF_TEXT_RENDER_LAYER);
        this.scene.add(ambientLight);
        this.ambientLights = [ambientLight];

        this.articleHoverOverlay = new this.three.Mesh(
            new this.three.PlaneGeometry(1, 1),
            new this.three.MeshBasicMaterial({
                color: 0xffffff,
                transparent: true,
                opacity: 0,
                depthWrite: false,
                toneMapped: false,
                side: this.three.DoubleSide
            })
        );
        this.articleHoverOverlay.visible = false;
        this.articleHoverOverlay.renderOrder = 999;
        this.articleHoverOverlay.layers.enable(MAIN_RENDER_LAYER);
        this.scene.add(this.articleHoverOverlay);

        this.cameraController = new this.cameraControllerClass(this.canvas, this.camera, {
            zoomMode: "fov",
            initialFov: CAMERA_STATUS_ZOOM.fov,
            minFov: 24,
            maxFov: CAMERA_MAX_FOV,
            forwardZLimit: 8,
            backwardZLimit: 50,
            ...this.cameraControllerOptions
        });

        this.buildComposer();
        this.updateViewportResize();
        this.initialized = true;
        return this;
    }

    start() {
        if (this.animationFrameId != null) {
            return;
        }

        this.prevFrameTime = Date.now();
        this.render();
    }

    stop() {
        if (this.animationFrameId == null) {
            return;
        }

        window.cancelAnimationFrame(this.animationFrameId);
        this.animationFrameId = null;
    }

    buildComposer() {
        if (this.renderer == null || this.scene == null || this.camera == null) {
            return;
        }

        this.composer = new EffectComposer(this.renderer);
        this.composer.setSize(this.getRenderDimensions().width, this.getRenderDimensions().height);

        if (this.aaParams.mode === "taa") {
            this.taaPass = new TAARenderPass(this.scene, this.camera);
            this.taaPass.sampleLevel = this.aaParams.sampleLevel;
            this.taaPass.clearColor = new this.three.Color(0x000000);
            this.taaPass.clearAlpha = 0;
            this.composer.addPass(this.taaPass);
        } else if (this.aaParams.mode === "ssaa") {
            this.ssaaPass = new SSAARenderPass(this.scene, this.camera);
            this.ssaaPass.sampleLevel = this.aaParams.sampleLevel;
            this.ssaaPass.clearColor = new this.three.Color(0x000000);
            this.ssaaPass.clearAlpha = 0;
            this.composer.addPass(this.ssaaPass);
        } else {
            this.renderPass = new RenderPass(this.scene, this.camera);
            this.composer.addPass(this.renderPass);
        }

        if (!this.lutParams.skipComposer) {
            this.lutPass = new LUTPass();
            this.composer.addPass(this.lutPass);
        } else {
            this.lutPass = null;
        }

        this.outputPass = new OutputPass();
        this.composer.addPass(this.outputPass);
        this.setLutTexture(this.lutParams.texture);
    }

    setLutParams(params = {}) {
        this.lutParams = {
            ...this.lutParams,
            ...params
        };

        if (this.lutPass != null) {
            this.lutPass.enabled = this.lutParams.enabled;
            this.lutPass.intensity = this.lutParams.intensity;
        }
    }

    setLutEnabled(enabled = true) {
        this.setLutParams({ enabled });
    }

    setLutIntensity(intensity = 0.8) {
        this.setLutParams({ intensity });
    }

    setSkipComposer(skipComposer = false) {
        this.setLutParams({ skipComposer });
        this.buildComposer();
    }

    setAAMode(mode) {
        this.aaParams.mode = mode;
        this.buildComposer();
    }

    applyLutTexture(texture3D = null) {
        this.setLutTexture(texture3D);
    }

    setLutTexture(texture3D = null) {
        this.lutParams.texture = texture3D;

        if (this.lutPass != null && texture3D != null) {
            this.lutPass.lut = texture3D;
        }
    }

    ensureArticleStatusViews() {
        if (this.scene == null) {
            return Promise.resolve();
        }

        const ensureThreeStatusView = async () => {
            if (this.articleStatusView != null) {
                return;
            }

            this.articleStatusView = new this.articleStatusClass({
                statusConfigPath: this.articleStatusConfigPath
            });
            await this.articleStatusView.init();
            this.scene.add(this.articleStatusView.getRootGroup());
            this.articleStatusView.hide();
        };

        const ensureD3StatusView = async () => {
            if (this.articleStatusD3 != null) {
                return;
            }

            this.articleStatusD3 = new this.articleStatusD3Class({
                svgSelector: this.articleStatusD3Selector,
                containerSelector: this.articleStatusD3ContainerSelector,
                statusConfigPath: this.articleStatusConfigPath
            });
            await this.articleStatusD3.init();
            this.articleStatusD3.hide();
        };

        return Promise.all([ensureThreeStatusView(), ensureD3StatusView()]);
    }

    hideArticleStatusProgress() {
        this.articleStatusView?.hide();
        this.articleStatusD3?.hide();
        this.setArticleStatusSpotlightEnabled(true);
        this.cameraController?.enable(true);
        this.onSetForegroundInteractive?.(true);
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

    async updateArticleStatusProgress(articleObject) {
        const activeUrl = this.getActiveArticleUrl();
        const status = String(articleObject?.article?.status ?? "").trim().toLowerCase();
        const hasArticle = articleObject?.article != null;
        const hasResolvedArticle =
            articleObject?.article?.ownership_tree_id != null &&
            articleObject?.ownershipTreeObj != null &&
            articleObject?.ownership_tree != null;

        if (activeUrl == null || !hasArticle) {
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
            status === "timeout" ||
            status === "failed"
        ) {
            this.hideArticleStatusProgress();
            return false;
        }

        const [showThree, showD3] = await Promise.all([
            this.articleStatusView?.showForStatus(status) ?? false,
            this.articleStatusD3?.showForStatus(status) ?? false
        ]);

        if (!showThree && !showD3) {
            this.hideArticleStatusProgress();
            return false;
        }

        this.setArticleStatusSpotlightEnabled(false);
        this.cameraController?.enable(false);
        this.articleStatusD3?.resize();
        this.onSetForegroundInteractive?.(true);
        return true;
    }

    setArticleView(articleView = null) {
        this.articleView = articleView;
        this.updateAmbientDependentLabelVisibility();
    }

    clearCurrentArticleView() {
        if (this.articleView == null) {
            return;
        }

        this.scene?.remove?.(this.articleView.getRootGroup?.());
        this.articleView = null;
        this.lastAmbientDependentLabelsVisible = null;
    }

    applyCameraZoomPreset(preset) {
        this.cameraController?.setZoomImmediate?.(preset);
    }

    applyArticleStatusCameraZoom() {
        this.applyCameraZoomPreset(CAMERA_STATUS_ZOOM);
    }

    applyResolvedArticleCameraView() {
        if (this.cameraController?.resetViewImmediate != null) {
            this.cameraController.resetViewImmediate({
                zoom: CAMERA_ARTICLE_VIEW_ZOOM
            });
            return;
        }

        this.applyCameraZoomPreset(CAMERA_ARTICLE_VIEW_ZOOM);
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

        const focusPoint = this.articleStatusView.getCurrentStatusWorldPosition?.(new this.three.Vector3());
        if (focusPoint == null) {
            this.cameraController.clearIdleHome?.();
            return;
        }

        const currentPanBase = this.cameraController.getPanBase?.(new this.three.Vector3()) ?? this.camera.position.clone();
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
                ? this.inputService.getHoveredIntersection()
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

        if (hoveredCollider instanceof this.three.Box3) {
            if (hoveredCollider.isEmpty()) {
                this.articleHoverOverlay.visible = false;
                this.articleHoverOverlay.material.opacity = 0;
                return;
            }

            center = hoveredCollider.getCenter(new this.three.Vector3());
            size = hoveredCollider.getSize(new this.three.Vector3());
            quaternion = new this.three.Quaternion();
        } else {
            center = hoveredCollider.center.clone();
            size = hoveredCollider.halfSize.clone().multiplyScalar(2);
            const rotationMatrix = new this.three.Matrix4().setFromMatrix3(
                new this.three.Matrix3().copy(hoveredCollider.rotation)
            );
            quaternion = new this.three.Quaternion().setFromRotationMatrix(rotationMatrix);
        }

        const overlayNormal = new this.three.Vector3(0, 0, 1).applyQuaternion(quaternion).normalize();
        center.addScaledVector(overlayNormal, 0.02);

        this.articleHoverOverlay.visible = true;
        this.articleHoverOverlay.position.copy(center);
        this.articleHoverOverlay.quaternion.copy(quaternion);

        size.x += 0.169;
        size.y += 0.169;

        this.articleHoverOverlay.scale.set(size.x, size.y, 1);

        const fadeStep = (deltaTimeSeconds * 1000) / ARTICLE_HOVER_PLANE_FADE_IN_MS;
        this.articleHoverOverlay.material.opacity = this.three.MathUtils.clamp(
            this.articleHoverOverlay.material.opacity + (ARTICLE_HOVER_PLANE_OPACITY * fadeStep),
            0,
            ARTICLE_HOVER_PLANE_OPACITY
        );
    }

    startArticleLightingIntro() {
        if (this.spotLight == null || this.canvas == null) {
            return;
        }

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
            spotlightPeakPenumbra: this.three.MathUtils.clamp(
                this.spotLight.penumbra + ARTICLE_LIGHTING_SPOTLIGHT_PENUMBRA_FLARE_OFFSET,
                0,
                1
            )
        };

        this.canvas.style.filter = "brightness(0)";
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
        const blackoutProgress = this.three.MathUtils.clamp(
            this.articleLightingIntro.elapsedMs / this.articleLightingIntro.blackoutDurationMs,
            0,
            1
        );

        if (blackoutProgress < 1) {
            return;
        }

        this.canvas.style.filter = "brightness(1)";
        const ambientToLowProgress = this.three.MathUtils.clamp(
            (this.articleLightingIntro.elapsedMs - this.articleLightingIntro.blackoutDurationMs) /
                this.articleLightingIntro.ambientToLowDurationMs,
            0,
            1
        );
        const easedAmbientToLowProgress =
            1 - Math.sqrt(1 - (ambientToLowProgress * ambientToLowProgress));

        this.ambientLights.forEach((light, index) => {
            light.intensity = this.three.MathUtils.lerp(
                0,
                this.articleLightingIntro.lowAmbientIntensities[index] ?? light.intensity,
                easedAmbientToLowProgress
            );
        });

        const spotlightDelayElapsedMs =
            this.articleLightingIntro.elapsedMs - this.articleLightingIntro.blackoutDurationMs;

        if (
            spotlightDelayElapsedMs >= this.articleLightingIntro.spotlightDelayMs &&
            this.articleLightingIntro.spotlightFlareElapsedMs == null
        ) {
            this.articleLightingIntro.spotlightFlareElapsedMs = 0;
            this.spotLight.intensity = this.articleLightingIntro.spotlightPeakIntensity;
            this.spotLight.angle = this.articleLightingIntro.spotlightPeakAngle;
            this.spotLight.penumbra = this.articleLightingIntro.spotlightPeakPenumbra;
            this.onShowNewSearchContainer?.();
            this.onShowShareContainer?.();
        }

        if (this.articleLightingIntro.spotlightFlareElapsedMs != null) {
            this.articleLightingIntro.spotlightFlareElapsedMs += deltaTimeSeconds * 1000;

            const flareProgress = this.three.MathUtils.clamp(
                this.articleLightingIntro.spotlightFlareElapsedMs /
                    this.articleLightingIntro.spotlightFlareDurationMs,
                0,
                1
            );
            const easedFlareProgress = 1 - Math.pow(1 - flareProgress, 3);

            this.spotLight.intensity = this.three.MathUtils.lerp(
                this.articleLightingIntro.spotlightPeakIntensity,
                this.articleLightingIntro.targetSpotLightIntensity,
                easedFlareProgress
            );
            this.spotLight.angle = this.three.MathUtils.lerp(
                this.articleLightingIntro.spotlightPeakAngle,
                this.articleLightingIntro.targetSpotLightAngle,
                easedFlareProgress
            );
            this.spotLight.penumbra = this.three.MathUtils.lerp(
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

            const ambientToFullProgress = this.three.MathUtils.clamp(
                this.articleLightingIntro.ambientToFullElapsedMs /
                    this.articleLightingIntro.ambientToFullDurationMs,
                0,
                1
            );
            const easedAmbientToFullProgress = 1 - Math.pow(1 - ambientToFullProgress, 3);

            this.ambientLights.forEach((light, index) => {
                light.intensity = this.three.MathUtils.lerp(
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
        if (this.requireActiveCanvas && this.canvas != null && !this.canvas.classList.contains("is-active")) {
            this.animationFrameId = window.requestAnimationFrame(this.render);
            return;
        }

        this.now = Date.now();
        this.deltaTime = (this.now - this.prevFrameTime) / 1000;

        this.onFrame?.({ phase: "begin", deltaTime: this.deltaTime, controller: this });

        if (this.lutPass != null) {
            this.lutPass.enabled = this.lutParams.enabled;
            this.lutPass.intensity = this.lutParams.intensity;
        }

        this.updateArticleLightingIntro(this.deltaTime);
        this.updateAmbientDependentLabelVisibility();
        this.updateArticleStatusCameraFollow();
        this.updateArticleHoverOverlay(this.deltaTime);

        if (this.visualizationMode === "d3") {
            this.d3Graph?.tick?.();
        }

        if (this.visualizationMode === "three") {
            const spotlightFollowAlpha = this.three.MathUtils.clamp(
                this.deltaTime * this.spotLightParams.followSpeed,
                0,
                1
            );
            const spotLightPosition = this.spotLight.position.clone();
            const spotLightTargetPos = this.spotLight.target.position.clone();

            spotLightPosition.x = this.three.MathUtils.lerp(
                spotLightPosition.x,
                this.camera.position.x,
                spotlightFollowAlpha
            );
            spotLightPosition.y = this.three.MathUtils.lerp(
                spotLightPosition.y,
                this.camera.position.y,
                spotlightFollowAlpha
            );
            spotLightTargetPos.x = this.three.MathUtils.lerp(
                spotLightTargetPos.x,
                this.camera.position.x,
                spotlightFollowAlpha
            );
            spotLightTargetPos.y = this.three.MathUtils.lerp(
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

            if (this.lutParams.skipComposer || this.composer == null) {
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

        this.onFrame?.({ phase: "end", deltaTime: this.deltaTime, controller: this });

        this.animationFrameId = window.requestAnimationFrame(this.render);
        this.prevFrameTime = this.now;
    }

    resize() {
        this.updateViewportResize();
        const { width, height } = this.getRenderDimensions();

        this.renderer?.setSize(width, height, false);
        this.composer?.setSize(width, height, false);

        if (this.camera != null) {
            this.camera.aspect = width / height;
            this.camera.updateProjectionMatrix();
        }

        this.articleStatusD3?.resize();

        if (this.visualizationMode === "d3") {
            this.d3Graph?.resize?.();
        }
    }

    onWindowResize() {
        this.resize();
    }

    updateViewportResize() {
        if (this.getRenderDimensions == null || this.camera == null || this.renderer == null) {
            return;
        }
    }

    setVisualizationMode(mode) {
        this.visualizationMode = mode === "d3" ? "d3" : "three";
        this.onModeChange?.(this.visualizationMode);

        if (this.visualizationMode === "d3") {
            this.d3Graph?.resize?.();
        } else if (this.renderer && this.camera && this.composer) {
            this.resize();
            this.renderer.clear(true, true, true);
            this.camera.layers.set(MAIN_RENDER_LAYER);
            this.cameraController.update();

            if (this.lutParams.skipComposer) {
                this.renderer.render(this.scene, this.camera);
            } else {
                this.composer.render();
            }
        }
    }

    setCustomRenderSorting(enabled = false) {
        if (this.renderer != null) {
            this.renderer.sortObjects = !enabled;
        }
    }

    getRenderDimensions() {
        if (typeof this._getRenderDimensions === "function") {
            return this._getRenderDimensions();
        }

        const canvasRect = this.canvas?.getBoundingClientRect?.();

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

    getActiveArticleUrl() {
        if (typeof this._getActiveArticleUrl === "function") {
            return this._getActiveArticleUrl();
        }

        return this.articleView?.model?.url ?? this.articleView?.url ?? null;
    }
}

export { VisualizationController };
