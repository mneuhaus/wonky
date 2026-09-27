import test from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missingBend();
if (publicTreeSkip) {
  test("viewer-section.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { mkdtemp, readFile, rm, writeFile } = await import("node:fs/promises");
const { tmpdir } = await import("node:os");
const { join } = await import("node:path");
const { build } = await import("../src/index.mjs");
const { createReviewServer } = await import("../src/review-server.mjs");
const { QUERY_HANDLERS } = await import("../src/viewer/query-worker.mjs");
const { DISPLAY_TOLERANCE_MM, chordBound, parseSectionRequest, reasonChain, sampleCurve, sectionQuery } = await import("../src/viewer/section.mjs");
const { createViewer } = await import("../viewer/app.js");
const { loadFeatures } = await import("../viewer/core/feature-loader.js");
const { LEGACY_FEATURES } = await import("../viewer/features/index.js");
const { axisOf, axisPlane, cleanDirection, exactSummary, flipPlane, planeState, planeText, positionOf, restoreSetting, setup: setupSection, settingOf, sliderRange, viewPlane, withPosition, worldPlane } = await import("../viewer/features/section/section.js");
const { bodyBounds, boxRect, capAvailability, capCovers, gapRadius, planeBoxPolygon, planesMeetBox, relativePlane } = await import("../viewer/features/section/section-caps.js");
const { createFakeEnvironment } = await import("../scripts/viewer/test-support/fake-env.mjs");
// section package: display clip planes, stencil cap helpers and exact
// contours (viewer/features/section/*, src/viewer/section.mjs and its route).
// Kernel cases are built from the example sources, so contours and failures
// come from the real `sectionSolid`.
















const source = path => readFile(new URL(path, import.meta.url), 'utf8');
const serialize = model => JSON.parse(JSON.stringify(model));
const [bracket, spacer, cone] = await Promise.all(['bracket', 'bored-spacer', 'conical-spacer']
  .map(name => source(`../examples/${name}.fs`).then(text => build(text)).then(serialize)));
const near = (actual, expected, tolerance = 1e-9) => assert.ok(
  Math.abs(actual - expected) <= tolerance, `${actual} is not ${expected} ±${tolerance}`);
const box = { min: [0, 0, 0], max: [50, 40, 8] };

// ---- Plane math ----

test('plane state: axis planes, positions, flip, view normal and text', () => {
  assert.deepEqual(cleanDirection([1e-17, -2, 3e-14]), [0, -1, 0], 'preset views snap');
  assert.equal(cleanDirection([0, 0, 0]), null);
  assert.deepEqual(axisOf([0, -1, 0]), { index: 1, sign: -1 });
  assert.equal(axisOf([0.6, 0.8, 0]), null);

  const front = planeState([0, -1, 0]);
  assert.equal(front.offset, null, 'no model yet: through the center later');
  assert.deepEqual(worldPlane(front, box), { origin: [0, 20, 0], normal: [0, -1, 0] });
  assert.equal(positionOf(front, box), 20, 'axis planes show the coordinate');
  const moved = withPosition(front, 12.5);
  assert.equal(moved.offset, -12.5, 'dot(n, p) = offset with n = -Y');
  assert.deepEqual(worldPlane(moved, box).origin, [0, 12.5, 0]);
  const flipped = flipPlane(moved);
  assert.deepEqual(flipped.normal, [0, 1, 0]);
  assert.deepEqual(worldPlane(flipped, box).origin, [0, 12.5, 0], 'flip keeps the plane');
  assert.equal(planeText(moved, box), 'y = 12.50 mm · normal −Y · the −Y side is cut away');

  const iso = [0.577, -0.577, 0.577];
  const x = axisPlane(0, iso, moved, box);
  assert.deepEqual(x.normal, [1, 0, 0], 'the half toward the camera (+X in iso) is cut');
  assert.equal(positionOf(x, box), 25, 'another axis starts at the model center');
  assert.equal(positionOf(axisPlane(0, [-1, 0, 0], withPosition(x, 18), box), box), 18,
    'the same axis keeps its position');
  const view = viewPlane(withPosition(x, 18), [0.6, 0, 0.8], box);
  assert.deepEqual(view.normal, [0.6, 0, 0.8]);
  near(view.offset, 0.6 * 18, 1e-12, 'normal from view keeps the plane point');
  assert.match(planeText(view, box), /normal \(\+0\.600, \+0\.000, \+0\.800\)/);

  assert.deepEqual(sliderRange(front, box), [-0.8, 40.8, 0.01]);
  assert.deepEqual(sliderRange(x, box), [-1, 51, 0.1]);
  assert.equal(sliderRange(front, null), null);
});

test('section settings round trip and reject malformed entries', () => {
  const state = { on: true, active: 1, planes: [planeState([1, 0, 0], 18),
    planeState([0, 0, -1], -4, false)] };
  const saved = JSON.parse(JSON.stringify(settingOf(state)));
  assert.deepEqual(restoreSetting(saved), state);
  assert.equal(restoreSetting(null), null);
  const repaired = restoreSetting({ on: 'yes', active: 9, planes: [{ normal: [0, 0, 0] },
    { normal: 'x' }, { normal: [0, 0, 2], offset: 3 }, { normal: [1, 0, 0] },
    { normal: [0, 1, 0] }, { normal: [1, 1, 0] }] });
  assert.equal(repaired.on, false);
  assert.equal(repaired.planes.length, 3, 'at most three planes');
  assert.deepEqual(repaired.planes[0], { normal: [0, 0, 1], offset: 3, enabled: true });
  assert.equal(repaired.active, 2);
  assert.deepEqual(restoreSetting({ planes: [] }).planes, [planeState([0, -1, 0])]);
});

// ---- Cap geometry ----

test('plane polygons cover the bounds; relative planes match the renderer', () => {
  const quad = planeBoxPolygon({ origin: [18, 0, 0], normal: [1, 0, 0] }, box, 0);
  assert.equal(quad.length, 4);
  assert.ok(quad.every(point => point[0] === 18));
  const rounded = value => Math.round(value * 1e6) / 1e6 + 0;
  assert.deepEqual(quad.map(point => [rounded(point[1]), rounded(point[2])]).sort(),
    [[0, 0], [0, 8], [40, 0], [40, 8]].sort(), 'the bounds face (grown by 1e-9 mm)');
  const cube = { min: [-1, -1, -1], max: [1, 1, 1] };
  const hexagon = planeBoxPolygon({ origin: [0, 0, 0], normal: [1, 1, 1] }, cube, 0);
  assert.equal(hexagon.length, 6, 'an oblique cut through the center is a hexagon');
  hexagon.forEach(point => near(point[0] + point[1] + point[2], 0, 1e-12));
  const normal = [1, 1, 1].map(value => value / Math.sqrt(3));
  for (let index = 0; index < 6; index++) {
    const [a, b, c] = [0, 1, 2].map(step => hexagon[(index + step) % 6]);
    const u = a.map((value, axis) => b[axis] - value);
    const v = b.map((value, axis) => c[axis] - value);
    const turn = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    assert.ok(turn.reduce((sum, value, axis) => sum + value * normal[axis], 0) > 0,
      'convex, counter-clockwise about the normal');
  }
  assert.equal(planeBoxPolygon({ origin: [60, 0, 0], normal: [1, 0, 0] }, box), null);
  const grown = planeBoxPolygon({ origin: [18, 0, 0], normal: [1, 0, 0] }, box);
  assert.ok(grown.some(point => point[1] < 0), 'the default margin grows the bounds');
  assert.deepEqual(relativePlane({ origin: [18, 0, 0], normal: [2, 0, 0] }, [25, 20, 4]),
    [1, 0, 0, -7]);
});

test('gap closing fills display-mesh seams but not real gaps or the outside', () => {
  assert.equal(gapRadius(0.02, 12, 2), 1, 'fit view: tolerance below one pixel');
  assert.equal(gapRadius(0.02, 60, 2), 3, 'close up: 2.4 px of tolerance');
  assert.equal(gapRadius(0.02, 1000, 2), 6, 'capped');
  assert.equal(gapRadius(null, 10, 1), 1);
  // A 12 × 12 px cap with a 1 px leak column (a seam) and real 2 and 5 px slots.
  const inside = (x, y) => x >= 0 && x < 12 && y >= 0 && y < 12;
  const seam = (x, y) => (inside(x, y) && x !== 5 ? 1 : 0);
  for (let y = 0; y < 12; y++) assert.equal(capCovers(seam, 5, y, 1), 1, `seam pixel ${y}`);
  for (const [x, y] of [[12, 5], [-1, 5], [5, 12], [5, -1], [13, 13]]) {
    assert.equal(capCovers(seam, x, y, 1), 0, `outside ${x},${y}`);
  }
  const slot = (x, y) => (inside(x, y) && (x < 3 || x > 7) ? 1 : 0);
  for (let x = 3; x <= 7; x++) assert.equal(capCovers(slot, x, 6, 2), 0, 'a 5 px slot stays open');
  const slit = (x, y) => (inside(x, y) && x !== 3 && x !== 4 ? 1 : 0);
  assert.equal(capCovers(slit, 3, 6, 1), 0, 'a 2 px slit stays open at gap 1');
  assert.equal(capCovers(slit, 3, 6, 2), 1, 'gap 2 closes up to 3 px');
});

test('cap passes are scissored to the body on screen', () => {
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const box = { min: [-0.5, -0.5, -0.5], max: [0.5, 0.5, 0.5] };
  const viewport = [0, 0, 100, 100];
  assert.deepEqual(boxRect(identity, [0, 0, 0], box, viewport, [0, 0, 99, 99], 2),
    [23, 23, 77, 77]);
  assert.deepEqual(boxRect(identity, [10, 0, 0], box, viewport, [0, 0, 99, 99], 0), null,
    'off screen');
  assert.deepEqual(boxRect(identity, [0, 0, 0], box, viewport, [40, 0, 99, 99], 0),
    [40, 25, 75, 75], 'cut to the pane clip');
  const behind = [...identity];
  behind[15] = -1;
  assert.deepEqual(boxRect(behind, [0, 0, 0], box, viewport, [0, 0, 99, 99]), [0, 0, 99, 99],
    'a corner behind the eye: the whole pane');
});

test('bodies with boundary-only faces are "cap unavailable"', () => {
  const model = {
    bodies: [
      { index: 0, id: 'solid', faceRange: [0, 2], indexRange: [0, 12] },
      { index: 1, id: 'open', faceRange: [2, 4], indexRange: [12, 18] },
      { index: 2, id: 'empty', faceRange: [4, 5], indexRange: [18, 18] },
    ],
    faces: [
      { body: 0, index: 0, indexRange: [0, 6] }, { body: 0, index: 1, indexRange: [6, 12] },
      { body: 1, index: 0, indexRange: [12, 18] },
      { body: 1, index: 1, indexRange: [18, 18], alias: 'B2.F2',
        displayWarning: 'This trimmed curved face is shown by its analytic boundaries' },
      { body: 2, index: 0, indexRange: [18, 18] },
    ],
  };
  const cube = { min: [0, 0, 0], max: [10, 10, 10] };
  const plane = (x, normal = [1, 0, 0]) => ({ origin: [x, 0, 0], normal });
  assert.equal(planesMeetBox([plane(5)], cube), 'cut');
  assert.equal(planesMeetBox([plane(12)], cube), 'whole', 'the kept side holds the whole body');
  assert.equal(planesMeetBox([plane(-2)], cube), 'clipped', 'the body is wholly cut away');
  assert.equal(planesMeetBox([plane(12), plane(-2, [-1, 0, 0])], cube), 'whole');
  assert.equal(planesMeetBox([plane(5), plane(-2)], cube), 'clipped');
  assert.deepEqual(bodyBounds({ center: [1, 1, 1], arrays: {
    positions: new Float32Array([0, 0, 0, 2, -1, 3, 5, 5, 5]) },
  bodies: [{ vertexRange: [0, 2] }, { vertexRange: [2, 2] }] }),
  [{ min: [1, 0, 1], max: [3, 1, 4] }, null]);
  const [solid, open, empty] = capAvailability(model);
  assert.deepEqual([solid.available, solid.reason], [true, null]);
  assert.equal(open.available, false);
  assert.equal(open.reason, 'cap unavailable: 1 boundary-only face (B2.F2)');
  assert.match(open.missing[0].reason, /analytic boundaries/);
  assert.equal(empty.available, false);
  assert.equal(empty.reason, 'cap unavailable: 1 boundary-only face (B3.F1)');
});

// ---- Server: request, sampling, reasons ----

test('section requests are validated; a model without bodies is a capability error', async () => {
  assert.deepEqual(parseSectionRequest({ origin: [18, 0, 0], normal: [1, 0, 0] }),
    { origin: [18, 0, 0], normal: [1, 0, 0] });
  for (const bad of [null, [], { origin: [0, 0], normal: [1, 0, 0] },
    { origin: [0, 0, 0], normal: [0, 0, 0] }, { origin: [0, 0, 'a'], normal: [1, 0, 0] },
    { origin: [0, 0, 0], normal: [1, 0, 0], bodies: 'B1' }]) {
    assert.throws(() => parseSectionRequest(bad), error => error.status === 400);
  }
  // The frozen query-pool test calls every handler with ({ bodies: [] }, {}).
  await assert.rejects(sectionQuery({ bodies: [] }, {}), error => error.status === 501);
  await assert.rejects(sectionQuery(bracket, { origin: [0, 0, 0], normal: [0, 0, 1],
    bodies: ['nope'] }), error => error.status === 400 && /Unknown body nope/.test(error.message));
});

test('contour polylines stay within the display chord tolerance', () => {
  const circle = { type: 'circle', origin: [0, 0, 5], normal: [0, 0, 1], x: [1, 0, 0],
    radius: 5 };
  const points = sampleCurve(circle, [0, 2 * Math.PI]);
  assert.ok(chordBound(circle, [0, 2 * Math.PI], points.length - 1) <= DISPLAY_TOLERANCE_MM);
  points.forEach(point => near(Math.hypot(point[0], point[1]), 5, 1e-12));
  near(points.at(-1)[0], points[0][0], 1e-12);
  const ellipse = { type: 'ellipse', origin: [0, 0, 0], normal: [0, 0, 1], x: [1, 0, 0],
    major: 20, minor: 4 };
  const arc = sampleCurve(ellipse, [0, Math.PI / 2]);
  assert.ok(chordBound(ellipse, [0, Math.PI / 2], arc.length - 1) <= DISPLAY_TOLERANCE_MM);
  const line = { type: 'line', origin: [0, 0, 4], direction: [-1, 0, 0] };
  assert.deepEqual(sampleCurve(line, [-50, 0]), [[50, 0, 4], [0, 0, 4]]);
  assert.throws(() => sampleCurve({ type: 'bspline' }, [0, 1]), error => error.status === 501);
});

test('kernel reasons are rendered as a complete chain', () => {
  const reason = { $: 'FaceContact', face: 0, reason: { $: 'VertexContact', edge: 4,
    location: { $: 'StartVertex', index: 4, point: { $: 'V3', x: { $: 'Real', hi: 18, lo: 0 },
      y: { $: 'Real', hi: 40, lo: 0 }, z: { $: 'Real', hi: 0, lo: 0 } },
    gap: { $: 'Real', hi: 0, lo: 0 } } } };
  assert.equal(reasonChain(reason), 'FaceContact face 0 › VertexContact edge 4 location'
    + ' StartVertex(index 4, point (18, 40, 0), gap 0)');
  assert.equal(reasonChain({ $: 'FaceRejected', face: 2, reason: { $: 'UnsupportedSurface' } }),
    'FaceRejected face 2 › UnsupportedSurface');
});

// ---- Server: real kernel ----

test('the bored spacer sections into two exact circles', async () => {
  const result = await sectionQuery(spacer, { origin: [0, 0, 5], normal: [0, 0, 1] });
  assert.equal(result.schema, 'wonky.viewer-section/1');
  assert.equal(result.status, 'resolved');
  assert.equal(result.reason, undefined);
  assert.deepEqual(result.exactness, { contours: 'kernel-resolved',
    points: 'display-approximation' });
  assert.deepEqual(result.bodies.map(body => [body.alias, body.status, body.relation,
    body.contours]), [['B1', 'resolved', 'Transverse', 2]]);
  const circles = result.contours.map(ring => ring.edges.map(edge => edge.curve));
  assert.deepEqual(circles.flat().map(curve => [curve.type, curve.radius]).sort(),
    [['circle', 2], ['circle', 5]]);
  for (const ring of result.contours) {
    const [edge] = ring.edges;
    assert.match(edge.face, /^B1\.F\d+$/);
    assert.ok(edge.chordBoundMm <= DISPLAY_TOLERANCE_MM);
    edge.points.forEach(point => {
      near(point[2], 5, 1e-12);
      near(Math.hypot(point[0], point[1]), edge.curve.radius, 1e-12);
    });
  }
});

// The viewer contract is the verbatim rendering of the kernel's own verdict;
// which failure kind a contact plane gets is the kernel's decision (it moved
// from FaceContact to FaceUnresolved with in-flight kernel work), so the
// expected kind and face come from sectionSolid itself.
test('bracket x = 18 and a cone fail explicitly; the kernel verdict is shown verbatim',
  async () => {
    const kernelSection = await import('../src/section.mjs');
    const plane = { origin: [18, 0, 0], normal: [1, 0, 0] };
    const verdict = await kernelSection.sectionSolid(bracket.bodies[0], plane, {});
    assert.notEqual(verdict.$, 'Resolved', 'the plane x = 18 lies on a bracket face; the'
      + ' kernel refuses such contact sections (pick another plane if it ever resolves them)');
    const { $: kind, face } = verdict.reason;
    const expected = `Solid/plane section ${kind}${face === undefined ? '' : ` at face ${face}`}`;
    assert.throws(() => kernelSection.requireResolvedSection(verdict),
      error => error.message === expected);
    const contact = await sectionQuery(bracket, plane);
    assert.equal(contact.status, 'failed');
    assert.equal(contact.reason, `B1: ${expected}`);
    assert.deepEqual(contact.contours, []);
    const [body] = contact.bodies;
    assert.equal(body.message, expected);
    assert.equal(body.face, Number.isInteger(face) ? `B1.F${face + 1}` : null);
    assert.deepEqual(body.kernelReason, JSON.parse(JSON.stringify(verdict.reason)));
    assert.ok(body.detail.startsWith(`${kind} face ${face}`), body.detail);
    assert.ok(body.detail.split(' › ').length >= 2, 'the complete chain, not the head only');
    const rejected = await sectionQuery(cone, { origin: [0, 0, 5], normal: [0, 0, 1] });
    assert.equal(rejected.status, 'failed');
    assert.match(rejected.bodies[0].message, /^Solid\/plane section FaceRejected at face \d+$/);
    assert.match(rejected.bodies[0].detail, /FaceRejected face \d+ › UnsupportedSurface/);
    const clear = await sectionQuery(bracket, { origin: [0, 0, 4], normal: [0, 0, 1] });
    assert.equal(clear.status, 'resolved');
    assert.equal(clear.contours.length, 1);
    assert.equal(clear.contours[0].edges.length, 6);
    assert.ok(clear.contours[0].edges.every(edge => edge.curve.type === 'line'));
    const miss = await sectionQuery(bracket, { origin: [0, 0, 20], normal: [0, 0, 1] });
    assert.equal(miss.status, 'resolved');
    assert.deepEqual([miss.bodies[0].relation, miss.contours.length], ['Empty', 0]);
    assert.match(exactSummary(miss, 'z = 20.00 mm · normal +Z'), /misses every sectioned body/);
    assert.equal(exactSummary(contact), 'Kernel section failed for 1 of 1 body.');
  });

// ---- Route ----

async function serve(t, model, handlers) {
  const directory = await mkdtemp(join(tmpdir(), 'wonky-section-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'part.brep.json');
  await writeFile(path, JSON.stringify(model));
  const server = await createReviewServer({
    modelPaths: [path], reviewDirectory: join(directory, 'reviews'), port: 0, log: () => {},
    ...(handlers ? { live: { queryHandlers: { ...QUERY_HANDLERS, ...handlers } } } : {}),
  });
  t.after(() => server.close());
  const base = server.origin;
  const [{ id }] = (await (await fetch(`${base}/api/workspace`)).json()).models;
  const post = (body, options = {}) => fetch(`${base}/api/models/${id}/section`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body), ...options,
  });
  return { base, id, post };
}

test('POST /section: latest wins, a closed request cancels its query, errors map', async t => {
  const calls = [];
  const section = (model, payload, { signal }) => new Promise((resolve, reject) => {
    const call = { payload, signal, resolve: () => resolve({ status: 'resolved', payload }) };
    calls.push(call);
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });
  const { base, id, post } = await serve(t, bracket, { section });
  const first = post({ origin: [0, 0, 1], normal: [0, 0, 1] });
  while (calls.length < 1) await new Promise(resolve => setTimeout(resolve, 5));
  const second = post({ origin: [0, 0, 2], normal: [0, 0, 1] });
  assert.equal((await first).status, 409, 'the older request is superseded');
  assert.equal(calls[0].signal.aborted, true, 'its query is aborted');
  while (calls.length < 2) await new Promise(resolve => setTimeout(resolve, 5));
  calls[1].resolve();
  const answer = await second;
  assert.equal(answer.status, 200);
  assert.deepEqual((await answer.json()).payload.origin, [0, 0, 2]);

  const controller = new AbortController();
  const gone = post({ origin: [0, 0, 3], normal: [0, 0, 1] }, { signal: controller.signal })
    .catch(error => error.name);
  while (calls.length < 3) await new Promise(resolve => setTimeout(resolve, 5));
  controller.abort();
  assert.equal(await gone, 'AbortError');
  for (let wait = 0; wait < 100 && !calls[2].signal.aborted; wait++) {
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.equal(calls[2].signal.aborted, true, 'a closed request cancels its query');

  assert.equal((await post({ origin: [0, 0], normal: [0, 0, 1] })).status, 400);
  const unknown = await fetch(`${base}/api/models/${'0'.repeat(64)}/section`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ origin: [0, 0, 0], normal: [0, 0, 1] }),
  });
  assert.equal(unknown.status, 404);
  const text = await fetch(`${base}/api/models/${id}/section`, { method: 'POST', body: 'x' });
  assert.equal(text.status, 415);
});

