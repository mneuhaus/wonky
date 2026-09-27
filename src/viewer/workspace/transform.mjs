// Rigid placements of workspace models and assembly instances
// (docs/viewer/workspace.md, section 1).
//
// A placement is 12 numbers, row-major [R | t] in mm: world = R · p + t.
// The same layout is sent to the browser (tree `matrix`) and read by
// viewer/render/placement.js. Only rigid transforms are accepted: no scale,
// no mirror (R · Rᵀ = I and det R = +1 within 1e-9).

export const IDENTITY = Object.freeze([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]);
export const RIGID_TOLERANCE = 1e-9;

export class WorkspaceError extends Error {
  constructor(path, message) {
    super(`${path}: ${message}`);
    this.name = 'WorkspaceError';
    this.jsonPath = path;
  }
}

const finite = value => typeof value === 'number' && Number.isFinite(value);
const isVector = value => Array.isArray(value) && value.length === 3 && value.every(finite);

// a ∘ b: apply b first, then a.
export function compose(a, b) {
  const out = new Array(12);
  for (let row = 0; row < 3; row++) {
    for (let column = 0; column < 3; column++) {
      out[4 * row + column] = a[4 * row] * b[column] + a[4 * row + 1] * b[4 + column]
        + a[4 * row + 2] * b[8 + column];
    }
    out[4 * row + 3] = a[4 * row] * b[3] + a[4 * row + 1] * b[7] + a[4 * row + 2] * b[11]
      + a[4 * row + 3];
  }
  return out.map(value => value + 0);
}

export const isIdentity = matrix => matrix.every((value, index) => value === IDENTITY[index]);

// Rotation of `deg` degrees about `axis` (right hand), as a placement.
export function rotation(axis, deg) {
  const length = Math.hypot(...axis);
  const [x, y, z] = axis.map(value => value / length);
  const radians = deg * Math.PI / 180;
  // Exact values at quarter turns, so 90° rotations stay integral.
  const quarter = Number.isInteger(deg / 90);
  const snap = value => (quarter ? Math.round(value) : value);
  const c = snap(Math.cos(radians));
  const s = snap(Math.sin(radians));
  const k = 1 - c;
  return [
    c + x * x * k, x * y * k - z * s, x * z * k + y * s, 0,
    y * x * k + z * s, c + y * y * k, y * z * k - x * s, 0,
    z * x * k - y * s, z * y * k + x * s, c + z * z * k, 0,
  ].map(value => value + 0);
}

function checkRigid(matrix, path) {
  const r = row => [matrix[4 * row], matrix[4 * row + 1], matrix[4 * row + 2]];
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      const dot = r(i).reduce((sum, value, axis) => sum + value * r(j)[axis], 0);
      if (Math.abs(dot - (i === j ? 1 : 0)) > RIGID_TOLERANCE) {
        throw new WorkspaceError(path, 'transform is not rigid (R·Rᵀ ≠ I): no scale or shear');
      }
    }
  }
  const [a, b, c] = [r(0), r(1), r(2)];
  const det = a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0])
    + a[2] * (b[0] * c[1] - b[1] * c[0]);
  if (Math.abs(det - 1) > RIGID_TOLERANCE) {
    throw new WorkspaceError(path, 'transform mirrors (det R = -1); mirrored placements are not'
      + ' supported');
  }
}

// { matrix: [12 | 16] } or { rotate: [{ axis, deg }], translate } -> 12
// numbers. Absent -> identity. Anything else is a WorkspaceError at `path`.
export function parseTransform(value, path) {
  if (value === undefined || value === null) return [...IDENTITY];
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new WorkspaceError(path, 'transform must be an object');
  }
  const keys = Object.keys(value);
  const unknown = keys.filter(key => !['matrix', 'rotate', 'translate'].includes(key));
  if (unknown.length) throw new WorkspaceError(`${path}.${unknown[0]}`, 'unknown field');
  let matrix;
  if (value.matrix !== undefined) {
    if (value.rotate !== undefined || value.translate !== undefined) {
      throw new WorkspaceError(path, 'use either matrix or rotate/translate, not both');
    }
    const numbers = value.matrix;
    if (!Array.isArray(numbers) || ![12, 16].includes(numbers.length) || !numbers.every(finite)) {
      throw new WorkspaceError(`${path}.matrix`, 'expects 12 or 16 finite numbers (row-major, mm)');
    }
    if (numbers.length === 16) {
      const last = numbers.slice(12);
      if (last[0] !== 0 || last[1] !== 0 || last[2] !== 0 || last[3] !== 1) {
        throw new WorkspaceError(`${path}.matrix`, 'the last row of a 16-number matrix must be'
          + ' 0 0 0 1');
      }
    }
    matrix = numbers.slice(0, 12);
    checkRigid(matrix, `${path}.matrix`);
  } else {
    matrix = [...IDENTITY];
    const rotations = value.rotate ?? [];
    if (!Array.isArray(rotations)) {
      throw new WorkspaceError(`${path}.rotate`, 'expects a list of { axis, deg }');
    }
    rotations.forEach((item, index) => {
      const at = `${path}.rotate[${index}]`;
      if (!item || typeof item !== 'object' || !isVector(item.axis) || !finite(item.deg)
        || Object.keys(item).some(key => !['axis', 'deg'].includes(key))) {
        throw new WorkspaceError(at, 'expects { axis: [x, y, z], deg }');
      }
      if (!(Math.hypot(...item.axis) > 0)) throw new WorkspaceError(`${at}.axis`, 'is zero');
      matrix = compose(rotation(item.axis, item.deg), matrix);
    });
    if (value.translate !== undefined) {
      if (!isVector(value.translate)) {
        throw new WorkspaceError(`${path}.translate`, 'expects [x, y, z] in mm');
      }
      matrix = compose([1, 0, 0, value.translate[0], 0, 1, 0, value.translate[1],
        0, 0, 1, value.translate[2]], matrix);
    }
  }
  return matrix.map(value => value + 0);
}
