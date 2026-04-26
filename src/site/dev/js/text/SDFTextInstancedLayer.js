import * as THREE from "three";
import { InstancedMeshPool } from "../utils/AssetPool.js";
import { MeshInstance } from "../utils/MeshInstance.js";
import { TextLayoutEngine } from "./TextLayoutEngine.js";
import { TextGeometryBuilder } from "./TextGeometryBuilder.js";
import { SDFTextInstance } from "./SDFTextInstance.js";
import { TextInstanceHandle } from "./TextInstanceHandle.js";

const SDF_TEXT_RENDER_LAYER = 1;

class SDFTextInstancedLayer {
    constructor({ font, material, maxGlyphs = 2048, parent = null }) {
        this.font = font;
        this.material = material;
        this._parent = parent || null;

        const customAttributes = [
            { name: "aGlyphPos", size: 2 },
            { name: "aGlyphScale", size: 2 },
            { name: "aGlyphUVRect", size: 4 },
            { name: "aInstanceVisible", size: 1 }
        ];

        const { handle, entry } = InstancedMeshPool.acquireInstance({
            geomType: "plane",
            geomParams: { width: 1, height: 1 },
            material: material,
            parent: parent,
            maxInstancesHint: maxGlyphs,
            customAttributes: customAttributes,
            hideOnCreation: false
        });

        handle.mesh.renderOrder = 10;
        handle.mesh.layers.set(SDF_TEXT_RENDER_LAYER);

        handle.release();
        this._entry = entry;

        const geom = this._entry.mesh.geometry;
        if (!geom.userData.isOffset) {
            geom.userData.isOffset = false;
        }

        this._instances = new Set();
        this._meshInstances = new Map();
        this._freeTextIndices = [];
        this._nextTextIndex = 0;
    }

    /**
     * Best-effort default font size if none is provided.
     */
    _getDefaultFontSize() {
        const f = this.font;
        return (
            f?.defaultFontSize ??
            f?.info?.size ??
            f?.data?.info?.size ??
            f?.size ??
            f?.common?.lineHeight ??
            f?.data?.common?.lineHeight ??
            16
        );
    }

    /**
     * Normalize layout options. Does not mutate caller input.
     */
    _normalizeLayoutOptions(layoutOptions = {}) {
        const o = { ...layoutOptions };

        // Shorthand aliases
        if (o.fitRect == null && o.fit != null) o.fitRect = o.fit;

        const fitRect = o.fitRect;
        if (fitRect && typeof fitRect === "object") {
            if (o.maxWidth == null && fitRect.width != null) o.maxWidth = fitRect.width;
            if (o.maxHeight == null && fitRect.height != null) o.maxHeight = fitRect.height;

            // When a rect is provided, fitting is implied unless explicitly disabled.
            if (o.autoScale == null) o.autoScale = true;

            // If caller didn't pick a wrapMode, default to word-wrapping when we have a maxWidth.
            if (o.wrapMode == null && o.maxWidth != null) o.wrapMode = fitRect.wrapMode ?? "word";

            // Optional padding inside the fit rect.
            if (o.padding == null && fitRect.padding != null) o.padding = fitRect.padding;
        }

        if (o.fontSize == null) o.fontSize = this._getDefaultFontSize();

        // Binary search iterations & minimum.
        if (o.fitIterations == null) o.fitIterations = 16;
        if (o.minFontSize == null) o.minFontSize = 0.01;

        // Allow scaling UP as well if min constraints exist.
        // Default maxFontSize to the requested fontSize if not given.
        if (o.maxFontSize == null) o.maxFontSize = o.fontSize;

        // Control whether "word wrap" can split a long word by characters.
        if (o.breakLongWords == null) o.breakLongWords = true;

        // Units: caller says constraints are world units; treat as world by default.
        // If someone wants local-space constraints they can set units: "local".
        if (o.units == null) o.units = "world";

        return o;
    }

