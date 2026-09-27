import test from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missingBend() || missing("fixtures/r10b/modules/base/Z76DD.body.json");
if (publicTreeSkip) {
  test("identity.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { readFileSync } = await import("node:fs");
const { createHash } = await import("node:crypto");
const { loadKernel, list, extrudeInBend, transformInBend } = await import("../src/kernel.mjs");
const { circularFrustumInBend, importOnshapeBody, transformAnalytic } = await import("../src/analytic.mjs");
const { booleanInBend } = await import("../src/boolean.mjs");
const { geometryRevision, topologyReference, matchTopologyReference } = await import("../src/identity.mjs");
const { UnsupportedFeatureError } = await import("../src/errors.mjs");
const { toStep } = await import("../src/exporters.mjs");
const { build } = await import("../src/index.mjs");
const { plateSource } = await import("../scripts/lang/wk-chain.mjs");













const plane = { origin: [0, 0, 0], normal: [0, 0, 1], x: [1, 0, 0] };
const identityRows = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
const rectangle = (w, d) => [[0, 0], [w, 0], [w, d], [0, d]];
const box = (kernel, id = 'box', width = 10, options = {}) => extrudeInBend(kernel, id, rectangle(width, 6), plane, [0, 0, 4], [0, 0, 0], { primitive: 'box', ...options });
const cylinder = (kernel, id = 'cylinder', radius = 5, height = 10, z = 0, options = {}) => circularFrustumInBend(kernel, id,
  { center: [0, 0], radius, plane: { ...plane, origin: [0, 0, z] } }, null, [0, 0, height], [0, 0, 0], options);
const entries = body => [body.identity, ...Object.values(body.identity.topology).flat()];
const origins = body => entries(body).map(entry => entry.originId);
const instances = body => entries(body).map(entry => entry.instanceId);
const importedSource = () => JSON.parse(readFileSync(new URL('../fixtures/r10b/modules/base/Z76DD.body.json', import.meta.url))).bodies[0];
const sourceNamespace = { document: 'frozen-document', element: 'frozen-element', microversion: 'frozen-revision' };

test('Bend derives deterministic framed keys without delimiter or Unicode collisions', async () => {
  const { identity: I } = await loadKernel();
  const key = (domain, parts) => I.key_text(I.key(domain, list(parts)));
  assert.equal(key('origin', ['a', 'b']), key('origin', ['a', 'b']));
  const cases = [[], [''], ['', ''], ['a:b', 'c'], ['a', 'b:c'], ['12:x'], ['1', '2:x'], ['µ🙂', 'face'], ['µ', '🙂face']];
  assert.equal(new Set(cases.map(parts => key('origin', parts))).size, cases.length);
  assert.notEqual(key('origin', ['part']), key('instance', ['part']));
  // An ancestry part longer than 512 characters is named by the SHA-256 of its
  // UTF-8 bytes (checked against Node's independent implementation), so long
  // parts that differ only in a non-ASCII character stay distinct.
  const sha = text => `sha256:${createHash('sha256').update(text, 'utf8').digest('hex')}`;
  const long = ['µ🙂'.repeat(300), 'µ😀'.repeat(300), `${'a'.repeat(512)}ࠀ􏿿`];
  assert.deepEqual(long.map(text => I.lineage(text)), long.map(sha));
  assert.equal(I.lineage('a'.repeat(512)), 'a'.repeat(512));
});

test('known box dimensions and display-name edits preserve semantic identities, not geometry revisions', async () => {
  const k = await loadKernel(), before = box(k), after = box(k, 'box', 14);
  before.name = 'Old display label'; after.name = 'New display label';
  assert.deepEqual(origins(before), origins(after));
  assert.deepEqual(instances(before), instances(after));
  assert.notEqual(before.identity.revision, after.identity.revision);
  assert.ok(entries(before).every(entry => entry.stability === 'semantic'));
  assert.equal(new Set(instances(before)).size, 27);
  const revision = geometryRevision(before);
  before.name = 'Renamed again'; before.identity.operation.source.file = 'different-display-location.fs';
  assert.equal(geometryRevision(before), revision);
  assert.deepEqual(before.identity.topology.faces.map(entry => entry.role), ['cap/start', 'cap/end', 'side/y-min', 'side/x-max', 'side/y-max', 'side/x-min']);
  const ref = topologyReference(before, 'face', 3, { persistent: true });
  const match = matchTopologyReference([after], ref);
  assert.equal(match.status, 'matched');
  assert.equal(match.index, 3);
});

test('namespace, generating operation and instance IDs occupy separate collision domains', async () => {
  const k = await loadKernel(), first = box(k);
  const otherOperation = box(k, 'other-op');
  const otherNamespace = box(k, 'box', 10, { namespace: 'other-model' });
  const otherOccurrence = box(k, 'box', 10, { occurrenceId: 'right-instance' });
  assert.notEqual(first.identity.originId, otherOperation.identity.originId);
  assert.notEqual(first.identity.originId, otherNamespace.identity.originId);
  assert.equal(first.identity.originId, otherOccurrence.identity.originId);
  assert.notEqual(first.identity.instanceId, otherOccurrence.identity.instanceId);
  assert.equal(first.identity.revision, otherOccurrence.identity.revision);
  const ref = topologyReference(first, 'face', 0, { persistent: true });
  assert.equal(matchTopologyReference([otherOccurrence], ref).status, 'missing');
  assert.equal(matchTopologyReference([first, otherOccurrence], ref, { byOrigin: true }).status, 'ambiguous');
});

test('anonymous polygon positions remain revision-local while sweep caps retain semantic roles', async () => {
  const k = await loadKernel();
  const make = points => extrudeInBend(k, 'profile', points, plane, [0, 0, 4]);
  const before = make([[0, 0], [7, 0], [2, 5]]), after = make([[0, 0], [9, 0], [2, 5]]);
  assert.equal(before.identity.topology.faces[0].originId, after.identity.topology.faces[0].originId);
  assert.ok(before.identity.topology.faces.slice(2).every(entry => entry.stability === 'revision-local'));
  assert.ok(before.identity.topology.vertices.every(entry => entry.stability === 'revision-local'));
  assert.notEqual(before.identity.topology.vertices[0].originId, after.identity.topology.vertices[0].originId);
  assert.throws(() => topologyReference(before, 'vertex', 0, { persistent: true }), UnsupportedFeatureError);
  const ref = topologyReference(before, 'vertex', 0);
  assert.equal(matchTopologyReference([before], ref).status, 'matched');
  assert.equal(matchTopologyReference([after], ref).status, 'unsupported');
  assert.equal(matchTopologyReference([before], { ...ref, revision: null }).status, 'unsupported');
  assert.throws(() => extrudeInBend(k, 'invalid-box', [[0, 0], [7, 0], [2, 5]], plane, [0, 0, 4], [0, 0, 0], { primitive: 'box' }), /canonical four-corner rectangle/);
});

test('cylinders and frustums carry semantic cap, rim, lateral and seam identities', async () => {
  const k = await loadKernel(), before = cylinder(k), after = cylinder(k, 'cylinder', 7, 13);
  assert.deepEqual(origins(before), origins(after));
  assert.deepEqual(instances(before), instances(after));
  assert.notEqual(before.identity.revision, after.identity.revision);
  assert.deepEqual(before.identity.topology.edges.map(entry => entry.role), ['start/rim', 'end/rim', 'side/seam']);
  assert.deepEqual(before.identity.topology.vertices.map(entry => entry.role), ['start/seam', 'end/seam']);
  assert.ok(entries(before).every(entry => entry.stability === 'semantic'));
});

test('rigid copies preserve origin lineage and distinguish occurrences for planar and analytic B-reps', async () => {
  const k = await loadKernel();
  for (const source of [box(k), cylinder(k)]) {
    const transform = source.geometry === 'analytic' ? transformAnalytic : transformInBend;
    const first = transform(k, source, 'pattern/left', identityRows, [20, 0, 0]);
    const second = transform(k, source, 'pattern/right', identityRows, [40, 0, 0]);
    assert.deepEqual(origins(source), origins(first));
    assert.deepEqual(origins(first), origins(second));
    assert.ok(instances(first).every((instance, i) => instance !== instances(second)[i] && instance !== instances(source)[i]));
    assert.notEqual(first.identity.revision, source.identity.revision);
    assert.equal(first.identity.lineage.relation, 'rigid-transform');
    assert.equal(first.identity.lineage.parents[0].instanceId, source.identity.instanceId);
    assert.deepEqual(first.identity.operation.parentOperations, [source.identity.operation.id]);
    assert.equal(first.identity.topology.faces[0].lineage.parents[0].originId, source.identity.topology.faces[0].originId);
    const ref = topologyReference(source, 'face', 0, { persistent: true });
    assert.equal(matchTopologyReference([first, second], ref, { byOrigin: true }).status, 'ambiguous');
    assert.equal(matchTopologyReference([first], ref, { byOrigin: true }).status, 'matched');
  }
});

test('frozen imported body/face/edge/vertex IDs survive topology array reordering and cloning', async () => {
  const k = await loadKernel(), raw = importedSource();
  const first = importOnshapeBody(k, raw, 'import-a', sourceNamespace);
  const reordered = structuredClone(raw);
  for (const group of ['vertices', 'edges', 'faces']) reordered[group].reverse();
  const second = importOnshapeBody(k, reordered, 'import-b', sourceNamespace);
  assert.equal(first.identity.source.entityId, raw.id);
  assert.equal(first.identity.originId, second.identity.originId);
  assert.notEqual(first.identity.instanceId, second.identity.instanceId);
  for (const group of ['vertices', 'edges', 'faces']) {
    const sourceIds = new Map(first.identity.topology[group].filter(entry => entry.source).map(entry => [entry.source.entityId, entry.originId]));
    for (const entry of second.identity.topology[group].filter(entry => entry.source)) {
      assert.equal(entry.originId, sourceIds.get(entry.source.entityId));
      assert.equal(entry.stability, 'source');
    }
    assert.equal(sourceIds.size, raw[group].length);
    assert.ok(first.identity.topology[group].filter(entry => !entry.source).every(entry => entry.stability === 'revision-local'));
  }
  const clone = transformAnalytic(k, first, 'instance', identityRows, [10, 0, 0]);
  assert.deepEqual(clone.identity.source, first.identity.source);
  assert.deepEqual(origins(clone), origins(first));
  assert.deepEqual(clone.identity.topology.faces[0].source, first.identity.topology.faces[0].source);
});

test('unknown import namespaces remain explicit and different frozen inputs cannot collide', async () => {
  const k = await loadKernel(), raw = importedSource();
  const unknown = importOnshapeBody(k, raw, 'unknown', {});
  assert.equal(unknown.identity.source.namespace, null);
  assert.equal(unknown.identity.stability, 'revision-local');
  assert.throws(() => topologyReference(unknown, 'face', 0, { persistent: true }), UnsupportedFeatureError);
  const first = importOnshapeBody(k, raw, 'a', sourceNamespace);
  const otherRevision = importOnshapeBody(k, raw, 'a', { ...sourceNamespace, microversion: 'different-revision' });
  const otherDocument = importOnshapeBody(k, raw, 'a', { ...sourceNamespace, document: 'different-document' });
  assert.notEqual(first.identity.originId, otherRevision.identity.originId);
  assert.notEqual(first.identity.originId, otherDocument.identity.originId);
});

test('Boolean split results retain both input ancestries without claiming persistent entity matching', async () => {
  const k = await loadKernel(), a = cylinder(k, 'target'), b = cylinder(k, 'tool', 6, 2, 4);
  const results = booleanInBend(k, a, b, 'SUBTRACTION', 'split', { line: 17, column: 3 });
  assert.equal(results.length, 2);
  assert.notEqual(results[0].identity.originId, results[1].identity.originId);
  for (const body of results) {
    assert.ok(entries(body).every(entry => entry.stability === 'revision-local'));
    assert.deepEqual(body.identity.lineage.parents.map(parent => parent.originId), [a.identity.originId, b.identity.originId]);
    assert.match(body.identity.lineage.matching, /unsupported-split-merge/);
    assert.ok(entries(body).every(entry => entry.lineage.matching === 'unsupported-split-merge-correspondence'));
    assert.ok(body.identity.lineage.ambiguity);
    assert.throws(() => topologyReference(body, 'face', 0, { persistent: true }), UnsupportedFeatureError);
    assert.deepEqual(body.identity.operation.source, { file: null, sha256: null, span: { line: 17, column: 3 } });
  }
  const ref = topologyReference(results[0], 'face', 0);
  const unchangedLowerPiece = booleanInBend(k, cylinder(k, 'target', 5, 12), b, 'SUBTRACTION', 'split');
  assert.equal(unchangedLowerPiece[0].identity.revision, results[0].identity.revision);
  assert.equal(matchTopologyReference(unchangedLowerPiece, ref).status, 'matched');
  const changed = booleanInBend(k, cylinder(k, 'target', 5.5, 12), b, 'SUBTRACTION', 'split');
  assert.equal(matchTopologyReference(changed, ref).status, 'unsupported');
  const differentInput = booleanInBend(k, cylinder(k, 'other-target'), b, 'SUBTRACTION', 'split');
  assert.notEqual(results[0].identity.originId, differentInput[0].identity.originId);
});

test('operation source and parameter slots preserve evidence without inventing unknown locations', async () => {
  const k = await loadKernel(), plain = box(k);
  assert.deepEqual(plain.identity.operation.source, { file: null, sha256: null, span: null });
  const source = { file: 'part.fs', sha256: 'verified-source-hash', span: { line: 12, column: 4 }, callStack: [{ line: 31, column: 2 }] };
  const parameters = { widthMm: 10, heightMm: 4 };
  const attributed = box(k, 'box', 10, { source, parameters });
  assert.deepEqual(attributed.identity.operation.source, source);
  assert.deepEqual(attributed.identity.operation.parameters, parameters);
  assert.equal(attributed.identity.revision, plain.identity.revision);
  source.span.line = 99; parameters.widthMm = 999;
  assert.equal(attributed.identity.operation.source.span.line, 12);
  assert.equal(attributed.identity.operation.parameters.widthMm, 10);
});

test('identity metadata is additive and cannot change the existing STEP geometry export', async () => {
  const k = await loadKernel(), body = cylinder(k);
  const model = { backend: { version: 'test' }, bodies: [body] };
  const withIdentity = toStep(model, 'identity-check');
  const legacy = structuredClone(body); delete legacy.identity;
  assert.equal(toStep({ ...model, bodies: [legacy] }, 'identity-check'), withIdentity);
  const moved = transformAnalytic(k, legacy, 'unattributed-copy', identityRows, [1, 0, 0]);
  assert.equal(moved.identity.stability, 'revision-local');
  assert.throws(() => topologyReference(moved, 'face', 0, { persistent: true }), UnsupportedFeatureError);
});

test('identity keys of a Boolean chain stop growing with its depth and still name every parent', async () => {
  // Ten through-holes cut one after another from one plate (scripts/lang/wk-chain.mjs),
  // the chain whose brep.json outgrew the V8 string limit at 30 holes.
  const model = await build(plateSource(10), { feature: 'plateHoles' });
  const cuts = model.operationEvidence.filter(evidence => evidence.operation === 'SUBTRACTION');
  assert.equal(cuts.length, 10);
  // The plate after cut i: the next cut's recorded input, then the final body.
  const plates = [...cuts.slice(1).map(evidence => evidence.inputs[0].identity), model.bodies[0].identity];
  plates.forEach((plate, i) => {
    assert.equal(plate.operationId, `model/b${i}`);
    assert.equal(plate.lineage.parents[0].instanceId, cuts[i].inputs[0].identity.instanceId, `cut ${i} names the plate it cut`);
  });
  const longest = plates.map(plate => Math.max(...[plate, ...Object.values(plate.topology).flat()]
    .flatMap(entry => [entry.originId.length, entry.instanceId.length])));
  // Operation ids b0..b9 are equally long: the keys after cuts 6-10 are no longer than the longest after cuts 1-5.
  assert.ok(Math.max(...longest.slice(5)) <= Math.max(...longest.slice(0, 5)), `longest key per cut: ${longest.join(', ')}`);
});

}
