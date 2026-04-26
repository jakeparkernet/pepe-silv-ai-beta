import { View } from "./View.js";
import { ViewPool } from "../utils/ViewPool.js";
import * as THREE from "three";
import { RelationshipModel } from "../models/RelationshipModel.js";
import { createSeededRandom, getRadialPoints, getPointOnBoxFromCenter } from "../utils/pointUtils.js";
import { Paper, PAPER_TEXTURE_PATHS } from "../components/Paper.js";
import { Corkboard } from "../components/Corkboard.js";
import { InputService } from "../services/InputService.js";

const ARTICLE_BACKGROUND_PAPER_COUNT = 512;
const ARTICLE_BACKGROUND_STACK_STEP = 0.0001;
const ARTICLE_BACKGROUND_TINT_SEED = "article-paper-tint";
const ARTICLE_CORKBOARD_PADDING = {
  x: 18,
  y: 12
};
const ARTICLE_BACKGROUND_GRID_CONFIG = {
  overflowXFactor: 1.2,
  overflowYFactor: 1.2,
  cellWidth: 8,
  cellHeight: 8,
  noiseRangeX: [0.8, 3.2],
  noiseRangeY: [0.8, 2.6]
};
const ARTICLE_ARROW_RANDOM_RANGES = {
  scale: [1.69, 2.69],
  nudgeFrom: [-0.5, 0],
  nudgeTo: [0, 0]
};
const ARTICLE_BACKGROUND_TINT_SWATCHES = [
  "#f6eee3",
  "#eee7d7",
  "#e5decf",
  "#fdfbfb",
  "#fbfdfb",
  "#fdfdff",
  "#fdf9f9",
  "#fdfbfb"
].map((hex) => new THREE.Color(hex));
const ARTICLE_BACKGROUND_TINT_VARIATION = {
  h: 0.004,
  s: 0.01,
  l: 0.01
};
const ARTICLE_BACKGROUND_TINT_DARKEN = 0.7;
const ARTICLE_BACKGROUND_TEXTURE_INTENSITY_RANGE = {
  min: 0.18,
  max: 0.92
};
const ARTICLE_NO_COMMON_OWNER_LAYOUT = {
  articleSubject: new THREE.Vector3(-18, -9, 0),
  newsSite: new THREE.Vector3(18, -9, 0)
};

function createPaperTint(random) {
  const color =
    ARTICLE_BACKGROUND_TINT_SWATCHES[
      Math.floor(random() * ARTICLE_BACKGROUND_TINT_SWATCHES.length)
    ].clone();
  const hsl = {};

  color.getHSL(hsl);

  hsl.h += (random() - 0.5) * ARTICLE_BACKGROUND_TINT_VARIATION.h;
  hsl.s = THREE.MathUtils.clamp(
    hsl.s + (random() - 0.5) * ARTICLE_BACKGROUND_TINT_VARIATION.s,
    0,
    1
  );
  hsl.l = THREE.MathUtils.clamp(
    hsl.l + (random() - 0.5) * ARTICLE_BACKGROUND_TINT_VARIATION.l,
    0,
    1
  );

  color.setHSL(hsl.h, hsl.s, hsl.l);
  color.multiplyScalar(ARTICLE_BACKGROUND_TINT_DARKEN);
  return color;
}

function randomInRange(random, min, max) {
  return min + ((max - min) * random());
}

function shuffleArrayInPlace(items, random) {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const temp = items[i];
    items[i] = items[j];
    items[j] = temp;
  }

  return items;
}

class ArticleView extends View {

