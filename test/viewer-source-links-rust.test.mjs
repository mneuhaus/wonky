import test from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missingBend();
if (publicTreeSkip) {
  test("viewer-source-links-rust.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { readFileSync } = await import("node:fs");
const { build } = await import("../src/index.mjs");
const { HISTORY_SCHEMA, operationHistory } = await import("../src/viewer/history.mjs");
// Source links on Rust bodies: the counterpart of test/viewer-source-links.test.mjs for the
// data a Rust body carries. Rust WC0 bodies have no recorded topology identity, so the
// per-face and per-edge sketch-entity links of the Bend lane do not exist here and the
// history says so ("unsupported on Rust"); operation spans, call paths, parameters and
// the body-level operation link are the same recorded data and are pinned below.






const FILE = '/private/var/folders/q1/x y/T/wonky-live/arc slot.fs';
const ARC_SLOT = readFileSync(new URL('./viewer-source-links.test.mjs', import.meta.url), 'utf8')
  .match(/const ARC_SLOT = `([\s\S]*?)`;/)[1];
const arcSlot = await build(ARC_SLOT, { sourcePath: FILE });
const doc = operationHistory(arcSlot, { modelId: 'a'.repeat(64) });

test('Rust history lists recorded calls with spans, call paths and mm/deg parameters', () => {
  assert.equal(doc.schema, HISTORY_SCHEMA);
  assert.equal(doc.available, true);
  assert.deepEqual(doc.operations.map(op => [op.name, op.span.line]), [
    ['newSketchOnPlane', 6], ['skLineSegment', 9], ['skArc', 10], ['skLineSegment', 11],
    ['skArc', 12], ['skSolve', 13], ['opExtrude', 14],
  ]);
  const extrude = doc.operations[6];
  assert.equal(extrude.file, FILE);
  assert.deepEqual(extrude.outputs, [{ bodyId: 'model/slot', alias: 'B1' }]);
  assert.deepEqual(extrude.callPath.map(frame => frame.name), ['arcSlot']);
  assert.deepEqual(extrude.parametersDisplay.find(row => row.path === '[1].endDepth'),
    { path: '[1].endDepth', value: 4, unit: 'mm', si: 0.004 });
  assert.equal(doc.bodies[0].operation, 6);
});

test('Rust history links the body to its operation and says the face and edge links are unsupported', () => {
  const [body] = doc.bodies;
  assert.match(body.unsupported, /^unsupported on Rust: per-face and per-edge sketch-entity links/);
  assert.equal(body.faces.length, 6);
  assert.equal(body.edges.length, 12);
  assert.ok(body.faces.every(face => face.operation === 6 && face.sketchEntity === undefined));
  assert.ok(body.edges.every(edge => edge.sketchEntity === undefined));
  const { lines, file } = doc.files[0];
  assert.equal(file, FILE);
  assert.deepEqual(lines[14].links.map(link => [link.relation, link.targets.map(t => t.alias)]), [['operation', ['B1']]]);
  for (const line of [6, 9, 10, 11, 12, 13]) assert.deepEqual(lines[line].links, [], `line ${line} states no link, none is invented`);
  assert.equal(lines[7], undefined, 'no recorded call at line 7');
});

}
