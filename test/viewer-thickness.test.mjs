import test from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missingBend();
if (publicTreeSkip) {
  test("viewer-thickness.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { mkdtemp, readFile, rm, writeFile } = await import("node:fs/promises");
const { tmpdir } = await import("node:os");
const { join } = await import("node:path");
const { build } = await import("../src/index.mjs");
const { createReviewServer } = await import("../src/review-server.mjs");
const { QUERY_HANDLERS } = await import("../src/viewer/query-worker.mjs");
const { supersedeKey } = await import("../src/viewer/routes/thickness.mjs");
const { exactMath } = await import("../src/viewer/geometry.mjs");
const { EXACTNESS, RAY_RANGE_MM, THICKNESS_SCHEMA, coincidenceSamples, groupRoots, loadThicknessKernels, parseThicknessRequest, probeThickness, refusedRootPlan, thicknessQuery } = await import("../src/viewer/thickness.mjs");
// thickness-probe package, server side: request parsing, the kernel probe
// (src/viewer/thickness.mjs) on models built from the example sources, and
// POST /api/models/:id/thickness through the query pool (injected handlers
// for latest-wins and cancellation, the real query worker for the kernel).












const source = name => readFile(new URL(`../examples/${name}.fs`, import.meta.url), 'utf8');
const serialize = model => JSON.parse(JSON.stringify(model));
const [bracket, spacer, cone] = await Promise.all(['bracket', 'bored-spacer', 'conical-spacer']
  .map(name => source(name).then(text => build(text)).then(serialize)));
const kernels = await loadThicknessKernels();
const probe = (model, payload, options = {}) => probeThickness(model,
  parseThicknessRequest(payload), { kernels, ...options });
const near = (actual, expected, tolerance = 1e-9) => assert.ok(
  Math.abs(actual - expected) <= tolerance, `${actual} is not ${expected} ±${tolerance}`);
const faceIndex = (model, predicate) => model.bodies[0].faces.findIndex(predicate);
const planeAt = (axis, value) => face => face.surface.type === 'plane'
  && Math.abs(Math.abs(face.surface.normal[axis]) - 1) < 1e-12
  && Math.abs(face.surface.origin[axis] - value) < 1e-9;
const alias = index => `B1.F${index + 1}`;

const bracketTop = faceIndex(bracket, planeAt(2, 8));
const bracketBottom = faceIndex(bracket, planeAt(2, 0));
const spacerOuter = faceIndex(spacer, face => face.surface.radius === 5);
const spacerBore = faceIndex(spacer, face => face.surface.radius === 2);

test('thickness requests are validated; a model without bodies is a capability error',
  async () => {
    assert.deepEqual(parseThicknessRequest({ face: 'B1.F2', point: [1, 2, 3] }),
      { mode: 'face', face: 'B1.F2', point: [1, 2, 3] });
    assert.deepEqual(parseThicknessRequest({ origin: [0, 0, 0], direction: [0, 0, 2],
      body: 'B1' }), { mode: 'ray', origin: [0, 0, 0], direction: [0, 0, 2], body: 'B1' });
    assert.deepEqual(parseThicknessRequest({ face: { bodyId: 'b', entityIndex: 3 },
      point: [0, 0, 0] }).face, { bodyId: 'b', entityType: 'face', entityIndex: 3 });
    for (const bad of [null, [], {}, { face: 'B1.F2' }, { face: 'B1.E2', point: [0, 0, 0] },
      { face: 'B1.F2', point: [0, 0] }, { origin: [0, 0, 0] },
      { origin: [0, 0, 0], direction: [0, 0, 0] }, { origin: [0, 0, 1e7], direction: [1, 0, 0] },
      { face: 'B1.F2', point: [0, 0, 0], origin: [0, 0, 0], direction: [1, 0, 0] },
      { origin: [0, 0, 0], direction: [1, 0, 0], body: 7 },
      { face: { bodyId: 'b', entityType: 'edge', entityIndex: 0 }, point: [0, 0, 0] }]) {
      assert.throws(() => parseThicknessRequest(bad), error => error.status === 400,
        JSON.stringify(bad));
    }
    await assert.rejects(thicknessQuery({ bodies: [] }, {}), error => error.status === 501);
    await assert.rejects(thicknessQuery(bracket, { face: 'B1.F2' }),
      error => error.status === 400);
  });

test('roots within the body tolerance form one event; coincidence samples cover every gap',
  () => {
    const events = groupRoots([{ t: 12 }, { t: 0 }, { t: 12.00001 }, { t: 40 }], 1e-4);
    assert.deepEqual(events.map(event => event.roots.length), [1, 2, 1]);
    assert.deepEqual(events.map(event => event.t), [0, 12, 40]);
    assert.deepEqual(coincidenceSamples([-3, 12, 40, 55], 40), [0, 6, 12, 26, 40]);
    assert.deepEqual(coincidenceSamples([], 0), [0]);
  });

test('a click on the bracket wall measures 8 mm along the exact inward normal', async () => {
  const top = await probe(bracket, { face: alias(bracketTop), point: [30.013, 6.004, 8.0007] });
  assert.equal(top.schema, THICKNESS_SCHEMA);
  assert.equal(top.status, 'measured');
  assert.equal(top.exactness, EXACTNESS);
  assert.equal(top.mm, 8);
  assert.equal(top.entry.alias, alias(bracketTop));
  assert.equal(top.hit.alias, alias(bracketBottom));
  [30.013, 6.004, 8].forEach((value, axis) => near(top.ray.origin[axis], value, 1e-12));
  assert.equal(top.ray.origin[2], 8, 'the pick is projected onto the plane');
  assert.deepEqual(top.ray.direction, [0, 0, -1]);
  near(top.ray.pickOffsetMm, 0.0007, 1e-12);
  assert.equal(top.ray.anchor, 'display-pick');
  [30.013, 6.004, 0].forEach((value, axis) => near(top.hit.point[axis], value, 1e-12));
  assert.equal(top.toleranceMm, bracket.bodies[0].validation.toleranceMm,
    'max of the two face tolerances, as exact-measure');
  assert.deepEqual(top.blocking, []);
  const bottom = await probe(bracket, { face: alias(bracketBottom), point: [10, 30, 0] });
  assert.deepEqual([bottom.status, bottom.mm, bottom.hit.alias],
    ['measured', 8, alias(bracketTop)]);
  const byReference = await probe(bracket, {
    face: { bodyId: bracket.bodies[0].id, entityIndex: bracketTop }, point: [40, 3, 8],
  });
  assert.equal(byReference.mm, 8);
});

test('the bored spacer wall measures 3 mm from either cylinder', async () => {
  const outer = await probe(spacer, { face: alias(spacerOuter), point: [3.5355, 3.5355, 4] });
  assert.equal(outer.status, 'measured');
  near(outer.mm, 3, 1e-12);
  assert.equal(outer.hit.alias, alias(spacerBore));
  near(Math.hypot(outer.hit.point[0], outer.hit.point[1]), 2, 1e-12);
  assert.equal(outer.toleranceMm, 0.0003);
  const bore = await probe(spacer, { face: alias(spacerBore), point: [0, -2.01, 7] });
  assert.equal(bore.status, 'measured');
  near(bore.mm, 3, 1e-12);
  assert.deepEqual(bore.ray.direction.map(value => Math.round(value * 1e12) / 1e12),
    [0, -1, 0], 'a hole wall is probed away from its axis');
  assert.equal(bore.hit.alias, alias(spacerOuter));
});

test('given rays reproduce the audit table, including the in-plane refusal', async () => {
  const foot = await probe(bracket, { origin: [30, 0, 4], direction: [0, 1, 0] });
  assert.deepEqual([foot.status, foot.mm], ['measured', 12]);
  const through = await probe(bracket, { origin: [-10, 6, 4], direction: [2, 0, 0] });
  assert.deepEqual([through.status, through.mm, through.entry.t], ['measured', 50, 10],
    'from outside: the span starts at the entry');
  const planar = await probe(bracket, { origin: [18, 0, 4], direction: [0, 1, 0] });
  assert.equal(planar.status, 'unresolved');
  assert.equal(planar.mm, null);
  const reasons = planar.blocking.map(item => [item.reason, item.t]);
  assert.deepEqual(reasons, [['boundary', 12], ['boundary', 40], ['coincident', 12]],
    'two boundary hits and the face whose plane contains the ray');
  const inner = faceIndex(bracket, planeAt(0, 18));
  assert.equal(planar.blocking[2].alias, alias(inner));
  assert.deepEqual(planar.coincident, [alias(inner)]);
  assert.ok(planar.blocking.every(item => item.edges?.length === 1 && /^B1\.E\d+$/
    .test(item.edges[0])), 'boundary contacts name their edge');
  assert.match(planar.reason, /3 blocking entities; the ray is not nudged/);
  const miss = await probe(bracket, { origin: [-10, 60, 4], direction: [1, 0, 0] });
  assert.equal(miss.status, 'no-hit');
  const inside = await probe(bracket, { origin: [10, 20, 4], direction: [1, 0, 0] });
  assert.equal(inside.status, 'unresolved');
  assert.match(inside.reason, /starts inside the material/);
});

test('a pick on an edge and cone apex roots are refused with their entities', async () => {
  const edge = await probe(bracket, { face: alias(bracketTop), point: [18, 20, 8] });
  assert.equal(edge.status, 'unresolved');
  assert.equal(edge.blocking[0].reason, 'start-boundary');
  assert.equal(edge.blocking[0].alias, alias(bracketTop));
  assert.ok(edge.blocking.some(item => item.reason === 'coincident'));
  const axial = await probe(cone, { origin: [0, 0, -5], direction: [0, 0, 1] });
  assert.equal(axial.status, 'unresolved');
  assert.ok(axial.blocking.some(item => item.reason === 'root-unresolved'
    && item.t === undefined), 'a root the kernel cannot decide always blocks');
  const coneFace = faceIndex(cone, face => face.surface.type === 'cone');
  await assert.rejects(probe(cone, { face: alias(coneFace), point: [4, 0, 5] }),
    error => error.status === 501 && /cone face is not supported/.test(error.message));
});

test('multi-body rays name their body; an aborted signal stops the probe', async () => {
  const twoBodies = { ...bracket, bodies: [bracket.bodies[0], spacer.bodies[0]] };
  await assert.rejects(probe(twoBodies, { origin: [0, 0, 5], direction: [1, 0, 0] }),
    error => error.status === 400 && /body is required/.test(error.message));
  const second = await probe(twoBodies, { origin: [-9, 0, 5], direction: [1, 0, 0],
    body: 'B2' });
  assert.deepEqual([second.status, second.mm, second.body], ['measured', 3, 'B2']);
  const byId = await probe(twoBodies, { origin: [-9, 0, 5], direction: [1, 0, 0],
    body: spacer.bodies[0].id });
  assert.equal(byId.body, 'B2');
  const controller = new AbortController();
  controller.abort(Object.assign(new Error('superseded'), { status: 409 }));
  await assert.rejects(probe(bracket, { face: alias(bracketTop), point: [30, 6, 8] },
    { signal: controller.signal }), error => error.status === 409);
});

// The bracket turned 30° about Z and 20° about X and moved: every probe ray
// is then only numerically parallel to the side walls, which the kernel
// answers `unresolved` (|cos| below its 1e-12 guard, or a start offset that
// rounds to zero without a certificate).
function tilted(model) {
  const [a, b] = [30, 20].map(degrees => degrees * Math.PI / 180);
  const rotate = ([x, y, z]) => {
    const [u, v] = [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)];
    return [u, v * Math.cos(b) - z * Math.sin(b), v * Math.sin(b) + z * Math.cos(b)];
  };
  const place = point => rotate(point).map((value, axis) => value + [3, -7, 11][axis]);
  const copy = structuredClone(model);
  const body = copy.bodies[0];
  body.vertices = body.vertices.map(place);
  for (const face of body.faces) {
    face.surface.origin = place(face.surface.origin);
    face.surface.normal = rotate(face.surface.normal);
    if (face.surface.x) face.surface.x = rotate(face.surface.x);
  }
  return { model: copy, place, rotate };
}

test('refused roots are settled only by exact closed forms, never by moving the ray', () => {
  const math = exactMath(kernels.kernel);
  const plane = { surface: { type: 'plane', origin: [0, 0, 0], normal: [0, 0, 1] } };
  const far = refusedRootPlan(math, plane, [0, 0, 5], [1, 0, 1e-14], 1e-4, 'unresolved');
  assert.deepEqual([far.excluded, far.how, far.offsetMm], [true, 'near-parallel', 5]);
  assert.ok(far.beyondMm > RAY_RANGE_MM, 'any crossing lies beyond the kernel range');
  const onPlane = refusedRootPlan(math, plane, [0, 0, 1e-6], [1, 0, 1e-14], 1e-4, 'unresolved');
  assert.deepEqual([onPlane.coincident, onPlane.how], [true, 'near-coincident']);
  const start = refusedRootPlan(math, plane, [3, 4, 0], [0, 0, -1], 1e-4, 'unresolved');
  assert.deepEqual([start.how, start.roots], ['origin-on-surface', [0]]);
  assert.equal(refusedRootPlan(math, plane, [0, 0, 5], [0, 0, 1], 1e-4, 'unresolved'), null,
    'a transverse plane the kernel refused stays blocking');
  const hole = { surface: { type: 'cylinder', origin: [0, 0, 0], axis: [0, 0, 1], radius: 2 } };
  const parallel = refusedRootPlan(math, hole, [5, 0, 0], [1e-9, 0, 1], 1e-4, 'unresolved');
  assert.deepEqual([parallel.excluded, parallel.how, parallel.offsetMm],
    [true, 'near-parallel', 3]);
  const wall = refusedRootPlan(math, hole, [2, 0, 0], [-1, 0, 0], 1e-4, 'unresolved');
  assert.deepEqual([wall.how, wall.roots.map(t => Math.round(t * 1e9) / 1e9)],
    ['origin-on-surface', [0, 4]], 'the far wall of a radial ray through the axis');
  const tangent = refusedRootPlan(math, hole, [2, 0, 0], [0, 1, 0], 1e-4, 'unresolved');
  assert.equal(tangent.tangent, true);
  assert.equal(refusedRootPlan(math, { surface: { type: 'cone' } }, [0, 0, 0], [0, 0, 1], 1e-4,
    'unresolved'), null);
});

test('a tilted bracket still measures 8 mm and still refuses the in-plane ray', async () => {
  const { model, place, rotate } = tilted(bracket);
  const top = await probe(model, { face: alias(bracketTop), point: place([30, 6, 8]) });
  assert.equal(top.status, 'measured');
  near(top.mm, 8, 1e-9);
  assert.ok(top.refusedRoots.length >= 3, 'side walls: kernel unresolved, reported');
  assert.ok(top.refusedRoots.every(item => item.how === 'near-parallel' && item.offsetMm > 1));
  const planar = await probe(model, { origin: place([18, 0, 4]), direction: rotate([0, 1, 0]) });
  assert.equal(planar.status, 'unresolved');
  const inner = alias(faceIndex(bracket, planeAt(0, 18)));
  assert.deepEqual(planar.blocking.map(item => item.reason),
    ['boundary', 'boundary', 'coincident']);
  assert.equal(planar.blocking[2].alias, inner);
  assert.ok(planar.refusedRoots.some(item => item.alias === inner
    && item.how === 'near-coincident'), 'the in-plane face is near-coincident, not excluded');
});

// ---- Route ----

async function serve(t, model, handlers) {
  const directory = await mkdtemp(join(tmpdir(), 'wonky-thickness-'));
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
  const post = (body, options = {}) => fetch(`${base}/api/models/${id}/thickness`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body), ...options,
  });
  return { base, id, post };
}

