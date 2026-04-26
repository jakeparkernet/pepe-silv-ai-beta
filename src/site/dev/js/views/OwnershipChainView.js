import { View } from "./View.js";
import { ViewPool } from "../utils/ViewPool.js";
import * as THREE from "three";
import { RelationshipModel } from "../models/RelationshipModel.js";
import { createSeededRandom, getRadialPointsWithSpacing, getPointOnBoxFromCenter } from "../utils/pointUtils.js";
import { InputService } from "../services/InputService.js";

class OwnershipChainView extends View {

  constructor (){
    super();

    this.cleanupDynamicViews = this.cleanupDynamicViews.bind(this);
    this.entityColliders = [];
    this.relationshipColliders = [];
    this.evidenceGroupViews = [];
    this.treeScale = 1;
    this.layoutOptions = {
      lateralOffset: 0,
      pivotLateralOffset: 0,
      pivotVerticalOffset: 0,
      topLateralSpread: 0,
      topVerticalFlatten: 0,
      topSpreadFalloff: 1.5,
      pointNoiseX: 0,
      pointNoiseY: 0,
      directRelationshipOffsetDistance: 8
    };
  }

  setEnds (parentCompanyView, childCompanydView, chirality) {
    this.parentCompanyView = parentCompanyView;
    this.childCompanyView = childCompanydView;
    this.chirality = chirality;
  }

  resetEnds () {
    this.parentCompanyView = null;
    this.childCompanyView = null;
  }

  setLayoutOptions(layoutOptions = {}) {
    this.layoutOptions = {
      ...this.layoutOptions,
      ...layoutOptions
    };
  }

  setLabelsVisible(visible = true) {
    if (Array.isArray(this.evidenceGroupViews)) {
      for (let i = 0; i < this.evidenceGroupViews.length; i++) {
        this.evidenceGroupViews[i]?.setLabelsVisible?.(visible);
      }
    }
  }

  show() {
    super.show();

    if (Array.isArray(this.ownerEntityViews)) {
      for (let i = 0; i < this.ownerEntityViews.length; i++) {
        const view = this.ownerEntityViews[i];
        if (view === this.parentCompanyView || view === this.childCompanyView) {
          continue;
        }

        view?.show?.();
      }
    }

    if (Array.isArray(this.ownerRelationshipViews)) {
      for (let i = 0; i < this.ownerRelationshipViews.length; i++) {
        this.ownerRelationshipViews[i]?.show?.();
      }
    }

    if (Array.isArray(this.evidenceGroupViews)) {
      for (let i = 0; i < this.evidenceGroupViews.length; i++) {
        this.evidenceGroupViews[i]?.show?.();
      }
    }
  }

  hide() {
    if (Array.isArray(this.ownerEntityViews)) {
      for (let i = 0; i < this.ownerEntityViews.length; i++) {
        const view = this.ownerEntityViews[i];
        if (view === this.parentCompanyView || view === this.childCompanyView) {
          continue;
        }

        view?.hide?.();
      }
    }

    if (Array.isArray(this.ownerRelationshipViews)) {
      for (let i = 0; i < this.ownerRelationshipViews.length; i++) {
        this.ownerRelationshipViews[i]?.hide?.();
      }
    }

    if (Array.isArray(this.evidenceGroupViews)) {
      for (let i = 0; i < this.evidenceGroupViews.length; i++) {
        this.evidenceGroupViews[i]?.hide?.();
      }
    }

    super.hide();
  }

  getChainBounds(referenceObject = null) {
    const views = [];

    if (this.parentCompanyView) {
      views.push(this.parentCompanyView);
    }

    if (Array.isArray(this.ownerEntityViews)) {
      for (let i = 0; i < this.ownerEntityViews.length; i++) {
        views.push(this.ownerEntityViews[i]);
      }
    }

    if (this.childCompanyView) {
      views.push(this.childCompanyView);
    }

    if (views.length === 0) {
      return null;
    }

    const bounds = {
      minX: Infinity,
      maxX: -Infinity,
      minY: Infinity,
      maxY: -Infinity
    };

    for (let i = 0; i < views.length; i++) {
      const view = views[i];
      if (view == null || typeof view.getDimensions !== "function") {
        continue;
      }

      const dimensions = view.getDimensions();
      const worldPos = view.getRootGroup().getWorldPosition(new THREE.Vector3());
      const position = referenceObject
        ? referenceObject.worldToLocal(worldPos)
        : worldPos;
      const halfWidth = dimensions.width * 0.5;
      const halfHeight = dimensions.height * 0.5;

      bounds.minX = Math.min(bounds.minX, position.x - halfWidth);
      bounds.maxX = Math.max(bounds.maxX, position.x + halfWidth);
      bounds.minY = Math.min(bounds.minY, position.y - halfHeight);
      bounds.maxY = Math.max(bounds.maxY, position.y + halfHeight);
    }

    if (Number.isFinite(bounds.minX) === false) {
      return null;
    }

    return bounds;
  }

