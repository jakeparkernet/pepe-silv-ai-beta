// debug/CurveDebug.js
// Minimal helpers to visualize the spline as a line and its sampled points.

import * as THREE from "three";

class CurveDebug {
  static build(spline, { segments = 200, pointEvery = 12 } = {}) {
    const group = new THREE.Group();

    // polyline along the spline
    const pts = [];
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      pts.push(spline.getPoint(t));
    }
    const lineGeo = new THREE.BufferGeometry().setFromPoints(pts);
    const lineMat = new THREE.LineBasicMaterial({ transparent: true, opacity: 0.6 });
    group.add(new THREE.Line(lineGeo, lineMat));

    // sampled points (tiny spheres) to see distribution
    const ballGeo = new THREE.SphereGeometry(0.01, 12, 12);
    const ballMat = new THREE.MeshBasicMaterial({ color: 0xffaa00 });
    for (let i = 0; i <= segments; i += pointEvery) {
      const t = i / segments;
      const p = spline.getPoint(t);
      const m = new THREE.Mesh(ballGeo, ballMat);
      m.position.copy(p);
      group.add(m);
    }

    return group;
  }
}

export { CurveDebug };