    _extractSizeFromMetrics(metrics) {
        if (!metrics) return { width: 0, height: 0 };

        const width =
            metrics.width ??
            metrics.w ??
            (metrics.maxX != null && metrics.minX != null ? metrics.maxX - metrics.minX : null) ??
            (metrics.xMax != null && metrics.xMin != null ? metrics.xMax - metrics.xMin : 0);

        const height =
            metrics.height ??
            metrics.h ??
            (metrics.maxY != null && metrics.minY != null ? metrics.maxY - metrics.minY : null) ??
            (metrics.yMax != null && metrics.yMin != null ? metrics.yMax - metrics.yMin : 0);

        return { width: width ?? 0, height: height ?? 0 };
    }

    /**
     * Determine parent/world scale used to convert WORLD-unit constraints to LOCAL-unit constraints.
     * - layoutOptions.worldScale: number | {x,y} | THREE.Vector2 | THREE.Vector3
     * - layoutOptions.worldScaleRef: THREE.Object3D to sample getWorldScale() from
     * - else uses this._parent if provided
     */
    _getWorldScaleXY(layoutOptions) {
        const o = layoutOptions || {};

        // Explicit numeric worldScale
        if (typeof o.worldScale === "number" && isFinite(o.worldScale) && o.worldScale > 0) {
            return { sx: o.worldScale, sy: o.worldScale };
        }

        // Explicit vector-ish worldScale
        if (o.worldScale && typeof o.worldScale === "object") {
            const sx = o.worldScale.x ?? o.worldScale.sx ?? null;
            const sy = o.worldScale.y ?? o.worldScale.sy ?? null;
            if (isFinite(sx) && isFinite(sy) && sx > 0 && sy > 0) return { sx, sy };
        }

        // Sample from object ref if provided
        const ref = o.worldScaleRef || this._parent;
        if (ref && typeof ref.getWorldScale === "function") {
            const v = new THREE.Vector3();
            ref.getWorldScale(v);
            const sx = Math.abs(v.x) || 1;
            const sy = Math.abs(v.y) || 1;
            return { sx, sy };
        }

        return { sx: 1, sy: 1 };
    }

    /**
     * Convert WORLD-unit sizing inputs into LOCAL-unit sizing inputs so that:
     * - layout metrics (local) can be compared fairly against constraints (world).
     */
    _worldToLocalLayoutOptions(normalizedWorld) {
        const o = { ...normalizedWorld };
        if ((o.units || "world") === "local") return o;

        const { sx, sy } = this._getWorldScaleXY(o);

        // Convert all dimensional constraints you care about.
        // (If you add more fields later, put them here.)
        const divX = (v) => (v != null && isFinite(v) ? v / sx : v);
        const divY = (v) => (v != null && isFinite(v) ? v / sy : v);

        o.maxWidth = divX(o.maxWidth);
        o.minWidth = divX(o.minWidth);

        o.maxHeight = divY(o.maxHeight);
        o.minHeight = divY(o.minHeight);

        // Padding is in world too.
        if (o.padding != null) {
            const p = this._parsePadding(o.padding);
            o.padding = { x: p.x / sx, y: p.y / sy };
        }

        // Font size is also interpreted as world-size (per your note),
        // so convert to local before passing to layout engine.
        o.fontSize = divY(o.fontSize);
        o.minFontSize = divY(o.minFontSize);
        o.maxFontSize = divY(o.maxFontSize);

        // Mark that we’re now local.
        o.units = "local";

        return o;
    }

    /**
     * Convert a local font size back to world units for reporting.
     */
    _localFontSizeToWorld(localFontSize, normalizedWorldOrLocal) {
        const o = normalizedWorldOrLocal || {};
        const units = o.units || "world";
        // If the caller used local constraints, don’t convert.
        if (units === "local") return localFontSize;

        const { sy } = this._getWorldScaleXY(o);
        return localFontSize * sy;
    }

