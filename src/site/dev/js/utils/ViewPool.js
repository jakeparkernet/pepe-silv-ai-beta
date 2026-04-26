import { NodeView } from "../views/NodeView.js";
import { EdgeView } from "../views/EdgeView.js";
import { Queue } from "./Queue.js";

import { DebugPlaneView } from "../views/DebugPlaneView.js";

import { EntityView } from "../views/EntityView.js";
import { JobView } from "../views/JobView.js";
import { ArticleAnalysisView } from "../views/ArticleAnalysisView.js";
import { StageView } from "../views/StageView.js";
import { BranchView } from "../views/BranchView.js";
import { StickyNoteView } from "../views/StickyNoteView.js";
import { StickyNotePileView } from "../views/StickyNotePileView.js";
import { SearchResultsView } from "../views/SearchResultsView.js";
import { FindOwnersView } from "../views/FindOwnersView.js";
import { ScrapeView } from "../views/ScrapeView.js";
import { JoinView } from "../views/JoinView.js";
import { LevelView } from "../views/LevelView.js";
import { ScrapeResultsLevelView } from "../views/ScrapeResultsLevelView.js";
import { OwnerTreeView } from "../views/OwnerTreeView.js";
import { ScrapeGroupView } from "../views/ScrapeGroupView.js";
import { FindOwnersFromPageDataView } from "../views/FindOwnersFromPageDataView.js";
import { OwnersGroupView } from "../views/OwnersGroupView.js";
import { IdentifyNewsSiteView } from "../views/IdentifyNewsSiteView.js";

import { ThreadView } from "../views/ThreadView.js";

import { ArticleView } from "../views/ArticleView.js";
import { EntityViewNew } from "../views/EntityViewNew.js";
import { RelationshipView } from "../views/RelationshipView.js";
import { ArrowRelationshipView } from "../views/ArrowRelationshipView.js";
import { InvestigationViewNew } from "../views/InvestigationViewNew.js";
import { OwnershipChainView } from "../views/OwnershipChainView.js";
import { EvidenceView } from "../views/EvidenceView.js";
import { EvidenceGroupView } from "../views/EvidenceGroupView.js";
import { EntityViewBig } from "../views/EntityViewBig.js";

class TrackedView {
  constructor(key, Ctor) {
    this.key = key;
    this.Ctor = Ctor;
    this.viewInstance = null;
    this.available = true;
  }

  create(params = {}) {
    this.viewInstance = new this.Ctor(params);
  }

  checkIn() {
    this.available = true;
    this.viewInstance.hide();
  }

  checkOut() {
    this.available = false;
    this.viewInstance.show();
  }
}

class ViewPool {
  // --- Static properties ---
  static availableViews = new Map();
  static unavailableByInstance = new Map();
  static viewFactories = new Map([
    ["node", NodeView],
    ["edge", EdgeView],
    ["debugPlane", DebugPlaneView],
    ["entity", EntityView],
    ["job", JobView],
    ["article_analysis", ArticleAnalysisView],
    ["stage", StageView],
    ["branch", BranchView],
    ["sticky", StickyNoteView],
    ["sticky_pile", StickyNotePileView],
    ["find_owners", FindOwnersView],
    ["search_results", SearchResultsView],
    ["scrape", ScrapeView],
    ["join", JoinView],
    ["level", LevelView],
    ["scrape_level", ScrapeResultsLevelView],
    ["thread", ThreadView],
    ["owner_tree", OwnerTreeView],
    ["scrape_group", ScrapeGroupView],
    ["find_owners_page_data", FindOwnersFromPageDataView],
    ["owners_group", OwnersGroupView],
    ["identify_news_site", IdentifyNewsSiteView],
    ["article_view", ArticleView],
    ["entity_view_new", EntityViewNew],
    ["relationship", RelationshipView],
    ["arrow_relationship", ArrowRelationshipView],
    ["investigation", InvestigationViewNew],
    ["ownership_chain", OwnershipChainView],
    ["evidence", EvidenceView],
    ["evidence_group", EvidenceGroupView],
    ["entity_view_big", EntityViewBig],
  ]);

  // Initialize queues for each view type
  static {
    for (const key of ViewPool.viewFactories.keys()) {
      ViewPool.availableViews.set(key, new Queue());
    }
  }

  // --- Static methods ---
  static getView(key) {
    const queue = ViewPool.availableViews.get(key);
    if (!queue) {
      throw new Error(`Unknown view key: ${key}`);
    }

    let trackedView;
    if (queue.isEmpty()) {
      trackedView = ViewPool.generateTrackedView(key);
    } else {
      trackedView = queue.dequeue();
    }

    trackedView.checkOut();
    ViewPool.unavailableByInstance.set(trackedView.viewInstance, trackedView);

    return trackedView.viewInstance;
  }

  static returnView(view) {
    const trackedView = ViewPool.unavailableByInstance.get(view);
    if (!trackedView) return;

    trackedView.checkIn();
    ViewPool.unavailableByInstance.delete(view);

    const queue = ViewPool.availableViews.get(trackedView.key);
    if (!queue) {
      throw new Error(`No queue found for key: ${trackedView.key}`);
    }
    queue.enqueue(trackedView);
  }

  static generateTrackedView(key) {
    const ViewCtor = ViewPool.viewFactories.get(key);
    if (!ViewCtor) {
      throw new Error(`Unknown view key: ${key}`);
    }
    const tracked = new TrackedView(key, ViewCtor);
    tracked.create();
    return tracked;
  }

  static test() {
    const nodeViews = [];
    const edgeViews = [];

    for (let i = 0; i < 2; i++) {
      nodeViews.push(ViewPool.getView("node"));
      edgeViews.push(ViewPool.getView("edge"));
    }

    ViewPool.returnView(nodeViews[0]);
    ViewPool.returnView(edgeViews[0]);

    const nodeView = ViewPool.getView("node");
    if (!nodeViews.includes(nodeView)) nodeViews.push(nodeView);

    const edgeView = ViewPool.getView("edge");
    if (!edgeViews.includes(edgeView)) edgeViews.push(edgeView);

    console.log(
      `NodeView length: ${nodeViews.length}, EdgeView length: ${edgeViews.length}`
    );
  }
}

export { ViewPool };
