import test from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missingBend() || missing("local design note");
if (publicTreeSkip) {
  test("fs-revolve.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { readFileSync, existsSync } = await import("node:fs");
const { homedir } = await import("node:os");
const { build } = await import("../src/index.mjs");
const { toStep } = await import("../src/exporters.mjs");
const { FeatureScriptException, UnsupportedFeatureError } = await import("../src/errors.mjs");
// FeatureScript opRevolve (src/library.mjs) on the exact kernel revolve
// (kernel/revolve.bend `sweep`, docs/revolve.md), and the STEP export of its
// sphere and torus faces (src/exporters.mjs). local design note task 9.








const header = 'FeatureScript 3044; import(path:"onshape/std/common.fs",version:"3044.0");';
const run = body => build(`${header} export const main = defineFeature(function(context is Context, id is Id, definition is map) precondition {} { ${body} });`, { feature: 'main' });
const relative = (actual, expected) => Math.abs(actual - expected) / Math.abs(expected);
const volume = body => body.validation.volumeMm3;

// A closed polyline of skLineSegments in the plane through `origin` spanned by
// the axis direction (sketch x) and `radial` (sketch y), revolved about the
// line (origin, axis): points are (along axis, radial) as in the R20 cases.
const polygon = (name, points, { origin = '0, 0, 0', axis = '1, 0, 0', radial = '0, 1, 0', angle = '360 * degree', extra = '' } = {}) => `
  { var sk = newSketchOnPlane(context, id + "${name}sk", { "sketchPlane" : plane(vector(${origin}) * millimeter, cross(vector(${axis}), vector(${radial})), vector(${axis})) });
    const pts = [${points.map(([a, r]) => `vector(${a}, ${r})`).join(', ')}];
    for (var i = 0; i < size(pts); i += 1)
      skLineSegment(sk, "s" ~ i, { "start" : pts[i] * millimeter, "end" : pts[(i + 1) % size(pts)] * millimeter });
    skSolve(sk);
    opRevolve(context, id + "${name}", { "entities" : qSketchRegion(id + "${name}sk", false), "axis" : line(vector(${origin}) * millimeter, vector(${axis})), "angleForward" : ${angle}${extra} });
    opDeleteBodies(context, id + "${name}clean", { "entities" : qCreatedBy(id + "${name}sk", EntityType.BODY) }); }`;
// The R20 ksSphere: a three-point arc and a line on the axis, a full turn.
const sphere = (name, center, r, angle = '360 * degree') => `
  { var sk = newSketchOnPlane(context, id + "${name}sk", { "sketchPlane" : plane(vector(${center}) * millimeter, vector(0, -1, 0), vector(1, 0, 0)) });
    skArc(sk, "a", { "start" : vector(${-r}, 0) * millimeter, "mid" : vector(0, ${r}) * millimeter, "end" : vector(${r}, 0) * millimeter });
    skLineSegment(sk, "l", { "start" : vector(${r}, 0) * millimeter, "end" : vector(${-r}, 0) * millimeter });
    skSolve(sk);
    opRevolve(context, id + "${name}", { "entities" : qSketchRegion(id + "${name}sk", false), "axis" : line(vector(${center}) * millimeter, vector(1, 0, 0)), "angleForward" : ${angle} });
    opDeleteBodies(context, id + "${name}clean", { "entities" : qCreatedBy(id + "${name}sk", EntityType.BODY) }); }`;
// The R20 KS08 tube: an skCircle revolved about Z.
const torus = (name, major, minor, angle = '360 * degree') => `
  { var sk = newSketchOnPlane(context, id + "${name}sk", { "sketchPlane" : plane(vector(0, 0, 0) * millimeter, vector(0, -1, 0), vector(1, 0, 0)) });
    skCircle(sk, "c", { "center" : vector(${major}, 0) * millimeter, "radius" : ${minor} * millimeter });
    skSolve(sk);
    opRevolve(context, id + "${name}", { "entities" : qSketchRegion(id + "${name}sk", false), "axis" : line(vector(0, 0, 0) * millimeter, vector(0, 0, 1)), "angleForward" : ${angle} });
    opDeleteBodies(context, id + "${name}clean", { "entities" : qCreatedBy(id + "${name}sk", EntityType.BODY) }); }`;
const byId = (model, name) => model.bodies.find(body => body.id === `model/${name}`) ?? assert.fail(`no body ${name}`);
const surfaces = body => body.faces.map(face => face.surface.type).sort().join(',');
const extent = (body, k) => [Math.min(...body.vertices.map(p => p[k])), Math.max(...body.vertices.map(p => p[k]))];
// Every circular arc between two vertices states its domain; a circle edge
// without one is a full turn and must be closed on one vertex.
function assertDomains(body) {
  for (const edge of body.edges.filter(edge => edge.curve.type === 'circle')) {
    if (edge.start === edge.end) { assert.equal(edge.curveRange, undefined); continue; }
    const [first, last] = edge.curveRange ?? assert.fail(`body ${body.id}: arc without curveRange`);
    assert.ok(last > first && last - first < 2 * Math.PI, `${first}..${last}`);
    const c = edge.curve, y = [c.normal[1] * c.x[2] - c.normal[2] * c.x[1], c.normal[2] * c.x[0] - c.normal[0] * c.x[2], c.normal[0] * c.x[1] - c.normal[1] * c.x[0]];
    const at = t => c.origin.map((o, k) => o + c.radius * (Math.cos(t) * c.x[k] + Math.sin(t) * y[k]));
    const [from, to] = edge.sameSense ? [first, last] : [last, first];
    for (const [t, v] of [[from, edge.start], [to, edge.end]]) {
      assert.ok(Math.hypot(...at(t).map((p, k) => p - body.vertices[v][k])) < 1e-9, `body ${body.id}: domain end off its vertex`);
    }
  }
}

test('KT3a/KT3b profiles: partial sweeps within 1e-6 of the Onshape mass properties', async () => {
  const model = await run(`
    ${polygon('toAxis', [[0, 0], [30, 0], [30, 12], [20, 20], [0, 20]], { angle: '135 * degree' })}
    ${polygon('ring', [[40, 5], [60, 5], [60, 25], [40, 25]], { radial: '0, cos(30 * degree), sin(30 * degree)', angle: '60 * degree' })}`);
  const a = byId(model, 'toAxis'), b = byId(model, 'ring');
  assert.ok(relative(volume(a), 12503.538761287378) < 1e-6, `${volume(a)}`);
  assert.ok(relative(volume(b), 6283.185307179588) < 1e-6, `${volume(b)}`);
  assert.equal(surfaces(a), 'cone,cylinder,plane,plane,plane,plane');
  assert.equal(surfaces(b), 'cylinder,cylinder,plane,plane,plane,plane');
  // Right-handed about +X from +Y: the 135° end half plane lies at -Y/+Z.
  assert.deepEqual(extent(a, 0), [0, 30]);
  assert.ok(Math.abs(extent(a, 1)[0] + 20 * Math.SQRT1_2) < 1e-9 && Math.abs(extent(a, 1)[1] - 20) < 1e-12);
  assert.ok(Math.abs(extent(b, 2)[0] - 2.5) < 1e-9 && Math.abs(extent(b, 2)[1] - 25) < 1e-9, `${extent(b, 2)}`);
  for (const body of [a, b]) {
    assert.equal(body.construction.method, 'native Bend exact revolve');
    assertDomains(body);
  }
});

test('the KT1 relief cone and the KS03 profile shape: an axis segment in a tilted sketch', async () => {
  // m3ReliefTool: sketch x radial, sketch y along a tilted axis.
  const model = await run(`
    const axis = normalize(vector(1, 2, 2));
    const x = normalize(cross(axis, vector(0, 0, 1)));
    var sk = newSketchOnPlane(context, id + "sk", { "sketchPlane" : plane(vector(5, 6, 7) * millimeter, cross(x, axis), x) });
    skLineSegment(sk, "entry", { "start" : vector(0, 0) * millimeter, "end" : vector(2.1, 0) * millimeter });
    skLineSegment(sk, "slope", { "start" : vector(2.1, 0) * millimeter, "end" : vector(0, 2.1) * millimeter });
    skLineSegment(sk, "axis", { "start" : vector(0, 2.1) * millimeter, "end" : vector(0, 0) * millimeter });
    skSolve(sk);
    opRevolve(context, id + "cone", { "entities" : qSketchRegion(id + "sk", false), "axis" : line(vector(5, 6, 7) * millimeter, axis), "angleForward" : 360 * degree });`);
  const cone = byId(model, 'cone');
  assert.ok(relative(volume(cone), Math.PI * 2.1 ** 3 / 3) < 1e-12, `${volume(cone)}`);
  assert.equal(surfaces(cone), 'cone,plane');
});

test('full turns of an arc profile and a circle: sphere and torus carriers, exact volumes', async () => {
  const model = await run(`${sphere('s', '0, 0, 0', 5)} ${torus('t', 12, 3)} ${sphere('q', '40, 0, 0', 5, '90 * degree')} ${torus('p', 12, 3, '45 * degree')}`);
  const s = byId(model, 's'), t = byId(model, 't'), q = byId(model, 'q'), p = byId(model, 'p');
  assert.ok(relative(volume(s), 4 / 3 * Math.PI * 125) < 1e-12);
  assert.ok(relative(volume(t), 2 * Math.PI ** 2 * 12 * 9) < 1e-12);
  assert.ok(relative(volume(q), Math.PI * 125 / 3) < 1e-12);
  assert.ok(relative(volume(p), 2 * Math.PI ** 2 * 12 * 9 / 8) < 1e-12);
  assert.equal(surfaces(s), 'sphere');
  assert.equal(surfaces(t), 'torus');
  assert.equal(surfaces(q), 'plane,plane,sphere');
  assert.equal(surfaces(p), 'plane,plane,torus');
  assert.ok(Math.abs(s.faces[0].surface.radius - 5) < 1e-12);
  assert.deepEqual([t.faces[0].surface.major, t.faces[0].surface.minor], [12, 3]);
  for (const body of [s, t, q, p]) assertDomains(body);
  const step = toStep(model);
  assert.equal(step.match(/SPHERICAL_SURFACE\(/g).length, 2);
  assert.equal(step.match(/TOROIDAL_SURFACE\(/g).length, 2);
  assert.ok(!/DEGENERATE_TOROIDAL_SURFACE/.test(step));
});

test('KS06a/KS06b: the sphere tool far from the origin is the one at the origin, translated', async () => {
  const far = [137.3571428571, -58.8912345679, 4.7];
  const model = await run(`${sphere('a', `10, 4, ${6 - 0.15}`, 0.9)} ${sphere('b', `${far[0] + 10}, ${far[1] + 4}, ${far[2] + 6 - 0.15}`, 0.9)}`);
  const a = byId(model, 'a'), b = byId(model, 'b');
  assert.equal(volume(a), volume(b));
  assert.equal(JSON.stringify(a.edges.map(({ start, end, sameSense, curveRange }) => ({ start, end, sameSense, curveRange }))),
    JSON.stringify(b.edges.map(({ start, end, sameSense, curveRange }) => ({ start, end, sameSense, curveRange }))));
  assert.deepEqual(a.faces.map(f => f.loops), b.faces.map(f => f.loops));
  a.vertices.forEach((p, i) => assert.ok(Math.hypot(...p.map((v, k) => b.vertices[i][k] - v - far[k])) < 1e-9, `vertex ${i}`));
  const [sa, sb] = [a.faces[0].surface, b.faces[0].surface];
  assert.equal(sa.radius, sb.radius);
  assert.deepEqual([sa.axis, sa.x], [sb.axis, sb.x]);
  assert.ok(Math.hypot(...sa.origin.map((v, k) => sb.origin[k] - v - far[k])) < 1e-9);
});

test('winding, side and angle conventions', async () => {
  const square = [[0, 5], [10, 5], [10, 15], [0, 15]];
  const exact = Math.PI * (15 ** 2 - 5 ** 2) * 10;
  const model = await run(`
    ${polygon('ccw', square)}
    ${polygon('cw', [...square].reverse())}
    ${polygon('below', square.map(([a, r]) => [a, -r]))}
    ${polygon('neg', square, { angle: '-90 * degree' })}
    ${polygon('num', square, { angle: 'PI / 2' })}
    ${polygon('both', square, { angle: '360 * degree', extra: ', "angleBack" : 360 * degree' })}`);
  for (const name of ['ccw', 'cw', 'below', 'both']) assert.ok(relative(volume(byId(model, name)), exact) < 1e-12, name);
  // angleForward is normalized to [0, 2π): -90° ends at 270°.
  assert.ok(relative(volume(byId(model, 'neg')), exact * 3 / 4) < 1e-12);
  assert.ok(relative(volume(byId(model, 'num')), exact / 4) < 1e-12);
  // A profile drawn below the axis sweeps from its own half plane (-Y).
  assert.ok(extent(byId(model, 'below'), 1)[0] < -14.9);
});

test('named refusals: skew or offset axis, crossing profile, holes, angleBack, revolveType', async () => {
  const square = [[0, 5], [10, 5], [10, 15], [0, 15]];
  const refuses = async (body, type, pattern) => {
    await assert.rejects(run(body), error => error instanceof type && pattern.test(error.message) && Number.isInteger(error.line), String(pattern));
  };
  // The sketch plane contains X and Y; the axis leaves it.
  await refuses(`
    var sk = newSketchOnPlane(context, id + "sk", { "sketchPlane" : plane(vector(0, 0, 0) * millimeter, vector(0, 0, 1), vector(1, 0, 0)) });
    skRectangle(sk, "r", { "firstCorner" : vector(0, 5) * millimeter, "secondCorner" : vector(10, 15) * millimeter });
    skSolve(sk);
    opRevolve(context, id + "rev", { "entities" : qSketchRegion(id + "sk"), "axis" : line(vector(0, 0, 0) * millimeter, vector(1, 0, 1)), "angleForward" : 90 * degree });`,
  UnsupportedFeatureError, /axis does not lie in the sketch plane: it is not perpendicular/);
  await refuses(`
    var sk = newSketchOnPlane(context, id + "sk", { "sketchPlane" : plane(vector(0, 0, 0) * millimeter, vector(0, 0, 1), vector(1, 0, 0)) });
    skRectangle(sk, "r", { "firstCorner" : vector(0, 5) * millimeter, "secondCorner" : vector(10, 15) * millimeter });
    skSolve(sk);
    opRevolve(context, id + "rev", { "entities" : qSketchRegion(id + "sk"), "axis" : line(vector(0, 0, 1) * millimeter, vector(1, 0, 0)), "angleForward" : 90 * degree });`,
  UnsupportedFeatureError, /axis does not lie in the sketch plane: its origin is 1 mm off/);
  // Onshape fails a region that strictly intersects the axis: a catchable exception.
  await refuses(polygon('x', [[0, -5], [10, -5], [10, 15], [0, 15]]), FeatureScriptException, /crosses the axis/);
  await refuses(`
    var sk = newSketchOnPlane(context, id + "sk", { "sketchPlane" : plane(vector(0, 0, 0) * millimeter, vector(0, 0, 1), vector(1, 0, 0)) });
    skRectangle(sk, "outer", { "firstCorner" : vector(0, 5) * millimeter, "secondCorner" : vector(10, 15) * millimeter });
    skRectangle(sk, "hole", { "firstCorner" : vector(2, 7) * millimeter, "secondCorner" : vector(8, 13) * millimeter });
    skSolve(sk);`, UnsupportedFeatureError, /nested loops, holes and multiple regions are not implemented/);
  await refuses(polygon('b', square, { angle: '90 * degree', extra: ', "angleBack" : 30 * degree' }), UnsupportedFeatureError, /angleBack other than 0 or angleForward/);
  await refuses(polygon('t', square, { extra: ', "revolveType" : "FULL"' }), UnsupportedFeatureError, /revolveType is not implemented/);
  // A capability refusal stays visible inside try silent.
  await refuses(`try silent { ${polygon('t', square, { extra: ', "revolveType" : "FULL"' })} }`, UnsupportedFeatureError, /revolveType/);
  // Kernel refusals keep their names (code 7: a full turn pinching on the axis).
  await refuses(polygon('pinch', [[0, 0], [10, 5], [0, 10]], { radial: '0, 1, 0' }), UnsupportedFeatureError, /pinches the solid to a point on the axis/);
});

// The R20 cases themselves (READ ONLY), when the R20 project is present.
const R20 = `${homedir()}/Workspace/cad/cad-project-041/single-step-r20/kernel-cases`;
test('R20 KT3 case builds both parts with Onshape mass properties', { skip: !existsSync(`${R20}/kt3_partial_revolve/case.fs`) && 'R20 project not present' }, async () => {
  const model = await build(readFileSync(`${R20}/kt3_partial_revolve/case.fs`, 'utf8'), { feature: 'kt3PartialRevolve' });
  const reference = JSON.parse(readFileSync(`${R20}/kt3_partial_revolve/reference.json`, 'utf8'));
  for (const part of reference.parts) {
    const body = model.bodies.find(body => body.name === part.name) ?? assert.fail(`no part ${part.name}`);
    assert.ok(relative(volume(body), part.volume_mm3_value_min_max[0]) < 1e-6, `${part.key}: ${volume(body)}`);
  }
});

}
