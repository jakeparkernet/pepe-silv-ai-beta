import { View } from "./View.js";
import * as THREE from "three";
import { ViewPool } from "../utils/ViewPool.js";
import { InputService } from "../services/InputService.js";
import { getPointOnBoxFromCenter } from "../utils/pointUtils.js";

class OwnerTreeView extends View {

    constructor() {
        super();

        this.update = this.update.bind(this);
        this.cleanupDynamicViews = this.cleanupDynamicViews.bind(this);
        this.getChainBounds = this.getChainBounds.bind(this);
        this.getEntityPositionBounds = this.getEntityPositionBounds.bind(this);
        this.setTarget = this.setTarget.bind(this);
        this.setLabelsVisible = this.setLabelsVisible.bind(this);
        this.setLayoutOptions = this.setLayoutOptions.bind(this);
        this.getLevelPositions = this.getLevelPositions.bind(this);
        this.setD3Positions = this.setD3Positions.bind(this);
        this.getTreeLocalPositionFromD3 = this.getTreeLocalPositionFromD3.bind(this);
        this.registerEntityCollider = this.registerEntityCollider.bind(this);
        this.registerRelationshipColliders = this.registerRelationshipColliders.bind(this);

        this.entityColliders = [];
        this.relationshipColliders = [];
        this.evidenceGroupViews = [];
        this.ownerEntityViews = [];
        this.ownerRelationshipViews = [];
        this.treeScale = 1;
        this.chirality = 0;
        this.d3Positions = null;
        this.d3Scale = 0.001;
        this.lastKnownLevelCount = 0;
        this.d3PositionOffset = { x: 0, y: 0 };
        this.layoutOptions = {
            levelSpacingY: 12,
            minNodeSpacingX: 12,
            levelBiasX: 1.5,
            pointNoiseX: 0,
            pointNoiseY: 0
        };
    }

    setD3Positions(positions, scale = 0.001) {
        this.d3Positions = positions;
        this.d3Scale = scale;
    }

    getTreeLocalPositionFromD3(d3Pos, targetD3Pos, targetViewPos) {
        if (d3Pos == null) {
            return null;
        }

        const scaledX = d3Pos.x * this.d3Scale;
        const scaledY = d3Pos.y * this.d3Scale;

        if (targetD3Pos == null || targetViewPos == null) {
            return new THREE.Vector3(
                scaledX + this.d3PositionOffset.x,
                scaledY + this.d3PositionOffset.y,
                0
            );
        }

        const targetScaledX = targetD3Pos.x * this.d3Scale;
        const targetScaledY = targetD3Pos.y * this.d3Scale;

        return new THREE.Vector3(
            targetViewPos.x + (scaledX - targetScaledX) + this.d3PositionOffset.x,
            targetViewPos.y - (scaledY - targetScaledY) + this.d3PositionOffset.y,
            0
        );
    }

    setD3PositionOffset(x, y) {
        this.d3PositionOffset = { x, y };
    }

    setDisplayScale(scale) {
        this.displayScale = scale;
    }

    setTarget(targetCompanyView, chirality = 0) {
        this.targetCompanyView = targetCompanyView;
        this.chirality = chirality;
    }

    setLayoutOptions(layoutOptions = {}) {
        this.layoutOptions = {
            ...this.layoutOptions,
            ...layoutOptions
        };
    }

    setLabelsVisible(visible = true) {
        for (let i = 0; i < this.ownerRelationshipViews.length; i++) {
            this.ownerRelationshipViews[i]?.setLabelsVisible?.(visible);
        }

        for (let i = 0; i < this.evidenceGroupViews.length; i++) {
            this.evidenceGroupViews[i]?.setLabelsVisible?.(visible);
        }
    }

    show() {
        super.show();

        for (let i = 0; i < this.ownerEntityViews.length; i++) {
            this.ownerEntityViews[i]?.show?.();
        }

        for (let i = 0; i < this.ownerRelationshipViews.length; i++) {
            this.ownerRelationshipViews[i]?.show?.();
        }

        for (let i = 0; i < this.evidenceGroupViews.length; i++) {
            this.evidenceGroupViews[i]?.show?.();
        }
    }

