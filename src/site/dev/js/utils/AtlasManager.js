class AtlasManager {
    /**
     * Manages a fixed-size atlas canvas subdivided into strip slots.
     * Each slot is stripWidth x stripHeight.
     */
    constructor({
        maxWidth = 2048,
        maxHeight = 512,
        stripWidth = 2,
        stripHeight = 256,
    } = {}) {
        this.atlasCanvas = document.createElement('canvas');
        this.atlasCanvas.width = maxWidth;
        this.atlasCanvas.height = maxHeight;
        this.ctx = this.atlasCanvas.getContext('2d');

        this.stripWidth = stripWidth;
        this.stripHeight = stripHeight;
        this.maxWidth = maxWidth;
        this.maxHeight = maxHeight;

        this.slotsPerRow = Math.floor(maxWidth / stripWidth);
        this.rows = Math.floor(maxHeight / stripHeight);
        this.maxSlots = this.slotsPerRow * this.rows;

        this.count = 0;       // how many slots are actually used
        this.rects = [];      // UV rects per slot: {u0,v0,u1,v1,index}
    }

    addStrip(stripCanvas) {
        if (stripCanvas.width !== this.stripWidth || stripCanvas.height !== this.stripHeight) {
            throw new Error(`AtlasManager.addStrip: strip must be ${this.stripWidth}x${this.stripHeight}`);
        }
        if (this.count >= this.maxSlots) {
            throw new Error('AtlasManager: atlas is full');
        }

        const index = this.count;
        const col = index % this.slotsPerRow;
        const row = Math.floor(index / this.slotsPerRow);

        const x = col * this.stripWidth;
        const y = row * this.stripHeight;

        this.ctx.drawImage(stripCanvas, x, y);

        const u0 = x / this.maxWidth;
        const u1 = (x + this.stripWidth) / this.maxWidth;

        const v0Top = y / this.maxHeight;
        const v1Top = (y + this.stripHeight) / this.maxHeight;

        const v0 = 1 - v1Top;
        const v1 = 1 - v0Top;

        const rect = { u0, v0, u1, v1, index };
        this.rects.push(rect);
        this.count++;

        return rect;
    }

    getCount() {
        return this.count;
    }
}

export { AtlasManager };