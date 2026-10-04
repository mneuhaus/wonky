// Immutable fixture binding for the Rust importer tests. These are authored
// analytic fixtures in the real STEP / frozen-capture schemas, not live proof.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const root = new URL('../fixtures/step-import/', import.meta.url);
test('planar import fixture bytes match frozen provenance', () => {
  const provenance = JSON.parse(readFileSync(new URL('provenance.json', root)));
  assert.equal(provenance.schema, 'wonky-import-fixture/1');
  assert.deepEqual(Object.keys(provenance.files).sort(), ['tetra-inch.step', 'tetra-si.step', 'tetra.capture.json']);
  for (const [file, entry] of Object.entries(provenance.files)) {
    assert.equal(createHash('sha256').update(readFileSync(new URL(file, root))).digest('hex'), entry.sha256, file);
  }
  assert.match(provenance.captureSchema, /synthetic test artifact/);
});
