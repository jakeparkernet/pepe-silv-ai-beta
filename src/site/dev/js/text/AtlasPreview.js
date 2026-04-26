// AtlasPreview.js

class AtlasPreview {
    constructor(options) {
        const { container, getFont, getActiveChars, onGlyphClick } = options;

        this.container = container;
        this.getFont = getFont;
        this.getActiveChars = getActiveChars;
        this.onGlyphClick = onGlyphClick;

        this.canvas = null;
        this.ctx = null;

        this.zoom = 1.0;
        this.offsetX = 0;
        this.offsetY = 0;

        this.isPanning = false;
        this.lastPanX = 0;
        this.lastPanY = 0;
    }

    attach() {
        const font = this.getFont();
        if (!font || !font.atlasCanvas) return;
        if (!this.container) return;

        this.container.innerHTML = "";

        const viewport = document.createElement("canvas");
        viewport.id = "atlas-viewport-canvas";
        viewport.style.display = "block";
        viewport.style.width = "100%";
        viewport.style.height = "100%";
        viewport.style.imageRendering = "pixelated";

        this.container.appendChild(viewport);

        this.canvas = viewport;
        this.ctx = viewport.getContext("2d");

        this.updateSize(true);
        this._setupInteraction();
        this.render();
    }

    updateSize(resetCamera = false) {
        if (!this.canvas || !this.container) return;

        const rect = this.container.getBoundingClientRect();
        const width = Math.max(1, Math.floor(rect.width));
        const height = Math.max(1, Math.floor(rect.height));

        const dpr = window.devicePixelRatio || 1;
        this.canvas.width = width * dpr;
        this.canvas.height = height * dpr;
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        if (resetCamera) {
            this.zoom = 1.0;
            this.offsetX = 0;
            this.offsetY = 0;
        }

        this._clampCamera();
        this.render();
    }

    render() {
        if (!this.canvas || !this.ctx) return;

        const font = this.getFont();
        if (!font || !font.atlasCanvas) return;

        const source = font.atlasCanvas;
        const vpW = this.canvas.width / (window.devicePixelRatio || 1);
        const vpH = this.canvas.height / (window.devicePixelRatio || 1);

        this.ctx.clearRect(0, 0, vpW, vpH);

        this.ctx.save();
        this.ctx.translate(vpW / 2 + this.offsetX, vpH / 2 + this.offsetY);
        this.ctx.scale(this.zoom, this.zoom);
        this.ctx.translate(-source.width / 2, -source.height / 2);

        this.ctx.drawImage(source, 0, 0);

        this._drawGlyphOutlines(font);

        this.ctx.restore();
    }

    _drawGlyphOutlines(font) {
        const glyphs = font.glyphs || {};
        const activeChars = new Set(this.getActiveChars() || []);

        this.ctx.strokeStyle = "red";
        this.ctx.lineWidth = 1;

        for (const [char, g] of Object.entries(glyphs)) {
            if (!activeChars.has(char)) continue;
            if (
                typeof g.u0 !== "number" ||
                typeof g.v0 !== "number" ||
                typeof g.u1 !== "number" ||
                typeof g.v1 !== "number"
            ) {
                continue;
            }

            const atlasW = font.atlasCanvas.width;
            const atlasH = font.atlasCanvas.height;

            const x = g.u0 * atlasW;
            const y = g.v0 * atlasH;
            const w = (g.u1 - g.u0) * atlasW;
            const h = (g.v1 - g.v0) * atlasH;

            this.ctx.beginPath();
            this.ctx.rect(x, y, w, h);
            this.ctx.stroke();
        }
    }

