import test from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missingBend() || missing("fixtures/corpus-repro/fs-module-import/snapshot/idioms.fs", "fixtures/r10b/modules.json", "fixtures/r10b/modules/base/parts.json", "fixtures/r10b/r10b.fs");
if (publicTreeSkip) {
  test("modules-revision.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { createHash } = await import("node:crypto");
const { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } = await import("node:fs");
const { tmpdir } = await import("node:os");
const { join } = await import("node:path");
const { fileURLToPath } = await import("node:url");
const { build } = await import("../src/index.mjs");
const { loadKernel } = await import("../src/kernel.mjs");
const { ModelingContext } = await import("../src/library.mjs");
const { frozenModules, manifestInputFiles, parseImportPath } = await import("../src/modules.mjs");
const { UnsupportedFeatureError } = await import("../src/errors.mjs");
// Revision-keyed frozen Onshape inputs (docs/onshape-inputs.md, stage 1 of
// docs/corpus/cluster-fs-module-import.md). Inputs are the frozen r10b capture
// and the fs-module-import repro; temporary schema-2 stores reuse their bytes.













const root = fileURLToPath(new URL('../', import.meta.url));
const read = path => readFileSync(join(root, path), 'utf8');
const sha = data => createHash('sha256').update(data).digest('hex');
const r10bManifest = join(root, 'fixtures/r10b/modules.json');
const snapshotDir = join(root, 'fixtures/corpus-repro/fs-module-import/snapshot');
const idioms = read('fixtures/corpus-repro/fs-module-import/snapshot/idioms.fs');
const idiomsManifest = join(snapshotDir, 'modules.json');
const BASE = 'onshape-id-019892ef', MV = 'onshape-id-676f05b9', HOST = 'onshape-id-b768d669';
const OTHER_DOC = 'aaaaaaaaaaaaaaaaaaaaaaaa', OTHER_VER = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const WALL = 'Zu2DD', FLOOR = 'Z/1DD';

const bounds = body => [0, 1, 2].map(i => [Math.min(...body.vertices.map(v => v[i])), Math.max(...body.vertices.map(v => v[i]))]);

// A minimal source importing `path@version` as namespace `ns`; `instance` is
// the addInstance definition (FeatureScript text) and `expect` the body count
// that qCreatedBy(<instantiator id>) must find.
const probe = ({ ns = 'src', path = BASE, version = MV, instance = '"name" : "all", "partQuery" : qBodyType(qAllModifiableSolidBodies(), BodyType.SOLID)', expect = 1 } = {}) => `FeatureScript 3044;
import(path : "onshape/std/common.fs", version : "3044.0");
import(path : "onshape/std/instantiator.fs", version : "3044.0");
${ns}::import(path : "${path}", version : "${version}");
annotation { "Feature Type Name" : "probe" }
export const probe = defineFeature(function(context is Context, id is Id, definition is map)
precondition {}
{
    var inst = newInstantiator(id + "src");
    addInstance(inst, ${ns}::build, {${instance}});
    instantiate(context, inst);
    if (size(evaluateQuery(context, qCreatedBy(id + "src", EntityType.BODY))) != ${expect})
        throw regenError("qCreatedBy(instantiator id) count");
});
`;

// A schema-2 store holding the r10b 'base' revision with the given parts
// (bytes of the r10b capture), relabeled as `entry` fields for the test.
function store({ parts = [WALL], entry = {}, manifest = {}, bodies = parts } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'wonky-store-'));
  const rev = `revisions/${BASE}@${MV}`;
  mkdirSync(join(dir, rev, 'bodies'), { recursive: true });
  mkdirSync(join(dir, 'manifests'), { recursive: true });
  const list = JSON.parse(read('fixtures/r10b/modules/base/parts.json')).filter(p => parts.includes(p.partId));
  const listBytes = JSON.stringify(list, null, 2);
  writeFileSync(join(dir, rev, 'parts.json'), listBytes);
  const bodyEntries = bodies.map(partId => {
    const file = `${rev}/bodies/${encodeURIComponent(partId)}.body.json`;
    cpSync(join(root, 'fixtures/r10b/modules/base', `${encodeURIComponent(partId)}.body.json`), join(dir, file));
    return { name: list.find(p => p.partId === partId).name, partId, file, sha256: sha(readFileSync(join(dir, file))) };
  });
  const path = join(dir, 'manifests', 'probe.fs.json');
  writeFileSync(path, JSON.stringify({ schema: 'wonky-onshape-inputs/2', store: '..', hostDocument: HOST, modules: [{
    namespace: 'anything', document: HOST, documentVersion: null, element: BASE, microversion: MV,
    parts: { file: `${rev}/parts.json`, sha256: sha(listBytes) }, bodies: bodyEntries, ...entry }], ...manifest }, null, 2));
  return { dir, path, rev };
}

