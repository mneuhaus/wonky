import test from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missingBend() || missing("fixtures/r10b/modules.json", "fixtures/r10b/r10b.fs");
if (publicTreeSkip) {
  test("lang-dataflow.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { execFileSync } = await import("node:child_process");
const { existsSync, mkdtempSync, readFileSync, writeFileSync } = await import("node:fs");
const { tmpdir } = await import("node:os");
const { join } = await import("node:path");
const { fileURLToPath } = await import("node:url");
const { Graph, analyze, diffGraphs, hashGraph, mergeGraphs, parseGraph, printGraph } = await import("../src/lang/dataflow/graph.mjs");
const { angleText, lengthText } = await import("../src/lang/dataflow/canon.mjs");
const { traceFeatureScript } = await import("../src/lang/dataflow/fs-trace.mjs");
const { tracePython } = await import("../src/lang/dataflow/py-trace.mjs");
const { lowerStages } = await import("../src/lang/dataflow/lower-spike.mjs");
const { compileToStream } = await import("../src/lang/spike-compile.mjs");
// Focused tests of the dataflow-graph prototype (docs/language/proposal-dataflow.md).
//   node --test test/lang-dataflow.test.mjs














const root = fileURLToPath(new URL('../', import.meta.url));
const read = path => readFileSync(join(root, path), 'utf8');
const header = 'FeatureScript 3000;\nimport(path : "onshape/std/geometry.fs", version : "3000.0");\n';
const feature = body => `${header}export const f = defineFeature(function(context is Context, id is Id, definition is map) precondition {} {\n${body}\n});\n`;
const box = (name, x0, y0, x1, y1) => `fCuboid(context, id + "${name}", { "corner1" : vector(${x0}, ${y0}, 0) * millimeter, "corner2" : vector(${x1}, ${y1}, 10) * millimeter });`;

test('canonical text round-trips and hashes ignore spans', () => {
  const { graph } = traceFeatureScript(read('examples/bracket.fs'), { sourcePath: 'examples/bracket.fs' });
  const text = printGraph(graph);
  const again = parseGraph(text);
  assert.equal(printGraph(again), text);
  const h1 = hashGraph(graph), h2 = hashGraph(again);
  for (const n of graph.nodes) assert.deepEqual(h1.get(n.name), h2.get(n.name));
  const noSpans = parseGraph(printGraph(graph, { spans: false }));
  assert.equal(hashGraph(noSpans).get('model/extrusion').full, h1.get('model/extrusion').full);
  assert.match(text, /model\/extrusion = extrude\(direction:\[0,0,1\],endBound:"BoundingType.BLIND",endDepth:8mm,entities:region\(model\/profile,filterInnerLoops=false\)\)  @31:9/);
});

test('lengths print in mm only when x * 0.001 reproduces the stored binary64 exactly', () => {
  assert.equal(lengthText(18 * 0.001), '18mm');
  assert.equal(lengthText(0.1 * 0.001), '0.1mm');
  assert.equal(lengthText((0.1 + 0.2) * 0.001), '0.30000000000000004mm');
  assert.equal(lengthText(0.07987915274295632), '0.07987915274295632m'); // no decimal x with x * 0.001 === v
  assert.equal(angleText(30 * Math.PI / 180), '30deg');
});

test('the geom hash ignores operation ids, the full hash keeps them; meta nodes pass geometry through', () => {
  const g = (name, colour) => {
    const x = new Graph();
    x.add({ name: `${name}/a`, op: 'cuboid', args: 'corner1:[0,0,0]mm,corner2:[1,1,1]mm', inputs: [] });
    x.add({ name: `${name}/a/name`, kind: 'meta', op: 'property.name', args: `$0,${JSON.stringify(colour)}`, inputs: [`${name}/a`] });
    return x;
  };
  const a = hashGraph(g('model', 'red')), b = hashGraph(g('other', 'blue'));
  assert.equal(a.get('model/a').geom, b.get('other/a').geom);
  assert.notEqual(a.get('model/a').full, b.get('other/a').full);
  assert.equal(a.get('model/a/name').geom, a.get('model/a').geom);
});

test('a one-parameter edit dirties exactly the dependent nodes', () => {
  const src = read('examples/bracket.fs');
  const base = traceFeatureScript(src).graph;
  const thicker = traceFeatureScript(src, { parameters: { thickness: '10 * millimeter' } }).graph;
  const d = diffGraphs(base, thicker);
  assert.deepEqual(d.dirtyNames, ['model/extrusion']);
  assert.equal(d.reused, 1);
});

test('independent Booleans show up as fork-join parallelism; a chain does not', () => {
  const par = traceFeatureScript(feature([
    box('a', 0, 0, 10, 10), box('b', 5, 5, 15, 15), box('c', 100, 0, 110, 10), box('d', 105, 5, 115, 15),
    'opBoolean(context, id + "u1", { "tools" : qUnion([qCreatedBy(id + "a", EntityType.BODY), qCreatedBy(id + "b", EntityType.BODY)]), "operationType" : BooleanOperationType.UNION });',
    'opBoolean(context, id + "u2", { "tools" : qUnion([qCreatedBy(id + "c", EntityType.BODY), qCreatedBy(id + "d", EntityType.BODY)]), "operationType" : BooleanOperationType.UNION });',
  ].join('\n')));
  assert.equal(par.status, 'complete');
  assert.deepEqual([analyze(par.graph).work, analyze(par.graph).span], [2, 1]);
  const chain = traceFeatureScript(feature([
    box('a', 0, 0, 10, 10), box('b', 5, 5, 15, 15), box('c', 8, 0, 20, 4),
    'opBoolean(context, id + "u1", { "tools" : qUnion([qCreatedBy(id + "a", EntityType.BODY), qCreatedBy(id + "b", EntityType.BODY)]), "operationType" : BooleanOperationType.UNION });',
    'opBoolean(context, id + "u2", { "targets" : qCreatedBy(id + "a", EntityType.BODY), "tools" : qCreatedBy(id + "c", EntityType.BODY), "operationType" : BooleanOperationType.SUBTRACTION });',
  ].join('\n')));
  assert.deepEqual([analyze(chain.graph).work, analyze(chain.graph).span], [2, 2]);
  // qCreatedBy(id + "a") after the union resolves to the union's result version.
  assert.deepEqual(chain.graph.byName.get('model/u2').inputs, ['model/u1', 'model/c']);
});

test('host checks on body counts become kernel check nodes (speculation), measurements are graph breaks', () => {
  const checked = traceFeatureScript(feature([
    box('a', 0, 0, 10, 10), box('b', 5, 5, 15, 15),
    'opBoolean(context, id + "u", { "tools" : qUnion([qCreatedBy(id + "a", EntityType.BODY), qCreatedBy(id + "b", EntityType.BODY)]), "operationType" : BooleanOperationType.UNION });',
    'if (size(evaluateQuery(context, qAllModifiableSolidBodies())) != 1) throw regenError("Expected one solid");',
  ].join('\n')));
  assert.equal(checked.status, 'complete');
  const check = checked.graph.nodes.find(n => n.kind === 'check');
  assert.equal(check.op, 'expect.count');
  assert.deepEqual(check.inputs, ['model/u']);
  const measured = traceFeatureScript(feature([
    box('a', 0, 0, 10, 10),
    'if (evVolume(context, { "entities" : qCreatedBy(id + "a", EntityType.BODY) }) > 1 * millimeter ^ 3) { ' + box('b', 0, 0, 1, 1) + ' }',
  ].join('\n')));
  assert.equal(measured.status, 'break');
  assert.equal(measured.error.site, 'evVolume');
  assert.equal(measured.error.line, 5);
  const missing = traceFeatureScript(feature('var t = noSuchStdFunction(1);'));
  assert.equal(missing.status, 'unsupported');
});

test('face and edge selections consumed by operations become kernel-side select nodes', () => {
  const r = traceFeatureScript(feature([
    box('a', 0, 0, 10, 10),
    'opFillet(context, id + "f", { "entities" : qGeometry(qOwnedByBody(qCreatedBy(id + "a", EntityType.BODY), EntityType.EDGE), GeometryType.LINE), "radius" : 1 * millimeter });',
  ].join('\n')));
  assert.equal(r.status, 'complete');
  const sel = r.graph.byName.get('model/f.q0');
  assert.equal(sel.kind, 'select');
  assert.match(sel.args, /owned:EDGE qGeometry\(GeometryType.LINE\)/);
  assert.deepEqual(r.graph.byName.get('model/f').inputs, ['model/f.q0']);
  // qParallelEdges (return.fs blends) stays symbolic too.
  const parallel = traceFeatureScript(feature([
    box('a', 0, 0, 10, 10),
    'opFillet(context, id + "f", { "entities" : qParallelEdges(qOwnedByBody(qCreatedBy(id + "a", EntityType.BODY), EntityType.EDGE), vector(1, 0, 0)), "radius" : 1 * millimeter });',
  ].join('\n')));
  assert.equal(parallel.status, 'complete');
  assert.match(parallel.graph.byName.get('model/f.q0').args, /owned:EDGE qParallelEdges\(/);
});

test('the full r10b fixture traces to a graph without geometry and without a break', () => {
  const r = traceFeatureScript(read('fixtures/r10b/r10b.fs'), { feature: 'singleStepR10b', moduleManifest: join(root, 'fixtures/r10b/modules.json') });
  assert.equal(r.status, 'complete');
  const a = analyze(r.graph);
  assert.equal(a.nodes, 2037);
  assert.equal(a.work, 433);
  assert.equal(a.span, 42);
  const edited = traceFeatureScript(read('fixtures/r10b/r10b.fs'), { feature: 'singleStepR10b', moduleManifest: join(root, 'fixtures/r10b/modules.json'), parameters: { catchPitch: '5 * millimeter' } });
  const d = diffGraphs(r.graph, edited.graph);
  assert.equal(d.heavyDirty, 15);
  assert.ok(d.dirtyNames.every(n => n.startsWith('model/TrayArms/') || n.startsWith('expect@')));
});

test('build123d frame-with-tab traces through the shim, merges variants by hash and lowers to fork-join', async () => {
  const src = read('fixtures/performance-build123d/cases/frame-with-tab.py');
  const v1 = await tracePython(src), v2 = await tracePython(src.replace('Pos(48, 10, 0)', 'Pos(48, 4, 0)'));
  assert.equal(v1.status, 'complete');
  assert.deepEqual(v1.graph.nodes.map(n => n.op), ['box', 'box', 'translate', 'boolean.subtract', 'box', 'translate', 'boolean.union']);
  const merged = mergeGraphs([v1.graph, v2.graph], { key: 'geom' });
  assert.equal(analyze(merged).work, 3); // one shared subtract + two unions
  const { text, stats } = lowerStages([{ graph: merged }]);
  assert.match(text, /\(par \(list \(union s0n2 s0n3\)\) \(list \(union s0n2 s0n4\)\)\)/);
  assert.equal(stats[0].heavyEvaluated, 3);
  const incr = lowerStages([{ graph: v1.graph }, { graph: v2.graph, reuse: true }]);
  assert.equal(incr.stats[1].heavyReused, 1);
  const spacer = await tracePython(read('examples/python-spacer.py'));
  assert.equal(spacer.status, 'break');
  assert.equal(spacer.break.site, 'volume');
  spacer.graph.outputs = ['boolean.subtract@10'];
  assert.throws(() => lowerStages([{ graph: spacer.graph }]), /cylinder' has no builtin/); // capability error, not an approximation
});

const spike = join(root, 'out/lang/spike/build/main');
test('the lowered bracket runs natively on the spike binary with the expected volume', { skip: !existsSync(spike) && 'spike binary not built' }, () => {
  const { graph } = traceFeatureScript(read('examples/bracket.fs'));
  const prelude = read('kernel/lang/spike/examples/prelude.core');
  const dir = mkdtempSync(join(tmpdir(), 'wonky-dataflow-'));
  const file = join(dir, 'bracket.ast');
  writeFileSync(file, compileToStream(prelude + '\n' + lowerStages([{ graph }]).text).text);
  const out = JSON.parse(execFileSync(spike, ['--threads', '1', '--gpu', 'off', '--', 'eval', file, '100000', '1'], { env: { ...process.env, BEND_NO_TELEMETRY: '1' } }).toString().trim().split('\n').at(-1));
  assert.equal(out.value[0][0].num, 8832);
  assert.equal(out.value[0][2].body.errors, 0);
});

}
