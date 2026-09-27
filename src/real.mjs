// Serialization only. Arithmetic on these words takes place in the kernel.
// Bend (WONKY_BACKEND js, native, diff, rust-diff, rust-mixed) takes a Real as
// its F32x2 split { hi: fround(x), lo: fround(x - hi) }. The Rust kernel
// (WONKY_BACKEND=rust, wire v2) takes the host binary64 itself: { hi: x, lo: 0 },
// no Math.fround and no split (docs/rust-migration.md 3.3).
export const binary64Host = () => process.env.WONKY_BACKEND === 'rust';
export function real(value) {
  if (binary64Host()) {
    if (!Number.isFinite(value)) throw new RangeError('Rust Real serialization requires a finite binary64');
    return { $: 'Real', hi: value, lo: 0 };
  }
  const hi = Math.fround(value);
  if (!Number.isFinite(value) || Math.abs(value) > 1e20 || (value !== 0 && hi === 0)) {
    throw new RangeError('Bend Real serialization requires a finite magnitude <= 1e20 without F32 exponent underflow');
  }
  return { $: 'Real', hi, lo: Math.fround(value - hi) };
}
export const number = value => value.hi + value.lo;
export const vector = ([x, y, z]) => ({ $: 'V3', x: real(x), y: real(y), z: real(z) });
export const coords = value => [number(value.x), number(value.y), number(value.z)];
