// import { Queue } from "./Queue.js";
const { Queue } = window[`apps_${performance.timeOrigin}`].modules.utils.Queue;

const getAppModules = () => window[`apps_${performance.timeOrigin}`]?.modules;

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
    ["thread", () => getAppModules().views.ThreadView.ThreadView],
    ["article_view", () => getAppModules().views.ArticleView.ArticleView],
    ["entity_view_new", () => getAppModules().views.EntityViewNew.EntityViewNew],
    ["relationship", () => getAppModules().views.RelationshipView.RelationshipView],
    ["arrow_relationship", () => getAppModules().views.ArrowRelationshipView.ArrowRelationshipView],
    ["ownership_chain", () => getAppModules().views.OwnershipChainView.OwnershipChainView],
    ["evidence", () => getAppModules().views.EvidenceView.EvidenceView],
    ["evidence_group", () => getAppModules().views.EvidenceGroupView.EvidenceGroupView],
    ["entity_view_big", () => getAppModules().views.EntityViewBig.EntityViewBig],
    ["owner_tree", () => getAppModules().views.OwnerTreeView.OwnerTreeView],
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
    const ViewCtorFactory = ViewPool.viewFactories.get(key);
    const ViewCtor = ViewCtorFactory?.();
    if (!ViewCtor) {
      throw new Error(`Unknown view key: ${key}`);
    }
    const tracked = new TrackedView(key, ViewCtor);
    tracked.create();
    return tracked;
  }

}

export { ViewPool };
