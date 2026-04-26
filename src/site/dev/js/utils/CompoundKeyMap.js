class CompoundKeyMap {
  constructor() {
    // Outer map: first key (object) → inner map
    this.outer = new Map();
  }

  /**
   * Set a value for a compound key (obj, key)
   */
  set(obj, key, value) {
    if (obj == null) {
      throw new Error("First compound key must be a non-null object.");
    }

    let inner = this.outer.get(obj);
    if (inner == null) {
      inner = new Map();
      this.outer.set(obj, inner);
    }

    inner.set(key, value);
  }

  /**
   * Get a value for a compound key (obj, key)
   * Returns null if missing.
   */
  get(obj, key) {
    const inner = this.outer.get(obj);
    if (inner == null) return null;

    const val = inner.get(key);
    return val == null ? null : val;
  }

  /**
   * Check existence of a compound key (obj, key)
   */
  has(obj, key) {
    const inner = this.outer.get(obj);
    return inner != null && inner.has(key);
  }

  /**
   * Delete an entry for this compound key
   */
  delete(obj, key) {
    const inner = this.outer.get(obj);
    if (inner == null) return false;

    const deleted = inner.delete(key);

    // Clean up empty inner maps
    if (inner.size === 0) {
      this.outer.delete(obj);
    }

    return deleted;
  }

  /**
   * Completely clear all compound keys
   */
  clear() {
    this.outer.clear();
  }
}

export { CompoundKeyMap };