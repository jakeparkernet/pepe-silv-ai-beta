const DEFAULT_BACKGROUND_IMAGES = [
    "./resources/pepe-bg-1.webp",
    "./resources/pepe-bg-2.webp",
    "./resources/pepe-bg-3.webp"
];

const DEFAULT_BACKGROUND_CONFIG = {
    enabled: true,
    perspectivePx: 500,
    rotateYMin: -18,
    rotateYMax: 18,
    scaleMin: 0.69,
    scaleMax: 1.24,
    positionXMin: 42,
    positionXMax: 58,
    positionYMin: 42,
    positionYMax: 58,
    vignetteMin: 0.3,
    vignetteMax: 0.7,
    focusIntervalMinMs: 3000,
    focusIntervalMaxMs: 5000,
    focusTransitionMinMs: 1600,
    focusTransitionMaxMs: 2600,
    focusEasing: "cubic-bezier(0.28, 0.02, 0.18, 1)",
    rackFocusDelayMs: 1000,
    sharpLayerBlurMin: 0.2,
    sharpLayerBlurMax: 1.2,
    blurLayerMin: 3,
    blurLayerMax: 11,
    blurOpacityMin: 0.05,
    blurOpacityMax: 0.3,
    focusSplitMin: 2,
    focusSplitMax: 20,
    focusSoftnessMin: 2,
    focusSoftnessMax: 6,
    sharpLayerBlurIdleMaxFactor: 0.65,
    blurLayerIdleMaxFactor: 0.8,
    blurOpacityIdleMaxFactor: 0.82,
    hideTransitionMs: 600
};

function noop() {}

function defaultRandomBetween(min, max) {
    return min + Math.random() * (max - min);
}

/**
 * PageBackgroundController owns the decorative page background slice:
 * - background initialization
 * - image loading
 * - focus-loop animation
 * - hide/show state
 * - three-canvas activation
 */
export class PageBackgroundController {
    constructor({
        dom = {},
        timers = {},
        callbacks = {},
        windowRef = window,
        documentRef = document,
        images = DEFAULT_BACKGROUND_IMAGES,
        config = {},
        randomBetween = defaultRandomBetween
    } = {}) {
        this.windowRef = windowRef;
        this.documentRef = documentRef;
        this.images = images;
        this.config = {
            ...DEFAULT_BACKGROUND_CONFIG,
            ...config
        };
        this.randomBetween = randomBetween;
        this.callbacks = {
            onInitialized: callbacks.onInitialized ?? noop,
            onImageApplied: callbacks.onImageApplied ?? noop,
            onFocusStateApplied: callbacks.onFocusStateApplied ?? noop,
            onBackgroundShown: callbacks.onBackgroundShown ?? noop,
            onBackgroundHidden: callbacks.onBackgroundHidden ?? noop,
            onCanvasActivated: callbacks.onCanvasActivated ?? noop
        };
        this.timers = {
            setTimeout: timers.setTimeout ?? windowRef.setTimeout?.bind(windowRef),
            clearTimeout: timers.clearTimeout ?? windowRef.clearTimeout?.bind(windowRef),
            requestIdleCallback: timers.requestIdleCallback ?? windowRef.requestIdleCallback?.bind(windowRef),
            cancelIdleCallback: timers.cancelIdleCallback ?? windowRef.cancelIdleCallback?.bind(windowRef)
        };

        this.dom = {
            pageBackground: dom.pageBackground ?? null,
            pageBackgroundPlane: dom.pageBackgroundPlane ?? null,
            pageBackgroundSharpLayer: dom.pageBackgroundSharpLayer ?? null,
            pageBackgroundBlurLayer: dom.pageBackgroundBlurLayer ?? null,
            threeCanvas: dom.threeCanvas ?? null
        };

        this.pageBackgroundImageLoadTimeout = null;
        this.pageBackgroundImageLoadToken = 0;
        this.backgroundFocusLoopTimeout = null;
        this.backgroundRackFocusTimeout = null;
        this.pageBackgroundIdleCallbackId = null;
        this._initialized = false;
    }

    initialize() {
        this.initializePageBackground();
    }

