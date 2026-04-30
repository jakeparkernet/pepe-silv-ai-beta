import * as THREE from "three";
// import { NodeView } from "./NodeView.js";
// import { IndexCard } from "../components/IndexCard.js";
// import { getTiltQuaternion } from "../utils/getTiltQuaternion.js";
// 
const appModules = window[`apps_${performance.timeOrigin}`].modules;
const { NodeView } = appModules.views.NodeView;
const { IndexCard } = appModules.components.IndexCard;
const { getTiltQuaternion } = appModules.utils.getTiltQuaternion;

class EntityViewNew extends NodeView {
    constructor() {
        super();
        this.getCardCollider = this.getCardCollider.bind(this);
        this.onClick = this.onClick.bind(this);
        this.updateLabel = this.updateLabel.bind(this);
        this.getDimensions = this.getDimensions.bind(this);
        this.setScale = this.setScale.bind(this);

        this.scale = 1;

        this.indexCard = new IndexCard();
        this.addToRoot(this.indexCard.getRootGroup(), {
            resetScale: false,
            resetTransform: true
        });

        this.indexCard.meshInstance.setScale(5, 3, 1);
        this.indexCard.getRootGroup().quaternion.copy(getTiltQuaternion());
    }

    show() {
        super.show();
        this.indexCard?.show?.();
    }

    hide() {
        this.indexCard?.hide?.();
        super.hide();
    }
    
    setScale (scale) {
        this.scale = scale;
        this.getRootGroup().scale.setScalar(this.scale);
    }

    getDimensions () {
        let size = this.getDefaultSize();
        return {
            width: size.x * this.scale,
            height: size.y * this.scale
        };
    }

    getDefaultSize () {
        return new THREE.Vector3(5, 3, 1);
    }

    update () {
        super.update();

        this.updateLabel("name", {
            text: this.model.name,
            position: [0, 0, 0],
            size: 0.01,
            wrapMode: "word",
            maxWidth: 500,
            maxHeight: 30,
            padding: 25,
            fitIterations: 24,
            breakLongWords: false,
            align: "center",
            anchor: "center"
        });

    }

    refreshSize() {
        if (this.size == null) {
            this.size = this.indexCard.getSize();
            return true;
        }
        else if (this.indexCard.getSize().equals(this.size) === false) {

            this.size = this.indexCard.getSize();
            return true;
        }

        return false;
    }

    updateLabel(key, params) {
        this.indexCard.updateLine(key, params);
    }

    getCardCollider() {
        return this.indexCard.getCollider();
    }

    onClick(payload = {}) {
        const detailData = {
            surface: payload.surface ?? "unknown",
            model: this.model
        };
        window[`apps_${performance.timeOrigin}`]?.pepe?.openDetailPanel?.({
            title: "Entity Details",
            kind: "entity",
            data: detailData
        });
        console.log("Entity card clicked", detailData);
    }
}

export { EntityViewNew };
