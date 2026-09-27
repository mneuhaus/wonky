#!/usr/bin/env node
// Metamorphic and regression harness of the hybrid Boolean (docs/hybrid-robust.md
// section 4, task B). TEST INFRASTRUCTURE: it computes no production geometry.
//
// Sources: the 35 frozen hybrid jobs of fixtures/r20/metamorphic/jobs (dumped
// with WONKY_HYBRID_DUMP from the R20 cases that refuse or wobble today;
// provenance.json). Every source is transformed on the job wire and run
// through a hybrid entry (kernel/hybrid/main.bend, the production entry by
// default), and every answer is judged:
//
//   exact on the wire   48 signed axis permutations (p0 = identity; odd ones
//                       reverse the triangle winding) and 2^k scalings
//                       (k in -3..3; every length word times 2^k, the job
//                       deviation too, directions and angles unchanged). Both
//                       words of an F32x2 Real map exactly, so the transformed
//                       job is exactly what the encoder would write for the
//                       transformed geometry (checkWire: identity byte-identical,
//                       inverse round trip byte-identical, every value exact).
//   inexact             translations t1e3 / t1e4 by s*(1.023123456789,
//                       -0.811987654321, 0.2475) mm (the CLI frames of
//                       scripts/r20/adversarial.mjs); every point is re-rounded
//                       to its nearest F32x2 value.
//
// Verdicts (judge): `exact` (a closed recovered B-rep whose volume, integrated
// in Bend by kernel/volume.bend, equals the source's reference volume times
// 2^3k), `mesh` (a certified mesh: watertight, consistently oriented, stating
// the job deviation, every vertex on the job's own input surface, volume equal
// to the manifold3d Boolean of the job's leaf meshes), `refused` (a named
// `unresolved <reason>`); a violation is `wrong` (a check failed), `crash` (the
// entry threw) or `malformed`. Never wrong = no violation. The verdict CLASS
// (exact | mesh | refused) must not depend on an exact transform.
//
// Tolerances, derived from corefine's own error model (docs/hybrid-robust.md
// 3/X4): S = max(1, largest |coordinate| of the job's leaf vertices) is the
// job scale corefine uses (weld.bend maxabs), eps = 2^-36 S its weld / collapse
// tolerance. A corefine vertex is an input vertex, a crossing constructed
// within ~2^-43 S, or moved by the short-edge collapse by at most eps, so it
// lies within DELTA = 2^-34 S (4 eps) of the input surface; volumes then agree
// within area x DELTA. An exact B-rep is within area x deviation of the mesh
// Boolean. The references (manifold3d oracle, exact volumes) are frozen in
// fixtures/r20/metamorphic/expect.json with their basis.
//
//   node scripts/r20/metamorphic.mjs sweep [--set all|perm|scale|translate|quick] [--sources a,b]
//        [--entry kernel/hybrid/main.bend] [--label prod] [--jobs 3] [--out <dir>]
//        -> <out>/results-*.jsonl (resumable), sweep.log, census.json, census.md, DONE
//   node scripts/r20/metamorphic.mjs census --out <dir>     re-judge a sweep's rows, rewrite the census
//   node scripts/r20/metamorphic.mjs wire [--sources a,b]    exactness of the transforms only (no Bend)
//   node scripts/r20/metamorphic.mjs baseline --out <dir>    write the production census into expect.json
//
// The default out dir is tmp/hybrid-robust/metamorphic/<label>. A sweep of a
// kernel that is being edited should use a snapshot (git archive HEAD kernel |
// tar -x -C <dir>; --entry <dir>/kernel/hybrid/main.bend): the closure digest of
// the entry is recorded, and a sweep never mixes rows of two closures.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const FIXTURES = path.join(ROOT, 'fixtures/r20/metamorphic');
export const DEFAULT_ENTRY = path.join(ROOT, 'kernel/hybrid/main.bend');
const SELF = fileURLToPath(import.meta.url);

// ---------------------------------------------------------------------------
// F32x2 words

const f32 = new Float32Array(1), u32 = new Uint32Array(f32.buffer);
export const toF = w => { u32[0] = Number(w) >>> 0; return f32[0]; };
const toW = f => { f32[0] = f; return u32[0]; };
const NEG_ZERO = 0x80000000;
// The encoder never writes a negative zero (src/hybrid.mjs encodeReal).
const canon = w => (w === NEG_ZERO ? 0 : w);
const negW = w => canon((w ^ NEG_ZERO) >>> 0);
class InexactTransform extends Error {}
function scaleW(w, k) {
  const f = toF(w);
  if (f === 0 || !k) return w;
  const g = f * 2 ** k;
  if (!Number.isFinite(g) || Math.fround(g) !== g || Math.abs(g) < 2 ** -126) throw new InexactTransform(`word ${w} (${f}) times 2^${k} is not an F32 value`);
  return canon(toW(g));
}
export const value = (hi, lo) => toF(hi) + toF(lo);
// The nearest F32x2 value of a double (hi = fround(y), lo = fround(y - hi)).
function encodeDouble(y) {
  if (!Number.isFinite(y)) throw new InexactTransform(`non-finite coordinate ${y}`);
  if (y === 0) return [0, 0];
  const hi = Math.fround(y), lo = Math.fround(y - hi);
  return [canon(toW(hi)), canon(toW(lo))];
}

// ---------------------------------------------------------------------------
// Frames

const AXES = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
// Index = 8 * axis order + sign pattern (bit i negates new axis i); the same
// numbering as the diagnosis harness (tmp/hybrid-robust/diag-numerics/permute.mjs).
export const PERMUTATIONS = AXES.flatMap(p => Array.from({ length: 8 }, (_, s) => ({ p, signs: [0, 1, 2].map(i => (s >> i) & 1) })));
const farT = s => [s * 1.023123456789, -s * 0.811987654321, s * 0.2475];
export const TRANSLATIONS = { t1e3: farT(1e3), t1e4: farT(1e4) };
// Eight permutations spread over all six axis orders, both parities and all
// sign counts; the scaled, translated and quick sets use them.
export const SPREAD = [0, 7, 13, 18, 26, 29, 35, 44];
export const SCALES = [-3, -2, -1, 1, 2, 3];
export const SETS = {
  perm: PERMUTATIONS.map((_, i) => `p${i}`),
  scale: SPREAD.flatMap(i => SCALES.map(k => `p${i}s${k}`)),
  translate: SPREAD.flatMap(i => Object.keys(TRANSLATIONS).map(t => `p${i}${t}`)),
  // npm test: 8 permutations x 2 scalings (2^0 and 2^+-3).
  quick: SPREAD.flatMap((i, n) => [`p${i}`, `p${i}s${n % 2 ? -3 : 3}`]),
};
SETS.all = [...SETS.perm, ...SETS.scale, ...SETS.translate];

