import test from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missingBend();
if (publicTreeSkip) {
  test("python-unify.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { chmodSync, mkdtempSync, realpathSync, rmSync, writeFileSync } = await import("node:fs");
const { tmpdir } = await import("node:os");
const { join } = await import("node:path");
const { buildPython, unifiedEdgeRecords } = await import("../src/python.mjs");
const { UnsupportedFeatureError } = await import("../src/errors.mjs");
// W5b fix round 1 regressions (docs/corpus/w5b.md, "Fix round 1"):
// 1. edges() and every selector after a Boolean or an extrusion are build123d's
//    clean() edges (ShapeUpgrade_UnifySameDomain), not Bend's split coplanar
//    pieces; where OpenCascade's outcome is not determined by the Bend body the
//    query is a capability error (src/python.mjs unifiedEdgeRecords);
// 2. a profile with an edge at or below Bend's resolvable length is refused, not
//    built into a body whose STEP is no solid (RectangleRounded near 2r = side);
// 3. a near-collinear polygon vertex is refused, not merged silently (the
//    kernel's regularized PROFILE_MERGE), exactly collinear vertices merge as in
//    build123d;
// 4. picks that depend on OpenCascade's edge order or edge direction are
//    capability errors (python/_b3d_query.py tie labels), picks by separating
//    keys equal build123d.
// Expected values come from build123d 0.13.0 itself (`uv run --no-project
// --with build123d==0.13.0 python -B tmp/w5b/integrate-fix/reg_oracle.py`,
// 2026-09-23), rounded to 9 decimals there and frozen here. Python runs through
// `uv run`, never a bare python3.








const workspace = realpathSync(mkdtempSync(join(tmpdir(), 'wonky-python-unify-')));
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

const ORACLE = {"union": {"edges": 30, "circles": 0, "length": 240.0, "groupsZ": [4, 1, 9, 2, 9, 1, 4], "solids": 1, "volume": 1875.0}, "pocket": {"edges": 24, "circles": 0, "length": 170.0, "groupsZ": [4, 4, 4, 4, 8], "solids": 1, "volume": 928.0}, "split": {"edges": 24, "circles": 0, "length": 52.0, "groupsZ": [8, 8, 8], "solids": 2, "volume": 20.0}, "pierce": {"edges": 15, "circles": 2, "length": 64.566370614, "groupsZ": [5, 5, 5], "solids": 1, "volume": 51.433629386}, "rotPierce": {"edges": 15, "circles": 2, "length": 64.566370614, "groupsZ": [4, 7, 4], "solids": 1, "volume": 51.433629386}, "steps": {"edges": 6, "circles": 4, "length": 66.831853072, "groupsZ": [1, 1, 2, 1, 1], "solids": 1, "volume": 81.681408993}, "triBoth": {"edges": 9, "circles": 0, "length": 36.0, "groupsZ": [3, 3, 3], "solids": 1, "volume": 24.0}, "rrBoth": {"edges": 24, "circles": 8, "length": 92.566370614, "groupsZ": [8, 8, 8], "solids": 1, "volume": 236.566370614}, "exactCollinear": {"edges": 12, "circles": 0, "length": 32.0, "groupsZ": [4, 4, 4], "solids": 1, "volume": 12.0}, "rrNearLimit": {"edges": 24, "circles": 8, "length": 61.702545472, "groupsZ": [8, 8, 8], "solids": 1, "volume": 52.279483468}, "unionTop": [10.0, 10.0, 10.0, 10.0], "unionLongest": 10.0, "pocketVertical": [4, 4], "picks": [[[-0.5, 0.0, -1.5], [0.0, -1.0, -1.5], [0.0, 1.0, -1.5], [0.5, 0.0, -1.5]], [-2.0, 2.4492935982947064e-16, 2.0]]};

test('edges() after Booleans and extrusions are build123d\'s unified edges (counts, lengths, groups, selections)', async () => {
  const got = output(await build(`from build123d import *
import json
def summ(s):
    es = s.edges()
    return {"edges": len(es), "circles": len(es.filter_by(GeomType.CIRCLE)), "length": round(sum(e.length for e in es), 9),
            "groupsZ": [len(g) for g in es.group_by(Axis.Z)], "solids": len(s.solids()), "volume": round(s.volume, 9)}
cases = {
 "union": Box(10,10,10) + Pos(5,5,5)*Box(10,10,10),
 "pocket": Box(10,10,10) - Pos(0,0,3)*Box(4,4,5),
 "split": Box(6,2,2) - Box(1,3,3),
 "pierce": Box(4,4,4) - Cylinder(1,6),
 "rotPierce": Box(4,4,4) - Rot(90,0,0)*Cylinder(1,6),
 "steps": Cylinder(3,2) + Pos(0,0,2)*Cylinder(2,2),
 "triBoth": extrude(Polygon((0,0),(4,0),(0,3)),2,both=True),
 "rrBoth": extrude(RectangleRounded(10,6,1),2,both=True),
 "exactCollinear": extrude(Polygon((0,0),(2,0),(4,0),(4,3),(0,3)),1),
 "rrNearLimit": extrude(RectangleRounded(10,6,3-1e-3),1),
}
out = {k: summ(v) for k, v in cases.items()}
u = cases["union"]
out["unionTop"] = sorted(round(e.length, 9) for e in u.edges().group_by(Axis.Z)[-1])
out["unionLongest"] = [e.length for e in u.edges().sort_by(SortBy.LENGTH)][-1]
out["pocketVertical"] = [len(g) for g in cases["pocket"].edges().filter_by(Axis.Z).group_by(SortBy.LENGTH)]
b = Box(1,2,3)
# (fix round 2: srt[0] and srt[-1] of .sort_by(Axis.X).sort_by(Axis.Y).sort_by(Axis.Z)
# are refused now; their Z keys are equal within float noise, see python-noise-seam)
out["picks"] = [sorted(tuple(e.center()) for e in b.edges().sort_by(Axis.Z)[0:4]),
                list(Cylinder(2,4).edges().filter_by(GeomType.CIRCLE).sort_by(Axis.Z)[-1].position_at(0.5))]
print("JSON" + json.dumps(out))
result = Box(1, 1, 1)
`));
  // Before the fix: union 84 edges, top group 12 x 5.0, longest 5.0; pocket 92 edges, vertical groups [16, 12].
  assert.deepEqual(got, ORACLE);
});

test('edges() is refused where OpenCascade\'s face merging is not determined by the Bend body', async () => {
  await refuses([
    // build123d merges these two full cylinders; Bend keeps two seamed faces.
    ['(Cylinder(3, 4) + Pos(0, 0, 4) * Cylinder(3, 4)).edges()', /full cylinder surface into several faces.*unify same domain/],
    // Bend splits the outer wall at the pocket floor (build123d: 6 edges, 4 circles; before the fix 9 and 6).
    ['(Cylinder(5, 4) - Pos(0, 0, 1) * Cylinder(2, 4)).edges()', /full cylinder surface into several faces/],
    // build123d: 4 faces, 5 edges; Bend one cylinder (before the fix 3 edges, silently).
    ['extrude(Circle(3), -4, both=True).edges()', /both=True.*4 faces, 5 edges/],
    ['(Pos(1, 0, 0) * extrude(Circle(3), 4, both=True)).edges()', /both=True/],
    ['(Box(10, 10, 10) - extrude(Circle(2), 6, both=True)).edges()', /both=True/],
  ]);
  // Only the edge query is refused: the solid itself is exact.
  const model = await build('from build123d import *\nresult = extrude(Circle(3), -4, both=True)\nprint(round(result.volume, 9))\n');
  assert.equal(model.execution.stdout.trim(), '226.194671058');
});

test('a profile edge at or below Bend\'s resolvable length is refused, never built into an invalid solid', async () => {
  await refuses([
    // build123d: a valid 6-face solid (it merges the 2e-10 mm sides); Bend built 16/24/10 with 2e-10 mm edges, STEP 0 solids.
    ['extrude(RectangleRounded(10, 6, 3 - 1e-10), 1)', /profile line 0 is 2\.000e-10 mm long.*sub-tolerance edge merge/],
    ['extrude(RectangleRounded(10, 6, 3 - 1e-4), 1)', /edge \d+ is 2\.000e-4 mm long, at or below the 3\.000e-4 mm Bend resolves/],
    ['extrude(RectangleRounded(10, 6, 1e-6), 2)', /sub-tolerance/],
  ]);
});

test('a near-collinear polygon vertex is refused instead of merged; exactly collinear vertices merge as in build123d', async () => {
  await refuses([
    // build123d: 119999.98 mm³, 15 edges; before the fix Bend gave 120000.0 and 12 edges, recorded only as 'regularized'.
    ['extrude(Polygon((0, 0), (200, 1e-4), (400, 0), (400, 300), (0, 300)), 1)', /vertex 1 \(200, 0\.0001\) lies 1\.000e-4 mm off.*near-collinear profile vertex/],
    ['extrude(Polygon((0, 0), (2, 5e-6), (4, 0), (4, 3), (0, 3)), 1)', /vertex 1 .* lies 5\.000e-6 mm off/],
  ]);
});

test('selections that depend on OpenCascade\'s edge order or direction are capability errors', async () => {
  const order = /ShapeList.* is not implemented here: it picks among edges whose order build123d takes from OpenCascade/;
  const direction = /depends on the edge's direction/;
  const line = 'Cylinder(2, 4).edges().filter_by(GeomType.LINE)[0]';
  await refuses([
    // build123d picks (-0.5, 0, -1.5), Bend's order gave (0, -1, -1.5).
    ['Box(1, 2, 3).edges().sort_by(Axis.Z)[0]', order],
    // Equal Z keys: OpenCascade may order them by rounding noise (fix round 2).
    ['Box(1, 2, 3).edges().sort_by(Axis.X).sort_by(Axis.Y).sort_by(Axis.Z)[0]', order],
    ['Box(1, 2, 3).edges().sort_by(Axis.X).sort_by(Axis.Y).sort_by(Axis.Z)[-1]', order],
    ['Box(1, 2, 3).edges().first', order],
    ['Box(1, 2, 3).edges().group_by(Axis.Z)[-1][0]', order],
    ['Box(1, 2, 3).edges().sort_by(Axis.Z)[1:3]', /ShapeList\[1:3:None\]/],
    ['Box(1, 2, 3).edges().pop()', /ShapeList\.pop/],
    ['(Box(1, 2, 3).edges() - Box(1, 2, 3).edges().filter_by(Axis.Z)).last', order],
    // build123d runs the bottom circle clockwise: (0, -2, -2); Bend gave (0, 2, -2).
    ['Cylinder(2, 4).edges().filter_by(GeomType.CIRCLE).sort_by(Axis.Z)[0].position_at(0.25)', /position_at\(0\.25\).*direction/],
    [`${line}.start_point()`, direction],
    [`${line}.end_point()`, direction],
    [`${line}.tangent_at(0.5)`, direction],
    [`${line} @ 0.25`, direction],
    [`${line} % 0.5`, direction],
  ]);
});

// A synthetic body: a disc whose top face Bend split along a diameter, so the
// top circle is three arcs and the diameter an edge between two faces of one
// plane. Unified, the top is one full circle whose seam is the vertex the side
// face's seam line keeps (as in build123d's Cylinder).
test('unified edge records merge split planar faces and chain co-circular arcs into one circle', () => {
  const circle = z => ({ type: 'circle', origin: [0, 0, z], normal: [0, 0, 1], x: [1, 0, 0], radius: 2 });
  const plane = (z, sameSense) => ({ surface: { type: 'plane', origin: [0, 0, z], normal: [0, 0, 1], x: [1, 0, 0] }, sameSense });
  const body = {
    vertices: [[0, 2, 1], [0, -2, 1], [2, 0, 0], [2, 0, 1]],
    edges: [
      { start: 3, end: 0, curve: circle(1), curveRange: [0, Math.PI / 2] },
      { start: 0, end: 1, curve: circle(1), curveRange: [Math.PI / 2, 3 * Math.PI / 2] },
      { start: 1, end: 3, curve: circle(1), curveRange: [3 * Math.PI / 2, 2 * Math.PI] },
      { start: 0, end: 1, curve: { type: 'line', origin: [0, 2, 1], direction: [0, -1, 0] } },
      { start: 2, end: 2, curve: circle(0) },
      { start: 2, end: 3, curve: { type: 'line', origin: [2, 0, 0], direction: [0, 0, 1] } },
    ],
    faces: [
      { ...plane(1, true), loops: [[{ edge: 1, forward: true }, { edge: 3, forward: false }]] },
      { ...plane(1, true), loops: [[{ edge: 2, forward: true }, { edge: 0, forward: true }, { edge: 3, forward: true }]] },
      { ...plane(0, false), loops: [[{ edge: 4, forward: false }]] },
      { surface: { type: 'cylinder', origin: [0, 0, 0], axis: [0, 0, 1], x: [1, 0, 0], radius: 2 }, sameSense: true,
        loops: [[{ edge: 4, forward: true }, { edge: 5, forward: true }, { edge: 2, forward: false }, { edge: 1, forward: false },
          { edge: 0, forward: false }, { edge: 5, forward: false }]] },
    ],
  };
  const records = unifiedEdgeRecords(null, body, 0);
  assert.deepEqual(records.map(r => [r.curve, r.index, r.closed ?? false, r.merged ?? 1]), [['circle', 0, true, 3], ['circle', 4, true, 1], ['line', 5, false, 1]]);
  const top = records[0];
  assert.deepEqual(top.start, [2, 0, 1]);
  assert.equal(top.seam, undefined);
  assert.ok(Math.abs(top.length - 4 * Math.PI) < 1e-12);
  // Without the seam line the three arcs form a cycle: the seam is OCCT's choice.
  const cycle = structuredClone(body);
  cycle.faces[3].loops[0] = cycle.faces[3].loops[0].filter(use => use.edge !== 5);
  cycle.faces[2].loops[0].push({ edge: 5, forward: true }, { edge: 5, forward: false });
  cycle.edges[5] = { start: 2, end: 2, curve: circle(0) };
  const cycled = unifiedEdgeRecords(null, cycle, 0).find(r => r.merged === 3);
  assert.equal(cycled.seam, 'unknown');
});

}
