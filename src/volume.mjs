// Integrated volume of a B-rep body with a stated error bound
// (method and refusal codes: the header of kernel/volume.bend). This file
// only serializes the body: every face becomes its carrier plus its loops, each
// coedge carrying its edge's curve, end vertices, parameter range and
// direction. The one topological fact computed here is `whole`: a face all of
// whose edges it uses twice (seams only) is its entire closed carrier.
import { fail, unsupported } from './errors.mjs';
import { list } from './kernel.mjs';
import { real, number, vector } from './real.mjs';

// The quadrature tolerance per unit carrier measure. With 10-point
// Gauss-Legendre the accepted intervals land far below it, and the bound that
// is reported is the summed estimate, not this target.
export const VOLUME_TOLERANCE = 1e-13;
// The largest relative bound evVolume accepts. Above it the integration is
// refused by name instead of returning a value nobody can use.
export const VOLUME_RELATIVE_LIMIT = 1e-6;

const REFUSALS = {
  1: 'no candidate polar axis keeps both poles of a sphere face off its boundary',
  2: 'the area of a sphere face is within its bound of zero modulo the whole sphere (empty or whole region undecided)',
  3: 'a torus face on a spindle or horn torus (minor radius not below the major radius) is not implemented',
  4: 'a loop of a torus face winds around the tube without a seam',
  5: 'the parameter area of a torus face is within its bound of zero modulo the whole torus (undecided)',
  6: 'adaptive Gauss-Legendre quadrature did not reach its tolerance within 24 halvings',
};

const zero = [0, 0, 0];
const vec = (value, what) => {
  if (!Array.isArray(value) || value.length !== 3 || !value.every(Number.isFinite)) fail(`Volume integration: invalid ${what}`);
  return vector(value);
};
const num = (value, what) => {
  if (!Number.isFinite(value)) fail(`Volume integration: invalid ${what}`);
  return real(value);
};

export function surface(s, face) {
  const at = `face ${face}`;
  switch (s?.type) {
    case 'plane': return { $: 'Plane', origin: vec(s.origin, `${at} origin`), normal: vec(s.normal, `${at} normal`), x: vector(s.x ?? zero) };
    case 'cylinder': return { $: 'Cylinder', origin: vec(s.origin, `${at} origin`), axis: vec(s.axis, `${at} axis`), x: vector(s.x ?? zero), radius: num(s.radius, `${at} radius`) };
    case 'cone': return { $: 'Cone', origin: vec(s.origin, `${at} origin`), axis: vec(s.axis, `${at} axis`), x: vector(s.x ?? zero), radius: num(s.radius, `${at} radius`), angle: num(s.angle, `${at} angle`) };
    case 'sphere': return { $: 'Sphere', origin: vec(s.origin, `${at} centre`), axis: vector(s.axis ?? zero), x: vector(s.x ?? zero), radius: num(s.radius, `${at} radius`) };
    case 'torus': return { $: 'Torus', origin: vec(s.origin, `${at} centre`), axis: vec(s.axis, `${at} axis`), x: vec(s.x, `${at} seam direction`), major: num(s.major, `${at} major radius`), minor: num(s.minor, `${at} minor radius`) };
    default: return unsupported(`Volume integration over a '${s?.type}' face is not implemented`);
  }
}

function curve(c, edge) {
  const at = `edge ${edge}`;
  // A polyhedral body (src/kernel.mjs decodePrism) writes its edges as the
  // string 'line'; a line runs between its vertices either way.
  if (c === 'line' || c?.type === 'line') return { $: 'Line', origin: vector(zero), direction: vector(zero) };
  if (c?.type === 'circle') return { $: 'Circle', origin: vec(c.origin, `${at} centre`), normal: vec(c.normal, `${at} normal`), x: vec(c.x, `${at} x`), radius: num(c.radius, `${at} radius`) };
  if (c?.type === 'ellipse') return { $: 'Ellipse', origin: vec(c.origin, `${at} centre`), normal: vec(c.normal, `${at} normal`), x: vec(c.x, `${at} x`), major: num(c.major, `${at} major radius`), minor: num(c.minor, `${at} minor radius`) };
  return unsupported(`Volume integration along a '${c?.type ?? c}' edge is not implemented`);
}

