// Corpus failure analysis, cluster boolean-capability: classify one refused
// binary opBoolean (operation + both operand bodies in the kernel body format)
// into the sub-cause a fix would have to address. Diagnostic only; used by
// scripts/corpus/boolean-probe.mjs (report) and scripts/corpus/boolean-hook-loader.mjs
// (selective next-blocker stubs). Never loaded by the CLIs.
//
// Sub-causes (docs/corpus/cluster-boolean-capability.md, section 3):
//   coaxial-revolution  both operands are solids of revolution about the same
//                       axis line (planes perpendicular to it, cylinders and
//                       cones on it), but not two cylinder primitives
//   pierce-admission    subtraction of a cylinder primitive whose circle stays
//                       inside the target (no target vertex inside the tool),
//                       refused by the through-hole admission; flags say why
//   general-trim        subtraction of a cylinder primitive that cuts through
//                       the target's boundary (a target vertex lies inside it,
//                       or its axis misses the pierced face: decline code 7)
//   general             everything else: a planar or cylindrical tool that
//                       trims curved faces, or a curved union
//   nary                (set by the library hook) more than two operands

const curveType = e => e.curve?.type ?? e.curve;
const count = xs => xs.reduce((c, x) => ({ ...c, [x]: (c[x] ?? 0) + 1 }), {});
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = a => Math.hypot(...a);
const unit = a => { const n = norm(a); return a.map(v => v / n); };

export const isCylinderPrimitive = body => body?.primitive?.type === 'frustum' && body.primitive.r0 === body.primitive.r1;

function bounds(body) {
  const v = body.vertices ?? [];
  if (!v.length) return null;
  const lo = [0, 1, 2].map(i => Math.min(...v.map(p => p[i]))), hi = [0, 1, 2].map(i => Math.max(...v.map(p => p[i])));
  return { min: lo.map(x => +x.toFixed(3)), max: hi.map(x => +x.toFixed(3)) };
}

export function describe(body) {
  if (!body) return null;
  const faces = body.faces ?? [], edges = body.edges ?? [];
  const planar = faces.every(f => f.surface.type === 'plane') && edges.every(e => curveType(e) === 'line');
  const cylinder = isCylinderPrimitive(body);
  const curvedFamily = faces.every(f => ['plane', 'cylinder'].includes(f.surface.type)) && edges.every(e => ['line', 'circle', 'ellipse'].includes(curveType(e)));
  const pierceable = faces.every(f => ['plane', 'cylinder'].includes(f.surface.type)) && edges.every(e => ['line', 'circle'].includes(curveType(e)) && !e.curveRange);
  return {
    faces: faces.length, edges: edges.length, vertices: (body.vertices ?? []).length,
    surfaces: count(faces.map(f => f.surface.type)), curves: count(edges.map(curveType)),
    rangedEdges: edges.filter(e => e.curveRange).length,
    primitive: body.primitive ? { type: body.primitive.type, ...(body.primitive.r0 !== undefined ? { r0: body.primitive.r0, r1: body.primitive.r1 } : {}), ...(body.primitive.bottom ? { bottom: body.primitive.bottom, top: body.primitive.top } : {}) } : null,
    gates: { planar, cylinder, curvedFamily, pierceable },
    method: body.construction?.method ?? null, volumeMm3: body.validation?.volumeMm3 ?? null, vertexBounds: bounds(body),
    budgetMm: body.constructionBudget?.ceilingMm ?? null,
  };
}

// Solid of revolution: every curved face is a cylinder/cone on one axis line
// and every planar face is perpendicular to it. Returns the axis or null.
export function revolutionAxis(body) {
  const faces = body.faces ?? [];
  const curved = faces.filter(f => ['cylinder', 'cone'].includes(f.surface.type));
  let axis = null, origin = null;
  if (body.primitive?.type === 'frustum') {
    const t = body.primitive;
    axis = unit(t.top.map((v, i) => v - t.bottom[i])); origin = t.bottom;
  } else if (curved.length) { axis = unit(curved[0].surface.axis); origin = curved[0].surface.origin; }
  if (!axis) return null;
  const onAxis = s => {
    const a = unit(s.axis), d = s.origin.map((v, i) => v - origin[i]), along = dot(d, axis);
    return norm(cross(a, axis)) < 1e-7 && norm(d.map((v, i) => v - along * axis[i])) < 1e-6;
  };
  const planeOk = s => norm(cross(s.normal, axis)) < 1e-7;
  const ok = faces.every(f => f.surface.type === 'plane' ? planeOk(f.surface) : ['cylinder', 'cone'].includes(f.surface.type) ? onAxis(f.surface) : false);
  return ok ? { axis: axis.map(v => +v.toFixed(6)), origin: origin.map(v => +v.toFixed(4)) } : null;
}

export function sameLine(p, q) {
  if (!p || !q) return false;
  const d = q.origin.map((v, i) => v - p.origin[i]), along = dot(d, p.axis);
  return norm(cross(p.axis, q.axis)) < 1e-5 && norm(d.map((v, i) => v - along * p.axis[i])) < 1e-3;
}

