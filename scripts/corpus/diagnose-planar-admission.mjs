// Diagnose why the native planar Booleans reject their operands at admission
// (planar arrangement stage 1: InvalidTopology / UnsupportedArrangement /
// ResolutionLimit; convex-tool intersection: UnsupportedArrangement tool 0 face 0).
//
// Runs a FeatureScript file through the production build (src/index.mjs) and
// wraps, IN THIS PROCESS ONLY, kernel.planarBoolean.union/subtract and
// kernel.solidIntersection.intersect. Each wrapper evaluates the admission
// predicates of kernel/ports/planar-boolean.bend on both operands and then
// delegates to the unchanged native entry. Nothing in src/ or kernel/ changes.
//
// What-if simulations (diagnosis only, NOT production geometry; the proposed
// production fix must compute this in Bend, see docs/corpus/cluster-boolean-invalid-topology.md):
//   --simulate carriers   replace every planar face carrier of a Boolean operand by the
//                         plane through its own loop vertices (float64 Newell normal,
//                         serialized to F32x2), when those vertices are coplanar in float64.
//   --simulate transform  evaluate the polygonal rigid transform (kernel.transform, F32 in
//                         kernel/topology.bend) in float64, so rotated vertices stay coplanar.
//   Both: --simulate carriers,transform
//
// Usage: node scripts/corpus/diagnose-planar-admission.mjs <file.fs> [feature] [--simulate ...] [--dump <dir>]
// Prints one JSON line per wrapped call and one final line on stdout.
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { loadJsKernel, array, list } from '../../src/kernel.mjs';
import { real } from '../../src/real.mjs';

const args = process.argv.slice(2);
const take = name => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : null; };
const dump = take('--dump');
const simulate = new Set((take('--simulate') ?? '').split(',').filter(Boolean));
const [file, feature] = args;
const kernel = await loadJsKernel();
const pb = kernel.planarBoolean;
const toNumber = r => (r && typeof r === 'object' && 'hi' in r) ? r.hi + (r.lo ?? 0) : r;
const bool = b => b?.$ === 'True' ? true : b?.$ === 'False' ? false : b;
const v3 = v => [toNumber(v.x), toNumber(v.y), toNumber(v.z)];
const sub = (a, b) => a.map((x, i) => x - b[i]);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = a => { const l = Math.hypot(...a); return a.map(x => x / l); };
const V3 = ([x, y, z]) => ({ $: 'V3', x: real(x), y: real(y), z: real(z) });
let call = 0;

// Float64 face geometry (diagnosis only; every kernel decision stays in F32x2 Bend).
function loopPoints(face, vertices, edges) {
  const loop = array(array(face.loops)[0].uses);
  return loop.map(u => { const e = edges[u.edge]; return vertices[u.forward ? e.start : e.end]; });
}
function newell(pts) {
  let n = [0, 0, 0];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    n = [n[0] + (a[1] - b[1]) * (a[2] + b[2]), n[1] + (a[2] - b[2]) * (a[0] + b[0]), n[2] + (a[0] - b[0]) * (a[1] + b[1])];
  }
  return unit(n);
}
function faceGeometry(face, vertices, edges) {
  const pts = loopPoints(face, vertices, edges), n = newell(pts);
  const c = pts.reduce((s, p) => s.map((x, i) => x + p[i] / pts.length), [0, 0, 0]);
  const fitted = Math.max(...pts.map(p => Math.abs(dot(sub(p, c), n))));
  const sn = unit(v3(face.surface.normal)), so = v3(face.surface.origin);
  const stored = Math.max(...pts.map(p => Math.abs(dot(sub(p, so), sn))));
  return { vertices: pts.length, normal: sn.map(x => +x.toFixed(6)), axisAligned: sn.filter(x => Math.abs(x) > 1e-9).length === 1,
    storedResidual: stored, fittedResidual: fitted, angleToFitted: Math.acos(Math.min(1, Math.abs(dot(sn, n)))) };
}

