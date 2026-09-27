import test from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missingBend();
if (publicTreeSkip) {
  test("native-bridge-build-guard.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { mkdtempSync, rmSync, writeFileSync, readFileSync, unlinkSync } = await import("node:fs");
const { tmpdir } = await import("node:os");
const { join } = await import("node:path");
const { hashFile, statInputs, touchedInputs } = await import("../src/native/build-key.mjs");







// Regression: an input edited during a native build and reverted before it
// ended kept its content hash, so the edited binary was cached under the
// clean source hash. The build now compares file identities before publishing.
test('an edit reverted during the build still counts as a changed input', () => {
  const root = mkdtempSync(join(tmpdir(), 'wonky-build-guard-'));
  try {
    writeFileSync(join(root, 'a.bend'), 'def a() -> U32:\n  1\n');
    writeFileSync(join(root, 'b.bend'), 'def b() -> U32:\n  2\n');
    const files = ['a.bend', 'b.bend'].map(path => ({ path, sha256: hashFile(root, path) }));
    const before = statInputs(root, files);
    assert.deepEqual(touchedInputs(root, before), []);

    const original = readFileSync(join(root, 'a.bend'));
    writeFileSync(join(root, 'a.bend'), 'def a() -> U32:\n  999\n');
    writeFileSync(join(root, 'a.bend'), original);
    assert.equal(hashFile(root, 'a.bend'), files[0].sha256, 'content is back to the hashed bytes');
    assert.deepEqual(touchedInputs(root, before), ['a.bend']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a deleted input counts as changed', () => {
  const root = mkdtempSync(join(tmpdir(), 'wonky-build-guard-'));
  try {
    writeFileSync(join(root, 'a.bend'), 'def a() -> U32:\n  1\n');
    const before = statInputs(root, [{ path: 'a.bend' }]);
    unlinkSync(join(root, 'a.bend'));
    assert.deepEqual(touchedInputs(root, before), ['a.bend']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

}