// Tool axis against the target's planar faces, in the kernel's own terms
// (kernel/pierce.bend perpendicular(): |normal x axis| < 1e-7).
export function pierceGeometry(a, b) {
  const t = b.primitive; if (!t?.top) return null;
  const span = t.top.map((v, i) => v - t.bottom[i]), len = norm(span), axis = span.map(v => v / len);
  const sine = n => norm(cross(n, axis)) / norm(n);
  const planes = (a.faces ?? []).filter(f => f.surface.type === 'plane').map(f => ({ sine: sine(f.surface.normal), offset: dot(f.surface.origin, axis) }));
  const perpendicular = planes.filter(p => p.sine < 1e-7);
  const nearlyPerpendicular = planes.filter(p => p.sine >= 1e-7 && p.sine < 1e-4);
  const near = [...planes].sort((x, y) => x.sine - y.sine).slice(0, 4).map(p => ({ sine: +p.sine.toExponential(2), offset: +p.offset.toFixed(4) }));
  // Target vertices inside the tool cylinder (between its end planes): the
  // tool then cuts through the target's boundary instead of boring a hole.
  const lo = Math.min(dot(t.bottom, axis), dot(t.top, axis)), hi = Math.max(dot(t.bottom, axis), dot(t.top, axis));
  const inside = (a.vertices ?? []).filter(p => {
    const d = p.map((v, i) => v - t.bottom[i]), h = dot(p, axis);
    const radial = norm(d.map((v, i) => v - dot(d, axis) * axis[i]));
    return radial < t.r0 - 1e-6 && h > lo - 1e-6 && h < hi + 1e-6;
  }).length;
  return { axis: axis.map(v => +v.toFixed(6)), radius: t.r0, lengthMm: +len.toFixed(4),
    toolSpan: [lo, hi].map(v => +v.toFixed(4)),
    targetPlanarFacesPerpendicular: perpendicular.length, perpendicularFaceOffsets: perpendicular.map(p => +p.offset.toFixed(4)),
    nearlyPerpendicular: nearlyPerpendicular.map(p => ({ sine: +p.sine.toExponential(2), offset: +p.offset.toFixed(4) })),
    nearestPlanes: near, targetVerticesInsideTool: inside,
    rangedTargetEdges: (a.edges ?? []).filter(e => e.curveRange).length,
    arcTargetEdges: (a.edges ?? []).filter(e => curveType(e) === 'circle' && e.curveRange).length };
}

// Which production dispatch arm of booleanInBend the pair reaches.
export function arm(operation, A, B) {
  if (A.gates.cylinder && B.gates.cylinder) return 'coaxial-cylinders (kernel refused)';
  if (operation !== 'INTERSECTION' && A.gates.planar && B.gates.planar) return 'planar arrangement (kernel refused)';
  if (operation === 'INTERSECTION' && A.gates.planar && B.gates.planar) return 'planar intersection (kernel refused)';
  if (operation === 'INTERSECTION' && A.gates.curvedFamily && B.gates.curvedFamily) return 'curved convex-tool intersection (kernel refused)';
  if (operation === 'SUBTRACTION' && A.gates.pierceable && B.gates.cylinder) return 'through-hole pierce (kernel declined)';
  const kind = d => d.gates.cylinder ? 'cylinder primitive' : d.gates.planar ? 'planar' : d.gates.pierceable ? 'plane+cylinder (full circles)' : d.gates.curvedFamily ? 'plane+cylinder (arcs)' : `other (${Object.keys(d.surfaces).join('+')})`;
  return `none: ${operation} ${kind(A)} x ${kind(B)}`;
}

export function subcause(operation, a, b, message = '') {
  const A = describe(a), B = describe(b);
  const ra = revolutionAxis(a), rb = revolutionAxis(b);
  const coaxial = sameLine(ra, rb);
  const pierce = operation === 'SUBTRACTION' && B.gates.cylinder ? pierceGeometry(a, b) : null;
  let key, flags = [];
  if (coaxial) key = 'coaxial-revolution';
  // A tool with target vertices inside it, or whose axis misses the face it
  // would pierce (kernel decline 7), cuts the boundary: not a hole.
  else if (pierce && (pierce.targetVerticesInsideTool > 0 || /must land in material/.test(message))) key = 'general-trim';
  else if (pierce) {
    key = 'pierce-admission';
    if (pierce.rangedTargetEdges) flags.push(pierce.arcTargetEdges ? 'arc-edges' : 'ranged-line-edges');
    if (pierce.nearlyPerpendicular.length) flags.push('oblique-caps');
    if (pierce.targetPlanarFacesPerpendicular > 2) flags.push('extra-perpendicular-faces');
    if (!flags.length) flags.push('other');
  } else key = 'general';
  const detail = key === 'general'
    ? `${operation} ${ra ? 'revolution' : A.gates.planar ? 'planar' : 'plane+cylinder'} x ${rb ? (B.gates.cylinder ? 'cylinder' : 'revolution') : B.gates.planar ? 'planar' : 'plane+cylinder'}`
    : null;
  return { key, flags, detail, arm: arm(operation, A, B), a: A, b: B, revolution: { a: ra, b: rb, coaxial }, pierce };
}