function diagnose(solid, domains, tolerance) {
  const V = name => pb[`occt-planar.${name}`];
  const { edges, faces, vertices } = solid;
  const res = pb['curved-validate.resolution'](solid);
  const audit = pb['curved-validate.audit'](solid, domains, tolerance, pb.zero());
  const vs = array(vertices).map(v3), es = array(edges);
  const planar = array(faces).every(f => f.surface.$ === 'Plane');
  const perFace = planar ? array(faces).map((face, i) => ({ face: i, ...faceGeometry(face, vs, es),
    occtFace: bool(V('face_valid')(face, vertices, edges, domains, res)),
    auditFace: bool(pb['curved-validate.face_valid'](face, i >>> 0, vertices, edges, domains, tolerance, pb.zero(), res)),
    required: toNumber(pb['curved-validate.loops_required'](face.loops, face.surface, edges, domains, vertices)) })) : [];
  return {
    counts: { vertices: vs.length, edges: es.length, faces: array(faces).length },
    family: { lineEdges: bool(V('line_edges')(edges)), planeFaces: bool(V('plane_faces')(faces)), singleFaces: bool(V('single_faces')(faces)) },
    sourceSize: bool(pb.source_size(solid)),
    resolution: toNumber(res),
    occtPlanarValid: bool(V('valid')(solid, domains, res)),
    vertexLinks: bool(pb['curved-contact-topology.valid'](solid)),
    audit: { valid: bool(audit.valid), required: toNumber(audit.required), allowance: toNumber(audit.allowance), volume: toNumber(audit.volume) },
    faceCount: perFace.length,
    slantedFaces: perFace.filter(f => !f.axisAligned).length,
    badFaces: perFace.filter(f => !f.occtFace || !f.auditFace || f.required > toNumber(audit.allowance)),
  };
}

// --simulate carriers: exact plane through each face's own (coplanar) vertices.
function exactCarriers(solid) {
  const vs = array(solid.vertices).map(v3), es = array(solid.edges);
  const scale = Math.max(1, ...vs.map(p => Math.hypot(...p)));
  let replaced = 0;
  const faces = array(solid.faces).map(face => {
    if (face.surface.$ !== 'Plane' || array(face.loops).length !== 1) return face;
    const pts = loopPoints(face, vs, es);
    let n = newell(pts);
    if (dot(n, v3(face.surface.normal)) < 0) n = n.map(x => -x);
    const fitted = Math.max(...pts.map(p => Math.abs(dot(sub(p, pts[0]), n))));
    if (fitted > 1e-13 * scale) return face;
    let x = sub(pts[1], pts[0]); x = unit(sub(x, n.map(c => c * dot(x, n))));
    replaced++;
    return { ...face, surface: { $: 'Plane', origin: V3(pts[0]), normal: V3(n), x: V3(x) } };
  });
  return { solid: { ...solid, faces: list(faces) }, replaced };
}

function wrap(owner, name, label) {
  const original = owner[name];
  owner[name] = (a, ad, ab, b, bd, bb, tolerance, ...rest) => {
    const index = call++;
    let replaced = null;
    if (simulate.has('carriers')) {
      const ea = exactCarriers(a), eb = exactCarriers(b);
      a = ea.solid; b = eb.solid; replaced = [ea.replaced, eb.replaced];
    }
    const record = { call: index, op: label, first: diagnose(a, ad, tolerance), second: diagnose(b, bd, tolerance), ...(replaced ? { carriersReplaced: replaced } : {}) };
    const result = original(a, ad, ab, b, bd, bb, tolerance, ...rest);
    record.result = result.$ === 'Bodies' ? `Bodies(${array(result.bodies).length})` : { reason: result.reason?.$, stage: toNumber(result.stage), detail: toNumber(result.detail), tool: result.tool, face: result.face };
    console.log(JSON.stringify(record));
    if (dump) { mkdirSync(dump, { recursive: true }); writeFileSync(join(dump, `call${index}.json`), JSON.stringify({ a, ad, b, bd })); }
    return result;
  };
}
wrap(pb, 'union', 'union');
wrap(pb, 'subtract', 'subtract');
wrap(kernel.solidIntersection, 'intersect', 'convex-tool-intersection');
// The convex halfspace intersection is tried first for planar INTERSECTION.
{
  const original = kernel.halfspace.intersect;
  kernel.halfspace.intersect = (a, b, tolerance, ab, bb) => {
    if (simulate.has('carriers')) { a = exactCarriers(a).solid; b = exactCarriers(b).solid; }
    const result = original(a, b, tolerance, ab, bb);
    console.log(JSON.stringify({ call: call++, op: 'halfspace-intersection', result: result.$ }));
    return result;
  };
}

