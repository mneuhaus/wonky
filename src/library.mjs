import { attachAngleWitness, tangentWitness } from './angle-witness.mjs';
import { fail, raise, unsupported } from './errors.mjs';
import { rememberFrame, rememberPlane } from './construction-frame.mjs';
import { EnumValue, Id, KeyedMap, Matrix, Plane, Quantity, Transform, Vector, binary, cast, checkType, isFunctionValue, isMap, length, map, matchesType, memberless, scalar, stdMapView, tagged, vectorNumbers } from './values.mjs';
import { cross, dot, norm, normalized, scale, signedArea, sub, tolerance, validatePolygon } from './brep.mjs';
import { array, list, extrudeInBend } from './kernel.mjs';
import { loadBend } from './bend-loader.mjs';
import { isStrictRustKernel } from './native/backend.mjs';
import { guardHostBuiltins } from './native/host-ops.mjs';
import { rememberPlacement, rememberRotationPlacement, rememberWorldPoint, rememberQueryPlane } from './native/rust-placement.mjs';
import { vector as realVector, coords as realCoords, real, number } from './real.mjs';
import { scalarBuiltins, verifyBounds } from './scalars.mjs';
import { queryBuiltins, resolveTopology, RegionQuery, REGION_HINTS, regionRefusal } from './queries.mjs';
import { instantiatorBuiltins } from './modules.mjs';
import { circularFrustumInBend, sweepInBend } from './analytic.mjs';
import { booleanInBend, HYBRID_METHOD, PRISM_METHOD } from './boolean.mjs';
import { normalizeModelingPolicy } from './modeling-policy.mjs';
import { solveSketchArcs, extrudeSketchArcs } from './sketch-arcs.mjs';
import { identifySketchArcExtrusion } from './identity.mjs';
import { operationEvidence } from './construction-history.mjs';
import { fsBlend } from './fillet-fs.mjs';
import { loadFilletProduction } from './fillet.mjs';
import { fsOutput } from './fs-output.mjs';
import { noteRefusal, noteProfileFaces } from './diagnostics.mjs';

// D1 / OM1: this is the sole default parameter formula. Source SI
// binary64 points are authoritative; Rust solves on these exact dyadics.
export function fitSplineParameters(points) {
  const cumulative = [0];
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const dx = points[i][0] - points[i - 1][0], dy = points[i][1] - points[i - 1][1];
    total += Math.sqrt(Math.sqrt(dx * dx + dy * dy));
    cumulative.push(total);
  }
  return cumulative.map(t => t / total);
}

class Context { constructor(engine) { this.type = 'Context'; this.engine = engine; } }
class Sketch {
  constructor(id, plane) { this.type = 'Sketch'; this.id = id; this.plane = plane; this.profiles = []; this.lineSegments = []; this.curveEntities = []; this.lineProfileSource = null; this.arcProfileSource = null; this.entityIds = new Set(); this.solved = false; }
}
class Query { constructor(id) { this.type = 'Query'; this.id = id; } }
const builtin = (name, min, max, call) => ({ type: 'builtin', name, min, max, call });
const fieldMap = (value, required, optional, loc) => {
  // A missing or mistyped definition field fails the std operation's
  // precondition, which is a FeatureScript exception.
  if (!isMap(value)) raise('Expected a definition map', loc);
  for (const key of required) if (!Object.hasOwn(value, key)) raise(`Missing required field '${key}'`, loc);
  for (const key of Object.keys(value)) if (![...required, ...optional].includes(key)) unsupported(`Field '${key}' is not supported by this operation`, loc);
  return value;
};

// Host resource limits of one sketch profile (docs/sketch-arcs.md "Admission
// cost", JS target):
// - SKETCH_ENTITY_LIMIT equals kernel/sketch-arcs.bend entity_limit(). A
//   line-only prism builds up to 1280 segments and exhausts the stack in the
//   identity roles by 1536;
// - SKETCH_LINES_SEGMENT_LIMIT is the limit in kernel/sketch-lines.bend solve();
//   longer line-only profiles are admitted by the line/arc solver instead;
// - a profile with arcs extrudes up to the same limit (1024 entities in 6 s
//   CPU; the analytic audit in kernel/ports/curved-validate.bend is linear).
export const SKETCH_ENTITY_LIMIT = 1024;
export const SKETCH_LINES_SEGMENT_LIMIT = 256;

// Preserve mm serialization remainders and the original SI binary64 identity.
// This is serialization only: endpoint equality and connectivity run in Bend.
const lineSketchPoint = (coordinates, sourceMeters) => {
  const original = [...coordinates, 0], value = realVector(original), stored = realCoords(value);
  const bits = new DataView(new ArrayBuffer(16));
  bits.setFloat64(0, sourceMeters[0]); bits.setFloat64(8, sourceMeters[1]);
  const source = { $: 'SourcePoint', x_high: bits.getUint32(0), x_low: bits.getUint32(4), y_high: bits.getUint32(8), y_low: bits.getUint32(12) };
  return { $: 'Point', value, remainder: realVector(original.map((v, i) => v - stored[i])), source };
};

// Bend services that interpretation needs synchronously but that the kernel
// wiring does not load (src/native/kernel-wiring.mjs parses loadJsKernel, so
// adding a module there would make every native build stale). build() awaits
// this once and passes the result as `new ModelingContext(kernel, { services })`.
// The persistent Bend cache makes it cheap after the first compile. The
// classifiers serve qContainsPoint, the production fillet (kernel/fillet)
// opFillet and opChamfer (src/fillet-fs.mjs). Strict rust never loads Bend.
let services;
// The setProperty values a body carries (queries.mjs setProperty) and every
// body derived from it inherits.
const BODY_PROPERTIES = ['name', 'appearance', 'description'];
export function loadModelingServices(kernel) {
  if (isStrictRustKernel(kernel)) return Promise.resolve({ faceClassifier: kernel.faceClassifier });
  services ??= Promise.all([
    loadBend(new URL('../kernel/face-classification.bend', import.meta.url)),
    loadBend(new URL('../kernel/solid-classification.bend', import.meta.url)),
    loadFilletProduction(),
    loadBend(new URL('../kernel/edge-plane.bend', import.meta.url)),
    loadBend(new URL('../kernel/evaluate.bend', import.meta.url)),
  ]).then(([faceClassifier, solidClassifier, fillet, edgePlane, evaluator]) => ({ faceClassifier, solidClassifier, fillet, edgePlane, evaluator }));
  return services;
}

