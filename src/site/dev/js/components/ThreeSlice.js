import * as THREE from "three";
import { createPooledMesh } from "../utils/AssetPool.js";

// Canonical tile keys in order (vertical)
const TILE_KEYS = ["top", "center", "bottom"];

const DEFAULT_SLICE_CONFIG = {
  edge: "resources/edge_10px.png",
  center: null
};

class ThreeSlice {
  constructor(sliceConfig, width = 1, height = 3, scale = 1) {
    if (!sliceConfig) {
      sliceConfig = structuredClone(DEFAULT_SLICE_CONFIG);
    }

    this.rootGroup = new THREE.Group();

    this._width = Math.max(width, 0.0001);
    this._height = Math.max(height, 2.0001);
    this._scaleFactor = scale;

    this._tiles = {};
    TILE_KEYS.forEach((k) => { this._tiles[k] = null; });

    this._config = null;
    this._configMode = null;

    this.setSlices(sliceConfig);
    this._layout();
  }

  getRootGroup() {
    return this.rootGroup;
  }

  setWidth(width) {
    this._width = Math.max(width, 0.0001);
    this._layout();
  }

  setHeight(height) {
    this._height = Math.max(height, 2.0001);
    this._layout();
  }

  setSize(width, height) {
    this._width = Math.max(width, 0.0001);
    this._height = Math.max(height, 2.0001);
    this._layout();
  }

  setScale(scale) {
    this._scaleFactor = scale;
    this._layout();
  }

  getWidth() { return this._width; }
  getHeight() { return this._height; }
  getScale() { return this._scaleFactor; }

  // -----------------------------------------------------------------------
  // PUBLIC API: slice config / materials
  // -----------------------------------------------------------------------

  /**
   * Main config setter (preferred). Same signature style as NineSlice's `setSlices`.
   *
   * Modes:
   *  - array: [top, center, bottom] (exactly 3 entries)
   *  - object: supports keys:
   *      top, center, bottom,
   *      edge/edges (generic for top/bottom),
   *      middle/mid (alias for center)
   */
  setSlices(sliceConfig) {
    if (Array.isArray(sliceConfig)) {
      if (sliceConfig.length !== 3) {
        throw new Error("ThreeSlice array mode requires exactly 3 entries.");
      }
      this._configMode = "array";
      this._config = sliceConfig.slice();
      this._buildFromArray(this._config);
    } else if (typeof sliceConfig === "object") {
      this._configMode = "object";
      // allow partial overrides
      if (this._config && !Array.isArray(this._config)) {
        this._config = Object.assign({}, this._config, sliceConfig);
      } else {
        this._config = Object.assign({}, sliceConfig);
      }
      this._buildFromObject(this._config);
    } else {
      throw new Error("setSlices expects an array of 3 or a config object.");
    }

    this._layout();
  }

  /**
   * Backwards-compatible alias (matches NineSlice).
   */
  setTextures(sliceConfig) {
    this.setSlices(sliceConfig);
  }

  // -----------------------------------------------------------------------
  // PUBLIC API: tile access
  // -----------------------------------------------------------------------

  getTile(name) {
    return this._tiles[name] || null;
  }

  getTop() { return this._tiles.top; }
  getCenter() { return this._tiles.center; }
  getBottom() { return this._tiles.bottom; }

  // Column-style accessor (parallels NineSlice-ish ergonomics)
  get col() {
    const self = this;
    return {
      top() { return self._tiles.top; },
      center() { return self._tiles.center; },
      bottom() { return self._tiles.bottom; }
    };
  }

  dispose() {
    for (const key of TILE_KEYS) {
      const mesh = this._tiles[key];
      if (!mesh) continue;
      this.getRootGroup().remove(mesh);
      if (typeof mesh.dispose === "function") {
        mesh.dispose();
      }
      this._tiles[key] = null;
    }
  }

  // -----------------------------------------------------------------------
  // Internals: normalization + builders
  // -----------------------------------------------------------------------

