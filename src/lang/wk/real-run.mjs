// Glue of the WK real-model spike (docs/language.md section 12): record a real
// FeatureScript part, evaluate its graph natively, turn the native node values
// into today's body JSON (identity and operation evidence included), and
// compare with today's path. Used by scripts/lang/wk-real.mjs and
// test/lang-wk-real.test.mjs.
import { readFileSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { recordFile, recordFeatureScript, annotateMethods } from './record-fs.mjs';
import { UnsupportedFeatureError } from '../../errors.mjs';
import { number } from '../../real.mjs';
import { encodeReal, runNative, parseOutput, splitBodies, bodyJson, replayIdentity, bodySummary, geomHashes, fullHashes, maxDeviation, operandRefs, precheck, pierceInputs, nonFiniteInputs, MalformedNativeOutput } from './real-host.mjs';

export const BINARY = new URL('../../../out/lang/wk/real/build/wk-real', import.meta.url).pathname;
export { MalformedNativeOutput };

export function recordCase(file, feature) {
  const t0 = performance.now();
  const rec = recordFile(file, { feature: feature ?? undefined });
  annotateMethods(rec.graph);
  rec.recordMs = performance.now() - t0;
  return rec;
}

// A native capability message carries its Real details (the polygon prism's
// required / before / allowance) as [[R:<hi bits>:<lo bits>]] (kernel/lang/wk/real.bend
// rmark); today's text is number(x).toExponential(3) (src/kernel.mjs refusePrism).
const REAL_MARK = /\[\[R:(\d+):(\d+)\]\]/g;
export const nativeMessage = message => message.replace(REAL_MARK, (_, hi, lo) => number({ hi: f32Bits(Number(hi)), lo: f32Bits(Number(lo)) }).toExponential(3));

// Native node values -> Map(node -> { native: [split bodies] } | { error } | { ok }).
// expected: the nodes that were sent (encodeReal keys). The node lines must be
// exactly those, each once; anything else is a malformed output, never "no error".
export function nodeValues(graph, out, expected = graph.nodes.map(n => n.n)) {
  const want = new Set(expected), got = [...out.values.keys()];
  const missing = [...want].filter(k => !out.values.has(k)), unexpected = got.filter(k => !want.has(k));
  if (missing.length || unexpected.length || got.length !== want.size) {
    throw new MalformedNativeOutput(`node lines do not match the nodes sent (missing ${missing.slice(0, 10).join(',') || 'none'}${missing.length > 10 ? ', ...' : ''}; unexpected ${unexpected.slice(0, 10).join(',') || 'none'})`);
  }
  const values = new Map();
  for (const [key, v] of out.values) {
    if (!v) throw new MalformedNativeOutput(`node ${key} has no value`);
    if (v.error) values.set(key, { error: { ...v.error, message: nativeMessage(v.error.message), line: graph.spans[v.error.span]?.line ?? null, column: graph.spans[v.error.span]?.column ?? null } });
    else if (v.ok) values.set(key, { ok: true });
    else values.set(key, v.postError ? { native: splitBodies(v), postError: v.postError } : { native: splitBodies(v) });
  }
  return values;
}

// Error code of a host-side error with production semantics: a FeatureScriptError
// is catchable in FS (2), an UnsupportedFeatureError is not (1), a JS RangeError
// (real()) is no FeatureScript error at all and is never caught (5).
export const hostCode = e => e?.name === 'UnsupportedFeatureError' || e?.name === 'GraphBreak' ? 1 : e?.name === 'FeatureScriptError' ? 2 : 5;
// ownLine / ownColumn: the location production's decoder gave its error (usually none).
const hostError = (graph, node, e, origin) => ({ code: hostCode(e), span: node.span, message: String(e.message), line: graph.spans[node.span]?.line ?? null, column: graph.spans[node.span]?.column ?? null, origin,
  ownLine: e?.line ?? null, ownColumn: e?.column ?? null });

// Body JSON per node (graph order, so a transform sees its decoded source and a
// Boolean its decoded operands). The production decoders run here (decodePrism's
// validateSolid, decodeAnalytic's structural checks); a node they reject gets
// that FeatureScript error as its value, at its span, exactly like a native
// error, and every dependent node carries it (the native values of dependents
// are discarded: they were computed from a body today's path never publishes).
// values is updated in place, so firstError sees these errors. A PIERCE value
// with a postError (the target's missing volume or its real() RangeError, which today raises
// after the decode) gets it once its decode succeeded. state (optional): the
// decode so far (staged evaluation); nodes without a value yet are left for
// a later call.
export const materializeState = () => ({ bodies: new Map(), failed: new Map(), done: new Set() });
export function materialize(graph, values, state = materializeState()) {
  const { bodies, failed, done } = state;
  for (const node of graph.nodes) {
    if (done.has(node.n)) continue;
    const inherited = operandRefs(node).map(r => failed.get(r.node)).find(Boolean);
    if (inherited) { failed.set(node.n, inherited); values.set(node.n, { error: inherited }); done.add(node.n); continue; }
    const v = values.get(node.n);
    if (v?.error) { failed.set(node.n, v.error); done.add(node.n); continue; }
    if (!v?.native) { if (v?.ok) done.add(node.n); continue; }
    // an operand without a value yet (a later stage, or a clean node that was not sent): decode later
    if (operandRefs(node).some(r => !bodies.has(r.node))) continue;
    done.add(node.n);
    const refs = operandRefs(node).map(r => bodies.get(r.node)?.[0] ?? null);
    const source = node.op === 'transform' ? refs[0] : null, inputs = node.op === 'boolean' ? refs : null;
    try { bodies.set(node.n, v.native.map((nb, i) => bodyJson(nb, node, i, source, inputs))); }
    catch (e) {
      if (e instanceof MalformedNativeOutput || !['FeatureScriptError', 'UnsupportedFeatureError', 'RangeError'].includes(e?.name)) throw e;
      const error = hostError(graph, node, e, 'host-decode');
      failed.set(node.n, error); values.set(node.n, { error });
      continue;
    }
    if (v.postError) {
      const error = { ...v.postError, line: graph.spans[node.span]?.line ?? null, column: graph.spans[node.span]?.column ?? null };
      bodies.delete(node.n); failed.set(node.n, error); values.set(node.n, { error });
    }
  }
  return bodies;
}

// Output bodies in production store order, with the names/appearances their
// body objects hold at the end (setProperty writes them in place, so a key
// set after the body was created comes last, in the order it was first set:
// o.props is the handle's key order). Shallow copies: the per-node bodies stay
// as the operations made them.
export function outputBodies(rec, nodeBodies) {
  return rec.outputs.map(o => {
    const body = nodeBodies.get(o.ref.node)?.[0];
    if (!body) return null;
    const out = { ...body };
    for (const [key, value] of o.props ?? [['name', o.name], ['appearance', o.appearance]].filter(([, v]) => v != null)) out[key] = value;
    return out;
  });
}

// Nodes whose F32x2 args fail real()'s precondition (real-host.mjs precheck),
// plus every node depending on them: not sent; their raw value is the error.
// literals / skip: nodes that are not evaluated (known values, or not needed).
export function hostPrechecked(rec, { literals = new Map(), skip = new Set() } = {}) {
  const graph = rec.graph;
  const bad = precheck(graph, graph.nodes.filter(n => !literals.has(n.n) && !skip.has(n.n)));
  const raw = new Map();
  for (const node of graph.nodes) {
    if (literals.has(node.n) || skip.has(node.n)) continue;
    const inherited = operandRefs(node).map(r => raw.get(r.node)).find(Boolean);
    if (inherited) raw.set(node.n, inherited);
    else if (bad.has(node.n)) raw.set(node.n, { error: { code: 5, span: node.span, message: bad.get(node.n).message, origin: 'host-precheck' } });
  }
  return raw;
}

const isPierce = node => node.op === 'boolean' && node.args.method === 'PIERCE';
// A cached raw value (u / f words) as the literal node payload of real-host.mjs encodeReal.
const literalOf = v => {
  const r = [];
  for (let i = 0; i < v.f.length; i += 2) r.push([f32Bits(v.f[i]), f32Bits(v.f[i + 1])]);
  return { u: [v.count, ...v.u], r };
};
const rawOfLiteral = lit => {
  const bits = x => { const b = new DataView(new ArrayBuffer(4)); b.setFloat32(0, x); return b.getUint32(0); };
  return { count: lit.u[0], u: lit.u.slice(1), f: lit.r.flatMap(([hi, lo]) => [bits(hi), bits(lo)]) };
};

// --- staged evaluation (verifier round 3) -----------------------------------------------------
//
// A PIERCE node needs three inputs that today's adapter computes in host
// binary64 from its decoded operands (real-host.mjs pierceInputs: the tool
// axis and reach from Math.hypot and divisions, the target volume
// real(a.validation.volumeMm3), a validateSolid integral for a polyhedral
// target). Bend has no binary64, and an F32x2 emulation differed from today by
// up to 0.034 mm^3. So the graph runs in stages: a PIERCE node runs one stage
// after the operands it depends on; stage s sends its nodes, their operands
// from earlier stages (or the cache) as literal nodes, and each PIERCE node's
// host inputs, which today's code computes from the operands' body JSON
// (materialize, i.e. today's decoders). A graph without PIERCE nodes is one
// stage, exactly as before; a graph whose PIERCE nodes depend on no other
// PIERCE (every measured part) is two. A node with a non-finite F32 kernel
// input (real-host.mjs nonFiniteInputs) is a stage boundary for its
// dependents in the same way. With the in-process binding a stage is a call,
// not a process.
//   options.known: Map node -> raw native value (host cache hits; not evaluated)
//   options.literals / options.skip: the older incremental interface (literal
//     payloads of clean operands, clean nodes nobody needs)
export async function evaluateStages(rec, { binary = BINARY, mode = 'fork', threads = 1, reps = 1, file, known = null, literals = null, skip = null } = {}) {
  const graph = rec.graph;
  const t0 = performance.now();
  known = new Map(known ?? []);
  if (literals) for (const [n, lit] of literals) if (!known.has(n)) known.set(n, rawOfLiteral(lit));
  const exclude = new Set(skip ?? []);
  const hostRaw = hostPrechecked(rec, { literals: known, skip: exclude });
  const evaluated = graph.nodes.filter(n => !known.has(n.n) && !exclude.has(n.n) && !hostRaw.has(n.n));
  const inEval = new Set(evaluated.map(n => n.n)), stage = new Map();
  // a node whose F32 kernel input is not finite is a boundary too: nothing native
  // consumes its result before today's decoder has seen it (real-host.mjs nonFiniteInputs)
  const barrier = nonFiniteInputs(graph);
  for (const node of evaluated) {
    const up = operandRefs(node).filter(r => inEval.has(r.node)).map(r => stage.get(r.node) + (isPierce(node) || barrier.has(r.node) ? 1 : 0));
    stage.set(node.n, up.length ? Math.max(...up) : 0);
  }
  const stages = evaluated.length ? Math.max(...stage.values()) + 1 : 0;
  // raw native values of every node known so far, and their host view (values)
  const raw = new Map(known);
  for (const [n, v] of hostRaw) raw.set(n, v);
  const values = new Map();
  const view = (n, v) => {
    if (v.error) return { error: { ...v.error, line: graph.spans[v.error.span]?.line ?? null, column: graph.spans[v.error.span]?.column ?? null } };
    if (v.ok) return { ok: true };
    const out = { native: splitBodies(v) };
    if (v.postError) out.postError = v.postError;
    return out;
  };
  for (const [n, v] of raw) values.set(n, view(n, v));
  const state = materializeState();
  const acc = { decodeUs: 0, repsUs: null, nodeUs: new Map(), wallMs: 0, encodeMs: performance.now() - t0, parseMs: 0, hostDecodeMs: 0, tokens: 0, keys: [], levels: [], evaluated: 0, inherited: 0, stdout: '' };
  const stageRows = [];
  for (let s = 0; s < stages; s++) {
    const members = [];
    const hostInputs = new Map();
    if (s > 0 || evaluated.some(n => stage.get(n.n) === s && isPierce(n))) {
      const t = performance.now();
      materialize(graph, values, state); // today's decoders on everything known or evaluated so far
      acc.hostDecodeMs += performance.now() - t;
    }
    const t1 = performance.now();
    for (const node of evaluated) {
      if (stage.get(node.n) !== s) continue;
      // an operand that failed in an earlier stage (natively or in today's decoder): inherit, do not send
      const inherited = operandRefs(node).map(r => state.failed.get(r.node) ?? (raw.get(r.node)?.error ? values.get(r.node).error : null)).find(Boolean);
      if (inherited) { raw.set(node.n, { error: inherited }); values.set(node.n, { error: inherited }); acc.inherited++; continue; }
      if (isPierce(node)) {
        const [a, b] = operandRefs(node).map(r => state.bodies.get(r.node)?.[0] ?? null);
        if (!a || !b) throw new Error(`WK stage ${s}: PIERCE node %${node.n} has undecoded operands`);
        hostInputs.set(node.n, pierceInputs(a, b));
      }
      members.push(node);
    }
    if (!members.length) continue;
    const memberSet = new Set(members.map(n => n.n));
    const lits = new Map(), needed = new Set();
    for (const node of members) for (const r of operandRefs(node)) if (!memberSet.has(r.node)) needed.add(r.node);
    for (const n of needed) {
      const v = raw.get(n);
      if (!v || v.error || v.ok) throw new Error(`WK stage ${s}: operand %${n} has no body value to send as a literal`);
      lits.set(n, literalOf(v));
    }
    const skipNow = new Set(graph.nodes.filter(n => !memberSet.has(n.n) && !lits.has(n.n)).map(n => n.n));
    const enc = encodeReal(graph, { literals: lits, skip: skipNow, hostInputs });
    const stageFile = s === 0 ? file : `${file}.s${s}`;
    writeFileSync(stageFile, enc.text);
    acc.encodeMs += performance.now() - t1;
    const run = await runNative(binary, stageFile, { mode, threads, reps });
    const t2 = performance.now();
    const out = parseOutput(run.stdout);
    nodeValues(graph, out, enc.keys); // strict: exactly the nodes sent, each once
    for (const node of members) {
      const v = out.values.get(node.n);
      const h = hostInputs.get(node.n);
      // today raises the missing-volume capability error (or real()'s RangeError) after the pierce and the decode
      if (h?.status === 3 && !v.error) Object.defineProperty(v, 'postError', { value: { code: hostCode(h.error), span: node.span, message: String(h.error.message), origin: 'host-pierce' }, enumerable: false });
      raw.set(node.n, v); values.set(node.n, view(node.n, v));
      if (out.nodeUs.has(node.n)) acc.nodeUs.set(node.n, out.nodeUs.get(node.n));
    }
    acc.decodeUs += out.decodeUs;
    acc.repsUs = acc.repsUs ? acc.repsUs.map((x, i) => x + (out.repsUs[i] ?? 0)) : [...out.repsUs];
    acc.wallMs += run.wallMs; acc.stdout += run.stdout; acc.tokens += enc.tokens; acc.keys.push(...members.map(n => n.n)); acc.levels.push(...enc.levels); acc.evaluated += members.length;
    acc.parseMs += performance.now() - t2;
    stageRows.push({ stage: s, file: stageFile, members: members.map(n => n.n), nodes: members.length, pierce: members.filter(isPierce).length, literals: lits.size, tokens: enc.tokens, levels: enc.levels.length,
      wallMs: run.wallMs, decodeUs: out.decodeUs, repsUs: out.repsUs, hostInputs: [...hostInputs].map(([n, h]) => ({ node: n, status: h.status })) });
  }
  const out = { decodeUs: acc.decodeUs, repsUs: acc.repsUs ?? [0], nodeUs: acc.nodeUs, values: raw };
  const enc = { tokens: acc.tokens, keys: acc.keys, levels: acc.levels, evaluated: acc.evaluated, inherited: acc.inherited };
  // run.stdout: the stages' outputs concatenated (their N lines are the evaluated nodes and the echoed literals)
  return { enc, encodeMs: acc.encodeMs, run: { wallMs: acc.wallMs, stdout: acc.stdout }, out, values, hostRaw, parseMs: acc.parseMs, hostDecodeMs: acc.hostDecodeMs, stages: stageRows };
}

// --- try replay (verifier round 3) ---------------------------------------------------------------
//
// A kernel failure inside a FeatureScript try changes host control flow: the
// handler runs (Marc's decorate idiom rethrows `regenError("R4 build: " ~ e)`,
// `try silent` continues). The first failing node in record (execution) order
// decides: if its error is catchable (code 2, a FeatureScriptError today) and
// the node sits in a try, the recording is REPLAYED with that failure known
// (record-fs.mjs options.failures): the recording builtin throws today's error
// object at that call and the unchanged interpreter runs the real handler.
// Values of nodes whose content (geom hash) did not change are reused. This
// repeats until the first failure is not caught (or there is none). The error
// object is today's: its message, and today's location (the adapters raise
// most kernel failures without one; todayLocation).
//
// Native messages that are NOT today's text (the evaluator's residual-check
// failures summarize what validateAnalytic words per vertex) are not replayed:
// such a failure inside a try stays an explicit, located error (explainError).
const INEXACT_MESSAGE = /^analytic (body edge \d+ misses its curve|boundary vertex misses face \d+|line edge leaves a cylinder face) \(residual above 0\.0003 mm\)$/;
// Where today's error carries a location: [line, column] or null. Today's
// adapters raise their own checks of a Boolean with the opBoolean location
// (src/boolean.mjs, src/planar-boolean.mjs: fail / unsupported(..., loc));
// circularFrustumInBend, transformInBend / transformAnalytic, decodeAnalytic,
// validateSolid and real() raise without one; src/library.mjs body() gives an
// extrusion error without a line the call location.
export function todayLocation(rec, node, error) {
  const loc = node.span >= 0 ? rec.graph.spans[node.span] : null;
  let at = null;
  if (error.origin === 'host-decode') at = error.ownLine != null ? [error.ownLine, error.ownColumn ?? null] : null;
  else if (error.origin === 'native' || error.origin == null) {
    if (node.op === 'boolean' && error.code !== 5 && !INEXACT_MESSAGE.test(error.message)) at = loc ? [loc.line, loc.column] : null;
  }
  if (!at && node.op === 'extrude_polygon' && loc) at = [loc.line, loc.column];
  return at;
}
// Errors only the WK path raises (today builds these, or they are WK
// speculation / stream checks): located at the op's FS span.
const WK_ONLY = /^(Boolean method (CURVED|PLANAR_INTERSECT) \(.*\) is not in the WK native evaluator|Boolean method speculation failed|WK op code \d+ is not in the native evaluator|unknown Boolean method code|malformed |count speculation failed|WK reference outside|coaxial operand is not|pierce tool is not|Boolean expects bodies|transform expects bodies)/;
export const todayRaises = error => [1, 2, 5].includes(error.code) && !WK_ONLY.test(error.message);
const replayable = error => error.code === 2 && !INEXACT_MESSAGE.test(error.message);
// Which replayed kernel failure FeatureScript can catch (W1 try semantics,
// src/errors.mjs catchable): only a raise() of today's adapters, i.e. a
// FeatureScriptException; every other failure is a fail() (FeatureScriptError)
// that try / try silent let through. The one raise() among the adapters the WK
// evaluator mirrors is circularFrustumInBend's zero height (src/analytic.mjs).
const CATCHABLE_KERNEL_FAILURES = new Set(['Circular loft/extrusion has zero or unresolved height']);
export const replayName = message => CATCHABLE_KERNEL_FAILURES.has(message) ? 'FeatureScriptException' : 'FeatureScriptError';
function firstFailing(rec, values) {
  for (const node of rec.graph.nodes) { const v = values.get(node.n); if (v?.error) return { node, error: v.error }; }
  return null;
}
export const MAX_REPLAYS = 200;

export async function evaluate(rec, options = {}) {
  let ev = await evaluateStages(rec, options);
  const replays = [];
  const hasTry = () => rec.graph.nodes.some(n => n.attrs?.try);
  while (hasTry()) {
    const t0 = performance.now();
    materialize(rec.graph, ev.values); // today's decoder errors are errors of their node too
    const first = firstFailing(rec, ev.values);
    if (!first || !first.node.attrs?.try || !replayable(first.error) || first.node.attempt == null) break;
    if (replays.length >= MAX_REPLAYS) throw new UnsupportedFeatureError(`more than ${MAX_REPLAYS} kernel failures inside FeatureScript try blocks; the WK host stops replaying`, rec.graph.spans[first.node.span] ?? undefined);
    const at = todayLocation(rec, first.node, first.error);
    const failure = { op: first.node.op, id: first.node.id, line: rec.graph.spans[first.node.span]?.line ?? null, column: rec.graph.spans[first.node.span]?.column ?? null,
      error: { name: replayName(first.error.message), message: first.error.message, line: at?.[0] ?? null, column: at?.[1] ?? null } };
    const failures = new Map(rec.failures ?? []);
    failures.set(first.node.attempt, failure);
    // reuse every value whose content did not change
    const cache = cacheStore(new Map(), rec, ev.out.values);
    const next = recordFeatureScript(rec.input.source, { ...rec.input.options, failures });
    annotateMethods(next.graph);
    next.recordMs = performance.now() - t0;
    next.failures = failures;
    const geom = geomHashes(next.graph), known = new Map();
    for (const node of next.graph.nodes) if (cache.has(geom[node.n])) known.set(node.n, cache.get(geom[node.n]));
    replays.push({ attempt: first.node.attempt, node: first.node.n, id: first.node.id, try: first.node.attrs.try, error: failure.error, reused: known.size, recordMs: next.recordMs });
    Object.assign(rec, next);
    ev = await evaluateStages(rec, { ...options, known, literals: null, skip: null });
  }
  return { ...ev, replays };
}

// options.release: keep only the output nodes' bodies after the identity replay
// (bounded host memory for long Boolean chains; per-node comparisons need false).
export function assemble(rec, values, identityKernel, { modelingPolicy, release = false } = {}) {
  const t0 = performance.now();
  const nodeBodies = materialize(rec.graph, values);
  const decodeMs = performance.now() - t0;
  const t1 = performance.now();
  const outputNodes = rec.outputs.map(o => o.ref.node);
  const replay = replayIdentity(rec.graph, nodeBodies, { kernel: identityKernel, sourceMap: rec.sourceMap, modelingPolicy, release, outputs: outputNodes });
  const identityMs = performance.now() - t1;
  const outputs = outputBodies(rec, nodeBodies);
  return { nodeBodies, outputs, evidence: replay.evidence, identities: replay.identities, decodeMs, identityMs };
}

// The model-level parts of today's build() result that the native path
// reproduces: bodies, operationEvidence (the real evidence of every Boolean, in
// execution order; the recorder's engine only holds count placeholders, see
// record-fs.mjs) and the source map, whose operation outputs carry the identity
// summary of each created body (source-map.mjs leave()).
export function assembleModel(rec, asm) {
  const sourceMap = structuredClone(rec.sourceMap);
  for (const record of sourceMap.operations) for (const out of record.outputs ?? []) {
    const summary = asm.identities.get(out.bodyId);
    if (summary) out.identity = { ...summary };
  }
  return { operationEvidence: asm.evidence, sourceMap, bodies: asm.outputs };
}

// The model as JSON for export. Beyond V8's maximum string length (about
// 512 MB, reached by today's identity / evidence labels on a plate with about
// 20 chained holes, docs/language/prototype.md) this is an explicit capability
// error at the FS span of the first output's operation, not a crash.
export function modelJson(rec, model) {
  try { return JSON.stringify(model); }
  catch (error) {
    if (!(error instanceof RangeError)) throw error;
    const node = rec.outputs[0] ? rec.graph.nodes[rec.outputs[0].ref.node] : null, loc = node && node.span >= 0 ? rec.graph.spans[node.span] : undefined;
    const e = new UnsupportedFeatureError(`the model JSON exceeds a V8 limit (${error.message}): today's identity labels and operation evidence grow superlinearly with the length of a chain of dependent Booleans; outputs ${rec.outputs.map(o => o.bodyId).join(', ').slice(0, 200)}`, loc);
    e.cause = error;
    throw e;
  }
}

// --- comparison -----------------------------------------------------------------------------------
//
// deepDiff: every field of two JSON-like values (numbers with Object.is, so
// -0 != +0 and NaN == NaN; key sets, array lengths). A difference is reported
// by path. jsonIdentical additionally requires the same key order (byte-equal
// JSON).
export function deepDiff(a, b, { limit = 50, path = '' } = {}) {
  const out = [];
  const walk = (x, y, p) => {
    if (out.length >= limit) return;
    if (typeof x === 'number' && typeof y === 'number') { if (!Object.is(x, y)) out.push({ path: p, native: x, reference: y, delta: x - y }); return; }
    if (x === null || y === null || typeof x !== 'object' || typeof y !== 'object') { if (x !== y) out.push({ path: p, native: short(x), reference: short(y) }); return; }
    if (Array.isArray(x) !== Array.isArray(y)) { out.push({ path: p, native: 'array/object', reference: 'object/array' }); return; }
    if (Array.isArray(x) && x.length !== y.length) out.push({ path: `${p}.length`, native: x.length, reference: y.length });
    for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) {
      if (!Object.hasOwn(x, k) || x[k] === undefined) { if (y[k] !== undefined) out.push({ path: `${p}.${k}`, native: 'missing', reference: short(y[k]) }); continue; }
      if (!Object.hasOwn(y, k) || y[k] === undefined) { out.push({ path: `${p}.${k}`, native: short(x[k]), reference: 'missing' }); continue; }
      walk(x[k], y[k], `${p}.${k}`);
      if (out.length >= limit) return;
    }
  };
  walk(a, b, path);
  return out;
}
const short = v => { const s = JSON.stringify(v); return s === undefined ? String(v) : s.length > 120 ? `${s.slice(0, 117)}...` : s; };
export const jsonIdentical = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Field-by-field comparison of two body lists (null entries are missing bodies).
// equal: the complete body JSON is deep-equal (every field, operationHistory,
// construction and identity included); the summary fields locate a difference.
export function compareLists(a, b) {
  const rows = [];
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a[i], y = b[i];
    if (!x || !y) { rows.push({ index: i, missing: !x ? 'native' : 'reference', equal: false }); continue; }
    const sx = bodySummary(x), sy = bodySummary(y);
    const diffs = deepDiff(x, y);
    const row = { index: i, id: sx.id, equal: diffs.length === 0, jsonIdentical: diffs.length === 0 && jsonIdentical(x, y), diffCount: diffs.length,
      diffs: diffs.slice(0, 12), faces: sx.faces === sy.faces, revision: sx.revision === sy.revision, brep: sx.brep === sy.brep,
      volumeWords: JSON.stringify(sx.volumeWords) === JSON.stringify(sy.volumeWords), identity: sx.identity === sy.identity, name: sx.name === sy.name };
    if (!row.revision || !row.brep) row.maxDeviationMm = maxDeviation(x, y);
    rows.push(row);
  }
  return rows;
}