    _setupInteraction() {
        if (!this.canvas) return;

        const canvas = this.canvas;
        let pointerStartX = 0;
        let pointerStartY = 0;

        canvas.addEventListener("wheel", (event) => {
            event.preventDefault();
            const delta = -event.deltaY * 0.001;
            const oldZoom = this.zoom;
            let newZoom = oldZoom * (1 + delta);
            newZoom = Math.max(0.25, Math.min(newZoom, 20));

            const rect = canvas.getBoundingClientRect();
            const mx = event.clientX - rect.left;
            const my = event.clientY - rect.top;

            const sx = (mx - this.offsetX - rect.width / 2) / oldZoom;
            const sy = (my - this.offsetY - rect.height / 2) / oldZoom;

            this.zoom = newZoom;
            this.offsetX = mx - rect.width / 2 - sx * this.zoom;
            this.offsetY = my - rect.height / 2 - sy * this.zoom;

            this._clampCamera();
            this.render();
        });

        canvas.addEventListener("pointerdown", (event) => {
            pointerStartX = event.clientX;
            pointerStartY = event.clientY;
            this.isPanning = true;
            this.lastPanX = event.clientX;
            this.lastPanY = event.clientY;
        });

        const movePan = (event) => {
            if (!this.isPanning) return;

            const dx = event.clientX - this.lastPanX;
            const dy = event.clientY - this.lastPanY;
            this.lastPanX = event.clientX;
            this.lastPanY = event.clientY;

            this.offsetX += dx;
            this.offsetY += dy;

            this._clampCamera();
            this.render();
        };

        canvas.addEventListener("pointerup", (event) => {
            const dx = Math.abs(event.clientX - pointerStartX);
            const dy = Math.abs(event.clientY - pointerStartY);

            if (dx < 5 && dy < 5) {
                const clickedChar = this._getCharAtEvent(event);
                if (clickedChar && this.onGlyphClick) {
                    this.onGlyphClick(clickedChar);
                }
            }
            this.isPanning = false;
        });

        window.addEventListener("pointermove", movePan);
        canvas.addEventListener("pointerleave", () => {
            this.isPanning = false;
        });
    }

    _getCharAtEvent(event) {
        const font = this.getFont();
        if (!font || !font.atlasCanvas || !this.canvas) return null;

        const rect = this.canvas.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        const vpW = rect.width;
        const vpH = rect.height;

        const atlasW = font.atlasCanvas.width;
        const atlasH = font.atlasCanvas.height;

        const mx = event.clientX - rect.left;
        const my = event.clientY - rect.top;

        const worldX = (mx - vpW / 2 - this.offsetX) / this.zoom + atlasW / 2;
        const worldY = (my - vpH / 2 - this.offsetY) / this.zoom + atlasH / 2;

        const u = worldX / atlasW;
        const v = worldY / atlasH;

        if (u < 0 || u > 1 || v < 0 || v > 1) return null;

        const glyphs = font.glyphs || {};
        const activeChars = new Set(this.getActiveChars() || []);

        for (const [char, g] of Object.entries(glyphs)) {
            if (!activeChars.has(char)) continue;
            if (u >= g.u0 && u <= g.u1 && v >= g.v0 && v <= g.v1) {
                return char;
            }
        }

        return null;
    }

    _clampCamera() {
        const font = this.getFont();
        if (!this.canvas || !font || !font.atlasCanvas) return;

        const vpW = this.canvas.width / (window.devicePixelRatio || 1);
        const vpH = this.canvas.height / (window.devicePixelRatio || 1);

        const atlasW = font.atlasCanvas.width;
        const atlasH = font.atlasCanvas.height;

        const worldW = atlasW * this.zoom;
        const worldH = atlasH * this.zoom;

        if (worldW <= vpW) {
            this.offsetX = 0;
        } else {
            const maxX = (worldW - vpW) / 2;
            if (this.offsetX < -maxX) this.offsetX = -maxX;
            if (this.offsetX > maxX) this.offsetX = maxX;
        }

        if (worldH <= vpH) {
            this.offsetY = 0;
        } else {
            const maxY = (worldH - vpH) / 2;
            if (this.offsetY < -maxY) this.offsetY = -maxY;
            if (this.offsetY > maxY) this.offsetY = maxY;
        }
    }
}

export { AtlasPreview };
