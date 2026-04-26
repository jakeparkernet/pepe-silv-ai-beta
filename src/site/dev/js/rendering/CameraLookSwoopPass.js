// CameraController.js
import * as THREE from 'three';

/**
 * Pass 3: Camera look-direction "swoop".
 * Always lerps toward an absolute forward direction, but biases toward the direction of travel (velocity)
 * to create a subtle swoop while panning/zooming, then settles back to forward.
 *
 * This pass DOES NOT change camera.position; it only changes orientation.
 */
class CameraLookSwoopPass {
    /**
     * @param {THREE.PerspectiveCamera} camera
     * @param {Object} opts
     *  - lookLerpRate: how quickly the look direction follows the desired direction (default: 8.0)
     *  - settleLerpRate: how quickly it settles back to absolute forward when not moving (default: 6.0)
     *  - influenceScale: multiplier from speed -> influence weight (default: 0.15)
     *  - maxInfluence: maximum weight of travel direction in the blend (default: 0.55)
     *  - minSpeed: speed threshold below which we treat as not moving (default: 1e-4)
     * @param {Object} deps
     *  - absoluteForward: THREE.Vector3 (normalized)
     *  - up: THREE.Vector3 (camera up, assumed stable)
     */
    constructor(camera, opts = {}, deps = {}) {
        this.camera = camera;

        this.lookLerpRate = opts.lookLerpRate ?? 8.0;
        this.settleLerpRate = opts.settleLerpRate ?? 6.0;
        this.influenceScale = opts.influenceScale ?? 0.09;
        this.maxInfluence = opts.maxInfluence ?? 0.55;
        this.minSpeed = opts.minSpeed ?? 1e-4;

        this.lookLerpRateMin = opts.lookLerpRateMin ?? 2.0;
        this.lookLerpRateMax = opts.lookLerpRateMax ?? 8.0;
        this.influenceScaleMin = opts.influenceScaleMin ?? 0.02;
        this.influenceScaleMax = opts.influenceScaleMax ?? 0.09;
        this.maxInfluenceMin = opts.maxInfluenceMin ?? 0.1;
        this.maxInfluenceMax = opts.maxInfluenceMax ?? 0.55;

        this._absoluteForward = (deps.absoluteForward ?? new THREE.Vector3(0, 0, -1)).clone().normalize();
        this._up = (deps.up ?? camera.up).clone().normalize();

        // Start from current camera look dir, but snap baseline toward absolute forward.
        const cur = new THREE.Vector3();
        camera.getWorldDirection(cur).normalize();
        this._currentLookDir = cur.lengthSq() > 0 ? cur : this._absoluteForward.clone();
        this._currentLookDir.lerp(this._absoluteForward, 0.5).normalize();

        this._tmpVel = new THREE.Vector3();
        this._tmpTravelDir = new THREE.Vector3();
        this._tmpDesiredDir = new THREE.Vector3();
        this._tmpLookAt = new THREE.Vector3();
    }

    /**
     * @param {THREE.Vector3} targetPosition - the composed target position for this frame
     * @param {THREE.Vector3} lastTargetPosition - the composed target position from previous frame
     * @param {number} dtSec - delta time in seconds
     */
    apply(targetPosition, lastTargetPosition, dtSec) {
        // Defensive dt
        const dt = Math.max(0, Math.min(dtSec, 0.1));

        // Velocity in world space
        this._tmpVel.copy(targetPosition).sub(lastTargetPosition);
        const speed = this._tmpVel.length();

        let desiredDir = this._tmpDesiredDir.copy(this._absoluteForward);

        if (speed > this.minSpeed) {
            this._tmpTravelDir.copy(this._tmpVel).normalize();

            // Influence weight based on speed, clamped.
            const w = THREE.MathUtils.clamp(speed * this.influenceScale, 0, this.maxInfluence);

            // Blend absolute forward toward travel direction.
            desiredDir.lerp(this._tmpTravelDir, w).normalize();

            // Follow motion a bit faster while moving.
            const alpha = 1 - Math.exp(-this.lookLerpRate * dt);
            this._currentLookDir.lerp(desiredDir, alpha).normalize();
        } else {
            // Settle back to absolute forward when essentially not moving.
            const alpha = 1 - Math.exp(-this.settleLerpRate * dt);
            this._currentLookDir.lerp(this._absoluteForward, alpha).normalize();
        }

        // Apply orientation. Keep the position at targetPosition; lookAt uses currentLookDir.
        this._tmpLookAt.copy(targetPosition).add(this._currentLookDir);

        this.camera.up.copy(this._up);
        this.camera.position.copy(targetPosition);
        this.camera.lookAt(this._tmpLookAt);
        this.camera.updateMatrixWorld();
    }

    /**
     * Sets the swoop strength based on a normalized zoom value (0 = zoomed out, 1 = zoomed in).
     * At zoom 0, variables are at their min values; at zoom 1, they're at max values.
     * @param {number} zoom - Normalized zoom value from 0 to 1
     */
    setSwoopStrength(zoom) {
        const t = THREE.MathUtils.clamp(zoom, 0, 1);
        this.lookLerpRate = THREE.MathUtils.lerp(this.lookLerpRateMin, this.lookLerpRateMax, t);
        this.influenceScale = THREE.MathUtils.lerp(this.influenceScaleMin, this.influenceScaleMax, t);
        this.maxInfluence = THREE.MathUtils.lerp(this.maxInfluenceMin, this.maxInfluenceMax, t);
    }
}

export { CameraLookSwoopPass };