// Whole-model comparison against today's build() result (bodies, evidence, source map).
export function compareModels(native, today) {
  const bodies = compareLists(native.bodies, today.bodies);
  const evidence = deepDiff(native.operationEvidence, today.operationEvidence, { path: 'operationEvidence' });
  const sourceMap = deepDiff(native.sourceMap, today.sourceMap, { path: 'sourceMap' });
  return { equal: bodies.length === today.bodies.length && bodies.every(r => r.equal) && !evidence.length && !sourceMap.length,
    jsonIdentical: bodies.every(r => r.jsonIdentical) && jsonIdentical(native.operationEvidence, today.operationEvidence) && jsonIdentical(native.sourceMap, today.sourceMap),
    bodies, evidence: evidence.slice(0, 12), sourceMap: sourceMap.slice(0, 12) };
}

// Work, span and bound from per-node times, next to the op-count bound (heavy = boolean).
export function costWeighted(graph, nodeUs) {
  const deps = node => operandRefs(node).map(r => r.node);
  const finish = new Map(), heavyDepth = new Map();
  let work = 0, heavyCount = 0, heavyWork = 0;
  for (const node of graph.nodes) {
    const t = nodeUs.get(node.n) ?? 0, d = deps(node);
    work += t;
    const heavy = node.op === 'boolean' ? 1 : 0;
    heavyCount += heavy; if (heavy) heavyWork += t;
    finish.set(node.n, t + (d.length ? Math.max(...d.map(x => finish.get(x) ?? 0)) : 0));
    heavyDepth.set(node.n, heavy + (d.length ? Math.max(...d.map(x => heavyDepth.get(x) ?? 0)) : 0));
  }
  const span = Math.max(0, ...finish.values()), heavySpan = Math.max(0, ...heavyDepth.values());
  return { workUs: work, spanUs: span, costBound: span ? work / span : 1, heavyCount, heavySpan, opCountBound: heavySpan ? heavyCount / heavySpan : 1, heavyWorkUs: heavyWork };
}