const bool = value => value === true; // Bend Bool is a JS boolean

// Every edge of the face used exactly twice in it, once in each direction.
function wholeCarrier(face) {
  const uses = new Map();
  for (const loop of face.loops) for (const use of loop) {
    const seen = uses.get(use.edge) ?? [];
    seen.push(use.forward);
    uses.set(use.edge, seen);
  }
  return [...uses.values()].every(seen => seen.length === 2 && seen[0] !== seen[1]);
}

export function volumeInput(body) {
  if (!Array.isArray(body?.faces) || !Array.isArray(body.edges) || !Array.isArray(body.vertices)) fail('Volume integration needs a B-rep body');
  const vertices = body.vertices.map((p, i) => vec(p, `vertex ${i}`));
  const edges = body.edges.map((edge, i) => {
    if (!Number.isInteger(edge.start) || !Number.isInteger(edge.end) || !vertices[edge.start] || !vertices[edge.end]) fail(`Volume integration: edge ${i} has invalid vertices`);
    const range = edge.curveRange;
    if (range !== undefined && range !== null && !(Array.isArray(range) && range.length === 2 && range.every(Number.isFinite) && range[0] < range[1])) {
      fail(`Volume integration: edge ${i} has an invalid curveRange`);
    }
    return { curve: curve(edge.curve, i), start: vertices[edge.start], end: vertices[edge.end], closed: bool(edge.start === edge.end),
      sense: bool(edge.sameSense !== false), range: range ? { $: 'Span', first: real(range[0]), last: real(range[1]) } : { $: 'Free' } };
  });
  return list(body.faces.map((face, f) => {
    if (!Array.isArray(face.loops) || !face.loops.length) fail(`Volume integration: face ${f} has no loops`);
    const loops = face.loops.map(loop => list(loop.map(use => {
      const edge = edges[use.edge];
      if (!edge || typeof use.forward !== 'boolean') fail(`Volume integration: face ${f} has an invalid coedge`);
      return { $: 'Use', ...edge, forward: bool(use.forward) };
    })));
    return { $: 'VFace', surface: surface(face.surface, f), sense: bool(face.sameSense !== false), whole: bool(wholeCarrier(face)), loops: list(loops) };
  }));
}

const cache = new WeakMap();

// -> { volumeMm3, boundMm3, relativeBound, label: 'exact' | 'quadrature', ... }
// (a certified-mesh body: integrateMeshVolume, label 'carrier-quadrature' or
// 'mesh-estimate')
// or throws UnsupportedFeatureError naming the refusal. `label` is 'exact' only
// when every face was integrated in closed form (planes, cylinders, cones, and
// whole spheres or tori); the bound is stated either way.
export function integrateVolume(kernel, body, { tolerance = VOLUME_TOLERANCE, loc } = {}) {
  // A certified-mesh body has no exact loops: the carrier method below.
  if (body?.geometry === 'mesh') return integrateMeshVolume(kernel, body, { tolerance, loc });
  if (!kernel?.volume?.volume) unsupported('Volume integration (kernel/volume.bend) is not loaded in this kernel backend', loc);
  const cached = cache.get(body);
  if (cached && cached.tolerance === tolerance) return cached.result;
  const answer = kernel.volume.volume(volumeInput(body), real(tolerance));
  if (answer.$ === 'Refused') unsupported(`Volume integration refused face ${answer.face}: ${REFUSALS[answer.code] ?? `code ${answer.code}`}`, loc);
  if (answer.$ !== 'Measured') throw new Error('Unexpected volume integration answer');
  const volumeMm3 = number(answer.volume), boundMm3 = number(answer.bound);
  if (!Number.isFinite(volumeMm3) || !Number.isFinite(boundMm3)) unsupported('Volume integration produced a non-finite value', loc);
  const result = {
    volumeMm3, boundMm3, relativeBound: boundMm3 / Math.max(Math.abs(volumeMm3), Number.MIN_VALUE),
    label: answer.quadrature === 0 ? 'exact' : 'quadrature',
    method: answer.quadrature === 0 ? 'closed-form boundary integrals in Bend (kernel/volume.bend)'
      : 'boundary integrals in Bend (kernel/volume.bend): closed-form on plane, cylinder and cone faces, adaptive 10-point Gauss-Legendre on sphere and torus faces',
    faces: answer.faces, quadratureFaces: answer.quadrature, tolerance,
    boundRule: 'summed |G10(interval) - G10(halves)| of every accepted quadrature interval + 2^-38 x the summed face flux magnitudes (F32x2 arithmetic allowance); the body as represented, input vertex tolerances not included',
  };
  cache.set(body, { tolerance, result });
  return result;
}