test('POST /section runs the real kernel in the query worker', async t => {
  const { post } = await serve(t, spacer);
  const response = await post({ origin: [0, 0, 5], normal: [0, 0, 1] });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.status, 'resolved');
  assert.equal(result.contours.length, 2);
});

// ---- Client feature in the fake environment ----

const { features: legacyFeatures } = await loadFeatures(LEGACY_FEATURES);
const modelId = 'c'.repeat(64);
// A closed 10 mm cube (12 triangles) as a JSON display scene.
function cubeScene(id) {
  const corner = bits => [bits & 1 ? 10 : 0, bits & 2 ? 10 : 0, bits & 4 ? 10 : 0];
  const quads = [[0, 2, 3, 1, [0, 0, -1]], [4, 5, 7, 6, [0, 0, 1]], [0, 1, 5, 4, [0, -1, 0]],
    [2, 6, 7, 3, [0, 1, 0]], [0, 4, 6, 2, [-1, 0, 0]], [1, 3, 7, 5, [1, 0, 0]]];
  return {
    id, bounds: { min: [0, 0, 0], max: [10, 10, 10] }, display: { toleranceMm: 0.02 },
    bodies: [{ id: 'cube', faces: quads.map(([a, b, c, d, normal], index) => ({
      index, surfaceType: 'plane', edgeIndices: [], triangles: [
        { points: [corner(a), corner(b), corner(c)], normal },
        { points: [corner(a), corner(c), corner(d)], normal }],
    })), edges: [], vertices: [] }],
  };
}

