import { Queue } from "./Queue.js";

import { ThreadView } from "../views/ThreadView.js";

import { ArticleView } from "../views/ArticleView.js";
import { EntityViewNew } from "../views/EntityViewNew.js";
import { RelationshipView } from "../views/RelationshipView.js";
import { ArrowRelationshipView } from "../views/ArrowRelationshipView.js";
import { OwnershipChainView } from "../views/OwnershipChainView.js";
import { EvidenceView } from "../views/EvidenceView.js";
import { EvidenceGroupView } from "../views/EvidenceGroupView.js";
import { EntityViewBig } from "../views/EntityViewBig.js";
import { OwnerTreeView } from "../views/OwnerTreeView.js";

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
    ["thread", ThreadView],
    ["article_view", ArticleView],
    ["entity_view_new", EntityViewNew],
    ["relationship", RelationshipView],
    ["arrow_relationship", ArrowRelationshipView],
    ["ownership_chain", OwnershipChainView],
    ["evidence", EvidenceView],
    ["evidence_group", EvidenceGroupView],
    ["entity_view_big", EntityViewBig],
    ["owner_tree", OwnerTreeView],
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

}

export { ViewPool };
