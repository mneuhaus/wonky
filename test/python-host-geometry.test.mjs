import test from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missingBend();
if (publicTreeSkip) {
  test("python-host-geometry.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { chmodSync, mkdtempSync, realpathSync, rmSync, writeFileSync } = await import("node:fs");
const { tmpdir } = await import("node:os");
const { join } = await import("node:path");
const { buildPython } = await import("../src/python.mjs");
const { build } = await import("../src/index.mjs");
const { extrudeInBend, loadKernel, transformInBend } = await import("../src/kernel.mjs");
const { UnsupportedFeatureError } = await import("../src/errors.mjs");
// Host geometry ops of the Python bridge (W5b task A): transform, extrude_profile
// and frustum, the Bend operations behind build123d Location/Rot, Polygon,
// Circle, RectangleRounded and Cone. Each op runs through the real protocol
// (build123d._request from Python) and must build the same body as the
// FeatureScript construction of the same profile (skPolyline / skCircle /
// skLineSegment + skArc with opExtrude, opLoft, opPattern). Oracle values
// (volume, bounding box, vertex/edge/face counts) were produced by build123d
// 0.13.0 itself (`uv run --no-project --with build123d==0.13.0`, 2026-09-23,
// tmp/w5b/a-host/oracle.py) and are frozen here. Python runs through `uv run`.










const workspace = realpathSync(mkdtempSync(join(tmpdir(), 'wonky-python-host-')));
const python = join(workspace, 'uv-python');
writeFileSync(python, '#!/bin/sh\nexec uv run --no-project --quiet python "$@"\n');
chmodSync(python, 0o755);
test.after(() => rmSync(workspace, { recursive: true, force: true }));

const XY = { origin: [0, 0, 0], x: [1, 0, 0], normal: [0, 0, 1] };
const py = value => JSON.stringify(value ?? null).replaceAll('null', 'None').replaceAll('true', 'True').replaceAll('false', 'False');
// One Python run; `shapes` maps output names to Python expressions over R(op, ...).
async function host(shapes, { trace = true } = {}) {
  const names = Object.keys(shapes);
  const model = await buildPython([
    'import build123d as b',
    'from ocp_vscode import show',
    'R = lambda op, **k: b.Shape._from_handle(b._request(op, **k))',
    ...names.map(name => `${name} = ${shapes[name]}`),
    `show(${names.join(', ')}, names=${JSON.stringify(names)})`,
  ].join('\n') + '\n', { python, timeoutMs: 120000, trace });
  return Object.fromEntries(model.bodies.map(body => [body.name, body]));
}
const extrude = (profile, amount, { plane = XY, both = false, dir = null } = {}) =>
  `R("extrude_profile", profile=${py(profile)}, plane=${py(plane)}, amount=${py(amount)}, both=${py(both)}, dir=${py(dir)})`;
const frustum = (r0, r1, height, align = ['CENTER', 'CENTER', 'CENTER']) => `R("frustum", r0=${py(r0)}, r1=${py(r1)}, height=${py(height)}, align=${py(align)})`;
const transform = (shape, rows, offset) => `R("transform", handle=(${shape})._handle, rows=${py(rows)}, offset=${py(offset)})`;

const featureScript = body => build(`FeatureScript 3044;
import(path:"onshape/std/common.fs",version:"3044.0");
export function main(context is Context,id is Id,definition is map) {
${body}
}`);
const sketch = (name, { origin = [0, 0, 0], normal = [0, 0, 1], x = [1, 0, 0] } = {}) =>
  `var ${name}=newSketchOnPlane(context,id+"${name}",{"sketchPlane":plane(vector(${origin})*meter,vector(${normal}),vector(${x}))});`;
const v2 = ([x, y]) => `vector(${x},${y})*meter`;
const extrudeFs = (name, direction, depth, start) => `opExtrude(context,id+"ex${name}",{"entities":qSketchRegion(id+"${name}",false),"direction":vector(${direction}),"endBound":BoundingType.BLIND,"endDepth":${depth}*meter${start === undefined ? '' : `,"startBound":BoundingType.BLIND,"startDepth":${start}*meter`}});`;

const geometry = body => ({ vertices: body.vertices, edges: body.edges, faces: body.faces });
const near = (actual, expected, tolerance = 1e-9) => assert.ok(Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(expected)), `${actual} != ${expected}`);
const counts = body => [body.vertices.length, body.edges.length, body.faces.length];
const extent = body => [0, 1, 2].map(k => [Math.min(...body.vertices.map(p => p[k])), Math.max(...body.vertices.map(p => p[k]))]);
function oracle(body, { volume, min, max, topology }, tolerance = 1e-9) {
  near(body.validation.volumeMm3, volume, tolerance);
  const bounds = body.validation.boundsMm ?? { min: extent(body).map(e => e[0]), max: extent(body).map(e => e[1]) };
  bounds.min.forEach((v, i) => near(v, min[i], 1e-6));
  bounds.max.forEach((v, i) => near(v, max[i], 1e-6));
  assert.deepEqual(counts(body), topology);
}

// Metres as FeatureScript reads them; the host receives the millimetres
// FeatureScript derives from them (length() = value * 1000), so both builds see
// the same numbers.
const mm = m => m * 1000;
// Planar Bend bodies at fceffef store F32 vertices (kernel.mjs vector()): a
// rotated or oblique prism's volume then differs from the oracle by F32
// rounding, measured 8.8e-9 (Location * Box) and 4.5e-8 (oblique dir) relative.
// W2's F32x2 polygon prism / rigid transform (in progress, 2026-09-23) measured
// 5e-15. The bound covers both and is asserted, not hidden.
const F32 = 1e-7;

test('Polygon profiles extrude like FeatureScript skPolyline + opExtrude (amount, both, negative, dir, Plane.XZ)', async () => {
  const tri = [[0, 0], [0.004, 0], [0, 0.002]], rect = [[-0.001, -0.002], [0.001, -0.002], [0.001, 0.002], [-0.001, 0.002]];
  const polygon = points => ({ kind: 'polygon', points: points.map(p => p.map(mm)) });
  const XZ = { origin: [0, 0, 0], x: [1, 0, 0], normal: [0, -1, 0] };
  const got = await host({
    tri: extrude(polygon(tri), 3), neg: extrude(polygon(tri), -3), both: extrude(polygon(tri), 3, { both: true }),
    oblique: extrude(polygon(rect), 3, { dir: [0, 1, 1] }), xz: extrude(polygon(rect), 3, { plane: XZ }),
    z2: extrude(polygon(rect), 3, { dir: [0, 0, 2] }), rect: extrude(polygon(rect), 3),
  });
  // build123d normalizes dir: extrude(Rectangle(2, 4), 3, dir=(0, 0, 2)) is the plain 24 mm³ prism.
  assert.deepEqual(geometry(got.z2), geometry(got.rect));
  const polyline = points => `skPolyline(s,"p",{"points":[${[...points, points[0]].map(v2)}]}); skSolve(s);`;
  const fs = async (points, direction, depth, start, frame) => (await featureScript(`${sketch('s', frame)} ${polyline(points)} ${extrudeFs('s', direction, depth, start)}`)).bodies[0];
  assert.deepEqual(geometry(got.tri), geometry(await fs(tri, [0, 0, 1], 0.003)));
  assert.deepEqual(geometry(got.both), geometry(await fs(tri, [0, 0, 1], 0.003, 0.003)));
  assert.deepEqual(geometry(got.oblique), geometry(await fs(rect, [0, 1, 1], 0.003)));
  assert.deepEqual(geometry(got.xz), geometry(await fs(rect, [0, -1, 0], 0.003, undefined, { normal: [0, -1, 0] })));
  // build123d oracle: extrude(Polygon((0,0),(4,0),(0,2)), 3 | -3 | 3, both=True),
  // extrude(Rectangle(2, 4), 3, dir=(0, 1, 1)), extrude(Plane.XZ * Rectangle(2, 4), 3).
  oracle(got.tri, { volume: 12, min: [0, 0, 0], max: [4, 2, 3], topology: [6, 9, 5] });
  oracle(got.neg, { volume: 12, min: [0, 0, -3], max: [4, 2, 0], topology: [6, 9, 5] });
  oracle(got.both, { volume: 24, min: [0, 0, -3], max: [4, 2, 3], topology: [6, 9, 5] });
  oracle(got.oblique, { volume: 16.970562748, min: [-1, -2, 0], max: [1, 4.121320344, 2.121320344], topology: [8, 12, 6] }, F32);
  oracle(got.xz, { volume: 24, min: [-1, -3, -2], max: [1, 0, 2], topology: [8, 12, 6] });
  oracle(got.z2, { volume: 24, min: [-1, -2, 0], max: [1, 2, 3], topology: [8, 12, 6] });
  // build123d: extrude(Rectangle(2, 4), 0) raises Standard_Failure (BRepSweep_Translation); a geometry error, not a capability.
  await assert.rejects(host({ flat: extrude(polygon(rect), 0) }), error => !(error instanceof UnsupportedFeatureError) && /zero or unresolved thickness/.test(error.message));
});

test('Circle profiles extrude to the analytic frustum primitive like skCircle + opExtrude; oblique circles are a capability error', async () => {
  const circle = (center, radius) => ({ kind: 'circle', center: center.map(mm), radius: mm(radius) });
  const got = await host({ cyl: extrude(circle([0, 0], 0.002), 5), both: extrude(circle([0, 0], 0.002), 5, { both: true }), off: extrude(circle([0.003, 0.001], 0.002), 5) });
  const fs = async (center, start) => (await featureScript(`${sketch('s')} skCircle(s,"c",{"center":${v2(center)},"radius":0.002*meter}); skSolve(s); ${extrudeFs('s', [0, 0, 1], 0.005, start)}`)).bodies[0];
  assert.deepEqual(geometry(got.cyl), geometry(await fs([0, 0])));
  assert.deepEqual(geometry(got.both), geometry(await fs([0, 0], 0.005)));
  assert.deepEqual(geometry(got.off), geometry(await fs([0.003, 0.001])));
  for (const body of Object.values(got)) assert.equal(body.primitive.type, 'frustum');
  assert.deepEqual(got.cyl.faces.map(f => f.surface.type).sort(), ['cylinder', 'plane', 'plane']);
  // Oracle: extrude(Circle(2), 5), both=True, extrude(Pos(3, 1) * Circle(2), 5): CYLINDER + 2 PLANE, 2/3/3.
  oracle(got.cyl, { volume: 62.831853072, min: [-2, -2, 0], max: [2, 2, 5], topology: [2, 3, 3] }, 1e-10);
  oracle(got.both, { volume: 125.663706144, min: [-2, -2, -5], max: [2, 2, 5], topology: [2, 3, 3] }, 1e-10);
  oracle(got.off, { volume: 62.831853072, min: [1, -1, 0], max: [5, 3, 5], topology: [2, 3, 3] }, 1e-10);
  // build123d builds an EXTRUSION surface here (volume 44.428829382); Bend has none.
  await assert.rejects(host({ c: extrude(circle([0, 0], 0.002), 5, { dir: [0, 1, 1] }) }),
    error => error instanceof UnsupportedFeatureError && /oblique circular extrusion/.test(error.message));
});

// RectangleRounded(10, 6, 1): 4 lines + 4 three-point corner arcs (task C's profile shape).
function roundedRectangle(width, height, radius) {
  const [a, b, d] = [width / 2, height / 2, Math.SQRT1_2 * radius];
  const corner = (cx, cy, sx, sy) => [cx + sx * d, cy + sy * d];
  return [
    { type: 'line', start: [-a + radius, -b], end: [a - radius, -b] },
    { type: 'arc', start: [a - radius, -b], mid: corner(a - radius, -b + radius, 1, -1), end: [a, -b + radius] },
    { type: 'line', start: [a, -b + radius], end: [a, b - radius] },
    { type: 'arc', start: [a, b - radius], mid: corner(a - radius, b - radius, 1, 1), end: [a - radius, b] },
    { type: 'line', start: [a - radius, b], end: [-a + radius, b] },
    { type: 'arc', start: [-a + radius, b], mid: corner(-a + radius, b - radius, -1, 1), end: [-a, b - radius] },
    { type: 'line', start: [-a, b - radius], end: [-a, -b + radius] },
    { type: 'arc', start: [-a, -b + radius], mid: corner(-a + radius, -b + radius, -1, -1), end: [-a + radius, -b] },
  ];
}

test('Line/arc profiles (RectangleRounded) extrude like skLineSegment + skArc + opExtrude with analytic arcs', async () => {
  const entities = roundedRectangle(10, 6, 1), profile = { kind: 'line-arc', entities };
  const YZ = { origin: [0, 0, 0], x: [0, 1, 0], normal: [1, 0, 0] };
  const got = await host({ rr: extrude(profile, 2), both: extrude(profile, 2, { both: true }), yz: extrude(profile, 2, { plane: YZ }) });
  // FeatureScript gets the same SI values the host derives (mm / 1000).
  const si = p => `vector(${p.map(v => v / 1000)})*meter`;
  const calls = entities.map((e, i) => e.type === 'line' ? `skLineSegment(s,"e${i}",{"start":${si(e.start)},"end":${si(e.end)}});`
    : `skArc(s,"e${i}",{"start":${si(e.start)},"mid":${si(e.mid)},"end":${si(e.end)}});`).join(' ');
  const fs = async (start, frame, direction = [0, 0, 1]) => (await featureScript(`${sketch('s', frame)} ${calls} skSolve(s); ${extrudeFs('s', direction, 0.002, start)}`)).bodies[0];
  assert.deepEqual(geometry(got.rr), geometry(await fs()));
  assert.deepEqual(geometry(got.both), geometry(await fs(0.002)));
  assert.deepEqual(geometry(got.yz), geometry(await fs(undefined, { normal: [1, 0, 0], x: [0, 1, 0] }, [1, 0, 0])));
  for (const body of Object.values(got)) {
    assert.equal(body.edges.filter(e => e.curve.type === 'circle').length, 8);
    assert.equal(body.faces.filter(f => f.surface.type === 'cylinder').length, 4);
    assert.equal(body.sketchProfile.entities.length, 8);
    assert.equal(body.validation.boundsMm, null, 'tight bounds of a line/arc extrusion are not evaluated; none are invented');
  }
  // Oracle: extrude(RectangleRounded(10, 6, 1), 2), both=True, Plane.YZ *: 16/24/10,
  // 4 CYLINDER + 6 PLANE faces. The extreme points are line endpoints, so the
  // vertex extent equals the oracle bounding box.
  oracle(got.rr, { volume: 118.283185307, min: [-5, -3, 0], max: [5, 3, 2], topology: [16, 24, 10] });
  oracle(got.both, { volume: 236.566370614, min: [-5, -3, -2], max: [5, 3, 2], topology: [16, 24, 10] });
  oracle(got.yz, { volume: 118.283185307, min: [0, -5, -3], max: [2, 5, 3], topology: [16, 24, 10] });
  await assert.rejects(host({ r: extrude(profile, 2, { dir: [0, 1, 1] }) }),
    error => error instanceof UnsupportedFeatureError && /oblique line\/arc extrusion/.test(error.message));
});

test('frustum builds build123d Cone(r0, r1, h, align) like FeatureScript opLoft of two skCircles; an apex is a capability error', async () => {
  const got = await host({ cone: frustum(3, 1, 2), min: frustum(3, 1, 2, ['MIN', 'MIN', 'MIN']), inv: frustum(1, 3, 2), max: frustum(3, 1, 2, ['MAX', 'MIN', 'MAX']) });
  const loft = (z0, z1, r0, r1) => `${sketch('a', { origin: [0, 0, z0] })} skCircle(a,"c",{"center":${v2([0, 0])},"radius":${r0}*meter}); skSolve(a);
${sketch('b', { origin: [0, 0, z1] })} skCircle(b,"c",{"center":${v2([0, 0])},"radius":${r1}*meter}); skSolve(b);
opLoft(context,id+"loft",{"profileSubqueries":[qSketchRegion(id+"a",false),qSketchRegion(id+"b",false)]});`;
  assert.deepEqual(geometry(got.cone), geometry((await featureScript(loft(-0.001, 0.001, 0.003, 0.001))).bodies[0]));
  assert.deepEqual(geometry(got.inv), geometry((await featureScript(loft(-0.001, 0.001, 0.001, 0.003))).bodies[0]));
  for (const body of Object.values(got)) {
    assert.equal(body.primitive.type, 'frustum');
    assert.deepEqual(body.faces.map(f => f.surface.type).sort(), ['cone', 'plane', 'plane']);
  }
  // Oracle: Cone(3, 1, 2) centered, align=Align.MIN, Cone(1, 3, 2), align=(MAX, MIN, MAX): CONE + 2 PLANE, 2/3/3.
  oracle(got.cone, { volume: 27.227136331, min: [-3, -3, -1], max: [3, 3, 1], topology: [2, 3, 3] }, 1e-10);
  oracle(got.min, { volume: 27.227136331, min: [0, 0, 0], max: [6, 6, 2], topology: [2, 3, 3] }, 1e-10);
  oracle(got.inv, { volume: 27.227136331, min: [-3, -3, -1], max: [3, 3, 1], topology: [2, 3, 3] }, 1e-10);
  oracle(got.max, { volume: 27.227136331, min: [-6, 0, -2], max: [0, 6, 0], topology: [2, 3, 3] }, 1e-10);
  // build123d: Cone(3, 0, 2) is a valid 18.849555922 mm³ cone with an apex; Bend has no apex.
  await assert.rejects(host({ c: frustum(3, 0, 2) }), error => error instanceof UnsupportedFeatureError && /'frustum apex'/.test(error.message));
  await assert.rejects(host({ c: frustum(0, 3, 2) }), error => error instanceof UnsupportedFeatureError && /'frustum apex'/.test(error.message));
  // build123d: Cone(2, 2, 3) raises Standard_Failure "cone with two identic radii".
  await assert.rejects(host({ c: frustum(2, 2, 3) }), error => !(error instanceof UnsupportedFeatureError) && /two identic radii/.test(error.message));
});

// build123d 0.13 Location matrices (oracle, gp_Trsf values).
const ROT_90_0_0 = [[1, -0, 0], [0, 2.220446049250313e-16, -1], [0, 1, 2.220446049250313e-16]];
const ROT_10_20_30 = [[0.8137976813493737, -0.46984631039295416, 0.34202014332566866], [0.5438381424823255, 0.823172944645501, -0.16317591116653485], [-0.20487412870286212, 0.3187957775971679, 0.9254165783983234]];
const ROT_30_45_60 = [[0.35355339059327373, -0.6123724356957945, 0.7071067811865477], [0.926776695296637, 0.12682648404432206, -0.35355339059327373], [0.1268264840443219, 0.7803300858899107, 0.6123724356957945]];
const ROT_0_0_90 = [[2.220446049250313e-16, -1, 0], [1, 2.220446049250313e-16, 0], [0, 0, 1]];

test('transform moves planar and analytic bodies rigidly like FeatureScript opPattern (Location, Rot)', async () => {
  const got = await host({
    loc: transform('b.Box(1, 2, 3)', ROT_10_20_30, [1, 2, 3]),
    rotz: transform('b.Box(2, 1, 1)', ROT_0_0_90, [0, 0, 0]),
    cone: transform(frustum(3, 1, 2), ROT_30_45_60, [0, 0, 0]),
  });
  const box = (l, w, h) => `${sketch('s', { origin: [-l / 2000, -w / 2000, -h / 2000] })} skPolyline(s,"p",{"points":[${[[0, 0], [l / 1000, 0], [l / 1000, w / 1000], [0, w / 1000], [0, 0]].map(v2)}]}); skSolve(s); ${extrudeFs('s', [0, 0, 1], h / 1000)}`;
  const pattern = (rows, offset) => `opPattern(context,id+"p",{"entities":qCreatedBy(id+"exs",EntityType.BODY),"transforms":[transform(matrix(${JSON.stringify(rows)}),vector(${offset})*meter)],"instanceNames":["one"]});`;
  const fsLoc = (await featureScript(`${box(1, 2, 3)} ${pattern(ROT_10_20_30, [0.001, 0.002, 0.003])}`)).bodies;
  assert.deepEqual(geometry(got.loc), geometry(fsLoc.at(-1)));
  // Oracle: Location((1, 2, 3), (10, 20, 30)) * Box(1, 2, 3); Rot(0, 0, 90) * Box(2, 1, 1); Rot(30, 45, 60) * Cone(3, 1, 2).
  oracle(got.loc, { volume: 6, min: [-0.389775366, 0.660144117, 1.19064229], max: [2.389775366, 3.339855883, 4.80935771], topology: [8, 12, 6] }, F32);
  oracle(got.rotz, { volume: 2, min: [-0.5, -1, -0.5], max: [0.5, 1, 0.5], topology: [8, 12, 6] }, F32);
  assert.equal(got.cone.primitive.type, 'frustum');
  oracle(got.cone, { volume: 27.227136331, min: [-2.828427125, -2.452689649, -2.984080681], max: [1.414213562, 3.159796431, 1.759335809], topology: [2, 3, 3] }, 1e-10);
});

test('a Rot(90, 0, 0)-rotated cylinder keeps its frustum primitive and still pierces a box', async () => {
  const got = await host({ rc: transform('b.Cylinder(1, 10)', ROT_90_0_0, [0, 0, 0]), pierced: `b.Box(4, 4, 4) - ${transform('b.Cylinder(1, 10)', ROT_90_0_0, [0, 0, 0])}` });
  assert.equal(got.rc.primitive.type, 'frustum');
  // Oracle: Rot(90, 0, 0) * Cylinder(1, 10); Box(4, 4, 4) - Rot(90, 0, 0) * Cylinder(1, 10).
  oracle(got.rc, { volume: 31.415926536, min: [-1, -5, -1], max: [1, 5, 1], topology: [2, 3, 3] }, 1e-10);
  assert.equal(got.pierced.construction.method, 'native Bend through-hole pierce');
  near(got.pierced.validation.volumeMm3, 51.433629386, 1e-10);
  assert.deepEqual(counts(got.pierced), [10, 15, 7]);
});

test('reflection and non-rigid matrices are capability errors naming the missing kernel operation', async () => {
  await assert.rejects(host({ m: transform('b.Box(1, 1, 1)', [[-1, 0, 0], [0, 1, 0], [0, 0, 1]], [0, 0, 0]) }),
    error => error instanceof UnsupportedFeatureError && /'reflection transform'/.test(error.message));
  await assert.rejects(host({ m: transform('b.Box(1, 1, 1)', [[2, 0, 0], [0, 1, 0], [0, 0, 1]], [0, 0, 0]) }),
    error => error instanceof UnsupportedFeatureError && /'scaled transform'/.test(error.message));
  await assert.rejects(host({ m: transform('b.Box(1, 1, 1)', [[1, 0.5, 0], [0, 1, 0], [0, 0, 1]], [0, 0, 0]) }),
    error => error instanceof UnsupportedFeatureError && /'scaled transform'/.test(error.message));
});

test('the existing translate op (Pos) stays bit-identical to the kernel calls it made before', async () => {
  // Without the source map, which annotates bodies after each op.
  const got = await host({ moved: 'b.Pos(1, 2, 3) * b.Box(1, 2, 3)', same: transform('b.Box(1, 2, 3)', [[1, 0, 0], [0, 1, 0], [0, 0, 1]], [1, 2, 3]) }, { trace: false });
  const kernel = await loadKernel();
  // Request ids follow the handle serial: Box = python/1, translate = python/2 (body python/2/0).
  const box = extrudeInBend(kernel, 'python/1', [[0, 0], [1, 0], [1, 2], [0, 2]], { origin: [-0.5, -1, -1.5], normal: [0, 0, 1], x: [1, 0, 0] }, [0, 0, 3], undefined, { primitive: 'box' });
  const expected = transformInBend(kernel, box, 'python/2/0', [[1, 0, 0], [0, 1, 0], [0, 0, 1]], [1, 2, 3]);
  const { name, ...moved } = got.moved;
  assert.equal(name, 'moved');
  assert.deepEqual(moved, expected);
  assert.deepEqual(geometry(got.same), geometry(expected));
});

}
