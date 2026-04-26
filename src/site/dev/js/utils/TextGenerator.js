// TextGenerator.js
// Pure ES6 + Three.js only – no external dependencies
// Static class with module-scoped private state (the modern, correct way)

import * as THREE from 'three';
import { FontLoader } from 'three/addons/loaders/FontLoader.js';
import { TextGeometry } from 'three/addons/geometries/TextGeometry.js';
import { MaterialPool } from './AssetPool.js';

// ─────────────────────────────────────────────────────────────────────────────
// Private module state
// ─────────────────────────────────────────────────────────────────────────────
const fontCache = new Map();        // url|string → THREE.Font
const pendingQueues = new Map();    // url → { promise, queue: Array<Function> }
const loader = new FontLoader();

// ─────────────────────────────────────────────────────────────────────────────
// Core private helpers
// ─────────────────────────────────────────────────────────────────────────────
function ensureFontLoaded(fontIdentifier) {
  // Allow both full URLs and short names that map to bundled fonts
  const url = resolveFontURL(fontIdentifier);

  if (fontCache.has(url)) {
    return Promise.resolve(fontCache.get(url));
  }

  if (pendingQueues.has(url)) {
    return pendingQueues.get(url).promise;
  }

  const promise = new Promise((resolve, reject) => {
    loader.load(
      url,
      (font) => {
        fontCache.set(url, font);
        const { queue } = pendingQueues.get(url);
        pendingQueues.delete(url);

        // Resolve all waiting requests
        queue.forEach((callback) => callback(font));
        resolve(font);
      },
      undefined, // onProgress (optional)
      (err) => {
        pendingQueues.delete(url);
        console.error(`TextGenerator: Failed to load font "${url}"`, err);
        reject(err);
        // Still notify queue about failure
        const { queue } = pendingQueues.get(url) || { queue: [] };
        queue.forEach((cb) => cb(null));
      }
    );
  });

  pendingQueues.set(url, { promise, queue: [] });
  return promise;
}

function resolveFontURL(identifier) {
  // Built-in Three.js fonts (shipped with examples)
  const builtIn = {
    helvetiker: 'https://unpkg.com/three@0.168.0/examples/fonts/helvetiker_regular.typeface.json',
    gentilis: 'https://unpkg.com/three@0.168.0/examples/fonts/gentilis_regular.typeface.json',
    optimer: 'https://unpkg.com/three@0.168.0/examples/fonts/optimer_regular.typeface.json',
    droid: 'https://unpkg.com/three@0.168.0/examples/fonts/droid/droid_sans_regular.typeface.json',
    kenpixel: 'https://cdn.jsdelivr.net/gh/mrdoob/three.js@dev/examples/fonts/kenpixel_regular.typeface.json',
  };

  if (builtIn[identifier]) return builtIn[identifier];
  if (identifier.startsWith('http') || identifier.startsWith('/') || identifier.startsWith('./')) {
    return identifier;
  }
  // Fallback – assume it's a full URL or local path
  return identifier;
}

// ─────────────────────────────────────────────────────────────────────────────
// TextGenerator – fully static class
// ─────────────────────────────────────────────────────────────────────────────
export class TextGenerator {
  /**
   * Main method – synchronously returns a Group you can add immediately
   */
  static getTextObject(options = {}) {
    const defaults = {
      text: '',
      font: './resources/fonts/roboto_regular.json',           // short name or full URL
      size: 0.05,
      depth: 0.002,
      curveSegments: 12,
      bevelEnabled: false,
      bevelThickness: 0.05,
      bevelSize: 0.02,
      bevelSegments: 5,
      materialType: 'basic',
      materialParams: null,
      outline: false,
      outlineMaterialType: 'basic',
      outlineMaterialParams: null,
      center: true,
      outline: false,               // true or color
      onReady: null,                // (group, mesh) => {}
    };

    const opts = { ...defaults, ...options };
    const group = new THREE.Group();

    // Store options for future updates
    group.userData.__textGeneratorOptions = opts;
    group.userData.__textReady = false;

    // Kick off font load + population
    ensureFontLoaded(opts.font)
      .then((font) => {
        if (font) this._populateGroup(group, font);
        else this._handleFontError(group);
      })
      .catch(() => this._handleFontError(group));

    return group;
  }

  /**
   * Change text after creation (e.g. score counter, dynamic labels)
   */
  static updateText(group, newText, newOptions = {}) {
    if (group?.userData?.__textGeneratorOptions == null) return;

    const opts = group.userData.__textGeneratorOptions;
    opts.text = newText;
    Object.assign(opts, newOptions);

    ensureFontLoaded(opts.font).then((font) => {
      if (font) this._populateGroup(group, font);
    });
  }