  _normalizeSliceEntry(value) {
    if (!value) return null;

    // Raw texture → basic material with map
    if (value.isTexture) {
      return {
        matType: "standard",
        matParams: {
          map: value,
          transparent: true
        }
      };
    }

    // String → treat as map texture path
    if (typeof value === "string") {
      value = {
        textures: {
          map: {
            texture: value
          }
        }
      };
    }

    if (typeof value === "object") {
      const matType = value.matType || "basic";
      const nestedParams = value.matParams || {};
      const rest = {};
      for (const k in value) {
        if (k === "matType" || k === "matParams") continue;
        rest[k] = value[k];
      }
      const matParams = Object.assign({}, nestedParams, rest);
      if (matParams.transparent === null || matParams.transparent === undefined) {
        matParams.transparent = true;
      }
      return { matType, matParams };
    }

    return null;
  }

  _buildFromArray(arr) {
    const mapping = {
      top: this._normalizeSliceEntry(arr[0]),
      center: this._normalizeSliceEntry(arr[1]),
      bottom: this._normalizeSliceEntry(arr[2])
    };

    for (const key of TILE_KEYS) {
      const desc = mapping[key];
      this._createOrReplaceTile(key, desc);
    }
  }

  _buildFromObject(config) {
    const get = (k) => (k in config ? config[k] : null);

    const genericEdge = this._normalizeSliceEntry(get("edge") || get("edges"));
    const genericCenter = this._normalizeSliceEntry(
      get("center") || get("middle") || get("mid")
    );

    const mapping = {};

    // Center
    {
      const specificCenter = this._normalizeSliceEntry(get("center") || get("middle") || get("mid"));
      mapping.center = specificCenter || genericCenter || null;
    }

    const assignEdge = (key) => {
      const specific = this._normalizeSliceEntry(get(key));
      if (specific) return specific;
      if (genericEdge) return genericEdge;
      return mapping.center; // fallback
    };

    mapping.top = assignEdge("top");
    mapping.bottom = assignEdge("bottom");

    // Build meshes
    for (const key of TILE_KEYS) {
      const desc = mapping[key];
      this._createOrReplaceTile(key, desc);
    }
  }

  _createOrReplaceTile(key, desc) {
    const existing = this._tiles[key];
    if (existing) {
      this.getRootGroup().remove(existing);
      if (typeof existing.dispose === "function") {
        existing.dispose();
      }
      this._tiles[key] = null;
    }

    if (!desc) return;

    const matType = desc.matType || "basic";
    const matParams = Object.assign({}, desc.matParams || {});
    if (matParams.transparent === null || matParams.transparent === undefined) {
      matParams.transparent = true;
    }

    // 1x1 plane
    const mesh = createPooledMesh("plane", { width: 1, height: 1 }, matType, matParams);

    this.getRootGroup().add(mesh);
    this._tiles[key] = mesh;
  }

  _layout() {
    // Matches NineSlice’s “border is 1 logical unit” assumption, but only vertical.
    const borderH = 1.0;

    const innerHeight = Math.max(this._height - 2 * borderH, 0.0001);

    const hT = borderH;
    const hM = innerHeight;
    const hB = borderH;

    const totalHeight = hT + hM + hB;

    const yTop = totalHeight / 2 - hT / 2;
    const yCenter = 0;
    const yBottom = -totalHeight / 2 + hB / 2;

    const s = this._scaleFactor;
    const w = this._width;

    const setTile = (tile, logicalWidth, logicalHeight, cx, cy) => {
      tile.scale.set(logicalWidth * s, logicalHeight * s, 1);
      tile.position.set(cx * s, cy * s, 0);
    };

    const t = this._tiles;

    if (t.top) setTile(t.top, w, hT, 0, yTop);
    if (t.center) setTile(t.center, w, hM, 0, yCenter);
    if (t.bottom) setTile(t.bottom, w, hB, 0, yBottom);
  }
}

export { ThreeSlice };
