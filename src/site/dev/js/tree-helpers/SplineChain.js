// SplineChain.js
// Drop-in update: `append()` now auto-smooths joins by referencing the previous
// points and inserting a "shoulder" knot derived from the last segment direction.
// Result: C¹-looking join even when the first point of the new chunk does NOT
// repeat the previous last point.

import * as THREE from "three";

class SplineChain {
  constructor(points = [], { type = "centripetal", tension = 0.5 } = {}) {
    this.points = [];
    this.type = type;       // "centripetal" avoids loops/kinks
    this.tension = tension; // used only for type "catmullrom"

    this.curve = new THREE.CatmullRomCurve3(this.points, false, this.type, this.tension);
    if (points.length) this.append(points);
  }

  /**
   * Append one or many points.
   * Auto-smoothing rules:
   *  - If new chunk doesn't start at the current tail, insert a "shoulder"
   *    point: S = P_last + blend * (P_last - P_prev).
   *  - If we only have one existing point (no direction yet), just stitch.
   *  - Duplicate anchors are skipped.
   * @param {THREE.Vector3[]|THREE.Vector3} newPoints
   * @param {object} [opts]
   * @param {number} [opts.blend=0.3]   // shoulder distance as fraction of last segment length
   * @param {number} [opts.eps=1e-12]   // duplicate threshold
   */
  append(newPoints, opts = {}) {
    const pts = Array.isArray(newPoints) ? newPoints : [newPoints];
    const blend = opts.blend ?? 0.3;
    const eps = opts.eps ?? 1e-12;
    if (!pts.length) return;

    // Nothing in the chain yet
    if (this.points.length === 0) {
      for (const p of pts) this.points.push(p.clone());
      this.curve.points = this.points;
      return;
    }

    // We already have at least one point
    const last = this.points[this.points.length - 1];
    const firstNew = pts[0];

    // If caller repeated the last point, skip it to avoid zero span
    let startIdx = 0;
    if (firstNew.distanceToSquared(last) <= eps) startIdx = 1;

    // If we have >=2 existing points and the first new point is different,
    // insert a shoulder knot using the previous direction to keep continuity.
    if (startIdx === 0 && this.points.length >= 2) {
      const prev = this.points[this.points.length - 2];
      const dir = last.clone().sub(prev); // last segment direction
      const shoulder = last.clone().add(dir.multiplyScalar(blend));
      // Only add if it meaningfully differs from `last`
      if (shoulder.distanceToSquared(last) > eps) this.points.push(shoulder);
    }

    // Append all remaining new points (skipping the duplicate anchor if present)
    for (let i = startIdx; i < pts.length; i++) {
      const p = pts[i];
      // Avoid accidental duplicates inside the chunk
      if (p.distanceToSquared(this.points[this.points.length - 1]) <= eps) continue;
      this.points.push(p.clone());
    }

    this.curve.points = this.points;
  }

  // Replace last N points (handy if you want to re-blend a tail)
  replaceTail(count, newPoints) {
    const c = Math.max(0, Math.min(count, this.points.length));
    this.points.splice(this.points.length - c, c, ...newPoints.map(p => p.clone()));
    this.curve.points = this.points;
  }

  getPoint(t)   { return this.curve.getPoint(t); }
  getTangent(t) { return this.curve.getTangent(t); }
  getLength(divs = 400) {
    const L = this.curve.getLengths(divs);
    return L[L.length - 1] || 0;
  }

  // Arc-length-ish advance using sampling + binary search
  advanceByDistance(fromT, dist, divs = 800) {
    const lengths = this.curve.getLengths(divs);
    const total   = lengths[lengths.length - 1] || 0;
    if (total <= 0) return fromT;

    const want = Math.min(total, fromT * total + dist);
    let lo = 0, hi = lengths.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (lengths[mid] < want) lo = mid + 1; else hi = mid;
    }
    return Math.min(1, lo / divs);
  }
}

export { SplineChain };
