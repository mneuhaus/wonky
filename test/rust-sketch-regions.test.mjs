// Sketch regions from the one wonky-curve arrangement on strict rust: crossing
// and nested circles, a plate with a bore, and the sketches the arrangement
// must still refuse by name. Volumes are closed forms (areas times the 5 mm
// depth); point selection on an arrangement sketch is decided on the arrangement (S17).
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.WONKY_BACKEND = 'rust';
const { build } = await import('../src/index.mjs');
const { errorCode } = await import('../src/errors.mjs');

const NAMED = /^[a-z][a-z0-9-]*(\/[a-z][a-z0-9-]*)*$/;
const DEPTH = 5;
const source = (sketch, query) => `FeatureScript 3044;
import(path : "onshape/std/geometry.fs", version : "3044.0");
export const f = defineFeature(function(context is Context, id is Id, definition is map) precondition {} {
  const xy = plane(vector(0, 0, 0) * millimeter, vector(0, 0, 1), vector(1, 0, 0));
  var s = newSketchOnPlane(context, id + "s", { "sketchPlane" : xy });
${sketch}
  skSolve(s);
  const R = qSketchRegion(id + "s");
  const Inner = qSketchRegion(id + "s", true);
  opExtrude(context, id + "e", { "entities" : ${query}, "direction" : vector(0, 0, 1), "endBound" : BoundingType.BLIND, "endDepth" : ${DEPTH} * millimeter });
});`;
const circle = (name, x, y, r) => `  skCircle(s, "${name}", { "center" : vector(${x}, ${y}) * millimeter, "radius" : ${r} * millimeter });`;
const rectangle = (name, x0, y0, x1, y1) => `  skRectangle(s, "${name}", { "firstCorner" : vector(${x0}, ${y0}) * millimeter, "secondCorner" : vector(${x1}, ${y1}) * millimeter });`;
const outcome = async (sketch, query) => {
  try { return { model: await build(source(sketch, query), { feature: 'f', trace: false }) }; } catch (error) { return { error }; }
};
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) <= Math.abs(expected) * 1e-9, `${actual} != ${expected}`);

test('a plate with a bore is one holed body and the bore disc is an island', async () => {
  const sketch = [rectangle('plate', 0, 0, 30, 20), circle('bore', 15, 10, 4)].join('\n');
  const { model, error } = await outcome(sketch, 'Inner');
  assert.ifError(error);
  assert.equal(model.bodies.length, 1);
  close(model.bodies[0].validation.volumeMm3, DEPTH * (600 - 16 * Math.PI));
});

test('concentric circles extrude as a ring', async () => {
  const { model, error } = await outcome([circle('outer', 0, 0, 9), circle('inner', 0, 0, 3)].join('\n'), 'Inner');
  assert.ifError(error);
  assert.equal(model.bodies.length, 1);
  close(model.bodies[0].validation.volumeMm3, DEPTH * 72 * Math.PI);
});

test('regions that share a boundary are fused by Onshape and refuse by name here', async () => {
  const sketch = [circle('a', -3, 0, 5), circle('b', 3, 0, 5)].join('\n');
  for (const query of ['R', 'Inner']) {
    const { model, error } = await outcome(sketch, query);
    assert.equal(model, undefined, query);
    assert.equal(errorCode(error), 'sketch-region/adjacent-regions-fuse', `${query}: ${error?.message}`);
  }
});

test('a hole made of two overlapping bores has no decided inner filter and refuses by name', async () => {
  // Whether the lens and the crescents inside the plate's hole are inner loops
  // depends on the reading of filterInnerLoops; nothing is guessed.
  const sketch = [rectangle('plate', -20, -20, 20, 20), circle('a', -3, 0, 5), circle('b', 3, 0, 5)].join('\n');
  const { model, error } = await outcome(sketch, 'Inner');
  assert.equal(model, undefined);
  assert.equal(errorCode(error), 'sketch-region/composite-hole-filter', `${error?.name}: ${error?.message}`);
  // A plate with two separate bores is decided: one holed body.
  const apart = [rectangle('plate', -20, -20, 20, 20), circle('a', -8, 0, 5), circle('b', 8, 0, 5)].join('\n');
  const decided = await outcome(apart, 'Inner');
  assert.ifError(decided.error);
  assert.equal(decided.model.bodies.length, 1);
  close(decided.model.bodies[0].validation.volumeMm3, DEPTH * (1600 - 50 * Math.PI));
});

test('point selection on an arrangement sketch decides among the arrangement cells', async () => {
  const at = (x, y) => `qContainsPoint(R, vector(${x}, ${y}, 0) * millimeter)`;
  // Nested rectangles: a point in the ring picks the ring, a point in the inner cell picks it.
  const nested = [rectangle('outer', 0, 0, 24, 18), rectangle('inner', 6, 5, 18, 13)].join('\n');
  const ring = await outcome(nested, at(2, 2));
  assert.ifError(ring.error);
  close(ring.model.bodies[0].validation.volumeMm3, DEPTH * (432 - 96));
  const core = await outcome(nested, at(12, 9));
  assert.ifError(core.error);
  close(core.model.bodies[0].validation.volumeMm3, DEPTH * 96);
  // Crossing circles: the lens and each crescent, closed forms (crossings at (0, +-4)).
  const pair = [circle('a', -3, 0, 5), circle('b', 3, 0, 5)].join('\n');
  const lensArea = 50 * Math.acos(0.6) - 24, crescent = 25 * Math.PI - lensArea;
  for (const [x, area] of [[0, lensArea], [-6, crescent], [6, crescent]]) {
    const { model, error } = await outcome(pair, at(x, 0));
    assert.ifError(error);
    assert.equal(model.bodies.length, 1, `x=${x}`);
    close(model.bodies[0].validation.volumeMm3, DEPTH * area);
  }
});