test('the frozen r10b manifest (schema 1) still loads, bound to its source', async () => {
  const kernel = await loadKernel();
  const source = read('fixtures/r10b/r10b.fs');
  const resolver = frozenModules(r10bManifest, source, () => new ModelingContext(kernel));
  assert.equal(resolver.binding.sourceBinding, 'match');
  const manifest = JSON.parse(readFileSync(r10bManifest, 'utf8'));
  for (const module of manifest.modules) {
    const exports = resolver({ namespace: module.namespace, path: module.element, version: module.microversion });
    const context = exports.build.call([Object.create(null)]);
    const parts = JSON.parse(read(`fixtures/r10b/modules/${module.namespace}/parts.json`));
    assert.equal(context.engine.records.size, parts.length);
  }
  assert.equal(manifestInputFiles(r10bManifest).length, manifest.modules.length + 16);
});

test('import paths: same-document element or document/version/element triple', () => {
  assert.deepEqual(parseImportPath(BASE), { document: null, documentVersion: null, element: BASE });
  assert.deepEqual(parseImportPath(`${HOST}/${OTHER_VER}/${BASE}`), { document: HOST, documentVersion: OTHER_VER, element: BASE });
  assert.equal(parseImportPath('./lib.fs'), null);
  assert.equal(parseImportPath(`${HOST}/${BASE}`), null);
});

test('fs-module-import idioms after stage 1: each builds or refuses by name', async () => {
  const run = feature => build(idioms, { feature, moduleManifest: idiomsManifest });
  const plain = await run('nameLookup');
  assert.equal(plain.bodies.length, 1); assert.equal(plain.bodies[0].faces.length, 10);
  assert.equal(plain.bodies[0].provenance.sourceBinding, undefined, 'a matching source binding keeps schema-1 provenance unchanged');
  assert.equal((await run('instantiatorIdQuery')).bodies.length, 1);
  const moved = (await run('instanceTransform')).bodies[0];
  plain.bodies[0].vertices.forEach((v, i) => v.forEach((x, j) => assert.ok(Math.abs(moved.vertices[i][j] - x - (j === 2 ? 10 : 0)) < 1e-9)));
  // The snapshot holds one body of 17 parts: all solids is an honest refusal.
  await assert.rejects(run('noLoadedContext'), e => e instanceof UnsupportedFeatureError && /Body '.*' was not captured in this input snapshot/.test(e.message));
  // evVolume integrates the imported body in Bend (kernel/volume.bend).
  assert.equal((await run('importedVolume')).bodies.length, 1);
  // The rest belong to later stages (makeId, qNthElement, evBox3d):
  // a capability error, never a loader refusal.
  for (const feature of ['sourceFeatureId', 'containsPoint', 'importedBox'])
    await assert.rejects(run(feature), e => e instanceof UnsupportedFeatureError && !/loadedContext|addInstance field|Frozen module/.test(e.message), feature);
});

test('manifests bind revisions, not sources or namespace names; a source mismatch is recorded', async () => {
  const other = await build(idioms, { feature: 'nameLookup', moduleManifest: r10bManifest });
  assert.equal(other.bodies.length, 1);
  assert.equal(other.bodies[0].provenance.sourceBinding, 'mismatch');
  assert.equal(other.bodies[0].provenance.microversion, MV);
  const renamed = idioms.replaceAll('base::', 'ctx::');
  assert.equal((await build(renamed, { feature: 'instanceTransform', moduleManifest: idiomsManifest })).bodies.length, 1);
  const kernel = await loadKernel();
  assert.equal(frozenModules(r10bManifest, idioms, () => new ModelingContext(kernel)).binding.sourceBinding, 'mismatch');
});

test('revision mismatches and unknown revisions are explicit', async () => {
  await assert.rejects(build(probe({ version: 'ffffffffffffffffffffffff' }), { moduleManifest: idiomsManifest }), /Frozen module revision mismatch: src imports/);
  await assert.rejects(build(probe({ path: 'cccccccccccccccccccccccc' }), { moduleManifest: idiomsManifest }), /Unresolved Onshape module 'src'/);
});

