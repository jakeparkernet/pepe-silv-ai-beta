const RELATIONSHIP_COLORS = [
  "#B22222",
  "#0F766E",
  "#1D4ED8",
  "#7C3AED",
  "#B45309",
  "#BE185D",
  "#166534",
  "#0F172A",
  "#C2410C",
  "#4338CA",
  "#0E7490",
  "#A21CAF"
];

const ROOT_Y_RATIO = 0.76;
const ARTICLE_NODE_SPACING_X = 520;
const FIRST_BRANCH_OFFSET_X = 240;
const SUBJECT_ROOT_OFFSET_X = 160;
const NEWS_ROOT_OFFSET_X = -80;
const SIDE_WIDTH_RATIO = 0.24;
const TREE_HEIGHT_RATIO = 0.56;
const MIN_LEVEL_STEP_X = 170;
const MIN_LEVEL_STEP_Y = 52;

function average(values) {
  if (values.length === 0) {
    return null;
  }

  let total = 0;
  for (let i = 0; i < values.length; i++) {
    total += values[i];
  }
  return total / values.length;
}

class NoCommonOwnerD3Chart {
  constructor({ createNode }) {
    this.createNode = createNode;
  }

  build(articleModel, { width, height }) {
    const nodes = [];
    const links = [];
    const nodeById = new Map();
    const treeRecords = [];

    const addNode = (node) => {
      const existing = nodeById.get(node.id);
      if (existing) {
        return existing;
      }

      node.hoverScale = 1;
      node.targetHoverScale = 1;
      node.membership = new Set();
      node.depths = new Map();
      nodeById.set(node.id, node);
      nodes.push(node);
      return node;
    };

    const addLink = (link) => {
      if (links.some((existing) => existing.id === link.id)) {
        return;
      }

      link.hoverScale = 1;
      link.targetHoverScale = 1;
      link.relationType = link.relationType ?? link.label ?? "relationship";
      links.push(link);
    };

    addNode(this.createNode("article-subject", articleModel.articleSubject, "articleSubject", "Article subject", 52));
    addNode(this.createNode("news-site", articleModel.newsSite, "newsSite", "News site", 52));

    nodeById.get("article-subject").isTargetRoot = true;
    nodeById.get("news-site").isTargetRoot = true;

    addLink({
      id: "news-site-direct-article-subject",
      source: "news-site",
      target: "article-subject",
      label: "wrote about",
      relationType: "wrote about",
      kind: "direct",
      data: {
        relation: "wrote about",
        source: articleModel.newsSite,
        target: articleModel.articleSubject
      }
    });

    treeRecords.push(this.addOwnershipRelationships(addNode, addLink, articleModel.subjectTree, "article-subject", "subject"));
    treeRecords.push(this.addOwnershipRelationships(addNode, addLink, articleModel.newsSiteTree, "news-site", "news"));

    this.assignPreferredPositions(treeRecords.filter(Boolean), nodeById, width, height);

    const relationTypes = Array.from(new Set(links.map((link) => link.relationType))).sort();
    const colorByRelationType = {};
    for (let i = 0; i < relationTypes.length; i++) {
      colorByRelationType[relationTypes[i]] = RELATIONSHIP_COLORS[i % RELATIONSHIP_COLORS.length];
    }

    return {
      nodes,
      links,
      layout: "force",
      forceVariant: "no-common-owner-chart",
      useArcLinks: true,
      colorByRelationType,
      relationTypes,
      newsTopOwnerNodeIds: treeRecords.find((record) => record?.key === "news")?.leafNodeIds ?? [],
      newsTopOwnerTitle: `Top Owners of ${articleModel.newsSite?.name ?? "News Site"}`
    };
  }

  addOwnershipRelationships(addNode, addLink, treeModel, rootId, treeKey) {
    const graph = treeModel?.getUpwardOwnershipGraph?.();
    if (graph == null) {
      return null;
    }

    const normalizedLevels = [[rootId]];
    const childNodeIds = new Set();
    const parentNodeIds = new Set();
    const perNodeIds = new Set();
    const nodesWithNonPerChildren = new Set();

    for (let depth = 1; depth < graph.levels.length; depth++) {
      const level = [];

      for (let i = 0; i < graph.levels[depth].length; i++) {
        const entityId = graph.levels[depth][i];
        const entity = treeModel.getEntityById?.(entityId);

        if (entity?.entity_type === "PER") {
          perNodeIds.add(`entity-${entityId}`);
          continue;
        }

        const nodeId = `entity-${entityId}`;
        const node = addNode(this.createNode(
          nodeId,
          entity,
          "ownerChain",
          "",
          30,
          { entityId }
        ));

        node.membership.add(treeKey);
        node.depths.set(treeKey, depth);
        if (depth === 1) {
          node.isFirstHop = true;
        }
        level.push(nodeId);
      }

      normalizedLevels.push(Array.from(new Set(level)));
    }

    for (let i = 0; i < graph.edges.length; i++) {
      const edge = graph.edges[i];
      const sourceId = `entity-${edge.sourceId}`;
      const targetId = edge.targetId === treeModel?.targetEntity?.id
        ? rootId
        : `entity-${edge.targetId}`;

      if (perNodeIds.has(sourceId) || perNodeIds.has(targetId)) {
        continue;
      }

      const relationType = edge.relationship?.relation ?? "owns";

      addLink({
        id: `${treeKey}-relationship-${edge.relationship?.id ?? `${sourceId}-${targetId}`}`,
        source: sourceId,
        target: targetId,
        label: relationType,
        relationType,
        kind: "chain",
        data: edge.relationship ?? {
          relation: relationType,
          source_entity_id: edge.sourceId,
          target_entity_id: edge.targetId
        },
        treeKey
      });

      parentNodeIds.add(sourceId);
      childNodeIds.add(targetId);
      nodesWithNonPerChildren.add(sourceId);
    }

    const leafNodeIds = Array.from(parentNodeIds).filter((nodeId) =>
      childNodeIds.has(nodeId) === false && nodesWithNonPerChildren.has(nodeId)
    );

    return { key: treeKey, rootId, levels: normalizedLevels, leafNodeIds };
  }

