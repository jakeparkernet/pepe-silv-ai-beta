const DEFAULT_STATUS_CONFIG_PATH = "./status_states.json";
const DEFAULT_GRAPH_WIDTH = 1200;
const DEFAULT_GRAPH_HEIGHT = 800;
const DEFAULT_LABEL_MAX_WIDTH = 120;

class ArticleStatusD3 {
    constructor({
        svgSelector,
        containerSelector,
        statusConfigPath = DEFAULT_STATUS_CONFIG_PATH
    }) {
        this.svg = window.d3.select(svgSelector);
        this.container = document.querySelector(containerSelector);
        this.statusConfigPath = statusConfigPath;
        this.width = DEFAULT_GRAPH_WIDTH;
        this.height = DEFAULT_GRAPH_HEIGHT;
        this.states = [];
        this.currentStatusIndex = -1;
        this.initialized = false;
        this.initializationPromise = null;

        this.root = this.svg.append("g").attr("class", "article-status-d3-root");
        this.root.style("pointer-events", "none");
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

        this.svg
            .attr("viewBox", `0 0 ${this.width} ${this.height}`)
            .attr("width", this.width)
            .attr("height", this.height);

        this.render();
    }

    render() {
        this.root.selectAll("*").remove();

        if (this.initialized === false || this.states.length === 0) {
            return;
        }

        const computedStyles = this.container ? window.getComputedStyle(this.container) : null;
        const offsetY = Number.parseFloat(computedStyles?.getPropertyValue("--article-status-d3-offset-y") ?? "") || 200;
        const isCompactViewport = this.width <= 768;
        const labelFontSize = isCompactViewport ? 10 : 12;
        const labelYOffset = isCompactViewport ? 28 : 32;
        const labelLineHeight = isCompactViewport ? 12 : 14;
        const outerPadding = 72;
        const lineWidth = Math.min(this.width - (outerPadding * 2), Math.max(460, this.states.length * 120));
        const startX = (this.width - lineWidth) * 0.5;
        const y = Math.max(170 + offsetY, Math.min((this.height * 0.42) + offsetY, 260 + offsetY));
        const endX = startX + lineWidth;
        const dotSpacing = this.states.length > 1 ? lineWidth / (this.states.length - 1) : 0;
        const labelMaxWidth = isCompactViewport
            ? Math.max(48, Math.min(78, dotSpacing - 10 || 78))
            : DEFAULT_LABEL_MAX_WIDTH;

        this.root
            .append("line")
            .attr("x1", startX)
            .attr("y1", y)
            .attr("x2", endX)
            .attr("y2", y)
            .attr("stroke", "rgba(122, 106, 77, 0.35)")
            .attr("stroke-width", 4)
            .attr("stroke-linecap", "round");

        const activeLineEndX = this.currentStatusIndex <= 0
            ? startX
            : startX + (dotSpacing * this.currentStatusIndex);

        this.root
            .append("line")
            .attr("x1", startX)
            .attr("y1", y)
            .attr("x2", activeLineEndX)
            .attr("y2", y)
            .attr("stroke", "#7c5b2a")
            .attr("stroke-width", 4)
            .attr("stroke-linecap", "round");

        const points = this.states.map((state, index) => ({
            ...state,
            x: startX + (dotSpacing * index),
            y,
            reached: this.currentStatusIndex >= index
        }));

        const groups = this.root
            .selectAll("g.article-status-d3-point")
            .data(points, (entry) => entry.status)
            .join("g")
            .attr("class", "article-status-d3-point")
            .attr("transform", (entry) => `translate(${entry.x}, ${entry.y})`);

        groups
            .append("circle")
            .attr("r", 10)
            .attr("fill", (entry) => entry.reached ? "#7c5b2a" : "rgba(255, 252, 244, 0.94)")
            .attr("stroke", "#7c5b2a")
            .attr("stroke-width", 2.5);

        groups
            .append("text")
            .attr("y", labelYOffset)
            .attr("fill", "#24180d")
            .attr("font-size", labelFontSize)
            .attr("font-weight", 700)
            .attr("text-anchor", "middle")
            .text((entry) => entry.messageD3)
            .each((_, index, nodes) => {
                this.wrapText(window.d3.select(nodes[index]), labelMaxWidth, labelLineHeight);
            });
    }

    wrapText(textSelection, maxWidth, lineHeight = 14) {
        const text = textSelection.text();
        const words = String(text).split(/\s+/).filter(Boolean);
        const x = Number(textSelection.attr("x") || 0);
        const y = Number(textSelection.attr("y") || 0);
        let line = [];
        let lineIndex = 0;

        textSelection.text(null);

        let tspan = textSelection
            .append("tspan")
            .attr("x", x)
            .attr("y", y)
            .attr("dy", "0em");

        for (let i = 0; i < words.length; i += 1) {
            line.push(words[i]);
            tspan.text(line.join(" "));

            if (tspan.node()?.getComputedTextLength() > maxWidth && line.length > 1) {
                line.pop();
                tspan.text(line.join(" "));
                line = [words[i]];
                lineIndex += 1;
                tspan = textSelection
                    .append("tspan")
                    .attr("x", x)
                    .attr("y", y)
                    .attr("dy", `${lineIndex * lineHeight}px`)
                    .text(words[i]);
            }
        }
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
        this.root.style("display", null);
    }

    hide() {
        this.root.style("display", "none");
    }
}

export { ArticleStatusD3 };
