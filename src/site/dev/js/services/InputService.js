import * as THREE from "three";
import { OBB } from "../thirdparty/three.js-r181/examples/jsm/math/OBB.js";

class InputService {
    static canvas = null;
    static scene = null;
    static camera = null;
    static raycaster = new THREE.Raycaster();
    static pointerNdc = new THREE.Vector2();
    static colliders = new Map();
    static _tmpHitPoint = new THREE.Vector3();
    static isDragging = false;
    static _wentMultitouch = false;
    static lastPointerEvent = null;
    static hoveredIntersection = null;

    static onPanStart = null;
    static onPanMove = null;
    static onPanEnd = null;
    static onWheel = null;
    static onPinchStart = null;
    static onPinchMove = null;
    static onPinchEnd = null;

    static pointerThresholdSq = 25;
    static clickThresholdSq = 100;

    static _pointers = [];
    static _primaryDownPos = null;
    static _isPinching = false;
    static _pinchStartDist = null;
    static _suppressNextClick = false;

    static init(canvas, scene, camera) {
        if (InputService.canvas != null) {
            InputService._removeEventListeners();
        }

        InputService.canvas = canvas;
        InputService.scene = scene;
        InputService.camera = camera;

        if (InputService.canvas != null) {
            InputService._addEventListeners();
            InputService.canvas.style.cursor = "grab";
            InputService.canvas.style.touchAction = "none";
            InputService.canvas.style.webkitTapHighlightColor = "transparent";
            InputService.canvas.style.userSelect = "none";
            InputService.canvas.style.webkitUserSelect = "none";
        }
    }

    static _addEventListeners() {
        const canvas = InputService.canvas;

        canvas.addEventListener("pointerdown", InputService._onPointerDown);
        canvas.addEventListener("pointermove", InputService._onPointerMove);
        canvas.addEventListener("pointerup", InputService._onPointerUp);
        canvas.addEventListener("pointercancel", InputService._onPointerUp);
        canvas.addEventListener("lostpointercapture", InputService._onPointerUp);

        canvas.addEventListener("wheel", InputService._onWheel, { passive: false });
    }

    static _removeEventListeners() {
        const canvas = InputService.canvas;

        canvas.removeEventListener("pointerdown", InputService._onPointerDown);
        canvas.removeEventListener("pointermove", InputService._onPointerMove);
        canvas.removeEventListener("pointerup", InputService._onPointerUp);
        canvas.removeEventListener("pointercancel", InputService._onPointerUp);
        canvas.removeEventListener("lostpointercapture", InputService._onPointerUp);

        canvas.removeEventListener("wheel", InputService._onWheel);

        canvas.style.touchAction = "";
    }

    static createWorldObbFromObject(object, localSize = new THREE.Vector3(1, 1, 1), localCenter = null) {
        if (object == null) {
            return null;
        }

        const center = (localCenter ?? new THREE.Vector3()).clone();
        const worldCenter = object.localToWorld(center);
        const worldQuaternion = object.getWorldQuaternion(new THREE.Quaternion());
        const worldScale = object.getWorldScale(new THREE.Vector3());

        const worldSize = new THREE.Vector3(
            Math.abs(localSize.x * worldScale.x),
            Math.abs(localSize.y * worldScale.y),
            Math.abs(localSize.z * worldScale.z)
        );

        const rotation = new THREE.Matrix3().setFromMatrix4(
            new THREE.Matrix4().makeRotationFromQuaternion(worldQuaternion)
        );

        return new OBB(worldCenter, worldSize.multiplyScalar(0.5), rotation);
    }

    static getPointerNdc(event) {
        const rect = InputService.canvas.getBoundingClientRect();

        InputService.pointerNdc.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        InputService.pointerNdc.y = -(((event.clientY - rect.top) / rect.height) * 2 - 1);

        return InputService.pointerNdc;
    }

    static getIntersections(event) {
        if (InputService.camera == null || InputService.colliders.size === 0) {
            return [];
        }

        const pointer = InputService.getPointerNdc(event);
        InputService.raycaster.setFromCamera(pointer, InputService.camera);

        const intersections = [];

        for (const [collider, owner] of InputService.colliders.entries()) {
            let hitPoint = null;

            if (collider instanceof OBB) {
                hitPoint = collider.intersectRay(InputService.raycaster.ray, InputService._tmpHitPoint);
            } else if (collider instanceof THREE.Box3) {
                if (collider.isEmpty()) {
                    continue;
                }

                hitPoint = InputService.raycaster.ray.intersectBox(collider, InputService._tmpHitPoint);
            } else {
                continue;
            }

            if (hitPoint == null) {
                continue;
            }

            intersections.push({
                collider,
                owner,
                distance: InputService.raycaster.ray.origin.distanceTo(hitPoint)
            });
        }

        intersections.sort((a, b) => a.distance - b.distance);
        return intersections;
    }

