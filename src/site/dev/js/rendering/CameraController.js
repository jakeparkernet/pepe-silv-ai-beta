import * as THREE from 'three';

import { CameraPanPass } from './CameraPanPass.js';
import { CameraZoomPass } from './CameraZoomPass.js';
import { CameraLookSwoopPass } from './CameraLookSwoopPass.js';

class CameraController {
    /**
     * @param {HTMLCanvasElement} canvas
     * @param {THREE.PerspectiveCamera} camera
     * @param {Object} opts
     *  - zoomMode: 'fov' | 'positional' (default: 'fov')
     *  - zoomDuration: seconds per eased gesture (default: 0.69)
     *  - basePanSpeed: pan speed at baseFov (default: 0.069)
     *  - targetMouseButton: 0 = left (default)
     *  - FOV mode:
     *      fovZoomSensitivity: FOV units per wheel delta (default: 0.15)
     *      minFov: default 20
     *      maxFov: default 90
     *  - Positional mode:
     *      posZoomSensitivity: world units per wheel delta (default: 0.025)
     *      forwardZLimit: optional minimum camera Z during forward zoom
     *      backwardZLimit: optional maximum camera Z during backward zoom
     *      maxForwardTravel/maxBackwardTravel are accepted as legacy relative clamps
     */
    constructor(canvas, camera, opts = {}) {
        this.update = this.update.bind(this);
        this._noteUserInteraction = this._noteUserInteraction.bind(this);
        this._applyIdleHome = this._applyIdleHome.bind(this);

        // State
        this.camera = camera;
        this.canvas = canvas;
        this.idleReturnDelaySec = opts.idleReturnDelaySec ?? 1.5;
        this.idleReturnLerpSpeed = opts.idleReturnLerpSpeed ?? 3.5;
        this._tmpPanBase = new THREE.Vector3();
        this._tmpTargetPanBase = new THREE.Vector3();
        this._lastUserInteractionTimeSec = Number.NEGATIVE_INFINITY;
        this._idleHome = {
            active: false,
            panBase: new THREE.Vector3(),
            zoom: null
        };

        // Forward at construction (camera never rotates per your design)
        this._absoluteForward = new THREE.Vector3();
        camera.getWorldDirection(this._absoluteForward).normalize();

        // For legacy naming compatibility in passes that expect 'forward'
        this._forward = this._absoluteForward.clone();

        // Construction-time anchor (clamp is measured from here along forward)
        this._constructPos = camera.position.clone();

        // Target position that passes will modify each frame (camera copies this)
        this._targetPosition = camera.position.clone();

        // Pass 1: pan
        this._panPass = new CameraPanPass(canvas, camera, {
            basePanSpeed: opts.basePanSpeed ?? 1.69,
            targetMouseButton: opts.targetMouseButton ?? 0,
            forward: this._forward,
            onInteraction: this._noteUserInteraction
        });

        // Pass 2: zoom
        this._zoomPass = new CameraZoomPass(camera, opts, {
            getPanBase: () => this._panPass.getPanBase(new THREE.Vector3()),
            constructPos: this._constructPos,
            forward: this._forward,
            basePanSpeed: opts.basePanSpeed ?? 0.02,
            onInteraction: this._noteUserInteraction
        });

        // Pass 3: look-direction swoop (runs AFTER position composition)
        this._lookPass = new CameraLookSwoopPass(camera, opts, {
            absoluteForward: this._absoluteForward,
            up: this.camera.up
        });

        this._lastTargetPosition = this._targetPosition.clone();
        this._lastTimeSec = performance.now() / 1000;
    }

