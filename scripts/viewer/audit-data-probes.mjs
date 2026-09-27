#!/usr/bin/env node
// Viewer data audit probes (docs/viewer/audit-data.md).
//
// Read-only evidence for what the model data and existing kernel functions
// already offer a viewer. Every geometric decision is made by existing Bend
// functions (ray.line_surface, solid-classification.membership, section);
// this script only builds sample models, calls those functions and tallies
// results. Nothing here is a viewer feature or a production code path.
//
// Usage: node scripts/viewer/audit-data-probes.mjs [--out out/viewer/audit-data/probes.json]
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { build } from '../../src/index.mjs';
import { array } from '../../src/kernel.mjs';
import { number, vector } from '../../src/real.mjs';
import { topologyReference, matchTopologyReference } from '../../src/identity.mjs';
import { loadRayKernel } from '../../src/ray.mjs';
import { loadSolidClassifier } from '../../src/solid-classification.mjs';
import { loadFaceClassifier, classificationInput } from '../../src/face-classification.mjs';
import { intersectionSurface, intersectionTolerance } from '../../src/intersections.mjs';
import { sectionSolid } from '../../src/section.mjs';
import { boundEdgePlaneBand } from '../../src/curve-band.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const samples = {
  bracket: 'examples/bracket.fs',
  'bored-spacer': 'examples/bored-spacer.fs',
  'arc-slot': 'scripts/viewer/audit-data/arc-slot.fs',
  'pocket-plate': 'scripts/viewer/audit-data/pocket-plate.fs',
  'cross-bore': 'scripts/viewer/audit-data/cross-bore.fs',
};
const groups = { face: 'faces', edge: 'edges', vertex: 'vertices' };
const report = { schema: 'wonky-viewer-data-audit/1', createdAt: new Date().toISOString(), probes: {} };
const emit = (probe, row) => { (report.probes[probe] ??= []).push(row); console.log(JSON.stringify({ probe, ...row })); };
const source = async name => readFile(resolve(root, samples[name]), 'utf8');
const built = new Map();
async function model(name) {
  if (!built.has(name)) built.set(name, await build(await source(name), { sourcePath: resolve(root, samples[name]) }));
  return built.get(name);
}

// 1. Cross-revision identity matching through the existing API only.
const edits = [
  ['arc-slot', 'depth 4 -> 6 mm', s => s.replace('"endDepth" : 4', '"endDepth" : 6')],
  ['arc-slot', 'right arc bulge 15 -> 17 mm', s => s.replace('vector(15, 0)', 'vector(17, 0)')],
  ['bracket', 'thickness 8 -> 12 mm', s => s.replace('"thickness" : 8 * millimeter', '"thickness" : 12 * millimeter')],
  ['pocket-plate', 'pocket 20 -> 22 mm wide', s => s.replace('vector(30, 22, 10)', 'vector(32, 22, 10)')],
  ['bored-spacer', 'bore radius 2 -> 2.5 mm', s => s.replace('"radius" : 2 * millimeter', '"radius" : 2.5 * millimeter')],
];
const nativeList = value => { const out = []; while (value?.$ === 'Con') { out.push(value.head); value = value.tail; } return out; };
// Output faces grouped by the semantic identities of their recorded input
// contributors. A group key is ancestry, not topological identity.
function ancestryKeys(body) {
  const history = body.operationHistory?.find(entry => entry.evidence?.frame?.id === body.construction?.frameId);
  const inputs = history?.evidence?.inputs ?? [];
  const key = ref => {
    const identity = inputs.find(input => input.operand === ref.operand)?.identity?.topology?.faces?.[ref.index];
    return identity && identity.stability !== 'revision-local' ? `${identity.originId}#${identity.instanceId}` : null;
  };
  return (body.construction?.faceOrigins ?? []).map(origin => {
    const keys = (origin.contributors ? nativeList(origin.contributors) : [origin]).map(key);
    return keys.every(Boolean) ? keys.sort().join('+') : null;
  });
}
for (const [name, label, edit] of edits) {
  const before = await model(name);
  const started = performance.now();
  const after = await build(edit(await source(name)), { sourcePath: resolve(root, samples[name]) });
  const rebuildMs = Math.round(performance.now() - started);
  const identity = {};
  for (const body of before.bodies) for (const [kind, group] of Object.entries(groups)) body[group].forEach((_, index) => {
    const status = matchTopologyReference(after.bodies, topologyReference(body, kind, index)).status;
    identity[`${kind}:${status}`] = (identity[`${kind}:${status}`] ?? 0) + 1;
  });
  const [a, b] = [before, after].map(m => ancestryKeys(m.bodies[0]));
  const count = keys => keys.reduce((map, key) => map.set(key, (map.get(key) ?? 0) + 1), new Map());
  const [ca, cb] = [count(a), count(b)];
  const ancestry = a.length ? { facesBefore: a.length, facesAfter: b.length, groupsBefore: ca.size, groupsAfter: cb.size,
    groupsMatched: [...ca.keys()].filter(key => key !== null && cb.has(key)).length } : null;
  emit('identity-matching', { model: name, edit: label, rebuildMs, identity, ancestry });
}

