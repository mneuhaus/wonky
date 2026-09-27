import test from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missing("fixtures/r20-modules/manifest.json");
if (publicTreeSkip) {
  test("r20-adversarial.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { default: fs } = await import("node:fs");
const { default: os } = await import("node:os");
const { default: path } = await import("node:path");
const { adversarialCases, judgeDeclared, splitRow, ADVERSARIAL_DEFAULT, ADVERSARIAL_FRAMES, ADVERSARIAL_DECLARED } = await import("../scripts/r20/adversarial.mjs");
// The R20 adversarial rows (scripts/r20/adversarial.mjs): row names split at
// the first '-', every default row names a known case and a rigid frame, the
// frames the hybrid-robust plan asks for exist, and a row with a declared
// refusal (kt6-t1e4, outside the +-10,000 mm envelope) is judged by that name.
// No CLI runs here (scripts/r20/acceptance.mjs --adversarial runs the rows).








const R20 = process.env.R20_ROOT ?? path.join(os.homedir(), 'Workspace/cad/cad-project-041/single-step-r20');
const CASE_IDS = ['kt1', 'kt2', 'kt3', 'kt4', 'kt5', 'kt6'];

test('row names split at the first dash', () => {
  assert.deepEqual(splitRow('kt6-rz1e-4'), ['kt6', 'rz1e-4']);
  assert.deepEqual(splitRow('kt6-rot-t1e3'), ['kt6', 'rot-t1e3']);
  assert.deepEqual(splitRow('kt1-far'), ['kt1', 'far']);
});

test('the frames of the hybrid-robust plan exist and are rigid', () => {
  for (const f of ['rz1e-4', 'rz1', 'rz7', 'rz45', 'rz60', 'rz89.9', 't1e3', 'rz45-t1e3', 'rot-t1e3', 't1e4']) assert.ok(ADVERSARIAL_FRAMES[f], f);
  for (const [name, { R, T }] of Object.entries(ADVERSARIAL_FRAMES)) {
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
      const d = R[0][i] * R[0][j] + R[1][i] * R[1][j] + R[2][i] * R[2][j];
      assert.ok(Math.abs(d - (i === j ? 1 : 0)) < 1e-15, `${name}: R^T R`);
    }
    const det = R[0][0] * (R[1][1] * R[2][2] - R[1][2] * R[2][1]) - R[0][1] * (R[1][0] * R[2][2] - R[1][2] * R[2][0]) + R[0][2] * (R[1][0] * R[2][1] - R[1][1] * R[2][0]);
    assert.ok(Math.abs(det - 1) < 1e-15, `${name}: det`);
    assert.equal(T.length, 3);
  }
  assert.ok(Math.max(...ADVERSARIAL_FRAMES.t1e4.T.map(Math.abs)) > 10000, 't1e4 leaves the envelope');
  assert.ok(Math.max(...ADVERSARIAL_FRAMES.t1e3.T.map(Math.abs)) < 10000);
});

test('every default row names a known case and frame; the new rows are in the default set', () => {
  for (const row of ADVERSARIAL_DEFAULT) {
    const [id, f] = splitRow(row);
    assert.ok(CASE_IDS.includes(id) && ADVERSARIAL_FRAMES[f], row);
  }
  for (const row of ['kt6-rz1e-4', 'kt6-rz45', 'kt6-rz60', 'kt6-rz89.9', 'kt6-rotfar', 'kt1-rotfar', 'kt1-t1e3', 'kt6-t1e4']) assert.ok(ADVERSARIAL_DEFAULT.includes(row), row);
  assert.equal(new Set(ADVERSARIAL_DEFAULT).size, ADVERSARIAL_DEFAULT.length);
});

test('a declared refusal is judged by its name', () => {
  const c = { refusal: ADVERSARIAL_DECLARED['kt6-t1e4'] };
  const message = 'Solid exceeds the finite ±10,000 mm coordinate envelope';
  assert.equal(judgeDeclared(c, { built: false, error: { message } }).status, 'REFUSED');
  assert.equal(judgeDeclared(c, { built: false, error: { message: `opExtrude: ${message}` } }).status, 'REFUSED');
  assert.equal(judgeDeclared(c, { built: false, error: { message: 'Native planar arrangement union unresolved: AmbiguousContact' } }).status, 'FAIL');
  assert.equal(judgeDeclared(c, { built: false, timedOut: true, error: { message } }).status, 'FAIL');
  assert.equal(judgeDeclared(c, { built: true }).status, 'FAIL');
  assert.equal(judgeDeclared({ expect: 'build-or-refuse' }, { built: false, error: { message } }), null);
});

test('adversarialCases: framed sources; declared rows only for a runner that judges them', { skip: !fs.existsSync(path.join(R20, 'kernel-cases')) && 'R20 cases not present' }, () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'wonky-adv-'));
  try {
    const base = CASE_IDS.map(id => ({ id, refs: [{ key: id.toUpperCase(), stl: 'x.stl', sha256: null }] }));
    const plain = adversarialCases(R20, out, base);
    assert.ok(!plain.some(c => c.id === 'adv:kt6-t1e4'), 'a runner without judgeDeclared does not get the declared row');
    assert.equal(plain.length, ADVERSARIAL_DEFAULT.length - Object.keys(ADVERSARIAL_DECLARED).length);
    const all = adversarialCases(R20, out, base, ADVERSARIAL_DEFAULT, { declaredRefusals: true });
    const t1e4 = all.find(c => c.id === 'adv:kt6-t1e4');
    assert.equal(t1e4.expect, 'refuse-by-name');
    assert.equal(t1e4.refusal, ADVERSARIAL_DECLARED['kt6-t1e4']);
    const rz = all.find(c => c.id === 'adv:kt6-rz1e-4');
    assert.equal(rz.expect, 'build-or-refuse');
    assert.equal(rz.transform, ADVERSARIAL_FRAMES['rz1e-4']);
    assert.match(fs.readFileSync(rz.source, 'utf8'), /R20 adversarial frame/);
    assert.equal(adversarialCases(R20, out, base, ['kt6-t1e4']).length, 1, 'a row named explicitly always runs');
  } finally { fs.rmSync(out, { recursive: true, force: true }); }
});

}