  cleanupDynamicViews() {
    for (let i = 0; i < this.relationshipColliders.length; i++) {
      InputService.unregisterCollider(this.relationshipColliders[i]);
    }
    this.relationshipColliders = [];

    for (let i = 0; i < this.entityColliders.length; i++) {
      InputService.unregisterCollider(this.entityColliders[i]);
    }
    this.entityColliders = [];

    if (Array.isArray(this.ownerEntityViews)) {
      for (let i = 0; i < this.ownerEntityViews.length; i++) {
        const view = this.ownerEntityViews[i];
        if (view === this.parentCompanyView || view === this.childCompanyView) {
          continue;
        }

        ViewPool.returnView(view);
      }
    }
    this.ownerEntityViews = [];

    if (Array.isArray(this.ownerRelationshipViews)) {
      for (let i = 0; i < this.ownerRelationshipViews.length; i++) {
        ViewPool.returnView(this.ownerRelationshipViews[i]);
      }
    }
    this.ownerRelationshipViews = [];

    if (Array.isArray(this.evidenceGroupViews)) {
      for (let i = 0; i < this.evidenceGroupViews.length; i++) {
        this.evidenceGroupViews[i]?.cleanupDynamicViews?.();
        ViewPool.returnView(this.evidenceGroupViews[i]);
      }
    }
    this.evidenceGroupViews = [];
  }

