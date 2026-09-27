// Pure FeatureScript std value functions that wonky's interpreter library does
// not provide yet, implemented from their documented std semantics
// (tmp/lang/onshape-std, MIT). Used only by the graph tracer: their results
// become graph arguments, so they must be exact binary64 computations; nothing
// here touches geometry. Unknown names still fail as capability errors.
import { fail } from '../../errors.mjs';
import { Matrix, Plane, Quantity, Transform, Vector, binary, display, isMap, map } from '../../values.mjs';

const builtin = (name, min, max, call) => ({ type: 'builtin', name, min, max, call });
const raw = x => (x instanceof Quantity ? x.value : x);
const angle = v => new Quantity(v, 0, 1);
const num = (x, loc) => { if (typeof x !== 'number' || !Number.isFinite(x)) fail('Expected a finite number', loc); return x; };
const vec3 = (v, loc) => { if (!(v instanceof Vector) || v.items.length !== 3) fail('Expected a 3D Vector', loc); return v.items.map(raw); };
const lengthVector = xs => new Vector(xs.map(x => new Quantity(x, 1, 0)));

export function extraValueBuiltins() {
  const values = {};
  const b = (name, min, max, fn) => { values[name] = builtin(name, min, max, fn); };
  b('atan2', 2, 2, ([y, x], loc) => {
    if ((y instanceof Quantity) !== (x instanceof Quantity) || (y instanceof Quantity && (y.dimension !== x.dimension || y.angle !== x.angle))) fail('atan2 expects matching units', loc);
    return angle(Math.atan2(raw(y), raw(x)));
  });
  for (const name of ['asin', 'acos', 'atan']) b(name, 1, 1, ([x], loc) => angle(Math[name](num(x, loc))));
  for (const name of ['exp', 'log', 'log10']) b(name, 1, 1, ([x], loc) => Math[name](num(x, loc)));
  const minmax = pick => ([a, c], loc) => {
    const items = c === undefined ? a : [a, c];
    if (!Array.isArray(items) || !items.length) fail('min/max expects two values or a nonempty array', loc);
    return items.reduce((best, v) => (binary(pick === 'min' ? '<' : '>', v, best, loc) ? v : best));
  };
  b('min', 1, 2, minmax('min')); b('max', 1, 2, minmax('max'));
  b('toString', 1, 1, ([v]) => display(v));
  b('isUndefinedOrEmptyString', 1, 1, ([v]) => v === undefined || v === '');
  b('squaredNorm', 1, 1, ([v], loc) => {
    if (!(v instanceof Vector)) fail('squaredNorm expects a Vector', loc);
    return v.items.map(x => binary('*', x, x, loc)).reduce((s, x) => binary('+', s, x, loc));
  });
  b('tolerantEquals', 2, 2, ([a, c], loc) => Math.abs(raw(binary('-', a, c, loc))) < (a instanceof Quantity && a.dimension === 1 ? 1e-8 : 1e-12));
  b('mirrorAcross', 1, 1, ([plane], loc) => {
    if (!(plane instanceof Plane)) fail('mirrorAcross expects a Plane', loc);
    const n = vec3(plane.normal, loc), o = vec3(plane.origin, loc);
    const L = [0, 1, 2].map(i => [0, 1, 2].map(j => (i === j ? 1 : 0) - 2 * n[i] * n[j]));
    const d = 2 * (n[0] * o[0] + n[1] * o[1] + n[2] * o[2]);
    return new Transform(new Matrix(L), lengthVector(n.map(x => d * x)));
  });
  b('rotationAround', 2, 2, ([axis, theta], loc) => {
    if (!isMap(axis) || !(axis.origin instanceof Vector) || !(axis.direction instanceof Vector)) fail('rotationAround expects a Line', loc);
    if (!(theta instanceof Quantity) || theta.angle !== 1 || theta.dimension !== 0) fail('rotationAround expects an angle', loc);
    const [x, y, z] = vec3(axis.direction, loc), o = vec3(axis.origin, loc), c = Math.cos(theta.value), s = Math.sin(theta.value), t = 1 - c;
    const R = [[t * x * x + c, t * x * y - s * z, t * x * z + s * y], [t * x * y + s * z, t * y * y + c, t * y * z - s * x], [t * x * z - s * y, t * y * z + s * x, t * z * z + c]];
    const Ro = R.map(row => row[0] * o[0] + row[1] * o[1] + row[2] * o[2]);
    return new Transform(new Matrix(R), lengthVector(o.map((v, i) => v - Ro[i])));
  });
  b('coordSystem', 3, 3, ([origin, xAxis, zAxis]) => map({ origin, xAxis, zAxis }));
  b('planeToCSys', 1, 1, ([p], loc) => { if (!(p instanceof Plane)) fail('planeToCSys expects a Plane', loc); return map({ origin: p.origin, xAxis: p.x, zAxis: p.normal }); });
  b('yAxis', 1, 1, ([p], loc) => {
    if (!(p instanceof Plane)) fail('yAxis expects a Plane', loc);
    const n = vec3(p.normal, loc), x = vec3(p.x, loc);
    return new Vector([n[1] * x[2] - n[2] * x[1], n[2] * x[0] - n[0] * x[2], n[0] * x[1] - n[1] * x[0]]);
  });
  b('toWorld', 1, 2, ([cs, point], loc) => {
    if (!isMap(cs) || !(cs.origin instanceof Vector)) fail('toWorld expects a CoordSystem', loc);
    const x = vec3(cs.xAxis, loc), z = vec3(cs.zAxis, loc), y = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]];
    const M = new Matrix([0, 1, 2].map(i => [x[i], y[i], z[i]]));
    if (point === undefined) return new Transform(M, cs.origin);
    return binary('+', binary('*', M, point, loc), cs.origin, loc);
  });
  b('isInteger', 1, 1, ([v]) => Number.isInteger(v));
  b('isArray', 1, 1, ([v]) => Array.isArray(v));
  b('stringToNumber', 1, 1, ([s], loc) => { const v = Number(s); if (typeof s !== 'string' || !Number.isFinite(v)) fail('stringToNumber expects a numeric string', loc); return v; });
  b('rangeArray', 2, 3, ([from, to, step = 1], loc) => { const out = []; for (let v = num(from, loc); v <= num(to, loc) + 1e-12; v += num(step, loc)) out.push(v); return out; });
  b('reverse', 1, 1, ([a], loc) => { if (!Array.isArray(a)) fail('reverse expects an array', loc); return [...a].reverse(); });
  b('concatenateArrays', 1, 1, ([arrays], loc) => { if (!Array.isArray(arrays) || !arrays.every(Array.isArray)) fail('concatenateArrays expects an array of arrays', loc); return arrays.flat(1); });
  b('makeArray', 1, 2, ([n, v], loc) => Array.from({ length: num(n, loc) }, () => v));
  b('subArray', 2, 3, ([a, s, e], loc) => { if (!Array.isArray(a)) fail('subArray expects an array', loc); return a.slice(num(s, loc), e === undefined ? undefined : num(e, loc)); });
  b('scaleUniformly', 1, 2, ([s, p], loc) => new Transform(new Matrix([[num(s, loc), 0, 0], [0, s, 0], [0, 0, s]]), p ? binary('*', 1 - s, p, loc) : lengthVector([0, 0, 0])));
  return values;
}