const parity = p => { let s = 0; for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) if (p[i] > p[j]) s ^= 1; return s; };

export function frame(name) {
  const m = /^p(\d+)(?:s(-?\d+))?(t1e3|t1e4)?$/.exec(name);
  if (!m || Number(m[1]) >= PERMUTATIONS.length) throw new Error(`metamorphic: unknown frame '${name}'`);
  const { p, signs } = PERMUTATIONS[Number(m[1])], k = m[2] ? Number(m[2]) : 0, T = m[3] ? TRANSLATIONS[m[3]] : null;
  if (k < -3 || k > 3) throw new Error(`metamorphic: scaling 2^${k} is outside -3..3`);
  return { name, index: Number(m[1]), p, signs, k, T, exact: !T, kind: T ? 'translate' : k ? 'scale' : 'perm',
    flip: (parity(p) + signs[0] + signs[1] + signs[2]) % 2 === 1 };
}
export const isIdentity = fr => fr.index === 0 && !fr.k && !fr.T;
// new[i] = s_i old[p[i]] 2^k  =>  old[j] = s_i new[i] 2^-k with p[i] = j.
export function inverse(fr) {
  if (fr.T) throw new Error('metamorphic: a translation frame is not inverted on the wire');
  const p = [0, 0, 0], signs = [0, 0, 0];
  fr.p.forEach((j, i) => { p[j] = i; signs[j] = fr.signs[i]; });
  return { ...fr, name: `inverse(${fr.name})`, p, signs, k: -fr.k };
}

// ---------------------------------------------------------------------------
// The job wire (docs/bakeoff.md "Job format"; src/hybrid.mjs encodeJob)

// Surface layouts (scripts/bakeoff/jobfmt.mjs surfaceReals): v point, d direction, r length, a angle.
const LAYOUT = { plane: 'vdd', cylinder: 'vddr', cone: 'vddra', sphere: 'vr', torus: 'vdrr' };
const IDENTITY_PRIM = `prim brep 0 ${[1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0].map(x => (x ? '1065353216 0' : '0 0')).join(' ')}`;

function mapPoint(w, fr) {
  const out = [];
  for (let i = 0; i < 3; i++) {
    let hi = w[2 * fr.p[i]], lo = w[2 * fr.p[i] + 1];
    if (fr.signs[i]) { hi = negW(hi); lo = negW(lo); }
    if (fr.k) { hi = scaleW(hi, fr.k); lo = scaleW(lo, fr.k); }
    if (fr.T) [hi, lo] = encodeDouble(value(hi, lo) + fr.T[i]);
    out.push(hi, lo);
  }
  return out;
}
function mapDirection(w, fr) {
  const out = [];
  for (let i = 0; i < 3; i++) {
    let hi = w[2 * fr.p[i]], lo = w[2 * fr.p[i] + 1];
    if (fr.signs[i]) { hi = negW(hi); lo = negW(lo); }
    out.push(hi, lo);
  }
  return out;
}
const mapLength = (w, fr) => [scaleW(w[0], fr.k), scaleW(w[1], fr.k)];
const words = s => s.split(' ').map(x => { if (!/^\d+$/.test(x)) throw new Error(`metamorphic: expected a U32 word, got '${x}'`); return Number(x); });

// The job text of `text` in frame fr. Throws InexactTransform if an exact
// frame would round, and refuses a job it cannot map (non-brep primitives).
export function transformJob(text, fr) {
  const lines = text.split('\n'), out = [];
  let mode = null, left = 0, tris = 0;
  for (const line of lines) {
    if (mode === 'v') {
      out.push(mapPoint(words(line), fr).join(' '));
      if (--left === 0) mode = tris ? 't' : null;
      continue;
    }
    if (mode === 't') {
      const [a, b, c, tag] = line.split(' ');
      out.push(fr.flip ? `${a} ${c} ${b} ${tag}` : line);
      if (--tris === 0) mode = null;
      continue;
    }
    const head = line.slice(0, line.indexOf(' ') < 0 ? line.length : line.indexOf(' '));
    if (head === 'deviation') { const w = words(line.slice(10)); out.push(`deviation ${mapLength(w, fr).join(' ')}`); continue; }
    if (head === 'prim') {
      if (line !== IDENTITY_PRIM) throw new Error(`metamorphic: only brep primitives at the identity are mapped, got '${line.slice(0, 60)}'`);
      out.push(line); continue;
    }
    if (head === 'face') {
      const parts = line.split(' '), type = parts[3], lay = LAYOUT[type], w = words(parts.slice(4).join(' ')), res = [];
      if (!lay) throw new Error(`metamorphic: unknown surface '${type}'`);
      let i = 0;
      for (const c of lay) {
        if (c === 'v') res.push(...mapPoint(w.slice(i, i + 6), fr));
        else if (c === 'd') res.push(...mapDirection(w.slice(i, i + 6), fr));
        else if (c === 'r') res.push(...mapLength(w.slice(i, i + 2), fr));
        else res.push(w[i], w[i + 1]);
        i += c === 'v' || c === 'd' ? 6 : 2;
      }
      if (i !== w.length) throw new Error(`metamorphic: ${type} face has ${w.length} words, layout ${lay} needs ${i}`);
      out.push(`${parts.slice(0, 4).join(' ')} ${res.join(' ')}`); continue;
    }
    const m = /^mesh (\d+) (\d+) (\d+)$/.exec(line);
    if (m) { out.push(line); left = Number(m[2]); tris = Number(m[3]); mode = left ? 'v' : tris ? 't' : null; continue; }
    out.push(line);
  }
  return out.join('\n');
}