  /**
   * Pre-warm a font (great for loading screens)
   */
  static preloadFont(fontIdentifier) {
    return ensureFontLoaded(fontIdentifier);
  }

  /**
   * Debug / hot-reload helper
   */
  static clearCache() {
    fontCache.clear();
    pendingQueues.clear();
  }

  static _clearGroupAndReleaseResources(group) {
    const seenGeometries = new Set();

    for (const child of group.children) {
      if (child.isMesh) {
        const geo = child.geometry;
        if (geo && !seenGeometries.has(geo)) {
          if (typeof geo.dispose === 'function') {
            geo.dispose();
          }
          seenGeometries.add(geo);
        }

        const mat = child.material;
        if (Array.isArray(mat)) {
          for (const m of mat) {
            MaterialPool.release(m);
          }
        } else if (mat) {
          MaterialPool.release(mat);
        }
      }
    }

    group.clear();
    if (group.userData) {
      delete group.userData.__textMesh;
    }
  }

  static _getMainMaterial(opts) {
    // If user passed an explicit THREE.Material, use it as-is (no pooling).
    if (opts.material && opts.material.isMaterial) {
      return opts.material;
    }

    // Build pooled material params:
    const type = opts.materialType || 'basic';

    let params = {};
    if (opts.materialParams && typeof opts.materialParams === 'object') {
      params = { ...opts.materialParams };
    } else if (typeof opts.material === 'number') {
      // Legacy: material as color number
      params = { color: opts.material };
    } else {
      // Default white
      params = { color: 0xffffff };
    }

    // Use a shallow clone so MaterialPool.getMaterial can safely mutate params (e.g. delete textures)
    return MaterialPool.getMaterial(type, { ...params });
  }

  static _getOutlineMaterial(opts) {
    if (!opts.outline) return null;

    const type = opts.outlineMaterialType || 'basic';

    let params = {
      side: THREE.BackSide,
    };

    // Base params from outlineMaterialParams if provided
    if (opts.outlineMaterialParams && typeof opts.outlineMaterialParams === 'object') {
      params = { ...params, ...opts.outlineMaterialParams };
    }

    // outline: true → default black
    // outline: number → color override
    if (opts.outline === true) {
      if (!('color' in params)) {
        params.color = 0x000000;
      }
    } else {
      // assume a color (number or THREE.Color-like accepted by Three)
      params.color = opts.outline;
    }

    return MaterialPool.getMaterial(type, { ...params });
  }

  static _populateGroup(group, font) {
    const opts = group.userData.__textGeneratorOptions;

    // Remove previous content & release resources
    this._clearGroupAndReleaseResources(group);

    if (!opts.text) {
      group.userData.__textReady = true;
      return;
    }

    const geometry = new TextGeometry(opts.text, {
      font,
      size: opts.size,
      depth: opts.depth,
      curveSegments: opts.curveSegments,
      bevelEnabled: opts.bevelEnabled,
      bevelThickness: opts.bevelThickness,
      bevelSize: opts.bevelSize,
      bevelSegments: opts.bevelSegments,
    });

    geometry.computeBoundingBox();
    geometry.computeVertexNormals();

    // Main material (pooled when using AssetPool-style params)
    const material = this._getMainMaterial(opts);

    const mesh = new THREE.Mesh(geometry, material);

    // Centering
    if (opts.center && geometry.boundingBox) {
      const box = geometry.boundingBox;
      const offsetX = -0.5 * (box.max.x - box.min.x);
      const offsetY = -0.5 * (box.max.y - box.min.y);
      mesh.position.set(offsetX, offsetY, 0);
    }

    // Outline (pooled material if using outlineMaterialType/outlineMaterialParams)
    if (opts.outline) {
      const outlineMat = this._getOutlineMaterial(opts);
      if (outlineMat) {
        const outlineMesh = new THREE.Mesh(geometry, outlineMat);
        outlineMesh.scale.multiplyScalar(1.05 + (opts.size > 3 ? 0.02 : 0));
        outlineMesh.position.copy(mesh.position);
        group.add(outlineMesh);
      }
    }

    group.add(mesh);
    group.userData.__textMesh = mesh;
    group.userData.__textReady = true;

    if (typeof opts.onReady === 'function') {
      requestAnimationFrame(() => opts.onReady(group, mesh));
    }
  }

  static _handleFontError(group) {
    group.clear();
    console.warn('TextGenerator: Font failed – showing fallback placeholder');
    const geo = new THREE.PlaneGeometry(2, 1);
    const mat = new THREE.MeshBasicMaterial({ color: 0xff0066, transparent: true, opacity: 0.8 });
    const mesh = new THREE.Mesh(geo, mat);
    group.add(mesh);
    group.userData.__textReady = true;
  }
}