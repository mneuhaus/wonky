#!/usr/bin/env node
// Fillet harness TEST INFRASTRUCTURE: the case catalogue (source of truth).
//
//   node scripts/fillet/cases.mjs --write     -> fixtures/fillet/cases.json
//   node scripts/fillet/cases.mjs --list
//
// Every case is an unmodified-syntax FeatureScript snippet that the wonky
// kernel evaluates into the input body (scripts/fillet/fixtures.mjs), an edge
// selection, a blend (fillet radius or equal-offset chamfer distance), the
// expected verdict and, where one exists, an independent closed form of the
// volume change. Closed forms are derived in docs/fillet/theory.md §14 and in
// docs/fillet/harness.md ("Closed forms"); they are INFERRED derivations whose
// numbers are MEASURED against OCCT in fixtures/fillet/reference.json.
//
// expect: ok           a valid blend exists and is well defined; refusing it is `declined`
//         must-refuse  no valid blend exists; any ok result is `wrong`
//         either       semantics differ between kernels (overflow, consumption,
//                      mixed convexity, tangent edges): a typed refusal and a valid
//                      result are both accepted; an ok result is checked against
//                      the closed form if the case states one.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { notch2D } from './closedform.mjs';
import { cornerChamfer2D, cornerFillet2D, faceOffsetSetback, lineCircleFillet2D, planePlaneSpandrel } from './geom.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const CASES_PATH = path.join(ROOT, 'fixtures/fillet/cases.json');

const PI = Math.PI;
const deg = (d) => (d * PI) / 180;
const A90 = (r) => r * r * (1 - PI / 4); // plane/plane spandrel at 90°
const W2 = (r) => r ** 3 * (5 / 3 - PI / 2); // ∫ w² for the fillet profile (mitre overlap)

// ---------------------------------------------------------------------------
// FeatureScript snippet builder (text only; the kernel evaluates it).

const num = (x) => {
  const s = Number(x.toFixed(12)).toString();
  return s.includes('e') ? x.toPrecision(17) : s;
};
const v2 = (p) => `vector(${num(p[0])}, ${num(p[1])}) * millimeter`;
const v3 = (p) => `vector(${p.map(num).join(', ')})`;

export const XY = (z = 0) => ({ o: [0, 0, z], n: [0, 0, 1], x: [1, 0, 0] });
// Profile in the XZ plane (sketch u = x, v = z), extruded towards −y.
export const XZ = (y = 0) => ({ o: [0, y, 0], n: [0, -1, 0], x: [1, 0, 0] });

class Model {
  constructor() {
    this.body = [];
    this.n = 0;
  }
  sketch(plane, draw) {
    const s = `s${this.n++}`;
    const ents = [];
    let k = 0;
    const e = {
      rect: (a, b) => ents.push(`skRectangle(${s}, "e${k++}", { "firstCorner" : ${v2(a)}, "secondCorner" : ${v2(b)} });`),
      poly: (pts) => ents.push(`skPolyline(${s}, "e${k++}", { "points" : [${[...pts, pts[0]].map(v2).join(', ')}] });`),
      circle: (c, r) => ents.push(`skCircle(${s}, "e${k++}", { "center" : ${v2(c)}, "radius" : ${num(r)} * millimeter });`),
      line: (a, b) => ents.push(`skLineSegment(${s}, "e${k++}", { "start" : ${v2(a)}, "end" : ${v2(b)} });`),
      arc: (a, m, b) => ents.push(`skArc(${s}, "e${k++}", { "start" : ${v2(a)}, "mid" : ${v2(m)}, "end" : ${v2(b)} });`),
    };
    draw(e);
    this.body.push(`    var ${s} = newSketchOnPlane(context, id + "${s}", { "sketchPlane" : plane(${v3(plane.o)} * millimeter, ${v3(plane.n)}, ${v3(plane.x)}) });`);
    for (const x of ents) this.body.push(`    ${x}`);
    this.body.push(`    skSolve(${s});`);
    return { s, plane };
  }
  extrude(sk, depth) {
    const f = `x${this.n++}`;
    this.body.push(`    opExtrude(context, id + "${f}", { "entities" : qSketchRegion(id + "${sk.s}"), "direction" : ${v3(sk.plane.n)}, "endBound" : BoundingType.BLIND, "endDepth" : ${num(depth)} * millimeter });`);
    return f;
  }
  loft(a, b) {
    const f = `x${this.n++}`;
    this.body.push(`    opLoft(context, id + "${f}", { "profileSubqueries" : [qSketchRegion(id + "${a.s}"), qSketchRegion(id + "${b.s}")] });`);
    return f;
  }
  union(features) {
    const f = `x${this.n++}`;
    this.body.push(`    opBoolean(context, id + "${f}", { "tools" : qUnion([${features.map((x) => `qCreatedBy(id + "${x}", EntityType.BODY)`).join(', ')}]), "operationType" : BooleanOperationType.UNION });`);
    return f;
  }
  subtract(target, tool) {
    const f = `x${this.n++}`;
    this.body.push(`    opBoolean(context, id + "${f}", { "targets" : qCreatedBy(id + "${target}", EntityType.BODY), "tools" : qCreatedBy(id + "${tool}", EntityType.BODY), "operationType" : BooleanOperationType.SUBTRACTION });`);
    return f;
  }
  source() {
    return ['FeatureScript 3044;', 'import(path : "onshape/std/geometry.fs", version : "3044.0");', '',
      'export function filletInput(context is Context, id is Id, definition is map)', '{', ...this.body, '}', ''].join('\n');
  }
}

// Closed polygon with optional tangent arcs at vertices (radii[i] > 0), CCW.
// Returns sketch drawing and the outline metrics used by the closed forms:
// P = perimeter, K = Σ_sharp tan(θ/2) + Σ_round θ/2 with θ the signed turning
// angle (positive = convex for a CCW outline).
export function roundedPoly(points, radii = []) {
  const n = points.length, draw = [], metrics = { P: 0, K: 0 };
  const sub2 = (a, b) => [a[0] - b[0], a[1] - b[1]];
  const len = (a) => Math.hypot(a[0], a[1]);
  const u = (a) => [a[0] / len(a), a[1] / len(a)];
  const corners = points.map((p, i) => {
    const a = u(sub2(p, points[(i - 1 + n) % n])), b = u(sub2(points[(i + 1) % n], p));
    const theta = Math.atan2(a[0] * b[1] - a[1] * b[0], a[0] * b[0] + a[1] * b[1]);
    const R = radii[i] ?? 0;
    if (R <= 0) {
      metrics.K += Math.tan(theta / 2);
      return { p, theta, R, tin: p, tout: p };
    }
    const s = R * Math.tan(Math.abs(theta) / 2);
    const tin = [p[0] - a[0] * s, p[1] - a[1] * s], tout = [p[0] + b[0] * s, p[1] + b[1] * s];
    const left = [-a[1], a[0]], side = theta > 0 ? 1 : -1;
    const c = [tin[0] + left[0] * R * side, tin[1] + left[1] * R * side];
    const d = u(sub2(p, c));
    metrics.K += theta / 2;
    metrics.P += R * Math.abs(theta);
    return { p, theta, R, tin, tout, mid: [c[0] + d[0] * R, c[1] + d[1] * R] };
  });
  for (let i = 0; i < n; i++) {
    const c = corners[i], nx = corners[(i + 1) % n];
    if (c.R > 0) draw.push((e) => e.arc(c.tin, c.mid, c.tout));
    draw.push((e) => e.line(c.tout, nx.tin));
    metrics.P += len(sub2(nx.tin, c.tout));
  }
  return { draw: (e) => draw.forEach((f) => f(e)), ...metrics, corners };
}