    /**
     * Layout a single line (no wrapping), stripping any wrap/fit-related options.
     */
    _layoutSingleLine(text, layoutOptions) {
        const o = { ...layoutOptions };

        delete o.wrapMode;
        delete o.maxWidth;
        delete o.minWidth;
        delete o.maxHeight;
        delete o.minHeight;
        delete o.fitRect;
        delete o.fit;
        delete o.autoScale;
        delete o.minFontSize;
        delete o.maxFontSize;
        delete o.fitIterations;
        delete o.padding;
        delete o.breakLongWords;
        delete o.units;
        delete o.worldScale;
        delete o.worldScaleRef;

        if (o.align == null) o.align = "left";

        return TextLayoutEngine.layoutText(this.font, text, o);
    }

    _computeLineHeight(fontSize, layoutOptions) {
        const multiplier =
            layoutOptions?.lineHeight != null && isFinite(layoutOptions.lineHeight)
                ? layoutOptions.lineHeight
                : 1.0;

        const f = this.font;
        const baseLine =
            f?.common?.lineHeight ??
            f?.data?.common?.lineHeight ??
            f?.lineHeight ??
            null;

        const baseSize =
            f?.info?.size ??
            f?.data?.info?.size ??
            f?.size ??
            null;

        let line = fontSize;
        if (baseLine != null && baseSize != null && baseSize > 0) {
            line = (baseLine / baseSize) * fontSize;
        }
        return line * multiplier;
    }

