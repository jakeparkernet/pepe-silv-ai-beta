// SceneManager.js
import * as THREE from "three";

class SceneManager {
    constructor(container) {
        this.container = container;
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x111111);

        const rect = this.container.getBoundingClientRect();
        const width = rect.width;
        const height = rect.height || 1;

        this.camera = new THREE.PerspectiveCamera(
            45,
            width / height,
            0.1,
            100
        );
        this.camera.position.set(0, 0, 15);

        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.setSize(width, height);

        this.container.appendChild(this.renderer.domElement);

        const light = new THREE.DirectionalLight(0xffffff, 0.5);
        light.position.set(1, 1, 1);
        this.scene.add(light);

        this.updateCallback = null;
        this._isAnimating = false;
    }

    getScene() {
        return this.scene;
    }

    getCamera() {
        return this.camera;
    }

    getRenderer() {
        return this.renderer;
    }

    setUpdateCallback(fn) {
        this.updateCallback = fn;
    }

    updateSize() {
        const rect = this.container.getBoundingClientRect();
        const width = rect.width;
        const height = rect.height || 1;

        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(width, height);
    }

    start() {
        if (this._isAnimating) return;
        this._isAnimating = true;
        const animate = () => {
            if (!this._isAnimating) return;

            if (this.updateCallback) {
                this.updateCallback();
            }

            this.renderer.render(this.scene, this.camera);
            requestAnimationFrame(animate);
        };
        animate();
    }

    stop() {
        this._isAnimating = false;
    }
}

export { SceneManager };
