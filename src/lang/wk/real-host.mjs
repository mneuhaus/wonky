// Host side of the WK/0 real-model spike (docs/language.md section 12).
//
//   encodeReal(graph)        WK/0 graph -> integer stream for the native
//                            evaluator (kernel/lang/wk/real.bend, main.bend
//                            `fork|serial <reps> <file>`), level by level
//   runNative(...)           one evaluator process; wall time and its own
//                            decode / per-rep / per-node timings
//   parseOutput(text)        the evaluator's stdout, strictly (every line and
//                            token checked; anything unexpected throws)
//   bodyJson(...)            node values -> body JSON exactly as today's
//                            adapters decode them (kernel.mjs decodePrism,
//                            analytic.mjs decodeAnalytic) plus the per-op
//                            fields the adapters set (primitive, validation
//                            volume / bounds / scope, construction budget,
//                            construction incl. planar provenance and pierce
//                            radius / depth / admission)
//   replayIdentity(...)      identity labels computed separately, through
//                            today's identity entries (src/identity.mjs), in
//                            record order, plus the operation evidence and
//                            operationHistory today's booleanInBend attaches
//                            (src/construction-history.mjs), followed by the
//                            source-map tracker's metadata, as the production
//                            build does
//   geomHashes / fullHashes  the two content hashes per node (proposal-dataflow):
//                            geom = op + args (no ids), full = geom + ids
//
// Nothing here computes geometry: every coordinate, volume and bound comes
// from the native evaluator; the host only serializes, decodes and runs the
// identity entries.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import v8 from 'node:v8';
import { f32Words } from './encode-bend.mjs';
import { Ref, canonical } from './ir.mjs';
import { validateSolid } from '../../brep.mjs';
import { decodeAnalytic } from '../../analytic.mjs';
import { real, number, vector, coords } from '../../real.mjs';
import { list, array, PROFILE_MERGE, prismInputs, isIdentityRotation, translatedPrismInputs } from '../../kernel.mjs';
import { inheritExactness, copyExactness, regularizedSources } from '../../exactness.mjs';
import { UnsupportedFeatureError } from '../../errors.mjs';
import { intersectionTolerance } from '../../intersections.mjs';
import { normalizeModelingPolicy } from '../../modeling-policy.mjs';
import { geometryRevision, identifyExtrusion, identifyFrustum, identifyBoolean, identifyTransform, ensureBodyIdentity } from '../../identity.mjs';
import { constructionBudget, transformConstructionHistory, operationEvidence, attachOperationEvidence } from '../../construction-history.mjs';

export const OP = { extrude_polygon: 1, frustum: 2, transform: 3, boolean: 4, expect_count: 5, literal: 6 };
export const METHOD = { COAXIAL: 1, PLANAR: 2, PIERCE: 3, PLANAR_INTERSECT: 5, CURVED: 6, NONE: 7, UNKNOWN: 0 };
const OPERATION = { union: 0, intersect: 1, subtract: 2 };

// --- words ------------------------------------------------------------------------
//
// One F32 value as the stream's (s, m, e) word (encode-bend.mjs f32Words), plus
// the two values the F32 contract (Math.fround) produces from finite binary64
// input that this form cannot express: +-Infinity (a value above the F32
// range, verifier round 3: a 1e39 mm extrusion depth) as (s, 0, 999) and NaN as
// (0, 1, 999) (kernel/lang/wk/real.bend wword). The kernel then computes with
// them exactly as the JS target does, and today's decoder raises today's error.
export const f32WordsX = x => {
  const v = Math.fround(x);
  if (Number.isNaN(v)) return [0, 1, 999];
  if (!Number.isFinite(v)) return [v < 0 ? 1 : 0, 0, 999];
  return f32Words(v);
};
const realWords = x => { const hi = Math.fround(x), lo = Math.fround(x - hi); return [...f32WordsX(hi), ...f32WordsX(lo)]; };
const pairWords = ([hi, lo]) => [...f32WordsX(hi), ...f32WordsX(lo)];
const f32FromBits = bits => { const b = new DataView(new ArrayBuffer(4)); b.setUint32(0, bits >>> 0); return b.getFloat32(0); };
// The largest F32 not above x (the F32 residual threshold of `residual > x`).
function f32Floor(x) {
  const f = Math.fround(x);
  if (f <= x) return f;
  const b = new DataView(new ArrayBuffer(4)); b.setFloat32(0, f);
  b.setUint32(0, b.getUint32(0) - (f > 0 ? 1 : -1)); return b.getFloat32(0);
}
// A binary64 constant of a host comparison as three F32 words c1 + c2 + c3 = c
// (exactly: every split step is a Sterbenz subtraction, and the check below
// reconstructs c in binary64 and requires each word to be an F32).
export function b64Words(c) {
  const c1 = Math.fround(c), r1 = c - c1, c2 = Math.fround(r1), r2 = r1 - c2, c3 = Math.fround(r2);
  if (!Number.isFinite(c) || c3 !== r2 || c1 + c2 + c3 !== c || (c1 + c2) + c3 !== c) throw new Error(`WK constant ${c} does not split into three F32 words`);
  return [c1, c2, c3];
}
// The host thresholds (kernel/lang/wk/real.bend type K): kernel inputs real(1e-7),
// real(1e-10), real(1e-7); binary64 thresholds of today's host comparisons:
// height^2 <= 1e-10 (circularFrustumInBend), |dot| < 1 - 1e-6 (coaxial normals),
// residual > 0.0003 (validateAnalytic cylinder_line_residual).
export const CONSTANTS = { kernel: [1e-7, 1e-10, 1e-7], height2: 1e-10, axis: 1 - 1e-6, residual: 0.0003 };
function constantTokens() {
  const b64 = c => { const [c1, c2, c3] = b64Words(c); return [...pairWords([c1, c2]), ...pairWords([c3, 0])]; };
  return [...CONSTANTS.kernel.flatMap(realWords), ...b64(CONSTANTS.height2), ...b64(CONSTANTS.axis),
    ...pairWords([f32Floor(CONSTANTS.residual), 0]), ...b64(CONSTANTS.residual), ...realWords(0)];
}

// --- precision contract (proposal-core-ir.md §2.2) -----------------------------------
//
// What each kernel adapter does to a binary64 host number before the kernel
// sees it. Since the W2 re-baseline (2026-09-23) every op is F32x2:
//   extrude_polygon      F32x2  src/kernel.mjs extrudeInBend: src/real.mjs vector()
//                               = real() per coordinate (points too), then
//                               profile-ring.simplify and polygon-prism.extrude
//                               on prismInputs: the near and far cap origins
//                               summed in binary64 (plane origin + offset
//                               [+ delta]) and the regularized sketch x
//   frustum              F32x2  src/real.mjs real(): hi = fround(x), lo = fround(x - hi)
//   transform            F32x2  polygon-prism.transform for a polyhedral body
//                               (transformInBend), analytic.transform otherwise
//                               (transformAnalytic); both take real() words; a translation of an
//                               extrusion (or of such a copy) is the extrusion of
//                               its binary64 cap origins + offset (foldedTranslations)
// The graph keeps the binary64 values; the contract decides what the kernel
// input is, and so what the content key covers: the canonical literal of a
// number is its [hi, lo] real() word pair (two binary64 literals with the
// same pair get the same key), plus the one signed-zero rule below. The
// precision report lists every number whose pair does not sum back to it.
// (Before W2 the polyhedral path took Math.fround, 'F32'.)
const f32x2 = x => { const hi = Math.fround(x); return [hi, Math.fround(x - hi)]; };
const mapNumbers = (v, f) => typeof v === 'number' ? f(v) : Array.isArray(v) ? v.map(x => mapNumbers(x, f))
  : v && typeof v === 'object' && !(v instanceof Ref) ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, mapNumbers(x, f)])) : v;

