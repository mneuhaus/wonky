import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { closeSync, constants as fsConstants, existsSync, openSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, extname, isAbsolute, join, relative, resolve as resolvePath, sep } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { loadKernel, extrudeInBend, transformInBend, precisionForBodies } from './kernel.mjs';
import { backendInfo, selectBackend, withoutBend } from './native/backend.mjs';
import { endsRun } from './native/errors.mjs';
import { circularFrustumInBend, transformAnalytic } from './analytic.mjs';
import { booleanInBend } from './boolean.mjs';
import { isMeshBody, refuseMeshBody } from './hybrid-mesh.mjs';
import { cross, dot, norm, scale, signedArea, tolerance, validatePolygon } from './brep.mjs';
import { identifySketchArcExtrusion } from './identity.mjs';
import { extrudeSketchArcs, solveSketchArcs } from './sketch-arcs.mjs';
import { UnsupportedFeatureError } from './errors.mjs';
import { pythonSourceTracker } from './source-map.mjs';
import { real, number, vector as realVector } from './real.mjs';
import { toStep, toStl } from './exporters.mjs';
import { toPrintStl } from './print-mesh.mjs';
import { SKETCH_ENTITY_LIMIT } from './library.mjs';
import { loadFilletProduction } from './fillet.mjs';
import { pythonBlend } from './fillet-python.mjs';

export class PythonExecutionError extends Error {
  constructor(message, { line, traceback, sourceFile, sourceLine } = {}) {
    super(message);
    this.name = 'PythonExecutionError';
    this.line = line;
    this.traceback = traceback;
    // Innermost frame when the error was raised inside a project module.
    if (sourceFile) Object.assign(this, { sourceFile, sourceLine });
  }
  format(filename = '<python>') {
    const inner = this.sourceFile ? ` (in ${basename(this.sourceFile)}${this.sourceLine ? `:${this.sourceLine}` : ''})` : '';
    return `${filename}${this.line ? `:${this.line}` : ''}: ${this.message}${inner}`;
  }
}

const identity = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
const capability = message => { throw new UnsupportedFeatureError(message); };
const finite = (value, name, positive = false) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || (positive && value <= 0)) {
    throw new PythonExecutionError(`${name} must be a finite ${positive ? 'positive ' : ''}number`);
  }
  return value;
};
const xyz = (value, name) => {
  if (!Array.isArray(value) || value.length !== 3) throw new PythonExecutionError(`${name} requires three coordinates`);
  return value.map(n => finite(n, name));
};

const unit = (value, name) => {
  const vector = xyz(value, name), length = norm(vector);
  if (length < 1e-12) throw new PythonExecutionError(`${name} must not be a zero vector`);
  return scale(vector, 1 / length);
};
const point2 = (value, name) => {
  if (!Array.isArray(value) || value.length !== 2) throw new PythonExecutionError(`${name} requires two coordinates`);
  return value.map(n => finite(n, name));
};

// A build123d Location is a rigid motion: rows orthonormal and det +1. Bend
// transforms (transformInBend, transformAnalytic) only move a solid rigidly, so
// a reflection or a scale/shear is refused, never approximated.
function rigidRows(value) {
  if (!Array.isArray(value) || value.length !== 3) throw new PythonExecutionError('Transform rows require a 3x3 matrix');
  const rows = value.map(row => xyz(row, 'Transform row'));
  const det = dot(rows[0], cross(rows[1], rows[2]));
  const orthonormal = rows.every((row, i) => rows.every((other, j) => Math.abs(dot(row, other) - (i === j ? 1 : 0)) <= 1e-9));
  if (orthonormal && Math.abs(det + 1) <= 1e-9) {
    capability('Reflection transforms (determinant -1, as mirror needs) are not implemented: Bend has no orientation-reversing \'reflection transform\' kernel operation');
  }
  if (!orthonormal || Math.abs(det - 1) > 1e-9) {
    capability('Non-rigid transforms (scale or shear) are not implemented: Bend transforms are rigid motions only; the \'scaled transform\' kernel operation is missing');
  }
  return rows;
}

// Sketch plane of a build123d face: origin, x direction and normal in world mm.
function sketchPlane(value) {
  if (!value || typeof value !== 'object') throw new PythonExecutionError('extrude_profile requires a plane');
  const origin = xyz(value.origin, 'Plane origin'), normal = unit(value.normal, 'Plane normal'), x = unit(value.x, 'Plane x direction');
  if (Math.abs(dot(normal, x)) > 1e-9) throw new PythonExecutionError('Plane x direction must be perpendicular to its normal');
  return { origin, normal, x };
}

// Requests that build no geometry: no source-map operation, never re-attributing a body.
const QUERY_OPS = new Set(['volume', 'count', 'solids', 'bounds', 'edges', 'compound', 'export_file', 'khana_check']);

const curveType = edge => edge.curve.type ?? edge.curve;
const polyhedral = body => body.faces.every(face => face.surface.type === 'plane') && body.edges.every(edge => curveType(edge) === 'line');
const vertexBounds = body => ({ min: [0, 1, 2].map(k => Math.min(...body.vertices.map(p => p[k]))), max: [0, 1, 2].map(k => Math.max(...body.vertices.map(p => p[k]))) });

// Tight bounds that are known, never invented: an all-plane, straight-edged
// body is bounded by its vertices (FeatureScript evBox3d reads them the same
// way); every other body only by the bounds Bend evaluated for it.
function tightBounds(body) {
  if (polyhedral(body) && body.vertices.length) return vertexBounds(body);
  const bounds = body.validation?.boundsMm;
  if (bounds && [...bounds.min, ...bounds.max].every(Number.isFinite)) return { min: [...bounds.min], max: [...bounds.max] };
  return capability(`bounding_box is not implemented for this body (${body.construction?.method ?? body.primitive?.type ?? 'analytic body'}): Bend has not evaluated its tight bounds, and the 'tight bounds of curved faces' kernel evaluation is missing`);
}

// N-ary Booleans skip a kernel call only when bounds that contain both bodies
// are separated by more than 1 µm, the same rule and gap as FeatureScript's
// naryBoolean (src/library.mjs NARY_SEPARATION_MM / separated), so both
// frontends decompose identically. Unknown bounds always go to the kernel.
const SEPARATION_MM = 1e-3;
function knownBounds(body) {
  if (polyhedral(body) && body.vertices.length) return vertexBounds(body);
  const bounds = body.validation?.boundsMm;
  return bounds && [...bounds.min, ...bounds.max].every(Number.isFinite) ? bounds : null;
}
function separated(a, b) {
  const first = knownBounds(a), second = knownBounds(b);
  return !!first && !!second && [0, 1, 2].some(k => first.min[k] - second.max[k] > SEPARATION_MM || second.min[k] - first.max[k] > SEPARATION_MM);
}

// One record per edge of the body JSON (python/_b3d_query.py builds build123d
// Edge objects from it): vertex coordinates, the carrier curve and the edge's
// parameter interval. Lengths are exact where the body states them: a line's
// vertex distance, a circle's radius times its angle; an ellipse arc has no
// closed-form length, so it is null, never approximated.
function edgeRecord(kernel, body, edge, solid, index) {
  const type = curveType(edge), start = body.vertices[edge.start], end = body.vertices[edge.end], forward = edge.sameSense !== false;
  const record = { solid, index, curve: type, start: [...start], end: [...end], sameSense: forward, range: edge.curveRange ? [...edge.curveRange] : null };
  if (type === 'line') {
    const delta = [0, 1, 2].map(k => end[k] - start[k]), length = norm(delta);
    const direction = typeof edge.curve === 'object' ? scale(edge.curve.direction, forward ? 1 : -1) : scale(delta, 1 / length);
    return { ...record, direction, length };
  }
  const curve = edge.curve, geometry = Object.fromEntries(Object.entries(curve).filter(([key]) => key !== 'type'));
  if (type !== 'circle') return { ...record, ...geometry, length: null };
  let range = record.range, closed = false;
  if (!range && edge.start === edge.end) closed = true;
  else if (!range) {
    // Untrimmed arc (STEP EDGE_CURVE): it runs along the curve from the start
    // vertex, or against it from the end vertex when sameSense is false.
    const encoded = Object.fromEntries(Object.entries(curve).map(([key, value]) => [key === 'type' ? '$' : key, key === 'type' ? 'Circle' : Array.isArray(value) ? realVector(value) : real(value)]));
    const parameter = point => number(kernel.analytic.curve_parameter(encoded, realVector(point)));
    const first = parameter(forward ? start : end);
    let last = parameter(forward ? end : start);
    while (last <= first) last += 2 * Math.PI;
    range = [first, last];
  }
  return { ...record, center: [...curve.origin], axis: [...curve.normal], x: [...curve.x], radius: curve.radius, range, closed,
    length: curve.radius * (closed ? 2 * Math.PI : range[1] - range[0]) };
}

