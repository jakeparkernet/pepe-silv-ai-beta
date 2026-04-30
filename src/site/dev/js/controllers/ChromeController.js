const DEFAULT_VISUAL_MODE_STORAGE_KEY = "visual-mode";
const MOBILE_VIEWPORT_QUERY = "(max-width: 768px)";
const SHARE_FEEDBACK_TIMEOUT_MS = 1400;
const FOREGROUND_VISIBLE_CLASS = "foreground-visible";

function noop() {}

function defaultRandomBetween(min, max) {
    return min + Math.random() * (max - min);
}

/**
 * ChromeController owns page-chrome behavior:
 * - viewport metrics
 * - mobile anchor positioning
 * - support/share/new-search controls
 * - relationship key rendering
 * - foreground visibility helpers
 * - visual-mode chrome toggles
 *
 * Dependencies are injected so the controller can stay isolated from the app
 * composition root and from unrelated scene or data concerns.
 */
export class ChromeController {
    constructor({
        dom = {},
        timers = {},
        callbacks = {},
        windowRef = window,
        documentRef = document,
        navigatorRef = window.navigator,
        localStorageRef = window.localStorage,
        historyRef = window.history,
        locationRef = window.location,
        randomBetween = defaultRandomBetween,
        visualModeStorageKey = DEFAULT_VISUAL_MODE_STORAGE_KEY,
        skipInitialVisualizationMode = false
    } = {}) {
        this.windowRef = windowRef;
        this.documentRef = documentRef;
        this.navigatorRef = navigatorRef;
        this.localStorageRef = localStorageRef;
        this.historyRef = historyRef;
        this.locationRef = locationRef;
        this.randomBetween = randomBetween;
        this.visualModeStorageKey = visualModeStorageKey;
        this.skipInitialVisualizationMode = skipInitialVisualizationMode;

        this.timers = {
            requestAnimationFrame: timers.requestAnimationFrame ?? windowRef.requestAnimationFrame?.bind(windowRef),
            cancelAnimationFrame: timers.cancelAnimationFrame ?? windowRef.cancelAnimationFrame?.bind(windowRef),
            setTimeout: timers.setTimeout ?? windowRef.setTimeout?.bind(windowRef),
            clearTimeout: timers.clearTimeout ?? windowRef.clearTimeout?.bind(windowRef)
        };

        this.callbacks = {
            onNewSearchRequested: callbacks.onNewSearchRequested ?? null,
            onShareRequested: callbacks.onShareRequested ?? null,
            onVisualizationModeChange: callbacks.onVisualizationModeChange ?? noop,
            onThreeModeActivated: callbacks.onThreeModeActivated ?? noop,
            onD3ModeActivated: callbacks.onD3ModeActivated ?? noop,
            onForegroundChange: callbacks.onForegroundChange ?? noop,
            onRelationshipKeyChange: callbacks.onRelationshipKeyChange ?? noop
        };

        this.dom = {
            foreground: dom.foreground ?? null,
            urlInputContainer: dom.urlInputContainer ?? null,
            newSearchButton: dom.newSearchButton ?? null,
            newSearchContainer: dom.newSearchContainer ?? null,
            shareButton: dom.shareButton ?? null,
            shareContainer: dom.shareContainer ?? null,
            shareFeedback: dom.shareFeedback ?? null,
            supportButtons: dom.supportButtons ?? null,
            supportCtaButton: dom.supportCtaButton ?? null,
            relationshipKey: dom.relationshipKey ?? null,
            articleActionToolbar: dom.articleActionToolbar ?? null,
            threeCanvas: dom.threeCanvas ?? null,
            d3CanvasContainer: dom.d3CanvasContainer ?? null,
            visualizationButtons: dom.visualizationButtons ?? { three: null, d3: null },
            submitButton: dom.submitButton ?? null,
            submitButtonContainer: dom.submitButtonContainer ?? null,
            articleUrlDisplay: dom.articleUrlDisplay ?? null,
            submitStatusMessage: dom.submitStatusMessage ?? null,
            submitStatusTimer: dom.submitStatusTimer ?? null,
            detailPanel: dom.detailPanel ?? null,
            pageTitle: dom.pageTitle ?? null,
            attribution: dom.attribution ?? null,
            lightModeTargets: Array.isArray(dom.lightModeTargets) ? dom.lightModeTargets : []
        };

        this.supportMenuOpen = false;
        this.shareFeedbackTimer = null;
        this.visualizationMode = "three";
        this._boundDocumentPointerDown = this.onDocumentPointerDown.bind(this);
        this._initialized = false;
    }

