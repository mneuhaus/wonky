import test from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missingBend();
if (publicTreeSkip) {
  test("python-names.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } = await import("node:fs");
const { tmpdir } = await import("node:os");
const { join } = await import("node:path");
const { buildPython } = await import("../src/python.mjs");
const { UnsupportedFeatureError } = await import("../src/errors.mjs");
// The complete build123d 0.13.0 name table of the Bend shim (python/build123d.py,
// python/build123d_names.json): every public name exists, unimplemented names
// build nothing until they are used, and each use fails as a capability at its
// own site. Unknown names stay ordinary Python errors.








const table = JSON.parse(readFileSync(new URL('../python/build123d_names.json', import.meta.url), 'utf8'));
const fixture = path => new URL(`../fixtures/corpus-repro/${path}`, import.meta.url);
const lastJson = model => JSON.parse(model.execution.stdout.trim().split('\n').at(-1));
const near = (a, b) => assert.ok(Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b)), `${a} != ${b}`);
const unsupportedRequests = model => (model.sourceMap?.operations ?? []).filter(operation => operation.name === 'unsupported');

// Implemented with Bend (or as plain values, which construct nothing).
const implementedClasses = ['Align', 'Box', 'Color', 'Cylinder', 'Mode', 'export_step', 'export_stl',
  // geometry values (python/_b3d_location.py)
  'Axis', 'Location', 'Plane', 'Pos', 'Rot', 'Rotation', 'Vector',
  // 2D profiles, pure Python data (python/_b3d_sketch.py)
  'Circle', 'Face', 'Polygon', 'Polyline', 'Rectangle', 'RectangleRounded', 'RegularPolygon', 'Sketch', 'Wire',
  'make_face',
  // queries and selectors over Bend edge records (python/_b3d_query.py)
  'BoundBox', 'Edge', 'ShapeList',
  // solid-edge fillet and chamfer on the Bend fillet (python/_b3d_blend.py)
  'chamfer', 'fillet',
  // operations and containers (python/_b3d_ops.py)
  'Compound', 'Cone', 'Part', 'Solid', 'extrude'];
const valueNames = table.all.filter(name => {
  const entry = table.names[name];
  return (entry.kind === 'value' && 'value' in entry) || entry.kind === 'enum';
});

test('the frozen table is build123d 0.13.0 with provenance, and names every public name', () => {
  assert.equal(table.schema, 'wonky-build123d-names/1');
  assert.equal(table.provenance.version, '0.13.0');
  assert.match(table.provenance.command, /uv run .*build123d==0\.13\.0 .*scripts\/python\/build123d-names\.py/);
  assert.equal(table.all.length, 203);
  assert.deepEqual([...table.all].sort(), table.all);
  for (const name of table.all) assert.equal(table.names[name]?.origin, 'public', name);
  for (const name of ['Shape', 'Drawing', 'TOLERANCE', 'exporters', 'gp_Pnt']) assert.ok(table.names[name], name);
  assert.equal(table.names.gp_Pnt.origin, 'ocp');
  assert.equal(table.names.exporters.origin, 'submodule');
  assert.deepEqual(table.names.Align.members, [['MIN', 1], ['CENTER', 2], ['MAX', 3], ['NONE', null]]);
  assert.deepEqual(table.names.IN, { kind: 'value', value: 25.4, module: null, origin: 'public' });
  for (const name of ['build123d.exporters', 'build123d.build_common', 'build123d.topology.one_d']) {
    assert.equal(table.submodules[name]?.importable, true, name);
  }
});