// Top-outline blends of a vertical-walled prism (INFERRED, harness.md
// "Closed forms"): the cross-section at depth z is the mitred inward offset of
// the outline by w(z), whose area is A − P w + K w².
export const outlineChamferRemoved = (P, K, d) => (P * d * d) / 2 - (K * d ** 3) / 3;
export const outlineFilletRemoved = (P, K, r) => P * A90(r) - K * W2(r);

// ---------------------------------------------------------------------------
// Shapes

function box(a, b, c) {
  const m = new Model();
  m.extrude(m.sketch(XY(), (e) => e.rect([0, 0], [a, b])), c);
  return m;
}
function prism(points, h, radii) {
  const m = new Model(), rp = roundedPoly(points, radii);
  m.extrude(m.sketch(XY(), rp.draw), h);
  return { m, rp };
}
function profile(points, L) {
  const m = new Model(), rp = roundedPoly(points);
  m.extrude(m.sketch(XZ(), rp.draw), L);
  return m;
}
function post(rho, h) {
  const m = new Model();
  m.extrude(m.sketch(XY(), (e) => e.circle([0, 0], rho)), h);
  return m;
}
function steppedPost(discR, discH, postR, postH) {
  const m = new Model();
  const a = m.extrude(m.sketch(XY(), (e) => e.circle([0, 0], discR)), discH);
  const b = m.extrude(m.sketch(XY(discH), (e) => e.circle([0, 0], postR)), postH);
  m.union([a, b]);
  return m;
}
function holePlate(w, d, h, holes) {
  const m = new Model();
  let body = m.extrude(m.sketch(XY(), (e) => e.rect([0, 0], [w, d])), h);
  for (const [c, r] of holes) {
    const tool = m.extrude(m.sketch(XY(-1), (e) => e.circle(c, r)), h + 2);
    body = m.subtract(body, tool);
  }
  return m;
}
const slotOutline = () => ({ draw: (e) => {
  e.line([0, 0], [20, 0]); e.arc([20, 0], [25, 5], [20, 10]); e.line([20, 10], [0, 10]); e.arc([0, 10], [-5, 5], [0, 0]);
}, P: 40 + 10 * PI, K: PI });
function slot(h) {
  const m = new Model(), o = slotOutline();
  m.extrude(m.sketch(XY(), o.draw), h);
  return { m, ...o };
}

// Rotation-family closed forms (Pappus): section region in the (radius, z)
// half plane, revolved about the axis.
const pappus = (region) => 2 * PI * region.momentX; // 2π ∬ x dA
const u2 = (a) => { const l = Math.hypot(a[0], a[1]); return [a[0] / l, a[1] / l]; };

// ---------------------------------------------------------------------------
// The catalogue. rank = edge-configuration rank in docs/fillet/corpus.md §4.1
// (99 = not in the measured corpus). corpus = the configuration it stands for.

const C = [];
const add = (c) => C.push(c);
const cf = (delta, formula, extra = {}) => ({ deltaVolume: delta, formula, label: 'INFERRED (derivation); compare MEASURED OCCT in reference.json', ...extra });

// --- 1: fillet, plane/plane line, convex 90°, perpendicular caps (corpus #1 edge, #1 vertex)
add({ id: 'pp-box-vertical-edge-r2', group: 'core', rank: 1, corpus: 'edge #1 / vertex #1: rounded vertical box edge', op: 'fillet', size: 2,
  model: box(20, 10, 8), select: [{ near: [20, 10, 4] }], convexity: ['convex'], expect: 'ok', blendTypes: ['cylinder'],
  closedForm: cf(-8 * A90(2), '-L r^2 (1 - pi/4)') });
add({ id: 'pp-plate-4-vertical-edges-r4.2', group: 'core', rank: 1, corpus: 'call #1: plane/plane convex lines, perpendicular caps; 4.2 mm is the #3 fillet size', op: 'fillet', size: 4.2,
  model: box(40, 30, 12), select: [{ parallel: [0, 0, 1] }], convexity: ['convex'], expect: 'ok', blendTypes: ['cylinder'],
  closedForm: cf(-4 * 12 * A90(4.2), 'V = abc - (4 - pi) r^2 c') });
add({ id: 'pp-roundx-r3', group: 'corpus', rank: 1, corpus: "Marc's roundX helper: the 4 X-parallel edges of a box", op: 'fillet', size: 3,
  model: box(50, 20, 12), select: [{ parallel: [1, 0, 0] }], convexity: ['convex'], expect: 'ok', blendTypes: ['cylinder'],
  closedForm: cf(-4 * 50 * A90(3), 'V = abc - (4 - pi) r^2 a (roundX, theory §14)') });
add({ id: 'pp-box-top-edge-r1', group: 'core', rank: 1, corpus: 'edge #1, horizontal orientation', op: 'fillet', size: 1,
  model: box(20, 10, 8), select: [{ near: [10, 0, 8] }], convexity: ['convex'], expect: 'ok', blendTypes: ['cylinder'],
  closedForm: cf(-20 * A90(1), '-L r^2 (1 - pi/4)') });
add({ id: 'pp-box-two-of-three-mitre-r2', group: 'core', rank: 1, corpus: 'vertex #6: corner-2-of-3 fillet mitre (implementations.md F6)', op: 'fillet', size: 2,
  model: box(20, 10, 8), select: [{ near: [10, 0, 8] }, { near: [20, 0, 4] }], convexity: ['convex', 'convex'], expect: 'ok', blendTypes: ['cylinder'],
  closedForm: cf(-(A90(2) * (20 + 8) - W2(2)), '-(r^2(1-pi/4)(L1+L2) - r^3(5/3 - pi/2))') });
add({ id: 'pp-box-top-loop-r2', group: 'core', rank: 1, corpus: 'call #10: fillet top loop of a box, four mitres', op: 'fillet', size: 2,
  model: box(30, 20, 10), select: [{ inPlane: { point: [0, 0, 10], normal: [0, 0, 1] } }], convexity: ['convex'], expect: 'ok', blendTypes: ['cylinder'],
  closedForm: cf(-outlineFilletRemoved(100, 4, 2), 'outline fillet: -(P r^2(1-pi/4) - K r^3(5/3-pi/2)), P = 100, K = 4') });
add({ id: 'pp-box-corner-3-r2', group: 'core', rank: 1, corpus: 'vertex #12: corner-3 sphere (F3)', op: 'fillet', size: 2,
  model: box(20, 20, 20), select: [{ near: [20, 20, 10] }, { near: [20, 10, 20] }, { near: [10, 20, 20] }], convexity: ['convex'], expect: 'ok', blendTypes: ['cylinder', 'sphere'],
  closedForm: cf(-(3 * A90(2) * (20 - 2) + 8 * (1 - PI / 6)), '-(3 r^2(1-pi/4)(a-r) + r^3(1-pi/6))') });
{
  const a = 20, b = 16, c = 12, r = 2, s = (x) => x - 2 * r;
  const rounded = s(a) * s(b) * s(c) + 2 * r * (s(a) * s(b) + s(b) * s(c) + s(a) * s(c)) + PI * r * r * (s(a) + s(b) + s(c)) + (4 / 3) * PI * r ** 3;
  add({ id: 'pp-box-all-edges-r2', group: 'core', rank: 1, corpus: 'all-edges fillet (12 cylinders + 8 sphere corners)', op: 'fillet', size: 2,
    model: box(a, b, c), select: [{ all: true }], convexity: ['convex'], expect: 'ok', blendTypes: ['cylinder', 'sphere'],
    closedForm: cf(rounded - a * b * c, 'Steiner: rounded box volume - abc', { faces: { plane: 6, cylinder: 12, sphere: 8 } }) });
}
{
  const a = 60, b = 6, c = 6, r = 1, s = (x) => x - 2 * r;
  const rounded = s(a) * s(b) * s(c) + 2 * r * (s(a) * s(b) + s(b) * s(c) + s(a) * s(c)) + PI * r * r * (s(a) + s(b) + s(c)) + (4 / 3) * PI * r ** 3;
  add({ id: 'corpus-probestab-all-edges-r1', group: 'corpus', rank: 1, corpus: 'make_probestaebe.py (py4186): all edges of test bars, corner-3', op: 'fillet', size: 1,
    model: box(a, b, c), select: [{ all: true }], convexity: ['convex'], expect: 'ok', blendTypes: ['cylinder', 'sphere'],
    closedForm: cf(rounded - a * b * c, 'Steiner: rounded box volume - abc') });
}
{
  // U plate: 6 convex + 2 concave vertical edges in one call (fs560-style).
  const pts = [[0, 0], [60, 0], [60, 40], [40, 40], [40, 20], [20, 20], [20, 40], [0, 40]];
  const { m } = prism(pts, 12);
  add({ id: 'corpus-u-plate-vertical-edges-r4.2', group: 'corpus', rank: 1, corpus: 'fs560 z-axis family: vertical plane/plane edges, convex and concave in one call', op: 'fillet', size: 4.2,
    model: m, select: [{ parallel: [0, 0, 1] }], convexity: ['convex', 'concave'], expect: 'ok', blendTypes: ['cylinder'],
    closedForm: cf(12 * (-6 * A90(4.2) + 2 * A90(4.2)), 'h (n_concave - n_convex) r^2 (1-pi/4)') });
}