// ---------------------------------------------------------------------------
// Certified-mesh bodies (src/hybrid-mesh.mjs; docs/hybrid-mesh-bodies.md)
//
// The carrier method: every face (patch) becomes its exact carrier bounded by
// the mesh boundary polyline, which Bend refines onto the exact curves
// (kernel/volume.bend MFace / Meet). This host code only walks topology:
// boundary half-edges (a triangle edge whose twin lies in another face),
// loops, the faces meeting at each boundary vertex, and a canonical order for
// every segment so both of its faces hand Bend the same piece.
const MESH_REFUSALS = {
  ...REFUSALS,
  7: 'Newton did not bring a boundary point within 1e-9 mm of both carriers of its segment',
  8: 'a boundary segment\'s exact curve turns more than 60 degrees away from its chord',
  9: 'a face without a boundary lies on a plane, cylinder or cone',
  10: 'the triangles of a face do not agree on a side of its carrier',
};

export function meshVolumeInput(body) {
  const { vertices, triangles } = body.mesh ?? {};
  if (!Array.isArray(vertices) || !Array.isArray(triangles)) fail('Volume integration needs the mesh of a certified-mesh body');
  const surfaces = body.faces.map((face, f) => surface(face.surface, f));
  // Twin of every directed edge -> the face on the other side.
  const faceAcross = new Map();
  for (const [a, b, c, f] of triangles) for (const [p, q] of [[a, b], [b, c], [c, a]]) faceAcross.set(`${p},${q}`, f);
  const boundary = body.faces.map(() => []); // per face: [from, to, other face]
  const facesAt = new Map(); // boundary vertex -> faces around it
  const touch = (v, f) => { let set = facesAt.get(v); if (!set) facesAt.set(v, set = new Set()); set.add(f); };
  for (const [a, b, c, f] of triangles) for (const [p, q] of [[a, b], [b, c], [c, a]]) {
    const other = faceAcross.get(`${q},${p}`);
    if (other === undefined) fail(`Volume integration: the mesh of body ${body.id} is not closed`);
    if (other === f) continue;
    boundary[f].push([p, q, other]);
    touch(p, f); touch(p, other); touch(q, f); touch(q, other);
  }
  const point = v => vec(vertices[v], `mesh vertex ${v}`);
  const carriersAt = new Map();
  const carriers = v => {
    if (!carriersAt.has(v)) carriersAt.set(v, list([...facesAt.get(v)].sort((x, y) => x - y).map(f => surfaces[f])));
    return carriersAt.get(v);
  };
  const curvedFace = s => s.$ === 'Sphere' || s.$ === 'Torus';
  return list(body.faces.map((_, f) => {
    // Loops: follow the boundary half-edges of f head to tail.
    const out = new Map();
    for (const edge of boundary[f]) { const list = out.get(edge[0]); if (list) list.push(edge); else out.set(edge[0], [edge]); }
    const used = new Set(), loops = [];
    for (const start of boundary[f]) {
      if (used.has(start)) continue;
      const loop = [];
      for (let edge = start; edge && !used.has(edge);) {
        used.add(edge); loop.push(edge);
        edge = (out.get(edge[1]) ?? []).find(next => !used.has(next));
      }
      if (loop.at(-1)[1] !== loop[0][0]) fail(`Volume integration: a boundary loop of face ${f} of body ${body.id} does not close`);
      loops.push(loop);
    }
    const meets = loops.map(loop => list(loop.map(([p, q, other]) => {
      const [a, b] = p < q ? [p, q] : [q, p], [f1, f2] = f < other ? [f, other] : [other, f];
      return { $: 'Meet', a: point(a), b: point(b), ca: carriers(a), cb: carriers(b), s1: surfaces[f1], s2: surfaces[f2], forward: p === a };
    })));
    const tris = curvedFace(surfaces[f]) ? triangles.filter(t => t[3] === f).map(([a, b, c]) => ({ $: 'Tri3', a: point(a), b: point(b), c: point(c) })) : [];
    return { $: 'MFace', surface: surfaces[f], tris: list(tris), whole: bool(!boundary[f].length), loops: list(meets) };
  }));
}

