import test from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missingBend();
if (publicTreeSkip) {
  test("geometry-summary.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { createHash } = await import("node:crypto");
const { spawnSync } = await import("node:child_process");
const { mkdtempSync, writeFileSync, readFileSync, rmSync } = await import("node:fs");
const { tmpdir } = await import("node:os");
const { join } = await import("node:path");
const { fileURLToPath } = await import("node:url");
const { build } = await import("../src/index.mjs");
const { createGeometryInspector, formatGeometrySummary, formatGeometryDetail, measureGeometrySummaryTokens } = await import("../src/geometry-summary.mjs");
const { historyEvidence, inputIdentity, serializeModel } = await import("../src/construction-history.mjs");
const { loadKernel, extrudeInBend } = await import("../src/kernel.mjs");
const { booleanInBend } = await import("../src/boolean.mjs");
const { transformAnalytic } = await import("../src/analytic.mjs");















const root = fileURLToPath(new URL('../', import.meta.url));
const source = readFileSync(new URL('../examples/bored-spacer.fs', import.meta.url), 'utf8');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
let example;
const model = async () => structuredClone(await (example ??= build(source, { sourceMap: true, sourcePath: '/example/bored-spacer.fs' })));
const reference = (inspector, alias) => ({ modelId: inspector.modelId, alias });
const run = args => spawnSync(process.execPath, ['bin/wonky-inspect.mjs', ...args], { cwd: root, encoding: 'utf8' });

test('overview exposes recorded geometry, compact alias ranges and explicit information limits', async () => {
  const raw = await model(), inspector = createGeometryInspector(raw), summary = inspector.summary();
  assert.deepEqual(summary.counts, { bodies: 1, faces: 4, edges: 6, vertices: 4 });
  assert.equal(summary.units, 'millimeter');
  const body = summary.bodies[0];
  assert.equal(body.alias, 'B1');
  assert.equal(body.volumeMm3, raw.bodies[0].validation.volumeMm3);
  assert.deepEqual(body.boundsMm, raw.bodies[0].validation.boundsMm);
  assert.deepEqual(body.edgeTypes, { circle: 4, line: 2 });
  assert.deepEqual(body.aliases.vertices, { count: 4, first: 'B1.V1', last: 'B1.V4' });
  assert.equal(body.faces[0].loops, 2, 'through-bore cap retains the recorded two-loop fact');
  assert.equal(body.faces[0].sameSense, raw.bodies[0].faces[0].sameSense, 'surface frame orientation must not be mistaken for the face orientation');
  assert.deepEqual(body.faces[2].surface, { type: 'cylinder', origin: [0, 0, 0], axis: [0, 0, 1], radius: 2 });
  assert.ok(summary.scope.omitted.includes('vertex coordinates'));
  assert.ok(summary.scope.notComputed.includes('voxel occupancy'));
  const text = formatGeometrySummary(summary);
  assert.match(text, /envelopes, not voxels\/occupancy/);
  assert.match(text, /B1\.F1 plane/);
  assert.match(text, /loops=2/);
  assert.match(text, /revision-local/);
  assert.doesNotMatch(text, /originId|instanceId/);
});

test('every body, face, edge and vertex alias resolves to its actual snapshot entity and identity', async () => {
  const raw = await model(), inspector = createGeometryInspector(raw), lookup = inspector.lookup();
  assert.equal(Object.keys(lookup).length, 15);
  for (const [alias, target] of Object.entries(lookup)) {
    assert.equal(target.modelId, inspector.modelId);
    assert.equal(target.bodyId, raw.bodies[0].id);
    const group = { face: 'faces', edge: 'edges', vertex: 'vertices' }[target.entityType];
    const identity = group ? raw.bodies[0].identity.topology[group][target.entityIndex] : raw.bodies[0].identity;
    assert.equal(target.identity.originId, identity.originId, alias);
    assert.equal(target.identity.instanceId, identity.instanceId, alias);
    assert.equal(target.identity.revision, identity.revision, alias);
    assert.equal(target.geometryRevision, raw.bodies[0].identity.revision);
  }
  assert.deepEqual(inspector.resolve(reference(inspector, 'B1.F2')), lookup['B1.F2']);
  assert.throws(() => inspector.resolve({ alias: 'B1.F2' }), /matching immutable modelId/);
  assert.throws(() => inspector.resolve(reference(inspector, 'B1.F99')), /Unknown geometry alias/);
  assert.throws(() => inspector.resolve(reference(inspector, '__proto__')), /Unknown geometry alias/);
});

test('optional body overview omits face descriptors explicitly while preserving every alias and default summary', async () => {
  const inspector = createGeometryInspector(await model()), overview = inspector.summary({ includeFaces: false });
  assert.equal(overview.detailLevel, 'bodies');
  assert.equal(overview.bodies[0].faces, undefined);
  assert.equal(overview.bodies[0].aliases.faces.count, 4);
  assert.ok(overview.scope.omitted.includes('face surface descriptors and incident edge lists'));
  assert.match(formatGeometrySummary(overview), /Face descriptors omitted/);
  assert.doesNotMatch(formatGeometrySummary(overview), /B1\.F1 plane/);
  assert.equal(inspector.resolve(reference(inspector, 'B1.F1')).entityType, 'face');
  assert.equal(inspector.summary().bodies[0].faces.length, 4);
});

test('face/edge/vertex detail preserves exact data, coedge winding, seam uses and source evidence', async () => {
  const raw = await model(), inspector = createGeometryInspector(raw), body = raw.bodies[0];
  const face = inspector.detail(reference(inspector, 'B1.F1'));
  assert.deepEqual(face.geometry, body.faces[0]);
  assert.deepEqual(face.relations.loops.map(loop => loop.uses.map(use => use.forward)), body.faces[0].loops.map(loop => loop.map(use => use.forward)));
  assert.equal(face.identity.originId, body.identity.topology.faces[0].originId);
  assert.deepEqual(face.operation, body.identity.operation);
  assert.deepEqual(face.source, body.identity.operation.source);
  const seamIndex = body.edges.findIndex(edge => edge.curve.type === 'line');
  const edge = inspector.detail(reference(inspector, `B1.E${seamIndex + 1}`));
  assert.deepEqual(edge.geometry, body.edges[seamIndex]);
  assert.equal(edge.relations.uses.length, 2);
  assert.equal(edge.relations.uses[0].face, edge.relations.uses[1].face);
  assert.notEqual(edge.relations.uses[0].forward, edge.relations.uses[1].forward);
  const vertex = inspector.detail(reference(inspector, edge.relations.start));
  assert.deepEqual(vertex.geometry.point, body.vertices[body.edges[seamIndex].start]);
  assert.ok(vertex.relations.edges.includes(edge.reference.alias));
  assert.match(formatGeometryDetail(face), /Original selected B-rep data/);
  const complete = inspector.detail(reference(inspector, 'B1'));
  assert.deepEqual(complete.geometry.vertices, body.vertices);
  assert.deepEqual(complete.geometry.edges, body.edges);
  assert.deepEqual(complete.geometry.faces, body.faces);
});

test('unknown volume/bounds remain null and are never filled from vertices or bounding boxes', async () => {
  const raw = await model();
  raw.bodies[0].validation.volumeMm3 = null;
  raw.bodies[0].validation.boundsMm = null;
  const inspector = createGeometryInspector(raw), summary = inspector.summary();
  assert.equal(summary.bodies[0].volumeMm3, null);
  assert.equal(summary.bodies[0].boundsMm, null);
  assert.match(formatGeometrySummary(summary), /volume=unknown mm³; bounds=unknown mm/);
  assert.doesNotMatch(formatGeometrySummary(summary), /volume=0/);
  assert.equal(inspector.detail(reference(inspector, 'B1')).bodyValidation.volumeMm3, null);
});

test('exact model bytes share review-server hashes and reject cross-revision or unverified IDs', async () => {
  const raw = await model(), bytes = Buffer.from(JSON.stringify(raw, null, 2) + '\n');
  const inspector = createGeometryInspector(raw, { modelBytes: bytes, modelId: hash(bytes) });
  assert.equal(inspector.modelId, hash(bytes));
  const compact = createGeometryInspector(raw);
  assert.notEqual(compact.modelId, inspector.modelId, 'byte formatting is part of the frozen snapshot revision');
  assert.throws(() => compact.resolve(reference(inspector, 'B1.F1')), /matching immutable modelId/);
  assert.throws(() => createGeometryInspector(raw, { modelId: 'f'.repeat(64) }), /does not match/);
  const changed = structuredClone(raw); changed.bodies[0].name = 'Different label, different model snapshot';
  assert.throws(() => createGeometryInspector(changed, { modelBytes: bytes }), /model object differ/);
  assert.throws(() => createGeometryInspector(changed).detail(reference(inspector, 'B1')), /matching immutable modelId/);
});

test('inspector snapshots are isolated from input and returned-data mutations', async () => {
  const raw = await model(), inspector = createGeometryInspector(raw), expected = inspector.detail(reference(inspector, 'B1.V1'));
  raw.bodies[0].vertices[0][0] += 1000;
  const summary = inspector.summary(); summary.bodies[0].faces[0].edges.length = 0;
  const detail = inspector.detail(reference(inspector, 'B1.V1')); detail.geometry.point[0] = -1234;
  assert.deepEqual(inspector.detail(reference(inspector, 'B1.V1')), expected);
  assert.ok(inspector.summary().bodies[0].faces[0].edges.length > 0);
});

test('legacy models retain revision-bound access without invented persistent IDs', async () => {
  const raw = await model(); delete raw.bodies[0].identity;
  const inspector = createGeometryInspector(raw);
  assert.equal(inspector.summary().bodies[0].identity, null);
  assert.equal(inspector.resolve(reference(inspector, 'B1.F1')).identity, null);
  assert.match(inspector.resolve(reference(inspector, 'B1.F1')).geometryRevision, /^sha256:/);
  assert.equal(inspector.detail(reference(inspector, 'B1.F1')).identity, null);
});

test('stale identities and ambiguous or broken topology data fail explicitly', async () => {
  const raw = await model();
  const stale = structuredClone(raw); stale.bodies[0].vertices[0][0] += 1;
  assert.throws(() => createGeometryInspector(stale), /Stale geometry revision/);
  const staleFace = structuredClone(raw); staleFace.bodies[0].identity.topology.faces[0].revision = 'old';
  assert.throws(() => createGeometryInspector(staleFace), /stale face identity/);
  const duplicate = structuredClone(raw); duplicate.bodies.push(structuredClone(duplicate.bodies[0]));
  assert.throws(() => createGeometryInspector(duplicate), /Duplicate body IDs/);
  const broken = structuredClone(raw); broken.bodies[0].faces[0].loops[0][0].edge = 999;
  assert.throws(() => createGeometryInspector(broken), /invalid coedges/);
});

test('CLI emits JSON/text overview and requires the correct revision for details and lookup', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'wonky-inspect-'));
  try {
    const file = join(directory, 'part.brep.json'), out = join(directory, 'packet.json');
    writeFileSync(file, JSON.stringify(await model(), null, 2));
    const overview = run([file, '--format', 'json']);
    assert.equal(overview.status, 0, overview.stderr);
    const summary = JSON.parse(overview.stdout);
    assert.equal(summary.modelId, hash(readFileSync(file)));
    const detail = run([file, '--detail', 'B1.F1', '--revision', summary.modelId, '--format', 'json', '--out', out]);
    assert.equal(detail.status, 0, detail.stderr);
    assert.equal(JSON.parse(readFileSync(out, 'utf8')).reference.alias, 'B1.F1');
    const lookup = run([file, '--lookup', 'B1.V1', '--revision', summary.modelId]);
    assert.equal(lookup.status, 0, lookup.stderr);
    assert.equal(JSON.parse(lookup.stdout).entityType, 'vertex');
    assert.match(run([file]).stdout, /Aliases require this modelId/);
    assert.equal(run([file, '--detail', 'B1.F1']).status, 1);
    assert.equal(run([file, '--lookup', 'B1.F1', '--revision', '0'.repeat(64)]).status, 1);
    assert.equal(run([file, '--format', 'voxels']).status, 1);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('optional tokenizer failures never turn into estimated token counts', async () => {
  const inspector = createGeometryInspector(await model());
  await assert.rejects(measureGeometrySummaryTokens(inspector, { python: '/no/such/local-tokenizer' }), /Cannot start local tokenizer/);
  await assert.rejects(measureGeometrySummaryTokens(inspector, { timeoutMs: 0 }), /positive integer/);
});

test('brep.json stores each evidence input identity once and still resolves every recorded face and edge origin', async () => {
  const k = await loadKernel(), frame = { origin: [0, 0, 0], normal: [0, 0, 1], x: [1, 0, 0] };
  const box = (name, low, high) => extrudeInBend(k, name, [[low[0], low[1]], [high[0], low[1]], [high[0], high[1]], [low[0], high[1]]],
    { ...frame, origin: [0, 0, low[2]] }, [0, 0, high[2] - low[2]]);
  const cut = (body, tool, id) => booleanInBend(k, body, tool, 'SUBTRACTION', id);
  // Three chained cuts with a transform between the first two, and a congruent second
  // plate/tool pair: same geometry revisions, different identities (originId).
  const first = cut(box('plate', [0, 0, 0], [20, 10, 4]), box('tool1', [2, 2, 2], [5, 8, 6]), 'cut1');
  const moved = transformAnalytic(k, first[0], 'move', [[1, 0, 0], [0, 1, 0], [0, 0, 1]], [1, 0, 0]);
  const second = cut(moved, box('tool2', [8, 2, 2], [11, 8, 6]), 'cut2');
  const third = cut(second[0], box('tool3', [14, 2, 2], [17, 8, 6]), 'cut3');
  const twin = cut(box('plateTwin', [0, 0, 0], [20, 10, 4]), box('toolTwin', [2, 2, 2], [5, 8, 6]), 'cutTwin');
  const operationEvidence = [first, second, third, twin].map(outputs => outputs.operationEvidence[0]);
  const raw = { schema: 'wonky-brep/1', units: 'millimeter', operationEvidence, bodies: [third[0], twin[0]] };
  const json = serializeModel(raw), saved = JSON.parse(json);
  const recorded = operationEvidence.flatMap(evidence => evidence.inputs.map(input => JSON.parse(JSON.stringify(input.identity))));
  const savedInputs = [...saved.operationEvidence, ...saved.bodies.flatMap(body => body.operationHistory.map(entry => entry.evidence))]
    .flatMap(evidence => evidence.inputs);
  assert.ok(savedInputs.every(input => !Object.hasOwn(input, 'identity') && typeof input.identityRef === 'string'));
  saved.operationEvidence.forEach((evidence, e) => evidence.inputs.forEach((input, i) =>
    assert.deepEqual(inputIdentity(saved, input), recorded[e * 2 + i], `${evidence.operationId} operand ${i}`)));
  assert.equal(Object.keys(saved.inputIdentities).length, new Set(recorded.map(identity => JSON.stringify(identity))).size);
  assert.ok(Object.keys(saved.inputIdentities).some(key => key.endsWith('#2')), 'the twin shares revisions with other identities');
  const live = createGeometryInspector(raw), fromFile = createGeometryInspector(saved, { modelBytes: Buffer.from(json) });
  let resolved = 0;
  raw.bodies.forEach((body, b) => [['F', body.faces], ['E', body.edges]].forEach(([letter, entities]) => entities.forEach((_, index) => {
    const alias = `B${b + 1}.${letter}${index + 1}`;
    const expected = JSON.parse(JSON.stringify(live.detail(reference(live, alias)).constructionOrigin));
    assert.deepEqual(fromFile.detail(reference(fromFile, alias)).constructionOrigin, expected, alias);
    for (const ref of expected.references) {
      assert.equal(ref.status, 'recorded-input-reference', alias);
      assert.ok(ref.identity, alias);
      resolved++;
    }
  })));
  assert.ok(resolved > raw.bodies.reduce((sum, body) => sum + body.faces.length, 0), `${resolved} face and edge references`);
});

// Each cut of a chain re-identifies every entity of the growing plate, and each entity
// names its parents' keys and repeats its origin inside its instance. Written out per
// entity, 200 chained holes exceeded V8's string limit (RangeError: Invalid string length).
test('the input identities of a Boolean chain are written in less space than their entities\' instance keys alone, losslessly', async () => {
  const k = await loadKernel(), frame = { origin: [0, 0, 0], normal: [0, 0, 1], x: [1, 0, 0] };
  const box = (name, low, high) => extrudeInBend(k, name, [[low[0], low[1]], [high[0], low[1]], [high[0], high[1]], [low[0], high[1]]],
    { ...frame, origin: [0, 0, low[2]] }, [0, 0, high[2] - low[2]]);
  let plate = box('plate', [0, 0, 0], [100, 10, 4]);
  const operationEvidence = [];
  for (let i = 0; i < 16; i++) {
    const [body] = booleanInBend(k, plate, box(`tool${i}`, [2 + 6 * i, 2, 2], [5 + 6 * i, 8, 6]), 'SUBTRACTION', `cut${i}`);
    operationEvidence.push(body.operationHistory[0].evidence);
    plate = body;
  }
  const raw = { schema: 'wonky-brep/1', units: 'millimeter', operationEvidence, bodies: [plate] };
  const json = serializeModel(raw), saved = JSON.parse(json);
  const recorded = operationEvidence.flatMap(evidence => evidence.inputs.map(input => JSON.parse(JSON.stringify(input.identity))));
  saved.operationEvidence.forEach((evidence, e) => evidence.inputs.forEach((input, i) =>
    assert.deepEqual(inputIdentity(saved, input), recorded[e * 2 + i], `${evidence.operationId} operand ${i}`)));
  const instanceKeys = recorded.reduce((sum, identity) => sum + Object.values(identity.topology).flat()
    .reduce((total, entity) => total + entity.instanceId.length, 0), 0);
  const stored = JSON.stringify({ inputIdentities: saved.inputIdentities, identityPool: saved.identityPool }).length;
  assert.ok(stored < instanceKeys, `${stored} bytes of input identities, ${instanceKeys} bytes of their entities' instance keys`);
  assert.equal(serializeModel(saved), json, 'a written model writes the same text again');
});

test('a model without an evidence list (Python, wonky-compare) still writes the earlier Booleans its history references', async () => {
  const k = await loadKernel(), frame = { origin: [0, 0, 0], normal: [0, 0, 1], x: [1, 0, 0] };
  const box = (name, low, high) => extrudeInBend(k, name, [[low[0], low[1]], [high[0], low[1]], [high[0], high[1]], [low[0], high[1]]],
    { ...frame, origin: [0, 0, low[2]] }, [0, 0, high[2] - low[2]]);
  // python.mjs chains booleanInBend like this and returns { schema, units, source, bodies }.
  // step0 is reachable only through step1's input history, and step1 only through the moved copy.
  const cut = (body, tool, id) => booleanInBend(k, body, tool, 'SUBTRACTION', id);
  const step0 = cut(box('plate', [0, 0, 0], [30, 10, 4]), box('t1', [2, 2, 2], [5, 8, 6]), 'python/~step0');
  const step1 = cut(step0[0], box('t2', [9, 2, 2], [12, 8, 6]), 'python/~step1');
  const moved = transformAnalytic(k, step1[0], 'python/move', [[1, 0, 0], [0, 1, 0], [0, 0, 1]], [1, 0, 0]);
  const step2 = cut(moved, box('t3', [20, 2, 2], [23, 8, 6]), 'python/~step2');
  const raw = { schema: 'wonky-brep/1', units: 'millimeter', source: { language: 'Python' }, bodies: [step2[0]] };
  const earlier = evidence => historyEvidence(raw, evidence.inputs[0].history[0]);
  assert.equal(earlier(step2.operationEvidence[0]), step1.operationEvidence[0]);
  assert.equal(earlier(earlier(step2.operationEvidence[0])), step0.operationEvidence[0]);
  const saved = JSON.parse(serializeModel(raw));
  assert.deepEqual(saved.operationEvidence.map(evidence => evidence.operationId).sort(), ['python/~step0', 'python/~step1', 'python/~step2']);
  const fromFile = evidence => historyEvidence(saved, evidence.inputs[0].history[0]);
  const resolved = fromFile(fromFile(saved.bodies[0].operationHistory[0].evidence)), written = step0.operationEvidence[0];
  assert.equal(resolved?.operationId, 'python/~step0');
  assert.deepEqual(resolved.inputs.map(input => input.bodyId), ['plate', 't1']);
  assert.deepEqual(resolved.outputs, JSON.parse(JSON.stringify(written.outputs)));
  assert.deepEqual(resolved.inputs.map(input => inputIdentity(saved, input)), JSON.parse(JSON.stringify(written.inputs.map(input => input.identity))));
  // A producer's own list is kept as it is: nothing it already holds is added again.
  const own = [step0, step1, step2].map(outputs => outputs.operationEvidence[0]);
  const listed = JSON.parse(serializeModel({ ...raw, operationEvidence: own }));
  assert.deepEqual(listed.operationEvidence.map(evidence => evidence.operationId), ['python/~step0', 'python/~step1', 'python/~step2']);
});

}