    hide() {
        for (let i = 0; i < this.ownerEntityViews.length; i++) {
            this.ownerEntityViews[i]?.hide?.();
        }

        for (let i = 0; i < this.ownerRelationshipViews.length; i++) {
            this.ownerRelationshipViews[i]?.hide?.();
        }

        for (let i = 0; i < this.evidenceGroupViews.length; i++) {
            this.evidenceGroupViews[i]?.hide?.();
        }

        super.hide();
    }

    getChainBounds(referenceObject = null) {
        const objects = [];

        if (this.targetCompanyView?.getRootGroup) {
            objects.push(this.targetCompanyView.getRootGroup());
        }

        for (let i = 0; i < this.ownerEntityViews.length; i++) {
            const rootGroup = this.ownerEntityViews[i]?.getRootGroup?.();
            if (rootGroup) {
                objects.push(rootGroup);
            }
        }

        for (let i = 0; i < this.ownerRelationshipViews.length; i++) {
            const rootGroup = this.ownerRelationshipViews[i]?.getRootGroup?.();
            if (rootGroup) {
                objects.push(rootGroup);
            }
        }

        for (let i = 0; i < this.evidenceGroupViews.length; i++) {
            const rootGroup = this.evidenceGroupViews[i]?.getRootGroup?.();
            if (rootGroup) {
                objects.push(rootGroup);
            }
        }

        if (objects.length === 0) {
            return null;
        }

        const bounds = {
            minX: Infinity,
            maxX: -Infinity,
            minY: Infinity,
            maxY: -Infinity
        };

        for (let i = 0; i < objects.length; i++) {
            const object = objects[i];
            if (object == null) {
                continue;
            }

            object.updateMatrixWorld(true);
            const worldBounds = new THREE.Box3().setFromObject(object);
            if (worldBounds.isEmpty()) {
                continue;
            }

            const min = worldBounds.min.clone();
            const max = worldBounds.max.clone();
            if (referenceObject) {
                referenceObject.worldToLocal(min);
                referenceObject.worldToLocal(max);
            }

            bounds.minX = Math.min(bounds.minX, min.x, max.x);
            bounds.maxX = Math.max(bounds.maxX, min.x, max.x);
            bounds.minY = Math.min(bounds.minY, min.y, max.y);
            bounds.maxY = Math.max(bounds.maxY, min.y, max.y);
        }

        if (Number.isFinite(bounds.minX) === false) {
            return null;
        }

        return bounds;
    }

    getEntityPositionBounds(referenceObject = null) {
        const objects = [];

        if (this.targetCompanyView?.getRootGroup) {
            objects.push(this.targetCompanyView.getRootGroup());
        }

        for (let i = 0; i < this.ownerEntityViews.length; i++) {
            const rootGroup = this.ownerEntityViews[i]?.getRootGroup?.();
            if (rootGroup) {
                objects.push(rootGroup);
            }
        }

        if (objects.length === 0) {
            return null;
        }

        const bounds = {
            minX: Infinity,
            maxX: -Infinity,
            minY: Infinity,
            maxY: -Infinity
        };

        for (let i = 0; i < objects.length; i++) {
            const object = objects[i];
            const worldPos = object.getWorldPosition(new THREE.Vector3());

            bounds.minX = Math.min(bounds.minX, worldPos.x);
            bounds.maxX = Math.max(bounds.maxX, worldPos.x);
            bounds.minY = Math.min(bounds.minY, worldPos.y);
            bounds.maxY = Math.max(bounds.maxY, worldPos.y);
        }

        if (Number.isFinite(bounds.minX) === false) {
            return null;
        }

        return bounds;
    }

    getLevelPositions(graph, positions, levelIds, levelIndex) {
        const targetRootPosition = this.targetCompanyView.getRootGroup().position.clone();
        const sideSign = this.chirality === 0 ? 1 : Math.sign(this.chirality);
        const levelY = targetRootPosition.y + (levelIndex * this.layoutOptions.levelSpacingY * this.treeScale);
        const outwardX =
            targetRootPosition.x
            + (sideSign * levelIndex * this.layoutOptions.levelBiasX * this.treeScale);
        const spacingX = this.layoutOptions.minNodeSpacingX * this.treeScale;

        const orderedIds = levelIds.slice().sort((a, b) => {
            const aChildren = [];
            const bChildren = [];

            for (let i = 0; i < graph.edges.length; i++) {
                const edge = graph.edges[i];
                if (edge.sourceId === a && positions.has(edge.targetId)) {
                    aChildren.push(positions.get(edge.targetId).x);
                }
                if (edge.sourceId === b && positions.has(edge.targetId)) {
                    bChildren.push(positions.get(edge.targetId).x);
                }
            }

            const aCenter = aChildren.length > 0
                ? aChildren.reduce((sum, x) => sum + x, 0) / aChildren.length
                : targetRootPosition.x;
            const bCenter = bChildren.length > 0
                ? bChildren.reduce((sum, x) => sum + x, 0) / bChildren.length
                : targetRootPosition.x;

            return aCenter - bCenter;
        });

        const levelPositions = new Map();
        for (let i = 0; i < orderedIds.length; i++) {
            const offsetX = i * spacingX * sideSign;
            levelPositions.set(
                orderedIds[i],
                new THREE.Vector3(outwardX + offsetX, levelY, 0)
            );
        }

        return levelPositions;
    }

