export const INDEX_CARD_EASINGS = {
  linear: t => 1 - t,
  quadOut: t => 1 - t * t,
  cubicOut: t => 1 - t * t * t,
  smooth: t => 1 - (t * t * (3 - 2 * t)), // reversed smoothstep
};

export function getBleedFunction(spec) {
  if (typeof spec === 'function') return spec;
  if (typeof spec === 'string' && INDEX_CARD_EASINGS[spec]) {
    return INDEX_CARD_EASINGS[spec];
  }
  console.warn('[IndexCard] Unknown bleed algorithm:', spec, '→ linear');
  return INDEX_CARD_EASINGS.linear;
}

export function parseColor(color) {
  if (!color) return [255, 255, 255];

  if (Array.isArray(color)) {
    return [color[0] ?? 0, color[1] ?? 0, color[2] ?? 0];
  }

  if (typeof color === 'string') {
    if (color[0] === '#') {
      const hex = color.slice(1);
      if (hex.length === 3) {
        const r = parseInt(hex[0] + hex[0], 16);
        const g = parseInt(hex[1] + hex[1], 16);
        const b = parseInt(hex[2] + hex[2], 16);
        return [r, g, b];
      }
      if (hex.length === 6) {
        const r = parseInt(hex.slice(0, 2), 16);
        const g = parseInt(hex.slice(2, 4), 16);
        const b = parseInt(hex.slice(4, 6), 16);
        return [r, g, b];
      }
    }
  }

  console.warn('[IndexCard] Could not parse color:', color, '→ white');
  return [255, 255, 255];
}

export function blendRgb(base, line, alpha) {
  const inv = 1 - alpha;
  return [
    base[0] * inv + line[0] * alpha,
    base[1] * inv + line[1] * alpha,
    base[2] * inv + line[2] * alpha,
  ];
}

// Compute alpha contribution for a horizontal line band at rowY
export function computeLineAlphaForRow(rowY, lineOpts, texHeight) {
  if (!lineOpts) return 0;

  const thickness = lineOpts.thickness ?? 1;
  const bleed = lineOpts.bleed ?? 0;
  const bleedFn = getBleedFunction(lineOpts.bleedAlgorithm);
  const halfThick = thickness / 2;
  const maxDist = halfThick + bleed;

  let centerY = null;

  if (typeof lineOpts.y === 'number') {
    // Single heading rule
    centerY = lineOpts.y;
  } else if (typeof lineOpts.firstY === 'number' && lineOpts.spacing > 0) {
    // Repeating ruled lines
    const spacing = lineOpts.spacing;
    const k = Math.round((rowY - lineOpts.firstY) / spacing);
    if (k < 0) return 0;
    centerY = lineOpts.firstY + k * spacing;
  } else {
    return 0;
  }

  if (centerY < -maxDist || centerY > texHeight + maxDist) return 0;

  const dist = Math.abs(rowY - centerY);
  if (dist > maxDist) return 0;
  if (dist <= halfThick) return 1;

  if (bleed <= 0) return 0;

  const t = (dist - halfThick) / bleed;
  const clampedT = Math.min(Math.max(t, 0), 1);
  return bleedFn(clampedT);
}