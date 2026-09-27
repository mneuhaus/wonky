// Corpus failure analysis, cluster boolean-capability: the bake-off's
// all-Bend hybrid route (corefine mesh Boolean + recover exact B-rep, both
// prototypes in kernel/proto/, docs/proto-corefine.md, docs/proto-recover.md)
// as a synchronous, TEST-ONLY replacement for one refused binary opBoolean.
// Loaded only by scripts/corpus/boolean-hook-loader.mjs in the modes "hybrid"
// and "hybrid-all" (in-memory instrumentation of a probe process); never by
// the CLIs, never written into production.
//
//   1. both operands, in the kernel body format, are tessellated with face
//      tags by scripts/bakeoff/brep-tessellate.mjs, or where it refuses by the
//      production print mesh with face tags (deviation 0.01 mm);
//   2. the corefine native build (1 thread) computes the tagged mesh Boolean;
//   3. the recover native build turns job + mesh into an exact B-rep;
//   4. scripts/bakeoff/recover-brep.mjs decodes it into kernel bodies, and the
//      kernel's own validateAnalytic must accept every body.
// Any refusal on the way is returned with its stage and reason, so the caller
// can refuse explicitly (the production error message plus the hybrid's).
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tessellateBrep } from '../bakeoff/brep-tessellate.mjs';
import { resolveTransform, surfaceDistance, signedVolume } from '../bakeoff/tessellate.mjs';
import { encodeJob, decodeResult } from '../bakeoff/jobfmt.mjs';
import { decodeRecover, toBodies } from '../bakeoff/recover-brep.mjs';
import { validateAnalytic } from '../../src/analytic.mjs';
import { printMesh } from '../../src/print-mesh.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');
const WORK = path.join(ROOT, 'tmp/corpus/boolean-capability/hybrid', String(process.pid));
const BIN = proto => path.join(ROOT, `out/bakeoff/${proto}/build/cpu`);
const OPS = { UNION: 'union', SUBTRACTION: 'subtract', INTERSECTION: 'intersect' };
let serial = 0;

const unitv = a => { const n = Math.hypot(...a); return a.map(v => v / n); };
// Loops outer-first (recovered bodies keep the recover order and flag the
// outer loop instead); loop order carries no geometry.
function outerFirst(face) {
  if (!face.outer || face.outer.every((o, i) => o === (i === 0))) return face;
  const order = face.loops.map((_, i) => i).sort((i, j) => Number(face.outer[j]) - Number(face.outer[i]));
  return { ...face, loops: order.map(i => face.loops[i]), outer: order.map(i => face.outer[i]) };
}
// Polyhedral bodies (curve: 'line', implicit sameSense) in analytic notation;
// no coordinate changes.
export function analyticForm(body) {
  if (body.faces.some(f => f.outer)) body = { ...body, faces: body.faces.map(outerFirst) };
  if (!body.edges.some(e => typeof e.curve === 'string')) return body;
  return { ...body,
    edges: body.edges.map(e => typeof e.curve === 'string'
      ? { start: e.start, end: e.end, curve: { type: 'line', origin: body.vertices[e.start], direction: unitv(body.vertices[e.end].map((v, i) => v - body.vertices[e.start][i])) }, sameSense: true, ...(e.curveRange ? { curveRange: e.curveRange } : {}) }
      : e),
    faces: body.faces.map(f => ({ sameSense: true, ...f })) };
}

// Wire form of a kernel surface (scripts/bakeoff/recover-roundtrip.mjs wireSurface).
function wireSurface(s) {
  if (s.type === 'plane') return { type: 'plane', o: s.origin, n: s.normal, x: s.x };
  if (s.type === 'cylinder') return { type: 'cylinder', o: s.origin, n: s.axis, x: s.x, r: s.radius };
  if (s.type === 'cone') return { type: 'cone', o: s.origin, n: s.axis, x: s.x, r: s.radius, a: s.angle };
  throw new Error(`surface ${s.type} has no wire form`);
}
// A tagged leaf mesh: brep-tessellate first (the bake-off fixture tessellator),
// and where it refuses (e.g. two co-cylindrical faces sharing a circle, which
// the production coaxial arm emits) the production print mesh with face tags,
// welded by exact position as in scripts/bakeoff/recover-roundtrip.mjs.
function tagged(kernel, body) {
  try { const t = tessellateBrep(analyticForm(body), 0.01); return { ...t, via: 'brep-tessellate' }; }
  catch (first) {
    let mesh;
    try { mesh = printMesh(kernel, body, 0.01, { tags: true }); }
    catch (second) { throw new Error(`brep-tessellate: ${first.message}; print-mesh: ${second.message}`); }
    const index = new Map(), vertices = [];
    const vid = p => { const k = p.join(','); if (!index.has(k)) { index.set(k, vertices.length); vertices.push(p); } return index.get(k); };
    const triangles = mesh.triangles.map((t, i) => [...t.map(vid), mesh.tags[i]]);
    return { vertices, triangles, faces: body.faces.map((f, i) => ({ faceIndex: i, surface: wireSurface(f.surface) })), via: 'print-mesh' };
  }
}

