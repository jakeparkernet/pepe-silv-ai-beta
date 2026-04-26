import * as THREE from "three";
import { View } from "./View.js";
import { ViewPool } from "../utils/ViewPool.js";
import { getTiltQuaternion } from "../utils/getTiltQuaternion.js";
import { RaisedLabel } from "../components/RaisedLabel.js";
import { InputService } from "../services/InputService.js";

const MAX_RENDERED_EVIDENCE_ITEMS = 3;

class EvidenceGroupView extends View {
    constructor() {
        super();

        this.onClick = this.onClick.bind(this);
        this.cleanupDynamicViews = this.cleanupDynamicViews.bind(this);
        this.evidenceViews = [];
        this.threadViews = [];
        this.evidenceColliders = [];
        this.threadColliders = [];
        this.raisedLabelCollider = null;
        this.evidenceViewScale = 1;
        this.groupBounds = null;
        this.labelsVisible = true;

        this.raisedLabel = new RaisedLabel({ fontKey: "typewriter-white" });
        this.raisedLabel.setText("EVIDENCE");
        this.addToRoot(this.raisedLabel.getRootGroup(), { resetScale: false, resetTransform: false });
        this.raisedLabel.getRootGroup().quaternion.copy(getTiltQuaternion());
    }

    show() {
        super.show();
        if (this.labelsVisible && this.groupBounds != null) {
            this.raisedLabel?.show?.();
        }

        for (let i = 0; i < this.evidenceViews.length; i++) {
            this.evidenceViews[i]?.show?.();
        }

        for (let i = 0; i < this.threadViews.length; i++) {
            this.threadViews[i]?.show?.();
        }
    }

    hide() {
        this.raisedLabel?.hide?.();

        for (let i = 0; i < this.evidenceViews.length; i++) {
            this.evidenceViews[i]?.hide?.();
        }

        for (let i = 0; i < this.threadViews.length; i++) {
            this.threadViews[i]?.hide?.();
        }

        super.hide();
    }

    setLabelsVisible(visible = true) {
        this.labelsVisible = !!visible;
        if (this.labelsVisible && this.groupBounds != null) {
            this.raisedLabel?.show?.();
        }
        else {
            this.raisedLabel?.hide?.();
        }

        for (let i = 0; i < this.evidenceViews.length; i++) {
            this.evidenceViews[i]?.setLabelsVisible?.(this.labelsVisible);
        }
    }

    setEvidenceViewScale (evidenceViewScale) {
        this.evidenceViewScale = evidenceViewScale;

        for (let i = 0; i < this.evidenceViews.length; i++) {
            this.evidenceViews[i].setScale(evidenceViewScale);
        }
    }

    getEvidenceDimensions(evidenceView) {
        if (typeof evidenceView.getDimensions === "function") {
            return evidenceView.getDimensions();
        }

        const size = evidenceView.getDefaultSize ? evidenceView.getDefaultSize() : new THREE.Vector3(8.5, 11, 1);
        const scale = evidenceView.getRootGroup().scale.x;
        return {
            width: size.x * scale,
            height: size.y * scale
        };
    }

    makeRect(position, dimensions, padding = 0) {
        return {
            minX: position.x - (dimensions.width * 0.5) - padding,
            maxX: position.x + (dimensions.width * 0.5) + padding,
            minY: position.y - (dimensions.height * 0.5) - padding,
            maxY: position.y + (dimensions.height * 0.5) + padding
        };
    }

    rectsOverlap(a, b) {
        return (
            a.minX < b.maxX &&
            a.maxX > b.minX &&
            a.minY < b.maxY &&
            a.maxY > b.minY
        );
    }

    findOpenPosition(pivot, centerAngle, baseRadius, angle, dimensions, occupiedRects) {
        const maxDimension = Math.max(dimensions.width, dimensions.height);
        const ringStep = Math.max(3, maxDimension * 0.75);
        const collisionPadding = Math.max(1.2, maxDimension * 0.08);
        const ringCount = 8;

        for (let ring = 0; ring < ringCount; ring++) {
            const ringRadius = baseRadius + (ring * ringStep);
            const sampleCount = ring === 0 ? 11 : 17;

            for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex++) {
                const t = sampleCount === 1 ? 0.5 : sampleIndex / (sampleCount - 1);
                const sampleAngle = centerAngle - angle + ((angle * 2) * t);
                const position = new THREE.Vector3(
                    pivot.x + (ringRadius * Math.cos(sampleAngle)),
                    pivot.y + (ringRadius * Math.sin(sampleAngle)),
                    pivot.z
                );

                const candidateRect = this.makeRect(position, dimensions, collisionPadding);
                const overlaps = occupiedRects.some((occupiedRect) => this.rectsOverlap(candidateRect, occupiedRect));
                if (overlaps === false) {
                    return { position, rect: candidateRect };
                }
            }
        }

        const fallbackRadius = baseRadius + (ringCount * ringStep);
        const fallbackPosition = new THREE.Vector3(
            pivot.x + (fallbackRadius * Math.cos(centerAngle)),
            pivot.y + (fallbackRadius * Math.sin(centerAngle)),
            pivot.z
        );

