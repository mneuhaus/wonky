// Rigid placements of workspace members (pure; docs/viewer/workspace.md,
// section 3). A placement is 12 numbers, row-major [R | t] in mm, as the
// server's tree sends it (src/viewer/workspace/transform.mjs): world =
// R · local + t. A pane member is { instance, key, modelId, matrix }.
//
// Every member is drawn with its own model-relative positions (float32
// stays small) through memberViewProjection(); lighting, perspective eye and
// clip planes are expressed in the member's local frame, so the shaders stay
// unchanged and an identity placement costs nothing.

export const IDENTITY = Object.freeze([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]);

export const isIdentity = matrix => !matrix
  || matrix.every((value, index) => value === IDENTITY[index]);

export function applyPoint(matrix, point) {
  if (isIdentity(matrix)) return [point[0], point[1], point[2]];
  const m = matrix;
  return [0, 1, 2].map(row => m[4 * row] * point[0] + m[4 * row + 1] * point[1]
    + m[4 * row + 2] * point[2] + m[4 * row + 3]);
}

// R · v (directions and normals).
export function applyDirection(matrix, vector) {
  if (isIdentity(matrix)) return [vector[0], vector[1], vector[2]];
  const m = matrix;
  return [0, 1, 2].map(row => m[4 * row] * vector[0] + m[4 * row + 1] * vector[1]
    + m[4 * row + 2] * vector[2]);
}

// Rᵀ · v: a world direction in the member's local frame.
export function localDirection(matrix, vector) {
  if (isIdentity(matrix)) return [vector[0], vector[1], vector[2]];
  const m = matrix;
  return [0, 1, 2].map(column => m[column] * vector[0] + m[4 + column] * vector[1]
    + m[8 + column] * vector[2]);
}

// Rᵀ · (p - t): a world point in the member's local frame.
export function localPoint(matrix, point) {
  if (isIdentity(matrix)) return [point[0], point[1], point[2]];
  return localDirection(matrix, [point[0] - matrix[3], point[1] - matrix[7],
    point[2] - matrix[11]]);
}

// World box of a local {min, max} box (its eight corners placed).
export function placeBox(matrix, box) {
  if (!box?.min || !box?.max) return null;
  if (isIdentity(matrix)) return { min: [...box.min], max: [...box.max] };
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const x of [box.min[0], box.max[0]]) {
    for (const y of [box.min[1], box.max[1]]) {
      for (const z of [box.min[2], box.max[2]]) {
        const point = applyPoint(matrix, [x, y, z]);
        for (let axis = 0; axis < 3; axis++) {
          min[axis] = Math.min(min[axis], point[axis]);
          max[axis] = Math.max(max[axis], point[axis]);
        }
      }
    }
  }
  return { min, max };
}

// World clip planes [{ origin, normal }] in the member's local frame.
export const localPlanes = (matrix, planes = []) => (isIdentity(matrix) ? planes
  : planes.map(plane => ({
    ...plane, origin: localPoint(matrix, plane.origin), normal: localDirection(matrix,
      plane.normal),
  })));

// Column-major 4x4 `viewProjection` (world, relative to `worldOrigin`) times
// the placement, for positions relative to the member's local `center`:
// world - worldOrigin = R · q + (R · center + t - worldOrigin). The caller
// passes worldOrigin = applyPoint(matrix, center), so the shift is zero and
// float32 precision matches an unplaced model.
export function placedMatrix(viewProjection, matrix) {
  if (isIdentity(matrix)) return viewProjection;
  const out = new Float64Array(16);
  // M4 = [[R, 0], [0, 1]] (column-major).
  const r = (row, column) => matrix[4 * row + column];
  for (let row = 0; row < 4; row++) {
    for (let column = 0; column < 3; column++) {
      out[column * 4 + row] = viewProjection[row] * r(0, column)
        + viewProjection[4 + row] * r(1, column) + viewProjection[8 + row] * r(2, column);
    }
    out[12 + row] = viewProjection[12 + row];
  }
  return out;
}
