// Centerer.js
import * as THREE from "three";

class Centerer {
  static centerObject3D(obj, target = new THREE.Vector3()) {
    // Compute AABB in world space and shift so its center is at 'target'
    const box = new THREE.Box3().setFromObject(obj, true);
    const center = box.getCenter(new THREE.Vector3());
    obj.position.add(target.clone().sub(center));
    return { box, center };
  }
}

export { Centerer };