// N-ary opBoolean skips a binary kernel call only when the operands' bounds
// are separated by more than this gap (1 µm, far above every Bend and Onshape
// tolerance). Bounds are either the vertices of an all-plane, straight-edged
// body, which contain it, or bounds Bend computed for the body. Closer or
// unbounded pairs always go to the kernel, which decides.
const NARY_SEPARATION_MM = 1e-3;
function knownBounds(body) {
  const polyhedral = body.faces.every(face => face.surface.type === 'plane') && body.edges.every(edge => (edge.curve.type ?? edge.curve) === 'line');
  if (polyhedral && body.vertices.length) return { min: [0, 1, 2].map(k => Math.min(...body.vertices.map(p => p[k]))), max: [0, 1, 2].map(k => Math.max(...body.vertices.map(p => p[k]))) };
  const bounds = body.validation?.boundsMm;
  return bounds && [...bounds.min, ...bounds.max].every(Number.isFinite) ? bounds : null;
}
// std boolean.fs reportBooleanNoOpWarning: an intersection that leaves nothing
// is reported as the feature info BOOLEAN_INTERSECT_NO_OP, not as an error.
// Whether Onshape then keeps the tool bodies (like BOOLEAN_UNION_NO_OP for
// disjoint unions) or deletes them is not verified, so wonky refuses instead
// of guessing either model.
function refuseEmptyIntersection(loc) {
  unsupported('opBoolean INTERSECTION with an empty result (Onshape reports BOOLEAN_INTERSECT_NO_OP; whether the tool bodies remain is not verified)', loc);
}
// The same function reports a subtraction that removes nothing from any target
// as BOOLEAN_SUBTRACT_NO_OP. Whether Onshape then consumes the tools and gives
// the target the feature's identity is not verified either, so the binary and
// the N-ary path both refuse before anything is committed.
function refuseNoOpSubtraction(loc) {
  unsupported('opBoolean SUBTRACTION that removes nothing from any target (Onshape reports BOOLEAN_SUBTRACT_NO_OP; whether the tools remain and the target takes the feature identity is not verified)', loc);
}
// Whether one binary SUBTRACTION step removed material from `target`. The
// kernel returns a new body even when it removed nothing, so this reads the
// kernel's own account of the result, never a volume threshold: a real cut can
// remove less than any relative threshold (a 0.125 mm3 notch in a 1e9 mm3
// block). The result R lies inside the one-lump target T, so R = T exactly when
// every face of R lies on the boundary of T; a face inside T bounds removed
// material. Each subtraction path of booleanInBend states that fact:
//   planar arrangement: every result face lists the original faces it lies on
//     (faceOrigins contributors, operand 0 = target, 1 = tool); a face that
//     lies on no target face is a piece of the tool's boundary inside T;
//   coaxial cylinders: the target is a cylinder primitive, which is convex, so
//     a result face on one of its surfaces lies on its boundary, and a face on
//     no target surface (within the path's own axis tolerance) is a cut;
//   through-hole pierce: admitted only when the bore goes through, so it
//     always removes material;
//   hybrid corefine+recover: every result face lists the operand faces its
//     triangles came from (leaf 0 = target, 1 = tool; hybridRemovedMaterial);
//   prism region Boolean: the tool spans the target's slab, so R differs from
//     T exactly when a side face extrudes a piece of the tool's profile (a
//     shared piece is kept from the target; toolBoundaryKept, decided in Bend
//     on exact incidences, src/prism-boolean.mjs).
// Any other result cannot be decided and is refused.
const PLANAR_SUBTRACTION = 'native Bend planar arrangement subtraction';
const PIERCE_SUBTRACTION = 'native Bend through-hole pierce';
const COAXIAL_ARRANGEMENT = 'coaxial radial/axial arrangement in Bend';
function removedMaterial(target, pieces, loc) {
  if (pieces.length !== 1) return true;
  const [piece] = pieces;
  if (piece === target) return false;
  const construction = piece.construction ?? {};
  let removed;
  if (construction.method === PIERCE_SUBTRACTION) return true;
  if (construction.method === PLANAR_SUBTRACTION && Array.isArray(construction.faceOrigins)) {
    removed = construction.faceOrigins.some(origin => !array(origin.contributors).some(ref => ref.operand === 0));
  } else if (construction.method === COAXIAL_ARRANGEMENT && target.primitive?.type === 'frustum' && Number.isFinite(construction.axisToleranceMm)) {
    const axisTolerance = construction.axisToleranceMm;
    removed = piece.faces.some(face => !target.faces.some(own => sameSurface(face.surface, own.surface, axisTolerance)));
  } else if (construction.method === PRISM_METHOD && typeof construction.toolBoundaryKept === 'boolean') {
    removed = construction.toolBoundaryKept;
  } else if (construction.method === HYBRID_METHOD && piece.provenance?.faces?.length === piece.faces.length) {
    removed = hybridRemovedMaterial(piece, loc);
  } else {
    unsupported(`opBoolean SUBTRACTION cannot tell whether this result (${construction.method ?? 'unknown method'}) removed material from the target`, loc);
  }
  // Consistency guard: an unchanged target keeps its volume. A hybrid result
  // states its integrated volume when it is not closed-form (quadrature, with
  // its bound), and so may a recovered target.
  const volumeOf = body => body.validation?.volumeMm3 ?? body.validation?.integratedVolume?.volumeMm3;
  const before = volumeOf(target), after = volumeOf(piece);
  const known = Number.isFinite(before) && Number.isFinite(after);
  // A hybrid result whose faces all come from the target lies on its
  // boundary; that account stands without volumes when none is stated.
  if (!removed && (known ? !(Math.abs(after - before) <= 1e-9 * Math.abs(before)) : construction.method !== HYBRID_METHOD)) {
    unsupported(`opBoolean SUBTRACTION result lies on the target's boundary but its volume changed (${before} -> ${after} mm3)`, loc);
  }
  return removed;
}
// A hybrid SUBTRACTION result removed material iff one of its faces comes from
// the tool (leaf 1): recover tags every result face with the operand faces its
// triangles came from (provenance.faces[i].sources), or, when the result mesh
// could not be assigned to faces, with its carrier class only. A tool face on
// the carrier of a target face (a coincident contact) is not evidence either
// way, because the coincident triangles may carry either tag; if every
// tool-derived face is such a face, the result is refused by name.
function hybridRemovedMaterial(piece, loc) {
  let ambiguous = 0;
  for (const face of piece.provenance.faces) {
    const leaves = rows => new Set((rows ?? []).map(row => row.leaf));
    const own = face.sources ? leaves(face.sources) : null, carrier = face.carrierClass ? leaves(face.carrierClass) : null;
    const fromTool = own ? own.has(1) : carrier ? (carrier.size === 1 && carrier.has(1)) : null;
    if (fromTool === null) { ambiguous++; continue; }
    if (!fromTool) continue;
    if (carrier && !carrier.has(0)) return true;
    ambiguous++;
  }
  if (ambiguous) unsupported(`opBoolean SUBTRACTION cannot tell whether this hybrid result removed material: ${ambiguous} of its faces come from the tool only on a carrier shared with the target, or have no face provenance`, loc);
  return false;
}
// Two plane or cylinder surfaces are the same up to a length tolerance (mm).
function sameSurface(a, b, tolerance) {
  const offset = (p, q) => [0, 1, 2].map(k => p[k] - q[k]);
  const parallel = (u, v) => norm(cross(u, v)) <= 1e-12;
  if (a.type === 'plane' && b.type === 'plane') {
    return parallel(a.normal, b.normal) && Math.abs(dot(b.normal, offset(a.origin, b.origin))) <= tolerance;
  }
  if (a.type === 'cylinder' && b.type === 'cylinder') {
    return parallel(a.axis, b.axis) && Math.abs(a.radius - b.radius) <= tolerance
      && norm(cross(b.axis, offset(a.origin, b.origin))) <= tolerance;
  }
  return false;
}
function separated(a, b) {
  const first = knownBounds(a), second = knownBounds(b);
  return !!first && !!second && [0, 1, 2].some(k => first.min[k] - second.max[k] > NARY_SEPARATION_MM || second.min[k] - first.max[k] > NARY_SEPARATION_MM);
}

