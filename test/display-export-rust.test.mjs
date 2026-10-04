import test from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missingBend();
if (publicTreeSkip) {
  test("display-export-rust.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { readFileSync } = await import("node:fs");
const { createHash } = await import("node:crypto");
const { build } = await import("../src/index.mjs");
const { displayMesh } = await import("../src/display-export.mjs");
const { viewerRecord } = await import("../src/viewer/model-record.mjs");
// Display export of Rust (WC0) bodies: the counterpart of test/display-export.test.mjs
// (whose second case is written for Bend topology identity and the 'analytic' Bend
// carriers). Same evidence: every face covered, deterministic bytes, stated
// approximation, stale and incomplete inputs rejected without a partial mesh.








const recordOf = async name => viewerRecord(await build(readFileSync(new URL(`../examples/${name}.fs`, import.meta.url), 'utf8')));

test('Rust display export covers every face with revision and approximation evidence', async () => {
  const model = await recordOf('bored-spacer');
  const bytes = JSON.stringify(model), sha256 = createHash('sha256').update(bytes).digest('hex');
  const first = await displayMesh(bytes), second = await displayMesh(bytes);
  assert.equal(first.stl, second.stl);
  assert.equal(first.manifest.meshSha256, second.manifest.meshSha256);
  assert.equal(first.manifest.modelSha256, sha256);
  assert.match(first.manifest.purpose, /display only/);
  assert.equal(first.manifest.faceCount, model.bodies.reduce((sum, body) => sum + body.faces.length, 0));
  assert.equal(first.manifest.omittedFaces, 0);
  assert.equal(first.manifest.triangleCount, (first.stl.match(/  facet normal /g) ?? []).length);
  let cylinders = 0;
  for (const face of first.manifest.faces) {
    assert.ok(face.triangleCount > 0);
    assert.equal(face.displayTessellation.source, 'rust-mesh');
    if (face.surfaceType === 'cylinder') {
      cylinders++;
      assert.equal(face.displayTessellation.approximate, true);
      assert.ok(face.displayTessellation.maxChordalErrorBoundMm <= 0.02);
    } else assert.equal(face.displayTessellation.approximate, false);
  }
  assert.equal(cylinders, 2);
  assert.equal(JSON.stringify(model), bytes);
});

test('Rust display export rejects stale records and incomplete faces without partial mesh results', async () => {
  const model = await recordOf('box');
  const stale = structuredClone(model); stale.bodies[0].vertices[0][0] += 1;
  await assert.rejects(displayMesh(JSON.stringify(stale)), /Stale geometry revision/);
  const words = Buffer.from(model.bodies[0].wc0Words, 'base64');
  const corrupt = structuredClone(model);
  corrupt.bodies[0].wc0Words = words.subarray(0, words.length - 4).toString('base64');
  await assert.rejects(displayMesh(JSON.stringify(corrupt)), /Display export incomplete/);
  await assert.rejects(displayMesh(JSON.stringify(model), { toleranceMm: 0 }), /Display tolerance/);
  await assert.rejects(displayMesh(JSON.stringify({ ...model, units: 'meter' })), /millimeter/);
});

}
