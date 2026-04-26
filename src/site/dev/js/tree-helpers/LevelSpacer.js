// LevelSpacer.js
// Greedy pass that advances each level forward along the spline until its LevelBand
// does not intersect any earlier level bands. Returns { levelTs, placements }.

import * as THREE from "three";
import { LevelBand } from "./LevelBand.js";

class LevelSpacer {
  constructor(spline, params = {}) {
    this.spline = spline; // SplineChain instance
    this.params = {
      levelGap: params.levelGap ?? 2,     // desired distance along spline between levels
      nodeGap: params.nodeGap ?? 1.2,       // lateral gap between siblings (normal axis)
      bandThickness: params.bandThickness ?? 0.8, // thickness of OBB along tangent
      bandMargin: params.bandMargin ?? 0.2,       // padding around each level band
      searchStep: params.searchStep ?? 0.25       // incremental forward step when resolving overlaps
    };
  }

  _rowWidth(tree, ids, fallbackW = 1.0) {
    const widths = ids.map(id => tree.getNode(id).width ?? fallbackW);
    const gaps = Math.max(0, ids.length - 1) * this.params.nodeGap;
    return widths.reduce((a, b) => a + b, 0) + gaps;
  }

  layout(tree, levels, getNodeSize = (n, defW, defH) => ({
    w: n.width ?? defW,
    h: n.height ?? defH
  }), defW = 1.0, defH = 0.6) {

    const L = Math.max(1e-6, this.spline.getLength(800));
    const advanceByDist = (t, d) => this.spline.advanceByDistance(t, d, 800);

    // Initial t for level 0 placed slightly inside the curve (no hard dependency on padStart).
    let t = Math.min(0.98, Math.max(0.0, (this.params.levelGap / L)));
    const levelTs = [];
    const levelBands = [];

    for (let li = 0; li < levels.length; li++) {
      // target t based on desired spacing
      if (li > 0) t = advanceByDist(levelTs[li - 1], this.params.levelGap);

      // compute local frame
      const base = this.spline.getPoint(t);
      const tan = this.spline.getTangent(t);
      const nrm = new THREE.Vector3(-tan.y, tan.x, 0).normalize();

      const rowIds = levels[li];
      const rowW = this._rowWidth(tree, rowIds, defW);

      // create a band for this level
      const band = new LevelBand(base, tan, nrm, rowW, this.params.bandThickness, this.params.bandMargin);

      // resolve overlaps against all previous level bands
      let safety = 0, maxIt = 200;
      while (levelBands.some(prev => band.intersects(prev))) {
        t = advanceByDist(t, this.params.searchStep);
        const newBase = this.spline.getPoint(t);
        band.center.copy(newBase);
        if (++safety > maxIt) break; // fail-safe
      }

      levelTs.push(t);
      levelBands.push(band);
    }

    // With final per-level t positions, place nodes laterally across each level’s normal
    const placements = [];
    for (let li = 0; li < levels.length; li++) {
      const ids = levels[li];
      const tLevel = levelTs[li];

      const base = this.spline.getPoint(tLevel);
      const tangent = this.spline.getTangent(tLevel);
      const normal = new THREE.Vector3(-tangent.y, tangent.x, 0).normalize();

      const widths = ids.map(id => getNodeSize(tree.getNode(id), defW, defH).w);
      const heights = ids.map(id => getNodeSize(tree.getNode(id), defW, defH).h);
      const rowW = this._rowWidth(tree, ids, defW);

      let left = -rowW / 2;
      for (let k = 0; k < ids.length; k++) {
        const node = tree.getNode(ids[k]);
        const w = widths[k], h = heights[k];
        const off = left + w / 2;
        left += w + this.params.nodeGap;

        const pos = base.clone().add(normal.clone().multiplyScalar(off));
        pos.z = -li * 0.001;

        placements.push({
          id: node.id,
          node,
          pos,
          w, h,
          tangent, normal
        });
      }
    }

    return { levelTs, placements };
  }
}

export { LevelSpacer };