// The job as numbers: deviation words, surfaces (words), leaf meshes (vertex
// words and doubles, triangles), and the job scale S.
export function parseJob(text) {
  const lines = text.split('\n'), job = { deviation: null, faces: [], meshes: [], prims: [] };
  let mesh = null, left = 0, tris = 0;
  for (const line of lines) {
    if (mesh && left > 0) { const w = words(line); mesh.words.push(w); mesh.vertices.push([value(w[0], w[1]), value(w[2], w[3]), value(w[4], w[5])]); if (--left === 0 && !tris) mesh = null; continue; }
    if (mesh && tris > 0) { mesh.triangles.push(line.split(' ').map(Number)); if (--tris === 0) mesh = null; continue; }
    if (line.startsWith('deviation ')) job.deviation = words(line.slice(10));
    else if (line.startsWith('prim ')) job.prims.push(line);
    else if (line.startsWith('face ')) { const p = line.split(' '); job.faces.push({ leaf: Number(p[1]), index: Number(p[2]), type: p[3], words: words(p.slice(4).join(' ')) }); }
    else {
      const m = /^mesh (\d+) (\d+) (\d+)$/.exec(line);
      if (m) { mesh = { leaf: Number(m[1]), words: [], vertices: [], triangles: [] }; left = Number(m[2]); tris = Number(m[3]); job.meshes.push(mesh); }
    }
  }
  let maxabs = 1;
  for (const m of job.meshes) for (const v of m.vertices) for (const x of v) maxabs = Math.max(maxabs, Math.abs(x));
  job.scale = maxabs;
  job.deviationMm = job.deviation ? value(...job.deviation) : null;
  return job;
}

// Exactness of an exact frame on the wire: the identity copy is the source
// byte for byte; the inverse frame gives the source back byte for byte; every
// transformed value is exactly s_i old[p[i]] 2^k (lengths 2^k, directions
// s_i old[p[i]], angles unchanged); triangles keep or reverse their winding.
export function checkWire(src, fr) {
  const out = transformJob(src, fr);
  if (isIdentity(fr)) return { ok: out === src, identical: out === src };
  if (!fr.exact) return { ok: true, exact: false, ...translationRounding(src, out, fr) };
  const back = transformJob(out, inverse(fr)), roundTrip = back === src;
  const a = parseJob(src), b = parseJob(out), bad = [];
  const want = (x, got, what) => { if (!Object.is(got, x) && !(x === 0 && got === 0)) bad.push(`${what}: ${got} != ${x}`); };
  const s = i => (fr.signs[i] ? -1 : 1), sc = 2 ** fr.k;
  want(value(...a.deviation) * sc, value(...b.deviation), 'deviation');
  a.meshes.forEach((m, mi) => m.vertices.forEach((v, vi) => {
    for (let i = 0; i < 3; i++) want(s(i) * v[fr.p[i]] * sc, b.meshes[mi].vertices[vi][i], `mesh ${mi} vertex ${vi}.${i}`);
  }));
  a.meshes.forEach((m, mi) => m.triangles.forEach((t, ti) => {
    const u = b.meshes[mi].triangles[ti], e = fr.flip ? [t[0], t[2], t[1], t[3]] : t;
    if (e.some((x, i) => x !== u[i])) bad.push(`mesh ${mi} triangle ${ti}`);
  }));
  a.faces.forEach((f, fi) => {
    const g = b.faces[fi]; let i = 0;
    for (const c of LAYOUT[f.type]) {
      if (c === 'v' || c === 'd') {
        for (let j = 0; j < 3; j++) want(s(j) * value(f.words[i + 2 * fr.p[j]], f.words[i + 2 * fr.p[j] + 1]) * (c === 'v' ? sc : 1), value(g.words[i + 2 * j], g.words[i + 2 * j + 1]), `face ${fi} ${c}.${j}`);
        i += 6;
      } else { want(value(f.words[i], f.words[i + 1]) * (c === 'r' ? sc : 1), value(g.words[i], g.words[i + 1]), `face ${fi} ${c}`); i += 2; }
    }
  });
  if (b.meshes.some(m => m.words.some(w => w.includes(NEG_ZERO)))) bad.push('negative zero on the wire');
  return { ok: roundTrip && !bad.length, roundTrip, mismatches: bad.slice(0, 5), mismatchCount: bad.length };
}

// A translation re-rounds every point: the largest distance between a mapped
// point and its exact image (for the census; at |x| ~ 1e4 about 2^-49 |x|).
function translationRounding(src, out, fr) {
  const a = parseJob(src), b = parseJob(out), s = i => (fr.signs[i] ? -1 : 1), sc = 2 ** fr.k;
  let worst = 0;
  a.meshes.forEach((m, mi) => m.vertices.forEach((v, vi) => {
    for (let i = 0; i < 3; i++) {
      const exact = s(i) * v[fr.p[i]] * sc, got = b.meshes[mi].vertices[vi][i] - fr.T[i];
      worst = Math.max(worst, Math.abs(got - exact));
    }
  }));
  return { maxRoundingMm: worst };
}

// ---------------------------------------------------------------------------
// Sources and expectations

export const readExpect = () => JSON.parse(fs.readFileSync(path.join(FIXTURES, 'expect.json'), 'utf8'));
export const sourceNames = () => fs.readdirSync(path.join(FIXTURES, 'jobs')).filter(f => f.endsWith('.job')).map(f => f.slice(0, -4)).sort();
export const sourceText = name => fs.readFileSync(path.join(FIXTURES, 'jobs', `${name}.job`), 'utf8');

// sha256 over the entry's Bend import closure (relative path + bytes), the
// identity of the kernel a census belongs to.
export function closureDigest(entry = DEFAULT_ENTRY) {
  const seen = new Map(), base = path.dirname(path.resolve(entry));
  const visit = file => {
    if (seen.has(file)) return;
    const bytes = fs.readFileSync(file);
    seen.set(file, createHash('sha256').update(bytes).digest('hex'));
    for (const raw of bytes.toString('utf8').split('\n')) {
      const line = raw.trim();
      if (line === '' || line.startsWith('#')) continue;
      const m = /^import\s+(\S+)(?:\s+as\s+\w+)?/.exec(line);
      if (!m) break;
      if (m[1] !== 'Base') visit(path.resolve(path.dirname(file), m[1]));
    }
  };
  visit(path.resolve(entry));
  const rows = [...seen].map(([f, h]) => `${path.relative(path.dirname(base), f)} ${h}`).sort();
  return { digest: createHash('sha256').update(rows.join('\n')).digest('hex'), files: rows.length };
}

