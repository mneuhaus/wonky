// The production fillet and chamfer as a modeling operation (docs/fillet-plan.md
// §8 step 4), shared by the FeatureScript (opFillet/opChamfer, src/library.mjs)
// and the build123d (fillet/chamfer, src/python.mjs) frontends:
//   - blendJob: a host body and the selected edge indices -> the job text of
//     kernel/fillet (docs/fillet/harness.md "Job and result format"). The
//     encoding is scripts/fillet/brepfmt.mjs encodeJob on geom.mjs
//     normaliseBody, word for word (test/fs-fillet.test.mjs checks it against
//     the catalogue jobs); every real is written as F32x2 (hi = fround(x),
//     lo = fround(x - hi)), and the largest rounding this makes to the body is
//     reported (quantizationMm), never hidden;
//   - blendBody: runs the job in kernel/fillet/production.bend and returns the
//     produced body with the record (the deterministic stripe order and the
//     selection notes: "seam-ignored <edge>", "propagated <edge>"), or the
//     refusal, classified: `onshape` names the Onshape error of a refusal
//     Onshape raises for the same input too (an ordinary operation error, which
//     a try in the input catches); every other class is a capability refusal
//     (the input may well be one Onshape builds), which the frontends raise as
//     a capability error that no try catches.
// Nothing here computes geometry.
import { filletJob } from './fillet.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

// Opt-in BL0 census: write the input before running A so refusals and thrown
// capability errors retain their exact input. Never enabled in normal builds.
// Hex-encoded UTF-8 is collision-free even on case-insensitive filesystems.
export const blendCensusStem = id => Buffer.from(String(id), 'utf8').toString('hex');

function censusSink(id) {
  const dir = process.env.WONKY_BLEND_CENSUS_DIR;
  if (!dir) return null;
  mkdirSync(dir, { recursive: true });
  const stem = blendCensusStem(id);
  return (suffix, data) => writeFileSync(join(dir, `${stem}.${suffix}`), data, { flag: 'wx' });
}

export const BLEND_ENGINE = 'kernel/fillet (prototype A ported; exact analytic)';

// Refusal classes that are Onshape failures too, with the Onshape error.
// Measured: probe FP12 (hard-tangent-edge-selection-r1) fails in Onshape with
// FILLET_FAIL_SMOOTH, and A refuses it `tangent-edge` (docs/fillet-plan.md
// §1.2). No other class is probed as an Onshape failure: `radius-too-large`,
// `overflow` and the rest stay capability refusals until a probe shows
// Onshape failing on the same input.
export const ONSHAPE_FAILURES = Object.freeze({ 'tangent-edge': 'FILLET_FAIL_SMOOTH' });

const f32 = new Float32Array(1), u32 = new Uint32Array(f32.buffer);
const bits = x => { f32[0] = x; return u32[0]; };
function split(x) {
  if (!Number.isFinite(x)) throw new Error(`non-finite real ${x}`);
  if (x === 0) x = 0;
  const hi = Math.fround(x);
  return [hi, Math.fround(x - hi)];
}
const real = x => split(x).map(bits).join(' ');
const vec = v => v.map(real).join(' ');
const quantize = x => { const [hi, lo] = split(x); return hi + lo; };

function curveTokens(c) {
  if (c.type === 'line') return `line ${vec(c.origin)} ${vec(c.direction)}`;
  if (c.type === 'circle') return `circle ${vec(c.origin)} ${vec(c.normal)} ${vec(c.x)} ${real(c.radius)}`;
  if (c.type === 'ellipse') return `ellipse ${vec(c.origin)} ${vec(c.normal)} ${vec(c.x)} ${real(c.major)} ${real(c.minor)}`;
  throw new Error(`Fillet job: unknown curve ${c.type}`);
}
function surfaceTokens(s) {
  switch (s.type) {
    case 'plane': return `plane ${vec(s.origin)} ${vec(s.normal)} ${vec(s.x)}`;
    case 'cylinder': return `cylinder ${vec(s.origin)} ${vec(s.axis)} ${vec(s.x)} ${real(s.radius)}`;
    case 'cone': return `cone ${vec(s.origin)} ${vec(s.axis)} ${vec(s.x)} ${real(s.radius)} ${real(s.angle)}`;
    case 'sphere': return `sphere ${vec(s.origin)} ${vec(s.axis)} ${vec(s.x)} ${real(s.radius)}`;
    case 'torus': return `torus ${vec(s.origin)} ${vec(s.axis)} ${vec(s.x)} ${real(s.major)} ${real(s.minor)}`;
    default: throw new Error(`Fillet job: unknown surface ${s.type}`);
  }
}