// 2. Edge classes for display, from exact data only.
const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
const sub = (a, b) => a.map((v, i) => v - b[i]);
const scale = (a, k) => a.map(v => v * k);
function outward(face, point, legacy) {
  const s = face.surface, sign = legacy || face.sameSense !== false ? 1 : -1;
  if (s.type === 'plane') return scale(s.normal, sign);
  if (s.type === 'cylinder') {
    const d = sub(point, s.origin), radial = sub(d, scale(s.axis, dot(d, s.axis)));
    return scale(radial, sign / Math.hypot(...radial));
  }
  return null;
}
function lineMidpoint(body, edge) {
  if (typeof edge.curve === 'object' && edge.curve.type !== 'line') return null;
  if (edge.curveRange && edge.curve.origin) {
    const t = (edge.curveRange[0] + edge.curveRange[1]) / 2;
    return edge.curve.origin.map((v, i) => v + edge.curve.direction[i] * t);
  }
  return scale(body.vertices[edge.start].map((v, i) => v + body.vertices[edge.end][i]), 0.5);
}
for (const name of Object.keys(samples)) {
  const body = (await model(name)).bodies[0], legacy = body.geometry !== 'analytic';
  const uses = body.edges.map(() => []);
  body.faces.forEach((face, f) => face.loops.forEach(loop => loop.forEach(use => uses[use.edge].push(f))));
  const classes = {};
  body.edges.forEach((edge, e) => {
    const [f0, f1] = uses[e];
    let kind;
    if (uses[e].length !== 2) kind = 'nonmanifold';
    else if (f0 === f1) kind = 'seam';
    else if (body.construction?.edgeOrigins?.[e]?.$ === 'FaceSubdivision') kind = 'subdivision';
    else {
      const p = lineMidpoint(body, edge), n0 = p && outward(body.faces[f0], p, legacy), n1 = p && outward(body.faces[f1], p, legacy);
      kind = !n0 || !n1 ? 'curved-edge-needs-bend-normal' : dot(n0, n1) > 1 - 1e-12 ? 'tangent' : 'sharp';
    }
    classes[kind] = (classes[kind] ?? 0) + 1;
  });
  emit('edge-classes', { model: name, edges: body.edges.length, faces: body.faces.length, classes });
}