function viewer(dispatch) {
  const requests = [];
  const fake = createFakeEnvironment({
    dispatch: (path, options) => {
      requests.push({ path, method: options?.method ?? 'GET',
        body: options?.body ? JSON.parse(options.body) : null });
      return dispatch?.(path, options) ?? {};
    },
  });
  const none = () => {};
  const seams = { scheduleDraw: none, renderAnnotations: none, renderLibrary: none,
    renderSaved: none, panel: none, renderInspector: none };
  const features = [...legacyFeatures, { id: 'section', legacy: false, setup: setupSection }];
  const composed = createViewer(fake.env, { seams, features, log: () => {} });
  const { state } = composed.harness;
  state.workspace.models = [{ id: modelId, label: 'cube', path: '/tmp/cube.brep.json' }];
  state.scenes.set(modelId, cubeScene(modelId));
  Object.assign(state, { before: modelId, after: modelId, compare: false, loading: false });
  return { ...composed, fake, requests, state, app: composed.ctx.app, store: composed.ctx.store };
}

const tick = () => new Promise(resolve => setImmediate(resolve));

test('X toggles one display plane; planes feed display.section and the S setting',
  async () => {
    const ui = viewer();
    await tick();
    assert.equal(ui.store.get().section.on, false, 'section is off by default');
    ui.ctx.commands.run('section.toggle');
    assert.equal(ui.store.get().section.on, true);
    assert.deepEqual(ui.store.get().display.section.planes, [{ origin: [0, 5, 0],
      normal: [0, -1, 0] }], 'one plane through the model center');
    assert.equal(ui.fake.node('#section-panel').hidden, false);
    assert.equal(ui.fake.node('#section-tag').textContent, 'display section ±0.02 mm');
    assert.match(ui.fake.node('#section-caps').innerHTML, /B1.*capped/);
    const planes = ui.app.setSectionPlanes([{ normal: [1, 0, 0], position: 3 },
      { normal: [0, 0, 1], position: 7 }, { normal: [0, 1, 0], position: 2 },
      { normal: [1, 1, 0] }], { active: 1 });
    assert.equal(planes.world.length, 3, 'at most three planes');
    assert.deepEqual(planes.world[1], { origin: [0, 0, 7], normal: [0, 0, 1] });
    assert.equal(ui.store.get().display.section.planes.length, 3);
    ui.ctx.commands.run('section.toggle');
    assert.deepEqual(ui.store.get().display.section.planes, [], 'off clears the clip');
    ui.dispose();
    const saved = ui.requests.filter(request => request.method === 'PUT');
    assert.equal(saved.length, 1, 'edits are saved once (debounced, flushed on dispose)');
    const [source] = Object.keys(saved[0].body.sources);
    assert.deepEqual(saved[0].body.sources[source].section.on, false);
    assert.equal(saved[0].body.sources[source].section.planes.length, 3);
  });