// ---------------------------------------------------------------------------
// Running and measuring

export async function loadKernel(entry = DEFAULT_ENTRY) {
  const { loadBend } = await import('../../src/bend-loader.mjs');
  const hybrid = await loadBend(path.resolve(entry));
  // Validation only: the Bend volume integrator of the repository kernel.
  const volume = await loadBend(path.join(ROOT, 'kernel/volume.bend'));
  const { runHybrid, decodeAnswer, toBodies } = await import('../../src/hybrid.mjs');
  const { integrateVolume } = await import('../../src/volume.mjs');
  return { hybrid, volume, entry: path.resolve(entry), runHybrid, decodeAnswer, toBodies, integrateVolume };
}

export function runJob(kernel, text) {
  const t0 = performance.now();
  try {
    const { text: answer } = kernel.runHybrid(kernel, text);
    return { answer, ms: Math.round(performance.now() - t0) };
  } catch (error) {
    return { crash: String(error?.message ?? error).slice(0, 400), ms: Math.round(performance.now() - t0) };
  }
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

// Distance from p to triangle abc (closest point, Ericson 5.1.5).
function pointTriangle(p, a, b, c) {
  const ab = sub(b, a), ac = sub(c, a), ap = sub(p, a);
  const d1 = dot(ab, ap), d2 = dot(ac, ap);
  const at = q => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
  if (d1 <= 0 && d2 <= 0) return at(a);
  const bp = sub(p, b), d3 = dot(ab, bp), d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return at(b);
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); return at([a[0] + v * ab[0], a[1] + v * ab[1], a[2] + v * ab[2]]); }
  const cp = sub(p, c), d5 = dot(ab, cp), d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return at(c);
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); return at([a[0] + w * ac[0], a[1] + w * ac[1], a[2] + w * ac[2]]); }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const w = (d4 - d3) / (d4 - d3 + (d5 - d6)); return at([b[0] + w * (c[0] - b[0]), b[1] + w * (c[1] - b[1]), b[2] + w * (c[2] - b[2])]); }
  const den = 1 / (va + vb + vc), v = vb * den, w = vc * den;
  return at([a[0] + ab[0] * v + ac[0] * w, a[1] + ab[1] * v + ac[1] * w, a[2] + ab[2] * v + ac[2] * w]);
}

// The largest distance of `points` from the job's input surface (all leaf
// triangles), searched within `reach`; a point farther than reach counts as
// Infinity. Uniform grid over the leaf triangles' boxes grown by reach.
function inputDistance(job, points, reach) {
  const tris = job.meshes.flatMap(m => m.triangles.map(t => [m.vertices[t[0]], m.vertices[t[1]], m.vertices[t[2]]]));
  if (!points.length) return 0;
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const t of tris) for (const v of t) for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], v[i] - reach); hi[i] = Math.max(hi[i], v[i] + reach); }
  const n = Math.max(1, Math.min(64, Math.ceil(Math.cbrt(tris.length)))), size = [0, 1, 2].map(i => (hi[i] - lo[i]) / n || 1);
  const cell = (x, i) => Math.min(n - 1, Math.max(0, Math.floor((x - lo[i]) / size[i])));
  const grid = new Map();
  tris.forEach((t, ti) => {
    const a = [0, 1, 2].map(i => cell(Math.min(t[0][i], t[1][i], t[2][i]) - reach, i)), b = [0, 1, 2].map(i => cell(Math.max(t[0][i], t[1][i], t[2][i]) + reach, i));
    for (let x = a[0]; x <= b[0]; x++) for (let y = a[1]; y <= b[1]; y++) for (let z = a[2]; z <= b[2]; z++) {
      const key = (x * n + y) * n + z; let l = grid.get(key); if (!l) grid.set(key, l = []); l.push(ti);
    }
  });
  let worst = 0;
  for (const p of points) {
    if ([0, 1, 2].some(i => p[i] < lo[i] || p[i] > hi[i])) return Infinity;
    const cand = grid.get((cell(p[0], 0) * n + cell(p[1], 1)) * n + cell(p[2], 2)) ?? [];
    let best = Infinity;
    for (const ti of cand) { const t = tris[ti]; best = Math.min(best, pointTriangle(p, t[0], t[1], t[2])); if (best === 0) break; }
    worst = Math.max(worst, best > reach ? Infinity : best);
    if (worst === Infinity) return Infinity;
  }
  return worst;
}

// Volume about the bounding-box centre: far from the origin the products of
// absolute coordinates would cancel away the digits the comparison needs.
function meshMeasure(vertices, triangles) {
  let volume = 0, area = 0;
  const half = new Map(), key = (a, b) => `${a},${b}`;
  const centre = [0, 1, 2].map(i => { let lo = Infinity, hi = -Infinity; for (const v of vertices) { lo = Math.min(lo, v[i]); hi = Math.max(hi, v[i]); } return vertices.length ? (lo + hi) / 2 : 0; });
  let degenerate = 0;
  for (const [a, b, c] of triangles) {
    if (a === b || b === c || a === c || [a, b, c].some(i => !vertices[i])) { degenerate++; continue; }
    const p = sub(vertices[a], centre), q = sub(vertices[b], centre), r = sub(vertices[c], centre);
    volume += dot(p, cross(q, r)) / 6;
    area += Math.hypot(...cross(sub(q, p), sub(r, p))) / 2;
    for (const [u, v] of [[a, b], [b, c], [c, a]]) half.set(key(u, v), (half.get(key(u, v)) ?? 0) + 1);
  }
  let unpaired = 0, repeated = 0;
  for (const [k, n] of half) { if (n > 1) repeated++; const [u, v] = k.split(','); if ((half.get(key(v, u)) ?? 0) !== n) unpaired++; }
  // components over shared vertices
  const parent = vertices.map((_, i) => i), find = i => { while (parent[i] !== i) i = parent[i] = parent[parent[i]]; return i; };
  const used = new Set();
  for (const [a, b, c] of triangles) { used.add(a); used.add(b); used.add(c); parent[find(b)] = find(a); parent[find(c)] = find(a); }
  const components = new Set([...used].map(find)).size;
  return { volumeMm3: volume, areaMm2: area, watertight: !unpaired && !repeated && !degenerate, unpaired, repeated, degenerate, components, triangles: triangles.length, vertices: vertices.length };
}

