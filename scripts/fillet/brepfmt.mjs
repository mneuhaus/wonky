// Fillet harness TEST INFRASTRUCTURE: the job and result text format
// (docs/fillet/harness.md, "Job and result format"). Encoding and decoding
// only; no geometry is computed here.
//
// Every real is two decimal U32 words, the IEEE-754 bit patterns of
// hi = fround(x) and lo = fround(x − hi) (the Boolean bake-off's F32x2 wire
// format, scripts/bakeoff/jobfmt.mjs). The value is hi + lo.

import { decodeReal, encodeReal, quantize } from '../bakeoff/jobfmt.mjs';
import { checkBspline } from './bspline.mjs';

export const JOB_MAGIC = 'wonky-fillet-job 1';
export const CURVES = { line: 6, circle: 10, ellipse: 11 };
export const SURFACES = { plane: 9, cylinder: 10, cone: 11, sphere: 10, torus: 11 };
// Result-only format extension (docs/fillet/proto-rollingball.md, stage C2):
//   bspline <du> <dv> <nu> <nv> <nu+du+1 u-knots> <nv+dv+1 v-knots> <nu*nv poles>
// non-rational, clamped, poles u-major (pole (i, j) at i*nv + j). A face
// carrying it is an approximation and must state tol > 0 (validate.mjs).
export const EXTENDED_SURFACES = ['bspline'];
export const ROLES = ['support', 'blend', 'corner', 'cap'];
// Refusal classes a prototype may name (first word after `unresolved`).
export const REFUSALS = [
  'radius-too-large', // no ball of this radius fits the supports (theory §10.1)
  'face-consumed', // a support face would vanish (full round, theory §10.3)
  'overflow', // a contact leaves its face onto a neighbour (theory §10.3)
  'blend-overlap', // blends of the same call intersect (theory §10.4)
  'self-intersection', // the blend surface self-intersects (spindle/horn, theory §10.5)
  'mixed-convexity', // vertex with convex and concave blended edges (theory §6.5)
  'vertex-blend', // any other vertex configuration the prototype does not build
  'tangent-edge', // the selected edge is smooth or nearly so (theory §10.6)
  'unsupported-surface', // a support or blend surface type it cannot hold
  'unsupported-edge', // selection it cannot interpret (e.g. seam, non-manifold)
  'invalid-input', // the input body fails the prototype's own checks
  'sliver', // a face or edge narrower than the modelling tolerance 1e-6 mm would remain (fillet-plan §8 step 3); names the needed tolerance
  'undecidable', // a boundary decision inside its rounding allowance with no exact form (fillet-plan §8 step 3)
  'not-implemented', // anything else, named in the reason
];

const r = encodeReal;
const vec = (v) => v.map(r).join(' ');

function curveTokens(c) {
  if (c.type === 'line') return `line ${vec(c.origin)} ${vec(c.direction)}`;
  if (c.type === 'circle') return `circle ${vec(c.origin)} ${vec(c.normal)} ${vec(c.x)} ${r(c.radius)}`;
  if (c.type === 'ellipse') return `ellipse ${vec(c.origin)} ${vec(c.normal)} ${vec(c.x)} ${r(c.major)} ${r(c.minor)}`;
  throw new Error(`unknown curve ${c.type}`);
}

function surfaceTokens(s) {
  switch (s.type) {
    case 'plane': return `plane ${vec(s.origin)} ${vec(s.normal)} ${vec(s.x)}`;
    case 'cylinder': return `cylinder ${vec(s.origin)} ${vec(s.axis)} ${vec(s.x)} ${r(s.radius)}`;
    case 'cone': return `cone ${vec(s.origin)} ${vec(s.axis)} ${vec(s.x)} ${r(s.radius)} ${r(s.angle)}`;
    case 'sphere': return `sphere ${vec(s.origin)} ${vec(s.axis)} ${vec(s.x)} ${r(s.radius)}`;
    case 'torus': return `torus ${vec(s.origin)} ${vec(s.axis)} ${vec(s.x)} ${r(s.major)} ${r(s.minor)}`;
    case 'bspline': return `bspline ${s.du} ${s.dv} ${s.nu} ${s.nv} ${s.knotsU.map(r).join(' ')} ${s.knotsV.map(r).join(' ')} ${s.poles.map(vec).join(' ')}`;
    default: throw new Error(`unknown surface ${s.type}`);
  }
}