// A host body in the job's form: a planar body's edges ('line' strings) become
// lines from start to end with the stated range [0, length] (geom.mjs
// normaliseBody). Returns null with the reason when the body has no exact
// B-rep the job can carry.
function jobBody(body) {
  if (body.geometry === 'mesh' || !Array.isArray(body.faces) || !Array.isArray(body.edges)) return { why: 'the body is not an exact B-rep (a certified mesh has no edges to blend)' };
  const sub = (a, b) => a.map((v, i) => v - b[i]);
  const edges = body.edges.map(e => {
    if (typeof e.curve === 'string') {
      if (e.curve !== 'line') return null;
      const a = body.vertices[e.start], d = sub(body.vertices[e.end], a), L = Math.hypot(...d);
      return { start: e.start, end: e.end, curve: { type: 'line', origin: a, direction: d.map(v => v * (1 / L)) }, sameSense: true, curveRange: [0, L] };
    }
    return { start: e.start, end: e.end, curve: e.curve, sameSense: e.sameSense !== false, ...(e.curveRange ? { curveRange: [...e.curveRange] } : {}) };
  });
  const bad = edges.findIndex(e => e === null || !['line', 'circle', 'ellipse'].includes(e.curve.type));
  if (bad >= 0) return { why: `edge ${bad} is a ${body.edges[bad].curve?.type ?? body.edges[bad].curve} curve, which the fillet job cannot carry` };
  const badFace = body.faces.findIndex(f => !['plane', 'cylinder', 'cone', 'sphere', 'torus'].includes(f.surface?.type));
  if (badFace >= 0) return { why: `face ${badFace} lies on a ${body.faces[badFace].surface?.type} surface, which the fillet job cannot carry` };
  return { body: { vertices: body.vertices, edges, faces: body.faces.map(f => ({ surface: f.surface, sameSense: f.sameSense !== false,
    loops: f.loops.map(l => l.map(u => ({ edge: u.edge, forward: u.forward !== false }))), outer: f.outer ?? f.loops.map((_, i) => i === 0) })) } };
}

function encodeJob({ id, op, size, chamferType, tangentPropagation, body, select }) {
  const L = ['wonky-fillet-job 1', `case ${id}`, `op ${op}`, `size ${real(size)}`, `chamfer ${chamferType ?? 'none'}`, `propagate ${tangentPropagation ? 1 : 0}`,
    `brep ${body.vertices.length} ${body.edges.length} ${body.faces.length}`];
  for (const v of body.vertices) L.push(`v ${vec(v)}`);
  for (const e of body.edges) {
    const [a, b] = e.curveRange ?? [0, 0];
    L.push(`e ${e.start} ${e.end} ${curveTokens(e.curve)} ${e.sameSense === false ? 0 : 1} ${e.curveRange ? 1 : 0} ${real(a)} ${real(b)}`);
  }
  for (const f of body.faces) {
    const loops = f.loops.map((l, i) => `l ${(f.outer?.[i] ?? i === 0) ? 1 : 0} ${l.length} ${l.map(u => `${u.edge} ${u.forward ? 1 : 0}`).join(' ')}`);
    L.push(`f ${f.sameSense === false ? 0 : 1} ${surfaceTokens(f.surface)} ${f.loops.length} ${loops.join(' ')}`);
  }
  L.push(`select ${select.length}${select.length ? ' ' : ''}${select.join(' ')}`, 'end');
  return L.join('\n') + '\n';
}

// Largest change the F32x2 wire makes to any real of the job body.
function quantization(body) {
  let worst = 0;
  const see = x => { worst = Math.max(worst, Math.abs(quantize(x) - x)); };
  const all = g => Object.values(g).forEach(x => (Array.isArray(x) ? x.forEach(see) : typeof x === 'number' && see(x)));
  body.vertices.forEach(v => v.forEach(see));
  for (const e of body.edges) { all(e.curve); e.curveRange?.forEach(see); }
  for (const f of body.faces) all(f.surface);
  return worst;
}