test('a wildcard import binds all 203 names; only the Bend subset and plain values are implemented', async () => {
  const model = await buildPython(`from build123d import *
import build123d, json
sentinels = sorted(name for name in build123d.__all__ if type(globals()[name]).__name__ == "_Unimplemented")
missing = [name for name in build123d.__all__ if name not in globals()]
result = Box(1, 1, 1)
print(json.dumps({"sentinels": sentinels, "missing": missing, "count": len(build123d.__all__)}))
`);
  const { sentinels, missing, count } = lastJson(model);
  assert.equal(count, 203);
  assert.deepEqual(missing, []);
  const implemented = new Set([...implementedClasses, ...valueNames]);
  assert.deepEqual(sentinels, table.all.filter(name => !implemented.has(name)));
  assert.ok(sentinels.includes('Mesher') && sentinels.includes('import_step') && sentinels.includes('loft'));
  assert.deepEqual(unsupportedRequests(model), []);
});

test('importing, annotating, subscripting and comparing unimplemented names builds and fails nothing', async () => {
  const model = await buildPython(`from build123d import Box, Compound, Edge, Location, Part, Plane, RectangleRounded, ShapeList, Sketch, extrude
import typing
from dataclasses import dataclass

AnyPart = Part | None
Edges = ShapeList[Edge]
MaybePlane = typing.Optional[Plane]
Either = typing.Union[Sketch, Part]
registry = {Part: "part", Compound: "compound"}
assert Compound is not Part and registry[Part] == "part"

def outline(width: float, where: Location = None) -> Sketch:
    return RectangleRounded(width, width, 1)

@dataclass
class Spec:
    body: Part | None = None

result = Box(2, 2, 2)
`);
  near(model.bodies[0].validation.volumeMm3, 8);
  assert.deepEqual(unsupportedRequests(model), []);
});

test('every use of an unimplemented name is a capability error at its own line, even when caught', async () => {
  for (const [expression, message] of [
    ['Mesher()', /^build123d\.Mesher is not implemented by the Python frontend$/],
    ['Plane.XY.shift_origin((0, 0, 1))', /^Plane\.shift_origin is not implemented/],
    ['Shell.cast(None)', /^build123d\.Shell\.cast is not implemented/],
    ['revolve(None)', /^build123d\.revolve is not implemented/],
    ['isinstance(Box(1, 1, 1), Vertex)', /isinstance\(\) against build123d\.Vertex/],
    ['issubclass(int, Shell)', /issubclass\(\) against build123d\.Shell/],
    ['class Bracket(BasePartObject): pass', /Subclassing build123d\.BasePartObject/],
    ['bool(Mesher)', /Truth value of build123d\.Mesher/],
    ['[vertex for vertex in Vertex]', /Iterating over build123d\.Vertex/],
    ['Mesher * 2', /Arithmetic on build123d\.Mesher/],
    ['UNITS_PER_METER[Unit.MM]', /build123d\.UNITS_PER_METER\[\.\.\.\]/],
    ['Box(1, 1, 1, align=Align.NONE)', /align requires/],
    ['__import__("build123d").Shape.cast(None)', /^Shape\.cast is not implemented by the Python frontend$/],
    ['Box.cast(None)', /^Box\.cast is not implemented/],
    ['Pos.mirror', /^Pos\.mirror is not implemented/],
    ['Location().wrapped', /^Location\.wrapped is an OpenCascade \(OCP\) object/],
    ['__import__("build123d").gp_Pnt(0, 0, 0)', /build123d\.gp_Pnt .*OpenCascade \(OCP\) name.*constructed in Bend/],
    ['import_step("bracket.step")', /^build123d\.import_step is not implemented .*reads external geometry from a file.*package policy.*constructed in Bend/],
    ['__import__("build123d").np.zeros(3)', /build123d\.np\.zeros .*third-party package 'numpy', which wonky does not provide/],
    ['__import__("build123d").logger.info("x")', /build123d\.logger\.info .*re-exports it from 'logging', the Bend shim does not/],
    ['__import__("build123d.exporters", fromlist=["Drawing"]).Drawing()', /build123d\.Drawing is not implemented/],
    ['__import__("build123d.topology.one_d").topology.one_d.Edge.make_line((0, 0), (1, 1))', /^Edge\.make_line is not implemented/],
  ]) {
    const source = `from build123d import *\nresult = Box(1, 1, 1)\ntry:\n    ${expression}\nexcept BaseException:\n    pass\n`;
    await assert.rejects(buildPython(source, { filename: 'names.py' }), error => {
      assert.ok(error instanceof UnsupportedFeatureError, `${expression}: ${error.message}`);
      assert.match(error.message, message, expression);
      assert.equal(error.line, 4, expression);
      return true;
    });
  }
});