// build123d's edges() after a Boolean (and after extrude) are those of
// ShapeUpgrade_UnifySameDomain (Shape.clean(), which +, -, &, fuse and cut
// apply): adjacent faces on one surface are one face and an edge chain on one
// curve between the same two faces is one edge. Bend keeps such splits, so the
// edge query unifies them here, exactly, with OCCT's default tolerances
// (Precision::Confusion 1e-7 mm, Precision::Angular 1e-12). The body itself is
// unchanged. Where OCCT's outcome depends on data Bend does not keep (the
// parametrization of full, seamed cylinders and cones), the query is refused.
const UNIFY_LINEAR_MM = 1e-7, UNIFY_ANGULAR = 1e-12;
const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const unit3 = a => scale(a, 1 / norm(a));
const parallel3 = (a, b) => norm(cross(unit3(a), unit3(b))) <= UNIFY_ANGULAR;
const lineDistance = (point, origin, direction) => norm(cross(sub3(point, origin), unit3(direction)));
const sameCurvedSurface = (a, b) => {
  if (a.type === 'cylinder') {
    return Math.abs(a.radius - b.radius) <= UNIFY_LINEAR_MM && parallel3(a.axis, b.axis) && lineDistance(b.origin, a.origin, a.axis) <= UNIFY_LINEAR_MM;
  }
  if (a.type === 'cone') {
    // The cone widens along its axis: r(v) = radius + v tan(angle); the apex fixes it.
    const apex = s => sub3(s.origin, scale(unit3(s.axis), s.radius / Math.tan(s.angle)));
    return Math.abs(a.angle - b.angle) <= UNIFY_ANGULAR && dot(unit3(a.axis), unit3(b.axis)) > 0 && parallel3(a.axis, b.axis)
      && norm(sub3(apex(a), apex(b))) <= UNIFY_LINEAR_MM;
  }
  return false;
};
function sameDomain(first, second) {
  const a = first.surface, b = second.surface;
  if (a.type !== b.type) return false;
  if (a.type === 'plane') {
    // Faces of one solid meeting at an edge on one plane have one outward normal.
    const outward = face => scale(unit3(face.surface.normal), face.sameSense === false ? -1 : 1);
    return dot(outward(first), outward(second)) > 0 && parallel3(a.normal, b.normal)
      && Math.abs(dot(unit3(a.normal), sub3(b.origin, a.origin))) <= UNIFY_LINEAR_MM;
  }
  return sameCurvedSurface(a, b);
}
const unifyRefusal = detail => capability(`edges() of this body is not implemented: ${detail}; build123d's clean() `
  + '(ShapeUpgrade_UnifySameDomain) merges or keeps such faces depending on OpenCascade surface parametrizations that '
  + 'Bend does not keep, and the \'unify same domain\' kernel operation is missing');

// One merged record for a chain of edges on one line or one circle. Lines keep
// the first member's direction; arcs run counterclockwise about the first
// member's axis; a chain of arcs that closes is a full circle whose seam vertex
// (which build123d's center() and position_at depend on) OCCT would choose.
function mergedRecord(body, members, ends) {
  const first = members.reduce((a, b) => (b.index < a.index ? b : a));
  if (first.curve === 'line') {
    // ends are vertex indices; the chain keeps the first member's direction.
    const [p, q] = ends.map(v => body.vertices[v]);
    const [start, end] = dot(sub3(q, p), first.direction) >= 0 ? [p, q] : [q, p];
    const delta = sub3(end, start);
    return { ...first, start: [...start], end: [...end], range: null, direction: unit3(delta), length: norm(delta), merged: members.length };
  }
  const center = first.center, z = unit3(first.axis), x = unit3(first.x), y = cross(z, x), radius = first.radius;
  const angle = point => { const v = sub3(point, center); return Math.atan2(dot(v, y), dot(v, x)); };
  const at = t => [0, 1, 2].map(k => center[k] + radius * (Math.cos(t) * x[k] + Math.sin(t) * y[k]));
  const total = members.reduce((sum, m) => sum + (m.range[1] - m.range[0]), 0);
  if (!ends.length || ends[0] === ends[1]) {
    const seam = ends.length ? body.vertices[ends[0]] : first.start;
    return { ...first, start: [...seam], end: [...seam], center: [...center], axis: z, x, sameSense: true, range: null, closed: true,
      ...(ends.length ? {} : { seam: 'unknown' }), length: 2 * Math.PI * radius, merged: members.length };
  }
  // Counterclockwise start of each member about z; the chain starts at the one
  // no other member ends at.
  const intervals = members.map(m => {
    const own = unit3(m.axis), mx = unit3(m.x), my = cross(own, mx), [r0, r1] = m.range;
    const point = t => [0, 1, 2].map(k => m.center[k] + m.radius * (Math.cos(t) * mx[k] + Math.sin(t) * my[k]));
    const start = dot(own, z) > 0 ? angle(point(r0)) : angle(point(r1));
    return { start, end: start + (r1 - r0) };
  });
  const turnsTo = (a, b) => { const d = Math.abs(((a - b) % (2 * Math.PI) + 3 * Math.PI) % (2 * Math.PI) - Math.PI); return d <= UNIFY_ANGULAR * 1e3; };
  const head = intervals.find(i => !intervals.some(j => j !== i && turnsTo(j.end, i.start)));
  if (!head) unifyRefusal('a chain of circular arcs has no start');
  const range = [head.start, head.start + total];
  return { ...first, start: at(range[0]), end: at(range[1]), center: [...center], axis: z, x, sameSense: true, range, closed: false,
    length: radius * total, merged: members.length };
}

// Coordinate noise of a body, in mm: how far Bend's evaluated coordinates (and
// so every key python/_b3d_query.py derives from them) may lie from the exact
// geometry, which OpenCascade evaluates with its own, different rounding. Keys
// closer than that are not ordered by the model but by rounding noise, so the
// Python side treats them as ties (never picks by them). F32x2 words decode
// with at most half a float64 ulp; 1e-10 of the coordinate scale leaves a wide
// margin over the kernel's own incidence allowance (about 1e-12 of it). F32
// words (or an unstated precision) resolve only about 1e-7 of the scale.
const NOISE_RELATIVE = { F32x2: 1e-10, F64: 1e-10 };
function coordinateNoise(body) {
  let size = 1;
  const grow = point => { if (Array.isArray(point)) point.forEach(v => { if (Number.isFinite(v)) size = Math.max(size, Math.abs(v)); }); };
  body.vertices.forEach(grow);
  body.edges.forEach(edge => { if (typeof edge.curve === 'object') { grow(edge.curve.origin); grow([edge.curve.radius]); } });
  const audit = [body.construction?.requiredIncidenceMm, body.construction?.allowanceMm].filter(Number.isFinite);
  return Math.max((NOISE_RELATIVE[body.precision] ?? 1e-5) * size, ...audit.map(v => 4 * v));
}

// The seam of a full (closed) cylinder or cone face: the edge its one loop
// uses twice. build123d keeps the seam where the operand's surface has it
// (its XDirection), also after a Boolean; Bend's Boolean results rebuild such
// surfaces with the seam at their own reference direction. The shape session
// records, per Boolean result, the angle from Bend's seam to build123d's.
function seamEdgeOf(face) {
  if (!['cylinder', 'cone'].includes(face.surface.type)) return null;
  const counts = new Map();
  face.loops.flat().forEach(use => counts.set(use.edge, (counts.get(use.edge) ?? 0) + 1));
  const twice = [...counts].filter(([, count]) => count === 2).map(([edge]) => edge);
  return twice.length === 1 ? twice[0] : twice.length ? -1 : null;
}
const radialDirection = (point, surface) => {
  const axis = unit3(surface.axis), v = sub3(point, surface.origin);
  return unit3(sub3(v, scale(axis, dot(v, axis))));
};
const rotateAbout = (v, axis, angle) => {
  const k = unit3(axis), c = Math.cos(angle), s = Math.sin(angle), kv = dot(k, v), kxv = cross(k, v);
  return [0, 1, 2].map(i => v[i] * c + kxv[i] * s + k[i] * kv * (1 - c));
};
const signedAngle = (from, to, axis) => Math.atan2(dot(unit3(axis), cross(from, to)), dot(from, to));
// Every full curved face of a body: its index, surface, seam edge and Bend's seam direction.
function seamedFaces(body) {
  return body.faces.flatMap((face, index) => {
    const seam = seamEdgeOf(face);
    if (seam === null) return [];
    if (seam < 0) return [{ index, face, seam: null, direction: null }];
    return [{ index, face, seam, direction: radialDirection(body.vertices[body.edges[seam].start], face.surface) }];
  });
}

