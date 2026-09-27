#!/usr/bin/env node
// Fillet harness TEST INFRASTRUCTURE (docs/fillet-plan.md §8 step 3): the
// boundary sweeps and rigid motions of the exact-decision step. It computes
// no fillet geometry; it builds job texts, runs kernel/fillet on them and
// checks the verdicts.
//
//   node scripts/fillet/sweeps.mjs [--targets js,cpu1] [--families a,b]
//     [--motions id,id] [--out dir]
//
// Families (the size or the geometry sweeps a boundary value b):
//   box-r      top front edge of a 20 x 10 x 5 box, fillet r = 5 + d
//              (the front face is 5 high: consumed at d = 0);
//   box-d      the same edge, chamfer d = 5 + d;
//   post-r     top rim of a post of radius 5 (catalogue pc-post-top-rim-r1's
//              job), fillet r = 5 + d (sphere dome at d = 0);
//   root-r     concave post root on a disc (adv-rb-post-root-r-width-minus-1e-6's
//              job), fillet r = 6 + d (the annulus is 6 wide);
//   ridge-a    a convex vertical edge of dihedral 180 deg - a of a prism,
//              fillet r = 2, a in {1e-3, 1e-6, 1e-9, 1e-12, 0} rad;
//   valley-a   the same, concave.
// d runs over -1e-3, -1e-6, -1e-9, -1e-12, 0, +1e-12, +1e-9, +1e-6, +1e-3 mm
// (the F32x2 word nearest to b + d; the report states the exact offset).
//
// Verdict rule checked per family (the acceptance of step 3): a built
// result or a typed refusal; the verdict at |d| >= tau equals the one at
// +-1e-3 on the same side; at 0 < |d| < tau it is `sliver` (or
// `radius-too-large` where no blend exists on that side at all, r > rho); at d = 0 it is
// the boundary's topology (built). Ridges: `invalid-input` at a = 0 (one plane: the edge is a coplanar fragment, ignored), `sliver`
// while the blend (about 2a wide) is below tau, built above. Built results
// must pass the validator and have no two vertices closer than tau and no
// circle edge of radius below tau (an independent check of "no
// sub-tolerance topology").
//
// Rigid motions (word-exact where the words allow it): translations by
// (1e4, 1e4, 1e4) and (1e7, -1e7, 1e7); a quarter turn about z and one about
// x (exact: coordinate permutations); scale by 2 (exact); a general rotation
// (3/5, 4/5 about z, then about x: rational, rounded once per word); scale
// 1/2. Each must keep the family verdict. Where a motion cannot keep it by
// construction (a general rotation rounds away an exact boundary; scaling
// moves a width across the absolute tau) the report lists the case under
// `expectedChanges` with the reason, never as a pass.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadBend } from '../../src/bend-loader.mjs';
import { bendSources } from '../bakeoff/run.mjs';
import { encodeJob, decodeResult } from './brepfmt.mjs';
import { prismBody } from './run-adversarial.mjs';
import { resolveSelection } from './fixtures.mjs';
import { checkResult } from './validate.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const BEND = path.join(ROOT, '.tools/bend-2.0.25/bin/bend');
const { version: BEND_VERSION } = JSON.parse(fs.readFileSync(path.join(ROOT, 'bend.lock.json'), 'utf8'));
const TAU = Math.fround(1e-6);

// ---------------------------------------------------------------------------
// Exact F32 words: a value is an integer S times 2^-149 (BigInt).

const f32 = new Float32Array(1), u32 = new Uint32Array(f32.buffer);
const bitsOf = (x) => { f32[0] = x; return u32[0]; };
const bitLen = (a) => a.toString(2).length;

export function wordToS(bits) {
  const sign = (bits >>> 31) ? -1n : 1n, e = (bits >>> 23) & 255, f = bits & 0x7fffff;
  if (e === 255) throw new Error('non-finite word');
  if (e === 0) return sign * BigInt(f);
  return sign * (BigInt(f | 0x800000) << BigInt(e - 1));
}