    initialize() {
        if (this._initialized) {
            return;
        }

        this.hideNewSearchContainer();
        this.hideShareContainer();
        this.hideSupportMenu();
        this.initializeNewSearch();
        this.initializeShareButton();
        this.initializeSupportCta();
        if (!this.skipInitialVisualizationMode) {
            this.applyInitialVisualizationMode();
        }
        this._initialized = true;
    }

    initializeNewSearch() {
        this.hideNewSearchContainer();

        this.dom.newSearchButton?.addEventListener("click", () => {
            if (typeof this.callbacks.onNewSearchRequested === "function") {
                this.callbacks.onNewSearchRequested();
                return;
            }

            const nextUrl = new URL(this.locationRef.href);
            nextUrl.search = "";
            this.locationRef.assign(nextUrl.toString());
        });
    }

    initializeShareButton() {
        this.hideShareContainer();
        this.hideShareFeedback();
        this.dom.shareButton?.addEventListener("click", this.onShareButtonClicked.bind(this));
    }

    initializeSupportCta() {
        this.hideSupportMenu();
        this.dom.supportCtaButton?.addEventListener("click", this.onSupportCtaClicked.bind(this));
        this.dom.supportButtons?.querySelectorAll("a").forEach((link) => {
            link.addEventListener("click", () => {
                this.hideSupportMenu();
            });
        });

        this.documentRef.addEventListener("pointerdown", this._boundDocumentPointerDown);
        this.timers.requestAnimationFrame?.(() => this.updateSupportButtonsScale());
    }

    dispose() {
        this.documentRef.removeEventListener("pointerdown", this._boundDocumentPointerDown);
        this.hideShareFeedback();
    }

    getInitialVisualizationMode() {
        if (this.dom.visualizationButtons?.d3?.classList.contains("is-active")) {
            return "d3";
        }

        return "three";
    }

    applyInitialVisualizationMode() {
        if (this.dom.threeCanvas) {
            this.dom.threeCanvas.style.opacity = "0";
            this.dom.threeCanvas.style.pointerEvents = "none";
        }

        if (this.dom.d3CanvasContainer) {
            this.dom.d3CanvasContainer.style.opacity = "0";
            this.dom.d3CanvasContainer.style.pointerEvents = "none";
            this.dom.d3CanvasContainer.setAttribute("aria-hidden", "true");
        }

        const storedMode = this.localStorageRef?.getItem?.(this.visualModeStorageKey);
        const initialMode = storedMode ?? this.getInitialVisualizationMode();

        this.timers.requestAnimationFrame?.(() => {
            this.setVisualizationMode(initialMode, { persist: false });
        }) ?? this.setVisualizationMode(initialMode, { persist: false });
    }

