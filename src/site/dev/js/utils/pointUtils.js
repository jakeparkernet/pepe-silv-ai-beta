import * as THREE from 'three';

const hitCache = new Map();

// Reused temps
const target = new THREE.Vector3();
const _center = new THREE.Vector3();
const _ray = new THREE.Ray();

const radialMap = new Map();

/**
 * Deterministic string key for a Vec3 + seed
 */
export function hashVec3(v, seed = "") {
  return `${seed}|${v.x},${v.y},${v.z}`;
}

/**
 * Unique string key for a Box3 + seed
 */
export function hashBox3(box, seed = "") {
  return `${seed}|min(${box.min.x},${box.min.y},${box.min.z})|max(${box.max.x},${box.max.y},${box.max.z})`;
}

/**
 * Unique key for hit-testing a specific ray direction + box
 */
export function makeHitKey(box, dirNorm) {
  return `${hashBox3(box)}|dir(${dirNorm.x},${dirNorm.y},${dirNorm.z})`;
}

export function getRadialDirections(count, startDirection = null) {
  if (startDirection == null) {
    startDirection = new THREE.Vector3(0, 1, 0);
  }

  const key = hashVec3(startDirection, count);

  if (radialMap.has(key)) {
    return radialMap.get(key);
  }

  const axis = new THREE.Vector3(0, 0, 1);

  const results = [];
  const angleStep = (Math.PI * 2) / count;
  const quaternion = new THREE.Quaternion();

  for (let i = 0; i < count; i++) {
    const angle = angleStep * i;

    quaternion.setFromAxisAngle(axis, angle);

    const rotated = startDirection.clone().applyQuaternion(quaternion);
    results.push(rotated);
  }

  radialMap.set(key, results);
  return results;
}

/**
 * Ray–box point lookup with caching
 */
export function getPointOnBoxAlongDirection(box, direction) {
  const dirNorm = direction.clone().normalize();
  box.getCenter(_center);
  _ray.set(_center, dirNorm);
  const hit = new THREE.Vector3();
  _ray.intersectBox(box, hit);
  return hit;
}

export function clearHitCache() {
  hitCache.clear();
}

export function getPointOnBoxFromCenter(center, width, height, direction) {
  const halfWidth = width / 2;
  const halfHeight = height / 2;
  const box = new THREE.Box3(
    new THREE.Vector3(center.x - halfWidth, center.y - halfHeight, 0),
    new THREE.Vector3(center.x + halfWidth, center.y + halfHeight, 0)
  );
  return getPointOnBoxAlongDirection(box, direction);
}

export function getRadialPoints(count, radius, startDirection = null) {
  let points = getRadialDirections(count, startDirection);
  for (let i = 0; i < points.length; i++) {
    points[i].multiplyScalar(radius);
  }

  return points;
}

export function getRadialPointsWithSpacing(start, end, pivot, count, spacing, chirality = 0) {
  const startAngle = Math.atan2(start.y - pivot.y, start.x - pivot.x);
  const endAngle = Math.atan2(end.y - pivot.y, end.x - pivot.x);

  let angleDiff = endAngle - startAngle;
  while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
  while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;

  if (chirality !== 0) {
    if (chirality > 0 && angleDiff < 0) angleDiff += Math.PI * 2;
    if (chirality < 0 && angleDiff > 0) angleDiff -= Math.PI * 2;
  }

  const segments = count - 1;
  if (segments <= 0) return [start.clone()];

  const angleStep = angleDiff / segments;

  // Radius derived from spacing
  const radius = Math.abs(spacing / angleStep);

  const points = [];

  // Special handling for count=2: place point at 90° to line (world up/forward)
  if (count === 2 && chirality !== 0) {
    const midX = (start.x + end.x) / 2;
    const midY = (start.y + end.y) / 2;
    const midZ = (start.z + end.z) / 2;

    const lineDir = new THREE.Vector3(
      end.x - start.x,
      end.y - start.y,
      end.z - start.z
    ).normalize();

    const worldUp = new THREE.Vector3(0, 1, 0);
    const worldFwd = new THREE.Vector3(0, 0, 1);

    const perp = chirality > 0
      ? worldUp.clone().cross(lineDir)
      : lineDir.clone().cross(worldUp);

    perp.normalize();
    if (perp.length() < 0.001) {
      perp.crossVectors(worldFwd, lineDir).normalize();
    }

    points.push(new THREE.Vector3(
      midX + perp.x * radius,
      midY + perp.y * radius,
      midZ + perp.z * radius
    ));
    return points;
  }

  for (let i = 0; i < count; i++) {
    if (i === 0) {
      points.push(start.clone());
      continue;
    }

    if (i === count - 1) {
      points.push(end.clone());
      continue;
    }

    const angle = startAngle + angleStep * i;

    points.push(new THREE.Vector3(
      pivot.x + radius * Math.cos(angle),
      pivot.y + radius * Math.sin(angle),
      pivot.z
    ));
  }

  return points;
}

export function getRadialPointsFromCenterDir(centerDir, pivot, radius, angleDeg, count) {
  if (count <= 0) {
    return [];
  }

  const angle = angleDeg * (Math.PI / 180); // half-angle in radians
  const centerAngle = Math.atan2(centerDir.y, centerDir.x);

  // Special case: exactly center
  if (count === 1) {
    return [
      new THREE.Vector3(
        pivot.x + radius * Math.cos(centerAngle),
        pivot.y + radius * Math.sin(centerAngle),
        pivot.z
      )
    ];
  }

  const startAngle = centerAngle - angle;
  const endAngle = centerAngle + angle;

  const points = [];

  for (let i = 0; i < count; i++) {
    const t = i / (count - 1); // guarantees endpoints land exactly on ±angle
    const currentAngle = startAngle + (endAngle - startAngle) * t;

    points.push(new THREE.Vector3(
      pivot.x + radius * Math.cos(currentAngle),
      pivot.y + radius * Math.sin(currentAngle),
      pivot.z
    ));
  }

  return points;
}

