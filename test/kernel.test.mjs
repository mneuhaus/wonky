import test from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missingBend();
if (publicTreeSkip) {
  test("kernel.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { readFileSync } = await import("node:fs");
const { build } = await import("../src/index.mjs");
const { toStep, toStl } = await import("../src/exporters.mjs");
const { cross, dot, signedArea, validateSolid } = await import("../src/brep.mjs");
const { loadKernel, extrudeInBend } = await import("../src/kernel.mjs");








const example = name => readFileSync(new URL(`../examples/${name}.fs`, import.meta.url), 'utf8');
const header = 'FeatureScript 3000; import(path : "onshape/std/geometry.fs", version : "3000.0");';
const feature = body => `${header}\nexport function main(context is Context, id is Id, definition is map) { ${body} }`;
const cube = (id = 'box', corner = 'vector(10,20,30) * millimeter') => `fCuboid(context,id + "${id}",{"corner1":vector(0,0,0)*millimeter,"corner2":${corner}});`;
const near = (actual, expected, epsilon = 1e-5) => assert.ok(Math.abs(actual - expected) <= Math.max(1e-5, Math.abs(expected) * epsilon), `${actual} != ${expected}`);
function profile(points, { depth = '7 * millimeter', direction = 'vector(0,0,1)', origin = 'vector(0,0,0)*millimeter', normal = 'vector(0,0,1)', extra = '' } = {}) {
  const closed = [...points, points[0]].map(p => `vector(${p.join(',')})*millimeter`).join(',');
  return feature(`var s = newSketchOnPlane(context,id+"s",{"sketchPlane":plane(${origin},${normal},vector(1,0,0))});
    skPolyline(s,"p",{"points":[${closed}]}); skSolve(s);
    opExtrude(context,id+"e",{"entities":qSketchRegion(id+"s"),"direction":${direction},"endBound":BoundingType.BLIND,"endDepth":${depth}${extra}});`);
}

for (const [name, counts, volume, area] of [
  ['box', [8, 12, 6], 4000, 2200],
  ['bracket', [12, 18, 8], 8832, 3648],
  ['tilted-plate', [8, 12, 6], 1000, 700],
]) test(`${name}: analytic volume, area, shared topology, closed shell`, async () => {
  const model = await build(example(name)), body = model.bodies[0], v = body.validation;
  assert.equal(model.backend.language, 'Bend'); assert.equal(model.backend.precision, 'F32x2');
  assert.deepEqual([v.vertices, v.edges, v.faces], counts);
  assert.equal(v.eulerCharacteristic, 2); assert.equal(v.closed, true);
  near(v.volumeMm3, volume); near(v.areaMm2, area);
  const edgeUses = body.edges.map((_, id) => body.faces.flatMap(f => f.loops[0]).filter(use => use.edge === id));
  assert.ok(edgeUses.every(uses => uses.length === 2 && uses[0].forward !== uses[1].forward));
});

test('parameters use FeatureScript units and defineFeature defaults', async () => {
  const model = await build(example('box'), { parameters: { width: '2 * inch' } });
  near(model.bodies[0].validation.volumeMm3, 5080);
  // std units.fs isLength(val) is false for a unitless number, so the
  // valueBounds.fs isLength(value, boundSpec) precondition fails.
  await assert.rejects(build(example('box'), { parameters: { width: '40' } }), /precondition failed/);
  await assert.rejects(build(example('box'), { parameters: { width: '-1 * millimeter' } }), /precondition failed/);
});

test('clockwise polygons, negative and oblique sweeps keep outward orientation', async () => {
  const points = [[0, 0], [20, 0], [20, 10], [0, 10]];
  for (const source of [
    profile([...points].reverse()),
    profile(points, { depth: '-7 * millimeter' }),
    profile(points, { direction: 'vector(0,0,-1)' }),
    profile(points, { direction: 'vector(3,0,4)', depth: '10 * millimeter' }),
  ]) {
    const body = (await build(source)).bodies[0];
    near(body.validation.volumeMm3, source.includes('vector(3,0,4)') ? 1600 : 1400);
    assert.equal(body.validation.closed, true);
  }
});

test('concave first corner and deterministic generated polygons', async () => {
  const l = [[18, 12], [18, 40], [0, 40], [0, 0], [50, 0], [50, 12]];
  near((await build(profile(l))).bodies[0].validation.volumeMm3, 1104 * 7);
  for (let n = 3; n <= 24; n++) {
    const points = Array.from({ length: n }, (_, i) => {
      const angle = i * 2 * Math.PI / n, radius = 10 + (i % 3) * 3;
      return [Math.cos(angle) * radius, Math.sin(angle) * radius];
    });
    if (n % 2) points.reverse();
    const body = (await build(profile(points, { origin: 'vector(23,-12,45)*millimeter' }))).bodies[0];
    near(body.validation.volumeMm3, Math.abs(signedArea(points)) * 7);
    assert.deepEqual([body.vertices.length, body.edges.length, body.faces.length], [2 * n, 3 * n, n + 2]);
  }
});

test('startDepth moves the starting cap opposite the extrusion direction', async () => {
  const body = (await build(profile([[0, 0], [10, 0], [10, 5], [0, 5]], {
    depth: '3 * millimeter', extra: ',"startBound":BoundingType.BLIND,"startDepth":2*millimeter',
  }))).bodies[0];
  near(body.validation.volumeMm3, 250);
  assert.deepEqual(body.validation.boundsMm, { min: [0, 0, -2], max: [10, 5, 3] });
});

test('functions, typed locals, for-in, conditionals, Id components and short circuit', async () => {
  const source = `${header}
  function width(value is number) returns number { return value ^ 2; }
  export function main(context is Context,id is Id,definition is map) {
    var count is number = 0;
    for (var i in [1,2,3]) {
      count += 1;
      if (false && missingFunction()) { missingFunction(); }
      if (i > 0) {
        fCuboid(context,id + ("box" ~ i),{"corner1":vector(i*20,0,0)*millimeter,
          "corner2":vector(i*20+width(i),10,2)*millimeter});
      }
    }
    if (count != 3) { missingFunction(); }
  }`;
  const model = await build(source);
  assert.deepEqual(model.bodies.map(b => b.id), ['model/box1', 'model/box2', 'model/box3']);
  near(model.bodies.reduce((s, b) => s + b.validation.volumeMm3, 0), 280);
});

test('STL triangulates a concave B-rep without filling the L notch', async () => {
  const model = await build(example('bracket'));
  const text = toStl(model);
  const vertices = [...text.matchAll(/vertex ([^\n]+)/g)].map(m => m[1].split(' ').map(Number));
  assert.equal(vertices.length, 60);
  let volume = 0; const incidence = new Map();
  for (let i = 0; i < vertices.length; i += 3) {
    const tri = vertices.slice(i, i + 3);
    volume += dot(tri[0], cross(tri[1], tri[2])) / 6;
    const center = [0, 1, 2].map(k => tri.reduce((s, p) => s + p[k], 0) / 3);
    assert.ok(center[0] <= 18 + 1e-9 || center[1] <= 12 + 1e-9, 'Triangle crosses the empty notch');
    for (let j = 0; j < 3; j++) {
      const endpoints = [JSON.stringify(tri[j]), JSON.stringify(tri[(j + 1) % 3])].sort();
      const key = endpoints.join(':'); incidence.set(key, (incidence.get(key) ?? 0) + 1);
    }
  }
  near(volume, 8832);
  assert.ok([...incidence.values()].every(count => count === 2));
});

test('STEP uses shared analytic edge curves and advanced planar faces', async () => {
  const model = await build(example('bracket')), step = toStep(model);
  assert.equal((step.match(/EDGE_CURVE\(/g) ?? []).length, 18);
  assert.equal((step.match(/ADVANCED_FACE\(/g) ?? []).length, 8);
  assert.equal((step.match(/PLANE\(/g) ?? []).length, 8);
  assert.ok(step.includes('MANIFOLD_SOLID_BREP(')); assert.ok(step.includes('SI_UNIT(.MILLI.,.METRE.)'));
  assert.equal(step, toStep(model));
});

test('validator detects broken connectivity, flipped coedges, and nonplanar vertices', async () => {
  const model = await build(example('box'));
  let body = structuredClone(model.bodies[0]); body.faces[0].loops[0][0].forward = !body.faces[0].loops[0][0].forward;
  assert.throws(() => validateSolid(body), /not closed|orientation/);
  body = structuredClone(model.bodies[0]); body.vertices[0][2] += 1;
  assert.throws(() => validateSolid(body), /analytic plane/);
  body = structuredClone(model.bodies[0]); body.edges[0].start = 999;
  assert.throws(() => validateSolid(body), /vertex reference/);
});

const rejections = [
  ['self crossing', () => profile([[0, 0], [10, 10], [0, 10], [10, 0]]), /self-intersecting/],
  // A straight-on collinear vertex is admitted (merged in Bend before extrusion,
  // test/profile-ring.test.mjs); a corner that reverses along its line is not.
  ['backtracking collinear edges', () => profile([[0, 0], [10, 0], [5, 0], [5, 5]]), /reverse direction/],
  ['over 4096 vertices', () => profile(Array.from({ length: 4097 }, (_, i) => [Math.cos(2 * Math.PI * i / 4097) * 50, Math.sin(2 * Math.PI * i / 4097) * 50].map(v => v.toFixed(9)))), /3–4096 vertices/],
  ['zero depth', () => profile([[0, 0], [10, 0], [0, 5]], { depth: '0*millimeter' }), /thickness/],
  ['parallel sweep', () => profile([[0, 0], [10, 0], [0, 5]], { direction: 'vector(1,0,0)' }), /thickness/],
  ['dimensionless corner', () => feature(cube('box', 'vector(10,20,30)')), /length with units/],
  ['duplicate ID', () => feature(cube() + cube()), /Duplicate operation ID/],
  ['units mismatch', () => feature('const x = 1*millimeter + 2;'), /Incompatible units/],
  ['incomplete boolean definition', () => feature('opBoolean(context,id,{});'), /Missing required field 'tools'/],
  ['unknown operation field', () => feature(cube().replace('"corner1":', '"fillet":true,"corner1":')), /fillet.*not supported/],
  ['open polyline', () => profile([[0, 0], [10, 0], [0, 5]]).replace('vector(0,0)*millimeter]}', 'vector(1,1)*millimeter]}'), /repeat its first point/],
  ['unsolved sketch', () => profile([[0, 0], [10, 0], [0, 5]]).replace('skSolve(s);', ''), /not been solved/],
  ['multiple profiles', () => profile([[0, 0], [10, 0], [0, 5]]).replace('skSolve(s);', 'skRectangle(s,"extra",{"firstCorner":vector(2,2)*millimeter,"secondCorner":vector(3,3)*millimeter});skSolve(s);'), /exactly one closed profile/],
  ['F32 collapse', () => feature('fCuboid(context,id+"b",{"corner1":vector(9999,9999,9999)*millimeter,"corner2":vector(9999.0001,9999.0001,9999.0001)*millimeter});'), /tolerance|collinear|thickness|collapsed/],
  ['nonboolean condition', () => feature('if (1) {' + cube() + '}'), /must be boolean/],
  ['constant assignment', () => feature('const x = 1; x = 2;'), /Cannot assign to constant/],
  ['local import', () => `${header.replace('onshape/std/geometry.fs', './evil.fs')} export function main() {}`, /Import.*not supported/],
  ['division by zero', () => feature('const x = 1 / 0;'), /Division by zero/],
];
for (const [name, source, pattern] of rejections) test(`reject ${name}`, async () => {
  await assert.rejects(build(source()), pattern);
});

test('unsupported calls retain source line and column', async () => {
  await assert.rejects(build(feature('\n opShell(context,id,{});')), error => error.line === 3 && error.column === 2 && /opShell/.test(error.message));
});

test('polygon prism coordinates are F32x2 words of the input, not F32 roundings (W2 re-baseline rule)', async () => {
  // The pinned last-bit values moved once with the F32x2 prism: -92.79 used to become
  // Math.fround(-92.79) = -92.79000091552734 and now decodes to -92.79000000000002.
  // extrudeInBend directly: the FS metre -> millimetre conversion adds its own float64 noise.
  const k = await loadKernel();
  const box = extrudeInBend(k, 'w2-words', [[-119, 4], [-92.79, 4], [-92.79, 46], [-119, 46]],
    { origin: [0, 0, -61], normal: [0, 0, 1], x: [1, 0, 0] }, [0, 0, 129]);
  const xs = [...new Set(box.vertices.map(v => v[0]))].sort((a, b) => a - b);
  assert.equal(box.precision, 'F32x2');
  assert.deepEqual(xs, [-119, -92.79000000000002]);
  assert.notEqual(xs[1], Math.fround(-92.79));
  assert.ok(Math.abs(xs[1] + 92.79) <= 2 ** -47 * 92.79);
  near(box.validation.volumeMm3, 26.21 * 42 * 129);
});

}