    _layoutWrapped(text, layoutOptions) {
        const maxWidth = layoutOptions.maxWidth;
        const wrapMode = (layoutOptions.wrapMode || "word").toLowerCase();
        const align = (layoutOptions.align || "left").toLowerCase();
        const breakLongWords = layoutOptions.breakLongWords !== false;

        const measureCache = new Map();
        const measureWidth = (s) => {
            const key = s;
            const cached = measureCache.get(key);
            if (cached != null) return cached;
            const layout = this._layoutSingleLine(s, layoutOptions);
            const { width } = this._extractSizeFromMetrics(layout?.metrics);
            measureCache.set(key, width);
            return width;
        };

        const lines = [];
        const paragraphs = String(text ?? "").split("\n");

        const pushWrappedParagraph = (para) => {
            if (para.length === 0) {
                lines.push("");
                return;
            }

            if (wrapMode === "char") {
                let remaining = para;
                while (remaining.length > 0) {
                    let lo = 1;
                    let hi = remaining.length;
                    let best = 1;

                    while (lo <= hi) {
                        const mid = (lo + hi) >> 1;
                        const prefix = remaining.slice(0, mid);
                        if (measureWidth(prefix) <= maxWidth) {
                            best = mid;
                            lo = mid + 1;
                        } else {
                            hi = mid - 1;
                        }
                    }

                    const line = remaining.slice(0, best);
                    lines.push(line);
                    remaining = remaining.slice(best);
                }
                return;
            }

            const tokens = para.match(/(\s+|\S+)/g) || [];
            let line = "";
            let pendingSpace = "";

            const flushLine = () => {
                if (line.length > 0) lines.push(line);
                line = "";
                pendingSpace = "";
            };

            for (const tok of tokens) {
                if (/^\s+$/.test(tok)) {
                    if (line.length > 0) pendingSpace += tok;
                    continue;
                }

                const spacer = line.length > 0 ? pendingSpace : "";
                const candidate = line + spacer + tok;

                if (line.length === 0) {
                    if (measureWidth(tok) > maxWidth) {
                        if (!breakLongWords) {
                            lines.push(tok);
                            pendingSpace = "";
                            continue;
                        }

                        let remaining = tok;
                        while (remaining.length > 0) {
                            let lo = 1;
                            let hi = remaining.length;
                            let best = 1;
                            while (lo <= hi) {
                                const mid = (lo + hi) >> 1;
                                const prefix = remaining.slice(0, mid);
                                if (measureWidth(prefix) <= maxWidth) {
                                    best = mid;
                                    lo = mid + 1;
                                } else {
                                    hi = mid - 1;
                                }
                            }
                            lines.push(remaining.slice(0, best));
                            remaining = remaining.slice(best);
                        }
                        pendingSpace = "";
                        continue;
                    }

                    line = tok;
                    pendingSpace = "";
                    continue;
                }

                if (measureWidth(candidate) <= maxWidth) {
                    line = candidate;
                    pendingSpace = "";
                } else {
                    flushLine();

                    if (measureWidth(tok) > maxWidth) {
                        if (!breakLongWords) {
                            lines.push(tok);
                        } else {
                            let remaining = tok;
                            while (remaining.length > 0) {
                                let lo = 1;
                                let hi = remaining.length;
                                let best = 1;
                                while (lo <= hi) {
                                    const mid = (lo + hi) >> 1;
                                    const prefix = remaining.slice(0, mid);
                                    if (measureWidth(prefix) <= maxWidth) {
                                        best = mid;
                                        lo = mid + 1;
                                    } else {
                                        hi = mid - 1;
                                    }
                                }
                                lines.push(remaining.slice(0, best));
                                remaining = remaining.slice(best);
                            }
                        }
                    } else {
                        line = tok;
                    }
                }
            }

            flushLine();
        };

        for (let p = 0; p < paragraphs.length; p++) pushWrappedParagraph(paragraphs[p]);

        const lineHeight = this._computeLineHeight(layoutOptions.fontSize, layoutOptions);
        const stitchedGlyphs = [];
        const lineLayouts = [];
        let maxLineWidth = 0;

        for (let i = 0; i < lines.length; i++) {
            const lineText = lines[i];
            const l = this._layoutSingleLine(lineText, layoutOptions);
            const { width } = this._extractSizeFromMetrics(l?.metrics);
            maxLineWidth = Math.max(maxLineWidth, width);
            lineLayouts.push({ layout: l, width });
        }

        const containerWidth = isFinite(maxWidth) ? maxWidth : maxLineWidth;

        for (let i = 0; i < lineLayouts.length; i++) {
            const { layout: l, width: lineW } = lineLayouts[i];
            const glyphs = l?.glyphs || [];

            let xShift = 0;
            if (align === "center") xShift = (containerWidth - lineW) * 0.5;
            else if (align === "right") xShift = containerWidth - lineW;

            const yShift = -i * lineHeight;

            for (const g of glyphs) {
                stitchedGlyphs.push({
                    ...g,
                    x: g.x + xShift,
                    y: g.y + yShift
                });
            }
        }

        let minX = Infinity;
        let maxX = -Infinity;
        let minY = Infinity;
        let maxY = -Infinity;

        for (const g of stitchedGlyphs) {
            minX = Math.min(minX, g.x);
            maxX = Math.max(maxX, g.x + g.w);
            maxY = Math.max(maxY, g.y);
            minY = Math.min(minY, g.y - g.h);
        }

        if (stitchedGlyphs.length === 0) {
            minX = minY = maxX = maxY = 0;
        }

        const metrics = {
            minX,
            maxX,
            minY,
            maxY,
            width: maxX - minX,
            height: maxY - minY,
            lineHeight,
            lineCount: lines.length
        };

        return { glyphs: stitchedGlyphs, metrics };
    }

    _layoutTextSmart(text, layoutOptions) {
        const wrapMode = layoutOptions?.wrapMode;
        const maxWidth = layoutOptions?.maxWidth;

        if (
            wrapMode &&
            String(wrapMode).toLowerCase() !== "none" &&
            maxWidth != null &&
            isFinite(maxWidth)
        ) {
            return this._layoutWrapped(text, layoutOptions);
        }

        return TextLayoutEngine.layoutText(this.font, text, layoutOptions);
    }

    _parsePadding(padding) {
        if (padding == null) return { x: 0, y: 0 };
        if (typeof padding === "number") return { x: padding, y: padding };
        if (Array.isArray(padding)) return { x: padding[0] ?? 0, y: padding[1] ?? padding[0] ?? 0 };
        if (typeof padding === "object") return { x: padding.x ?? 0, y: padding.y ?? 0 };
        return { x: 0, y: 0 };
    }

