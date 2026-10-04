// Exact construction tags; values stay the interpreter's binary64 words.
const words = new DataView(new ArrayBuffer(8));
function rational(n, d = 1n) {
  if (d < 0n) { n = -n; d = -d; }
  let a = n < 0n ? -n : n, b = d;
  while (b) [a, b] = [b, a % b];
  return { n: n / a, d: d / a };
}
export function dyadic(value) {
  if (!Number.isFinite(value)) throw new Error('angle/non-finite-input');
  if (value === 0) return { n: 0n, d: 1n };
  words.setFloat64(0, value); const bits = words.getBigUint64(0);
  const exponent = Number((bits >> 52n) & 2047n);
  let n = (bits & ((1n << 52n) - 1n)) | (exponent ? 1n << 52n : 0n);
  if (bits >> 63n) n = -n;
  const e = (exponent || 1) - 1075;
  return e >= 0 ? rational(n << BigInt(e)) : rational(n, 1n << BigInt(-e));
}
const read = w => ({ n: BigInt(w.numerator), d: BigInt(w.denominator) });
const pack = (kind, r) => Object.freeze({ kind, numerator: String(r.n), denominator: String(r.d) });
const mul = (a, b) => rational(a.n * b.n, a.d * b.d);
const add = (a, b, sign) => rational(a.n * b.d + sign * b.n * a.d, a.d * b.d);
// Round the ratio once, including subnormals; separate Number conversions can
// overflow a denominator or double-round a non-dyadic construction.
function nearestRatio({ n, d }) {
  if (n === 0n) return 0;
  const negative = n < 0n; if (negative) n = -n;
  let e = n.toString(2).length - d.toString(2).length;
  if (e >= 0 ? n < (d << BigInt(e)) : (n << BigInt(-e)) < d) e--;
  // Normal numbers use 53 significant bits; subnormals use the fixed grid.
  const s = e < -1022 ? 1074 : 52 - e;
  const numerator = s >= 0 ? n << BigInt(s) : n;
  const denominator = s >= 0 ? d : d << BigInt(-s);
  let rounded = numerator / denominator;
  const remainder = numerator % denominator;
  if (2n * remainder > denominator || (2n * remainder === denominator && (rounded & 1n))) rounded++;
  const result = Number(rounded) * 2 ** (-s);
  return negative ? -result : result;
}
export const degreeWitness = () => pack('Turns', { n: 1n, d: 360n });
export const tangentWitness = value => pack('Tan', dyadic(value));
// Compare only after canonical binary64 construction; never replace the word.
export function witnessWord(witness) {
  const r = read(witness);
  if (r.d <= 0n) throw new Error('angle/witness-mismatch');
  if (witness.kind === 'Turns') {
    const degrees = rational(r.n * 360n, r.d);
    return nearestRatio(degrees) * (Math.PI / 180);
  }
  if (witness.kind === 'Tan') return Math.atan(nearestRatio(r));
  throw new Error('angle/witness-mismatch');
}
export function attachAngleWitness(quantity, witness) {
  Object.defineProperty(quantity, 'angleWitness', { value: witness, enumerable: false });
  return quantity;
}
export function propagateAngleWitness(result, op, a, b) {
  if (result?.dimension !== 0 || result?.angle !== 1) return result;
  if (!Number.isFinite(result.value) || (typeof a === 'number' && !Number.isFinite(a)) ||
      (typeof b === 'number' && (!Number.isFinite(b) || (op === '/' && b === 0)))) return result;
  const wa = a?.angleWitness, wb = b?.angleWitness;
  let w;
  if (wa?.kind === 'Turns' && wb?.kind === 'Turns' && ['+', '-'].includes(op)) w = pack('Turns', add(read(wa), read(wb), op === '+' ? 1n : -1n));
  else if (wa?.kind === 'Turns' && typeof b === 'number' && ['*', '/'].includes(op)) {
    const r = dyadic(b); w = pack('Turns', mul(read(wa), op === '*' ? r : rational(r.d, r.n)));
  } else if (typeof a === 'number' && wb?.kind === 'Turns' && op === '*') w = pack('Turns', mul(dyadic(a), read(wb)));
  else if (wa?.kind === 'Tan' && b === -1 && op === '*' || wb?.kind === 'Tan' && a === -1 && op === '*') {
    const r = read(wa ?? wb); w = pack('Tan', rational(-r.n, r.d));
  }
  if (w && Object.is(witnessWord(w), result.value)) attachAngleWitness(result, w);
  return result;
}
