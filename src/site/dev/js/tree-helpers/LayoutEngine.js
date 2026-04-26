// LayoutEngine.js
// Pure functions for laying out a Tree. No ThreeJS, no side effects.

/**
 * @typedef {Object} LayoutOptions
 * @property {string[]} rootIds      - root node ids to start from
 * @property {function(string): {w:number, h:number}} nodeMetrics - size provider
 * @property {function(string): boolean} [includeNode] - filter which nodes to include
 * @property {number} [levelGap]  - vertical spacing between levels (depth)
 * @property {number} [nodeGap]   - horizontal spacing between siblings
 */

/**
 * Canonical 2D tree layout (x = lateral, y = depth).
 * Returns Map<nodeId, {x, y}> with root(s) centered around x=0, y=0.
 *
 * - Works on any Tree-like structure via tree.childrenOf(nodeId).
 * - Respects includeNode for slicing / clusters.
 */
export function layoutTree(tree, options) {
  if (!tree) throw new Error("layoutTree requires a Tree instance");

  const rootIds = (options && options.rootIds) || tree.getRootIds();
  const nodeMetrics = options && options.nodeMetrics
    ? options.nodeMetrics
    : function () { return { w: 1, h: 1 }; };

  const levelGap = options && typeof options.levelGap === "number"
    ? options.levelGap
    : 4.0;

  const nodeGap = options && typeof options.nodeGap === "number"
    ? options.nodeGap
    : 2.0;

  const includeNode = options && typeof options.includeNode === "function"
    ? options.includeNode
    : function () { return true; };

  /** @type {Map<string, number>} */
  const depthMap = new Map();
  /** @type {Map<number, string[]>} */
  const levels = new Map();

  // --- 1) BFS to assign depths and build levels ----------------------------

  const queue = [];
  for (let i = 0; i < rootIds.length; i++) {
    const rid = rootIds[i];
    if (!includeNode(rid)) continue;
    depthMap.set(rid, 0);
    queue.push(rid);
    if (!levels.has(0)) levels.set(0, []);
    levels.get(0).push(rid);
  }

  while (queue.length > 0) {
    const nid = queue.shift();
    const depth = depthMap.get(nid) || 0;
    const children = tree.childrenOf(nid) || [];
    for (let i = 0; i < children.length; i++) {
      const cid = children[i];
      if (!includeNode(cid)) continue;
      if (depthMap.has(cid)) continue; // already assigned (DAG)
      const childDepth = depth + 1;
      depthMap.set(cid, childDepth);
      queue.push(cid);

      if (!levels.has(childDepth)) levels.set(childDepth, []);
      levels.get(childDepth).push(cid);
    }
  }

  // There may be nodes not reachable from the given roots but includedNode=true.
  // We ignore those for now; they won't be laid out in this pass.

  // --- 2) For each level, assign lateral positions -------------------------

  /** @type {Map<string, {x:number, y:number}>} */
  const positions = new Map();

  const depths = Array.from(levels.keys()).sort(function (a, b) { return a - b; });

  for (let dIdx = 0; dIdx < depths.length; dIdx++) {
    const depth = depths[dIdx];
    const ids = levels.get(depth);
    if (!ids || !ids.length) continue;

    // Total width for this level
    let totalWidth = 0;
    const widths = [];
    for (let i = 0; i < ids.length; i++) {
      const m = nodeMetrics(ids[i]) || { w: 1, h: 1 };
      const w = typeof m.w === "number" ? m.w : 1;
      widths.push(w);
      totalWidth += w;
    }

    const gaps = nodeGap * (ids.length - 1);
    totalWidth += gaps;

    // Center around x=0
    let cursorX = -totalWidth / 2;

    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      const w = widths[i];

      const centerX = cursorX + w / 2;
      const centerY = depth * levelGap;

      positions.set(id, { x: centerX, y: centerY });

      cursorX += w + nodeGap;
    }
  }

  return positions;
}
