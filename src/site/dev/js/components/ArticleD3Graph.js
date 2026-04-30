// import { NoCommonOwnerD3Chart } from "./NoCommonOwnerD3Chart.js";
// 
const appModules = window[`apps_${performance.timeOrigin}`].modules;
const { NoCommonOwnerD3Chart } = appModules.components.NoCommonOwnerD3Chart;

const DEFAULT_GRAPH_WIDTH = 1200;
const DEFAULT_GRAPH_HEIGHT = 800;
const NODE_LABEL_PADDING_X = 14;
const NODE_LABEL_PADDING_Y = 10;
const NODE_EDGE_CLEARANCE = 30;
const LINK_LABEL_PADDING_X = 10;
const LINK_LABEL_PADDING_Y = 6;
const LINK_LABEL_OFFSET = 40;
const CHAIN_LINK_DISTANCE = 320;
const DIRECT_LINK_DISTANCE = 420;
const MIN_CHAIN_EDGE_LENGTH = 260;
const MIN_DIRECT_EDGE_LENGTH = 340;
const PRIMARY_NODE_REPULSION = -2600;
const SECONDARY_NODE_REPULSION = -1800;
const D3_MIN_SCALE = 0.8;
const D3_MAX_SCALE = 1.6;
const D3_PAN_MARGIN = 500000;
const NODE_HOVER_BRIGHTNESS = 1.12;
const LINK_HOVER_BRIGHTNESS = 1.22;
const NODE_HOVER_SCALE = 1.08;
const LINK_HOVER_SCALE = 1.12;
const HOVER_SCALE_LERP = 0.28;
const DIMMED_COLOR = "#9ca3af";

function brightenColor(color, factor = 1.1) {
  const parsed = window.d3.color(color);
  if (parsed == null) {
    return color;
  }

  const hsl = window.d3.hsl(parsed);
  hsl.l = Math.min(1, hsl.l * factor);
  return hsl.formatRgb();
}

function withAlpha(color, alpha) {
  const parsed = window.d3.color(color);
  if (parsed == null) {
    return color;
  }

  parsed.opacity = alpha;
  return parsed.formatRgb();
}

function isPrimaryEntityNode(node) {
  return node?.id === "top-owner" || node?.id === "article-subject" || node?.id === "news-site";
}

function getNodeVisualStyle(node) {
  if (isPrimaryEntityNode(node)) {
    return {
      rectFill: "rgba(244, 231, 196, 0.98)",
      rectStroke: "#7c5b2a",
      rectStrokeWidth: 2.4,
      labelFill: "#24180d",
      labelFontSize: 18,
      metaFill: "#5a4020",
      metaFontSize: 12,
      labelLimit: 30
    };
  }

  return {
    rectFill: "rgba(247, 239, 223, 0.96)",
    rectStroke: "#b79d73",
    rectStrokeWidth: 1.3,
    labelFill: "#2b2218",
    labelFontSize: 14,
    metaFill: "#3e3428",
    metaFontSize: 11,
    labelLimit: 24
  };
}

function shortenLabel(label, limit = 28) {
  if (typeof label !== "string") {
    return "";
  }

  if (label.length <= limit) {
    return label;
  }

  return `${label.slice(0, limit - 1)}…`;
}

function getAnchoredLinePoints(link) {
  const sourceX = link.source.x ?? 0;
  const sourceY = link.source.y ?? 0;
  const targetX = link.target.x ?? 0;
  const targetY = link.target.y ?? 0;
  const sourceBoxWidth = link.source.boxWidth ?? ((link.source.radius ?? 24) * 2);
  const sourceBoxHeight = link.source.boxHeight ?? ((link.source.radius ?? 24) * 2);
  const targetBoxWidth = link.target.boxWidth ?? ((link.target.radius ?? 24) * 2);
  const targetBoxHeight = link.target.boxHeight ?? ((link.target.radius ?? 24) * 2);

  const sourcePoint = getPointOnRectBoundary(sourceX, sourceY, sourceBoxWidth, sourceBoxHeight, targetX, targetY);
  const targetPoint = getPointOnRectBoundary(targetX, targetY, targetBoxWidth, targetBoxHeight, sourceX, sourceY);
  const dx = targetPoint.x - sourcePoint.x;
  const dy = targetPoint.y - sourcePoint.y;
  const distance = Math.hypot(dx, dy) || 1;
  const clearance = Math.min(NODE_EDGE_CLEARANCE, Math.max((distance * 0.5) - 1, 0));
  const offsetX = (dx / distance) * clearance;
  const offsetY = (dy / distance) * clearance;

  return {
    x1: sourcePoint.x + offsetX,
    y1: sourcePoint.y + offsetY,
    x2: targetPoint.x - offsetX,
    y2: targetPoint.y - offsetY
  };
}

function getPointOnRectBoundary(centerX, centerY, width, height, towardX, towardY) {
  const dx = towardX - centerX;
  const dy = towardY - centerY;
  const absDx = Math.abs(dx) || 0.0001;
  const absDy = Math.abs(dy) || 0.0001;
  const halfWidth = Math.max(width * 0.5, 1);
  const halfHeight = Math.max(height * 0.5, 1);
  const scale = Math.min(halfWidth / absDx, halfHeight / absDy);

  return {
    x: centerX + (dx * scale),
    y: centerY + (dy * scale)
  };
}

function getCurvedHorizontalPath(link) {
  const points = getAnchoredLinePoints(link);
  return window.d3.linkHorizontal()({
    source: [points.x1, points.y1],
    target: [points.x2, points.y2]
  });
}

function getArcPath(link) {
  const points = getAnchoredLinePoints(link);
  const dx = points.x2 - points.x1;
  const dy = points.y2 - points.y1;
  const radius = Math.max(Math.hypot(dx, dy), 1);
  const sweep = points.x1 <= points.x2 ? 1 : 0;
  return `M${points.x1},${points.y1}A${radius},${radius} 0 0,${sweep} ${points.x2},${points.y2}`;
}

function getEvidenceEntries(relationshipData) {
  const evidence = relationshipData?.evidence;
  if (Array.isArray(evidence)) {
    return evidence;
  }

  if (evidence != null && typeof evidence === "object") {
    return Object.values(evidence);
  }

  return [];
}

function relationshipHasCompleteEvidence(relationshipData) {
  const entries = getEvidenceEntries(relationshipData);
  if (entries.length === 0) {
    return false;
  }

  for (let i = 0; i < entries.length; i++) {
    const evidence = entries[i];
    if (evidence == null) {
      return false;
    }

    const excerpt = typeof evidence.excerpt === "string" ? evidence.excerpt.trim() : "";
    const source = typeof evidence.source === "string" ? evidence.source.trim() : "";
    if (!excerpt || !source) {
      return false;
    }
  }

  return true;
}

function shouldRenderRelationshipDashed(link) {
  if (link?.kind === "direct") {
    return false;
  }

  return relationshipHasCompleteEvidence(link?.data) === false;
}

function createMinimumEdgeLengthForce(links, getMinLength) {
  let nodes = [];

  function force(alpha) {
    for (let i = 0; i < links.length; i++) {
      const link = links[i];
      const source = link.source;
      const target = link.target;
      if (!source || !target) {
        continue;
      }

      const dx = (target.x ?? 0) - (source.x ?? 0);
      const dy = (target.y ?? 0) - (source.y ?? 0);
      const distance = Math.hypot(dx, dy) || 0.0001;
      const minLength = getMinLength(link);
      if (distance >= minLength) {
        continue;
      }

      const push = ((minLength - distance) / distance) * alpha * 0.35;
      const offsetX = dx * push;
      const offsetY = dy * push;

      if (source.fx == null) {
        source.x -= offsetX * 0.5;
        source.y -= offsetY * 0.5;
      }

      if (target.fx == null) {
        target.x += offsetX * 0.5;
        target.y += offsetY * 0.5;
      }
    }
  }

  force.initialize = function (_nodes) {
    nodes = _nodes;
  };

  return force;
}