// Moves the seam of each full curved face of a Boolean result to build123d's
// (deltas: face index -> angle from Bend's seam about the surface axis, or null
// when no single operand fixes it). Exact only for a face bounded by its seam
// and closed circles on its axis (a hole, a coaxial wall); a face with other
// boundary edges would be split differently by build123d's seam, so its
// edges() is refused. An unknown seam of such a cylinder is flagged on its
// records ('seam: unknown'): lengths and keys along the axis stay exact.
function applySeams(body, records, deltas) {
  if (!deltas) return;
  const moved = new Map();
  const refuse = (face, detail) => unifyRefusal(`the seam of a full ${face.surface.type} face of this Boolean result ${detail}`);
  for (const { index, face, seam, direction } of seamedFaces(body)) {
    if (!deltas.has(index)) continue;
    const delta = deltas.get(index);
    if (delta !== null && Math.abs(Math.atan2(Math.sin(delta), Math.cos(delta))) <= 1e-12) continue;
    if (seam === null) refuse(face, 'is not one edge');
    const axis = unit3(face.surface.axis);
    const others = face.loops.length === 1 ? face.loops[0].filter(use => use.edge !== seam).map(use => use.edge) : null;
    const simple = others && new Set(others).size === others.length && others.every(e => {
      const edge = body.edges[e];
      return edge.start === edge.end && curveType(edge) === 'circle' && parallel3(edge.curve.normal, axis)
        && lineDistance(edge.curve.origin, face.surface.origin, axis) <= UNIFY_LINEAR_MM;
    });
    if (!simple) {
      refuse(face, delta === null
        ? 'lies where build123d\'s operands put it, and no single operand surface fixes it'
        : 'lies elsewhere in build123d (where the operand surface has it), and the face has boundary edges other than its end circles, which build123d\'s seam would split differently');
    }
    if (delta === null) {
      if (face.surface.type !== 'cylinder') refuse(face, 'lies where build123d\'s operands put it, and no single operand surface fixes it');
      for (const e of [seam, ...others]) Object.assign(records[e], { seam: 'unknown', seamAxis: axis });
      continue;
    }
    const target = rotateAbout(direction, axis, delta);
    const reseat = point => {
      const v = sub3(point, face.surface.origin), foot = [0, 1, 2].map(k => face.surface.origin[k] + axis[k] * dot(v, axis));
      return [0, 1, 2].map(k => foot[k] + norm(sub3(point, foot)) * target[k]);
    };
    const line = records[seam], start = reseat(line.start), end = reseat(line.end);
    Object.assign(records[seam], { start, end, direction: unit3(sub3(end, start)), length: norm(sub3(end, start)) });
    for (const e of others) {
      if (moved.has(e) && norm(sub3(moved.get(e), target)) > 1e-9) refuse(face, 'is claimed by two faces with different seams');
      moved.set(e, target);
      const circle = records[e], point = [0, 1, 2].map(k => circle.center[k] + circle.radius * target[k]);
      Object.assign(circle, { start: point, end: [...point], x: [...target] });
    }
  }
}

export function unifiedEdgeRecords(kernel, body, solid, seamDeltas) {
  const noise = coordinateNoise(body);
  const records = body.edges.map((edge, index) => ({ ...edgeRecord(kernel, body, edge, solid, index), noise }));
  applySeams(body, records, seamDeltas);
  const uses = body.edges.map(() => []);
  body.faces.forEach((face, f) => face.loops.forEach(loop => loop.forEach(use => uses[use.edge].push(f))));
  if (uses.some(u => u.length !== 2)) unifyRefusal('an edge does not bound exactly two face sides');
  const seamed = body.faces.map(() => false);
  uses.forEach(([a, b]) => { if (a === b) seamed[a] = true; });
  const parent = body.faces.map((_, i) => i);
  const find = i => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const removed = body.edges.map(() => false);
  body.edges.forEach((edge, e) => {
    const [a, b] = uses[e];
    if (a === b || !sameDomain(body.faces[a], body.faces[b])) return;
    if (body.faces[a].surface.type !== 'plane') {
      if (seamed[a] || seamed[b]) unifyRefusal(`Bend splits one full ${body.faces[a].surface.type} surface into several faces`);
      if (curveType(edge) !== 'circle') unifyRefusal(`Bend splits one ${body.faces[a].surface.type} surface along a ${curveType(edge)} edge`);
    }
    removed[e] = true;
    parent[find(a)] = find(b);
  });
  // Chains through vertices where exactly two kept, open edges meet on one
  // carrier curve and between the same two (merged) faces.
  const incident = new Map();
  body.edges.forEach((edge, e) => {
    if (removed[e]) return;
    for (const v of edge.start === edge.end ? [edge.start, edge.start] : [edge.start, edge.end]) incident.set(v, [...(incident.get(v) ?? []), e]);
  });
  const facePair = e => uses[e].map(find).sort((p, q) => p - q).join(',');
  const sameCarrier = (p, q) => {
    if (p.curve !== q.curve) return false;
    if (p.curve === 'line') return parallel3(p.direction, q.direction) && lineDistance(q.start, p.start, p.direction) <= UNIFY_LINEAR_MM
      && lineDistance(q.end, p.start, p.direction) <= UNIFY_LINEAR_MM;
    if (p.curve === 'circle') return norm(sub3(p.center, q.center)) <= UNIFY_LINEAR_MM && Math.abs(p.radius - q.radius) <= UNIFY_LINEAR_MM && parallel3(p.axis, q.axis);
    return unifyRefusal(`two ${p.curve} edges continue each other on one face boundary, and merging them is not implemented`);
  };
  const link = body.edges.map(() => []), linkedAt = new Set();
  for (const [vertex, list] of incident) {
    if (list.length !== 2 || list[0] === list[1]) continue;
    const [p, q] = list;
    if (body.edges[p].start === body.edges[p].end || body.edges[q].start === body.edges[q].end) continue;
    if (facePair(p) !== facePair(q) || !sameCarrier(records[p], records[q])) continue;
    link[p].push(q); link[q].push(p); linkedAt.add(vertex);
  }
  const seen = body.edges.map(() => false), out = [];
  body.edges.forEach((edge, e) => {
    if (removed[e] || seen[e]) return;
    if (!link[e].length) { seen[e] = true; out.push(records[e]); return; }
    const members = [], stack = [e];
    seen[e] = true;
    while (stack.length) { const m = stack.pop(); members.push(m); for (const n of link[m]) if (!seen[n]) { seen[n] = true; stack.push(n); } }
    // Chain ends: member end vertices where no link was made. None: a cycle,
    // whose seam OCCT would choose. Twice the same vertex: a full circle whose
    // seam is that remaining vertex (it has other edges).
    const ends = members.flatMap(m => [body.edges[m].start, body.edges[m].end]).filter(v => !linkedAt.has(v));
    // The Bend edges of the chain, for the blend request (not sent to Python).
    out.push(Object.defineProperty(mergedRecord(body, members.map(m => records[m]), ends), 'members', { value: members.sort((a, b) => a - b), enumerable: false }));
  });
  return out;
}

