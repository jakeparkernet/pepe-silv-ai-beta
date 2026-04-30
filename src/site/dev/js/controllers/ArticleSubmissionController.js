const DEFAULT_FOREGROUND_FADE_OUT_MS = 400;
const DEFAULT_SUBMIT_STATUS_FADE_MS = 200;
const DEFAULT_SUBMIT_STATUS_INPUT_CLEAR_DELAY_MS = 5000;
const DEFAULT_SUBMIT_STATUS_POLL_DELAY_MS = 400;

function noop() {}

function callMaybe(fn, ...args) {
    if (typeof fn !== "function") {
        return undefined;
    }

    return fn(...args);
}

/**
 * ArticleSubmissionController owns the submit/poll state machine:
 * - submit click, URL input, and paste handling
 * - queue polling and terminal-state resolution
 * - submit status messaging and reset timers
 * - foreground fade orchestration
 * - resolved-article handoff to the rest of the app
 *
 * Side effects are injected so this slice stays independent from the app
 * composition root and from rendering or detail-panel responsibilities.
 */
export class ArticleSubmissionController {
    constructor({
        dom = {},
        api = {},
        chrome = {},
        visualization = {},
        callbacks = {},
        timers = {},
        windowRef = window,
        documentRef = document,
        logger = console,
        constants = {}
    } = {}) {
        this.windowRef = windowRef;
        this.documentRef = documentRef;
        this.logger = logger;

        this.dom = {
            foreground: dom.foreground ?? null,
            urlInput: dom.urlInput ?? null,
            submitButton: dom.submitButton ?? null,
            submitButtonContainer: dom.submitButtonContainer ?? null,
            submitStatusMessage: dom.submitStatusMessage ?? null,
            submitStatusTimer: dom.submitStatusTimer ?? null,
            supportedSites: dom.supportedSites ?? null
        };

        this.api = {
            normalizeUserUrl: api.normalizeUserUrl ?? null,
            isSupportedSiteUrl: api.isSupportedSiteUrl ?? null,
            getArticleByUrl: api.getArticleByUrl ?? null,
            getArticleQueueRowByUrl: api.getArticleQueueRowByUrl ?? null,
            fetchOwnershipTreeById: api.fetchOwnershipTreeById ?? null,
            parseJsonRecursively: api.parseJsonRecursively ?? ((value) => value)
        };

        this.chrome = {
            showForeground: chrome.showForeground ?? null,
            hideForeground: chrome.hideForeground ?? null,
            setForegroundInteractive: chrome.setForegroundInteractive ?? null,
            hidePageBackground: chrome.hidePageBackground ?? null,
            activateThreeCanvas: chrome.activateThreeCanvas ?? null,
            hideSubmitStatusMessage: chrome.hideSubmitStatusMessage ?? null,
            showSubmitStatusMessage: chrome.showSubmitStatusMessage ?? null,
            hideSubmitStatusTimer: chrome.hideSubmitStatusTimer ?? null,
            startSubmitStatusTimer: chrome.startSubmitStatusTimer ?? null,
            showSupportedSites: chrome.showSupportedSites ?? null,
            hideSupportedSites: chrome.hideSupportedSites ?? null,
            updateSubmitButtonVisibility: chrome.updateSubmitButtonVisibility ?? null,
            updateAddressBarUrlParam: chrome.updateAddressBarUrlParam ?? null,
            applyArticleStatusCameraZoom: chrome.applyArticleStatusCameraZoom ?? null,
            applyResolvedArticleCameraView: chrome.applyResolvedArticleCameraView ?? null,
            ensureArticleStatusViews: chrome.ensureArticleStatusViews ?? null,
            hideArticleStatusProgress: chrome.hideArticleStatusProgress ?? null,
            updateArticleStatusProgress: chrome.updateArticleStatusProgress ?? null
        };

        this.visualization = {
            startArticleLightingIntro: visualization.startArticleLightingIntro ?? null,
            stopPageBackgroundFocusLoop: visualization.stopPageBackgroundFocusLoop ?? null,
            clearCurrentArticleView: visualization.clearCurrentArticleView ?? null,
            applyResolvedArticleCameraView: visualization.applyResolvedArticleCameraView ?? null,
            applyArticleStatusCameraZoom: visualization.applyArticleStatusCameraZoom ?? null,
            ensureArticleStatusViews: visualization.ensureArticleStatusViews ?? null,
            hideArticleStatusProgress: visualization.hideArticleStatusProgress ?? null,
            updateArticleStatusProgress: visualization.updateArticleStatusProgress ?? null,
            setArticleStatusSpotlightEnabled: visualization.setArticleStatusSpotlightEnabled ?? null
        };

        this.callbacks = {
            onResolvedArticle: callbacks.onResolvedArticle ?? null,
            onPendingArticleState: callbacks.onPendingArticleState ?? null,
            onBeforeResolvedArticle: callbacks.onBeforeResolvedArticle ?? null,
            onAfterResolvedArticle: callbacks.onAfterResolvedArticle ?? null
        };

        this.timers = {
            setTimeout: timers.setTimeout ?? windowRef.setTimeout?.bind(windowRef) ?? setTimeout,
            clearTimeout: timers.clearTimeout ?? windowRef.clearTimeout?.bind(windowRef) ?? clearTimeout,
            requestAnimationFrame:
                timers.requestAnimationFrame ?? windowRef.requestAnimationFrame?.bind(windowRef) ?? null
        };

        this.foregroundFadeOutMs = constants.foregroundFadeOutMs ?? DEFAULT_FOREGROUND_FADE_OUT_MS;
        this.submitStatusFadeMs = constants.submitStatusFadeMs ?? DEFAULT_SUBMIT_STATUS_FADE_MS;
        this.submitStatusInputClearDelayMs =
            constants.submitStatusInputClearDelayMs ?? DEFAULT_SUBMIT_STATUS_INPUT_CLEAR_DELAY_MS;
        this.submitStatusPollDelayMs = constants.submitStatusPollDelayMs ?? DEFAULT_SUBMIT_STATUS_POLL_DELAY_MS;

        this.isManualUrlSubmitMode = false;
        this.pendingSubmitStatusResetToken = 0;
        this.articleStatusPollToken = 0;
        this.hasSubmittedValidArticleUrl = false;
    }