// The volume of a certified-mesh body: the carrier method (label
// 'carrier-quadrature'), else, if Bend refuses it, the mesh volume with
// +- area x deviation (label 'mesh-estimate'). Neither is ever 'exact'.
export function integrateMeshVolume(kernel, body, { tolerance = VOLUME_TOLERANCE, loc, fallback = true } = {}) {
  if (!kernel?.volume?.volume) unsupported('Volume integration (kernel/volume.bend) is not loaded in this kernel backend', loc);
  const cached = cache.get(body);
  if (cached && cached.tolerance === tolerance && cached.fallback === fallback) return cached.result;
  const deviationMm = body.mesh?.deviationMm;
  const answer = kernel.volume.volume(meshVolumeInput(body), real(tolerance));
  let result;
  if (answer.$ === 'Measured') {
    const volumeMm3 = number(answer.volume), boundMm3 = number(answer.bound);
    if (!Number.isFinite(volumeMm3) || !Number.isFinite(boundMm3)) unsupported('Volume integration produced a non-finite value', loc);
    result = { volumeMm3, boundMm3, relativeBound: boundMm3 / Math.max(Math.abs(volumeMm3), Number.MIN_VALUE), label: 'carrier-quadrature',
      method: 'carrier method in Bend (kernel/volume.bend): each face of the certified mesh on its exact carrier, its boundary polyline refined by Newton onto both carriers of every segment and integrated along the exact intersection curves (adaptive 10-point Gauss-Legendre)',
      faces: answer.faces, tolerance, deviationMm,
      boundRule: 'summed |G10(interval) - G10(halves)| + 2^-38 x summed face flux magnitudes + 2 L r (|p - c| + |p - anchor|) per boundary segment (r its largest carrier residual); the volume of the exact solid whose faces are the mesh patches on their carriers; the patch topology is corefine\'s (certificate: approximation.certificate), not bounded here' };
  } else if (answer.$ === 'Refused') {
    const refusal = `Volume integration refused face ${answer.face} of ${body.id}: ${MESH_REFUSALS[answer.code] ?? `code ${answer.code}`}`;
    if (!fallback) unsupported(refusal, loc);
    result = { ...meshEstimate(body), carrierRefusal: refusal };
  } else throw new Error('Unexpected volume integration answer');
  cache.set(body, { tolerance, fallback, result });
  return result;
}

// Mesh volume and area; the exact solid lies within the deviation of every
// mesh point on its carrier, so its volume differs by at most area x
// deviation (host arithmetic on the mesh's own coordinates, labelled).
export function meshEstimate(body) {
  const { vertices, triangles, deviationMm } = body.mesh;
  let volume = 0, area = 0;
  for (const [a, b, c] of triangles) {
    const p = vertices[a], q = vertices[b], r = vertices[c];
    volume += (p[0] * (q[1] * r[2] - q[2] * r[1]) - p[1] * (q[0] * r[2] - q[2] * r[0]) + p[2] * (q[0] * r[1] - q[1] * r[0])) / 6;
    const u = [q[0] - p[0], q[1] - p[1], q[2] - p[2]], v = [r[0] - p[0], r[1] - p[1], r[2] - p[2]];
    area += Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]) / 2;
  }
  const boundMm3 = area * deviationMm;
  return { volumeMm3: volume, boundMm3, relativeBound: boundMm3 / Math.abs(volume), label: 'mesh-estimate', areaMm2: area, deviationMm,
    method: 'signed volume of the certified mesh (host arithmetic on its coordinates)', boundRule: 'mesh area x deviation' };
}