  constructor () {
    super();

    this.update = this.update.bind(this);
    this.ensurePrimaryViews = this.ensurePrimaryViews.bind(this);
    this.updateOwnershipChainPath = this.updateOwnershipChainPath.bind(this);
    this.updateOwnershipTreePath = this.updateOwnershipTreePath.bind(this);
    this.syncLayoutWorldMatrices = this.syncLayoutWorldMatrices.bind(this);
    this.refreshTreeViewsFromD3Positions = this.refreshTreeViewsFromD3Positions.bind(this);
    this.refreshBackgroundFromCurrentLayout = this.refreshBackgroundFromCurrentLayout.bind(this);
    this.generateBackgroundCorkboard = this.generateBackgroundCorkboard.bind(this);
    this.generateMidgroundPapers = this.generateMidgroundPapers.bind(this);
    this.getOwnershipChainBounds = this.getOwnershipChainBounds.bind(this);
    this.updateCorkboardFromChains = this.updateCorkboardFromChains.bind(this);
    this.getEntityConnectionPoints = this.getEntityConnectionPoints.bind(this);
    this.getArrowLayout = this.getArrowLayout.bind(this);
    this.setLabelsVisible = this.setLabelsVisible.bind(this);
    this.resetPooledView = this.resetPooledView.bind(this);
    this.cleanupDynamicViews = this.cleanupDynamicViews.bind(this);
    this.setViewVisibility = this.setViewVisibility.bind(this);
    this.getOwnedViews = this.getOwnedViews.bind(this);
    this.hasCommonOwners = this.hasCommonOwners.bind(this);
    this.setD3OwnershipPositions = this.setD3OwnershipPositions.bind(this);

    this.d3Positions = null;
    this.d3Scale = 0.001;

    this.generateBackgroundCorkboard();

    this.backgroundContainer = new THREE.Group();
    this.addToRoot(this.backgroundContainer, { resetScale: false, resetTransform: false });
    this.papers = [];
    this.paperSeed = null;
    this.paperPlacementKey = null;
    this.clickColliders = [];

    this.ownershipChainLayout = {
      lateralOffset: 8,
      pivotLateralOffset: 12,
      pivotVerticalOffset: -4,
      topLateralSpread: -16.9,
      topVerticalFlatten: 5,
      topSpreadFalloff: 1.35,
      pointNoiseX: 2.5,
      pointNoiseY: 2
    };
  }

  setLabelsVisible(visible = true) {
    this.topOwnerToArticleSubjectRelationship?.setLabelsVisible?.(visible);
    this.topOwnerToNewsSiteRelationship?.setLabelsVisible?.(visible);
    this.newsSiteToArticleSubjectRelationship?.setLabelsVisible?.(visible);
    this.newsSiteTreeView?.setLabelsVisible?.(visible);
    this.subjectTreeView?.setLabelsVisible?.(visible);
  }

  resetPooledView(viewKey) {
    const view = this[viewKey];
    if (view == null) {
      return;
    }

    view.cleanupDynamicViews?.();
    view.resetEnds?.();
    ViewPool.returnView(view);
    this[viewKey] = null;
  }

  setViewVisibility(view, visible) {
    if (view == null) {
      return;
    }

    view.__articleViewDesiredVisible = !!visible;

    if (visible) {
      view.show?.();
      if (typeof view.show !== "function") {
        view.getRootGroup().visible = true;
      }
      return;
    }

    view.hide?.();
    if (typeof view.hide !== "function") {
      view.getRootGroup().visible = false;
    }
  }

  getOwnedViews() {
    return [
      this.topOwnerView,
      this.articleSubjectView,
      this.newsSiteView,
      this.newsSiteTreeView,
      this.subjectTreeView,
      this.topOwnerToArticleSubjectRelationship,
      this.topOwnerToNewsSiteRelationship,
      this.newsSiteToArticleSubjectRelationship
    ].filter(Boolean);
  }

  cleanupDynamicViews() {
    for (let i = 0; i < this.clickColliders.length; i++) {
      InputService.unregisterCollider(this.clickColliders[i]);
    }
    this.clickColliders = [];

    this.resetPooledView("topOwnerView");
    this.resetPooledView("articleSubjectView");
    this.resetPooledView("newsSiteView");
    this.resetPooledView("newsSiteTreeView");
    this.resetPooledView("subjectTreeView");
    this.resetPooledView("topOwnerToArticleSubjectRelationship");
    this.resetPooledView("topOwnerToNewsSiteRelationship");
    this.resetPooledView("newsSiteToArticleSubjectRelationship");
  }

