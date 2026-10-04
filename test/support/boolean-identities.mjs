// Rational arithmetic also encloses binary64 endpoints without rounding an
// interval sum inward. No numeric tolerance participates in an identity.
export const q = (n, d = 1n) => {
  n = BigInt(n); d = BigInt(d);
  if (d === 0n) throw new Error('zero denominator');
  if (d < 0n) { n = -n; d = -d; }
  let a = n < 0n ? -n : n, b = d;
  while (b) [a, b] = [b, a % b];
  return [n / a, d / a];
};
export const add = (a,b) => q(a[0]*b[1]+b[0]*a[1],a[1]*b[1]);
const mul = (a,b) => q(a[0]*b[0],a[1]*b[1]);
const neg = a => [-a[0],a[1]];
const cmp = (a,b) => a[0]*b[1]-b[0]*a[1];
export function binary64(x) {
  if (!Number.isFinite(x)) throw new Error('nonfinite volume bound');
  const view = new DataView(new ArrayBuffer(8)); view.setFloat64(0,x);
  const bits = view.getBigUint64(0), exponent = Number((bits >> 52n) & 2047n);
  const significand = (bits & ((1n << 52n)-1n)) | (exponent ? 1n << 52n : 0n);
  const power = (exponent || 1)-1023-52;
  const n = bits >> 63n ? -significand : significand;
  return power >= 0 ? q(n << BigInt(power)) : q(n,1n << BigInt(-power));
}
export function volume(m) {
  if (m.volumeExactMm3) {
    const v = q(m.volumeExactMm3.numerator,m.volumeExactMm3.denominator);
    return {lo:v,hi:v,exact:true};
  }
  if (m.volumeEnclosureMm3) {
    const [lo,hi] = m.volumeEnclosureMm3.map(binary64);
    if (cmp(lo,hi)>0n) throw new Error('reversed volume enclosure');
    return {lo,hi,exact:cmp(lo,hi)===0n};
  }
  if (!(m.volumeMm3 >= 0 && m.volumeRelBound >= 0)) throw new Error('missing certified volume bound');
  const v = binary64(m.volumeMm3), radius = mul(v,binary64(m.volumeRelBound));
  return {lo:add(v,neg(radius)),hi:add(v,radius),exact:radius[0]===0n};
}
export const zero = () => ({lo:q(0),hi:q(0),exact:true});
export const sum = (a,b) => ({lo:add(a.lo,b.lo),hi:add(a.hi,b.hi),exact:a.exact&&b.exact});
export function identity(a,b,label) {
  const mode = a.exact && b.exact ? 'exact' : 'enclosure';
  if (cmp(a.lo,b.hi)>0n || cmp(b.lo,a.hi)>0n) throw new Error(`WRONG ${label} (${mode}): disjoint volume intervals [${a.lo.join("/")}, ${a.hi.join("/")}] vs [${b.lo.join("/")}, ${b.hi.join("/")}]`);
  return mode;
}