// Pure Onshape std value functions. Each follows the cited std source
// (javawizard/onshape-std-library-mirror, tmp/lang/onshape-std); none touches
// the kernel. Precondition failures are FeatureScript errors, as in std.
// unitless and isInteger live with the bound specs in scalars.mjs.
const ZERO_ANGLE = 1e-11; // std math.fs TOLERANCE.zeroAngle
const angle = radians => new Quantity(radians, 0, 1);
const isAngle = value => value instanceof Quantity && value.dimension === 0 && value.angle === 1;
const identity3 = () => [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
// vector.fs:339 perpendicularVector(vec): a unit vector perpendicular to vec,
// picked by fixed ratio thresholds so the choice is stable near the axes; a
// (near) zero vector gives (1, 0, 0). ValueWithUnits components drop their units.
function perpendicularVector(vec) {
  if (vec.reduce((sum, v) => sum + v * v, 0) < 1e-8 * 1e-8) return [1, 0, 0]; // TOLERANCE.zeroLength
  const different = [0, 0, 0], [x, y, z] = vec.map(Math.abs);
  if (x > 1.036663652861932668633 * y) different[x > .951702989392233451722 * z ? 2 : 1] = 1;
  else different[y > .920419947455385938102 * z ? 0 : 1] = 1;
  const c = cross(different, vec), n = norm(c);
  return scale(c, 1 / n);
}
// The std overloads take `cSys is CoordSystem` and `line is Line`: tagged maps.
function coordSystemAxes(cs, loc) {
  if (!matchesType(cs, 'CoordSystem') || !(cs.origin instanceof Vector) || !(cs.xAxis instanceof Vector) || !(cs.zAxis instanceof Vector)) raise('Expected a CoordSystem', loc);
  vectorNumbers(cs.origin, 1, 3, loc);
  const x = vectorNumbers(cs.xAxis, 0, 3, loc), z = vectorNumbers(cs.zAxis, 0, 3, loc);
  return { x, y: cross(z, x), z };
}
function lineAxis(line, loc, name) {
  if (!matchesType(line, 'Line') || !(line.origin instanceof Vector) || !(line.direction instanceof Vector)) raise(`${name} expects a Line`, loc);
  vectorNumbers(line.origin, 1, 3, loc);
  return normalized(vectorNumbers(line.direction, 0, 3, loc), loc);
}
function stdToString(value, loc) {
  if (typeof value === 'string') return value;
  // units.fs toString(ValueWithUnits): SI value, then each base unit and its power.
  if (value instanceof Quantity) {
    const unit = (name, power) => power === 0 ? '' : ` ${name}${power === 1 ? '' : `^${power}`}`;
    return binary('~', value.value, '', loc) + unit('meter', value.dimension) + unit('radian', value.angle);
  }
  // vector.fs toString(Vector) before string.fs toString(array): a Vector is a tagged array.
  if (value instanceof Vector) return `(${value.items.map(item => stdToString(item, loc)).join(', ')})`;
  // An Id is a tagged array of strings, so string.fs toString(array) applies.
  const items = Array.isArray(value) ? value : value instanceof Id ? value.parts : null;
  if (items) return `[${items.map(item => ` ${stdToString(item, loc)} `).join(',')}]`;
  // string.fs: maps use their deterministic key order and recursively call
  // toString, not JSON.stringify (which exposes the host's Quantity/Vector).
  const fields = isMap(value) && !isFunctionValue(value) ? value : stdMapView(value);
  if (fields || value instanceof KeyedMap) {
    const entries = fields ? Object.entries(fields) : [...value.entries];
    const strings = entries.every(([key]) => typeof key === 'string'), numbers = entries.every(([key]) => typeof key === 'number');
    if (!strings && !numbers) unsupported('toString of maps with mixed or composite keys is not implemented (FeatureScript key order)', loc);
    entries.sort(([a], [b]) => {
      if (numbers) return a - b;
      const x = Array.from(a, c => c.codePointAt(0)), y = Array.from(b, c => c.codePointAt(0));
      for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) return x[i] - y[i];
      return x.length - y.length;
    });
    return `{${entries.map(([key, item]) => ` ${stdToString(key, loc)} : ${stdToString(item, loc)} `).join(',')}}`;
  }
  if (value instanceof Matrix) unsupported('toString of matrices is not implemented', loc);
  return binary('~', '', value, loc); // string.fs toString(value): "" ~ value
}
function stdValueBuiltins() {
  const values = {
    // context.fs: makeId(idComp) returns [idComp] as Id; newId() returns [] as Id.
    makeId: builtin('makeId', 1, 1, ([idComp], loc) => {
      if (typeof idComp !== 'string') raise('makeId expects a string', loc);
      return cast([idComp], 'Id', loc);
    }),
    newId: builtin('newId', 0, 0, () => new Id([])),
    // units.fs atan2(number, number) and atan2(ValueWithUnits, ValueWithUnits) with y.units == x.units.
    atan2: builtin('atan2', 2, 2, ([y, x], loc) => {
      const units = v => v instanceof Quantity ? `${v.dimension}:${v.angle}` : typeof v === 'number' ? 'number' : null;
      if (!units(y) || units(y) !== units(x)) raise('atan2 expects two numbers or two values with the same units', loc);
      return angle(Math.atan2(y instanceof Quantity ? y.value : y, x instanceof Quantity ? x.value : x));
    }),
    // coordSystem.fs coordSystem(origin, xAxis, zAxis) with precondition
    // perpendicularVectors(xAxis, zAxis); surfaceGeometry.fs coordSystem(plane)
    // = coordSystem(plane.origin, plane.x, plane.normal).
    coordSystem: builtin('coordSystem', 1, 3, (args, loc) => {
      if (args.length === 2 || (args.length === 1 && !(args[0] instanceof Plane))) unsupported('coordSystem is implemented for a Plane or for origin, xAxis and zAxis only', loc);
      const [origin, xAxis, zAxis] = args.length === 1 ? [args[0].origin, args[0].x, args[0].normal] : args;
      vectorNumbers(origin, 1, 3, loc);
      const x = vectorNumbers(xAxis, 0, 3, loc), z = vectorNumbers(zAxis, 0, 3, loc), d = dot(x, z);
      if (!(d * d < dot(x, x) * dot(z, z) * ZERO_ANGLE * ZERO_ANGLE)) raise('coordSystem requires xAxis perpendicular to zAxis', loc);
      return rememberFrame(tagged(map({ origin, xAxis: new Vector(normalized(x, loc)), zAxis: new Vector(normalized(z, loc)) }), 'CoordSystem'));
    }),
    // coordSystem.fs toWorld(cSys) = transform(transpose(matrix([x, z×x, z])), origin);
    // toWorld(cSys, point) = toWorld(cSys) * point.
    toWorld: builtin('toWorld', 1, 2, ([cs, point], loc) => {
      const { x, y, z } = coordSystemAxes(cs, loc);
      const world = new Transform(new Matrix([0, 1, 2].map(i => [x[i], y[i], z[i]])), cs.origin);
      rememberPlacement(world, cs);
      if (point === undefined) return world;
      vectorNumbers(point, 1, 3, loc);
      return rememberWorldPoint(binary('*', world, point, loc), point, world, cs);
    }),
    // coordSystem.fs fromWorld(cSys) = transform(R, R * -origin), R = matrix([x, z×x, z]);
    // fromWorld(cSys, point) = R * (point - origin).
    fromWorld: builtin('fromWorld', 1, 2, ([cs, point], loc) => {
      const { x, y, z } = coordSystemAxes(cs, loc), rotation = new Matrix([x, y, z]);
      if (point === undefined) return new Transform(rotation, binary('*', rotation, binary('*', -1, cs.origin, loc), loc));
      vectorNumbers(point, 1, 3, loc);
      return binary('*', rotation, binary('-', point, cs.origin, loc), loc);
    }),
    // curveGeometry.fs rotationAround(line, angle) = transform(R, origin - R * origin),
    // R = rotationMatrix3d(direction, angle): counterclockwise looking against the direction.
    rotationAround: builtin('rotationAround', 2, 2, ([line, theta], loc) => {
      const [x, y, z] = lineAxis(line, loc, 'rotationAround');
      if (!isAngle(theta)) raise('rotationAround expects an angle', loc);
      const c = Math.cos(theta.value), s = Math.sin(theta.value), t = 1 - c;
      const rotation = new Matrix([[t * x * x + c, t * x * y - s * z, t * x * z + s * y],
        [t * x * y + s * z, t * y * y + c, t * y * z - s * x], [t * x * z - s * y, t * y * z + s * x, t * z * z + c]]);
      return rememberRotationPlacement(new Transform(rotation, binary('-', line.origin, binary('*', rotation, line.origin, loc), loc)),
        [x,y,z], theta.value, line.origin.items.map(q => q.value), line);
    }),
    // surfaceGeometry.fs mirrorAcross(plane) = transform(I - 2nᵀn, origin - linear * origin).
    // A value only: opPattern refuses the reflection until Bend reverses orientation.
    mirrorAcross: builtin('mirrorAcross', 1, 1, ([plane], loc) => {
      if (!(plane instanceof Plane)) raise('mirrorAcross expects a Plane', loc);
      const n = normalized(vectorNumbers(plane.normal, 0, 3, loc), loc);
      const linear = new Matrix(identity3().map((row, i) => row.map((v, j) => v - 2 * n[i] * n[j])));
      return new Transform(linear, binary('-', plane.origin, binary('*', linear, plane.origin, loc), loc));
    }),
    // vector.fs:339 perpendicularVector(vec is Vector): the units of a ValueWithUnits
    // vector are dropped (vec[i].value); the result is dimensionless.
    perpendicularVector: builtin('perpendicularVector', 1, 1, ([vec], loc) => {
      if (!(vec instanceof Vector) || vec.items.length !== 3) raise('perpendicularVector expects a 3D Vector', loc);
      const items = vec.items.map(item => item instanceof Quantity ? item.value : item);
      if (!items.every(item => typeof item === 'number' && Number.isFinite(item))) raise('perpendicularVector expects a 3D Vector', loc);
      return new Vector(perpendicularVector(items));
    }),
    // containers.fs concatenateArrays(arr) and concatenateArrays(a, b) = @concatenateArrays([a, b]).
    // An Id (context.fs canBeId) and a Vector are arrays too.
    concatenateArrays: builtin('concatenateArrays', 1, 2, (args, loc) => {
      const items = value => Array.isArray(value) ? value : value instanceof Vector ? value.items : value instanceof Id ? value.parts : null;
      const parts = args.length === 2 ? args : items(args[0]) ?? memberless(args[0], 'concatenateArrays', loc);
      return parts.flatMap(part => items(part) ?? memberless(part, 'concatenateArrays', loc));
    }),
    toString: builtin('toString', 1, 1, ([value], loc) => stdToString(value, loc)),
  };
  // units.fs asin/acos/atan(number) return an angle; out-of-domain input throws.
  for (const name of ['asin', 'acos', 'atan']) values[name] = builtin(name, 1, 1, ([value], loc) => {
    if (typeof value !== 'number') raise(`${name} expects a number`, loc);
    const result = Math[name](value);
    if (!Number.isFinite(result)) raise(`${name} is undefined for ${value}`, loc);
    return name === 'atan' && Number.isFinite(value) && !Object.is(value, -0) ? attachAngleWitness(angle(result), tangentWitness(value)) : angle(result);
  });
  // math.fs min(value1, value2) = value1 < value2 ? value1 : value2, max the
  // mirror; min(arr)/max(arr) fold with operator < and return undefined when empty.
  const less = (a, b, loc) => binary('<', a, b, loc);
  for (const [name, pick, replaces] of [
    ['min', (a, b, loc) => less(a, b, loc) ? a : b, (item, best, loc) => less(item, best, loc)],
    ['max', (a, b, loc) => less(a, b, loc) ? b : a, (item, best, loc) => less(best, item, loc)]]) {
    values[name] = builtin(name, 1, 2, (args, loc) => {
      if (args.length === 2) return pick(args[0], args[1], loc);
      const items = Array.isArray(args[0]) ? args[0] : args[0] instanceof Vector ? args[0].items : raise(`${name} expects two values or an array`, loc);
      let best;
      for (const item of items) if (best === undefined || replaces(item, best, loc)) best = item;
      return best;
    });
  }
  return values;
}

// ---- opRevolve (std geomOperations.fs:1447, docs/revolve.md) ---------------
// @opRevolve normalizes angleForward and angleBack to [0, 2π) and revolves a
// full turn when they are equal. adjustAngle (feature.fs:855) keeps 360° as
// 2π, which normalizes to 0, the default angleBack: `angleForward: 360 *
// degree` is a full turn. std primitives.fs passes a plain number (2 * PI),
// which is radians.
const TURN = 2 * Math.PI;
function revolveAngle(value, name, loc) {
  const radians = isAngle(value) ? value.value : typeof value === 'number' ? value : raise(`opRevolve ${name} must be an angle`, loc);
  if (!Number.isFinite(radians)) raise(`opRevolve ${name} must be finite`, loc);
  const normal = ((radians % TURN) + TURN) % TURN;
  return normal < ZERO_ANGLE || TURN - normal < ZERO_ANGLE ? 0 : normal;
}
// The axis must lie in the sketch plane: its direction within this angle of
// the plane (radians; far below any drawn angle, far above rounding of unit
// vectors built from cos/sin) and its origin within the linear tolerance.
const REVOLVE_AXIS_IN_PLANE = 1e-9;

// The closed profile of a solved sketch in sketch coordinates (mm), in solved
// order: { p: [u, v], arc: null | { center: [u, v], ccw } } with ccw
// counterclockwise in (u, v), or a single { circle }. Lines keep their
// binary64 endpoints. An arc's centre and sense are the Bend fit's
// (kernel/sketch-arcs.bend fit_circle/fit_original: `sense` is counterclockwise
// from the entity's start to its end), and the use direction flips the sense.
function sketchLoop(sketch, loc) {
  const profile = sketch.profiles[0];
  if (Array.isArray(profile)) return profile.map(p => ({ p, arc: null }));
  if (profile.type === 'circle') return [{ circle: profile }];
  if (profile.type !== 'line-arc') unsupported('opRevolve of this sketch profile is not implemented', loc);
  const entities = sketch.arcProfileSource.entities;
  return array(profile.native.uses).map(({ fit, forward }) => {
    const entity = entities[fit.source.index];
    if (entity?.index !== fit.source.index) throw new Error('Line/arc profile use does not match its source entity');
    const p = forward ? entity.start : entity.end;
    if (entity.type !== 'arc') return { p, arc: null };
    if (fit.curve.$ !== 'Circle') throw new Error('Expected a circle fit for a sketch arc');
    return { p, arc: { center: realCoords(fit.curve.origin).slice(0, 2), ccw: fit.sense === forward } };
  });
}