// 'poly' for bodies of extrude_polygon (and rigid transforms of them), else 'analytic'.
export function bodyKinds(graph) {
  const kinds = new Map();
  for (const node of graph.nodes) {
    if (node.op === 'extrude_polygon') kinds.set(node.n, 'poly');
    else if (node.op === 'transform') kinds.set(node.n, kinds.get(node.args.bodies.node) ?? 'analytic');
    else if (node.op !== 'expect_count') kinds.set(node.n, 'analytic');
  }
  return kinds;
}
// kinds is kept in the signature: a transform's kernel entry still depends on
// its source kind (polygon-prism.transform or analytic.transform), not its contract.
const CONTRACT = node => ['extrude_polygon', 'frustum', 'transform'].includes(node.op) ? 'F32x2' : null;

// The kernel inputs of a node under its contract (the fixed canonical literal:
// each number as its real() [hi, lo] pair). An extrusion also carries
// prism = src/kernel.mjs prismInputs: its cap origins are binary64 sums, not a
// function of the summands' pairs, so the key covers the summed words. The
// signed-zero rule: polygon-prism.extrude gets the plane origin only through
// prismInputs, whose binary64 sums (origin + offset + 0) write -0 as +0, so an
// origin -0 gives the words of +0 for every start offset, -0 included
// (test/lang-wk-real.test.mjs checks the built words). (The F32 path needed a
// +0 offset for this.)
export function contractArgs(node, kinds) {
  const contract = CONTRACT(node, kinds);
  let args = node.args;
  if (node.op === 'extrude_polygon' && args.plane.origin.some(v => Object.is(v, -0)))
    args = { ...args, plane: { ...args.plane, origin: args.plane.origin.map(v => v === 0 ? 0 : v) } };
  if (node.op === 'extrude_polygon') args = { ...args, prism: prismKernelInputs(args) };
  return contract === 'F32x2' ? mapNumbers(args, f32x2) : args;
}

// src/kernel.mjs prismInputs of an extrude_polygon node, without the plane
// normal (a node arg already): what polygon-prism.extrude receives.
function prismKernelInputs(a) {
  const { origin, x, far, frameRegularization } = prismInputs(a.plane, a.delta, a.offset ?? [0, 0, 0]);
  return { origin, x, far, frameRegularization };
}

// src/kernel.mjs transformInBend folds a translation (an exactly identity
// rotation) of a polygon prism into an extrusion of the translated cap origins,
// summed in binary64 (translatedPrismInputs). Production keeps the prism inputs
// with the body object of an extrusion or of such a folded copy; in the graph
// that is a transform whose source node is an extrude_polygon node or a folded
// transform. Map node -> the kernel inputs of its extrusion (the source's
// points: the ring merge decides the same kept vertices again).
export function foldedTranslations(graph) {
  const folds = new Map(), byNumber = new Map(graph.nodes.map(node => [node.n, node]));
  for (const node of graph.nodes) {
    const a = node.args;
    if (node.op !== 'transform' || !(a.bodies instanceof Ref) || !isIdentityRotation(a.rotation)) continue;
    const source = byNumber.get(a.bodies.node);
    const base = source?.op === 'extrude_polygon' ? { points: source.args.points, normal: source.args.plane.normal, ...prismKernelInputs(source.args) }
      : folds.get(a.bodies.node);
    if (base) folds.set(node.n, translatedPrismInputs(base, a.offset));
  }
  return folds;
}