    /**
     * Layout + (optional) auto-fit.
     *
     * Supports BOTH:
     * - maxWidth/maxHeight (shrink until it fits)
     * - minWidth/minHeight (grow until it reaches at least these)
     *
     * All constraints are assumed WORLD units unless layoutOptions.units === "local".
     */
    _layoutTextWithAutoFit(text, requestedLayoutOptions = {}) {
        const normalizedWorld = this._normalizeLayoutOptions(requestedLayoutOptions);

        // Convert world inputs into local for fair comparisons with local metrics.
        const normalized = this._worldToLocalLayoutOptions(normalizedWorld);

        const wantFit = !!normalized.autoScale;

        const hasMaxW = normalized.maxWidth != null && isFinite(normalized.maxWidth);
        const hasMaxH = normalized.maxHeight != null && isFinite(normalized.maxHeight);
        const hasMinW = normalized.minWidth != null && isFinite(normalized.minWidth);
        const hasMinH = normalized.minHeight != null && isFinite(normalized.minHeight);

        if (!wantFit || (!hasMaxW && !hasMaxH && !hasMinW && !hasMinH)) {
            const layout = this._layoutTextSmart(text, normalized);
            return {
                layout,
                requested: normalizedWorld,      // keep caller-visible options in world
                effective: normalizedWorld,      // same
                effectiveFontSize: normalizedWorld.fontSize
            };
        }

        const pad = this._parsePadding(normalized.padding);
        const maxTargetW = hasMaxW ? Math.max(0, normalized.maxWidth - pad.x * 2) : null;
        const maxTargetH = hasMaxH ? Math.max(0, normalized.maxHeight - pad.y * 2) : null;

        const minTargetW = hasMinW ? Math.max(0, normalized.minWidth - pad.x * 2) : null;
        const minTargetH = hasMinH ? Math.max(0, normalized.minHeight - pad.y * 2) : null;

        const wrapMode = String(normalized.wrapMode || "none").toLowerCase();
        const breakLongWords = normalized.breakLongWords !== false;

        const requireLongestWordFit =
            breakLongWords === false &&
            wrapMode === "word" &&
            maxTargetW != null &&
            isFinite(maxTargetW);

        // Local font sizes (already converted if inputs were world).
        const hardMin = 0.0001;
        const minFontSize = Math.max(hardMin, normalized.minFontSize ?? hardMin);
        const maxFontSize = Math.max(minFontSize, normalized.maxFontSize ?? normalized.fontSize ?? 1);

        const iterations = Math.max(1, normalized.fitIterations ?? 12);
        const eps = 1e-6;

        const fitsMax = (layout, optsForMeasure) => {
            const { width, height } = this._extractSizeFromMetrics(layout?.metrics);
            const wOk = maxTargetW == null || width <= maxTargetW + eps;
            const hOk = maxTargetH == null || height <= maxTargetH + eps;
            if (!wOk || !hOk) return false;

            if (requireLongestWordFit) {
                const longest = this._measureLongestWordWidth(text, optsForMeasure);
                if (longest > maxTargetW + eps) return false;
            }
            return true;
        };

        const meetsMin = (layout) => {
            const { width, height } = this._extractSizeFromMetrics(layout?.metrics);
            const wOk = minTargetW == null || width >= minTargetW - eps;
            const hOk = minTargetH == null || height >= minTargetH - eps;
            return wOk && hOk;
        };

        const makeOpts = (fontSize) => ({
            ...normalized,
            // Use max constraints (if any) for wrapping/layout in fit mode.
            maxWidth: maxTargetW ?? normalized.maxWidth,
            maxHeight: maxTargetH ?? normalized.maxHeight,
            fontSize
        });

        // Evaluate at extremes.
        const maxOpts = makeOpts(maxFontSize);
        const maxLayout = this._layoutTextSmart(text, maxOpts);

        const minOpts = makeOpts(minFontSize);
        const minLayout = this._layoutTextSmart(text, minOpts);

        // If even the largest size doesn't meet the MIN constraints, clamp to max.
        if (!meetsMin(maxLayout)) {
            return {
                layout: maxLayout,
                requested: normalizedWorld,
                effective: {
                    ...normalizedWorld,
                    fontSize: this._localFontSizeToWorld(maxFontSize, normalizedWorld)
                },
                effectiveFontSize: this._localFontSizeToWorld(maxFontSize, normalizedWorld)
            };
        }

        // If even the smallest size doesn't fit the MAX constraints, clamp to min.
        if (!fitsMax(minLayout, minOpts)) {
            return {
                layout: minLayout,
                requested: normalizedWorld,
                effective: {
                    ...normalizedWorld,
                    fontSize: this._localFontSizeToWorld(minFontSize, normalizedWorld)
                },
                effectiveFontSize: this._localFontSizeToWorld(minFontSize, normalizedWorld)
            };
        }

        // Now there exists some fontSize in [min, max] that:
        // - fits max constraints
        // - meets min constraints
        //
        // We'll binary search for the "largest" font size that still fits max,
        // while also meeting min.
        let lo = minFontSize;
        let hi = maxFontSize;
        let best = minFontSize;
        let bestLayout = minLayout;

        for (let i = 0; i < iterations; i++) {
            const mid = (lo + hi) * 0.5;
            const midOpts = makeOpts(mid);
            const midLayout = this._layoutTextSmart(text, midOpts);

            const okMax = fitsMax(midLayout, midOpts);
            const okMin = meetsMin(midLayout);

            if (okMax && okMin) {
                best = mid;
                bestLayout = midLayout;
                lo = mid; // try bigger
            } else {
                hi = mid; // too big or too small to meet min? (min is guaranteed achievable at max; max is guaranteed achievable at min)
            }
        }

        const bestWorldFontSize = this._localFontSizeToWorld(best, normalizedWorld);

        return {
            layout: bestLayout,
            requested: normalizedWorld,
            effective: { ...normalizedWorld, fontSize: bestWorldFontSize },
            effectiveFontSize: bestWorldFontSize
        };
    }