// Coordinates of profile points that lie within `tol` of each other are meant
// to be equal (a line drawn parallel or perpendicular to the axis, or ending on
// it); kernel/revolve.bend refuses near-equal values (code 9), so they are
// delivered equal. A chain of values spanning more than `tol` is ambiguous.
function snapValues(values, tol, anchor, loc) {
  const sorted = [...new Set(values)].sort((a, b) => a - b), snapped = new Map();
  for (let i = 0; i < sorted.length;) {
    let j = i + 1;
    while (j < sorted.length && sorted[j] - sorted[j - 1] <= tol) j += 1;
    const group = sorted.slice(i, j);
    if (group.at(-1) - group[0] > tol) unsupported(`opRevolve profile coordinates ${group[0]}..${group.at(-1)} mm form a chain of near-equal values longer than the linear tolerance (${tol} mm); which of them are meant equal is ambiguous`, loc);
    const count = value => values.filter(v => v === value).length;
    const pick = anchor !== undefined && group.some(v => Math.abs(v - anchor) <= tol) ? anchor
      : group.reduce((best, v) => count(v) > count(best) || (count(v) === count(best) && Math.abs(v) < Math.abs(best)) ? v : best);
    for (const v of group) snapped.set(v, pick);
    i = j;
  }
  return value => snapped.get(value);
}

// Reverses a revolve profile chain: node i carries the segment to node i+1,
// so in reverse the point of node j carries the segment of node j-1, flipped.
function reverseRevolveProfile(nodes) {
  const k = nodes.length, at = node => Array.isArray(node) ? node : node.at, arc = node => Array.isArray(node) ? null : node.arc;
  return Array.from({ length: k }, (_, i) => {
    const j = (k - i) % k, previous = arc(nodes[(j - 1 + k) % k]);
    return previous ? { at: at(nodes[j]), arc: { center: previous.center, ccw: !previous.ccw } } : at(nodes[j]);
  });
}

// The repository convention (src/print-mesh.mjs fullTurn, the curved audit's
// kernel/face-classification.bend auto_domain) reads a circle edge without a
// curveRange as a full turn, and requires an explicit domain for a circular
// arc between two vertices. kernel/revolve.bend `sweep` returns such arcs
// (partial-sweep parallels, meridians of spheres and tori, profile arcs on
// the side planes) without domains, so they are stated here: the Bend
// parameters (kernel/analytic.bend curve_parameter) of the edge's end
// vertices, ordered along the edge sense, the end lifted by one turn when it
// does not lie after the start.
function revolveEdgeDomains(kernel, body) {
  for (const edge of body.edges) {
    const c = edge.curve;
    if (c.type !== 'circle' || edge.start === edge.end || edge.curveRange) continue;
    const circle = { $: 'Circle', origin: realVector(c.origin), normal: realVector(c.normal), x: realVector(c.x), radius: real(c.radius) };
    const [a, b] = [edge.start, edge.end].map(index => number(kernel.analytic.curve_parameter(circle, realVector(body.vertices[index]))));
    const [first, end] = edge.sameSense ? [a, b] : [b, a];
    edge.curveRange = [first, end > first ? end : end + TURN];
  }
  return body;
}

// opRevolve of a solved sketch region about a line in its plane
// (kernel/revolve.bend `sweep`). The profile goes into the (r, h) half plane
// of the axis: h along the axis direction, r along the in-plane direction x
// toward the profile. The sweep turns right-handed about the axis direction
// from the profile's own half plane; `angle` null is a full turn.
function revolveSketch(kernel, id, sketch, plane, origin, axis, angle, loc) {
  const n = normalized(plane.normal, loc), u = normalized(plane.x, loc), v = cross(n, u);
  const loop = sketchLoop(sketch, loc), circle = loop[0].circle;
  const planar = loop.flatMap(node => node.circle ? [node.circle.center, [node.circle.radius]] : node.arc ? [node.p, node.arc.center] : [node.p]);
  const tol = tolerance([...planar, plane.origin, origin]);
  if (Math.abs(dot(axis, n)) > REVOLVE_AXIS_IN_PLANE) unsupported('opRevolve axis does not lie in the sketch plane: it is not perpendicular to the sketch normal (a skew axis sweeps non-analytic faces)', loc);
  const offset = sub(origin, plane.origin);
  if (Math.abs(dot(offset, n)) > tol) unsupported(`opRevolve axis does not lie in the sketch plane: its origin is ${Math.abs(dot(offset, n))} mm off the plane (linear tolerance ${tol} mm)`, loc);
  const o2 = [dot(offset, u), dot(offset, v)], d2 = normalized([dot(axis, u), dot(axis, v)], loc);
  const toHR = ([pu, pv]) => { const w = [pu - o2[0], pv - o2[1]]; return [w[0] * d2[0] + w[1] * d2[1], d2[0] * w[1] - d2[1] * w[0]]; };
  const raw = circle ? [{ at: toHR(circle.center), arc: { center: toHR(circle.center), ccw: true } }]
    : loop.map(node => ({ at: toHR(node.p), arc: node.arc && { center: toHR(node.arc.center), ccw: node.arc.ccw } }));
  const sides = raw.map(node => node.at[1]);
  const positive = sides.some(r => r > tol), negative = sides.some(r => r < -tol);
  // std geomOperations.fs: the entities 'may abut, but not strictly intersect the axis';
  // Onshape fails such an operation, so this is a FeatureScript exception.
  if (positive && negative) raise('opRevolve profile crosses the axis: it has points on both sides of it (the region may abut the axis but not strictly intersect it)', loc);
  // A profile on the negative side turns the radial direction around; that
  // reflection of (r, h) flips every arc's sense once more.
  const sign = negative ? -1 : 1, x = scale(normalized(cross(n, axis), loc), sign);
  const zero = r => Math.abs(r) <= tol ? 0 : r;
  const flat = raw.map(({ at: [h, r], arc }) => ({ at: [zero(sign * r), h], arc: arc && { center: [zero(sign * arc.center[1]), arc.center[0]], ccw: negative ? arc.ccw : !arc.ccw } }));
  let nodes;
  if (circle) {
    const [{ arc: { center: [rc, hc] } }] = flat;
    nodes = [{ at: [rc + circle.radius, hc], arc: { center: [rc, hc], ccw: true } }];
  } else {
    const snapR = snapValues(flat.map(node => node.at[0]), tol, 0, loc), snapH = snapValues(flat.map(node => node.at[1]), tol, undefined, loc);
    nodes = flat.map(({ at: [r, h], arc }) => arc ? { at: [snapR(r), snapH(h)], arc } : [snapR(r), snapH(h)]);
  }
  const sweep = profile => sweepInBend(kernel, id, profile, origin, axis, x, tol, angle);
  try {
    let body, reversed = false;
    // Bend decides the winding: a clockwise chain is refused (code 4) and is
    // then revolved reversed.
    try { body = sweep(nodes); }
    catch (error) { if (!/not counterclockwise/.test(error.message)) throw error; body = sweep(reverseRevolveProfile(nodes)); reversed = true; }
    // revolve.bend piece_faces emits one face per non-axis profile piece,
    // in traversal order, followed by two caps for a partial turn.
    const useIds = sketch.arcProfileSource ? array(sketch.arcProfileSource.native.uses).map(use => sketch.arcProfileSource.entities[use.fit.source.index].id)
      : sketch.lineProfileSource ? sketch.lineProfileSource.profileUses.map(use => use.entityId)
        : nodes.map(() => [...sketch.entityIds][0]);
    const profile = body.primitive.profile, at = node => Array.isArray(node) ? node : node.at;
    const faceIds = profile.flatMap((node, i) => {
      const onAxis = !node.arc && at(node)[0] === 0 && at(profile[(i + 1) % profile.length])[0] === 0;
      const entity = useIds[reversed ? (nodes.length - 1 - i + nodes.length) % nodes.length : i];
      return onAxis ? [] : [entity ? [entity] : []];
    });
    noteProfileFaces(body, angle === null ? faceIds : [...faceIds, [], []]);
    revolveEdgeDomains(kernel, body);
    body.revolveSource = { sketchId: sketch.id.toString(), toleranceMm: tol, axis: { origin, direction: axis }, x, angle };
    return body;
  } catch (error) {
    if (!error.line && loc) { error.line = loc.line; error.column = loc.column; }
    throw error;
  }
}