// --- 2: chamfer, plane/plane line, convex 90°
add({ id: 'ch-box-vertical-edge-d1', group: 'core', rank: 2, corpus: 'edge #2 / vertex #5: chamfer with perpendicular caps', op: 'chamfer', size: 1,
  model: box(20, 10, 8), select: [{ near: [20, 10, 4] }], convexity: ['convex'], expect: 'ok', blendTypes: ['plane'],
  closedForm: cf(-8 * 0.5, '-L d^2/2') });
add({ id: 'ch-plate-top-loop-0.42', group: 'core', rank: 2, corpus: 'call #6: 0.42 mm deburr of a face loop, mitres (the #1 chamfer size)', op: 'chamfer', size: 0.42,
  model: box(40, 30, 5), select: [{ inPlane: { point: [0, 0, 5], normal: [0, 0, 1] } }], convexity: ['convex'], expect: 'ok', blendTypes: ['plane'],
  closedForm: cf(-outlineChamferRemoved(140, 4, 0.42), 'outline chamfer: -(P d^2/2 - K d^3/3), P = 140, K = 4') });
add({ id: 'ch-plate-both-loops-0.42', group: 'core', rank: 2, corpus: 'top and bottom deburr loops in one call', op: 'chamfer', size: 0.42,
  model: box(40, 30, 5), select: [{ inPlane: { point: [0, 0, 5], normal: [0, 0, 1] } }, { inPlane: { point: [0, 0, 0], normal: [0, 0, 1] } }], convexity: ['convex'], expect: 'ok', blendTypes: ['plane'],
  closedForm: cf(-2 * outlineChamferRemoved(140, 4, 0.42), '2 x outline chamfer') });
add({ id: 'ch-box-corner-3-d1', group: 'core', rank: 2, corpus: 'vertex #11: chamfer corner-3', op: 'chamfer', size: 1,
  model: box(20, 20, 20), select: [{ near: [20, 20, 10] }, { near: [20, 10, 20] }, { near: [10, 20, 20] }], convexity: ['convex'], expect: 'ok', blendTypes: ['plane'],
  closedForm: cf(-(1.5 * 20 - 0.75), '-(3 d^2 L/2 - d^3 + d^3/4): union of three prisms, planes meet in a point (inclusion-exclusion)',
    { alternatives: { cornerTriangle: -(1.5 * 20 - 2 / 3) }, acceptAlternatives: true, note: 'OCCT adds a corner triangle (MEASURED, removes d^3/12 more); Onshape probe FP16 builds the corner triangle, so the grade uses that form (validate.mjs verdictOf: the forms Onshape agrees with decide)' }) });
{
  const rp = roundedPoly([[0, 0], [50, 0], [50, 30], [0, 30]], [0, 5, 5, 0]);
  const m = new Model();
  m.extrude(m.sketch(XY(), rp.draw), 4);
  add({ id: 'corpus-outline-chamfer-lines-arcs-0.42', group: 'corpus', rank: 2, corpus: 'call #3: outline chamfer of a rounded plate, mitres + G1 chains (cad-project-033, cad-project-032)', op: 'chamfer', size: 0.42,
    model: m, select: [{ inPlane: { point: [0, 0, 4], normal: [0, 0, 1] } }], convexity: ['convex'], expect: 'ok', blendTypes: ['plane', 'cone'],
    closedForm: cf(-outlineChamferRemoved(rp.P, rp.K, 0.42), `outline chamfer, P = ${rp.P.toFixed(6)}, K = ${rp.K.toFixed(6)}`) });
}
{
  // r22-planar-guides-like outline: lines at 10° and 30°, R4.2 arcs, a concave dip, 4.2 thick.
  const t10 = Math.tan(deg(10)), t30 = Math.tan(deg(30));
  const pts = [[0, 0], [70, 0], [70, 8], [50, 8 + 20 * t10], [35, 8 + 20 * t10 - 15 * t30], [20, 8 + 20 * t10], [0, 8]];
  const { m, rp } = prism(pts, 4.2, [0, 0, 0, 4.2, 0, 4.2, 0]);
  add({ id: 'corpus-r22-guide-outline-chamfer-0.42', group: 'corpus', rank: 2, corpus: 'r22-planar-guides.fs outerDeburr: face-loop chamfer that OCCT fails in the corpus (strict class); geometry is r22-like, not the file itself',
    op: 'chamfer', size: 0.42, model: m, select: [{ inPlane: { point: [0, 0, 4.2], normal: [0, 0, 1] } }], convexity: ['convex'], expect: 'ok', blendTypes: ['plane', 'cone'],
    closedForm: cf(-outlineChamferRemoved(rp.P, rp.K, 0.42), `outline chamfer, P = ${rp.P.toFixed(6)}, K = ${rp.K.toFixed(6)} (mitres at convex and concave sharp corners)`) });
}

// --- 3: chamfer, circle plane/cylinder rim
{
  const d = 0.42, rho = 4;
  const tri = cornerChamfer2D([rho, 6], [1, 0], [0, -1], d, d);
  add({ id: 'ch-hole-rim-0.42', group: 'core', rank: 3, corpus: 'edge #3 / vertex #4: hole rim chamfer, closed loop', op: 'chamfer', size: d,
    model: holePlate(30, 30, 6, [[[15, 15], rho]]), select: [{ near: [15 + rho, 15, 6] }], convexity: ['convex'], expect: 'ok', blendTypes: ['cone'],
    closedForm: cf(-pappus(cornerChamfer2D([rho, 6], [1, 0], [0, -1], d, d)), 'Pappus: 2 pi xbar d^2/2, xbar = rho + d/3', { area2D: tri.area }) });
  const tri2 = cornerChamfer2D([5, 10], [-1, 0], [0, -1], d, d);
  add({ id: 'ch-post-rim-0.42', group: 'core', rank: 3, corpus: 'edge #3: boss rim chamfer (closed circle with the cylinder seam vertex)', op: 'chamfer', size: d,
    model: post(5, 10), select: [{ near: [0, 5, 10] }], convexity: ['convex'], expect: 'ok', blendTypes: ['cone'],
    closedForm: cf(-pappus(tri2), 'Pappus: 2 pi xbar d^2/2, xbar = rho - d/3') });
  const two = holePlate(40, 20, 5, [[[10, 10], 2.5], [[30, 10], 2.5]]);
  const tri3 = cornerChamfer2D([2.5, 5], [1, 0], [0, -1], d, d);
  add({ id: 'corpus-two-hole-rims-chamfer-0.42', group: 'corpus', rank: 3, corpus: 'call #4: closed rim chamfers (kalibrier.py, wasteboard)', op: 'chamfer', size: d,
    model: two, select: [{ near: [12.5, 10, 5] }, { near: [32.5, 10, 5] }], convexity: ['convex'], expect: 'ok', blendTypes: ['cone'],
    closedForm: cf(-2 * pappus(tri3), '2 x Pappus') });
}