  show() {
    super.show();

    const ownedViews = this.getOwnedViews();
    for (let i = 0; i < ownedViews.length; i++) {
      const view = ownedViews[i];
      this.setViewVisibility(view, view.__articleViewDesiredVisible !== false);
    }

    for (let i = 0; i < this.papers.length; i++) {
      this.papers[i]?.show?.();
    }
  }

  hide() {
    const ownedViews = this.getOwnedViews();
    for (let i = 0; i < ownedViews.length; i++) {
      ownedViews[i]?.hide?.();
    }

    for (let i = 0; i < this.papers.length; i++) {
      this.papers[i]?.hide?.();
    }

    super.hide();
  }

  hasCommonOwners() {
    return (this.model?.investigationModel?.commonOwnerEntities?.size ?? 0) > 0;
  }

  getArrowLayout(key) {
    const seedBase = this.model?.url ?? this.model?.article?.url ?? "article-arrow-default";
    const random = createSeededRandom(`article-arrow:${seedBase}:${key}`);

    return {
      scale: randomInRange(random, ARTICLE_ARROW_RANDOM_RANGES.scale[0], ARTICLE_ARROW_RANDOM_RANGES.scale[1]),
      nudgeFrom: randomInRange(random, ARTICLE_ARROW_RANDOM_RANGES.nudgeFrom[0], ARTICLE_ARROW_RANDOM_RANGES.nudgeFrom[1]),
      nudgeTo: randomInRange(random, ARTICLE_ARROW_RANDOM_RANGES.nudgeTo[0], ARTICLE_ARROW_RANDOM_RANGES.nudgeTo[1])
    };
  }

  getEntityConnectionPoints(fromView, toView) {
    const fromCenter = fromView.getRootGroup().position.clone();
    const toCenter = toView.getRootGroup().position.clone();
    const direction = toCenter.clone().sub(fromCenter);

    if (direction.lengthSq() <= 1e-8) {
      return {
        fromPoint: fromCenter,
        toPoint: toCenter
      };
    }

    const fromDir = direction.clone().normalize();
    const toDir = fromDir.clone().negate();
    const fromDimensions = fromView.getDimensions();
    const toDimensions = toView.getDimensions();

    return {
      fromPoint: getPointOnBoxFromCenter(
        fromCenter,
        fromDimensions.width,
        fromDimensions.height,
        fromDir
      ),
      toPoint: getPointOnBoxFromCenter(
        toCenter,
        toDimensions.width,
        toDimensions.height,
        toDir
      )
    };
  }

  generateBackgroundCorkboard () {
    this.corkboard = new Corkboard();
    this.corkboard.getRootGroup().position.setComponent(2, -1);
    this.addToRoot(this.corkboard.getRootGroup(), {
      resetScale: false,
      resetTransform: false
    });
  }

