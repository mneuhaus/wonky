import test from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missingBend();
if (publicTreeSkip) {
  test("python-khana.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { chmodSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } = await import("node:fs");
const { tmpdir } = await import("node:os");
const { join } = await import("node:path");
const { fileURLToPath } = await import("node:url");
const { buildPython, PythonExecutionError } = await import("../src/python.mjs");
const { UnsupportedFeatureError } = await import("../src/errors.mjs");
// wonky's cad_khana compatibility package (W5 "khana", decision 3): the
// modeling API builds named, colored Bend bodies; cad_khana's diagnostics and
// external packages fail as capabilities at their use site. Python runs
// through `uv run`, never a bare python3.









const workspace = realpathSync(mkdtempSync(join(tmpdir(), 'wonky-python-khana-')));
const python = join(workspace, 'uv-python');
writeFileSync(python, '#!/bin/sh\nexec uv run --no-project --quiet python "$@"\n');
chmodSync(python, 0o755);
test.after(() => rmSync(workspace, { recursive: true, force: true }));

const fixture = path => fileURLToPath(new URL(`../fixtures/corpus-repro/py-khana/${path}`, import.meta.url));
const runFixture = path => buildPython(readFileSync(fixture(path), 'utf8'), { filename: fixture(path), python });
const run = source => buildPython(source, { python });
const near = (a, b) => assert.ok(Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b)), `${a} != ${b}`);
const nearAll = (a, b) => a.forEach((value, i) => near(value, b[i]));
const byName = model => Object.fromEntries(model.bodies.map(body => [body.name, body]));
const lastJson = model => JSON.parse(model.execution.stdout.trim().split('\n').at(-1));
const capability = (pattern, line) => error => {
  assert.ok(error instanceof UnsupportedFeatureError, `${error.name}: ${error.message}`);
  assert.match(error.message, pattern);
  if (line !== undefined) assert.equal(error.line, line);
  return true;
};

test('a cad_khana assembly from a project module becomes named, colored and placed Bend bodies', async () => {
  const model = await runFixture('assembly/assembly.py');
  assert.equal(model.source.result, 'assembly');
  // cad_khana placed_parts order: own parts first, then sub-assembly leaves.
  assert.deepEqual(model.bodies.map(body => body.name), ['tray', 'hood', 'tray_slid_out', 'pin_left', 'pin_right']);
  assert.deepEqual(model.source.outputs.map(output => [output.kind, output.name]),
    model.bodies.map(body => ['assembly', body.name]));
  assert.equal(new Set(model.bodies.map(body => body.id)).size, 5);
  const parts = byName(model);
  assert.deepEqual(parts.tray.appearance, { red: 0.77, green: 0.65, blue: 0.49, alpha: 1 });
  assert.deepEqual(parts.tray_slid_out.appearance, { red: 0.77, green: 0.65, blue: 0.49, alpha: 0.5 });
  assert.deepEqual(parts.pin_left.appearance, { red: 0.8, green: 0.44, blue: 0.13, alpha: 1 });
  near(parts.tray.validation.volumeMm3, 40 * 30 * 3);
  near(parts.hood.validation.volumeMm3, 40 * 30 * 20 - 36 * 26 * 17);
  near(parts.pin_right.validation.volumeMm3, Math.PI * 1.5 ** 2 * 8);
  nearAll(parts.hood.validation.boundsMm.min, [-20, -15, 40]);
  nearAll(parts.tray_slid_out.validation.boundsMm.max, [20, 40, 3]);
  // Sub-assembly placement Pos(0, 0, 3) composes with each pin's own Pos(±15, 0, 0).
  nearAll(parts.pin_left.validation.boundsMm.min, [-16.5, -1.5, 3]);
  nearAll(parts.pin_right.validation.boundsMm.max, [16.5, 1.5, 11]);
  const module = model.source.modules.find(entry => entry.module === 'parts');
  assert.equal(module.path, fixture('assembly/parts.py'));
});

test('the same shape placed twice at the same spot yields two distinct named bodies', async () => {
  const model = await run(`
from build123d import Box
from cad_khana.mechanism.assembly import Assembly
cube = Box(4, 4, 4)
assembly = Assembly().with_part("a", cube).with_part("b", cube, color=(0, 0, 1))
`);
  assert.deepEqual(model.bodies.map(body => body.name), ['a', 'b']);
  assert.notEqual(model.bodies[0].id, model.bodies[1].id);
  assert.deepEqual(model.bodies[0].validation.boundsMm, model.bodies[1].validation.boundsMm);
  assert.equal(model.bodies[0].appearance, undefined);
  assert.deepEqual(model.bodies[1].appearance, { red: 0, green: 0, blue: 1, alpha: 1 });
});

