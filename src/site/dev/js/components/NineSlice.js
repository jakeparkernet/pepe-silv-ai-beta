import * as THREE from "three";
import { createPooledMesh } from "../utils/AssetPool.js";

// Canonical tile keys in order
const TILE_KEYS = [
  "topLeft", "top", "topRight",
  "left", "center", "right",
  "bottomLeft", "bottom", "bottomRight"
];

const DEFAULT_SLICE_CONFIG = {
  corner: "resources/corner_10px.png",
  edge: "resources/edge_10px.png",
  center: null
};

class NineSlice {
  constructor(sliceConfig, width = 3, height = 3, scale = 1) {

    if (!sliceConfig) {
      sliceConfig = structuredClone(DEFAULT_SLICE_CONFIG);
    }

    this.rootGroup = new THREE.Group();

    this._width = Math.max(width, 2.0001);
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

  setEdgeWidth (edgeWidth) {
    
  }

  setWidth(width) {
    this._width = Math.max(width, 2.0001);
    this._layout();
  }

  setHeight(height) {
    this._height = Math.max(height, 2.0001);
    this._layout();
  }

  setSize(width, height) {
    this._width = Math.max(width, 2.0001);
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
   * Main config setter (preferred). Same signature as constructor's `sliceConfig`.
   * Rebuilds all tile meshes using createPooledMesh.
   */
  setSlices(sliceConfig) {
    if (Array.isArray(sliceConfig)) {
      if (sliceConfig.length !== 9) {
        throw new Error("NineSlice array mode requires exactly 9 entries.");
      }
      this._configMode = "array";
      this._config = sliceConfig.slice();
      this._buildFromArray(this._config);
    } else if (typeof sliceConfig === "object") {
      this._configMode = "object";
      // merge if already object to allow partial overrides
      if (this._configMode === "object" && this._config && !Array.isArray(this._config)) {
        this._config = Object.assign({}, this._config, sliceConfig);
      } else {
        this._config = Object.assign({}, sliceConfig);
      }
      this._buildFromObject(this._config);
    } else {
      throw new Error("setSlices expects an array of 9 or a config object.");
    }

    this._layout();
  }

  /**
   * Backwards-compatible alias for old name.
   * If you were previously calling setTextures, this still works.
   */
  setTextures(sliceConfig) {
    this.setSlices(sliceConfig);
  }

  // -----------------------------------------------------------------------
  // PUBLIC API: tile access
  // -----------------------------------------------------------------------

  /**
   * Generic lookup by canonical key:
   *   "topLeft", "top", "topRight",
   *   "left", "center", "right",
   *   "bottomLeft", "bottom", "bottomRight"
   */
  getTile(name) {
    return this._tiles[name] || null;
  }

  // Top row
  getTopLeft() { return this._tiles.topLeft; }
  getTopCenter() { return this._tiles.top; }
  getTop() { return this._tiles.top; }        // alias
  getTopRight() { return this._tiles.topRight; }

  // Middle row
  getCenterLeft() { return this._tiles.left; }
  getLeft() { return this._tiles.left; }     // alias

  getCenter() { return this._tiles.center; }

  getCenterRight() { return this._tiles.right; }
  getRight() { return this._tiles.right; }    // alias

  // Bottom row
  getBottomLeft() { return this._tiles.bottomLeft; }
  getBottomCenter() { return this._tiles.bottom; }
  getBottom() { return this._tiles.bottom; }   // alias
  getBottomRight() { return this._tiles.bottomRight; }

  // Row-style: nine.top.left(), nine.centerRow.center(), nine.bottom.right()
  _rowAccessor(rowName) {
    const self = this;
    if (rowName === "top") {
      return {
        left() { return self._tiles.topLeft; },
        center() { return self._tiles.top; },
        right() { return self._tiles.topRight; }
      };
    }
    if (rowName === "middle") {
      return {
        left() { return self._tiles.left; },
        center() { return self._tiles.center; },
        right() { return self._tiles.right; }
      };
    }
    if (rowName === "bottom") {
      return {
        left() { return self._tiles.bottomLeft; },
        center() { return self._tiles.bottom; },
        right() { return self._tiles.bottomRight; }
      };
    }
    return {
      left() { return null; },
      center() { return null; },
      right() { return null; }
    };
  }

  get top() { return this._rowAccessor("top"); }
  get middle() { return this._rowAccessor("middle"); }
  get centerRow() { return this._rowAccessor("middle"); }
  get bottom() { return this._rowAccessor("bottom"); }

  dispose() {
    for (const key of TILE_KEYS) {
      const mesh = this._tiles[key];
      if (!mesh) continue;
      this.getRootGroup().remove(mesh);
      if (typeof mesh.dispose === "function") {
        mesh.dispose(); // releases geometry & material back to pools
      }
      this._tiles[key] = null;
    }
  }

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

    if (typeof value === "string") {
      let convertedVal = {
        textures: {
          map: {
            texture: value
          }
        }
      }

      value = convertedVal;
    }

    if (typeof value === "object") {
      const matType = value.matType || "basic";
      const nestedParams = value.matParams || {};
      // Everything else at top level is merged into matParams
      const rest = {};
      for (const k in value) {
        if (k === "matType" || k === "matParams") continue;
        rest[k] = value[k];
      }
      const matParams = Object.assign({}, nestedParams, rest);
      if (matParams.transparent === undefined) {
        matParams.transparent = true;
      }
      return { matType, matParams };
    }

    return null;
  }

  _buildFromArray(arr) {
    // manual mode: no auto-rotation
    const mapping = {
      topLeft: this._normalizeSliceEntry(arr[0]),
      top: this._normalizeSliceEntry(arr[1]),
      topRight: this._normalizeSliceEntry(arr[2]),
      left: this._normalizeSliceEntry(arr[3]),
      center: this._normalizeSliceEntry(arr[4]),
      right: this._normalizeSliceEntry(arr[5]),
      bottomLeft: this._normalizeSliceEntry(arr[6]),
      bottom: this._normalizeSliceEntry(arr[7]),
      bottomRight: this._normalizeSliceEntry(arr[8])
    };

    for (const key of TILE_KEYS) {
      const desc = mapping[key];
      this._createOrReplaceTile(key, desc, "explicit");
    }
  }

  _buildFromObject(config) {
    const get = (k) => (k in config ? config[k] : null);

    const genericCorner = this._normalizeSliceEntry(
      get("corner") || get("corners")
    );
    const genericEdge = this._normalizeSliceEntry(
      get("edge") || get("edges")
    );
    const genericCenter = this._normalizeSliceEntry(
      get("center") || get("middle") || get("mid")
    );

    const mapping = {};
    const type = {};

    // Center
    (function resolveCenter(self) {
      const specificCenter = self._normalizeSliceEntry(get("center") || get("middle"));
      if (specificCenter) {
        mapping.center = specificCenter;
        type.center = "explicit";
      } else if (genericCenter) {
        mapping.center = genericCenter;
        type.center = "center";
      } else {
        mapping.center = null;
        type.center = "explicit";
      }
    })(this);

    const assignCorner = (key) => {
      const specific = this._normalizeSliceEntry(get(key));
      if (specific) {
        mapping[key] = specific;
        type[key] = "explicit";
      } else if (genericCorner) {
        mapping[key] = genericCorner;
        type[key] = "corner";
      } else if (genericEdge) {
        mapping[key] = genericEdge;
        type[key] = "corner";
      } else {
        mapping[key] = mapping.center;
        type[key] = "corner";
      }
    };

    const assignEdge = (key) => {
      const specific = this._normalizeSliceEntry(get(key));
      if (specific) {
        mapping[key] = specific;
        type[key] = "explicit";
      } else if (genericEdge) {
        mapping[key] = genericEdge;
        type[key] = "edge";
      } else if (genericCorner) {
        mapping[key] = genericCorner;
        type[key] = "edge";
      } else {
        mapping[key] = mapping.center;
        type[key] = "edge";
      }
    };

    // Corners
    assignCorner("topLeft");
    assignCorner("topRight");
    assignCorner("bottomLeft");
    assignCorner("bottomRight");

    // Edges
    assignEdge("top");
    assignEdge("bottom");
    assignEdge("left");
    assignEdge("right");

    // Build meshes
    for (const key of TILE_KEYS) {
      const desc = mapping[key];
      const kind = type[key] || "explicit";
      this._createOrReplaceTile(key, desc, kind);
    }
  }

  _createOrReplaceTile(key, desc, sliceType) {
    // remove old
    const existing = this._tiles[key];
    if (existing) {
      this.getRootGroup().remove(existing);
      if (typeof existing.dispose === "function") {
        existing.dispose(); // returns geometry + material to pools
      }
      this._tiles[key] = null;
    }

    if (!desc) {
      // no tile for this slot
      return;
    }

    const matType = desc.matType || "basic";
    const matParams = Object.assign({}, desc.matParams || {});
    if (matParams.transparent === undefined) {
      matParams.transparent = true;
    }

    // 1x1 plane; pooling handles sharing
    const mesh = createPooledMesh("plane", { width: 1, height: 1 }, matType, matParams);
    mesh.rotation.z = this._getRotationFor(key, sliceType);

    this.getRootGroup().add(mesh);
    this._tiles[key] = mesh;
  }

  _getRotationFor(key, type) {
    if (type === "edge") {
      switch (key) {
        case "top": return 0;
        case "right": return -Math.PI / 2;
        case "bottom": return Math.PI;
        case "left": return Math.PI / 2;
        default: return 0;
      }
    }
    if (type === "corner") {
      switch (key) {
        case "topLeft": return 0;
        case "topRight": return -Math.PI / 2;
        case "bottomRight": return Math.PI;
        case "bottomLeft": return Math.PI / 2;
        default: return 0;
      }
    }
    // center or explicit: no auto-rotation
    return 0;
  }

  _layout() {
    const borderW = 1.0;
    const borderH = 1.0;

    const innerWidth = Math.max(this._width - 2 * borderW, 0.0001);
    const innerHeight = Math.max(this._height - 2 * borderH, 0.0001);

    const wL = borderW;
    const wM = innerWidth;
    const wR = borderW;

    const hT = borderH;
    const hM = innerHeight;
    const hB = borderH;

    const totalWidth = wL + wM + wR;
    const totalHeight = hT + hM + hB;

    const xLeft = -totalWidth / 2 + wL / 2;
    const xCenter = 0;
    const xRight = totalWidth / 2 - wR / 2;

    const yTop = totalHeight / 2 - hT / 2;
    const yCenter = 0;
    const yBottom = -totalHeight / 2 + hB / 2;

    const s = this._scaleFactor;

    const setTile = (tile, logicalWidth, logicalHeight, cx, cy) => {
      tile.scale.set(logicalWidth * s, logicalHeight * s, 1);
      tile.position.set(cx * s, cy * s, 0);
    };

    const t = this._tiles;

    // Top row
    if (t.topLeft) setTile(t.topLeft, wL, hT, xLeft, yTop);
    if (t.top) setTile(t.top, wM, hT, xCenter, yTop);
    if (t.topRight) setTile(t.topRight, wR, hT, xRight, yTop);

    // Middle row
    if (t.left) setTile(t.left, hM, wL, xLeft, yCenter);
    if (t.center) setTile(t.center, wM, hM, xCenter, yCenter);
    if (t.right) setTile(t.right, hM, wR, xRight, yCenter);

    // Bottom row
    if (t.bottomLeft) setTile(t.bottomLeft, wL, hB, xLeft, yBottom);
    if (t.bottom) setTile(t.bottom, wM, hB, xCenter, yBottom);
    if (t.bottomRight) setTile(t.bottomRight, wR, hB, xRight, yBottom);
  }
}

export { NineSlice };
