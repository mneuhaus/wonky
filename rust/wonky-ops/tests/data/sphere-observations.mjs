// Independent consumer of the production native observation JSON. Rust owns
// the geometry cases; this uses the real host JSON parser, not a shadow parser.
import assert from 'node:assert/strict';
let input = '';
for await (const chunk of process.stdin) input += chunk;
const [whole, upper, side] = JSON.parse(input);
const near = (actual, expected) => {
  assert.ok(Number.isFinite(actual), `nonfinite observation ${actual}`);
  assert.ok(Math.abs(actual - expected) <= 2e-11, `${actual} != ${expected}`);
};
const vector = (actual, expected) => {
  assert.equal(actual.length, expected.length);
  expected.forEach((x, i) => near(actual[i], x));
};
for (const [m, faces, edges, chartEdges] of [[whole, 1, 0, 1], [upper, 2, 1, 2], [side, 2, 1, 2]]) {
  assert.equal(m.basis, 'native-f64-construction');
  assert.equal(m.boundToConstruction, true);
  assert.equal(m.topology.faces, faces);
  assert.equal(m.topology.edges, edges);
  assert.equal(m.topology.ringEdges, edges);
  assert.equal(m.topology.vertices, 0);
  assert.equal(m.topology.loops, edges * 2);
  assert.equal(m.topology.genus, 0);
  assert.equal(m.validity.closed, true);
  assert.equal(m.projection.vertices.length, 2);
  assert.equal(m.projection.edges.length, chartEdges);
  assert.equal(m.projection.faces.length, faces);
  assert.ok(m.toleranceMm > 0 && m.toleranceMm < 1e-9);
  near(m.volumeMm3, (edges ? 2 : 4) * Math.PI * 512 / 3);
  near(m.areaMm2, (edges ? 3 : 4) * Math.PI * 64);
  assert.equal(m.facePerimetersMm.length, faces);
  m.facePerimetersMm.forEach(x => near(x, edges ? 16 * Math.PI : 0));
  assert.equal(m.faceAreasMm2.length, faces);
  near(m.faceAreasMm2[0], (edges ? 2 : 4) * Math.PI * 64);
  if (edges) near(m.faceAreasMm2[1], Math.PI * 64);
}
vector(whole.centroidMm, [0, 0, 0]);
assert.equal(whole.mappedBboxMm, null);
vector(upper.centroidMm, [125, -250, 503]);
vector(upper.bboxMm.min, [117, -258, 500]);
vector(upper.bboxMm.max, [133, -242, 508]);
vector(upper.mappedBboxMm.min, [1505 - 8 * Math.sqrt(13), 377 - 8 * Math.sqrt(2), -6618 - 104]);
vector(upper.mappedBboxMm.max, [1505 + 8 * Math.sqrt(29), 377 + 8 * Math.sqrt(3), -6618 + 40]);
vector(side.centroidMm, [126.8, -247.6, 500]);
vector(side.bboxMm.min, [118.6, -254.8, 492]);
vector(side.bboxMm.max, [133, -242, 508]);
assert.equal(upper.probes.length, 4);
for (const [i, distance] of [Math.sqrt(32), 4, 0, 4].entries()) {
  near(upper.probes[i].distanceMm, distance);
  assert.equal(upper.probes[i].inside, i === 2);
  assert.ok(upper.probes[i].boundMm >= 0 && upper.probes[i].boundMm < 1e-9);
}