    createTextInstance(text, layoutOptions = {}) {
        const { layout, requested, effective, effectiveFontSize } =
            this._layoutTextWithAutoFit(text, layoutOptions);

        const glyphs = layout.glyphs || [];

        const glyphIndices = [];
        for (let i = 0; i < glyphs.length; i++) {
            try {
                glyphIndices.push(this._entry.allocateIndex());
            } catch (e) {
                console.warn("SDFText: Max glyphs reached");
                break;
            }
        }

        // Use *local* options for writing, because glyph positions/sizes are local.
        // We convert requested/effective (world) back into local for rendering math.
        const localEffectiveForWrite = this._worldToLocalLayoutOptions(this._normalizeLayoutOptions(effective));
        this._writeGlyphData(layout, glyphIndices, localEffectiveForWrite);

        const textIndex =
            this._freeTextIndices.length
                ? this._freeTextIndices.pop()
                : this._nextTextIndex++;

        const group = new THREE.Group();

        const handle = new TextInstanceHandle({
            layer: this,
            entry: this._entry,
            glyphIndices,
            textIndex
        });

        const meshInstance = new MeshInstance({ group, handle, entry: this._entry });
        this._entry.registerInstance(textIndex, meshInstance);
        this._entry.markInstanceDirty(textIndex);

        const instance = new SDFTextInstance({
            layer: this,
            text,
            layoutOptions: requested,
            glyphIndices,
            meshInstance,
            group,
            textIndex,
            handle
        });

        // Metrics are in local space from layout engine.
        // You may want world-space metrics too:
        const { sx, sy } = this._getWorldScaleXY(requested);
        instance.metrics = layout.metrics;
        instance.metricsWorld = layout.metrics
            ? {
                  ...layout.metrics,
                  width: (layout.metrics.width ?? 0) * sx,
                  height: (layout.metrics.height ?? 0) * sy
              }
            : layout.metrics;

        instance.effectiveFontSize = effectiveFontSize;

        handle.attachInstance(instance);

        return instance;
    }