const firstLine = s => s.slice(0, s.indexOf('\n') < 0 ? s.length : s.indexOf('\n'));
// A refusal's reason with its numbers masked and the unified-class statement
// removed (the census groups by it; the diagnosis harness did the same).
export const normalReason = r => r.replace(/[-+]?\d[\d.e+-]*/g, '#').replace(/; coplanar plane carriers.*$/, '').slice(0, 90);

// What an answer is, measured (no judgement): refusal reason; exact B-rep
// structure and Bend-integrated volume; mesh structure, volume, stated
// deviation words and the distance of its vertices from the job's input.
export function measureAnswer(kernel, answer, jobText) {
  const head = firstLine(answer), job = parseJob(jobText), S = job.scale, reach = 2 ** -30 * S;
  if (head.startsWith('unresolved')) {
    const reason = head.slice(10).trim();
    return { status: reason ? 'refused' : 'malformed', reason, S };
  }
  let decoded;
  try { decoded = kernel.decodeAnswer(answer); } catch (error) { return { status: 'malformed', why: String(error.message).slice(0, 200), S }; }
  if (decoded.status === 'exact') {
    if (decoded.brep.status !== 'ok') return { status: 'malformed', why: 'exact answer without a B-rep', S };
    const raw = decoded.brep.raw, uses = raw.edges.map(() => [0, 0]);
    for (const f of raw.faces) for (const l of f.loops) for (const u of l) uses[u.edge][u.forward ? 0 : 1]++;
    const badEdges = uses.filter(([a, b]) => a !== 1 || b !== 1).length;
    const bodies = kernel.toBodies(raw, 'metamorphic');
    let volumeMm3 = 0, boundMm3 = 0, label = 'exact', volumeError = null;
    for (const b of bodies) {
      try { const v = kernel.integrateVolume({ volume: kernel.volume }, b); volumeMm3 += v.volumeMm3; boundMm3 += v.boundMm3; if (v.label !== 'exact') label = v.label; }
      catch (error) { volumeError = String(error.message).slice(0, 200); }
    }
    return { status: 'exact', S, bodies: bodies.length, vertices: raw.vertices.length, edges: raw.edges.length, faces: raw.faces.length, badEdges,
      volumeMm3: volumeError ? null : volumeMm3, boundMm3, volumeLabel: label, volumeError, unified: decoded.brep.stats.unifiedClasses ?? 0, slivers: decoded.brep.stats.slivers };
  }
  if (decoded.status === 'mesh') {
    const m = /^mesh (\d+) (\d+) /.exec(head), stated = m ? [Number(m[1]), Number(m[2])] : null;
    const mm = meshMeasure(decoded.mesh.vertices, decoded.mesh.triangles);
    return { status: 'mesh', S, reason: decoded.reason, statedDeviationWords: stated, jobDeviationWords: job.deviation,
      ...mm, maxInputDistanceMm: inputDistance(job, decoded.mesh.vertices, reach) };
  }
  return { status: 'malformed', why: `answer '${head.slice(0, 60)}'`, S };
}

// ---------------------------------------------------------------------------
// Judgement

export const DELTA_EXP = -34;
// -> { verdict: exact|mesh|refused|wrong|crash|malformed, cls: exact|mesh|refused|null, failed: [...] }
export function judge(row, reference) {
  if (row.crash) return { verdict: 'crash', cls: null, failed: [`entry threw: ${row.crash}`] };
  const m = row.measure;
  if (!m || m.status === 'malformed') return { verdict: 'malformed', cls: null, failed: [m?.why ?? 'unnamed refusal'] };
  if (m.status === 'refused') return { verdict: 'refused', cls: 'refused', failed: [], reason: normalReason(m.reason) };
  const fr = frame(row.frame), v3 = 2 ** (3 * fr.k), a2 = 2 ** (2 * fr.k), l1 = 2 ** fr.k, delta = 2 ** DELTA_EXP * m.S;
  const oracle = reference?.oracle, exactRef = reference?.exact, failed = [], checks = {};
  const dev = (reference?.deviationMm ?? 0.01) * l1;
  if (m.status === 'exact') {
    if (m.badEdges) failed.push(`${m.badEdges} B-rep edges not used once in each direction`);
    if (m.volumeMm3 == null) failed.push(`volume not measured: ${m.volumeError}`);
    else {
      const area = (oracle?.areaMm2 ?? 0) * a2, tight = m.boundMm3 + area * delta;
      if (exactRef) {
        const want = exactRef.volumeMm3 * v3, d = Math.abs(m.volumeMm3 - want);
        checks.exactReference = { d, allowed: tight };
        if (!(d <= tight)) failed.push(`volume ${m.volumeMm3} vs reference ${want}: |d| ${d.toExponential(3)} > ${tight.toExponential(3)}`);
      }
      if (oracle) {
        const want = oracle.volumeMm3 * v3, d = Math.abs(m.volumeMm3 - want), allowed = area * dev + tight;
        checks.oracle = { d, allowed };
        if (!(d <= allowed)) failed.push(`volume ${m.volumeMm3} vs mesh Boolean ${want}: |d| ${d.toExponential(3)} > area x deviation ${allowed.toExponential(3)}`);
        if (m.bodies !== oracle.components) failed.push(`${m.bodies} bodies, the mesh Boolean has ${oracle.components} components`);
      }
      if (!exactRef && !oracle) failed.push('no reference volume');
    }
    return { verdict: failed.length ? 'wrong' : 'exact', cls: 'exact', failed, checks };
  }
  // certified mesh
  if (!m.watertight) failed.push(`not watertight (${m.unpaired} unpaired, ${m.repeated} repeated half-edges, ${m.degenerate} degenerate triangles)`);
  if (!(m.volumeMm3 > 0)) failed.push(`not outward oriented (volume ${m.volumeMm3})`);
  if (!m.statedDeviationWords || m.statedDeviationWords.join(' ') !== m.jobDeviationWords.join(' ')) failed.push(`states deviation ${m.statedDeviationWords} instead of the job's ${m.jobDeviationWords}`);
  if (!(m.maxInputDistanceMm <= delta)) failed.push(`a vertex lies ${m.maxInputDistanceMm} mm off the job's input surface (> 2^${DELTA_EXP} S = ${delta.toExponential(3)})`);
  if (oracle) {
    const want = oracle.volumeMm3 * v3, d = Math.abs(m.volumeMm3 - want), allowed = m.areaMm2 * delta;
    checks.oracle = { d, allowed };
    if (!(d <= allowed)) failed.push(`volume ${m.volumeMm3} vs mesh Boolean ${want}: |d| ${d.toExponential(3)} > area x 2^${DELTA_EXP} S ${allowed.toExponential(3)}`);
    if (m.components !== oracle.components) failed.push(`${m.components} components, the mesh Boolean has ${oracle.components}`);
  } else failed.push('no mesh reference');
  if (exactRef) {
    const want = exactRef.volumeMm3 * v3, d = Math.abs(m.volumeMm3 - want), allowed = m.areaMm2 * (dev + delta);
    checks.exactReference = { d, allowed };
    if (!(d <= allowed)) failed.push(`volume ${m.volumeMm3} vs exact reference ${want}: |d| ${d.toExponential(3)} > area x deviation ${allowed.toExponential(3)}`);
  }
  return { verdict: failed.length ? 'wrong' : 'mesh', cls: 'mesh', failed, checks };
}