    setVisualizationMode(mode, { persist = true } = {}) {
        this.visualizationMode = mode === "d3" ? "d3" : "three";

        if (persist) {
            this.localStorageRef?.setItem?.(this.visualModeStorageKey, this.visualizationMode);
        }

        const showD3 = this.visualizationMode === "d3";

        if (this.dom.threeCanvas) {
            this.dom.threeCanvas.style.opacity = showD3 ? "0" : "1";
            this.dom.threeCanvas.style.pointerEvents = showD3 ? "none" : "all";
        }

        if (this.dom.d3CanvasContainer) {
            this.dom.d3CanvasContainer.style.opacity = showD3 ? "1" : "0";
            this.dom.d3CanvasContainer.style.pointerEvents = showD3 ? "auto" : "none";
            this.dom.d3CanvasContainer.setAttribute("aria-hidden", showD3 ? "false" : "true");
        }

        this.dom.visualizationButtons.three?.classList.toggle("is-active", !showD3);
        this.dom.visualizationButtons.d3?.classList.toggle("is-active", showD3);

        this._toggleLightModeChrome(showD3);
        this.updateRelationshipKeyVisibility();

        this.callbacks.onVisualizationModeChange?.(this.visualizationMode);
        if (showD3) {
            this.callbacks.onD3ModeActivated?.(this.visualizationMode);
        } else {
            this.callbacks.onThreeModeActivated?.(this.visualizationMode);
        }

        return this.visualizationMode;
    }

    _toggleLightModeChrome(showD3) {
        this.dom.detailPanel?.classList.toggle("light-mode", showD3);
        this.dom.articleUrlDisplay?.classList.toggle("light-mode", showD3);
        this.dom.submitStatusMessage?.classList.toggle("light-mode", showD3);
        this.dom.submitStatusTimer?.classList.toggle("light-mode", showD3);
        this.dom.newSearchButton?.classList.toggle("light-mode", showD3);
        this.dom.newSearchContainer?.classList.toggle("light-mode", showD3);
        this.dom.shareButton?.classList.toggle("light-mode", showD3);
        this.dom.shareContainer?.classList.toggle("light-mode", showD3);
        this.dom.shareFeedback?.classList.toggle("light-mode", showD3);
        this.dom.submitButton?.classList.toggle("light-mode", showD3);
        this.dom.submitButtonContainer?.classList.toggle("light-mode", showD3);
        this.dom.supportCtaButton?.classList.toggle("light-mode", showD3);
        this.dom.supportButtons?.classList.toggle("light-mode", showD3);
        this.dom.pageTitle?.classList.toggle("light-mode", showD3);
        this.dom.attribution?.classList.toggle("light-mode", showD3);

        for (const target of this.dom.lightModeTargets) {
            target?.classList?.toggle?.("light-mode", showD3);
        }
    }

    isMobileViewport() {
        return this.windowRef.matchMedia?.(MOBILE_VIEWPORT_QUERY).matches ?? false;
    }

    updateViewportMetrics() {
        const viewport = this.windowRef.visualViewport;
        const top = viewport?.offsetTop ?? 0;
        const left = viewport?.offsetLeft ?? 0;
        const viewportWidth = viewport?.width ?? this.windowRef.innerWidth;
        const viewportHeight = viewport?.height ?? this.windowRef.innerHeight;
        const viewportBottom = top + viewportHeight;
        const bottomOffset = Math.max(0, this.windowRef.innerHeight - viewportBottom);

        this.documentRef.documentElement.style.setProperty("--vv-top", `${Math.round(top)}px`);
        this.documentRef.documentElement.style.setProperty("--vv-left", `${Math.round(left)}px`);
        this.documentRef.documentElement.style.setProperty("--vv-width", `${Math.round(viewportWidth)}px`);
        this.documentRef.documentElement.style.setProperty("--vv-height", `${Math.round(viewportHeight)}px`);
        this.documentRef.documentElement.style.setProperty("--vv-offset-bottom", `${Math.round(bottomOffset)}px`);
        this.updateSupportButtonsScale();
        this.timers.requestAnimationFrame?.(() => this.updateMobileViewportAnchors());

        if (!this.isMobileViewport()) {
            this.hideSupportMenu();
        }
    }

    updateSupportButtonsScale() {
        if (this.dom.supportButtons == null) {
            return;
        }

        this.dom.supportButtons.style.setProperty("--support-buttons-scale", "1");

        const availableWidth = this.dom.supportButtons.clientWidth;
        const contentWidth = this.dom.supportButtons.scrollWidth;

        if (availableWidth <= 0 || contentWidth <= 0) {
            return;
        }

        const scale = Math.min(1, availableWidth / contentWidth);
        this.dom.supportButtons.style.setProperty("--support-buttons-scale", `${scale}`);
    }