// Operations the Bend kernel itself lacks (python/build123d.py _KERNEL_GAPS):
// the message names the missing kernel operation, not only the missing binding.
const gapNotes = {
  blend: /Bend has no 2D vertex (fillet|chamfer) of sketch profiles \(it blends solid edges only\)/,
  text: /Bend has no font outlines/,
  offset: /Bend has no offset operation/,
  mirror: /Bend has no reflection transform/,
  loft: /Bend has no general loft: its only loft is the exact frustum between two coaxial circles/,
  sweep: /Bend has no sweep along a path/,
  spline: /Bend has no B-spline curves/,
  section: /Bend computes solid\/plane section contours .* no operation that builds the planar section faces/,
  svg: /Bend has no 2D drawing export/,
  torus: /Bend has no torus surface/,
  sphere: /Bend has no sphere surface/,
};
// Every "Class.method" key exists on that class in build123d 0.13.0 (checked with
// `uv run --with build123d==0.13.0`: hasattr(build123d.<Class>, <method>)), except
// Shape.offset_3d: the shim's Shape also stands for Part and Compound results,
// which have it. Solid-edge fillet/chamfer are implemented (python/_b3d_blend.py,
// test/python-fillet.test.mjs); only Sketch's 2D vertex blends stay gaps.
const gapMethods = ['Compound.make_text', 'Compound.mirror', 'Compound.offset_3d',
  'Edge.make_spline', 'Edge.mirror', 'Edge.offset_2d', 'Face.mirror', 'Face.sweep', 'Location.mirror',
  'Part.mirror', 'Part.offset_3d', 'Shape.mirror',
  'Shape.offset_3d', 'Sketch.chamfer', 'Sketch.fillet', 'Sketch.mirror', 'Sketch.offset_3d',
  'Solid.make_loft', 'Solid.make_sphere', 'Solid.make_torus', 'Solid.mirror', 'Solid.offset_3d',
  'Solid.sweep', 'Wire.mirror', 'Wire.offset_2d'];
const gapNames = ['ExportSVG', 'Sphere', 'Spline', 'Text', 'Torus', 'loft', 'mirror', 'offset', 'section', 'sweep'];