// --simulate transform: float64 rigid transform of polygonal (topology.bend) solids.
if (simulate.has('transform')) {
  const rotate = (p, r) => [0, 1, 2].map(i => r.x[i] * p[0] + r.y[i] * p[1] + r.z[i] * p[2]);
  const plain = v => [v.x, v.y, v.z];
  kernel.transform = (solid, rotation, offset) => {
    const r = { x: plain(rotation.x), y: plain(rotation.y), z: plain(rotation.z) }, o = plain(offset);
    const point = p => { const q = rotate(plain(p), r); return { $: 'V3', x: q[0] + o[0], y: q[1] + o[1], z: q[2] + o[2] }; };
    const direction = p => { const q = rotate(plain(p), r); return { $: 'V3', x: q[0], y: q[1], z: q[2] }; };
    return { ...solid, vertices: list(array(solid.vertices).map(point)),
      faces: list(array(solid.faces).map(f => ({ ...f, origin: point(f.origin), normal: direction(f.normal), x: direction(f.x) }))) };
  };
}

// --simulate linearc: build every polygon prism (skPolyline, rectangle and
// line-only sketches) with the existing native line/arc extruder
// (kernel/sketch-arcs.bend, F32x2, audited) instead of the F32 polygon
// extruder (kernel/topology.bend). Bodies then are analytic, so opTransform /
// opPattern also take the F32x2 analytic transform. This is the proposed
// production route, exercised with unchanged production kernel entries.
if (simulate.has('linearc')) {
  const { ModelingContext } = await import('../../src/library.mjs');
  const { solveSketchArcs, extrudeSketchArcs } = await import('../../src/sketch-arcs.mjs');
  ModelingContext.prototype.body = function (id, points, plane, delta, offset, loc) {
    const entities = points.map((p, i) => {
      const q = points[(i + 1) % points.length];
      return { type: 'line', index: i, id: `l${i}`, startMeters: p.map(v => v / 1000), endMeters: q.map(v => v / 1000) };
    });
    const profile = solveSketchArcs(this.kernel.sketchArcs, entities, loc);
    const body = extrudeSketchArcs(this.kernel.sketchArcs, this.kernel, profile, id.toString(), plane, delta, offset ?? [0, 0, 0], loc);
    this.addSolid(id, body);
  };
}

const { build } = await import('../../src/index.mjs');
const { normalizeModelingPolicy } = await import('../../src/modeling-policy.mjs');
const source = readFileSync(file, 'utf8');
const sibling = resolve(dirname(file), 'modules.json');
try {
  const model = await build(source, { feature: feature || undefined, parameters: {},
    moduleManifest: existsSync(sibling) ? sibling : undefined, sourcePath: resolve(file),
    modelingPolicy: normalizeModelingPolicy({ curvedContacts: 'strict' }) });
  const bodies = model.bodies ?? [];
  console.log(JSON.stringify({ ok: true, simulate: [...simulate], bodies: bodies.length,
    summary: bodies.map(b => ({ id: b.id, faces: b.faces?.length, volumeMm3: b.validation?.volumeMm3 ?? null })) }));
} catch (error) {
  const trace = error.modelTrace?.operations ?? [];
  const failed = [...trace].reverse().find(o => o.status === 'failed') ?? null;
  console.log(JSON.stringify({ ok: false, simulate: [...simulate], error: error.name, message: String(error.message).slice(0, 400),
    line: error.line, column: error.column, completed: trace.filter(o => o.status === 'completed').length,
    failedOperation: failed ? { name: failed.name, operationId: failed.operationId,
      callChain: (failed.callStack ?? []).map(f => `${f.name}@${f.calledAt?.line ?? '?'}:${f.calledAt?.column ?? '?'}`) } : null }));
}
