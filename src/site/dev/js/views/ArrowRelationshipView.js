import * as THREE from "three";
// import { View } from "./View.js";
// import { Arrow } from "../components/Arrow.js";
// import { TapeLabel } from "../components/TapeLabel.js";
// 
const appModules = window[`apps_${performance.timeOrigin}`].modules;
const { View } = appModules.views.View;
const { Arrow } = appModules.components.Arrow;
const { TapeLabel } = appModules.components.TapeLabel;

const WORLD_FORWARD = new THREE.Vector3(0, 0, 1);
const WORLD_UP = new THREE.Vector3(0, 1, 0);
const TAPE_LABEL_ROOT_Z = 0.001;

class ArrowRelationshipView extends View {
    constructor() {
        super();

        this.onClick = this.onClick.bind(this);
        this.updateTapeLabelLayout = this.updateTapeLabelLayout.bind(this);
        this.arrowScale = 1;
        this.nudgeFrom = 0;
        this.nudgeTo = 0;
        this.tapeLabelScale = 1.5;
        this.labelsVisible = true;
        this.flipTapeLabel = false;
        this.invertTapeLabelOffset = false;
        this.fromPoint = null;
        this.toPoint = null;
        this._tmpMidpoint = new THREE.Vector3();
        this._tmpDirection = new THREE.Vector3();
        this._tmpTapeUp = new THREE.Vector3();

        this.arrow = new Arrow({
            size: new THREE.Vector3(2, 1.35, 1),
            color: "#d92727",
            useSdf: true,
            threshold: 0.7,
            softness: 0.26,
            ambientStrength: 0.44,
            diffuseStrength: 0.42,
            specularStrength: 0.1,
            sheenStrength: 0.08,
            sheenPower: 16.0,
            lightIntensityScale: 0.024
        });
        this.addToRoot(this.arrow.getRootGroup(), { resetScale: false, resetTransform: false });

        this.tapeLabelOffset = 1;

        this.tapeLabel = new TapeLabel();
        this.addToRoot(this.tapeLabel.getRootGroup(), { resetScale: false, resetTransform: false });
        this.tapeLabel.getRootGroup().position.set(0, 0, 0.01);
        this.tapeLabel.getRootGroup().scale.setScalar(this.tapeLabelScale);
    }

    setLabelsVisible(visible = true) {
        this.labelsVisible = !!visible;

        if (this.labelsVisible) {
            this.tapeLabel.show?.();
        }
        else {
            this.tapeLabel.hide?.();
        }
        return this;
    }

    show() {
        super.show();
        if (this.labelsVisible) {
            this.tapeLabel?.show?.();
        }
    }

    hide() {
        this.tapeLabel?.hide?.();
        super.hide();
    }

    setArrowScale(scale) {
        this.arrowScale = scale;
        this.arrow.setScale(scale);
        return this;
    }

    setTapeLabelScale(scale) {
        this.tapeLabelScale = scale;
        this.tapeLabel.getRootGroup().scale.setScalar(scale);
        this.tapeLabel.markDirty?.();
        this.updateTapeLabelLayout();
        return this;
    }

    setTapeLabelFlip(flip = false) {
        this.flipTapeLabel = !!flip;
        this.updateTapeLabelLayout();
        return this;
    }

    setTapeLabelOffsetInverted(inverted = false) {
        this.invertTapeLabelOffset = !!inverted;
        this.updateTapeLabelLayout();
        return this;
    }

    setTapeLabelMirrored(mirrored = false) {
        const nextValue = !!mirrored;
        this.flipTapeLabel = nextValue;
        this.invertTapeLabelOffset = nextValue;
        this.updateTapeLabelLayout();
        return this;
    }

    setEndpointNudges(nudgeFrom = 0, nudgeTo = 0) {
        this.nudgeFrom = nudgeFrom;
        this.nudgeTo = nudgeTo;
        return this;
    }

    setModel(model) {
        this.model = model;
        this.tapeLabel.setText(this.model.relation);
        return this;
    }

    setEndpoints(fromPoint, toPoint, nudgeFrom = this.nudgeFrom, nudgeTo = this.nudgeTo) {
        this.fromPoint = fromPoint.clone();
        this.toPoint = toPoint.clone();
        this.arrow.setScale(this.arrowScale);
        this.arrow.setEndpoints(fromPoint, toPoint, nudgeFrom, nudgeTo);
        this.updateTapeLabelLayout();
        return this;
    }

    updateTapeLabelLayout() {
        if (this.fromPoint == null || this.toPoint == null) {
            this.tapeLabel.markDirty?.();
            return this;
        }

        const tapeRoot = this.tapeLabel.getRootGroup();
        const tapeQuaternion = new THREE.Quaternion();
        const direction = this._tmpDirection.subVectors(this.toPoint, this.fromPoint);

        if (direction.lengthSq() > 1e-8) {
            const angle = Math.atan2(direction.y, direction.x);
            tapeQuaternion.setFromAxisAngle(WORLD_FORWARD, angle);
        }
        else {
            tapeQuaternion.identity();
        }

        if (this.flipTapeLabel) {
            tapeQuaternion.multiply(
                new THREE.Quaternion().setFromAxisAngle(WORLD_FORWARD, Math.PI)
            );
        }

        const tapeUp = this._tmpTapeUp.copy(WORLD_UP).applyQuaternion(tapeQuaternion);
        const offsetSign = this.invertTapeLabelOffset ? -1 : 1;
        const tapeOffsetDistance =
            ((this.tapeLabel.getSize().y * 0.5) + this.tapeLabelOffset) * this.tapeLabelScale;

        const midpoint = this._tmpMidpoint.addVectors(this.fromPoint, this.toPoint).multiplyScalar(0.5);

        tapeRoot.position.set(
            midpoint.x + (tapeUp.x * offsetSign * tapeOffsetDistance),
            midpoint.y + (tapeUp.y * offsetSign * tapeOffsetDistance),
            TAPE_LABEL_ROOT_Z
        );
        tapeRoot.quaternion.copy(tapeQuaternion);
        tapeRoot.scale.setScalar(this.tapeLabelScale);
        this.tapeLabel.markDirty?.();
        return this;
    }

    getArrowCollider() {
        return this.arrow.getCollider();
    }

    getTapeLabelCollider() {
        return this.tapeLabel.getCollider();
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
        console.log("Arrow relationship clicked", detailData);
    }
}

export { ArrowRelationshipView };
