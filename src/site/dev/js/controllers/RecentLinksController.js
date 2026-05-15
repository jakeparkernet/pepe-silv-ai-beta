const DEFAULT_RECENT_LINK_LIMIT = 100;

function normalizeStatusClass(status) {
    return String(status ?? "unknown")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "") || "unknown";
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
    }

    initialize() {
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

        this.root.classList.add("is-visible");
        this.root.setAttribute("aria-hidden", "false");
    }

    hide() {
        if (this.root == null) {
            return;
        }

        this.refreshToken += 1;
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

            this.rows = Array.isArray(data) ? data : [];
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

        const list = this.documentRef.createElement("div");
        list.className = "recent-links-list";

        for (const row of rows) {
            const rawUrl = row?.url ?? "";
            const href = this.buildArticleHref(rawUrl);
            if (href == null) {
                continue;
            }

            const status = String(row?.status ?? "unknown").trim() || "unknown";
            const link = this.documentRef.createElement("a");
            link.className = `recent-link-row recent-link-status-${normalizeStatusClass(status)}`;
            link.href = href;
            link.title = rawUrl;
            link.setAttribute("aria-label", `${rawUrl}, status ${status}`);

            const urlText = this.documentRef.createElement("span");
            urlText.className = "recent-link-url";
            urlText.textContent = rawUrl;

            const statusText = this.documentRef.createElement("span");
            statusText.className = "recent-link-status";
            statusText.textContent = status;

            link.append(urlText, statusText);
            list.appendChild(link);
        }

        this.root.replaceChildren(list);
        if (list.childElementCount === 0) {
            this.hide();
        }
    }
}

export default RecentLinksController;