test('kernel-less operations stop at their use site and name the missing Bend operation', async () => {
  for (const name of gapNames) assert.equal(table.names[name]?.origin, 'public', name);
  const keys = lastJson(await buildPython(`import build123d, json
result = build123d.Box(1, 1, 1)
print(json.dumps(sorted(build123d._KERNEL_GAPS)))
`));
  assert.deepEqual(keys, [...gapNames, ...gapMethods].sort());
  for (const [expression, subject, note] of [
    // top-level sentinels, in the argument forms of Marc's corpus
    ['Text("C0.20", font_size=3)', 'build123d.Text', gapNotes.text],
    ['offset(Rectangle(2, 2), amount=-1, kind=Kind.INTERSECTION)', 'build123d.offset', gapNotes.offset],
    ['mirror(Rectangle(2, 2), Plane.YZ)', 'build123d.mirror', gapNotes.mirror],
    ['loft([Circle(2), Pos(0, 0, 1) * Circle(1)], ruled=True)', 'build123d.loft', gapNotes.loft],
    ['sweep(Circle(1), path=None, is_frenet=True)', 'build123d.sweep', gapNotes.sweep],
    ['Spline((0, 0), (1, 2), (3, 0), tangents=[(0, 1), (0, -1)])', 'build123d.Spline', gapNotes.spline],
    ['section(result, section_by=Plane.XY)', 'build123d.section', gapNotes.section],
    ['ExportSVG(scale=4, margin=5)', 'build123d.ExportSVG', gapNotes.svg],
    ['Torus(3, 1)', 'build123d.Torus', gapNotes.torus],
    ['Sphere(3)', 'build123d.Sphere', gapNotes.sphere],
    // methods of classes that are sentinels until a shim module implements them (Edge: _b3d_query),
    // also through a submodule view; the subject then loses its "build123d." prefix
    ['Edge.make_spline([(0, 0), (1, 1), (2, 0)])', '?Edge.make_spline', gapNotes.spline],
    ['__import__("build123d.topology.one_d").topology.one_d.Edge.make_spline([])', '?Edge.make_spline', gapNotes.spline],
    ['Solid.make_sphere(1)', '?Solid.make_sphere', gapNotes.sphere],
    ['Sketch.fillet', '?Sketch.fillet', gapNotes.blend],
    // methods of implemented classes: the attribute read is the use site
    ['result.mirror(Plane.XZ)', 'Box.mirror', gapNotes.mirror],
    // an Algebra result (a Part, or a Compound of several solids; _b3d_ops), as in the corpus's slot.mirror(Plane.XZ)
    ['(result + Pos(3, 0, 0) * Box(1, 1, 1)).mirror(Plane.XZ)', /^(Shape|Part|Compound)\.mirror is not implemented by the Python frontend; /, gapNotes.mirror],
    ['Sketch.chamfer', '?Sketch.chamfer', gapNotes.blend],
    ['Pos.mirror', 'Pos.mirror', gapNotes.mirror],
    ['Location().mirror(Plane.XY)', 'Location.mirror', gapNotes.mirror],
    ['Circle(1).mirror(Plane.YZ)', 'Circle.mirror', gapNotes.mirror],
    ['Polyline((0, 0), (1, 0), (1, 1)).offset_2d(1)', 'Polyline.offset_2d', gapNotes.offset],
  ]) {
    const source = `from build123d import *\nresult = Box(1, 1, 1)\ntry:\n    ${expression}\nexcept BaseException:\n    pass\n`;
    await assert.rejects(buildPython(source, { filename: 'gaps.py' }), error => {
      assert.ok(error instanceof UnsupportedFeatureError, `${expression}: ${error.message}`);
      // '?Name' allows the sentinel ("build123d.Name") or an implemented class ("Name")
      const subjects = subject instanceof RegExp ? [] : subject.startsWith('?')
        ? [`build123d.${subject.slice(1)}`, subject.slice(1)] : [subject];
      if (subject instanceof RegExp) assert.match(error.message, subject, expression);
      else assert.ok(subjects.some(prefix => error.message.startsWith(`${prefix} is not implemented by the Python frontend; `)),
        `${expression}: ${error.message}`);
      assert.match(error.message, note, expression);
      assert.equal(error.line, 4, expression);
      return true;
    });
  }
});

test('kernel-gap notes leave implemented attributes and plain naming alone', async () => {
  const model = await buildPython(`from build123d import *
import json
ops = {"fillet": fillet, "spline": Spline, "sphere": Sphere, "edge": Edge}
annotated: "Spline | None" = None
assert Plane.XY.offset(2).origin == Vector(0, 0, 2)
placed = Pos(1, 0, 0) * Box(1, 1, 1)
result = placed.moved(Location((0, 0, 1)))
print(json.dumps(sorted(ops)))
`);
  assert.deepEqual(lastJson(model), ['edge', 'fillet', 'sphere', 'spline']);
  assert.deepEqual(model.bodies[0].validation.boundsMm, { min: [0.5, -0.5, 0.5], max: [1.5, 0.5, 1.5] });
  assert.deepEqual(unsupportedRequests(model), []);
});