  assignPreferredPositions(treeRecords, nodeById, width, height) {
    const treeDefs = [
      {
        key: "subject",
        rootId: "article-subject",
        anchorX: ((width * 0.5) - (ARTICLE_NODE_SPACING_X * 0.5)) + SUBJECT_ROOT_OFFSET_X,
        anchorY: height * ROOT_Y_RATIO,
        direction: -1
      },
      {
        key: "news",
        rootId: "news-site",
        anchorX: ((width * 0.5) + (ARTICLE_NODE_SPACING_X * 0.5)) + NEWS_ROOT_OFFSET_X,
        anchorY: height * ROOT_Y_RATIO,
        direction: 1
      }
    ];

    for (let i = 0; i < treeDefs.length; i++) {
      const treeDef = treeDefs[i];
      const treeRecord = treeRecords.find((record) => record.key === treeDef.key);
      if (treeRecord == null) {
        continue;
      }

      const orderedLevels = this.orderLevels(treeRecord.levels, treeRecord.key, nodeById);
      const maxDepth = Math.max(1, orderedLevels.length - 1);
      const levelStepX = Math.max((width * SIDE_WIDTH_RATIO) / maxDepth, MIN_LEVEL_STEP_X);
      const usableHeight = Math.max(height * TREE_HEIGHT_RATIO, MIN_LEVEL_STEP_Y);
      const boundaryX = treeDef.anchorX + (FIRST_BRANCH_OFFSET_X * treeDef.direction);

      for (let depth = 0; depth < orderedLevels.length; depth++) {
        const levelIds = orderedLevels[depth];
        const span = Math.max(0, levelIds.length - 1) * MIN_LEVEL_STEP_Y;
        const levelHeight = Math.max(usableHeight, span);
        const startY = treeDef.anchorY - (levelHeight * 0.5);

        for (let index = 0; index < levelIds.length; index++) {
          const node = nodeById.get(levelIds[index]);
          if (node == null) {
            continue;
          }

          const y = levelIds.length === 1
            ? treeDef.anchorY
            : startY + ((levelHeight / (levelIds.length - 1)) * index);
          const horizontalOffset = depth === 0
            ? 0
            : FIRST_BRANCH_OFFSET_X + ((depth - 1) * levelStepX);
          const x = treeDef.anchorX + (horizontalOffset * treeDef.direction);

          if (treeDef.key === "subject") {
            node.preferredXSubject = x;
            node.preferredYSubject = y;
            node.maxAllowedX = boundaryX;
          } else {
            node.preferredXNews = x;
            node.preferredYNews = y;
            node.minAllowedX = boundaryX;
          }
        }
      }
    }

    nodeById.get("article-subject").preferredX = ((width * 0.5) - (ARTICLE_NODE_SPACING_X * 0.5)) + SUBJECT_ROOT_OFFSET_X;
    nodeById.get("article-subject").preferredY = height * ROOT_Y_RATIO;
    nodeById.get("news-site").preferredX = ((width * 0.5) + (ARTICLE_NODE_SPACING_X * 0.5)) + NEWS_ROOT_OFFSET_X;
    nodeById.get("news-site").preferredY = height * ROOT_Y_RATIO;

    for (const node of nodeById.values()) {
      if (node.id === "article-subject" || node.id === "news-site") {
        continue;
      }

      const preferredXs = [node.preferredXSubject, node.preferredXNews].filter((value) => value != null);
      const preferredYs = [node.preferredYSubject, node.preferredYNews].filter((value) => value != null);
      node.preferredX = average(preferredXs) ?? (width * 0.5);
      node.preferredY = average(preferredYs) ?? (height * 0.4);
    }
  }

  orderLevels(levels, treeKey, nodeById) {
    const orderedLevels = levels.map((level) => level.slice());
    const currentRanks = new Map();

    for (let depth = 0; depth < orderedLevels.length; depth++) {
      const level = orderedLevels[depth];
      level.sort((leftId, rightId) => {
        const leftLabel = nodeById.get(leftId)?.label ?? "";
        const rightLabel = nodeById.get(rightId)?.label ?? "";
        return leftLabel.localeCompare(rightLabel);
      });

      for (let index = 0; index < level.length; index++) {
        currentRanks.set(level[index], index);
      }
    }

    for (let depth = 1; depth < orderedLevels.length; depth++) {
      const previousLevel = orderedLevels[depth - 1];
      const previousOrder = new Map(previousLevel.map((id, index) => [id, index]));
      orderedLevels[depth].sort((leftId, rightId) => {
        const leftRank = currentRanks.get(leftId) ?? previousOrder.get(leftId) ?? 0;
        const rightRank = currentRanks.get(rightId) ?? previousOrder.get(rightId) ?? 0;
        return leftRank - rightRank;
      });
    }

    return orderedLevels;
  }
}

export { NoCommonOwnerD3Chart };