// --- 4, 5, 7: fillet, plane/plane concave
{
  const L = [[0, 0], [30, 0], [30, 8], [8, 8], [8, 30], [0, 30]];
  add({ id: 'pp-concave-270-r2', group: 'core', rank: 4, corpus: 'edge #4: concave 270° root fillet', op: 'fillet', size: 2,
    model: prism(L, 10).m, select: [{ near: [8, 8, 5] }], convexity: ['concave'], expect: 'ok', blendTypes: ['cylinder'],
    closedForm: cf(10 * A90(2), '+L r^2 (1-pi/4)') });
  add({ id: 'ch-concave-270-d1', group: 'core', rank: 4, corpus: 'chamfer on a concave edge (adds material)', op: 'chamfer', size: 1,
    model: prism(L, 10).m, select: [{ near: [8, 8, 5] }], convexity: ['concave'], expect: 'ok', blendTypes: ['plane'],
    closedForm: cf(10 * 0.5, '+L d^2/2') });
  add({ id: 'pp-l-concave-and-convex-r2', group: 'core', rank: 4, corpus: 'call #14: convex + concave lines in one call, not at one vertex', op: 'fillet', size: 2,
    model: prism(L, 10).m, select: [{ near: [8, 8, 5] }, { near: [0, 15, 10] }], convexity: ['concave', 'convex'], expect: 'ok', blendTypes: ['cylinder'],
    closedForm: cf(10 * A90(2) - 30 * A90(2), '+10 A90 - 30 A90') });
}
add({ id: 'pp-rib-root-concave-r2', group: 'core', rank: 4, corpus: 'call #2: concave root fillets of a rib (cad-project-003 robot.py)', op: 'fillet', size: 2,
  model: profile([[0, 0], [40, 0], [40, 4], [22, 4], [22, 16], [18, 16], [18, 4], [0, 4]], 20), select: [{ near: [18, -10, 4] }, { near: [22, -10, 4] }],
  convexity: ['concave'], expect: 'ok', blendTypes: ['cylinder'], closedForm: cf(2 * 20 * A90(2), '+2 L r^2 (1-pi/4)') });
{
  const d = 15 * Math.tan(deg(30));
  add({ id: 'pp-concave-240-r2', group: 'core', rank: 5, corpus: 'edge #5: concave 180-270°', op: 'fillet', size: 2,
    model: prism([[0, 0], [30, 0], [30, 20], [15, 20 - d], [0, 20]], 10).m, select: [{ near: [15, 20 - d, 5] }], convexity: ['concave'], expect: 'ok', blendTypes: ['cylinder'],
    closedForm: cf(10 * planePlaneSpandrel(2, deg(120)), '+L r^2 (cot(b/2) - (pi-b)/2), b = 360° - 240°') });
  const d2 = 15 * Math.tan(deg(60));
  add({ id: 'pp-concave-300-r1', group: 'core', rank: 7, corpus: 'edge #7: deep concave > 270°', op: 'fillet', size: 1,
    model: prism([[0, 0], [30, 0], [30, 40], [15, 40 - d2], [0, 40]], 10).m, select: [{ near: [15, 40 - d2, 5] }], convexity: ['concave'], expect: 'ok', blendTypes: ['cylinder'],
    closedForm: cf(10 * planePlaneSpandrel(1, deg(60)), '+L r^2 (cot(b/2) - (pi-b)/2), b = 60°') });
}

// --- 6, 8: fillet, plane/plane convex at other angles
{
  const roof = 15 * Math.tan(deg(15));
  add({ id: 'pp-convex-150-r2', group: 'core', rank: 6, corpus: 'edge #6: obtuse convex 90-180°', op: 'fillet', size: 2,
    model: prism([[0, 0], [30, 0], [30, 10], [15, 10 + roof], [0, 10]], 10).m, select: [{ near: [15, 10 + roof, 5] }], convexity: ['convex'], expect: 'ok', blendTypes: ['cylinder'],
    closedForm: cf(-10 * planePlaneSpandrel(2, deg(150)), '-L r^2 (cot(a/2) - (pi-a)/2)') });
  add({ id: 'pp-ridge-150-horizontal-r2', group: 'core', rank: 6, corpus: 'edge #6 on a horizontal ridge (non-axis-aligned faces)', op: 'fillet', size: 2,
    model: profile([[0, 0], [30, 0], [30, 10], [15, 10 + roof], [0, 10]], 20), select: [{ near: [15, -10, 10 + roof] }], convexity: ['convex'], expect: 'ok', blendTypes: ['cylinder'],
    closedForm: cf(-20 * planePlaneSpandrel(2, deg(150)), '-L r^2 (cot(a/2) - (pi-a)/2)') });
  const hex = [0, 1, 2, 3, 4, 5].map((k) => [10 * Math.cos(deg(60 * k)), 10 * Math.sin(deg(60 * k))]);
  add({ id: 'pp-convex-120-hex-r2', group: 'core', rank: 6, corpus: 'edge #6: 120° (hex prism)', op: 'fillet', size: 2,
    model: prism(hex, 10).m, select: [{ near: [10, 0, 5] }], convexity: ['convex'], expect: 'ok', blendTypes: ['cylinder'],
    closedForm: cf(-10 * planePlaneSpandrel(2, deg(120)), '-L r^2 (cot(a/2) - (pi-a)/2)') });
  // Onshape probe FP15 (chamfer semantics, 24 September 2026): the probe's own
  // input (regular hexagon of circumradius 10 in the YZ plane, extruded 20
  // along +X), with the corner coordinates written out as the kernel's
  // FeatureScript subset needs them. Onshape's EQUAL_OFFSETS sets back d along
  // each support face (MEASURED: dV -8.6603, chamfer face 34.641 mm²); the face
  // offset reading (-11.547) is recorded as a rejected alternative.
  const fp15 = () => {
    const pts = Array.from({ length: 6 }, (_, k) => [10 * Math.cos(deg(30 + 60 * k)), 10 * Math.sin(deg(30 + 60 * k))]);
    const n = (x) => (Math.abs(x) < 1e-12 ? '0' : Number(x.toPrecision(17)).toString());
    const segs = pts.map((p, k) => `    skLineSegment(s0, "e${k}", { "start" : vector(${n(p[0])}, ${n(p[1])}) * millimeter, "end" : vector(${n(pts[(k + 1) % 6][0])}, ${n(pts[(k + 1) % 6][1])}) * millimeter });`);
    return ['FeatureScript 3044;', 'import(path : "onshape/std/geometry.fs", version : "3044.0");', '',
      'export function filletInput(context is Context, id is Id, definition is map)', '{',
      '    var s0 = newSketchOnPlane(context, id + "s0", { "sketchPlane" : plane(vector(0, 0, 0) * millimeter, vector(1, 0, 0), vector(0, 1, 0)) });',
      ...segs, '    skSolve(s0);',
      '    opExtrude(context, id + "x1", { "entities" : qSketchRegion(id + "s0"), "direction" : vector(1, 0, 0), "endBound" : BoundingType.BLIND, "endDepth" : 20 * millimeter });',
      '}', ''].join('\n');
  };
  add({ id: 'ch-convex-120-hex-d1', group: 'core', rank: 6, corpus: 'Onshape probe FP15: equal-offset chamfer on a 120° edge (chamfer semantics)', op: 'chamfer', size: 1,
    model: { source: fp15 }, select: [{ near: [10, 0, 10] }], convexity: ['convex'], expect: 'ok', blendTypes: ['plane'],
    closedForm: cf(-20 * 0.5 * Math.sin(deg(120)), '-L d^2 sin(a)/2: setback d along each support face (Onshape FP15)',
      { alternatives: { faceOffset: -20 * 0.5 * (1 / Math.sin(deg(120))) ** 2 * Math.sin(deg(120)) }, acceptAlternatives: false,
        note: 'Onshape probe FP15 (MEASURED): setback along the faces; the face-offset reading is rejected' }) });
  const tri = [[0, 0], [20, 0], [10, 10 * Math.sqrt(3)]];
  add({ id: 'pp-convex-60-r2', group: 'core', rank: 8, corpus: 'edge #8: acute convex < 90°', op: 'fillet', size: 2,
    model: prism(tri, 10).m, select: [{ near: [10, 10 * Math.sqrt(3), 5] }], convexity: ['convex'], expect: 'ok', blendTypes: ['cylinder'],
    closedForm: cf(-10 * planePlaneSpandrel(2, deg(60)), '-L r^2 (cot(a/2) - (pi-a)/2)') });
  const c15 = Math.cos(deg(15)), s15 = Math.sin(deg(15));
  add({ id: 'pp-convex-30-acute-r1', group: 'core', rank: 8, corpus: 'edge #8: 30° knife edge', op: 'fillet', size: 1,
    model: prism([[0, 0], [40 * c15, -40 * s15], [40 * c15, 40 * s15]], 10).m, select: [{ near: [0, 0, 5] }], convexity: ['convex'], expect: 'ok', blendTypes: ['cylinder'],
    closedForm: cf(-10 * planePlaneSpandrel(1, deg(30)), '-L r^2 (cot(a/2) - (pi-a)/2)') });
  // chamfer at 60°: Onshape EQUAL_OFFSETS sets back d along each support face
  // (probe FP-a, measured on FP15 at 120°), which is OCCT's in-support
  // distance; the face-offset reading (in-face setback d cot(a/2)) is rejected.
  const fo = faceOffsetSetback(1, deg(60));
  const top = [10, 10 * Math.sqrt(3)], ua = u2([-10, -10 * Math.sqrt(3)]), ub = u2([10, -10 * Math.sqrt(3)]);
  add({ id: 'ch-convex-60-d1', group: 'core', rank: 8, corpus: 'equal-offset chamfer off 90°: setback along the faces (Onshape FP-a), not face offset', op: 'chamfer', size: 1,
    model: prism(tri, 10).m, select: [{ near: [10, 10 * Math.sqrt(3), 5] }], convexity: ['convex'], expect: 'ok', blendTypes: ['plane'],
    closedForm: cf(-10 * cornerChamfer2D(top, ua, ub, 1, 1).area, '-L d^2 sin(a)/2: setback d along each support face (Onshape FP-a / FP15)',
      { alternatives: { faceOffset: -10 * cornerChamfer2D(top, ua, ub, fo, fo).area }, acceptAlternatives: false,
        note: 'Onshape EQUAL_OFFSETS sets back along the faces (probe FP-a, MEASURED on FP15); the face-offset reading (in-face setback d cot(a/2)) is rejected' }) });
}

