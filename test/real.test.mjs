import test from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missingBend();
if (publicTreeSkip) {
  test("real.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { loadKernel } = await import("../src/kernel.mjs");
const { real, number, vector, coords } = await import("../src/real.mjs");





const near = (actual, expected, scale = Math.max(1, Math.abs(expected))) => {
  assert.ok(Number.isFinite(actual) && Math.abs(actual - expected) <= 3e-13 * scale,
    `${actual} != ${expected} (error ${actual - expected}, scale ${scale})`);
};

test('Bend two-word arithmetic agrees with an independent double oracle over CAD magnitudes', async () => {
  const { real: R } = await loadKernel();
  let seed = 728391;
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  const pairs = [[135, -132.8], [10000, -9999.999999], [2.2, 2.2], [1e-8, -1e-8]];
  for (let i = 0; i < 300; i++) pairs.push([(random() - 0.5) * 10 ** (random() * 12 - 6), (random() - 0.5) * 10 ** (random() * 12 - 6)]);
  for (const [a, b] of pairs) {
    near(number(R.add(real(a), real(b))), a + b, Math.max(1, Math.abs(a), Math.abs(b)));
    near(number(R.sub(real(a), real(b))), a - b, Math.max(1, Math.abs(a), Math.abs(b)));
    near(number(R.mul(real(a), real(b))), a * b);
    near(number(R.div(real(a), real(b))), a / b);
    near(number(R.sqrt(real(Math.abs(a)))), Math.sqrt(Math.abs(a)));
    assert.equal(R.less(real(a), real(b)), a < b);
  }
  near(number(R.sqrt(real(0))), 0);
  const cancellation = number(R.sub(R.add(real(10000), real(1e-7)), real(10000)));
  assert.ok(Math.abs(cancellation - 1e-7) < 1e-14);
  assert.throws(() => real(Infinity), RangeError);
  assert.throws(() => real(1e30), RangeError);
});

test('Bend trigonometry and atan2 preserve quadrants and small CAD angles', async () => {
  const { real: R } = await loadKernel();
  near(number(R.pi()), Math.PI);
  for (const angle of [-12, -Math.PI, -Math.PI / 2, -1, -0.1, -1e-8, 0, 1e-8, 0.1, 1, Math.PI / 2, Math.PI, 12]) {
    near(number(R.sin(real(angle))), Math.sin(angle));
    near(number(R.cos(real(angle))), Math.cos(angle));
    near(number(R.atan(real(angle))), Math.atan(angle));
  }
  for (const x of [-100, -1, -1e-8, 0, 1e-8, 1, 100]) for (const y of [-100, -1, 0, 1, 100]) {
    near(number(R.atan2(real(y), real(x))), Math.atan2(y, x));
  }
});

test('Bend precise vectors retain translated tangent positions', async () => {
  const { precise: P } = await loadKernel();
  const center = vector([0, 135, 0]);
  const point = P.add(center, P.scale(vector([0, -1, 0]), real(2.2)));
  coords(point).forEach((v, i) => near(v, [0, 132.8, 0][i]));
  near(number(P.dot(P.sub(center, point), vector([0, 1, 0]))), 2.2);
});

}