test('a point exactly on a region edge is never resolved to one side', async () => {
  const at = (x, y) => `qContainsPoint(R, vector(${x}, ${y}, 0) * millimeter)`;
  const nested = [rectangle('outer', 0, 0, 24, 18), rectangle('inner', 6, 5, 18, 13)].join('\n');
  // On the inner rectangle's edge: the ring and the core both contain it.
  const edge = await outcome(nested, at(6, 9));
  assert.equal(edge.model, undefined);
  assert.equal(errorCode(edge.error), 'sketch-region/point-on-boundary', `${edge.error?.name}: ${edge.error?.message}`);
  // On the circles' crossing: three cells contain it.
  const pair = [circle('a', -3, 0, 5), circle('b', 3, 0, 5)].join('\n');
  const cross = await outcome(pair, at(0, 4));
  assert.equal(cross.model, undefined);
  assert.equal(errorCode(cross.error), 'sketch-region/point-on-boundary', `${cross.error?.name}: ${cross.error?.message}`);
  // On the outer boundary only one cell contains it: closed set, that cell is chosen.
  const outer = await outcome(nested, at(0, 2));
  assert.ifError(outer.error);
  close(outer.model.bodies[0].validation.volumeMm3, DEPTH * (432 - 96));
});

test('qClosestTo over crossing circles picks the nearest cell of the arrangement', async () => {
  const pair = [circle('a', -3, 0, 5), circle('b', 3, 0, 5)].join('\n');
  const lensArea = 50 * Math.acos(0.6) - 24, crescent = 25 * Math.PI - lensArea;
  // Above and left of both circles: the left crescent is nearer than the lens.
  const { model, error } = await outcome(pair, 'qClosestTo(R, vector(-1, 10, 0) * millimeter)');
  assert.ifError(error);
  assert.equal(model.bodies.length, 1);
  close(model.bodies[0].validation.volumeMm3, DEPTH * crescent);
});

test('a point selection on curved regions the loose solvers numbered refuses by name', async () => {
  // A lone disc and a plate with one bore are numbered by the loose-edge solvers, not the
  // arrangement: a pick must not index arrangement cells with those region numbers.
  for (const sketch of [circle('disc', 0, 0, 5), [rectangle('plate', 0, 0, 30, 20), circle('bore', 15, 10, 4)].join('\n')]) {
    const { model, error } = await outcome(sketch, 'qContainsPoint(R, vector(1, 1, 0) * millimeter)');
    assert.equal(model, undefined, sketch);
    assert.equal(errorCode(error), 'sketch-region/point-selection-legacy-numbering', `${error?.name}: ${error?.message}`);
  }
});

test('internally tangent circles are never two regions: a named refusal', async () => {
  const sketch = [circle('a', 0, 0, 5), circle('b', 2, 0, 3)].join('\n');
  const { model, error } = await outcome(sketch, 'Inner');
  assert.equal(model, undefined);
  assert.ok(error, 'built');
  assert.equal(errorCode(error), 'prism-stack/tangent-branch-order', `${error.name}: ${error.message}`);
  assert.match(errorCode(error), NAMED);
});

const line = (x0, y0, x1, y1) => `  skLineSegment(s, "split", { "start" : vector(${x0}, ${y0}) * millimeter, "end" : vector(${x1}, ${y1}) * millimeter });`;
test('open crossing lines split circles and rectangles into exact picked cells', async () => {
  for (const r of [5, 5.025]) {
    const sketch = [circle('disc', 0, 0, r), line(-6, 0, 6, 0)].join('\n');
    for (const y of [-2, 2]) {
      const result = await outcome(sketch, `qContainsPoint(R, vector(0, ${y}, 0) * millimeter)`);
      assert.ifError(result.error);
      assert.equal(result.model.bodies.length, 1);
      close(result.model.bodies[0].validation.volumeMm3, DEPTH * Math.PI * r * r / 2);
      const bounds = result.model.bodies[0].validation.boundsMm;
      close(y > 0 ? bounds.max[1] : -bounds.min[1], r);
      assert.ok(Math.abs(y > 0 ? bounds.min[1] : bounds.max[1]) < 1e-9);
    }
  }
  const sketch = [rectangle('box', 0, 0, 20, 10), line(10, -2, 10, 12)].join('\n');
  for (const x of [5, 15]) {
    const result = await outcome(sketch, `qContainsPoint(R, vector(${x}, 5, 0) * millimeter)`);
    assert.ifError(result.error);
    assert.equal(result.model.bodies.length, 1);
    close(result.model.bodies[0].validation.volumeMm3, DEPTH * 100);
  }
});

test('split-region picks never choose one side of the shared cut or extrude dangling tails', async () => {
  const sketch = [circle('disc', 0, 0, 5), line(-6, 0, 6, 0)].join('\n');
  const cut = await outcome(sketch, 'qContainsPoint(R, vector(0, 0, 0) * millimeter)');
  assert.equal(cut.model, undefined);
  assert.equal(errorCode(cut.error), 'sketch-region/point-on-boundary');
  const tail = await outcome(sketch, 'qContainsPoint(R, vector(5.5, 0, 0) * millimeter)');
  assert.equal(tail.model, undefined);
  assert.ok(tail.error, 'a dangling tail is not an extrudable region');
  const both = await outcome(sketch, 'R');
  assert.equal(both.model, undefined);
  assert.equal(errorCode(both.error), 'sketch-region/adjacent-regions-fuse');
});