// --- 9: fillet, circle plane/cylinder rim (rotation family)
{
  const rim = (r) => cornerFillet2D([5, 10], [-1, 0], [0, -1], r);
  for (const [r, id, note, blend] of [[1, 'pc-post-top-rim-r1', 'edge #9: boss rim, ring torus (major 4, minor 1)', ['torus']],
    [3.5, 'pc-post-top-rim-spindle-r3.5', 'spindle torus (rho/2 < r < rho), theory §4.4', ['torus']],
    [4.99, 'pc-post-top-rim-r4.99', 'near-sphere spindle torus (major 0.01)', ['torus']],
    [5, 'pc-post-top-rim-sphere-r5', 'r = rho: sphere cap, top face consumed (OCCT OK, implementations.md §2.4)', ['sphere']]]) {
    add({ id, group: 'core', rank: 9, corpus: note, op: 'fillet', size: r, model: post(5, 10), select: [{ near: [0, 5, 10] }], convexity: ['convex'], expect: 'ok', blendTypes: blend,
      closedForm: cf(-pappus(rim(r)), 'Pappus: 2 pi xbar A, section = cornerFillet2D') });
  }
  add({ id: 'pc-post-top-rim-too-large-r6', group: 'hard', rank: 9, corpus: 'r > rho on a boss top: no ball fits (theory §4.4 / §10.1)', op: 'fillet', size: 6,
    model: post(5, 10), select: [{ near: [0, 5, 10] }], convexity: ['convex'], expect: 'must-refuse', refuseClass: ['radius-too-large', 'face-consumed', 'overflow', 'self-intersection'] });
  const base = cornerFillet2D([4, 3], [1, 0], [0, 1], 1);
  add({ id: 'pc-post-base-concave-r1', group: 'core', rank: 17, corpus: 'edge #17: concave rim at a post base (ring torus, adds material)', op: 'fillet', size: 1,
    model: steppedPost(10, 3, 4, 10), select: [{ near: [0, 4, 3] }], convexity: ['concave'], expect: 'ok', blendTypes: ['torus'],
    closedForm: cf(pappus(base), '+Pappus') });
  const hole = cornerFillet2D([4, 6], [1, 0], [0, -1], 1);
  add({ id: 'pc-hole-rim-r1', group: 'core', rank: 9, corpus: 'edge #9: hole rim fillet (ring torus major rho + r)', op: 'fillet', size: 1,
    model: holePlate(30, 30, 6, [[[15, 15], 4]]), select: [{ near: [19, 15, 6] }], convexity: ['convex'], expect: 'ok', blendTypes: ['torus'],
    closedForm: cf(-pappus(hole), '-Pappus') });
  add({ id: 'pc-hole-both-rims-r1', group: 'core', rank: 9, corpus: 'both hole rims (two closed loops in one call)', op: 'fillet', size: 1,
    model: holePlate(30, 30, 6, [[[15, 15], 4]]), select: [{ near: [19, 15, 6] }, { near: [19, 15, 0] }], convexity: ['convex'], expect: 'ok', blendTypes: ['torus'],
    closedForm: cf(-2 * pappus(hole), '-2 Pappus') });
  add({ id: 'pc-post-both-rims-r1', group: 'core', rank: 9, corpus: 'vertex #13: closed-loop fillets at both ends of a post', op: 'fillet', size: 1,
    model: post(5, 10), select: [{ near: [0, 5, 10] }, { near: [0, 5, 0] }], convexity: ['convex'], expect: 'ok', blendTypes: ['torus'],
    closedForm: cf(-2 * pappus(rim(1)), '-2 Pappus') });
}

// --- 10: chamfer on a cone section; cone rim fillet
{
  const P = [5, 10], ua = [-1, 0], ub = u2([3, -10]);
  const alpha = Math.acos(ua[0] * ub[0] + ua[1] * ub[1]);
  const s = faceOffsetSetback(0.42, alpha);
  const cone = () => { const m = new Model(); const a = m.sketch(XY(), (e) => e.circle([0, 0], 8)); const b = m.sketch(XY(10), (e) => e.circle([0, 0], 5)); m.loft(a, b); return m; };
  add({ id: 'ch-cone-rim-0.42', group: 'core', rank: 10, corpus: 'edge #10: chamfer of a cone section (obtuse), extended class', op: 'chamfer', size: 0.42,
    model: cone(), select: [{ near: [0, 5, 10] }], convexity: ['convex'], expect: 'ok', blendTypes: ['cone'],
    closedForm: cf(-pappus(cornerChamfer2D(P, ua, ub, 0.42, 0.42)), `Pappus, setback d along each support face (Onshape FP-a / FP15), a = ${(alpha * 180 / PI).toFixed(4)}°`,
      { alternatives: { faceOffset: -pappus(cornerChamfer2D(P, ua, ub, s, s)) }, acceptAlternatives: false,
        note: 'Onshape EQUAL_OFFSETS sets back along the faces (probe FP-a, MEASURED on FP15); the face-offset reading (in-face setback d cot(a/2)) is rejected' }) });
  add({ id: 'pc-cone-rim-r1', group: 'core', rank: 10, corpus: 'plane/cone rim fillet (rotation family: torus)', op: 'fillet', size: 1,
    model: cone(), select: [{ near: [0, 5, 10] }], convexity: ['convex'], expect: 'ok', blendTypes: ['torus'],
    closedForm: cf(-pappus(cornerFillet2D(P, ua, ub, 1)), 'Pappus') });
}