  generateMidgroundPapers (seed = "article-paper-default") {
    this.paperSeed = seed;
    const corkboardSize = this.corkboard.getSize();
    const corkboardCenter = this.corkboard.getRootGroup().position.clone();
    const placementKey = [
      seed,
      corkboardSize.x.toFixed(3),
      corkboardSize.y.toFixed(3),
      corkboardCenter.x.toFixed(3),
      corkboardCenter.y.toFixed(3)
    ].join(":");

    if (this.paperPlacementKey === placementKey) {
      return;
    }

    this.paperPlacementKey = placementKey;
    this.papers.forEach((paper) => paper.dispose?.());
    this.papers = [];
    this.backgroundContainer.clear();
    this.backgroundContainer.position.copy(corkboardCenter);

    const randomTint = createSeededRandom(`${ARTICLE_BACKGROUND_TINT_SEED}:${seed}`);
    const randomLayout = createSeededRandom(`article-paper-grid:${placementKey}`);
    const layoutWidth = corkboardSize.x * ARTICLE_BACKGROUND_GRID_CONFIG.overflowXFactor;
    const layoutHeight = corkboardSize.y * ARTICLE_BACKGROUND_GRID_CONFIG.overflowYFactor;
    const columns = Math.max(1, Math.ceil(layoutWidth / ARTICLE_BACKGROUND_GRID_CONFIG.cellWidth));
    const rows = Math.max(1, Math.ceil(layoutHeight / ARTICLE_BACKGROUND_GRID_CONFIG.cellHeight));
    const actualCellWidth = layoutWidth / columns;
    const actualCellHeight = layoutHeight / rows;
    const startX = -layoutWidth * 0.5 + (actualCellWidth * 0.5);
    const startY = -layoutHeight * 0.5 + (actualCellHeight * 0.5);
    const gridPoints = [];

    for (let row = 0; row < rows; row++) {
      for (let column = 0; column < columns; column++) {
        const baseX = startX + (column * actualCellWidth);
        const baseY = startY + (row * actualCellHeight);
        const noiseX = randomInRange(
          randomLayout,
          ARTICLE_BACKGROUND_GRID_CONFIG.noiseRangeX[0],
          ARTICLE_BACKGROUND_GRID_CONFIG.noiseRangeX[1]
        );
        const noiseY = randomInRange(
          randomLayout,
          ARTICLE_BACKGROUND_GRID_CONFIG.noiseRangeY[0],
          ARTICLE_BACKGROUND_GRID_CONFIG.noiseRangeY[1]
        );

        gridPoints.push(new THREE.Vector3(
          baseX + ((randomLayout() - 0.5) * 2 * noiseX),
          baseY + ((randomLayout() - 0.5) * 2 * noiseY),
          0
        ));
      }
    }

    shuffleArrayInPlace(gridPoints, randomLayout);

    for (let i = 0; i < Math.min(ARTICLE_BACKGROUND_PAPER_COUNT, gridPoints.length); i++) {
      const paper = new Paper({
        tiltOptions: {
          tiltRangeMin: -16.9,
          tiltRangeMax: 16.9,
        },
        tint: createPaperTint(randomTint),
        texture: Math.floor(randomLayout() * PAPER_TEXTURE_PATHS.length),
        textureIntensity: randomInRange(
          randomLayout,
          ARTICLE_BACKGROUND_TEXTURE_INTENSITY_RANGE.min,
          ARTICLE_BACKGROUND_TEXTURE_INTENSITY_RANGE.max
        )
      });
      const paperRoot = paper.getRootGroup();
      const point = gridPoints[i];

      point.z = -0.01 - (i * ARTICLE_BACKGROUND_STACK_STEP);
      paperRoot.position.copy(point);
      paperRoot.updateMatrix();
      paperRoot.matrixAutoUpdate = false;
      this.backgroundContainer.add(paperRoot);
      this.papers.push(paper);

      if (this.getRootGroup().visible === false) {
        paper.hide?.();
      }
    }

    this.backgroundContainer.position.setComponent(2, 0);
  }

  getOwnershipChainBounds() {
    if (this.hasCommonOwners()) {
      const chainBounds = [];

      if (this.newsSiteTreeView && typeof this.newsSiteTreeView.getChainBounds === "function") {
        const bounds = this.newsSiteTreeView.getChainBounds(this.getRootGroup());
        if (bounds) {
          chainBounds.push(bounds);
        }
      }

      if (this.subjectTreeView && typeof this.subjectTreeView.getChainBounds === "function") {
        const bounds = this.subjectTreeView.getChainBounds(this.getRootGroup());
        if (bounds) {
          chainBounds.push(bounds);
        }
      }

      if (chainBounds.length === 0) {
        return null;
      }

      return chainBounds.reduce((combinedBounds, nextBounds) => ({
        minX: Math.min(combinedBounds.minX, nextBounds.minX),
        maxX: Math.max(combinedBounds.maxX, nextBounds.maxX),
        minY: Math.min(combinedBounds.minY, nextBounds.minY),
        maxY: Math.max(combinedBounds.maxY, nextBounds.maxY)
      }));
    }

    const treeBounds = [
      this.newsSiteTreeView?.getEntityPositionBounds?.(this.getRootGroup()),
      this.subjectTreeView?.getEntityPositionBounds?.(this.getRootGroup())
    ].filter(Boolean);

    if (treeBounds.length === 0) {
      return null;
    }

    const bounds = treeBounds.reduce((combinedBounds, nextBounds) => ({
      minX: Math.min(combinedBounds.minX, nextBounds.minX),
      maxX: Math.max(combinedBounds.maxX, nextBounds.maxX),
      minY: Math.min(combinedBounds.minY, nextBounds.minY),
      maxY: Math.max(combinedBounds.maxY, nextBounds.maxY)
    }));

    return bounds;
  }

