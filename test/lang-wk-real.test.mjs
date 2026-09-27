import test from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missingBend();
if (publicTreeSkip) {
  test("lang-wk-real.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { readFileSync, writeFileSync, existsSync, mkdirSync } = await import("node:fs");
const { execFileSync, spawnSync } = await import("node:child_process");
const { performance } = await import("node:perf_hooks");
const { createHash } = await import("node:crypto");
const { homedir } = await import("node:os");
const { join } = await import("node:path");
const { build } = await import("../src/index.mjs");
const { loadKernel, list, prismInputs } = await import("../src/kernel.mjs");
const { vector } = await import("../src/real.mjs");
const { recordFeatureScript } = await import("../src/lang/wk/record-fs.mjs");
const { stageFeatureScript } = await import("../src/lang/wk/stage-fs.mjs");
const { stagePython } = await import("../src/lang/wk/stage-py.mjs");
const { canonicalize } = await import("../src/lang/wk/canon.mjs");
const { printGraph, contentHashes } = await import("../src/lang/wk/ir.mjs");
const { recordCase, evaluate, assemble, assembleModel, modelJson, materialize, compareLists, compareModels, deepDiff, gateRatios, firstError, firstErrorOverall, cacheStore, planIncremental, mergeRaw, nodeValues, nativeMessage, MalformedNativeOutput, BINARY } = await import("../src/lang/wk/real-run.mjs");
const { memoIdentityKernel, geomHashes, precisionReport, contractArgs, bodyKinds, encodeReal, parseOutput, NATIVE, pierceInputs, b64Words, f32WordsX } = await import("../src/lang/wk/real-host.mjs");
const { encodeSession } = await import("../src/lang/wk/encode-bend.mjs");
const { oracleNodes } = await import("../src/lang/wk/real-oracle.mjs");
const { plateSource } = await import("../scripts/lang/wk-chain.mjs");
// Focused tests of the WK real-model spike (docs/language/spike-real-model.md,
// docs/language/prototype.md). Run: node --test test/lang-wk-real.test.mjs
// Native tests run only when out/lang/wk/real/build/wk-real exists
// (node scripts/lang/wk-real-build.mjs); corpus tests only when Marc's corpus
// (~/Workspace/cad, read-only) is present; the build123d test only with the
// reference venv. "Fix round 2" tests are the regression tests of the defects
// the independent verification found (docs/language/prototype.md §7).






















const root = new URL('../', import.meta.url).pathname;
const cad = join(homedir(), 'Workspace/cad');
const WASHERS = join(cad, 'cad-project-039/belt-fixed-r29/top-clearance-r29/top-clamp-washers-r29.fs');
const DUAL = join(cad, 'cad-project-039/belt-return-r25/dual-hardware-r25.fs');
const CASES = join(root, 'kernel/lang/wk/cases');
const PY = join(root, 'out/build123d-performance/reference-venv/bin/python');
const TMP = join(root, 'tmp/lang/wk/real/test');
mkdirSync(TMP, { recursive: true });
const native = existsSync(BINARY) ? false : 'native evaluator not built (node scripts/lang/wk-real-build.mjs)';
const corpus = existsSync(WASHERS) && existsSync(DUAL) ? false : 'corpus not present';
// The WK native path runs the exact Boolean arms only; the JS side it is
// compared with uses the same policy (src/modeling-policy.mjs).
const EXACT_ONLY = { boolean: 'exact-only' };
const HEADER = 'FeatureScript 3000;\nimport(path : "onshape/std/geometry.fs", version : "3000.0");\n';
const feature = body => `${HEADER}export const f = defineFeature(function(context is Context, id is Id, definition is map)\nprecondition {}\n{\n${body}\n});\n`;
const opsOf = operations => operations.map(o => `${o.operationId}|${o.name}|${o.source?.span?.line}:${o.source?.span?.column}`);
let jsKernel = null;
const kernel = async () => (jsKernel ??= await loadKernel());
// Today's build() and the native WK path of one feature, whole model compared.
async function bothPaths(file, featureName, tag, { release = false, threads = 1 } = {}) {
  const k = await kernel();
  const model = await build(readFileSync(file, 'utf8'), { feature: featureName, sourcePath: file });
  const rec = recordCase(file, featureName);
  assert.equal(rec.status, 'complete', `${tag}: ${rec.error?.message}`);
  const ev = await evaluate(rec, { file: join(TMP, `${tag}.wkr`), threads });
  const asm = assemble(rec, ev.values, memoIdentityKernel(k).kernel, { release });
  assert.equal(firstError(rec, ev.values), null);
  return { model, rec, ev, asm, cmp: compareModels(assembleModel(rec, asm), model) };
}
const assertModelEqual = (cmp, label) => {
  assert.ok(cmp.equal, `${label}: ${JSON.stringify({ bodies: cmp.bodies.filter(r => !r.equal).map(r => r.diffs), evidence: cmp.evidence, sourceMap: cmp.sourceMap }).slice(0, 1500)}`);
  assert.ok(cmp.jsonIdentical, `${label}: deep-equal but the JSON key order differs`);
};

// Since 2026-09-23 06:15 another workflow edits the FS frontend (src/parser.mjs,
// src/interpreter.mjs, src/library.mjs, ...) in the working tree, so a byte
// comparison against git HEAD no longer tells whether THIS workflow changed
// them. What the recorder guarantees is checked instead: no file of the
// language workflow writes or patches them, and a recording leaves the
// Interpreter class exactly as it was. (The HEAD comparison is reported as a
// diagnostic; docs/language/prototype.md §8.)
test('the recorder runs src/parser.mjs and src/interpreter.mjs unmodified', async t => {
  const { readdirSync } = await import('node:fs');
  const own = [...readdirSync(join(root, 'src/lang/wk')).map(f => join(root, 'src/lang/wk', f)), ...readdirSync(join(root, 'scripts/lang')).filter(f => f.startsWith('wk')).map(f => join(root, 'scripts/lang', f))]
    .filter(f => f.endsWith('.mjs'));
  for (const file of own) {
    const text = readFileSync(file, 'utf8');
    assert.doesNotMatch(text, /(Interpreter|Parser)\.prototype|writeFileSync\([^)]*(parser|interpreter)\.mjs/, file);
  }
  const { Interpreter } = await import('../src/interpreter.mjs');
  const parser = await import('../src/parser.mjs');
  const shape = () => JSON.stringify([Object.getOwnPropertyNames(Interpreter.prototype).map(k => [k, String(Object.getOwnPropertyDescriptor(Interpreter.prototype, k).value ?? '')]), Object.entries(parser).map(([k, v]) => [k, String(v)])]);
  const before = shape();
  const r = recordFeatureScript(readFileSync(join(CASES, 'frame-with-tab.fs'), 'utf8'), { feature: 'frameWithTab', sourcePath: 'frame-with-tab.fs' });
  assert.equal(r.status, 'complete');
  assert.equal(shape(), before);
  for (const file of ['src/parser.mjs', 'src/interpreter.mjs']) {
    const head = execFileSync('git', ['show', `HEAD:${file}`], { cwd: root });
    t.diagnostic(`${file} ${createHash('sha256').update(readFileSync(join(root, file))).digest('hex') === createHash('sha256').update(head).digest('hex') ? 'equals' : 'differs from'} git HEAD`);
  }
});

test('frame-with-tab: the recorder, the old stager and build123d give one canonical graph', { skip: !existsSync(PY) && 'reference venv missing' }, async () => {
  const source = readFileSync(join(CASES, 'frame-with-tab.fs'), 'utf8');
  const recorded = recordFeatureScript(source, { sourcePath: 'frame-with-tab.fs' });
  assert.equal(recorded.status, 'complete');
  const bare = g => printGraph(g, { spans: false, ids: false }).split('\n').slice(1).map(l => l.replace(/ name="result"$/, '')).join('\n');
  const r = canonicalize(recorded.graph).graph, s = canonicalize(stageFeatureScript(source, { file: 'frame-with-tab.fs' }).graph).graph;
  const py = await stagePython(readFileSync(join(root, 'fixtures/performance-build123d/cases/frame-with-tab.py'), 'utf8'), { filename: 'frame-with-tab.py', python: PY });
  const p = canonicalize(py.graph).graph;
  assert.equal(bare(r), bare(s));
  assert.equal(bare(r), bare(p));
  assert.equal(contentHashes(r)[r.outputs[0].value.node], 'e61c3e396beed88d'); // f55dec6f28652498 before W2 (precision="F32")
});

test('kernel ops inside try: the decorate idiom is recorded exactly, other handlers speculatively', () => {
  const r = recordFeatureScript(feature(`
    try { fCuboid(context, id + "a", { "corner1" : vector(0, 0, 0) * millimeter, "corner2" : vector(10, 10, 10) * millimeter }); }
    catch (error) { throw regenError("Block: " ~ error); }
    try silent(fCuboid(context, id + "b", { "corner1" : vector(20, 0, 0) * millimeter, "corner2" : vector(30, 10, 10) * millimeter }));
  `), { sourcePath: 'try.fs' });
  assert.equal(r.status, 'complete');
  const [a, b] = r.graph.nodes;
  assert.equal(a.attrs.try.mode, 'rethrow');
  assert.deepEqual(a.attrs.try.at.map(t => t.line), [7]);
  assert.equal(b.attrs.try.mode, 'speculate');
  assert.deepEqual([r.trace.tryRethrow, r.trace.trySpeculate], [1, 1]);
});

test('precision contract: F32x2 for polygon extrusions (real() word pairs); a -0 origin folds under any start offset', async () => {
  const r = recordFeatureScript(readFileSync(join(root, 'examples/bracket.fs'), 'utf8'), { sourcePath: 'bracket.fs' });
  const extrusion = r.graph.nodes.find(n => n.op === 'extrude_polygon');
  assert.equal(extrusion.args.precision, 'F32x2');
  // 18.000000000000004 mm (18 * millimeter) is kept exactly by its word pair: nothing to report
  assert.deepEqual(precisionReport(r.graph), []);
  const pair = contractArgs(extrusion, bodyKinds(r.graph)).points.find(p => p[0][0] === 18);
  assert.deepEqual(pair[0], [18, 3.552713678800501e-15]);
  // a number the pair cannot hold is reported
  const rounded = { n: 0, op: 'extrude_polygon', args: { points: [[0.1 + 2 ** -60, 0]], plane: { origin: [0, 0, 0], normal: [0, 0, 1], x: [1, 0, 0] }, delta: [0, 0, 1], offset: null } };
  assert.deepEqual(precisionReport({ nodes: [rounded] }).map(x => [x.contract, x.path]), [['F32x2', 'points[0][0]']]);
  // the -0 fold: prismInputs sums the cap origins in binary64 and writes -0 as +0, so
  // polygon-prism.extrude builds the same words for a -0 and a +0 origin, whatever the offset
  const node = { n: 0, op: 'extrude_polygon', args: { points: [[0, 0]], plane: { origin: [-0, 0, 0], normal: [0, 0, 1], x: [1, 0, 0] }, delta: [0, 0, 1], offset: null } };
  for (const offset of [null, [-0, -0, -0], [1, -0, 2]]) {
    const folded = contractArgs({ ...node, args: { ...node.args, offset } }, bodyKinds({ nodes: [node] })).plane.origin[0];
    assert.ok(Object.is(folded[0], 0) && Object.is(folded[1], 0), JSON.stringify(offset));
  }
  const k = await kernel();
  const pts = list([[0, 0], [10, 0], [10, 5], [0, 5]].map(([x, y]) => vector([x, y, 0])));
  const words = v => JSON.stringify(v, (key, x) => Object.is(x, -0) ? '-0' : x);
  for (const [normal, delta] of [[[0, 0, 1], [0, 0, 3]], [[0, Math.SQRT1_2, Math.SQRT1_2], [0, 1, 2]]]) {
    for (const offset of [[0, 0, 0], [-0, -0, -0], [1, -0, 2]]) {
      const build = origin => {
        const inputs = prismInputs({ origin, normal, x: [1, 0, 0] }, delta, offset);
        return words(k.polygonPrism.extrude(pts, vector(inputs.origin), vector(inputs.normal), vector(inputs.x), vector(inputs.far)));
      };
      assert.equal(build([-0, -0, -0]), build([0, 0, 0]), JSON.stringify({ normal, offset }));
    }
  }
});

test('washers (a real part): recorder op sequence equals today\'s build; the whole native model equals it byte for byte', { skip: native || corpus }, async () => {
  const k = await kernel();
  const model = await build(readFileSync(WASHERS, 'utf8'), { feature: 'topClampWashersR29', sourcePath: WASHERS });
  const rec = recordCase(WASHERS, 'topClampWashersR29');
  assert.equal(rec.status, 'complete');
  assert.deepEqual(opsOf(rec.sourceMap.operations), opsOf(model.sourceMap.operations));
  assert.deepEqual(rec.graph.nodes.filter(n => n.op === 'boolean').map(n => n.args.method), ['COAXIAL', 'COAXIAL', 'COAXIAL', 'COAXIAL']);
  const digests = new Set();
  for (const [mode, threads] of [['fork', 1], ['seq', 1], ['fork', 4]]) {
    const ev = await evaluate(rec, { mode, threads, reps: 2, file: join(TMP, `washers-${mode}-${threads}.wkr`) });
    assert.equal(firstError(rec, ev.values), null);
    digests.add(ev.run.stdout.split('\n').filter(l => l.startsWith('N ')).join('\n'));
    const asm = assemble(rec, ev.values, memoIdentityKernel(k).kernel);
    assertModelEqual(compareModels(assembleModel(rec, asm), model), `washers ${mode}@${threads}`);
  }
  assert.equal(digests.size, 1);
});

test('loud failures: CURVED method, unknown op and a split result fail at their FS spans, with no result', { skip: native }, async () => {
  const curved = recordCase(join(CASES, 'curved-intersection.fs'), 'curvedIntersection');
  assert.equal(curved.graph.nodes[2].args.method, 'CURVED');
  let ev = await evaluate(curved, { file: join(TMP, 'curved.wkr') });
  let error = firstError(curved, ev.values);
  assert.deepEqual([error.kind, error.line, error.column], ['capability', 19, 9]);
  assert.match(error.message, /CURVED/);
  assert.ok(ev.values.get(curved.outputs[0].ref.node).error);

  const split = recordCase(join(CASES, 'split-count.fs'), 'splitCount');
  ev = await evaluate(split, { file: join(TMP, 'split.wkr'), threads: 4 });
  error = firstError(split, ev.values);
  assert.deepEqual([error.kind, error.line], ['speculation', 15]);
  assert.match(error.message, /produced 2 bodies, the recorded program assumed 1/);

  const unknown = recordCase(join(CASES, 'frame-with-tab.fs'), 'frameWithTab');
  unknown.graph.nodes[3].op = 'loft';
  ev = await evaluate(unknown, { file: join(TMP, 'unknown.wkr') });
  error = firstError(unknown, ev.values);
  assert.deepEqual([error.kind, error.line, error.node], ['capability', 14, 3]);
  assert.match(error.message, /op code 99 is not in the native evaluator/);
  assert.equal(ev.values.get(4).error.span, unknown.graph.nodes[3].span); // the join inherits the tab's error
});

test('dual-hardware (primary): a wrong count speculation is an expect error; a real edit re-evaluates only dirty nodes and equals a cold run', { skip: native || corpus }, async () => {
  const rec = recordCase(DUAL, 'dualHardware25');
  assert.equal(rec.status, 'complete');
  const check = rec.graph.nodes.find(n => n.op === 'expect_count');
  const wrong = recordCase(DUAL, 'dualHardware25');
  wrong.graph.nodes[check.n].args = { ...check.args, count: check.args.count + 1 };
  const ev = await evaluate(wrong, { file: join(TMP, 'dual-wrong.wkr'), threads: 4 });
  const error = firstError(wrong, ev.values);
  assert.equal(error.kind, 'speculation');
  assert.equal(error.line, rec.graph.spans[check.span].line);

  const base = await evaluate(rec, { file: join(TMP, 'dual-base.wkr'), threads: 4 });
  const cache = cacheStore(new Map(), rec, base.out.values);
  const source = readFileSync(DUAL, 'utf8').split('\n');
  assert.equal(source[87].split('27.357265589908167').length, 2);
  source[87] = source[87].replace('27.357265589908167', '28.7251288694');
  const editedPath = join(TMP, 'dual-hardware-L88.fs');
  writeFileSync(editedPath, source.join('\n'));
  const edited = recordCase(editedPath, 'dualHardware25');
  const plan = planIncremental(edited, cache);
  // Changed by the edit: the nut extrusion and its through hole. Every other
  // re-evaluated node is an error node of the base run (errors are never cached).
  const baseGeom = new Set(geomHashes(rec.graph)), geom = geomHashes(edited.graph);
  const changed = edited.graph.nodes.filter(n => !baseGeom.has(geom[n.n]));
  assert.deepEqual(changed.map(n => `${n.op}:${n.id}`), ['extrude_polygon:model/nut1/ex', 'boolean:model/nut1hole']);
  for (const n of plan.dirty) assert.ok(changed.some(c => c.n === n) || base.out.values.get(n).error, `node ${n}`);
  const inc = await evaluate(edited, { file: join(TMP, 'dual-inc.wkr'), threads: 4, known: plan.known });
  assert.equal(inc.enc.evaluated + inc.enc.inherited, plan.dirty.length); // dirty PIERCE nodes of a failed operand inherit its error on the host
  const incValues = nodeValues(edited.graph, { values: mergeRaw(plan, inc.out) });
  const cold = await evaluate(edited, { file: join(TMP, 'dual-cold.wkr'), threads: 4 });
  for (const node of edited.graph.nodes) assert.deepEqual(incValues.get(node.n), cold.values.get(node.n), `node ${node.n}`);
  const k = await kernel();
  const a = assemble(edited, incValues, memoIdentityKernel(k).kernel), b = assemble(edited, cold.values, memoIdentityKernel(k).kernel);
  const rows = compareLists(a.outputs.filter(Boolean), b.outputs.filter(Boolean));
  assert.ok(rows.length > 0 && rows.every(r => r.equal && r.jsonIdentical));
  assert.notDeepEqual(geomHashes(edited.graph), geomHashes(rec.graph));
});

test('frame-with-tab natively: the planar chain gives the direct-kernel volume and 64 faces', { skip: native }, async () => {
  const rec = recordCase(join(CASES, 'frame-with-tab.fs'), 'frameWithTab');
  const ev = await evaluate(rec, { file: join(TMP, 'frame.wkr'), threads: 4 });
  assert.equal(firstError(rec, ev.values), null);
  const [body] = materialize(rec.graph, ev.values).get(4);
  // out/lang/spike/run-2 refValue: F32x2 words 1180188672 / 739621607 = 13840.000000000002 mm³
  assert.equal(body.validation.volumeMm3, 13840.000000000002);
  assert.equal(body.faces.length, 64);
});

// --- fix round 2: regression tests of the verified defects ------------------------------------

test('fix 2.1 comparison covers the whole body JSON: construction, operationHistory and key order', { skip: native }, async () => {
  const { asm } = await bothPaths(join(CASES, 'pierce.fs'), 'alignedHoles', 'cmp-pierce');
  const body = asm.outputs[0];
  const same = structuredClone(body);
  assert.deepEqual(compareLists([body], [same]).map(r => [r.equal, r.jsonIdentical]), [[true, true]]);
  const depth = structuredClone(body); depth.construction.depthMm += 2 ** -50;
  let [row] = compareLists([depth], [body]);
  assert.equal(row.equal, false); assert.equal(row.brep, true); // the old B-rep-hash comparison saw nothing
  assert.deepEqual(row.diffs.map(d => d.path), ['.construction.depthMm']);
  const noHistory = structuredClone(body); delete noHistory.operationHistory;
  [row] = compareLists([noHistory], [body]);
  assert.deepEqual([row.equal, row.diffs[0].path, row.diffs[0].native], [false, '.operationHistory', 'missing']);
  const { name, ...rest } = { ...body, name: 'n' };
  [row] = compareLists([{ name, ...rest }], [{ ...rest, name }]);
  assert.deepEqual([row.equal, row.jsonIdentical], [true, false]);
  assert.deepEqual(deepDiff({ a: -0 }, { a: 0 }).map(d => d.path), ['.a']);
});

test('fix 2.1 PIERCE: complete construction (radius, depth, admission, subdivision) and evidence equal today; exact axis for aligned tools', { skip: native }, async () => {
  const aligned = await bothPaths(join(CASES, 'pierce.fs'), 'alignedHoles', 'pierce-aligned');
  assertModelEqual(aligned.cmp, 'alignedHoles');
  const facts = aligned.rec.graph.nodes.filter(n => n.op === 'boolean').map(n => NATIVE.get(aligned.asm.nodeBodies.get(n.n)[0]));
  assert.deepEqual(facts.map(f => f.method), ['PIERCE', 'PIERCE', 'PIERCE']);
  assert.equal(aligned.ev.stages.length, 4); // three chained holes: one stage each after the plate
  const c = aligned.asm.outputs[0].construction;
  assert.deepEqual(Object.keys(c), ['method', 'operation', 'frameId', 'sourceBudgetMm', 'radiusMm', 'depthMm', 'admission', 'subdivision']);
  assert.equal(c.depthMm, 4.500000000000001); // the F32x2 plate keeps the FS mm value (4.5 under the F32 contract before W2)
  const tilted = await bothPaths(join(CASES, 'pierce.fs'), 'tiltedHole', 'pierce-tilted');
  assertModelEqual(tilted.cmp, 'tiltedHole'); // the host inputs are today's binary64 words (fix 3.1)
});

test('fix 2.1 / 3.3 dual-hardware: every node\'s complete body JSON equals today\'s adapters, the polyhedral-volume PIERCE included', { todo: 'stale since W2/W1-fix/r20-gate changed production; rebase WK/0', skip: native || corpus }, async () => {
  const k = await kernel();
  const rec = recordCase(DUAL, 'dualHardware25');
  const ev = await evaluate(rec, { file: join(TMP, 'dual-oracle.wkr'), threads: 2 });
  const asm = assemble(rec, ev.values, memoIdentityKernel(k).kernel, { modelingPolicy: EXACT_ONLY });
  const oracle = oracleNodes(rec.graph, k, { sourceMap: rec.sourceMap, modelingPolicy: EXACT_ONLY });
  const differing = [];
  for (const node of rec.graph.nodes) {
    const a = asm.nodeBodies.get(node.n), b = oracle.values.get(node.n);
    if (!a || !b) { assert.equal(Boolean(a), Boolean(b), `node ${node.n}: bodies on one side only`); continue; }
    const rows = compareLists(a, b);
    if (!rows.every(r => r.equal && r.jsonIdentical)) differing.push({ node, rows, facts: NATIVE.get(a[0]) });
  }
  const pierce = rec.graph.nodes.filter(n => n.args.method === 'PIERCE' && asm.nodeBodies.get(n.n));
  assert.equal(pierce.length, 10); // 9 before W2: model/phaseNut0hole (node 86) now builds on both sides with F32x2 prisms
  assert.deepEqual(differing.map(d => d.node.id), []); // node 93 (model/phaseNut1hole) differed by 2.27e-13 mm3 before fix 3.3
  assert.equal(ev.stages.length, 2);
  assert.deepEqual(ev.stages[1].hostInputs.map(h => h.status), ev.stages[1].hostInputs.map(() => 0));
});

test('fix 2.2 planar Booleans: construction provenance, operation evidence and operationHistory equal today byte for byte', { skip: native }, async () => {
  const { cmp, asm } = await bothPaths(join(CASES, 'planar-small.fs'), 'planarSmall', 'planar-small');
  assertModelEqual(cmp, 'planarSmall');
  const body = asm.outputs[0];
  for (const key of ['stats', 'ownership', 'subdivision', 'faceOrigins', 'edgeOrigins']) assert.ok(key in body.construction, key);
  assert.equal(body.operationHistory[0].evidence.inputs[0].history[0].evidence.method, 'native Bend planar arrangement subtraction');
});

test('fix 2.3 gate: the ratio is the smaller of the median and mean statistics; a median-only pass is not a pass', () => {
  const rows = (mode, threads, reps) => [0, 1, 2].map(i => ({ mode, threads, i, repsMs: [9, ...reps] }));
  const seq = [1, 2, 4].flatMap(t => rows('seq', t, [1.0, 1.0, 1.0, 1.0, 1.0]));
  const g = gateRatios([...seq, ...rows('fork', 1, [1, 1, 1, 1, 1]), ...rows('fork', 2, [1, 1, 1, 1, 1]), ...rows('fork', 4, [0.7, 0.7, 0.7, 2.0, 2.0])]);
  assert.ok(g.median.ratio > 1.4 && g.mean.ratio < 1.0);
  assert.equal(g.ratio, g.mean.ratio);
  assert.deepEqual([g.passes, g.verdict], [false, 'not robust (passes one statistic only)']);
  const steady = gateRatios([...seq, ...rows('fork', 4, [0.5, 0.5, 0.5, 0.5, 0.5])]);
  assert.deepEqual([steady.passes, steady.ratio], [true, 2]);
});

test('fix 2.4 identity: evaluateQuery results as op arguments give today\'s identity.operation.parameters', { skip: native }, async () => {
  for (const name of ['eachTarget', 'patternReference']) {
    const { model, rec, cmp } = await bothPaths(join(CASES, 'query-reference.fs'), name, `query-${name}`);
    assertModelEqual(cmp, name);
    assert.deepEqual(rec.sourceMap.operations.map(o => o.parameters), model.sourceMap.operations.map(o => o.parameters));
    const owner = JSON.stringify(model.sourceMap.operations).match(/"owner":\{[^}]*\}/)?.[0];
    assert.ok(owner && !owner.includes('"body"'), owner);
  }
});

test('fix 2.6 first error: a kernel failure before a record-time capability error is the one reported', { skip: native, todo: 'stale since W2/W1-fix/r20-gate changed production; rebase WK/0' }, async () => {
  const file = join(CASES, 'masked-error.fs');
  const today = await build(readFileSync(file, 'utf8'), { feature: 'maskedError', sourcePath: file, modelingPolicy: EXACT_ONLY }).then(() => null, e => e);
  const rec = recordCase(file, 'maskedError');
  assert.deepEqual([rec.status, rec.error.line], ['unsupported', 24]); // the recorder stops at opTransform
  const ev = await evaluate(rec, { file: join(TMP, 'masked.wkr') });
  const fe = firstErrorOverall(rec, ev.values);
  assert.deepEqual([fe.origin, fe.kind, fe.line, fe.column, fe.message], ['native', 'capability', today.line, today.column, today.message]);
  // without a native error, the record-time error is the first one
  const tail = recordFeatureScript(feature('opTransform(context, id + "t", {});'), { sourcePath: 't.fs' });
  const none = firstErrorOverall(tail, new Map());
  assert.deepEqual([none.origin, none.kind, none.line], ['record', 'capability', 6]);
});

test('fix 2.6 first error on real parts: the recorder\'s partial graph reveals today\'s earlier kernel error', { todo: 'stale since W2/W1-fix/r20-gate changed production; rebase WK/0', skip: native || corpus }, async () => {
  // hybridHopper: 50:5 before W2 and again since the W2 integrate: the part's plane at 33:5
  // has normal . x = 6.5e-11, above the prism's 1e-11 orthonormality budget; the prism
  // refused it until src/kernel.mjs prismInputs projected x within 1e-8 rad (recorded as
  // construction.frameRegularization), and the WK path reports the same first error
  for (const [path, name, line, column] of [['cad-project-014/machine-interface-r11/interface-r11.fs', 'fasteners', 45, 6], ['cad-project-039/archive-r16/hopper.fs', 'hybridHopper', 50, 5]]) {
    const rec = recordCase(join(cad, path), name);
    assert.equal(rec.status, 'unsupported');
    const ev = await evaluate(rec, { file: join(TMP, `partial-${name}.wkr`) });
    const fe = firstErrorOverall(rec, ev.values);
    assert.deepEqual([fe.origin, fe.line, fe.column], ['native', line, column], name);
    const today = await build(readFileSync(join(cad, path), 'utf8'), { feature: name, sourcePath: join(cad, path), modelingPolicy: EXACT_ONLY }).then(() => null, e => e);
    assert.deepEqual([fe.message, fe.line, fe.column], [today.message, today.line, today.column], name);
  }
});

test('fix 2.6 host errors around the kernel call: the same error as today, at the op span', { skip: native }, async () => {
  const file = join(CASES, 'far-pattern.fs');
  // farBox: before W2 the polyhedral copy took F32 words and today's decoder refused the result (2, host-decode);
  // transformInBend now re-splits the offset with real(), which refuses it first, as for the cylinder
  for (const [name, code, origin] of [['farBox', 5, 'host-precheck'], ['farCylinder', 5, 'host-precheck']]) {
    const today = await build(readFileSync(file, 'utf8'), { feature: name, sourcePath: file }).then(() => null, e => e);
    const rec = recordCase(file, name);
    const ev = await evaluate(rec, { file: join(TMP, `far-${name}.wkr`) });
    assemble(rec, ev.values, memoIdentityKernel(await kernel()).kernel);
    const fe = firstErrorOverall(rec, ev.values);
    // today's transform and real() errors carry no location; at = the op's FS span
    assert.deepEqual([fe.code, fe.origin, fe.message, fe.line, today.line ?? null, fe.at.line], [code, origin, today.message, null, null, rec.graph.spans[rec.graph.nodes.find(n => n.op === 'transform').span].line], name);
    assert.ok(ev.values.get(rec.outputs.at(-1).ref.node).error, `${name}: the copy has no body`);
  }
  // a helper called inside and outside a try shares one call span: the origin is the failing node, not the first node of that span
  const shared = recordFeatureScript(feature(`
    fCuboid(context, id + "a", { "corner1" : vector(0, 0, 0) * millimeter, "corner2" : vector(10, 10, 10) * millimeter });
    try silent(fCuboid(context, id + "z", { "corner1" : vector(20, 0, 0) * millimeter, "corner2" : vector(30, 10, 10) * millimeter }));
  `), { sourcePath: 'shared.fs' });
  const values = new Map([[0, { ok: true }], [1, { error: { code: 2, span: shared.graph.nodes[1].span, message: 'boom' } }]]);
  assert.equal(firstError(shared, values).kind, 'try-speculation');
});

test('fix 2.7 malformed streams are rejected as a whole; the host never reads missing node lines as "no error"', { skip: native }, async () => {
  const rec = recordCase(join(CASES, 'frame-with-tab.fs'), 'frameWithTab');
  const toks = encodeReal(rec.graph).text.split(' ');
  const reseal = t => { const body = t.slice(2).map(Number); return [body.length, body.reduce((s, x) => (s + x) % 4294967296, 0), ...body]; };
  const depthAt = 68; // 2 seal tokens, 11 constant reals of 6 tokens
  const cases = {
    'cut at the end': [toks.slice(0, -6).join(' '), /seal does not match/],
    'last digit changed': [[...toks.slice(0, -1), String(Number(toks.at(-1)) + 1)].join(' '), /seal does not match/],
    'depth - 1 (resealed)': [reseal(toks.map((t, i) => i === depthAt ? String(Number(t) - 1) : t)).join(' '), /left over after the last level/],
    'depth + 1 (resealed)': [reseal(toks.map((t, i) => i === depthAt ? String(Number(t) + 1) : t)).join(' '), /count does not match the tokens/],
    'non-numeric token': [toks.map((t, i) => i === 60 ? 'abc' : t).join(' '), /not a decimal U32/],
    'token above 2^32': [toks.map((t, i) => i === 60 ? '4294967296' : t).join(' '), /not a decimal U32/],
    empty: ['', /seal .* is missing/],
  };
  for (const [label, [text, message]] of Object.entries(cases)) {
    const file = join(TMP, `malformed-${label.replace(/\W+/g, '-')}.wkr`);
    writeFileSync(file, text);
    const r = spawnSync(BINARY, ['--threads', '1', '--gpu', 'off', '--', 'seq', '1', file], { encoding: 'utf8', env: { ...process.env, BEND_NO_TELEMETRY: '1' } });
    assert.equal(r.status, 3, label);
    assert.match(r.stderr, message, label);
    assert.doesNotMatch(r.stdout, /^N /m, label);
  }
  for (const reps of ['0', 'x']) {
    const r = spawnSync(BINARY, ['--threads', '1', '--gpu', 'off', '--', 'fork', reps, join(TMP, 'malformed-empty.wkr')], { encoding: 'utf8', env: { ...process.env, BEND_NO_TELEMETRY: '1' } });
    assert.equal(r.status, 2, `reps ${reps}`);
  }
  // host: a missing, repeated or foreign line is malformed output
  const good = await evaluate(rec, { file: join(TMP, 'malformed-good.wkr') });
  const lines = good.run.stdout.trim().split('\n');
  const drop = lines.filter(l => !l.startsWith('N 4 ')).join('\n');
  assert.throws(() => nodeValues(rec.graph, parseOutput(drop), good.enc.keys), MalformedNativeOutput);
  assert.throws(() => parseOutput(`${lines.join('\n')}\n${lines.at(-1)}`), MalformedNativeOutput);
  assert.throws(() => parseOutput(`${lines.join('\n')}\nwhatever`), MalformedNativeOutput);
  assert.throws(() => parseOutput(lines.filter(l => !l.startsWith('R ')).join('\n')), MalformedNativeOutput);
});

test('fix 2.8 Boolean chains: equal to today while today\'s labels fit; beyond, an explicit capability error at a Boolean span, never a crash', { skip: native }, async () => {
  const file = join(TMP, 'plate-5.fs');
  writeFileSync(file, plateSource(5));
  const { cmp, asm } = await bothPaths(file, 'plateHoles', 'plate-5', { release: true });
  assertModelEqual(cmp, 'plate-5');
  assert.deepEqual([...asm.nodeBodies.keys()], [10]); // release keeps only the output node (the last Boolean)
  // 60 chained holes under a 160 MB heap: the replay's heap guard stops at a Boolean span. (12 did
  // before evidence/2, 15 before identity keys stopped nesting every ancestor key; 20 now fit.)
  const fileLong = join(TMP, 'plate-60.fs');
  writeFileSync(fileLong, plateSource(60));
  const script = `import { loadKernel } from '${root}src/kernel.mjs';
    import { recordCase, evaluate, assemble } from '${root}src/lang/wk/real-run.mjs';
    import { memoIdentityKernel } from '${root}src/lang/wk/real-host.mjs';
    const rec = recordCase('${fileLong}', 'plateHoles');
    const ev = await evaluate(rec, { file: '${fileLong}.wkr' });
    try { assemble(rec, ev.values, memoIdentityKernel(await loadKernel()).kernel, { release: true }); console.log(JSON.stringify({ ok: true })); }
    catch (e) { console.log(JSON.stringify({ name: e.name, line: e.line, message: e.message })); }`;
  const r = spawnSync(process.execPath, ['--max-old-space-size=160', '--input-type=module', '-e', script], { encoding: 'utf8', env: { ...process.env, BEND_NO_TELEMETRY: '1' } });
  assert.equal(r.status, 0, r.stderr.slice(-400));
  const out = JSON.parse(r.stdout.trim().split('\n').at(-1));
  assert.equal(out.name, 'UnsupportedFeatureError', JSON.stringify(out));
  assert.match(out.message, /host identity replay of node %\d+ \(boolean model\/b\d+\) reached a V8 limit/);
  const rec = recordCase(file, 'plateHoles');
  const boolLine = rec.graph.spans[rec.graph.nodes.find(n => n.op === 'boolean').span].line;
  assert.equal(out.line, boolLine); // the opBoolean call in plateSource
  // an export beyond V8's string limit is the same kind of explicit error
  const huge = { toJSON() { throw new RangeError('Invalid string length'); } };
  assert.throws(() => modelJson(rec, huge), e => e.name === 'UnsupportedFeatureError' && /exceeds a V8 limit/.test(e.message) && e.line === boolLine);
});

// --- fix round 3: regression tests of the verified defects ------------------------------------
// Fixtures: kernel/lang/wk/cases/round3.fs (the verifiers' round-3 reproductions).

const R3 = join(CASES, 'round3.fs');
// Today's build() and the WK path of one feature that fails on both: first error compared.
async function bothErrors(featureName, tag) {
  const today = await build(readFileSync(R3, 'utf8'), { feature: featureName, sourcePath: R3 }).then(() => null, e => e);
  assert.ok(today, `${tag}: today builds`);
  const rec = recordCase(R3, featureName);
  const ev = await evaluate(rec, { file: join(TMP, `${tag}.wkr`), threads: 2 });
  assemble(rec, ev.values, memoIdentityKernel(await kernel()).kernel);
  const fe = firstErrorOverall(rec, ev.values);
  assert.ok(fe, `${tag}: the WK path returns a model where today fails (${today.message})`);
  assert.deepEqual([fe.message, fe.line, fe.column], [today.message, today.line ?? null, today.column ?? null], tag);
  return { today, rec, ev, fe };
}

test('fix 3.1 / 3.3 PIERCE: a non-aligned tool and polyhedral targets of any size give today\'s model byte for byte (host binary64 inputs, staged)', { skip: native }, async () => {
  for (const name of ['tiltedHole', 'bigTiltedPlate', 'bigPlate']) {
    const { cmp, ev, asm, rec } = await bothPaths(R3, name, `r3-${name}`, { threads: 2 });
    assertModelEqual(cmp, name); // before: |dV| up to 3.5e-5 (tiltedHole) and 0.034 mm3 (bigTiltedPlate)
    assert.equal(ev.stages.length, 2, name);
    assert.deepEqual(ev.stages[1].hostInputs.map(h => h.status), [0], name);
    assert.ok(asm.outputs.some(b => b.construction?.method === 'native Bend through-hole pierce'), name);
    const pierceNode = rec.graph.nodes.find(n => n.args.method === 'PIERCE');
    assert.deepEqual(Object.keys(NATIVE.get(asm.nodeBodies.get(pierceNode.n)[0])), ['method', 'depthMm', 'radiusMm']); // no exactness flags: nothing is emulated
  }
  // the host inputs are exactly today's adapter arithmetic on the decoded operands
  const plate = { validation: { volumeMm3: 1600.0000000000002 } }, tool = { primitive: { type: 'frustum', bottom: [1, 2, -1], top: [1.5, 2.25, 5], r0: 2, r1: 2 } };
  const h = pierceInputs(plate, tool);
  const span = [0.5, 0.25, 6], length = Math.hypot(...span);
  assert.equal(h.status, 0);
  assert.deepEqual(h.words[0], [Math.fround(0.5 / length), Math.fround(0.5 / length - Math.fround(0.5 / length))]);
  assert.deepEqual(h.words[5], [Math.fround(1600.0000000000002), Math.fround(1600.0000000000002 - Math.fround(1600.0000000000002))]);
  assert.equal(pierceInputs(plate, { primitive: { ...tool.primitive, top: tool.primitive.bottom } }).status, 1);
  assert.equal(pierceInputs({ validation: { volumeMm3: null } }, tool).status, 3);
  // a PIERCE node is never sent without its host inputs
  const rec = recordCase(R3, 'tiltedHole');
  assert.throws(() => encodeReal(rec.graph), /needs its host inputs/);
});

test('fix 3.2 thresholds: a dot product equal to the F32x2 rounding of 1 - 1e-6 is refused as today (exact binary64 comparison)', { skip: native }, async () => {
  const { fe, rec } = await bothErrors('axisThreshold', 'r3-axis');
  assert.equal(fe.kind, 'capability');
  assert.match(fe.message, /coaxial profiles and a normal sweep/);
  assert.equal(fe.at.line, rec.graph.spans[rec.graph.nodes.find(n => n.op === 'frustum').span].line);
  // the constants travel as three F32 words that sum to the binary64 value exactly
  for (const c of [1 - 1e-6, 1e-10, 0.0003]) {
    const [c1, c2, c3] = b64Words(c);
    assert.ok([c1, c2, c3].every(x => Math.fround(x) === x) && c1 + c2 + c3 === c, String(c));
  }
  assert.deepEqual(b64Words(1 - 1e-6).slice(0, 2), [Math.fround(1 - 1e-6), Math.fround(1 - 1e-6 - Math.fround(1 - 1e-6))]); // the dot of the fixture
  assert.notEqual(b64Words(1 - 1e-6)[2], 0); // so F32x2 equality with the threshold is NOT binary64 equality
});

// Since W2 every polyhedral input is F32x2 (real()), so a coordinate above 1e20
// (here 1e39, beyond the F32 range) is today's real() RangeError before any
// kernel call: no FeatureScript error, so try silent does not swallow it, and the
// WK host refuses the node before sending it (host-precheck), dependents included.
// (Under the F32 contract before W2 it became an Infinity body that today's
// decoder refused, and try silent swallowed that.)
test('fix 3.4 inputs above real()\'s range: today\'s RangeError at today\'s location, never sent, and try silent does not swallow it (as today)', { skip: native }, async () => {
  for (const name of ['hugeDepth', 'hugeOffset', 'trySilentHuge']) {
    const { fe, ev, rec } = await bothErrors(name, `r3-${name}`);
    assert.deepEqual([fe.kind, fe.origin, fe.code], ['host', 'host-precheck', 5], name);
    assert.match(fe.message, /Bend Real serialization requires a finite magnitude <= 1e20/);
    const huge = rec.graph.nodes.find(n => n.n === fe.node);
    assert.ok(!ev.enc.keys.includes(huge.n), `${name}: the refused node is not sent`);
  }
  const consumed = await bothErrors('hugeConsumed', 'r3-huge-consumed');
  const unite = consumed.rec.graph.nodes.find(n => n.op === 'boolean');
  assert.ok(!consumed.ev.enc.keys.includes(unite.n) && consumed.ev.values.get(unite.n).error, 'the union of the huge prism is never evaluated natively');
  // +-Infinity and NaN have stream words (kernel/lang/wk/real.bend wword); the old encoder threw a raw RangeError
  assert.deepEqual([f32WordsX(1e39), f32WordsX(-Infinity), f32WordsX(NaN), f32WordsX(1)], [[0, 0, 999], [1, 0, 999], [0, 1, 999], [0, 2 ** 23, 177]]);
});

test('fix 3.5 the session mode checks a sealed stream strictly: malformed input exits 3 at once, bounded memory', { skip: native }, async () => {
  const g = canonicalize(stageFeatureScript(readFileSync(join(CASES, 'frame-with-tab.fs'), 'utf8')).graph).graph;
  const text = encodeSession([g], [contentHashes(g)]).text;
  const toks = text.split(' ');
  const reseal = body => [body.length, body.reduce((s, x) => (s + x) % 4294967296, 0), ...body].join(' ');
  const body = toks.slice(2).map(Number);
  const real = encodeReal(recordCase(join(CASES, 'frame-with-tab.fs'), 'frameWithTab').graph).text; // a valid REAL-mode stream (the verifier's input)
  const cases = {
    'real-mode stream': [real, /count does not match the tokens/],
    'cut at the end': [toks.slice(0, -3).join(' '), /seal does not match/],
    'level count 2^32 - 1 (resealed)': [reseal(body.map((x, i) => i === 1 ? 4294967295 : x)), /count does not match the tokens/],
    'point count 2^32 - 1 (resealed)': [reseal(body.map((x, i) => i === 7 ? 4294967295 : x)), /count does not match the tokens/],
    'trailing token (resealed)': [reseal([...body, 7]), /left over/],
    'unsealed (the old format)': [toks.slice(2).join(' '), /seal does not match/],
  };
  assert.equal(body[3], 1); // ngraphs nlevels nnodes, then node 0: op 1 (an extrusion) span hi lo npoints (index 7)
  for (const [label, [stream, message]] of Object.entries(cases)) {
    const file = join(TMP, `session-${label.replace(/\W+/g, '-')}.wk`);
    writeFileSync(file, stream);
    const t0 = performance.now();
    const r = spawnSync(BINARY, ['--threads', '1', '--gpu', 'off', '--', file], { encoding: 'utf8', timeout: 20000, env: { ...process.env, BEND_NO_TELEMETRY: '1' } });
    assert.equal(r.status, 3, `${label}: ${r.signal ?? ''} ${r.stderr.slice(-300)}`);
    assert.match(r.stderr, message, label);
    assert.equal(r.stdout, '', label);
    assert.ok(performance.now() - t0 < 10000, label);
  }
  const file = join(TMP, 'session-valid.wk');
  writeFileSync(file, text);
  const lines = execFileSync(BINARY, ['--threads', '1', '--gpu', 'off', '--', file], { env: { ...process.env, BEND_NO_TELEMETRY: '1' } }).toString().trim().split('\n').map(l => JSON.parse(l));
  assert.deepEqual(lines[1].outputs[0], { body: { hash: 3141504600, hiBits: 1180188672, loBits: 739621607, errors: 0, faces: 64 } });
});

test('fix 3.6 kernel failures inside try are replayed: the decorate idiom reports today\'s message and location, handlers run as today', { skip: native }, async () => {
  for (const name of ['decorated', 'decoratedMessage']) {
    const { fe, ev, today } = await bothErrors(name, `r3-${name}`);
    assert.equal(ev.replays.length, 1, name);
    assert.equal(fe.origin, 'record');
    assert.equal(ev.replays[0].error.message, 'Circular loft/extrusion has zero or unresolved height');
    assert.deepEqual([ev.replays[0].try.mode, ev.replays[0].error.line], ['rethrow', null]); // circularFrustumInBend raises it without a location
    if (name === 'decoratedMessage') assert.equal(today.message, 'R4 build: Circular loft/extrusion has zero or unresolved height');
  }
  const { cmp, ev } = await bothPaths(R3, 'fallback', 'r3-fallback');
  assertModelEqual(cmp, 'fallback'); // the handler builds a box instead
  assert.equal(ev.replays.length, 1);
  assert.equal(ev.replays[0].try.mode, 'speculate');
  // the replay reuses every unchanged node value; a diverging replay is an internal error, never a result
  const rec = recordCase(R3, 'fallback');
  const failures = new Map([[0, { op: 'boolean', id: 'x', line: 1, column: 1, error: { name: 'FeatureScriptError', message: 'm', line: null, column: null } }]]);
  assert.throws(() => recordFeatureScript(rec.input.source, { ...rec.input.options, failures }), /WK replay diverged at kernel call 0/);
});

// W2 re-baseline (local-development-evidence): the WK evaluator builds
// production's F32x2 prisms (profile-ring.simplify, polygon-prism.extrude /
// transform in kernel/lang/wk/real.bend), so the whole model equals today's byte
// for byte: merge records, precision, copies, refusals, and a pierce of a copy.
const REPRO = join(root, 'fixtures/corpus-repro/kernel-sketch-and-ops');
const W2 = join(CASES, 'w2-prism.fs');
test('W2 prisms: corpus repros and prism cases equal today byte for byte', { skip: native }, async () => {
  for (const [file, name] of [[join(REPRO, 'collinear-polyline-vertex.fs'), 'collinearVertex'], [join(REPRO, 'cap-normal-far-from-origin.fs'), 'tiltedOctagonFar'],
    [join(REPRO, 'cap-normal-far-from-origin.fs'), 'tiltedRectangleFar'], [join(REPRO, 'through-hole-tilted-panel.fs'), 'tiltedPanelHole'],
    [join(REPRO, 'profile-over-256-vertices.fs'), 'polygon300'], [join(REPRO, 'next-pierce-after-copy.fs'), 'pierceAfterCopy'],
    [W2, 'regularizedMerge'], [W2, 'rotatedCut'], [W2, 'generatorFrame'], [W2, 'coplanarTray'],
    [W2, 'regularizedCut'], [W2, 'regularizedPierce'], [W2, 'patternFlush']]) {
    const { cmp, asm } = await bothPaths(file, name, `w2-${name}`);
    assertModelEqual(cmp, name);
    for (const body of asm.outputs.filter(Boolean)) if (!body.geometry) assert.equal(body.precision, 'F32x2', name);
  }
  // the exact merge of the collinear repro, with the identity's profile sources
  const collinear = await bothPaths(join(REPRO, 'collinear-polyline-vertex.fs'), 'collinearVertex', 'w2-collinear');
  const merge = collinear.asm.outputs[0].construction.profileMerge;
  assert.ok(merge.merged.length > 0 && merge.merged.every(m => m.exact && m.deviationMm === 0) && merge.kept.length === merge.keptVertices, JSON.stringify(merge));
  // a regularized merge is recorded (and kept by the rigid copy)
  const reg = await bothPaths(W2, 'regularizedMerge', 'w2-reg');
  const [prism, copy] = reg.rec.graph.nodes.filter(n => n.op !== 'boolean').slice(0, 2).map(n => reg.asm.nodeBodies.get(n.n)[0]);
  assert.deepEqual([prism.exactness, copy.exactness, prism.construction.profileMerge.merged.map(m => m.exact)], ['regularized', 'regularized', [false]]);
  assert.deepEqual(copy.construction.profileMerge, prism.construction.profileMerge);
  // a generated sketch frame is projected and recorded (W2 integrate, src/kernel.mjs prismInputs)
  const gen = await bothPaths(W2, 'generatorFrame', 'w2-gen');
  const framed = gen.asm.outputs[0];
  assert.equal(framed.exactness, 'regularized');
  assert.ok(Math.abs(framed.construction.frameRegularization.orthogonalityDefect - 8.43e-11) < 1e-15, JSON.stringify(framed.construction));
  // the copy of the pierced plate keeps its volume, so the second hole cuts it (task A follow-up)
  const pac = await bothPaths(join(REPRO, 'next-pierce-after-copy.fs'), 'pierceAfterCopy', 'w2-pac');
  const copied = pac.rec.graph.nodes.find(n => n.op === 'transform');
  assert.equal(pac.asm.nodeBodies.get(copied.n)[0].validation.scope, 'boundary topology and endpoint incidence; rigidly preserved exact through-hole volume in Bend; tight bounds not evaluated');
  // W2 integrate fix 1: a Boolean and a pierce of a regularized body (and the pierce's copy) keep the label
  for (const name of ['regularizedCut', 'regularizedPierce']) {
    const run = await bothPaths(W2, name, `w2-${name}`);
    for (const body of run.asm.outputs) {
      assert.equal(body.exactness, 'regularized', name);
      assert.deepEqual(body.regularizedSources.map(s => s.profileMerge.merged.map(m => m.index)), [[2]], name);
    }
  }
  // W2 integrate fix 2: two folded translations land the pocket top on the box top (an open-top pocket)
  const flush = await bothPaths(W2, 'patternFlush', 'w2-flush');
  const cut = flush.asm.outputs.find(body => body.faces.length === 46);
  assert.ok(cut && Math.abs(cut.validation.volumeMm3 - (30 * 30 * 11.78 - 20 * 20 * 10.1)) < 1e-9, JSON.stringify(cut?.validation));
});

test('W2 prisms: a refusal is today\'s capability error, at today\'s location; Real details are formatted as today', { skip: native }, async () => {
  const { fe } = await (async () => {
    const today = await build(readFileSync(W2, 'utf8'), { feature: 'invalidFrame', sourcePath: W2 }).then(() => null, e => e);
    const rec = recordCase(W2, 'invalidFrame');
    const ev = await evaluate(rec, { file: join(TMP, 'w2-invalid-frame.wkr') });
    const fe = firstErrorOverall(rec, ev.values);
    assert.deepEqual([fe.origin, fe.kind, fe.message, fe.line, fe.column], ['native', 'capability', today.message, today.line, today.column]);
    return { fe };
  })();
  assert.equal(fe.message, 'Polygon prism extrusion in Bend refused: InvalidFrame');
  // required / allowance travel as [[R:hi:lo]] word markers (kernel/lang/wk/real.bend rmark)
  const bits = x => { const b = new DataView(new ArrayBuffer(4)); b.setFloat32(0, x); return b.getUint32(0); };
  const mark = x => { const hi = Math.fround(x), lo = Math.fround(x - hi); return `[[R:${bits(hi)}:${bits(lo)}]]`; };
  assert.equal(nativeMessage(`Polygon prism rigid transform in Bend refused: TransformDrift (required ${mark(3.25e-10)} mm, before ${mark(1e-12)} mm, allowance ${mark(4.9e-10)} mm)`),
    `Polygon prism rigid transform in Bend refused: TransformDrift (required ${(3.25e-10).toExponential(3)} mm, before ${(1e-12).toExponential(3)} mm, allowance ${(4.9e-10).toExponential(3)} mm)`);
});

}
