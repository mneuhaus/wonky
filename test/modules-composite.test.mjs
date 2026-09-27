import test from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missingBend() || missing("fixtures/r10b/modules/base/parts.json");
if (publicTreeSkip) {
  test("modules-composite.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { createHash } = await import("node:crypto");
const { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } = await import("node:fs");
const { tmpdir } = await import("node:os");
const { join } = await import("node:path");
const { fileURLToPath } = await import("node:url");
const { build } = await import("../src/index.mjs");
const { traceFeatureScript } = await import("../src/lang/dataflow/fs-trace.mjs");
const { loadKernel } = await import("../src/kernel.mjs");
const { ModelingContext } = await import("../src/library.mjs");
const { frozenModules, instantiatorBuiltins } = await import("../src/modules.mjs");
const { TopologyQuery } = await import("../src/queries.mjs");
const { Id, map } = await import("../src/values.mjs");
const { FeatureScriptError, UnsupportedFeatureError } = await import("../src/errors.mjs");
// Composite parts in frozen Onshape imports (decision 11 of
// docs/entscheidungen.md, docs/onshape-inputs.md): the module loads; only
// using the composite part raises a named capability error. A temporary
// schema-2 store reuses the r10b 'base' capture: one captured solid (the wall)
// and the floor's part-list entry relabeled as a composite part.
















const root = fileURLToPath(new URL('../', import.meta.url));
const sha = data => createHash('sha256').update(data).digest('hex');
const BASE = 'onshape-id-019892ef', MV = 'onshape-id-676f05b9', HOST = 'onshape-id-b768d669';
const WALL = 'Zu2DD', FLOOR = 'Z/1DD', COMPOSITE = 'RUCT';
const COMPOSITE_NAME = 'bearing composite';

// `extra` rewrites the relabeled entry (bodyType, microversionId, ...).
function store(extra = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'wonky-composite-'));
  const rev = `revisions/${BASE}@${MV}`;
  mkdirSync(join(dir, rev, 'bodies'), { recursive: true });
  mkdirSync(join(dir, 'manifests'), { recursive: true });
  const parts = JSON.parse(readFileSync(join(root, 'fixtures/r10b/modules/base/parts.json'), 'utf8'));
  const wall = parts.find(p => p.partId === WALL);
  const composite = { ...parts.find(p => p.partId === FLOOR), partId: COMPOSITE, name: COMPOSITE_NAME, bodyType: 'composite', ...extra };
  const listBytes = JSON.stringify([composite, wall], null, 2);
  writeFileSync(join(dir, rev, 'parts.json'), listBytes);
  const file = `${rev}/bodies/${WALL}.body.json`;
  cpSync(join(root, 'fixtures/r10b/modules/base', `${WALL}.body.json`), join(dir, file));
  const path = join(dir, 'manifests', 'probe.fs.json');
  writeFileSync(path, JSON.stringify({ schema: 'wonky-onshape-inputs/2', store: '..', hostDocument: HOST, modules: [{
    namespace: 'anything', document: HOST, documentVersion: null, element: BASE, microversion: MV,
    parts: { file: `${rev}/parts.json`, sha256: sha(listBytes) },
    bodies: [{ name: wall.name, partId: WALL, file, sha256: sha(readFileSync(join(dir, file))) }] }] }, null, 2));
  return path;
}

// `body` is FeatureScript run inside the feature with `src` imported.
const source = body => `FeatureScript 3044;
import(path : "onshape/std/common.fs", version : "3044.0");
import(path : "onshape/std/instantiator.fs", version : "3044.0");
src::import(path : "${BASE}", version : "${MV}");
annotation { "Feature Type Name" : "probe" }
export const probe = defineFeature(function(context is Context, id is Id, definition is map)
precondition {}
{
${body}
    fCuboid(context, id + "box", { "corner1" : vector(0, 0, 0) * millimeter, "corner2" : vector(1, 1, 1) * millimeter });
});
`;
const WHOLE_CONTEXT = /^A query over the whole source context of imported module 'src' meets its composite part 'bearing composite' \(RUCT\): composite parts are not implemented, and Onshape's answer would include the bodies a closed composite consumes/;
const USE = /^Using the composite part 'bearing composite' \(RUCT\) of imported module 'src' is not implemented/;
const capability = pattern => e => e instanceof UnsupportedFeatureError && pattern.test(e.message);

test('a part list with a composite part loads', async () => {
  const model = await build(source('    var loaded = src::build({});'), { moduleManifest: store() });
  assert.equal(model.bodies.length, 1, 'only the feature\'s own cuboid');
  const kernel = await loadKernel();
  const resolver = frozenModules(store(), '', () => new ModelingContext(kernel));
  const context = resolver({ namespace: 'src', path: BASE, version: MV }).build.call([Object.create(null)]);
  assert.equal(context.engine.records.size, 2, 'a record for the composite and for the solid');
  const wall = [...context.engine.records.values()].find(r => r.sourcePartId === WALL);
  assert.equal(wall.kind, 'solid');
  assert.ok(wall.body.faces.length > 0, 'the solid next to the composite still imports');
});