export class ModelingContext {
  constructor(kernel, options = {}) {
    this.kernel = kernel; this.context = new Context(this); this.sketches = new Map(); this.ids = new Set(); this.records = new Map(); this.nextRecord = 0;
    this.modelingPolicy = normalizeModelingPolicy(options.modelingPolicy);
    this.operationEvidence = [];
    this.output = options.output ?? fsOutput(null, null);
    this.readOnly = false;
    // Record key -> operation id of every body a Boolean consumed (a merged
    // union tool, a subtraction or intersection tool). Which body inherits
    // such an identity is not documented, so makeRobustQuery refuses them.
    this.consumedBy = new Map();
    // Optional Bend services from loadModelingServices(); qContainsPoint
    // refuses explicitly when the build did not load them.
    this.services = options.services ?? null;
  }
  get bodies() { return [...this.records.values()].filter(row => row.kind === 'solid').map(row => row.body); }
  // The modeling state a failed sub-feature rolls back (std feature.fs
  // @abortFeature; Interpreter.invoke). Records are copied by property
  // descriptor, so the lazy body getter of an imported record is not evaluated;
  // setProperty's name, appearance and description on a body are saved with it. Record keys
  // keep counting up, so a rolled-back key is never reused.
  snapshot() {
    const records = [...this.records.values()].map(record => {
      const descriptors = Object.getOwnPropertyDescriptors(record), body = descriptors.body?.value;
      return { record, descriptors, body: body && { body, ...Object.fromEntries(BODY_PROPERTIES.map(key => [key, Object.getOwnPropertyDescriptor(body, key)])) } };
    });
    const sketches = [...this.sketches.values()].map(sketch => ({ sketch, fields: {
      ...sketch, profiles: [...sketch.profiles], lineSegments: [...sketch.lineSegments], curveEntities: [...sketch.curveEntities], entityIds: new Set(sketch.entityIds),
      // Rust sketch coordinates and solved regions are plain, mutable data.
      // Keep the Sketch object itself: FeatureScript variables still refer to it.
      ...(sketch.rust && { rust: structuredClone(sketch.rust) }),
    } }));
    return { records, sketches, ids: new Set(this.ids), consumedBy: new Map(this.consumedBy), evidence: this.operationEvidence.length };
  }
  restore({ records, sketches, ids, consumedBy, evidence }) {
    this.records = new Map(records.map(({ record, descriptors, body }) => {
      for (const key of Object.keys(record)) if (!Object.hasOwn(descriptors, key)) delete record[key];
      Object.defineProperties(record, descriptors);
      if (body) for (const key of BODY_PROPERTIES) {
        if (body[key]) Object.defineProperty(body.body, key, body[key]); else delete body.body[key];
      }
      return [record.key, record];
    }));
    this.sketches = new Map(sketches.map(({ sketch, fields }) => {
      for (const key of Object.keys(sketch)) if (!Object.hasOwn(fields, key)) delete sketch[key];
      return [sketch.id.key(), Object.assign(sketch, fields)];
    }));
    this.ids = ids; this.consumedBy = consumedBy;
    this.operationEvidence.length = evidence;
  }
  addSolid(id, body) {
    const key = String(this.nextRecord++), createdBy = new Set([id.key()]);
    this.records.set(key, { key, kind: 'solid', body, createdBy,
      // Native topology history also includes modifying features. A surviving
      // BODY, unlike newly split/created topology, keeps its original creators.
      ...(isStrictRustKernel(this.kernel) && { bodyCreatedBy: new Set(createdBy) }),
    });
  }
  claim(context, id, loc) {
    if (context !== this.context) raise('Invalid modeling context', loc);
    if (this.readOnly) fail('An imported source context is read-only', loc);
    checkType(id, 'Id', loc);
    if (this.ids.has(id.key())) fail(`Duplicate operation ID '${id}'`, loc);
    if (this.ids.size >= 20000) fail('Execution limit: 20,000 modeling operations per feature', loc);
    this.ids.add(id.key());
  }
  sketch(value, loc, mutable = false) {
    if (!(value instanceof Sketch) || this.sketches.get(value.id.key()) !== value) raise('Expected a sketch from this context', loc);
    if (mutable && value.solved) fail('Sketch has already been solved', loc);
    return value;
  }
  addProfile(sketch, id, points, loc) {
    this.sketch(sketch, loc, true);
    if (sketch.curveEntities.length) unsupported('A line/arc sketch cannot mix entities with rectangle, polyline or circle profiles', loc);
    if (typeof id !== 'string' || !id) fail('Sketch entity ID must be a nonempty string', loc);
    if (sketch.entityIds.has(id)) fail(`Duplicate sketch entity ID '${id}'`, loc);
    validatePolygon(points, loc);
    sketch.entityIds.add(id); sketch.profiles.push(points);
  }
  body(id, points, plane, delta, offset, loc, identityContext = {}, profileSource = null) {
    if (this.bodies.length >= 128) fail('Prototype limit: 128 bodies per feature', loc);
    validatePolygon(points, loc);
    const eps = tolerance([...points, plane.origin, delta, offset ?? [0, 0, 0]]);
    const height = dot(delta, plane.normal);
    // Up to std math.fs TOLERANCE.zeroLength (1e-8 m = 1e-5 mm) the extrusion is
    // flat in Onshape too: a failing operation, which a try in the input catches.
    // Beyond that, below the F32 tolerance, it is wonky's precision limit.
    if (Math.abs(height) <= 1e-5) raise('Extrusion has zero or unresolved thickness normal to the sketch plane', loc);
    if (!Number.isFinite(height) || Math.abs(height) <= eps) fail('Extrusion has zero or unresolved thickness normal to the sketch plane', loc);
    const oriented = signedArea(points) * height < 0 ? [...points].reverse() : points;
    try {
      const body = extrudeInBend(this.kernel, id.toString(), oriented, plane, delta, offset, identityContext);
      if (profileSource) {
        body.sketchProfile = profileSource;
        const n = points.length, kept = body.identity?.profile?.kept ?? points.map((_, i) => i);
        const ids = i => profileSource.profileUses[oriented === points ? i : (n - 2 - i + n) % n]?.entityId;
        const sides = kept.map((start, j) => {
          const entities = [];
          for (let i = start; i !== kept[(j + 1) % kept.length]; i = (i + 1) % n) if (ids(i)) entities.push(ids(i));
          return entities;
        });
        noteProfileFaces(body, [[], [], ...sides]);
      }
      this.addSolid(id, body);
    } catch (error) {
      if (!error.line && loc) { error.line = loc.line; error.column = loc.column; }
      throw error;
    }
  }
  // Adds the extra components of a Boolean result as new records. They share
  // the lineage and name the record they split from, so identity tracking can
  // refuse to guess which piece inherits the original identity.
  addSplitPieces(id, bodies, lineage, source) {
    for (const body of bodies) {
      this.addSolid(id, body);
      Object.assign(this.records.get(String(this.nextRecord - 1)), { createdBy: new Set(lineage), splitFrom: source.key });
    }
  }
  consume(record, id) { this.records.delete(record.key); this.consumedBy.set(record.key, id.toString()); }
  binaryBoolean(operation, id, records, keepTools, loc) {
    const subtract = operation === 'SUBTRACTION';
    let results;
    try { results = booleanInBend(this.kernel, records[0].body, records[1].body, operation, id.toString(), loc,
      { modelingPolicy: this.modelingPolicy }); }
    catch (error) { noteRefusal(error, records.map(record => record.body)); throw error; }
    this.operationEvidence.push(...(results.operationEvidence ?? []));
    // std geomOperations.fs opBoolean UNION merges "tool bodies that intersect
    // or abut". Two union results mean the tools do not touch: both bodies
    // stay as they were, with their own identities (as in naryBoolean).
    if (operation === 'UNION' && results.length === 2) return;
    if (operation === 'INTERSECTION' && !results.length) refuseEmptyIntersection(loc);
    if (subtract && !removedMaterial(records[0].body, results, loc)) refuseNoOpSubtraction(loc);
    if (operation === 'UNION' && results.length > 2) unsupported(`opBoolean union of two bodies returned ${results.length} bodies`, loc);
    // Commit only after the entire Bend result has passed validation. Keep
    // the first record identity so existing body queries track the result.
    const lineage = new Set([...records[0].createdBy, ...(subtract ? [] : records[1].createdBy), id.key()]);
    if (!subtract || !keepTools) this.consume(records[1], id);
    if (!results.length) this.records.delete(records[0].key);
    else {
      const [first, ...rest] = results;
      for (const body of results) for (const key of BODY_PROPERTIES) if (records[0].body[key] !== undefined) body[key] = records[0].body[key];
      records[0].body = first; records[0].createdBy = lineage;
      this.addSplitPieces(id, rest, lineage, records[0]);
    }
  }
  // Onshape's opBoolean takes any number of operands (std geomOperations.fs):
  //   UNION merges tool bodies that intersect or abut; when several merge, the
  //   tool that appears earliest in the query keeps its identity.
  //   SUBTRACTION removes the union of all tools from every target.
  //   INTERSECTION is the intersection of all tools.
  // Bend Booleans are binary, so this folds the call into binary booleanInBend
  // calls in source order. The order matters beyond cost: Bend resolves some
  // contacts only in some orders (a fewest-faces-first pairing failed a
  // four-tool union that the source-order fold builds), so every merge keeps
  // exactly the operands of the source-order fold. UNION is component-aware:
  // every later tool meets every component collected so far, because two
  // disjoint tools can be connected by a later one (a left fold would return
  // two bodies there). A binary union with two results means "not touching"
  // and leaves both as they were. Only geometry, never a kernel verdict on a
  // different pair, lets the fold skip a pair: a pair whose Bend-computed
  // bounds are separated by more than NARY_SEPARATION_MM cannot touch, and
  // neither can a merged body and a component that is that far from every
  // tool the merged body was built from. (Testing the tool alone with the
  // kernel instead is not equivalent: for a tool that meets the component only
  // at a vertex Bend returns two bodies, while the merged body's own call, and
  // the same unions done one by one, are refused.) Everything is staged and
  // committed only after every binary call succeeded, and the decomposition is
  // recorded as operation evidence.
  naryBoolean(operation, id, toolRecords, targetRecords, keepTools, loc) {
    const policy = { modelingPolicy: this.modelingPolicy };
    const evidence = [], steps = [], inputs = [...targetRecords, ...toolRecords].map(record => record.body);
    const order = new Map([...targetRecords, ...toolRecords].map((record, i) => [record, i]));
    const run = (a, b) => {
      const stepId = `${id}/~step${steps.length}`;
      let results;
      try { results = booleanInBend(this.kernel, a, b, operation, stepId, loc, policy); }
      catch (error) { noteRefusal(error, [a, b]); error.operationEvidence = [...evidence, ...(error.operationEvidence ?? [])]; throw error; }
      evidence.push(...(results.operationEvidence ?? []));
      steps.push({ operationId: stepId, operands: [a.id, b.id], outcome: `${results.length} bodies` });
      return results;
    };
    const skip = (a, b, outcome) => { steps.push({ operationId: null, operands: [a.id, b.id], outcome }); };
    const lineageOf = records => new Set([...records.flatMap(record => [...record.createdBy]), id.key()]);
    const withProperties = (bodies, source) => {
      for (const body of bodies) for (const key of BODY_PROPERTIES) if (source[key] !== undefined) body[key] = source[key];
      return bodies;
    };
    const commits = [];
    if (operation === 'UNION') {
      let components = [{ records: [toolRecords[0]], body: toolRecords[0].body }];
      for (const next of toolRecords.slice(1)) {
        let current = { records: [next], body: next.body };
        const apart = [];
        for (const part of components) {
          if (separated(part.body, current.body)) { skip(part.body, current.body, 'disjoint bounds'); apart.push(part); continue; }
          if (current.records.length > 1 && current.records.every(record => separated(part.body, record.body))) {
            skip(part.body, current.body, 'disjoint bounds: every tool of the merged body'); apart.push(part); continue;
          }
          const [keep, drop] = order.get(part.records[0]) < order.get(current.records[0]) ? [part, current] : [current, part];
          const results = run(keep.body, drop.body);
          if (results.length === 2) { steps.at(-1).outcome = 'not touching'; apart.push(part); continue; }
          if (results.length !== 1) unsupported(`opBoolean union of two bodies returned ${results.length} bodies`, loc);
          steps.at(-1).outcome = 'merged';
          current = { records: [...keep.records, ...drop.records], body: results[0] };
        }
        components = [...apart, current];
      }
      for (const { records, body } of components) {
        if (records.length === 1) continue;
        commits.push(() => {
          const [first, ...merged] = records;
          withProperties([body], first.body);
          first.body = body; first.createdBy = lineageOf(records);
          for (const record of merged) this.consume(record, id);
        });
      }
    } else if (operation === 'INTERSECTION') {
      let pieces = [toolRecords[0].body];
      for (const next of toolRecords.slice(1)) {
        pieces = pieces.flatMap(piece => separated(piece, next.body) ? (skip(piece, next.body, 'disjoint bounds: empty'), []) : run(piece, next.body));
      }
      if (!pieces.length) refuseEmptyIntersection(loc);
      commits.push(() => {
        const [first, ...consumed] = toolRecords, lineage = lineageOf(toolRecords);
        for (const record of consumed) this.consume(record, id);
        if (!pieces.length) { this.records.delete(first.key); return; }
        withProperties(pieces, first.body);
        first.body = pieces[0]; first.createdBy = lineage;
        this.addSplitPieces(id, pieces.slice(1), lineage, first);
      });
    } else {
      for (const target of targetRecords) {
        let pieces = [target.body], removed = false;
        for (const tool of toolRecords) {
          pieces = pieces.flatMap(piece => {
            if (separated(piece, tool.body)) { skip(piece, tool.body, 'disjoint bounds: unchanged'); return [piece]; }
            const results = run(piece, tool.body);
            if (removedMaterial(piece, results, loc)) removed = true;
            else steps.at(-1).outcome = 'removed nothing';
            return results;
          });
        }
        // A target from which no tool removed anything keeps its record untouched.
        if (!removed) continue;
        commits.push(() => {
          const lineage = lineageOf([target]);
          if (!pieces.length) { this.records.delete(target.key); return; }
          withProperties(pieces, target.body);
          target.body = pieces[0]; target.createdBy = lineage;
          this.addSplitPieces(id, pieces.slice(1), lineage, target);
        });
      }
      if (!commits.length) refuseNoOpSubtraction(loc);
      if (!keepTools) commits.push(() => { for (const tool of toolRecords) this.consume(tool, id); });
    }
    for (const commit of commits) commit();
    const decomposition = operationEvidence(id.toString(), operation, inputs, this.modelingPolicy, {
      method: 'N-ary opBoolean folded into binary Bend Booleans in source order', status: 'Resolved',
      decomposition: { rule: operation === 'UNION' ? 'component-aware union: each later tool meets every component so far'
        : operation === 'INTERSECTION' ? 'left fold over the tools, applied to every piece' : 'every tool removed from every piece of every target',
        separationMarginMm: NARY_SEPARATION_MM, steps } });
    this.operationEvidence.push(...evidence, decomposition);
  }
  builtins() {
    const register = (name, min, max, fn) => builtin(name, min, max, fn);
    const values = {
      ...scalarBuiltins(),
      ...stdValueBuiltins(),
      print: register('print', 1, 1, ([value], loc) => this.output(stdToString(value, loc), loc, false)),
      println: register('println', 0, 1, (args, loc) => this.output(args.length ? stdToString(args[0], loc) : '', loc, true)),
      ...queryBuiltins(this),
      ...instantiatorBuiltins(this),
      meter: new Quantity(1), centimeter: new Quantity(0.01), millimeter: new Quantity(0.001), inch: new Quantity(0.0254), foot: new Quantity(0.3048),
      BoundingType: map({ BLIND: 'BoundingType.BLIND' }),
      // wonky alias used by examples/; not exported by Onshape std (endcap.fs keeps a
      // private one), so it has no UI default. LENGTH_BOUNDS and the other std
      // specs come from scalarBuiltins() (valueBounds.fs).
      POSITIVE_LENGTH_BOUNDS: 'POSITIVE_LENGTH_BOUNDS',
      vector: register('vector', 2, 3, (args, loc) => {
        if (!args.every(scalar)) raise('Vector components must be numbers or quantities', loc);
        if (!args.every(x => (x instanceof Quantity ? x.dimension : 0) === (args[0] instanceof Quantity ? args[0].dimension : 0) && (x instanceof Quantity ? x.angle : 0) === (args[0] instanceof Quantity ? args[0].angle : 0))) raise('Vector components must have matching units', loc);
        return new Vector(args);
      }),
      plane: register('plane', 2, 3, ([origin, normal, x], loc) => {
        vectorNumbers(origin, 1, 3, loc);
        const direction = vectorNumbers(normal, 0, 3, loc), n = normalized(direction, loc);
        let u;
        if (x) {
          u = normalized(vectorNumbers(x, 0, 3, loc), loc);
          if (Math.abs(dot(n, u)) > 1e-7) raise('The plane x axis must be perpendicular to its normal', loc); // surfaceGeometry.fs canBePlane
        } else {
          // surfaceGeometry.fs:86 plane(origin, normal) = plane(origin, normal, perpendicularVector(normal)):
          // perpendicularVector sees the normal as given, so one shorter than
          // TOLERANCE.zeroLength gets (1, 0, 0) whatever its direction, and the
          // `as Plane` of plane(origin, normal, x) (canBePlane: |x . normal| <
          // TOLERANCE.zeroAngle) fails unless that happens to be perpendicular.
          u = perpendicularVector(direction);
          if (!(Math.abs(dot(n, u)) < ZERO_ANGLE)) raise('The plane x axis must be perpendicular to its normal', loc);
        }
        const result = rememberPlane(new Plane(origin, new Vector(n), new Vector(u)), normal, x);
        return rememberQueryPlane(result, origin, normal);
      }),
      defineFeature: register('defineFeature', 1, 2, ([fn, defaults = map({})], loc) => {
        if (!isFunctionValue(fn) || !isMap(defaults)) raise('defineFeature expects a function and optional defaults map', loc);
        return { type: 'feature', fn, defaults };
      }),
      // units.fs isLength(val): a ValueWithUnits of length units, false otherwise.
      // valueBounds.fs isLength(value, boundSpec is LengthBoundSpec) = isLength(value)
      // and verifyBounds(value, boundSpec): out of range throws PARAMETER_OUT_OF_RANGE.
      isLength: register('isLength', 1, 2, ([value, bounds], loc) => {
        if (!(value instanceof Quantity) || value.dimension !== 1 || value.angle !== 0 || !Number.isFinite(value.value)) return false;
        if (bounds === undefined) return true;
        if (bounds === 'POSITIVE_LENGTH_BOUNDS') return value.value > 0;
        return verifyBounds(value, bounds, 'LengthBoundSpec', loc);
      }),
      newSketchOnPlane: register('newSketchOnPlane', 3, 3, ([context, id, definition], loc) => {
        const { sketchPlane } = fieldMap(definition, ['sketchPlane'], [], loc);
        checkType(sketchPlane, 'Plane', loc); this.claim(context, id, loc);
        const sketch = new Sketch(id, sketchPlane); this.sketches.set(id.key(), sketch); return sketch;
      }),
      skRectangle: register('skRectangle', 3, 3, ([sketch, id, definition], loc) => {
        const d = fieldMap(definition, ['firstCorner', 'secondCorner'], ['construction'], loc);
        if (d.construction !== undefined && d.construction !== false) unsupported('Construction geometry is not implemented', loc);
        const a = vectorNumbers(d.firstCorner, 1, 2, loc), b = vectorNumbers(d.secondCorner, 1, 2, loc);
        const [x0, y0] = a.map((v, i) => Math.min(v, b[i])), [x1, y1] = a.map((v, i) => Math.max(v, b[i]));
        this.addProfile(sketch, id, [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], loc);
      }),
      skPolyline: register('skPolyline', 3, 3, ([sketch, id, definition], loc) => {
        const d = fieldMap(definition, ['points'], ['construction', 'constrained'], loc);
        if ((d.construction !== undefined && d.construction !== false) || (d.constrained !== undefined && d.constrained !== false)) unsupported('Construction geometry and sketch constraints are not implemented', loc);
        if (!Array.isArray(d.points) || d.points.length < 4) fail('A closed polyline needs at least three vertices plus a repeated first point', loc);
        const points = d.points.map(p => vectorNumbers(p, 1, 2, loc));
        if (points[0].some((v, i) => v !== points.at(-1)[i])) fail('skPolyline must explicitly repeat its first point to close the profile', loc);
        this.addProfile(sketch, id, points.slice(0, -1), loc);
      }),
      skLineSegment: register('skLineSegment', 3, 3, ([sketch, id, definition], loc) => {
        this.sketch(sketch, loc, true);
        const d = fieldMap(definition, ['start', 'end'], ['construction'], loc);
        if (d.construction !== undefined && d.construction !== false) unsupported('Construction sketch geometry is not implemented', loc);
        if (sketch.profiles.length) unsupported('A line-segment sketch cannot mix segments with rectangle, polyline or circle profiles', loc);
        if (typeof id !== 'string' || !id || sketch.entityIds.has(id)) fail('Sketch segment ID must be nonempty and unique', loc);
        if (sketch.curveEntities.length >= SKETCH_ENTITY_LIMIT) unsupported(`A line/arc profile supports at most ${SKETCH_ENTITY_LIMIT} entities`, loc);
        const start = vectorNumbers(d.start, 1, 2, loc), end = vectorNumbers(d.end, 1, 2, loc);
        const startMeters = d.start.items.map(value => value.value), endMeters = d.end.items.map(value => value.value);
        let native;
        try { native = { $: 'Segment', index: sketch.lineSegments.length, start: lineSketchPoint(start, startMeters), end: lineSketchPoint(end, endMeters) }; }
        catch (error) { unsupported(`Line sketch coordinates cannot be represented: ${error.message}`, loc); }
        const entity = { id, start, end, startMeters, endMeters, native, location: loc ? { line: loc.line, column: loc.column } : null };
        sketch.entityIds.add(id); sketch.lineSegments.push(entity);
        sketch.curveEntities.push({ ...entity, type: 'line', index: sketch.curveEntities.length });
      }),
      skArc: register('skArc', 3, 3, ([sketch, id, definition], loc) => {
        this.sketch(sketch, loc, true);
        const d = fieldMap(definition, ['start', 'mid', 'end'], ['construction'], loc);
        if (d.construction !== undefined && d.construction !== false) unsupported('Construction sketch geometry is not implemented', loc);
        if (sketch.profiles.length) unsupported('A line/arc sketch cannot mix entities with rectangle, polyline or circle profiles', loc);
        if (typeof id !== 'string' || !id || sketch.entityIds.has(id)) fail('Sketch arc ID must be nonempty and unique', loc);
        if (sketch.curveEntities.length >= SKETCH_ENTITY_LIMIT) unsupported(`A line/arc profile supports at most ${SKETCH_ENTITY_LIMIT} entities`, loc);
        const start = vectorNumbers(d.start, 1, 2, loc), mid = vectorNumbers(d.mid, 1, 2, loc), end = vectorNumbers(d.end, 1, 2, loc);
        sketch.curveEntities.push({ type: 'arc', index: sketch.curveEntities.length, id, start, mid, end,
          startMeters: d.start.items.map(value => value.value), midMeters: d.mid.items.map(value => value.value),
          endMeters: d.end.items.map(value => value.value), location: loc ? { line: loc.line, column: loc.column } : null });
        sketch.entityIds.add(id);
      }),
      skCircle: register('skCircle', 3, 3, ([sketch, id, definition], loc) => {
        this.sketch(sketch, loc, true);
        if (sketch.curveEntities.length) unsupported('A line/arc sketch cannot mix entities with rectangle, polyline or circle profiles', loc);
        const d = fieldMap(definition, ['center', 'radius'], ['construction'], loc);
        if (d.construction !== undefined && d.construction !== false) unsupported('Construction sketch geometry is not implemented', loc);
        if (typeof id !== 'string' || !id || sketch.entityIds.has(id)) fail('Sketch circle ID must be nonempty and unique', loc);
        const radius = length(d.radius, loc);
        if (radius <= 0.00001) fail('Circle radius must be positive and resolvable', loc);
        sketch.profiles.push({ type: 'circle', center: vectorNumbers(d.center, 1, 2, loc), radius });
        sketch.entityIds.add(id);
      }),
      // std sketch.fs skBezier (control points, degree = points - 1): only the
      // Rust curve-profile port builds it (src/native/rust-host.mjs).
      skFitSpline: register('skFitSpline', 3, 3, (_args, loc) => unsupported('skFitSpline requires the Rust curve-profile port', loc)),
      skBezier: register('skBezier', 3, 3, (_args, loc) => unsupported('skBezier requires the Rust curve-profile port (WONKY_BACKEND=rust)', loc)),
      skSolve: register('skSolve', 1, 1, ([sketch], loc) => {
        this.sketch(sketch, loc, true);
        if (sketch.curveEntities.some(entity => entity.type === 'arc')) {
          if (!this.kernel.sketchArcs) unsupported('Native line/arc sketch assembly is unavailable', loc);
          const entities = sketch.curveEntities.map(({ native, ...entity }) => entity);
          const result = solveSketchArcs(this.kernel.sketchArcs, entities, loc);
          sketch.arcProfileSource = { schema: 'wonky-line-arc-sketch/1', sketchId: sketch.id.toString(), entities, native: result,
            scope: 'Original named line/arc entities and native ordered analytic profile; no polygonal approximation.' };
          sketch.profiles.push({ type: 'line-arc', native: result });
        } else if (sketch.lineSegments.length) {
          // Up to SKETCH_LINES_SEGMENT_LIMIT segments kernel/sketch-lines.bend admits
          // the profile. Above it the analytic line/arc solver does (its admission is
          // O(n log n), docs/sketch-arcs.md "Admission cost"); either way the body is
          // the same polygon prism from the segments' own endpoints.
          const large = sketch.lineSegments.length > SKETCH_LINES_SEGMENT_LIMIT;
          let result, uses;
          if (large) {
            if (!this.kernel.sketchArcs) unsupported('Native line/arc sketch assembly is unavailable', loc);
            result = solveSketchArcs(this.kernel.sketchArcs, sketch.curveEntities.map(({ native, ...entity }) => entity), loc);
            uses = array(result.uses).map(({ fit, forward }) => ({ entityId: sketch.lineSegments[fit.source.index].id, sourceIndex: fit.source.index, forward }));
          } else {
            if (!this.kernel.sketchLines) unsupported('Native line-sketch assembly is unavailable', loc);
            result = this.kernel.sketchLines.solve(list(sketch.lineSegments.map(segment => segment.native)));
            if (result.$ !== 'Solved') unsupported(`Line sketch cannot form one simple closed profile: ${result.reason.$}`, loc);
            uses = array(result.uses).map(use => ({ entityId: sketch.lineSegments[use.segment.index].id, sourceIndex: use.segment.index, forward: use.forward }));
          }
          // The profile is the segments' own binary64 mm endpoints in the order Bend
          // solved (use start: start when forward), not result.points, the solver's
          // F32 quantization: the polygon prism takes F32x2 words (src/kernel.mjs),
          // so an F32 profile left a 1.5e-6 mm wall against a polyline face.
          const points = uses.map(({ sourceIndex, forward }) => { const segment = sketch.lineSegments[sourceIndex]; return forward ? segment.start : segment.end; });
          sketch.lineProfileSource = { schema: 'wonky-line-sketch/1', sketchId: sketch.id.toString(),
            scope: 'Canonical 2D profile and original segment references; use order describes the profile, not final solid edge indices.',
            segments: sketch.lineSegments.map(({ id, start, end, startMeters, endMeters, location }) => ({ id, startMm: start, endMm: end, startMeters, endMeters, location })),
            profileUses: uses, native: result, solver: large ? 'kernel/sketch-arcs.bend' : 'kernel/sketch-lines.bend' };
          sketch.profiles.push(points);
        }
        if (sketch.profiles.length !== 1) unsupported('Sketch solving requires exactly one closed profile; nested loops, holes and multiple regions are not implemented', loc);
        sketch.solved = true;
        const key = String(this.nextRecord++); this.records.set(key, { key, kind: 'sketch', sketch, createdBy: new Set([sketch.id.key()]) });
      }),
      qSketchRegion: register('qSketchRegion', 1, 2, ([id, filterInnerLoops = false], loc) => {
        checkType(id, 'Id', loc); if (typeof filterInnerLoops !== 'boolean') raise('filterInnerLoops must be boolean', loc); return new Query(id);
      }),
      evOwnerSketchPlane: register('evOwnerSketchPlane', 2, 2, ([context, definition], loc) => {
        if (context !== this.context) raise('Invalid context', loc);
        const d = fieldMap(definition, ['entity'], [], loc);
        return this.resolve(d.entity, loc).plane;
      }),
      opExtrude: register('opExtrude', 3, 3, ([context, id, definition], loc) => {
        const d = fieldMap(definition, ['entities', 'direction', 'endBound', 'endDepth'], ['startBound', 'startDepth'], loc);
        if (d.endBound !== 'BoundingType.BLIND' || (d.startBound !== undefined && d.startBound !== 'BoundingType.BLIND')) unsupported('Only BoundingType.BLIND extrusion bounds are implemented', loc);
        if ((d.startBound !== undefined) !== (d.startDepth !== undefined)) fail('startBound and startDepth must be supplied together', loc);
        const sketch = this.resolve(d.entities, loc), direction = normalized(vectorNumbers(d.direction, 0, 3, loc), loc);
        const end = length(d.endDepth, loc), start = d.startDepth === undefined ? 0 : length(d.startDepth, loc);
        this.claim(context, id, loc);
        if (sketch.profiles[0].type === 'line-arc') {
          const plane = this.numericPlane(sketch.plane, loc), delta = scale(direction, end + start), offset = scale(direction, -start);
          const body = extrudeSketchArcs(this.kernel.sketchArcs, this.kernel, sketch.profiles[0].native, id.toString(), plane, delta, offset, loc);
          body.sketchProfile = structuredClone(sketch.arcProfileSource);
          identifySketchArcExtrusion(this.kernel, body, id.toString(), sketch.arcProfileSource, plane, delta, offset);
          this.addSolid(id, body);
        } else if (sketch.profiles[0].type === 'circle') this.addSolid(id, circularFrustumInBend(this.kernel, id.toString(), { ...sketch.profiles[0], plane: this.numericPlane(sketch.plane, loc) }, null, scale(direction, end + start), scale(direction, -start)));
        else this.body(id, sketch.profiles[0], this.numericPlane(sketch.plane, loc), scale(direction, end + start), scale(direction, -start), loc, {}, sketch.lineProfileSource);
      }),
      opLoft: register('opLoft', 3, 3, ([context, id, definition], loc) => {
        const d = fieldMap(definition, ['profileSubqueries'], [], loc);
        if (!Array.isArray(d.profileSubqueries) || d.profileSubqueries.length !== 2) unsupported('opLoft currently requires two coaxial circular profiles', loc);
        const profiles = d.profileSubqueries.map(q => this.resolve(q, loc));
        if (profiles.some(s => s.profiles[0].type !== 'circle')) unsupported('opLoft currently requires two coaxial circular profiles', loc);
        this.claim(context, id, loc);
        const [a, b] = profiles.map(s => ({ ...s.profiles[0], plane: this.numericPlane(s.plane, loc) }));
        this.addSolid(id, circularFrustumInBend(this.kernel, id.toString(), a, b));
      }),
      // std geomOperations.fs opRevolve(entities, axis, angleForward[, angleBack]).
      // Regions with holes are refused by skSolve; the region must be one closed
      // line/arc profile, polyline, rectangle or circle.
      opRevolve: register('opRevolve', 3, 3, ([context, id, definition], loc) => {
        const d = fieldMap(definition, ['entities', 'axis', 'angleForward'], ['angleBack', 'revolveType'], loc);
        if (d.revolveType !== undefined) unsupported('opRevolve revolveType is not implemented: only angleForward, with angleBack 0 or equal to angleForward (a full turn)', loc);
        const forward = revolveAngle(d.angleForward, 'angleForward', loc);
        const back = d.angleBack === undefined ? 0 : revolveAngle(d.angleBack, 'angleBack', loc);
        const full = Math.abs(forward - back) < ZERO_ANGLE;
        if (!full && back !== 0) unsupported('opRevolve angleBack other than 0 or angleForward is not implemented: the sense in which a nonzero start angle is measured is not verified against Onshape', loc);
        const sketch = this.resolve(d.entities, loc);
        const axis = lineAxis(d.axis, loc, 'opRevolve axis'), origin = vectorNumbers(d.axis.origin, 1, 3, loc);
        this.claim(context, id, loc);
        this.addSolid(id, revolveSketch(this.kernel, id.toString(), sketch, this.numericPlane(sketch.plane, loc), origin, axis, full ? null : forward, loc));
      }),
      opShell: register('opShell', 3, 3, (_args, loc) => unsupported('opShell requires the Rust host port', loc)),
      // std geomOperations.fs opFillet / opChamfer on the production fillet.
      opFillet: register('opFillet', 3, 3, (args, loc) => fsBlend(this, 'fillet', args, loc, BODY_PROPERTIES)),
      opChamfer: register('opChamfer', 3, 3, (args, loc) => fsBlend(this, 'chamfer', args, loc, BODY_PROPERTIES)),
      opBoolean: register('opBoolean', 3, 3, ([context, id, definition], loc) => {
        const d = fieldMap(definition, ['tools', 'operationType'], ['targets', 'keepTools'], loc);
        if (!(d.operationType instanceof EnumValue) || d.operationType.enumType !== 'BooleanOperationType') raise('opBoolean requires a BooleanOperationType', loc);
        const operation = d.operationType.name;
        if (!['UNION', 'INTERSECTION', 'SUBTRACTION'].includes(operation)) unsupported(`Boolean operation '${operation}' is not implemented`, loc);
        if (d.keepTools !== undefined && typeof d.keepTools !== 'boolean') raise('keepTools must be boolean', loc);
        const tools = resolveTopology(this, d.tools, loc);
        const targets = d.targets === undefined ? [] : resolveTopology(this, d.targets, loc);
        if ([...tools, ...targets].some(r => r.kind !== 'body' || r.record.kind !== 'solid')) fail('opBoolean expects solid-body queries', loc);
        const subtract = operation === 'SUBTRACTION';
        // An empty operand usually means the feature expected parts of an
        // Onshape Part Studio that a standalone build does not have.
        if (!tools.length) unsupported('opBoolean tools resolved to no bodies', loc);
        if (subtract && !targets.length) unsupported('opBoolean targets resolved to no bodies', loc);
        if (!subtract && d.targets !== undefined) unsupported('opBoolean targets for union/intersection (targetsAndToolsNeedGrouping) are not implemented', loc);
        if (!subtract && tools.length < 2) unsupported('opBoolean union/intersection of a single tool body is not implemented', loc);
        if (!subtract && d.keepTools) unsupported('keepTools is currently supported only for subtraction', loc);
        const toolRecords = tools.map(r => r.record), targetRecords = targets.map(r => r.record);
        if (toolRecords.some(record => targetRecords.includes(record))) fail('Boolean target and tool must be different bodies', loc);
        this.claim(context, id, loc);
        if (subtract ? toolRecords.length === 1 && targetRecords.length === 1 : toolRecords.length === 2) {
          this.binaryBoolean(operation, id, subtract ? [targetRecords[0], toolRecords[0]] : toolRecords, !!d.keepTools, loc);
        } else this.naryBoolean(operation, id, toolRecords, targetRecords, !!d.keepTools, loc);
      }),
      opSphere: register('opSphere', 3, 3, (_args, loc) => unsupported('opSphere requires the Rust spherical body port', loc)),
      fSphere: register('fSphere', 3, 3, (_args, loc) => unsupported('fSphere requires the Rust spherical body port', loc)),
      fCylinder: register('fCylinder', 3, 3, (_args, loc) => unsupported('fCylinder requires the Rust analytic carrier port', loc)),
      fCuboid: register('fCuboid', 3, 3, ([context, id, definition], loc) => {
        const d = fieldMap(definition, ['corner1', 'corner2'], [], loc);
        const a = vectorNumbers(d.corner1, 1, 3, loc), b = vectorNumbers(d.corner2, 1, 3, loc);
        const lo = a.map((v, i) => Math.min(v, b[i])), hi = a.map((v, i) => Math.max(v, b[i]));
        this.claim(context, id, loc);
        this.body(id, [[lo[0], lo[1]], [hi[0], lo[1]], [hi[0], hi[1]], [lo[0], hi[1]]],
          { origin: [0, 0, lo[2]], normal: [0, 0, 1], x: [1, 0, 0] }, [0, 0, hi[2] - lo[2]], undefined, loc, {primitive:'box'});
      }),
      normalize: register('normalize', 1, 1, ([value], loc) => {
        if (!(value instanceof Vector)) raise('normalize expects a Vector', loc);
        const raw = value.items.map(v => v instanceof Quantity ? v.value : v);
        return new Vector(normalized(raw, loc));
      }),
      norm: register('norm', 1, 1, ([value], loc) => {
        if (value instanceof Matrix) unsupported('norm of a Matrix is not implemented', loc);
        if (!(value instanceof Vector)) raise('norm expects a Vector', loc);
        const magnitude = norm(value.items.map(v => v instanceof Quantity ? v.value : v));
        return value.items[0] instanceof Quantity ? new Quantity(magnitude, value.items[0].dimension, value.items[0].angle) : magnitude;
      }),
      abs: register('abs', 1, 1, ([value], loc) => {
        if (!scalar(value)) raise('abs expects a number or quantity', loc);
        return value instanceof Quantity ? new Quantity(Math.abs(value.value), value.dimension, value.angle) : Math.abs(value);
      }),
      // containers.fs size(container is array|map). An Id is an array of
      // strings; Plane, Transform and a caught regenError are std maps
      // (stdMapView); a ValueWithUnits is { value, unit }.
      size: register('size', 1, 1, ([value], loc) => {
        if (Array.isArray(value) || typeof value === 'string') return value.length;
        if (value instanceof Vector) return value.items.length;
        if (value instanceof Id) return value.parts.length;
        if (value instanceof KeyedMap) return value.entries.length;
        if (value instanceof Quantity) return 2;
        const fields = isMap(value) && !isFunctionValue(value) ? value : stdMapView(value);
        if (fields) return Object.keys(fields).length;
        memberless(value, 'size', loc);
      }),
    };
    // Unknown functions and enum values fail at their source location instead
    // of being approximated by a similar operation. On strict rust the geometry
    // operations route to the Rust host port or refuse by name (host-ops.mjs).
    return guardHostBuiltins(values, this, isStrictRustKernel(this.kernel), { Sketch, Query, fieldMap, checkType, fitSplineParameters });
  }
  resolve(query, loc) {
    // A region-set query (qUnion, qSubtraction, qContainsPoint, ... of
    // qSketchRegion) names only some regions of a sketch. Only the Rust port's
    // opExtrude evaluates it (native/rust-host.mjs); any other caller that
    // would use every region of one sketch refuses it by name instead.
    if (query instanceof RegionQuery) {
      // The Rust host's own refusal (a RustCapabilityError) for a point selection.
      if (query.kind === 'pick') query.refuse(loc);
      regionRefusal('query', 'sketch-region/query-outside-extrude', 'a set of sketch regions is consumed only by opExtrude',
        'Pass the region query to opExtrude, or use qSketchRegion(sketchId) here.', loc);
    }
    if (!(query instanceof Query)) regionRefusal('query', 'sketch-region/topology-query-not-extrudable', 'only sketch regions are implemented here, not a topology query', REGION_HINTS.topology, loc);
    const sketch = this.sketches.get(query.id.key());
    if (!sketch?.solved || sketch.deleted) raise(`Sketch '${query.id}' does not exist or has not been solved`, loc);
    return sketch;
  }
  numericPlane(plane, loc) {
    return { origin: vectorNumbers(plane.origin, 1, 3, loc), normal: vectorNumbers(plane.normal, 0, 3, loc), x: vectorNumbers(plane.x, 0, 3, loc) };
  }
}