    registerEntityCollider(entityView) {
        const entityCollider = entityView?.getCardCollider?.();
        if (entityCollider == null) {
            return;
        }

        this.entityColliders.push(entityCollider);
        InputService.registerCollider({
            onClick: (payload) => entityView.onClick({ ...payload, surface: "card" })
        }, entityCollider);
    }

    registerRelationshipColliders(relationshipView) {
        const stickyNoteCollider = relationshipView?.getStickyNoteCollider?.();
        if (stickyNoteCollider != null) {
            this.relationshipColliders.push(stickyNoteCollider);
            InputService.registerCollider({
                onClick: (payload) => relationshipView.onClick({ ...payload, surface: "stickyNote" })
            }, stickyNoteCollider);
        }

        const threadColliders = typeof relationshipView?.getThreadColliders === "function"
            ? relationshipView.getThreadColliders()
            : [relationshipView?.getThreadCollider?.()].filter(Boolean);

        for (let i = 0; i < threadColliders.length; i++) {
            const threadCollider = threadColliders[i];
            if (threadCollider == null) {
                continue;
            }

            this.relationshipColliders.push(threadCollider);
            InputService.registerCollider({
                onClick: (payload) => relationshipView.onClick({ ...payload, surface: "thread" })
            }, threadCollider);
        }
    }

    setTargetPosition(targetPosition) {
        this.targetPosition = targetPosition;
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

        for (let i = 0; i < this.ownerRelationshipViews.length; i++) {
            ViewPool.returnView(this.ownerRelationshipViews[i]);
        }
        this.ownerRelationshipViews = [];

        for (let i = 0; i < this.ownerEntityViews.length; i++) {
            ViewPool.returnView(this.ownerEntityViews[i]);
        }
        this.ownerEntityViews = [];

        for (let i = 0; i < this.evidenceGroupViews.length; i++) {
            this.evidenceGroupViews[i]?.cleanupDynamicViews?.();
            ViewPool.returnView(this.evidenceGroupViews[i]);
        }
        this.evidenceGroupViews = [];
    }