// One job end to end: transform, run, measure, judge.
export function runFrame(kernel, source, frameName, text = sourceText(source), reference = readExpect().sources[source]?.reference) {
  const fr = frame(frameName), job = transformJob(text, fr);
  const run = runJob(kernel, job);
  const row = { source, frame: frameName, kind: fr.kind, ms: run.ms };
  if (run.crash) row.crash = run.crash;
  else {
    row.answerHead = firstLine(run.answer).slice(0, 300);
    row.answerSha = createHash('sha256').update(run.answer).digest('hex').slice(0, 16);
    row.measure = measureAnswer(kernel, run.answer, job);
  }
  return { ...row, judged: judge(row, reference) };
}

// ---------------------------------------------------------------------------
// Census

export function census(rows, expect = readExpect()) {
  const sources = {}, totals = {}, violations = [];
  // The identity job's answer next to the one the CLI dumped with the source
  // (provenance.json): equal when the entry is the kernel that made the dump.
  const dumped = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'provenance.json'), 'utf8')).jobs;
  for (const r of rows) {
    const j = judge(r, expect.sources[r.source]?.reference), set = r.kind;
    const s = sources[r.source] ??= { n: 0, classes: {}, verdicts: {}, reasons: {}, sets: {}, identity: null };
    const t = totals[set] ??= { jobs: 0, exact: 0, mesh: 0, refused: 0, wrong: 0, crash: 0, malformed: 0 };
    t.jobs++; t[j.verdict]++;
    s.n++;
    s.verdicts[j.verdict] = (s.verdicts[j.verdict] ?? 0) + 1;
    if (j.cls) s.classes[j.cls] = (s.classes[j.cls] ?? 0) + 1;
    const st = s.sets[set] ??= {}; st[j.cls ?? j.verdict] = (st[j.cls ?? j.verdict] ?? 0) + 1;
    if (j.reason) s.reasons[j.reason] = (s.reasons[j.reason] ?? 0) + 1;
    if (r.frame === 'p0') {
      s.identity = j.cls === 'refused' ? `refused: ${j.reason}` : j.cls ?? j.verdict;
      if (dumped[r.source]?.answerSha256) s.identityAnswerAsDumped = r.answerSha === dumped[r.source].answerSha256.slice(0, 16);
    }
    if (!['exact', 'mesh', 'refused'].includes(j.verdict)) violations.push({ source: r.source, frame: r.frame, verdict: j.verdict, failed: j.failed });
  }
  for (const s of Object.values(sources)) {
    s.stable = Object.keys(s.classes).length <= 1;
    // Exact frames alone must give one class; translations are reported apart.
    const exactSets = Object.entries(s.sets).filter(([k]) => k !== 'translate').map(([, v]) => v), merged = {};
    for (const v of exactSets) for (const [k, n] of Object.entries(v)) merged[k] = (merged[k] ?? 0) + n;
    s.stableExact = Object.keys(merged).length <= 1;
  }
  const all = Object.values(totals).reduce((a, t) => { for (const [k, n] of Object.entries(t)) a[k] = (a[k] ?? 0) + n; return a; }, {});
  const identities = Object.values(sources).filter(s => s.identityAnswerAsDumped !== undefined);
  return { totals: { ...totals, all }, sources, violations,
    identityAnswersAsDumped: `${identities.filter(s => s.identityAnswerAsDumped).length}/${identities.length}`,
    stableSources: Object.values(sources).filter(s => s.stableExact).length, sourceCount: Object.keys(sources).length };
}

