import * as THREE from 'three';
// import { InputService } from '../services/InputService.js';
// 
const appModules = window[`apps_${performance.timeOrigin}`].modules;
const { InputService } = appModules.services.InputService;

class CameraZoomPass {
    constructor(camera, opts = {}, deps = {}) {
        this.camera = camera;

        this.zoomMode = opts.zoomMode ?? 'positional';
        this.zoomDuration = opts.zoomDuration ?? 0.69;

        this.fovZoomSensitivity = opts.fovZoomSensitivity ?? 0.15;
        this.minFov = opts.minFov ?? 1;
        this.maxFov = opts.maxFov ?? 120;

        this.posZoomSensitivity = opts.posZoomSensitivity ?? 0.025;

        this._getPanBase = deps.getPanBase ?? (() => camera.position.clone());
        this._constructPos = (deps.constructPos ?? camera.position.clone()).clone();
        this._forward = (deps.forward ?? new THREE.Vector3(0, 0, -1)).clone().normalize();
        this._basePanSpeed = deps.basePanSpeed ?? 0.069;
        this._onInteraction = deps.onInteraction ?? null;
        const initialFov = THREE.MathUtils.clamp(opts.initialFov ?? camera.fov, this.minFov, this.maxFov);
        this.camera.fov = initialFov;
        this.camera.updateProjectionMatrix();
        this._baseFov = this.camera.fov;

        this.zoomPerInch = -0.3;

        const defaultForwardZLimit = 21;
        const defaultBackwardZLimit = 80;
        this.forwardZLimit =
            opts.forwardZLimit
            ?? (typeof opts.maxForwardTravel === 'number' ? this._constructPos.z - opts.maxForwardTravel : defaultForwardZLimit);
        this.backwardZLimit =
            opts.backwardZLimit
            ?? (typeof opts.maxBackwardTravel === 'number' ? this._constructPos.z + opts.maxBackwardTravel : defaultBackwardZLimit);

        this._offset = 0;

        this._fovAnim = {
            animating: false,
            startFov: camera.fov,
            endFov: camera.fov,
            startTime: 0
        };

        this._posAnim = {
            animating: false,
            startOffset: 0,
            endOffset: 0,
            startTime: 0
        };

        this._offset = this._clampEndOffset(opts.initialOffset ?? 0);

        this._touchStartDist = null;
        this._touchStartOffset = null;

        this._registerCallbacks();
    }

    _registerCallbacks() {
        InputService.onWheel = (e) => this._onWheel(e);
        InputService.onPinchStart = (e) => this._onPinchStart(e);
        InputService.onPinchMove = (e) => this._onPinchMove(e);
        InputService.onPinchEnd = (e) => this._onPinchEnd(e);
    }

