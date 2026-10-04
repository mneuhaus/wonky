// Vector helpers of the viewer measurements on the Rust kernel: plain IEEE
// binary64 over the world-millimetre carrier data of the record (the Rust
// carriers op states every value after one exact composition and one rounding).
// Same interface as exactMath's Bend Real implementation (geometry.mjs); the
// arithmetic guard of these operations is RELATIVE_GUARD.binary64.
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = a => Math.hypot(a[0], a[1], a[2]);

export function binary64Math() {
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
  return {
    label: 'binary64 over the Rust carriers',
    dot, norm, sub, add, scale,
    cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
    normalize(a) {
      const length = norm(a);
      if (!(length > 0)) throw new Error('A zero-length direction has no orientation');
      return scale(a, 1 / length);
    },
    atan2: (y, x) => Math.atan2(y, x),
    sqrt: value => Math.sqrt(Math.max(0, value)),
    // Point on the line through `point` along unit `direction` nearest to `target`.
    foot: (point, direction, target) => add(point, scale(direction, dot(sub(target, point), direction))),
  };
}

// Parameter (rad) of `point` on a circle carrier {origin, normal, x}: the angle
// from the x direction about the normal.
export function circleParameter(curve, point) {
  const n = curve.normal, x = curve.x;
  const nl = norm(n);
  const u = scaleTo(n, 1 / nl);
  const y = [u[1] * x[2] - u[2] * x[1], u[2] * x[0] - u[0] * x[2], u[0] * x[1] - u[1] * x[0]];
  const d = [point[0] - curve.origin[0], point[1] - curve.origin[1], point[2] - curve.origin[2]];
  return Math.atan2(dot(d, y), dot(d, x));
}
const scaleTo = (a, s) => [a[0] * s, a[1] * s, a[2] * s];

// World point of a circle carrier at parameter t.
export function circlePoint(curve, t) {
  const n = curve.normal, x = curve.x;
  const u = scaleTo(n, 1 / norm(n));
  const y = [u[1] * x[2] - u[2] * x[1], u[2] * x[0] - u[0] * x[2], u[0] * x[1] - u[1] * x[0]];
  const r = curve.radius, c = Math.cos(t), s = Math.sin(t);
  return [0, 1, 2].map(k => curve.origin[k] + r * (c * x[k] + s * y[k]));
}