    initializePageBackground() {
        if (this._initialized) {
            return;
        }

        if (
            !this.config.enabled ||
            this.dom.pageBackground == null ||
            this.dom.pageBackgroundPlane == null ||
            this.dom.pageBackgroundSharpLayer == null ||
            this.dom.pageBackgroundBlurLayer == null
        ) {
            return;
        }

        this.showPageBackground();

        const randomImage = this.images[Math.floor(Math.random() * this.images.length)];
        const rotateY = this.randomBetween(this.config.rotateYMin, this.config.rotateYMax);
        const backgroundScale = this.randomBetween(this.config.scaleMin, this.config.scaleMax);
        const backgroundPositionX = this.randomBetween(this.config.positionXMin, this.config.positionXMax);
        const backgroundPositionY = this.randomBetween(this.config.positionYMin, this.config.positionYMax);
        const vignette = this.randomBetween(this.config.vignetteMin, this.config.vignetteMax);
        const focusBiasClass = rotateY >= 0 ? "focus-bias-left" : "focus-bias-right";
        const backgroundPosition = `${backgroundPositionX.toFixed(2)}% ${backgroundPositionY.toFixed(2)}%`;
        const focusSplit = this.randomBetween(this.config.focusSplitMin, this.config.focusSplitMax);
        const focusSoftness = this.randomBetween(this.config.focusSoftnessMin, this.config.focusSoftnessMax);

        this.dom.pageBackgroundSharpLayer.style.backgroundPosition = backgroundPosition;
        this.dom.pageBackgroundBlurLayer.style.backgroundPosition = backgroundPosition;
        this.dom.pageBackgroundPlane.style.setProperty(
            "--page-background-plane-transform",
            `perspective(${this.config.perspectivePx}px) rotateY(${rotateY.toFixed(2)}deg) scale(${backgroundScale.toFixed(3)})`
        );
        this.dom.pageBackground.style.setProperty("--page-background-vignette-opacity", vignette.toFixed(3));
        this.dom.pageBackground.style.setProperty("--page-background-focus-easing", this.config.focusEasing);
        this.dom.pageBackground.style.setProperty("--page-background-focus-split", `${focusSplit.toFixed(2)}%`);
        this.dom.pageBackground.style.setProperty("--page-background-focus-softness", `${focusSoftness.toFixed(2)}%`);
        this.dom.pageBackground.classList.remove("focus-bias-left", "focus-bias-right");
        this.dom.pageBackground.classList.add(focusBiasClass);

        this.applyPageBackgroundFocusState({
            sharpLayerBlur: this.config.sharpLayerBlurMax,
            blurAmount: this.config.blurLayerMax,
            blurOpacity: this.config.blurOpacityMax,
            transitionMs: 0
        });

        this.loadPageBackgroundImage(randomImage);
        this.startPageBackgroundFocusLoop();
        this._initialized = true;
        this.callbacks.onInitialized?.();
    }

    showPageBackground() {
        if (this.dom.pageBackground == null) {
            return;
        }

        this.dom.pageBackground.classList.remove("is-hidden");
        this.callbacks.onBackgroundShown?.();
    }

    hidePageBackground() {
        if (!this.config.enabled || this.dom.pageBackground == null) {
            return;
        }

        this.dom.pageBackground.classList.add("is-hidden");
        this.callbacks.onBackgroundHidden?.();
    }

    loadPageBackgroundImage(imageUrl) {
        if (this.dom.pageBackgroundSharpLayer == null || this.dom.pageBackgroundBlurLayer == null) {
            return;
        }

        const token = ++this.pageBackgroundImageLoadToken;
        this.timers.clearTimeout?.(this.pageBackgroundImageLoadTimeout);
        this.timers.cancelIdleCallback?.(this.pageBackgroundIdleCallbackId);
        this.pageBackgroundImageLoadTimeout = null;
        this.pageBackgroundIdleCallbackId = null;

        const applyImage = () => {
            if (token !== this.pageBackgroundImageLoadToken) {
                return;
            }

            this.dom.pageBackgroundSharpLayer.style.backgroundImage = `url("${imageUrl}")`;
            this.dom.pageBackgroundBlurLayer.style.backgroundImage = `url("${imageUrl}")`;
            this.callbacks.onImageApplied?.(imageUrl);
        };

        const image = new Image();
        image.decoding = "async";
        image.fetchPriority = "high";
        image.onload = applyImage;
        image.onerror = applyImage;
        image.src = imageUrl;

        if (image.complete) {
            applyImage();
        }
    }