    normalizeUserUrl(raw) {
        return this.api.normalizeUserUrl?.(raw) ?? null;
    }

    isSupportedSiteUrl(rawUrl) {
        return this.api.isSupportedSiteUrl?.(rawUrl) ?? false;
    }

    wait(ms) {
        return new Promise((resolve) => {
            this.timers.setTimeout(resolve, ms);
        });
    }

    getActiveArticleUrl() {
        const inputUrl = this.normalizeUserUrl(this.dom.urlInput?.value ?? "");
        if (inputUrl != null) {
            return inputUrl;
        }

        const params = new URLSearchParams(this.windowRef.location?.search ?? "");
        return this.normalizeUserUrl(params.get("url") ?? "");
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

        this.logger?.log?.("[article-status-check]", {
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

    hideSubmitStatusTimer() {
        if (typeof this.chrome.hideSubmitStatusTimer === "function") {
            this.chrome.hideSubmitStatusTimer();
            return;
        }

        if (this.dom.submitStatusTimer == null) {
            return;
        }

        this.dom.submitStatusTimer.style.opacity = "0";
        this.dom.submitStatusTimer.style.transition = "none";
        this.dom.submitStatusTimer.style.removeProperty("--submit-status-timer-scale");
        this.dom.submitStatusTimer.style.removeProperty("--submit-status-timer-duration");
        this.dom.submitStatusTimer.offsetWidth;
    }

    startSubmitStatusTimer(durationMs) {
        if (typeof this.chrome.startSubmitStatusTimer === "function") {
            this.chrome.startSubmitStatusTimer(durationMs);
            return;
        }

        if (this.dom.submitStatusTimer == null) {
            return;
        }

        this.dom.submitStatusTimer.style.transition = "opacity 120ms ease";
        this.dom.submitStatusTimer.style.opacity = "1";
        this.dom.submitStatusTimer.style.setProperty("--submit-status-timer-duration", `${durationMs}ms`);
        this.dom.submitStatusTimer.style.setProperty("--submit-status-timer-scale", "1");

        this.timers.requestAnimationFrame?.(() => {
            this.timers.requestAnimationFrame?.(() => {
                this.dom.submitStatusTimer.style.setProperty("--submit-status-timer-scale", "0");
            });
        });
    }

    hideSupportedSites() {
        if (typeof this.chrome.hideSupportedSites === "function") {
            this.chrome.hideSupportedSites();
            return;
        }

        if (this.dom.supportedSites == null) {
            return;
        }

        this.dom.supportedSites.classList.add("is-hidden");
        this.dom.supportedSites.style.opacity = "0";
    }

    showSupportedSites() {
        if (typeof this.chrome.showSupportedSites === "function") {
            this.chrome.showSupportedSites();
            return;
        }

        if (this.dom.supportedSites == null) {
            return;
        }

        this.dom.supportedSites.classList.remove("is-hidden");
        this.dom.supportedSites.style.opacity = "1";
    }

    hideSubmitStatusMessage() {
        if (typeof this.chrome.hideSubmitStatusMessage === "function") {
            this.chrome.hideSubmitStatusMessage();
            return;
        }

        if (this.dom.submitStatusMessage == null) {
            return;
        }

        this.dom.submitStatusMessage.textContent = "";
        this.dom.submitStatusMessage.style.opacity = "0";
        this.hideSubmitStatusTimer();
    }

    showSubmitStatusMessage(message) {
        if (typeof this.chrome.showSubmitStatusMessage === "function") {
            this.chrome.showSubmitStatusMessage(message);
            return;
        }

        if (this.dom.submitStatusMessage == null) {
            return;
        }

        this.dom.submitStatusMessage.textContent = message;
        this.dom.submitStatusMessage.style.opacity = "0";
        this.hideSupportedSites();
        this.timers.requestAnimationFrame?.(() => {
            this.dom.submitStatusMessage.style.opacity = "1";
        });
    }

    setForegroundInteractive(isInteractive = true) {
        if (typeof this.chrome.setForegroundInteractive === "function") {
            this.chrome.setForegroundInteractive(isInteractive);
            return;
        }

        if (this.dom.foreground == null) {
            return;
        }

        this.dom.foreground.style.pointerEvents = isInteractive ? "auto" : "none";
    }

    hideForeground() {
        if (typeof this.chrome.hideForeground === "function") {
            this.chrome.hideForeground();
            return;
        }

        if (this.dom.foreground == null) {
            return;
        }

        this.setForegroundInteractive(false);
        this.dom.foreground.classList.remove("is-hiding");
        this.dom.foreground.style.opacity = "1";
        this.dom.foreground.style.display = "none";
    }

    showForeground() {
        if (typeof this.chrome.showForeground === "function") {
            this.chrome.showForeground();
            return;
        }

        if (this.dom.foreground == null) {
            return;
        }

        this.setForegroundInteractive(true);
        this.dom.foreground.classList.remove("is-hiding");
        this.dom.foreground.style.display = "initial";
        this.dom.foreground.style.opacity = "1";
    }

    hideArticleStatusProgress() {
        if (typeof this.chrome.hideArticleStatusProgress === "function") {
            this.chrome.hideArticleStatusProgress();
            return;
        }

        if (typeof this.visualization.hideArticleStatusProgress === "function") {
            this.visualization.hideArticleStatusProgress();
        }
    }

    async ensureArticleStatusViews() {
        if (typeof this.chrome.ensureArticleStatusViews === "function") {
            return this.chrome.ensureArticleStatusViews();
        }

        if (typeof this.visualization.ensureArticleStatusViews === "function") {
            return this.visualization.ensureArticleStatusViews();
        }

        return undefined;
    }

    async updateArticleStatusProgress(articleObject) {
        if (typeof this.chrome.updateArticleStatusProgress === "function") {
            return this.chrome.updateArticleStatusProgress(articleObject);
        }

        if (typeof this.visualization.updateArticleStatusProgress === "function") {
            return this.visualization.updateArticleStatusProgress(articleObject);
        }

        this.hideArticleStatusProgress();
        return false;
    }

    applyArticleStatusCameraZoom() {
        if (typeof this.chrome.applyArticleStatusCameraZoom === "function") {
            this.chrome.applyArticleStatusCameraZoom();
            return;
        }

        callMaybe(this.visualization.applyArticleStatusCameraZoom);
    }

    applyResolvedArticleCameraView() {
        if (typeof this.chrome.applyResolvedArticleCameraView === "function") {
            this.chrome.applyResolvedArticleCameraView();
            return;
        }

        callMaybe(this.visualization.applyResolvedArticleCameraView);
    }

    startArticleLightingIntro() {
        callMaybe(this.visualization.startArticleLightingIntro);
    }

    clearCurrentArticleView() {
        callMaybe(this.visualization.clearCurrentArticleView);
    }

    setArticleStatusSpotlightEnabled(enabled = true) {
        if (typeof this.visualization.setArticleStatusSpotlightEnabled === "function") {
            this.visualization.setArticleStatusSpotlightEnabled(enabled);
            return;
        }

        callMaybe(this.visualization.setArticleStatusSpotlightEnabled, enabled);
    }

    startForegroundFadeOut() {
        const normalizedUrl = this.normalizeUserUrl(this.dom.urlInput?.value ?? "");
        if (normalizedUrl == null) {
            return;
        }

        callMaybe(this.chrome.hidePageBackground);
        callMaybe(this.chrome.activateThreeCanvas);
        this.hideSubmitStatusMessage();

        if (this.dom.foreground == null) {
            return;
        }

        this.dom.foreground.style.display = "initial";

        if (this.dom.foreground.classList.contains("is-hiding")) {
            return;
        }

        this.dom.foreground.classList.remove("is-hiding");
        void this.dom.foreground.offsetWidth;
        this.dom.foreground.classList.add("is-hiding");
    }

    async fadeOutForeground({ afterFadeOut = null } = {}) {
        this.startForegroundFadeOut();
        await this.wait(this.foregroundFadeOutMs);
        await afterFadeOut?.();
        this.hideForeground();
    }

    onSubmitButtonPointerDown() {
        if (this.normalizeUserUrl(this.dom.urlInput?.value ?? "") == null) {
            return;
        }

        this.startForegroundFadeOut();
    }

    onUrlInputChanged(event) {
        const isPasteEvent = event?.inputType === "insertFromPaste";
        this.logger?.log?.("[submit-flow] onUrlInputChanged", {
            inputType: event?.inputType ?? null,
            isPasteEvent,
            value: this.dom.urlInput?.value ?? "",
            normalizedUrl: this.normalizeUserUrl(this.dom.urlInput?.value ?? ""),
            isManualUrlSubmitMode: this.isManualUrlSubmitMode,
            hasSubmittedValidArticleUrl: this.hasSubmittedValidArticleUrl
        });

        if (!isPasteEvent) {
            this.stopArticleStatusPolling();
            this.hideArticleStatusProgress();
            this.hasSubmittedValidArticleUrl = false;
        }

        if ((this.dom.urlInput?.value ?? "").trim().length === 0) {
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

        const shouldAutoSubmit =
            !this.isManualUrlSubmitMode &&
            (this.dom.urlInput?.value ?? "").trim().length === 0;

        this.logger?.log?.("[submit-flow] onUrlInputPasted", {
            valueBeforePaste: this.dom.urlInput?.value ?? "",
            isManualUrlSubmitMode: this.isManualUrlSubmitMode,
            shouldAutoSubmit
        });

        this.timers.setTimeout(async () => {
            const normalizedUrl = this.normalizeUserUrl(this.dom.urlInput?.value ?? "");

            this.logger?.log?.("[submit-flow] onUrlInputPasted timeout", {
                valueAfterPaste: this.dom.urlInput?.value ?? "",
                normalizedUrl,
                shouldAutoSubmit,
                isManualUrlSubmitMode: this.isManualUrlSubmitMode
            });

            if ((this.dom.urlInput?.value ?? "").trim().length === 0) {
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
        if (typeof this.chrome.updateSubmitButtonVisibility === "function") {
            this.chrome.updateSubmitButtonVisibility();
            return;
        }

        if (this.dom.submitButton == null || this.dom.urlInput == null) {
            return;
        }

        const hasValue = this.dom.urlInput.value.trim().length > 0;
        const isValidUrl = this.normalizeUserUrl(this.dom.urlInput.value) != null;

        if (hasValue && !isValidUrl) {
            this.isManualUrlSubmitMode = true;
        }

        const shouldShowButton = hasValue && (this.isManualUrlSubmitMode || !isValidUrl);

        this.dom.submitButton.style.visibility = shouldShowButton ? "visible" : "hidden";
        this.dom.submitButtonContainer?.classList.toggle("is-visible", shouldShowButton);
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
        const delayMs = this.submitStatusFadeMs + this.submitStatusInputClearDelayMs;
        this.startSubmitStatusTimer(delayMs);
        await this.wait(delayMs);

        if (token !== this.pendingSubmitStatusResetToken) {
            return false;
        }

        if (clearInput && this.dom.urlInput != null) {
            this.dom.urlInput.value = "";
        }

        this.resetUrlInputMode();
        return true;
    }

    async onSubmitClicked(event) {
        event?.preventDefault?.();
        this.stopArticleStatusPolling();
        this.hideArticleStatusProgress();
        this.hasSubmittedValidArticleUrl = false;

        const normalizedUrl = this.normalizeUserUrl(this.dom.urlInput?.value ?? "");
        this.logger?.log?.("[submit-flow] onSubmitClicked", {
            eventType: event?.type ?? null,
            rawInput: this.dom.urlInput?.value ?? "",
            normalizedUrl,
            isManualUrlSubmitMode: this.isManualUrlSubmitMode
        });

        if (normalizedUrl == null) {
            this.showForeground();
            this.showSubmitStatusMessage("Not a valid url");
            this.updateSubmitButtonVisibility();
            return;
        }

        if (!this.isSupportedSiteUrl(normalizedUrl)) {
            this.showForeground();
            this.showSubmitStatusMessage("Unsupported site");
            this.updateSubmitButtonVisibility();
            return;
        }

        this.hasSubmittedValidArticleUrl = true;
        callMaybe(this.chrome.updateAddressBarUrlParam, normalizedUrl);
        this.startForegroundFadeOut();

        const articleObject = await this.api.getArticleByUrl?.(normalizedUrl);
        this.logger?.log?.("[submit-flow] getArticleByUrl resolved", {
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
                articleObject?.ownershipTreeObj?.summary ??
                articleObject?.article?.applicability_result?.reason ??
                "Not applicable.";

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

        await this.renderResolvedArticle(articleObject, {
            source: "initial-submit",
            targetUrl: normalizedUrl
        });
    }

    async handlePendingArticleState(targetUrl, articleObject) {
        this.logger?.log?.("[submit-flow] handlePendingArticleState", {
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

    async pollArticleStatus(targetUrl) {
        const token = ++this.articleStatusPollToken;
        const pollDelayMs = this.submitStatusPollDelayMs;

        while (token === this.articleStatusPollToken) {
            await this.wait(pollDelayMs);

            if (token !== this.articleStatusPollToken) {
                return;
            }

            const queueResult = await this.api.getArticleQueueRowByUrl?.(targetUrl);
            if (queueResult?.error || queueResult?.data == null) {
                continue;
            }

            const articleObject = {
                article: this.api.parseJsonRecursively(queueResult.data),
                ownershipTreeObj: null,
                ownership_tree: null,
                investigation_prepass_results: this.api.parseJsonRecursively(
                    queueResult.data.investigation_prepass_results ?? null
                )
            };

            this.logArticleStatusCheck("poll", articleObject, {
                poll_token: token,
                target_url: targetUrl
            });

            this.showSubmitStatusMessage(this.getQueueStatusMessage(articleObject));
            await this.updateArticleStatusProgress(articleObject);

            const articleStatus = String(articleObject?.article?.status ?? "").toLowerCase();
            if (articleStatus === "timeout") {
                this.stopArticleStatusPolling();
                this.hideArticleStatusProgress();
                await this.scheduleSubmitStatusReset({ clearInput: true });
                return;
            }

            if (articleObject.article?.ownership_tree_id) {
                const ownershipTreeObj = await this.api.fetchOwnershipTreeById?.(
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
                    await this.renderResolvedArticle(articleObject, {
                        source: "poll-resolved",
                        targetUrl
                    });
                    return;
                }
            }

            if (
                articleStatus === "deferred" ||
                articleStatus === "not applicable" ||
                articleStatus === "not-applicable"
            ) {
                this.stopArticleStatusPolling();
                this.hideArticleStatusProgress();
                await this.scheduleSubmitStatusReset({ clearInput: true });
                return;
            }
        }
    }

    async renderResolvedArticle(articleObject, { source = "resolved", targetUrl = null } = {}) {
        this.stopArticleStatusPolling();
        this.hideArticleStatusProgress();
        this.hideSubmitStatusMessage();
        this.hideSubmitStatusTimer();
        callMaybe(this.visualization.clearCurrentArticleView);
        callMaybe(this.visualization.stopPageBackgroundFocusLoop);

        this.logger?.log?.("[submit-flow] renderResolvedArticle handoff", {
            source,
            targetUrl,
            status: articleObject?.article?.status ?? null,
            ownership_tree_id: articleObject?.article?.ownership_tree_id ?? null
        });

        await callMaybe(this.callbacks.onBeforeResolvedArticle, articleObject, {
            source,
            targetUrl
        });

        await this.callbacks.onResolvedArticle?.(articleObject, {
            source,
            targetUrl
        });

        await callMaybe(this.callbacks.onAfterResolvedArticle, articleObject, {
            source,
            targetUrl
        });
    }
}
