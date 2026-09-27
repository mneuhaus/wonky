import test from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missingBend();
if (publicTreeSkip) {
  test("lang-wk.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { readFileSync, existsSync, writeFileSync, mkdirSync } = await import("node:fs");
const { execFileSync } = await import("node:child_process");
const { build } = await import("../src/index.mjs");
const { geometryRevision } = await import("../src/identity.mjs");
const { stageFeatureScript } = await import("../src/lang/wk/stage-fs.mjs");
const { stagePython } = await import("../src/lang/wk/stage-py.mjs");
const { canonicalize } = await import("../src/lang/wk/canon.mjs");
const { contentHashes, printGraph, structure } = await import("../src/lang/wk/ir.mjs");
const { evaluateGraphJS } = await import("../src/lang/wk/eval-js.mjs");
const { encodeSession, f32Words, NativeCapabilityError } = await import("../src/lang/wk/encode-bend.mjs");
// Focused tests of the WK/0 core-IR prototype (docs/language/proposal-core-ir.md).
// Run: node --test test/lang-wk.test.mjs   (JS target; the native test runs only
// when out/lang/wk/build/wk-native exists, the Python test only when the
// reference venv exists).













const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const PY = new URL('../out/build123d-performance/reference-venv/bin/python', import.meta.url).pathname;
const BIN = new URL('../out/lang/wk/build/wk-native', import.meta.url).pathname;
const ops = graph => graph.nodes.map(n => n.op);
const stage = (source, options = {}) => {
  const r = stageFeatureScript(source, { file: 'test.fs', ...options });
  if (r.error) throw r.error;
  return r;
};
const HEADER = 'FeatureScript 3000;\nimport(path : "onshape/std/geometry.fs", version : "3000.0");\n';
const feature = body => `${HEADER}export const f = defineFeature(function(context is Context, id is Id, definition is map)\nprecondition {}\n{\n${body}\n});\n`;

test('bracket.fs stages to one F32-contract extrusion that keeps the binary64 inputs', () => {
  const r = stage(read('examples/bracket.fs'));
  assert.equal(r.graphBreak, null);
  assert.deepEqual(ops(r.graph), ['extrude_polygon']);
  const node = r.graph.nodes[0];
  assert.deepEqual(node.args.delta, [0, 0, 8]); // defineFeature default, not a std bound default
  assert.equal(node.args.points[3][0], 18.000000000000004); // 18 * millimeter in binary64 mm
  assert.equal(node.id, 'model/extrusion');
  assert.equal(r.graph.spans[node.span].line, 31);
});

test('the same part through FeatureScript and build123d gives one canonical graph (H1)', { skip: !existsSync(PY) && 'reference venv missing' }, async () => {
  const fs = canonicalize(stage(read('kernel/lang/wk/cases/frame-with-tab.fs')).graph).graph;
  const py = await stagePython(read('fixtures/performance-build123d/cases/frame-with-tab.py'), { filename: 'frame-with-tab.py', python: PY });
  assert.equal(py.failure, null);
  const pg = canonicalize(py.graph).graph;
  const bare = g => printGraph(g, { spans: false, ids: false }).split('\n').slice(1).map(l => l.replace(/ name="result"$/, '')).join('\n');
  assert.equal(bare(fs), bare(pg));
  assert.equal(contentHashes(fs)[fs.outputs[0].value.node], contentHashes(pg)[pg.outputs[0].value.node]);
});

test('checks, selections, guards and early returns stage without a graph break', () => {
  const r = stage(feature(`
    fCuboid(context, id + "a", { "corner1" : vector(0, 0, 0) * millimeter, "corner2" : vector(10, 10, 10) * millimeter });
    var tall = [];
    for (var b in evaluateQuery(context, qAllModifiableSolidBodies()))
        if (evBox3d(context, { "topology" : b, "tight" : true }).maxCorner[2] > 5 * millimeter)
            tall = append(tall, b);
    if (size(tall) != 1) throw regenError("Expected one tall body, found " ~ size(tall));
    var es = evaluateQuery(context, qOwnedByBody(qUnion(tall), EntityType.EDGE));
    if (size(es) > 0) opFillet(context, id + "round", { "entities" : qUnion(es), "radius" : 1 * millimeter });
  `));
  assert.equal(r.graphBreak, null);
  const used = new Set(ops(r.graph));
  for (const op of ['extrude_polygon', 'select', 'expect', 'when', 'choose', 'op']) assert.ok(used.has(op), `missing ${op}`);
  // The message contains a kernel result, so it is itself a node evaluated at run time.
  const expect = r.graph.nodes.find(n => n.op === 'expect');
  const [, ref] = expect.args.message.match(/^⟨%(\d+)⟩$/);
  assert.deepEqual(r.graph.nodes[Number(ref)].args.parts[0], 'Expected one tall body, found ');
  // The guarded fillet reaches the output through choose(cond, filleted, unchanged).
  const out = r.graph.nodes[r.graph.outputs[0].value.node];
  assert.equal(out.op, 'choose');
});

test('a loop over a kernel result that no idiom covers is an explicit graph break with its line', () => {
  const r = stageFeatureScript(feature(`
    fCuboid(context, id + "a", { "corner1" : vector(0, 0, 0) * millimeter, "corner2" : vector(10, 10, 10) * millimeter });
    opBoolean(context, id + "u", { "tools" : qUnion([qCreatedBy(id + "a", EntityType.BODY)]), "operationType" : BooleanOperationType.UNION });
    var n = 0;
    for (var e in evaluateQuery(context, qOwnedByBody(qCreatedBy(id + "a", EntityType.BODY), EntityType.EDGE)))
    {
        if (n > 2) break;
        n += 1;
    }
  `), { file: 'test.fs' });
  assert.ok(r.graphBreak, 'expected a graph break');
  assert.equal(r.graphBreak.kind, 'loop');
  assert.equal(r.graphBreak.loc.line, 10);
});

test('the JS reference WK evaluator reproduces build() bit for bit', async () => {
  for (const path of ['examples/box.fs', 'examples/bracket.fs', 'examples/tilted-plate.fs']) {
    const source = read(path);
    const direct = await build(source, { trace: false });
    const viaWK = await evaluateGraphJS(stage(source).graph);
    assert.deepEqual(viaWK.bodies.map(geometryRevision), direct.bodies.map(geometryRevision), path);
  }
});

test('content hashes ignore ids and spans and change only downstream of an edit', () => {
  const a = canonicalize(stage(read('kernel/lang/wk/cases/frame-with-tab.fs')).graph).graph;
  const b = canonicalize(stage(read('kernel/lang/wk/cases/frame-with-tab.fs').replace('vector(48, 10, 0)', 'vector(47, 10, 0)')).graph).graph;
  const ha = contentHashes(a), hb = contentHashes(b);
  assert.equal(ha.length, hb.length);
  const same = hb.filter(h => ha.includes(h)).length;
  assert.equal(same, 3); // stock, opening, frame reused; tab and join changed
  const renamed = stage(read('kernel/lang/wk/cases/frame-with-tab.fs').replaceAll('"stock"', '"blank"')).graph;
  assert.deepEqual(contentHashes(canonicalize(renamed).graph), ha);
});

test('the native encoder rejects what the native subset cannot run, with the source span', () => {
  const g = canonicalize(stage(read('kernel/lang/wk/cases/frame-with-tab.fs')).graph).graph;
  g.nodes[0].args.delta = [0, 0, -10];
  assert.throws(() => encodeSession([g], [contentHashes(g)]), e => e instanceof NativeCapabilityError && g.spans[e.span].line === 10);
  assert.deepEqual(f32Words(1), [0, 2 ** 23, 177]);
  assert.deepEqual(f32Words(-0.5), [1, 2 ** 23, 176]);
  assert.equal(structure(stage(read('kernel/lang/wk/cases/four-pockets.fs')).graph).heavySpan, 1);
});

test('native evaluation of the staged FS frame-with-tab equals the direct kernel calls', { skip: !existsSync(BIN) && 'native binary not built' }, () => {
  const g = canonicalize(stage(read('kernel/lang/wk/cases/frame-with-tab.fs')).graph).graph;
  const { text } = encodeSession([g], [contentHashes(g)]);
  mkdirSync(new URL('../tmp/lang/wk', import.meta.url), { recursive: true });
  const path = new URL('../tmp/lang/wk/test-frame.wk', import.meta.url).pathname;
  writeFileSync(path, text);
  const lines = execFileSync(BIN, ['--threads', '1', '--gpu', 'off', '--', path], { env: { ...process.env, BEND_NO_TELEMETRY: '1' } }).toString().trim().split('\n').map(l => JSON.parse(l));
  const [body, volume, faces] = lines[1].outputs;
  // out/lang/spike/run-2/report.json, frame-with-tab refValue (direct kernel calls)
  assert.deepEqual(body, { body: { hash: 3141504600, hiBits: 1180188672, loBits: 739621607, errors: 0, faces: 64 } });
  assert.deepEqual([volume.hi, volume.lo, faces.num], [1180188672, 739621607, 64]);
});

}