    update() {
        if (this.model == null || this.targetCompanyView == null) {
            return;
        }

        this.cleanupDynamicViews();

        const graph = this.model.getUpwardOwnershipGraph?.();
        const levels = graph?.levels ?? [];
        if (levels.length === 0) {
            return;
        }

        const positions = new Map();
        const viewById = new Map();
        const targetId = this.model.targetEntity?.id;
        const targetPosition = this.targetCompanyView.getRootGroup().position.clone();
        positions.set(targetId, targetPosition);
        viewById.set(targetId, this.targetCompanyView);

        const useD3Positions = this.d3Positions != null && this.d3Positions.size > 0;
        let targetD3Pos = null;
        let targetViewPos = null;

        if (useD3Positions) {
            // Try both the ID directly and common keys
            targetD3Pos = this.d3Positions.get(targetId);
            if (!targetD3Pos) targetD3Pos = this.d3Positions.get("news-site");
            if (!targetD3Pos) targetD3Pos = this.d3Positions.get("article-subject");
            targetViewPos = this.getRootGroup().worldToLocal(
                this.targetCompanyView.getRootGroup().getWorldPosition(new THREE.Vector3())
            );
        }

        const minNodeSpacingX = this.layoutOptions.minNodeSpacingX * this.treeScale;
        const targetRootPosition = this.targetCompanyView.getRootGroup().position.clone();

        if (useD3Positions) {
            for (let levelIndex = 1; levelIndex < levels.length; levelIndex++) {
                const levelIds = levels[levelIndex];
                for (let i = 0; i < levelIds.length; i++) {
                    const entityId = levelIds[i];
                    const d3Key = `entity-${entityId}`;
                    const d3Pos = this.d3Positions?.get(d3Key);

                    if (d3Pos) {
                        let entityView = ViewPool.getView("entity_view_new");
                        let model = window[`apps_${performance.timeOrigin}`].pepe.entities[entityId];

                        entityView.setModel(model);
                        this.addToRoot(entityView.getRootGroup(), { resetTransform: false });
                        entityView.getRootGroup().position.copy(this.getTreeLocalPositionFromD3(d3Pos, targetD3Pos, targetViewPos));

                        this.ownerEntityViews.push(entityView);
                        viewById.set(entityId, entityView);
                        this.registerEntityCollider(entityView);
                    }
                }
            }

            for (let levelIndex = 1; levelIndex < levels.length; levelIndex++) {
                const levelIds = levels[levelIndex];
                const sideSign = this.chirality === 0 ? 1 : Math.sign(this.chirality);
                const levelY = targetRootPosition.y + (levelIndex * this.layoutOptions.levelSpacingY * this.treeScale);
                const outwardX = targetRootPosition.x + (sideSign * levelIndex * this.layoutOptions.levelBiasX * this.treeScale);
                const spacingX = minNodeSpacingX;

                for (let i = 0; i < levelIds.length; i++) {
                    const entityId = levelIds[i];
                    const d3Key = `entity-${entityId}`;
                    const d3Pos = this.d3Positions.get(d3Key);

                    if (d3Pos != null) {
                        positions.set(entityId, this.getTreeLocalPositionFromD3(d3Pos, targetD3Pos, targetViewPos));
                    } else {
                        const offsetX = (i - (levelIds.length - 1) / 2) * spacingX * sideSign;
                        positions.set(entityId, new THREE.Vector3(outwardX + offsetX, levelY, 0));
                    }
                }
            }
        } else {
            for (let levelIndex = 1; levelIndex < levels.length; levelIndex++) {
                const levelIds = levels[levelIndex];
                const levelPositions = this.getLevelPositions(graph, positions, levelIds, levelIndex);

                for (let i = 0; i < levelIds.length; i++) {
                    const nodeId = levelIds[i];
                    const finalPosition = levelPositions.get(nodeId);
                    if (finalPosition != null) {
                        positions.set(nodeId, finalPosition);
                    }
                }
            }
        }

        const center = new THREE.Vector3();
        const positionValues = Array.from(positions.values());
        for (let i = 0; i < positionValues.length; i++) {
            center.add(positionValues[i]);
        }
        center.divideScalar(Math.max(positionValues.length, 1));

        for (let i = 0; i < graph.edges.length; i++) {
            const edge = graph.edges[i];
            const sourceView = viewById.get(edge.sourceId);
            const targetView = viewById.get(edge.targetId);
            if (sourceView == null || targetView == null) {
                continue;
            }

            let sourcePos = sourceView.getRootGroup().getWorldPosition(new THREE.Vector3());
            let targetPos = targetView.getRootGroup().getWorldPosition(new THREE.Vector3());
            const direction = targetPos.clone().sub(sourcePos).normalize();
            const reverseDirection = direction.clone().negate();
            const sourceDimensions = sourceView.getDimensions();
            const targetDimensions = targetView.getDimensions();

            sourcePos = getPointOnBoxFromCenter(sourcePos, sourceDimensions.width, sourceDimensions.height, direction);
            targetPos = getPointOnBoxFromCenter(targetPos, targetDimensions.width, targetDimensions.height, reverseDirection);

            const relationshipView = ViewPool.getView("relationship");
            relationshipView.threadWidth *= this.treeScale;
            relationshipView.setStickyNoteScale(this.treeScale);
            relationshipView.setModel(edge.relationship);
            this.addToRoot(relationshipView.getRootGroup());
            relationshipView.setEndpoints(sourcePos, targetPos);
            relationshipView.getRootGroup().position.setComponent(2, -0.001);
            relationshipView.getRootGroup().updateMatrixWorld(true);

            this.ownerRelationshipViews.push(relationshipView);
            this.registerRelationshipColliders(relationshipView);
        }
    }
}

export { OwnerTreeView };