  updateCorkboardFromChains() {
    const chainBounds = this.getOwnershipChainBounds();
    if (chainBounds == null) {
      return false;
    }

    const width = Math.max(1, (chainBounds.maxX - chainBounds.minX) + (ARTICLE_CORKBOARD_PADDING.x * 2));
    const height = Math.max(1, (chainBounds.maxY - chainBounds.minY) + (ARTICLE_CORKBOARD_PADDING.y * 2));
    const centerX = (chainBounds.minX + chainBounds.maxX) * 0.5;
    const centerY = (chainBounds.minY + chainBounds.maxY) * 0.5;

    this.corkboard.setDimensions(width, height);
    this.corkboard.getRootGroup().position.set(centerX, centerY, -0.25);
    return true;
  }

  ensurePrimaryViews(showCommonOwnerMode, entityViewPoints) {
    if (this.topOwnerView == null) {
      this.topOwnerView = ViewPool.getView("entity_view_big");
      this.addToRoot(this.topOwnerView.getRootGroup());
      if (entityViewPoints) {
        this.topOwnerView.getRootGroup().position.copy(entityViewPoints[0]);
      }
    }
    if (showCommonOwnerMode) {
      this.topOwnerView.setModel(this.model.investigationModel.topOwner);
      this.topOwnerView.getRootGroup().position.copy(entityViewPoints[0]);
    }
    this.setViewVisibility(this.topOwnerView, showCommonOwnerMode);

    if (this.articleSubjectView == null) {
      this.articleSubjectView = ViewPool.getView("entity_view_big");
      this.addToRoot(this.articleSubjectView.getRootGroup());
    }
    this.articleSubjectView.setModel(this.model.articleSubject);
    this.articleSubjectView.getRootGroup().position.copy(
      showCommonOwnerMode ? entityViewPoints[1] : ARTICLE_NO_COMMON_OWNER_LAYOUT.articleSubject
    );

    if (this.newsSiteView == null) {
      this.newsSiteView = ViewPool.getView("entity_view_big");
      this.addToRoot(this.newsSiteView.getRootGroup());
    }
    this.newsSiteView.setModel(this.model.newsSite);
    this.newsSiteView.getRootGroup().position.copy(
      showCommonOwnerMode ? entityViewPoints[2] : ARTICLE_NO_COMMON_OWNER_LAYOUT.newsSite
    );
  }