export function censusMarkdown(c, title) {
  const out = [`# ${title}`, '', '| set | jobs | exact | mesh | refused | wrong | crash | malformed |', '|---|---:|---:|---:|---:|---:|---:|---:|'];
  for (const [k, t] of Object.entries(c.totals)) out.push(`| ${k} | ${t.jobs} | ${t.exact} | ${t.mesh} | ${t.refused} | ${t.wrong} | ${t.crash} | ${t.malformed} |`);
  out.push('', `Sources with one verdict class over the exact frames: ${c.stableSources}/${c.sourceCount}. Violations: ${c.violations.length}. Identity answers byte-identical to the dumped production answers: ${c.identityAnswersAsDumped}.`, '',
    '| source | n | identity | classes (perm / scale / translate) | refusal reasons |', '|---|---:|---|---|---|');
  const h = o => Object.entries(o ?? {}).map(([k, n]) => `${n} ${k}`).join(', ') || '-';
  for (const [name, s] of Object.entries(c.sources).sort()) {
    out.push(`| ${name}${s.stableExact ? '' : ' (unstable)'} | ${s.n} | ${s.identity ?? '-'} | ${h(s.sets.perm)} / ${h(s.sets.scale)} / ${h(s.sets.translate)} | ${Object.entries(s.reasons).map(([k, n]) => `${n}x ${k}`).join('; ') || '-'} |`);
  }
  if (c.violations.length) { out.push('', '## Violations', ''); for (const v of c.violations.slice(0, 200)) out.push(`- ${v.source} ${v.frame}: ${v.verdict}: ${v.failed.join('; ')}`); }
  return out.join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// CLI

function options(argv) {
  const o = { set: 'all', sources: null, entry: DEFAULT_ENTRY, label: 'prod', jobs: 3, out: null, list: null, results: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], next = () => argv[++i];
    if (a === '--set') o.set = next();
    else if (a === '--sources') o.sources = next().split(',').filter(Boolean);
    else if (a === '--entry') o.entry = path.resolve(next());
    else if (a === '--label') o.label = next();
    else if (a === '--jobs') o.jobs = Number(next());
    else if (a === '--out') o.out = path.resolve(next());
    else if (a === '--list') o.list = next();
    else if (a === '--results') o.results = next();
    else throw new Error(`metamorphic: unknown argument ${a}`);
  }
  o.out ??= path.join(ROOT, 'tmp/hybrid-robust/metamorphic', o.label);
  return o;
}

const readRows = dir => (fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => /^results-.*\.jsonl$/.test(f)).flatMap(f => fs.readFileSync(path.join(dir, f), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l))) : []);

async function worker(o) {
  const kernel = await loadKernel(o.entry), expect = readExpect();
  const items = fs.readFileSync(o.list, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
  const texts = new Map();
  for (const [source, name] of items) {
    if (!texts.has(source)) texts.set(source, sourceText(source));
    const row = runFrame(kernel, source, name, texts.get(source), expect.sources[source]?.reference);
    fs.appendFileSync(o.results, JSON.stringify(row) + '\n');
    process.stderr.write(`${source} ${name}: ${row.judged.verdict}${row.judged.reason ? ` (${row.judged.reason})` : ''} ${row.ms} ms${row.judged.failed.length && row.judged.verdict !== 'refused' ? ` FAILED ${row.judged.failed.join('; ')}` : ''}\n`);
  }
}

function writeCensus(o) {
  const rows = readRows(o.out), run = JSON.parse(fs.readFileSync(path.join(o.out, 'run.json'), 'utf8'));
  const c = census(rows);
  fs.writeFileSync(path.join(o.out, 'census.json'), JSON.stringify({ schema: 'wonky/r20-metamorphic-census/1', ...run, generatedAt: new Date().toISOString(), rows: rows.length, ...c }, null, 1) + '\n');
  fs.writeFileSync(path.join(o.out, 'census.md'), censusMarkdown(c, `Metamorphic census: ${run.label} (${path.relative(ROOT, run.entry)}, closure ${run.closure.digest.slice(0, 12)})`));
  return c;
}

async function sweep(o) {
  fs.mkdirSync(o.out, { recursive: true });
  const log = line => { const s = `[${new Date().toISOString()}] ${line}\n`; fs.appendFileSync(path.join(o.out, 'sweep.log'), s); process.stdout.write(s); };
  const closure = closureDigest(o.entry), runFile = path.join(o.out, 'run.json');
  if (fs.existsSync(runFile)) {
    const prev = JSON.parse(fs.readFileSync(runFile, 'utf8'));
    if (prev.closure.digest !== closure.digest) throw new Error(`metamorphic: ${o.out} holds rows of closure ${prev.closure.digest.slice(0, 12)}, the entry is ${closure.digest.slice(0, 12)}; use a fresh --out`);
  }
  fs.rmSync(path.join(o.out, 'DONE'), { force: true });
  const names = o.sources ?? sourceNames(), frames = SETS[o.set];
  if (!frames) throw new Error(`metamorphic: unknown set ${o.set}`);
  fs.writeFileSync(runFile, JSON.stringify({ label: o.label, entry: o.entry, closure, set: o.set, sources: names.length, frames: frames.length, startedAt: new Date().toISOString() }, null, 1) + '\n');
  const done = new Set(readRows(o.out).map(r => `${r.source}|${r.frame}`));
  // Heavy sources first so the shards finish together.
  const weight = n => fs.statSync(path.join(FIXTURES, 'jobs', `${n}.job`)).size;
  const items = names.slice().sort((a, b) => weight(b) - weight(a)).flatMap(s => frames.map(f => [s, f])).filter(([s, f]) => !done.has(`${s}|${f}`));
  log(`sweep ${o.label}: ${names.length} sources x ${frames.length} frames (${o.set}); ${done.size} rows present, ${items.length} to run on ${o.jobs} processes; entry ${o.entry} closure ${closure.digest.slice(0, 12)} (${closure.files} files)`);
  const stamp = Date.now().toString(36), shards = Array.from({ length: Math.max(1, o.jobs) }, () => []);
  items.forEach((it, i) => shards[i % shards.length].push(it));
  let finished = 0;
  await Promise.all(shards.map((list, i) => new Promise((resolve, reject) => {
    if (!list.length) return resolve();
    const listFile = path.join(o.out, `shard-${stamp}-${i}.list`);
    fs.writeFileSync(listFile, list.map(x => JSON.stringify(x)).join('\n') + '\n');
    const child = spawn(process.execPath, [SELF, 'worker', '--entry', o.entry, '--list', listFile, '--results', path.join(o.out, `results-${stamp}-${i}.jsonl`)], { cwd: ROOT, stdio: ['ignore', 'inherit', 'pipe'] });
    let buf = '';
    child.stderr.on('data', d => {
      buf += d; let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
        if (/ms( FAILED|$)/.test(line)) finished++;
        if (/FAILED|crash|malformed|wrong/.test(line) || finished % 50 === 0) log(`[${finished}/${items.length}] shard ${i}: ${line.slice(0, 400)}`);
        else fs.appendFileSync(path.join(o.out, 'sweep.log'), `  shard ${i}: ${line}\n`);
      }
    });
    child.on('close', code => (code === 0 ? resolve() : reject(new Error(`shard ${i} exited ${code}`))));
  })));
  const c = writeCensus(o);
  const t = c.totals;
  const summary = `${Object.entries(t).map(([k, v]) => `${k}: ${v.jobs} jobs, ${v.exact} exact, ${v.mesh} mesh, ${v.refused} refused, ${v.wrong + v.crash + v.malformed} violations`).join(' | ')}; ${c.stableSources}/${c.sourceCount} sources one class over the exact frames`;
  log(`census: ${summary}`);
  fs.writeFileSync(path.join(o.out, 'DONE'), `${new Date().toISOString()} ${summary}\n`);
  if (c.violations.length) process.exitCode = 1;
}