const wait = () => new Promise(resolve => setTimeout(resolve, 5));

test('POST /thickness: latest wins, a closed request cancels its query, errors map', async t => {
  const calls = [];
  const thickness = (_model, payload, { signal }) => new Promise((resolve, reject) => {
    calls.push({ payload, signal, resolve: () => resolve({ status: 'measured', payload }) });
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });
  const { base, id, post } = await serve(t, bracket, { thickness });
  assert.equal(supersedeKey(id), `thickness:${id}`);
  const first = post({ face: 'B1.F2', point: [30, 6, 8] });
  while (calls.length < 1) await wait();
  const second = post({ face: 'B1.F2', point: [31, 6, 8] });
  assert.equal((await first).status, 409, 'the older probe is superseded');
  assert.equal(calls[0].signal.aborted, true, 'its query is aborted');
  while (calls.length < 2) await wait();
  calls[1].resolve();
  const answer = await second;
  assert.equal(answer.status, 200);
  const body = await answer.json();
  assert.equal(body.modelId, id);
  assert.deepEqual(body.payload.point, [31, 6, 8]);

  const controller = new AbortController();
  const gone = post({ face: 'B1.F2', point: [32, 6, 8] }, { signal: controller.signal })
    .catch(error => error.name);
  while (calls.length < 3) await wait();
  controller.abort();
  assert.equal(await gone, 'AbortError');
  for (let tries = 0; tries < 100 && !calls[2].signal.aborted; tries++) await wait();
  assert.equal(calls[2].signal.aborted, true, 'a closed request cancels its query');

  assert.equal((await post({ face: 'B1.F2' })).status, 400);
  const unknown = await fetch(`${base}/api/models/${'0'.repeat(64)}/thickness`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ face: 'B1.F2', point: [0, 0, 0] }),
  });
  assert.equal(unknown.status, 404);
});

test('POST /thickness runs the real kernel in the query worker', async t => {
  const { post } = await serve(t, spacer);
  const response = await post({ face: alias(spacerOuter), point: [0, 5.01, 5] });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.status, 'measured');
  near(result.mm, 3, 1e-12);
  const refused = await post({ origin: [0, 0, 5], direction: [0, 0, 1] });
  assert.equal(refused.status, 200);
  assert.equal((await refused.json()).status, 'no-hit', 'a ray along the axis stays in the bore');
  const unsupported = await post({ face: 'B1.F9', point: [0, 0, 0] });
  assert.equal(unsupported.status, 404);
});

}