    updateMobileViewportAnchors() {
        const rootStyle = this.documentRef.documentElement.style;

        if (!this.isMobileViewport() || this.dom.urlInputContainer == null) {
            rootStyle.removeProperty("--mobile-url-input-bottom");
            return;
        }

        const { bottom } = this.dom.urlInputContainer.getBoundingClientRect();
        rootStyle.setProperty("--mobile-url-input-bottom", `${Math.round(bottom)}px`);
    }

    updateArticleActionToolbarPosition() {
        if (this.dom.articleActionToolbar == null) {
            return;
        }

        if (this.isMobileViewport()) {
            this.dom.articleActionToolbar.style.removeProperty("top");
            return;
        }

        const computedStyles = this.windowRef.getComputedStyle(this.dom.articleActionToolbar);
        const fallbackTop = Number.parseFloat(computedStyles.getPropertyValue("--toolbar-fallback-top")) || 180;
        const legendGap = Number.parseFloat(computedStyles.getPropertyValue("--toolbar-legend-gap")) || 44;
        const legendGroup = this.documentRef.querySelector("#d3-canvas g.article-graph-legend > g");

        if (legendGroup == null || typeof legendGroup.getBBox !== "function") {
            this.dom.articleActionToolbar.style.top = `${fallbackTop}px`;
            return;
        }

        const legendBounds = legendGroup.getBBox();
        const nextTop = Math.max(fallbackTop, legendBounds.y + legendBounds.height + legendGap);
        this.dom.articleActionToolbar.style.top = `${Math.round(nextTop)}px`;
    }

    showNewSearchContainer() {
        this.dom.newSearchContainer?.classList.add("is-visible");
    }

    hideNewSearchContainer() {
        this.dom.newSearchContainer?.classList.remove("is-visible");
    }

    showShareContainer() {
        this.dom.shareContainer?.classList.add("is-visible");
    }

    hideShareContainer() {
        this.dom.shareContainer?.classList.remove("is-visible");
        this.hideShareFeedback();
    }

    showSupportMenu() {
        if (this.dom.supportButtons == null || this.dom.supportCtaButton == null) {
            return;
        }

        this.supportMenuOpen = true;
        this.dom.supportButtons.classList.add("is-open");
        this.dom.supportCtaButton.setAttribute("aria-expanded", "true");
    }

    hideSupportMenu() {
        this.dom.supportButtons?.classList.remove("is-open");
        this.dom.supportCtaButton?.setAttribute("aria-expanded", "false");
        this.supportMenuOpen = false;
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
            this.dom.supportButtons?.contains(target) ||
            this.dom.supportCtaButton?.contains(target)
        ) {
            return;
        }

