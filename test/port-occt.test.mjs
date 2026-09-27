import test from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missingBend() || missing("kernel/ports/occt.bend");
if (publicTreeSkip) {
  test("port-occt.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { mkdirSync, writeFileSync } = await import("node:fs");
const { loadBend } = await import("../src/bend-loader.mjs");
const { loadKernel, extrudeInBend, array, list } = await import("../src/kernel.mjs");
const { classificationInput } = await import("../src/face-classification.mjs");
const { intersectionTolerance } = await import("../src/intersections.mjs");
const { decodeAnalytic, circularFrustumInBend } = await import("../src/analytic.mjs");
const { real, vector, number, coords } = await import("../src/real.mjs");
const { toStep } = await import("../src/exporters.mjs");











const [port, planar, kernel] = await Promise.all([
  loadBend(new URL('../kernel/ports/occt.bend', import.meta.url)),
  loadBend(new URL('../kernel/ports/occt-planar.bend', import.meta.url)), loadKernel(),
]);
const frame = { origin: [0, 0, 0], normal: [0, 0, 1], x: [1, 0, 0] };
const prism = (name, points) => extrudeInBend(kernel, name, points, frame, [0, 0, 4]);
const box = () => prism('box', [[0, 0], [8, 0], [8, 6], [0, 6]]);
const near = (a, b, eps = 2e-10) => assert.ok(Math.abs(a - b) <= eps * Math.max(1, Math.abs(b)), `${a} differs from ${b}`);
const bodies = result => result.$ === 'Clipped' ? [result] : result.$ === 'Components' ? array(result.bodies) : [];
function clip(body, origin, normal, options = {}) {
  const input = classificationInput(body, kernel.faceClassifier, options);
  return port.clip(input.solid, input.domains, origin.$ ? origin : vector(origin), normal.$ ? normal : vector(normal),
    intersectionTolerance(options), input.sourceBudget);
}
function checked(result, expectedVolumes) {
  assert.ok(['Clipped', 'Components'].includes(result.$), JSON.stringify(result));
  const components = bodies(result);
  assert.equal(components.length, expectedVolumes.length);
  if (components.length === 1) assert.equal(result.$, 'Clipped');
  else assert.equal(result.$, 'Components');
  const volumes = components.map(component => number(planar.volume(component.solid))).sort((a, b) => a - b);
  expectedVolumes.toSorted((a, b) => a - b).forEach((volume, i) => near(volumes[i], volume));
  for (const component of components) {
    const { solid } = component, edges = array(solid.edges), faces = array(solid.faces), vertices = array(solid.vertices);
    assert.equal(array(component.domains).length, edges.length);
    assert.equal(array(component.edge_origins).length, edges.length);
    assert.equal(array(component.face_origins).length, faces.length);
    assert.equal(planar.valid(solid, component.domains, real(1e-10)), true);
    const incident = edges.map(() => []);
    faces.forEach(face => array(face.loops).forEach(loop => array(loop.uses).forEach(use => incident[use.edge].push(use.forward))));
    incident.forEach(uses => assert.deepEqual(uses.toSorted(), [false, true]));
    assert.equal(new Set(edges.flatMap(edge => [edge.start, edge.end])).size, vertices.length);
    // Each output interval must still describe the returned support and sense.
    array(component.domains).forEach((choice, i) => {
      assert.equal(choice.$, 'GivenDomain');
      const edge = edges[i], interval = choice.domain;
      for (const [index, parameter] of [[edge.start, edge.same_sense ? interval.first : interval.last],
        [edge.end, edge.same_sense ? interval.last : interval.first]]) {
        const represented = coords(kernel.analytic.curve_point(edge.curve, parameter));
        represented.forEach((value, j) => near(value, coords(vertices[index])[j]));
      }
    });
  }
  return components;
}
function exportResult(result, name) {
  const root = new URL('../out/boolean-ports/occt/', import.meta.url);
  mkdirSync(root, { recursive: true });
  const decoded = bodies(result).map((component, i) => {
    const body = decodeAnalytic(component.solid, `${name}/${i}`, kernel);
    body.validation.volumeMm3 = number(planar.volume(component.solid));
    body.validation.boundsMm = { min: [0, 1, 2].map(j => Math.min(...body.vertices.map(p => p[j]))),
      max: [0, 1, 2].map(j => Math.max(...body.vertices.map(p => p[j]))) };
    array(component.domains).forEach((choice, j) => {
      body.edges[j].curveRange = [number(choice.domain.first), number(choice.domain.last)];
    });
    body.construction = { method: 'OCCT algorithmic Bend subset',
      faceOrigins: array(component.face_origins), edgeOrigins: array(component.edge_origins) };
    return body;
  });
  const model = { schema: 'wonky-brep/1', units: 'millimeter', backend: { language: 'Bend', version: '2.0.25' }, bodies: decoded };
  writeFileSync(new URL(`${name}.brep.json`, root), `${JSON.stringify(model, null, 2)}\n`);
  writeFileSync(new URL(`${name}.step`, root), toStep(model, name));
}

test('OCCT shared edge blocks construct a closed box clip with immutable input and complete provenance', () => {
  const input = box(), before = JSON.stringify(input);
  const result = clip(input, [4, 0, 0], [1, 0, 0]);
  const [body] = checked(result, [96]);
  assert.equal(JSON.stringify(input), before);
  assert.deepEqual([array(body.solid.vertices).length, array(body.solid.edges).length, array(body.solid.faces).length], [8, 12, 6]);
  assert.equal(array(body.face_origins).filter(origin => origin.$ === 'CutFace').length, 1);
  assert.equal(array(body.edge_origins).filter(origin => origin.$ === 'CutEdge').length, 4);
  assert.equal(new Set(array(body.edge_origins).filter(origin => origin.$ === 'SourceEdge').map(origin => origin.index)).size, 8);
  exportResult(result, 'half-box');
});

test('OCCT face area construction clips concave L and U profiles without convex substitution', () => {
  const l = prism('L', [[0, 0], [8, 0], [8, 2], [3, 2], [3, 6], [0, 6]]);
  checked(clip(l, [4, 0, 0], [1, 0, 0]), [80]);
  checked(clip(l, [0, 3, 0], [0, 1, 0]), [76]);
  checked(clip(l, [0, 3, 0], [0, -1, 0]), [36]);
  const result = clip(l, [0, 0, 2], [0, 0, 1]);
  checked(result, [56]); exportResult(result, 'concave-L');
  const u = prism('U', [[0, 0], [8, 0], [8, 6], [6, 6], [6, 2], [2, 2], [2, 6], [0, 6]]);
  checked(clip(u, [0, 0, 2], [0, 0, 1]), [64]);
});

test('OCCT produces separate closed components when a nonconvex face splits', () => {
  const u = prism('U', [[0, 0], [8, 0], [8, 6], [6, 6], [6, 2], [2, 2], [2, 6], [0, 6]]);
  const result = clip(u, [0, 3, 0], [0, -1, 0]);
  checked(result, [24, 24]); exportResult(result, 'U-components');
  // The cutter coincides with the inner crossbar face. Its outside zero-volume
  // remnant must disappear, leaving the two arms as complete components.
  checked(clip(u, [0, 2, 0], [0, -1, 0]), [32, 32]);
  checked(clip(u, [0, 2, 0], [0, 1, 0]), [64]);
  const c = prism('C', [[0, 0], [8, 0], [8, 2], [2, 2], [2, 4], [8, 4], [8, 6], [0, 6]]);
  checked(clip(c, [3, 0, 0], [-1, 0, 0]), [40, 40]);
});

test('OCCT handles oblique, exact face, edge and vertex contacts with regularized emptiness', () => {
  for (const origin of [[-1, 0, 0], [0, 0, 0]]) assert.equal(clip(box(), origin, [1, 0, 0]).$, 'Empty');
  checked(clip(box(), [8, 0, 0], [1, 0, 0]), [192]);
  checked(clip(box(), [0, 0, 0], [1, -1, 0]), [72]);
  checked(clip(box(), [0, 0, 0], [1, 1, -1]), [64 / 6]);
  const result = clip(box(), [3, 0, 0], [1, 1, 1]);
  checked(result, [4.5]); exportResult(result, 'oblique');
  assert.equal(clip(box(), [0, 0, 0], [1, 1, 1]).$, 'Empty');
});

test('OCCT respects reversed curve senses and reordered source IDs', () => {
  const input = classificationInput(box(), kernel.faceClassifier).solid, before = JSON.stringify(input);
  const edges = array(input.edges), n = edges.length;
  const permuted = { ...input,
    edges: list(edges.toReversed().map(edge => ({ ...edge, start: edge.end, end: edge.start, same_sense: !edge.same_sense }))),
    faces: list(array(input.faces).toReversed().map(face => ({ ...face,
      loops: list(array(face.loops).map(loop => ({ ...loop,
        uses: list(array(loop.uses).map(use => ({ ...use, edge: n - use.edge - 1, forward: !use.forward }))) }))) }))) };
  const [result] = checked(clip(permuted, [4, 0, 0], [1, 0, 0]), [96]);
  assert.equal(array(result.edge_origins).filter(origin => origin.$ === 'SourceEdge').length, 8);
  assert.equal(JSON.stringify(input), before);
});

test('OCCT is stable under native rigid transforms and returned-domain repeated clips', () => {
  const input = classificationInput(box(), kernel.faceClassifier).solid;
  const rotation = { $: 'Rotation', x: vector([0.8, 0, -0.6]), y: vector([0, 1, 0]), z: vector([0.6, 0, 0.8]) };
  const offset = vector([17, -31, 59]), moved = kernel.analytic.transform(input, rotation, offset);
  const result = clip(moved, kernel.analytic.point_transform(vector([4, 0, 0]), rotation, offset), kernel.precise.rotate(vector([1, 0, 0]), rotation));
  checked(result, [96]); exportResult(result, 'rotated');
  const [first] = checked(clip(box(), [4, 0, 0], [1, 0, 0]), [96]);
  const before = JSON.stringify(first);
  checked(clip(first.solid, [0, 3, 0], [0, 1, 0], { domains: array(first.domains) }), [48]);
  assert.equal(JSON.stringify(first), before);
});

test('OCCT checks all source faces and edges before empty or contained shortcuts', () => {
  const input = classificationInput(box(), kernel.faceClassifier).solid;
  const badFace = structuredClone(input), faces = array(badFace.faces);
  faces.at(-1).surface.x = vector([0, 0, 0]); badFace.faces = list(faces);
  const badEdge = structuredClone(input), edges = array(badEdge.edges);
  edges.at(-1).end = 100000; badEdge.edges = list(edges);
  const open = structuredClone(input); open.faces = list(array(open.faces).slice(1));
  for (const candidate of [badFace, badEdge, open]) for (const origin of [[-1, 0, 0], [4, 0, 0], [10, 0, 0]]) {
    const result = clip(candidate, origin, [1, 0, 0]);
    assert.equal(result.$, 'Unresolved'); assert.equal(result.solid, undefined);
  }
});

test('OCCT explicitly rejects uncertain contact, tolerant sources, curves and invalid domains', () => {
  assert.equal(clip(box(), [1e-9, 0, 0], [1, 0, 0]).reason.$, 'AmbiguousContact');
  assert.equal(clip(box(), [4, 0, 0], [1, 0, 0], { inputTolerance: 0.0003 }).reason.$, 'SourceTolerance');
  const round = circularFrustumInBend(kernel, 'round', { center: [0, 0], radius: 3, plane: frame }, null, [0, 0, 4]);
  for (const origin of [[-10, 0, 0], [0, 0, 0], [10, 0, 0]]) assert.equal(clip(round, origin, [1, 0, 0]).reason.$, 'UnsupportedSurface');
  assert.equal(clip(box(), [4, 0, 0], [0, 0, 0]).reason.$, 'InvalidInput');
  assert.equal(clip(box(), [4, 0, 0], [1, 0, 0], { domains: [[0, 1]] }).$, 'Unresolved');
  const invalid = Array.from({ length: 12 }, () => [-1, 2]);
  assert.equal(clip(box(), [10, 0, 0], [1, 0, 0], { domains: invalid }).$, 'Unresolved');
});

test('OCCT rejects a valid annular prism before shortcuts without filling its hole', () => {
  // Test fixture topology only: outer box minus a rectangular through-hole.
  const vertices = [[0, 0], [8, 0], [8, 6], [0, 6], [2, 2], [6, 2], [6, 4], [2, 4]]
    .flatMap(([x, y]) => [[x, y, 0], [x, y, 4]]);
  const definitions = [
    { normal: [0, 0, -1], rings: [[0, 6, 4, 2], [8, 10, 12, 14]] },
    { normal: [0, 0, 1], rings: [[1, 3, 5, 7], [9, 15, 13, 11]] },
    { normal: [0, -1, 0], rings: [[0, 2, 3, 1]] },
    { normal: [1, 0, 0], rings: [[2, 4, 5, 3]] },
    { normal: [0, 1, 0], rings: [[4, 6, 7, 5]] },
    { normal: [-1, 0, 0], rings: [[6, 0, 1, 7]] },
    { normal: [0, 1, 0], rings: [[10, 8, 9, 11]] },
    { normal: [-1, 0, 0], rings: [[12, 10, 11, 13]] },
    { normal: [0, -1, 0], rings: [[14, 12, 13, 15]] },
    { normal: [1, 0, 0], rings: [[8, 14, 15, 9]] },
  ];
  const edges = [], keys = new Map();
  const faces = definitions.map(({ normal, rings }) => ({ surface: { type: 'plane', origin: vertices[rings[0][0]], normal,
    x: normal[0] ? [0, 1, 0] : [1, 0, 0] }, sameSense: true, outer: rings.map((_, i) => i === 0),
    loops: rings.map(ids => ids.map((start, i) => {
      const end = ids[(i + 1) % ids.length], key = [start, end].sort((a, b) => a - b).join(':');
      if (!keys.has(key)) { keys.set(key, edges.length); edges.push({ start, end, curve: 'line' }); }
      const index = keys.get(key); return { edge: index, forward: edges[index].start === start };
    })) }));
  const input = { id: 'annular-prism', vertices, edges, faces };
  const counts = edges.map(() => []);
  faces.forEach(face => face.loops.forEach(loop => loop.forEach(use => counts[use.edge].push(use.forward))));
  counts.forEach(uses => assert.deepEqual(uses.toSorted(), [false, true]));
  for (const origin of [[-1, 0, 0], [4, 0, 0], [10, 0, 0]]) {
    const result = clip(input, origin, [1, 0, 0]);
    assert.equal(result.$, 'Unresolved'); assert.equal(result.reason.$, 'UnsupportedArrangement');
  }
});

}