test('Exact contour posts the plane, latest wins, a moved plane makes it stale', async () => {
  const pending = [];
  const ui = viewer((path, options) => {
    if (!path.endsWith('/section')) return {};
    return new Promise((resolve, reject) => {
      pending.push({ resolve, body: JSON.parse(options.body) });
      options.signal?.addEventListener('abort', () => reject(Object.assign(
        new Error('aborted'), { name: 'AbortError' })), { once: true });
    });
  });
  await tick();
  ui.app.setSectionPlanes([{ normal: [1, 0, 0], position: 4 }]);
  const first = ui.app.sectionExact();
  const second = ui.app.sectionExact();
  assert.equal(await first, null, 'the first request is superseded');
  const request = ui.requests.filter(item => item.path.endsWith('/section'));
  assert.equal(request.length, 2);
  assert.deepEqual(request[1].body, { origin: [4, 0, 0], normal: [1, 0, 0], bodies: ['cube'] });
  const result = { status: 'resolved', contours: [{ body: 'B1', edges: [
    { points: [[4, 0, 0], [4, 10, 0], [4, 10, 10], [4, 0, 10], [4, 0, 0]] }] }],
  bodies: [{ alias: 'B1', status: 'resolved', contours: 1 }], displayToleranceMm: 0.02 };
  pending[1].resolve(result);
  assert.deepEqual(await second, result);
  const stats = ui.app.sectionStats();
  assert.deepEqual([stats.requests, stats.completed, stats.superseded], [2, 1, 1]);
  assert.equal(ui.app.sectionState().contour.status, 'resolved');
  assert.match(ui.fake.node('#section-exact-status').innerHTML, /1 closed contour on x = 4\.00/);
  ui.app.setSectionPlanes([{ normal: [1, 0, 0], position: 5 }]);
  assert.equal(ui.app.sectionState().contour.status, 'stale', 'a moved plane drops the contour');
  const third = ui.app.sectionExact();
  ui.app.setSectionPlanes([{ normal: [1, 0, 0], position: 6 }]);
  assert.equal(await third, null);
  assert.equal(ui.app.sectionState().contour.status, 'superseded',
    'moving the plane aborts the running request');
  const failed = ui.app.sectionExact();
  pending.at(-1).resolve({ status: 'failed', reason: 'B1: Solid/plane section FaceContact at'
    + ' face 0', contours: [], bodies: [{ alias: 'B1', status: 'failed', contours: 0,
    message: 'Solid/plane section FaceContact at face 0', face: 'B1.F1',
    detail: 'FaceContact face 0 › VertexContact edge 4' }] });
  await failed;
  const html = ui.fake.node('#section-exact-status').innerHTML;
  assert.match(html, /Solid\/plane section FaceContact at face 0/);
  assert.match(html, /FaceContact face 0 › VertexContact edge 4/);
  ui.dispose();
});

}