// --- the speed gate (docs/language.md §11/§12) ---------------------------------------------------
//
// rows: native runs {mode, threads, repsMs} (one row per process; rep 1 is
// cold, reps 2..R warm). Two statistics of the warm time per configuration:
//   median  median over processes of the per-process median (robust to
//           outliers, blind to a heavy tail)
//   mean    mean over every warm repetition of every process (sees the tail)
// For each: W_best = the best serial time over 1/2/4 threads (seq mode, the
// same binary), T4 = fork@4, ratio = W_best / T4. The gate ratio is the
// SMALLER of the two ratios: run_graph passes only if the fork win survives
// both the typical and the average repetition (a median-only pass on a
// heavy-tailed fork@4 is not a pass).
const median = xs => { const s = [...xs].sort((a, b) => a - b); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null; };
const mean = xs => xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null;
export const GATE = 1.2;
export function gateRatios(rows, { threads = [1, 2, 4], gate = GATE } = {}) {
  const warm = r => (r.repsMs.length > 1 ? r.repsMs.slice(1) : r.repsMs);
  const of = (mode, t) => rows.filter(r => r.mode === mode && r.threads === t);
  const stat = {
    median: rs => median(rs.map(r => median(warm(r)))),
    mean: rs => mean(rs.flatMap(warm)),
  };
  const out = {};
  for (const [name, f] of Object.entries(stat)) {
    const seq = Object.fromEntries(threads.map(t => [t, f(of('seq', t))]));
    const best = Math.min(...Object.values(seq)), T4 = f(of('fork', 4));
    out[name] = { W_best_ms: best, W_best_threads: Number(Object.keys(seq).find(t => seq[t] === best)), W4_ms: seq[4], T4_ms: T4, ratio: best / T4, ratioSameThreads: seq[4] / T4 };
  }
  // tail: how much the mean exceeds the median at fork@4 (1 = no tail)
  const tail = out.mean.T4_ms / out.median.T4_ms;
  const ratio = Math.min(out.median.ratio, out.mean.ratio);
  return { ...out, ratio, tailFork4: tail, gate, passes: ratio >= gate,
    verdict: ratio >= gate ? 'pass' : Math.max(out.median.ratio, out.mean.ratio) >= gate ? 'not robust (passes one statistic only)' : 'reject' };
}