// 3. Wall thickness along a ray: Bend roots on supporting surfaces, Bend trim
// membership per hit; the nearest resolved positive hit wins, any unresolved
// hit at or before it refuses the measurement.
const ray = await loadRayKernel(), solidClassifier = await loadSolidClassifier(), faceClassifier = await loadFaceClassifier();
function thickness(body, origin, direction, skipFace) {
  const { solid, domains, sourceBudget } = classificationInput(body, faceClassifier);
  const tolerance = intersectionTolerance(), length = Math.hypot(...direction), hits = [], unresolved = [];
  body.faces.forEach((face, index) => {
    if (index === skipFace) return;
    const roots = ray.line_surface(vector(origin), vector(direction), intersectionSurface(face.surface));
    if (roots.kind === 0) return;
    if (roots.kind !== 1) { unresolved.push({ face: index, rootKind: roots.kind }); return; }
    for (const t of array(roots.values).map(number)) {
      if (!(t > 1e-6)) continue;
      const point = origin.map((v, i) => v + direction[i] / length * t);
      const member = solidClassifier.membership(solid, index, domains, vector(point), tolerance, sourceBudget).$;
      if (member === 'FaceInside') hits.push({ face: index, t });
      else if (member !== 'FaceOutside') unresolved.push({ face: index, t, member });
    }
  });
  hits.sort((x, y) => x.t - y.t);
  const nearest = hits[0];
  const blocking = unresolved.filter(u => !nearest || u.t === undefined || u.t <= nearest.t + 1e-6);
  return blocking.length ? { status: 'unresolved', blocking } : nearest ? { status: 'measured', mm: nearest.t, face: nearest.face } : { status: 'no-hit' };
}
for (const [name, origin, direction, skip] of [
  ['bored-spacer', [2, 0, 5], [1, 0, 0], 2],
  ['bracket', [30, 6, 0], [0, 0, 1], 0],
  ['bracket', [30, 0, 4], [0, 1, 0], 2],
  ['bracket', [18, 0, 4], [0, 1, 0], null],
  ['arc-slot', [0, -5, 2], [0, 1, 0], 2],
  ['pocket-plate', [20, 15, 3], [0, 0, -1], null],
  ['cross-bore', [15, 0, 14], [0, 0, 1], 6],
]) {
  const started = performance.now(), result = thickness((await model(name)).bodies[0], origin, direction, skip);
  emit('thickness', { model: name, origin, direction, ms: Math.round(performance.now() - started), ...result });
}

// 4. Exact section contours for clipping outlines.
for (const [name, plane] of [
  ['bracket', { origin: [0, 0, 4], normal: [0, 0, 1] }],
  ['bracket', { origin: [18, 0, 0], normal: [1, 0, 0] }],
  ['bored-spacer', { origin: [0, 0, 5], normal: [0, 0, 1] }],
  ['arc-slot', { origin: [0, 0, 2], normal: [0, 0, 1] }],
  ['pocket-plate', { origin: [0, 0, 4.5], normal: [0, 0, 1] }],
  ['cross-bore', { origin: [15, 0, 0], normal: [1, 0, 0] }],
]) {
  const started = performance.now(), result = await sectionSolid((await model(name)).bodies[0], plane);
  emit('section', { model: name, plane, ms: Math.round(performance.now() - started), status: result.$,
    ...(result.$ === 'Resolved'
      ? { edges: array(result.edges).length, contours: array(result.contours).length, curves: [...new Set(array(result.edges).map(edge => edge.curve.$))] }
      : { reason: result.reason.$, face: result.reason.face ?? null }) });
}

// 5. What a failed build exposes to a live error panel.
const bored = await source('bored-spacer');
for (const [label, text] of [
  ['capability', bored.replace('BooleanOperationType.SUBTRACTION', 'BooleanOperationType.INTERSECTION')],
  ['syntax', bored.replace('skSolve(outer);', 'skSolve(outer')],
  ['runtime', bored.replace('"radius" : 2 * millimeter', '"radius" : -2 * millimeter')],
]) {
  try { await build(text, { sourcePath: resolve(root, samples['bored-spacer']) }); emit('failure', { label, unexpected: 'build succeeded' }); }
  catch (error) {
    const failed = error.modelTrace?.operations.find(op => op.status === 'failed');
    emit('failure', { label, errorName: error.name, message: error.message, line: error.line ?? null, column: error.column ?? null,
      tracedOperations: error.modelTrace?.operations.length ?? null,
      failedOperation: failed ? { sequence: failed.sequence, name: failed.name, operationId: failed.operationId, span: failed.source.span } : null,
      completedOperationEvidence: error.completedOperationEvidence?.length ?? null });
  }
}

