// layoutCore.js
import * as THREE from "three";

/**
 * Helper: get a node's visual size as a Vector3, with sensible defaults.
 */
export function getNodeSize(nodeView, {
  defaultW = 1.0,
  defaultH = 0.6,
} = {}) {
  if (nodeView && typeof nodeView.getSize === "function") {
    const size = nodeView.getSize();
    if (size instanceof THREE.Vector3) {
      return size;
    }
  }
  return new THREE.Vector3(defaultW, defaultH, 0);
}

/**
 * For each level, re-space nodes so that horizontally (along lateralDir)
 * they have equal edge-to-edge gaps, based on *visual* size.
 *
 * levelsByDepth: array of { depth, nodes: Map<id, layoutNode> }
 * getNodeView:   (id) => nodeView
 */
export function applyEqualEdgeSpacingToLevels(levelsByDepth, {
  getNodeView,
  lateralDir,
  nodeGap,
  defaultW = 1.0,
  defaultH = 0.6,
}) {
  const EPS = 1e-6;
  const dx = Math.abs(lateralDir.x);
  const dy = Math.abs(lateralDir.y);

  for (const level of levelsByDepth) {
    const logicalNodes = [...level.nodes.values()];
    if (!logicalNodes.length) continue;

    // Sort by current logicalX to preserve left→right order
    logicalNodes.sort((a, b) => (a.logicalX ?? 0) - (b.logicalX ?? 0));

    // Compute half-span along lateralDir for each node
    const infos = logicalNodes.map((ln) => {
      const nodeView = getNodeView(ln.id);
      const size = getNodeSize(nodeView, { defaultW, defaultH });
      const w = size.x;
      const h = size.y;

      let halfLen;
      if (dx < EPS && dy < EPS) {
        halfLen = Math.max(w, h) * 0.5;
      } else {
        const tx = dx > EPS ? (w * 0.5) / dx : Infinity;
        const ty = dy > EPS ? (h * 0.5) / dy : Infinity;
        halfLen = Math.min(tx, ty);
      }

      return { ln, halfLen };
    });

    if (infos.length === 1) {
      infos[0].ln.logicalX = infos[0].halfLen;
      continue;
    }

    // Equal edge spacing:
    // center[i+1] = center[i] + half[i] + gap + half[i+1]
    let cursor = infos[0].halfLen;
    infos[0].ln.logicalX = cursor;

    for (let i = 1; i < infos.length; i++) {
      const prev = infos[i - 1];
      const curr = infos[i];

      cursor = cursor + prev.halfLen + nodeGap + curr.halfLen;
      curr.ln.logicalX = cursor;
    }
  }
}

/**
 * Center each level horizontally in logical space, and keep relative
 * alignment between levels (so they don't jump around).
 *
 * Mutates ln.logicalX in-place.
 */
export function centerLevelsLaterally(levelsByDepth) {
  let prevCenterX = null;

  for (const level of levelsByDepth) {
    const logicalNodes = [...level.nodes.values()];
    if (!logicalNodes.length) continue;

    let minX = Infinity;
    let maxX = -Infinity;
    for (const ln of logicalNodes) {
      if (ln.logicalX < minX) minX = ln.logicalX;
      if (ln.logicalX > maxX) maxX = ln.logicalX;
    }

    let centerX = (minX + maxX) / 2;
    if (prevCenterX != null) {
      const offsetX = prevCenterX - centerX;
      for (const ln of logicalNodes) ln.logicalX += offsetX;
      minX += offsetX;
      maxX += offsetX;
      centerX = (minX + maxX) / 2;
    }
    prevCenterX = centerX;
  }
}

/**
 * For each level, compute a half-span along depthDir based on node visual sizes.
 *
 * Returns: Map<depth, halfSpan>
 */
export function computeLevelHalfSpans(levelsByDepth, {
  getNodeView,
  depthDir,
  defaultW = 1.0,
  defaultH = 0.6,
}) {
  const levelHalfSpans = new Map();
  const EPS = 1e-6;
  const dx = Math.abs(depthDir.x);
  const dy = Math.abs(depthDir.y);

  for (const level of levelsByDepth) {
    const logicalNodes = [...level.nodes.values()];
    if (!logicalNodes.length) {
      levelHalfSpans.set(level.depth, 0);
      continue;
    }

    let maxHalfSpan = 0;

    for (const ln of logicalNodes) {
      const nodeView = getNodeView(ln.id);
      const size = getNodeSize(nodeView, { defaultW, defaultH });
      const w = size.x;
      const h = size.y;

      let halfLen;
      if (dx < EPS && dy < EPS) {
        halfLen = Math.max(w, h) * 0.5;
      } else {
        const tx = dx > EPS ? (w * 0.5) / dx : Infinity;
        const ty = dy > EPS ? (h * 0.5) / dy : Infinity;
        halfLen = Math.min(tx, ty);
      }

      if (halfLen > maxHalfSpan) maxHalfSpan = halfLen;
    }

    levelHalfSpans.set(level.depth, maxHalfSpan);
  }

  return levelHalfSpans;
}

