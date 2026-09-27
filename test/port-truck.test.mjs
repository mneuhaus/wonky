import test from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missingBend();
if (publicTreeSkip) {
  test("port-truck.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { mkdirSync, writeFileSync, readFileSync } = await import("node:fs");
const { createHash } = await import("node:crypto");
const { loadBend } = await import("../src/bend-loader.mjs");
const { loadKernel, extrudeInBend, array, list } = await import("../src/kernel.mjs");
const { classificationInput } = await import("../src/face-classification.mjs");
const { intersectionTolerance } = await import("../src/intersections.mjs");
const { vector, real, coords } = await import("../src/real.mjs");
const { decodeAnalytic, circularFrustumInBend } = await import("../src/analytic.mjs");
const { toStep } = await import("../src/exporters.mjs");












const artifact = new URL('../out/boolean-ports/truck/', import.meta.url);
const { version } = JSON.parse(readFileSync(new URL('../bend.lock.json', import.meta.url)));
mkdirSync(artifact, { recursive: true });
const port = await loadBend(new URL('../kernel/ports/truck.bend', import.meta.url));
const cylinderPort = await loadBend(new URL('../kernel/ports/truck-cylinder.bend', import.meta.url));
const k = await loadKernel();
const frame = { origin: [0, 0, 0], normal: [0, 0, 1], x: [1, 0, 0] };
const prism = (points, height = 4) => classificationInput(extrudeInBend(k, 'fixture', points, frame, [0, 0, height]), k.faceClassifier).solid;
const box = () => prism([[0, 0], [8, 0], [8, 6], [0, 6]]);
const clip = (solid, origin, normal, options = {}) => port.clip(solid, options.domains ?? list([]), origin.$ ? origin : vector(origin), normal.$ ? normal : vector(normal), intersectionTolerance(options), real(options.sourceBudget ?? 0));
const clipCylinder = (solid, origin, normal, options = {}) => cylinderPort.clip(solid, options.domains ?? list([]), origin.$ ? origin : vector(origin), normal.$ ? normal : vector(normal), intersectionTolerance(options), real(options.sourceBudget ?? 0));
const cylinder = () => classificationInput(circularFrustumInBend(k, 'round', { center: [0, 0], radius: 3, plane: frame }, null, [0, 0, 4]), k.faceClassifier).solid;
const bodies = result => result.$ === 'Clipped' ? [result] : result.$ === 'Components' ? array(result.bodies) : [];
const sub = (a, b) => a.map((v, i) => v - b[i]);
const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const near = (a, b, tolerance = 2e-9) => assert.ok(Math.abs(a - b) <= tolerance * Math.max(1, Math.abs(b)), `${a} != ${b}`);
const evidence = [];

// Independent signed-volume oracle over the output's oriented planar rings;
// this measures produced geometry and never constructs production geometry.
function measure(solid) {
  const points = array(solid.vertices).map(coords), edges = array(solid.edges), reference = points[0];
  let volume = 0;
  for (const face of array(solid.faces)) for (const loop of array(face.loops)) {
    const ring = array(loop.uses).map(use => points[edges[use.edge][use.forward ? 'start' : 'end']]);
    for (let i = 1; i < ring.length - 1; i++) volume += dot(sub(ring[0], reference), cross(sub(ring[i], reference), sub(ring[i + 1], reference))) / 6;
  }
  return volume;
}

function verify(result, source, expected, name) {
  assert.ok(['Clipped', 'Components'].includes(result.$), `${name}: ${JSON.stringify(result)}`);
  const output = bodies(result), sourceFaces = array(source.faces), sourceEdges = array(source.edges), sourcePoints = array(source.vertices).map(coords);
  near(output.reduce((sum, body) => sum + measure(body.solid), 0), expected);
  const exports = [];
  for (const [component, body] of output.entries()) {
    const points = array(body.solid.vertices).map(coords), edges = array(body.solid.edges), faces = array(body.solid.faces);
    assert.equal(array(body.domains).length, edges.length);
    assert.equal(array(body.edge_origins).length, edges.length);
    assert.equal(array(body.face_origins).length, faces.length);
    const uses = edges.map(() => [0, 0]), usedPoints = new Set();
    for (const [index, face] of faces.entries()) {
      const origin = array(body.face_origins)[index];
      if (origin.$ === 'SourceFace') assert.deepEqual(face.surface, sourceFaces[origin.index].surface);
      else assert.equal(origin.$, 'CutFace');
      for (const loop of array(face.loops)) {
        assert.equal(loop.outer, true);
        const boundary = array(loop.uses);
        assert.ok(boundary.length >= 3);
        for (const [i, use] of boundary.entries()) {
          uses[use.edge][use.forward ? 0 : 1]++;
          const edge = edges[use.edge], nextUse = boundary[(i + 1) % boundary.length], next = edges[nextUse.edge];
          assert.equal(edge[use.forward ? 'end' : 'start'], next[nextUse.forward ? 'start' : 'end']);
          usedPoints.add(edge.start); usedPoints.add(edge.end);
        }
      }
    }
    assert.ok(uses.every(count => count[0] === 1 && count[1] === 1));
    assert.equal(usedPoints.size, points.length);
    for (const [i, origin] of array(body.edge_origins).entries()) {
      if (origin.$ === 'SourceEdge') {
        const sourceEdge = sourceEdges[origin.index], a = sourcePoints[sourceEdge.start], b = sourcePoints[sourceEdge.end], delta = sub(b, a);
        for (const p of [points[edges[i].start], points[edges[i].end]]) {
          near(Math.hypot(...cross(sub(p, a), delta)), 0);
          const t = dot(sub(p, a), delta) / dot(delta, delta);
          assert.ok(t >= -1e-10 && t <= 1 + 1e-10);
        }
      } else {
        assert.equal(origin.$, 'CutEdge'); assert.ok(origin.face < sourceFaces.length);
      }
    }
    const decoded = decodeAnalytic(body.solid, `${name}-${component}`, k);
    assert.equal(decoded.validation.closed, true);
    decoded.validation.volumeMm3 = measure(body.solid);
    decoded.validation.boundsMm = { min: [0, 1, 2].map(i => Math.min(...points.map(p => p[i]))), max: [0, 1, 2].map(i => Math.max(...points.map(p => p[i]))) };
    exports.push(decoded);
  }
  const model = { schema: 'wonky-brep/1', units: 'millimeter', backend: { language: 'Bend', version }, bodies: exports };
  writeFileSync(new URL(`${name}.brep.json`, artifact), JSON.stringify(model, null, 2) + '\n');
  writeFileSync(new URL(`${name}.step`, artifact), toStep(model, name));
  evidence.push({ name, status: result.$, components: output.length, volume: expected, faces: output.map(body => array(body.solid.faces).length) });
  return output;
}

test('Truck transverse corefinement returns a closed box with source provenance', () => {
  const source = box(), before = JSON.stringify(source);
  const output = verify(clip(source, [4, 0, 0], [1, 0, 0]), source, 96, 'half-box');
  assert.deepEqual([array(output[0].solid.vertices).length, array(output[0].solid.edges).length, array(output[0].solid.faces).length], [8, 12, 6]);
  assert.equal(JSON.stringify(source), before);
  verify(clip(source, [3, 0, 0], [1, 1, 1]), source, 4.5, 'simplex');
  assert.equal(clip(source, [-1, 0, 0], [1, 0, 0]).$, 'Empty');
  verify(clip(source, [9, 0, 0], [1, 0, 0]), source, 192, 'uncut');
});

test('concave face splitting preserves L material and returns U arms as distinct closed components', () => {
  const l = prism([[0, 0], [8, 0], [8, 2], [3, 2], [3, 6], [0, 6]]);
  verify(clip(l, [2, 0, 0], [1, 0, 0]), l, 48, 'L-left');
  verify(clip(l, [4, 0, 0], [1, 0, 0]), l, 80, 'L-concave');
  const u = prism([[0, 0], [6, 0], [6, 6], [4, 6], [4, 2], [2, 2], [2, 6], [0, 6]]);
  const result = clip(u, [0, 3, 0], [0, -1, 0]);
  assert.equal(result.$, 'Components');
  const output = verify(result, u, 48, 'U-separated');
  assert.equal(output.length, 2); output.forEach(body => near(measure(body.solid), 24));
});

test('complete Truck results accept transverse repeated cuts and rigid transformations', () => {
  const source = box();
  const first = verify(clip(source, [4, 0, 0], [1, 0, 0]), source, 96, 'chain-first')[0].solid;
  verify(clip(first, [0, 3, 0], [0, 1, 0]), first, 48, 'chain-second');
  const rotation = { $: 'Rotation', x: vector([0.8, 0, -0.6]), y: vector([0, 1, 0]), z: vector([0.6, 0, 0.8]) }, offset = vector([17, -31, 59]);
  const moved = k.analytic.transform(source, rotation, offset), origin = k.analytic.point_transform(vector([4, 0, 0]), rotation, offset), normal = k.precise.rotate(vector([1, 0, 0]), rotation);
  verify(clip(moved, origin, normal), moved, 96, 'rotated');
});

test('Truck retains its transverse-only failure domain and never exposes a partial shell', () => {
  const source = box();
  for (const [origin, normal] of [[[0, 0, 0], [1, 0, 0]], [[0, 0, 0], [1, 1, -1]], [[0, 0, 0], [1, -1, 0]], [[1e-9, 0, 0], [1, 0, 0]]]) {
    const result = clip(source, origin, normal);
    assert.deepEqual(result, { $: 'Unresolved', reason: { $: 'AmbiguousContact' } });
  }
  const curved = classificationInput(circularFrustumInBend(k, 'round', { center: [0, 0], radius: 3, plane: frame }, null, [0, 0, 4]), k.faceClassifier).solid;
  assert.equal(clip(curved, [0, 0, 2], [0, 0, 1]).reason.$, 'UnsupportedSurface');
  assert.equal(clip(source, [4, 0, 0], [1, 0, 0], { sourceBudget: 0.0003 }).reason.$, 'SourceTolerance');
  assert.equal(clip(source, [4, 0, 0], [1, 0, 0], { domains: list([{ $: 'GivenDomain', domain: { $: 'Interval', first: real(0), last: real(1) } }]) }).reason.$, 'UnsupportedDomain');
  for (const options of [{ linear: 0 }, { angular: 0 }, { angular: 1e-14 }]) assert.equal(clip(source, [4, 0, 0], [1, 0, 0], options).reason.$, 'InvalidInput');
  const open = structuredClone(source); open.faces = list(array(open.faces).slice(1));
  const orphan = structuredClone(source); orphan.vertices = list([...array(orphan.vertices), vector([4, 3, 2])]);
  const flipped = structuredClone(source); flipped.faces.head.surface.normal = vector([0, 0, 1]);
  for (const invalid of [open, orphan, flipped]) {
    const result = clip(invalid, [4, 0, 0], [1, 0, 0]);
    assert.equal(result.$, 'Unresolved'); assert.equal(result.solid, undefined); assert.equal(result.bodies, undefined);
  }
});

// Independent analytic oracle: a full cylindrical band has a circular axial
// projection. Integrating each cap's affine height cancels its odd terms,
// leaving pi*r^2 times the difference of its axis intercepts. Bounds come from
// exact conic coordinate amplitudes; neither oracle constructs geometry.
function cylindricalMeasures(body) {
  const wall = body.faces.find(face => face.surface.type === 'cylinder').surface;
  const height = body.faces.filter(face => face.surface.type === 'plane').reduce((sum, face) => {
    const plane = face.surface, alignment = dot(plane.normal, wall.axis);
    const intercept = dot(plane.normal, sub(plane.origin, wall.origin)) / alignment;
    return sum + Math.sign(alignment) * (face.sameSense ? 1 : -1) * intercept;
  }, 0);
  const rims = body.edges.filter(edge => ['circle', 'ellipse'].includes(edge.curve.type)).map(({ curve }) => {
    const u = curve.x.map(v => v * (curve.radius ?? curve.major));
    const v = cross(curve.normal, curve.x).map(v => v * (curve.radius ?? curve.minor));
    const amplitude = u.map((value, i) => Math.hypot(value, v[i]));
    return { min: curve.origin.map((v, i) => v - amplitude[i]), max: curve.origin.map((v, i) => v + amplitude[i]) };
  });
  return { volume: Math.PI * wall.radius ** 2 * height, bounds: {
    min: [0, 1, 2].map(i => Math.min(...rims.map(rim => rim.min[i]))),
    max: [0, 1, 2].map(i => Math.max(...rims.map(rim => rim.max[i]))),
  } };
}

function verifyCylinder(result, source, expected, name) {
  assert.equal(result.$, 'Clipped', `${name}: ${JSON.stringify(result)}`);
  const { solid } = result, points = array(solid.vertices).map(coords), edges = array(solid.edges), faces = array(solid.faces);
  const sourceEdges = array(source.edges), sourceFaces = array(source.faces), sourcePoints = array(source.vertices).map(coords);
  assert.deepEqual([points.length, edges.length, faces.length], [2, 3, 3]);
  assert.deepEqual(array(result.domains).map(domain => domain.$), ['AutoDomain', 'AutoDomain', 'AutoDomain']);
  assert.equal(array(result.face_origins).length, 3); assert.equal(array(result.edge_origins).length, 3);
  assert.equal(faces.filter(face => face.surface.$ === 'Cylinder').length, 1);
  const uses = edges.map(() => [0, 0]);
  for (const [i, face] of faces.entries()) {
    const origin = array(result.face_origins)[i];
    if (origin.$ === 'SourceFace') {
      assert.deepEqual(face.surface, sourceFaces[origin.index].surface);
      assert.equal(face.same_sense, sourceFaces[origin.index].same_sense);
    } else assert.equal(origin.$, 'CutFace');
    const loops = array(face.loops); assert.equal(loops.length, 1); assert.equal(loops[0].outer, true);
    const boundary = array(loops[0].uses);
    assert.equal(boundary.length, face.surface.$ === 'Cylinder' ? 4 : 1);
    for (const [j, use] of boundary.entries()) {
      uses[use.edge][use.forward ? 0 : 1]++;
      const edge = edges[use.edge], nextUse = boundary[(j + 1) % boundary.length], next = edges[nextUse.edge];
      assert.equal(edge[use.forward ? 'end' : 'start'], next[nextUse.forward ? 'start' : 'end']);
    }
  }
  assert.ok(uses.every(count => count[0] === 1 && count[1] === 1));
  const seams = edges.flatMap((edge, i) => edge.curve.$ === 'Line' ? [i] : []);
  assert.equal(seams.length, 1); assert.notEqual(edges[seams[0]].start, edges[seams[0]].end);
  for (const [i, origin] of array(result.edge_origins).entries()) {
    const edge = edges[i];
    if (origin.$ === 'SourceEdge') {
      const sourceEdge = sourceEdges[origin.index];
      if (edge.curve.$ === 'Line') {
        const a = sourcePoints[sourceEdge.start], delta = sub(sourcePoints[sourceEdge.end], a);
        for (const point of [points[edge.start], points[edge.end]]) {
          near(Math.hypot(...cross(sub(point, a), delta)), 0);
          const parameter = dot(sub(point, a), delta) / dot(delta, delta);
          assert.ok(parameter >= -1e-10 && parameter <= 1 + 1e-10);
        }
      } else {
        assert.equal(edge.start, edge.end);
        assert.deepEqual(edge.curve, sourceEdge.curve);
        assert.equal(edge.same_sense, sourceEdge.same_sense);
      }
    } else {
      assert.equal(origin.$, 'CutEdge'); assert.equal(sourceFaces[origin.face].surface.$, 'Cylinder');
      assert.ok(['Circle', 'Ellipse'].includes(edge.curve.$)); assert.equal(edge.start, edge.end);
    }
  }
  const decoded = decodeAnalytic(solid, name, k), measured = cylindricalMeasures(decoded);
  assert.equal(decoded.validation.closed, true); near(measured.volume, expected);
  decoded.validation.volumeMm3 = measured.volume;
  decoded.validation.boundsMm = measured.bounds;
  decoded.validation.scope = 'endpoint and topology validation; independent analytic full-band volume and conic bounds test oracle';
  const model = { schema: 'wonky-brep/1', units: 'millimeter', backend: { language: 'Bend', version }, bodies: [decoded] };
  writeFileSync(new URL(`${name}.brep.json`, artifact), JSON.stringify(model, null, 2) + '\n');
  writeFileSync(new URL(`${name}.step`, artifact), toStep(model, name));
  evidence.push({ name, status: result.$, components: 1, volume: measured.volume, faces: [3], curves: edges.map(edge => edge.curve.$) });
  return solid;
}

test('separate Truck cylindrical loop path preserves full analytic axial and oblique sections', () => {
  const source = cylinder(), before = JSON.stringify(source);
  const axial = verifyCylinder(clipCylinder(source, [0, 0, 2], [0, 0, 1]), source, 18 * Math.PI, 'cylinder-axial');
  assert.deepEqual(array(axial.edges).map(edge => edge.curve.$), ['Circle', 'Circle', 'Line']);
  const oblique = verifyCylinder(clipCylinder(source, [0, 0, 2], [0.2, 0, 1]), source, 18 * Math.PI, 'cylinder-oblique');
  assert.deepEqual(array(oblique.edges).map(edge => edge.curve.$), ['Circle', 'Ellipse', 'Line']);
  const measured = cylindricalMeasures(decodeAnalytic(oblique, 'bounds-check', k));
  measured.bounds.min.forEach((value, i) => near(value, [-3, -3, 0][i]));
  measured.bounds.max.forEach((value, i) => near(value, [3, 3, 2.6][i]));
  verifyCylinder(clipCylinder(source, [0, 0, 2], [-0.2, 0, -1]), source, 18 * Math.PI, 'cylinder-upper');
  verifyCylinder(clipCylinder(source, [0, 0, 5], [0, 0, 1]), source, 36 * Math.PI, 'cylinder-uncut');
  assert.deepEqual(clipCylinder(source, [0, 0, -1], [0, 0, 1]), { $: 'Empty' });
  assert.equal(JSON.stringify(source), before);
});

test('Truck cylindrical outputs remain usable for repeated cuts and rigid transforms', () => {
  const source = cylinder();
  const first = verifyCylinder(clipCylinder(source, [0, 0, 3], [0.1, 0, 1]), source, 27 * Math.PI, 'cylinder-chain-first');
  verifyCylinder(clipCylinder(first, [0, 0, 1], [0, 0, 1]), first, 9 * Math.PI, 'cylinder-chain-circle');
  const between = verifyCylinder(clipCylinder(first, [0, 0, 1], [0, 0.1, -1]), first, 18 * Math.PI, 'cylinder-chain-ellipses');
  assert.deepEqual(array(between.edges).map(edge => edge.curve.$), ['Ellipse', 'Ellipse', 'Line']);
  verifyCylinder(clipCylinder(between, [0, 0, 2], [0.1, 0, 1]), between, 9 * Math.PI, 'cylinder-chain-third');
  const rotation = { $: 'Rotation', x: vector([0.8, 0, -0.6]), y: vector([0, 1, 0]), z: vector([0.6, 0, 0.8]) }, offset = vector([17, -31, 59]);
  const moved = k.analytic.transform(source, rotation, offset);
  const origin = k.analytic.point_transform(vector([0, 0, 2]), rotation, offset), normal = k.precise.rotate(vector([0.2, 0, 1]), rotation);
  verifyCylinder(clipCylinder(moved, origin, normal), moved, 18 * Math.PI, 'cylinder-rotated');
});

test('Truck cylinder rejects partial-rim arrangements, contact, explicit trims and tolerant sources', () => {
  const source = cylinder();
  for (const [origin, normal, reason] of [
    [[0, 0, 0], [0, 0, 1], 'AmbiguousContact'],
    [[3, 0, 0], [1, 0, 0], 'AmbiguousContact'],
    [[0, 0, 1e-9], [0, 0, 1], 'AmbiguousContact'],
    [[0, 0, 2], [1, 0, 0], 'UnsupportedArrangement'],
    [[0, 0, 2], [1, 0, 1], 'UnsupportedArrangement'],
  ]) assert.deepEqual(clipCylinder(source, origin, normal), { $: 'Unresolved', reason: { $: reason } });
  for (const domain of [{ $: 'Untrimmed' }, { $: 'Interval', first: real(0), last: real(1) }]) {
    assert.equal(clipCylinder(source, [0, 0, 2], [0, 0, 1], { domains: list([{ $: 'GivenDomain', domain }]) }).reason.$, 'UnsupportedDomain');
  }
  assert.equal(clipCylinder(source, [0, 0, 2], [0, 0, 1], { sourceBudget: 0.0003 }).reason.$, 'SourceTolerance');
  assert.equal(clipCylinder(source, [0, 0, 2], [0, 0, 1], { linear: 1e-14 }).reason.$, 'ResolutionLimit');
  const bore = circularFrustumInBend(k, 'bore', { center: [0, 0], radius: 1, plane: frame }, null, [0, 0, 4]);
  const multiWall = structuredClone(source); multiWall.faces = list([...array(multiWall.faces), ...array(classificationInput(bore, k.faceClassifier).solid.faces)]);
  assert.equal(clipCylinder(multiWall, [0, 0, 2], [0, 0, 1]).reason.$, 'UnsupportedArrangement');
  // Parallel oblique caps can be disjoint while their global axial ranges
  // overlap. This valid band is outside this helper's conservative domain.
  const overlappingRanges = cylinder(), normal = k.precise.normalize(vector([0.8, 0, 1]));
  overlappingRanges.vertices = list([vector([3, 0, -2.4]), vector([3, 0, -0.4])]);
  for (const [i, height] of [0, 2].entries()) {
    array(overlappingRanges.faces)[i].surface = k.analytic.plane(vector([0, 0, height]), normal);
    array(overlappingRanges.edges)[i].curve = k.analytic.plane_cylinder(vector([0, 0, height]), normal, vector([0, 0, 0]), vector([0, 0, 1]), real(3));
  }
  array(overlappingRanges.edges)[2].curve.origin = vector([3, 0, -2.4]);
  near(cylindricalMeasures(decodeAnalytic(overlappingRanges, 'overlapping-ranges', k)).volume, 18 * Math.PI);
  assert.equal(clipCylinder(overlappingRanges, [0, 0, 1], [0.8, 0, 1]).reason.$, 'UnsupportedArrangement');
});

test('Truck cylinder validates complete seam and conic incidence before returning any body', () => {
  const source = cylinder();
  const wrongSeam = structuredClone(source); array(wrongSeam.edges)[2].curve.direction = vector([1, 0, 1]);
  const chordSeam = structuredClone(source); array(chordSeam.vertices)[1].x = real(-3);
  const missingSeam = structuredClone(source); array(missingSeam.faces)[2].loops.head.uses = list([{ $: 'Use', edge: 0, forward: true }, { $: 'Use', edge: 1, forward: false }]);
  const wrongCurve = structuredClone(source); array(wrongCurve.edges)[1].curve.radius = real(2);
  const wrongSense = structuredClone(source); array(wrongSense.faces)[0].same_sense = true;
  const orphan = structuredClone(source); orphan.vertices = list([...array(orphan.vertices), vector([0, 0, 2])]);
  const falseEllipse = structuredClone(source); array(falseEllipse.edges)[0].curve = k.analytic.ellipse(vector([0, 0, 0]), vector([0, 0, 1]), vector([1, 0, 0]), real(3), real(2));
  for (const invalid of [wrongSeam, chordSeam, missingSeam, wrongCurve, wrongSense, orphan, falseEllipse]) {
    const result = clipCylinder(invalid, [0, 0, 2], [0, 0, 1]);
    assert.deepEqual(result, { $: 'Unresolved', reason: { $: 'InvalidTopology' } });
  }
});

test.after(() => {
  const files = ['kernel/ports/truck.bend', 'kernel/ports/truck-topology.bend', 'kernel/ports/truck-cylinder.bend', 'kernel/ports/types.bend', 'test/port-truck.test.mjs'];
  const hashes = Object.fromEntries(files.map(file => [file, createHash('sha256').update(readFileSync(new URL(`../${file}`, import.meta.url))).digest('hex')]));
  writeFileSync(new URL('focused-evidence.json', artifact), JSON.stringify({ hashes, cases: evidence }, null, 2) + '\n');
});

}