class ArticleD3Graph {
  constructor(svgSelector, containerSelector) {
    this.svg = window.d3.select(svgSelector);
    this.container = document.querySelector(containerSelector);
    this.width = DEFAULT_GRAPH_WIDTH;
    this.height = DEFAULT_GRAPH_HEIGHT;
    this.graphData = { nodes: [], links: [] };
    this.currentArticleModel = null;
    this.simulation = null;
    this.hoverAnimationFrame = null;
    this.currentSelectedNodeId = null;
    this.highlightedLinkIds = new Set();
    this.cachedNoCommonOwnerPositions = null;
    this.noCommonOwnerChart = new NoCommonOwnerD3Chart({
      createNode: (...args) => this.createNode(...args)
    });

    this.root = this.svg.append("g").attr("class", "article-graph-root");
    this.viewport = this.root.append("g").attr("class", "article-graph-viewport");
    this.linkLayer = this.viewport.append("g").attr("class", "article-graph-links");
    this.nodeLayer = this.viewport.append("g").attr("class", "article-graph-nodes");
    this.legendLayer = this.root.append("g").attr("class", "article-graph-legend");
    this.markerId = `article-graph-arrow-${Math.random().toString(36).slice(2)}`;

    this.setupDefs();
    this.applyBaseStyles();
    this.setupZoom();
    this.resize();
  }

  setupDefs() {
    this.defs = this.svg.append("defs");
    const marker = this.defs
      .append("marker")
      .attr("id", this.markerId)
      .attr("viewBox", "0 -5 10 10")
      .attr("refX", 4)
      .attr("refY", 0)
      .attr("markerWidth", 8)
      .attr("markerHeight", 8)
      .attr("orient", "auto");

    marker
      .append("path")
      .attr("d", "M0,-5L10,0L0,5")
      .attr("fill", "#7a6a4d")
      .attr("opacity", 1);

    this.defs
      .append("marker")
      .attr("id", `${this.markerId}-highlight`)
      .attr("viewBox", "0 -5 10 10")
      .attr("refX", 8)
      .attr("refY", -0.5)
      .attr("markerWidth", 6)
      .attr("markerHeight", 6)
      .attr("orient", "auto")
      .append("path")
      .attr("d", "M0,-5L10,0L0,5")
      .attr("fill", "#7a6a4d");

    this.defs
      .append("marker")
      .attr("id", `${this.markerId}-dimmed`)
      .attr("viewBox", "0 -5 10 10")
      .attr("refX", 8)
      .attr("refY", -0.5)
      .attr("markerWidth", 6)
      .attr("markerHeight", 6)
      .attr("orient", "auto")
      .append("path")
      .attr("d", "M0,-5L10,0L0,5")
      .attr("fill", DIMMED_COLOR);
  }

  applyBaseStyles() {
    this.svg
      .attr("role", "img")
      .attr("aria-label", "D3 article relationship graph")
      .style("font-family", "\"Trebuchet MS\", \"Segoe UI\", sans-serif")
      .style("cursor", "grab");
  }

  getRelationType(link) {
    return link?.relationType ?? link?.label ?? "relationship";
  }

  getMarkerIdForRelationType(relationType) {
    const safeType = String(relationType ?? "relationship")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    return `${this.markerId}-${safeType || "relationship"}`;
  }

  getLinkBaseColor(link) {
    if (this.isDimmingNonSelectedElements() && !this.highlightedLinkIds?.has(link.id)) {
      return DIMMED_COLOR;
    }

    const relationType = this.getRelationType(link);
    return this.graphData?.colorByRelationType?.[relationType] ?? "#7a6a4d";
  }

  getLinkLabelFill(link) {
    return withAlpha(this.getLinkBaseColor(link), 0.18);
  }

  getLinkLabelStroke(link) {
    return withAlpha(this.getLinkBaseColor(link), 0.45);
  }

  getLinkMarkerUrl(link) {
    if (this.isDimmingNonSelectedElements() && !this.highlightedLinkIds?.has(link.id)) {
      return `url(#${this.markerId}-dimmed)`;
    }

    if (this.highlightedLinkIds?.has(link.id)) {
      if (this.graphData?.colorByRelationType) {
        return `url(#${this.getMarkerIdForRelationType(this.getRelationType(link))})`;
      }

      return `url(#${this.markerId})`;
    }

    if (this.graphData?.colorByRelationType) {
      return `url(#${this.getMarkerIdForRelationType(this.getRelationType(link))})`;
    }

    return `url(#${this.markerId})`;
  }

  updateRelationshipMarkers(graph) {
    const relationTypes = graph?.relationTypes ?? [];

    this.defs
      .selectAll("marker.article-graph-relation-marker")
      .data(relationTypes, (d) => d)
      .join(
        (enter) => {
          const marker = enter
            .append("marker")
            .attr("class", "article-graph-relation-marker")
            .attr("viewBox", "0 -5 10 10")
            .attr("refX", 8)
            .attr("refY", -0.5)
            .attr("markerWidth", 6)
            .attr("markerHeight", 6)
            .attr("orient", "auto");

          marker.append("path").attr("d", "M0,-5L10,0L0,5");
          return marker;
        },
        (update) => update,
        (exit) => exit.remove()
      )
      .attr("id", (d) => this.getMarkerIdForRelationType(d))
      .select("path")
      .attr("fill", (d) => graph.colorByRelationType[d] ?? "#7a6a4d");
  }

  updateMarkerColors() {
    this.defs
      .select(`marker#${this.markerId} path`)
      .attr("fill", "#7a6a4d");

    this.defs
      .select(`marker#${this.markerId}-highlight path`)
      .attr("fill", "#7a6a4d");

    this.defs
      .select(`marker#${this.markerId}-dimmed path`)
      .attr("fill", DIMMED_COLOR);

    this.defs
      .selectAll("marker.article-graph-relation-marker")
      .select("path")
      .attr("fill", (relationType) => this.graphData?.colorByRelationType?.[relationType] ?? "#7a6a4d");
  }

  updateLegend(graph) {
    this.legendLayer.selectAll("*").remove();
  }

  getLegendItems() {
    if (
      this.graphData?.useArcLinks !== true ||
      Array.isArray(this.graphData?.relationTypes) === false ||
      this.graphData.relationTypes.length === 0
    ) {
      return [];
    }

    return this.graphData.relationTypes.map((relationType) => ({
      label: relationType,
      color: this.graphData?.colorByRelationType?.[relationType] ?? "#7a6a4d"
    }));
  }

  updateTopOwnersPanel(graph, anchorWidth, anchorHeight) {
    if (Array.isArray(graph.newsTopOwnerNodeIds) === false || graph.newsTopOwnerNodeIds.length === 0) {
      return;
    }

    const gutter = 24;
    const panelX = gutter + anchorWidth + gutter;
    const detailPanelReserve = Math.min(420, Math.max(this.width - 32, 0));
    const panelWidth = Math.max(260, this.width - panelX - detailPanelReserve - gutter);
    const panelHeight = anchorHeight;
    const panelY = 64;
    const titleHeight = 18;
    const paddingX = 14;
    const paddingY = 12;
    const cardHeight = 34;
    const cardGap = 8;
    const cardColumns = 6;
    const innerWidth = panelWidth - (paddingX * 2);
    const cardWidth = Math.floor((innerWidth - cardGap) / cardColumns);

    const panel = this.legendLayer
      .append("g")
      .attr("transform", `translate(${panelX}, ${panelY})`)
      .on("click", (event) => {
        event.stopPropagation();
      });

    panel
      .append("rect")
      .attr("width", panelWidth)
      .attr("height", panelHeight)
      .attr("rx", 10)
      .attr("ry", 10)
      .attr("fill", "rgba(255, 252, 244, 0.92)")
      .attr("stroke", "rgba(36, 24, 13, 0.18)")
      .attr("stroke-width", 1.2);

    panel
      .append("text")
      .attr("x", paddingX)
      .attr("y", paddingY + 12)
      .attr("fill", "#24180d")
      .attr("font-size", 12)
      .attr("font-weight", 800)
      .attr("letter-spacing", "0.05em")
      .text(graph.newsTopOwnerTitle ?? "Top Owners");

    const scrollHeight = panelHeight - (paddingY * 2) - titleHeight - 8;
    const foreignObject = panel
      .append("foreignObject")
      .attr("x", paddingX)
      .attr("y", paddingY + titleHeight + 8)
      .attr("width", innerWidth)
      .attr("height", scrollHeight);

    const container = foreignObject
      .append("xhtml:div")
      .style("width", `${innerWidth}px`)
      .style("height", `${scrollHeight}px`)
      .style("overflow-y", "auto")
      .style("overflow-x", "hidden")
      .style("display", "grid")
      .style("grid-template-columns", `repeat(${cardColumns}, ${cardWidth}px)`)
      .style("gap", `${cardGap}px`)
      .style("padding", "0")
      .style("box-sizing", "border-box")
      .on("wheel", (event) => {
        event.stopPropagation();
      })
      .on("click", (event) => {
        event.stopPropagation();
      });

    const cards = container
      .selectAll("div.article-graph-top-owner-card")
      .data(graph.newsTopOwnerNodeIds, (d) => d)
      .join("xhtml:div")
      .attr("class", "article-graph-top-owner-card")
      .style("width", `${cardWidth}px`)
      .style("height", `${cardHeight}px`)
      .style("border-radius", "10px")
      .style("box-sizing", "border-box")
      .style("display", "flex")
      .style("align-items", "center")
      .style("justify-content", "center")
      .style("text-align", "center")
      .style("padding", "4px 4px")
      .style("cursor", "pointer")
      .style("user-select", "none")
      .style("font-family", "\"Trebuchet MS\", \"Segoe UI\", sans-serif")
      .style("font-size", "10px")
      .style("font-weight", "800")
      .style("line-height", "1.05")
      .style("overflow", "hidden")
      .style("text-overflow", "ellipsis")
      .style("color", (nodeId) => getNodeVisualStyle(this.getNodeById(nodeId)).labelFill)
      .style("background", (nodeId) => getNodeVisualStyle(this.getNodeById(nodeId)).rectFill)
      .style("border", (nodeId) => `1.3px solid ${getNodeVisualStyle(this.getNodeById(nodeId)).rectStroke}`)
      .text((nodeId) => shortenLabel(this.getNodeById(nodeId)?.label ?? "", getNodeVisualStyle(this.getNodeById(nodeId)).labelLimit))
      .on("click", (event, nodeId) => {
        event.stopPropagation();
        const node = this.getNodeById(nodeId);
        if (node == null) {
          return;
        }

        this.activateNode(node);
      });
  }

