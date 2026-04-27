const DEFAULT_STATUS_CONFIG_PATH = "./status_states.json";
const DEFAULT_GRAPH_WIDTH = 1200;
const DEFAULT_GRAPH_HEIGHT = 800;
const DEFAULT_LABEL_MAX_WIDTH = 120;
const VERTICAL_LAYOUT_MAX_WIDTH = 560;
const VERTICAL_LAYOUT_POINT_SPACING = 68;
const VERTICAL_LAYOUT_FRAME_MIN_TOP = 24;
const VERTICAL_LAYOUT_FRAME_MIN_BOTTOM = 24;

class ArticleStatusD3 {
    constructor({
        svgSelector,
        containerSelector,
        statusConfigPath = DEFAULT_STATUS_CONFIG_PATH
    }) {
        this.svgSelector = svgSelector;
        this.container = document.querySelector(containerSelector);
        this.statusConfigPath = statusConfigPath;
        this.width = DEFAULT_GRAPH_WIDTH;
        this.height = DEFAULT_GRAPH_HEIGHT;
        this.states = [];
        this.currentStatusIndex = -1;
        this.initialized = false;
        this.initializationPromise = null;

        this.root = document.createElement("div");
        this.root.className = "article-status-html-root";
        this.root.setAttribute("aria-hidden", "true");
        this.container?.appendChild?.(this.root);
        this.hide();
    }

    async init() {
        if (this.initialized) {
            return this;
        }

        if (this.initializationPromise != null) {
            return this.initializationPromise;
        }

        this.initializationPromise = this.loadStates()
            .then((states) => {
                this.states = states;
                this.initialized = true;
                this.resize();
                return this;
            })
            .finally(() => {
                this.initializationPromise = null;
            });

        return this.initializationPromise;
    }

    async loadStates() {
        const response = await fetch(this.statusConfigPath);
        if (!response.ok) {
            throw new Error(`ArticleStatusD3: failed to load "${this.statusConfigPath}" (${response.status})`);
        }

        const data = await response.json();
        if (Array.isArray(data) === false) {
            throw new Error("ArticleStatusD3: status config must be an array.");
        }

        return data
            .filter((entry) => entry != null && typeof entry === "object")
            .map((entry) => ({
                status: String(entry.status ?? "").trim().toLowerCase(),
                messageD3: String(entry.message_d3 ?? entry.message ?? entry.status ?? "").trim()
            }))
            .filter((entry) => entry.status.length > 0 && entry.messageD3.length > 0);
    }

    getStatusIndex(status) {
        const normalizedStatus = String(status ?? "").trim().toLowerCase();
        return this.states.findIndex((entry) => entry.status === normalizedStatus);
    }

    resize() {
        const rect = this.container?.getBoundingClientRect?.();
        this.width = Math.max(320, Math.floor(rect?.width || window.innerWidth || DEFAULT_GRAPH_WIDTH));
        this.height = Math.max(320, Math.floor(rect?.height || window.innerHeight || DEFAULT_GRAPH_HEIGHT));
        this.render();
    }

    render() {
        if (this.root == null) {
            return;
        }

        this.root.replaceChildren();

        if (this.initialized === false || this.states.length === 0) {
            return;
        }

        const computedStyles = this.container ? window.getComputedStyle(this.container) : null;
        const offsetY = Number.parseFloat(computedStyles?.getPropertyValue("--article-status-d3-offset-y") ?? "") || 200;
        const isCompactViewport = this.width <= 768;
        const useVerticalLayout = this.width <= VERTICAL_LAYOUT_MAX_WIDTH;
        const labelMaxWidth = isCompactViewport ? 78 : DEFAULT_LABEL_MAX_WIDTH;
        const outerPadding = 72;
        const lineWidth = Math.min(this.width - (outerPadding * 2), Math.max(460, this.states.length * 120));
        const y = Math.max(170 + offsetY, Math.min((this.height * 0.42) + offsetY, 260 + offsetY));
        const pointCount = this.states.length;
        const progress = pointCount <= 1
            ? (this.currentStatusIndex >= 0 ? 1 : 0)
            : Math.max(0, Math.min(1, this.currentStatusIndex / (pointCount - 1)));

        const frame = document.createElement("div");
        frame.className = "article-status-html-frame";
        frame.classList.toggle("is-compact", isCompactViewport);
        frame.classList.toggle("is-vertical", useVerticalLayout);

        if (useVerticalLayout) {
            const frameHeight = Math.max(180, ((Math.max(0, pointCount - 1)) * VERTICAL_LAYOUT_POINT_SPACING) + 24);
            const frameWidth = Math.max(180, Math.min(280, this.width - 32));
            const frameTop = Math.max(
                VERTICAL_LAYOUT_FRAME_MIN_TOP,
                Math.min(
                    this.height - frameHeight - VERTICAL_LAYOUT_FRAME_MIN_BOTTOM,
                    Math.round(y - 24)
                )
            );

            frame.style.width = `${frameWidth}px`;
            frame.style.height = `${frameHeight}px`;
            frame.style.top = `${frameTop}px`;
        } else {
            frame.style.width = `${Math.max(220, lineWidth)}px`;
            frame.style.top = `${Math.round(y)}px`;
        }

        const track = document.createElement("div");
        track.className = "article-status-html-track";
        if (useVerticalLayout) {
            track.classList.add("is-vertical");
        }
        frame.appendChild(track);

        const activeTrack = document.createElement("div");
        activeTrack.className = "article-status-html-track article-status-html-track-active";
        if (useVerticalLayout) {
            activeTrack.classList.add("is-vertical");
            activeTrack.style.transform = `scaleY(${progress})`;
        } else {
            activeTrack.style.transform = `scaleX(${progress})`;
        }
        frame.appendChild(activeTrack);

        for (let i = 0; i < pointCount; i += 1) {
            const state = this.states[i];
            const point = document.createElement("div");
            const isReached = this.currentStatusIndex >= i;
            const isCurrent = this.currentStatusIndex === i;
            const pointPercent = pointCount <= 1 ? 50 : (i / (pointCount - 1)) * 100;

            point.className = "article-status-html-point";
            point.style.setProperty("--article-status-label-max-width", `${labelMaxWidth}px`);
            point.classList.toggle("is-reached", isReached);
            point.classList.toggle("is-current", isCurrent);

            if (useVerticalLayout) {
                point.classList.add("is-vertical");
                point.style.top = `${pointPercent}%`;
            } else {
                point.style.left = `${pointPercent}%`;
            }

            const dot = document.createElement("div");
            dot.className = "article-status-html-dot";
            point.appendChild(dot);

            const label = document.createElement("div");
            label.className = "article-status-html-label";
            label.textContent = state.messageD3;
            point.appendChild(label);

            frame.appendChild(point);
        }

        this.root.appendChild(frame);
    }

    async showForStatus(status) {
        await this.init();

        const statusIndex = this.getStatusIndex(status);
        if (statusIndex < 0) {
            this.hide();
            this.currentStatusIndex = -1;
            return false;
        }

        this.currentStatusIndex = statusIndex;
        this.show();
        this.render();
        return true;
    }

    show() {
        if (this.root == null) {
            return;
        }

        this.root.style.display = "";
        this.root.setAttribute("aria-hidden", "false");
    }

    hide() {
        if (this.root == null) {
            return;
        }

        this.root.style.display = "none";
        this.root.setAttribute("aria-hidden", "true");
    }
}

export { ArticleStatusD3 };
