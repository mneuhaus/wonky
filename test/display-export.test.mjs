import test from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missingBend();
if (publicTreeSkip) {
  test("display-export.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { readFileSync } = await import("node:fs");
const { createHash } = await import("node:crypto");
const { build } = await import("../src/index.mjs");
const { displayMesh } = await import("../src/display-export.mjs");







test('analytic display export covers every face with revision and approximation evidence', async () => {
  const model = await build(readFileSync(new URL('../examples/bored-spacer.fs', import.meta.url), 'utf8'));
  const bytes = JSON.stringify(model), sha256 = createHash('sha256').update(bytes).digest('hex');
  const first = await displayMesh(bytes), second = await displayMesh(bytes);
  assert.equal(first.stl, second.stl);
  assert.equal(first.manifest.meshSha256, second.manifest.meshSha256);
  assert.equal(first.manifest.modelSha256, sha256);
  assert.match(first.manifest.purpose, /display only/);
  assert.equal(first.manifest.faceCount, model.bodies.reduce((sum, body) => sum + body.faces.length, 0));
  assert.equal(first.manifest.omittedFaces, 0);
  assert.equal(first.manifest.triangleCount, (first.stl.match(/  facet normal /g) ?? []).length);
  for (const face of first.manifest.faces) {
    assert.ok(face.triangleCount > 0);
    if (face.surfaceType === 'cylinder') {
      assert.equal(face.displayTessellation.approximate, true);
      assert.ok(face.displayTessellation.maxChordalErrorBoundMm <= 0.02);
    }
  }
  assert.equal(JSON.stringify(model), bytes);
});

test('display exports reject stale revisions and incomplete faces without partial mesh results', async () => {
  const model = await build(readFileSync(new URL('../examples/box.fs', import.meta.url), 'utf8'));
  const stale = structuredClone(model); stale.bodies[0].vertices[0][0] += 1;
  await assert.rejects(displayMesh(JSON.stringify(stale)), /Stale geometry revision/);
  const unsupported = structuredClone(model); delete unsupported.bodies[0].identity;
  unsupported.bodies[0].geometry = 'analytic'; unsupported.bodies[0].faces[0].surface.type = 'sphere';
  await assert.rejects(displayMesh(JSON.stringify(unsupported)), /Display export incomplete/);
  await assert.rejects(displayMesh(JSON.stringify(model), { toleranceMm: 0 }), /Display tolerance/);
  await assert.rejects(displayMesh(JSON.stringify({ ...model, units: 'meter' })), /millimeter/);
});

}