  getNodeById(nodeId) {
    return this.graphData?.nodes?.find((node) => node.id === nodeId) ?? null;
  }

  activateNode(node) {
    this.setSelectedNode(node);
    const detailData = node.data;
    window[`apps_${performance.timeOrigin}`]?.pepe?.openDetailPanel?.({
      title: "Entity Details",
      kind: "entity",
      data: detailData
    });
    console.log("Entity clicked", detailData);
  }

  setNodeHoverState(selection, isHovered) {
    selection.each(function (d) {
      const group = window.d3.select(this);
      const style = getNodeVisualStyle(d);
      d.targetHoverScale = isHovered ? NODE_HOVER_SCALE : 1;
      if (!isHovered) {
        d.hoverScale = 1;
      }

      group.select(".article-graph-node-bg")
        .attr("fill", isHovered ? brightenColor(style.rectFill, NODE_HOVER_BRIGHTNESS) : style.rectFill)
        .attr("stroke", isHovered ? brightenColor(style.rectStroke, NODE_HOVER_BRIGHTNESS) : style.rectStroke)
        .attr("stroke-width", isHovered ? style.rectStrokeWidth + 0.8 : style.rectStrokeWidth);

      group.select(".article-graph-node-label")
        .attr("fill", isHovered ? brightenColor(style.labelFill, NODE_HOVER_BRIGHTNESS) : style.labelFill);

      group.select(".article-graph-node-meta")
        .attr("fill", isHovered ? brightenColor(style.metaFill, NODE_HOVER_BRIGHTNESS) : style.metaFill);
    });

    this.scheduleHoverAnimation();
  }

  setLinkHoverState(selection, isHovered) {
    selection.each((d, index, nodes) => {
      const group = window.d3.select(nodes[index]);
      const baseColor = this.getLinkBaseColor(d);
      const lineColor = isHovered ? brightenColor(baseColor, LINK_HOVER_BRIGHTNESS) : baseColor;
      const labelFill = isHovered ? brightenColor(this.getLinkLabelFill(d), LINK_HOVER_BRIGHTNESS) : this.getLinkLabelFill(d);
      const labelStroke = isHovered ? brightenColor(this.getLinkLabelStroke(d), LINK_HOVER_BRIGHTNESS) : this.getLinkLabelStroke(d);
      const textColor = isHovered ? brightenColor("#24180d", LINK_HOVER_BRIGHTNESS) : "#24180d";

      d.targetHoverScale = isHovered ? LINK_HOVER_SCALE : 1;
      if (!isHovered) {
        d.hoverScale = 1;
      }

      group.select(".article-graph-link-line")
        .attr("stroke", lineColor)
        .attr("stroke-width", d.kind === "chain"
          ? (isHovered ? 3.5 : 2.8)
          : (isHovered ? 2.7 : 2.2));

      group.select(".article-graph-link-path")
        .attr("stroke", lineColor)
        .attr("stroke-width", d.kind === "chain"
          ? (isHovered ? 3.5 : 2.8)
          : (isHovered ? 2.7 : 2.2));

      group.select(".article-graph-link-label-bg")
        .attr("fill", labelFill)
        .attr("stroke", labelStroke);

      group.select("text")
        .attr("fill", textColor);
    });

    this.scheduleHoverAnimation();
  }

  scheduleHoverAnimation() {
    if (this.hoverAnimationFrame != null) {
      return;
    }

    this.hoverAnimationFrame = requestAnimationFrame(() => {
      this.hoverAnimationFrame = null;
      const shouldContinue = this.updateHoverScales();
      this.redraw();
      if (shouldContinue) {
        this.scheduleHoverAnimation();
      }
    });
  }

  updateHoverScales() {
    let shouldContinue = false;
    const applyStep = (item) => {
      const current = item.hoverScale ?? 1;
      const target = item.targetHoverScale ?? 1;
      const next = current + ((target - current) * HOVER_SCALE_LERP);
      item.hoverScale = Math.abs(target - next) < 0.001 ? target : next;
      if (Math.abs((item.hoverScale ?? 1) - target) >= 0.001) {
        shouldContinue = true;
      }
    };

    for (let i = 0; i < this.graphData.nodes.length; i++) {
      applyStep(this.graphData.nodes[i]);
    }

    for (let i = 0; i < this.graphData.links.length; i++) {
      applyStep(this.graphData.links[i]);
    }

    return shouldContinue;
  }

  setupZoom() {
    this.zoomBehavior = window.d3.zoom()
      .scaleExtent([D3_MIN_SCALE, D3_MAX_SCALE])
      .on("start", () => {
        this.svg.style("cursor", "grabbing");
      })
      .on("zoom", (event) => {
        this.viewport.attr("transform", event.transform);
      })
      .on("end", () => {
        this.svg.style("cursor", "grab");
      });

    this.svg.call(this.zoomBehavior);
  }

  updateZoomBounds(maxScale = D3_MAX_SCALE) {
    if (this.zoomBehavior == null) {
      return;
    }

    this.zoomBehavior
      .scaleExtent([D3_MIN_SCALE, maxScale])
      .extent([[0, 0], [this.width, this.height]])
      .translateExtent([
        [-D3_PAN_MARGIN, -D3_PAN_MARGIN],
        [this.width + D3_PAN_MARGIN, this.height + D3_PAN_MARGIN]
      ]);
  }

  resize() {
    const rect = this.container?.getBoundingClientRect?.();
    const svgWidth = Math.max(320, Math.floor(rect?.width || window.innerWidth || DEFAULT_GRAPH_WIDTH));
    const svgHeight = Math.max(320, Math.floor(rect?.height || window.innerHeight || DEFAULT_GRAPH_HEIGHT));

    this.svg
      .attr("viewBox", `0 0 ${this.width} ${this.height}`)
      .attr("width", svgWidth)
      .attr("height", svgHeight);

    const maxScale = Math.max(D3_MAX_SCALE, this.width / svgWidth);
    this.updateZoomBounds(maxScale);
  }

  clear() {
    this.stopSimulation();
    this.linkLayer.selectAll("*").remove();
    this.nodeLayer.selectAll("*").remove();
    this.legendLayer.selectAll("*").remove();
    this.currentSelectedNodeId = null;
    this.highlightedLinkIds.clear();
    this.linkSelection = null;
    this.nodeSelection = null;
    this.currentArticleModel = null;
    this.graphData = { nodes: [], links: [] };
  }