  update () {
    const chainItems = this.model.getOwnershipChain();
    const occupiedEvidenceRects = [];

    if (this.ownerEntityViews == null) {
      this.ownerEntityViews = [];
    }

    if (this.ownerRelationshipViews == null) {
      this.ownerRelationshipViews = [];
    }

    this.cleanupDynamicViews();

    const parentPos = this.parentCompanyView.getRootGroup().position.clone();
    const childPos = this.childCompanyView.getRootGroup().position.clone();
    const sideSign = this.chirality === 0 ? 1 : Math.sign(this.chirality);
    const sideOffset = new THREE.Vector3(sideSign, 0, 0);
    const layoutStart = parentPos.clone().addScaledVector(sideOffset, this.layoutOptions.lateralOffset);
    const layoutEnd = childPos.clone().addScaledVector(sideOffset, this.layoutOptions.lateralOffset);
    let pivot = layoutStart.clone().add(layoutEnd).multiplyScalar(0.5);
    pivot.x += sideSign * this.layoutOptions.pivotLateralOffset;
    pivot.y += this.layoutOptions.pivotVerticalOffset;

    let viewPoints = getRadialPointsWithSpacing(layoutStart,
                                    layoutEnd,
                                    pivot,
                                    chainItems.length,
                                    20,
                                    this.chirality);

    const noiseSeedBase = `${this.model?.id ?? this.model?.name ?? "ownership-chain"}:${this.chirality}`;
    const pointNoiseRandom = createSeededRandom(noiseSeedBase);

    for (let i = 1; i < viewPoints.length - 1; i++) {
      const t = i / (viewPoints.length - 1);
      const topWeight = Math.pow(1 - t, this.layoutOptions.topSpreadFalloff);
      viewPoints[i].x += sideSign * this.layoutOptions.topLateralSpread * topWeight;
      viewPoints[i].y -= this.layoutOptions.topVerticalFlatten * topWeight;
      viewPoints[i].x += (pointNoiseRandom() - 0.5) * 2 * this.layoutOptions.pointNoiseX;
      viewPoints[i].y += (pointNoiseRandom() - 0.5) * 2 * this.layoutOptions.pointNoiseY;
    }

    let center = new THREE.Vector3();
    for (let i = 0; i < viewPoints.length; i++) {
      center.add(viewPoints[i].clone());
    }

    center = center.divideScalar(viewPoints.length);

    for (let i = 0; i < chainItems.length; i++) {
      const chainItem = chainItems[i];
      let entityView = null;
      
      if (i == 0) {
        entityView = this.parentCompanyView;
      }
      else if (i == chainItems.length-1) {
        entityView = this.childCompanyView;
      }

      if (entityView == null) {
        entityView = ViewPool.getView("entity_view_new");
        this.addToRoot(entityView.getRootGroup());

        entityView.setModel(chainItem.entity);
        entityView.getRootGroup().position.copy(viewPoints[i]);
        entityView.setScale(this.treeScale);
      }

      this.ownerEntityViews.push(entityView);
      entityView.getRootGroup().updateMatrixWorld(true);

      if (typeof entityView.getCardCollider === "function") {
        const entityCollider = entityView.getCardCollider();
        if (entityCollider != null) {
          this.entityColliders.push(entityCollider);
          InputService.registerCollider({
            onClick: (payload) => entityView.onClick({ ...payload, surface: "card" })
          }, entityCollider);
        }
      }

      const relModel = chainItem.relationship 
        ? window[`apps_${performance.timeOrigin}`].pepe.relationships[chainItem.relationship.id]
        : null;

      if (relModel == null) {
        continue;
      }

      let ownerEntityView = this.ownerEntityViews[this.ownerEntityViews.length-2];
      
      let targetPos = entityView.getRootGroup().getWorldPosition(new THREE.Vector3());
      let ownerPos = ownerEntityView.getRootGroup().getWorldPosition(new THREE.Vector3());

      let ownerDir = targetPos.clone().sub(ownerPos.clone()).normalize();
      let targetDir = ownerDir.clone().negate();

      let targetDimensions = entityView.getDimensions();
      let ownerDimensions = ownerEntityView.getDimensions();

      targetPos = getPointOnBoxFromCenter(targetPos.clone(), targetDimensions.width, targetDimensions.height, targetDir.clone());
      ownerPos = getPointOnBoxFromCenter(ownerPos.clone(), ownerDimensions.width, ownerDimensions.height, ownerDir.clone());
      const isDirectRelationship = chainItems.length === 2;
      let relView = null;
      let relCenter = targetPos.clone().add(ownerPos.clone()).multiplyScalar(0.5);

      if (isDirectRelationship === false) {
        relView = ViewPool.getView("relationship");
        relView.threadWidth *= this.treeScale;
        this.ownerRelationshipViews.push(relView);

        relView.setStickyNoteScale(this.treeScale);
        relView.setModel(relModel);
        relView.setSplitThreadConfig({
          enabled: false,
          offsetDistance: 0
        });
        this.addToRoot(relView.getRootGroup());
        relView.setEndpoints(targetPos, ownerPos);
        relView.getRootGroup().position.setComponent(2, -0.001);
        relView.getRootGroup().updateMatrixWorld(true);

        relCenter = relView.getStickyNoteWorldPosition?.()
          ?? relCenter;
      }
      let evidenceDir = relCenter.clone().sub(center.clone()).normalize();

      let evidenceGroupView = ViewPool.getView("evidence_group");
      evidenceGroupView.setEvidenceViewScale(1);
      evidenceGroupView.setEvidenceModels(
        relModel.evidence,
        evidenceDir,
        relCenter,
        20,
        30,
        occupiedEvidenceRects,
        relModel
      );

      this.addToRoot(evidenceGroupView.getRootGroup());
      this.evidenceGroupViews.push(evidenceGroupView);

      const evidenceGroupBounds = evidenceGroupView.getGroupBounds();
      if (evidenceGroupBounds != null) {
        occupiedEvidenceRects.push(evidenceGroupBounds);
      }

      if (relView != null) {
        const stickyNoteCollider = relView.getStickyNoteCollider();
        if (stickyNoteCollider != null) {
          this.relationshipColliders.push(stickyNoteCollider);
          InputService.registerCollider({
            onClick: (payload) => relView.onClick({ ...payload, surface: "stickyNote" })
          }, stickyNoteCollider);
        }

        const threadColliders = typeof relView.getThreadColliders === "function"
          ? relView.getThreadColliders()
          : [relView.getThreadCollider()].filter(Boolean);
        for (let colliderIndex = 0; colliderIndex < threadColliders.length; colliderIndex++) {
          const threadCollider = threadColliders[colliderIndex];
          this.relationshipColliders.push(threadCollider);
          InputService.registerCollider({
            onClick: (payload) => relView.onClick({ ...payload, surface: "thread" })
          }, threadCollider);
        }
      }
    }
  }

}

export { OwnershipChainView };