// Each handle owns already constructed and validated Bend B-reps. It never
// names an expression to evaluate later. A Boolean can own zero or more solids.
function shapeSession(kernel, fillet = null) {
  const shapes = new Map();
  let serial = 0;
  const get = handle => {
    if (typeof handle !== 'string' || !shapes.has(handle)) throw new PythonExecutionError('Unknown Bend shape handle');
    return shapes.get(handle);
  };
  const aligned = (dimensions, alignment) => {
    if (!Array.isArray(alignment) || alignment.length !== 3 || alignment.some(a => !['MIN', 'CENTER', 'MAX'].includes(a))) {
      capability('align requires Align.MIN, Align.CENTER or Align.MAX on each axis');
    }
    return dimensions.map((size, i) => -size * { MIN: 0, CENTER: 0.5, MAX: 1 }[alignment[i]]);
  };
  const save = bodies => {
    const handle = `shape-${++serial}`;
    shapes.set(handle, bodies);
    return handle;
  };
  // Bodies whose build123d topology Bend's body does not show (a circle
  // extruded with both=True: build123d fuses the two halves and keeps their
  // two cylindrical faces), and every body built from one. edges() refuses them.
  const unmatchedTopology = new WeakMap();
  const inherit = (sources, results) => {
    const reason = sources.map(body => unmatchedTopology.get(body)).find(Boolean);
    // Results that are operands unchanged (a disjoint union) keep their own state.
    if (reason) results.forEach(body => { if (!sources.includes(body)) unmatchedTopology.set(body, reason); });
    return results;
  };
  // Seams of full curved faces (applySeams): per Boolean result, face index ->
  // angle from Bend's seam to build123d's about the surface axis, or null when
  // unknown. A body without an entry (a primitive, an extrusion, a transform of
  // one) has build123d's seam itself. A rigid motion keeps the angles (both
  // seams move with the body); Boolean results take the seam of the operand
  // face on the same surface.
  const seamDeltas = new WeakMap();
  const trueSeams = body => seamedFaces(body).map(({ index, face, direction }) => {
    const deltas = seamDeltas.get(body), delta = deltas?.has(index) ? deltas.get(index) : 0;
    return { surface: face.surface, direction: direction && delta !== null ? rotateAbout(direction, face.surface.axis, delta) : null };
  });
  const seamed = (sources, results) => {
    const operands = sources.flatMap(trueSeams);
    for (const result of results) {
      if (sources.includes(result)) continue;
      const deltas = new Map();
      for (const { index, face, direction } of seamedFaces(result)) {
        const candidates = operands.filter(s => s.surface.type === face.surface.type && sameCurvedSurface(s.surface, face.surface));
        const agreed = candidates.length && candidates.every(s => s.direction && norm(sub3(s.direction, candidates[0].direction)) <= 1e-9);
        deltas.set(index, agreed && direction ? signedAngle(direction, candidates[0].direction, face.surface.axis) : null);
      }
      if (deltas.size) seamDeltas.set(result, deltas);
    }
    return results;
  };
  const moveSeams = (source, result) => {
    const deltas = seamDeltas.get(source);
    if (!deltas) return result;
    const kept = source.faces.length === result.faces.length && source.faces.every((face, i) => face.surface.type === result.faces[i].surface.type);
    seamDeltas.set(result, kept ? new Map(deltas) : new Map(seamedFaces(result).map(({ index }) => [index, null])));
    return result;
  };
  // A certified mesh (src/hybrid-mesh.mjs) has no exact faces to move in Bend.
  const place = (bodies, id, rows, offset) => bodies.map((body, i) => isMeshBody(body) ? refuseMeshBody(body, 'A rigid placement') : moveSeams(body, inherit([body], [(body.geometry === 'analytic' ? transformAnalytic : transformInBend)(
    kernel, body, `${id}/${i}`, rows, offset)])[0]));
  // Every edge of a built profile body must be longer than the body's own
  // tolerance (the STEP uncertainty it is exported with), or the exported solid
  // collapses; such a body is refused, never reported as built.
  const subTolerance = (detail, eps) => capability(`Extrusion of this profile is not implemented: ${detail}, at or below the ${eps.toExponential(3)} mm Bend resolves; build123d merges or rejects such sub-tolerance edges, and Bend has no 'sub-tolerance edge merge' operation`);
  const resolved = body => {
    const eps = body.validation?.toleranceMm;
    if (!Number.isFinite(eps)) return body;
    body.edges.forEach((edge, index) => {
      const radius = typeof edge.curve === 'object' ? edge.curve.radius : undefined;
      if (Number.isFinite(radius) && radius <= eps) subTolerance(`edge ${index} has radius ${radius.toExponential(3)} mm`, eps);
      if (edge.start === edge.end) return;
      const length = norm(sub3(body.vertices[edge.end], body.vertices[edge.start]));
      if (length <= eps) subTolerance(`edge ${index} is ${length.toExponential(3)} mm long`, eps);
    });
    return body;
  };
  // The Python frontend is strict (docs/python-frontend.md): a profile Bend only
  // builds after regularizing it (a vertex within the profile tolerance of the
  // line of its neighbours merged away, kernel PROFILE_MERGE.allowRegularized,
  // or a sketch frame projected orthogonal) is refused. build123d keeps such a
  // vertex as a real corner. Exactly collinear vertices merge in both.
  const exactProfile = (body, points) => {
    if (body.exactness !== 'regularized') return body;
    const merged = (body.construction?.profileMerge?.merged ?? []).filter(m => !m.exact);
    const detail = merged.length
      ? merged.map(m => `vertex ${m.index} (${points[m.index]?.join(', ')}) lies ${m.deviationMm.toExponential(3)} mm off the line of its neighbours`).join('; ')
      : 'the sketch frame is not orthogonal within the kernel budget';
    return capability(`Extrusion of this polygon is not implemented exactly: ${detail}, within the ${(body.construction?.profileMerge?.toleranceMm ?? 0).toExponential(3)} mm profile tolerance, so Bend would merge it (a regularized profile) while build123d keeps it; the 'near-collinear profile vertex' kernel support is missing`);
  };
  // build123d extrude(face, amount, dir, both): the prism of unit(dir or the
  // face normal) * amount; both=True fuses it with its mirror image, which is
  // the one prism from -amount to +amount (FeatureScript opExtrude with
  // startBound BLIND of the same depth).
  const extrudeProfile = (request, id) => {
    const plane = sketchPlane(request.plane), amount = finite(request.amount, 'extrude amount');
    if (typeof request.both !== 'boolean') throw new PythonExecutionError('extrude both must be a boolean');
    const direction = request.dir === null || request.dir === undefined ? plane.normal : unit(request.dir, 'extrude dir');
    const oblique = Math.abs(dot(direction, plane.normal)) < 1 - 1e-12;
    const delta = scale(direction, request.both ? amount + amount : amount), offset = request.both ? scale(direction, -amount) : [0, 0, 0];
    // std math.fs TOLERANCE.zeroLength; build123d fails too (BRepSweep_Translation).
    if (Math.abs(dot(delta, plane.normal)) <= 1e-5) throw new PythonExecutionError('Extrusion has zero or unresolved thickness normal to the sketch plane');
    const profile = request.profile ?? {};
    switch (profile.kind) {
      case 'polygon': {
        if (!Array.isArray(profile.points)) throw new PythonExecutionError('A polygon profile requires points');
        const points = profile.points.map(p => point2(p, 'Polygon point'));
        validatePolygon(points);
        const height = dot(delta, plane.normal);
        if (Math.abs(height) <= tolerance([...points, plane.origin, delta, offset])) throw new PythonExecutionError('Extrusion has zero or unresolved thickness normal to the sketch plane');
        // Same orientation rule as FeatureScript opExtrude (src/library.mjs body()).
        const oriented = signedArea(points) * height < 0 ? [...points].reverse() : points;
        return resolved(exactProfile(extrudeInBend(kernel, id, oriented, plane, delta, offset), points));
      }
      case 'circle': {
        if (oblique) capability('Oblique extrusion of a circle is not implemented: Bend has no elliptic-section cylinder (\'oblique circular extrusion\' kernel operation)');
        const radius = finite(profile.radius, 'Circle radius', true);
        if (radius <= 0.00001) throw new PythonExecutionError('Circle radius must be positive and resolvable');
        const body = resolved(circularFrustumInBend(kernel, id, { type: 'circle', center: point2(profile.center, 'Circle center'), radius, plane }, null, delta, offset));
        if (request.both) unmatchedTopology.set(body, 'build123d builds extrude(Circle, both=True) as the fusion of two extrusions and keeps their two cylindrical faces, the seam split and the circle between them (4 faces, 5 edges), where Bend builds one cylinder (3 faces, 3 edges)');
        return body;
      }
      case 'line-arc': {
        if (oblique) capability('Oblique extrusion of a line/arc profile is not implemented: Bend has no \'oblique line/arc extrusion\' kernel operation');
        if (!Array.isArray(profile.entities) || !profile.entities.length) throw new PythonExecutionError('A line/arc profile requires entities');
        if (profile.entities.length > SKETCH_ENTITY_LIMIT) capability(`A line/arc profile supports at most ${SKETCH_ENTITY_LIMIT} entities`);
        // SI coordinates as FeatureScript passes them (sketch-arcs.mjs): meters = mm / 1000.
        const meters = p => p.map(v => v / 1000);
        const entities = profile.entities.map((entity, index) => {
          if (!entity || !['line', 'arc'].includes(entity.type)) throw new PythonExecutionError('Line/arc profile entities must be lines or arcs');
          const start = point2(entity.start, 'Profile entity start'), end = point2(entity.end, 'Profile entity end');
          const mid = entity.type === 'arc' ? point2(entity.mid, 'Arc mid point') : undefined;
          return { id: `e${index}`, type: entity.type, index, start, end, startMeters: meters(start), endMeters: meters(end),
            ...(mid ? { mid, midMeters: meters(mid) } : {}), location: null };
        });
        // An entity shorter than the profile tolerance (the rule validatePolygon
        // applies to polygon edges) is not resolvable in Bend: build123d merges
        // it away (RectangleRounded with 2r within 1e-8 of a side) or fails.
        const eps = tolerance(entities.flatMap(entity => [entity.start, entity.end]));
        entities.forEach(entity => {
          const length = norm(sub3([...entity.end, 0], [...entity.start, 0]));
          if (length <= eps) subTolerance(`profile ${entity.type} ${entity.index} is ${length.toExponential(3)} mm long`, eps);
        });
        const native = solveSketchArcs(kernel.sketchArcs, entities);
        const source = { schema: 'wonky-line-arc-sketch/1', sketchId: `${id}/sketch`, entities, native,
          scope: 'Original line/arc entities of the build123d profile and native ordered analytic profile; no polygonal approximation.' };
        const body = extrudeSketchArcs(kernel.sketchArcs, kernel, native, id, plane, delta, offset);
        body.sketchProfile = structuredClone(source);
        identifySketchArcExtrusion(kernel, body, id, source, plane, delta, offset);
        return resolved(body);
      }
      default: throw new PythonExecutionError(`Unknown extrude profile kind '${profile.kind}'`);
    }
  };
  // A build123d Boolean with a compound (multi-solid) or empty operand, as
  // exact set identities over the binary Bend Boolean. A handle's solids never
  // share a face (a union that touches merges them into one), so:
  //   A ∪ B: every solid of B meets the components collected so far and merges
  //          with each one it touches (two union results mean "not touching");
  //   A − B: every solid of A minus every solid of B in turn;
  //   A ∩ B: ∪ ai ∩ bj over all pairs (the pairs are disjoint pieces).
  // Order, operand roles, the 1 µm separation skip and the resulting body order
  // follow FeatureScript's naryBoolean (src/library.mjs), so the same model
  // builds the same bodies in both frontends. Empty operands follow build123d
  // 0.13: x + ∅ = ∅ + x = x (as Part() + x), x − ∅ = x, and ∅ − x or ∩ with ∅
  // raise its ValueError.
  const compoundBoolean = (operation, first, second, id) => {
    let step = 0;
    const run = (a, b) => seamed([a, b], booleanInBend(kernel, a, b, operation, `${id}/~step${step++}`));
    if (operation === 'UNION') {
      let components = first.map((body, order) => ({ order, body }));
      second.forEach((next, i) => {
        let current = { order: first.length + i, body: next };
        const apart = [];
        for (const part of components) {
          if (separated(part.body, current.body)) { apart.push(part); continue; }
          const [keep, drop] = part.order < current.order ? [part, current] : [current, part];
          const results = run(keep.body, drop.body);
          if (results.length === 2) { apart.push(part); continue; }
          if (results.length !== 1) capability(`Bend union of two touching solids returned ${results.length} solids`);
          current = { order: keep.order, body: results[0] };
        }
        components = [...apart, current];
      });
      return components.sort((a, b) => a.order - b.order).map(component => component.body);
    }
    if (!first.length) throw new PythonExecutionError(`Cannot ${operation === 'SUBTRACTION' ? 'subtract shape from' : 'intersect shape with'} empty compound`);
    if (operation === 'INTERSECTION') {
      if (!second.length) throw new PythonExecutionError('Cannot intersect shape with empty compound');
      return first.flatMap(a => second.flatMap(b => separated(a, b) ? [] : run(a, b)));
    }
    const kept = [], split = [];
    for (const target of first) {
      let pieces = [target];
      for (const tool of second) pieces = pieces.flatMap(piece => separated(piece, tool) ? [piece] : run(piece, tool));
      // FeatureScript keeps the first piece in the target's place and appends the rest.
      if (pieces.length) { kept.push(pieces[0]); split.push(...pieces.slice(1)); }
    }
    return [...kept, ...split];
  };
  return {
    get,
    request(request) {
      const id = `python/${serial + 1}`;
      switch (request.op) {
        case 'box': {
          const [length, width, height] = xyz(request.dimensions, 'Box dimensions').map(n => finite(n, 'Box dimension', true));
          const origin = aligned([length, width, height], request.align);
          return save([extrudeInBend(kernel, id, [[0, 0], [length, 0], [length, width], [0, width]],
            { origin, normal: [0, 0, 1], x: [1, 0, 0] }, [0, 0, height], undefined, {primitive:'box'})]);
        }
        case 'cylinder': {
          const radius = finite(request.radius, 'Cylinder radius', true), height = finite(request.height, 'Cylinder height', true);
          const offset = aligned([2 * radius, 2 * radius, height], request.align);
          const origin = [offset[0] + radius, offset[1] + radius, offset[2]];
          return save([circularFrustumInBend(kernel, id, { center: [0, 0], radius,
            plane: { origin, normal: [0, 0, 1], x: [1, 0, 0] } }, null, [0, 0, height])]);
        }
        case 'translate': {
          const offset = xyz(request.offset, 'Pos translation');
          return save(place(get(request.handle), id, identity, offset));
        }
        case 'transform': {
          const rows = rigidRows(request.rows), offset = xyz(request.offset, 'Location translation');
          return save(place(get(request.handle), id, rows, offset));
        }
        case 'extrude_profile': return save([extrudeProfile(request, id)]);
        // build123d Cone(bottom_radius, top_radius, height, align): the frustum
        // aligned by its bounding box (2R x 2R x height, R the larger radius),
        // built as FeatureScript opLoft of two coaxial skCircle profiles.
        case 'frustum': {
          const r0 = finite(request.r0, 'Cone bottom radius'), r1 = finite(request.r1, 'Cone top radius'), height = finite(request.height, 'Cone height', true);
          if (r0 < 0 || r1 < 0 || (r0 === 0 && r1 === 0)) throw new PythonExecutionError('Cone radii must be non-negative and not both zero');
          if (r0 === 0 || r1 === 0) capability('Cone with a zero radius is not implemented: Bend has no \'frustum apex\' kernel operation (a cone that closes in a point)');
          if (r0 === r1) throw new PythonExecutionError('cone with two identic radii (build123d: Standard_Failure; use Cylinder)');
          const radius = Math.max(r0, r1), offset = aligned([2 * radius, 2 * radius, height], request.align);
          const bottom = [offset[0] + radius, offset[1] + radius, offset[2]], top = [bottom[0], bottom[1], bottom[2] + height];
          const circle = (origin, r) => ({ type: 'circle', center: [0, 0], radius: r, plane: { origin, normal: [0, 0, 1], x: [1, 0, 0] } });
          return save([circularFrustumInBend(kernel, id, circle(bottom, r0), circle(top, r1))]);
        }
        case 'boolean': {
          const first = get(request.left), second = get(request.right);
          if (!['UNION', 'SUBTRACTION', 'INTERSECTION'].includes(request.operation)) capability('Unknown Python Boolean operation');
          if (first.length === 1 && second.length === 1) {
            const result = seamed([first[0], second[0]], booleanInBend(kernel, first[0], second[0], request.operation, id));
            // Two union results mean the operands do not touch. The fused shape
            // then holds both solids unchanged, in operand order, as FeatureScript
            // opBoolean leaves disjoint tools untouched (ModelingContext.binaryBoolean).
            return save(inherit([...first, ...second], request.operation === 'UNION' && result.length === 2 ? [first[0], second[0]] : result));
          }
          return save(inherit([...first, ...second], compoundBoolean(request.operation, first, second, id)));
        }
        case 'bounds': {
          // build123d bounding_box() (optimal): the union of the solids' tight
          // bounds. An empty shape has none; null lets the Python side apply
          // build123d's empty BoundBox instead of the host inventing one.
          const boxes = get(request.handle).map(tightBounds);
          if (!boxes.length) return null;
          return { min: [0, 1, 2].map(k => Math.min(...boxes.map(box => box.min[k]))), max: [0, 1, 2].map(k => Math.max(...boxes.map(box => box.max[k]))) };
        }
        case 'edges': return get(request.handle).flatMap((body, solid) => {
          const reason = unmatchedTopology.get(body);
          if (reason) capability(`edges() of this body is not implemented: ${reason}; Bend's body does not show that topology`);
          return unifiedEdgeRecords(kernel, body, solid, seamDeltas.get(body));
        });
        case 'volume': {
          const volumes = get(request.handle).map(body => body.validation.volumeMm3);
          if (volumes.some(v => !Number.isFinite(v))) capability('Computed volume is not available for this shape');
          return volumes.reduce((sum, volume) => sum + volume, 0);
        }
        // build123d Shape protocol: bool() is "has a solid", len() the solid
        // count, iteration one handle per solid (sharing the solid, as build123d
        // shares the TShape). An empty Boolean result owns zero solids.
        case 'count': return get(request.handle).length;
        case 'solids': return get(request.handle).map(body => save([body]));
        // build123d Compound(children=[...]) of separate shapes: one handle on all
        // their solids, unfused and unchanged (no geometry is built).
        case 'compound': {
          if (!Array.isArray(request.handles) || request.handles.length < 2) throw new PythonExecutionError('compound requires two or more handles');
          return save(request.handles.flatMap(handle => get(handle)));
        }
        // build123d fillet/chamfer of solid edges (src/fillet-python.mjs).
        case 'blend': {
          const sources = get(request.handle);
          const results = pythonBlend({ kernel, native: fillet, bodies: sources, request, id,
            records: (body, solid) => unifiedEdgeRecords(kernel, body, solid, seamDeltas.get(body)),
            // python/_b3d_blend.py raises an ordinary failure as ValueError, as build123d does.
            failed: message => { throw new PythonExecutionError(message); }, capability });
          return save(seamed(sources, inherit(sources, results)));
        }
        case 'unsupported': capability(request.message || 'Unsupported build123d API'); break;
        default: capability(`Unsupported Python bridge request '${request.op}'`);
      }
    },
  };
}