// Nearest F32 word (ties to even) of S * 2^-149; exact when nothing is lost.
export function sToWord(s) {
  if (s === 0n) return { bits: 0, exact: true };
  const neg = s < 0n, a = neg ? -s : s, sign = neg ? 0x80000000 : 0;
  if (a < (1n << 24n)) return { bits: (sign | Number(a)) >>> 0, exact: true };
  let shift = bitLen(a) - 24, m = a >> BigInt(shift);
  const rem = a - (m << BigInt(shift)), half = 1n << BigInt(shift - 1);
  if (rem > half || (rem === half && (m & 1n))) m += 1n;
  if (m === (1n << 24n)) { m >>= 1n; shift += 1; }
  const e = shift + 1;
  if (e >= 255) throw new Error('word overflow');
  return { bits: (sign | (e << 23) | Number(m - (1n << 23n))) >>> 0, exact: rem === 0n };
}

// An F32x2 pair for S: exact when hi + lo == S.
export function sToPair(s) {
  const hi = sToWord(s), r = s - wordToS(hi.bits), lo = sToWord(r);
  return { hi: hi.bits, lo: lo.bits, exact: r === wordToS(lo.bits) };
}

export const pairToS = (hi, lo) => wordToS(hi) + wordToS(lo);
const numToS = (x) => { const h = Math.fround(x), l = Math.fround(x - h); return pairToS(bitsOf(h), bitsOf(l)); };

// ---------------------------------------------------------------------------
// Job text transforms. A motion is p -> (M p / q) * s + T with M an integer
// matrix over the denominator q (a rotation), s = sn / sd, T in S units.

const REALS = {
  line: ['P', 'D'], circle: ['P', 'D', 'D', 'L'], ellipse: ['P', 'D', 'D', 'L', 'L'],
  plane: ['P', 'D', 'D'], cylinder: ['P', 'D', 'D', 'L'], cone: ['P', 'D', 'D', 'L', 'A'],
  sphere: ['P', 'D', 'D', 'L'], torus: ['P', 'D', 'D', 'L', 'L'],
};

const abs = (x) => (x < 0n ? -x : x);
const divRound = (n, d) => {
  const q = n / d, r = n - q * d;
  return 2n * abs(r) >= abs(d) ? q + (((n < 0n) !== (d < 0n)) ? -1n : 1n) : q;
};

function transformer(motion) {
  const { M = [[1n, 0n, 0n], [0n, 1n, 0n], [0n, 0n, 1n]], q = 1n, sn = 1n, sd = 1n, T = [0n, 0n, 0n] } = motion;
  let exact = true;
  const put = (s) => { const p = sToPair(s); if (!p.exact) exact = false; return `${p.hi} ${p.lo}`; };
  const rot = (v) => M.map((row) => row.reduce((acc, m, k) => acc + m * v[k], 0n));
  const scaleS = (v, withScale) => {
    const num = withScale ? sn : 1n, den = q * (withScale ? sd : 1n);
    return v.map((x) => { const n = x * num; if (n % den !== 0n) exact = false; return divRound(n, den); });
  };
  return {
    point: (v) => scaleS(rot(v), true).map((x, k) => put(x + T[k])).join(' '),
    dir: (v) => scaleS(rot(v), false).map(put).join(' '),
    len: (x) => { const n = x * sn; if (n % sd !== 0n) exact = false; return put(divRound(n, sd)); },
    same: (x) => put(x),
    get exact() { return exact; },
  };
}

// Transform a job text word for word; the size scales with the body.
export function transformJob(text, motion) {
  const tf = transformer(motion);
  const out = [];
  for (const line of text.split('\n')) {
    const w = line.split(' ');
    const reals = (i, n) => { const r = []; for (let k = 0; k < n; k++) r.push(pairToS(Number(w[i + 2 * k]), Number(w[i + 2 * k + 1]))); return r; };
    if (w[0] === 'size') { out.push(`size ${tf.len(pairToS(Number(w[1]), Number(w[2])))}`); continue; }
    if (w[0] === 'v') { out.push(`v ${tf.point(reals(1, 3))}`); continue; }
    if (w[0] === 'e' || w[0] === 'f') {
      const isE = w[0] === 'e', head = isE ? w.slice(0, 3) : w.slice(0, 2), type = w[head.length];
      let i = head.length + 1;
      const parts = [...head, type];
      for (const kind of REALS[type]) {
        if (kind === 'P') { parts.push(tf.point(reals(i, 3))); i += 6; }
        else if (kind === 'D') { parts.push(tf.dir(reals(i, 3))); i += 6; }
        else if (kind === 'L') { parts.push(tf.len(reals(i, 1)[0])); i += 2; }
        else { parts.push(tf.same(reals(i, 1)[0])); i += 2; }
      }
      if (isE) {
        // same ranged t0 t1: a line's parameter scales with lengths, a circle's is an angle
        parts.push(w[i], w[i + 1]);
        const [t0, t1] = reals(i + 2, 2);
        parts.push(...(type === 'line' ? [tf.len(t0), tf.len(t1)] : [tf.same(t0), tf.same(t1)]));
        i += 6;
      }
      parts.push(...w.slice(i));
      out.push(parts.join(' '));
      continue;
    }
    out.push(line);
  }
  return { text: out.join('\n'), exact: tf.exact };
}

