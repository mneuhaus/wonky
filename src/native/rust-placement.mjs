// Keep the construction axes of toWorld beside its rounded FS matrix. Geometry
// uses the exact interpreter frame (x, z, z cross x); ordinary FS arithmetic
// still sees the standard matrix. A copied/composed matrix loses this lineage
// and is not silently promoted to an exact placement.
const placements = new WeakMap();
const worldPoints = new WeakMap();
const queryPlanes = new WeakMap();
const coordinates = vector => vector.items.map(q => typeof q === 'number' ? q : q.value);
const unchanged = (vector, values) => vector?.items?.length === values.length &&
  coordinates(vector).every((x, i) => x === values[i]);
export function rememberPlacement(transform, cs) {
  placements.set(transform, { origin: cs.origin.items.map(q => q.value), x: [...cs.xAxis.items], z: [...cs.zAxis.items],
    rows: transform.linear.rows.map(row => [...row]) });
  return transform;
}
export function exactPlacement(transform) {
  const frame = placements.get(transform);
  if (!frame || !frame.origin.every((x, i) => x === transform.translation?.items[i]?.value) ||
      !frame.rows.every((row, i) => row.every((x, j) => x === transform.linear?.rows[i]?.[j]))) return null;
  return frame;
}

// A toWorld point keeps its pre-rounding source coordinates. Only the actual
// axes of that same frame may give a query plane a local normal: numeric
// similarity to a frame axis is not construction provenance. All other planes
// continue through the exact world-space predicate/refusal path.
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
  else return result;
  queryPlanes.set(result, { frame: source.frame, origin: source.local, normal: localNormal,
    worldOrigin: coordinates(result.origin), worldNormal: coordinates(result.normal) });
  return result;
}
export function exactQueryPlane(plane) {
  const source = queryPlanes.get(plane);
  return source && unchanged(plane.origin, source.worldOrigin) && unchanged(plane.normal, source.worldNormal)
    ? source : null;
}
