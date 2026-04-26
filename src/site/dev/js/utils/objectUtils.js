export function diffObjects(base, updated) {
  // If they are strictly equal, no diff
  if (base === updated) {
    return null; // no changes
  }

  // Handle arrays explicitly
  if (Array.isArray(base) && Array.isArray(updated)) {
    const arraysDiffer =
      base.length !== updated.length ||
      updated.some((v, i) => JSON.stringify(v) !== JSON.stringify(base[i]));

    return arraysDiffer ? updated : null;
  }

  // If either is not an object (or is null), or one is array and the other is not,
  // then the value has changed and we return the updated value as the diff.
  const baseIsObject = typeof base === "object" && base !== null && !Array.isArray(base);
  const updatedIsObject = typeof updated === "object" && updated !== null && !Array.isArray(updated);

  if (!baseIsObject || !updatedIsObject) {
    // type changed, or one side is primitive/null/array
    return updated;
  }

  // Both are plain objects: recurse on keys in updated
  const result = {};
  let hasChanges = false;

  for (const key of Object.keys(updated)) {
    const baseVal = base[key];
    const updatedVal = updated[key];

    const diff = diffObjects(baseVal, updatedVal);

    // Only include keys that actually changed
    if (diff !== null) {
      result[key] = diff;
      hasChanges = true;
    }
  }

  return hasChanges ? result : null;
}

export function applyDiff(base, diff) {
  // If there is no diff, return base as-is
  if (diff === null) {
    return base;
  }

  // If diff is a primitive, null, or array, it fully replaces base
  if (
    diff === null ||
    typeof diff !== "object" ||
    Array.isArray(diff)
  ) {
    return diff;
  }

  // If diff is an object, merge it into a shallow clone of base
  const result = Array.isArray(base)
    ? (base ? base.slice() : [])
    : (typeof base === "object" && base !== null
        ? { ...base }
        : {});

  for (const key of Object.keys(diff)) {
    const valueDiff = diff[key];
    const baseVal = base && typeof base === "object" ? base[key] : null;

    if (
      valueDiff !== null &&
      typeof valueDiff === "object" &&
      !Array.isArray(valueDiff)
    ) {
      // Nested object diff: recurse
      result[key] = applyDiff(baseVal, valueDiff);
    } else {
      // Primitive, array, or null: direct override
      result[key] = valueDiff;
    }
  }

  return result;
}

export function mergeWithDiff(base, updated) {
  const diff = diffObjects(base, updated);

  if (diff === null) {
    // No changes
    return base;
  }

  return applyDiff(base, diff);
}

// Mutating version: applies diff into base and returns true/false if anything changed.
export function tryApplyDiff(base, diff) {
  // No changes at all
  if (diff === null) {
    return false;
  }

  // If diff is primitive, null, or array → full replacement is *logically* needed,
  // but since `base` is passed by reference, the caller should assign it.
  // Here we just report whether base and diff differ.
  if (
    typeof diff !== "object" ||
    diff === null ||
    Array.isArray(diff)
  ) {
    return base !== diff;
  }

  let changed = false;

  for (const key of Object.keys(diff)) {
    const diffVal = diff[key];
    const baseVal = (base && typeof base === "object") ? base[key] : null;

    // Nested object case
    if (
      diffVal !== null &&
      typeof diffVal === "object" &&
      !Array.isArray(diffVal)
    ) {
      // Ensure nested object exists
      if (typeof baseVal !== "object" || baseVal === null || Array.isArray(baseVal)) {
        base[key] = {};
        changed = true;
      }

      // Recurse into child object
      if (tryApplyDiff(base[key], diffVal)) {
        changed = true;
      }
    } else {
      // Primitive, null, or array: direct override
      if (base[key] !== diffVal) {
        base[key] = diffVal;
        changed = true;
      }
    }
  }

  return changed;
}

export function findRelationship(relationships, sourceId, targetId) {
    if (!relationships) return null;
    for (const rel of Object.values(relationships)) {
        if (rel.source_entity_id === sourceId && rel.target_entity_id === targetId) {
            return rel;
        }
    }
    return null;
}
