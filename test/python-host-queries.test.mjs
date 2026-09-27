import test from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missingBend();
if (publicTreeSkip) {
  test("python-host-queries.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { chmodSync, mkdtempSync, realpathSync, rmSync, writeFileSync } = await import("node:fs");
const { tmpdir } = await import("node:os");
const { join } = await import("node:path");
const { buildPython } = await import("../src/python.mjs");
const { build } = await import("../src/index.mjs");
const { UnsupportedFeatureError } = await import("../src/errors.mjs");
// Host queries and compound Booleans of the Python bridge (W5b task E): the
// `edges` and `bounds` queries behind build123d Shape.edges() and
// bounding_box(), and Booleans whose operands hold several solids (or none),
// distributed over the binary Bend Boolean as exact set identities. Each query
// runs through the real protocol (build123d._request from Python). Oracle
// values (edge counts per geometry type, lengths, bounding boxes, solid counts,
// volumes, topology counts) were produced by build123d 0.13.0 itself
// (`uv run --no-project --with build123d==0.13.0`, 2026-09-23,
// tmp/w5b/e-host/oracle*.py -> oracle*.txt) and are frozen here.









const workspace = realpathSync(mkdtempSync(join(tmpdir(), 'wonky-python-queries-')));
const python = join(workspace, 'uv-python');
writeFileSync(python, '#!/bin/sh\nexec uv run --no-project --quiet python "$@"\n');
chmodSync(python, 0o755);
test.after(() => rmSync(workspace, { recursive: true, force: true }));

const run = (lines, options = {}) => buildPython([
  'import json',
  'import build123d as b',
  'from build123d import Box, Cylinder, Pos, RectangleRounded',
  'from ocp_vscode import show',
  'R = lambda op, **k: b.Shape._from_handle(b._request(op, **k))',
  'Q = lambda op, shape: print(json.dumps(b._request(op, handle=shape._handle)))',
  // RectangleRounded(10, 6, 1) extruded by 2 through task A's extrude_profile op.
  'def rounded():',
  '    face = RectangleRounded(10, 6, 1)._wonky_faces()[0]',
  '    return R("extrude_profile", profile=face["profile"], plane=face["plane"], amount=2, both=False, dir=None)',
  ...lines,
].join('\n') + '\n', { python, timeoutMs: 120000, ...options });
const printed = model => model.execution.stdout.trim().split('\n').map(line => JSON.parse(line));

const near = (actual, expected, tolerance = 1e-9) => assert.ok(Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(expected)), `${actual} != ${expected}`);
const nearList = (actual, expected, tolerance) => { assert.equal(actual.length, expected.length); actual.forEach((v, i) => near(v, expected[i], tolerance)); };
const kind = edge => ({ line: 'LINE', circle: 'CIRCLE' })[edge.curve];
const census = records => records.reduce((all, edge) => ({ ...all, [kind(edge)]: (all[kind(edge)] ?? 0) + 1 }), {});
const curveType = edge => edge.curve.type ?? edge.curve;
const topology = bodies => [bodies.length, ...['vertices', 'edges', 'faces'].map(key => bodies.reduce((sum, body) => sum + body[key].length, 0))];
const volumes = bodies => bodies.map(body => body.validation.volumeMm3).sort((a, b) => a - b);

// Every record restates its edge of the body JSON: vertex coordinates, carrier
// curve, sense and parameter interval; nothing is resampled or re-derived. The
// body is compared as JSON, like the bridge sends it (no signed zeros).
const json = value => JSON.parse(JSON.stringify(value));
function matchesBody(records, shown) {
  const bodies = json(shown);
  assert.equal(records.length, bodies.reduce((sum, body) => sum + body.edges.length, 0));
  for (const record of records) {
    const body = bodies[record.solid], edge = body.edges[record.index];
    assert.deepEqual(record.start, body.vertices[edge.start]);
    assert.deepEqual(record.end, body.vertices[edge.end]);
    assert.equal(record.curve, curveType(edge));
    assert.equal(record.sameSense, edge.sameSense !== false);
    if (edge.curveRange) assert.deepEqual(record.range, edge.curveRange);
    if (record.curve === 'circle') {
      assert.deepEqual([record.center, record.axis, record.x, record.radius], [edge.curve.origin, edge.curve.normal, edge.curve.x, edge.curve.radius]);
      if (edge.start === edge.end && !edge.curveRange) assert.equal(record.closed, true);
    } else if (typeof edge.curve === 'object') {
      assert.deepEqual(record.direction, json(edge.curve.direction.map(v => (edge.sameSense === false ? -v : v))));
    }
  }
}

test('edges of a box, a cylinder and a RectangleRounded extrusion restate the body JSON and match build123d', async () => {
  const model = await run([
    'box = Box(1, 2, 3)', 'cyl = Cylinder(2, 5)', 'rr = rounded()',
    'Q("edges", box)', 'Q("edges", cyl)', 'Q("edges", rr)',
    'show(box, cyl, rr, names=["box", "cyl", "rr"])',
  ]);
  const bodies = Object.fromEntries(model.bodies.map(body => [body.name, body]));
  const [box, cyl, rr] = printed(model);
  // build123d 0.13: (count, {geom_type: n}, total length, sorted lengths)
  const oracle = {
    box: [12, { LINE: 12 }, 24, [1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3]],
    cyl: [3, { CIRCLE: 2, LINE: 1 }, 30.132741228718, [5, 12.566370614, 12.566370614]],
    rr: [24, { LINE: 16, CIRCLE: 8 }, 76.566370614359, [...Array(8).fill(1.570796327), ...Array(8).fill(2), ...Array(4).fill(4), ...Array(4).fill(8)]],
  };
  for (const [name, records] of Object.entries({ box, cyl, rr })) {
    matchesBody(records, [bodies[name]]);
    const [count, kinds, total, lengths] = oracle[name];
    assert.equal(records.length, count, name);
    assert.deepEqual(census(records), kinds, name);
    near(records.reduce((sum, edge) => sum + edge.length, 0), total, 1e-11);
    nearList(records.map(edge => edge.length).sort((a, b) => a - b), lengths, 1e-9);
  }
  // The cylinder's rims are full circles; its seam runs along +Z.
  assert.deepEqual(cyl.filter(edge => edge.curve === 'circle').map(edge => [edge.closed, edge.range]), [[true, null], [true, null]]);
  assert.deepEqual(cyl.find(edge => edge.curve === 'line').direction, [0, 0, 1]);
  // The rounded rectangle's arcs are quarter turns of radius 1 (analytic, not polygonal).
  for (const arc of rr.filter(edge => edge.curve === 'circle')) { near(arc.radius, 1, 1e-12); near(arc.range[1] - arc.range[0], Math.PI / 2, 1e-12); }
});

test('bounds are the tight bounds build123d reports, over every solid of a compound', async () => {
  const model = await run([
    'box = Box(1, 2, 3)', 'cyl = Cylinder(2, 5)', 'pair = Box(2, 2, 2) + Pos(5, 0, 0) * Box(2, 2, 2)',
    'Q("bounds", box)', 'Q("bounds", cyl)', 'Q("bounds", pair)',
    'show(box, cyl, pair, names=["box", "cyl", "pair"])',
  ]);
  const [box, cyl, pair] = printed(model);
  const flat = bounds => [...bounds.min, ...bounds.max];
  assert.deepEqual(flat(box), [-0.5, -1, -1.5, 0.5, 1, 1.5]);
  assert.deepEqual(flat(cyl), [-2, -2, -2.5, 2, 2, 2.5]);
  assert.deepEqual(flat(pair), [-1, -1, -1, 6, 1, 1]);
  // Straight from the body JSON: vertex extent (planar) or Bend's evaluated bounds (frustum).
  const bodies = Object.fromEntries(model.bodies.map(body => [body.name, body]));
  assert.deepEqual(cyl, json(bodies.cyl.validation.boundsMm));
  assert.deepEqual(box, json(bodies.box.validation.boundsMm));
});

test('bounds of a body without evaluated tight bounds is a capability error, never invented', async () => {
  // build123d gives (-5,-3,0)..(5,3,2) here; Bend's line/arc extrusion states no bounds.
  await assert.rejects(run(['rr = rounded()', 'Q("bounds", rr)', 'show(rr)']), error => {
    assert.ok(error instanceof UnsupportedFeatureError, error.message);
    assert.match(error.message, /bounding_box is not implemented .*native Bend line\/arc sketch extrusion.*tight bounds/);
    return true;
  });
  // Its edges stay available: nothing about them is estimated.
  const model = await run(['rr = rounded()', 'Q("edges", rr)', 'show(rr)']);
  assert.equal(printed(model)[0].length, 24);
});

const header = 'FeatureScript 3044; import(path:"onshape/std/geometry.fs",version:"3044.0");';
const feature = body => `${header}export function main(context is Context,id is Id,definition is map){${body}}`;
const cuboid = (name, low, high) => `fCuboid(context,id+"${name}",{"corner1":vector(${low})*millimeter,"corner2":vector(${high})*millimeter});`;
const bodiesOf = name => `qCreatedBy(id+"${name}",EntityType.BODY)`;
const geometry = ({ vertices, edges, faces, validation }) => JSON.parse(JSON.stringify({ vertices, edges, faces, volume: validation.volumeMm3 }));

test('a disjoint union followed by a subtraction builds solid by solid and equals the FeatureScript result', async () => {
  const model = await run([
    'pair = Box(2, 2, 2) + Pos(5, 0, 0) * Box(2, 2, 2)',
    'Q("count", pair)',
    'result = pair - Pos(2.5, 0, 1) * Box(10, 1, 1)',
  ]);
  assert.deepEqual(printed(model), [2]);
  // build123d 0.13: 2 solids of volume 7 each. (Its topology, 32 vertices,
  // 48 edges and 20 faces, is not Bend's: planar arrangement results keep
  // their split coplanar faces, 2 x 24 / 44 / 22 here, in both frontends.)
  assert.equal(model.bodies.length, 2);
  volumes(model.bodies).forEach((v, i) => near(v, [7, 7][i]));
  const reference = await build(feature([
    cuboid('a', [-1, -1, -1], [1, 1, 1]), cuboid('b', [4, -1, -1], [6, 1, 1]), cuboid('tool', [-2.5, -0.5, 0.5], [7.5, 0.5, 1.5]),
    `opBoolean(context,id+"union",{"tools":qUnion([${bodiesOf('a')},${bodiesOf('b')}]),"operationType":BooleanOperationType.UNION});`,
    `opBoolean(context,id+"cut",{"targets":qUnion([${bodiesOf('a')},${bodiesOf('b')}]),"tools":${bodiesOf('tool')},"operationType":BooleanOperationType.SUBTRACTION});`,
  ].join('')));
  assert.deepEqual(model.bodies.map(geometry), reference.bodies.map(geometry));
});

test('compound operands follow build123d: split pieces, pairwise intersection, bridging union, compound + compound', async () => {
  const cases = {
    // name: [expression, build123d 0.13 solids, sorted solid volumes, Bend topology or null]
    // Primitives and untouched solids keep build123d's topology; Boolean
    // results carry Bend's split coplanar faces (see the test above).
    split: ['pair - Box(0.5, 3, 3)', 3, [3, 3, 8], null],
    common: ['pair & (Pos(2.5, 0, 0) * Box(10, 1, 1))', 2, [2, 2], null],
    bridge: ['pair + Pos(2.5, 0, 1) * Box(7, 1, 1)', 1, [21], null],
    bridgeFirst: ['Pos(2.5, 0, 1) * Box(7, 1, 1) + pair', 1, [21], null],
    quad: ['pair + (Pos(0, 5, 0) * Box(2, 2, 2) + Pos(5, 5, 0) * Box(2, 2, 2))', 4, [8, 8, 8, 8], [4, 32, 48, 24]],
    far: ['pair - Pos(50, 0, 0) * Box(1, 1, 1)', 2, [8, 8], [2, 16, 24, 12]],
    none: ['pair & (Pos(50, 0, 0) * Box(1, 1, 1))', 0, [], null],
  };
  for (const [name, [expression, solids, expected, counts]] of Object.entries(cases)) {
    const model = await run(['pair = Box(2, 2, 2) + Pos(5, 0, 0) * Box(2, 2, 2)', `shape = ${expression}`, 'print(len(shape))',
      'show(shape if shape else Box(1, 1, 1), names=["r"])']);
    assert.deepEqual(printed(model), [solids], name);
    if (!solids) continue;
    if (counts) assert.deepEqual(topology(model.bodies), counts, name);
    volumes(model.bodies).forEach((v, i) => near(v, expected[i]));
  }
});

test('empty host operands follow build123d 0.13: x + ∅ = ∅ + x = x, x − ∅ = x, ∅ − x and ∩ with ∅ fail', async () => {
  // Raw protocol: the Python classes answer most empty cases before reaching
  // the host, so the host's own rules are exercised on an empty handle directly.
  const model = await run([
    'H = lambda op, **k: b._request(op, **k)',
    'x, far = Box(2, 2, 2)._handle, (Pos(50, 0, 0) * Box(1, 1, 1))._handle',
    'e = H("boolean", left=x, right=far, operation="INTERSECTION")',
    'print(json.dumps([H("count", handle=e), H("bounds", handle=e), H("edges", handle=e)]))',
    'for label, left, right, op in [("x+e", x, e, "UNION"), ("e+x", e, x, "UNION"), ("x-e", x, e, "SUBTRACTION"), ("e-x", e, x, "SUBTRACTION"),',
    '                               ("x&e", x, e, "INTERSECTION"), ("e&x", e, x, "INTERSECTION"), ("e+e", e, e, "UNION")]:',
    '    try:',
    '        h = H("boolean", left=left, right=right, operation=op)',
    '        print(json.dumps([label, H("count", handle=h), H("volume", handle=h)]))',
    '    except Exception as error:',
    '        print(json.dumps([label, str(error)]))',
    'result = Box(2, 2, 2)',
  ]);
  const [empty, ...rows] = printed(model);
  // No solids, no edges, and no bounds: build123d reports an all-zero BoundBox
  // for an empty shape; the host says null and leaves that convention to Python.
  assert.deepEqual(empty, [0, null, []]);
  // build123d: x + e, x - e -> volume 8; e - x "Cannot subtract shape from empty
  // compound"; x & e, e & x "Cannot intersect shape with empty compound";
  // Part() + x -> x and Part() + Part() -> empty. (A Boolean-made empty
  // Compound on the left of + raises AssertionError in build123d; telling it
  // from Part() is the Python side's job.)
  for (const row of rows.filter(row => row.length === 3)) { near(row[2], row[0] === 'e+e' ? 0 : 8); row.pop(); }
  assert.deepEqual(rows, [
    ['x+e', 1], ['e+x', 1], ['x-e', 1],
    ['e-x', 'Cannot subtract shape from empty compound'],
    ['x&e', 'Cannot intersect shape with empty compound'],
    ['e&x', 'Cannot intersect shape with empty compound'],
    ['e+e', 0],
  ]);
});

}