  clearSelectionState() {
    this.currentSelectedNodeId = null;
    this.highlightedLinkIds.clear();
    if (this.linkSelection != null || this.nodeSelection != null) {
      this.updateMarkerColors();
      this.redraw();
    }
  }

  renderArticle(articleModel) {
    if (articleModel == null) {
      this.clear();
      return;
    }

    if (this.currentArticleModel !== articleModel) {
      this.cachedNoCommonOwnerPositions = null;
    }
    this.currentArticleModel = articleModel;
    this.stopSimulation();
    this.svg.on("click", () => {
      this.clearSelectionState();
    });

    const graph = this.hasCommonOwners(articleModel)
      ? this.buildGraphData(articleModel)
      : this.buildNoCommonOwnerGraphData(articleModel);
    this.graphData = graph;
    this.currentSelectedNodeId = null;
    this.highlightedLinkIds.clear();
    this.resolveLinkNodeRefs(graph);
    this.updateRelationshipMarkers(graph);
    this.updateMarkerColors();
    this.updateLegend(graph);
    if (graph.layout === "force") {
      this.seedNodePositions(graph.nodes);
    }
    this.resetZoom();

    this.linkLayer.selectAll("*").remove();
    this.nodeLayer.selectAll("*").remove();
    if (this.hoverAnimationFrame != null) {
      cancelAnimationFrame(this.hoverAnimationFrame);
      this.hoverAnimationFrame = null;
    }

    const linkSelection = this.linkLayer
      .selectAll("g.article-graph-link")
      .data(graph.links, (d) => d.id)
      .join((enter) => {
        const graphView = this;
        const group = enter.append("g").attr("class", "article-graph-link");
        group
          .append("path")
          .attr("class", "article-graph-link-path")
          .attr("fill", "none")
          .attr("stroke", (d) => this.getLinkBaseColor(d))
          .attr("stroke-opacity", 0)
          .attr("stroke-width", (d) => (d.kind === "chain" ? 2.8 : 2.2))
          .attr("stroke-linecap", "round")
          .style("cursor", (d) => (d.kind === "chain" ? "pointer" : "default"));
        group
          .append("line")
          .attr("class", "article-graph-link-line")
          .attr("stroke", (d) => this.getLinkBaseColor(d))
          .attr("stroke-opacity", 1)
          .attr("stroke-width", (d) => (d.kind === "chain" ? 2.8 : 2.2))
          .attr("stroke-linecap", "round")
          .style("cursor", (d) => (d.kind === "chain" ? "pointer" : "default"))
          .attr("marker-end", (d) => this.getLinkMarkerUrl(d));
        group
          .append("g")
          .attr("class", "article-graph-link-label")
          .each(function (d) {
            const labelGroup = window.d3.select(this);
            labelGroup
              .append("rect")
              .attr("class", "article-graph-link-label-bg")
              .attr("rx", 6)
              .attr("ry", 6)
              .attr("fill", (d) => graphView.getLinkLabelFill(d))
              .attr("stroke", (d) => graphView.getLinkLabelStroke(d))
              .attr("stroke-width", 1.1);
            labelGroup
              .append("text")
              .attr("fill", "#24180d")
              .attr("font-size", 12)
              .attr("font-weight", 800)
              .attr("letter-spacing", "0.04em")
              .attr("text-transform", "uppercase")
              .attr("text-anchor", "middle")
              .style("cursor", (d) => (d.kind === "chain" ? "pointer" : "default"))
              .text((d) => d.label);
          });
        return group;
      });

    const nodeSelection = this.nodeLayer
      .selectAll("g.article-graph-node")
      .data(graph.nodes, (d) => d.id)
      .join((enter) => {
        const group = enter.append("g")
          .attr("class", "article-graph-node")
          .style("cursor", "pointer");

        group
          .append("rect")
          .attr("class", "article-graph-node-bg")
          .attr("rx", 10)
          .attr("ry", 10)
          .attr("fill", (d) => getNodeVisualStyle(d).rectFill)
          .attr("stroke", (d) => getNodeVisualStyle(d).rectStroke)
          .attr("stroke-width", (d) => getNodeVisualStyle(d).rectStrokeWidth);

        group
          .append("text")
          .attr("class", "article-graph-node-label")
          .attr("text-anchor", "middle")
          .attr("font-size", (d) => getNodeVisualStyle(d).labelFontSize)
          .attr("font-weight", 800)
          .attr("fill", (d) => getNodeVisualStyle(d).labelFill)
          .attr("dy", "-0.35em")
          .text((d) => shortenLabel(d.label, getNodeVisualStyle(d).labelLimit));

        group
          .append("text")
          .attr("class", "article-graph-node-meta")
          .attr("text-anchor", "middle")
          .attr("font-size", (d) => getNodeVisualStyle(d).metaFontSize)
          .attr("font-weight", 700)
          .attr("fill", (d) => getNodeVisualStyle(d).metaFill)
          .attr("dy", "1.15em")
          .text((d) => d.meta ?? "")
          .attr("display", (d) => (d.meta ? null : "none"));

        group
          .append("title")
          .text((d) => `${d.label}${d.meta ? `\n${d.meta}` : ""}`);

        return group;
      });

    linkSelection.on("click", (event, d) => {
      if (d.kind !== "chain") {
        return;
      }

      event.stopPropagation();
      this.clearSelectionState();

      const relationshipData = d.data;
      const pepe = window[`apps_${performance.timeOrigin}`]?.pepe;
      let model = pepe?.relationships?.[relationshipData?.id];

      if (model == null) {
        const evidenceIds = relationshipData?.evidence_ids ?? [];
        const resolvedEvidence = {};
        for (let i = 0; i < evidenceIds.length; i++) {
          const evId = evidenceIds[i];
          const ev = pepe?.evidence?.[evId];
          if (ev) {
            resolvedEvidence[evId] = ev;
          }
        }
        model = {
          id: relationshipData?.id,
          source: relationshipData?.source_entity_id ?? relationshipData?.source,
          target: relationshipData?.target_entity_id ?? relationshipData?.target,
          relation: relationshipData?.relation,
          evidence: resolvedEvidence
        };
      }

      const detailData = {
        model,
        surface: "arrow"
      };
      window[`apps_${performance.timeOrigin}`]?.pepe?.openDetailPanel?.({
        title: "Relationship Details",
        kind: "relationship",
        data: detailData
      });
      console.log("Arrow relationship clicked", {
        linkId: d.id,
        relId: relationshipData?.id,
        hasResolvedModel: !!pepe?.relationships?.[relationshipData?.id],
        evidenceCount: model?.evidence ? Object.keys(model.evidence).length : 0,
        detailData
      });
    });

    linkSelection
      .on("mouseenter", (event, d) => {
        if (d.kind !== "chain") {
          return;
        }

        this.setLinkHoverState(window.d3.select(event.currentTarget), true);
      })
      .on("mouseleave", (event, d) => {
        if (d.kind !== "chain") {
          return;
        }

        this.setLinkHoverState(window.d3.select(event.currentTarget), false);
      });

    nodeSelection.on("click", (event, d) => {
      event.stopPropagation();
      this.activateNode(d);
    });

    nodeSelection
      .on("mouseenter", (event) => {
        this.setNodeHoverState(window.d3.select(event.currentTarget), true);
      })
      .on("mouseleave", (event) => {
        this.setNodeHoverState(window.d3.select(event.currentTarget), false);
      });

    this.linkSelection = linkSelection;
    this.nodeSelection = nodeSelection;
    this.updateNodeLabelBoxes();
    if (graph.layout === "force" && this.cachedNoCommonOwnerPositions == null) {
      this.initializeSimulation(graph);
      this.redraw();
    } else if (graph.layout === "force") {
      this.seedNodePositionsFromCache(graph);
      this.redraw();
    } else {
      this.redraw();
    }
  }

  resetZoom() {
    if (this.zoomBehavior == null) {
      return;
    }

    const identity = window.d3.zoomIdentity;
    this.svg.call(this.zoomBehavior.transform, identity);
  }