test('the Assembly builder keeps cad_khana semantics: immutable, ordered, overridable', async () => {
  const model = await run(`
import json
from dataclasses import FrozenInstanceError
from build123d import Axis, Box, Pos
from cad_khana.mechanism.assembly import Assembly, DetailOverride, PlacedPart, RevoluteJoint
from cad_khana.mechanism.diagnostics import SCHEMA_VERSION
from cad_khana.printability.methods import FDM
from cad_khana import draw, viewer, environment

cube = Box(10, 10, 10)
empty = Assembly()
one = empty.with_part("a", cube)
assert empty.parts == () and len(one.parts) == 1 and one.parts[0].part is cube
assert one.parts[0].color is None and one.parts[0].material is None
two = one.with_part("b", cube, location=Pos(0, 0, 20), material="plastic_matte")
assert [p.name for p in two.parts] == ["a", "b"]
checked = two.assert_no_interference("a", "b", name="first").assert_clearance("a", "b", min_mm=0.2)
checked = checked.assert_interference("a", "b", reason="press fit")
assert [a.name for a in checked.assertions] == ["first", "clearance:a/b>=0.2", "interference:a/b"]
assert two.assertions == () and not hasattr(Assembly(), "assert_min_wall")
try:
    two.parts[0].name = "x"
    raise AssertionError("PlacedPart must be frozen")
except FrozenInstanceError:
    pass
materials = two.with_materials({"a": "aluminium"})
assert [p.material for p in materials.parts] == ["aluminium", "plastic_matte"]
swapped = two.with_detailed_geometry({"b": DetailOverride(part=Box(2, 2, 2), material="steel"),
                                      "c": DetailOverride(part=Box(1, 1, 1), location=Pos(50, 0, 0))})
assert [p.name for p in swapped.parts] == ["a", "b", "c"] and swapped.parts[1].material == "steel"
try:
    two.with_detailed_geometry({"new": Box(1, 1, 1)})
    raise AssertionError("an addition needs a location")
except ValueError:
    pass
joint = RevoluteJoint(axis=Axis.Z)
parent = Assembly().with_subassembly("arm", two, location=Pos(100, 0, 0), joint=joint)
parent = parent.with_joint_angle("arm", 0).with_joint("arm", joint.with_angle(0))
try:
    Assembly().with_joint_angle("missing", 10)
    raise AssertionError("unknown joint path")
except KeyError:
    pass
assert [p.name for p in parent.placed_parts] == ["a", "b"] and parent.placed_parts[1].part is cube
assert FDM() == FDM(up_axis=(0, 0, 1), wall_min_mm=1.5, overhang_max_deg=45.0) and SCHEMA_VERSION == "0.2"
assert not viewer.auto_enabled() and not draw.auto_enabled()
print(json.dumps(parent._wonky_metadata()["parts"]))
assembly = parent
`);
  assert.deepEqual(lastJson(model), [
    { name: 'a', path: ['arm', 'a'], material: null },
    { name: 'b', path: ['arm', 'b'], material: 'plastic_matte' },
  ]);
  // Zero joint angle is the exact identity; the sub-assembly Pos(100, 0, 0) applies.
  const parts = byName(model);
  nearAll(parts.a.validation.boundsMm.min, [95, -5, -5]);
  nearAll(parts.b.validation.boundsMm.min, [95, -5, 15]);
});

test('a joint at a nonzero angle turns the sub-assembly about its axis line, as cad_khana does', async () => {
  // cad_khana RevoluteJoint.transform = T(p) * R(d, angle) * T(-p), composed
  // before the sub-assembly placement. Expected bounds: build123d 0.13.0
  // (Location((5, 0, 0)) * Location((0, 0, 0), (0, 0, 1), 90) * Location((5, 0, 0)).inverse()
  // * Pos(0, 0, 20) * Box(10, 2, 2), bounding box and volume).
  const model = await run(`
from build123d import Axis, Box, Pos
from cad_khana.mechanism.assembly import Assembly, RevoluteJoint
arm = Assembly().with_part("link", Box(10, 2, 2))
parent = Assembly().with_subassembly("arm", arm, location=Pos(0, 0, 20),
                                     joint=RevoluteJoint(axis=Axis((5, 0, 0), (0, 0, 1))))
assert repr(parent.subassemblies[0].joint.with_angle(90).transform) == "Location((5, -5, 0), (0, 0, 90))"
assembly = parent.with_joint_angle("arm", 90)
`);
  const [link] = model.bodies;
  assert.equal(link.name, 'link');
  near(link.validation.volumeMm3, 40);
  nearAll(link.validation.boundsMm.min, [4, -10, 19]);
  nearAll(link.validation.boundsMm.max, [6, 0, 21]);
});