        this.hideSupportMenu();
    }

    renderRelationshipKey(items = []) {
        if (this.dom.relationshipKey == null) {
            return;
        }

        if (Array.isArray(items) === false || items.length === 0) {
            this.clearRelationshipKey();
            return;
        }

        const card = this.documentRef.createElement("div");
        card.className = "relationship-key-card";

        const title = this.documentRef.createElement("div");
        title.className = "relationship-key-title";
        title.textContent = "RELATIONSHIP KEY";
        card.appendChild(title);

        const list = this.documentRef.createElement("div");
        list.className = "relationship-key-list";

        items.forEach((item) => {
            const row = this.documentRef.createElement("div");
            row.className = "relationship-key-row";

            const swatch = this.documentRef.createElement("span");
            swatch.className = "relationship-key-swatch";
            swatch.style.backgroundColor = item.color ?? "#7a6a4d";

            const label = this.documentRef.createElement("span");
            label.className = "relationship-key-label";
            label.textContent = item.label ?? "";

            row.appendChild(swatch);
            row.appendChild(label);
            list.appendChild(row);
        });

        card.appendChild(list);
        this.dom.relationshipKey.replaceChildren(card);
        this.updateRelationshipKeyVisibility();
        this.callbacks.onRelationshipKeyChange?.(items);
    }

    clearRelationshipKey() {
        if (this.dom.relationshipKey == null) {
            return;
        }

        this.dom.relationshipKey.innerHTML = "";
        this.dom.relationshipKey.classList.remove("is-visible");
        this.dom.relationshipKey.setAttribute("aria-hidden", "true");
        this.callbacks.onRelationshipKeyChange?.([]);
    }

    updateRelationshipKeyVisibility(forceVisible = null) {
        if (this.dom.relationshipKey == null) {
            return;
        }

        const hasItems = this.dom.relationshipKey.childElementCount > 0;
        const shouldShow = forceVisible ?? (this.visualizationMode === "d3" && hasItems);
        this.dom.relationshipKey.classList.toggle("is-visible", shouldShow);
        this.dom.relationshipKey.setAttribute("aria-hidden", shouldShow ? "false" : "true");
    }

    setForegroundInteractive(isInteractive = true) {
        if (this.dom.foreground == null) {
            return;
        }

        this.dom.foreground.style.pointerEvents = isInteractive ? "auto" : "none";
    }

    hideForeground() {
        if (this.dom.foreground == null) {
            return;
        }

        this.documentRef.body?.classList.remove(FOREGROUND_VISIBLE_CLASS);
        this.setForegroundInteractive(false);
        this.dom.foreground.classList.remove("is-hiding");
        this.dom.foreground.style.opacity = "1";
        this.dom.foreground.style.display = "none";
        this.callbacks.onForegroundChange?.(false);
    }

    showForeground() {
        if (this.dom.foreground == null) {
            return;
        }

        this.documentRef.body?.classList.add(FOREGROUND_VISIBLE_CLASS);
        this.setForegroundInteractive(true);
        this.dom.foreground.classList.remove("is-hiding");
        this.dom.foreground.style.display = "initial";
        this.dom.foreground.style.opacity = "1";
        this.hideNewSearchContainer();
        this.hideShareContainer();
        this.callbacks.onForegroundChange?.(true);
    }

    async onShareButtonClicked() {
        const shareUrl = this.locationRef.href;

        try {
            if (typeof this.navigatorRef.share === "function") {
                await this.navigatorRef.share({
                    title: this.documentRef.title,
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
            if (this.navigatorRef.clipboard?.writeText) {
                await this.navigatorRef.clipboard.writeText(shareUrl);
                return true;
            }
        } catch (_error) {
        }

        try {
            const tempInput = this.documentRef.createElement("textarea");
            tempInput.value = shareUrl;
            tempInput.setAttribute("readonly", "");
            tempInput.style.position = "fixed";
            tempInput.style.opacity = "0";
            tempInput.style.pointerEvents = "none";
            this.documentRef.body.appendChild(tempInput);
            tempInput.select();
            tempInput.setSelectionRange(0, tempInput.value.length);
            const copied = this.documentRef.execCommand("copy");
            this.documentRef.body.removeChild(tempInput);
            return copied;
        } catch (_error) {
            return false;
        }
    }

    showShareFeedback() {
        if (this.dom.shareFeedback == null) {
            return;
        }

        if (this.shareFeedbackTimer != null) {
            this.timers.clearTimeout?.(this.shareFeedbackTimer);
        }

        this.dom.shareFeedback.classList.add("is-visible");
        this.shareFeedbackTimer = this.timers.setTimeout?.(() => {
            this.hideShareFeedback();
        }, SHARE_FEEDBACK_TIMEOUT_MS) ?? null;
    }

    hideShareFeedback() {
        if (this.dom.shareFeedback == null) {
            return;
        }

        if (this.shareFeedbackTimer != null) {
            this.timers.clearTimeout?.(this.shareFeedbackTimer);
            this.shareFeedbackTimer = null;
        }

        this.dom.shareFeedback.classList.remove("is-visible");
    }
}

export default ChromeController;