test('schema 2: other-document triple, default loadedContext, store-relative files', async () => {
  const { path } = store({ parts: [WALL, FLOOR], entry: { document: OTHER_DOC, documentVersion: OTHER_VER } });
  const triple = `${OTHER_DOC}/${OTHER_VER}/${BASE}`;
  const model = await build(probe({ path: triple, expect: 2 }), { moduleManifest: path });
  assert.equal(model.bodies.length, 2);
  assert.equal(new Set(model.bodies.map(b => b.id)).size, 2, 'instance bodies keep distinct ids');
  for (const body of model.bodies) {
    assert.equal(body.provenance.document, OTHER_DOC);
    assert.equal(body.provenance.documentVersion, OTHER_VER);
    assert.equal(body.provenance.sourceBinding, 'absent');
  }
  await assert.rejects(build(probe({ path: `${OTHER_DOC}/${'d'.repeat(24)}/${BASE}`, expect: 2 }), { moduleManifest: path }), /Frozen module revision mismatch/);
  await assert.rejects(build(probe({ path: BASE, expect: 2 }), { moduleManifest: path }), /Frozen module revision mismatch/, 'a same-document import does not match an other-document entry');
  assert.equal(manifestInputFiles(path).length, 3);
});

test('schema 2: a part that was not captured stays an explicit error', async () => {
  const { path } = store({ parts: [WALL, FLOOR], bodies: [WALL] });
  await assert.rejects(build(probe({ expect: 2 }), { moduleManifest: path }), /Body 'T05 R6d 249.2mm hopper floor' was not captured in this input snapshot/);
});

test('schema 2: an element-microversion import is pinned to the document microversion its bytes name', async () => {
  // The import version is the element's own microversion; the capture pinned
  // it to document microversion MV, which the part list and body name.
  const ELEMENT_MV = 'eeeeeeeeeeeeeeeeeeeeeeee';
  const pinned = store({ entry: { microversion: ELEMENT_MV, documentMicroversion: MV } });
  const body = (await build(probe({ version: ELEMENT_MV }), { moduleManifest: pinned.path })).bodies[0];
  assert.equal(body.provenance.microversion, ELEMENT_MV);
  assert.equal(body.provenance.documentMicroversion, MV);
  const unpinned = store({ entry: { microversion: ELEMENT_MV } });
  await assert.rejects(build(probe({ version: ELEMENT_MV }), { moduleManifest: unpinned.path }), /Part-list revision mismatch/);
  const plain = (await build(probe(), { moduleManifest: store().path })).bodies[0];
  assert.equal('documentMicroversion' in plain.provenance, false, 'a document-microversion import records no extra field');
});

test('schema 2: body files stay hash-checked and inside the store', async () => {
  const tampered = store();
  writeFileSync(join(tampered.dir, tampered.rev, 'bodies', `${WALL}.body.json`), readFileSync(join(tampered.dir, tampered.rev, 'bodies', `${WALL}.body.json`), 'utf8') + ' ');
  await assert.rejects(build(probe(), { moduleManifest: tampered.path }), /Frozen module checksum mismatch/);
  const escaped = store();
  const manifest = JSON.parse(readFileSync(escaped.path, 'utf8'));
  manifest.modules[0].bodies[0].file = '../../outside.body.json';
  writeFileSync(escaped.path, JSON.stringify(manifest));
  await assert.rejects(build(probe(), { moduleManifest: escaped.path }), /outside its manifest directory/);
});

test('addInstance: rigid transforms apply, scale/shear/reflection and configurations are refused', async () => {
  const { path } = store();
  const base = (await build(probe(), { moduleManifest: path })).bodies[0];
  const rotated = (await build(probe({ instance: '"name" : "w", "partQuery" : qAllModifiableSolidBodies(), "configuration" : {}, "transform" : transform(matrix([[0, -1, 0], [1, 0, 0], [0, 0, 1]]), vector(5, 0, 0) * millimeter)' }), { moduleManifest: path })).bodies[0];
  base.vertices.forEach(([x, y, z], i) => [5 - y, x, z].forEach((v, j) => assert.ok(Math.abs(rotated.vertices[i][j] - v) < 1e-9)));
  assert.deepEqual(bounds(rotated)[2], bounds(base)[2]);
  const refused = async (instance, pattern) => assert.rejects(build(probe({ instance: `"name" : "w", "partQuery" : qAllModifiableSolidBodies(), ${instance}` }), { moduleManifest: path }),
    e => e instanceof UnsupportedFeatureError && pattern.test(e.message));
  await refused('"transform" : transform(matrix([[2, 0, 0], [0, 1, 0], [0, 0, 1]]), vector(0, 0, 0) * millimeter)', /scale or shear/);
  await refused('"transform" : transform(matrix([[1, 0.5, 0], [0, 1, 0], [0, 0, 1]]), vector(0, 0, 0) * millimeter)', /scale or shear/);
  await refused('"transform" : transform(matrix([[1, 0, 0], [0, 1, 0], [0, 0, -1]]), vector(0, 0, 0) * millimeter)', /reflection/);
  await refused('"configuration" : {"size" : 2}', /configuration/);
  await refused('"mateConnector" : 1', /addInstance field 'mateConnector' is not implemented/);
});

}
