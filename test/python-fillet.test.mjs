import test from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missingBend();
if (publicTreeSkip) {
  test("python-fillet.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { chmodSync, mkdtempSync, realpathSync, rmSync, writeFileSync } = await import("node:fs");
const { tmpdir } = await import("node:os");
const { join } = await import("node:path");
const { buildPython, PythonExecutionError } = await import("../src/python.mjs");
const { loadKernel } = await import("../src/kernel.mjs");
const { integrateVolume } = await import("../src/volume.mjs");
const { UnsupportedFeatureError } = await import("../src/errors.mjs");
// build123d fillet / chamfer of solid edges on the production fillet
// (python/_b3d_blend.py, src/fillet-python.mjs, kernel/fillet;
// docs/fillet-plan.md §8 step 4), Bend JS target. Volumes are checked against
// closed forms derived here through kernel/volume.bend's integration (the
// fillet computes no volume). Python runs through `uv run`, never a bare python3.










const workspace = realpathSync(mkdtempSync(join(tmpdir(), 'wonky-python-fillet-')));
const python = join(workspace, 'uv-python');
writeFileSync(python, '#!/bin/sh\nexec uv run --no-project --quiet python "$@"\n');
chmodSync(python, 0o755);
test.after(() => rmSync(workspace, { recursive: true, force: true }));
const kernel = await loadKernel();
const build = source => buildPython(`from build123d import *\n${source}`, { python, timeoutMs: 300000 });
const near = (got, want, what) => assert.ok(Math.abs(got - want) <= 1e-12 * want, `${what}: ${got} vs closed form ${want}`);
const PI = Math.PI, d = 0.42, r = 4.2;

test('P3: fillet(R4.2) of the vertical edges of a box is a Part with four quarter cylinders', async () => {
  const model = await build('result = fillet(Box(30, 18, 26).edges().filter_by(Axis.Z), 4.2)\nassert type(result).__name__ == "Part", type(result)');
  assert.equal(model.bodies.length, 1);
  const body = model.bodies[0];
  near(integrateVolume(kernel, body).volumeMm3, 30 * 18 * 26 - 4 * (r * r - PI * r * r / 4) * 26, 'P3');
  assert.equal(body.faces.filter(f => f.surface.type === 'cylinder').length, 4);
  assert.equal(body.fillet.claim, 'exact');
  assert.equal(body.fillet.order.length, 4);
});

test('P1: chamfer(0.42) of the top loop and of a bore rim (Box - Cylinder), and the Shape.chamfer method', async () => {
  const bore = await build('part = Box(30, 18, 10) - Cylinder(3.3, 12)\nresult = chamfer(part.edges().group_by(Axis.Z)[-1], 0.42)');
  near(integrateVolume(kernel, bore.bodies[0]).volumeMm3,
    30 * 18 * 10 - PI * 3.3 ** 2 * 10 - ((30 + 18) * d * d - 4 * d ** 3 / 3) - PI * (3.3 * d * d + d ** 3 / 3), 'bore');
  assert.deepEqual(bore.bodies[0].faces.map(f => f.surface.type).filter(t => t !== 'plane').sort(), ['cone', 'cylinder']);
  const method = await build('box = Solid.make_box(30, 18, 26)\nresult = box.chamfer(0.42, None, box.edges().group_by(Axis.Z)[-1])\nassert type(result).__name__ == "Solid", type(result)');
  near(integrateVolume(kernel, method.bodies[0]).volumeMm3, 30 * 18 * 26 - ((30 + 18) * d * d - 4 * d ** 3 / 3), 'box top loop');
});

// Rim fillet r on a convex outline: Pappus, the corner section A = r^2 (1 - pi/4)
// with its centroid xbar = r (5/6 - pi/4) / (1 - pi/4) inside the outline, swept
// along the lines and around the arcs at radius R - xbar. (The same formula gives
// fl-slot-one-line-propagate-r1's catalogue closed form, 15.024803441838.)
test('one selected line of a rounded top loop follows its tangent chain (OCCT semantics), recorded in the result', async () => {
  const model = await build('part = extrude(RectangleRounded(20, 12, 2.2), amount=8)\nline = part.edges().group_by(Axis.Z)[-1].filter_by(GeomType.LINE).sort_by(Axis.Y)[0]\nresult = fillet(line, 1)');
  const body = model.bodies[0];
  assert.equal(body.fillet.order.length, 8);
  assert.equal(body.fillet.notes.filter(n => n.startsWith('propagated ')).length, 7);
  const R = 2.2, A = 1 - PI / 4, xbar = (5 / 6 - PI / 4) / (1 - PI / 4);
  near(integrateVolume(kernel, body).volumeMm3, (240 - (4 - PI) * R * R) * 8 - A * (2 * (20 - 2 * R) + 2 * (12 - 2 * R) + 2 * PI * (R - xbar)), 'rounded rim');
});

test('FP12 analogue: tangent edges are refused as OCCT and Onshape refuse them, a ValueError the model catches', async () => {
  const model = await build([
    'part = extrude(RectangleRounded(20, 12, 2.2), amount=8)',
    'try:',
    '    fillet(part.edges().filter_by(Axis.Z), 1)',
    '    raise AssertionError("no error")',
    'except ValueError as error:',
    '    assert str(error).startswith("fillet failed: FILLET_FAIL_SMOOTH (tangent-edge: "), str(error)',
    'result = part'].join('\n'));
  assert.equal(model.bodies[0].fillet, undefined);
});

test('a capability refusal latches: except cannot turn it into a success', async () => {
  const source = [
    'part = extrude(Polygon((0, 0), (20, 0), (20, 4), (4, 4), (4, 16), (0, 16), align=None), amount=30)',
    'try:',
    '    part = fillet(part.edges(), 1)',
    'except Exception:',
    '    pass',
    'result = part'].join('\n');
  await assert.rejects(build(source), e => e instanceof UnsupportedFeatureError && /^fillet is not implemented for this input: mixed-convexity: /.test(e.message));
  await assert.rejects(build('result = chamfer(Box(2, 2, 2).edges(), 0.2, length2=0.3)'), e => e instanceof UnsupportedFeatureError && /asymmetric chamfer/.test(e.message));
  await assert.rejects(build('result = fillet(Box(2, 2, 2).edges(), -1)'), e => e instanceof PythonExecutionError && /radius must be positive/.test(e.message));
});

}