export function hybridBoolean(kernel, a, b, operation, id) {
  const t0 = performance.now();
  let via = [];
  const done = extra => ({ ms: Math.round(performance.now() - t0), via, ...extra });
  const refuse = (stage, reason) => done({ refused: `${stage}: ${String(reason).slice(0, 200)}` });
  fs.mkdirSync(WORK, { recursive: true });
  const base = path.join(WORK, `${serial++}`);
  const faces = [], meshes = [], prims = []; let onSurface = 0;
  try {
    [a, b].forEach((body, leaf) => {
      const t = tagged(kernel, body);
      via.push(t.via);
      if (!(signedVolume(t.vertices, t.triangles) > 0)) throw new Error('tessellation is not outward-oriented');
      const tagOf = new Map(), surf = new Map(t.faces.map(f => [f.faceIndex, f.surface]));
      for (const f of t.faces) { tagOf.set(f.faceIndex, faces.length); faces.push({ leaf, faceIndex: f.faceIndex, surface: f.surface }); }
      for (const tri of t.triangles) for (const i of tri.slice(0, 3)) onSurface = Math.max(onSurface, surfaceDistance(surf.get(tri[3]), t.vertices[i]));
      meshes.push({ leaf, vertices: t.vertices, triangles: t.triangles.map(([p, q, r, f]) => [p, q, r, tagOf.get(f)]) });
      prims.push({ kind: 'brep', params: [], matrix: resolveTransform({}) });
    });
  } catch (error) { return refuse('tessellate', error.message); }
  const job = encodeJob({ id: `hybrid-${serial}`, deviation: 0.01, tree: { op: OPS[operation], children: [{ leaf: 0 }, { leaf: 1 }] }, prims, faces, meshes });
  fs.writeFileSync(`${base}.job`, job);
  const c = spawnSync(BIN('corefine'), ['--threads', '1', '--gpu', 'off', '--', `${base}.job`, `${base}.mesh`], { timeout: 120000 });
  if (c.status !== 0 || !fs.existsSync(`${base}.mesh`)) return refuse('corefine', c.error?.message ?? `exit ${c.status}`);
  const meshText = fs.readFileSync(`${base}.mesh`, 'utf8');
  const mesh = decodeResult(meshText);
  if (mesh.status !== 'ok') return refuse('corefine', mesh.reason);
  if (!mesh.mesh.triangles.length) return done({ bodies: [], onSurface });
  fs.writeFileSync(`${base}.recover`, job + meshText);
  const r = spawnSync(BIN('recover'), ['--threads', '1', '--gpu', 'off', '--', `${base}.recover`, `${base}.brep`], { timeout: 120000 });
  if (r.status !== 0 || !fs.existsSync(`${base}.brep`)) return refuse('recover', r.error?.message ?? `exit ${r.status}`);
  const text = fs.readFileSync(`${base}.brep`, 'utf8');
  const d = decodeRecover(text);
  if (d.status !== 'ok') return refuse('recover', d.reason);
  const bodies = toBodies(d.raw, id);
  if (bodies.some(x => x.voids)) return refuse('recover', 'void shells are outside the kernel body format');
  if (bodies.some(x => x.faces.some(f => !['plane', 'cylinder', 'cone'].includes(f.surface.type)))) return refuse('recover', 'sphere/torus faces are outside the kernel body format');
  try {
    for (const body of bodies) {
      body.validation = validateAnalytic(body, kernel);
      body.construction = { method: 'corpus hybrid probe: corefine mesh Boolean + recover (bake-off prototypes, not production)', operation };
    }
  } catch (error) { return refuse('validateAnalytic', error.message); }
  return done({ bodies, onSurface, triangles: mesh.mesh.triangles.length, stats: { corners: d.stats.corners, maxBoundaryDeviationMm: d.stats.maxBoundaryDeviationMm } });
}
