const DEFAULT_RECENT_LINK_LIMIT = 100;
const RECENT_LINK_AUTO_SCROLL_SPEED_PX_PER_SECOND = 6.9;
const RECENT_LINK_AUTO_SCROLL_RESUME_DELAY_MS = 6900;
const RECENT_LINK_AUTO_SCROLL_MAX_FRAME_MS = 64;
const RECENT_LINK_INTERACTION_EVENTS = [
    "pointerenter",
    "pointerdown",
    "wheel",
    "touchstart",
    "focusin"
];

function isTerminalCompleteStatus(status) {
    const normalizedStatus = String(status ?? "").trim().toLowerCase();
    return normalizedStatus === "complete" || normalizedStatus === "completed";
}

export class RecentLinksController {
    constructor({
        root = null,
        api = {},
        windowRef = window,
        documentRef = document,
        logger = console,
        limit = DEFAULT_RECENT_LINK_LIMIT
    } = {}) {
        this.root = root;
        this.api = {
            getRecentArticleQueueRows: api.getRecentArticleQueueRows ?? null,
            normalizeUserUrl: api.normalizeUserUrl ?? null
        };
        this.windowRef = windowRef;
        this.documentRef = documentRef;
        this.logger = logger;
        this.limit = limit;
        this.refreshToken = 0;
        this.hasLoaded = false;
        this.rows = [];
        this.autoScrollFrameId = null;
        this.autoScrollSetupFrameId = null;
        this.autoScrollResumeTimerId = null;
        this.autoScrollLoopHeight = 0;
        this.autoScrollOffsetPx = 0;
        this.autoScrollEnabled = false;
        this.autoScrollPaused = false;
        this.autoScrollLastFrameTime = null;
        this.interactionListenersBound = false;
        this.handleAutoScrollFrame = this.handleAutoScrollFrame.bind(this);
        this.handleRecentLinksInteraction = this.handleRecentLinksInteraction.bind(this);
        this.handleRecentLinksKeydown = this.handleRecentLinksKeydown.bind(this);
    }

    initialize() {
        this.bindInteractionListeners();
        this.hide();
    }

    setVisible(isVisible = true) {
        if (isVisible) {
            this.show();
            return;
        }

        this.hide();
    }

    show() {
        if (this.root == null || this.rows.length === 0) {
            return;
        }

        this.bindInteractionListeners();
        this.root.classList.add("is-visible");
        this.root.setAttribute("aria-hidden", "false");
        this.scheduleAutoScrollSetup();
    }

    hide() {
        if (this.root == null) {
            return;
        }

        this.refreshToken += 1;
        this.stopAutoScroll();
        this.root.classList.remove("is-visible");
        this.root.setAttribute("aria-hidden", "true");
    }

    async refresh({ force = false, visible = true } = {}) {
        if (this.root == null || typeof this.api.getRecentArticleQueueRows !== "function") {
            return;
        }

        if (this.hasLoaded && !force) {
            if (visible) {
                this.show();
            }
            return;
        }

        const token = ++this.refreshToken;

        try {
            const { data, error } = await this.api.getRecentArticleQueueRows({
                limit: this.limit
            });

            if (token !== this.refreshToken) {
                return;
            }

            if (error != null) {
                this.logger?.warn?.("[recent-links] could not load article queue", error);
                this.rows = [];
                this.renderRows([]);
                this.hide();
                return;
            }

            this.rows = Array.isArray(data) ? data.filter((row) => isTerminalCompleteStatus(row?.status)) : [];
            this.hasLoaded = true;
            this.renderRows(this.rows);

            if (visible) {
                this.show();
            }
        } catch (error) {
            if (token !== this.refreshToken) {
                return;
            }

            this.logger?.warn?.("[recent-links] could not load article queue", error);
            this.rows = [];
            this.renderRows([]);
            this.hide();
        }
    }