    _easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }

    setZoomMode(mode) {
        if (mode !== 'fov' && mode !== 'positional') throw new Error("zoomMode must be 'fov' or 'positional'");
        this.zoomMode = mode;
    }

    setPositionalClamp({ maxForwardTravel, maxBackwardTravel }) {
        if (typeof maxForwardTravel === 'number') this.forwardZLimit = this._constructPos.z - maxForwardTravel;
        if (typeof maxBackwardTravel === 'number') this.backwardZLimit = this._constructPos.z + maxBackwardTravel;
    }

    setPositionalZClamp({ forwardZLimit, backwardZLimit }) {
        if (typeof forwardZLimit === 'number') this.forwardZLimit = forwardZLimit;
        if (typeof backwardZLimit === 'number') this.backwardZLimit = backwardZLimit;
        this._offset = this._clampEndOffset(this._offset);
    }

    setZoomImmediate({ mode = this.zoomMode, fov, offset } = {}) {
        this.setZoomMode(mode);

        if (this.zoomMode === 'fov') {
            const nextFov = THREE.MathUtils.clamp(
                typeof fov === 'number' ? fov : this.camera.fov,
                this.minFov,
                this.maxFov
            );

            this.camera.fov = nextFov;
            this.camera.updateProjectionMatrix();
            this._fovAnim.animating = false;
            this._fovAnim.startFov = nextFov;
            this._fovAnim.endFov = nextFov;
            return;
        }

        const nextOffset = this._clampEndOffset(typeof offset === 'number' ? offset : this._offset);
        this._offset = nextOffset;
        this._posAnim.animating = false;
        this._posAnim.startOffset = nextOffset;
        this._posAnim.endOffset = nextOffset;
    }

    isAnimating() {
        return this._fovAnim.animating || this._posAnim.animating;
    }

    getCurrentZoomState() {
        if (this.zoomMode === 'fov') {
            return {
                mode: 'fov',
                fov: this.camera.fov
            };
        }

        return {
            mode: 'positional',
            offset: this._offset
        };
    }

    getZoom() {
        if (this.zoomMode === 'fov') {
            return THREE.MathUtils.clamp(
                (this.maxFov - this.camera.fov) / (this.maxFov - this.minFov),
                0,
                1
            );
        }

        const currentZ = this._targetZFromOffset(this._offset);
        const minZ = Math.min(this.forwardZLimit, this.backwardZLimit);
        const maxZ = Math.max(this.forwardZLimit, this.backwardZLimit);
        return THREE.MathUtils.clamp(
            (maxZ - currentZ) / (maxZ - minZ),
            0,
            1
        );
    }

    setZoom(zoom) {
        if (this.zoomMode === 'fov') {
            const nextFov = this.maxFov - (zoom * (this.maxFov - this.minFov));
            this.camera.fov = THREE.MathUtils.clamp(nextFov, this.minFov, this.maxFov);
            this.camera.updateProjectionMatrix();
            return;
        }

        const minZ = Math.min(this.forwardZLimit, this.backwardZLimit);
        const maxZ = Math.max(this.forwardZLimit, this.backwardZLimit);
        const targetZ = maxZ - (zoom * (maxZ - minZ));
        this._offset = this._clampEndOffset(this._offsetFromTargetZ(targetZ));
    }

    setCurrentZoomState({ mode = this.zoomMode, fov, offset } = {}) {
        this.setZoomMode(mode);

        if (this.zoomMode === 'fov') {
            const nextFov = THREE.MathUtils.clamp(
                typeof fov === 'number' ? fov : this.camera.fov,
                this.minFov,
                this.maxFov
            );

            this.camera.fov = nextFov;
            this.camera.updateProjectionMatrix();
            this._fovAnim.animating = false;
            this._fovAnim.startFov = nextFov;
            this._fovAnim.endFov = nextFov;
            return;
        }

        const nextOffset = this._clampEndOffset(typeof offset === 'number' ? offset : this._offset);
        this._offset = nextOffset;
        this._posAnim.animating = false;
        this._posAnim.startOffset = nextOffset;
        this._posAnim.endOffset = nextOffset;
    }

    _targetZFromOffset(offsetVal) {
        return this._getPanBase().z + (this._forward.z * offsetVal);
    }

    _offsetFromTargetZ(z) {
        const panBaseZ = this._getPanBase().z;
        return (z - panBaseZ) / this._forward.z;
    }

    _clampEndOffset(desiredEndOffset) {
        if (Math.abs(this._forward.z) < 1e-6) return desiredEndOffset;

        const panBaseZ = this._getPanBase().z;
        const desiredZ = panBaseZ + (this._forward.z * desiredEndOffset);
        const minZ = Math.min(this.forwardZLimit, this.backwardZLimit);
        const maxZ = Math.max(this.forwardZLimit, this.backwardZLimit);
        const clampedZ = THREE.MathUtils.clamp(desiredZ, minZ, maxZ);
        return (clampedZ - panBaseZ) / this._forward.z;
    }

    _onWheel(e) {
        this._onInteraction?.();
        const now = performance.now() / 1000;

        if (this.zoomMode === 'fov') {
            let currentFov = this.camera.fov;
            if (this._fovAnim.animating) {
                const t = Math.min((now - this._fovAnim.startTime) / this.zoomDuration, 1);
                currentFov = THREE.MathUtils.lerp(this._fovAnim.startFov, this._fovAnim.endFov, this._easeOutCubic(t));
            }

            const desired = THREE.MathUtils.clamp(
                currentFov + e.deltaY * this.fovZoomSensitivity,
                this.minFov,
                this.maxFov
            );

            this._fovAnim.startFov = currentFov;
            this._fovAnim.endFov = desired;
            this._fovAnim.startTime = now;
            this._fovAnim.animating = true;
        } else {
            let currentOffset = this._offset;
            if (this._posAnim.animating) {
                const t = Math.min((now - this._posAnim.startTime) / this.zoomDuration, 1);
                currentOffset = THREE.MathUtils.lerp(this._posAnim.startOffset, this._posAnim.endOffset, this._easeOutCubic(t));
            }

            const desiredEndOffset = currentOffset + (-e.deltaY * this.posZoomSensitivity);
            const clampedEndOffset = this._clampEndOffset(desiredEndOffset);

            this._posAnim.startOffset = currentOffset;
            this._posAnim.endOffset = clampedEndOffset;
            this._posAnim.startTime = now;
            this._posAnim.animating = true;
        }
    }

    update(nowSec) {
        if (this._fovAnim.animating) {
            const t = Math.min((nowSec - this._fovAnim.startTime) / this.zoomDuration, 1);
            const k = this._easeOutCubic(t);

            this.camera.fov = THREE.MathUtils.lerp(this._fovAnim.startFov, this._fovAnim.endFov, k);
            this.camera.updateProjectionMatrix();

            if (t >= 1) this._fovAnim.animating = false;
        }

        if (this._posAnim.animating) {
            const t = Math.min((nowSec - this._posAnim.startTime) / this.zoomDuration, 1);
            const k = this._easeOutCubic(t);

            let intendedOffset = THREE.MathUtils.lerp(this._posAnim.startOffset, this._posAnim.endOffset, k);
            intendedOffset = this._clampEndOffset(intendedOffset);

            this._offset = intendedOffset;

            if (t >= 1) this._posAnim.animating = false;
        }

        if (this.zoomMode === 'fov') {
            return this._basePanSpeed * (this.camera.fov / this._baseFov);
        }

        const currentZ = this._targetZFromOffset(this._offset);
        const zSpan = Math.max(Math.abs(this.backwardZLimit - this.forwardZLimit), 1e-6);
        const proximity = THREE.MathUtils.clamp(
            (currentZ - this.forwardZLimit) / zSpan,
            0.1,
            1.0
        );

        return this._basePanSpeed * proximity;
    }

    applyToTarget(targetPosition) {
        if (this.zoomMode !== 'positional') return;
        targetPosition.add(new THREE.Vector3().copy(this._forward).multiplyScalar(this._offset));
    }

    _onPinchStart(e) {
        this._onInteraction?.();
        this._touchStartDist = e._startDist;
        this._touchStartOffset = this.getZoom();
    }

    _onPinchMove(e) {
        if (this._touchStartDist == null) return;
        if (this._touchStartDist === 0) return;
        this._onInteraction?.();
        const currentDist = e._currentDist;

        const pixelsPerInch = 96;
        const distChangeInches = (currentDist - this._touchStartDist) / pixelsPerInch;
        const zoomDelta = -distChangeInches * this.zoomPerInch;
        const desiredZoom = this._touchStartOffset + zoomDelta;

        this.setZoom(THREE.MathUtils.clamp(desiredZoom, 0, 1));
    }

    _onPinchEnd(e) {
        this._touchStartDist = null;
        this._touchStartOffset = null;
    }

    dispose() {
        InputService.onWheel = null;
        InputService.onPinchStart = null;
        InputService.onPinchMove = null;
        InputService.onPinchEnd = null;
    }
}

export { CameraZoomPass };