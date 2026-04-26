import * as THREE from "three";

export const TravelDirectionIndices = [
    "up",
    "right",
    "down",
    "left"
]

export const TravelDirections =  {
    up: "up",
    down: "down",
    left: "left",
    right: "right",
};

export const TravelDirectionVectors = {
  up: new THREE.Vector3(0, 1, 0),
  down: new THREE.Vector3(0, -1, 0),
  left: new THREE.Vector3(-1, 0, 0),
  right: new THREE.Vector3(1, 0, 0),
};

export function getInverseTravelDirection (travelDirection) {
    switch (travelDirection) {
        case "up":
            return "down";
        case "down":
            return "up";
        case "left":
            return "right";
        case "right":
            return "left";
    }

    return "none";
};

// Map string → index (0–3)
const TravelDirectionToIndex = {
  up: 0,
  right: 1,
  down: 2,
  left: 3,
};

// Always wrap to 0–3 safely
function normIndex(i) {
  return ((i % 4) + 4) % 4;
}

// String → index
export function directionToIndex(direction) {
  return TravelDirectionToIndex[direction];
}

// Index → string
export function indexToDirection(index) {
  return TravelDirectionIndices[normIndex(index)];
}

/**
 * Given how a child is "facing" relative to its parent ("up"/"right"/"down"/"left"),
 * return the relative rotation in 90° clockwise steps.
 *
 *  up   → 0  (same as parent up)
 *  right→ 1  (90° CW from parent up)
 *  down → 2
 *  left → 3
 */
export function facingToRelativeRotation(facingDirection) {
  return directionToIndex(facingDirection);
}

/**
 * Accumulate rotation: given the parent's global rotation (0–3) and the child's
 * facing direction, return the child's global rotation.
 *
 * globalRot = "how many 90° CW steps from root's up".
 */
export function accumulateGlobalRotation(parentGlobalRot, childFacingDirection) {
  const delta = facingToRelativeRotation(childFacingDirection);
  return normIndex(parentGlobalRot + delta);
}

/**
 * Given a node's globalRot, returns which GLOBAL direction its LOCAL direction maps to.
 * "If I push 'localDirection' here, which global direction is that?"
 */
export function getGlobalDirectionForLocal(localDirection, nodeGlobalRot) {
  const localIndex = directionToIndex(localDirection);
  const globalIndex = normIndex(localIndex + nodeGlobalRot);
  return indexToDirection(globalIndex);
}

/**
 * Inverse of the above: given a node's globalRot, and a GLOBAL direction,
 * which LOCAL direction corresponds to that?
 *
 * "Which local direction here matches globalDirection?"
 */
export function getLocalDirectionForGlobal(globalDirection, nodeGlobalRot) {
  const globalIndex = directionToIndex(globalDirection);
  const localIndex = normIndex(globalIndex - nodeGlobalRot);
  return indexToDirection(localIndex);
}

/**
 * Convenience: get the global Vector3 for a given LOCAL direction at this node.
 * (Still no float-based equality for logic; vectors are just a final representation.)
 */
export function getGlobalVectorForLocal(localDirection, nodeGlobalRot) {
  const globalDir = getGlobalDirectionForLocal(localDirection, nodeGlobalRot);
  return TravelDirectionVectors[globalDir];
}