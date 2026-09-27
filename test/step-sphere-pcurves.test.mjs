import test from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missingBend();
if (publicTreeSkip) {
  test("step-sphere-pcurves.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { build } = await import("../src/index.mjs");
const { toStep } = await import("../src/exporters.mjs");
const { loadStepPCurves, sphereFrame, sphereFrameKept, sphereNeedsPCurve, sphereCirclePCurve } = await import("../src/step-pcurves.mjs");






// STEP sphere faces (kernel/step-pcurves.bend, "Sphere faces"; fix round 1 of
// the R20 gate, KS06): a sphere face bounded by circles of two families (a
// groove along x and the top plane) has no frame in which every circle is a
// latitude or a meridian, and a reader that builds the missing parameter curve
// itself approximates it (OpenCascade: 1.7e-5 mm, against 1e-7 mm edge
// tolerances, so its exact CurveOnSurface check failed). The writer takes a
// canonical frame from one family and writes a Bend parameter curve for the
// other.

const header = 'FeatureScript 3044;\nimport(path : "onshape/std/geometry.fs", version : "3044.0");\n';
// KS06's detent in miniature: a 20 x 8 x 6 block, a r 0.55 groove along x at
// y 4, z 5.85, and a r 0.9 sphere at (10, 4, 5.85) subtracted.
const source = `${header}export function part(context is Context, id is Id, definition is map)
{
    fCuboid(context, id + "block", { "corner1" : vector(0, 0, 0) * millimeter, "corner2" : vector(20, 8, 6) * millimeter });
    var g = newSketchOnPlane(context, id + "g", { "sketchPlane" : plane(vector(0, 4, 5.85) * millimeter, vector(1, 0, 0)) });
    skCircle(g, "c", { "center" : vector(0, 0) * millimeter, "radius" : 0.55 * millimeter });
    skSolve(g);
    opExtrude(context, id + "groove", { "entities" : qSketchRegion(id + "g"), "direction" : vector(1, 0, 0),
        "endBound" : BoundingType.BLIND, "endDepth" : 20 * millimeter });
    opBoolean(context, id + "cut1", { "targets" : qCreatedBy(id + "block", EntityType.BODY), "tools" : qCreatedBy(id + "groove", EntityType.BODY),
        "operationType" : BooleanOperationType.SUBTRACTION });
    var s = newSketchOnPlane(context, id + "s", { "sketchPlane" : plane(vector(10, 4, 5.85) * millimeter, vector(0, -1, 0), vector(1, 0, 0)) });
    skArc(s, "a", { "start" : vector(-0.9, 0) * millimeter, "mid" : vector(0, 0.9) * millimeter, "end" : vector(0.9, 0) * millimeter });
    skLineSegment(s, "l", { "start" : vector(0.9, 0) * millimeter, "end" : vector(-0.9, 0) * millimeter });
    skSolve(s);
    opRevolve(context, id + "ball", { "entities" : qSketchRegion(id + "s", false), "axis" : line(vector(10, 4, 5.85) * millimeter, vector(1, 0, 0)),
        "angleForward" : 360 * degree });
    opBoolean(context, id + "cut2", { "targets" : qCreatedBy(id + "block", EntityType.BODY), "tools" : qCreatedBy(id + "ball", EntityType.BODY),
        "operationType" : BooleanOperationType.SUBTRACTION });
}`;

const model = await build(source, { feature: 'part' });
const native = await loadStepPCurves();
const body = model.bodies[0];
const sphereFaces = body.faces.map((face, i) => [face, i]).filter(([face]) => face.surface.type === 'sphere');

test('a sphere face bounded by two circle families gets a canonical frame and a Bend parameter curve for the other family', () => {
  assert.equal(model.bodies.length, 1);
  assert.equal(sphereFaces.length, 1, 'one sphere face');
  const [face] = sphereFaces[0];
  const curves = face.loops.flat().map(use => body.edges[use.edge].curve);
  assert.equal(sphereFrameKept(native, face.surface, curves), false, 'no frame of the face fits both families');
  const frame = sphereFrame(native, face.surface, curves);
  // The axis of one family, exactly (a recovered sphere's own frame wobbles
  // by 1e-15).
  assert.ok([[1, 0, 0], [0, 0, 1], [-1, 0, 0], [0, 0, -1]].some(a => a.every((v, k) => v === frame.axis[k])), `axis ${frame.axis}`);
  const needs = face.loops.flat().filter(use => sphereNeedsPCurve(native, frame, body.edges[use.edge].curve));
  assert.equal(needs.length, 2, 'the other family needs parameter curves');
  for (const use of needs) {
    const edge = body.edges[use.edge], c = edge.curve;
    const [first, last] = edge.curveRange ?? [0, 2 * Math.PI];
    const p = sphereCirclePCurve(native, frame, c, first, last);
    assert.equal(p.status, 'Resolved', p.reason);
    assert.ok(p.totalBoundMm <= 1e-8, `stated ${p.totalBoundMm}`);
    // Independent check: the cubic B-spline (Bezier spans, knots of
    // multiplicity 3) on the sphere against the circle, 64 points per span.
    const y = [frame.axis[1] * frame.x[2] - frame.axis[2] * frame.x[1], frame.axis[2] * frame.x[0] - frame.axis[0] * frame.x[2], frame.axis[0] * frame.x[1] - frame.axis[1] * frame.x[0]];
    const cy = [c.normal[1] * c.x[2] - c.normal[2] * c.x[1], c.normal[2] * c.x[0] - c.normal[0] * c.x[2], c.normal[0] * c.x[1] - c.normal[1] * c.x[0]];
    let worst = 0;
    const spans = (p.points.length - 1) / 3;
    for (let i = 0; i < spans; i++) {
      const [p0, p1, p2, p3] = p.points.slice(3 * i, 3 * i + 4), t0 = p.knots[i], t1 = p.knots[i + 1];
      for (let k = 0; k <= 64; k++) {
        const s = k / 64, w = 1 - s, b = [w * w * w, 3 * w * w * s, 3 * w * s * s, s * s * s];
        const u = b[0] * p0[0] + b[1] * p1[0] + b[2] * p2[0] + b[3] * p3[0], v = b[0] * p0[1] + b[1] * p1[1] + b[2] * p2[1] + b[3] * p3[1];
        const q = [0, 1, 2].map(j => frame.origin[j] + frame.radius * (Math.cos(v) * (Math.cos(u) * frame.x[j] + Math.sin(u) * y[j]) + Math.sin(v) * frame.axis[j]));
        const t = t0 + (t1 - t0) * s;
        const r = [0, 1, 2].map(j => c.origin[j] + c.radius * (Math.cos(t) * c.x[j] + Math.sin(t) * cy[j]));
        worst = Math.max(worst, Math.hypot(q[0] - r[0], q[1] - r[1], q[2] - r[2]));
      }
    }
    assert.ok(worst <= 1e-8, `independent sampled distance ${worst}`);
  }
});

test('STEP writes the parameter curves with the circle range in [0, 2 pi)', () => {
  const text = toStep(model, 'detent');
  assert.match(text, /REPRESENTATION_CONTEXT\('','2D sphere parameters'\)/);
  const pcurves = [...text.matchAll(/B_SPLINE_CURVE_WITH_KNOTS\('Bend UV approximation, sampled <= ([0-9.E-]+) mm'/g)];
  assert.equal(pcurves.length, 2);
  for (const [, bound] of pcurves) assert.ok(Number(bound) <= 1e-8);
  // The 3D trims of those edges share the curves' range, inside [0, 2 pi].
  const lines = new Map(text.split('\n').map(l => l.match(/^(#\d+)=(.*);$/)).filter(Boolean).map(m => [m[1], m[2]]));
  const surfaceCurves = [...lines.values()].filter(e => e.startsWith("SURFACE_CURVE('',"));
  assert.equal(surfaceCurves.length, 2);
  for (const e of surfaceCurves) {
    const trimmed = lines.get(e.match(/^SURFACE_CURVE\('',(#\d+)/)[1]);
    const [, a, b] = trimmed.match(/PARAMETER_VALUE\(([^)]*)\)\),\(PARAMETER_VALUE\(([^)]*)\)/);
    assert.ok(Number(a) >= 0 && Number(a) < 2 * Math.PI && Number(b) > Number(a), trimmed);
  }
});

test('a whole sphere keeps its own frame and needs no parameter curve', async () => {
  const ball = await build(`${header}export function part(context is Context, id is Id, definition is map)
{
    var s = newSketchOnPlane(context, id + "s", { "sketchPlane" : plane(vector(0, 0, 0) * millimeter, vector(0, -1, 0), vector(1, 0, 0)) });
    skArc(s, "a", { "start" : vector(-2, 0) * millimeter, "mid" : vector(0, 2) * millimeter, "end" : vector(2, 0) * millimeter });
    skLineSegment(s, "l", { "start" : vector(2, 0) * millimeter, "end" : vector(-2, 0) * millimeter });
    skSolve(s);
    opRevolve(context, id + "ball", { "entities" : qSketchRegion(id + "s", false), "axis" : line(vector(0, 0, 0) * millimeter, vector(1, 0, 0)),
        "angleForward" : 360 * degree });
}`, { feature: 'part' });
  const face = ball.bodies[0].faces.find(f => f.surface.type === 'sphere');
  assert.equal(sphereFrameKept(native, face.surface, face.loops.flat().map(use => ball.bodies[0].edges[use.edge].curve)), true);
  assert.doesNotMatch(toStep(ball, 'ball'), /2D sphere parameters/);
});

}