/**
 * Given per-level half-spans, compute a center depth coordinate for each level,
 * so that levels are separated by levelGap plus their half-spans.
 *
 * Returns: Map<depth, depthCenter>
 */
export function computeLevelDepthCenters(levelsByDepth, levelHalfSpans, {
  levelGap,
}) {
  const depthCenters = new Map();

  if (!levelsByDepth.length) return depthCenters;

  const sorted = [...levelsByDepth].sort((a, b) => a.depth - b.depth);

  // Start the first level at depth 0
  let prevDepth = sorted[0].depth;
  let prevCenter = 0;
  let prevSpan = levelHalfSpans.get(prevDepth) ?? 0;
  depthCenters.set(prevDepth, prevCenter);

  for (let i = 1; i < sorted.length; i++) {
    const level = sorted[i];
    const depth = level.depth;
    const currSpan = levelHalfSpans.get(depth) ?? 0;

    const center = prevCenter + prevSpan + levelGap + currSpan;
    depthCenters.set(depth, center);

    prevDepth = depth;
    prevCenter = center;
    prevSpan = currSpan;
  }

  return depthCenters;
}

/**
 * Compute final world positions for all layout nodes, given depth centers and basis.
 *
 * Returns: Map<nodeId, THREE.Vector3>
 */
export function buildWorldPositions(levelsByDepth, depthCenters, {
  lateralDir,
  depthDir,
}) {
  const positions = new Map();

  for (const level of levelsByDepth) {
    const depthCenter = depthCenters.get(level.depth) ?? 0;
    const logicalNodes = [...level.nodes.values()];

    for (const ln of logicalNodes) {
      const pos = new THREE.Vector3()
        .addScaledVector(lateralDir, ln.logicalX)
        .addScaledVector(depthDir, depthCenter);
      positions.set(ln.id, pos);
    }
  }

  return positions;
}

/**
 * Map a subset of layout nodes (logicalX + depthIndex) into a local
 * rectangle coordinate system, preserving the "shape" of the layout.
 *
 * children: Array<{ layoutNode, logicalX, depthIndex }>
 *
 * Returns: Map<layoutNode, { localX, localY }>
 *   - localX, localY are in a coordinate system where:
 *       X: [-rectWidth/2, +rectWidth/2]
 *       Y: [+rectHeight/2 (top), -rectHeight/2 (bottom)]
 */
export function mapLogicalSubsetToRect(children, rectWidth, rectHeight) {
  const result = new Map();
  if (!children || children.length === 0) return result;

  let minX = Infinity;
  let maxX = -Infinity;
  let minDepth = Infinity;
  let maxDepth = -Infinity;

  for (const { logicalX, depthIndex } of children) {
    const lx = typeof logicalX === "number" ? logicalX : 0;
    const d = typeof depthIndex === "number" ? depthIndex : 0;

    if (lx < minX) minX = lx;
    if (lx > maxX) maxX = lx;
    if (d < minDepth) minDepth = d;
    if (d > maxDepth) maxDepth = d;
  }

  if (!Number.isFinite(minX) || !Number.isFinite(maxX)) {
    minX = -0.5;
    maxX = 0.5;
  }
  if (!Number.isFinite(minDepth) || !Number.isFinite(maxDepth)) {
    minDepth = 0;
    maxDepth = 1;
  }

  let logicalWidth = maxX - minX;
  let logicalHeight = maxDepth - minDepth;

  if (logicalWidth <= 0) logicalWidth = 1;
  if (logicalHeight <= 0) logicalHeight = 1;

  for (const entry of children) {
    const { layoutNode, logicalX, depthIndex } = entry;
    const lx = typeof logicalX === "number" ? logicalX : 0;
    const d = typeof depthIndex === "number" ? depthIndex : 0;

    const nx = (lx - minX) / logicalWidth;      // 0..1
    const ny = (d - minDepth) / logicalHeight;  // 0..1

    const localX = -rectWidth / 2 + nx * rectWidth;
    const localY = rectHeight / 2 - ny * rectHeight;

    result.set(layoutNode, { localX, localY });
  }

  return result;
}