// { text, quantizationMm } | { why } for a body and the selected edge indices.
// The job id is a single token (the job grammar reads words).
export function blendJob({ id, op, size, chamferType, tangentPropagation, body, select }) {
  if (op !== 'fillet' && op !== 'chamfer') throw new Error(`Unknown blend op ${op}`);
  const input = jobBody(body);
  if (!input.body) return { why: input.why };
  const indices = [...new Set(select)].sort((a, b) => a - b);
  if (indices.some(i => !Number.isInteger(i) || i < 0 || i >= body.edges.length)) throw new Error('Blend selection names an edge the body does not have');
  const text = encodeJob({ id: String(id).replace(/\s+/g, '_') || 'blend', op, size, chamferType: op === 'chamfer' ? chamferType : 'none', tangentPropagation, body: input.body, select: indices });
  return { text, quantizationMm: quantization(input.body) };
}

// Runs one blend on one body. `native` is loadFilletProduction(), `kernel`
// adds Bend's incidence checks to the produced body (loadKernel()).
//   { status: 'ok', body, order, notes, quantizationMm }
//   { status: 'refused', class, reason, onshape?, order, notes }   A's typed refusal
//   { status: 'refused', class: 'unsupported-input', reason }       the body has no job form
export function blendBody(native, kernel, { id, op, size, chamferType = 'equal-offsets', tangentPropagation, body, select }) {
  const job = blendJob({ id, op, size, chamferType, tangentPropagation, body, select });
  const save = censusSink(id);
  if (save) {
    if (job.text) save('job', job.text);
    const incident = edge => body.faces.flatMap((face, index) => face.loops?.some(loop => loop.some(use => use.edge === edge))
      ? [{ index, surface: face.surface?.type,
        provenance: body.geometry === 'mesh' ? 'mesh'
          : body.provenance?.faces?.[index]?.sources?.length ? 'recovered analytic carrier' : 'analytic carrier (origin unverified)' }] : []);
    const selected = [...new Set(select)].sort((a, b) => a - b);
    const vertices = [...new Set(selected.flatMap(index => [body.edges[index]?.start, body.edges[index]?.end]))].filter(Number.isInteger);
    const metadata = { id: String(id), op, sizeMm: size, chamferType: op === 'chamfer' ? chamferType : null,
      selected, geometry: body.geometry ?? 'analytic', quantizationMm: job.quantizationMm ?? null,
      carrier: { validationScope: body.validation?.scope ?? null,
        recoveredFaceCount: body.provenance?.faces?.filter(face => face.sources?.length).length ?? 0,
        provenanceKind: body.provenance?.method ?? body.provenance?.source ?? null },
      unsupportedInput: job.why ?? null,
      edges: selected.map(index => ({ index, curve: body.edges[index]?.curve?.type ?? body.edges[index]?.curve,
        vertices: [body.edges[index]?.start, body.edges[index]?.end], supports: incident(index) })),
      corners: vertices.map(vertex => ({ vertex, selectedDegree: selected.filter(index => body.edges[index]?.start === vertex || body.edges[index]?.end === vertex).length,
        bodyDegree: body.edges.filter(edge => edge.start === vertex || edge.end === vertex).length })) };
    save('json', JSON.stringify(metadata, null, 2) + '\n');
  }
  if (!job.text) {
    const refusal = { status: 'refused', class: 'unsupported-input', reason: job.why, order: [], notes: [] };
    save?.('outcome.json', JSON.stringify(refusal, null, 2) + '\n');
    return refusal;
  }
  let out;
  try { out = filletJob(native, job.text, String(id), kernel); }
  catch (error) {
    save?.('outcome.json', JSON.stringify({ status: 'threw', message: error.message }, null, 2) + '\n');
    throw error;
  }
  const outcome = out.status === 'unresolved'
    ? { status: 'refused', class: out.class, reason: out.reason, ...(ONSHAPE_FAILURES[out.class] ? { onshape: ONSHAPE_FAILURES[out.class] } : {}), order: out.order, notes: out.notes }
    : { status: 'ok', body: out.body, order: out.order, notes: out.notes, quantizationMm: job.quantizationMm };
  save?.('outcome.json', JSON.stringify({ ...outcome, body: undefined }, null, 2) + '\n');
  return outcome;
}

// The message of a refusal, naming the operation, the class, A's reason and
// the record (selection order and notes), so the stripe order is visible in
// the error too.
export function refusalMessage(what, refusal) {
  const record = refusal.order?.length || refusal.notes?.length
    ? ` [order ${refusal.order.join(' ') || '-'}${refusal.notes.length ? `; ${refusal.notes.join('; ')}` : ''}]` : '';
  if (refusal.onshape) return `${what} failed: ${refusal.onshape} (${refusal.class}: ${refusal.reason})${record}`;
  return `${what} is not implemented for this input: ${refusal.class}: ${refusal.reason}${record}`;
}
