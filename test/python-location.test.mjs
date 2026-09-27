import test from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missingBend();
if (publicTreeSkip) {
  test("python-location.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { chmodSync, mkdtempSync, realpathSync, rmSync, writeFileSync } = await import("node:fs");
const { tmpdir } = await import("node:os");
const { join } = await import("node:path");
const { buildPython } = await import("../src/python.mjs");
const { UnsupportedFeatureError } = await import("../src/errors.mjs");
// build123d 0.13 Location, Rotation/Rot, Pos, Plane, Axis and Vector in the
// shim (python/_b3d_location.py), and shapes placed by them. Expected values
// were produced by build123d 0.13.0 itself (`uv run --no-project --with
// build123d==0.13.0 python -B tmp/w5b/b-location/oracle.py`, 2026-09-23) and
// frozen here. Printed text and keys must match exactly; raw floats within
// 1e-12, because OCCT's arm64 build fuses multiply-adds (FMA contraction), so
// build123d's own last bits depend on the platform.
// Python runs through `uv run`, never a bare python3.








const workspace = realpathSync(mkdtempSync(join(tmpdir(), 'wonky-python-location-')));
const python = join(workspace, 'uv-python');
writeFileSync(python, '#!/bin/sh\nexec uv run --no-project --quiet python "$@"\n');
chmodSync(python, 0o755);
test.after(() => rmSync(workspace, { recursive: true, force: true }));
const build = source => buildPython(source, { python, timeoutMs: 120000 });
const near = (a, b, tolerance = 1e-9) => assert.ok(Math.abs(a - b) <= tolerance * Math.max(1, Math.abs(b)), `${a} != ${b}`);
const nearAll = (a, b, tolerance) => { assert.equal(a.length, b.length); a.forEach((value, i) => near(value, b[i], tolerance)); };

// Python helpers shared by the models: close() compares nested floats within 1e-12.
const prelude = `from build123d import *
def close(a, b, tol=1e-12):
    if isinstance(a, (list, tuple)):
        return len(a) == len(b) and all(close(x, y, tol) for x, y in zip(a, b))
    return abs(a - b) <= tol * max(1.0, abs(b))
def cols(loc):
    return [tuple((loc * Pos(*e)).position - loc.position) for e in ((1, 0, 0), (0, 1, 0), (0, 0, 1))]
def texts(loc):
    return [repr(loc), str(loc), f"{loc:.2f}", type(loc).__name__]
`;

test('Rot, Location and Pos compose, compare, hash and print like build123d 0.13', async () => {
  const model = await build(`${prelude}
r = Rot(10, 20, 30)
# Rot(10, 20, 30) rows (build123d: loc.wrapped.Transformation().Value(i, j)), read back as columns.
rows = [[0.8137976813493737, -0.46984631039295416, 0.34202014332566866],
        [0.5438381424823255, 0.823172944645501, -0.16317591116653485],
        [-0.20487412870286212, 0.3187957775971679, 0.9254165783983234]]
assert close(cols(r), [tuple(row[i] for row in rows) for i in range(3)]), cols(r)
assert r == Rot(10, 0, 0) * Rot(0, 20, 0) * Rot(0, 0, 30)
assert r != Rot(0, 0, 30) * Rot(0, 20, 0) * Rot(10, 0, 0)
assert Location((1, 2, 3), (10, 20, 30)) == Pos(1, 2, 3) * Rot(10, 20, 30)
assert Location((1, 2, 3), (10, 20, 30)) != Rot(10, 20, 30) * Pos(1, 2, 3)
assert r._key() == ((0.0, 0.0, 0.0), (0.12768, 0.14488, 0.26854, 0.94371))
assert hash(r) == hash(Rot(10, 0, 0) * Rot(0, 20, 0) * Rot(0, 0, 30)) and len({Rot(0, 0, 0), Location()}) == 1
assert Rot(360, 0, 0) == Rot(0, 0, 0) and Rot(360, 0, 0)._key() == ((0.0, 0.0, 0.0), (-0.0, 0.0, -0.0, 1.0))
got = {
    "rot": texts(r),
    "rot90": texts(Rot(90, 0, 0)),
    "pos_rot": texts(Pos(1, 2, 3) * Rot(0, 0, 90)),
    "axis_angle": texts(Location((0, 0, 18.5), (1, 1, 1), -120)),
    "rot_pos": texts(Rot(0, 0, 90) * Pos(1, 0, 0)),
    "gimbal": [repr(Rot(*a)) for a in [(0, 90, 0), (0, -90, 0), (180, 0, 0), (90, 90, 90), (0, 0, 180), (-45, 30, 200)]],
    "inverse": repr(Location((1, 2, 3), (10, 20, 30)).inverse()),
    "pow": [repr(Location((1, 2, 3), (10, 20, 30)) ** n) for n in (2, -2, 0)],
    "forms": [repr(Location((1, 2, 3), 45)), repr(Location()), repr(Location(Rot(1, 2, 3))), repr(Location((1, 2))),
              repr(Location(Plane.XZ)), repr(Location(Plane.XZ, (1, 2, 3))),
              repr(Location(position=(1, 2, 3), orientation=(0, 0, 90)))],
    "rotations": [repr(Rot(Axis((1, 0, 0), (0, 0, 1)), 90)), repr(Rot(Axis((1, 0, 0), (0, 0, 1)), 0)),
                  repr(Rot((10, 20, 30))), repr(Rot((10, 20))), repr(Rot(X=10)), repr(Rot(10)), repr(Rot(Rot(10, 0, 0)))],
    "types": [type(Rot(1, 0, 0) * Rot(0, 1, 0)).__name__, type(Pos(1, 0, 0) * Pos(0, 1, 0)).__name__,
              isinstance(Pos(1, 0, 0) * Pos(0, 1, 0), Pos), type(Pos(1, 0, 0) * Rot(0, 1, 0)).__name__, Rot is Rotation],
    "lists": [repr(x) for x in Rot(0, 0, 90) * [Pos(1, 0, 0), Pos(0, 1, 0)]],
    "parts": [repr(Location((1, 2, 3), (10, 20, 30)).position), repr(Location((1, 2, 3), (10, 20, 30)).orientation),
              repr(Pos(1, 2, 3).center()), repr(Rot(0, 0, 90).x_axis), repr(Location((1, 2, 3), (90, 0, 0)).z_axis)],
    "pos_args": [repr(Pos(1, X=5)), repr(Pos((1, 2))), repr(Pos(Vector(1, 2, 3))), repr(Pos(1, 2, 3, 4))],
    "eq_other": [Location() == (0, 0, 0)],
}
loc = Location((1, 2, 3), (10, 20, 30))
loc.position = (4, 5, 6)
got["set_position"] = repr(loc)
loc.orientation = (0, 0, 45)
got["set_orientation"] = repr(loc)
got["copy"] = repr(__import__("copy").copy(Rot(1, 2, 3)))
expected = {
    "rot": ["Rotation((0, 0, 0), (10, 20, 30))", "Rotation: (position=(0, 0, 0), orientation=(10, 20, 30))",
            "((0.00, 0.00, 0.00), (10.00, 20.00, 30.00))", "Rotation"],
    "rot90": ["Rotation((0, 0, 0), (90, 0, 0))", "Rotation: (position=(0, 0, 0), orientation=(90, 0, 0))",
              "((0.00, 0.00, 0.00), (90.00, 0.00, 0.00))", "Rotation"],
    "pos_rot": ["Location((1, 2, 3), (0, 0, 90))", "Location: (position=(1, 2, 3), orientation=(0, 0, 90))",
                "((1.00, 2.00, 3.00), (0.00, 0.00, 90.00))", "Location"],
    "axis_angle": ["Location((0, 0, 18.5), (-90, 0, -90))", "Location: (position=(0, 0, 18.5), orientation=(-90, 0, -90))",
                   "((0.00, 0.00, 18.50), (-90.00, 0.00, -90.00))", "Location"],
    "rot_pos": ["Location((0, 1, 0), (0, 0, 90))", "Location: (position=(0, 1, 0), orientation=(0, 0, 90))",
                "((0.00, 1.00, 0.00), (0.00, 0.00, 90.00))", "Location"],
    "gimbal": ["Rotation((0, 0, 0), (0, 90, 0))", "Rotation((0, 0, 0), (0, -90, 0))", "Rotation((0, 0, 0), (180, 0, 0))",
               "Rotation((0, 0, 0), (0, 90, 180))", "Rotation((0, 0, 0), (0, 0, 180))", "Rotation((0, 0, 0), (-45, 30, -160))"],
    "inverse": "Location((-1.28685, -2.13289, -2.79192), (-19.0083, -11.8221, -33.7537))",
    "pow": ["Location((1.90017, 3.70066, 6.20897), (7.70323, 42.184, 62.9764))",
            "Location((-2.92204, -4.17405, -5.4677), (-41.6765, -10.5414, -69.9735))",
            "Location((0, 0, 0), (0, 0, 0))"],
    "forms": ["Location((1, 2, 3), (0, 0, 45))", "Location((0, 0, 0), (0, 0, 0))", "Location((0, 0, 0), (1, 2, 3))",
              "Location((1, 2, 0), (0, 0, 0))", "Location((0, 0, 0), (90, 0, 0))", "Location((0, 0, 0), (90, 0, 0))",
              "Location((1, 2, 3), (0, 0, 90))"],
    "rotations": ["Rotation((1, -1, 0), (0, 0, 90))", "Rotation((0, 0, 0), (0, 0, 0))", "Rotation((0, 0, 0), (10, 20, 30))",
                  "Rotation((0, 0, 0), (10, 20, 0))", "Rotation((0, 0, 0), (10, 0, 0))", "Rotation((0, 0, 0), (10, 0, 0))",
                  "Rotation((0, 0, 0), (10, 0, 0))"],
    "types": ["Location", "Location", False, "Location", True],
    "lists": ["Location((0, 1, 0), (0, 0, 90))", "Location((-1, 0, 0), (0, 0, 90))"],
    "parts": ["Vector(1, 2, 3)", "Vector(10, 20, 30)", "Vector(1, 2, 3)", "Axis((0, 0, 0), (0, 1, 0))",
              "Axis((1, 2, 3), (0, -1, 0))"],
    "pos_args": ["Pos((5, 0, 0), (0, 0, 0))", "Pos((1, 2, 0), (0, 0, 0))", "Pos((1, 2, 3), (0, 0, 0))",
                 "Pos((1, 2, 3), (0, 0, 0))"],
    "eq_other": [False],
    "set_position": "Location((4, 5, 6), (10, 20, 30))",
    "set_orientation": "Location((4, 5, 6), (0, 0, 45))",
    "copy": "Location((0, 0, 0), (1, 2, 3))",
}
for key in expected:
    assert got[key] == expected[key], (key, got[key])
# Unformatted text prints the raw floats (last bits platform dependent, see the file header).
number = lambda text: [float(v) for v in text.replace("(", " ").replace(")", " ").replace(",", " ").split()]
assert close(number(format(r)), [0.0, 0.0, 0.0, 10.0, 19.999999999999996, 29.999999999999996])
assert close(number(format(Location((1, 2, 3), (10, 20, 30)).inverse())),
             [-1.2868515802054383, -2.1328869116895515, -2.791918056187569, -19.008263264952667, -11.822130763866335, -33.75369500293538])
assert format(Location(Plane.XZ)) == "((-0.0, -0.0, 0.0), (90.0, 0.0, -0.0))"
for bad, error, message in [(lambda: Location("x"), TypeError, "Expected floats"),
                            (lambda: Location((1, 2, 3), (1, 2, 3), "x"), TypeError, "Third parameter must be a float or order not x"),
                            (lambda: Rot("a"), TypeError, "Invalid positional arguments: ('a',)"),
                            (lambda: Location(foo=1), TypeError, "Unexpected keyword arguments: foo"),
                            (lambda: Pos(1, "a"), TypeError, "Invalid inputs to Pos (1, 'a')"),
                            (lambda: Location() * 2, TypeError, "unsupported operand type(s) for *: 'Location' and 'int'"),
                            (lambda: Rot(90, 0, 0) * Axis.Z, TypeError, "unsupported operand type(s) for *: 'Rotation' and 'Axis'"),
                            (lambda: Location().foo, AttributeError, "'Location' object has no attribute 'foo'")]:
    try:
        bad()
        raise AssertionError(message)
    except error as caught:
        assert str(caught) == message, str(caught)
result = Box(1, 1, 1)
`);
  assert.equal(model.bodies.length, 1);
});

test('Euler orders follow OCCT gp_EulerSequence, as build123d orientation= and ordering=', async () => {
  const model = await build(`${prelude}
expected = {
    Intrinsic.XYZ: "(10, 20, 30)", Intrinsic.XZY: "(-1.17023, 28.0243, 22.7959)", Intrinsic.YZX: "(29.7166, 18.5901, 12.4831)",
    Intrinsic.YXZ: "(20.2836, 9.39129, 26.5488)", Intrinsic.ZXY: "(14.1306, 32.9453, 11.2123)",
    Intrinsic.ZYX: "(28.4518, 22.2422, -1.11606)", Intrinsic.XYX: "(41.5667, 17.2294, -10.3141)",
    Intrinsic.ZXZ: "(19.7197, 3.40487, 39.408)", Extrinsic.XYZ: "(-1.11606, 22.2422, 28.4518)",
    Extrinsic.ZYX: "(30, 20, 10)", Extrinsic.YXY: "(25.2364, 37.8134, -12.5015)", Extrinsic.ZYZ: "(-10.3141, 17.2294, 41.5667)",
}
for order, angles in expected.items():
    text = repr(Location((0, 0, 0), (10, 20, 30), order))
    assert text == f"Location((0, 0, 0), {angles})", (order, text)
# Intrinsic.XZY rows of Location((0, 0, 0), (10, 20, 30), Intrinsic.XZY).
rows = [[0.8137976813493737, -0.3420201433256687, 0.46984631039295416],
        [0.3785223063697925, 0.9254165783983234, 0.01802831123629728],
        [-0.4409696105298824, 0.16317591116653482, 0.8825641192593856]]
assert close(cols(Location((0, 0, 0), (10, 20, 30), Intrinsic.XZY)), [tuple(row[i] for row in rows) for i in range(3)])
proper = [repr(Location((0, 0, 0), a, o)) for a in [(0, 90, 0), (30, 90, 45), (0, 180, 0)]
          for o in (Intrinsic.XYX, Intrinsic.ZXZ, Extrinsic.ZYZ)]
assert proper == ["Location((0, 0, 0), (0, 90, 0))", "Location((0, 0, 0), (90, 0, 0))", "Location((0, 0, 0), (0, 90, 0))",
                  "Location((0, 0, 0), (120, 45, -90))", "Location((0, 0, 0), (90, 30, 45))", "Location((0, 0, 0), (-90, 45, 120))",
                  "Location((0, 0, 0), (-180, 0, -180))", "Location((0, 0, 0), (180, 0, 0))", "Location((0, 0, 0), (-180, 0, -180))"], proper
assert repr(Rot(10, 20, 30, Extrinsic.XYZ)) == "Rotation((0, 0, 0), (-1.11606, 22.2422, 28.4518))"
result = Box(1, 1, 1)
`);
  assert.equal(model.bodies.length, 1);
});

test('Plane, Axis and Vector frames, offsets and products match build123d 0.13', async () => {
  const model = await build(`${prelude}
planes = {
    "XY": ["Plane((0, 0, 0), (1, 0, 0), (0, 0, 1))", (0, 1, 0), "Location((0, 0, 0), (0, 0, 0))"],
    "YZ": ["Plane((0, 0, 0), (0, 1, 0), (1, 0, 0))", (0, 0, 1), "Location((0, 0, 0), (0, 90, 90))"],
    "ZX": ["Plane((0, 0, 0), (0, 0, 1), (0, 1, 0))", (1, 0, 0), "Location((0, 0, 0), (-90, 0, -90))"],
    "XZ": ["Plane((0, 0, 0), (1, 0, 0), (0, -1, 0))", (0, 0, 1), "Location((0, 0, 0), (90, 0, 0))"],
    "YX": ["Plane((0, 0, 0), (0, 1, 0), (0, 0, -1))", (1, 0, 0), "Location((0, 0, 0), (-180, 0, -90))"],
    "ZY": ["Plane((0, 0, 0), (0, 0, 1), (-1, 0, 0))", (0, 1, 0), "Location((0, 0, 0), (0, -90, 0))"],
    "front": ["Plane((0, 0, 0), (1, 0, 0), (0, -1, 0))", (0, 0, 1), "Location((0, 0, 0), (90, 0, 0))"],
    "back": ["Plane((0, 0, 0), (-1, 0, 0), (0, 1, 0))", (0, 0, 1), "Location((0, 0, 0), (-90, 0, -180))"],
    "left": ["Plane((0, 0, 0), (0, -1, 0), (-1, 0, 0))", (0, 0, 1), "Location((0, 0, 0), (0, -90, -90))"],
    "right": ["Plane((0, 0, 0), (0, 1, 0), (1, 0, 0))", (0, 0, 1), "Location((0, 0, 0), (0, 90, 90))"],
    "top": ["Plane((0, 0, 0), (1, 0, 0), (0, 0, 1))", (0, 1, 0), "Location((0, 0, 0), (0, 0, 0))"],
    "bottom": ["Plane((0, 0, 0), (1, 0, 0), (0, 0, -1))", (0, -1, 0), "Location((0, 0, 0), (-180, 0, 0))"],
    "isometric": ["Plane((0, 0, 0), (0.707107, 0.707107, 0), (0.57735, -0.57735, 0.57735))",
                  (-0.4082482904638631, 0.40824829046386313, 0.8164965809277261), "Location((0, 0, 0), (45, 35.2644, 30))"],
}
for name, (text, y_dir, location) in planes.items():
    plane = getattr(Plane, name)
    assert [repr(plane), repr(plane.location)] == [text, location], (name, repr(plane), repr(plane.location))
    assert close(tuple(plane.y_dir), y_dir), (name, tuple(plane.y_dir))
got = {
    "offset": [repr(Plane.XZ.offset(2)), tuple(Plane.XZ.offset(2).origin), repr(Plane.XY.offset(3))],
    "text": [str(Plane.XZ), format(Plane.XZ), f"{Plane.XZ:.2f}"],
    "built": [repr(Plane(origin=(1, 2, 3), x_dir=(1, 1, 0), z_dir=(0, 0, 1))), repr(Plane(origin=(1, 2, 3), z_dir=(1, 0, 0))),
              repr(Plane(origin=(0, 0, 0), z_dir=(1, 1, 1))), repr(Plane(origin=(5, 0, 0))), repr(Plane((1, 2, 3))),
              repr(Plane(Axis((1, 2, 3), (0, 1, 0)))), repr(Plane((0, 0, 0), (1, 0, 0), y_dir=(0, 0, 1))),
              repr(Plane(origin=(0, 0, 0), x_dir=(1, 0, 1), z_dir=(0, 0, 1)))],
    "products": [repr(Plane.XZ * Pos(1, 2, 3)), repr(Plane.XZ * Plane.YZ), repr(Pos(1, 2, 3) * Plane.XZ),
                 repr(Rot(0, 0, 90) * Plane.XZ), [repr(x) for x in Plane.XZ * [Pos(1, 0, 0), Plane.XY]]],
    "misc": [repr(-Plane.XZ), repr(Plane.XY.reverse()), Plane.XZ._key(), Plane.XY == Plane(origin=(0, 0, 0), z_dir=(0, 0, 1)),
             Plane.XY == Plane.XZ, hash(Plane.XY) == hash(Plane.top), repr(Plane(Rot(90, 0, 0))),
             repr(Plane.XY.rotated((0, 0, 90))), repr(Plane.XZ.moved(Rot(0, 0, 90)))],
    "axes": [repr(Axis.X), str(Axis.X), format(Axis.Z), repr(Axis((1, 2, 3), (0, 0, 2))), repr(Axis((1, 2, 3), (0, 1, 0)).location),
             Axis.Z == Axis((0, 0, 0), (0, 0, 5)), Axis.Z == Axis.X, repr(Axis(Rot(90, 0, 0))),
             repr(Axis((1, 1, 1), end_point=(1, 1, 3))), repr(-Axis.Z), repr(Axis.Z.located(Rot(90, 0, 0)))],
    "vectors": [repr(Vector(1, 2, 3)), str(Vector(1, 2, 3)), format(Vector(1, 2, 3)), repr(Vector(0.1 + 0.2, 1 / 3, 1e-7)),
                repr(Vector(1, 2, 3) + (1, 1, 1)), repr(2 * Vector(1, 2, 3)), repr(Vector(1, 2, 3) / 2), repr(-Vector(1, 2, 3)),
                repr(Vector(1, 2, 3).cross(Vector(1, 0, 0))), repr(Vector(1, 2, 3).normalized()), Vector(1, 2, 3) == Vector(1, 2, 3.000001),
                Vector(1, 2, 3) == (1, 2, 3), repr(sum([Vector(1, 0, 0), Vector(0, 1, 0)])), repr(Vector(1, 2, 3).rotate(Axis.Z, 90)),
                repr(Vector(3, 4, 5).project_to_plane(Plane.XY))],
}
expected = {
    "offset": ["Plane((0, -2, 0), (1, 0, 0), (0, -1, 0))", (0.0, -2.0, 0.0), "Plane((0, 0, 3), (1, 0, 0), (0, 0, 1))"],
    "text": ["Plane: (origin=(0, 0, 0), x_dir=(1, 0, 0), z_dir=(0, -1, 0))",
             "((0.0, 0.0, 0.0), (1.0, 0.0, 0.0), (0.0, -1.0, 0.0))",
             "((0.00, 0.00, 0.00), (1.00, 0.00, 0.00), (0.00, -1.00, 0.00))"],
    "built": ["Plane((1, 2, 3), (0.707107, 0.707107, 0), (0, 0, 1))", "Plane((1, 2, 3), (0, 0, 1), (1, 0, 0))",
              "Plane((0, 0, 0), (0.707107, 0, -0.707107), (0.57735, 0.57735, 0.57735))", "Plane((5, 0, 0), (1, 0, 0), (0, 0, 1))",
              "Plane((1, 2, 3), (1, 0, 0), (0, 0, 1))", "Plane((1, 2, 3), (0, 0, 1), (0, 1, 0))",
              "Plane((0, 0, 0), (1, 0, 0), (0, -1, 0))", "Plane((0, 0, 0), (1, 0, 0), (0, 0, 1))"],
    "products": ["Location((1, -3, 2), (90, 0, 0))", "Location((0, 0, 0), (0, 90, 180))", "Plane((1, -3, 2), (1, 0, 0), (0, -1, 0))",
                 "Plane((0, 0, 0), (0, 0, 1), (0, -1, 0))", ["Location((1, 0, 0), (90, 0, 0))", "Location((0, 0, 0), (90, 0, 0))"]],
    "misc": ["Plane((0, 0, 0), (1, 0, 0), (0, 1, 0))", "Plane((0, 0, 0), (1, 0, 0), (0, 0, -1))",
             ((0.0, 0.0, 0.0), (1.0, 0.0, 0.0), (0.0, -1.0, 0.0)), True, False, True, "Plane((0, 0, 0), (1, 0, 0), (0, -1, 0))",
             "Plane((0, 0, 0), (0, 1, 0), (0, 0, 1))", "Plane((0, 0, 0), (0, 0, 1), (0, -1, 0))"],
    "axes": ["Axis((0, 0, 0), (1, 0, 0))", "Axis: (position=(0, 0, 0), direction=(1, 0, 0))", "((0.0, 0.0, 0.0), (0.0, 0.0, 1.0))",
             "Axis((1, 2, 3), (0, 0, 1))", "Location((1, 2, 3), (-90, 0, -90))", True, False, "Axis((0, 0, 0), (0, -1, 0))",
             "Axis((1, 1, 1), (0, 0, 1))", "Axis((0, 0, 0), (0, 0, -1))", "Axis((0, 0, 0), (0, -1, 0))"],
    "vectors": ["Vector(1, 2, 3)", "Vector: (X=1, Y=2, Z=3)", "(1.0, 2.0, 3.0)", "Vector(0.3, 0.3333333333333, 0)", "Vector(2, 3, 4)",
                "Vector(2, 4, 6)", "Vector(0.5, 1, 1.5)", "Vector(-1, -2, -3)", "Vector(0, 3, -2)",
                "Vector(0.2672612419124, 0.5345224838248, 0.8017837257373)", True, False, "Vector(1, 1, 0)", "Vector(-2, 1, 3)",
                "Vector(3, 4, 0)"],
}
for key in expected:
    assert got[key] == expected[key], (key, got[key])
# Plane(Location) rebuilds the frame from a moved face: x and the normal are rounded to 14 digits.
assert close(list(Plane(Location((1, 2, 3), (10, 20, 30))).x_dir), [0.8137976813493695, 0.5438381424823313, -0.20487412870286426])
assert close(list(Plane(origin=(0, 0, 0), z_dir=(1, 2, -3)).x_dir), [-1.1390805436183623e-17, -0.8320502943378438, -0.5547001962252291])
for bad, error, message in [
        (lambda: Plane(origin=(0, 0, 0), x_dir=(0, 0, 2), z_dir=(0, 0, 1)), Exception, "gp_Dir::CrossCross() - result vector has zero norm"),
        (lambda: Plane(origin=(0, 0, 0), z_dir=(0, 0, 0)), ValueError, "z_dir must be non null"),
        (lambda: Plane(origin=(0, 0, 0), x_dir=(0, 0, 0)), ValueError, "x_dir must be non null"),
        (lambda: Plane.XY * 2, TypeError, "unsupported operand type(s) for *: 'Plane' and 'int'"),
        (lambda: Axis((0, 0, 0), (0, 0, 0)), ValueError, "Invalid Axis parameters"),
        (lambda: Vector(1, 2, 3)[0], TypeError, "'Vector' object is not subscriptable")]:
    try:
        bad()
        raise AssertionError(message)
    except error as caught:
        assert str(caught) == message, str(caught)
result = Box(1, 1, 1)
`);
  assert.equal(model.bodies.length, 1);
});

// build123d 0.13.0: volume, bounding box and face count of each placed shape.
const placements = [
  ['Rot(0, 0, 90) * Box(2, 1, 1)', 2, [-0.5, -1, -0.5], [0.5, 1, 0.5], 6],
  ['Pos(1, 2, 3) * Rot(10, 20, 30) * Box(1, 2, 3)', 6, [-0.389775366, 0.660144117, 1.19064229], [2.389775366, 3.339855883, 4.80935771], 6],
  ['Plane.XZ * Box(1, 2, 3, align=Align.MIN)', 6, [0, -3, 0], [1, 0, 2], 6],
  ['Plane.XZ.offset(2) * Box(1, 2, 3, align=Align.MIN)', 6, [0, -5, 0], [1, -2, 2], 6],
  ['Location((0, 0, 18.5), (1, 1, 1), -120) * Box(1, 2, 3, align=Align.MIN)', 6, [0, 0, 18.5], [2, 3, 19.5], 6],
  ['Box(1, 1, 1).moved(Pos(1, 0, 0))', 1, [0.5, -0.5, -0.5], [1.5, 0.5, 0.5], 6],
  ['Box(1, 1, 1, align=Align.MIN).moved(Plane.YZ)', 1, [0, 0, 0], [1, 1, 1], 6],
  ['Rot(90, 0, 0) * Cylinder(1, 4)', 4 * Math.PI, [-1, -2, -1], [1, 2, 1], 3],
  ['Cylinder(1, 2).moved(Rot(0, 90, 0))', 2 * Math.PI, [-1, -1, -1], [1, 1, 1], 3],
  // pin_hinge tang(): a plate pierced by a Rot(90, 0, 0) cylinder. build123d's bounding box is
  // (0, -2, -6)..(40, 2, 6); Bend does not evaluate bounds of this analytic Boolean result (null).
  ['Pos(20, 0, 0) * Box(40, 4, 12) - Pos(6, 0, 0) * Rot(90, 0, 0) * Cylinder(2.3, 8)', 1853.52389945, null, null, 7],
];

test('Location, Rot and Plane place Bend shapes like build123d moves them', async () => {
  for (const [expression, volume, min, max, faces] of placements) {
    const model = await build(`${prelude}result = ${expression}\n`);
    assert.equal(model.bodies.length, 1, expression);
    const [body] = model.bodies;
    near(body.validation.volumeMm3, volume, 1e-9);
    if (min === null) assert.equal(body.validation.boundsMm, null, expression);
    else {
      nearAll(body.validation.boundsMm.min, min, 1e-8);
      nearAll(body.validation.boundsMm.max, max, 1e-8);
    }
    assert.equal(body.faces.length, faces, expression);
  }
});

test('placed shapes keep their class and build123d is_same identity', async () => {
  const model = await build(`${prelude}
box = Box(10, 2, 2)
p = Pos(1, 0, 0)
# build123d: the same TShape at an equal TopLoc_Location chain is the same shape.
assert [(p * p.inverse()) * box == box, Location() * box == box, Pos(0, 0, 0) * box == box, p * box == p * box] == \\
    [True, False, False, True]
assert Pos(1, 0, 0) * box != Pos(1, 0, 0) * box
q = Rot(0, 0, 90)
assert q * (p * box) == (q * p) * box
assert [type(Rot(0, 0, 90) * box).__name__, isinstance(Rot(0, 0, 90) * box, Box), type(Plane.XZ * box).__name__] == ["Box", True, "Box"]
placed = [Rot(0, 0, 90), Plane.XZ] * Box(2, 1, 1)
assert len(placed) == 2 and all(isinstance(s, Box) for s in placed)
for bad, message in [(lambda: Box(1, 1, 1) * Pos(1, 0, 0), "unsupported operand type(s) for *: 'Box' and 'Pos'"),
                     (lambda: Box(1, 1, 1).moved(3), "'int' object has no attribute 'wrapped'"),
                     (lambda: [Pos(1, 0, 0), 2] * box, "Box cannot be multiplied by int")]:
    try:
        bad()
        raise AssertionError(message)
    except (TypeError, AttributeError) as caught:
        assert str(caught) == message, str(caught)
pivot = Location((5, 0, 0))
joint = pivot * Location((0, 0, 0), (0, 0, 1), 90) * pivot.inverse()
assert repr(joint) == "Location((5, -5, 0), (0, 0, 90))"
result = Location((0, 0, 20)) * joint * box
`);
  const [body] = model.bodies;
  near(body.validation.volumeMm3, 40);
  nearAll(body.validation.boundsMm.min, [4, -10, 19], 1e-8);
  nearAll(body.validation.boundsMm.max, [6, 0, 21], 1e-8);
});

test('OCP objects and unimplemented geometry queries are capability errors at their use, even when caught', async () => {
  const cases = [
    ['Location().wrapped', /^Location\.wrapped is an OpenCascade \(OCP\) object/],
    ['Plane.XY.to_gp_ax3()', /^Plane\.to_gp_ax3 is not implemented by the Python frontend/],
    ['Plane.XZ.to_local_coords(Vector(1, 2, 3))', /^Plane\.to_local_coords is not implemented/],
    ['Location().mirror(Plane.XY)', /^Location\.mirror is not implemented/],
    ['Axis.Z.is_parallel(Axis.X)', /^Axis\.is_parallel is not implemented/],
    ['Vector(1, 0, 0).transform(None)', /^Vector\.transform is not implemented/],
    ['Plane(Box(1, 1, 1))', /^Plane\(face\) is not implemented/],
    ['Location(gp_trsf=object())', /OpenCascade \(OCP\) object/],
    ['-Rot(0, 0, 90)', /^-Rotation flips the orientation/],
    ['Plane.XY & Plane.XZ', /^Plane & \.\.\. \(intersect\) is not implemented/],
  ];
  for (const [expression, pattern] of cases) {
    const source = `from build123d import *\nresult = Box(1, 1, 1)\ntry:\n    value = ${expression}\nexcept BaseException:\n    pass\n`;
    await assert.rejects(build(source), error => {
      assert.ok(error instanceof UnsupportedFeatureError, `${expression}: ${error.name}: ${error.message}`);
      assert.match(error.message, pattern, expression);
      assert.equal(error.line, 4, expression);
      return true;
    });
  }
});

}
