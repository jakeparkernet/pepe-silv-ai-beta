// NestedSubgraph.js
import { Tree } from "../models/Tree.js";
import { Node } from "../models/Node.js";

/**
 * @typedef {Object} NestedTreeViewConfig
 * @property {string} [rootId]       - Where to start traversal. Defaults to tree root.
 * @property {number} [maxDepth]     - Limit depth from rootId (0 = root).
 * @property {(node, depth:number) => boolean} [includeNode]
 *           Additional node filter. Called with (node, relativeDepth).
 */

/**
 * Build a new Tree instance that contains only the nodes/edges
 * specified by NestedTreeViewConfig. This is a *data copy*; the original
 * Tree is untouched.
 */
export function buildSubTree(mainTree, config = {}) {
  const rootId = config.rootId ?? mainTree.getRootId();

  // BFS from rootId over outputs
  const queue = [rootId];
  const seen = new Set([rootId]);
  const depthMap = new Map([[rootId, 0]]);

  while (queue.length) {
    const id = queue.shift();
    const depth = depthMap.get(id) ?? 0;

    if (config.maxDepth != null && depth >= config.maxDepth) {
      continue;
    }

    const node = mainTree.getNode(id);
    if (!node) continue;

    for (const outId of node.outputs) {
      if (seen.has(outId)) continue;
      const outNode = mainTree.getNode(outId);
      if (!outNode) continue;

      const nextDepth = depth + 1;
      depthMap.set(outId, nextDepth);
      seen.add(outId);
      queue.push(outId);
    }
  }

  // Apply includeNode predicate if provided
  const includedIds = new Set();
  for (const id of seen) {
    const node = mainTree.getNode(id);
    if (!node) continue;
    const relDepth = depthMap.get(id) ?? 0;

    if (typeof config.includeNode === "function") {
      if (!config.includeNode(node, relDepth)) continue;
    }

    includedIds.add(id);
  }

  if (!includedIds.size) {
    // at least include the root
    includedIds.add(rootId);
  }

  // Build a new Tree with copies of the included nodes/edges
  const includedNodes = [...includedIds].map((id) => mainTree.getNode(id));

  // Pick a sub-root: use config.rootId if included, otherwise first included
  const subRootNode =
    includedIds.has(rootId) ? mainTree.getNode(rootId) : includedNodes[0];

  const rootCopy = new Node({
    id: subRootNode.id,
    options: subRootNode.options ?? {},
  });
  rootCopy.size = subRootNode.size?.clone?.() ?? subRootNode.size;

  const subTree = new Tree(rootCopy);

  // Add remaining nodes
  for (const node of includedNodes) {
    if (node.id === rootCopy.id) continue;
    const copy = new Node({
      id: node.id,
      options: node.options ?? {},
    });
    copy.size = node.size?.clone?.() ?? node.size;
    subTree.nodes[copy.id] = copy;
  }

  // Recreate edges where both endpoints are included
  for (const edge of Object.values(mainTree.edges)) {
    if (!includedIds.has(edge.from) || !includedIds.has(edge.to)) continue;
    subTree.addEdge(edge.from, edge.to, edge.id, edge.data ?? {});
  }

  return { subTree, includedIds, depthMap };
}