const S1 = 1n << 149n;
export const MOTIONS = {
  'translate-1e4': { T: [10000n * S1, 10000n * S1, 10000n * S1] },
  'translate-1e7': { T: [10000000n * S1, -10000000n * S1, 10000000n * S1] },
  'quarter-z': { M: [[0n, -1n, 0n], [1n, 0n, 0n], [0n, 0n, 1n]] },
  'quarter-x': { M: [[1n, 0n, 0n], [0n, 0n, -1n], [0n, 1n, 0n]] },
  'scale-2': { sn: 2n },
  // (3/5, 4/5) about z, then about x: M = Rx Rz over q = 25
  'rotate-general': { M: [[15n, -20n, 0n], [12n, 9n, -20n], [16n, 12n, 15n]], q: 25n },
  'scale-1/2': { sd: 2n },
};

// ---------------------------------------------------------------------------
// Families

const OFFSETS = [-1e-3, -1e-6, -1e-9, -1e-12, 0, 1e-12, 1e-9, 1e-6, 1e-3];
const readJob = (id, dir = 'fixtures/fillet/jobs') => fs.readFileSync(path.join(ROOT, dir, `${id}.job`), 'utf8');
const withSize = (text, size) => text.replace(/\nsize \d+ \d+\n/, () => { const p = sToPair(numToS(size)); return `\nsize ${p.hi} ${p.lo}\n`; });
const withId = (text, id) => text.replace(/\ncase [^\n]*\n/, `\ncase ${id}\n`);

function prismJob(id, poly, h, near, op, size) {
  const { body } = prismBody(poly, h);
  const select = resolveSelection(body, [{ near }]);
  return encodeJob({ id, op, size, chamferType: op === 'chamfer' ? 'equal-offsets' : 'none', tangentPropagation: true, body, select });
}

function sizeFamily(name, base, b) {
  return OFFSETS.map((d) => ({ family: name, param: d, bound: b, text: withId(withSize(base, b + d), `${name}${d < 0 ? '' : '+'}${d}`) }));
}

function ridgeFamily(name, sign) {
  return [1e-3, 1e-6, 1e-9, 1e-12, 0].map((a) => {
    const e = sign * 10 * Math.tan(a / 2);
    const poly = [[0, 0], [20, 0], [20, 5], [10, 5 + e], [0, 5]];
    return { family: name, param: a, bound: 0, text: prismJob(`${name}-${a}`, poly, 10, [10, 5 + e, 5], 'fillet', 2) };
  });
}

// Built on demand (root-r reads a stored job under out/, which a fresh
// checkout lacks; test/fillet-exact.test.mjs asks only for the others).
export const FAMILIES = {
  'box-r': () => sizeFamily('box-r', boxJob('fillet'), 5),
  'box-d': () => sizeFamily('box-d', boxJob('chamfer'), 5),
  'post-r': () => sizeFamily('post-r', readJob('pc-post-top-rim-r1'), 5),
  'root-r': () => sizeFamily('root-r', readJob('adv-rb-post-root-r-width-minus-1e-6', 'out/fillet/s2/p2/adv-rb/jobs'), 6),
  'ridge-a': () => ridgeFamily('ridge-a', 1),
  'valley-a': () => ridgeFamily('valley-a', -1),
};
const boxJob = (op) => prismJob('box', [[0, 0], [20, 0], [20, 10], [0, 10]], 5, [10, 0, 5], op, 5);

// The exact offset of a family case: its size word minus the boundary (mm).
export function exactOffset(c) {
  if (/^(ridge|valley)/.test(c.family)) return c.param;
  const size = /\nsize (\d+) (\d+)\n/.exec(c.text);
  return Number(pairToS(Number(size[1]), Number(size[2])) - numToS(c.bound)) / 2 ** 149;
}

// ---------------------------------------------------------------------------
// Running