test('queries over the whole source context meet the composite and refuse by name', async () => {
  const path = store();
  for (const query of ['qAllModifiableSolidBodies()', 'qBodyType(qEverything(EntityType.BODY), BodyType.SOLID)', 'qBodyType(qEverything(EntityType.FACE), BodyType.SOLID)']) {
    await assert.rejects(build(source(`    var loaded = src::build({});\n    evaluateQuery(loaded, ${query});`), { moduleManifest: path }), capability(WHOLE_CONTEXT), query);
    // addInstance without a loadedContext builds the default context itself.
    await assert.rejects(build(source(`    var inst = newInstantiator(id + "i");\n    addInstance(inst, src::build, { "name" : "all", "partQuery" : ${query} });\n    instantiate(context, inst);`), { moduleManifest: path }), capability(WHOLE_CONTEXT), `addInstance ${query}`);
  }
  // try silent never turns the refusal into an empty answer.
  await assert.rejects(build(source('    var loaded = src::build({});\n    try silent { evaluateQuery(loaded, qAllModifiableSolidBodies()); }'), { moduleManifest: path }), capability(WHOLE_CONTEXT));
});

test('addInstance with a query that selects the composite refuses by name', async () => {
  const kernel = await loadKernel();
  const resolver = frozenModules(store(), '', () => new ModelingContext(kernel));
  const { build: moduleBuild } = resolver({ namespace: 'src', path: BASE, version: MV });
  const loaded = moduleBuild.call([Object.create(null)]);
  const source = loaded.engine;
  const target = new ModelingContext(kernel);
  const { newInstantiator, addInstance } = instantiatorBuiltins(target);
  // A reference row, as evaluateQuery returns it, selecting each record.
  const select = record => new TopologyQuery('reference', { rows: [{ record, kind: 'body' }], owner: source });
  const [composite, wall] = [COMPOSITE, WALL].map(id => [...source.records.values()].find(r => r.sourcePartId === id));
  const inst = newInstantiator.call([new Id(['i'])]);
  assert.throws(() => addInstance.call([inst, moduleBuild, map({ name: 'c', partQuery: select(composite), loadedContext: loaded })]), capability(USE));
  const both = new TopologyQuery('union', { queries: [select(wall), select(composite)] });
  assert.throws(() => addInstance.call([inst, moduleBuild, map({ name: 'both', partQuery: both, loadedContext: loaded })]), capability(USE));
  // Selecting only the solid next to it is not refused.
  addInstance.call([inst, moduleBuild, map({ name: 'wall', partQuery: select(wall), loadedContext: loaded })]);
  assert.equal(inst.instances.length, 1);
  // Any access to the composite's geometry refuses the same way.
  assert.throws(() => composite.body, capability(USE));
});

test('the composite entry is still checked; other non-solid body types still refuse the module', async () => {
  await assert.rejects(build(source('    var loaded = src::build({});'), { moduleManifest: store({ microversionId: 'f'.repeat(24) }) }),
    e => e instanceof FeatureScriptError && /Part-list revision mismatch/.test(e.message));
  await assert.rejects(build(source('    var loaded = src::build({});'), { moduleManifest: store({ bodyType: 'wire' }) }),
    capability(/^Imported module 'src' contains unsupported body type 'wire'$/));
});

// The dataflow tracer resolves queries over the same source-context records
// (src/lang/dataflow/fs-trace.mjs); a composite part must not be traced as an
// imported solid there either.
test('the FeatureScript dataflow tracer refuses the composite by name, never as an import node', () => {
  const path = store();
  const instance = query => `    var inst = newInstantiator(id + "i");\n    addInstance(inst, src::build, { "name" : "all", "partQuery" : ${query} });\n    instantiate(context, inst);`;
  const cases = [
    instance('qEverything(EntityType.BODY)'),
    instance('qAllModifiableSolidBodies()'),
    instance('qBodyType(qEverything(EntityType.BODY), BodyType.SOLID)'),
    `    var loaded = src::build({});\n    var refs = evaluateQuery(loaded, qEverything(EntityType.BODY));\n${instance('qUnion(refs)')}`,
  ];
  for (const body of cases) {
    const traced = traceFeatureScript(source(body), { moduleManifest: path });
    assert.equal(traced.status, 'unsupported', body);
    assert.match(traced.error.message, WHOLE_CONTEXT, body);
    assert.deepEqual(traced.graph.nodes.filter(node => String(node.op).startsWith('import')), [], body);
  }
});

}