/**
 * Generates random points uniformly inside a circle in 3D space using a Quaternion for orientation.
 * 
 * @param {THREE.Vector3} center - Center position of the circle
 * @param {number} radius - Radius of the circle
 * @param {THREE.Quaternion} quaternion - Quaternion defining the orientation of the circle
 * @param {number} count - Number of points to generate
 * @param {number|string} seed - Seed for reproducible randomness
 * @returns {THREE.Vector3[]} Array of random points inside the circle
 */
export function generateRandomPointsInCircleSeeded(center, radius, quaternion, count, seed = 0) {
    const points = [];
    
    // Seeded random generator
    const random = createSeededRandom(seed);
    
    // Create two perpendicular vectors in the circle's local plane
    // We'll rotate the local X and Y axes by the given quaternion
    const localRight = new THREE.Vector3(1, 0, 0);
    const localUp    = new THREE.Vector3(0, 1, 0);
    
    // Rotate them into world space using the quaternion
    const right = localRight.clone().applyQuaternion(quaternion);
    const up    = localUp.clone().applyQuaternion(quaternion);
    
    for (let i = 0; i < count; i++) {
        // Uniform disk distribution
        const r = radius * Math.sqrt(random());
        const theta = random() * Math.PI * 2;
        
        const x = r * Math.cos(theta);
        const y = r * Math.sin(theta);
        
        // Build point in world space: center + x*right + y*up
        const point = center.clone()
            .addScaledVector(right, x)
            .addScaledVector(up, y);
        
        points.push(point);
    }
    
    return points;
}

/**
 * Generates random points inside a circle in 3D space using a seeded radial
 * falloff curve so density can be biased toward the center.
 *
 * `radialFalloffCurve` receives a uniform random value in [0, 1) and should
 * return a normalized radius in [0, 1]. Curves that grow slowly near 0 make
 * the center denser and the edges sparser.
 *
 * @param {THREE.Vector3} center - Center position of the circle
 * @param {number} radius - Radius of the circle
 * @param {THREE.Quaternion} quaternion - Quaternion defining the orientation of the circle
 * @param {number} count - Number of points to generate
 * @param {number|string} seed - Seed for reproducible randomness
 * @param {function(number): number} radialFalloffCurve - Maps random [0,1) to normalized radius [0,1]
 * @returns {THREE.Vector3[]} Array of random points inside the circle
 */
export function generateRandomPointsInCircleWithDensityFalloffSeeded(
    center,
    radius,
    quaternion,
    count,
    seed = 0,
    radialFalloffCurve = (t) => t * t
) {
    const points = [];
    const random = createSeededRandom(seed);

    const localRight = new THREE.Vector3(1, 0, 0);
    const localUp = new THREE.Vector3(0, 1, 0);

    const right = localRight.clone().applyQuaternion(quaternion);
    const up = localUp.clone().applyQuaternion(quaternion);

    for (let i = 0; i < count; i++) {
        const t = THREE.MathUtils.clamp(radialFalloffCurve(random()), 0, 1);
        const r = radius * t;
        const theta = random() * Math.PI * 2;

        const x = r * Math.cos(theta);
        const y = r * Math.sin(theta);

        const point = center.clone()
            .addScaledVector(right, x)
            .addScaledVector(up, y);

        points.push(point);
    }

    return points;
}

/**
 * Simple, fast, high-quality seeded PRNG (Mulberry32)
 * @param {number|string} seed
 * @returns {function(): number} A function that returns a random number [0, 1)
 */
export function createSeededRandom(seed) {
    // Convert string seed to number if needed
    let s = typeof seed === 'string' 
        ? hashString(seed) 
        : (seed >>> 0); // ensure unsigned 32-bit
    
    return function() {
        s |= 0; // ensure 32-bit integer
        s = s + 0x6D2B79F5 | 0;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t = t + Math.imul(t ^ (t >>> 7), 61 | t) | 0;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * Simple string to number hash (for string seeds)
 */
export function hashString(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = (hash << 5) - hash + char;
        hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash);
}

export function getQuaternionFromVectors (forward, up, right) {
    let f = forward ? forward.clone() : null;
    let u = up ? up.clone() : null;
    let r = right ? right.clone() : null;

    // Validate at least two vectors exist
    let provided = [f, u, r].filter(v => v !== null).length;
    if (provided < 2) {
        throw new Error("At least two of forward, up, right must be provided.");
    }

    // Reconstruct missing vector
    if (!f) {
        // forward = up × right
        f = new THREE.Vector3().crossVectors(u, r);
    } else if (!u) {
        // up = right × forward
        u = new THREE.Vector3().crossVectors(r, f);
    } else if (!r) {
        // right = forward × up
        r = new THREE.Vector3().crossVectors(f, u);
    }

    // Normalize all
    f.normalize();
    u.normalize();
    r.normalize();

    // Re-orthogonalize (important to avoid drift / skew)
    // Recompute right and up to ensure perfect orthonormal basis
    r.crossVectors(f, u).normalize();
    u.crossVectors(r, f).normalize();

    // Three.js uses column-major matrices
    // Basis vectors go into matrix columns: right, up, forward
    let m = new THREE.Matrix4();
    m.makeBasis(r, u, f);

    return new THREE.Quaternion().setFromRotationMatrix(m);
}
