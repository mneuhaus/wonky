import test from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missingBend();
if (publicTreeSkip) {
  test("fillet-production.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { default: fs } = await import("node:fs");
const { loadBend } = await import("../src/bend-loader.mjs");
const { filletResultBody, loadFilletProduction, loadFilletValidation } = await import("../src/fillet.mjs");
const { toStep } = await import("../src/exporters.mjs");
const { cylinderLinesOnly, loadStepPCurves, sphereFaceFrame } = await import("../src/step-pcurves.mjs");
const { UnsupportedFeatureError } = await import("../src/errors.mjs");
const { decodeResult, encodeJob } = await import("../scripts/fillet/brepfmt.mjs");
const { jobPath, resolveSelection } = await import("../scripts/fillet/fixtures.mjs");
const { prismBody } = await import("../scripts/fillet/run-adversarial.mjs");
const { encodeReal } = await import("../scripts/bakeoff/jobfmt.mjs");
// Production types and STEP export for the output of the production fillet
// (docs/fillet-plan.md §8 steps 1-2). The fillet (kernel/fillet, prototype A
// ported; test/fillet-port.test.mjs holds it to the prototype) runs on the Bend
// JS target on catalogue jobs and on two runner-built prisms; its result text is mapped onto
// kernel/analytic.bend by kernel/fillet/production.bend (src/fillet.mjs) and
// written by src/exporters.mjs. The expectations are checked independently in
// JS: the harness decoder (brepfmt.mjs) for the mapping, circle geometry for
// the sphere frames. No OpenCascade here: strict STEP validation of every
// built catalogue and adversarial result is the harness runs' job
// (scripts/fillet/run.mjs, run-adversarial.mjs).














const A = await loadBend(new URL('../kernel/fillet/main.bend', import.meta.url));
const native = await loadFilletProduction();
const kernel = await loadFilletValidation();
const stepNative = await loadStepPCurves();
const version = JSON.parse(fs.readFileSync(new URL('../bend.lock.json', import.meta.url), 'utf8')).version;
const catalogueResult = (id) => A.run(fs.readFileSync(jobPath(id), 'utf8'));
const prismResult = (id, input, select, size) => {
  const { body } = prismBody(input.polygon, input.height, input.origin, input.shear);
  return A.run(encodeJob({ id, op: 'fillet', size, chamferType: 'none', tangentPropagation: true, body, select: resolveSelection(body, select) }));
};
const step = (body) => toStep({ backend: { version }, bodies: [body] }, body.id);

// The harness decode, mapped by hand as the production types require: a
// negative cone angle is the reversed axis with a positive angle, a whole
// closed circle has no range.
function expectedBody(text) {
  const { body } = decodeResult(text);
  return {
    vertices: body.vertices,
    edges: body.edges.map((e) => {
      const whole = e.start === e.end && e.curve.type !== 'line' && Math.abs(e.curveRange[1] - e.curveRange[0] - 2 * Math.PI) < 1e-12;
      return { start: e.start, end: e.end, curve: e.curve, sameSense: e.sameSense, ...(whole ? {} : { curveRange: e.curveRange }) };
    }),
    faces: body.faces.map((f) => ({ surface: f.surface.type === 'cone' && f.surface.angle < 0 ? { ...f.surface, axis: f.surface.axis.map((x) => (x === 0 ? 0 : -x)), angle: -f.surface.angle } : f.surface,
      sameSense: f.sameSense, loops: f.loops, outer: f.outer })),
    roles: body.faces.map((f) => f.role),
  };
}

test('A\'s spheres, tori and cones map one to one onto the production types', () => {
  for (const id of ['pc-post-top-rim-spindle-r3.5', 'pc-post-top-rim-sphere-r5', 'ch-post-rim-0.42', 'pp-box-corner-3-r2', 'pc-hole-rim-r1']) {
    const text = catalogueResult(id);
    const out = filletResultBody(native, text, id, kernel);
    assert.equal(out.status, 'ok', id);
    const want = expectedBody(text), body = out.body;
    assert.deepEqual(body.vertices, want.vertices, id);
    assert.deepEqual(body.edges.map(({ start, end, curve, sameSense, curveRange }) => ({ start, end, curve, sameSense, ...(curveRange ? { curveRange } : {}) })), want.edges, id);
    assert.deepEqual(body.faces.map(({ surface, sameSense, loops, outer }) => ({ surface, sameSense, loops, outer })), want.faces, id);
    assert.deepEqual(body.fillet.faceRoles, want.roles, id);
    assert.equal(body.validation.closed, true, id);
    for (const f of body.faces) if (f.surface.type === 'cone') assert.ok(f.surface.angle > 0 && f.surface.angle < Math.PI / 2, `${id} cone angle ${f.surface.angle}`);
  }
  const spindle = filletResultBody(native, catalogueResult('pc-post-top-rim-spindle-r3.5'), 'spindle', kernel).body;
  const torus = spindle.faces.find((f) => f.surface.type === 'torus').surface;
  assert.ok(torus.minor > torus.major, 'the spindle rim is a spindle torus (tube-centre sheet)');
  assert.match(step(spindle), /DEGENERATE_TOROIDAL_SURFACE\('',#\d+,[0-9.E-]+,[0-9.E-]+,\.T\.\)/);
  assert.match(step(filletResultBody(native, catalogueResult('pp-box-corner-3-r2'), 'corner', kernel).body), /SPHERICAL_SURFACE/);
  const cone = step(filletResultBody(native, catalogueResult('ch-post-rim-0.42'), 'cone', kernel).body);
  for (const [, angle] of cone.matchAll(/CONICAL_SURFACE\('',#\d+,[0-9.E-]+,([0-9.E-]+)\)/g)) assert.ok(Number(angle) > 0, angle);
});

test('refusals pass through; approximate faces and malformed text are refused by name', () => {
  assert.deepEqual(filletResultBody(native, 'unresolved blend-overlap needs width 1.0e+0 (short by 1.000e-7)\nend\n', 'r', kernel),
    { status: 'unresolved', class: 'blend-overlap', reason: 'needs width 1.0e+0 (short by 1.000e-7)' });
  const text = catalogueResult('pp-box-top-edge-r1');
  const approximate = text.replace(/ blend 0 0 /, ` blend ${encodeReal(1e-9)} `);
  assert.notEqual(approximate, text);
  assert.throws(() => filletResultBody(native, approximate, 'approx', kernel), (e) => e instanceof UnsupportedFeatureError && /approximation tolerance/.test(e.message));
  assert.throws(() => filletResultBody(native, text.replace(/\nend\n$/, '\n'), 'cut', kernel), (e) => e instanceof UnsupportedFeatureError && /malformed/.test(e.message));
  assert.throws(() => filletResultBody(native, text.replace('brep', 'breps'), 'bad', kernel), (e) => e instanceof UnsupportedFeatureError && /malformed/.test(e.message));
});

// A pole of a sphere frame lies inside a boundary arc when it is on the arc's
// circle strictly between its ends (independent evaluation of the circle).
function poleInsideArc(pole, curve, range) {
  const d = pole.map((v, i) => v - curve.origin[i]);
  const n = curve.normal, x = curve.x, y = [n[1] * x[2] - n[2] * x[1], n[2] * x[0] - n[0] * x[2], n[0] * x[1] - n[1] * x[0]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  if (Math.abs(dot(d, n)) > 1e-9 || Math.abs(Math.hypot(...d) - curve.radius) > 1e-9) return false;
  if (!range) return true;
  let u = Math.atan2(dot(d, y), dot(d, x)) - range[0];
  u -= 2 * Math.PI * Math.floor(u / (2 * Math.PI));
  return u > 1e-9 && u < range[1] - range[0] - 1e-9;
}

test('sphere frames keep their poles off the boundary arcs (A\'s sheared-box corners)', () => {
  const text = prismResult('sheared', { polygon: [[0, 0], [20, 0], [20, 12], [0, 12]], height: 10, origin: [0, 0, 0], shear: [3, 2] }, [{ all: true }], 1);
  const { body } = filletResultBody(native, text, 'sheared', kernel);
  let reframed = 0;
  for (const face of body.faces.filter((f) => f.surface.type === 'sphere')) {
    const arcs = face.loops.flat().map((u) => body.edges[u.edge]).map((e) => ({ curve: e.curve, range: e.curveRange }));
    const frame = sphereFaceFrame(stepNative, face.surface, arcs);
    const axis = frame.kept ? face.surface.axis : frame.axis;
    const poles = [1, -1].map((s) => face.surface.origin.map((v, i) => v + s * face.surface.radius * axis[i]));
    for (const pole of poles) for (const arc of arcs) assert.equal(poleInsideArc(pole, arc.curve, arc.range), false, `pole ${pole} inside an arc`);
    if (!frame.kept) reframed++;
  }
  assert.ok(reframed >= 4, `${reframed} corner spheres take a writer frame`);
  assert.match(step(body), /2D sphere parameters/);
});

test('far from the origin a body bounded by cylinder parameter lines exports without the planner; ellipses still need it', () => {
  const far = prismResult('far', { polygon: [[0, 0], [20, 0], [20, 10], [0, 10]], height: 8, origin: [1e7, -1e7, 1e7] }, [{ near: [10000010, -10000000, 10000008] }], 1);
  const farBody = filletResultBody(native, far, 'far', kernel).body;
  assert.equal(cylinderLinesOnly(stepNative, farBody), true);
  const text = step(farBody);
  assert.doesNotMatch(text, /PCURVE/);
  assert.match(text, /CYLINDRICAL_SURFACE/);
  const mitres = filletResultBody(native, catalogueResult('pp-box-top-loop-r2'), 'mitres', kernel).body;
  assert.equal(cylinderLinesOnly(stepNative, mitres), false, 'mitre ellipses are not parameter lines');
  assert.match(step(mitres), /PCURVE/);
});

}
