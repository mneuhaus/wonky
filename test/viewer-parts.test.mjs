import test from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missingBend();
if (publicTreeSkip) {
  test("viewer-parts.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { mkdtemp, mkdir, readFile, rm, writeFile } = await import("node:fs/promises");
const { tmpdir } = await import("node:os");
const { join } = await import("node:path");
const { build } = await import("../src/index.mjs");
const { createReviewServer } = await import("../src/review-server.mjs");
const { PARTS_SCHEMA, appearanceRgb, partsDocument, partsOf, rgbHex, settingsKeys } = await import("../src/viewer/parts.mjs");
const { appearanceColor } = await import("../viewer/render/style.js");
// parts-tree (server): partsOf / partsDocument over the multi-body QA
// fixture and GET /api/models/:id/parts through the review server.










const fixture = new URL('../scripts/viewer/qa/fixtures/multi-body.fs', import.meta.url);
const directory = await mkdtemp(join(tmpdir(), 'wonky-parts-'));
const sourcePath = join(directory, 'multi-body.fs');
const text = await readFile(fixture, 'utf8');
await writeFile(sourcePath, text);
const model = await build(text, { sourcePath });
const modelPath = join(directory, 'multi-body.brep.json');
await writeFile(modelPath, JSON.stringify(model, null, 2) + '\n');
test.after(() => rm(directory, { recursive: true, force: true }));

test('the multi-body fixture has four bodies with raw and logical face counts', () => {
  const { bodies, totals, logicalFacesReason } = partsOf(model);
  assert.equal(logicalFacesReason, null);
  assert.deepEqual(bodies.map(body => [body.alias, body.label, body.settingsKey]), [
    ['B1', 'Base plate', 'Base plate'],
    ['B2', 'Bracket', 'Bracket'],
    ['B3', 'Pin', 'Pin'],
    ['B4', 'model/spacer', 'model/spacer'],
  ]);
  const [plate, bracket, pin, spacer] = bodies;
  assert.deepEqual(plate.counts, { faces: 46, logicalFaces: 11, edges: 92, vertices: 48 },
    'the unioned pad splits the plate top into coplanar fragments');
  assert.equal(bracket.counts.faces, 8);
  assert.equal(bracket.counts.logicalFaces, 8);
  assert.deepEqual([pin.counts.faces, spacer.counts.faces], [3, 6]);
  assert.deepEqual(totals, { bodies: 4, faces: 63, logicalFaces: 28, edges: 125, vertices: 70 });
  assert.equal(spacer.name, null, 'a body without a name is listed by its id');
});

test('appearance colors are recorded data; bodies without appearance have none', () => {
  const [plate, bracket, pin, spacer] = partsOf(model).bodies;
  assert.deepEqual(plate.color, { rgb: [0.55, 0.68, 0.58], hex: '#8cad94', source: 'appearance' });
  assert.deepEqual(bracket.color.hex, '#cc8552');
  assert.deepEqual(plate.appearance, { red: 0.55, green: 0.68, blue: 0.58, alpha: 1 });
  assert.equal(pin.color, null);
  assert.equal(pin.appearance, null);
  assert.equal(spacer.color, null);
  // Same rule as the renderer (viewer/render/style.js appearanceColor).
  for (const record of [
    { red: 0.2, green: 0.4, blue: 0.6 }, { red: 51, green: 102, blue: 153 },
    { color: { red: 51, green: 102, blue: 153 }, opacity: 255 }, [0.1, 0.2, 0.3],
    { red: 'x' }, null, 'red',
  ]) {
    assert.deepEqual(appearanceRgb(record), appearanceColor(record), JSON.stringify(record));
  }
  assert.equal(rgbHex([1, 0.5, 0]), '#ff8000');
});

test('recorded volume, bounds, representation and the producing operation', () => {
  const [plate, bracket, pin] = partsOf(model).bodies;
  assert.ok(Math.abs(plate.volumeMm3 - 11520) < 1e-6);
  // Viewer contract: the recorded kernel bounds pass through unchanged.
  model.bodies.slice(0, 2).forEach((body, index) => {
    const { boundsMm } = partsOf(model).bodies[index];
    assert.deepEqual([boundsMm.min, boundsMm.max], [body.validation.boundsMm.min,
      body.validation.boundsMm.max]);
    assert.deepEqual(boundsMm.size, boundsMm.max.map((value, axis) => value - boundsMm.min[axis]));
  });
  // Geometry: the boxes of the fixture, within the recorded tolerance of each
  // body (the last bits of a recorded bound are the kernel's, not the
  // viewer's: in-flight kernel work moved plate min z to 1.6e-16).
  const within = (actual, expected, tolerance, what) => actual.forEach((value, axis) => assert.ok(
    Math.abs(value - expected[axis]) <= tolerance, `${what}: ${actual} vs ${expected} ±${tolerance}`));
  within(plate.boundsMm.min, [0, 0, 0], plate.toleranceMm, 'plate min');
  within(plate.boundsMm.size, [60, 40, 9], plate.toleranceMm, 'plate size');
  within(bracket.boundsMm.min, [34, 2, 4], bracket.toleranceMm, 'bracket min');
  assert.equal(plate.representation.geometry, 'analytic');
  assert.equal(bracket.representation.geometry, 'planar');
  assert.equal(plate.representation.closed, true);
  assert.equal(plate.operation.id, 'model/base');
  assert.equal(plate.operation.name, 'opBoolean');
  assert.equal(plate.operation.source.span.line, 22);
  assert.equal(pin.operation.name, 'opExtrude');
  assert.equal(plate.operation.source.file, sourcePath);
  assert.ok(plate.toleranceMm > 0);
  assert.equal(plate.provenance, null);
});

test('settings keys use the name only when it is unique in the model', () => {
  assert.deepEqual(settingsKeys([
    { id: 'a', name: 'Lid' }, { id: 'b', name: 'Clip' }, { id: 'c', name: 'Clip' },
    { id: 'd' }, { id: 'e', name: '' },
  ]), ['Lid', 'b', 'c', 'd', 'e']);
});

test('a logical grouping failure keeps raw counts and states the reason', () => {
  const result = partsOf(model, { logical: () => {
    throw new Error('classification unavailable');
  } });
  assert.equal(result.logicalFacesReason, 'classification unavailable');
  assert.ok(result.bodies.every(body => body.counts.logicalFaces === null));
  assert.equal(result.totals.logicalFaces, null);
  assert.equal(result.totals.faces, 63);
  assert.throws(() => partsOf({ schema: 'other' }), /wonky-brep\/1/);
});

test('recorded nulls stay null ("not evaluated"), never 0', () => {
  const copy = structuredClone(model);
  copy.bodies[0].validation.volumeMm3 = null;
  copy.bodies[0].validation.boundsMm = null;
  const [plate] = partsOf(copy).bodies;
  assert.equal(plate.volumeMm3, null);
  assert.equal(plate.boundsMm, null);
});

test('GET /api/models/:id/parts answers the parts document; unknown ids are 404', async () => {
  const reviews = join(directory, 'reviews');
  await mkdir(reviews, { recursive: true });
  const server = await createReviewServer({ modelPaths: [modelPath], root: directory,
    reviewDirectory: reviews, port: 0 });
  try {
    const workspace = await (await fetch(server.origin + '/api/workspace')).json();
    const [{ id }] = workspace.models;
    const response = await fetch(`${server.origin}/api/models/${id}/parts`);
    assert.equal(response.status, 200);
    const document = await response.json();
    assert.equal(document.schema, PARTS_SCHEMA);
    assert.equal(document.modelId, id);
    assert.deepEqual(document, JSON.parse(JSON.stringify(partsDocument(model, id))));
    assert.equal(document.exactness.logicalFaces, 'exact-parameters');
    assert.equal(document.exactness.volumeMm3, 'recorded');
    const again = await (await fetch(`${server.origin}/api/models/${id}/parts`)).json();
    assert.deepEqual(again, document, 'cached per revision');
    const unknown = await fetch(`${server.origin}/api/models/${'0'.repeat(64)}/parts`);
    assert.equal(unknown.status, 404);
    assert.match((await unknown.json()).error, /Unknown model revision/);
  } finally {
    await server.close();
  }
});

}
