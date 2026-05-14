const DEFAULT_FOREGROUND_FADE_OUT_MS = 400;
const DEFAULT_SUBMIT_STATUS_FADE_MS = 200;
const DEFAULT_SUBMIT_STATUS_INPUT_CLEAR_DELAY_MS = 5000;
const DEFAULT_SUBMIT_STATUS_POLL_DELAY_MS = 400;
const NOT_APPLICABLE_STATUS_MESSAGE = "Article not about a specific company or product";
const FAILED_STATUS_MESSAGE = "Article research failed, come back later";
const COMPANY_PAIR_RESEARCH_MESSAGE = "This common-influence search has not been researched yet. Sign in and buy credits to request it.";
const FOREGROUND_SEARCH_VISIBLE_CLASS = "foreground-search-visible";

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
            urlInputContainer: dom.urlInputContainer ?? null,
            companyPairInputContainer: dom.companyPairInputContainer ?? null,
            companyANameInput: dom.companyANameInput ?? null,
            companyAContextInput: dom.companyAContextInput ?? null,
            companyBNameInput: dom.companyBNameInput ?? null,
            companyBContextInput: dom.companyBContextInput ?? null,
            companyPairActions: dom.companyPairActions ?? null,
            companyPairSubmitButton: dom.companyPairSubmitButton ?? null,
            companyPairResearchActions: dom.companyPairResearchActions ?? null,
            companyPairResearchButton: dom.companyPairResearchButton ?? null,
            companyPairBuyCreditsButton: dom.companyPairBuyCreditsButton ?? null,
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
            parseJsonRecursively: api.parseJsonRecursively ?? ((value) => value),
            lookupCompanyPair: api.lookupCompanyPair ?? null,
            startCompanyPairResearch: api.startCompanyPairResearch ?? null,
            createCheckoutSession: api.createCheckoutSession ?? null,
            getCurrentUser: api.getCurrentUser ?? null
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
        this.isCompanyPairMode = false;
        this.pendingCompanyPairPayload = null;
        this.isSubmitInteractionLocked = false;
        this.pendingSubmitStatusResetToken = 0;
        this.articleStatusPollToken = 0;
        this.hasSubmittedValidArticleUrl = false;
        this.windowRef.__pepeSubmitLocked = false;

        this.dom.companyPairSubmitButton?.addEventListener("click", (event) => {
            void this.onCompanyPairSubmitClicked(event);
        });
        this.dom.companyPairResearchButton?.addEventListener("click", (event) => {
            void this.onCompanyPairResearchClicked(event);
        });
        this.dom.companyPairBuyCreditsButton?.addEventListener("click", (event) => {
            void this.onBuyCreditsClicked(event);
        });
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

    parseCompanyPairSplit(rawValue) {
        const value = String(rawValue ?? "");
        const match = value.match(/^(\S+)\s+(.*)$/);
        if (!match) {
            return null;
        }

        return {
            companyAName: match[1].trim(),
            companyBName: match[2].trim()
        };
    }

    buildCompanyPairPayload() {
        const companyAName = this.dom.companyANameInput?.value?.trim() ?? "";
        const companyBName = this.dom.companyBNameInput?.value?.trim() ?? "";
        const companyAContext = this.dom.companyAContextInput?.value?.trim() ?? "";
        const companyBContext = this.dom.companyBContextInput?.value?.trim() ?? "";

        return {
            company_a: {
                name: companyAName,
                context: companyAContext
            },
            company_b: {
                name: companyBName,
                context: companyBContext
            }
        };
    }

    enterCompanyPairMode({ companyAName = "", companyBName = "" } = {}) {
        if (this.isCompanyPairMode) {
            return;
        }

        this.isCompanyPairMode = true;
        this.pendingCompanyPairPayload = null;
        this.stopArticleStatusPolling();
        this.hideArticleStatusProgress();
        this.hideSubmitStatusMessage();
        this.hideSupportedSites();
        this.setSubmitInteractionLocked(false);
        this.dom.urlInputContainer?.classList.add("company-pair-mode");

        if (this.dom.companyPairInputContainer != null) {
            this.dom.companyPairInputContainer.hidden = false;
        }
        if (this.dom.companyPairActions != null) {
            this.dom.companyPairActions.hidden = false;
        }
        if (this.dom.companyPairResearchActions != null) {
            this.dom.companyPairResearchActions.hidden = true;
        }

        if (this.dom.companyANameInput != null && companyAName) {
            this.dom.companyANameInput.value = companyAName;
        }
        if (this.dom.companyBNameInput != null && companyBName) {
            this.dom.companyBNameInput.value = companyBName;
        }
        if (this.dom.urlInput != null) {
            this.dom.urlInput.value = "";
        }

        this.updateSubmitButtonVisibility();
        this.timers.requestAnimationFrame?.(() => {
            if ((this.dom.companyBNameInput?.value ?? "").trim().length === 0) {
                this.dom.companyBNameInput?.focus?.();
                return;
            }
            this.dom.companyBContextInput?.focus?.();
        });
    }

    exitCompanyPairMode() {
        this.isCompanyPairMode = false;
        this.pendingCompanyPairPayload = null;
        this.dom.urlInputContainer?.classList.remove("company-pair-mode");

        if (this.dom.companyPairInputContainer != null) {
            this.dom.companyPairInputContainer.hidden = true;
        }
        if (this.dom.companyPairActions != null) {
            this.dom.companyPairActions.hidden = true;
        }
        if (this.dom.companyPairResearchActions != null) {
            this.dom.companyPairResearchActions.hidden = true;
        }
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
            return FAILED_STATUS_MESSAGE;
        }

        if (status === "failed") {
            return FAILED_STATUS_MESSAGE;
        }

        if (status === "not applicable" || status === "not-applicable") {
            return NOT_APPLICABLE_STATUS_MESSAGE;
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

    setForegroundSearchVisible(isVisible = true) {
        this.documentRef.body?.classList.toggle(FOREGROUND_SEARCH_VISIBLE_CLASS, Boolean(isVisible));
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
        if (this.isCompanyPairMode) {
            return;
        }

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

        const split = this.parseCompanyPairSplit(this.dom.urlInput?.value ?? "");
        if (!isPasteEvent && split != null) {
            this.enterCompanyPairMode(split);
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
            !this.isCompanyPairMode &&
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

            const split = this.parseCompanyPairSplit(this.dom.urlInput?.value ?? "");
            if (split != null) {
                this.enterCompanyPairMode(split);
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

        if (this.isCompanyPairMode) {
            this.dom.submitButton.style.visibility = "hidden";
            this.dom.submitButtonContainer?.classList.remove("is-visible");
            return;
        }

        const hasValue = this.dom.urlInput.value.trim().length > 0;
        const isValidUrl = this.normalizeUserUrl(this.dom.urlInput.value) != null;

        if (hasValue && !isValidUrl) {
            this.isManualUrlSubmitMode = true;
        }

        const shouldShowButton =
            !this.isSubmitInteractionLocked &&
            hasValue &&
            (this.isManualUrlSubmitMode || !isValidUrl);

        this.dom.submitButton.style.visibility = shouldShowButton ? "visible" : "hidden";
        this.dom.submitButtonContainer?.classList.toggle("is-visible", shouldShowButton);
    }

    setSubmitInteractionLocked(isLocked = true) {
        this.isSubmitInteractionLocked = Boolean(isLocked);
        this.windowRef.__pepeSubmitLocked = this.isSubmitInteractionLocked;

        if (this.dom.urlInput != null) {
            this.dom.urlInput.readOnly = this.isSubmitInteractionLocked;
        }

        const pairInputs = [
            this.dom.companyANameInput,
            this.dom.companyAContextInput,
            this.dom.companyBNameInput,
            this.dom.companyBContextInput
        ];
        for (const input of pairInputs) {
            if (input != null) {
                input.readOnly = this.isSubmitInteractionLocked;
            }
        }

        if (this.dom.submitButtonContainer != null) {
            this.dom.submitButtonContainer.classList.toggle("is-locked", this.isSubmitInteractionLocked);
            this.dom.submitButtonContainer.setAttribute(
                "aria-disabled",
                this.isSubmitInteractionLocked ? "true" : "false"
            );
        }

        this.updateSubmitButtonVisibility();
        return this.isSubmitInteractionLocked;
    }

    resetUrlInputMode() {
        this.cancelPendingSubmitStatusReset();
        this.isManualUrlSubmitMode = false;
        this.exitCompanyPairMode();
        this.hasSubmittedValidArticleUrl = false;
        this.setForegroundSearchVisible(true);
        this.setSubmitInteractionLocked(false);
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
        if (this.isCompanyPairMode) {
            return await this.onCompanyPairSubmitClicked(event);
        }

        if (this.isSubmitInteractionLocked) {
            return false;
        }

        this.stopArticleStatusPolling();
        this.hideArticleStatusProgress();
        this.hasSubmittedValidArticleUrl = false;

        const split = this.parseCompanyPairSplit(this.dom.urlInput?.value ?? "");
        if (split != null) {
            this.enterCompanyPairMode(split);
            return false;
        }

        const normalizedUrl = this.normalizeUserUrl(this.dom.urlInput?.value ?? "");
        this.logger?.log?.("[submit-flow] onSubmitClicked", {
            eventType: event?.type ?? null,
            rawInput: this.dom.urlInput?.value ?? "",
            normalizedUrl,
            isManualUrlSubmitMode: this.isManualUrlSubmitMode
        });

        if (normalizedUrl == null) {
            this.setForegroundSearchVisible(true);
            this.showForeground();
            this.showSubmitStatusMessage("Not a valid url");
            this.setSubmitInteractionLocked(false);
            this.updateSubmitButtonVisibility();
            return;
        }

        if (!this.isSupportedSiteUrl(normalizedUrl)) {
            this.setForegroundSearchVisible(true);
            this.showForeground();
            this.showSubmitStatusMessage("Unsupported site");
            this.setSubmitInteractionLocked(false);
            this.updateSubmitButtonVisibility();
            return;
        }

        this.hasSubmittedValidArticleUrl = true;
        this.setSubmitInteractionLocked(true);
        callMaybe(this.chrome.updateAddressBarUrlParam, normalizedUrl);
        this.startForegroundFadeOut();

        let articleObject = null;
        try {
            articleObject = await this.api.getArticleByUrl?.(normalizedUrl);
        } catch (error) {
            this.logger?.error?.("[submit-flow] getArticleByUrl failed", error);
            this.setForegroundSearchVisible(true);
            this.showForeground();
            this.showSubmitStatusMessage("Could not load article status.");
            this.setSubmitInteractionLocked(false);
            this.updateSubmitButtonVisibility();
            return;
        }

        this.logger?.log?.("[submit-flow] getArticleByUrl resolved", {
            normalizedUrl,
            hasArticleObject: articleObject != null,
            status: articleObject?.article?.status ?? null,
            ownership_tree_id: articleObject?.article?.ownership_tree_id ?? null
        });

        if (articleObject == null) {
            this.setForegroundSearchVisible(true);
            this.showForeground();
            this.showSubmitStatusMessage("Could not load article status.");
            this.setSubmitInteractionLocked(false);
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
            this.setForegroundSearchVisible(true);
            this.showForeground();
            this.showSubmitStatusMessage(NOT_APPLICABLE_STATUS_MESSAGE);
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

    async onCompanyPairSubmitClicked(event) {
        event?.preventDefault?.();
        if (this.isSubmitInteractionLocked) {
            return false;
        }

        const payload = this.buildCompanyPairPayload();
        if (!payload.company_a.name || !payload.company_b.name) {
            this.setForegroundSearchVisible(true);
            this.showForeground();
            this.showSubmitStatusMessage("Enter two company names.");
            return false;
        }
        if (payload.company_a.name.toLowerCase() === payload.company_b.name.toLowerCase()) {
            this.setForegroundSearchVisible(true);
            this.showForeground();
            this.showSubmitStatusMessage("Enter two different companies.");
            return false;
        }

        this.pendingCompanyPairPayload = payload;
        this.setSubmitInteractionLocked(true);
        this.hideArticleStatusProgress();
        this.hideSubmitStatusMessage();
        if (this.dom.companyPairResearchActions != null) {
            this.dom.companyPairResearchActions.hidden = true;
        }

        let lookupResult = null;
        try {
            lookupResult = await this.api.lookupCompanyPair?.(payload);
        } catch (error) {
            this.logger?.error?.("[company-pair] lookup failed", error);
            this.showSubmitStatusMessage("Could not check this company pair.");
            this.setSubmitInteractionLocked(false);
            return false;
        }

        if (lookupResult?.error != null) {
            this.logger?.error?.("[company-pair] lookup error", lookupResult.error);
            const status = lookupResult.error?.context?.status ?? null;
            this.showSubmitStatusMessage(status === 401 ? "Sign in to run this search." : "Could not check this company pair.");
            this.setSubmitInteractionLocked(false);
            return false;
        }

        if (lookupResult?.articleObject != null) {
            await this.renderResolvedArticle(lookupResult.articleObject, {
                source: "company-pair-lookup",
                targetUrl: null
            });
            return true;
        }

        this.setForegroundSearchVisible(true);
        this.showForeground();
        if (lookupResult?.data?.company_a?.name && lookupResult?.data?.company_b?.name) {
            this.pendingCompanyPairPayload = {
                company_a: {
                    name: lookupResult.data.company_a.name,
                    context: lookupResult.data.company_a.context ?? payload.company_a.context
                },
                company_b: {
                    name: lookupResult.data.company_b.name,
                    context: lookupResult.data.company_b.context ?? payload.company_b.context
                }
            };
        }
        this.showSubmitStatusMessage(lookupResult?.data?.message ?? COMPANY_PAIR_RESEARCH_MESSAGE);
        if (this.dom.companyPairResearchActions != null) {
            this.dom.companyPairResearchActions.hidden = false;
        }
        this.setSubmitInteractionLocked(false);
        return false;
    }

    async onCompanyPairResearchClicked(event) {
        event?.preventDefault?.();
        const payload = this.pendingCompanyPairPayload ?? this.buildCompanyPairPayload();

        if (!payload.company_a.name || !payload.company_b.name) {
            this.showSubmitStatusMessage("Enter two company names.");
            return false;
        }
        if (payload.company_a.name.toLowerCase() === payload.company_b.name.toLowerCase()) {
            this.showSubmitStatusMessage("Enter two different companies.");
            return false;
        }

        this.setSubmitInteractionLocked(true);
        let result = null;
        try {
            result = await this.api.startCompanyPairResearch?.(payload);
        } catch (error) {
            this.logger?.error?.("[company-pair] research start failed", error);
            this.showSubmitStatusMessage("Could not request research.");
            this.setSubmitInteractionLocked(false);
            return false;
        }

        if (result?.error != null || result?.data?.ok === false) {
            const status = result?.error?.context?.status ?? result?.data?.status ?? null;
            const message = status === 401
                ? "Sign in before requesting research."
                : status === 402
                    ? "Not enough credits. Buy credits first."
                    : result?.data?.error ?? "Could not request research.";
            this.showSubmitStatusMessage(message);
            if (this.dom.companyPairResearchActions != null) {
                this.dom.companyPairResearchActions.hidden = false;
            }
            this.setSubmitInteractionLocked(false);
            return false;
        }

        this.showSubmitStatusMessage("Research requested. Check back soon for the ownership tree.");
        if (this.dom.companyPairResearchActions != null) {
            this.dom.companyPairResearchActions.hidden = false;
        }
        this.setSubmitInteractionLocked(false);
        return true;
    }

    async onBuyCreditsClicked(event) {
        event?.preventDefault?.();
        let result = null;
        try {
            result = await this.api.createCheckoutSession?.({ amountUsd: 10 });
        } catch (error) {
            this.logger?.error?.("[credits] checkout failed", error);
            this.showSubmitStatusMessage("Could not start checkout.");
            return false;
        }

        if (result?.error != null || !result?.data?.checkout_url) {
            const status = result?.error?.context?.status ?? null;
            this.showSubmitStatusMessage(status === 401 ? "Sign in before buying credits." : "Could not start checkout.");
            return false;
        }

        this.windowRef.location.assign(result.data.checkout_url);
        return true;
    }

    async handlePendingArticleState(targetUrl, articleObject) {
        this.logger?.log?.("[submit-flow] handlePendingArticleState", {
            targetUrl,
            status: articleObject?.article?.status ?? null,
            ownership_tree_id: articleObject?.article?.ownership_tree_id ?? null
        });

        const status = String(articleObject?.article?.status ?? "").toLowerCase();
        if (status === "timeout" || status === "failed") {
            this.setForegroundSearchVisible(true);
            this.showForeground();
            this.showSubmitStatusMessage(this.getQueueStatusMessage(articleObject));
            this.setSubmitInteractionLocked(false);
            this.updateSubmitButtonVisibility();
            await this.scheduleSubmitStatusReset({ clearInput: true });
            return;
        }

        this.showForeground();
        this.setForegroundSearchVisible(false);
        this.applyArticleStatusCameraZoom();

        const initialMessage = this.getQueueStatusMessage(articleObject);
        this.showSubmitStatusMessage(initialMessage);
        await this.updateArticleStatusProgress(articleObject);
        this.updateSubmitButtonVisibility();

        const isTerminalDeferred = status === "deferred";
        const isTerminalNotApplicable =
            status === "not-applicable" || status === "not applicable";

        if (isTerminalDeferred || isTerminalNotApplicable) {
            this.setForegroundSearchVisible(true);
            this.hideArticleStatusProgress();
            this.setSubmitInteractionLocked(false);
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
            if (articleStatus === "timeout" || articleStatus === "failed") {
                this.stopArticleStatusPolling();
                this.setForegroundSearchVisible(true);
                this.hideArticleStatusProgress();
                this.setSubmitInteractionLocked(false);
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
                this.setForegroundSearchVisible(true);
                this.hideArticleStatusProgress();
                this.setSubmitInteractionLocked(false);
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