// --- 14, 19: cylinder-generator lines (translation family, line/circle 2D solve)
{
  const dflat = new Model();
  dflat.extrude(dflat.sketch(XY(), (e) => { e.line([6, -8], [6, 8]); e.arc([6, 8], [-10, 0], [6, -8]); }), 10);
  const lc = lineCircleFillet2D([6, 8], [0, -1], [-1, 0], [0, 0], 10, 1, true);
  add({ id: 'pc-dflat-generator-convex-r1', group: 'core', rank: 19, corpus: 'edge #19: cylinder-generator/plane convex (D shaft flat)', op: 'fillet', size: 1,
    model: dflat, select: [{ near: [6, 8, 5] }, { near: [6, -8, 5] }], convexity: ['convex'], expect: 'ok', blendTypes: ['cylinder'],
    closedForm: cf(-2 * 10 * lc.area, '-2 L A(line/circle, internal)') });
  const bump = new Model();
  bump.extrude(bump.sketch(XY(), (e) => { e.line([0, 0], [30, 0]); e.line([30, 0], [30, 10]); e.line([30, 10], [20, 10]); e.arc([20, 10], [15, 15], [10, 10]); e.line([10, 10], [0, 10]); e.line([0, 10], [0, 0]); }), 8);
  const cb = lineCircleFillet2D([20, 10], [1, 0], [0, 1], [15, 10], 5, 1, false);
  add({ id: 'pc-bump-generator-concave-r1', group: 'core', rank: 14, corpus: 'edge #14: cylinder-generator/plane concave', op: 'fillet', size: 1,
    model: bump, select: [{ near: [10, 10, 4] }, { near: [20, 10, 4] }], convexity: ['concave'], expect: 'ok', blendTypes: ['cylinder'],
    closedForm: cf(2 * 8 * cb.area, '+2 L A(line/circle, external)') });
}

// --- G1 chains (vertex #3 / #10)
{
  const s = () => slot(4);
  const o = s();
  add({ id: 'ch-slot-outline-0.42', group: 'core', rank: 3, corpus: 'vertex #3: chamfer along a G1 line/arc chain', op: 'chamfer', size: 0.42,
    model: o.m, select: [{ inPlane: { point: [0, 0, 4], normal: [0, 0, 1] } }], convexity: ['convex'], expect: 'ok', blendTypes: ['plane', 'cone'],
    closedForm: cf(-outlineChamferRemoved(o.P, o.K, 0.42), 'outline chamfer, K = pi') });
  add({ id: 'fl-slot-outline-r1', group: 'core', rank: 9, corpus: 'vertex #10: fillet along a G1 chain (cylinders + tori)', op: 'fillet', size: 1,
    model: s().m, select: [{ inPlane: { point: [0, 0, 4], normal: [0, 0, 1] } }], convexity: ['convex'], expect: 'ok', blendTypes: ['cylinder', 'torus'],
    closedForm: cf(-outlineFilletRemoved(o.P, o.K, 1), 'outline fillet, K = pi') });
  add({ id: 'fl-slot-one-line-propagate-r1', group: 'core', rank: 9, corpus: 'F7: tangent propagation from one selected line to the whole loop', op: 'fillet', size: 1, tangentPropagation: true,
    model: s().m, select: [{ near: [10, 0, 4] }], convexity: ['convex'], expect: 'ok', blendTypes: ['cylinder', 'torus'],
    closedForm: cf(-outlineFilletRemoved(o.P, o.K, 1), 'propagates to the full outline') });
  add({ id: 'fl-slot-one-line-no-propagate-r1', group: 'hard', rank: 9, corpus: 'F7 with tangentPropagation false: the blend must end at G1 vertices', op: 'fillet', size: 1, tangentPropagation: false,
    model: s().m, select: [{ near: [10, 0, 4] }], convexity: ['convex'], expect: 'either' });
  add({ id: 'hard-tangent-edge-selection-r1', group: 'hard', rank: 13, corpus: 'edge #13: fillet on a G1 seam edge (degenerate selection; OCCT no-op)', op: 'fillet', size: 1,
    model: s().m, select: [{ near: [20, 0, 2] }], convexity: ['smooth'], expect: 'either', refuseClass: ['tangent-edge'],
    closedForm: cf(0, 'no-op: the ball touches both faces on the same line'), noOpAllowed: true });
}

// --- hard: admission boundaries, consumption, overflow, overlap, mixed convexity
add({ id: 'hard-single-edge-r-too-large-r12', group: 'hard', rank: 1, corpus: 'F2: radius larger than both adjacent faces', op: 'fillet', size: 12,
  model: box(10, 10, 10), select: [{ near: [10, 10, 5] }], convexity: ['convex'], expect: 'must-refuse', refuseClass: ['radius-too-large', 'face-consumed', 'overflow'] });
add({ id: 'hard-single-edge-r-equals-width-r10', group: 'hard', rank: 1, corpus: 'F2 boundary: r = face width, both faces consumed (OCCT NOT DONE)', op: 'fillet', size: 10,
  model: box(10, 10, 10), select: [{ near: [10, 10, 5] }], convexity: ['convex'], expect: 'either', refuseClass: ['face-consumed', 'radius-too-large'],
  closedForm: cf(-10 * A90(10), 'quarter cylinder') });
add({ id: 'hard-single-edge-r9.999', group: 'hard', rank: 1, corpus: 'F2 just inside the boundary (OCCT OK, implementations.md §2.4)', op: 'fillet', size: 9.999,
  model: box(10, 10, 10), select: [{ near: [10, 10, 5] }], convexity: ['convex'], expect: 'ok', blendTypes: ['cylinder'],
  closedForm: cf(-10 * A90(9.999), '-L r^2 (1-pi/4)') });
add({ id: 'hard-full-round-r5', group: 'hard', rank: 1, corpus: 'F1: two fillets consume the top face (OCCT #1177, NOT DONE on 8.0.1)', op: 'fillet', size: 5,
  model: box(10, 10, 10), select: [{ near: [5, 0, 10] }, { near: [5, 10, 10] }], convexity: ['convex'], expect: 'either', refuseClass: ['face-consumed'],
  closedForm: cf(-2 * 10 * A90(5), 'two quarter cylinders meeting tangentially') });
add({ id: 'hard-near-full-round-r4.99', group: 'hard', rank: 1, corpus: 'F1 just inside: a 0.02 mm sliver of the top face survives', op: 'fillet', size: 4.99,
  model: box(10, 10, 10), select: [{ near: [5, 0, 10] }, { near: [5, 10, 10] }], convexity: ['convex'], expect: 'ok', blendTypes: ['cylinder'],
  closedForm: cf(-2 * 10 * A90(4.99), '-2 L r^2 (1-pi/4)') });
add({ id: 'hard-overlapping-blends-thin-wall-r1', group: 'hard', rank: 1, corpus: 'theory §10.4: two blends on a 1.5 mm wall overlap (1 + 1 > 1.5)', op: 'fillet', size: 1,
  model: box(20, 1.5, 10), select: [{ near: [10, 0, 10] }, { near: [10, 1.5, 10] }], convexity: ['convex'], expect: 'either', refuseClass: ['blend-overlap', 'face-consumed', 'overflow'] });
