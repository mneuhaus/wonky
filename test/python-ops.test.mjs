import test from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missingBend();
if (publicTreeSkip) {
  test("python-ops.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { chmodSync, mkdtempSync, realpathSync, rmSync, writeFileSync } = await import("node:fs");
const { tmpdir } = await import("node:os");
const { join } = await import("node:path");
const { buildPython } = await import("../src/python.mjs");
const { UnsupportedFeatureError } = await import("../src/errors.mjs");
// build123d 0.13 algebra-mode operations in the shim (python/_b3d_ops.py):
// extrude, Solid.make_box / make_cylinder / extrude, Cone, Part / Compound,
// the + - & operators, fuse / cut / intersect, rotate / translate and the
// opaque `wrapped` token. Every case below is a call shape from Marc's corpus
// (docs/corpus/w5b-plan.md). Expected values were produced by build123d 0.13.0
// itself (`uv run --no-project --with build123d==0.13.0 python -B
// tmp/w5b/d-ops/oracle.py`, cases in tmp/w5b/d-ops/cases.py, 2026-09-23) and
// frozen here: class, volume and bounding box (relative 1e-9), solid count and
// face/edge/vertex counts. Python runs through `uv run`, never a bare python3.








const workspace = realpathSync(mkdtempSync(join(tmpdir(), 'wonky-python-ops-')));
const python = join(workspace, 'uv-python');
writeFileSync(python, '#!/bin/sh\nexec uv run --no-project --quiet python "$@"\n');
chmodSync(python, 0o755);
test.after(() => rmSync(workspace, { recursive: true, force: true }));
const build = source => buildPython(source, { python, timeoutMs: 300000 });
const relative = (a, b) => Math.abs(a - b) / Math.max(1, Math.abs(b));

// name: [expression, class, volume, solids, [faces, edges, vertices], [bbox min, bbox max]]
const CASES = {
  extrude_key: ["extrude(Polygon((-2.1, 0), (2.1, 0), (2.1, 0.6), (3.5, 2.2), (-3.5, 2.2), (-2.1, 0.6), align=None), amount=5.0)", "Part", 57.40000000000001, 1, [8,18,12], [[-3.5,0,0],[3.5,2.2,5]]],
  prism_xy: ["Pos(0, 0, 1.2) * extrude(Polygon((-2.1, 0), (2.1, 0), (2.1, 0.6), (3.5, 2.2), (-3.5, 2.2), (-2.1, 0.6), align=None), amount=3.8, dir=(0, 0, 1))", "Part", 43.62400000000001, 1, [8,18,12], [[-3.5,0,1.2],[3.5,2.2,5]]],
  prism_yz: ["Pos(-16, 0, 0) * extrude(Plane.YZ * Polygon((10, 1.6), (12, 1.6), (12, 7.0), (8.25, 7.0), (10, 5.0), align=None), amount=32, dir=(1, 0, 0))", "Part", 401.6, 1, [7,15,10], [[-16,8.25,1.6],[16,12,7]]],
  rounded: ["extrude(RectangleRounded(20, 12, 2.2), amount=8)", "Part", 1886.7624675469965, 1, [10,24,16], [[-10,-6,0],[10,6,8]]],
  rounded_pos: ["Pos(0, 0, 1.2) * extrude(RectangleRounded(16.8, 8.8, 1), amount=9)", "Part", 1322.8343338823083, 1, [10,24,16], [[-8.4,-4.4,1.2],[8.4,4.4,10.2]]],
  side_prism: ["Rot(90, 0, 0) * (Pos(0, 0, -3.5) * extrude(Circle(2.4), 7))", "Part", 126.66901579274045, 1, [3,3,2], [[-2.4,-3.5000000000000004,-2.400000000000001],[2.4,3.5000000000000004,2.400000000000001]]],
  tooth: ["extrude(make_face(Plane.XZ * Polyline((-2, 0), (-1, 1.5), (1, 1.5), (2, 0), close=True)), 2.5, both=True)", "Part", 22.5, 1, [6,12,8], [[-2,-2.5,0],[2,2.5,1.5]]],
  offset_negative: ["extrude(Plane.XY.offset(3) * Rectangle(4, 2), -2)", "Part", 15.999999999999996, 1, [6,12,8], [[-2,-1,1],[2,1,3]]],
  oblique: ["extrude(Plane(origin=(1, 2, 3), x_dir=(1, 0, 0), z_dir=(0, 1, 0)) * Polygon((0, 0), (3, 0), (0, 2), align=None), amount=4, dir=(0.2, 1, 0.3))", "Part", 11.28865042060317, 1, [5,9,6], [[1,2,1],[4.752576694706878,5.762883473534389,4.128865042060317]]],
  face_dir: ["extrude(Face(Wire.make_polygon([(0, 0, 0), (3, 0, 0), (3, 0, 2), (0, 0, 2)])), amount=1.5, dir=(0, -1, 0))", "Part", 9, 1, [6,12,8], [[0,-1.5,0],[3,0,2]]],
  circle_both: ["extrude(Circle(2), 5, both=True)", "Part", 125.6637061435917, 1, [3,3,2], [[-2,-2,-5],[2,2,5]]],
  face_list: ["extrude([Face(Wire.make_polygon([(0, 0, 0), (2, 0, 0), (2, 1, 0)]))], 3)", "Part", 3, 1, [5,9,6], [[-4.5393212517870803e-17,-2.2696606258935402e-17,0],[2,1,3]]],
  make_box: ["Solid.make_box(1, 2, 3)", "Solid", 6, 1, [6,12,8], [[0,0,0],[1,2,3]]],
  make_box_plane: ["Solid.make_box(44, 4, 20, Plane(origin=(-91, 11, -208)))", "Solid", 3519.9999999999995, 1, [6,12,8], [[-91,11,-208],[-47,15,-188]]],
  make_box_xz: ["Solid.make_box(1, 2, 3, Plane.XZ)", "Solid", 5.999999999999999, 1, [6,12,8], [[0,-3,0],[1,0,2]]],
  make_cylinder: ["Solid.make_cylinder(3.2, 3.5, Plane(origin=(-76.5, 7.6, -203.5), z_dir=(0, 1, 0)))", "Solid", 112.59468070465816, 1, [3,3,2], [[-79.7,7.6,-206.7],[-73.3,11.1,-200.3]]],
  make_cylinder_xy: ["Solid.make_cylinder(2, 5)", "Solid", 62.83185307179585, 1, [3,3,2], [[-2,-2,0],[2,2,5]]],
  solid_extrude: ["Solid.extrude(Face(Wire.make_polygon([(0, 0, 0), (0, 4, 0), (0, 4, 1), (0, 0, 1)])), (2.5, 0, 0))", "Solid", 9.999999999999998, 1, [6,12,8], [[0,0,0],[2.5,4,1]]],
  cone: ["Cone(3, 1, 2)", "Cone", 27.227136331111545, 1, [3,3,2], [[-3,-3,-1.0000000000000002],[3,3,1.0000000000000002]]],
  cone_bar: ["Pos(0, 0, 0.9) * Cone(3.5, 1.7, 2.0)", "Cone", 44.17079270947248, 1, [3,3,2], [[-3.5,-3.5,-0.09999999999999998],[3.5,3.5,1.9000000000000001]]],
  cone_stud: ["Pos(0, 0, 1.55) * Cone(2.4, 2.1, 0.3)", "Cone", 4.778362426110076, 1, [3,3,2], [[-2.4,-2.4,1.4000000000000001],[2.4,2.4,1.7000000000000002]]],
  cone_min: ["Cone(3, 1, 2, align=Align.MIN)", "Cone", 27.227136331111545, 1, [3,3,2], [[0,0,0],[6,6,2.0000000000000004]]],
  cone_none: ["Cone(2, 1, 3, align=None)", "Cone", 21.991148575128552, 1, [3,3,2], [[-2,-2,0],[2,2,3.0000000000000004]]],
  cone_mixed: ["Cone(3, 1, 2, align=(Align.MIN, Align.CENTER, Align.MAX))", "Cone", 27.227136331111545, 1, [3,3,2], [[0,-3,-2.0000000000000004],[6,3,0]]],
  cone_rotated: ["Cone(3, 1, 2, rotation=(90, 0, 0), align=Align.MIN)", "Cone", 27.227136331111545, 1, [3,3,2], [[0,-2,0],[6,1.3322676295501878e-15,6]]],
  cone_widening: ["Cone(1, 2, 3)", "Cone", 21.991148575128555, 1, [3,3,2], [[-2.0000000000000004,-2.0000000000000004,-1.5000000000000002],[2.0000000000000004,2.0000000000000004,1.5000000000000002]]],
  union: ["Box(1, 1, 1) + Pos(0.5, 0, 0) * Box(1, 1, 1)", "Part", 1.5, 1, [6,12,8], [[-0.5,-0.5,-0.5],[1,0.5,0.5]]],
  union_disjoint: ["Box(1, 1, 1) + Pos(5, 0, 0) * Box(1, 1, 1)", "Compound", 1.9999999999999996, 2, [12,24,16], [[-0.5,-0.5,-0.5],[5.5,0.5,0.5]]],
  difference: ["Box(1, 1, 1) - Pos(0.5, 0, 0) * Box(1, 1, 1)", "Part", 0.4999999999999999, 1, [6,12,8], [[-0.5,-0.5,-0.5],[0,0.5,0.5]]],
  intersection: ["Box(1, 1, 1) & Pos(0.5, 0, 0) * Box(1, 1, 1)", "Part", 0.4999999999999999, 1, [6,12,8], [[0,-0.5,-0.5],[0.5,0.5,0.5]]],
  solid_fuse: ["Solid.make_box(1, 1, 1).fuse(Pos(0.5, 0, 0) * Solid.make_box(1, 1, 1))", "Solid", 1.5, 1, [6,12,8], [[0,0,0],[1.5,1,1]]],
  solid_cut: ["Solid.make_box(1, 1, 1).cut(Pos(0.5, 0, 0) * Box(1, 1, 1))", "Solid", 0.7499999999999998, 1, [8,18,12], [[0,0,0],[1,1,1]]],
  part_plus: ["Part() + Box(1, 1, 1)", "Part", 0.9999999999999998, 1, [6,12,8], [[-0.5,-0.5,-0.5],[0.5,0.5,0.5]]],
  part_wrapped: ["Part(Box(1, 2, 3).wrapped)", "Part", 6, 1, [6,12,8], [[-0.5,-1,-1.5],[0.5,1,1.5]]],
  compound_children: ["Compound(children=[Box(1, 1, 1), Pos(5, 0, 0) * Box(1, 1, 1)])", "Compound", 1.9999999999999996, 2, [12,24,16], [[-0.5,-0.5,-0.5],[5.5,0.5,0.5]]],
  rotate_translate: ["Box(1, 2, 3).rotate(Axis.X, -25).translate((0, 0, 203))", "Box", 5.999999999999995, 1, [6,12,8], [[-0.5,-1.5402351796476992,201.21792005770433],[0.5,1.5402351796476992,204.78207994229567]]],
  rotate_axis: ["Solid.make_box(1, 1, 1).rotate(Axis((2, 0, 5), (1, 0, 0)), 45)", "Solid", 0.9999999999999998, 1, [6,12,8], [[0,2.82842712474619,1.4644660940672622],[1,4.242640687119285,2.878679656440357]]],
};

// Bend does not merge coplanar faces after a Boolean (a fused box keeps the
// split faces), so topology counts are compared for constructed bodies only.
const BOOLEAN_TOPOLOGY = new Set(['union', 'union_disjoint', 'difference', 'intersection', 'solid_fuse', 'solid_cut', 'part_plus']);
// The host's bounds op refuses bodies whose tight bounds Bend has not
// evaluated (arc-edged extrusions); that refusal is the host's, not a guess.
const NO_BOUNDS = new Set(['rounded', 'rounded_pos']);
// Kernel precision, not the shim: validation.boundsMm of an analytic frustum
// carries float32 error (Cone(2.4, 2.1, 0.3): z +-0.15000010...; its primitive
// is exact). Compared within 1e-6 until the kernel reports exact frustum bounds.
const BOUNDS_TOLERANCE = { cone_stud: 1e-6 };

test('corpus call shapes match build123d 0.13 class, volume, bounding box and topology', async () => {
  const source = `import json, build123d
from build123d import *
from ocp_vscode import show
CASES = ${JSON.stringify(Object.fromEntries(Object.entries(CASES).map(([name, [expression]]) => [name, expression])))}
NO_BOUNDS = ${JSON.stringify([...NO_BOUNDS])}
records, shown, names = {}, [], []
for name, expression in CASES.items():
    shape = eval(expression)
    group = shape._members if isinstance(shape, Compound) and getattr(shape, "_members", None) is not None else None
    handles = group if group is not None else (shape._handle,)
    record = {"cls": type(shape).__name__, "volume": shape.volume, "solids": len(shape)}
    if name not in NO_BOUNDS:
        boxes = [build123d._request("bounds", handle=h) for h in handles]
        record["bbox"] = [[min(b["min"][k] for b in boxes) for k in range(3)], [max(b["max"][k] for b in boxes) for k in range(3)]]
    records[name] = record
    if group is None:
        shown.append(shape)
        names.append(name)
print(json.dumps(records))
show(*shown, names=names)
`;
  const model = await build(source);
  const records = JSON.parse(model.execution.stdout.trim().split('\n').at(-1));
  const topology = Object.fromEntries(model.bodies.map(body => [body.name, [body.faces.length, body.edges.length, body.vertices.length]]));
  for (const [name, [, cls, volume, solids, counts, bbox]] of Object.entries(CASES)) {
    const got = records[name];
    assert.equal(got.cls, cls, `${name} class`);
    assert.ok(relative(got.volume, volume) <= 1e-9, `${name} volume ${got.volume} != ${volume}`);
    assert.equal(got.solids, solids, `${name} solids`);
    if (!NO_BOUNDS.has(name)) {
      const tolerance = BOUNDS_TOLERANCE[name] ?? 1e-9;
      [0, 1].forEach(i => [0, 1, 2].forEach(k => assert.ok(relative(got.bbox[i][k], bbox[i][k]) <= tolerance,
        `${name} bbox ${JSON.stringify(got.bbox)} != ${JSON.stringify(bbox)}`)));
    }
    if (topology[name] && !BOOLEAN_TOPOLOGY.has(name)) assert.deepEqual(topology[name], counts, `${name} faces/edges/vertices`);
  }
  // Compound(children=[...]) of two shapes is a group, not one output body.
  assert.equal(topology.compound_children, undefined);
});

test('Part, Compound and the algebra operators follow build123d 0.13', async () => {
  // Frozen from build123d 0.13.0 (tmp/w5b/d-ops/facts.py, facts2.py, matrix.py).
  await build(`from build123d import *
a = Box(1, 1, 1)
b = Pos(0.5, 0, 0) * Box(1, 1, 1)
far = Pos(5, 0, 0) * Box(1, 1, 1)
s = Solid.make_box(1, 1, 1)
def raises(kind, message, f):
    try:
        f()
    except kind as error:
        assert str(error) == message, str(error)
    else:
        raise AssertionError(f"no {kind.__name__}: {message}")

# Part() is empty; Part() + x is a new Part holding x's solid, x + Part() is x.
empty = Part()
assert not empty and len(empty) == 0 and empty.volume == 0 and empty.children == ()
p = Part() + a
assert type(p) is Part and abs(p.volume - 1) < 1e-12 and p != a
assert a + Part() is a and a + None is a and a - Part() is a and a + [] is a
raises(ValueError, "Cannot subtract shape from empty compound", lambda: Part() - a)
raises(ValueError, "Cannot intersect shape with empty compound", lambda: Part() & a)
raises(ValueError, "Cannot intersect shape with empty compound", lambda: a & Part())
raises(ValueError, "Cannot move an empty shape", lambda: Pos(1, 0, 0) * Part())
raises(ValueError, "Only shapes with the same dimension can be added", lambda: a + Rectangle(1, 1))
acc = Part()
acc += a
acc += far
assert type(acc) is Compound and len(acc) == 2 and abs(acc.volume - 2) < 1e-12

# wrapped: Part(shape.wrapped) is the same shape (is_same), as a Part.
w = Part(a.wrapped)
assert type(w) is Part and w == a and hash(w) == hash(a)

# Compound(children=[...]) keeps its children; Compound([...]) has none.
g = Compound(children=[a, far])
assert type(g) is Compound and g.children[0] is a and len(g) == 2 and abs(g.volume - 2) < 1e-12
assert Compound([a, far]).children == () and not Compound() and Compound(children=[a]) != a
split = g - Pos(5, 0, 0) * Box(0.5, 1, 1)
assert type(split) is Compound and len(split) == 3 and abs(split.volume - 1.5) < 1e-12
moved = Pos(0, 0, 10) * g
assert type(moved) is Compound and len(moved) == 2 and moved != g

# Result classes.
assert type(a + b) is Part and type(a + far) is Compound and type(a - b) is Part and type(a & b) is Part
assert type(s + Pos(0.5, 0, 0) * Solid.make_box(1, 1, 1)) is Solid and type(s - b) is Solid
assert type(a + Pos(0.5, 0, 0) * Solid.make_box(1, 1, 1)) is Part
assert type(a.fuse(b)) is Solid and type(a.fuse(far)) is Compound and type(a.cut(b)) is Solid
assert [type(x).__name__ for x in a + far] == ["Solid", "Solid"]
assert isinstance(a, Part) and isinstance(a, Compound) and not isinstance(a, Solid) and issubclass(Box, Part)
assert isinstance(s, Solid) and not isinstance(s, Part) and isinstance(Cone(3, 1, 2), Part)
assert type(Rot(0, 0, 90) * s) is Solid and type(s.translate((1, 0, 0))) is Solid and type(a.rotate(Axis.X, 30)) is Box

# Empty intersections: a Part-like left gives an empty Compound, a Solid left None.
nothing = a & far
assert type(nothing) is Compound and not nothing
assert s & (Pos(5, 0, 0) * Solid.make_box(1, 1, 1)) is None
hit = a.intersect(b)
assert isinstance(hit, list) and [type(x).__name__ for x in hit] == ["Solid"] and abs(hit[0].volume - 0.5) < 1e-12
assert a.intersect(far) is None and a.intersect(b, far) is None and a.intersect() is None

# extrude in algebra mode: mode and clean change nothing; no faces is an empty Part.
assert abs(extrude(Rectangle(1, 2), 3, mode=Mode.SUBTRACT, clean=False).volume - 6) < 1e-12
e = extrude(Sketch(), 5)
assert type(e) is Part and not e
raises(ValueError, "A face or sketch must be provided", lambda: extrude(None, 1))
raises(ValueError, "Either amount or until must be provided", lambda: extrude(Rectangle(1, 1)))
assert type(a.volume) is float
result = a + b
`);
});

test('empty containers and empty Boolean results move, iterate and add as in build123d 0.13', async () => {
  // Frozen from build123d 0.13.0 (tmp/w5b/integrate/oracle-empty.py -> probe2.oracle.txt). build123d's
  // Compound(), Part(), Sketch() and empty Boolean results have no wrapped shape: listing them asserts
  // (Plane * x lists x first), Compound._dim asserts in x + ..., and moving them is a ValueError.
  // Compound([]) wraps an empty TopoDS compound instead and lists as [].
  await build(`from build123d import *
a = Box(1, 1, 1)
e = a & (Pos(5, 0, 0) * Box(1, 1, 1))
def raises(kind, message, f):
    try:
        f()
    except kind as error:
        assert str(error) == message, str(error)
    else:
        raise AssertionError(f"no {kind.__name__}: {message}")
moving = "Cannot move an empty shape"
for f in (lambda: Pos(1, 0, 0) * Sketch(), lambda: Rot(0, 0, 90) * Sketch(), lambda: Sketch().moved(Location()),
          lambda: [Pos(1, 0, 0)] * Sketch(), lambda: Location((1, 0, 0)) * Part(), lambda: Pos(1, 0, 0) * e):
    raises(ValueError, moving, f)
for f in (lambda: Plane.XY * Sketch(), lambda: Plane.XZ * Sketch(), lambda: Plane.XY * Part(), lambda: e + a,
          lambda: e + None, lambda: Compound() + a, lambda: Compound() + None, lambda: list(Sketch()),
          lambda: list(Part())):
    raises(AssertionError, "", f)
assert type(Compound([]) + a) is Part and type(Part() + None) is Part and type(Sketch() + None) is Sketch
assert list(Compound([])) == [] and Plane.XY * Compound([]) == []
assert a + e is a and a - e is a
assert type(Plane.XY * a) is Box and type(Plane.XY * Circle(1)) is Circle and type(Plane.XY * Part(a.wrapped)) is Part
raises(ValueError, "Cannot subtract shape from empty compound", lambda: e - a)
raises(ValueError, "Cannot intersect shape with empty compound", lambda: e & a)
result = a
`);
});

test('a Compound of separate shapes is one unfused result through the host compound op', async () => {
  // Frozen from build123d 0.13.0 (tmp/w5b/integrate/compound.py): bounding box, edges, groups, volume.
  const model = await build(`from build123d import *
a = Box(1, 1, 1)
far = Pos(5, 0, 0) * Box(1, 1, 2)
g = Compound(children=[a, far])
bb = g.bounding_box()
assert tuple(bb.min) == (-0.5, -0.5, -1.0) and tuple(bb.max) == (5.5, 0.5, 1.0), bb
assert len(g.edges()) == 24 and len(g.solids()) == 2 and abs(g.volume - 3) < 1e-12
assert [len(x) for x in g.edges().group_by(Axis.Z)] == [4, 4, 8, 4, 4]
assert g.is_valid and g._handle == g._handle
result = g
`);
  // The two member B-reps unchanged: no Boolean, no copy.
  assert.equal(model.bodies.length, 2);
  model.bodies.forEach((body, i) => assert.ok(relative(body.validation.volumeMm3, i + 1) < 1e-12, `volume ${body.validation.volumeMm3}`));
  assert.deepEqual(model.bodies.map(body => [body.vertices.length, body.edges.length, body.faces.length]), [[8, 12, 6], [8, 12, 6]]);
});

test('unsupported arguments of the operations are capability errors naming the missing operation', async () => {
  const cases = [
    ['extrude(Rectangle(1, 1), 1, taper=5)', /tapered extrusion/],
    ['extrude(Rectangle(1, 1), until=Until.NEXT)', /extrude until/],
    ['extrude(Rectangle(1, 1), 1, target=Box(1, 1, 1))', /extrude until/],
    ['extrude([Face(Wire.make_polygon([(0, 0, 0), (1, 0, 0), (0, 1, 0)])), Face(Wire.make_polygon([(2, 0, 0), (3, 0, 0), (2, 1, 0)]))], 1)', /several faces/],
    ['extrude(Box(1, 1, 1), 1)', /pass a Sketch or Face/],
    ['Box(1, 1, 1).rotate(Axis.X, 30, transform=True)', /transform=True/],
    ['Box(1, 1, 1).fuse(Pos(0.5, 0, 0) * Box(1, 1, 1), glue=True)', /glue/],
    ['Box(1, 1, 1).intersect(Plane.XY)', /section/],
    ['Solid.make_cylinder(1, 2, angle=90)', /cylinder sector/],
    ['Cone(3, 1, 2, arc_size=180)', /cone sector/],
    ['Cone(3, 0, 2)', /frustum apex/],
    ['Solid()', /Solid\(shape\.wrapped\)/],
    ['Box(1, 1, 1).wrapped.Location()', /OpenCascade \(OCP\)/],
    ['Part(Box(1, 1, 1), color="red")', /color=/],
    ['Solid.make_sphere(1)', /Solid\.make_sphere is not implemented/],
  ];
  await Promise.all(cases.map(([expression, message]) => [`result = ${expression}`, message]).map(async ([line, message]) => {
    await assert.rejects(build(`from build123d import *\n${line}\n`), error => {
      assert.ok(error instanceof UnsupportedFeatureError, `${line}: ${error.name}: ${error.message}`);
      assert.match(error.message, message, line);
      return true;
    });
  }));
});

}