    _syncCameraFromPasses(nowSec) {
        // Update zoom (and get panSpeed recommendation), then compose target: pan -> zoom.
        const panSpeed = this._zoomPass.update(nowSec);
        this._panPass.setPanSpeed(panSpeed);
        this._applyIdleHome(nowSec);

        // Compose target position for this frame: pan first, then zoom.
        this._panPass.getPanBase(this._targetPosition);
        this._zoomPass.applyToTarget(this._targetPosition);

        // Camera copies the target position first (orientation is handled in the look pass).
        this.camera.position.copy(this._targetPosition);

        // Look-direction swoop pass (orientation)
        const dt = Math.max(0, nowSec - this._lastTimeSec);
        const zoom = this._zoomPass.getZoom();
        this._lookPass.setSwoopStrength(zoom);
        this._lookPass.apply(this._targetPosition, this._lastTargetPosition, dt);

        // Track for next frame
        this._lastTargetPosition.copy(this._targetPosition);
        this._lastTimeSec = nowSec;
    }

    _noteUserInteraction() {
        this._lastUserInteractionTimeSec = performance.now() / 1000;
    }

    _applyIdleHome(nowSec) {
        if (!this._idleHome.active) {
            return;
        }

        if (this._panPass.isDragging() || this._zoomPass.isAnimating()) {
            return;
        }

        if ((nowSec - this._lastUserInteractionTimeSec) < this.idleReturnDelaySec) {
            return;
        }

        const dt = Math.max(0, nowSec - this._lastTimeSec);
        const alpha = 1 - Math.exp(-this.idleReturnLerpSpeed * dt);

        const currentPanBase = this._panPass.getPanBase(this._tmpPanBase);
        const targetPanBase = this._tmpTargetPanBase.copy(currentPanBase);
        targetPanBase.x = this._idleHome.panBase.x;
        targetPanBase.y = this._idleHome.panBase.y;
        targetPanBase.z = this._idleHome.panBase.z;
        currentPanBase.lerp(targetPanBase, alpha);
        this._panPass.setPanBase(currentPanBase);

        if (this._idleHome.zoom == null) {
            return;
        }

        const currentZoom = this._zoomPass.getCurrentZoomState();
        if (currentZoom.mode === 'fov' && this._idleHome.zoom.mode === 'fov') {
            this._zoomPass.setCurrentZoomState({
                mode: 'fov',
                fov: THREE.MathUtils.lerp(currentZoom.fov, this._idleHome.zoom.fov, alpha)
            });
            return;
        }

        if (currentZoom.mode === 'positional' && this._idleHome.zoom.mode === 'positional') {
            this._zoomPass.setCurrentZoomState({
                mode: 'positional',
                offset: THREE.MathUtils.lerp(currentZoom.offset, this._idleHome.zoom.offset, alpha)
            });
        }
    }

    // ---------- API ----------

    update() {
        const now = performance.now() / 1000;
        this._syncCameraFromPasses(now);
    }

    setZoomMode(mode) {
        this._zoomPass.setZoomMode(mode);
    }

    setPositionalClamp({ maxForwardTravel, maxBackwardTravel }) {
        this._zoomPass.setPositionalClamp({ maxForwardTravel, maxBackwardTravel });
    }

    setPositionalZClamp({ forwardZLimit, backwardZLimit }) {
        this._zoomPass.setPositionalZClamp({ forwardZLimit, backwardZLimit });
    }

    setZoomImmediate(zoomConfig = {}) {
        this._zoomPass.setZoomImmediate(zoomConfig);
        this._syncCameraFromPasses(performance.now() / 1000);
    }

    enable(enabled = true) {
        this._panPass.enable(enabled);
    }

    getPanBase(outVec3 = null) {
        return this._panPass.getPanBase(outVec3);
    }

    setIdleHome({ panBase = null, zoom = null } = {}) {
        this._idleHome.active = true;

        if (panBase != null) {
            this._idleHome.panBase.copy(panBase);
        }

        this._idleHome.zoom = zoom != null ? { ...zoom } : null;
    }

    clearIdleHome() {
        this._idleHome.active = false;
        this._idleHome.zoom = null;
    }

    dispose() {
        this._panPass.dispose();
        this._zoomPass.dispose();
        this._lookPass = null;
    }
}

export { CameraController };
