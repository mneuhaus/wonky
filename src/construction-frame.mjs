// Construction identity, not a geometric tolerance. These witnesses survive
// value-only std operations without promoting their rounded outputs to new
// authoritative geometry. The Rust port evaluates the local construction and
// applies the interpreter's original affine frame only for export/observation.
const vectors = new WeakMap();
const planes = new WeakMap();
const planeAxes = new WeakMap();
const lineAxes = new WeakMap();
const rotationCharts = new WeakMap();
const values = v => v.items.map(x => typeof x === 'number' ? x : x.value);
const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
function get(v) {
  const p = vectors.get(v);
  return p && same(values(v), p.values) ? p : null;
}
function put(v, frame, role) {
  vectors.set(v, { frame, role, values: values(v) });
  return v;
}
export function rememberFrame(cs) {
  const frame = { origin: values(cs.origin), x: values(cs.xAxis), z: values(cs.zAxis) };
  put(cs.xAxis, frame, 'x'); put(cs.zAxis, frame, 'z');
  return cs;
}
export function rememberCross(result, a, b) {
  const pa = get(a), pb = get(b);
  if (pa && pb && pa.frame === pb.frame && pa.role === 'z' && pb.role === 'x') put(result, pa.frame, 'y');
  return result;
}
export function rememberScale(result, input, scale) {
  const p = get(input);
  if (p && scale === -1 && p.role === 'y') put(result, p.frame, '-y');
  return result;
}
export function rememberPlane(plane, normal, x) {
  // plane(x) and line(x) normalize the identical construction input through
  // different floating operations (multiply by reciprocal versus division).
  // Preserve that identity, rather than comparing their rounded directions.
  if (x) planeAxes.set(plane, { input: values(x), origin: values(plane.origin),
    normal: values(plane.normal), x: values(plane.x) });
  const n = get(normal), u = x && get(x);
  if (n && u && n.frame === u.frame && n.role === 'z' && u.role === 'x'
      && same(values(plane.origin), n.frame.origin)) {
    rotationCharts.set(n.frame, { plane, origin: values(plane.origin), x: values(plane.x), z: values(plane.normal) });
  }
  if (n && u && n.frame === u.frame && n.role === '-y' && u.role === 'x'
      && same(values(plane.origin), n.frame.origin)) {
    planes.set(plane, { frame: n.frame, normal: values(plane.normal), x: values(plane.x) });
  }
  return plane;
}
export function rememberLine(line, direction) {
  lineAxes.set(line, { input: values(direction), origin: values(line.origin), direction: values(line.direction) });
  const p = get(direction);
  if (p && p.role === 'z' && same(values(line.origin), p.frame.origin)) put(line.direction, p.frame, 'axis');
  return line;
}
export function sharedMeridianFrame(plane, line) {
  const p = planes.get(plane), a = get(line.direction);
  if (!p || !a || a.role !== 'axis' || p.frame !== a.frame
      || !same(values(plane.origin), p.frame.origin) || !same(values(line.origin), p.frame.origin)
      || !same(values(plane.normal), p.normal) || !same(values(plane.x), p.x)) return null;
  return p.frame;
}

// A shared direction witness, not a tolerance-based world-space repair.
// Origins need not match: Rust independently proves the displaced line lies
// in the source sketch plane. Snapshots invalidate mutable value edits.
export function sharedSketchXAxis(plane, line) {
  const p = planeAxes.get(plane), a = lineAxes.get(line);
  return !!p && !!a && same(p.input, a.input)
    && same(values(plane.origin), p.origin) && same(values(line.origin), a.origin)
    && same(values(plane.normal), p.normal) && same(values(plane.x), p.x)
    && same(values(line.direction), a.direction);
}

// Authenticate the source chart through constructor identity and immutable snapshots.
export function sourceRotationChart(line) {
  const a = get(line.direction), input = lineAxes.get(line);
  const chart = a && rotationCharts.get(a.frame);
  if (!a || a.role !== 'axis' || !input || !chart
      || !same(values(line.origin), a.frame.origin)
      || !same(values(line.origin), input.origin)
      || !same(values(line.direction), input.direction)
      || !same(values(chart.plane.origin), chart.origin)
      || !same(values(chart.plane.x), chart.x)
      || !same(values(chart.plane.normal), chart.z)) return null;
  return { origin: [...chart.origin], x: [...chart.x], z: [...chart.z] };
}