// body = {vertices, edges, faces} in the normalised analytic form
// (geom.mjs normaliseBody); result faces may carry role and tol.
export function encodeBrep(body, { result = false } = {}) {
  const L = [`brep ${body.vertices.length} ${body.edges.length} ${body.faces.length}`];
  for (const v of body.vertices) L.push(`v ${vec(v)}`);
  for (const e of body.edges) {
    const ranged = e.curveRange ? 1 : 0, [a, b] = e.curveRange ?? [0, 0];
    L.push(`e ${e.start} ${e.end} ${curveTokens(e.curve)} ${e.sameSense === false ? 0 : 1} ${ranged} ${r(a)} ${r(b)}`);
  }
  for (const f of body.faces) {
    const head = `f ${f.sameSense === false ? 0 : 1} ${surfaceTokens(f.surface)}`;
    const extra = result ? ` ${f.role ?? 'support'} ${r(f.tol ?? 0)}` : '';
    const loops = f.loops.map((l, i) => `l ${(f.outer?.[i] ?? i === 0) ? 1 : 0} ${l.length} ${l.map((u) => `${u.edge} ${u.forward ? 1 : 0}`).join(' ')}`);
    L.push(`${head}${extra} ${f.loops.length} ${loops.join(' ')}`);
  }
  return L;
}

export function encodeJob(job) {
  const L = [JOB_MAGIC, `case ${job.id}`, `op ${job.op}`, `size ${r(job.size)}`, `chamfer ${job.chamferType ?? 'none'}`, `propagate ${job.tangentPropagation ? 1 : 0}`];
  L.push(...encodeBrep(job.body));
  L.push(`select ${job.select.length}${job.select.length ? ' ' : ''}${job.select.join(' ')}`);
  L.push('end');
  return L.join('\n') + '\n';
}

export function encodeResult(res) {
  if (res.status === 'unresolved') {
    const reason = String(res.reason ?? '').replace(/\s+/g, ' ').trim();
    return `unresolved ${res.class ?? 'not-implemented'}${reason ? ` ${reason}` : ''}\nend\n`;
  }
  return ['ok', ...encodeBrep(res.body, { result: true }), 'end'].join('\n') + '\n';
}

// ---------------------------------------------------------------------------

class Tokens {
  constructor(text) {
    this.w = text.split(/\s+/).filter(Boolean);
    this.i = 0;
  }
  word() {
    if (this.i >= this.w.length) throw new Error('unexpected end of text');
    return this.w[this.i++];
  }
  peek() { return this.w[this.i]; }
  expect(x) {
    const g = this.word();
    if (g !== x) throw new Error(`expected '${x}', got '${g}' at token ${this.i - 1}`);
  }
  u32() {
    const g = this.word();
    if (!/^\d+$/.test(g)) throw new Error(`expected U32, got '${g}' at token ${this.i - 1}`);
    return Number(g);
  }
  bool() {
    const v = this.u32();
    if (v > 1) throw new Error(`expected 0/1, got ${v} at token ${this.i - 1}`);
    return v === 1;
  }
  real() {
    const hi = this.u32(), lo = this.u32();
    const x = decodeReal(hi, lo);
    if (!Number.isFinite(x)) throw new Error(`non-finite real at token ${this.i - 2}`);
    return x;
  }
  vec() { return [this.real(), this.real(), this.real()]; }
}

function readCurve(t) {
  const type = t.word();
  if (type === 'line') return { type, origin: t.vec(), direction: t.vec() };
  if (type === 'circle') return { type, origin: t.vec(), normal: t.vec(), x: t.vec(), radius: t.real() };
  if (type === 'ellipse') return { type, origin: t.vec(), normal: t.vec(), x: t.vec(), major: t.real(), minor: t.real() };
  throw new Error(`unknown curve '${type}'`);
}

function readSurface(t, result = false) {
  const type = t.word();
  if (type === 'plane') return { type, origin: t.vec(), normal: t.vec(), x: t.vec() };
  if (type === 'cylinder') return { type, origin: t.vec(), axis: t.vec(), x: t.vec(), radius: t.real() };
  if (type === 'cone') return { type, origin: t.vec(), axis: t.vec(), x: t.vec(), radius: t.real(), angle: t.real() };
  if (type === 'sphere') return { type, origin: t.vec(), axis: t.vec(), x: t.vec(), radius: t.real() };
  if (type === 'torus') return { type, origin: t.vec(), axis: t.vec(), x: t.vec(), major: t.real(), minor: t.real() };
  if (type === 'bspline' && result) {
    const du = t.u32(), dv = t.u32(), nu = t.u32(), nv = t.u32();
    if (!(du >= 1 && dv >= 1 && nu > du && nv > dv && nu * nv <= 1e6)) throw new Error(`bad bspline header ${du} ${dv} ${nu} ${nv}`);
    const knotsU = [], knotsV = [], poles = [];
    for (let i = 0; i < nu + du + 1; i++) knotsU.push(t.real());
    for (let i = 0; i < nv + dv + 1; i++) knotsV.push(t.real());
    for (let i = 0; i < nu * nv; i++) poles.push(t.vec());
    return checkBspline({ type, du, dv, nu, nv, knotsU, knotsV, poles });
  }
  throw new Error(`unknown surface '${type}'`);
}