    static resolveClickHandler(target) {
        if (target == null) {
            return null;
        }

        if (typeof target.onClick === "function") {
            return target.onClick.bind(target);
        }

        if (typeof target.userData?.onClick === "function") {
            return target.userData.onClick.bind(target);
        }

        return null;
    }

    static handleIntersectionClick(intersection, event) {
        const owner = intersection.owner ?? intersection.collider;

        const handler =
            InputService.resolveClickHandler(owner)
            ?? InputService.resolveClickHandler(intersection.collider);

        if (handler == null) {
            return false;
        }

        handler({
            event,
            owner,
            collider: intersection.collider,
            distance: intersection.distance,
            raycaster: InputService.raycaster
        });

        return true;
    }

    static getClickableIntersection(event) {
        const intersections = InputService.getIntersections(event);

        for (const intersection of intersections) {
            const owner = intersection.owner ?? intersection.collider;

            const handler =
                InputService.resolveClickHandler(owner)
                ?? InputService.resolveClickHandler(intersection.collider);

            if (handler != null) {
                return intersection;
            }
        }

        return null;
    }

    static getHoveredIntersection() {
        return InputService.hoveredIntersection;
    }

    static setHoveredIntersection(intersection) {
        InputService.hoveredIntersection = intersection ?? null;
    }

    static _getTouchDistance(p1, p2) {
        const dx = p1.x - p2.x;
        const dy = p1.y - p2.y;

        return Math.sqrt(dx * dx + dy * dy);
    }

    static _onClick(event) {
        if (InputService._suppressNextClick) {
            InputService._suppressNextClick = false;
            event.preventDefault();
            return;
        }

        const intersections = InputService.getIntersections(event);

        for (const intersection of intersections) {
            if (InputService.handleIntersectionClick(intersection, event)) {
                return;
            }
        }
    }

    static _onPointerDown(event) {
        event.preventDefault();

        if (InputService.canvas == null) {
            return;
        }

        try {
            InputService.canvas.setPointerCapture(event.pointerId);
        } catch {
            // Some browsers can throw if capture is not available for this pointer.
        }

        const id = event.pointerId;

        if (InputService._pointers.find(p => p.id === id) != null) {
            return;
        }

        const point = {
            id,
            x: event.clientX,
            y: event.clientY
        };

        InputService._pointers.push(point);

        if (InputService._pointers.length === 1) {
            InputService._primaryDownPos = { x: point.x, y: point.y };
            InputService.isDragging = false;
            InputService._isPinching = false;
            InputService._pinchStartDist = null;
            InputService._wentMultitouch = false;
        } else if (InputService._pointers.length === 2) {
            InputService._wentMultitouch = true;
            InputService._handlePinchStart();
        }

        InputService.lastPointerEvent = {
            clientX: event.clientX,
            clientY: event.clientY
        };

        InputService.refreshCursor(event);
    }

    static _onPointerMove(event) {
        event.preventDefault();

        const point = InputService._pointers.find(p => p.id === event.pointerId);

        if (point != null) {
            point.x = event.clientX;
            point.y = event.clientY;
        }

        if (InputService._isPinching && InputService._pointers.length >= 2) {
            InputService._handlePinchMove();
        } else if (InputService._pointers.length === 1) {
            InputService._handleDrag(event, InputService._pointers[0]);
        }

        InputService.lastPointerEvent = {
            clientX: event.clientX,
            clientY: event.clientY
        };

        InputService.setHoveredIntersection(InputService.getClickableIntersection(event));
        InputService.refreshCursor(event);
    }