  getAnchorPositions() {
    return {
      "top-owner": { x: this.width * 0.5, y: this.height * 0.14 },
      "article-subject": { x: this.width * 0.18, y: this.height * 0.8 },
      "news-site": { x: this.width * 0.82, y: this.height * 0.8 }
    };
  }

  getNodeTargetPosition(node) {
    const anchors = this.getAnchorPositions();
    const primaryAnchor = anchors[node.id];
    if (primaryAnchor) {
      return primaryAnchor;
    }

    const isSubjectChain = node.chainKey === "subject";
    const chainIndex = node.chainIndex ?? 0;
    const chainLength = Math.max(1, node.chainLength ?? 1);
    const lerp = (chainIndex + 1) / (chainLength + 1);
    const from = anchors["top-owner"];
    const to = anchors[isSubjectChain ? "article-subject" : "news-site"];
    const sideOffset = isSubjectChain ? -170 : 170;
    const arcLift = 120 * Math.sin(lerp * Math.PI);

    return {
      x: from.x + ((to.x - from.x) * lerp) + sideOffset,
      y: from.y + ((to.y - from.y) * lerp) - arcLift
    };
  }

  seedNodePositions(nodes) {
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      const target = (node.preferredX != null && node.preferredY != null)
        ? { x: node.preferredX, y: node.preferredY }
        : this.getNodeTargetPosition(node);
      const jitterX = isPrimaryEntityNode(node) ? 0 : ((Math.random() - 0.5) * 36);
      const jitterY = isPrimaryEntityNode(node) ? 0 : ((Math.random() - 0.5) * 36);
      node.x = target.x + jitterX;
      node.y = target.y + jitterY;
    }
  }

  getCollisionRadius(node) {
    const width = node.boxWidth ?? ((node.radius ?? 30) * 2.4);
    const height = node.boxHeight ?? ((node.radius ?? 30) * 2.0);
    return (Math.max(width, height) * 0.5) + 44;
  }

  initializeSimulation(graph) {
    if (graph.forceVariant === "no-common-owner-chart") {
      this.initializeNoCommonOwnerSimulation(graph);
      return;
    }

    const d3 = window.d3;
    const anchors = this.getAnchorPositions();

    for (let i = 0; i < graph.nodes.length; i++) {
      const node = graph.nodes[i];
      if (node.id === "top-owner") {
        node.fx = anchors["top-owner"].x;
        node.fy = anchors["top-owner"].y;
      } else if (node.id === "article-subject") {
        node.fx = anchors["article-subject"].x;
        node.fy = anchors["article-subject"].y;
      } else if (node.id === "news-site") {
        node.fx = anchors["news-site"].x;
        node.fy = anchors["news-site"].y;
      } else {
        node.fx = null;
        node.fy = null;
      }
    }

    this.simulation = d3.forceSimulation(graph.nodes)
      .force("link", d3.forceLink(graph.links)
        .id((d) => d.id)
        .distance((d) => (d.kind === "chain" ? CHAIN_LINK_DISTANCE : DIRECT_LINK_DISTANCE))
        .strength((d) => (d.kind === "chain" ? 0.42 : 0.18)))
      .force("min-edge-length", createMinimumEdgeLengthForce(
        graph.links,
        (d) => (d.kind === "chain" ? MIN_CHAIN_EDGE_LENGTH : MIN_DIRECT_EDGE_LENGTH)
      ))
      .force("charge", d3.forceManyBody()
        .strength((d) => (isPrimaryEntityNode(d) ? PRIMARY_NODE_REPULSION : SECONDARY_NODE_REPULSION))
        .distanceMax(Math.max(this.width, this.height) * 1.3))
      .force("collide", d3.forceCollide((d) => this.getCollisionRadius(d))
        .iterations(4)
        .strength(1))
      .force("x", d3.forceX((d) => this.getNodeTargetPosition(d).x)
        .strength((d) => (isPrimaryEntityNode(d) ? 0.2 : 0.12)))
      .force("y", d3.forceY((d) => this.getNodeTargetPosition(d).y)
        .strength((d) => (isPrimaryEntityNode(d) ? 0.2 : 0.12)))
      .alpha(1)
      .alphaDecay(0.045);

    for (let i = 0; i < graph.nodes.length; i++) {
      const node = graph.nodes[i];
      if (node.fx != null) {
        node.x = node.fx;
        node.vx = 0;
        node.vy = 0;
      }
      if (node.fy != null) {
        node.y = node.fy;
        node.vx = 0;
        node.vy = 0;
      }
    }
    this.simulation.alpha(0).stop();
  }

  initializeNoCommonOwnerSimulation(graph) {
    const d3 = window.d3;

    for (let i = 0; i < graph.nodes.length; i++) {
      const node = graph.nodes[i];
      node.fx = null;
      node.fy = null;

      if (node.isTargetRoot) {
        node.fx = node.preferredX ?? null;
        node.fy = node.preferredY ?? null;
      } else if (node.isFirstHop) {
        node.fx = node.preferredX ?? null;
      }
    }

    this.simulation = d3.forceSimulation(graph.nodes)
      .force("link", d3.forceLink(graph.links)
        .id((d) => d.id)
        .distance((d) => (d.kind === "chain" ? 260 : 340))
        .strength((d) => (d.kind === "chain" ? 0.48 : 0.22)))
      .force("charge", d3.forceManyBody()
        .strength((d) => (isPrimaryEntityNode(d) ? PRIMARY_NODE_REPULSION : SECONDARY_NODE_REPULSION))
        .distanceMax(Math.max(this.width, this.height) * 1.4))
      .force("collide", d3.forceCollide((d) => this.getCollisionRadius(d))
        .iterations(4)
        .strength(1))
      .force("x", d3.forceX((d) => d.preferredX ?? (this.width * 0.5))
        .strength((d) => (d.isTargetRoot || d.isFirstHop ? 0.45 : isPrimaryEntityNode(d) ? 0.34 : 0.18)))
      .force("y", d3.forceY((d) => d.preferredY ?? (this.height * 0.5))
        .strength((d) => (isPrimaryEntityNode(d) ? 0.28 : 0.16)))
      .alpha(1)
      .alphaDecay(0.05);

    for (let i = 0; i < graph.nodes.length; i++) {
      const node = graph.nodes[i];
      if (node.fx != null) {
        node.x = node.fx;
        node.vx = 0;
        node.vy = 0;
      }
      if (node.fy != null) {
        node.y = node.fy;
        node.vx = 0;
        node.vy = 0;
      }
    }
    this.lockNoCommonOwnerRootNodes(graph.nodes);
    this.simulation.alpha(0).stop();

    this._noCommonOwnerGraph = graph;
  }

  lockNoCommonOwnerRootNodes(nodes = this.graphData?.nodes) {
    if (this.graphData?.forceVariant !== "no-common-owner-chart" || Array.isArray(nodes) === false) {
      return;
    }

    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      if (!node?.isTargetRoot) {
        continue;
      }

      const lockedX = node.preferredX;
      const lockedY = node.preferredY;
      if (lockedX == null || lockedY == null) {
        continue;
      }

      node.x = lockedX;
      node.y = lockedY;
      node.fx = lockedX;
      node.fy = lockedY;
      node.vx = 0;
      node.vy = 0;
    }
  }

  enforceNoCommonOwnerXBounds(nodes) {
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      if (node.minAllowedX != null && node.x < node.minAllowedX) {
        node.x = node.minAllowedX;
        node.vx = Math.max(0, node.vx ?? 0);
      }

      if (node.maxAllowedX != null && node.x > node.maxAllowedX) {
        node.x = node.maxAllowedX;
        node.vx = Math.min(0, node.vx ?? 0);
      }
    }
  }

  tick() {
    if (this.simulation && this.simulation.alpha() > 0) {
      this.simulation.tick();
    }
    if (this.simulation && this._noCommonOwnerGraph) {
      this.enforceNoCommonOwnerXBounds(this._noCommonOwnerGraph.nodes);
      this.lockNoCommonOwnerRootNodes(this._noCommonOwnerGraph.nodes);
    }
    if (this.simulation && this.simulation.alpha() > 0) {
      this.redraw();
    }
  }

  getNoCommonOwnerPositions(scale = 1, useCache = true) {
    const d3 = window.d3;
    if (d3 == null || this.currentArticleModel == null) {
      return null;
    }

    if (useCache && this.cachedNoCommonOwnerPositions != null) {
      return this.cachedNoCommonOwnerPositions;
    }

    const articleModel = this.currentArticleModel;
    const graph = this.noCommonOwnerChart.build(articleModel, {
      width: this.width,
      height: this.height
    });

    const filteredGraph = this.filterGraphForEvidence(graph);
    if (filteredGraph.nodes.length === 0) {
      return null;
    }

    for (let i = 0; i < filteredGraph.nodes.length; i++) {
      const node = filteredGraph.nodes[i];
      node.fx = null;
      node.fy = null;

      if (node.isTargetRoot) {
        node.fx = node.preferredX ?? null;
        node.fy = node.preferredY ?? null;
      } else if (node.isFirstHop) {
        node.fx = node.preferredX ?? null;
      }
    }

    for (const link of filteredGraph.links) {
      if (typeof link.source !== "string") link.source = link.source.id;
      if (typeof link.target !== "string") link.target = link.target.id;
    }

    let simulation;
    try {
    simulation = d3.forceSimulation(filteredGraph.nodes)
      .force("link", d3.forceLink(filteredGraph.links)
        .id((d) => d.id)
        .distance((d) => (d.kind === "chain" ? 260 : 340))
        .strength((d) => (d.kind === "chain" ? 0.48 : 0.22)))
      .force("charge", d3.forceManyBody()
        .strength((d) => (isPrimaryEntityNode(d) ? PRIMARY_NODE_REPULSION : SECONDARY_NODE_REPULSION))
        .distanceMax(Math.max(this.width, this.height) * 1.4))
      .force("collide", d3.forceCollide((d) => this.getCollisionRadius(d))
        .iterations(4)
        .strength(1))
      .force("x", d3.forceX((d) => d.preferredX ?? (this.width * 0.5))
        .strength((d) => (d.isTargetRoot || d.isFirstHop ? 0.45 : isPrimaryEntityNode(d) ? 0.34 : 0.18)))
      .force("y", d3.forceY((d) => d.preferredY ?? (this.height * 0.5))
        .strength((d) => (isPrimaryEntityNode(d) ? 0.28 : 0.16)))
      .alphaDecay(0.05);

    for (let i = 0; i < 300; i++) {
      simulation.tick();
      this.enforceNoCommonOwnerXBounds(filteredGraph.nodes);
    }
    } catch (err) {
      console.warn("[ArticleD3Graph] position sim failed:", err.message);
      return null;
    }

    const positions = new Map();
    for (let i = 0; i < filteredGraph.nodes.length; i++) {
      const node = filteredGraph.nodes[i];
      let nodeX = node.x ?? node.preferredX ?? this.width * 0.5;
      let nodeY = node.y ?? node.preferredY ?? this.height * 0.5;

      if (node.id === "article-subject") {
        nodeX = node.preferredXSubject ?? nodeX;
        nodeY = node.preferredYSubject ?? nodeY;
      } else if (node.id === "news-site") {
        nodeX = node.preferredXNews ?? nodeX;
        nodeY = node.preferredYNews ?? nodeY;
      }

      positions.set(node.id, { x: nodeX * scale, y: nodeY * scale });
    }

    if (useCache) {
      this.cachedNoCommonOwnerPositions = positions;
      this.applyCachedPositionsToGraph();
    }

    return positions;
  }

  applyCachedPositionsToGraph() {
    const cached = this.cachedNoCommonOwnerPositions;
    if (cached == null || this.graphData?.nodes == null) {
      return;
    }

    for (let i = 0; i < this.graphData.nodes.length; i++) {
      const node = this.graphData.nodes[i];
      const cachedPos = cached.get(node.id);
      if (cachedPos) {
        node.x = cachedPos.x;
        node.y = cachedPos.y;
        node.fx = cachedPos.x;
        node.fy = cachedPos.y;
        node.vx = 0;
        node.vy = 0;
      }
    }

    this.lockNoCommonOwnerRootNodes(this.graphData.nodes);
    this.redraw();
  }

  seedNodePositionsFromCache(graph) {
    const cached = this.cachedNoCommonOwnerPositions;
    if (cached == null) return;

    for (let i = 0; i < graph.nodes.length; i++) {
      const node = graph.nodes[i];
      const cachedPos = cached.get(node.id);
      if (cachedPos) {
        node.x = cachedPos.x;
        node.y = cachedPos.y;
        node.fx = cachedPos.x;
        node.fy = cachedPos.y;
      }
    }

    this.lockNoCommonOwnerRootNodes(graph.nodes);
  }

  setSelectedNode(node) {
    const highlightedLinkIds = this.computeHighlightedPathLinks(node);
    if (highlightedLinkIds.size === 0) {
      this.currentSelectedNodeId = null;
      this.highlightedLinkIds.clear();
    } else {
      this.currentSelectedNodeId = node?.id ?? null;
      this.highlightedLinkIds = highlightedLinkIds;
    }
    if (this.linkSelection != null) {
      this.updateMarkerColors();
      this.redraw();
    }
  }

  isDimmingNonSelectedElements() {
    return this.graphData?.forceVariant === "no-common-owner-chart"
      && this.currentSelectedNodeId != null
      && this.highlightedLinkIds.size > 0;
  }

  getNodeBaseColors(node) {
    const style = getNodeVisualStyle(node);
    if (!this.isDimmingNonSelectedElements()) {
      return {
        fill: style.rectFill,
        stroke: style.rectStroke,
        labelFill: style.labelFill,
        metaFill: style.metaFill
      };
    }

    const isTargetNode = node?.id === "article-subject" || node?.id === "news-site";
    const isSelectedNode = node?.id === this.currentSelectedNodeId;
    const isPathNode = isSelectedNode || isTargetNode || this.isNodeOnHighlightedPath(node?.id);
    if (isPathNode) {
      return {
        fill: style.rectFill,
        stroke: style.rectStroke,
        labelFill: style.labelFill,
        metaFill: style.metaFill
      };
    }

    return {
      fill: "rgba(229, 231, 235, 0.95)",
      stroke: "#9ca3af",
      labelFill: "#6b7280",
      metaFill: "#9ca3af"
    };
  }

  isNodeOnHighlightedPath(nodeId) {
    if (nodeId == null || this.highlightedLinkIds.size === 0) {
      return false;
    }

    for (let i = 0; i < this.graphData.links.length; i++) {
      const link = this.graphData.links[i];
      if (!this.highlightedLinkIds.has(link.id)) {
        continue;
      }

      const sourceId = typeof link.source === "string" ? link.source : link.source?.id;
      const targetId = typeof link.target === "string" ? link.target : link.target?.id;
      if (sourceId === nodeId || targetId === nodeId) {
        return true;
      }
    }

    return false;
  }

  computeHighlightedPathLinks(node) {
    if (this.graphData?.forceVariant !== "no-common-owner-chart" || node == null) {
      return new Set();
    }

    if (node.id === "article-subject" || node.id === "news-site") {
      return new Set();
    }

    const memberships = Array.from(node.membership ?? []);
    if (memberships.length === 0) {
      return new Set();
    }

    const targetIds = memberships
      .map((treeKey) => (treeKey === "subject" ? "article-subject" : treeKey === "news" ? "news-site" : null))
      .filter((value) => value != null);

    const combinedPath = new Set();
    for (let i = 0; i < targetIds.length; i++) {
      const paths = this.findAllPathsToTarget(node.id, targetIds[i], memberships[i]);
      for (const linkId of paths) {
        combinedPath.add(linkId);
      }
    }

    return combinedPath;
  }

  findAllPathsToTarget(startNodeId, targetNodeId, treeKey) {
    const outgoingBySource = new Map();
    for (let i = 0; i < this.graphData.links.length; i++) {
      const link = this.graphData.links[i];
      if (link.kind !== "chain" || link.treeKey !== treeKey) {
        continue;
      }

      const sourceId = typeof link.source === "string" ? link.source : link.source?.id;
      if (sourceId == null) {
        continue;
      }

      const outgoing = outgoingBySource.get(sourceId) ?? [];
      outgoing.push(link);
      outgoingBySource.set(sourceId, outgoing);
    }

    const memo = new Map();
    const visit = (nodeId) => {
      if (memo.has(nodeId)) {
        return memo.get(nodeId);
      }

      if (nodeId === targetNodeId) {
        const result = { reachesTarget: true, linkIds: new Set() };
        memo.set(nodeId, result);
        return result;
      }

      const result = { reachesTarget: false, linkIds: new Set() };
      memo.set(nodeId, result);

      const outgoing = outgoingBySource.get(nodeId) ?? [];
      for (let i = 0; i < outgoing.length; i++) {
        const link = outgoing[i];
        const childId = typeof link.target === "string" ? link.target : link.target?.id;
        if (childId == null) {
          continue;
        }

        const childResult = visit(childId);
        if (!childResult.reachesTarget) {
          continue;
        }

        result.reachesTarget = true;
        result.linkIds.add(link.id);
        for (const childLinkId of childResult.linkIds) {
          result.linkIds.add(childLinkId);
        }
      }

      return result;
    };

    return visit(startNodeId).linkIds;
  }

  stopSimulation() {
    if (this.simulation == null) {
      return;
    }

    this.simulation.stop();
    this.simulation = null;
  }

  redraw() {
    if (this.linkSelection == null || this.nodeSelection == null) {
      return;
    }

    this.lockNoCommonOwnerRootNodes(this.graphData?.nodes);

    const useArcLinks = this.graphData.useArcLinks === true;
    const useCurvedTreeLinks = this.graphData.layout === "static" && !useArcLinks;

    this.nodeSelection.attr("transform", (d) => `translate(${d.x}, ${d.y}) scale(${d.hoverScale ?? 1})`);
    this.updateNodeLabelBoxes();
    this.nodeSelection.each((d, index, nodes) => {
      const group = window.d3.select(nodes[index]);
      const style = getNodeVisualStyle(d);
      const colors = this.getNodeBaseColors(d);

      group.select(".article-graph-node-bg")
        .attr("fill", colors.fill)
        .attr("stroke", colors.stroke)
        .attr("stroke-width", style.rectStrokeWidth);

      group.select(".article-graph-node-label")
        .attr("fill", colors.labelFill);

      group.select(".article-graph-node-meta")
        .attr("fill", colors.metaFill);
    });

    this.linkSelection.select(".article-graph-link-line")
      .attr("stroke", (d) => this.getLinkBaseColor(d))
      .attr("stroke-opacity", (d) => {
        if (useArcLinks) {
          return d.kind === "direct" ? 1 : 0;
        }

        return useCurvedTreeLinks && d.kind === "chain" ? 0 : 1;
      })
      .attr("marker-end", (d) => {
        if (useArcLinks) {
          return d.kind === "direct" ? this.getLinkMarkerUrl(d) : null;
        }

        return useCurvedTreeLinks && d.kind === "chain" ? null : this.getLinkMarkerUrl(d);
      })
      .attr("x1", (d) => getAnchoredLinePoints(d).x1)
      .attr("y1", (d) => getAnchoredLinePoints(d).y1)
      .attr("x2", (d) => getAnchoredLinePoints(d).x2)
      .attr("y2", (d) => getAnchoredLinePoints(d).y2);

    this.linkSelection.select(".article-graph-link-path")
      .attr("stroke", (d) => this.getLinkBaseColor(d))
      .attr("stroke-opacity", (d) => {
        if (useArcLinks) {
          return d.kind === "chain" ? 1 : 0;
        }

        return useCurvedTreeLinks && d.kind === "chain" ? 1 : 0;
      })
      .attr("marker-end", (d) => {
        if (useArcLinks) {
          return d.kind === "chain" ? this.getLinkMarkerUrl(d) : null;
        }

        return useCurvedTreeLinks && d.kind === "chain" ? this.getLinkMarkerUrl(d) : null;
      })
      .attr("d", (d) => {
        if (useArcLinks) {
          return d.kind === "chain" ? getArcPath(d) : null;
        }

        if (useCurvedTreeLinks && d.kind === "chain") {
          return getCurvedHorizontalPath(d);
        }

        return null;
      });

    this.linkSelection.select(".article-graph-link-label")
      .attr("display", useArcLinks ? "none" : null)
      .attr("transform", (d) => {
        const position = this.getLinkLabelPosition(d);
        return `translate(${position.x}, ${position.y}) scale(${d.hoverScale ?? 1})`;
      });

    if (!useArcLinks) {
      this.updateLinkLabelBoxes();
    }
  }

  updateNodeLabelBoxes() {
    this.nodeSelection.each(function (d) {
      const group = window.d3.select(this);
      const label = group.select(".article-graph-node-label").node();
      const meta = group.select(".article-graph-node-meta").node();

      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;

      [label, meta].forEach((node) => {
        if (node == null) {
          return;
        }

        const bbox = node.getBBox();
        if (bbox.width === 0 && bbox.height === 0) {
          return;
        }

        minX = Math.min(minX, bbox.x);
        minY = Math.min(minY, bbox.y);
        maxX = Math.max(maxX, bbox.x + bbox.width);
        maxY = Math.max(maxY, bbox.y + bbox.height);
      });

      if (Number.isFinite(minX) === false) {
        d.boxWidth = d.radius ?? 48;
        d.boxHeight = d.radius ?? 48;
        return;
      }

      const rectX = minX - NODE_LABEL_PADDING_X;
      const rectY = minY - NODE_LABEL_PADDING_Y;
      const rectWidth = (maxX - minX) + (NODE_LABEL_PADDING_X * 2);
      const rectHeight = (maxY - minY) + (NODE_LABEL_PADDING_Y * 2);

      d.boxWidth = rectWidth;
      d.boxHeight = rectHeight;

      group.select(".article-graph-node-bg")
        .attr("x", rectX)
        .attr("y", rectY)
        .attr("width", rectWidth)
        .attr("height", rectHeight);
    });
  }

  updateLinkLabelBoxes() {
    this.linkSelection.each(function () {
      const group = window.d3.select(this);
      const text = group.select(".article-graph-link-label text").node();
      if (text == null) {
        return;
      }

      const bbox = text.getBBox();
      group.select(".article-graph-link-label-bg")
        .attr("x", bbox.x - LINK_LABEL_PADDING_X)
        .attr("y", bbox.y - LINK_LABEL_PADDING_Y)
        .attr("width", bbox.width + (LINK_LABEL_PADDING_X * 2))
        .attr("height", bbox.height + (LINK_LABEL_PADDING_Y * 2));
    });
  }

  getLinkLabelPosition(link) {
    const points = getAnchoredLinePoints(link);
    const dx = points.x2 - points.x1;
    const dy = points.y2 - points.y1;
    const distance = Math.hypot(dx, dy) || 1;
    const normalA = {
      x: -dy / distance,
      y: dx / distance
    };
    const normalB = {
      x: -normalA.x,
      y: -normalA.y
    };
    const midpoint = {
      x: (points.x1 + points.x2) * 0.5,
      y: (points.y1 + points.y2) * 0.5
    };
    const outward = {
      x: midpoint.x - (this.width * 0.5),
      y: midpoint.y - (this.height * 0.5)
    };
    const chosenNormal =
      ((normalA.x * outward.x) + (normalA.y * outward.y)) >=
      ((normalB.x * outward.x) + (normalB.y * outward.y))
        ? normalA
        : normalB;

    return {
      x: midpoint.x + (chosenNormal.x * LINK_LABEL_OFFSET),
      y: midpoint.y + (chosenNormal.y * LINK_LABEL_OFFSET)
    };
  }

   resolveLinkNodeRefs(graph) {
    const nodeById = new Map();

    for (let i = 0; i < graph.nodes.length; i++) {
      const node = graph.nodes[i];
      nodeById.set(node.id, node);
    }

    const validLinks = [];
    for (let i = 0; i < graph.links.length; i++) {
      const link = graph.links[i];
      if (typeof link.source === "string") {
        link.source = nodeById.get(link.source);
      }
      if (typeof link.target === "string") {
        link.target = nodeById.get(link.target);
      }
      if (link.source != null && link.target != null) {
        validLinks.push(link);
      }
    }
    graph.links = validLinks;
  }

  hasCommonOwners(articleModel) {
    return (articleModel?.investigationModel?.commonOwnerEntities?.size ?? 0) > 0;
  }

  buildGraphData(articleModel) {
    const nodes = [];
    const links = [];
    const seenNodeIds = new Set();
    const seenLinkIds = new Set();
    const hasDirectSubjectOwnership = articleModel.subjectTree?.getOwnershipChain?.().length === 2;
    const hasDirectNewsOwnership = articleModel.newsSiteTree?.getOwnershipChain?.().length === 2;

    const addNode = (node) => {
      if (node == null || seenNodeIds.has(node.id)) {
        return;
      }

      node.hoverScale = 1;
      node.targetHoverScale = 1;
      seenNodeIds.add(node.id);
      nodes.push(node);
    };

    const addLink = (link) => {
      if (link == null || seenLinkIds.has(link.id)) {
        return;
      }

      link.hoverScale = 1;
      link.targetHoverScale = 1;
      seenLinkIds.add(link.id);
      links.push(link);
    };

    addNode(this.createNode("top-owner", articleModel.investigationModel?.topOwner, "topOwner", "Top owner", 56));
    addNode(this.createNode("article-subject", articleModel.articleSubject, "articleSubject", "Article subject", 52));
    addNode(this.createNode("news-site", articleModel.newsSite, "newsSite", "News site", 52));

    if (!hasDirectSubjectOwnership) {
      addLink({
        id: "top-owner-direct-article-subject",
        source: "top-owner",
        target: "article-subject",
        label: "owns",
        kind: "direct",
        data: {
          relation: "owns",
          source: articleModel.investigationModel?.topOwner,
          target: articleModel.articleSubject
        }
      });
    }

    if (!hasDirectNewsOwnership) {
      addLink({
        id: "top-owner-direct-news-site",
        source: "top-owner",
        target: "news-site",
        label: "owns",
        kind: "direct",
        data: {
          relation: "owns",
          source: articleModel.investigationModel?.topOwner,
          target: articleModel.newsSite
        }
      });
    }

    addLink({
      id: "news-site-direct-article-subject",
      source: "news-site",
      target: "article-subject",
      label: "wrote about",
      kind: "direct",
      data: {
        relation: "wrote about",
        source: articleModel.newsSite,
        target: articleModel.articleSubject
      }
    });

    this.addOwnershipChain(nodes, links, addNode, addLink, articleModel.newsSiteTree, "news-site", "news");
    this.addOwnershipChain(nodes, links, addNode, addLink, articleModel.subjectTree, "article-subject", "subject");

    return this.filterGraphForEvidence({ nodes, links, layout: "force" });
  }

  buildNoCommonOwnerGraphData(articleModel) {
    return this.filterGraphForEvidence(this.noCommonOwnerChart.build(articleModel, {
      width: this.width,
      height: this.height
    }));
  }

   filterGraphForEvidence(graph) {
    const keptLinks = [];
    for (let i = 0; i < graph.links.length; i++) {
      const link = graph.links[i];
      //if (link.kind === "direct" || relationshipHasCompleteEvidence(link.data)) {
        keptLinks.push(link);
     // }
    }

    const existingNodeIds = new Set();
    for (let i = 0; i < graph.nodes.length; i++) {
      existingNodeIds.add(graph.nodes[i].id);
    }

    const keptNodeIds = new Set(["article-subject", "news-site"].filter((id) => existingNodeIds.has(id)));
    const reverseChainLinksByTarget = new Map();

    for (let i = 0; i < keptLinks.length; i++) {
      const link = keptLinks[i];
      const sourceId = typeof link.source === "string" ? link.source : link.source?.id;
      const targetId = typeof link.target === "string" ? link.target : link.target?.id;

      if (link.kind === "direct") {
        if (sourceId != null && existingNodeIds.has(sourceId)) {
          keptNodeIds.add(sourceId);
        }
        if (targetId != null && existingNodeIds.has(targetId)) {
          keptNodeIds.add(targetId);
        }
        continue;
      }

      if (sourceId == null || targetId == null) {
        continue;
      }

      const incomingLinks = reverseChainLinksByTarget.get(targetId) ?? [];
      incomingLinks.push(sourceId);
      reverseChainLinksByTarget.set(targetId, incomingLinks);
    }

    const queue = ["article-subject", "news-site"].filter((id) => existingNodeIds.has(id));
    const visited = new Set(queue);
    while (queue.length > 0) {
      const currentTargetId = queue.shift();
      const incomingSourceIds = reverseChainLinksByTarget.get(currentTargetId) ?? [];

      for (let i = 0; i < incomingSourceIds.length; i++) {
        const sourceId = incomingSourceIds[i];
        if (existingNodeIds.has(sourceId)) {
          keptNodeIds.add(sourceId);
        }
        if (visited.has(sourceId)) {
          continue;
        }

        visited.add(sourceId);
        queue.push(sourceId);
      }
    }

    const fullyKeptLinks = [];
    for (let i = 0; i < keptLinks.length; i++) {
      const link = keptLinks[i];
      const sourceId = typeof link.source === "string" ? link.source : link.source?.id;
      const targetId = typeof link.target === "string" ? link.target : link.target?.id;
      if (sourceId == null || targetId == null) {
        continue;
      }

      if (!keptNodeIds.has(sourceId) || !keptNodeIds.has(targetId)) {
        continue;
      }

      fullyKeptLinks.push(link);
    }

    const keptNodes = [];
    for (let i = 0; i < graph.nodes.length; i++) {
      const node = graph.nodes[i];
      if (keptNodeIds.has(node.id)) {
        keptNodes.push(node);
      }
    }

    const filteredGraph = {
      ...graph,
      nodes: keptNodes,
      links: fullyKeptLinks
    };

    if (Array.isArray(graph.newsTopOwnerNodeIds)) {
      filteredGraph.newsTopOwnerNodeIds = graph.newsTopOwnerNodeIds.filter((nodeId) => keptNodeIds.has(nodeId));
    }

    if (graph.colorByRelationType != null) {
      const relationTypes = Array.from(new Set(fullyKeptLinks.map((link) => this.getRelationType(link)))).sort();
      const colorByRelationType = {};
      for (let i = 0; i < relationTypes.length; i++) {
        colorByRelationType[relationTypes[i]] = graph.colorByRelationType[relationTypes[i]];
      }
      filteredGraph.relationTypes = relationTypes;
      filteredGraph.colorByRelationType = colorByRelationType;
    }

    return filteredGraph;
  }

  addOwnershipChain(nodes, links, addNode, addLink, treeModel, targetId, chainKey) {
    if (treeModel == null || typeof treeModel.getOwnershipChain !== "function") {
      return;
    }

    const chain = treeModel.getOwnershipChain();
    if (Array.isArray(chain) === false || chain.length < 2) {
      return;
    }

    const intermediates = chain.slice(1, -1);
    const chainLength = intermediates.length;

    for (let i = 0; i < intermediates.length; i++) {
      const item = intermediates[i];
      addNode(this.createNode(
        `${chainKey}-owner-${item.entity?.id ?? i}`,
        item.entity,
        "ownerChain",
        "",
        30,
        { chainKey, chainIndex: i, chainLength }
      ));
    }

    for (let i = 1; i < chain.length; i++) {
      const previous = chain[i - 1];
      const current = chain[i];
      const sourceId = this.getChainNodeId(chainKey, previous.entity, i - 1, chain.length, "top-owner", targetId);
      const targetNodeId = this.getChainNodeId(chainKey, current.entity, i, chain.length, "top-owner", targetId);
      const relationLabel = current.relationship?.relation ?? "owns";

      addLink({
        id: `${chainKey}-relationship-${current.relationship?.id ?? `${sourceId}-${targetNodeId}`}`,
        source: sourceId,
        target: targetNodeId,
        label: relationLabel,
        kind: "chain",
        data: current.relationship ?? {
          relation: relationLabel,
          source_entity_id: previous.entity?.id,
          target_entity_id: current.entity?.id
        }
      });
    }
  }

  getChainNodeId(chainKey, entity, index, chainLength, topOwnerId, targetId) {
    if (index === 0) {
      return topOwnerId;
    }

    if (index === chainLength - 1) {
      return targetId;
    }

    return `${chainKey}-owner-${entity?.id ?? index}`;
  }

  createNode(id, entity, kind, meta, radius, extra = {}) {
    return {
      id,
      label: entity?.name ?? meta,
      meta,
      kind,
      radius,
      entityId: entity?.id ?? null,
      data: entity ?? null,
      ...extra
    };
  }
}

export { ArticleD3Graph };
