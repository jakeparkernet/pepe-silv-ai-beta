import { ThreadView } from "./ThreadView.js";
import * as THREE from "three";
import { StickyNote } from "../components/StickyNote.js";
import { getTiltQuaternion } from "../utils/getTiltQuaternion.js";

class RelationshipView extends ThreadView {

    constructor() {
        super();

        this.stickyNoteScale = 1;
        this.onClick = this.onClick.bind(this);
        this.setSplitThreadConfig = this.setSplitThreadConfig.bind(this);
        this.getThreadColliders = this.getThreadColliders.bind(this);
        this.getStickyNoteWorldPosition = this.getStickyNoteWorldPosition.bind(this);
        this.syncThreadDisplayMode = this.syncThreadDisplayMode.bind(this);
        this.show = this.show.bind(this);
        this.hide = this.hide.bind(this);
        this.splitThreadConfig = {
            enabled: false,
            offsetDistance: 0
        };
        try {
            this.leftThreadView = new ThreadView();
            this.rightThreadView = new ThreadView();
            this.getRootGroup().add(this.leftThreadView.getRootGroup());
            this.getRootGroup().add(this.rightThreadView.getRootGroup());
            this.leftThreadView.hide();
            this.rightThreadView.hide();
        } catch (e) {
            console.warn("[RelationshipView] Failed to create child thread views:", e.message);
            this.leftThreadView = null;
            this.rightThreadView = null;
        }
        this.syncThreadDisplayMode();
    }

    setStickyNoteScale(scale) {
        this.stickyNoteScale = scale;
    }

    show() {
        super.show();
        this.stickyNote?.show?.();
    }

    hide() {
        this.stickyNote?.hide?.();
        super.hide();
    }

    setSplitThreadConfig(config = {}) {
        this.splitThreadConfig = {
            ...this.splitThreadConfig,
            ...config
        };
        this.syncThreadDisplayMode();
    }

    syncThreadDisplayMode() {
        const isSplit = this.splitThreadConfig.enabled;

        this.setThreadMeshVisible(!isSplit);
        this.leftThreadView?.hide();
        this.rightThreadView?.hide();
    }

    setModel(model) {
        this.model = model;
        
        if (this.stickyNote == null) {
            this.stickyNote = new StickyNote();

            this.stickyNote.updateLine("owns", {
                text: model.relation,
                position: [0, 0, 0],
                size: 0.01,
                wrapMode: "word",
                maxWidth: 200,
                maxHeight: 200,
                padding: 0,
                align: "center",
                anchor: "center",
                breakLongWords: false,
                fitIterations: 24,
            });

            this.getRootGroup().add(this.stickyNote.getRootGroup());
            this.stickyNote.getRootGroup().quaternion.copy(getTiltQuaternion());
        };

        this.stickyNote.getRootGroup().position.set(0, 0, 0.001);
        this.stickyNote.getRootGroup().scale.setScalar(this.stickyNoteScale);
        if (this.getRootGroup().visible === false) {
            this.stickyNote.hide();
        } else {
            this.stickyNote.show();
        }
    }

    setEndpoints(fromPoint, toPoint) {
        this.fromPoint.copy(fromPoint);
        this.toPoint.copy(toPoint);

        if (this.splitThreadConfig.enabled && this.leftThreadView && this.rightThreadView) {
            this.syncThreadDisplayMode();
            const direction = toPoint.clone().sub(fromPoint);
            const midpoint = fromPoint.clone().add(toPoint).multiplyScalar(0.5);
            const perpendicular = new THREE.Vector3(-direction.y, direction.x, 0);

            if (perpendicular.lengthSq() > 1e-8) {
                perpendicular.normalize().multiplyScalar(this.splitThreadConfig.offsetDistance ?? 0);
            } else {
                perpendicular.set(0, this.splitThreadConfig.offsetDistance ?? 0, 0);
            }

            const stickyPosition = midpoint.add(perpendicular);
            if (this.stickyNote != null) {
                this.stickyNote.getRootGroup().position.copy(stickyPosition);
                this.stickyNote.getRootGroup().position.setComponent(2, 0.001);
                this.stickyNote.markDirty();
            }

            this.leftThreadView.threadWidth = this.threadWidth;
            this.rightThreadView.threadWidth = this.threadWidth;
            this.leftThreadView.setEndpoints(fromPoint, stickyPosition);
            this.rightThreadView.setEndpoints(stickyPosition, toPoint);
            this.leftThreadView.show();
            this.rightThreadView.show();
        } else {
            this.syncThreadDisplayMode();
            this._applyEdgeTransform();
            this.update();
        }
    }

    getStickyNoteCollider() {
        if (this.stickyNote == null) {
            return null;
        }

        return this.stickyNote.getCollider();
    }

    getStickyNoteWorldPosition() {
        if (this.stickyNote == null) {
            return null;
        }

        return this.stickyNote.getRootGroup().getWorldPosition(new THREE.Vector3());
    }

    getThreadCollider() {
        if (this.splitThreadConfig.enabled && this.leftThreadView) {
            return this.leftThreadView.getCollider();
        }

        return this.getCollider();
    }

    getThreadColliders() {
        if (this.splitThreadConfig.enabled) {
            return [
                this.leftThreadView?.getCollider(),
                this.rightThreadView?.getCollider()
            ].filter(Boolean);
        }

        const collider = this.getCollider();
        return collider ? [collider] : [];
    }

    onClick(payload = {}) {
        const detailData = {
            relation: this.model?.relation,
            surface: payload.surface ?? "unknown",
            model: this.model
        };
        window[`apps_${performance.timeOrigin}`]?.pepe?.openDetailPanel?.({
            title: "Relationship Details",
            kind: "relationship",
            data: detailData
        });
        console.log("Relationship clicked", detailData);
    }
}

export { RelationshipView };
