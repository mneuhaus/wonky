// Canonical, exact text for frontend values that become WGraph node arguments.
//
// Exactness rule: the text must denote the same binary64 value the frontend
// computed. FeatureScript stores lengths in meters and angles in radians, so a
// length prints as `<x>mm` only when `x * 0.001` (exactly what `x * millimeter`
// computes in FS) reproduces the stored double bit for bit; otherwise it prints
// the meter value (`<v>m`). Angles likewise use `deg` only when exact. Numbers
// use JavaScript's shortest round-trip format. Maps print with sorted keys.
import { EnumValue, Id, KeyedMap, Matrix, Plane, Quantity, Transform, Vector, isMap } from '../../values.mjs';

const num = x => (Object.is(x, -0) ? '-0' : String(x));
const DEG = Math.PI / 180;

// The shortest decimal x with x * unit === v (bit for bit), if any.
function shortestScaled(v, unit) {
  if (v === 0) return Object.is(v, -0) ? null : 0;
  const scaled = v / unit;
  for (let p = 1; p <= 17; p++) {
    const x = Number(scaled.toPrecision(p));
    if (x * unit === v) return x;
  }
  return null;
}
export function lengthText(v) {
  const mm = shortestScaled(v, 0.001);
  return mm === null ? `${num(v)}m` : `${num(mm)}mm`;
}
export function angleText(v) {
  const d = shortestScaled(v, DEG);
  return d === null ? `${num(v)}rad` : `${num(d)}deg`;
}

export function canon(value) {
  if (value?.graphRef) return value.graphRef; // an already-resolved input slot ($i)
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  if (typeof value === 'number') return num(value);
  if (typeof value === 'boolean') return String(value);
  if (typeof value === 'string') return JSON.stringify(value);
  if (value instanceof Quantity) {
    if (value.dimension === 1 && value.angle === 0) return lengthText(value.value);
    if (value.dimension === 0 && value.angle === 1) return angleText(value.value);
    return `${num(value.value)}m^${value.dimension}rad^${value.angle}`;
  }
  if (value instanceof EnumValue) return `${value.enumType}.${value.name}`;
  if (value instanceof Id) return JSON.stringify(value.toString());
  if (value instanceof Vector) {
    const items = value.items.map(canon);
    if (items.length && items.every(t => /^-?[\d.e+-]+mm$/.test(t))) return `[${items.map(t => t.slice(0, -2)).join(',')}]mm`;
    return `[${items.join(',')}]`;
  }
  if (value instanceof Matrix) return `[${value.rows.map(r => `[${r.map(num).join(',')}]`).join(',')}]`;
  if (value instanceof Transform) return `xf(${canon(value.linear)},${canon(value.translation)})`;
  if (value instanceof Plane) return `plane(${canon(value.origin)},${canon(value.normal)},${canon(value.x)})`;
  if (value instanceof KeyedMap) return `{${value.entries.map(([k, v]) => `${canon(k)}:${canon(v)}`).join(',')}}${value.tag ? ` as ${value.tag}` : ''}`;
  if (Array.isArray(value)) return `[${value.map(canon).join(',')}]`;
  if (isMap(value)) return `{${Object.keys(value).sort().map(k => `${/^[A-Za-z_][A-Za-z0-9_]*$/.test(k) ? k : JSON.stringify(k)}:${canon(value[k])}`).join(',')}}`;
  throw new TypeError(`canon: no canonical form for ${value?.constructor?.name ?? typeof value}`);
}