test('enum members and unit constants are plain values, as in build123d 0.13.0', async () => {
  const model = await buildPython(`from build123d import *
import json
assert 10 * MM + IN == 35.4 and FT == 12 * IN
assert Align.NONE.value is None and Align.MIN.value == 1 and Keep.TOP in Keep
assert [mode.name for mode in Mode] == ["ADD", "SUBTRACT", "INTERSECT", "REPLACE", "PRIVATE"]
style = {"font_style": FontStyle.BOLD, "keep": Keep.BOTH, "kind": Kind.INTERSECTION, "select": Select.LAST}
result = Box(1, 1, 1, align=(Align.MIN, Align.CENTER, Align.MAX))
print(json.dumps({"members": len(GeomType), "names": sorted(member.name for member in style.values())}))
`);
  assert.deepEqual(lastJson(model), { members: table.names.GeomType.members.length, names: ['BOLD', 'BOTH', 'INTERSECTION', 'LAST'] });
  assert.deepEqual(model.bodies[0].validation.boundsMm, { min: [0, -0.5, -1], max: [1, 0.5, 0] });
  assert.deepEqual(unsupportedRequests(model), []);
});

test('the implemented enums carry exactly the frozen build123d 0.13.0 members', async () => {
  const model = await buildPython(`import build123d, json
result = build123d.Box(1, 1, 1)
print(json.dumps({name: [[m.name, m.value] for m in getattr(build123d, name)] for name in ("Align", "Mode")}))
`);
  const members = lastJson(model);
  assert.deepEqual(members.Align, table.names.Align.members);
  assert.deepEqual(members.Mode, table.names.Mode.members);
});

test('standard-library re-exports are the very stdlib objects; they build nothing and fail nothing', async () => {
  const stdlib = Object.entries(table.names).filter(([, entry]) => entry.stdlib);
  assert.ok(stdlib.length >= 60, `${stdlib.length} verified stdlib re-exports`);
  for (const [name, entry] of stdlib) assert.equal(entry.origin, 'reexport', name);
  assert.deepEqual(table.names.Path.stdlib, ['pathlib._local', 'Path']);
  assert.deepEqual(table.names.TYPE_CHECKING.stdlib, ['typing', 'TYPE_CHECKING']);
  for (const name of ['np', 'ConvexHull', 'ezdxf', 'logger', 'CLASS_REGISTRY', 'deprecated']) assert.equal(table.names[name].stdlib, undefined, name);
  const model = await buildPython(`import collections.abc, dataclasses, math, pathlib, typing
import build123d
from build123d import Path, dataclass_field, Iterable, inf
assert Path is pathlib.Path and dataclass_field is dataclasses.field and Iterable is collections.abc.Iterable
assert inf == math.inf and build123d.pi == math.pi and build123d.math is math and build123d.TYPE_CHECKING is False
assert build123d.tcast is typing.cast and "Path" not in build123d.__all__
result = build123d.Box(1, 1, 1)
`);
  near(model.bodies[0].validation.volumeMm3, 1);
  assert.deepEqual(unsupportedRequests(model), []);
});

test('names that build123d 0.13.0 does not have stay AttributeError, not capability errors', async () => {
  const model = await buildPython(`import build123d
from build123d import FontStyle, Keep
assert getattr(FontStyle, "WIDE", None) is None and not hasattr(Keep, "LEFT")
try:
    FontStyle.WIDE
except AttributeError as error:
    assert "FontStyle has no member 'WIDE' in build123d 0.13.0" in str(error), str(error)
assert not hasattr(build123d, "RoundedBox")
try:
    build123d.RoundedBox(1, 2, 3)
except AttributeError as error:
    message = str(error)
assert "not a public name of build123d 0.13.0" in message, message
try:
    build123d.exporters.NoSuchExporter
except AttributeError:
    pass
else:
    raise AssertionError("unknown submodule name resolved")
result = build123d.Box(1, 2, 3)
`);
  near(model.bodies[0].validation.volumeMm3, 6);
  assert.deepEqual(unsupportedRequests(model), []);
});

