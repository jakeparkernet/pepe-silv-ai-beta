// LevelBand.js
// A per-level oriented rectangle (OBB) used to space levels along a spline.
// Projects node widths across the local normal and assigns a small thickness along the tangent.

import * as THREE from "three";

class LevelBand {
  constructor(center, tangent, normal, width, thickness = 0.6, margin = 0.2) {
    this.center = center.clone();
    this.tangent = tangent.clone().normalize();
    this.normal = normal.clone().normalize();
    this.width = width;           // span along `normal`
    this.thickness = thickness;   // span along `tangent`
    this.margin = margin;         // extra outward padding
  }

  halfW() { return (this.width / 2) + this.margin; }
  halfT() { return (this.thickness / 2) + this.margin; }

  corners() {
    const ux = this.tangent, uy = this.normal;
    const a = ux.clone().multiplyScalar(+this.halfT());
    const b = uy.clone().multiplyScalar(+this.halfW());
    // CCW: (+t,+n) -> (+t,-n) -> (-t,-n) -> (-t,+n)
    return [
      this.center.clone().add(a).add(b),
      this.center.clone().add(a).sub(b),
      this.center.clone().sub(a).sub(b),
      this.center.clone().sub(a).add(b),
    ];
  }

  translateAlongTangent(d) {
    this.center.add(this.tangent.clone().multiplyScalar(d));
    return this;
  }

  // --- 2D SAT overlap in XY-plane on the axes of both rectangles (tangent & normal) ---
  _projectOntoAxis(points, axis) {
    let min = Infinity, max = -Infinity;
    for (const p of points) {
      const v = p.x * axis.x + p.y * axis.y; // z ignored (2D view)
      if (v < min) min = v;
      if (v > max) max = v;
    }
    return { min, max };
  }

  _overlap1D(a, b) {
    return !(a.max < b.min || b.max < a.min);
  }

  intersects(other) {
    const A = this.corners();
    const B = other.corners();
    const axes = [
      this.tangent, this.normal,
      other.tangent, other.normal
    ];
    for (const ax of axes) {
      const pa = this._projectOntoAxis(A, ax);
      const pb = this._projectOntoAxis(B, ax);
      if (!this._overlap1D(pa, pb)) return false; // separated
    }
    return true;
  }
}

export { LevelBand };