    buildArticleHref(rawUrl) {
        const normalizedUrl = this.api.normalizeUserUrl?.(rawUrl);
        if (normalizedUrl == null) {
            return null;
        }

        const href = new URL("/", this.windowRef.location.origin);
        href.searchParams.set("url", normalizedUrl);
        return href.toString();
    }

    renderRows(rows) {
        if (this.root == null) {
            return;
        }

        this.stopAutoScroll();

        const list = this.documentRef.createElement("div");
        list.className = "recent-links-list";

        for (const row of rows) {
            const rawUrl = row?.url ?? "";
            const href = this.buildArticleHref(rawUrl);
            if (href == null) {
                continue;
            }

            const link = this.documentRef.createElement("a");
            link.className = "recent-link-row";
            link.href = href;
            link.title = rawUrl;
            link.setAttribute("aria-label", rawUrl);

            const urlText = this.documentRef.createElement("span");
            urlText.className = "recent-link-url";
            urlText.textContent = rawUrl;

            link.append(urlText);
            list.appendChild(link);
        }

        this.root.replaceChildren(list);
        this.root.scrollTop = 0;
        if (list.childElementCount === 0) {
            this.hide();
        }
    }

    bindInteractionListeners() {
        if (this.root == null || this.interactionListenersBound) {
            return;
        }

        for (const eventName of RECENT_LINK_INTERACTION_EVENTS) {
            this.root.addEventListener(eventName, this.handleRecentLinksInteraction, { passive: true });
        }

        this.root.addEventListener("keydown", this.handleRecentLinksKeydown);
        this.interactionListenersBound = true;
    }

    scheduleAutoScrollSetup() {
        if (this.root == null) {
            return;
        }

        if (this.autoScrollSetupFrameId != null) {
            this.windowRef.cancelAnimationFrame(this.autoScrollSetupFrameId);
        }

        this.autoScrollSetupFrameId = this.windowRef.requestAnimationFrame(() => {
            this.autoScrollSetupFrameId = null;
            this.setupAutoScroll();
        });
    }

    setupAutoScroll() {
        if (this.root == null || !this.root.classList.contains("is-visible")) {
            return;
        }

        this.stopAutoScroll();
        this.removeLoopDuplicate();
        this.root.scrollTop = 0;

        const list = this.root.querySelector(".recent-links-list:not(.recent-links-list-duplicate)");
        if (list == null || list.childElementCount === 0) {
            return;
        }

        const listHeight = list.offsetHeight;
        const viewportHeight = this.root.clientHeight;
        if (listHeight <= viewportHeight + 1) {
            return;
        }

        const duplicate = list.cloneNode(true);
        duplicate.classList.add("recent-links-list-duplicate");
        duplicate.setAttribute("aria-hidden", "true");
        duplicate.querySelectorAll("a").forEach((link) => {
            link.tabIndex = -1;
        });
        this.root.appendChild(duplicate);

        this.autoScrollLoopHeight = listHeight;
        this.autoScrollOffsetPx = 0;
        this.autoScrollEnabled = true;
        this.autoScrollPaused = false;
        this.autoScrollLastFrameTime = null;
        this.applyAutoScrollTransform();
        this.requestAutoScrollFrame();
    }

    removeLoopDuplicate() {
        if (this.root == null) {
            return;
        }

        this.root.querySelectorAll(".recent-links-list").forEach((list) => {
            list.style.removeProperty("transform");
        });
        this.root.querySelectorAll(".recent-links-list-duplicate").forEach((list) => list.remove());
    }

    requestAutoScrollFrame() {
        if (this.autoScrollFrameId != null || !this.autoScrollEnabled || this.autoScrollPaused) {
            return;
        }

        this.autoScrollFrameId = this.windowRef.requestAnimationFrame(this.handleAutoScrollFrame);
    }