test('cad_khana diagnostics are capability errors at their call, even when caught', async () => {
  const cases = [
    ['from cad_khana.mechanism.check import check', 'check(Assembly().with_part("a", cube), out="outputs")', /cad_khana\.mechanism\.check\.check\(\)/],
    ['from cad_khana.printability.inspect import inspect', 'inspect(cube, method=FDM(), out="outputs", name="cube")', /cad_khana\.printability\.inspect\.inspect\(\)/],
    ['from cad_khana.viewer import push', 'push(Assembly().with_part("a", cube))', /cad_khana\.viewer\.push\(\).*wonky-view/],
    ['from cad_khana.draw import draw', 'draw(Assembly(), "views")', /cad_khana\.draw\.draw\(\)/],
    ['from cad_khana.export import export_assembly', 'export_assembly(Assembly(), "out")', /cad_khana\.export\.export_assembly\(\)/],
    ['from cad_khana.printability.orientation import suggest_orientation', 'suggest_orientation(cube, name="c")', /suggest_orientation\(\)/],
    ['from cad_khana.printability.overhangs import detect_overhang', 'detect_overhang(cube)', /detect_overhang\(\)/],
    ['from cad_khana.mechanism.diagnostics import Diagnostics', 'Diagnostics()', /cad_khana\.mechanism\.diagnostics\.Diagnostics\(\)/],
    ['from cad_khana.mechanism.assertions import NoInterference', 'NoInterference("a", "b", "n").evaluate({})', /NoInterference\.evaluate\(\)/],
  ];
  for (const [statement, call, pattern] of cases) {
    await assert.rejects(run(`
from build123d import Box
from cad_khana.mechanism.assembly import Assembly
from cad_khana.printability.methods import FDM
${statement}
cube = Box(1, 1, 1)
try:
    ${call}
except BaseException:
    pass
result = cube
`), capability(pattern, 8), call);
  }
});

test('names outside the provided cad_khana API fail as capabilities, submodules import', async () => {
  await assert.rejects(run('import cad_khana.core.build\n'), capability(/cad_khana\.core\.build/, 1));
  await assert.rejects(run('from cad_khana.mechanism.assembly import Scene\n'),
    capability(/cad_khana\.mechanism\.assembly\.Scene is not part of the cad_khana API/, 1));
  await assert.rejects(run('import cad_khana\nx = cad_khana.build\n'), capability(/cad_khana\.build/, 2));
});

test('parts must be Bend shapes and colors must be build123d-like colors', async () => {
  await assert.rejects(run(`
from cad_khana.mechanism.assembly import Assembly
assembly = Assembly().with_part("sketch", "not a shape")
`), capability(/cad_khana part 'sketch': the part is a str, not a Bend-built build123d Shape/, 3));
  await assert.rejects(run(`
from build123d import Box
from cad_khana.mechanism.assembly import Assembly
assembly = Assembly().with_part("a", Box(1, 1, 1), color="red")
`), error => error instanceof PythonExecutionError && /TypeError: cad_khana part 'a': color must be/.test(error.message)
    && error.line === 4);
  // build123d 0.13 Color iterates as (r, g, b, a); older releases expose to_tuple().
  const model = await run(`
from build123d import Box, Pos
from cad_khana.mechanism.assembly import Assembly
class Iterated:
    def __iter__(self):
        return iter((0.25, 0.5, 0.75, 1.0))
class Tupled:
    def to_tuple(self):
        return (1.0, 0.0, 0.0, 0.25)
assembly = Assembly().with_part("i", Box(1, 1, 1), color=Iterated()).with_part(
    "t", Box(1, 1, 1), location=Pos(5, 0, 0), color=Tupled())
`);
  assert.deepEqual(model.bodies.map(body => body.appearance), [
    { red: 0.25, green: 0.5, blue: 0.75, alpha: 1 }, { red: 1, green: 0, blue: 0, alpha: 0.25 }]);
});

test('show() of a cad_khana assembly records its named parts', async () => {
  const model = await run(`
from build123d import Box, Pos
from ocp_vscode import show
from cad_khana.mechanism.assembly import Assembly
frame = Assembly().with_part("left", Box(2, 2, 2)).with_part("right", Box(2, 2, 2), location=Pos(10, 0, 0))
show(frame, names=["frame"])
`);
  assert.equal(model.source.result, 'capture');
  assert.deepEqual(model.bodies.map(body => body.name), ['frame/left', 'frame/right']);
});

test('corpus repros: check() in the main block, a caught inspect() and bd_warehouse fail at their lines', async () => {
  await assert.rejects(runFixture('check-in-main/assembly.py'), capability(/check\(\) is a cad_khana diagnostic/, 18));
  await assert.rejects(runFixture('diagnostic-caught/part.py'), capability(/inspect\(\) is a cad_khana diagnostic/, 10));
  await assert.rejects(runFixture('external-package/part.py'), capability(/'bd_warehouse' is not available.*wonky does not provide bd_warehouse: its threads/, 4));
});

}
