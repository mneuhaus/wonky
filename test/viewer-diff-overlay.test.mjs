import test from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missingBend();
if (publicTreeSkip) {
  test("viewer-diff-overlay.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { mkdir, mkdtemp, readFile, rm, writeFile } = await import("node:fs/promises");
const { tmpdir } = await import("node:os");
const { join } = await import("node:path");
const { build } = await import("../src/index.mjs");
const { createReviewServer } = await import("../src/review-server.mjs");
const { HttpError } = await import("../src/viewer/http.mjs");
const { boundsDelta, compareModels } = await import("../src/viewer/compare.mjs");
const { bandExtrema, coneApex, diffBoundsQuery, ghostPairing, kernelBodyBounds, kernelBounds, realValue, unsupportedFaces } = await import("../src/viewer/diff.mjs");
const { QUERY_HANDLERS } = await import("../src/viewer/query-worker.mjs");
const { emptySettings, mergeSettings } = await import("../src/viewer/settings.mjs");
const { createViewer } = await import("../viewer/app.js");
const { loadFeatures } = await import("../viewer/core/feature-loader.js");
const { createRequests } = await import("../viewer/core/requests.js");
const { FEATURES } = await import("../viewer/features/index.js");
const { boundsDeltaText, clampBlend, createGhostController, deltaItems, ghostLabel, ghostTarget, panelModel } = await import("../viewer/features/diff/diff.js");
const { ghostEdgePositions } = await import("../viewer/features/diff/ghost-layer.js");
const { createFakeEnvironment } = await import("../scripts/viewer/test-support/fake-env.mjs");
// diff-overlay: exact edge-band bounds (kernelBodyBounds, kernelBounds, the
// diffBounds query), their use in compareModels, ghost pairing, GET /api/diff,
// the ghost layer's edge selection, the ghost controller (keyed by model id,
// pending on a swap) and the diff feature in the fake browser environment.




















const round = value => Math.round(value * 1e6) / 1e6;
const roundBox = box => ({ min: box.min.map(round), max: box.max.map(round) });

// ---------------------------------------------------------------------------
// Edge-band bounds with an injected band (no kernel).

// Resolved band evidence of a line (vertex pair) or a circle with normal ±Z.
const bandOf = extrema => ({
  $: 'Resolved', relation: { $: 'ExceedsBand' },
  evidence: {
    minimum: { signed_distance: { $: 'Real', hi: extrema[0], lo: 0 } },
    maximum: { signed_distance: { $: 'Real', hi: extrema[1], lo: 0 } },
    arithmetic_guard: { $: 'Real', hi: 1e-10, lo: 0 },
  },
});
function fakeBand(calls = []) {
  return async (body, edgeIndex, plane) => {
    calls.push([edgeIndex, plane.normal.indexOf(1)]);
    const edge = body.edges[edgeIndex];
    const axis = plane.normal.indexOf(1);
    if (edge.curve?.type === 'circle') {
      const { origin, radius } = edge.curve;
      return bandOf(axis === 2 ? [origin[2], origin[2]]
        : [origin[axis] - radius, origin[axis] + radius]);
    }
    const [a, b] = [body.vertices[edge.start][axis], body.vertices[edge.end][axis]];
    return bandOf([Math.min(a, b), Math.max(a, b)]);
  };
}

const plane = (origin, normal) => ({ surface: { type: 'plane', origin, normal, x: [1, 0, 0] } });
const circle = (origin, radius) => ({
  start: 0, end: 0, curve: { type: 'circle', origin, normal: [0, 0, 1], x: [1, 0, 0], radius },
});
// A pointed cone: base circle r = 8 at z = 0, apex at z = 24 (no apex edge).
const pointedCone = {
  id: 'cone', faces: [plane([0, 0, 0], [0, 0, 1]), {
    surface: { type: 'cone', origin: [0, 0, 12], axis: [0, 0, -1], x: [1, 0, 0], radius: 4,
      angle: Math.atan(1 / 3) },
    loops: [[{ edge: 0, forward: true }]],
  }],
  edges: [circle([0, 0, 0], 8)], vertices: [[8, 0, 0]],
  validation: { toleranceMm: 0.0003, boundsMm: null, volumeMm3: null },
};
// The conical spacer's lateral face: two full coaxial circles, apex excluded.
const frustum = {
  ...pointedCone, id: 'frustum',
  faces: [pointedCone.faces[0], plane([0, 0, 12], [0, 0, 1]), {
    ...pointedCone.faces[1], loops: [[{ edge: 0, forward: true }, { edge: 1, forward: false }]],
  }],
  edges: [circle([0, 0, 0], 8), circle([0, 0, 12], 4)], vertices: [[8, 0, 0], [4, 0, 12]],
};

test('edge-band bounds: union of the extrema of every edge along X, Y and Z', async () => {
  const calls = [];
  const result = await kernelBodyBounds(frustum, { band: fakeBand(calls) });
  assert.equal(result.status, 'resolved');
  assert.deepEqual(roundBox(result.bounds), { min: [-8, -8, 0], max: [8, 8, 12] });
  assert.deepEqual(result.bounds.size.map(round), [16, 16, 12]);
  assert.equal(calls.length, 2 * 3, 'every edge against every axis plane');
  assert.equal(result.guardMm, 1e-10);
  assert.equal(result.toleranceMm, 0.0003, 'the model tolerance dominates the guard');
  assert.match(result.method, /boundEdgePlaneBand/);
  assert.equal(coneApex(frustum, 2).excluded, true, 'two coaxial circles bound the face');
});

test('a cone face that may reach its apex outside the edge-band box is unresolved', async () => {
  const apex = coneApex(pointedCone, 1);
  assert.equal(apex.excluded, false);
  assert.deepEqual(apex.apex.map(round), [0, 0, 24]);
  const result = await kernelBodyBounds(pointedCone, { band: fakeBand() });
  assert.equal(result.status, 'unresolved');
  assert.equal(result.bounds, null);
  assert.match(result.reason, /Cone face B1\.F2 may reach its apex at \(0, 0, 24\)/);
});

test('unsupported surfaces and unresolved bands are reported, never guessed', async () => {
  const sphere = { ...frustum, faces: [...frustum.faces, { surface: { type: 'sphere' } }] };
  assert.deepEqual(unsupportedFaces(sphere, 'B2'), ['B2.F4 (sphere)']);
  const calls = [];
  const unsupported = await kernelBodyBounds(sphere, { alias: 'B2', band: fakeBand(calls) });
  assert.equal(unsupported.status, 'unsupported');
  assert.match(unsupported.reason, /plane, cylinder and cone faces; B2\.F4 \(sphere\) is not/);
  assert.equal(calls.length, 0, 'no kernel call for an unsupported body');
  const rejecting = async (body, edge, target) => (edge === 1 && target.normal[2] === 1
    ? { $: 'Rejected', reason: { $: 'EdgeRejected', reason: { $: 'InvalidDomain' } } }
    : fakeBand()(body, edge, target));
  const unresolved = await kernelBodyBounds(frustum, { band: rejecting });
  assert.equal(unresolved.status, 'unresolved');
  assert.match(unresolved.reason,
    /1 of 6 edge bands did not resolve \(first: B1\.E2 along Z: Rejected\/EdgeRejected\/Invalid/);
  const throwing = async () => {
    throw new TypeError('bad edge');
  };
  const failed = await kernelBodyBounds(frustum, { band: throwing });
  assert.equal(failed.status, 'unresolved');
  assert.equal(failed.issues[0].message, 'bad edge');
  const empty = await kernelBodyBounds({ ...frustum, edges: [] }, { band: fakeBand() });
  assert.deepEqual([empty.status, empty.reason], ['unresolved', 'The body has no edges']);
});

test('band extrema: resolved relations and threshold evidence count, rejections do not', () => {
  assert.equal(realValue({ $: 'Real', hi: 1, lo: 1e-17 }), 1 + 1e-17);
  assert.equal(realValue(2.5), 2.5);
  assert.ok(Number.isNaN(realValue({})));
  assert.deepEqual(bandExtrema(bandOf([1, 3])), { minimum: 1, maximum: 3, guard: 1e-10 });
  const threshold = { $: 'Unresolved', reason: { $: 'Threshold', evidence: bandOf([0, 1e-7])
    .evidence } };
  assert.deepEqual(bandExtrema(threshold), { minimum: 0, maximum: 1e-7, guard: 1e-10 });
  assert.equal(bandExtrema({ $: 'Unresolved', reason: { $: 'CoefficientConditioning' } }), null);
  assert.equal(bandExtrema({ $: 'Rejected', reason: { $: 'InvalidGeometry' } }), null);
  assert.equal(bandExtrema(bandOf([3, 1])), null, 'inverted extrema are rejected');
});

test('kernelBounds keeps recorded bodies and aborts with the signal', async () => {
  const recorded = { ...frustum, id: 'rec', validation: { toleranceMm: 0.0003, boundsMm: {
    min: [0, 0, 0], max: [1, 2, 3] } } };
  const model = { schema: 'wonky-brep/1', bodies: [recorded, frustum] };
  const calls = [];
  const result = await kernelBounds(model, { band: fakeBand(calls) });
  assert.equal(result.status, 'resolved');
  assert.equal(result.exactness, 'kernel-resolved');
  assert.deepEqual(result.bodies.map(row => [row.alias, row.source, row.status]),
    [['B1', 'recorded', 'resolved'], ['B2', 'kernel', 'resolved']]);
  assert.deepEqual(roundBox(result.bounds), { min: [-8, -8, 0], max: [8, 8, 12] });
  assert.equal(calls.length, 6, 'only the body without recorded bounds is computed');
  const onlyRecorded = await kernelBounds({ schema: 'wonky-brep/1', bodies: [recorded] },
    { band: fakeBand() });
  assert.deepEqual([onlyRecorded.status, onlyRecorded.exactness], ['not-needed', 'recorded']);
  const controller = new AbortController();
  controller.abort(new Error('superseded'));
  await assert.rejects(kernelBounds(model, { band: fakeBand(), signal: controller.signal }),
    /superseded/);
  await assert.rejects(kernelBounds({ bodies: [] }), /wonky-brep\/1/);
});

// ---------------------------------------------------------------------------
// The real kernel.

const crossBoreSource = readFile(new URL('../scripts/viewer/audit-data/cross-bore.fs',
  import.meta.url), 'utf8');
const crossBore = async (radius = 4) => build((await crossBoreSource)
  .replace('"radius" : 4 * millimeter', `"radius" : ${radius} * millimeter`));

test('Bend edge bands give the cross bore its exact box although recorded bounds are null',
  async () => {
    const model = await crossBore();
    assert.equal(model.bodies[0].validation.boundsMm, null);
    const result = await diffBoundsQuery(model, { other: 'x'.repeat(64) });
    assert.equal(result.other, 'x'.repeat(64));
    assert.equal(result.status, 'resolved');
    assert.equal(result.exactness, 'kernel-resolved');
    assert.deepEqual(roundBox(result.bounds), { min: [0, -10, 0], max: [30, 10, 20] });
    assert.ok(result.toleranceMm >= 0.0003 && result.toleranceMm < 0.001);
    // A body with recorded bounds reproduces them exactly (bored spacer).
    const spacer = await build(await readFile(new URL('../examples/bored-spacer.fs',
      import.meta.url), 'utf8'));
    const recorded = spacer.bodies[0].validation.boundsMm;
    const computed = await kernelBounds(spacer, { onlyMissing: false });
    assert.deepEqual(roundBox(computed.bounds), roundBox(recorded));
    // And the conical spacer's frustum face provably excludes its apex.
    const conical = await build(await readFile(new URL('../examples/conical-spacer.fs',
      import.meta.url), 'utf8'));
    const cone = await kernelBounds(conical, { onlyMissing: false });
    assert.equal(cone.status, 'resolved');
    assert.deepEqual(roundBox(cone.bounds), roundBox(conical.bodies[0].validation.boundsMm));
  });

// ---------------------------------------------------------------------------
// compareModels with kernel bounds (signature unchanged).

const box = (min, max) => ({ min, max });
const body = (id, bounds, extra = {}) => ({
  id, faces: [{}], edges: [{}], vertices: [[0, 0, 0]],
  validation: { volumeMm3: 100, boundsMm: bounds, toleranceMm: 0.0003 }, ...extra,
});
const brep = bodies => ({ schema: 'wonky-brep/1', bodies });
const oneGroup = value => ({ bodies: value.bodies.map(() => ({ groups: [{}] })) });
const kernelFor = (model, boxes) => ({
  method: 'edge bands', status: 'resolved',
  bodies: model.bodies.map((entry, index) => (boxes[index] ? {
    bodyId: entry.id, status: 'resolved', toleranceMm: 0.0003,
    bounds: { ...boxes[index], size: boxes[index].max.map((v, i) => v - boxes[index].min[i]) },
  } : { bodyId: entry.id, status: 'recorded' })),
});

test('compareModels labels kernel bounds and keeps the old output without them', () => {
  const before = brep([body('a', null)]);
  const after = brep([body('a', null)]);
  const display = { min: [0, 0, 0], max: [30, 20, 20], toleranceMm: 0.02 };
  const plain = compareModels({ model: before, displayBounds: display },
    { model: after, displayBounds: display }, { logical: oneGroup });
  assert.equal(plain.deltas.bounds.exactness, 'display-approximation');
  assert.equal(plain.deltas.bounds.toleranceMm, 0.04);
  assert.equal(plain.deltas.bodyMatches[0].bounds.status, 'not evaluated');
  const kernelBefore = kernelFor(before, [box([0, -10, 0], [30, 10, 20])]);
  const kernelAfter = kernelFor(after, [box([0, -10, 0], [32, 10, 20])]);
  const { deltas } = compareModels(
    { model: before, displayBounds: display, kernelBounds: kernelBefore },
    { model: after, displayBounds: display, kernelBounds: kernelAfter }, { logical: oneGroup });
  assert.equal(deltas.bounds.exactness, 'kernel-resolved');
  assert.equal(deltas.bounds.toleranceMm, 0.0006);
  assert.deepEqual(deltas.bounds.delta.size, [2, 0, 0]);
  assert.equal(deltas.bounds.after.method, 'edge bands');
  assert.equal(deltas.bodyMatches[0].bounds.exactness, 'kernel-resolved');
  assert.deepEqual(deltas.bodyMatches[0].bounds.delta.size, [2, 0, 0]);
  // Recorded bodies keep their label; one kernel body makes the model kernel.
  const mixed = brep([body('r', box([0, 0, 0], [1, 1, 1])), body('k', null)]);
  const result = compareModels({ model: mixed, kernelBounds: kernelFor(mixed,
    [null, box([0, 0, 0], [2, 2, 2])]) }, { model: mixed, kernelBounds: kernelFor(mixed,
    [null, box([0, 0, 0], [2, 2, 3])]) }, { logical: oneGroup });
  assert.equal(result.deltas.bounds.exactness, 'kernel-resolved');
  assert.deepEqual(result.deltas.bodyMatches.map(row => row.bounds.exactness),
    ['recorded', 'kernel-resolved']);
  assert.deepEqual(result.deltas.bodyMatches[0].bounds.before, {
    min: [0, 0, 0], max: [1, 1, 1], size: [1, 1, 1], exactness: 'recorded' });
  // A kernel failure falls back to the display envelope and carries the reason.
  const failed = compareModels(
    { model: before, displayBounds: display, kernelBounds: { status: 'unresolved',
      reason: 'B1: cone apex', bodies: [{ bodyId: 'a', status: 'unresolved' }] } },
    { model: after, displayBounds: display, kernelBounds: kernelAfter }, { logical: oneGroup });
  assert.equal(failed.deltas.bounds.exactness, 'display-approximation');
  assert.equal(failed.deltas.bounds.before.kernelReason, 'B1: cone apex');
  // A kernel row of another body id is never used.
  const other = compareModels({ model: before, kernelBounds: kernelFor(brep([body('z', null)]),
    [box([0, 0, 0], [1, 1, 1])]) }, { model: after }, { logical: oneGroup });
  assert.equal(other.deltas.bounds.status, 'not evaluated');
});

test('bounds delta exactness is the weakest side', () => {
  const side = (exactness, toleranceMm) => ({
    min: [0, 0, 0], max: [1, 1, 1], size: [1, 1, 1], exactness,
    ...(toleranceMm === undefined ? {} : { toleranceMm }),
  });
  const cases = [
    [['recorded'], ['recorded'], 'recorded', 0],
    [['recorded'], ['kernel-resolved', 0.0003], 'kernel-resolved', 0.0003],
    [['kernel-resolved', 0.0003], ['display-approximation', 0.02], 'display-approximation',
      0.0203],
    [['display-approximation', 0.02], ['recorded'], 'display-approximation', 0.02],
  ];
  for (const [before, after, exactness, tolerance] of cases) {
    const delta = boundsDelta(side(...before), side(...after));
    assert.equal(delta.exactness, exactness);
    assert.equal(round(delta.toleranceMm), tolerance);
  }
});

// ---------------------------------------------------------------------------
// Ghost pairing.

test('ghost pairing: previous revision of the same source, explicit, or none', () => {
  const live = (id, revision, path = '/w/part.fs') => ({ id, sourcePath: path,
    live: { path, revision } });
  const list = [live('a', 1), live('b', 2), live('x', 1, '/w/other.fs'), live('c', 4),
    { id: 'i1', sourcePath: '/w/in.brep.json' }, { id: 'i2', sourcePath: '/w/in.brep.json' },
    { id: 's', sourcePath: '/r/models/s.brep.json' }];
  const pair = (after, before) => ghostPairing(list, { after, before,
    snapshotDirectory: '/r/models' });
  assert.deepEqual([pair('c').pairing, pair('c').before.modelId, pair('c').before.revision],
    ['previous-revision', 'b', 2]);
  assert.equal(pair('b').before.modelId, 'a');
  assert.equal(pair('a').pairing, 'none');
  assert.equal(pair('a').reason, 'No earlier revision of this source');
  assert.equal(pair('x').pairing, 'none', 'another source is never a ghost');
  assert.equal(pair('i2').before.modelId, 'i1', 'input revisions by registration order');
  assert.equal(pair('s').pairing, 'none', 'archived snapshots have no previous');
  assert.deepEqual([pair('c', 'x').pairing, pair('c', 'x').before.modelId], ['explicit', 'x']);
});

// ---------------------------------------------------------------------------
// GET /api/diff against real revisions.

test('GET /api/diff: pairing, kernel-labelled bounds for null recorded bounds, caching',
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'wonky-diff-'));
    const reviews = join(directory, 'reviews');
    await mkdir(reviews);
    const output = join(directory, 'cross-bore.brep.json');
    const write = async radius => writeFile(output,
      JSON.stringify(await crossBore(radius), null, 2) + '\n');
    let calls = 0;
    let failNext = false;
    const handlers = {
      ...QUERY_HANDLERS,
      diffBounds: (...args) => {
        calls++;
        if (failNext) {
          failNext = false;
          throw new HttpError(504, 'Query diffBounds timed out after 30000 ms');
        }
        return QUERY_HANDLERS.diffBounds(...args);
      },
    };
    let server;
    try {
      await write(4);
      server = await createReviewServer({ modelPaths: [output], root: directory,
        reviewDirectory: reviews, port: 0, live: { queryHandlers: handlers } });
      const base = server.origin;
      await write(5);
      const workspace = await (await fetch(base + '/api/workspace')).json();
      const [first, second] = workspace.models.map(entry => entry.id);
      const get = async query => {
        const response = await fetch(`${base}/api/diff?${query}`);
        return { status: response.status, body: await response.json() };
      };
      const { status, body } = await get(`after=${second}`);
      assert.equal(status, 200);
      assert.equal(body.schema, 'wonky.diff/1');
      assert.equal(body.pairing, 'previous-revision');
      assert.deepEqual([body.ghost.modelId, body.ghost.forModelId], [first, second]);
      assert.equal(body.ghost.representation, 'display-approximation');
      assert.deepEqual([body.before.revision, body.after.revision], [1, 2]);
      assert.equal(body.deltas.bounds.exactness, 'kernel-resolved');
      assert.deepEqual(roundBox(body.deltas.bounds.after), { min: [0, -10, 0], max: [30, 10, 20] });
      assert.deepEqual(body.deltas.bounds.delta.size.map(round), [0, 0, 0]);
      assert.equal(body.after.kernelBounds.status, 'resolved');
      assert.equal(body.after.kernelBounds.bodies[0].source, 'kernel');
      assert.ok(body.deltas.volumeMm3.delta < 0, 'a larger bore removes material');
      assert.equal(calls, 2, 'one kernel query per revision');
      // Explicit pairing reuses the per-model kernel bounds.
      const explicit = await get(`after=${first}&before=${second}`);
      assert.equal(explicit.body.pairing, 'explicit');
      assert.equal(explicit.body.deltas.bounds.exactness, 'kernel-resolved');
      assert.equal(calls, 2);
      assert.equal((await get(`after=${first}`)).body.pairing, 'none');
      for (const [query, code] of [['', 400], ['after=x', 400],
        [`after=${'0'.repeat(64)}`, 404], [`after=${second}&before=nope`, 400]]) {
        assert.equal((await get(query)).status, code, query);
      }
      // A transient pool failure falls back to the display envelope and is retried.
      await write(3);
      const third = (await (await fetch(base + '/api/workspace')).json()).models
        .map(entry => entry.id).find(id => id !== first && id !== second);
      failNext = true;
      const failed = await get(`after=${third}`);
      assert.equal(failed.body.deltas.bounds.exactness, 'display-approximation');
      assert.match(failed.body.deltas.bounds.after.kernelReason, /timed out/);
      assert.equal(failed.body.after.kernelBounds.status, 'failed');
      const retried = await get(`after=${third}`);
      assert.equal(retried.body.deltas.bounds.exactness, 'kernel-resolved');
      assert.equal(calls, 4, 'the failure was not cached');
    } finally {
      await server?.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

// ---------------------------------------------------------------------------
// Ghost layer: edges that do not coincide with the displayed model.

const drawModel = (center, points, segments, classes) => ({
  center, arrays: {
    edgePoints: Float32Array.from(points.flatMap(point => point.map((value, axis) => value
      - center[axis]))),
    edgeSegments: Uint32Array.from(segments.flat()),
    edgeOfSegment: Uint32Array.from(segments.map((_segment, index) => index)),
    edgeClass: Uint8Array.from(classes),
  },
});

test('ghost edges skip segments the displayed model shares, seams and the overflow', () => {
  const ghost = drawModel([1, 1, 1], [[0, 0, 0], [10, 0, 0], [10, 5, 0], [0, 5, 0]],
    [[0, 1], [1, 2], [2, 3], [3, 0]], [0, 0, 2, 4]);
  const shown = drawModel([5, 5, 5], [[10, 0, 0], [0, 0, 0], [10, 7, 0]], [[0, 1], [0, 2]],
    [0, 0]);
  const result = ghostEdgePositions(ghost, shown);
  assert.equal(result.coincident, 1, 'the shared segment (either direction) is skipped');
  assert.equal(result.segments, 2, 'the seam class (2) is skipped too');
  assert.deepEqual([...result.positions].map(round),
    [10, 0, 0, 10, 5, 0, 0, 5, 0, 0, 0, 0]);
  const limited = ghostEdgePositions(ghost, null, { limit: 1 });
  assert.deepEqual([limited.segments, limited.truncated], [1, 2]);
  assert.equal(ghostEdgePositions(null, shown).segments, 0);
});

// ---------------------------------------------------------------------------
// Ghost controller: keyed by model id, pending until recomputed.

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
};
const settle = () => new Promise(resolve => setImmediate(resolve));
const diffAnswer = (before, after, extra = {}) => ({
  schema: 'wonky.diff/1', pairing: 'previous-revision', ghost: { modelId: before, forModelId:
    after }, before: { modelId: before, revision: 3 }, after: { modelId: after, revision: 4 },
  deltas: {
    bounds: { status: 'evaluated', exactness: 'kernel-resolved', toleranceMm: 0.0006,
      before: { size: [30, 20, 20] }, after: { size: [30, 20, 20] },
      delta: { size: [0, 0, 2.5], min: [0, 0, 0], max: [0, 0, 2.5] } },
    volumeMm3: { status: 'evaluated', before: 10492, after: 9644, delta: -848.2 },
  },
  ...extra,
});

function controllerHarness({ previous = { d: 'c', c: 'b' } } = {}) {
  const view = { after: 'c', before: null, compare: false };
  const loads = new Map();
  const diffs = new Map();
  const snapshots = [];
  const requests = createRequests();
  const controller = createGhostController({
    view: () => view,
    previous: id => previous[id] ?? null,
    loadModel: id => {
      if (!loads.has(id)) loads.set(id, deferred());
      return loads.get(id).promise;
    },
    fetchDiff: ({ before, after }) => {
      const key = `${before}:${after}`;
      if (!diffs.has(key)) diffs.set(key, deferred());
      return diffs.get(key).promise;
    },
    scope: requests.scope('diff.ghost'),
    emit: snapshot => snapshots.push(snapshot),
  });
  return { view, loads, diffs, snapshots, controller };
}

test('the ghost is keyed by model id: a swap clears it and shows pending until recomputed',
  async () => {
    const { view, loads, diffs, controller } = controllerHarness();
    assert.equal(controller.snapshot().status, 'off');
    controller.toggle(true);
    assert.deepEqual([controller.snapshot().status, controller.snapshot().modelId,
      controller.snapshot().diff.status], ['pending', 'b', 'pending']);
    assert.equal(controller.drawn(), null, 'nothing is drawn while pending');
    loads.get('b').resolve();
    await settle();
    assert.equal(controller.snapshot().status, 'ready');
    assert.deepEqual(controller.drawn(), { modelId: 'b', forModelId: 'c' });
    diffs.get('b:c').resolve(diffAnswer('b', 'c'));
    await settle();
    assert.equal(controller.snapshot().diff.status, 'ready');
    // Live swap to d: cleared at once, pending until d's pair is ready.
    view.after = 'd';
    controller.sync();
    assert.deepEqual([controller.snapshot().status, controller.snapshot().forModelId,
      controller.snapshot().modelId, controller.snapshot().diff.status],
    ['pending', 'd', 'c', 'pending']);
    assert.equal(controller.drawn(), null);
    diffs.get('c:d').resolve(diffAnswer('c', 'd'));
    await settle();
    assert.equal(controller.snapshot().diff.status, 'ready');
    assert.equal(controller.snapshot().status, 'pending', 'the ghost waits for its draw data');
    loads.get('c').resolve();
    await settle();
    assert.deepEqual(controller.drawn(), { modelId: 'c', forModelId: 'd' });
    // The same pair again is not recomputed.
    assert.equal(controller.sync().status, 'ready');
    controller.toggle(false);
    assert.deepEqual([controller.snapshot().on, controller.snapshot().status], [false, 'off']);
    assert.equal(controller.drawn(), null);
  });

test('stale draw data for a replaced pair never marks the new pair ready', async () => {
  const { view, loads, controller } = controllerHarness();
  controller.toggle(true);
  view.after = 'd';
  controller.sync();
  loads.get('b').resolve();
  await settle();
  assert.equal(controller.snapshot().status, 'pending');
  assert.equal(controller.drawn(), null);
});

test('pairing falls back to the server; none, failures and capability are explicit',
  async () => {
    const { view, loads, diffs, controller } = controllerHarness({ previous: {} });
    view.after = 'n';
    controller.toggle(true);
    assert.equal(controller.snapshot().modelId, null, 'no client pairing');
    diffs.get('null:n').resolve(diffAnswer('m', 'n'));
    await settle();
    assert.deepEqual([controller.snapshot().modelId, controller.snapshot().pairing],
      ['m', 'previous-revision']);
    loads.get('m').resolve();
    await settle();
    assert.equal(controller.snapshot().status, 'ready');
    // No earlier revision.
    view.after = 'first';
    controller.sync();
    diffs.get('null:first').resolve({ schema: 'wonky.diff/1', pairing: 'none', ghost: null,
      reason: 'No earlier revision of this source' });
    await settle();
    assert.deepEqual([controller.snapshot().status, controller.snapshot().reason],
      ['none', 'No earlier revision of this source']);
    // The pairing request fails.
    view.after = 'broken';
    controller.sync();
    diffs.get('null:broken').reject(new Error('Unknown after model revision'));
    await settle();
    assert.equal(controller.snapshot().status, 'failed');
    assert.match(controller.snapshot().reason, /Ghost pairing unavailable: Unknown after/);
    // Draw data fails.
    const other = controllerHarness();
    other.controller.toggle(true);
    other.loads.get('b').reject(new Error('Request failed (500)'));
    await settle();
    assert.equal(other.controller.snapshot().status, 'failed');
    assert.match(other.controller.snapshot().reason, /Ghost draw data unavailable/);
    // Without WebGL2 the deltas still come, the ghost is not drawn.
    const blind = createGhostController({
      view: () => ({ after: 'c' }), previous: () => 'b', loadModel: () => Promise.resolve(),
      fetchDiff: async () => diffAnswer('b', 'c'), scope: createRequests().scope('x'),
      unavailable: () => 'This viewer draws models with WebGL2',
    });
    blind.toggle(true);
    await settle();
    assert.deepEqual([blind.snapshot().status, blind.snapshot().diff.status],
      ['unavailable', 'ready']);
    assert.equal(blind.drawn(), null);
  });

test('compare mode pairs the ghost with the before model', () => {
  assert.deepEqual(ghostTarget({ after: 'b', before: 'a', compare: true }, () => 'z'),
    { forModelId: 'b', modelId: 'a', pairing: 'explicit' });
  assert.deepEqual(ghostTarget({ after: 'b', before: 'b', compare: true }, () => 'z'),
    { forModelId: 'b', modelId: 'z', pairing: 'previous-revision' });
  assert.deepEqual(ghostTarget({ after: null }), { forModelId: null, modelId: null,
    pairing: null });
});

test('panel texts: ghost label, kernel-labelled bounds to the tolerance decade, pending', () => {
  assert.equal(ghostLabel({ kind: 'live', revision: 3 }), 'r3 ghost');
  assert.equal(ghostLabel({ kind: 'archive', revision: null }), 'archived ghost');
  assert.equal(ghostLabel(null), 'ghost');
  const answer = diffAnswer('b', 'c');
  assert.equal(boundsDeltaText(answer.deltas.bounds), 'bounds Δ 0 × 0 × +2.5 mm');
  assert.equal(boundsDeltaText({ status: 'evaluated', exactness: 'recorded', toleranceMm: 0,
    delta: { size: [-0.0004, 1.23456, 0] } }), 'bounds Δ 0 × +1.235 × 0 mm');
  assert.equal(boundsDeltaText({ status: 'not evaluated' }), 'bounds not evaluated');
  const items = deltaItems(answer);
  assert.match(items[0].chip, /exactness-kernel[^>]*>kernel</);
  assert.match(items[1].text, /volume Δ −848\.2 mm³/);
  assert.match(items[1].chip, />recorded</);
  const pending = panelModel({ on: true, status: 'pending', modelId: 'b', diff: {
    status: 'pending' } }, { label: 'r3 ghost' });
  assert.deepEqual([pending.hidden, pending.label, pending.state, pending.delta.text],
    [false, 'r3 ghost', 'pending', 'bounds Δ pending']);
  const drawnPending = panelModel({ on: true, status: 'ready', modelId: 'b', diff: {
    status: 'pending' } }, { label: 'r3 ghost' });
  assert.deepEqual([drawnPending.state, drawnPending.tone], ['pending', 'pending'],
    'a drawn ghost reads pending until its delta is recomputed');
  const none = panelModel({ on: true, status: 'none', modelId: null, reason: 'No earlier'
    + ' revision of this source', diff: { status: 'none' } }, { label: 'x' });
  assert.deepEqual([none.label, none.reason], ['ghost', 'No earlier revision of this source']);
  assert.equal(panelModel({ on: false, status: 'off', diff: {} }, { label: 'x' }).hidden, true);
  assert.equal(clampBlend(0), 0.05);
  assert.equal(clampBlend(2), 1);
  assert.equal(clampBlend('0.456'), 0.46);
  assert.equal(clampBlend('x'), 0.35);
});

// ---------------------------------------------------------------------------
// The diff feature in the fake browser environment (legacy features plus
// display and diff, non-legacy mode).

const wanted = new Set([...FEATURES.filter(entry => entry.legacy).map(entry => entry.id),
  'display', 'diff']);
const { features, failures } = await loadFeatures(FEATURES.filter(entry => wanted.has(entry.id)));
assert.deepEqual(failures, []);

const hex = character => character.repeat(64);
const sceneOf = id => ({ id, label: 'part', bounds: { min: [0, 0, 0], max: [1, 1, 1] },
  bodies: [{ id: 'part', faces: [{ index: 0, triangles: [] }], edges: [], vertices: [] }] });
const flush = async (count = 6) => {
  for (let index = 0; index < count; index++) await new Promise(resolve => setImmediate(resolve));
};

test('Shift+W shows "r2 ghost" with its kernel delta; a new revision clears it to pending',
  async () => {
    const models = [hex('a'), hex('b')].map(id => ({ id, label: 'part',
      sourcePath: '/w/part.brep.json', bodyCount: 1 }));
    const requests = [];
    let document = emptySettings();
    const dispatch = (path, options = {}) => {
      requests.push(`${options.method ?? 'GET'} ${path}`);
      if (path === '/api/workspace') return { models, reports: [], feedback: [] };
      if (path === '/api/compare/revisions') throw new Error('facts unavailable');
      if (path === '/api/settings' && options.method === 'PUT') {
        document = mergeSettings(document, JSON.parse(options.body));
        return document;
      }
      if (path === '/api/settings') return document;
      if (path.startsWith('/api/diff?')) {
        const query = new URLSearchParams(path.split('?')[1]);
        return diffAnswer(query.get('before'), query.get('after'));
      }
      if (path.startsWith('/api/compare?')) throw new Error('delta strip: not tested here');
      if (path.startsWith('/api/models/')) return sceneOf(path.slice('/api/models/'.length));
      return {};
    };
    const fake = createFakeEnvironment({ dispatch });
    const none = () => {};
    const viewer = createViewer(fake.env, {
      features, legacy: false,
      seams: { scheduleDraw: none, renderAnnotations: none, renderSaved: none, panel: none,
        renderInspector: none },
    });
    const { state } = viewer.harness;
    const { app, store, renderer } = viewer.ctx;
    const loads = [];
    renderer.loadModel = async id => {
      loads.push(id);
    };
    await viewer.harness.startupWorkspace();
    await flush();
    assert.equal(state.after, hex('b'));
    assert.equal(fake.node('#ghost-panel').hidden, true);
    fake.document.emit('keydown', { key: 'W', shiftKey: true });
    assert.equal(fake.node('#ghost-panel').hidden, false);
    assert.equal(fake.node('#ghost-state').textContent, 'pending');
    await flush();
    assert.ok(requests.includes(`GET /api/diff?after=${hex('b')}&before=${hex('a')}`));
    assert.deepEqual(loads, [hex('a')]);
    assert.equal(fake.node('#ghost-label').textContent, 'r1 ghost');
    assert.equal(fake.node('#ghost-state').hidden, true, 'ready: no state chip');
    assert.match(fake.node('#ghost-details').innerHTML, /bounds Δ 0 × 0 × \+2\.5 mm/);
    assert.match(fake.node('#ghost-details').innerHTML, /exactness-kernel/);
    assert.deepEqual(store.get().display.ghost, { modelId: hex('a'), opacity: 0.35 });
    assert.equal(renderer.style().ghost.modelId, hex('a'), 'composed into the style table');
    assert.equal(fake.node('#ghost-toggle').getAttribute('aria-pressed'), 'true');
    // Blend slider: opacity follows, the G setting is written.
    fake.node('#ghost-blend').value = '60';
    fake.node('#ghost-blend').oninput();
    assert.equal(document.global.ghostBlend, undefined, 'not written while dragging');
    fake.node('#ghost-blend').onchange();
    await flush();
    assert.equal(store.get().display.ghost.opacity, 0.6);
    assert.equal(fake.node('#ghost-blend-value').textContent, '60 %');
    assert.equal(document.global.ghostBlend, 0.6);
    // A new revision is displayed: the ghost clears at once and shows pending.
    models.push({ id: hex('c'), label: 'part', sourcePath: '/w/part.brep.json', bodyCount: 1 });
    let release;
    renderer.loadModel = id => new Promise(resolve => {
      loads.push(id);
      release = resolve;
    });
    await viewer.harness.workspace();
    assert.equal(state.after, hex('b'));
    assert.equal(store.get().display.ghost.modelId, hex('a'), 'a refresh keeps the pair');
    app.openModel(hex('c'));
    assert.equal(store.get().display.ghost.modelId, null, 'cleared on the swap');
    assert.equal(fake.node('#ghost-state').textContent, 'pending');
    assert.match(fake.node('#ghost-details').innerHTML, /bounds Δ pending/);
    await flush();
    assert.equal(store.get().display.ghost.modelId, null, 'still pending without draw data');
    assert.equal(loads.at(-1), hex('b'));
    release();
    await flush();
    assert.equal(store.get().display.ghost.modelId, hex('b'));
    assert.equal(fake.node('#ghost-label').textContent, 'r2 ghost');
    // Shift+W again hides it.
    fake.document.emit('keydown', { key: 'W', shiftKey: true });
    assert.equal(fake.node('#ghost-panel').hidden, true);
    assert.equal(store.get().display.ghost.modelId, null);
    assert.equal(app.ghostStatus().status, 'off');
    viewer.dispose?.();
  });

}