// Every host number the contract changes: [{node, id, path, value, kernel}].
export function precisionReport(graph) {
  const kinds = bodyKinds(graph), rows = [];
  for (const node of graph.nodes) {
    const contract = CONTRACT(node, kinds);
    if (!contract) continue;
    const walk = (v, path) => {
      if (typeof v === 'number') {
        const k = f32x2(v);
        const same = Object.is(k[0] + k[1], v) || (v === 0 && k[0] === 0);
        if (!same) rows.push({ node: node.n, id: node.id, contract, path, value: v, kernel: k });
      } else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`));
      else if (v && typeof v === 'object' && !(v instanceof Ref)) for (const [k, x] of Object.entries(v)) walk(x, path ? `${path}.${k}` : k);
    };
    walk(node.args, '');
  }
  return rows;
}

// real() (src/real.mjs) accepts only finite values with |x| <= 1e20 and no F32
// exponent underflow; the F32x2 adapters (extrudeInBend, circularFrustumInBend,
// transformInBend, transformAnalytic) call it on every host input and throw this RangeError
// before the kernel runs. The WK host applies the same precondition to the
// F32x2-contract args of each node before sending it (real-run.mjs evaluate):
// a failing node and its dependents are not sent and carry this error. Values
// the kernel computes between two native ops are not re-checked (a gap:
// today's host would re-encode them through real()).
export const REAL_RANGE_MESSAGE = 'Bend Real serialization requires a finite magnitude <= 1e20 without F32 exponent underflow';
const realOk = v => Number.isFinite(v) && Math.abs(v) <= 1e20 && !(v !== 0 && Math.fround(v) === 0);
export function precheck(graph, nodes = graph.nodes) {
  const kinds = bodyKinds(graph), bad = new Map(), folds = foldedTranslations(graph);
  for (const node of nodes) {
    if (CONTRACT(node, kinds) !== 'F32x2') continue;
    let ok = true;
    const walk = v => { if (!ok) return; if (typeof v === 'number') ok = realOk(v); else if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object' && !(v instanceof Ref)) Object.values(v).forEach(walk); };
    walk(node.args);
    if (ok && node.op === 'extrude_polygon') walk(prismKernelInputs(node.args));
    if (ok && folds.has(node.n)) walk([folds.get(node.n).origin, folds.get(node.n).far]);
    if (!ok) bad.set(node.n, { name: 'RangeError', message: REAL_RANGE_MESSAGE });
  }
  return bad;
}

// F32-contract nodes whose kernel input is not finite (Math.fround above the
// F32 range, or NaN): they are sent (the kernel computes with Infinity as the
// JS target does), but their result is one today's decoder must see before any
// other kernel op does, so real-run.mjs evaluates their dependents one stage
// later (after the host decode, which today rejects such a body). Since every
// op is F32x2 (W2) there are none: precheck refuses a non-finite F32x2 input
// with today's RangeError before anything is sent. Kept for an F32 op.
export function nonFiniteInputs(graph) {
  const kinds = bodyKinds(graph), out = new Set();
  for (const node of graph.nodes) {
    if (CONTRACT(node, kinds) !== 'F32') continue;
    let bad = false;
    const walk = v => { if (bad) return; if (typeof v === 'number') bad = !Number.isFinite(Math.fround(v)); else if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object' && !(v instanceof Ref)) Object.values(v).forEach(walk); };
    walk(node.args);
    if (bad) out.add(node.n);
  }
  return out;
}

// --- content hashes (proposal-dataflow: geom without ids, full with ids) ---------------
const sha = text => createHash('sha256').update(text).digest('hex').slice(0, 16);
function merkle(graph, withIds) {
  const hashes = new Array(graph.nodes.length), kinds = bodyKinds(graph);
  for (const node of graph.nodes) {
    const refText = r => `#${hashes[r.node]}${r.out === null ? '' : `.${r.out}`}`;
    const ids = withIds ? `@${node.id ?? ''}${node.attrs?.primitive ? `/${node.attrs.primitive}` : ''}` : '';
    hashes[node.n] = sha(`${node.op}(${canonical(contractArgs(node, kinds), refText)})${ids}`);
  }
  return hashes;
}
export const geomHashes = graph => merkle(graph, false);
export const fullHashes = graph => merkle(graph, true);

// --- encoding -------------------------------------------------------------------------
const refsOfNode = node => {
  const a = node.args;
  switch (node.op) {
    case 'transform': return [a.bodies];
    case 'boolean': return a.kind === 'subtract' ? [a.targets[0], a.tools[0]] : [a.tools[0], a.tools[1]];
    case 'expect_count': return a.of;
    default: return [];
  }
};
const v3 = (v, fallback = [0, 0, 0]) => v ?? fallback;

// Payload of one node: [us, reals]. The reals are the binary64 values the JS
// adapter hands to real() / Math.fround(); the evaluator reads the F32x2 words
// (or only the high word where the adapter uses Math.fround). A PIERCE node
// also carries its host inputs (pierceInputs): a status word and six [hi, lo]
// word pairs, exactly the real() words today's adapter hands the kernel.
function payload(node, host, fold) {
  const a = node.args;
  if (fold) return [[PROFILE_MERGE.allowRegularized ? 1 : 0], [...fold.origin, ...fold.normal, ...fold.x, ...fold.far, ...fold.points.flat()]];
  if (node.op === 'boolean' && a.method === 'PIERCE') {
    if (!host) throw new Error(`WK encode: PIERCE node %${node.n} (${node.id}) needs its host inputs (real-run.mjs stages the graph)`);
    return [[METHOD.PIERCE, OPERATION[a.kind], a.components, host.status], host.words];
  }
  switch (node.op) {
    case 'extrude_polygon': { // us: the profile merge policy of src/kernel.mjs (PROFILE_MERGE.allowRegularized)
      const prism = prismKernelInputs(a); // reals: near cap origin, normal, x, far cap origin, points
      return [[PROFILE_MERGE.allowRegularized ? 1 : 0], [...prism.origin, ...a.plane.normal, ...prism.x, ...prism.far, ...a.points.flat()]];
    }
    case 'frustum': {
      const circle = c => [...c.center, c.radius, ...c.plane.origin, ...c.plane.normal, ...c.plane.x];
      return [[a.second ? 1 : 0], [...circle(a.first), ...(a.second ? circle(a.second) : v3(a.delta)), ...v3(a.offset)]];
    }
    case 'transform': return [[], [...a.rotation.flat(), ...a.offset]];
    case 'boolean': return [[METHOD[a.method] ?? 0, OPERATION[a.kind], a.components], []];
    case 'expect_count': return [[a.count], []];
    default: return [[], []];
  }
}

// graph -> { text, tokens, keys (evaluation order), levels, evaluated }
// options.literals: Map node -> { u: [..], r: [[hi, lo] words as F32 values] } (host cache hits,
//   operands evaluated in an earlier stage)
// options.skip: Set of nodes not sent at all (clean and not needed by any evaluated node)
// options.hostInputs: Map node -> pierceInputs(...) for every PIERCE node that is sent
export function encodeReal(graph, { literals = new Map(), skip = new Set(), hostInputs = new Map() } = {}) {
  const nodes = graph.nodes.filter(n => !skip.has(n.n));
  const folds = foldedTranslations(graph);
  // a folded translation is sent as the extrusion it is (op 1), without its source
  const refsOf = node => literals.has(node.n) || folds.has(node.n) ? [] : refsOfNode(node);
  const level = new Map();
  for (const node of nodes) {
    const refs = refsOf(node);
    level.set(node.n, refs.length ? 1 + Math.max(...refs.map(r => {
      if (!level.has(r.node)) throw new Error(`WK encode: node %${node.n} references %${r.node}, which is neither sent nor earlier`);
      return level.get(r.node);
    })) : 0);
  }
  const depth = nodes.length ? Math.max(...level.values()) + 1 : 0;
  const tokens = [];
  tokens.push(...constantTokens());
  tokens.push(depth);
  const position = new Map(), keys = [], levels = [];
  let base = 0;
  for (let l = 0; l < depth; l++) {
    const members = nodes.filter(n => level.get(n.n) === l);
    tokens.push(members.length);
    for (const node of members) {
      const lit = literals.get(node.n);
      const op = lit ? OP.literal : folds.has(node.n) ? OP.extrude_polygon : OP[node.op] ?? 99;
      const refs = refsOf(node).map(r => base - 1 - position.get(r.node));
      const [us, rs] = lit ? [lit.u, lit.r] : payload(node, hostInputs.get(node.n), folds.get(node.n));
      tokens.push(op, node.span + 1, node.n, refs.length, ...refs, us.length, ...us, rs.length);
      for (const x of rs) tokens.push(...(Array.isArray(x) ? pairWords(x) : realWords(x)));
    }
    members.forEach((node, i) => position.set(node.n, base + i));
    levels.push(members.map(n => n.n));
    keys.push(...members.map(n => n.n));
    base += members.length;
  }
  // The seal (kernel/lang/wk/real.bend program_seal): token count and their sum
  // mod 2^32 in front, so a cut or altered stream is rejected as a whole.
  for (const t of tokens) if (!Number.isInteger(t) || t < 0 || t > 4294967295) throw new Error(`WK encode: token ${t} is not a U32`);
  const seal = [tokens.length, tokens.reduce((s, t) => (s + t) % 4294967296, 0)];
  return { text: [...seal, ...tokens].join(' '), tokens: tokens.length + 2, keys, levels, evaluated: nodes.filter(n => !literals.has(n.n)).length };
}

// --- one native run ------------------------------------------------------------------------
// binary 'bend-js' runs kernel/lang/wk/main.bend through Bend's own runner (the
// sequential JS target): for logic checks only, never for timings.
export const BEND = new URL('../../../.tools/bend-2.0.25/bin/bend', import.meta.url).pathname;
export const MAIN = new URL('../../../kernel/lang/wk/main.bend', import.meta.url).pathname;
export function runNative(binary, file, { mode = 'fork', threads = 1, reps = 1, timeoutMs = 600000 } = {}) {
  return new Promise((resolve, reject) => {
    const t0 = performance.now();
    const [command, args] = binary === 'bend-js' ? [BEND, [MAIN, mode, String(reps), file]]
      : [binary, ['--threads', String(threads), '--gpu', 'off', '--', mode, String(reps), file]];
    execFile(command, args,
      { env: { ...process.env, BEND_NO_TELEMETRY: '1' }, maxBuffer: 1 << 30, timeout: timeoutMs }, (error, stdout, stderr) => {
        const wallMs = performance.now() - t0;
        if (error) { error.stderr = stderr; error.wallMs = wallMs; reject(error); return; }
        resolve({ wallMs, stdout });
      });
  });
}

// --- decoding the native output ------------------------------------------------------------
//
// Strict: the evaluator prints exactly one `D <us>` line, one `R <us>*` line,
// `T <node> <us>` lines (serial mode), one `N <node> <value>` line per node it
// was sent, and nothing else. Any other line, a token that is not a decimal
// U32, a repeated node or a missing D/R line is a malformed output and throws;
// nodeValues (real-run.mjs) then checks that the node lines are exactly the
// nodes that were sent.
export class MalformedNativeOutput extends Error {
  constructor(message) { super(`malformed native evaluator output: ${message}`); this.name = 'MalformedNativeOutput'; }
}
const U32_TOKEN = /^(0|[1-9][0-9]{0,9})$/;
const u32 = (token, what) => {
  if (!U32_TOKEN.test(token) || Number(token) > 4294967295) throw new MalformedNativeOutput(`${what}: '${String(token).slice(0, 40)}' is not a decimal U32`);
  return Number(token);
};
const u32s = (text, what) => { const t = text.trim(); return t === '' ? [] : t.split(' ').map(x => u32(x, what)); };
export function parseOutput(text) {
  const out = { decodeUs: null, repsUs: null, nodeUs: new Map(), values: new Map() };
  const lines = text.split('\n');
  if (lines.at(-1) === '') lines.pop();
  for (const line of lines) {
    const tag = line.slice(0, 2);
    if (tag === 'D ') {
      if (out.decodeUs !== null) throw new MalformedNativeOutput('two D lines');
      out.decodeUs = u32(line.slice(2), 'D line');
    } else if (tag === 'R ') {
      if (out.repsUs !== null) throw new MalformedNativeOutput('two R lines');
      out.repsUs = u32s(line.slice(2), 'R line');
    } else if (tag === 'T ') {
      const parts = line.split(' ');
      if (parts.length !== 3) throw new MalformedNativeOutput(`bad T line '${line.slice(0, 60)}'`);
      out.nodeUs.set(u32(parts[1], 'T node'), u32(parts[2], 'T time'));
    } else if (tag === 'N ') {
      const m = /^N (\S+) (.*)$/s.exec(line);
      if (!m) throw new MalformedNativeOutput(`bad N line '${line.slice(0, 60)}'`);
      const key = u32(m[1], 'N node'), rest = m[2];
      if (out.values.has(key)) throw new MalformedNativeOutput(`node ${key} printed twice`);
      if (rest === 'K') out.values.set(key, { ok: true });
      else if (rest.startsWith('E ')) {
        const e = /^E (\S+) (\S+) (.*)$/s.exec(rest);
        if (!e) throw new MalformedNativeOutput(`bad error value of node ${key}`);
        out.values.set(key, { error: { code: u32(e[1], 'error code'), span: u32(e[2], 'error span') - 1, message: e[3] } });
      } else {
        const b = /^B (\S+) U (.*)F (.*)$/s.exec(rest);
        if (!b || b[2].includes('F')) throw new MalformedNativeOutput(`bad body value of node ${key}`);
        out.values.set(key, { count: u32(b[1], 'body count'), u: u32s(b[2], 'U words'), f: u32s(b[3], 'F words') });
      }
    } else throw new MalformedNativeOutput(`unexpected line '${line.slice(0, 60)}'`);
  }
  if (out.decodeUs === null || out.repsUs === null) throw new MalformedNativeOutput('the D or R line is missing (the evaluator did not finish)');
  return out;
}

// u/f streams -> [{ kind, solid (Bend value shape), extra fields, u, r }] per body.
export function splitBodies(value) {
  const { u, f, count } = value;
  let ui = 0, fi = 0;
  const U = () => { if (ui >= u.length) throw new MalformedNativeOutput('body structure words end early'); return u[ui++]; };
  const F32 = () => { if (fi >= f.length) throw new MalformedNativeOutput('body float words end early'); return f32FromBits(f[fi++]); };
  const R = () => ({ $: 'Real', hi: F32(), lo: F32() });
  const V = () => ({ $: 'V3', x: R(), y: R(), z: R() });
  const bodies = [];
  for (let b = 0; b < count; b++) {
    const u0 = ui, f0 = fi, kind = U(), nv = U(), ne = U();
    if (kind === 0) { // an F32x2 polygon prism (kernel/lang/wk/real.bend enc_body)
      const vertices = Array.from({ length: nv }, V);
      const edges = Array.from({ length: ne }, () => ({ start: U(), end: U() }));
      const nf = U();
      const uses = Array.from({ length: nf }, () => { const n = U(); return Array.from({ length: n }, () => ({ edge: U(), forward: U() === 1 })); });
      const nrec = U();
      if (nrec > 1) throw new MalformedNativeOutput(`polyhedral body with ${nrec} profile records`);
      const head = nrec ? { source: U(), kept: Array.from({ length: U() }, U) } : null;
      const merges = head ? Array.from({ length: U() }, () => ({ index: U(), exact: U() === 1 })) : null;
      const faces = uses.map(list => ({ uses: list, origin: V(), normal: V(), x: V() }));
      const required = R(), allowance = R();
      const ring = head ? { ...head, tolerance: R(), merged: merges.map(m => ({ index: m.index, deviation: R(), exact: m.exact })) } : null;
      bodies.push({ kind: 'poly', vertices, edges, faces, required, allowance, ring, u: u.slice(u0, ui), r: pairs(f, f0, fi) });
      continue;
    }
    const vertices = Array.from({ length: nv }, V);
    const edgeHeads = Array.from({ length: ne }, () => ({ start: U(), end: U(), tag: U(), same: U() === 1 }));
    const curve = tag => tag === 0 ? { $: 'Line', origin: V(), direction: V() }
      : tag === 1 ? { $: 'Circle', origin: V(), normal: V(), x: V(), radius: R() }
        : { $: 'Ellipse', origin: V(), normal: V(), x: V(), major: R(), minor: R() };
    const edges = edgeHeads.map(e => ({ $: 'Edge', start: e.start, end: e.end, curve: curve(e.tag), same_sense: e.same }));
    const nf = U();
    const faceHeads = Array.from({ length: nf }, () => {
      const stag = U(), same = U() === 1, nl = U();
      const loops = Array.from({ length: nl }, () => { const outer = U() === 1, n = U(); return { outer, uses: Array.from({ length: n }, () => ({ edge: U(), forward: U() === 1 })) }; });
      return { stag, same, loops };
    });
    const surface = tag => tag === 0 ? { $: 'Plane', origin: V(), normal: V(), x: V() }
      : tag === 1 ? { $: 'Cylinder', origin: V(), axis: V(), x: V(), radius: R() }
        : { $: 'Cone', origin: V(), axis: V(), x: V(), radius: R(), angle: R() };
    const faces = faceHeads.map(h => ({ $: 'Face', surface: surface(h.stag), same_sense: h.same,
      loops: list(h.loops.map(l => ({ $: 'Loop', outer: l.outer, uses: list(l.uses.map(x => ({ $: 'Use', ...x }))) }))) }));
    const nd = U(), dtags = Array.from({ length: nd }, U);
    const domains = dtags.map(t => t === 0 ? null : t === 1 ? [R(), R()] : 'untrimmed');
    const ptag = U(), nbudget = U(), nvol = U(), nbounds = U(), cons = U(), nextra = U(), npu = U();
    const pu = Array.from({ length: npu }, U);
    const prim = ptag === 1 ? { bottom: V(), top: V(), r0: R(), r1: R() } : null;
    const budget = nbudget ? R() : null, volume = nvol ? R() : null;
    const bounds = nbounds ? { low: V(), high: V() } : null;
    const extra = Array.from({ length: nextra }, R);
    bodies.push({ kind: 'analytic', solid: { $: 'Solid', vertices: list(vertices), edges: list(edges), faces: list(faces) },
      domains, prim, budget, volume, bounds, cons, extra, pu, u: u.slice(u0, ui), r: pairs(f, f0, fi) });
  }
  if (ui !== u.length || fi !== f.length) throw new MalformedNativeOutput(`${u.length - ui} structure and ${f.length - fi} float words left over`);
  return bodies;
}
const pairs = (f, a, b) => { const out = []; for (let i = a; i < b; i += 2) out.push([f32FromBits(f[i]), f32FromBits(f[i + 1])]); return out; };

// src/kernel.mjs decodePrism (module private there) with the construction
// record extrudeInBend / transformInBend give it, in the same key order: every
// F32x2 word decoded as number(x) + 0, precision 'F32' when the audit exceeds
// its allowance, the profile merge and frame regularization records of an
// extrusion (exactness 'regularized' after an inexact merge or a projected x), a copy's construction cloned from its
// source (and its exactness), then validateSolid.
const decodedV = v => [number(v.x) + 0, number(v.y) + 0, number(v.z) + 0];
function decodePoly(p, node, id, source) {
  const extrusion = node.op === 'extrude_polygon';
  // a folded translation (foldedTranslations) comes back as the extrusion it was sent as
  const folded = node.op === 'transform' && Boolean(p.ring);
  if (folded && !isIdentityRotation(node.args.rotation)) throw new MalformedNativeOutput(`node ${node.n} (transform): a profile record for a rotation`);
  if (!folded && extrusion !== Boolean(p.ring)) throw new MalformedNativeOutput(`node ${node.n} (${node.op}): polyhedral body ${p.ring ? 'with' : 'without'} a profile record`);
  const body = {
    id, precision: 'F32x2',
    vertices: p.vertices.map(decodedV),
    edges: p.edges.map(({ start, end }) => ({ curve: 'line', start, end })),
    faces: p.faces.map(face => ({ surface: { type: 'plane', origin: decodedV(face.origin), normal: decodedV(face.normal), x: decodedV(face.x) },
      loops: [face.uses.map(({ edge, forward }) => ({ edge, forward }))] })),
  };
  body.shell = { closed: true, faces: body.faces.map((_, i) => i) };
  const [requiredMm, allowanceMm] = [number(p.required), number(p.allowance)];
  if (!(requiredMm <= allowanceMm)) body.precision = 'F32';
  let construction, merged = [], frame = null;
  if (extrusion) {
    merged = p.ring.merged.map(m => ({ index: m.index, deviationMm: number(m.deviation), exact: m.exact }));
    frame = prismKernelInputs(node.args).frameRegularization;
    construction = { method: 'native Bend F32x2 polygon prism',
      profileMerge: { sourceVertices: p.ring.source, keptVertices: p.ring.kept.length, merged, toleranceMm: number(p.ring.tolerance),
        ...(merged.length ? { kept: p.ring.kept } : {}) },
      ...(frame ? { frameRegularization: frame } : {}) };
  } else {
    construction = source?.construction ? structuredClone(source.construction)
      : { method: 'native Bend F32x2 rigid transform', sourcePrecision: source?.precision ?? 'F32' };
  }
  body.construction = { ...construction, requiredIncidenceMm: requiredMm, allowanceMm };
  body.validation = validateSolid(body);
  if (extrusion && (merged.some(m => !m.exact) || frame)) body.exactness = 'regularized';
  if (!extrusion && source) copyExactness(source, body);
  return body;
}

const SCOPE_KERNEL = 'boundary topology, analytic endpoint incidence and cylinder line-segment incidence in Bend';
const real2 = r => ({ $: 'Real', hi: r.hi, lo: r.lo }); // a Bend Real exactly as the JS target returns it

// Per-body native facts the host needs for the operation evidence but that are
// not fields of today's body JSON (so they never appear in it): the method
// details (planar stats / audit / budgets, pierce depth / radius).
export const NATIVE = new WeakMap();

// Today's host inputs of a PIERCE node (src/boolean.mjs booleanInBend, the
// through-hole branch), computed with today's code from the decoded operands
// a (target) and b (tool), in today's order:
//   span = top - bottom, length = Math.hypot(...span)         binary64
//   length === 0: fail('Pierce tool has no length')            status 1
//   vector(bottom), axis = vector(span / length), real(r0), the reach
//   real(min), real(max) of the binary64 projections: a RangeError status 2
//   a target volume that is not finite: today's capability error
//   (src/boolean.mjs, "needs a target with a certified volume"), or
//   real(a.validation.volumeMm3)'s RangeError (both raised after
//   the kernel call and the decode)                            status 3
// words: axis x, y, z, reach low, reach high, target volume as the [hi, lo]
// F32 pairs real() returns, i.e. exactly the words today's kernel call gets.
// The kernel checks (classificationInput, the pierce admission) stay native.
export function pierceInputs(a, b) {
  const zero = () => Array.from({ length: 6 }, () => [0, 0]);
  const tool = b?.primitive;
  if (tool?.type !== 'frustum' || !a?.validation) return { status: 0, words: zero() }; // the evaluator refuses the method first
  const span = tool.top.map((v, i) => v - tool.bottom[i]);
  const length = Math.hypot(...span);
  if (length === 0) return { status: 1, words: zero() };
  const w = r => [r.hi, r.lo];
  let axis, low, high;
  try {
    vector(tool.bottom);
    axis = vector(span.map(v => v / length));
    real(tool.r0);
    const reach = [tool.bottom, tool.top].map(p => p.reduce((sum, v, i) => sum + v * span[i] / length, 0));
    low = real(Math.min(...reach)); high = real(Math.max(...reach));
  } catch (error) { if (error instanceof RangeError) return { status: 2, words: zero(), error }; throw error; }
  const head = [w(axis.x), w(axis.y), w(axis.z), w(low), w(high)];
  if (!Number.isFinite(a.validation.volumeMm3)) {
    return { status: 3, words: [...head, [0, 0]], error: new UnsupportedFeatureError(`opBoolean through hole needs a target with a certified volume; this target (${a.construction?.method ?? a.id ?? 'body'}) states none, and the pierced volume is not invented`) };
  }
  try { return { status: 0, words: [...head, w(real(a.validation.volumeMm3))] }; }
  catch (error) { if (error instanceof RangeError) return { status: 3, words: [...head, [0, 0]], error }; throw error; }
}

// Planar provenance words (kernel/lang/wk/real.bend planar_pu) -> today's
// Bend-JS-target objects, with src/planar-boolean.mjs decodePlanarBoolean's
// reference checks against the two input bodies.
function planarProvenance(nb, node, inputs, body) {
  let i = 0;
  const U = () => { if (i >= nb.pu.length) throw new MalformedNativeOutput(`planar provenance of node ${node.n} ends early`); return nb.pu[i++]; };
  const stats = { $: 'Stats', planes: U(), cells: U(), selected_cells: U(), shared_vertices: U(), boundary_faces: U(), internal_interfaces: U() };
  const valid = U() === 1;
  const ref = () => { const operand = U(), index = U(); return { $: 'FaceRef', operand, index }; };
  const refs = () => { const n = U(); return Array.from({ length: n }, ref); };
  const faces = Array.from({ length: U() }, () => { const owner = ref(); return { $: 'FaceOrigin', owner, contributors: list(refs()) }; });
  const edges = Array.from({ length: U() }, () => {
    const tag = U();
    if (tag === 0) { const operand = U(), index = U(); return { $: 'OriginalEdge', operand, index }; }
    if (tag === 1) { const first = ref(), second = ref(); return { $: 'FaceIntersection', first, second }; }
    if (tag === 2) return { $: 'FaceSubdivision', faces: list(refs()) };
    throw new MalformedNativeOutput(`unknown planar edge-origin tag ${tag} at node ${node.n}`);
  });
  if (i !== nb.pu.length || nb.extra.length !== 7) throw new MalformedNativeOutput(`planar provenance of node ${node.n} has ${nb.pu.length - i} words / ${nb.extra.length} reals left over`);
  // decodePlanarBoolean's checks (a failure means native and host disagree: loud)
  const bad = message => { throw new MalformedNativeOutput(`node ${node.n} (${node.id}): ${message}`); };
  const faceKey = r => `${r.operand}/${r.index}`;
  const reference = (r, kind) => {
    if (!Number.isInteger(r?.operand) || !Number.isInteger(r?.index) || r.operand < 0 || r.operand >= inputs.length || r.index < 0 || r.index >= inputs[r.operand][kind].length) bad(`Invalid planar arrangement ${kind} origin`);
  };
  const faceReferences = values => {
    if (!values.length || new Set(values.map(faceKey)).size !== values.length) bad('Invalid planar arrangement face contributors');
    values.forEach(r => reference(r, 'faces'));
    return values;
  };
  if (faces.length !== body.faces.length || edges.length !== body.edges.length || nb.domains.length !== body.edges.length) bad('Incomplete native planar-arrangement domains or provenance');
  for (const origin of faces) {
    reference(origin.owner, 'faces');
    if (!faceReferences(array(origin.contributors)).some(r => faceKey(r) === faceKey(origin.owner))) bad('Planar arrangement face owner is absent from its contributors');
  }
  for (const origin of edges) {
    if (origin.$ === 'OriginalEdge') reference(origin, 'edges');
    else if (origin.$ === 'FaceIntersection') {
      reference(origin.first, 'faces'); reference(origin.second, 'faces');
      if (faceKey(origin.first) === faceKey(origin.second)) bad('Planar edge intersection requires distinct source faces');
    } else faceReferences(array(origin.faces));
  }
  const [required, allowance, resolution, volume, budgetA, budgetB, budgetMax] = nb.extra.map(real2);
  return { stats, faces, edges, audit: { $: 'Audit', valid, allowance, required, resolution, volume }, budgets: [budgetA, budgetB], budgetMax };
}

// Body JSON of one native body, with the fields the JS adapter of `node` sets.
// inputs: the decoded operand bodies of a Boolean ([target, tool] for a
// subtraction), source: the decoded source body of a transform.
export function bodyJson(nb, node, index, source = null, inputs = null) {
  if (nb.kind === 'poly') return decodePoly(nb, node, node.op === 'boolean' ? `${node.id}/${index}` : node.id, source);
  const id = node.op === 'transform' ? node.id : node.op === 'boolean' ? `${node.id}/${index}` : node.id;
  const body = decodeAnalytic(nb.solid, id, null);
  body.validation.scope = SCOPE_KERNEL; // the residual checks ran natively (kernel/lang/wk/real.bend validate)
  nb.domains.forEach((d, i) => { if (Array.isArray(d)) body.edges[i].curveRange = [number(d[0]), number(d[1])]; });
  if (nb.prim) {
    body.primitive = { type: 'frustum', bottom: coords(nb.prim.bottom), top: coords(nb.prim.top), r0: number(nb.prim.r0), r1: number(nb.prim.r1) };
    body.validation.volumeMm3 = number(nb.volume); body.validation.boundsMm = { min: coords(nb.bounds.low), max: coords(nb.bounds.high) };
    body.validation.scope = 'boundary topology; analytic frustum mass properties in Bend';
  }
  // A transform's budget is not set here: today's transformConstructionHistory
  // clones the source's after the construction (key order), in the replay.
  if (nb.budget && node.op !== 'transform') body.constructionBudget = constructionBudget(nb.budget);
  const setMeasures = scope => { body.validation.volumeMm3 = nb.volume ? number(nb.volume) : null; body.validation.boundsMm = nb.bounds ? { min: coords(nb.bounds.low), max: coords(nb.bounds.high) } : null; body.validation.scope = scope; };
  const operation = node.op === 'boolean' ? { union: 'UNION', subtract: 'SUBTRACTION', intersect: 'INTERSECTION' }[node.args.kind] : null;
  if (node.op === 'boolean' && nb.cons === 1) {
    setMeasures('boundary topology and endpoint incidence; coaxial cylinder Boolean volume and bounds in Bend');
    body.construction = { operation, method: 'coaxial radial/axial arrangement in Bend', axisToleranceMm: 1e-9, minimumIntervalMm: 1e-7 };
    NATIVE.set(body, { method: 'COAXIAL' });
  } else if (node.op === 'boolean' && (nb.cons === 2 || nb.cons === 3)) {
    if (!inputs) throw new Error(`bodyJson: planar node ${node.n} needs its decoded operands`);
    const p = planarProvenance(nb, node, inputs, body);
    setMeasures('Native Bend planar arrangement, closed topology and incidence audit; volume and tight vertex bounds in Bend');
    body.construction = { method: `native Bend planar arrangement ${nb.cons === 2 ? 'union' : 'subtraction'}`, operation, frameId: `${node.id}/input-frame`,
      sourceBudgetMm: number(nb.budget), requiredIncidenceMm: number(p.audit.required), allowanceMm: number(p.audit.allowance),
      numericResolutionMm: number(p.audit.resolution), stats: structuredClone(p.stats),
      ownership: 'owner is a deterministic representative; all matching original trimmed faces are retained as contributors',
      subdivision: 'FaceSubdivision edges are explicit arrangement subdivisions, not asserted operand intersections',
      faceOrigins: p.faces, edgeOrigins: p.edges,
      ...(nb.cons === 3 ? { contributorOrientation: 'operand 0 preserves its original orientation; operand 1 reverses its original orientation',
        faceContributorOrientations: p.faces.map(origin => array(origin.contributors).map(r => ({ ...r, reversed: r.operand === 1 }))) } : {}) };
    NATIVE.set(body, { method: 'PLANAR', stats: p.stats, audit: p.audit, budgets: p.budgets, budgetMax: p.budgetMax, nativeBudget: real2(nb.budget) });
  } else if (node.op === 'boolean' && nb.cons === 4) {
    if (!inputs) throw new Error(`bodyJson: pierce node ${node.n} needs its decoded operands`);
    if (nb.extra.length !== 1 || nb.pu.length !== 0) throw new MalformedNativeOutput(`pierce node ${node.n} evidence has ${nb.extra.length} reals and ${nb.pu.length} provenance words`);
    const tool = inputs[1].primitive, depthMm = number(nb.extra[0]);
    body.validation.volumeMm3 = number(nb.volume);
    body.validation.scope = inputs.some(input => regularizedSources(input).length)
      ? 'boundary topology; through-hole volume in Bend, exact relative to a regularized target (see exactness, regularizedSources)'
      : 'boundary topology; exact through-hole volume in Bend';
    body.construction = { method: 'native Bend through-hole pierce', operation, frameId: `${node.id}/input-frame`, sourceBudgetMm: number(nb.budget),
      radiusMm: tool.r0, depthMm,
      admission: 'the tool axis is perpendicular to exactly two target faces and its circle clears every boundary edge of both',
      subdivision: 'no face is subdivided; the two pierced faces gain an inner loop and one cylindrical wall is added' };
    NATIVE.set(body, { method: 'PIERCE', depthMm, radiusMm: tool.r0 });
  } else if (node.op === 'transform' && !nb.prim && nb.cons === 4) {
    // transformAnalytic: a rigid copy of a through-hole pierce keeps its exact volume; its bounds were never evaluated
    setMeasures(`boundary topology and endpoint incidence; ${source?.exactness ? 'rigidly preserved through-hole volume in Bend, exact relative to a regularized target (see exactness, regularizedSources)'
      : 'rigidly preserved exact through-hole volume in Bend'}; tight bounds not evaluated`);
    if (source?.construction) body.construction = structuredClone(source.construction);
  } else if (node.op === 'transform' && !nb.prim && [1, 2, 3].includes(nb.cons)) {
    setMeasures(nb.cons === 1 ? 'boundary topology and endpoint incidence; rigidly preserved Boolean volume and tight circular-rim bounds in Bend'
      : 'boundary topology and endpoint incidence; rigidly preserved planar Boolean volume and tight vertex bounds in Bend');
    if (source?.construction) body.construction = structuredClone(source.construction);
  }
  // src/boolean.mjs identify / src/analytic.mjs transformAnalytic: the inputs' approximation labels
  if (node.op === 'boolean') inheritExactness(body, inputs ?? []);
  else if (node.op === 'transform' && source) copyExactness(source, body);
  return body;
}

// --- identity replay ---------------------------------------------------------------------
//
// In record order, exactly the identity and evidence calls of today's adapters:
//   extrudeInBend  -> identifyExtrusion(points, plane, delta, startOffset, {primitive},
//                     the kept indices when the profile ring merged a vertex)
//   circularFrustumInBend -> identifyFrustum
//   booleanInBend  -> ensureBodyIdentity(a, b), then per method in its order:
//                     PLANAR  operationEvidence (before identify), audits,
//                             identify (construction.operation, identifyBoolean),
//                             attachOperationEvidence
//                     PIERCE  identify, operationEvidence, attachOperationEvidence
//                     COAXIAL identifyBoolean per component, operationEvidence,
//                             attachOperationEvidence
//                     (src/boolean.mjs), then opBoolean's name / appearance copy
//                     and its engine.operationEvidence push (src/library.mjs)
//   transformInBend / transformAnalytic -> transformConstructionHistory, identifyTransform
// then the tracker's metadata (source-map.mjs leave(): body.debug and
// identity.operation.source / parameters / callStack) for every body the
// operation created. `kernel` only needs kernel.identity (JS target or the
// native addon); `memo` caches identity-entry results by a SHA-256 of their
// arguments (ids included, so the key is in effect (full hash, op id)).
export function memoIdentityKernel(kernel, memo = new Map(), stats = { calls: 0, hits: 0 }) {
  const identity = new Proxy(kernel.identity, { get(target, name) {
    const fn = target[name];
    if (typeof fn !== 'function') return fn;
    return (...args) => {
      const key = createHash('sha256').update(`${String(name)}:${JSON.stringify(args)}`).digest('base64');
      if (memo.has(key)) { stats.hits++; return structuredClone(memo.get(key)); }
      stats.calls++;
      const value = fn(...args); memo.set(key, structuredClone(value)); return value;
    };
  } });
  return { kernel: { ...kernel, identity }, memo, stats };
}

const OPERATION_NAME = { union: 'UNION', subtract: 'SUBTRACTION', intersect: 'INTERSECTION' };
export const operandRefs = node => node.op === 'transform' ? [node.args.bodies]
  : node.op === 'boolean' ? (node.args.kind === 'subtract' ? [node.args.targets[0], node.args.tools[0]] : [node.args.tools[0], node.args.tools[1]])
    : node.op === 'expect_count' ? node.args.of : [];

// A V8 limit reached while building today's identity / evidence values
// (structured-clone or call-stack depth, string or array length): an explicit
// capability error at the node's FS span instead of a crash. Today's labels
// grow superlinearly with the length of a chain of dependent Booleans: every
// topology entry of a Boolean result carries an instance id that nests its
// parents' ids (kernel/identity.bend), and operationHistory nests the inputs'
// identity and history (src/construction-history.mjs); measured in
// docs/language/prototype.md (chain of N holes). A heap exhaustion cannot be
// caught, so the replay also stops with the same capability error once the
// heap in use exceeds heapBudget x the V8 heap limit (default 0.6): a guard
// against the crash, which may stop somewhat early while garbage is not yet
// collected, never a fallback. release drops consumed intermediate bodies.
const V8_LIMIT = /Maximum call stack size exceeded|Invalid string length|Invalid array length|out of memory|could not be cloned|Data cannot be cloned/i;
function limitError(error, node, loc) {
  const e = new UnsupportedFeatureError(`host identity replay of node %${node.n} (${node.op} ${node.id}) reached a V8 limit (${error.name}: ${String(error.message).slice(0, 160)}); a chain of dependent Booleans this long exceeds what the host replay can hold in this heap`, loc ?? undefined);
  e.cause = error;
  return e;
}
export const heapLimit = () => v8.getHeapStatistics().heap_size_limit;

// options.release: drop the body JSON of a node once its last consumer is
// replayed (never an output node's); options.outputs: the node indexes to keep;
// options.heapBudget: fraction of the V8 heap limit (see above; 0 disables).
export function replayIdentity(graph, nodeBodies, { kernel, sourceMap, modelingPolicy, tracked = true, release = false, outputs = [], heapBudget = 0.6 }) {
  const budget = heapBudget > 0 ? heapBudget * heapLimit() : Infinity;
  const operations = sourceMap?.operations ?? [];
  const policy = normalizeModelingPolicy(modelingPolicy);
  const evidence = [], identities = new Map(); // bodyId -> the source-map identity summary (kept when bodies are released)
  const bodiesOf = ref => nodeBodies.get(ref.node) ?? [];
  const lastUse = new Map(), keep = new Set(outputs);
  for (const node of graph.nodes) for (const r of operandRefs(node)) lastUse.set(r.node, node.n);
  const overwrite = (node, bodies) => {
    const record = operations[node.sequence];
    if (!tracked || !record) return;
    for (const body of bodies) {
      body.debug = { sourceOperation: record.sequence, operationId: record.operationId, source: record.source, callStack: record.callStack };
      if (body.identity?.operation) {
        body.identity.operation.source = record.source;
        body.identity.operation.parameters = record.parameters;
        body.identity.operation.callStack = record.callStack;
      }
    }
  };
  for (const node of graph.nodes) {
    const a = node.args, bodies = nodeBodies.get(node.n);
    const loc = node.span >= 0 ? graph.spans[node.span] : null;
    if (bodies) try {
      if (node.op === 'extrude_polygon') {
        for (const body of bodies) identifyExtrusion(kernel, body, node.id, a.points, a.plane, a.delta, a.offset ?? [0, 0, 0], a.primitive ?? (node.attrs?.primitive ? { primitive: node.attrs.primitive } : {}),
          body.construction?.profileMerge?.kept ?? null);
      } else if (node.op === 'frustum') {
        const circle = c => c && { type: 'circle', center: c.center, radius: c.radius, plane: c.plane };
        for (const body of bodies) identifyFrustum(kernel, body, node.id, { first: circle(a.first), second: circle(a.second), delta: a.delta ?? null, startOffset: a.offset ?? [0, 0, 0] });
      } else if (node.op === 'boolean') {
        const operation = OPERATION_NAME[a.kind];
        const inputs = operandRefs(node).map(r => bodiesOf(r)[0]);
        for (const input of inputs) ensureBodyIdentity(kernel, input);
        const identify = (body, i) => identifyBoolean(kernel, body, node.id, operation, inputs, i,
          { modelingPolicy: policy, source: { file: null, sha256: null, span: loc ? { line: loc.line, column: loc.column } : null } });
        const facts = NATIVE.get(bodies[0]);
        if (!facts || bodies.some(b => NATIVE.get(b)?.method !== facts.method)) throw new Error(`replay: Boolean node ${node.n} has no native method facts`);
        let e;
        if (facts.method === 'PLANAR') {
          e = operationEvidence(node.id, operation, inputs, policy, { method: `native Bend planar arrangement ${operation === 'UNION' ? 'union' : 'subtraction'}`,
            status: 'Bodies', sourceBudget: facts.budgetMax, nativeSourceBudget: facts.nativeBudget, inputBudgets: facts.budgets,
            tolerance: intersectionTolerance(), stats: facts.stats });
          e.audits = bodies.map((body, component) => ({ component, ...NATIVE.get(body).audit }));
          bodies.forEach((body, i) => { body.construction.operation = operation; identify(body, i); });
          attachOperationEvidence(bodies, e);
        } else if (facts.method === 'PIERCE') {
          bodies.forEach((body, i) => { body.construction.operation = operation; identify(body, i); });
          e = operationEvidence(node.id, operation, inputs, policy, { method: 'native Bend through-hole pierce', status: 'Bored', depthMm: facts.depthMm, radiusMm: facts.radiusMm });
          attachOperationEvidence(bodies, e);
        } else {
          bodies.forEach(identify);
          e = operationEvidence(node.id, operation, inputs, policy, { method: 'coaxial radial/axial arrangement in Bend', status: 'Resolved' });
          attachOperationEvidence(bodies, e);
        }
        // opBoolean: name / appearance of the target body object as it was when the
        // operation ran (setProperty mutates it in place; the recorder's props)
        const props = new Map(node.attrs?.props ?? []);
        for (const body of bodies) for (const key of ['name', 'appearance']) if (props.get(key) !== undefined) body[key] = props.get(key);
        evidence.push(e);
      } else if (node.op === 'transform') {
        // transformInBend (polyhedral): name / appearance when truthy, then the history;
        // transformAnalytic: the history, then name / appearance when defined. The
        // values are those of the source body object when the pattern ran (props).
        const source = bodiesOf(a.bodies)[0], props = new Map(node.attrs?.props ?? []);
        for (const body of bodies) {
          const poly = body.geometry !== 'analytic';
          if (poly) for (const key of ['name', 'appearance']) if (props.get(key)) body[key] = props.get(key);
          transformConstructionHistory(source, body, node.id, a.rotation, a.offset);
          if (!poly) for (const key of ['name', 'appearance']) if (props.get(key) !== undefined) body[key] = props.get(key);
          identifyTransform(kernel, source, body, node.id, a.rotation, a.offset);
        }
      }
      overwrite(node, bodies);
      for (const body of bodies) if (body.identity) identities.set(body.id, { originId: body.identity.originId, instanceId: body.identity.instanceId, revision: body.identity.revision });
    } catch (error) {
      if (error instanceof RangeError || error?.name === 'DataCloneError' || V8_LIMIT.test(String(error?.message))) throw limitError(error, node, loc);
      throw error;
    }
    if (release) for (const r of operandRefs(node)) if (lastUse.get(r.node) === node.n && !keep.has(r.node)) nodeBodies.delete(r.node);
    if (bodies && budget < Infinity) {
      const used = process.memoryUsage().heapUsed;
      if (used > budget) throw limitError(new RangeError(`heap in use ${Math.round(used / 1e6)} MB exceeds ${heapBudget} of the ${Math.round(heapLimit() / 1e6)} MB V8 heap limit`), node, loc);
    }
  }
  return { evidence, identities };
}

// --- comparison ------------------------------------------------------------------------------
const volumeWords = v => v == null ? null : [Math.fround(v), Math.fround(v - Math.fround(v))];
// B-rep hash: vertices, edges with curve ranges, faces, primitive, construction
// budget, volume and bounds (the stored geometry of a body, identity excluded).
export function brepHash(body) {
  const g = { geometry: body.geometry ?? 'planar', vertices: body.vertices, edges: body.edges, faces: body.faces, primitive: body.primitive ?? null,
    constructionBudget: body.constructionBudget ?? null, volumeMm3: body.validation?.volumeMm3 ?? null, boundsMm: body.validation?.boundsMm ?? null };
  return createHash('sha256').update(JSON.stringify(g)).digest('hex').slice(0, 16);
}
export function bodySummary(body) {
  return { id: body.id, name: body.name ?? null, faces: body.faces.length, revision: geometryRevision(body), brep: brepHash(body),
    volumeWords: volumeWords(body.validation?.volumeMm3), identity: body.identity ? createHash('sha256').update(JSON.stringify(body.identity)).digest('hex').slice(0, 16) : null };
}

// Largest coordinate difference between two bodies with the same topology (mm):
// a diagnostic that locates a difference; every comparison of this spike
// expects bit equality.
export function maxDeviation(a, b) {
  let max = 0;
  const walk = (x, y) => {
    if (typeof x === 'number' && typeof y === 'number') { max = Math.max(max, Math.abs(x - y)); return; }
    if (Array.isArray(x) && Array.isArray(y) && x.length === y.length) { x.forEach((v, i) => walk(v, y[i])); return; }
    if (x && y && typeof x === 'object' && typeof y === 'object') { for (const k of Object.keys(x)) walk(x[k], y[k]); return; }
    if (x !== y) max = Infinity;
  };
  walk({ v: a.vertices, e: a.edges, f: a.faces, vol: a.validation?.volumeMm3 }, { v: b.vertices, e: b.edges, f: b.faces, vol: b.validation?.volumeMm3 });
  return max;
}

export function writeStream(path, enc) { writeFileSync(path, enc.text); }