    static _onPointerUp(event) {
        event.preventDefault();

        const id = event.pointerId;
        const releasedKnownPointer = InputService._pointers.some(p => p.id === id);
        const wasDragging = InputService.isDragging;
        const wasPinching = InputService._isPinching;

        InputService._pointers = InputService._pointers.filter(p => p.id !== id);

        try {
            if (InputService.canvas?.hasPointerCapture?.(id)) {
                InputService.canvas.releasePointerCapture(id);
            }
        } catch {
            // Ignore release errors.
        }

        if (!releasedKnownPointer) {
            return;
        }

        if (wasPinching) {
            InputService._isPinching = false;
            InputService._pinchStartDist = null;
            InputService.onPinchEnd?.(event);

            if (InputService._pointers.length === 1) {
                const remainingPointer = InputService._pointers[0];
                InputService._primaryDownPos = {
                    x: remainingPointer.x,
                    y: remainingPointer.y
                };
                InputService.isDragging = false;
            }
        } else if (wasDragging) {
            InputService.isDragging = false;
            InputService.onPanEnd?.(event);
        } else if (
            !InputService._wentMultitouch &&
            InputService._pointers.length === 0 &&
            InputService._primaryDownPos != null
        ) {
            const dx = event.clientX - InputService._primaryDownPos.x;
            const dy = event.clientY - InputService._primaryDownPos.y;
            const distSq = dx * dx + dy * dy;

            if (distSq < InputService.clickThresholdSq) {
                InputService._onClick(event);
            }
        }

        if (InputService._pointers.length === 0) {
            InputService._primaryDownPos = null;
            InputService.isDragging = false;
            InputService._isPinching = false;
            InputService._pinchStartDist = null;
            InputService._wentMultitouch = false;
        }

        InputService.refreshCursor(event);
    }
    static _handlePointerClick(event) {
        const intersections = InputService.getIntersections(event);

        for (const intersection of intersections) {
            if (InputService.handleIntersectionClick(intersection, event)) {
                return;
            }
        }
    }
    static _onWheel(event) {
        event.preventDefault();
        InputService.onWheel?.(event);
    }

    static _handleDrag(event, point) {
        if (InputService._primaryDownPos == null) {
            return;
        }

        const dx = point.x - InputService._primaryDownPos.x;
        const dy = point.y - InputService._primaryDownPos.y;
        const distSq = dx * dx + dy * dy;

        if (!InputService.isDragging && distSq >= InputService.pointerThresholdSq) {
            InputService.isDragging = true;
            InputService.onPanStart?.(event);
            return;
        }

        if (InputService.isDragging) {
            InputService.onPanMove?.(event);
        }
    }

    static _handlePinchStart() {
        if (InputService._pointers.length < 2) {
            return;
        }

        if (InputService.isDragging) {
            InputService.isDragging = false;
            InputService.onPanEnd?.({});
        }

        InputService._isPinching = true;

        InputService._pinchStartDist = InputService._getTouchDistance(
            InputService._pointers[0],
            InputService._pointers[1]
        );

        InputService.onPinchStart?.({
            _startDist: InputService._pinchStartDist,
            _currentDist: InputService._pinchStartDist
        });
    }

    static _handlePinchMove() {
        if (InputService._pointers.length < 2 || !InputService._isPinching) {
            return;
        }

        const currentDist = InputService._getTouchDistance(
            InputService._pointers[0],
            InputService._pointers[1]
        );

        InputService.onPinchMove?.({
            _startDist: InputService._pinchStartDist,
            _currentDist: currentDist
        });
    }

    static refreshCursor(event = InputService.lastPointerEvent) {
        if (InputService.canvas == null) {
            return;
        }

        if (InputService.isDragging) {
            InputService.canvas.style.cursor = "grabbing";
            return;
        }

        if (InputService.hoveredIntersection != null) {
            InputService.canvas.style.cursor = "pointer";
            return;
        }

        InputService.canvas.style.cursor = "grab";
    }

    static setDragging(isDragging, event = null) {
        InputService.isDragging = !!isDragging;

        if (event != null) {
            InputService.lastPointerEvent = {
                clientX: event.clientX,
                clientY: event.clientY
            };
        }

        InputService.refreshCursor(event ?? InputService.lastPointerEvent);
    }

    static registerCollider(object, collider) {
        const owner = object ?? collider;
        const targetCollider = collider ?? object;

        if (targetCollider == null) {
            return null;
        }

        if (!(targetCollider instanceof OBB) && !(targetCollider instanceof THREE.Box3)) {
            throw new Error("InputService.registerCollider expects a THREE.OBB or THREE.Box3 collider");
        }

        InputService.colliders.set(targetCollider, owner);
        return targetCollider;
    }

    static unregisterCollider(collider) {
        if (collider == null) {
            return;
        }

        if (InputService.hoveredIntersection?.collider === collider) {
            InputService.setHoveredIntersection(null);
        }

        InputService.colliders.delete(collider);
    }

    static dispose() {
        if (InputService.canvas != null) {
            InputService._removeEventListeners();
            InputService.canvas.style.cursor = "";
            InputService.canvas.style.touchAction = "";
        }

        InputService.canvas = null;
        InputService.scene = null;
        InputService.camera = null;
        InputService.colliders.clear();
        InputService.isDragging = false;
        InputService.lastPointerEvent = null;
        InputService.hoveredIntersection = null;
        InputService._pointers = [];
        InputService._primaryDownPos = null;
        InputService._isPinching = false;
        InputService._pinchStartDist = null;
        InputService._suppressNextClick = false;
    }
}

export { InputService };