function readBrep(t, { result }) {
  t.expect('brep');
  const nv = t.u32(), ne = t.u32(), nf = t.u32();
  const vertices = [], edges = [], faces = [];
  for (let i = 0; i < nv; i++) { t.expect('v'); vertices.push(t.vec()); }
  for (let i = 0; i < ne; i++) {
    t.expect('e');
    const start = t.u32(), end = t.u32(), curve = readCurve(t), sameSense = t.bool(), ranged = t.bool(), a = t.real(), b = t.real();
    const e = { start, end, curve, sameSense };
    if (ranged) e.curveRange = [a, b];
    edges.push(e);
  }
  for (let i = 0; i < nf; i++) {
    t.expect('f');
    const sameSense = t.bool(), surface = readSurface(t, result);
    const f = { surface, sameSense };
    if (result) {
      f.role = t.word();
      if (!ROLES.includes(f.role)) throw new Error(`face ${i}: unknown role '${f.role}'`);
      f.tol = t.real();
      if (!(f.tol >= 0)) throw new Error(`face ${i}: negative tolerance`);
    }
    const nl = t.u32();
    f.loops = [];
    f.outer = [];
    for (let k = 0; k < nl; k++) {
      t.expect('l');
      f.outer.push(t.bool());
      const n = t.u32(), uses = [];
      for (let j = 0; j < n; j++) uses.push({ edge: t.u32(), forward: t.bool() });
      f.loops.push(uses);
    }
    faces.push(f);
  }
  return { vertices, edges, faces };
}

export function decodeJob(text) {
  const t = new Tokens(text);
  t.expect('wonky-fillet-job');
  t.expect('1');
  t.expect('case');
  const id = t.word();
  t.expect('op');
  const op = t.word();
  if (op !== 'fillet' && op !== 'chamfer') throw new Error(`unknown op ${op}`);
  t.expect('size');
  const size = t.real();
  t.expect('chamfer');
  const chamferType = t.word();
  t.expect('propagate');
  const tangentPropagation = t.bool();
  const body = readBrep(t, { result: false });
  t.expect('select');
  const k = t.u32(), select = [];
  for (let i = 0; i < k; i++) select.push(t.u32());
  t.expect('end');
  return { id, op, size, chamferType, tangentPropagation, body, select };
}

// -> {status: 'ok', body} | {status: 'unresolved', class, reason}
export function decodeResult(text) {
  const nl = text.indexOf('\n');
  const first = (nl < 0 ? text : text.slice(0, nl)).trim();
  if (first.startsWith('unresolved')) {
    const rest = first.slice('unresolved'.length).trim();
    const [cls, ...words] = rest.split(/\s+/);
    if (text.slice(nl + 1).trim() !== 'end') throw new Error('unresolved result must end with a single `end` line');
    return { status: 'unresolved', class: cls || null, knownClass: REFUSALS.includes(cls), reason: words.join(' ') };
  }
  if (first !== 'ok') throw new Error(`bad status line '${first.slice(0, 80)}'`);
  const t = new Tokens(text.slice(nl + 1));
  const body = readBrep(t, { result: true });
  t.expect('end');
  if (t.i !== t.w.length) throw new Error('trailing tokens after end');
  return { status: 'ok', body };
}

// Largest change quantization makes to any real of a body (0 when it is
// already F32x2).
export function quantizationError(body) {
  let worst = 0;
  const see = (x) => { worst = Math.max(worst, Math.abs(quantize(x) - x)); };
  body.vertices.forEach((v) => v.forEach(see));
  for (const e of body.edges) {
    Object.values(e.curve).forEach((x) => (Array.isArray(x) ? x.forEach(see) : typeof x === 'number' && see(x)));
    e.curveRange?.forEach(see);
  }
  for (const f of body.faces) Object.values(f.surface).forEach((x) => (Array.isArray(x) ? x.forEach(see) : typeof x === 'number' && see(x)));
  return worst;
}