// Exports (decision 13, 2026-09-24): build123d export_step()/export_stl()
// write their file at the call, from the Bend B-rep, with the exporters of
// bin/wonky.mjs (src/exporters.mjs toStep and toStl; curved bodies in an STL
// through src/print-mesh.mjs within the requested tolerance). The runner sends
// the path joined to Python's working directory, unnormalized, and the host
// resolves it as open() does, so the model can read the file back. A path outside the model's
// project directory (the nearest pyproject.toml root, else the model
// directory) or inside a read-only root is refused, latched like a capability
// error. Every written file is recorded with its path and SHA-256.
export class ExportRefusedError extends PythonExecutionError {
  constructor(message) { super(message); this.name = 'ExportRefusedError'; this.pythonType = 'PermissionError'; }
}
// An I/O failure Python would raise as that OSError subclass (not latched: the model may handle it).
const osError = (type, message) => Object.assign(new PythonExecutionError(message), { pythonType: type });

const REPO_DIR = fileURLToPath(new URL('../', import.meta.url));
// Corpus runs (scripts/corpus/run.mjs) execute a mirror of the corpus under
// tmp/corpus/src. The corpus itself (~/Workspace/cad) is read only for every
// run, whether the model runs from the mirror or from the corpus directly.
const CORPUS_MIRROR = join(REPO_DIR, 'tmp', 'corpus', 'src');
const corpusRoot = () => process.env.WONKY_CORPUS_ROOT ?? join(homedir(), 'Workspace', 'cad');
const inside = (path, root) => path === root || path.startsWith(root.endsWith(sep) ? root : root + sep);
// Read-only roots compare case-folded where volumes are usually case-insensitive
// (APFS, NTFS): refusing a case variant too is the safe direction.
const FOLD_CASE = process.platform === 'darwin' || process.platform === 'win32';
const insideReadOnly = (path, root) => FOLD_CASE ? inside(path.toLowerCase(), root.toLowerCase()) : inside(path, root);
// realpath(3) (not the JS realpathSync): it returns the on-disk case of every
// existing component and applies '..' after symlinks, as the OS does for open().
const realpath = realpathSync.native;
const realDirectory = directory => { try { return realpath(directory); } catch { return resolvePath(directory); } };
// The absolute path as open() resolves it: the existing prefix through
// symlinks and '..' in OS order, then the missing components. `missing` counts
// the components below the last existing directory (more than one: a directory is missing).
function openTarget(path) {
  let head = path;
  const rest = [];
  while (!existsSync(head) && dirname(head) !== head) { rest.unshift(basename(head)); head = dirname(head); }
  return { path: join(realpath(head), ...rest), missing: rest.length };
}
const realTarget = path => openTarget(resolvePath(path)).path;