  updateOwnershipChainPath() {

    if (this.newsSiteTreeView && typeof this.newsSiteTreeView.setEnds !== "function") {
      this.resetPooledView("newsSiteTreeView");
    }
    if (this.subjectTreeView && typeof this.subjectTreeView.setEnds !== "function") {
      this.resetPooledView("subjectTreeView");
    }

    if (this.newsSiteTreeView == null) {
      this.newsSiteTreeView = ViewPool.getView("ownership_chain");
      this.newsSiteTreeView.setEnds(this.topOwnerView, this.newsSiteView, -1);
      this.newsSiteTreeView.setLayoutOptions({
        ...this.ownershipChainLayout,
        lateralOffset: this.ownershipChainLayout.lateralOffset,
        pivotLateralOffset: this.ownershipChainLayout.pivotLateralOffset
      });
      this.addToRoot(this.newsSiteTreeView.getRootGroup());
    }
    this.newsSiteTreeView.setModel(this.model.newsSiteTree);

    if (this.subjectTreeView == null) {
      this.subjectTreeView = ViewPool.getView("ownership_chain");
      this.subjectTreeView.setEnds(this.topOwnerView, this.articleSubjectView, 1);
      this.subjectTreeView.setLayoutOptions({
        ...this.ownershipChainLayout,
        lateralOffset: this.ownershipChainLayout.lateralOffset,
        pivotLateralOffset: this.ownershipChainLayout.pivotLateralOffset
      });
      this.addToRoot(this.subjectTreeView.getRootGroup());
    }
    this.subjectTreeView.setModel(this.model.subjectTree);

    if (this.topOwnerToArticleSubjectRelationship == null) {
      const arrowLayout = this.getArrowLayout("top-owner-to-article-subject");
      this.topOwnerToArticleSubjectRelationship = ViewPool.getView("arrow_relationship");
      this.topOwnerToArticleSubjectRelationship.setArrowScale(arrowLayout.scale);
      this.topOwnerToArticleSubjectRelationship.setEndpointNudges(arrowLayout.nudgeFrom, arrowLayout.nudgeTo);
      this.topOwnerToArticleSubjectRelationship.setTapeLabelFlip(true);
      this.addToRoot(this.topOwnerToArticleSubjectRelationship.getRootGroup());
      this.topOwnerToArticleSubjectRelationship.setModel(new RelationshipModel({ relation: "owns" }));
    }
    const topOwnerToArticleSubjectPoints = this.getEntityConnectionPoints(this.topOwnerView, this.articleSubjectView);
    this.topOwnerToArticleSubjectRelationship.setEndpoints(
      topOwnerToArticleSubjectPoints.fromPoint,
      topOwnerToArticleSubjectPoints.toPoint
    );
    this.topOwnerToArticleSubjectRelationship.getRootGroup().position.setComponent(2, 0.01);

    if (this.topOwnerToNewsSiteRelationship == null) {
      const arrowLayout = this.getArrowLayout("top-owner-to-news-site");
      this.topOwnerToNewsSiteRelationship = ViewPool.getView("arrow_relationship");
      this.topOwnerToNewsSiteRelationship.setArrowScale(arrowLayout.scale);
      this.topOwnerToNewsSiteRelationship.setEndpointNudges(arrowLayout.nudgeFrom, arrowLayout.nudgeTo);
      this.topOwnerToNewsSiteRelationship.setTapeLabelMirrored(false);
      this.addToRoot(this.topOwnerToNewsSiteRelationship.getRootGroup());
      this.topOwnerToNewsSiteRelationship.setModel(new RelationshipModel({ relation: "owns" }));
    }
    const topOwnerToNewsSitePoints = this.getEntityConnectionPoints(this.topOwnerView, this.newsSiteView);
    this.topOwnerToNewsSiteRelationship.setEndpoints(
      topOwnerToNewsSitePoints.fromPoint,
      topOwnerToNewsSitePoints.toPoint
    );
    this.topOwnerToNewsSiteRelationship.getRootGroup().position.setComponent(2, 0.01);

    if (this.newsSiteToArticleSubjectRelationship == null) {
      const arrowLayout = this.getArrowLayout("news-site-to-article-subject");
      this.newsSiteToArticleSubjectRelationship = ViewPool.getView("arrow_relationship");
      this.newsSiteToArticleSubjectRelationship.setArrowScale(arrowLayout.scale);
      this.newsSiteToArticleSubjectRelationship.setEndpointNudges(arrowLayout.nudgeFrom, arrowLayout.nudgeTo);
      this.newsSiteToArticleSubjectRelationship.setTapeLabelMirrored(true);
      this.addToRoot(this.newsSiteToArticleSubjectRelationship.getRootGroup());
      this.newsSiteToArticleSubjectRelationship.setModel(new RelationshipModel({ relation: "wrote about" }));
    }
    const newsSiteToArticleSubjectPoints = this.getEntityConnectionPoints(this.newsSiteView, this.articleSubjectView);
    this.newsSiteToArticleSubjectRelationship.setEndpoints(
      newsSiteToArticleSubjectPoints.fromPoint,
      newsSiteToArticleSubjectPoints.toPoint
    );
    this.newsSiteToArticleSubjectRelationship.getRootGroup().position.setComponent(2, 0.01);

    this.setViewVisibility(this.topOwnerToArticleSubjectRelationship, true);
    this.setViewVisibility(this.topOwnerToNewsSiteRelationship, true);
    this.setViewVisibility(this.newsSiteToArticleSubjectRelationship, true);

    return true;
  }

