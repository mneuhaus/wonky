import test from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missingBend() || missing("fixtures/r10b/modules/base/ZtoDD.body.json", "fixtures/r10b/r10b.fs");
if (publicTreeSkip) {
  test("section.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { readFileSync } = await import("node:fs");
const { createHash } = await import("node:crypto");
const { loadKernel, array, list, extrudeInBend } = await import("../src/kernel.mjs");
const { real, number, vector, coords } = await import("../src/real.mjs");
const { importOnshapeBody, transformAnalytic } = await import("../src/analytic.mjs");
const { classificationInput, loadFaceClassifier } = await import("../src/face-classification.mjs");
const { intersectEdgePlane } = await import("../src/edge-plane.mjs");
const { loadSection, sectionSolid, requireResolvedSection } = await import("../src/section.mjs");
const { UnsupportedFeatureError } = await import("../src/errors.mjs");












const frame = { origin: [0, 0, 0], normal: [0, 0, 1], x: [1, 0, 0] };
const cut = (origin, normal) => ({ type: 'plane', origin, normal });
const box = k => extrudeInBend(k, 'section-box', [[0, 0], [8, 0], [8, 6], [0, 6]], frame, [0, 0, 4]);
const cylinder = k => k.analytic.frustum(vector([0, 0, 0]), vector([0, 0, 10]), vector([1, 0, 0]), real(5), real(5));
const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
const nearPoint = (a, b, eps = 1e-9) => a.forEach((v, i) => near(v, b[i], eps));
const add = (a, b) => a.map((v, i) => v + b[i]);
const sub = (a, b) => a.map((v, i) => v - b[i]);
const scale = (a, s) => a.map(v => v * s);
const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = a => scale(a, 1 / Math.hypot(...a));

function combineNative(first, second) {
  const vertices = array(first.vertices), edges = array(first.edges), vi = vertices.length, ei = edges.length;
  return { $: 'Solid', vertices: list([...vertices, ...array(second.vertices)]),
    edges: list([...edges, ...array(second.edges).map(e => ({ ...e, start: e.start + vi, end: e.end + vi }))]),
    faces: list([...array(first.faces), ...array(second.faces).map(f => ({ ...f,
      loops: list(array(f.loops).map(l => ({ ...l, uses: list(array(l.uses).map(u => ({ ...u, edge: u.edge + ei }))) }))) }))]) };
}

function resolved(result, pieces, contours, faceCount) {
  assert.equal(result.$, 'Resolved', JSON.stringify({ kind: result.$, reason: result.reason }));
  assert.equal(result.relation.$, pieces ? 'Transverse' : 'Empty');
  assert.equal(array(result.pieces).length, pieces);
  assert.equal(array(result.edges).length, pieces);
  assert.equal(array(result.contours).length, contours);
  if (faceCount !== undefined) assert.equal(array(result.faces).length, faceCount);
  assert.ok(array(result.faces).every(f => f.result.$ === 'Resolved'));
  const edges = array(result.edges), uses = array(result.contours).flatMap(r => array(r.uses));
  assert.equal(uses.length, pieces);
  assert.equal(new Set(uses.map(u => u.edge)).size, pieces);
  for (const ring of array(result.contours)) {
    const uses = array(ring.uses);
    uses.forEach((use, i) => {
      const e = edges[use.edge], next = uses[(i + 1) % uses.length], n = edges[next.edge];
      assert.equal(use.forward ? e.end : e.start, next.forward ? n.start : n.end);
    });
  }
  return result;
}

function failed(result, kind, faceCount) {
  assert.equal(result.$, 'Failed');
  if (kind) assert.equal(result.reason.$, kind, JSON.stringify(result.reason));
  for (const field of ['roots', 'edges', 'pieces', 'contours']) assert.equal(result[field], undefined);
  if (faceCount !== undefined) assert.equal(array(result.faces).length, faceCount);
  assert.throws(() => requireResolvedSection(result), UnsupportedFeatureError);
  return result;
}

function orientationReference(piece, cutter) {
  const curve = piece.section.curve, t = number(piece.orientation.parameter);
  let point, tangent;
  if (curve.$ === 'Line') {
    tangent = coords(curve.direction);
    point = add(coords(curve.origin), scale(tangent, t));
  } else {
    const x = coords(curve.x), y = cross(coords(curve.normal), x);
    const a = number(curve.radius ?? curve.major), b = number(curve.radius ?? curve.minor);
    point = add(coords(curve.origin), add(scale(x, a * Math.cos(t)), scale(y, b * Math.sin(t))));
    tangent = add(scale(x, -a * Math.sin(t)), scale(y, b * Math.cos(t)));
  }
  const face = piece.face.face, surface = face.surface;
  let normal;
  if (surface.$ === 'Plane') normal = unit(coords(surface.normal));
  else {
    const axis = unit(coords(surface.axis)), delta = sub(point, coords(surface.origin));
    normal = unit(sub(delta, scale(axis, dot(delta, axis))));
  }
  if (!face.same_sense) normal = scale(normal, -1);
  const positive = unit(cross(unit(cutter), normal));
  const directed = scale(unit(tangent), piece.orientation.forward ? 1 : -1);
  assert.ok(dot(directed, positive) > 1 - 1e-12);
  nearPoint(coords(piece.orientation.outward_normal), normal);
  nearPoint(coords(piece.orientation.positive_tangent), positive);
  assert.ok(number(piece.orientation.parallel_error) <= number(piece.orientation.angular_margin));
}

function linearArea(result, ring, normal) {
  const pieces = array(result.pieces), n = unit(normal);
  return array(ring.uses).reduce((sum, use) => {
    const section = pieces[use.edge].section;
    assert.equal(section.curve.$, 'Line');
    const a = coords(use.forward ? section.first.point : section.last.point);
    const b = coords(use.forward ? section.last.point : section.first.point);
    return sum + dot(cross(a, b), n) / 2;
  }, 0);
}

function annularCylinder() {
  const circle = (r, z) => ({ type: 'circle', origin: [0, 0, z], normal: [0, 0, 1], x: [1, 0, 0], radius: r });
  const use = (edge, forward) => ({ edge, forward });
  const side = (radius, sameSense, loops) => ({ surface: { type: 'cylinder', origin: [0, 0, 0], axis: [0, 0, 1], x: [1, 0, 0], radius }, sameSense, loops: [loops], outer: [true] });
  return {
    vertices: [[5, 0, 0], [5, 0, 10], [2, 0, 0], [2, 0, 10]],
    edges: [
      { start: 0, end: 0, sameSense: true, curve: circle(5, 0) },
      { start: 1, end: 1, sameSense: true, curve: circle(5, 10) },
      { start: 0, end: 1, sameSense: true, curve: { type: 'line', origin: [5, 0, 0], direction: [0, 0, 1] } },
      { start: 2, end: 2, sameSense: true, curve: circle(2, 0) },
      { start: 3, end: 3, sameSense: true, curve: circle(2, 10) },
      { start: 2, end: 3, sameSense: true, curve: { type: 'line', origin: [2, 0, 0], direction: [0, 0, 1] } },
    ],
    faces: [
      { surface: { type: 'plane', ...frame }, sameSense: false, loops: [[use(0, false)], [use(3, true)]], outer: [true, false] },
      { surface: { type: 'plane', ...frame, origin: [0, 0, 10] }, sameSense: true, loops: [[use(1, true)], [use(4, false)]], outer: [true, false] },
      side(5, true, [use(0, true), use(2, true), use(1, false), use(2, false)]),
      side(2, false, [use(5, true), use(4, true), use(5, false), use(3, false)]),
    ],
  };
}

test('box sections are complete directed contours with original shared edge roots', async () => {
  const body = box(await loadKernel()), before = structuredClone(body), plane = cut([2, 0, 0], [1, 0, 0]);
  const result = resolved(await sectionSolid(body, plane), 4, 1, 6);
  assert.equal(requireResolvedSection(result), result);
  const roots = array(result.roots), pieces = array(result.pieces);
  assert.equal(roots.length, 4);
  near(linearArea(result, array(result.contours)[0], plane.normal), 24);
  for (const piece of pieces) {
    orientationReference(piece, plane.normal);
    for (const [ref, endpoint] of [[piece.first, piece.section.first], [piece.last, piece.section.last]]) {
      const root = roots[ref.root], association = ref.association;
      assert.equal(root.$, 'SourceRoot');
      assert.equal(root.edge, endpoint.event.edge);
      assert.deepEqual(root.hit, endpoint.event.hit);
      assert.deepEqual(root.source, endpoint.event.source);
      assert.deepEqual(association.original, endpoint.event);
      assert.deepEqual(association.checked.point, endpoint.point);
      assert.deepEqual(association.checked.parameter, endpoint.parameter);
      assert.ok(number(association.checked.gap) <= number(association.margin));
    }
  }
  for (const root of roots) {
    const reference = await intersectEdgePlane(body, root.edge, plane);
    assert.equal(reference.$, 'Resolved');
    assert.deepEqual(root.source, reference.source);
    assert.deepEqual(root.hit, array(reference.hits)[0]);
  }
  assert.deepEqual(body, before);
  resolved(await sectionSolid(body, cut([50, 0, 0], [1, 0, 0])), 0, 0, 6);
});

test('concave prisms retain both disconnected contours without nesting labels', async () => {
  const body = extrudeInBend(await loadKernel(), 'concave-section', [[0, 0], [8, 0], [8, 6], [6, 6], [6, 2], [2, 2], [2, 6], [0, 6]], frame, [0, 0, 4]);
  const result = resolved(await sectionSolid(body, cut([0, 4, 0], [0, 1, 0])), 8, 2, 10);
  for (const ring of array(result.contours)) {
    near(linearArea(result, ring, [0, 1, 0]), 8);
    assert.deepEqual(Object.keys(ring).sort(), ['$', 'uses']);
  }
  for (const piece of array(result.pieces)) orientationReference(piece, [0, 1, 0]);
});

test('transverse and oblique cylinder sections retain analytic periodic seams', async () => {
  const body = cylinder(await loadKernel());
  for (const [normal, kind] of [[[0, 0, 1], 'Circle'], [[-0.4, 0, 1], 'Ellipse']]) {
    const result = resolved(await sectionSolid(body, cut([0, 0, 5], normal)), 1, 1, 3);
    const [piece] = array(result.pieces), [root] = array(result.roots), [edge] = array(result.edges);
    assert.equal(root.$, 'SyntheticSeam');
    assert.equal(root.face, 2); assert.equal(root.section, 0);
    assert.equal(edge.start, edge.end);
    assert.equal(piece.first.root, piece.last.root);
    assert.equal(piece.section.curve.$, kind);
    assert.equal(piece.section.domain.$, 'Untrimmed');
    assert.deepEqual(piece.section.first, piece.section.last);
    assert.deepEqual(root.point, piece.section.first.point);
    orientationReference(piece, normal);
    if (kind === 'Ellipse') near(number(piece.section.curve.major), 5 * Math.sqrt(1.16));
  }
});

test('longitudinal and clipped oblique cylinder sections join actual rim roots', async () => {
  const body = cylinder(await loadKernel());
  const longitudinal = resolved(await sectionSolid(body, cut([1, 0, 0], [1, 0, 0])), 4, 1, 3);
  near(linearArea(longitudinal, array(longitudinal.contours)[0], [1, 0, 0]), 20 * Math.sqrt(24));
  assert.equal(array(longitudinal.pieces).filter(p => p.orientation.family.$ === 'CylinderGenerator').length, 2);
  for (const piece of array(longitudinal.pieces)) orientationReference(piece, [1, 0, 0]);
  const throughSourceSeam = resolved(await sectionSolid(body, cut([0, 0, 0], [0, 1, 0])), 4, 1, 3);
  assert.ok(array(throughSourceSeam.roots).every(r => r.$ === 'SourceRoot'));
  assert.equal(array(throughSourceSeam.roots).filter(r => r.hit.location.$ === 'SeamVertex').length, 2);
  const result = resolved(await sectionSolid(body, cut([0, 0, 1], [-1, 0, 1])), 2, 1, 3);
  const curved = array(result.pieces).find(p => p.section.curve.$ === 'Ellipse');
  assert.ok(number(curved.section.last.parameter) > 2 * Math.PI);
  assert.ok(number(curved.section.last.event.parameter) < 2 * Math.PI);
  assert.deepEqual(curved.last.association.original, curved.section.last.event);
  assert.deepEqual(curved.last.association.checked.parameter, curved.section.last.parameter);
  assert.deepEqual(curved.last.association.checked.point, curved.section.last.point);
  assert.deepEqual(curved.last.association.checked.hit, curved.section.last.event.hit);
  for (const piece of array(result.pieces)) orientationReference(piece, [-1, 0, 1]);
});

test('bored cylinders preserve separately directed outer and inner periodic contours', async () => {
  const body = annularCylinder();
  const result = resolved(await sectionSolid(body, cut([0, 0, 5], [0, 0, 1])), 2, 2, 4);
  assert.equal(new Set(array(result.pieces).map(p => p.first.root)).size, 2);
  assert.ok(array(result.roots).every(r => r.$ === 'SyntheticSeam'));
  const pieces = array(result.pieces);
  assert.deepEqual(pieces.map(p => [number(p.section.curve.radius), p.orientation.forward]), [[5, true], [2, false]]);
  for (const p of pieces) orientationReference(p, [0, 0, 1]);
  const lengthwise = resolved(await sectionSolid(body, cut([1, 0, 0], [1, 0, 0])), 8, 2, 4);
  for (const ring of array(lengthwise.contours)) near(linearArea(lengthwise, ring, [1, 0, 0]), 10 * (Math.sqrt(24) - Math.sqrt(3)));
  for (const p of array(lengthwise.pieces)) orientationReference(p, [1, 0, 0]);
  for (const face of body.faces) {
    if (face.surface.axis) face.surface.axis = [0, 0, 7.123456789];
    if (face.surface.normal) face.surface.normal = [0, 0, 3.125];
    face.surface.x = [0.625, 0, 0];
  }
  const nonunit = resolved(await sectionSolid(body, cut([0, 0, 5], [-1.25, 0, 3.125])), 2, 2, 4);
  for (const p of array(nonunit.pieces)) orientationReference(p, [-1.25, 0, 3.125]);
});

test('normal reversal and native rigid transforms preserve source geometry and change directed sense', async () => {
  const k = await loadKernel(), f = await loadFaceClassifier(), native = classificationInput(box(k), f).solid;
  const positive = resolved(await sectionSolid(native, cut([2, 0, 0], [1, 0, 0])), 4, 1, 6);
  const negative = resolved(await sectionSolid(native, cut([2, 0, 0], [-1, 0, 0])), 4, 1, 6);
  near(linearArea(positive, array(positive.contours)[0], [1, 0, 0]), 24);
  near(linearArea(negative, array(negative.contours)[0], [1, 0, 0]), -24);
  const rotation = { $: 'Rotation', x: vector([0.8, 0, -0.6]), y: vector([0, 1, 0]), z: vector([0.6, 0, 0.8]) }, offset = vector([29, -17, 83]);
  const transformed = k.analytic.transform(native, rotation, offset), before = structuredClone(transformed);
  const plane = { origin: k.analytic.point_transform(vector([2, 0, 0]), rotation, offset), normal: k.precise.rotate(vector([1, 0, 0]), rotation) };
  const result = resolved(await sectionSolid(transformed, plane), 4, 1, 6);
  near(linearArea(result, array(result.contours)[0], coords(plane.normal)), 24);
  for (const p of array(result.pieces)) {
    orientationReference(p, coords(plane.normal));
    assert.deepEqual(p.face.face, array(transformed.faces)[p.face.index]);
    assert.deepEqual(p.face.plane_origin, plane.origin); assert.deepEqual(p.face.plane_normal, plane.normal);
    for (const ref of [p.first, p.last]) {
      const source = ref.association.original.source;
      assert.deepEqual(source.edge, array(transformed.edges)[source.index]);
      assert.deepEqual(source.start, array(transformed.vertices)[source.edge.start]);
      assert.deepEqual(source.end, array(transformed.vertices)[source.edge.end]);
    }
  }
  assert.deepEqual(transformed, before);
  for (const normal of [[0, 0, 1], [0, 0, -1]]) {
    const ring = resolved(await sectionSolid(annularCylinder(), cut([0, 0, 5], normal)), 2, 2, 4);
    for (const p of array(ring.pieces)) orientationReference(p, normal);
  }
  const round = k.analytic.transform(cylinder(k), rotation, offset);
  const roundCut = { origin: k.analytic.point_transform(vector([0, 0, 5]), rotation, offset), normal: k.precise.rotate(vector([-0.4, 0, 1]), rotation) };
  const roundResult = resolved(await sectionSolid(round, roundCut), 1, 1, 3);
  assert.equal(array(roundResult.pieces)[0].section.curve.$, 'Ellipse');
  orientationReference(array(roundResult.pieces)[0], coords(roundCut.normal));
});

test('support endpoint gaps are retained as checked associations, without rewriting roots or curves', async () => {
  const k = await loadKernel(), f = await loadFaceClassifier(), body = classificationInput(box(k), f).solid;
  const faces = array(body.faces), gap = 1e-5;
  faces[1].surface.origin.z = real(4 + gap); body.faces = list(faces);
  const before = structuredClone(body), result = resolved(await sectionSolid(body, cut([2, 0, 0], [1, 0, 0]), { inputTolerance: 2e-5 }), 4, 1, 6);
  const top = array(result.pieces).find(p => p.face.index === 1);
  for (const [ref, endpoint] of [[top.first, top.section.first], [top.last, top.section.last]]) {
    const a = ref.association;
    near(coords(endpoint.point)[2], 4 + gap);
    near(coords(a.original.hit.point)[2], 4);
    near(number(a.checked.gap), gap);
    assert.deepEqual(a.checked.point, endpoint.point);
    assert.deepEqual(array(result.roots)[ref.root].hit, a.original.hit);
    assert.notDeepEqual(a.checked.point, a.original.hit.point);
    assert.ok(number(a.checked.gap) < number(a.margin));
  }
  assert.deepEqual(body, before);
});

test('root matching requires source edge and exact parameter words plus identical original hit coordinates', async () => {
  const result = resolved(await sectionSolid(box(await loadKernel()), cut([2, 0, 0], [1, 0, 0])), 4, 1, 6);
  const s = await loadSection(), [root] = array(result.roots), roots = list([root]);
  assert.deepEqual(s.find_root(roots, root.edge, root.hit, 0), { $: 'FoundRoot', index: 0 });
  assert.equal(s.find_root(roots, root.edge + 1, root.hit, 0).$, 'MissingRoot');
  const parameterChanged = structuredClone(root.hit); parameterChanged.parameter.lo += 1e-12;
  assert.equal(s.find_root(roots, root.edge, parameterChanged, 0).$, 'MissingRoot');
  const pointChanged = structuredClone(root.hit); pointChanged.point.z.lo += 1e-12;
  assert.deepEqual(s.find_root(roots, root.edge, pointChanged, 0), { $: 'ConflictingRoot', index: 0 });
  // Coordinates are allowed to agree exactly while unrelated source keys stay distinct.
  assert.equal(s.find_root(list([{ ...root, edge: root.edge + 1 }]), root.edge, root.hit, 0).$, 'MissingRoot');
});

test('contacts, unsupported surfaces and uncertain supporting intersections return no partial contours', async () => {
  const k = await loadKernel(), b = box(k), c = cylinder(k);
  for (const plane of [cut([0, 0, 0], [1, 0, 0]), cut([0, 0, 0], [1, 1, 1]), cut([0, 0, 4], [0, 0, 1])]) failed(await sectionSolid(b, plane), 'FaceContact', 6);
  failed(await sectionSolid(c, cut([5, 0, 0], [1, 0, 0])), 'FaceContact', 3);
  failed(await sectionSolid(c, cut([0, 0, 5], [1e-13, 0, 1])), 'FaceUnresolved', 3);
  const cone = k.analytic.frustum(vector([0, 0, 0]), vector([0, 0, 10]), vector([1, 0, 0]), real(5), real(3));
  const unsupported = failed(await sectionSolid(cone, cut([0, 0, 5], [0, 0, 1])), 'FaceRejected', 3);
  assert.equal(unsupported.reason.face, 2); assert.equal(unsupported.reason.reason.$, 'UnsupportedSurface');
  const f = await loadFaceClassifier(), native = classificationInput(b, f).solid;
  const identity = { $: 'Rotation', x: vector([1, 0, 0]), y: vector([0, 1, 0]), z: vector([0, 0, 1]) };
  const two = combineNative(native, k.analytic.transform(native, identity, vector([2, 10, 0])));
  const partial = failed(await sectionSolid(two, cut([2, 0, 0], [1, 0, 0])), 'FaceContact', 12);
  assert.equal(array(partial.faces).slice(0, 6).reduce((n, f) => n + array(f.result.sections).length, 0), 4);
});

test('every face is prepared even after empty results, and invalid topology or orientation fails closed', async () => {
  const k = await loadKernel(), f = await loadFaceClassifier(), body = classificationInput(box(k), f).solid;
  const invalid = structuredClone(body), faces = array(invalid.faces);
  faces[5].surface.x = structuredClone(faces[5].surface.normal); invalid.faces = list(faces);
  const result = failed(await sectionSolid(invalid, cut([50, 0, 0], [1, 0, 0])), 'FaceRejected', 6);
  assert.equal(result.reason.face, 5);
  assert.ok(array(result.faces).slice(0, 5).every(f => f.result.$ === 'Resolved' && f.result.relation.$ === 'Empty'));
  const open = structuredClone(body); open.faces.head.loops.head.uses.head.forward = !open.faces.head.loops.head.uses.head.forward;
  failed(await sectionSolid(open, cut([2, 0, 0], [1, 0, 0])), 'SourceNotClosed', 0);
  const wrongSense = structuredClone(body); wrongSense.faces.head.same_sense = !wrongSense.faces.head.same_sense;
  const inconsistent = failed(await sectionSolid(wrongSense, cut([2, 0, 0], [1, 0, 0])), 'StitchFailure', 6);
  assert.equal(inconsistent.reason.reason.$, 'OpenBoundary');
  for (const options of [{ linear: 0 }, { angular: 1e-15 }, { inputTolerance: -1 }]) failed(await sectionSolid(body, cut([2, 0, 0], [1, 0, 0]), options), 'InvalidInput', 0);
  failed(await sectionSolid(body, cut([2, 0, 0], [0, 0, 0])), 'InvalidInput', 0);
  const badVertex = structuredClone(body); badVertex.vertices = list([...array(badVertex.vertices), { $: 'V3', x: { $: 'Real', hi: 0, lo: 1 }, y: real(0), z: real(0) }]);
  assert.equal(failed(await sectionSolid(badVertex, cut([50, 0, 0], [1, 0, 0])), 'InvalidVertex', 0).reason.vertex, 8);
});

test('fresh frozen P10 yields 12 stitched sections on each actual right and top box plane; y=4 remains unresolved', async () => {
  const bytes = readFileSync(new URL('../fixtures/r10b/modules/base/ZtoDD.body.json', import.meta.url));
  const fsBytes = readFileSync(new URL('../fixtures/r10b/r10b.fs', import.meta.url));
  const hash = value => createHash('sha256').update(value).digest('hex');
  assert.equal(hash(bytes), 'b78a8546970e360ee2a3a22661c87d4f9e835d24fe50cedeedde6a19add20dc9');
  assert.equal(hash(fsBytes), '219ee9630f37f9e54fe7e1b4e09094ab25748a811ed8f9e8b9ebf4892d8b8349');
  const k = await loadKernel(), body = transformAnalytic(k, importOnshapeBody(k, JSON.parse(bytes).bodies[0], 'section-P10', { sha256: hash(bytes) }), 'section-g0',
    [[1, 0, 0], [0, 0.9063077870366499, -0.42261826174069944], [0, 0.42261826174069944, 0.9063077870366499]], [0, 85.7915071334, -183.980480768]);
  const clip = extrudeInBend(k, 'section-clip', [[-119, 4], [-92.79, 4], [-92.79, 46], [-119, 46]], { ...frame, origin: [0, 0, -61] }, [0, 0, 129]);
  assert.equal(clip.faces[3].surface.origin[0], -92.79000000000002);
  assert.equal(clip.faces[1].surface.origin[2], 68);
  const before = structuredClone(body);
  for (const index of [3, 1]) {
    const result = await sectionSolid(body, clip.faces[index].surface);
    assert.equal(result.$, 'Resolved', JSON.stringify(result.reason));
    resolved(result, 12, index === 3 ? 2 : 1, 189);
    assert.deepEqual(array(result.contours).map(r => array(r.uses).length).sort((a, b) => a - b), index === 3 ? [4, 8] : [12]);
    assert.equal(array(result.roots).length, 12);
    assert.ok(array(result.roots).every(r => r.$ === 'SourceRoot'));
    for (const piece of array(result.pieces)) orientationReference(piece, clip.faces[index].surface.normal);
  }
  const unresolved = failed(await sectionSolid(body, clip.faces[2].surface), 'FaceUnresolved', 189);
  assert.equal(array(unresolved.faces).filter(f => f.result.$ === 'Unresolved').length, 16);
  assert.deepEqual(body, before);
});

}