        return {
            position: fallbackPosition,
            rect: this.makeRect(fallbackPosition, dimensions, collisionPadding)
        };
    }

    updateGroupBounds(placedRects) {
        if (placedRects.length === 0) {
            this.groupBounds = null;
            this.raisedLabel?.hide?.();
            return;
        }

        const bounds = {
            minX: Infinity,
            maxX: -Infinity,
            minY: Infinity,
            maxY: -Infinity
        };

        for (let i = 0; i < placedRects.length; i++) {
            const rect = placedRects[i];
            bounds.minX = Math.min(bounds.minX, rect.minX);
            bounds.maxX = Math.max(bounds.maxX, rect.maxX);
            bounds.minY = Math.min(bounds.minY, rect.minY);
            bounds.maxY = Math.max(bounds.maxY, rect.maxY);
        }

        this.groupBounds = bounds;
        if (this.labelsVisible) {
            this.raisedLabel?.show?.();
        }
        else {
            this.raisedLabel?.hide?.();
        }
        this.raisedLabel.getRootGroup().position.set(
            bounds.minX + (this.raisedLabel.getSize().x * 0.5),
            bounds.maxY + (this.raisedLabel.getSize().y * 0.85),
            0.01
        );
        this.raisedLabel.markDirty?.();
    }

    getGroupBounds() {
        if (this.groupBounds == null) {
            return null;
        }

        return { ...this.groupBounds };
    }

    onClick(payload = {}) {
        if (payload.surface === "raisedLabel" && this.relationshipModel != null) {
            window[`apps_${performance.timeOrigin}`]?.pepe?.openDetailPanel?.({
                title: "Relationship Evidence",
                kind: "relationship",
                data: {
                    model: this.relationshipModel,
                    relation: this.relationshipModel?.relation
                }
            });
            return;
        }

        const detailData = {
            surface: payload.surface ?? "unknown",
        };
        window[`apps_${performance.timeOrigin}`]?.pepe?.openDetailPanel?.({
            title: "Evidence Details",
            kind: "evidence",
            data: detailData
        });
        console.log("Evidence group clicked", detailData);
    }

    cleanupDynamicViews() {
        for (let i = 0; i < this.evidenceColliders.length; i++) {
            InputService.unregisterCollider(this.evidenceColliders[i]);
        }
        this.evidenceColliders = [];

        for (let i = 0; i < this.threadColliders.length; i++) {
            InputService.unregisterCollider(this.threadColliders[i]);
        }
        this.threadColliders = [];

        InputService.unregisterCollider(this.raisedLabelCollider);
        this.raisedLabelCollider = null;

        for (let i = 0; i < this.evidenceViews.length; i++) {
            ViewPool.returnView(this.evidenceViews[i]);
        }
        this.evidenceViews = [];

        for (let i = 0; i < this.threadViews.length; i++) {
            ViewPool.returnView(this.threadViews[i]);
        }
        this.threadViews = [];

        this.groupBounds = null;
        this.relationshipModel = null;
        this.raisedLabel?.hide?.();
    }

    setEvidenceModels (evidence, centerDir, pivot, radius, angleDeg, occupiedRects = [], relationshipModel = null) {
        this.model = evidence;
        this.relationshipModel = relationshipModel;

        this.cleanupDynamicViews();

        const normalizedCenterDir = centerDir.lengthSq() > 0.0001
            ? centerDir.clone().normalize()
            : new THREE.Vector3(0, 1, 0);
        const angle = angleDeg * (Math.PI / 180);
        const centerAngle = Math.atan2(normalizedCenterDir.y, normalizedCenterDir.x);
        const placedRects = occupiedRects.map((rect) => ({ ...rect }));
        const evidenceEntries = Object.entries(evidence ?? {}).slice(0, MAX_RENDERED_EVIDENCE_ITEMS);

        for (const [key, value] of evidenceEntries) {

            let evidenceView = ViewPool.getView("evidence");
            evidenceView.setModel(value);
            evidenceView.setScale(this.evidenceViewScale);
            evidenceView.setLabelsVisible(this.labelsVisible);
            this.addToRoot(evidenceView.getRootGroup());

            const dimensions = this.getEvidenceDimensions(evidenceView);
            const placement = this.findOpenPosition(
                pivot,
                centerAngle,
                radius,
                angle,
                dimensions,
                placedRects
            );

            evidenceView.getRootGroup().position.copy(placement.position);
            evidenceView.getRootGroup().quaternion.copy(getTiltQuaternion());
            this.evidenceViews.push(evidenceView);
            placedRects.push(placement.rect);

            let threadView = ViewPool.getView("thread");
            this.addToRoot(threadView.getRootGroup());
            threadView.setEndpoints(
                pivot,
                placement.position.clone()
            );
            threadView.getRootGroup().position.setComponent(2, -0.001);
            this.threadViews.push(threadView);
        }

        this.updateGroupBounds(placedRects.slice(occupiedRects.length));

        if (this.labelsVisible && this.groupBounds != null) {
            this.raisedLabel?.show?.();
        }
        else {
            this.raisedLabel?.hide?.();
        }

        this.raisedLabel.getRootGroup().updateMatrixWorld(true);
        if (this.labelsVisible && this.groupBounds != null) {
            this.raisedLabelCollider = this.raisedLabel.getCollider();
            InputService.registerCollider({
                onClick: (payload) => this.onClick({ ...payload, surface: "raisedLabel" })
            }, this.raisedLabelCollider);
        }

        for (let i = 0; i < this.evidenceViews.length; i++) {
            const evidenceView = this.evidenceViews[i];
            evidenceView.getRootGroup().updateMatrixWorld(true);
            const collider = evidenceView.getCollider();
            this.evidenceColliders.push(collider);
            InputService.registerCollider(evidenceView, collider);
        }

        for (let i = 0; i < this.threadViews.length; i++) {
            const threadView = this.threadViews[i];
            threadView.getRootGroup().updateMatrixWorld(true);
            const collider = threadView.getCollider();
            if (collider == null) {
                continue;
            }

            this.threadColliders.push(collider);
            InputService.registerCollider({
                onClick: (payload) => this.onClick({ ...payload, surface: "thread" })
            }, collider);
        }
    }

}

export { EvidenceGroupView };