    handleAutoScrollFrame(timestamp) {
        this.autoScrollFrameId = null;

        if (this.root == null || !this.autoScrollEnabled || this.autoScrollPaused) {
            return;
        }

        if (this.autoScrollLastFrameTime == null) {
            this.autoScrollLastFrameTime = timestamp;
        }

        const elapsedMs = Math.min(timestamp - this.autoScrollLastFrameTime, RECENT_LINK_AUTO_SCROLL_MAX_FRAME_MS);
        this.autoScrollLastFrameTime = timestamp;

        if (elapsedMs > 0) {
            this.autoScrollOffsetPx += (RECENT_LINK_AUTO_SCROLL_SPEED_PX_PER_SECOND * elapsedMs) / 1000;
            this.normalizeLoopScrollPosition();
            this.applyAutoScrollTransform();
        }

        this.requestAutoScrollFrame();
    }

    handleRecentLinksInteraction() {
        if (!this.autoScrollEnabled) {
            return;
        }

        this.normalizeLoopScrollPosition();
        this.pauseAutoScroll();
        this.scheduleAutoScrollResume();
    }

    handleRecentLinksKeydown() {
        this.handleRecentLinksInteraction();
    }

    pauseAutoScroll() {
        if (!this.autoScrollEnabled) {
            return;
        }

        this.autoScrollPaused = true;
        this.autoScrollLastFrameTime = null;

        if (this.autoScrollFrameId != null) {
            this.windowRef.cancelAnimationFrame(this.autoScrollFrameId);
            this.autoScrollFrameId = null;
        }
    }

    scheduleAutoScrollResume() {
        this.clearAutoScrollResumeTimer();

        if (!this.autoScrollEnabled) {
            return;
        }

        this.autoScrollResumeTimerId = this.windowRef.setTimeout(() => {
            this.autoScrollResumeTimerId = null;
            this.resumeAutoScroll();
        }, RECENT_LINK_AUTO_SCROLL_RESUME_DELAY_MS);
    }

    resumeAutoScroll() {
        if (this.root == null || !this.autoScrollEnabled || !this.root.classList.contains("is-visible")) {
            return;
        }

        this.normalizeLoopScrollPosition();
        this.autoScrollPaused = false;
        this.autoScrollLastFrameTime = null;
        this.requestAutoScrollFrame();
    }

    normalizeLoopScrollPosition() {
        if (this.root == null || this.autoScrollLoopHeight <= 0) {
            return;
        }

        if (this.autoScrollOffsetPx >= this.autoScrollLoopHeight) {
            this.autoScrollOffsetPx %= this.autoScrollLoopHeight;
        }
    }

    applyAutoScrollTransform() {
        if (this.root == null) {
            return;
        }

        const offset = this.autoScrollEnabled ? this.autoScrollOffsetPx : 0;
        this.root.querySelectorAll(".recent-links-list").forEach((list) => {
            list.style.transform = `translate3d(0, ${-offset}px, 0)`;
        });
    }

    clearAutoScrollResumeTimer() {
        if (this.autoScrollResumeTimerId == null) {
            return;
        }

        this.windowRef.clearTimeout(this.autoScrollResumeTimerId);
        this.autoScrollResumeTimerId = null;
    }

    stopAutoScroll() {
        if (this.autoScrollSetupFrameId != null) {
            this.windowRef.cancelAnimationFrame(this.autoScrollSetupFrameId);
            this.autoScrollSetupFrameId = null;
        }

        if (this.autoScrollFrameId != null) {
            this.windowRef.cancelAnimationFrame(this.autoScrollFrameId);
            this.autoScrollFrameId = null;
        }

        this.clearAutoScrollResumeTimer();
        this.autoScrollLoopHeight = 0;
        this.autoScrollOffsetPx = 0;
        this.autoScrollEnabled = false;
        this.autoScrollPaused = false;
        this.autoScrollLastFrameTime = null;
        this.applyAutoScrollTransform();
    }
}

export default RecentLinksController;