export const readSource = file => readFileSync(file, 'utf8');
export { geomHashes, fullHashes };

// --- errors: the failing node with the smallest index, mapped to FS source ------------
//
// Native error codes (kernel/lang/wk/real.bend): 1 capability, 2 kernel failure
// (FeatureScriptError, catchable in FS), 3 speculation or expect, 4 malformed
// node payload. A dependent node carries its input's error unchanged, so the
// error of the smallest failing index is the one a sequential FS run would
// raise first, among the recorded operations.
export const CODE = { 1: 'capability', 2: 'fail', 3: 'speculation', 4: 'malformed', 5: 'host' };
// The node where an error value originated: follow operands carrying the same
// error (a dependent carries its input's error unchanged). Spans alone are not
// enough: two nodes can share one call site (a helper called inside and
// outside a try).
function originOf(rec, key, values) {
  let n = key;
  for (;;) {
    const e = values?.get(n)?.error;
    const up = operandRefs(rec.graph.nodes[n]).map(r => r.node).find(m => { const x = values?.get(m)?.error; return x && e && x.code === e.code && x.span === e.span && x.message === e.message; });
    if (up === undefined) return rec.graph.nodes[n];
    n = up;
  }
}
export function explainError(rec, key, error, values = null) {
  const node = rec.graph.nodes[key], at = rec.graph.spans[error.span] ?? null;
  const out = { node: key, op: node?.op ?? null, id: node?.id ?? null, code: error.code, kind: CODE[error.code] ?? 'unknown', message: error.message,
    file: at?.file ?? null, line: at?.line ?? null, column: at?.column ?? null, origin: error.origin ?? 'native', at: at ? { line: at.line, column: at.column } : null };
  const origin = values ? originOf(rec, key, values) : node;
  // An error today's build raises too carries today's location (none where today
  // has none); `at` keeps the op's FS span. WK-only errors stay at the span.
  if (origin && todayRaises(error)) {
    const t = todayLocation(rec, origin, error);
    out.line = t?.[0] ?? null; out.column = t?.[1] ?? null; out.location = 'today';
  } else out.location = 'span';
  const inTry = origin?.attrs?.try;
  if (inTry) {
    const where = inTry.at.map(t => `${t.line}:${t.column}`).join(', ');
    // evaluate() replays every catchable failure inside a try whose message is
    // today's; what is left here is an error FeatureScript does not catch, or a
    // native residual failure whose message is not today's text (not replayed).
    if (error.code !== 2) out.try = { mode: inTry.mode, at: inTry.at, note: `FeatureScript would not catch this error at ${where}` };
    else { out.kind = 'try-speculation'; out.try = { mode: inTry.mode, at: inTry.at, note: `not replayed: FeatureScript would catch this failure at ${where}, but its native message is not today's text, so the handler cannot be run with today's error` }; }
  }
  return out;
}
// The first node in record order with an error value is the error's origin (its
// operands, all earlier, carry none).
export function firstError(rec, values) {
  for (const node of rec.graph.nodes) {
    const v = values.get(node.n);
    if (v?.error) return explainError(rec, node.n, v.error, values);
  }
  return null;
}