/** The directory a model may write exports into: the nearest pyproject.toml root, else the model directory (python/runner.py project_roots). */
export function projectDirectory(filename) {
  if (typeof filename !== 'string' || !isAbsolute(filename)) return null;
  let modelDirectory;
  try {
    if (!statSync(filename).isFile()) return null;
    modelDirectory = dirname(realpath(filename));
  } catch { return null; }
  for (let directory = modelDirectory; ; directory = dirname(directory)) {
    try { if (statSync(join(directory, 'pyproject.toml')).isFile()) return directory; } catch { /* keep looking */ }
    if (dirname(directory) === directory) return modelDirectory;
  }
}

/**
 * Read-only roots that apply without being asked for: the corpus root
 * (~/Workspace/cad, and WONKY_CORPUS_ROOT when set), for every model, also one
 * run from the corpus directly. There is no opt-out.
 */
export function defaultReadOnlyRoots() {
  return [...new Set([join(homedir(), 'Workspace', 'cad'), corpusRoot()])];
}
const CORPUS_NOTE = ' (the corpus is never written: a corpus run executes the mirror under tmp/corpus/src; to export from a corpus model, run a copy outside the corpus)';

// Write the file through a fresh temporary file next to it, then rename it
// over the target (rename replaces a symlink at the target, never its
// destination). The temporary name is random and opened exclusively without
// following symlinks, so a model cannot plant a link at it.
const TEMPORARY_FLAGS = fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | (fsConstants.O_NOFOLLOW ?? 0);
function writeReplacing(target, bytes, where) {
  const temporary = join(dirname(target), `.${basename(target)}.${randomBytes(12).toString('hex')}.wonky-tmp`);
  let descriptor, created = false;
  try {
    descriptor = openSync(temporary, TEMPORARY_FLAGS, 0o666);
    created = true;
    for (let offset = 0; offset < bytes.length;) offset += writeSync(descriptor, bytes, offset, bytes.length - offset);
    closeSync(descriptor);
    descriptor = undefined;
    renameSync(temporary, target);
    created = false;
  } catch (error) {
    throw osError(error.code === 'EACCES' || error.code === 'EPERM' ? 'PermissionError' : 'OSError', `${where}: cannot write ${target}: ${error.message}`);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    if (created) rmSync(temporary, { force: true });
  }
}

// build123d writes binary STL unless ascii_format=True; the exporters write
// ASCII, re-encoded here facet by facet (float32, as every binary STL).
function binaryStl(ascii, header) {
  const facets = [];
  let facet = null;
  for (const line of ascii.split('\n')) {
    const words = line.trim().split(/\s+/);
    if (words[0] === 'facet') facet = [words.slice(2, 5).map(Number)];
    else if (words[0] === 'vertex') facet.push(words.slice(1, 4).map(Number));
    else if (words[0] === 'endfacet') {
      if (facet.length !== 4 || facet.flat().length !== 12 || !facet.flat().every(Number.isFinite)) throw new PythonExecutionError('Cannot re-encode the STL facet as binary');
      facets.push(facet);
    }
  }
  const buffer = Buffer.alloc(84 + 50 * facets.length);
  buffer.write(header.slice(0, 80), 0, 'latin1');
  buffer.writeUInt32LE(facets.length, 80);
  facets.forEach((values, i) => values.flat().forEach((value, k) => buffer.writeFloatLE(value, 84 + 50 * i + 4 * k)));
  return buffer;
}