test('build123d submodules are views of the same table', async () => {
  const model = await buildPython(`import sys
import build123d
import build123d.topology.one_d as one_d
from build123d.build_common import Locations
from build123d.exporters import Drawing
from build123d.build_enums import *
assert one_d.Edge is build123d.Edge and Locations is build123d.Locations and Drawing is build123d.Drawing
assert build123d.exporters is sys.modules["build123d.exporters"] and build123d.topology.one_d is one_d
assert Keep is build123d.Keep
result = build123d.Box(1, 1, 2)
`);
  near(model.bodies[0].validation.volumeMm3, 2);
  assert.deepEqual(unsupportedRequests(model), []);
});

test('the corpus repros build once their names are implemented, or when the names are only named', async () => {
  // W5 stopped this repro at Part() (line 9); _b3d_ops implements Part(): Part() + x is x's geometry.
  const named = await buildPython(readFileSync(fixture('py-api-surface/named-import.py'), 'utf8'), { filename: 'named-import.py' });
  near(named.bodies[0].validation.volumeMm3, 1000);
  const annotated = await buildPython(readFileSync(fixture('py-api-surface/wildcard-annotation.py'), 'utf8'));
  near(annotated.bodies[0].validation.volumeMm3, 800);
});

test('use sites carry columns, and uses inside a project module name that module', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'wonky-names-'));
  writeFileSync(join(directory, 'helpers.py'), `from build123d import *


def plate(size):
    return Box(size, size, 2) if size > 99 else  Sphere(3).volume
`);
  const probe = `import inspect, json, sys
import build123d

def here():
    return build123d._position(inspect.currentframe().f_back)

first = here(); second = [0, "µ", here()][2]
print(json.dumps({"version": sys.version_info[:2], "columns": [first["column"], second["column"]]}))
`;
  writeFileSync(join(directory, 'probe.py'), `${probe}result = build123d.Box(1, 1, 1)\n`);
  const probed = lastJson(await buildPython(readFileSync(join(directory, 'probe.py'), 'utf8'), { filename: join(directory, 'probe.py') }));
  const columns = probed.version[0] > 3 || probed.version[1] >= 11;
  // 1-based characters, not UTF-8 bytes: "µ" is one column.
  assert.deepEqual(probed.columns, columns ? [9, 35] : [null, null]);

  const part = join(directory, 'part.py');
  writeFileSync(part, 'from build123d import Box\nimport helpers\n\nresult = Box(1, 1, 1)\nhelpers.plate(3)\n');
  await assert.rejects(buildPython(readFileSync(part, 'utf8'), { filename: part }), error => {
    assert.ok(error instanceof UnsupportedFeatureError, error.message);
    assert.equal(error.line, 5);
    assert.match(error.message, columns
      ? /^build123d\.Sphere is not implemented by the Python frontend; Bend has no sphere surface [^()]*\([^)]*\) \(at helpers\.py:5:50\)$/
      : /^build123d\.Sphere is not implemented by the Python frontend; Bend has no sphere surface [^()]*\([^)]*\) \(at helpers\.py:5\)$/);
    return true;
  });
});