  updateOwnershipTreePath() {
    if (this.newsSiteTreeView && typeof this.newsSiteTreeView.setTarget !== "function") {
      this.resetPooledView("newsSiteTreeView");
    }
    if (this.subjectTreeView && typeof this.subjectTreeView.setTarget !== "function") {
      this.resetPooledView("subjectTreeView");
    }

    if (this.newsSiteTreeView == null) {
      this.newsSiteTreeView = ViewPool.getView("owner_tree");
      this.newsSiteTreeView.setTargetPosition(ARTICLE_NO_COMMON_OWNER_LAYOUT.newsSite);
      this.newsSiteTreeView.setTarget(this.newsSiteView, 1);
      this.newsSiteTreeView.setLayoutOptions({
        levelSpacingY: 11,
        minNodeSpacingX: 12,
        levelBiasX: 1.5
      });
      this.addToRoot(this.newsSiteTreeView.getRootGroup());
    }

    if (this.subjectTreeView == null) {
      this.subjectTreeView = ViewPool.getView("owner_tree");
      this.subjectTreeView.setTarget(this.articleSubjectView, -1);
      this.subjectTreeView.setLayoutOptions({
        levelSpacingY: 11,
        minNodeSpacingX: 12,
        levelBiasX: 1.5
      });
      this.addToRoot(this.subjectTreeView.getRootGroup());
    }

    if (this.newsSiteToArticleSubjectRelationship == null) {
      const arrowLayout = this.getArrowLayout("news-site-to-article-subject");
      this.newsSiteToArticleSubjectRelationship = ViewPool.getView("arrow_relationship");
      this.newsSiteToArticleSubjectRelationship.setArrowScale(arrowLayout.scale);
      this.newsSiteToArticleSubjectRelationship.setEndpointNudges(arrowLayout.nudgeFrom, arrowLayout.nudgeTo);
      this.newsSiteToArticleSubjectRelationship.setTapeLabelMirrored(true);
      this.addToRoot(this.newsSiteToArticleSubjectRelationship.getRootGroup());
      this.newsSiteToArticleSubjectRelationship.setModel(new RelationshipModel({ relation: "wrote about" }));
    }
    const newsSiteToArticleSubjectPoints = this.getEntityConnectionPoints(this.newsSiteView, this.articleSubjectView);
    this.newsSiteToArticleSubjectRelationship.setEndpoints(
      newsSiteToArticleSubjectPoints.fromPoint,
      newsSiteToArticleSubjectPoints.toPoint
    );
    this.newsSiteToArticleSubjectRelationship.getRootGroup().position.setComponent(2, 0.01);

    // Defer tree view updates until D3 positions are available.
    this.newsSiteTreeView.model = this.model.newsSiteTree;
    this.subjectTreeView.model = this.model.subjectTree;

    this.setViewVisibility(this.topOwnerToArticleSubjectRelationship, false);
    this.setViewVisibility(this.topOwnerToNewsSiteRelationship, false);
    this.setViewVisibility(this.newsSiteToArticleSubjectRelationship, true);

    return this.refreshTreeViewsFromD3Positions();
  }

