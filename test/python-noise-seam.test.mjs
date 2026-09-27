import test from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missingBend();
if (publicTreeSkip) {
  test("python-noise-seam.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { chmodSync, mkdtempSync, realpathSync, rmSync, writeFileSync } = await import("node:fs");
const { tmpdir } = await import("node:os");
const { join } = await import("node:path");
const { buildPython, unifiedEdgeRecords } = await import("../src/python.mjs");
const { UnsupportedFeatureError } = await import("../src/errors.mjs");
// W5b fix round 2 regressions (docs/corpus/w5b.md, "Fix round 2"):
// 1. float-noise ties: build123d does not round sort keys, so keys that are
//    mathematically equal carry OpenCascade's rounding noise there and Bend's
//    here. Picks among keys that lie within the edges' coordinate noise
//    (src/python.mjs coordinateNoise, python/_b3d_query.py _compare) are
//    capability errors, as are group_by keys whose rounding the noise could
//    flip and filter_by(Axis) edges whose angle lies within noise of the
//    tolerance. Picks by separating keys equal build123d.
// 2. the seam of a full cylinder face after a Boolean is the seam of the
//    operand surface it comes from (build123d keeps the operand's
//    parametrization), also after rigid moves and further Booleans; where no
//    single operand fixes it, the seam-dependent evaluations are refused
//    (src/python.mjs applySeams).
// Expected values come from build123d 0.13.0 itself (`uv run --no-project
// --with build123d==0.13.0 python -B tmp/w5b/integrate-fix2/reg_oracle.py`,
// 2026-09-24), rounded to 9 decimals there and frozen here. Python runs through
// `uv run`, never a bare python3.








const workspace = realpathSync(mkdtempSync(join(tmpdir(), 'wonky-python-noise-seam-')));
const python = join(workspace, 'uv-python');
writeFileSync(python, '#!/bin/sh\nexec uv run --no-project --quiet python "$@"\n');
chmodSync(python, 0o755);
test.after(() => rmSync(workspace, { recursive: true, force: true }));
const build = source => buildPython(source, { python, timeoutMs: 120000 });
const output = model => JSON.parse(model.execution.stdout.split('\n').find(line => line.startsWith('JSON')).slice(4));

const refuses = (cases, line = 2) => Promise.all(cases.map(async ([expression, message]) => {
  await assert.rejects(build(`from build123d import *\nx = ${expression}\nresult = Box(1, 1, 1)\n`), error => {
    assert.ok(error instanceof UnsupportedFeatureError, `${expression}: ${error.name}: ${error.message}`);
    assert.match(error.message, message, expression);
    assert.equal(error.line, line, expression);
    return true;
  });
}));

const ORACLE = {"holeSeam": [[2.342020143, 1.939692621, 0.0]], "holeCircles": [[[1.657979857, 0.060307379, -2.0], [2.342020143, 1.939692621, -2.0], [2.342020143, 1.939692621, -2.0]], [[1.657979857, 0.060307379, 2.0], [2.342020143, 1.939692621, 2.0], [2.342020143, 1.939692621, 2.0]]], "rotHoledCircles": [[6.477153055, 5.755349612, 3.0], [6.477153055, 5.755349612, 7.0]], "yHole": [[0.64278761, 0.0, 0.766044443]], "outerRot": [[1.0, 0.0, 0.0], [1.02606043, 2.819077862, 0.0]], "innerRot": [[0.342020143, 0.939692621, 0.0], [3.0, 0.0, 0.0]], "extrudeRotPlane": [[1.0, 0.0, 2.0], [2.298133329, 1.928362829, 2.0]], "unionRot": [[1.0, 0.0, -3.0], [1.0, 0.0, 3.0], [1.02606043, 2.819077862, 0.0]], "secondHole": [[-0.590461069, -1.486969785, -2.0], [-0.590461069, -1.486969785, 2.0], [1.657979857, 0.060307379, -2.0], [1.657979857, 0.060307379, 2.0]], "unknownLengths": [4.0, 6.283185307, 6.283185307], "unknownGroupsZ": [[["CIRCLE", 6.283185307]], [["LINE", 4.0]], [["CIRCLE", 6.283185307]]], "unknownSeamLines": 1, "tiltLengthGroups": [4, 8], "tiltLongest8": [2.0, 2.0, 2.0, 2.0, 2.0, 2.0, 2.0, 2.0], "offBoundaryGroups": [4, 4, 4], "tilt099": 4, "tilt101": 0, "hexFar": [[-2.25, -1.299038106, 1.0], [-2.25, 1.299038106, 1.0], [0.0, -2.598076211, 1.0], [0.0, 2.598076211, 1.0], [2.25, -1.299038106, 1.0], [2.25, 1.299038106, 1.0]]};

test('Boolean results keep the operand seam, and picks by separating keys equal build123d', async () => {
  const got = output(await build(`from build123d import *
import json
def P(v): return [round(c, 9) + 0.0 for c in v]
out = {}
tool = Pos(2, 1, 0) * Rot(0, 0, 70) * Cylinder(1, 5)
part = Box(10, 10, 4) - tool
out["holeSeam"] = [P(e.center()) for e in part.edges().filter_by(Axis.Z) if abs(e.center().X) < 4.9]
circles = part.edges().filter_by(GeomType.CIRCLE).sort_by(Axis.Z)
out["holeCircles"] = [[P(c.center()), P(c.position_at(0)), P(c.position_at(1))] for c in circles]
out["rotHoledCircles"] = sorted(P(e.center()) for e in (Pos(5, 5, 5) * Rot(0, 0, 25) * part).edges().filter_by(GeomType.CIRCLE))
out["yHole"] = [P(e.center()) for e in (Box(4, 10, 4) - Rot(90, 0, 0) * Rot(0, 0, 50) * Cylinder(1, 12)).edges().filter_by(Axis.Y) if abs(e.center().X) < 1.9]
def seams(s): return sorted(P(e.center()) for e in s.edges().filter_by(Axis.Z))
out["outerRot"] = seams(Rot(0, 0, 70) * Cylinder(3, 4) - Cylinder(1, 5))
out["innerRot"] = seams(Cylinder(3, 4) - Rot(0, 0, 70) * Cylinder(1, 5))
out["extrudeRotPlane"] = seams(extrude(Plane.XY.rotated((0, 0, 40)) * Circle(3), 4) - Cylinder(1, 10))
out["unionRot"] = seams(Rot(0, 0, 70) * Cylinder(3, 4) + Cylinder(1, 8))
out["secondHole"] = sorted(P(e.center()) for e in (part - Pos(-2, -2, 0) * Rot(0, 0, 200) * Cylinder(1.5, 6)).edges().filter_by(GeomType.CIRCLE))
U = Rot(0, 0, 70) * Cylinder(1, 4) & Rot(0, 0, 10) * Cylinder(1, 8)
out["unknownLengths"] = sorted(round(e.length, 9) for e in U.edges())
out["unknownGroupsZ"] = [sorted([e.geom_type.name, round(e.length, 9)] for e in g) for g in U.edges().group_by(Axis.Z)]
out["unknownSeamLines"] = len(U.edges().filter_by(Axis.Z))
tilt = extrude(Plane(origin=(0, 0, 0), z_dir=(1, 2, 3)) * Rectangle(2, 2), 1)
out["tiltLengthGroups"] = [len(g) for g in tilt.edges().group_by(SortBy.LENGTH)]
out["tiltLongest8"] = sorted(round(e.length, 9) for e in tilt.edges().sort_by(SortBy.LENGTH)[4:])
out["offBoundaryGroups"] = [len(g) for g in (Pos(0, 0, 2e-7) * Box(1, 1, 1)).edges().group_by(Axis.Z)]
out["tilt099"] = len((Rot(0.99e-5, 0, 0) * Box(1, 1, 1)).edges().filter_by(Axis.Z))
out["tilt101"] = len((Rot(1.01e-5, 0, 0) * Box(1, 1, 1)).edges().filter_by(Axis.Z))
out["hexFar"] = sorted(P(e.center()) for e in extrude(RegularPolygon(3, 6), 1).edges().sort_by(Axis.Z)[-6:])
print("JSON" + json.dumps(out))
result = Box(1, 1, 1)
`));
  // Before the fix: holeSeam (3, 1, 0), hole circle centers (1, 1, +-2), outerRot seam (3, 0, 0), ...
  assert.deepEqual(got, ORACLE);
});

test('picks among keys equal within float noise are capability errors, never Bend\'s noise order', async () => {
  const tilt = 'extrude(Plane(origin=(0, 0, 0), z_dir=(1, 2, 3)) * Rectangle(2, 2), 1)';
  // Before the fix each of the first four returned an edge other than build123d's, silently.
  await refuses([
    [`${tilt}.edges().sort_by(SortBy.LENGTH)[-1]`, /ShapeList\[-1\].*float rounding noise/],
    ['extrude(RegularPolygon(3, 6), 1).edges().sort_by(SortBy.DISTANCE)[5]', /ShapeList\[5\]/],
    ['(Pos(0.1, 0.2, 0.3) * Box(1, 2, 3)).edges().sort_by(Axis((0, 0, 0), (1, 1, 1)))[4]', /ShapeList\[4\]/],
    ['(Rot(10, 20, 30) * Box(1, 2, 3)).edges().sort_by(SortBy.LENGTH)[-2:]', /ShapeList\[-2:None:None\]/],
    // Exactly equal Bend keys may differ in OpenCascade's rounding (and the reverse).
    ['Box(1, 2, 3).edges().sort_by(Axis.X).sort_by(Axis.Y).sort_by(Axis.Z)[0]', /ShapeList\[0\]/],
    // A key on a rounding boundary of group_by's 6 digits, an edge tilted by exactly the tolerance.
    ['(Pos(0, 0, 5e-7) * Box(1, 1, 1)).edges().group_by(Axis.Z)', /group_by is not implemented for these edges: the key .* boundary of its rounding/],
    ['(Rot(1e-5, 0, 0) * Box(1, 1, 1)).edges().filter_by(Axis.Z)', /filter_by\(Axis\) is not implemented for these edges: .*tolerance/],
    // Unroundable keys group by exact equality in build123d.
    ['(Rot(10, 20, 30) * Box(1, 2, 3)).edges().group_by(lambda e: (e.length, 1))', /group_by is not implemented for these edges: the keys/],
  ]);
});

test('seam-dependent evaluations are refused where no single operand fixes the seam', async () => {
  const unknown = '(Rot(0, 0, 70) * Cylinder(1, 4) & Rot(0, 0, 10) * Cylinder(1, 8))';
  await refuses([
    [`${unknown}.edges().filter_by(GeomType.CIRCLE).sort_by(Axis.Z)[0].center()`, /Edge\.center\(\) is not implemented for this edge: .*seam/],
    [`${unknown}.edges().filter_by(Axis.Z)[0].center()`, /Edge\.center\(\) is not implemented for this edge: .*seam/],
    [`${unknown}.edges().filter_by(GeomType.CIRCLE).sort_by(Axis.Z)[0].position_at(0)`, /Edge\.position_at is not implemented for this edge/],
    [`${unknown}.edges().sort_by(Axis.X)`, /Edge\.center\(\) is not implemented for this edge/],
  ]);
});

test('unifiedEdgeRecords moves the seam of a simple full cylinder face and refuses other faces', async () => {
  const model = await build('from build123d import *\nresult = Box(10, 10, 4) - Pos(2, 1, 0) * Cylinder(1, 5)\n');
  const body = model.bodies[0];
  const face = body.faces.findIndex(f => f.surface.type === 'cylinder');
  const plain = unifiedEdgeRecords(null, body, 0);
  assert.ok(plain.every(record => record.noise > 0 && record.noise <= 1e-8), 'every record states its coordinate noise');
  const seam = plain.find(record => record.curve === 'line' && Math.abs(record.start[0] - 3) < 1e-12);
  assert.deepEqual([seam.start, seam.end].map(p => p.map(v => +v.toFixed(12) + 0)), [[3, 1, -2], [3, 1, 2]]);
  const turned = unifiedEdgeRecords(null, body, 0, new Map([[face, Math.PI / 2]]));
  const moved = turned.find(record => record.index === seam.index);
  assert.deepEqual([moved.start, moved.end].map(p => p.map(v => +v.toFixed(12) + 0)), [[2, 2, -2], [2, 2, 2]]);
  for (const circle of turned.filter(record => record.curve === 'circle')) {
    assert.deepEqual(circle.start.map(v => +v.toFixed(12) + 0), [2, 2, circle.center[2]]);
    assert.deepEqual(circle.x.map(v => +v.toFixed(12) + 0), [0, 1, 0]);
  }
  const unknown = unifiedEdgeRecords(null, body, 0, new Map([[face, null]]));
  assert.deepEqual(unknown.filter(record => record.seam === 'unknown').map(record => record.curve).sort(), ['circle', 'circle', 'line']);
  // A face bounded by more than its seam and end circles: build123d's seam would split it differently.
  const other = structuredClone(body);
  const straight = other.edges.findIndex(edge => edge.curve === "line" || edge.curve.type === "line");
  other.faces[face].loops.push([{ edge: straight, forward: true }]);
  assert.throws(() => unifiedEdgeRecords(null, other, 0, new Map([[face, 0.5]])), error => error instanceof UnsupportedFeatureError
    && /seam of a full cylinder face of this Boolean result lies elsewhere/.test(error.message));
});

}
