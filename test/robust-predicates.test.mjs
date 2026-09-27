import test from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missingBend();
if (publicTreeSkip) {
  test("robust-predicates.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { loadBend } = await import("../src/bend-loader.mjs");
const { vector } = await import("../src/real.mjs");





const kernel = loadBend(new URL('../kernel/robust-predicates.bend', import.meta.url));
const bytes = new DataView(new ArrayBuffer(4));
const word = bits => { bytes.setUint32(0, bits); return bytes.getFloat32(0); };
// Independent test oracle: every F32 is an integer multiple of 2^-149.
const integerWord = value => {
  bytes.setFloat32(0, value); const bits = bytes.getUint32(0), exponent = (bits >>> 23) & 255;
  assert.notEqual(exponent, 255);
  const magnitude = BigInt((bits & 0x7fffff) | (exponent ? 0x800000 : 0)) << BigInt(Math.max(1, exponent) - 1);
  return bits >>> 31 ? -magnitude : magnitude;
};
const integerReal = value => integerWord(value.hi) + integerWord(value.lo);
const dotDelta = (normal, a, b) => ['x', 'y', 'z'].reduce((sum, key) =>
  sum + integerReal(normal[key]) * (integerReal(a[key]) - integerReal(b[key])), 0n);
const sign = value => value === 0n ? 'ExactlyZero' : value < 0n ? 'Negative' : 'Positive';
const rawVector = words => ({ $: 'V3', ...Object.fromEntries(['x', 'y', 'z'].map((key, i) =>
  [key, { $: 'Real', hi: words[2 * i], lo: words[2 * i + 1] }])) });
const implicitSign = (point, origin, normal) => {
  const a = dotDelta(point.normal, point.first, point.origin), b = dotDelta(point.normal, point.last, point.origin);
  const c = dotDelta(normal, point.first, origin), d = dotDelta(normal, point.last, origin);
  return a === b ? 'Undefined' : sign((a * d - b * c) * (a - b));
};

test('filtered exact plane predicates preserve both F32 words and use a fast path for separated points', async () => {
  const k = await kernel;
  for (const point of [[7, 2, 3], [-7, 2, 3]]) {
    const p = vector(point), n = vector([1, 0.3, -0.1]), o = vector([0, 0, 0]);
    const result = k.point_plane(n, p, o);
    assert.equal(result.sign.$, sign(dotDelta(n, p, o)));
    assert.equal(result.method.$, 'FloatFilter');
  }
});

test('exact dyadic fallback resolves cancellation that a rounded F32x2 dot can erase', async () => {
  const k = await kernel, e = 2 ** -40;
  const n = vector([1, 1 + e, 0]), p = vector([1, 0, 0]), o = vector([2 + 2 * e, -(1 + e), 0]);
  assert.ok(dotDelta(n, p, o) > 0n);
  const result = k.point_plane(n, p, o);
  assert.equal(result.sign.$, 'Positive'); assert.equal(result.method.$, 'ExactDyadic');
  assert.equal(k.point_plane(n, o, p).sign.$, 'Negative');
  assert.equal(k.point_plane(n, p, p).sign.$, 'ExactlyZero');
});

test('exact fallback covers subnormal products and the entire finite F32 exponent range', async () => {
  const k = await kernel, zero = vector([0, 0, 0]);
  for (const value of [word(1), word(0x80000001), word(0x7f7fffff), word(0xff7fffff), word(0x00800000)]) {
    const n = rawVector([value, 0, 0, 0, 0, 0]), p = rawVector([Math.abs(value), 0, 0, 0, 0, 0]);
    const result = k.point_plane(n, p, zero);
    assert.equal(result.sign.$, sign(dotDelta(n, p, zero)));
    assert.equal(result.method.$, 'ExactDyadic');
  }
  const max = word(0x7f7fffff), tiny = word(1);
  const n = rawVector([max, tiny, max, 0, 0, 0]);
  const p = rawVector([max, 0, -max, 0, 0, 0]);
  assert.equal(k.point_plane(n, p, zero).sign.$, 'Positive');
});

test('random raw-word polynomial signs agree with independent BigInt arithmetic', async () => {
  const k = await kernel; let state = 0x927318;
  const random = () => (state = (Math.imul(state, 1664525) + 1013904223) >>> 0);
  const finite = () => word((random() & 0x807fffff) | ((random() % 255) << 23));
  const v = () => rawVector(Array.from({ length: 6 }, finite));
  for (let i = 0; i < 160; i++) {
    const n = v(), a = v(), b = i % 4 === 0 ? structuredClone(a) : v();
    if (i % 8 === 0) b.x.lo = finite();
    const result = k.point_plane(n, a, b);
    assert.equal(result.sign.$, sign(dotDelta(n, a, b)), `case ${i}`);
  }
});

test('indirect line-plane predicates retain exact incidence without rounding the constructed point', async () => {
  const k = await kernel;
  const point = { $: 'LinePlane', first: vector([0, 0, 0]), last: vector([1, 0, 0]),
    origin: vector([0, 1, 0]), normal: vector([3, 1, 0]) };
  const samePlane = k.classify(point, point.origin, point.normal);
  assert.equal(samePlane.sign.$, 'ExactlyZero'); assert.equal(samePlane.method.$, 'IndirectExact');
  for (const origin of [[1 / 3, 0, 0], [0.3, 0, 0], [0.4, 0, 0]]) {
    const o = vector(origin), n = vector([1, 0, 0]);
    assert.equal(k.classify(point, o, n).sign.$, implicitSign(point, o, n));
    assert.equal(k.classify({ ...point, first: point.last, last: point.first }, o, n).sign.$, implicitSign(point, o, n));
  }
  // The independently rounded coordinate is not exactly on 3*x + y = 1.
  const rounded = k.point_plane(point.normal, vector([1 / 3, 0, 0]), point.origin);
  assert.notEqual(rounded.sign.$, 'ExactlyZero');
});

test('indirect predicates match rational oracles through severe cancellation and exponent changes', async () => {
  const k = await kernel; let state = 291719;
  const random = () => (state = (Math.imul(state, 1103515245) + 12345) >>> 0);
  const v = () => rawVector(Array.from({ length: 6 }, () => word((random() & 0x807fffff) | ((50 + random() % 150) << 23))));
  for (let i = 0; i < 32; i++) {
    const point = { $: 'LinePlane', first: v(), last: v(), origin: v(), normal: v() };
    const origin = i % 4 === 0 ? point.origin : v(), normal = i % 4 === 0 ? point.normal : v();
    assert.equal(k.classify(point, origin, normal).sign.$, implicitSign(point, origin, normal), `case ${i}`);
  }
});

test('nonunique intersections and nonfinite input remain explicit undefined decisions', async () => {
  const k = await kernel, zero = vector([0, 0, 0]), axis = vector([0, 1, 0]);
  const point = { $: 'LinePlane', first: zero, last: vector([1, 0, 0]), origin: axis, normal: axis };
  assert.equal(k.classify(point, zero, axis).sign.$, 'Undefined');
  assert.equal(k.classify({ ...point, origin: zero }, zero, axis).sign.$, 'Undefined');
  for (const value of [NaN, Infinity, -Infinity]) {
    const invalid = rawVector([value, 0, 0, 0, 0, 0]);
    assert.deepEqual(k.point_plane(invalid, zero, zero), { $: 'Decision', sign: { $: 'Undefined' }, method: { $: 'Invalid' } });
    assert.equal(k.classify({ ...point, first: invalid }, zero, axis).method.$, 'Invalid');
  }
});

}
