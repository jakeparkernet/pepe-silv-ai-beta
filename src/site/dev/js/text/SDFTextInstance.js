import * as THREE from "three";
// import { TextGeometryBuilder } from "./TextGeometryBuilder.js";
// 
const appModules = window[`apps_${performance.timeOrigin}`].modules;
const { TextGeometryBuilder } = appModules.text.TextGeometryBuilder;

export class SDFTextInstance {
    constructor({
        layer,
        text,
        layoutOptions,
        glyphIndices,
        meshInstance,
        group,
        textIndex,
        handle
    }) {
        this._layer = layer;
        this.text = text;
        // layoutOptions are the *requested* options (i.e. what the caller asked for).
        // If auto-scaling is enabled, the layer may compute an effective fontSize
        // per layout pass while keeping these requested options intact.
        this.layoutOptions = layoutOptions;
        this.glyphIndices = glyphIndices;
        this.meshInstance = meshInstance;
        this.group = group;
        this._textIndex = textIndex;
        this.handle = handle;

        // Populated by the layer after layout.
        this.metrics = null;
        this.metricsWorld = null;
        this.effectiveFontSize = null;
    }

    setMatrix(worldMatrix) {
        this.handle.setMatrix(worldMatrix);
    }

    setVisible(vis) {
        this.handle.setVisible(vis);
    }

    markDirty() {
        this.meshInstance?.markDirty?.();
    }

    updateText(newText, newLayoutOptions = {}) {
        this._layer._updateTextInstanceInternal(this, newText, newLayoutOptions);
    }

    /**
     * Convenience: returns last computed layout metrics (width/height/etc)
     * or null if the instance hasn't been laid out yet.
     */
    getMetrics() {
        return this.metrics;
    }

    getMetricsWorld() {
        return this.metricsWorld;
    }

    getBounds(target = new THREE.Box3(), { space = "world" } = {}) {
        const metrics = space === "world" ? (this.metricsWorld || this.metrics) : this.metrics;
        if (!metrics) {
            return target.makeEmpty();
        }

        const minX = Number.isFinite(metrics.minX) ? metrics.minX : 0;
        const maxX = Number.isFinite(metrics.maxX) ? metrics.maxX : 0;
        const minY = Number.isFinite(metrics.minY) ? metrics.minY : 0;
        const maxY = Number.isFinite(metrics.maxY) ? metrics.maxY : 0;
        const anchor = this.layoutOptions?.anchor || "center";
        const offset = TextGeometryBuilder.computeAnchorOffset(metrics, anchor);

        const corners = [
            new THREE.Vector3(minX + offset.x, minY + offset.y, 0),
            new THREE.Vector3(minX + offset.x, maxY + offset.y, 0),
            new THREE.Vector3(maxX + offset.x, minY + offset.y, 0),
            new THREE.Vector3(maxX + offset.x, maxY + offset.y, 0)
        ];

        const matrix = space === "world" ? this.group.matrixWorld : this.group.matrix;
        this.group.updateMatrixWorld(true);

        target.makeEmpty();
        for (const corner of corners) {
            corner.applyMatrix4(matrix);
            target.expandByPoint(corner);
        }

        return target;
    }

    /**
     * Convenience: returns the fontSize actually used after auto-fitting.
     * (When autoScale is off, this matches layoutOptions.fontSize.)
     */
    getEffectiveFontSize() {
        return this.effectiveFontSize;
    }

    release() {
        this.handle.release();
    }
}