    applyPageBackgroundFocusState({
        sharpLayerBlur = this.config.sharpLayerBlurMin,
        blurAmount = this.config.blurLayerMin,
        blurOpacity = this.config.blurOpacityMin,
        transitionMs = this.config.focusTransitionMinMs
    } = {}) {
        if (this.dom.pageBackground == null) {
            return;
        }

        this.dom.pageBackground.style.setProperty("--page-background-focus-transition-ms", `${Math.round(transitionMs)}ms`);
        this.dom.pageBackground.style.setProperty("--page-background-sharp-layer-blur", `${sharpLayerBlur.toFixed(2)}px`);
        this.dom.pageBackground.style.setProperty("--page-background-blur-amount", `${blurAmount.toFixed(2)}px`);
        this.dom.pageBackground.style.setProperty("--page-background-blur-opacity", blurOpacity.toFixed(3));
        this.callbacks.onFocusStateApplied?.({
            sharpLayerBlur,
            blurAmount,
            blurOpacity,
            transitionMs
        });
    }

    scheduleNextPageBackgroundFocus() {
        if (!this.config.enabled || this.dom.pageBackground == null) {
            return;
        }

        const nextDelay = this.randomBetween(this.config.focusIntervalMinMs, this.config.focusIntervalMaxMs);

        this.timers.clearTimeout?.(this.backgroundFocusLoopTimeout);
        this.backgroundFocusLoopTimeout = this.timers.setTimeout?.(() => {
            this.applyPageBackgroundFocusState({
                sharpLayerBlur: this.randomBetween(this.config.sharpLayerBlurMin, this.config.sharpLayerBlurMax),
                blurAmount: this.randomBetween(this.config.blurLayerMin, this.config.blurLayerMax),
                blurOpacity: this.randomBetween(this.config.blurOpacityMin, this.config.blurOpacityMax),
                transitionMs: this.randomBetween(this.config.focusTransitionMinMs, this.config.focusTransitionMaxMs)
            });
            this.scheduleNextPageBackgroundFocus();
        }, nextDelay) ?? null;
    }

    startPageBackgroundFocusLoop() {
        if (!this.config.enabled || this.dom.pageBackground == null) {
            return;
        }

        this.timers.clearTimeout?.(this.backgroundRackFocusTimeout);
        this.timers.clearTimeout?.(this.backgroundFocusLoopTimeout);

        this.backgroundRackFocusTimeout = this.timers.setTimeout?.(() => {
            this.applyPageBackgroundFocusState({
                sharpLayerBlur: this.randomBetween(this.config.sharpLayerBlurMin, this.config.sharpLayerBlurMax * 0.65),
                blurAmount: this.randomBetween(this.config.blurLayerMin, this.config.blurLayerMax * 0.8),
                blurOpacity: this.randomBetween(this.config.blurOpacityMin, this.config.blurOpacityMax * 0.82),
                transitionMs: this.randomBetween(this.config.focusTransitionMinMs, this.config.focusTransitionMaxMs)
            });
            this.scheduleNextPageBackgroundFocus();
        }, this.config.rackFocusDelayMs) ?? null;
    }

    stopPageBackgroundFocusLoop() {
        if (!this.config.enabled || this.dom.pageBackground == null) {
            return;
        }

        this.timers.clearTimeout?.(this.backgroundRackFocusTimeout);
        this.timers.clearTimeout?.(this.backgroundFocusLoopTimeout);
        this.timers.clearTimeout?.(this.pageBackgroundImageLoadTimeout);
        this.timers.cancelIdleCallback?.(this.pageBackgroundIdleCallbackId);

        this.backgroundRackFocusTimeout = null;
        this.backgroundFocusLoopTimeout = null;
        this.pageBackgroundImageLoadTimeout = null;
        this.pageBackgroundIdleCallbackId = null;

        this.applyPageBackgroundFocusState({
            sharpLayerBlur: 0,
            blurAmount: 0,
            blurOpacity: 0,
            transitionMs: this.config.hideTransitionMs
        });
    }

    activateThreeCanvas() {
        if (!this.config.enabled || this.dom.threeCanvas == null) {
            return;
        }

        this.dom.threeCanvas.classList.add("is-active");
        this.callbacks.onCanvasActivated?.();
    }

    dispose() {
        this.stopPageBackgroundFocusLoop();
    }
}

export default PageBackgroundController;