// 6. Overhang from exact outward normals, build direction +Z, threshold 45 deg
// from vertical: overhanging where n.z < -sin(45 deg). Planar faces are exact.
// Cylinders get the exact angular band of their full surface; trims still
// decide which part of the band exists (not evaluated here).
const thresholdDeg = 45, limit = -Math.sin(thresholdDeg * Math.PI / 180);
for (const name of ['bracket', 'pocket-plate', 'cross-bore', 'arc-slot']) {
  const body = (await model(name)).bodies[0], legacy = body.geometry !== 'analytic';
  const minZ = Math.min(...body.vertices.map(v => v[2]));
  const faces = body.faces.map((face, index) => {
    const s = face.surface, sign = legacy || face.sameSense !== false ? 1 : -1;
    if (s.type === 'plane') {
      const nz = s.normal[2] * sign, offset = dot(s.origin, [0, 0, 1]);
      const kind = nz < limit ? (nz <= -1 + 1e-12 && Math.abs(offset - minZ) <= (body.validation.toleranceMm ?? 0) ? 'bed-candidate' : 'overhang') : 'ok';
      return { face: index, surface: 'plane', nz, kind };
    }
    if (s.type === 'cylinder') {
      // n(u) = sign * (cos u * x + sin u * y), y = axis x x; n.z = sign * R * cos(u - phi)
      const y = [s.axis[1] * s.x[2] - s.axis[2] * s.x[1], s.axis[2] * s.x[0] - s.axis[0] * s.x[2], s.axis[0] * s.x[1] - s.axis[1] * s.x[0]];
      const R = Math.hypot(s.x[2], y[2]), phi = Math.atan2(y[2], s.x[2]);
      if (R * 1 < -limit) return { face: index, surface: 'cylinder', kind: 'ok', note: 'axis within threshold of vertical; no overhang band' };
      const half = Math.acos(-limit / R), center = sign > 0 ? phi + Math.PI : phi;
      const deg = v => Number((((v * 180 / Math.PI) % 360 + 360) % 360).toFixed(6));
      return { face: index, surface: 'cylinder', kind: 'overhang-band', bandDeg: [deg(center - half), deg(center + half)],
        frame: 'u measured from surface.x toward axis x surface.x' };
    }
    return { face: index, surface: s.type, kind: 'not-evaluated-here' };
  });
  emit('overhang', { model: name, buildDirection: [0, 0, 1], thresholdDeg, faces: faces.filter(f => f.kind !== 'ok') });
}

// 7. Exact axis-aligned bounds from Bend edge/plane distance bands. On solids
// bounded by planes, cylinders and cones every directional extreme lies on an
// edge, so the edge bands bound the body. Useful where validation.boundsMm is
// null (through-hole pierce results, frozen imports).
for (const name of ['cross-bore', 'bored-spacer']) {
  const body = (await model(name)).bodies[0], started = performance.now();
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity], issues = [];
  for (let axis = 0; axis < 3; axis++) {
    const normal = [0, 0, 0]; normal[axis] = 1;
    for (let edge = 0; edge < body.edges.length; edge++) {
      const band = await boundEdgePlaneBand(body, edge, { type: 'plane', origin: [0, 0, 0], normal }, { contactTolerance: 1e-7 });
      if (band.$ !== 'Resolved') { issues.push({ edge, axis, status: band.$, reason: band.reason?.$ ?? null }); continue; }
      min[axis] = Math.min(min[axis], number(band.evidence.minimum.signed_distance));
      max[axis] = Math.max(max[axis], number(band.evidence.maximum.signed_distance));
    }
  }
  emit('edge-band-bounds', { model: name, recordedBoundsMm: body.validation.boundsMm ?? null,
    bandBoundsMm: issues.length ? null : { min, max }, issues, ms: Math.round(performance.now() - started) });
}

const out = process.argv.includes('--out') ? resolve(process.argv[process.argv.indexOf('--out') + 1]) : null;
if (out) { await mkdir(dirname(out), { recursive: true }); await writeFile(out, JSON.stringify(report, null, 2) + '\n'); console.log(out); }
