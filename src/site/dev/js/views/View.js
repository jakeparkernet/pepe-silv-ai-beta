import * as THREE from "three";

class View {
    constructor() {
        this.show = this.show.bind(this);
        this.hide = this.hide.bind(this);
        this.rootGroup = new THREE.Group();
    }

    show() { this.getRootGroup().visible = true; }
    hide() { this.getRootGroup().visible = false; }
    getRootGroup() { return this.rootGroup; }
    addToRoot(child, { resetScale = true, resetTransform = true } = {}) {
        this.getRootGroup().add(child);

        if (resetScale) {
            child.scale.set(1, 1, 1);
        }
        if (resetTransform) {
            child.quaternion.set(0, 0, 0, 1);
            child.position.set(0, 0, 0);
        }
    }

    setModel (model) {
        this.model = model;
        this.update();
    }

    update() {}
}

export { View };