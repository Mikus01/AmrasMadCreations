export const RENOWN_MIN = -100;
export const RENOWN_MAX = 100;

/** Ordered ascending by minimum points. */
export const RENOWN_LEVELS = Object.freeze([
  Object.freeze({ key: "infamous", min: -100 }),
  Object.freeze({ key: "hated", min: -75 }),
  Object.freeze({ key: "disliked", min: -40 }),
  Object.freeze({ key: "neutral", min: -10 }),
  Object.freeze({ key: "liked", min: 10 }),
  Object.freeze({ key: "respected", min: 40 }),
  Object.freeze({ key: "revered", min: 75 }),
  Object.freeze({ key: "paragon", min: 90 })
]);

/**
 * Clamp renown points to the allowed range.
 * @param {number} points
 * @returns {number}
 */
export function clampRenown(points) {
  if (typeof points !== "number" || !Number.isFinite(points)) {
    throw new TypeError("Renown points must be a finite number.");
  }
  return Math.min(RENOWN_MAX, Math.max(RENOWN_MIN, points));
}

/**
 * Get the level key for a number of points.
 * @param {number} points
 * @returns {string}
 */
export function getRenownLevel(points) {
  const value = clampRenown(points);
  let key = RENOWN_LEVELS[0].key;
  for (const level of RENOWN_LEVELS) if (value >= level.min) key = level.key;
  return key;
}