  refreshTreeViewsFromD3Positions() {
    if (this.d3Positions == null) {
      return false;
    }

    const scale = this.d3Scale ?? 1;

    if (this.newsSiteTreeView != null && typeof this.newsSiteTreeView.setD3Positions === "function") {
      this.newsSiteTreeView.setD3Positions(this.d3Positions, scale);
      this.newsSiteTreeView.update();
    }

    if (this.subjectTreeView != null && typeof this.subjectTreeView.setD3Positions === "function") {
      this.subjectTreeView.setD3Positions(this.d3Positions, scale);
      this.subjectTreeView.update();
    }

    return true;
  }

  syncLayoutWorldMatrices(showCommonOwnerMode) {
    if (showCommonOwnerMode) {
      this.topOwnerView.getRootGroup().updateMatrixWorld(true);
    }
    this.articleSubjectView.getRootGroup().updateMatrixWorld(true);
    this.newsSiteView.getRootGroup().updateMatrixWorld(true);
    this.newsSiteTreeView?.getRootGroup?.().updateMatrixWorld(true);
    this.subjectTreeView?.getRootGroup?.().updateMatrixWorld(true);
    if (showCommonOwnerMode) {
      this.topOwnerToArticleSubjectRelationship.getRootGroup().updateMatrixWorld(true);
      this.topOwnerToNewsSiteRelationship.getRootGroup().updateMatrixWorld(true);
      this.newsSiteToArticleSubjectRelationship.getRootGroup().updateMatrixWorld(true);
    }
  }

  refreshBackgroundFromCurrentLayout(nextPaperSeed) {
    if (this.updateCorkboardFromChains()) {
      this.generateMidgroundPapers(nextPaperSeed);
      return true;
    }

    return false;
  }

  update() {
    super.update();

    for (let i = 0; i < this.clickColliders.length; i++) {
      InputService.unregisterCollider(this.clickColliders[i]);
    }
    this.clickColliders = [];

    const nextPaperSeed = this.model?.url ?? "article-paper-default";
    const showCommonOwnerMode = this.hasCommonOwners();
    let entityViewPoints = showCommonOwnerMode ? getRadialPoints(3, 15) : null;
    this.ensurePrimaryViews(showCommonOwnerMode, entityViewPoints);
    const layoutReady = showCommonOwnerMode
      ? this.updateOwnershipChainPath()
      : this.updateOwnershipTreePath();

    const registerClickableSurface = (owner, collider, surface) => {
      if (collider == null) {
        return;
      }

      this.clickColliders.push(collider);
      InputService.registerCollider({
        onClick: (payload) => owner.onClick({ ...payload, surface })
      }, collider);
    };

    if (layoutReady) {
      this.syncLayoutWorldMatrices(showCommonOwnerMode);
      this.refreshBackgroundFromCurrentLayout(nextPaperSeed);
    }

    if (showCommonOwnerMode) {
      registerClickableSurface(this.topOwnerView, this.topOwnerView.getTextCollider(), "text");
    }
    registerClickableSurface(this.articleSubjectView, this.articleSubjectView.getTextCollider(), "text");
    registerClickableSurface(this.newsSiteView, this.newsSiteView.getTextCollider(), "text");
  }

  setD3OwnershipPositions(positions, scale = 0.001) {
    this.d3Positions = positions;
    this.d3Scale = scale;

    if (this.hasCommonOwners()) {
      return;
    }

    if (this.refreshTreeViewsFromD3Positions()) {
      this.syncLayoutWorldMatrices(false);
      const nextPaperSeed = this.model?.url ?? "article-paper-default";
      this.refreshBackgroundFromCurrentLayout(nextPaperSeed);
    }
  }

  setOwnerTreePositionOffset(x, y) {
    this.newsSiteTreeView?.setD3PositionOffset?.(x, y);
    this.subjectTreeView?.setD3PositionOffset?.(x, y);
    this.newsSiteTreeView?.update?.();
    this.subjectTreeView?.update?.();
  }
}

export { ArticleView };