export function nativeBinary() {
  const native = path.join(ROOT, 'kernel/fillet/native.bend');
  const dir = path.join(ROOT, 'out/fillet/fillet/build'), binary = path.join(dir, 'cpu');
  const h = crypto.createHash('sha256').update(`${BEND_VERSION}\ncpu\n`);
  for (const f of bendSources(native)) h.update(f).update(fs.readFileSync(path.join(ROOT, f)));
  const key = h.digest('hex');
  if (fs.existsSync(binary) && fs.existsSync(`${binary}.key`) && fs.readFileSync(`${binary}.key`, 'utf8') === key) return binary;
  fs.mkdirSync(dir, { recursive: true });
  process.stderr.write('building kernel/fillet native (cpu) ...\n');
  const r = spawnSync(BEND, [native, '-o', binary], { cwd: ROOT, env: { ...process.env, BEND_NO_TELEMETRY: '1' }, encoding: 'utf8', maxBuffer: 1 << 28 });
  if (r.status !== 0) throw new Error(`native build failed: ${r.stderr.slice(-2000)}`);
  fs.writeFileSync(`${binary}.key`, key);
  return binary;
}

export function runCpu1(binary, text, work) {
  const job = path.join(work, 'job.txt'), out = path.join(work, 'out.txt');
  fs.writeFileSync(job, text);
  fs.rmSync(out, { force: true });
  const r = spawnSync(binary, ['--threads', '1', '--gpu', 'off', '--', job, out], { encoding: 'utf8', timeout: 120000 });
  if (r.status !== 0 || !fs.existsSync(out)) return `error ${r.status} ${String(r.stderr).slice(-300)}`;
  return fs.readFileSync(out, 'utf8');
}

export function verdictOf(result) {
  if (result.startsWith('ok\n')) return 'ok';
  const m = /^unresolved (\S+)/.exec(result);
  return m ? m[1] : 'error';
}

// Independent check of a built result: validator, no two vertices closer
// than tau, no circle edge of radius below tau. The kernel decides widths
// exactly on the job's words, but writes the result in F32x2: a width decided
// >= tau may be written up to the rounding allowance below it. The check
// therefore compares with tau - 2^-36 M (M the largest coordinate magnitude
// of the result, at least 1; kernel/fillet/decide.bend's allowance).
export function subTolerance(jobText, resultText) {
  const check = checkResult(jobText, resultText);
  const issues = [...check.issues];
  const { body } = decodeResult(resultText);
  const V = body.vertices;
  const M = Math.max(1, ...V.map((v) => Math.abs(v[0]) + Math.abs(v[1]) + Math.abs(v[2])));
  const TAU_W = TAU - 2 ** -36 * M;
  let minD = Infinity;
  for (let i = 0; i < V.length; i++) for (let j = i + 1; j < V.length; j++) minD = Math.min(minD, Math.hypot(V[i][0] - V[j][0], V[i][1] - V[j][1], V[i][2] - V[j][2]));
  if (minD < TAU_W) issues.push(`vertices ${minD.toExponential(3)} mm apart`);
  for (const e of body.edges) if (e.curve.type === 'circle' && e.curve.radius < TAU_W) issues.push(`circle edge of radius ${e.curve.radius}`);
  return { issues, minVertexDistance: minD };
}

function expected(cases) {
  const far = (s) => cases.find((c) => c.param === s * 1e-3)?.verdict;
  return (c) => {
    if (c.family.startsWith('ridge') || c.family.startsWith('valley')) {
      if (c.param === 0) return 'invalid-input'; // one plane: a coplanar-fragment edge, ignored (integrate-fix round 2)
      return c.param * 2 >= TAU ? 'ok' : 'sliver';
    }
    if (c.param === 0) return 'ok';
    // within tau of the boundary: a sliver, unless no blend exists at all on
    // that side (the far verdict is radius-too-large: exact from the boundary on)
    const f = far(Math.sign(c.param));
    if (Math.abs(c.exactOffset) < TAU) return f === 'radius-too-large' ? f : 'sliver';
    return f;
  };
}

