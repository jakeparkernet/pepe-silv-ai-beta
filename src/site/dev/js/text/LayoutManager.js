// LayoutManager.js
class LayoutManager {
    constructor(options) {
        const {
            appRoot,        // should be document.documentElement
            container,      // #threejs-canvas
            debugPanel,     // #debug-panel
            debugResizer,   // #debug-resizer
            atlasPanel,     // #atlas-preview
            atlasResizer,   // #atlas-resizer
            sceneManager,
            atlasPreview
        } = options;

        this.appRoot = appRoot;
        this.container = container;
        this.debugPanel = debugPanel;
        this.debugResizer = debugResizer;
        this.atlasPanel = atlasPanel;
        this.atlasResizer = atlasResizer;
        this.sceneManager = sceneManager;
        this.atlasPreview = atlasPreview;
    }

    init() {
        this._setupPanelResizers();
        this._setupResizeObservers();

        window.addEventListener("resize", () => {
            this.sceneManager.updateSize();
            this.atlasPreview.updateSize(true);
        });
    }

    _setupResizeObservers() {
        if (typeof ResizeObserver === "undefined") return;
        const containerResizeObserver = new ResizeObserver(() => {
            this.sceneManager.updateSize();
        });
        containerResizeObserver.observe(this.container);
    }

    _setupPanelResizers() {
        const minWidth = 150;

        // Left resizer (debug panel)
        if (this.debugResizer && this.debugPanel) {
            let startX = 0;
            let startWidth = 0;

            const onMouseMove = (event) => {
                const dx = event.clientX - startX;
                let newWidth = startWidth + dx;
                if (newWidth < minWidth) newWidth = minWidth;
                this.appRoot.style.setProperty("--debug-panel-width", `${newWidth}px`);
            };

            const onMouseUp = () => {
                document.removeEventListener("mousemove", onMouseMove);
                document.removeEventListener("mouseup", onMouseUp);
            };

            this.debugResizer.addEventListener("mousedown", (event) => {
                event.preventDefault();
                startX = event.clientX;
                startWidth = this.debugPanel.getBoundingClientRect().width;
                document.addEventListener("mousemove", onMouseMove);
                document.addEventListener("mouseup", onMouseUp);
            });
        }

        // Right resizer (atlas preview)
        if (this.atlasResizer && this.atlasPanel) {
            let startX = 0;
            let startWidth = 0;

            const onMouseMove = (event) => {
                const dx = startX - event.clientX;
                let newWidth = startWidth + dx;
                if (newWidth < minWidth) newWidth = minWidth;

                // CSS uses --atlas-preview-width in :root
                this.appRoot.style.setProperty("--atlas-preview-width", `${newWidth}px`);
                this.atlasPreview.updateSize();
            };

            const onMouseUp = () => {
                document.removeEventListener("mousemove", onMouseMove);
                document.removeEventListener("mouseup", onMouseUp);
            };

            this.atlasResizer.addEventListener("mousedown", (event) => {
                event.preventDefault();
                const rect = this.atlasPanel.getBoundingClientRect();
                startX = event.clientX;
                startWidth = rect.width;
                document.addEventListener("mousemove", onMouseMove);
                document.addEventListener("mouseup", onMouseUp);
            });
        }
    }
}

export { LayoutManager };