function exportWriter({ kernel, version, filename, readOnlyRoots, files }) {
  const scope = projectDirectory(filename), realScope = scope && realDirectory(scope);
  const corpus = new Set(defaultReadOnlyRoots());
  const readOnly = readOnlyRoots.map(root => ({ root, lexical: resolvePath(root), real: realDirectory(root), note: corpus.has(root) ? CORPUS_NOTE : '' }));
  const source = typeof filename === 'string' && isAbsolute(filename) && existsSync(filename) ? realTarget(filename) : null;
  return (session, request) => {
    const kind = request.kind;
    if (!['export_step', 'export_stl'].includes(kind)) throw new PythonExecutionError(`Unknown export kind '${kind}'`);
    if (typeof request.path !== 'string' || !isAbsolute(request.path) || typeof request.requested !== 'string') {
      throw new PythonExecutionError(`${kind}(): the runner must send the requested and the absolute path`);
    }
    // request.path is the working directory joined with the requested path, not
    // normalized: 'link/../x' resolves through the symlink first, as open() does.
    const where = `${kind}('${request.requested}')`, lexical = resolvePath(request.path);
    const opened = openTarget(request.path), target = opened.path;
    for (const { root, lexical: rootPath, real, note } of readOnly) {
      if (insideReadOnly(target, real) || insideReadOnly(lexical, rootPath)) {
        throw new ExportRefusedError(`${where}: refusing to write ${target}: ${root} is read only for this run${note}`);
      }
    }
    if (!realScope) {
      throw new ExportRefusedError(`${where}: refusing to write ${target}: the model has no project directory (its source is not a file on disk), and wonky writes exports only inside the model's project directory`);
    }
    if (!inside(target, realScope)) {
      throw new ExportRefusedError(`${where}: refusing to write ${target}: it is outside the model's project directory ${realScope}`
        + ` (Python resolved '${request.requested}' against its working directory ${request.cwd ?? 'unknown'})`);
    }
    if (target === source) throw new ExportRefusedError(`${where}: refusing to overwrite the model's own source file ${target}`);
    if (opened.missing > 1) {
      throw osError('FileNotFoundError', `${where}: no such directory ${dirname(request.path)}; build123d does not create directories either`);
    }
    let parent;
    try { parent = statSync(dirname(target)); } catch {
      throw osError('FileNotFoundError', `${where}: no such directory ${dirname(target)}; build123d does not create directories either`);
    }
    if (!parent.isDirectory()) throw osError('NotADirectoryError', `${where}: ${dirname(target)} is not a directory`);
    if (existsSync(target) && statSync(target).isDirectory()) throw osError('IsADirectoryError', `${where}: ${target} is a directory`);
    const seen = new Set(), bodies = [];
    for (const handle of request.handles ?? []) for (const body of session.get(handle)) if (!seen.has(body)) { seen.add(body); bodies.push(body); }
    if (!bodies.length) throw new PythonExecutionError(`${where}: the shape has no solid bodies to write`);
    const model = { backend: { version }, bodies };
    let contents, details;
    if (kind === 'export_step') {
      contents = toStep(model, basename(target, extname(target)));
      details = { format: 'STEP', exporter: 'src/exporters.mjs toStep' };
    } else {
      const tolerance = request.options?.tolerance ?? 0.001, ascii = request.options?.ascii_format ?? false;
      if (typeof tolerance !== 'number' || !Number.isFinite(tolerance) || tolerance <= 0) throw new PythonExecutionError(`${where}: tolerance must be a finite positive number`);
      let text;
      if (bodies.every(body => body.geometry !== 'analytic')) {
        // Planar bodies: the B-rep's own facets, exact within any tolerance.
        text = toStl(model);
        details = { exporter: 'src/exporters.mjs toStl', mesh: 'exact-facets' };
      } else {
        const printed = toPrintStl(kernel, model, { deviationMm: tolerance });
        text = printed.stl;
        details = { exporter: 'src/print-mesh.mjs toPrintStl', mesh: 'print-mesh', deviationMm: tolerance,
          achievedDeviationMm: Math.max(...printed.manifest.bodies.map(body => body.achievedDeviationMm ?? 0)),
          angularTolerance: 'not applied (the print mesh bounds chord deviation only)' };
      }
      contents = ascii ? text : binaryStl(text, `wonky-kernel Bend ${version} ${basename(target)}`);
      details = { format: ascii ? 'STL (ASCII)' : 'STL (binary)', ...details };
    }
    const bytes = Buffer.isBuffer(contents) ? contents : Buffer.from(contents, 'utf8');
    writeReplacing(target, bytes, where);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    files.push({ kind, path: target, projectPath: relative(realScope, target), requested: request.requested, sha256, bytes: bytes.length,
      bodyIds: bodies.map(body => body.id), location: request.location ?? null, ...details });
    return { path: target, sha256, bytes: bytes.length };
  };
}

// cad_khana check()/inspect() (decision 12, docs/python-khana.md). Every call
// is a bridge request, decided here: the mode and the not-run record belong to
// the host, so a model cannot switch the checks off or rewrite what brep.json
// says about them. 'refuse' (default) is a capability error at the call;
// 'skip' records the call as not run and answers with a copy of the record.
const KHANA_SCOPE = "wonky's cad_khana provides the modeling API only (Assembly, with_part, with_subassembly, part names, colors and materials)";
const sourceSite = site => site && typeof site === 'object' && typeof site.file === 'string' && Number.isSafeInteger(site.line)
  ? { file: site.file, line: site.line, column: Number.isSafeInteger(site.column) ? site.column : null } : null;
function khanaCheckRecorder(mode, notRun) {
  return request => {
    const { call, what, arguments: args } = request;
    if (typeof call !== 'string' || !/^cad_khana(\.[A-Za-z_]\w*)+$/.test(call) || typeof what !== 'string'
      || !Array.isArray(args) || args.some(argument => typeof argument !== 'string')) {
      throw new PythonExecutionError('Invalid cad_khana check request from the Python runner');
    }
    if (mode !== 'skip') {
      throw new UnsupportedFeatureError(`${call}() is a cad_khana diagnostic that wonky does not provide: ${what}. ${KHANA_SCOPE}; `
        + 'bin/wonky-python.mjs --khana-checks=skip records the call as not run instead; see docs/python-khana.md');
    }
    const entry = { call, status: 'not-run', message: `cad_khana ${call.split('.').at(-1)}() not run: no wonky equivalent yet`,
      location: sourceSite(request.site) ?? sourceSite(request.location), arguments: [...args] };
    notRun.push(entry);
    return structuredClone(entry);
  };
}

// Result contract (python/_wonky_runtime.py resolves it): the runner reports
// one output per named handle, from `result`, `assembly` or the captured
// show/export calls. Each body appears once, under the first output that names
// it; later outputs of the same body list its id without duplicating it.
const appearanceOf = color => {
  if (color === null || color === undefined) return undefined;
  if (!Array.isArray(color) || ![3, 4].includes(color.length)) throw new PythonExecutionError('Invalid output color from the Python runner');
  const [red, green, blue, alpha] = color, channel = value => typeof value === 'number' && Number.isFinite(value);
  const appearance = { ...(channel(red) && channel(green) && channel(blue) ? { red, green, blue } : {}), ...(channel(alpha) ? { alpha } : {}) };
  return Object.keys(appearance).length ? appearance : undefined;
};

function collectOutputs(session, outputs) {
  if (!Array.isArray(outputs) || !outputs.length) throw new PythonExecutionError('The Python result contains no outputs');
  const named = new Map(), bodies = [], records = [];
  for (const output of outputs) {
    if (!output || typeof output !== 'object' || (output.name !== null && typeof output.name !== 'string')) {
      throw new PythonExecutionError('Invalid output record from the Python runner');
    }
    const own = session.get(output.handle), appearance = appearanceOf(output.color);
    const where = output.name ? `Output '${output.name}' (${output.kind})` : `The module-level '${output.kind}'`;
    if (!own.length) throw new PythonExecutionError(`${where} contains no solid bodies`, { line: output.location?.line });
    const bodyIds = own.map((body, index) => {
      if (!named.has(body)) {
        const name = output.name === null ? body.name : own.length > 1 ? `${output.name}[${index}]` : output.name;
        const copy = { ...body, ...(name ? { name } : {}), ...(appearance ? { appearance } : {}) };
        named.set(body, copy);
        bodies.push(copy);
      }
      return named.get(body).id;
    });
    records.push({
      kind: output.kind, name: output.name, bodyIds, location: output.location ?? null,
      ...(output.path !== undefined ? { path: output.path, written: !!output.file, ...(output.file ? { file: output.file } : {}) } : {}),
      ...(output.options?.length ? { ignoredOptions: output.options } : {}),
      ...(appearance ? { appearance } : {}),
    });
  }
  return { bodies, records };
}

