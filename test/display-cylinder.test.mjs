import test from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missingBend() || missing("fixtures/r10b/modules/base/ZtoDD.body.json");
if (publicTreeSkip) {
  test("display-cylinder.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { readFileSync, mkdirSync, writeFileSync } = await import("node:fs");
const { createHash } = await import("node:crypto");
const { loadKernel } = await import("../src/kernel.mjs");
const { vector } = await import("../src/real.mjs");
const { importOnshapeBody, transformAnalytic } = await import("../src/analytic.mjs");
const { classificationInput, loadFaceClassifier } = await import("../src/face-classification.mjs");
const { loadCylinderClassifier } = await import("../src/cylinder-classification.mjs");
const { intersectionTolerance } = await import("../src/intersections.mjs");
const { reviewScene } = await import("../src/review-scene.mjs");












const tau = 2 * Math.PI, tolerance = 0.02, evidence = [];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const add = (a, b) => a.map((v, i) => v + b[i]);
const sub = (a, b) => a.map((v, i) => v - b[i]);
const scale = (a, s) => a.map(v => v * s);
const dot = (a, b) => a.reduce((sum, v, i) => sum + v * b[i], 0);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const length = a => Math.hypot(...a);
const cylinder = () => ({ type: 'cylinder', origin: [0, 0, 0], axis: [0, 0, 1], x: [1, 0, 0], radius: 5 });
const empty = () => ({ id: 'display-test', geometry: 'analytic', vertices: [], edges: [], faces: [{ surface: cylinder(), sameSense: true, loops: [], outer: [] }] });
const circle = z => ({ type: 'circle', origin: [0, 0, z], normal: [0, 0, 1], x: [1, 0, 0], radius: 5 });
const point = (u, v) => [5 * Math.cos(u), 5 * Math.sin(u), v];
function line(body, start, end) {
  const index = body.edges.length;
  body.edges.push({ start, end, sameSense: true, curve: { type: 'line', origin: body.vertices[start], direction: sub(body.vertices[end], body.vertices[start]) } });
  return index;
}
function band({ seam = true, slope = 0, height = 10 } = {}) {
  const body = empty(), factor = Math.hypot(1, slope);
  body.vertices.push([5, 0, 0], [5, 0, height + 5 * slope]);
  body.edges.push({ start: 0, end: 0, sameSense: true, curve: circle(0) }, {
    start: 1, end: 1, sameSense: true,
    curve: slope === 0 ? circle(height) : { type: 'ellipse', origin: [0, 0, height], normal: [-slope / factor, 0, 1 / factor],
      x: [1 / factor, 0, slope / factor], major: 5 * factor, minor: 5 },
  });
  if (seam) {
    line(body, 0, 1);
    body.faces[0].loops = [[{ edge: 0, forward: true }, { edge: 2, forward: true }, { edge: 1, forward: false }, { edge: 2, forward: false }]];
    body.faces[0].outer = [true];
  } else {
    body.faces[0].loops = [[{ edge: 0, forward: true }], [{ edge: 1, forward: false }]];
    body.faces[0].outer = [false, false];
  }
  return body;
}
function panel(body, first, last, low, high, outer = true) {
  const v = body.vertices.length, e = body.edges.length;
  body.vertices.push(point(first, low), point(last, low), point(last, high), point(first, high));
  body.edges.push({ start: v, end: v + 1, sameSense: true, curve: circle(low), curveRange: [first, last] });
  line(body, v + 1, v + 2);
  body.edges.push({ start: v + 2, end: v + 3, sameSense: false, curve: circle(high), curveRange: [first, last] });
  line(body, v + 3, v);
  body.faces[0].loops.push([0, 1, 2, 3].map(i => ({ edge: e + i, forward: true })));
  body.faces[0].outer.push(outer);
}
async function sceneFor(body, toleranceMm = tolerance) {
  const model = { bodies: [body] }, before = JSON.stringify(model);
  const scene = await reviewScene(model, { id: 'display-test' }, { toleranceMm });
  assert.equal(JSON.stringify(model), before, 'display must not modify the input B-rep');
  return scene;
}
function uv(p, s) {
  const d = sub(p, s.origin), a = dot(d, s.x), b = dot(d, cross(s.axis, s.x));
  return [Math.atan2(b, a), dot(d, s.axis), Math.hypot(a, b)];
}
function surfacePoint(s, u, v) {
  return add(add(s.origin, scale(s.axis, v)), scale(add(scale(s.x, Math.cos(u)), scale(cross(s.axis, s.x), Math.sin(u))), s.radius));
}
function covers(face, s, u, v) {
  return face.triangles.some(triangle => {
    const points = triangle.points.map(p => {
      const q = uv(p, s);
      return [Math.atan2(Math.sin(q[0] - u), Math.cos(q[0] - u)), q[1] - v];
    });
    if (Math.max(...points.map(p => p[0])) - Math.min(...points.map(p => p[0])) > Math.PI) return false;
    const sides = points.map((p, i) => p[0] * points[(i + 1) % 3][1] - p[1] * points[(i + 1) % 3][0]);
    return sides.every(value => value >= -1e-9) || sides.every(value => value <= 1e-9);
  });
}
function residuals(face, s) {
  let vertex = 0, interior = 0, meshArea = 0;
  for (const triangle of face.triangles) {
    const [a, b, c] = triangle.points, product = cross(sub(b, a), sub(c, a));
    meshArea += length(product) / 2;
    assert.ok(dot(product, triangle.normal) > 0, 'triangle winding must agree with the displayed normal');
    for (const p of triangle.points) vertex = Math.max(vertex, Math.abs(uv(p, s)[2] - s.radius));
    for (const p of [scale(add(add(a, b), c), 1 / 3), scale(add(a, b), .5), scale(add(a, c), .5), scale(add(b, c), .5)]) {
      interior = Math.max(interior, Math.abs(uv(p, s)[2] - s.radius));
    }
  }
  assert.ok(vertex < 1e-7, `vertex cylinder residual ${vertex}`);
  assert.ok(interior <= face.displayTessellation.toleranceMm + 1e-7, `interior cylinder residual ${interior}`);
  return { vertexResidualMm: vertex, interiorResidualMm: interior, meshAreaMm2: meshArea };
}
function boundaryChords(face, s, curves) {
  let count = 0, error = 0, axial = 0, radial = 0;
  for (const triangle of face.triangles) for (let i = 0; i < 3; i++) {
    const a = triangle.points[i], b = triangle.points[(i + 1) % 3];
    for (const curve of curves) {
      if (Math.abs(dot(sub(a, curve.origin), curve.normal)) > 1e-7 || Math.abs(dot(sub(b, curve.origin), curve.normal)) > 1e-7) continue;
      const ua = uv(a, s)[0], raw = uv(b, s)[0], ub = ua + Math.atan2(Math.sin(raw - ua), Math.cos(raw - ua));
      if (Math.abs(ub - ua) < 1e-10) continue;
      count++;
      for (const fraction of [.25, .5, .75]) {
        const u = ua + (ub - ua) * fraction, chord = add(scale(a, 1 - fraction), scale(b, fraction));
        const radialPoint = surfacePoint(s, u, 0);
        const h = dot(sub(curve.origin, radialPoint), curve.normal) / dot(s.axis, curve.normal);
        const actual = surfacePoint(s, u, h), delta = sub(chord, actual);
        error = Math.max(error, length(delta));
        axial = Math.max(axial, Math.abs(dot(delta, s.axis)));
        radial = Math.max(radial, Math.abs(uv(chord, s)[2] - s.radius));
      }
    }
  }
  assert.ok(count > 0, 'check actual curved boundary segments between angular columns');
  assert.ok(error <= face.displayTessellation.maxChordalErrorBoundMm + 1e-7, `boundary chord error ${error}`);
  return { segments: count, measuredChordErrorMm: error, axialErrorMm: axial, radialErrorMm: radial };
}

test('cylinder display covers periodic bands and seam-crossing holes without using outer-loop labels', async () => {
  let probes = 0;
  for (const seam of [false, true]) {
    const body = band({ seam }); panel(body, -.4, .6, 3, 7, false);
    body.faces[0].loops.reverse(); body.faces[0].outer.reverse();
    const scene = await sceneFor(body), face = scene.bodies[0].faces[0];
    assert.deepEqual(scene.display.notes, []);
    assert.ok(Math.abs(face.displayTessellation.chartAreaMm2 - (5 * tau * 10 - 5 * 1 * 4)) < 1e-7);
    assert.equal(face.displayTessellation.seamEdges.length, seam ? 1 : 0);
    for (const angle of [-3, -1, -.2, .2, .8, 2, 6.2]) for (const height of [-1, 1, 5, 9, 11]) {
      const wrapped = Math.atan2(Math.sin(angle), Math.cos(angle));
      assert.equal(covers(face, body.faces[0].surface, angle, height), height > 0 && height < 10 && !(wrapped > -.4 && wrapped < .6 && height > 3 && height < 7));
      probes++;
    }
    residuals(face, body.faces[0].surface);
  }
  evidence.push({ check: 'periodic bands and holes', passed: true, coverageProbes: probes });
});

test('partial cylindrical panels preserve coverage across the angle seam and reversed senses', async () => {
  let probes = 0;
  for (const [first, last] of [[-.6, .8], [5.7, 7.1], [-2.8, 2.8]]) {
    const body = empty(); panel(body, first, last, 0, 10);
    body.faces[0].sameSense = false;
    body.faces[0].loops.forEach(loop => loop.reverse().forEach(use => { use.forward = !use.forward; }));
    const scene = await sceneFor(body), face = scene.bodies[0].faces[0];
    assert.deepEqual(scene.display.notes, []);
    assert.ok(Math.abs(face.displayTessellation.chartAreaMm2 - 50 * (last - first)) < 1e-7);
    for (const angle of [first - .1, first + .1, (first + last) / 2, last - .1, last + .1]) for (const height of [-1, 5, 11]) {
      assert.equal(covers(face, body.faces[0].surface, angle, height), angle > first && angle < last && height > 0 && height < 10);
      probes++;
    }
    residuals(face, body.faces[0].surface);
  }
  evidence.push({ check: 'partial panels and reversed senses', passed: true, coverageProbes: probes });
});

test('oblique elliptical display boundaries bound both radial and axial chord error between columns', async () => {
  const cases = [];
  for (const [slope, height, toleranceMm] of [[.4, 10, .02], [4, 40, .02], [4, 40, .005]]) {
    const body = band({ slope, height }), scene = await sceneFor(body, toleranceMm), face = scene.bodies[0].faces[0];
    assert.deepEqual(scene.display.notes, []);
    const chord = boundaryChords(face, body.faces[0].surface, [body.edges[1].curve]);
    if (slope === 4) assert.ok(chord.axialErrorMm > chord.radialErrorMm, 'steep ellipse exercises an error missed by radial-only checks');
    for (const angle of [-3, -1, .3, 1.5, 2.7, 5.5]) {
      const top = height + 5 * slope * Math.cos(angle);
      assert.equal(covers(face, body.faces[0].surface, angle, top - .1), true);
      assert.equal(covers(face, body.faces[0].surface, angle, top + .1), false);
    }
    cases.push({ slope, toleranceMm, triangles: face.triangles.length, boundMm: face.displayTessellation.maxChordalErrorBoundMm, ...chord, ...residuals(face, body.faces[0].surface) });
  }
  assert.ok(cases[2].triangles > cases[1].triangles);
  assert.ok(cases[2].measuredChordErrorMm < cases[1].measuredChordErrorMm);
  evidence.push({ check: 'oblique boundary error', passed: true, cases });
});

test('ambiguous, crossing, coincident and invalid cylinder trims stay visibly unshaded', async () => {
  const missing = empty(); panel(missing, -.4, .6, 0, 10); delete missing.edges[0].curveRange;
  const crossing = band({ slope: 1, height: 1 });
  const tangency = band({ slope: 1, height: 5 });
  const generatorCross = band(); panel(generatorCross, -.4, .6, 3, 12, false);
  const duplicate = band({ seam: false }); duplicate.faces[0].loops.push([{ edge: 0, forward: true }]); duplicate.faces[0].outer.push(false);
  const badSeam = band(); badSeam.edges[1].curve.x = [0, 1, 0]; badSeam.vertices[1] = [0, 5, 10]; badSeam.edges[2].curve.direction = [-5, 5, 10];
  const unbounded = band({ seam: false }); unbounded.faces[0].loops.pop(); unbounded.faces[0].outer.pop();
  const cases = [];
  for (const [name, body] of Object.entries({ missing, crossing, tangency, generatorCross, duplicate, badSeam, unbounded })) {
    const scene = await sceneFor(body), face = scene.bodies[0].faces[0];
    assert.equal(face.triangles.length, 0, name);
    assert.match(face.displayWarning, /Cylinder display:.*shown as boundaries/);
    assert.ok(scene.bodies[0].edges.every(edge => edge.points.length >= 2));
    cases.push({ name, warning: face.displayWarning });
  }
  evidence.push({ check: 'invalid trim rejection', passed: true, cases });
});

test('fresh frozen P10 g0 renders every cylinder with independent area, residual and membership evidence', async () => {
  const path = new URL('../fixtures/r10b/modules/base/ZtoDD.body.json', import.meta.url), bytes = readFileSync(path);
  const expected = 'b78a8546970e360ee2a3a22661c87d4f9e835d24fe50cedeedde6a19add20dc9';
  assert.equal(hash(bytes), expected);
  const source = JSON.parse(bytes).bodies[0], kernel = await loadKernel();
  const imported = importOnshapeBody(kernel, source, 'P10', { source: 'frozen P10 display regression', sha256: expected });
  const body = transformAnalytic(kernel, imported, 'g0', [
    [1, 0, 0], [0, .9063077870366499, -.42261826174069944], [0, .42261826174069944, .9063077870366499],
  ], [0, 85.7915071334, -183.980480768]);
  const before = JSON.stringify(body), scene = await sceneFor(body), displayed = scene.bodies[0];
  const F = await loadFaceClassifier(), C = await loadCylinderClassifier(), input = classificationInput(body, F);
  const checks = [];
  for (const face of displayed.faces.filter(f => f.surfaceType === 'cylinder')) {
    assert.ok(face.triangles.length > 0, `${face.index}: ${face.displayWarning}`);
    assert.deepEqual(face.identity, body.identity.topology.faces[face.index], 'display triangles retain the selectable source face identity');
    const original = body.faces[face.index], s = original.surface, measured = residuals(face, s);
    const referenceArea = source.faces[face.index].area * 1e6, perimeter = body.referenceMeasurements.facePerimetersMm[face.index];
    const areaError = Math.abs(face.displayTessellation.chartAreaMm2 - referenceArea);
    assert.ok(areaError <= perimeter * tolerance + Math.PI * tolerance ** 2, `face ${face.index}: chart area ${areaError}`);
    assert.ok(Math.abs(measured.meshAreaMm2 - referenceArea) <= referenceArea * .005 + perimeter * tolerance, `face ${face.index}: mesh area`);
    let inside = 0;
    for (const fraction of [.31, .71]) {
      const triangle = face.triangles[Math.floor(face.triangles.length * fraction)];
      const center = scale(triangle.points.reduce(add), 1 / 3), location = uv(center, s);
      const result = C.classify(input.solid, face.index, input.domains, vector(surfacePoint(s, location[0], location[1])), intersectionTolerance({ linear: 1e-7 }), input.sourceBudget);
      assert.equal(result.$, 'Inside', JSON.stringify({ face: face.index, result }));
      inside++;
    }
    const ellipseEdges = [...new Set(original.loops.flat().map(use => use.edge))].map(i => body.edges[i].curve).filter(curve => curve.type === 'ellipse');
    checks.push({ face: face.index, triangles: face.triangles.length, sourceAreaMm2: referenceArea,
      chartAreaMm2: face.displayTessellation.chartAreaMm2, chartAreaErrorMm2: areaError,
      boundMm: face.displayTessellation.maxChordalErrorBoundMm, membershipInside: inside, ...measured,
      ...(ellipseEdges.length ? { ellipseBoundary: boundaryChords(face, s, ellipseEdges) } : {}) });
  }
  assert.equal(checks.length, 26);
  assert.deepEqual(scene.display.notes, []);
  assert.equal(JSON.stringify(body), before);
  assert.equal(hash(readFileSync(path)), expected);
  evidence.push({ check: 'frozen P10 g0', passed: true, fixtureSha256: expected, bodySha256: hash(before),
    sourceCounts: { vertices: source.vertices.length, edges: source.edges.length, faces: source.faces.length }, faces: checks });
});

test.after(() => {
  if (process.env.WONKY_DISPLAY_EVIDENCE !== '1') return;
  const files = ['src/review-scene.mjs', 'src/display-cylinder.mjs', 'kernel/display.bend', 'test/display-cylinder.test.mjs'];
  const report = { schema: 'wonky.display-cylinder-observations/1', recordedAt: new Date().toISOString(),
    complete: evidence.length === 5, displayOnly: true, toleranceMm: tolerance,
    sources: files.map(path => ({ path, sha256: hash(readFileSync(new URL('../' + path, import.meta.url))) })), checks: evidence };
  const directory = new URL('../out/viewer-trims/', import.meta.url);
  mkdirSync(directory, { recursive: true });
  writeFileSync(new URL('regression.json', directory), JSON.stringify(report, null, 2) + '\n');
});

}