test('export_step and export_stl keep build123d signatures, write their files and become named outputs', async () => {
  // Exports are written inside the model's project directory (test/python-exports.test.mjs), so the model is a file.
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'wonky-names-export-')));
  const python = join(directory, 'uv-python'), filename = join(directory, 'model.py');
  writeFileSync(python, '#!/bin/sh\nexec uv run --no-project --quiet python "$@"\n');
  chmodSync(python, 0o755);
  mkdirSync(join(directory, 'out'));
  writeFileSync(filename, `from build123d import *
from pathlib import Path
bracket = Box(4, 3, 2)
assert export_step(bracket, Path("out") / "bracket.step") is True
assert export_stl(bracket, "out/bracket.stl", 0.01) is True
export_step(Pos(10, 0, 0) * Cylinder(1, 5), "out/pin.step", unit=Unit.MM)
`);
  try {
    const model = await buildPython(readFileSync(filename, 'utf8'), { filename, python, cwd: directory });
    assert.equal(model.source.result, 'capture');
    assert.deepEqual(model.bodies.map(body => body.name), ['bracket', 'pin']);
    assert.deepEqual(model.source.outputs.map(output => [output.kind, output.name, output.path, output.written]), [
      ['export_step', 'bracket', 'out/bracket.step', true],
      ['export_stl', 'bracket', 'out/bracket.stl', true],
      ['export_step', 'pin', 'out/pin.step', true],
    ]);
    assert.deepEqual(model.source.writtenFiles.map(file => file.projectPath), ['out/bracket.step', 'out/bracket.stl', 'out/pin.step']);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('show() and show_object() capture in call order, with inferred names and build123d colors', async () => {
  const model = await buildPython(`from build123d import *
from ocp_vscode import show, show_object
base = Box(4, 4, 1)
peg = Pos(0, 0, 2) * Cylinder(1, 3)
lid = Pos(10, 0, 0) * Box(4, 4, 1)
show(base, peg, colors=["steelblue", Color(0x4A6E8A)])
show_object(lid, name="cover", options={"color": "#f00", "alpha": 0.5})
`);
  assert.equal(model.source.result, 'capture');
  assert.deepEqual(model.bodies.map(body => [body.name, body.appearance]), [
    ['base', { red: 0.2745098, green: 0.5098039, blue: 0.7058824, alpha: 1 }],
    ['peg', { red: 0.2901961, green: 0.4313726, blue: 0.5411765, alpha: 1 }],
    ['cover', { red: 1, green: 0, blue: 0, alpha: 0.5 }],
  ]);
  assert.deepEqual(model.source.outputs.map(output => [output.kind, output.name, output.location?.line]),
    [['show', 'base', 6], ['show', 'peg', 6], ['show_object', 'cover', 7]]);
  await assert.rejects(buildPython(`from build123d import *
from ocp_vscode import show
show(Box(1, 1, 1), colors=["no-such-color"])
`), error => /ValueError: 'no-such-color' is not defined as a named color/.test(error.message) && error.line === 3);
});

// Fix round: submodule views carry every public attribute of the real
// submodule (constants, aliases, mixins), not only __all__ or what build123d
// defines there, so no submodule import line fails where build123d 0.13.0 works.
test('submodule views import every public build123d 0.13.0 name; import * binds the declared __all__', async () => {
  const model = await buildPython(`from build123d.build_constants import MM, IN
from build123d.geometry import VectorLike
from build123d.build_enums import Align2D
from build123d.topology import Mixin1D
from build123d.topology import *
import build123d.topology as topology
from typing import Optional
def place(at: Optional[VectorLike] = None) -> Mixin1D | None:
    return None
assert MM == 1 and IN == 25.4 and place() is None
assert sorted(topology.__all__) == sorted(${JSON.stringify(table.submodules['build123d.topology'].all)})
assert "Mixin1D" not in topology.__all__
from build123d import Box
result = Box(10 * MM, 1, 1)
`);
  near(model.bodies[0].validation.volumeMm3, 10);
  assert.deepEqual(unsupportedRequests(model), []);
  for (const [module, name] of [['build123d.build_constants', 'MM'], ['build123d.geometry', 'VectorLike'],
    ['build123d.build_enums', 'Align2D'], ['build123d.topology', 'Mixin1D']]) {
    assert.ok(Object.hasOwn(table.submodules[module].names, name), `${module}.${name}`);
  }
  await assert.rejects(buildPython('from build123d.topology import Mixin1D\nMixin1D.edges\n'), error =>
    error instanceof UnsupportedFeatureError && error.line === 2 && /build123d\.topology\.Mixin1D\.edges is not implemented/.test(error.message));
});

}