add({ id: 'hard-overflow-narrow-ledge-r0.4', group: 'hard', rank: 4, corpus: 'face consumption/overflow: 0.125 mm ledge next to a 0.4 mm concave root (preload coupon)', op: 'fillet', size: 0.4,
  model: profile([[0, 0], [20, 0], [20, 2], [12.125, 2], [12.125, 2.5], [12, 2.5], [12, 10], [8, 10], [8, 2], [0, 2]], 10), select: [{ near: [12, -5, 2.5] }],
  convexity: ['concave'], expect: 'either', refuseClass: ['overflow', 'face-consumed'] });
{
  // Onshape FP09 builds the notch: the 0.57 mm face is consumed and the blend
  // cylinder is trimmed by the top face (face areas 87.71573 and 195.7828 mm²
  // match the trim at y = 8.7716 and x = 19.5783).
  const pts = [[0, 0], [20, 0], [20, 9.6], [19.6, 10], [0, 10]];
  add({ id: 'hard-overflow-convex-small-face-r2', group: 'hard', rank: 6, corpus: 'overflow: setback 0.83 mm > 0.57 mm neighbouring face', op: 'fillet', size: 2,
    model: prism(pts, 10).m, select: [{ near: [20, 9.6, 5] }], convexity: ['convex'], expect: 'either', refuseClass: ['overflow', 'face-consumed'],
    closedForm: cf(-10 * notch2D(pts, 2, 2).area, '-L area(notch): the ball on the 20-face and the 135° face, trimmed by the top face (Onshape FP09)') });
}
{
  const L = [[0, 0], [30, 0], [30, 8], [8, 8], [8, 30], [0, 30]];
  add({ id: 'hard-mixed-convexity-corner-r1', group: 'hard', rank: 99, corpus: 'vertex #15 / F5: concave + two convex edges at one vertex (project-component-4c7a33fe.fs)', op: 'fillet', size: 1,
    model: prism(L, 10).m, select: [{ near: [8, 8, 5] }, { near: [19, 8, 10] }, { near: [8, 19, 10] }], convexity: ['concave', 'convex'], expect: 'either', refuseClass: ['mixed-convexity', 'vertex-blend'] });
}
{
  const roof = 15 * Math.tan(deg(0.55));
  add({ id: 'hard-near-tangent-ridge-178.9-r2', group: 'hard', rank: 6, corpus: 'F11: dihedral 178.9°, spandrel of 1e-5 mm²', op: 'fillet', size: 2,
    model: profile([[0, 0], [30, 0], [30, 10], [15, 10 + roof], [0, 10]], 20), select: [{ near: [15, -10, 10 + roof] }], convexity: ['convex'], expect: 'either', refuseClass: ['tangent-edge'],
    closedForm: cf(-20 * planePlaneSpandrel(2, deg(178.9)), '-L r^2 (cot(a/2) - (pi-a)/2)'), noOpAllowed: false });
}
{
  const m = new Model();
  const a = m.extrude(m.sketch(XY(), (e) => e.rect([0, 0], [30, 20])), 6);
  const b = m.extrude(m.sketch(XY(5), (e) => e.rect([10, 5], [20, 15])), 3);
  m.union([a, b]);
  add({ id: 'hard-fillet-after-boolean-fragments-r1', group: 'hard', rank: 1, corpus: 'F14: fillet on the output of a planar union (wonky splits coplanar faces into fragments)', op: 'fillet', size: 1,
    model: m, select: [{ segment: { a: [10, 5, 6], b: [10, 5, 8] } }, { segment: { a: [20, 5, 6], b: [20, 5, 8] } }, { segment: { a: [20, 15, 6], b: [20, 15, 8] } }, { segment: { a: [10, 15, 6], b: [10, 15, 8] } }],
    convexity: ['convex'], expect: 'ok', blendTypes: ['cylinder'], closedForm: cf(-4 * 2 * A90(1), '-4 L r^2 (1-pi/4), L = 2') });
  add({ id: 'hard-boss-root-concave-mitres-r1', group: 'hard', rank: 4, corpus: 'call #13: concave root loop around a boss, convex third edges (cad-project-026 plate)', op: 'fillet', size: 1,
    model: m, select: [{ segment: { a: [10, 5, 6], b: [20, 5, 6] } }, { segment: { a: [20, 5, 6], b: [20, 15, 6] } }, { segment: { a: [20, 15, 6], b: [10, 15, 6] } }, { segment: { a: [10, 15, 6], b: [10, 5, 6] } }],
    convexity: ['concave'], expect: 'either', refuseClass: ['vertex-blend', 'mixed-convexity'] });
}
add({ id: 'hard-concave-rim-overflow-r6.5', group: 'hard', rank: 17, corpus: 'concave rim whose contact (rho 10.5) leaves the 10 mm disc', op: 'fillet', size: 6.5,
  model: steppedPost(10, 3, 4, 10), select: [{ near: [0, 4, 3] }], convexity: ['concave'], expect: 'either', refuseClass: ['overflow', 'face-consumed'] });
add({ id: 'hard-chamfer-exceeds-both-faces-d5', group: 'hard', rank: 2, corpus: 'chamfer wider than both 4 mm faces', op: 'chamfer', size: 5,
  model: box(4, 4, 20), select: [{ near: [4, 4, 10] }], convexity: ['convex'], expect: 'must-refuse', refuseClass: ['radius-too-large', 'face-consumed', 'overflow'] });
{
  // Short edge in a fillet loop (F2): 0.5 mm side between two convex corners.
  const pts = [[0, 0], [20, 0], [20, 9.5], [19.5, 10], [0, 10]];
  add({ id: 'hard-short-edge-in-loop-r1', group: 'hard', rank: 1, corpus: 'F2: loop fillet with a 0.7 mm edge shorter than 2r', op: 'fillet', size: 1,
    model: prism(pts, 6).m, select: [{ inPlane: { point: [0, 0, 6], normal: [0, 0, 1] } }], convexity: ['convex'], expect: 'either', refuseClass: ['blend-overlap', 'overflow', 'face-consumed', 'vertex-blend'] });
}
// cad-project-046 radius trials on a 3 mm notch: 6 -> 3 -> 1 (admission sweep, F16)
{
  const U = [[0, 0], [40, 0], [40, 20], [21.5, 20], [21.5, 15], [18.5, 15], [18.5, 20], [0, 20]];
  const sel = [{ near: [18.5, 15, 3] }, { near: [21.5, 15, 3] }];
  add({ id: 'corpus-notch-trial-r6', group: 'corpus', rank: 4, corpus: 'cad-project-046 _fillet_notches radius trial 1/3: ball larger than the notch', op: 'fillet', size: 6,
    model: prism(U, 6).m, select: sel, convexity: ['concave'], expect: 'must-refuse', refuseClass: ['radius-too-large', 'overflow', 'face-consumed', 'blend-overlap'] });
  add({ id: 'corpus-notch-trial-r3', group: 'corpus', rank: 4, corpus: 'cad-project-046 radius trial 2/3: ball diameter = 2 x notch width', op: 'fillet', size: 3,
    model: prism(U, 6).m, select: sel, convexity: ['concave'], expect: 'either', refuseClass: ['overflow', 'face-consumed', 'blend-overlap'] });
  add({ id: 'corpus-notch-trial-r1.5', group: 'corpus', rank: 4, corpus: 'cad-project-046 radius trial boundary: two fillets consume the 3 mm floor (full round)', op: 'fillet', size: 1.5,
    model: prism(U, 6).m, select: sel, convexity: ['concave'], expect: 'either', refuseClass: ['face-consumed'], closedForm: cf(2 * 6 * A90(1.5), '+2 L r^2 (1-pi/4)') });
  add({ id: 'corpus-notch-trial-r1', group: 'corpus', rank: 4, corpus: 'cad-project-046 radius trial that fits', op: 'fillet', size: 1,
    model: prism(U, 6).m, select: sel, convexity: ['concave'], expect: 'ok', blendTypes: ['cylinder'], closedForm: cf(2 * 6 * A90(1), '+2 L r^2 (1-pi/4)') });
}
// scale: comb with 12 teeth, all vertical edges (fs560 edge counts)
{
  const pts = [[0, 0], [48, 0], [48, 8]];
  for (let k = 11; k >= 0; k--) { const x = 4 * k; pts.push([x + 2, 8], [x + 2, 13], [x, 13], [x, 8]); }
  pts.splice(pts.length - 1, 1); // the last tooth ends at x = 0
  const { m, rp } = prism(pts, 6);
  const nConvex = rp.corners.filter((c) => c.theta > 0).length, nConcave = rp.corners.filter((c) => c.theta < 0).length;
  add({ id: 'perf-comb-vertical-edges-r0.5', group: 'corpus', rank: 1, corpus: 'scale: 50 vertical edges in one call (fs560 has up to 462)', op: 'fillet', size: 0.5,
    model: m, select: [{ parallel: [0, 0, 1] }], convexity: ['convex', 'concave'], expect: 'ok', blendTypes: ['cylinder'],
    closedForm: cf(6 * (nConcave - nConvex) * A90(0.5), `h (n_concave - n_convex) r^2 (1-pi/4), ${nConvex} convex, ${nConcave} concave`) });
}
{
  const holes = [];
  for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) holes.push([[8 + 10 * i, 8 + 10 * j], 2]);
  const tri = cornerChamfer2D([2, 5], [1, 0], [0, -1], 0.42, 0.42);
  add({ id: 'perf-hole-grid-rims-0.42', group: 'corpus', rank: 3, corpus: 'scale: 12 hole rims + outer loop deburred in one call (wasteboard)', op: 'chamfer', size: 0.42,
    model: holePlate(46, 36, 5, holes), select: [{ inPlane: { point: [0, 0, 5], normal: [0, 0, 1] } }], convexity: ['convex'], expect: 'ok', blendTypes: ['plane', 'cone'],
    closedForm: cf(-(12 * pappus(tri) + outlineChamferRemoved(164, 4, 0.42)), '12 Pappus + outline chamfer') });
}

