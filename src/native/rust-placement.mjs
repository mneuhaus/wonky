import { sourceRotationChart } from '../construction-frame.mjs';
// Keep the construction axes of toWorld beside its rounded FS matrix. Geometry
// uses the exact interpreter frame (x, z, z cross x); ordinary FS arithmetic
// still sees the standard matrix. A copied/composed matrix loses this lineage
// and is not silently promoted to an exact placement.
const placements = new WeakMap();
const linearPlacements = new WeakMap();
const worldDirections = new WeakMap();
const worldPoints = new WeakMap();
const queryPlanes = new WeakMap();
const coordinates = vector => vector.items.map(q => typeof q === 'number' ? q : q.value);
const unchanged = (vector, values) => vector?.items?.length === values.length &&
  coordinates(vector).every((x, i) => x === values[i]);
export function rememberPlacement(transform, cs) {
  const frame = { origin: cs.origin.items.map(q => q.value), x: [...cs.xAxis.items], z: [...cs.zAxis.items],
    rows: transform.linear.rows.map(row => [...row]) };
  placements.set(transform, frame);
  linearPlacements.set(transform.linear, frame);
  return transform;
}
export function exactPlacement(transform) {
  const frame = placements.get(transform);
  if (!frame || !frame.origin.every((x, i) => x === transform.translation?.items[i]?.value) ||
      !frame.rows.every((row, i) => row.every((x, j) => x === transform.linear?.rows[i]?.[j]))) return null;
  return frame;
}

// Preserve explicitly constructed coordinate-axis directions as well as the
// original cs axes. Matrix arithmetic/copying does not inherit this witness.
// A general primal vector is NOT an affine dual normal: only source coordinate
// axes participate in the same source-plane semantics as cs.xAxis/cs.zAxis.
export function rememberWorldDirection(result, matrix, input) {
  const frame = linearPlacements.get(matrix);
  if (frame && frame.rows.length === matrix.rows.length &&
      frame.rows.every((row, i) => row.length === matrix.rows[i]?.length && row.every((x, j) => x === matrix.rows[i][j])) &&
      input.items.length === 3 && input.items.every(x => typeof x === 'number' && Number.isFinite(x)) &&
      input.items.filter(x => x !== 0).length === 1) {
    worldDirections.set(result, { frame, local: [...input.items], values: coordinates(result) });
  }
  return result;
}
const sameFrame = (a, b) => ['origin', 'x', 'z'].every(key => a[key].every((x, i) => x === b[key][i]));

// A toWorld point keeps its pre-rounding source coordinates. Only actual axes
// constructed in that same frame may give a plane a local normal; numeric
// similarity is not provenance. Other planes retain world-space predicates.
export function rememberWorldPoint(result, point, transform, cs) {
  const frame = exactPlacement(transform);
  if (frame) worldPoints.set(result, { frame, local: coordinates(point),
    values: coordinates(result), xAxis: cs.xAxis, zAxis: cs.zAxis });
  return result;
}
export function rememberQueryPlane(result, origin, normal) {
  const source = worldPoints.get(origin);
  if (!source || !unchanged(origin, source.values)) return result;
  let localNormal;
  if (normal === source.xAxis && unchanged(normal, source.frame.x)) localNormal = [1, 0, 0];
  else if (normal === source.zAxis && unchanged(normal, source.frame.z)) localNormal = [0, 0, 1];
  else {
    const direction = worldDirections.get(normal);
    if (!direction || !unchanged(normal, direction.values) || !sameFrame(source.frame, direction.frame)) return result;
    localNormal = direction.local;
  }
  queryPlanes.set(result, { frame: source.frame, origin: source.local, normal: localNormal,
    worldOrigin: coordinates(result.origin), worldNormal: coordinates(result.normal) });
  return result;
}
export function exactQueryPlane(plane) {
  const source = queryPlanes.get(plane);
  return source && unchanged(plane.origin, source.worldOrigin) && unchanged(plane.normal, source.worldNormal)
    ? source : null;
}

// Two profile planes share the same constructed interpreter axes. The upper
// origin must be a tagged toWorld point on its Z axis: subtracting rounded
// world coordinates would lose the exact profile separation in translated frames.
export function commonLoftFrame(bottom, top) {
  const source = worldPoints.get(top?.origin);
  if (!source || !unchanged(top.origin, source.values) ||
      !unchanged(bottom.origin, source.frame.origin) ||
      !unchanged(bottom.x, source.frame.x) || !unchanged(top.x, source.frame.x) ||
      !unchanged(bottom.normal, source.frame.z) || !unchanged(top.normal, source.frame.z) ||
      source.local.length !== 3 || source.local[0] !== 0 || source.local[1] !== 0) return null;
  return { frame: source.frame, height: source.local[2] };
}

// Shared with motion sampling: integer rotation columns and separate exact
// translations. Never materialize (origin - R*origin) as rounded geometry.
const IDENTITY_ROWS = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
const negate = v => v.map(x => (x === 0 ? 0 : -x));
const translation = origin => ({ origin, x: [1, 0, 0], z: [0, 0, 1] });

// Rotation by k quarter turns (right-hand rule) about a coordinate axis, as an
// integer matrix: R = a a^T + cos (I - a a^T) + sin [a]x with cos, sin in {0, +-1}.
export function quarterTurn(axis, k) {
  const cos = [1, 0, -1, 0][k], sin = [0, 1, 0, -1][k];
  const cross = v => [axis[1] * v[2] - axis[2] * v[1], axis[2] * v[0] - axis[0] * v[2], axis[0] * v[1] - axis[1] * v[0]];
  return IDENTITY_ROWS.map(e => {
    const along = axis[0] * e[0] + axis[1] * e[1] + axis[2] * e[2];
    const c = cross(e);
    return [0, 1, 2].map(i => axis[i] * along + cos * (e[i] - axis[i] * along) + sin * c[i] + 0);
  }); // rows are R e_x, R e_y, R e_z
}

export function exactQuarterTurnSteps(axis, turns, origin) {
  const k = ((turns % 4) + 4) % 4;
  if (k === 0) return [];
  const [x, , z] = quarterTurn(axis, k);
  return [...(origin.some(v => v !== 0) ? [translation(negate(origin))] : []),
    { origin: [0,0,0], x, z },
    ...(origin.some(v => v !== 0) ? [translation([...origin])] : [])];
}
const rotationPlacements = new WeakMap();
export function rememberRotationPlacement(transform, axis, angle, origin, line) {
  const turns = angle / (Math.PI / 2);
  // Equality is a discrete constructor match, with no angle tolerance.
  if (!Number.isSafeInteger(turns) || turns * (Math.PI / 2) !== angle ||
      !Number.isFinite(angle)) return transform;
  const coordinateAxis = axis.filter(v => v !== 0).length === 1 && axis.every(v => v === 0 || Math.abs(v) === 1);
  const chart = !coordinateAxis && line && sourceRotationChart(line);
  if (!coordinateAxis && !chart) return transform;
  rotationPlacements.set(transform, { rows: transform.linear.rows.map(r => [...r]),
    translation: coordinates(transform.translation), steps: chart ? [{ ...chart, localTurns: ((turns % 4) + 4) % 4 }] : exactQuarterTurnSteps(axis, turns, origin) });
  return transform;
}
export function exactRotationSteps(transform) {
  const source = rotationPlacements.get(transform);
  return source && unchanged(transform.translation, source.translation) &&
    source.rows.every((r,i) => r.every((v,j) => v === transform.linear?.rows[i]?.[j]))
    ? source.steps : null;
}