async function main() {
  const args = process.argv.slice(2);
  const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
  const targets = opt('--targets', 'js,cpu1').split(',');
  const pick = opt('--families', Object.keys(FAMILIES).join(',')).split(',');
  const motions = opt('--motions', Object.keys(MOTIONS).join(',')).split(',').filter(Boolean);
  const outDir = path.join(ROOT, opt('--out', 'out/fillet/s3/sweeps'));
  fs.mkdirSync(outDir, { recursive: true });
  const work = fs.mkdtempSync(path.join(outDir, 'work-'));
  const port = targets.includes('js') ? await loadBend(path.join(ROOT, 'kernel/fillet/main.bend')) : null;
  const binary = targets.includes('cpu1') ? nativeBinary() : null;
  const run = (text) => {
    const r = {};
    if (port) r.js = port.run(text);
    if (binary) r.cpu1 = runCpu1(binary, text, work);
    return r;
  };
  const report = { capturedAt: new Date().toISOString(), tau: TAU, targets, families: {}, motions, failures: [], expectedChanges: [] };
  for (const name of pick) {
    const cases = [];
    for (const c of FAMILIES[name]()) {
      const res = run(c.text);
      const texts = Object.values(res);
      const same = texts.every((t) => t === texts[0]);
      const verdict = verdictOf(texts[0]);
      const rec = { family: c.family, param: c.param, exactOffset: exactOffset(c), verdict, targetsAgree: same, reason: texts[0].split('\n')[0].slice(0, 240) };
      if (verdict === 'ok') rec.check = subTolerance(c.text, texts[0]);
      rec.motions = {};
      for (const m of motions) {
        const t = transformJob(c.text, MOTIONS[m]);
        const mt = Object.values(run(t.text));
        const mv = verdictOf(mt[0]);
        const mrec = { verdict: mv, wordExact: t.exact, targetsAgree: mt.every((x) => x === mt[0]) };
        if (mv === 'ok') mrec.check = subTolerance(t.text, mt[0]);
        if (mv !== verdict) mrec.reason = mt[0].split('\n')[0].slice(0, 240);
        rec.motions[m] = mrec;
      }
      cases.push(rec);
      process.stderr.write(`${c.family} ${c.param}: ${verdict}${same ? '' : ' (TARGETS DIFFER)'} ${Object.entries(rec.motions).filter(([, v]) => v.verdict !== verdict).map(([k, v]) => `${k}->${v.verdict}`).join(' ')}\n`);
    }
    const want = expected(cases);
    for (const rec of cases) {
      rec.expected = want(rec);
      const where = `${rec.family} ${rec.param}`;
      if (!rec.targetsAgree) report.failures.push(`${where}: targets differ`);
      if (rec.verdict !== rec.expected) report.failures.push(`${where}: verdict ${rec.verdict}, expected ${rec.expected} (${rec.reason})`);
      if (rec.check?.issues.length) report.failures.push(`${where}: built result has ${rec.check.issues.slice(0, 3).join('; ')}`);
      for (const [m, mr] of Object.entries(rec.motions)) {
        if (!mr.targetsAgree) report.failures.push(`${where} ${m}: targets differ`);
        if (mr.check?.issues.length) report.failures.push(`${where} ${m}: built result has ${mr.check.issues.slice(0, 3).join('; ')}`);
        if (mr.verdict === rec.verdict) continue;
        const factor = m === 'scale-2' ? 2 : m === 'scale-1/2' ? 0.5 : 1;
        const scaled = factor !== 1 && rec.param !== 0 && ((Math.abs(rec.exactOffset) * factor < TAU) !== (Math.abs(rec.exactOffset) < TAU));
        const rounded = m === 'rotate-general' && !mr.wordExact && (rec.param === 0 || Math.abs(Math.abs(rec.exactOffset) - TAU) < 1e-12);
        const why = scaled ? 'the scale moves the offset across the absolute tau' : rounded ? 'the rounded rotation moves an exact boundary (or a width within 1e-12 of tau) by its rounding' : null;
        (why ? report.expectedChanges : report.failures).push(`${where} ${m}: ${rec.verdict} -> ${mr.verdict}${why ? ` (${why})` : ''} [${mr.reason ?? ''}]`);
      }
    }
    report.families[name] = cases;
  }
  fs.rmSync(work, { recursive: true, force: true });
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 1));
  const lines = [];
  for (const [name, cases] of Object.entries(report.families)) lines.push(`${name}: ${cases.map((c) => `${c.param}:${c.verdict}`).join(' ')}`);
  lines.push(`failures ${report.failures.length}`, ...report.failures.map((f) => `  FAIL ${f}`));
  lines.push(`expected changes ${report.expectedChanges.length}`, ...report.expectedChanges.map((f) => `  ${f}`));
  console.log(lines.join('\n'));
  process.exitCode = report.failures.length ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