// The first error of the whole FS run. The recorder stops at its own error
// (a capability the recorder or the production library lacks, a graph break,
// or an FS error of the host program) AFTER every recorded operation; a
// sequential FS run executes those operations first. So an error of the
// partial graph comes first, and only a partial graph that evaluates without
// error leaves the record-time error as the first one. (values: the native
// values of rec.graph, complete or partial.)
export function firstErrorOverall(rec, values) {
  const native = firstError(rec, values);
  if (native || rec.status === 'complete') return native;
  const e = rec.error;
  return { node: null, op: null, id: null, code: null, origin: 'record',
    kind: rec.status === 'break' ? 'graph-break' : rec.status === 'unsupported' ? 'capability' : 'fail',
    message: String(e?.message ?? 'recording stopped'), name: e?.name ?? null, file: rec.graph.meta?.file ?? null, line: e?.line ?? null, column: e?.column ?? null };
}

// --- host cache: geom hash -> native node value (docs/language.md §9 step 5) ---------------
//
// The cache holds the raw native value of a node ({count, u, f} words, or {ok}),
// keyed by the geom hash (op + contract-rounded args + input hashes, no ids).
// Errors are never cached. Identity is not in the cached value: it is recomputed
// for every node by replayIdentity through today's identity entries, whose calls
// are memoized by their arguments (ids included) in memoIdentityKernel.
export function cacheStore(cache, rec, raw, geom = geomHashes(rec.graph)) {
  for (const node of rec.graph.nodes) {
    const v = raw.get(node.n);
    if (v && !v.error && !v.postError) cache.set(geom[node.n], v);
  }
  return cache;
}
const f32Bits = bits => { const b = new DataView(new ArrayBuffer(4)); b.setUint32(0, bits >>> 0); return b.getFloat32(0); };
// Dirty nodes are evaluated; clean inputs of dirty nodes travel as literal nodes
// (op 6, the cached words unchanged); every other clean node is not sent at all.
export function planIncremental(rec, cache, geom = geomHashes(rec.graph)) {
  const dirty = new Set(rec.graph.nodes.filter(n => !cache.has(geom[n.n])).map(n => n.n));
  const needed = new Set([...dirty].flatMap(n => operandRefs(rec.graph.nodes[n]).map(r => r.node)).filter(n => !dirty.has(n)));
  const literals = new Map(), skip = new Set(), cached = new Map();
  for (const node of rec.graph.nodes) {
    if (dirty.has(node.n)) continue;
    const v = cache.get(geom[node.n]);
    cached.set(node.n, v);
    if (!needed.has(node.n)) { skip.add(node.n); continue; }
    if (v.ok) { skip.add(node.n); continue; }
    const r = [];
    for (let i = 0; i < v.f.length; i += 2) r.push([f32Bits(v.f[i]), f32Bits(v.f[i + 1])]);
    literals.set(node.n, { u: [v.count, ...v.u], r });
  }
  // known: every clean node's raw value; evaluate(rec, { known: plan.cached }) sends the same work as
  // literals + skip and can also decode clean operands (PIERCE host inputs need them)
  return { dirty: [...dirty], literals, skip, cached, known: cached };
}
// Raw values of a whole graph: cache hits plus the natively evaluated dirty nodes.
// (out.values also holds the host-precheck errors evaluate() added.)
export function mergeRaw(plan, out) {
  const raw = new Map(plan.cached);
  for (const n of plan.dirty) {
    if (!out.values.has(n)) throw new MalformedNativeOutput(`dirty node ${n} has no value line`);
    raw.set(n, out.values.get(n));
  }
  return raw;
}