    _updateTextInstanceInternal(instance, newText, newLayoutOptions = {}) {
        if (!instance || instance._textIndex == null) return;

        const merged = { ...instance.layoutOptions, ...newLayoutOptions };
        const { layout, requested, effective, effectiveFontSize } =
            this._layoutTextWithAutoFit(newText, merged);
        const glyphs = layout.glyphs || [];

        const glyphIndices = instance.glyphIndices;
        const oldCount = glyphIndices.length;
        const newCount = glyphs.length;

        if (newCount > oldCount) {
            for (let i = oldCount; i < newCount; i++) {
                try {
                    const idx = this._entry.allocateIndex();
                    glyphIndices.push(idx);
                } catch (e) {
                    console.warn("SDFText: Max glyphs reached during update");
                    break;
                }
            }
        }

        if (newCount < oldCount) {
            for (let i = newCount; i < oldCount; i++) {
                const idx = glyphIndices[i];
                this._entry.setInstanceAttribute(idx, "aInstanceVisible", 0);
                this._entry.releaseIndex(idx);
            }
            glyphIndices.length = newCount;
        }

        instance.text = newText;
        instance.layoutOptions = requested;
        instance.metrics = layout.metrics;

        const { sx, sy } = this._getWorldScaleXY(requested);
        instance.metricsWorld = layout.metrics
            ? {
                  ...layout.metrics,
                  width: (layout.metrics.width ?? 0) * sx,
                  height: (layout.metrics.height ?? 0) * sy
              }
            : layout.metrics;

        instance.effectiveFontSize = effectiveFontSize;

        const localEffectiveForWrite = this._worldToLocalLayoutOptions(this._normalizeLayoutOptions(effective));
        this._writeGlyphData(layout, glyphIndices, localEffectiveForWrite);

        this._entry.markInstanceDirty(instance._textIndex);
    }

    _writeGlyphData(layout, glyphIndices, layoutOptions) {
        const glyphs = layout.glyphs;
        const metrics = layout.metrics;
        const anchor = layoutOptions.anchor || "center";
        const offset = TextGeometryBuilder.computeAnchorOffset(metrics, anchor);

        for (let i = 0; i < glyphIndices.length; i++) {
            const idx = glyphIndices[i];
            const g = glyphs[i];
            if (!g) {
                this._entry.setInstanceAttribute(idx, "aInstanceVisible", 0);
                continue;
            }

            const x = g.x + offset.x;
            const y = g.y + offset.y;

            const centerX = x + g.w * 0.5;
            const centerY = y - g.h * 0.5;

            this._entry.setInstanceAttribute(idx, "aGlyphPos", [centerX, centerY]);
            this._entry.setInstanceAttribute(idx, "aGlyphScale", [g.w, -g.h]);
            this._entry.setInstanceAttribute(idx, "aGlyphUVRect", [g.u0, g.v0, g.u1, g.v1]);
            this._entry.setInstanceAttribute(idx, "aInstanceVisible", 1);
        }
    }

    _measureLongestWordWidth(text, layoutOptions) {
        const s = String(text ?? "");
        const words = s.match(/\S+/g) || [];

        let maxW = 0;
        for (const w of words) {
            const l = this._layoutSingleLine(w, layoutOptions);
            const { width } = this._extractSizeFromMetrics(l?.metrics);
            if (width > maxW) maxW = width;
        }
        return maxW;
    }

    _disposeTextInstance(inst, { fromHandle = false } = {}) {
        if (inst._textIndex != null) {
            this._entry.unregisterInstance(inst._textIndex);
            this._freeTextIndices.push(inst._textIndex);
            inst._textIndex = null;
        }

        for (const idx of inst.glyphIndices) {
            this._entry.setInstanceAttribute(idx, "aInstanceVisible", 0);
            this._entry.releaseIndex(idx);
        }
        inst.glyphIndices.length = 0;

        if (!fromHandle && inst.meshInstance) {
            inst.meshInstance.dispose();
            inst.meshInstance = null;
        }
    }
}

export { SDFTextInstancedLayer };