/** Execute trusted local Python with the Bend-backed build123d Algebra shim. */
export async function buildPython(source, {
  filename = '<python>', python = 'python3', timeoutMs = 30000, maxRequests = 20000, trace = true, projectPath = true,
  cwd, khanaChecks = 'refuse', readOnlyRoots = [],
} = {}) {
  if (typeof source !== 'string') throw new TypeError('Python source must be a string');
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw new TypeError('timeoutMs must be a positive integer');
  if (!Number.isSafeInteger(maxRequests) || maxRequests <= 0) throw new TypeError('maxRequests must be a positive integer');
  if (typeof projectPath !== 'boolean') throw new TypeError('projectPath must be a boolean');
  if (!['refuse', 'skip'].includes(khanaChecks)) throw new TypeError("khanaChecks must be 'refuse' or 'skip'");
  if (!Array.isArray(readOnlyRoots) || readOnlyRoots.some(root => typeof root !== 'string' || !root)) throw new TypeError('readOnlyRoots must be an array of paths');
  if (cwd !== undefined && typeof cwd !== 'string') throw new TypeError('cwd must be a path');
  // The production fillet runs on the Bend JS target; the native and rust backends do not load it.
  const kernel = await loadKernel(), session = shapeSession(kernel, withoutBend(selectBackend()) ? null : await loadFilletProduction());
  const tracker=trace?pythonSourceTracker(source,filename):null;
  const { version } = JSON.parse(readFileSync(new URL('../bend.lock.json', import.meta.url), 'utf8'));
  const runner = fileURLToPath(new URL('../python/runner.py', import.meta.url));
  // The executed model text itself; project modules carry their own SHA-256 in `modules`.
  const sourceSha256 = createHash('sha256').update(source, 'utf8').digest('hex');
  // Files written by export_step()/export_stl(), in call order (build provenance).
  const writtenFiles = [];
  const writeExport = exportWriter({ kernel, version, filename, files: writtenFiles,
    readOnlyRoots: [...new Set([...defaultReadOnlyRoots(), ...readOnlyRoots])] });
  return new Promise((resolve, reject) => {
    // The protocol has private pipes; user print/input streams cannot be
    // mistaken for kernel requests. -I -S excludes user site-packages, PYTHON*
    // variables and installed packages; the runner itself puts the model
    // directory and project root on sys.path, like `python model.py`.
    const child = spawn(python, ['-I', '-S', '-B', '-u', runner], { stdio: ['ignore', 'pipe', 'pipe', 'pipe', 'pipe'], ...(cwd ? { cwd } : {}) });
    let stdout = '', stderr = '', outputBytes = 0, requests = 0, completion, failure, stickyCapability, closed = false;
    // Project-local modules (path + SHA-256) and the interpreter environment,
    // reported on success and on failure so reviews and watchers see them.
    let modules = [], environment = null;
    // cad_khana check()/inspect() calls recorded as not run (--khana-checks=skip), by the host only.
    const notRunChecks = [], khanaCheck = khanaCheckRecorder(khanaChecks, notRunChecks);
    const khanaRecord = () => khanaChecks === 'skip' ? { khanaChecks: { mode: 'skip', notRun: structuredClone(notRunChecks) } } : {};
    const abort = error => {
      failure ??= error;
      child.kill('SIGKILL');
    };
    const timer = setTimeout(() => abort(new PythonExecutionError(`Python execution exceeded ${timeoutMs} ms`)), timeoutMs);
    const capture = stream => chunk => {
      outputBytes += Buffer.byteLength(chunk);
      if (outputBytes > 1024 * 1024) return abort(new PythonExecutionError('Python output exceeded the 1 MiB limit'));
      if (stream === 'stdout') stdout += chunk; else stderr += chunk;
    };
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', capture('stdout'));
    child.stderr.on('data', capture('stderr'));
    child.on('error', error => { failure ??= new PythonExecutionError(`Cannot start Python '${python}': ${error.message}`); });
    child.stdio[3].on('error', error => { if (!closed) failure ??= new PythonExecutionError(`Python request pipe failed: ${error.message}`); });
    child.stdio[4].on('error', error => abort(new PythonExecutionError(`Python response pipe failed: ${error.message}`)));
    const lines = createInterface({ input: child.stdio[4], crlfDelay: Infinity });
    lines.on('line', line => {
      try {
        const message = JSON.parse(line);
        if (!message || typeof message !== 'object' || completion) throw new PythonExecutionError('Invalid Python bridge message');
        if (Array.isArray(message.modules)) modules = message.modules;
        if (message.environment) environment = message.environment;
        if (message.type === 'complete') {
          completion = {
            pythonVersion: message.pythonVersion, binding: message.binding, ignoredCaptures: message.ignoredCaptures ?? 0,
            assembly: message.assembly,
            ...collectOutputs(session, message.outputs),
          };
          return;
        }
        if (message.type === 'failure') {
          failure ??= new PythonExecutionError(`${message.error.type}: ${message.error.message}`, message.error);
          return;
        }
        if (message.type !== 'request' || !Number.isSafeInteger(message.id)) throw new PythonExecutionError('Invalid Python bridge request');
        if (++requests > maxRequests) return abort(new PythonExecutionError(`Python bridge exceeded ${maxRequests} requests`));
        let response;
        // Queries (volume, solid count, per-solid handles) build no geometry, so
        // they are no source-map operations and never re-attribute a body.
        const record = QUERY_OPS.has(message.op) ? null : tracker?.enter(message);
        try {
          if (stickyCapability) throw stickyCapability;
          const value = message.op === 'export_file' ? writeExport(session, message)
            : message.op === 'khana_check' ? khanaCheck(message) : session.request(message);
          tracker?.leave(record,{bodies:record?session.get(value):[]});
          response = { id: message.id, ok: true, value };
        } catch (error) {
          // Capability errors and refused export paths are latched: catching them in Python cannot turn the run into a success.
          if (error instanceof UnsupportedFeatureError || error instanceof ExportRefusedError) stickyCapability ??= error;
          if (message.location?.line && !error.line) {
            // 1-based column from co_positions (Python 3.11+); the use site names a
            // project-module frame when the construct was used there.
            error.line = message.location.line;
            error.column = message.location.column ?? 1;
            if (message.location.use) error.useSite = message.location.use;
          }
          tracker?.leave(record,{error});
          // A native-backend failure (bridge error, native/JS divergence) is not a
          // geometry error: it ends the run and never reaches Python code. Only
          // WONKY_BACKEND=native|diff can raise one.
          if (endsRun(error)) return abort(error);
          response = { id: message.id, ok: false, error: { type: error instanceof UnsupportedFeatureError ? 'UnsupportedFeatureError' : error.pythonType ?? 'GeometryError', message: error.message } };
        }
        child.stdio[3].write(JSON.stringify(response) + '\n');
      } catch (error) { abort(error); }
    });
    child.on('close', (code, signal) => {
      closed = true;
      clearTimeout(timer);
      lines.close();
      const error = stickyCapability ?? failure;
      if (error) {
        Object.assign(error, { stdout, stderr, sourceSha256, sourceFiles: modules, pythonEnvironment: environment, writtenFiles, ...khanaRecord() });
        if(tracker)error.modelTrace=tracker.report();
        reject(error); return;
      }
      if (code !== 0 || !completion) {
        reject(Object.assign(new PythonExecutionError(`Python exited ${signal ? `on ${signal}` : `with status ${code}`} without a completed result${stderr ? `: ${stderr.trim()}` : ''}`),
          { sourceSha256, sourceFiles: modules, pythonEnvironment: environment, writtenFiles }));
        return;
      }
      const { bodies } = completion;
      resolve({
        schema: 'wonky-brep/1', units: 'millimeter',
        backend: { language: 'Bend', version, ...backendInfo(kernel), precision: precisionForBodies(bodies) },
        source: {
          language: 'Python', api: 'build123d Algebra subset', filename, sha256: sourceSha256, pythonVersion: completion.pythonVersion,
          result: completion.binding, outputs: completion.records,
          ...(completion.ignoredCaptures ? { ignoredCaptures: completion.ignoredCaptures } : {}),
          ...(completion.assembly !== undefined ? { assembly: completion.assembly } : {}),
          modules, environment,
          ...(writtenFiles.length ? { writtenFiles } : {}),
          // Recorded, never evaluated: a skipped check is not a passed one.
          ...khanaRecord(),
        },
        bodies, execution: { stdout, stderr, requests },
        ...(tracker?{sourceMap:tracker.report()}:{}),
      });
    });
    child.stdio[3].write(JSON.stringify({ source, filename, projectPath }) + '\n');
  });
}