function wire(o) {
  let n = 0, bad = 0, worst = 0;
  for (const s of o.sources ?? sourceNames()) {
    const text = sourceText(s);
    for (const name of [...new Set([...SETS.perm, ...SPREAD.flatMap(i => [-3, -2, -1, 0, 1, 2, 3].map(k => `p${i}${k ? `s${k}` : ''}`)), ...SETS.translate])]) {
      const r = checkWire(text, frame(name)); n++;
      if (!r.ok) { bad++; console.log(`${s} ${name}: NOT EXACT ${JSON.stringify(r)}`); }
      if (r.maxRoundingMm) worst = Math.max(worst, r.maxRoundingMm);
    }
  }
  console.log(`wire: ${n} transforms, ${bad} not exact; identity copies byte-identical; translations re-round points by at most ${worst.toExponential(3)} mm`);
  process.exitCode = bad ? 1 : 0;
}

// An exact reference volume from a production sweep, for a source whose
// target is exact and that has no independent one: the median of its exact
// answers over the 48 permutations, accepted only if every one of them lies
// within its own tight tolerance of the median and the median within area x
// deviation of the manifold3d mesh Boolean.
export function consensusReference(rows, reference) {
  const vols = rows.filter(r => r.kind === 'perm' && r.measure?.status === 'exact' && r.measure.volumeMm3 != null && !r.measure.badEdges);
  if (!vols.length || !reference?.oracle) return { ok: false, why: 'no exact production answer' };
  const sorted = vols.map(r => r.measure.volumeMm3).sort((a, b) => a - b), median = sorted[Math.floor(sorted.length / 2)];
  const area = reference.oracle.areaMm2, spread = sorted.at(-1) - sorted[0];
  const off = vols.filter(r => !(Math.abs(r.measure.volumeMm3 - median) <= r.measure.boundMm3 + area * 2 ** DELTA_EXP * r.measure.S));
  const d = Math.abs(median - reference.oracle.volumeMm3), allowed = area * reference.deviationMm;
  if (off.length || !(d <= allowed)) return { ok: false, why: `${off.length} answers off the median; |median - mesh Boolean| ${d} vs ${allowed}` };
  return { ok: true, exact: { volumeMm3: median, basis: `consensus of ${vols.length} production exact answers over the 48 signed permutations (spread ${spread.toExponential(3)} mm3, each within its bound + area x 2^${DELTA_EXP} S); |median - manifold3d mesh Boolean| = ${d.toExponential(3)} <= area x deviation ${allowed.toExponential(3)}` } };
}

// The production census of a finished sweep into expect.json (sources[*].production,
// production.census), and consensus exact references where none is independent.
function baseline(o) {
  const run = JSON.parse(fs.readFileSync(path.join(o.out, 'run.json'), 'utf8'));
  const file = path.join(FIXTURES, 'expect.json'), e = JSON.parse(fs.readFileSync(file, 'utf8'));
  const rows = readRows(o.out);
  for (const [name, s] of Object.entries(e.sources)) {
    if (s.target.class !== 'exact' || s.reference.exact) continue;
    const r = consensusReference(rows.filter(x => x.source === name), s.reference);
    if (r.ok) { s.reference.exact = { ...r.exact, fromSweep: path.relative(ROOT, o.out) }; console.log(`${name}: exact reference ${r.exact.volumeMm3} (${r.exact.basis})`); }
    else console.log(`${name}: no consensus reference: ${r.why}`);
  }
  fs.writeFileSync(file, JSON.stringify(e, null, 1) + '\n');
  const c = writeCensus(o);
  e.production.closure = run.closure; e.production.entry = path.relative(ROOT, run.entry); e.production.sweep = path.relative(ROOT, o.out);
  e.production.census = { totals: c.totals, stableSources: c.stableSources, sourceCount: c.sourceCount, violations: c.violations.length };
  e.production.identityAnswersAsDumped = `${c.identityAnswersAsDumped} (the p0 answer of a source next to the answer the CLI dumped with it)`;
  for (const [name, s] of Object.entries(c.sources)) {
    e.sources[name].production = { identity: s.identity, perm: s.sets.perm ?? {}, scale: s.sets.scale ?? {}, translate: s.sets.translate ?? {}, stable: s.stableExact, reasons: s.reasons };
  }
  fs.writeFileSync(file, JSON.stringify(e, null, 1) + '\n');
  console.log(`expect.json: production census of ${path.relative(ROOT, o.out)} (${c.stableSources}/${c.sourceCount} stable, ${c.violations.length} violations)`);
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2), o = options(rest);
  if (cmd === 'sweep') await sweep(o);
  else if (cmd === 'worker') await worker(o);
  else if (cmd === 'census') { const c = writeCensus(o); console.log(censusMarkdown(c, 'census')); process.exitCode = c.violations.length ? 1 : 0; }
  else if (cmd === 'wire') wire(o);
  else if (cmd === 'baseline') baseline(o);
  else { console.log(fs.readFileSync(SELF, 'utf8').split('\nimport ')[0]); process.exitCode = cmd ? 2 : 0; }
}

if (process.argv[1] && path.resolve(process.argv[1]) === SELF) main().catch(error => { console.error(`metamorphic: ${error.stack ?? error.message}`); process.exitCode = 2; });
