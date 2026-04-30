import * as THREE from 'three';
// import { InputService } from '../services/InputService.js';
// 
const appModules = window[`apps_${performance.timeOrigin}`].modules;
const { InputService } = appModules.services.InputService;

class CameraPanPass {
    constructor(canvas, camera, opts = {}) {
        this.canvas = canvas;
        this.camera = camera;

        this.basePanSpeed = opts.basePanSpeed ?? 0.69;
        this.targetMouseButton = opts.targetMouseButton ?? 0;
        this._forward = (opts.forward ?? new THREE.Vector3(0, 0, -1)).clone().normalize();
        this._onInteraction = opts.onInteraction ?? null;

        this.State = { IDLE: 'IDLE', DRAGGING: 'DRAGGING' };
        this._state = this.State.IDLE;
        this._enabled = true;

        this._panSpeed = this.basePanSpeed;

        this._panBase = camera.position.clone();

        this._down = {
            mouse: new THREE.Vector2(),
            panBase: this._panBase.clone(),
            touchId: null
        };
        this._dragDistanceSq = 0;
        this.clickSuppressDistance = (opts.clickSuppressDistance ?? 4);

        this._registerCallbacks();
    }

    _registerCallbacks() {
        InputService.onPanStart = (e) => this._onPanStart(e);
        InputService.onPanMove = (e) => this._onPanMove(e);
        InputService.onPanEnd = (e) => this._onPanEnd(e);
    }

    setPanSpeed(panSpeed) {
        this._panSpeed = panSpeed;
    }

    getPanBase(outVec3 = null) {
        const out = outVec3 ?? new THREE.Vector3();
        return out.copy(this._panBase);
    }

    setPanBase(panBase) {
        this._panBase.copy(panBase);
    }

    isDragging() {
        return this._state === this.State.DRAGGING;
    }

    _onPanStart(e) {
        if (!this._enabled) return;
        this._onInteraction?.();
        this._state = this.State.DRAGGING;
        InputService.setDragging(true, e);
        this._dragDistanceSq = 0;
        this._down.mouse.set(e.clientX, e.clientY);
        this._down.panBase.copy(this._panBase);
        this._down.touchId = e.identifier ?? null;
    }

    _onPanMove(e) {
        if (this._state !== this.State.DRAGGING) return;
        this._onInteraction?.();

        const dx = e.clientX - this._down.mouse.x;
        const dy = e.clientY - this._down.mouse.y;
        this._dragDistanceSq = Math.max(this._dragDistanceSq, (dx * dx) + (dy * dy));

        const right = new THREE.Vector3().crossVectors(this.camera.up, this._forward).normalize();
        const up = new THREE.Vector3().copy(this.camera.up).normalize();

        const moveRight = right.multiplyScalar(dx * this._panSpeed);
        const moveUp = up.multiplyScalar(dy * this._panSpeed);

        this._panBase = new THREE.Vector3().copy(this._down.panBase).add(moveRight).add(moveUp);
    }

    _onPanEnd(e) {
        this._onInteraction?.();
        this._state = this.State.IDLE;
        InputService.setDragging(false, e);
        this._down.touchId = null;
    }

    enable(enabled = true) {
        this._enabled = enabled;
    }

    dispose() {
        InputService.onPanStart = null;
        InputService.onPanMove = null;
        InputService.onPanEnd = null;
    }
}

export { CameraPanPass };