// ---------------------------------------------------------------------------

// Closed forms re-evaluated on the job's geometry (closedform.mjs; docs/fillet-plan.md
// §8 step 0). The kernel's F32 sketch coordinates move the non-axis inputs by up
// to 1e-7 mm, so the design values are off by up to 1.5e-9 × V there; the
// others agree with their design value to rounding and cross-check it.
const JOB_FORMS = {
  edges: ['pp-box-vertical-edge-r2', 'pp-plate-4-vertical-edges-r4.2', 'pp-roundx-r3', 'pp-box-top-edge-r1', 'corpus-u-plate-vertical-edges-r4.2',
    'perf-comb-vertical-edges-r0.5', 'ch-box-vertical-edge-d1', 'pp-concave-270-r2', 'ch-concave-270-d1', 'pp-l-concave-and-convex-r2', 'pp-rib-root-concave-r2',
    'corpus-notch-trial-r1.5', 'corpus-notch-trial-r1', 'pp-concave-240-r2', 'pp-convex-150-r2', 'pp-ridge-150-horizontal-r2', 'pp-convex-120-hex-r2',
    'ch-convex-120-hex-d1', 'pp-concave-300-r1', 'pp-convex-60-r2', 'pp-convex-30-acute-r1', 'ch-convex-60-d1', 'hard-single-edge-r-equals-width-r10',
    'hard-single-edge-r9.999', 'hard-full-round-r5', 'hard-near-full-round-r4.99', 'hard-fillet-after-boolean-fragments-r1', 'hard-near-tangent-ridge-178.9-r2'],
  outline: ['pp-box-top-loop-r2', 'ch-plate-top-loop-0.42', 'ch-plate-both-loops-0.42', 'corpus-outline-chamfer-lines-arcs-0.42', 'corpus-r22-guide-outline-chamfer-0.42',
    'ch-post-rim-0.42', 'ch-slot-outline-0.42', 'perf-hole-grid-rims-0.42', 'pc-post-top-rim-r1', 'pc-post-top-rim-spindle-r3.5', 'pc-post-top-rim-r4.99',
    'pc-post-both-rims-r1', 'fl-slot-outline-r1'],
  notch: ['hard-overflow-convex-small-face-r2'],
};
const jobFormOf = (id) => Object.entries(JOB_FORMS).find(([, ids]) => ids.includes(id))?.[0] ?? null;

const GROUP_ORDER = { core: 0, corpus: 0, hard: 1 };
export function catalogue() {
  const cases = C.map((c, i) => ({ ...c, i }))
    .sort((a, b) => GROUP_ORDER[a.group] - GROUP_ORDER[b.group] || a.rank - b.rank || a.i - b.i)
    .map(({ i, model, ...c }) => ({
      id: c.id, group: c.group, rank: c.rank, corpus: c.corpus, op: c.op, size: c.size,
      chamferType: c.op === 'chamfer' ? 'equal-offsets' : 'none', tangentPropagation: c.tangentPropagation ?? true,
      expect: c.expect, refuseClass: c.refuseClass ?? null, convexity: c.convexity, blendTypes: c.blendTypes ?? null,
      select: c.select, closedForm: c.closedForm ? { ...c.closedForm, ...(jobFormOf(c.id) ? { job: { kind: jobFormOf(c.id) } } : {}) } : null, noOpAllowed: c.noOpAllowed ?? false,
      input: { language: 'FeatureScript', feature: 'filletInput', source: model.source() },
    }));
  const ids = new Set();
  for (const [kind, list] of Object.entries(JOB_FORMS)) for (const id of list) {
    if (!cases.find((c) => c.id === id)?.closedForm) throw new Error(`job form ${kind}: ${id} is not a case with a closed form`);
  }
  for (const c of cases) {
    if (ids.has(c.id)) throw new Error(`duplicate case id ${c.id}`);
    ids.add(c.id);
    if (!['ok', 'must-refuse', 'either'].includes(c.expect)) throw new Error(`${c.id}: bad expect`);
  }
  return cases;
}

export function loadCases() {
  return JSON.parse(fs.readFileSync(CASES_PATH, 'utf8')).cases;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const cases = catalogue();
  if (process.argv.includes('--write')) {
    fs.mkdirSync(path.dirname(CASES_PATH), { recursive: true });
    const doc = {
      schema: 'wonky-fillet-cases/1',
      conventions: {
        units: 'millimeter',
        size: 'fillet radius or equal-offset chamfer distance (Onshape EQUAL_OFFSETS: setback d along each support face, probe FP-a / FP15)',
        expect: 'ok | must-refuse | either (see scripts/fillet/cases.mjs header)',
        select: 'near: the edge within 1e-6 mm of the point; all; parallel: straight edges parallel to the axis; inPlane: edges lying in the plane; segment: edges lying on the segment',
        closedForm: 'deltaVolume = result volume - input volume (negative = material removed), from the design parameters; job: {kind} re-evaluates it on the job geometry (scripts/fillet/closedform.mjs), which grades the result',
        rank: 'edge-configuration rank in docs/fillet/corpus.md §4.1 (99 = not measured in the corpus)',
      },
      cases,
    };
    fs.writeFileSync(CASES_PATH, JSON.stringify(doc, null, 1) + '\n');
    console.log(`wrote ${path.relative(ROOT, CASES_PATH)}: ${cases.length} cases`);
  } else {
    for (const c of cases) console.log(`${c.id.padEnd(44)} ${c.group.padEnd(7)} ${String(c.rank).padStart(2)} ${c.op.padEnd(8)} ${String(c.size).padEnd(6)} ${c.expect.padEnd(12)} ${c.closedForm ? c.closedForm.deltaVolume.toFixed(6) : '-'}`);
    console.log(cases.length, 'cases');
  }
}
