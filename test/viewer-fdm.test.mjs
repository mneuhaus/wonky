import test from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missingBend();
if (publicTreeSkip) {
  test("viewer-fdm.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { mkdtemp, readFile, rm, writeFile } = await import("node:fs/promises");
const { tmpdir } = await import("node:os");
const { join } = await import("node:path");
const { build } = await import("../src/index.mjs");
const { loadKernel } = await import("../src/kernel.mjs");
const { createReviewServer } = await import("../src/review-server.mjs");
const { checkRequest, curvedBand, faceCoverage, intersectIntervals, overhangAngle, printabilityOf, printabilityQuery, slackDeg } = await import("../src/viewer/printability.mjs");
const { createViewer } = await import("../viewer/app.js");
const { loadFeatures } = await import("../viewer/core/feature-loader.js");
const { LEGACY_FEATURES } = await import("../viewer/features/index.js");
const fdmFeature = await import("../viewer/features/fdm/fdm.js");
const { badgeMarkup, bandText, betaOf, bodyKey, cleanAlpha, cleanPlate, displayFdm, faceFlags, legendMarkup, legendText, relationOf, smallBoreText, statusView, stripSpanDeg, upLabel } = await import("../viewer/features/fdm/overhang.js");
const { clampSegments, depthSlab, gridFade, plateGeometry } = await import("../viewer/features/fdm/plate-layer.js");
const { basis, project } = await import("../viewer/render/camera.js");
const { createFakeEnvironment } = await import("../scripts/viewer/test-support/fake-env.mjs");
// fdm package: printability API (src/viewer/printability.mjs and its route),
// the pure client helpers (viewer/features/fdm/overhang.js, plate-layer.js)
// and the fdm feature in the fake browser environment. Models are built from
// the QA fixtures (chamfer-45, cross-bore-16), the audit cross bore and arc
// slot and the pin-in-bore fixture, so every classification runs on real
// stored analytic parameters.


















const source = path => readFile(new URL(path, import.meta.url), 'utf8');
const kernel = await loadKernel();
const [chamfer, crossBore, crossBore16, pinInBore, arcSlot] = await Promise.all([
  source('../scripts/viewer/qa/fixtures/chamfer-45.fs').then(text => build(text)),
  source('../scripts/viewer/audit-data/cross-bore.fs').then(text => build(text)),
  source('../scripts/viewer/qa/fixtures/cross-bore-16.fs').then(text => build(text)),
  source('../scripts/viewer/qa/fixtures/pin-in-bore.fs').then(text => build(text)),
  source('../scripts/viewer/audit-data/arc-slot.fs').then(text => build(text)),
]);
const near = (actual, expected, tolerance = 1e-9) => assert.ok(
  Math.abs(actual - expected) <= tolerance, `${actual} is not ${expected} ±${tolerance}`);
const check = (model, body = {}) => printabilityOf(model, checkRequest(body), { kernel });
const face = (result, fragment, body = 0) => result.bodies[body].faces
  .find(item => item.fragments.includes(fragment));

// ---- Server: request shape --------------------------------------------------

test('checkRequest fills the cad-khana defaults and rejects bad input with 400', () => {
  assert.deepEqual(checkRequest({}), {
    alphaDeg: 45, smallBoreMm: 12, plateMm: [256, 256], bodies: null,
  });
  assert.equal(checkRequest({ smallBoreMm: null }).smallBoreMm, null, 'exemption off');
  const up = checkRequest({ bodies: [{ bodyId: 'b', up: [0, 0, 2] }] }).bodies[0];
  assert.deepEqual(up, { bodyId: 'b', up: [0, 0, 1], printed: true }, 'up is normalized');
  for (const bad of [{ alphaDeg: 0 }, { alphaDeg: 90 }, { alphaDeg: '45' },
    { smallBoreMm: -1 }, { plateMm: [256] }, { bodies: [{}] },
    { bodies: [{ bodyId: 'b', up: [0, 0, 0] }] }, { bodies: [{ bodyId: 'b', printed: 1 }] },
    { bodies: [{ bodyId: 'b' }, { bodyId: 'b' }] }, null, []]) {
    assert.throws(() => checkRequest(bad), error => error.status === 400, JSON.stringify(bad));
  }
});

// ---- Server: closed forms ---------------------------------------------------

test('α from vertical: a vertical wall is 0°, a ceiling 90°, a 45° chamfer 45°', () => {
  near(overhangAngle([1, 0, 0], [0, 0, 1]), 0);
  near(overhangAngle([0, 0, -1], [0, 0, 1]), 90);
  near(overhangAngle([Math.SQRT1_2, 0, -Math.SQRT1_2], [0, 0, 1]), 45, 1e-12);
  near(overhangAngle([0, 0, 1], [0, 0, 1]), 0, 0);
});

test('cylinder and cone bands: centre, half width and the vertical-axis cases', () => {
  const frame = { axis: [1, 0, 0], x: [0, 1, 0], y: [0, 0, 1] };
  const hole = curvedBand({ sense: -1, ...frame, up: [0, 0, 1], alphaDeg: 45 });
  assert.equal(hole.kind, 'band');
  near(hole.centerDeg, 90);
  near(hole.halfWidthDeg, 45, 1e-9);
  assert.deepEqual(hole.bandsDeg.map(pair => pair.map(value => Math.round(value))), [[45, 135]]);
  const boss = curvedBand({ sense: 1, ...frame, up: [0, 0, 1], alphaDeg: 45 });
  near(boss.centerDeg, 270, 1e-9);
  const vertical = curvedBand({ sense: -1, axis: [0, 0, 1], x: [1, 0, 0], y: [0, 1, 0],
    up: [0, 0, 1], alphaDeg: 45 });
  assert.equal(vertical.kind, 'none', 'a vertical bore never overhangs');
  // A cone boss narrowing upward (conical spacer, half angle atan(1/3)): its
  // normal leans up, so up = +Z never overhangs and up = −Z gives α = 18.4°.
  const cone = { sense: 1, halfAngleRad: Math.atan(1 / 3), axis: [0, 0, -1], x: [1, 0, 0],
    y: [0, 1, 0], alphaDeg: 45 };
  assert.equal(curvedBand({ ...cone, up: [0, 0, 1] }).kind, 'none');
  assert.equal(curvedBand({ ...cone, up: [0, 0, -1] }).kind, 'none');
  assert.equal(curvedBand({ ...cone, up: [0, 0, -1], alphaDeg: 15 }).kind, 'full');
  assert.deepEqual(intersectIntervals([[315, 405]], [[0, 90]]), [[0, 45]]);
  assert.deepEqual(intersectIntervals([[45, 135]], [[180, 360]]), []);
});

// ---- Server: fixtures ---------------------------------------------------------

test('chamfer-45: the 45° chamfer passes at α_max 45°, the 50° face overhangs', async () => {
  const result = await check(chamfer);
  const body = result.bodies[0];
  assert.equal(result.betaDeg, 45);
  assert.equal(result.conventions.legend,
    'overhang α > 45° from vertical (slicer threshold β = 45°)');
  assert.equal(result.exemptions.bridge.applied, false);
  assert.match(result.exemptions.bridge.note, /bridge exemption \(<= 10 mm\) not applied/);
  const chamferFace = face(result, 'B1.F4');
  near(chamferFace.angleDeg, 45, slackDeg(chamfer.bodies[0]));
  assert.equal(chamferFace.kind, 'ok');
  assert.equal(chamferFace.exactness, 'exact-parameters');
  const fifty = face(result, 'B1.F8');
  near(fifty.angleDeg, 50, 1e-5);
  assert.equal(fifty.kind, 'overhang');
  assert.equal(face(result, 'B1.F3').kind, 'bed', 'the face at z = 0 is the bed face');
  assert.deepEqual(body.counts, { ok: 6, overhang: 1, bed: 1, 'exempt-small-bore': 0,
    unsupported: 0 });
  assert.equal(body.plate.relation, 'on-plate');
  assert.equal(body.plate.exactness, 'recorded');
  const sixty = await check(chamfer, { alphaDeg: 60 });
  assert.equal(sixty.betaDeg, 30);
  assert.equal(face(sixty, 'B1.F8').kind, 'ok', 'α_max 60°: the 50° face passes');
  assert.equal(body.plate.footprint.exceeds, false);
  const small = await check(chamfer, { plateMm: [40, 40] });
  assert.equal(small.bodies[0].plate.footprint.exceeds, true, 'x −11.9..30 leaves ±20 mm');
  assert.deepEqual(small.plate.sizeMm, [40, 40]);
});

test('cross bores: Ø8 is exempt (small bore), Ø16 overhangs in the exact band 45°–135°',
  async () => {
    const small = await check(crossBore);
    const bore = face(small, 'B1.F7');
    assert.equal(bore.kind, 'exempt-small-bore');
    assert.equal(bore.hole, true);
    assert.match(bore.reason, /Ø8 mm <= 12 mm/);
    const off = await check(crossBore, { smallBoreMm: null });
    assert.equal(face(off, 'B1.F7').kind, 'overhang', 'without the exemption it overhangs');
    const large = await check(crossBore16);
    const bore16 = face(large, 'B1.F7');
    assert.equal(bore16.kind, 'overhang');
    assert.equal(bore16.exactness, 'exact-parameters');
    near(bore16.bandsDeg[0][0], 45, 1e-5);
    near(bore16.bandsDeg[0][1], 135, 1e-5);
    assert.deepEqual(bore16.band.coverageDeg, [[0, 360]], 'full turn from its circle edges');
    assert.deepEqual(bore16.band.frame.x, [0, 1, 0]);
    // cross-bore has no recorded bounds: the plate relation comes from edge bands.
    assert.equal(large.bodies[0].plate.relation, 'on-plate');
    assert.equal(large.bodies[0].plate.exactness, 'kernel-resolved');
    assert.deepEqual(large.bodies[0].plate.bedFaces, ['B1.L1']);
  });

test('a half cylinder keeps only the part of the band its circle edges cover', async () => {
  // arc-slot: two half-cylinder ends (bosses) about Z. With up = +X the band
  // points to −X: only the left end overhangs, the right end not.
  const body = arcSlot.bodies[0];
  const result = await check(arcSlot, { bodies: [{ bodyId: body.id, up: [1, 0, 0] }] });
  const ends = result.bodies[0].faces.filter(item => item.surface === 'cylinder');
  const index = alias => Number(alias.split('.F')[1]) - 1;
  const right = ends.find(item => body.faces[index(item.fragments[0])].surface.origin[0] > 0);
  const left = ends.find(item => body.faces[index(item.fragments[0])].surface.origin[0] < 0);
  assert.equal(right.kind, 'ok');
  assert.deepEqual(right.bandsDeg, []);
  assert.equal(right.band.supportingBandsDeg.length, 1, 'the supporting cylinder has a band');
  assert.equal(left.kind, 'overhang');
  const [coverage] = left.band.coverageDeg;
  near(coverage[1] - coverage[0], 180, 1e-6);
  const planar = body.faces.findIndex(item => item.surface.type === 'plane'
    && !item.loops.flat().some(use => body.edges[use.edge].curve.type === 'circle'));
  const surface = body.faces[body.faces.findIndex(item => item.surface.type === 'cylinder')]
    .surface;
  const frame = { origin: surface.origin, axis: [0, 0, 1], x: surface.x,
    y: [-surface.x[1], surface.x[0], 0] };
  assert.equal(faceCoverage(kernel, body, body.faces[planar], frame), null,
    'a face without circle edges has no evaluated coverage');
});

test('multi-body plate relations, printed flags, up = −n and unknown bodies', async () => {
  const pin = pinInBore.bodies[1];
  const both = await check(pinInBore);
  assert.equal(both.bodies[0].plate.relation, 'on-plate');
  assert.equal(both.bodies[0].plate.exactness, 'kernel-resolved', 'no recorded bounds');
  assert.equal(both.bodies[1].plate.relation, 'cuts');
  near(both.bodies[1].plate.distanceMm, 4);
  assert.equal(both.bodies[1].plate.exactness, 'recorded');
  const only = await check(pinInBore, { bodies: [{ bodyId: pin.id, printed: false }] });
  assert.equal(only.bodies.length, 1, 'the answer covers exactly the listed bodies');
  assert.equal(only.bodies[0].plate, null);
  assert.deepEqual(only.bodies[0].faces, []);
  await assert.rejects(check(pinInBore, { bodies: [{ bodyId: 'nope' }] }),
    error => error.status === 400 && /Unknown body nope/.test(error.message));
  // Print on the 45° chamfer: up = −n; the chamfer becomes the bed face and
  // the minimum along the tilted up comes from kernel edge bands.
  const n = chamfer.bodies[0].faces[3].surface.normal;
  const tilted = await check(chamfer, { bodies: [{ bodyId: chamfer.bodies[0].id,
    up: n.map(value => -value) }] });
  assert.equal(tilted.bodies[0].plate.relation, 'bed-faces');
  assert.deepEqual(tilted.bodies[0].plate.bedFaces, ['B1.L4']);
  assert.equal(tilted.bodies[0].plate.exactness, 'kernel-resolved');
  assert.equal(face(tilted, 'B1.F8').kind, 'ok');
});

test('the query handler checks its payload and the route answers through the worker',
  async () => {
    await assert.rejects(printabilityQuery(chamfer, { alphaDeg: 95 }),
      error => error.status === 400);
    const directory = await mkdtemp(join(tmpdir(), 'wonky-fdm-'));
    const path = join(directory, 'chamfer-45.brep.json');
    await writeFile(path, `${JSON.stringify(chamfer, null, 2)}\n`);
    const server = await createReviewServer({
      modelPaths: [path], reviewDirectory: join(directory, 'reviews'), port: 0, log: () => {},
    });
    try {
      const base = server.origin;
      const [{ id }] = (await (await fetch(`${base}/api/workspace`)).json()).models;
      const post = (body, headers = { 'Content-Type': 'application/json' }, model = id) =>
        fetch(`${base}/api/models/${model}/printability`, {
          method: 'POST', headers, body: JSON.stringify(body),
        });
      const response = await post({ alphaDeg: 60 });
      assert.equal(response.status, 200);
      const data = await response.json();
      assert.equal(data.schema, 'wonky.viewer-printability/1');
      assert.equal(data.modelId, id);
      assert.equal(data.betaDeg, 30);
      assert.equal(data.bodies[0].faces.find(item => item.alias === 'B1.L8').kind, 'ok');
      assert.equal((await post({ alphaDeg: 90 })).status, 400);
      assert.equal((await post({ bodies: [{ bodyId: 'nope' }] })).status, 400);
      assert.equal((await post({}, { 'Content-Type': 'text/plain' })).status, 415);
      assert.equal((await post({}, undefined, '0'.repeat(64))).status, 404);
    } finally {
      await server.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

// ---- Client: pure helpers -------------------------------------------------------

test('legend texts: α, the slicer β = 90° − α and the exemption notes', () => {
  assert.equal(betaOf(45), 45);
  assert.equal(legendText(45), 'overhang α > 45° from vertical (slicer threshold β = 45°)');
  assert.equal(legendText(60), 'overhang α > 60° from vertical (slicer threshold β = 30°)');
  assert.equal(legendText(47.5),
    'overhang α > 47.5° from vertical (slicer threshold β = 42.5°)');
  assert.equal(smallBoreText(12), 'exempt: small bore Ø ≤ 12 mm (outlined)');
  assert.equal(smallBoreText(null), 'small-bore exemption off');
  const markup = legendMarkup({ alphaDeg: 45, smallBoreMm: 12, stripDeg: 8.1045,
    counts: { overhang: 1, exempt: 0, bed: 1, unsupported: 0 }, revision: 'r3' });
  assert.match(markup, /bridge exemption \(≤ 10 mm\) not applied/);
  assert.match(markup, /curved band edges ±4\.1° \(display strips\)/);
  assert.match(markup, /1 overhang · 0 exempt · 1 bed · r3/);
  assert.match(legendMarkup({ alphaDeg: 45, smallBoreMm: 12, pending: true, revision: 'r4' }),
    /overhang pending · r4: no tint until the printability API answers/);
  near(stripSpanDeg(8, 0.02), 8.1045, 1e-3);
  assert.equal(stripSpanDeg(8, null), null);
  assert.equal(cleanAlpha('60'), 60);
  assert.equal(cleanAlpha(95), 89);
  assert.equal(cleanAlpha('x'), 45);
  assert.deepEqual(cleanPlate([300, 250]), [300, 250]);
  assert.deepEqual(cleanPlate([0, 250]), [256, 256]);
  assert.equal(upLabel([0, 0, -1]), '−Z');
  assert.equal(upLabel([0, 0.6, 0.8]), '(0, 0.6, 0.8)');
  assert.equal(bandText([[45, 135]]), '45.000°–135.000°');
  assert.equal(bandText([[315, 405]]), '315.000°–45.000°');
});

test('plate relation texts print to the decade of the tolerance with their label', () => {
  const plate = (relation, extra = {}) => ({
    up: [0, 0, 1], printed: true,
    plate: { relation, toleranceMm: 0.0003, exactness: 'recorded', bedFaces: ['B1.L2'],
      minAlongUpMm: 3.2, distanceMm: 3.2, ...extra },
  });
  assert.equal(relationOf(plate('on-plate', { distanceMm: 0 })).text, 'on plate');
  assert.equal(relationOf(plate('floats')).text, 'floats 3.2000 mm above the plate');
  assert.equal(relationOf(plate('cuts', { minAlongUpMm: -0.4, distanceMm: 0.4 })).text,
    'cuts 0.4000 mm into the plate');
  assert.equal(relationOf(plate('cuts', { distanceMm: 0.4 })).short, 'cuts 0.4000 mm');
  assert.equal(relationOf(plate('bed-faces')).text, 'bed faces: B1.L2');
  assert.equal(relationOf(plate('on-plate', { footprint: { exceeds: true } })).text,
    'on plate · footprint exceeds plate');
  assert.equal(relationOf(plate('unresolved', { exactness: 'unsupported' })).chip,
    'unsupported');
  assert.equal(relationOf({ printed: false }).text, 'not printed');
  const kernelChip = badgeMarkup(relationOf(plate('floats', { exactness: 'kernel-resolved' })),
    { compact: true });
  assert.match(kernelChip, /floats 3\.2000 mm<span class="exactness-chip[^"]*"[^>]*>kernel/);
  assert.match(badgeMarkup(null, { pending: true }), /plate pending/);
});

test('status bar: one visible body shows its relation, several point to the rows', () => {
  const bodies = [{ id: 'a', alias: 'B1', printed: true }, { id: 'b', alias: 'B2',
    printed: false }];
  const result = { printed: true, plate: { relation: 'on-plate', toleranceMm: 0.0003,
    exactness: 'kernel-resolved' } };
  const results = new Map([['a', result]]);
  assert.equal(statusView({ bodies, visible: new Set(['a', 'b']), results }).mode, 'rows');
  const one = statusView({ bodies, visible: new Set(['a']), results });
  assert.equal(one.relation.text, 'on plate');
  assert.equal(one.relation.chip, 'kernel-resolved');
  assert.equal(statusView({ bodies, visible: new Set(['b']), results }).relation.text,
    'not printed');
  assert.equal(statusView({ bodies, visible: new Set(['a']), results: new Map(),
    pending: true }).pending, true);
  assert.equal(statusView({ bodies, visible: new Set(), results }), null);
});

test('display.fdm carries flags only for answered, printed bodies (no tint before)', () => {
  const answer = { faces: [
    { alias: 'B1.L1', fragments: ['B1.F1', 'B1.F9'], surface: 'plane', kind: 'bed' },
    { alias: 'B1.L2', fragments: ['B1.F2'], surface: 'plane', kind: 'ok' },
    { alias: 'B1.L7', fragments: ['B1.F7'], surface: 'cylinder', kind: 'overhang',
      bandsDeg: [[45, 135]] },
  ] };
  assert.deepEqual(faceFlags(answer), { 'B1.F1': 'bed', 'B1.F9': 'bed',
    'B1.F7': { kind: 'overhang', bandsDeg: [[45, 135]] } });
  const body = (result, printed = true) => ({ bodyId: 'a', up: [0, 0, 1], printed, result });
  assert.deepEqual(displayFdm({ enabled: false, alphaDeg: 45 }), { overhang: null });
  const pending = displayFdm({ enabled: true, alphaDeg: 45, entries: [{ modelId: 'm',
    bodies: [body(null)] }] });
  assert.deepEqual(pending.overhang.models, {}, 'no answer, no tint');
  const answered = displayFdm({ enabled: true, alphaDeg: 45, entries: [{ modelId: 'm',
    bodies: [body(answer)] }] });
  assert.equal(answered.overhang.models.m.faces['B1.F1'], 'bed');
  const off = displayFdm({ enabled: true, alphaDeg: 45, entries: [{ modelId: 'm',
    bodies: [body(answer, false)] }] });
  assert.deepEqual(off.overhang.models, {}, 'a body that is not printed is not tinted');
});

test('settings keys: a unique body name, else the body id', () => {
  const bodies = [{ id: 'a', name: 'bracket' }, { id: 'b', name: 'pin' },
    { id: 'c', name: 'pin' }, { id: 'd' }];
  assert.equal(bodyKey(bodies, bodies[0]), 'name:bracket');
  assert.equal(bodyKey(bodies, bodies[1]), 'id:b');
  assert.equal(bodyKey(bodies, bodies[3]), 'id:d');
});

// ---- Client: plate layer ---------------------------------------------------------

test('plate geometry: 256 × 256 mm grid, 10 mm and 1 mm lines, origin axes', () => {
  const lines = plateGeometry([256, 256]);
  const segments = points => points.length / 6;
  assert.equal(segments(lines.outline), 4);
  assert.equal(segments(lines.major), 2 * 25, '10 mm lines from −120 to 120');
  assert.equal(segments(lines.minor), 2 * (255 - 25), '1 mm lines that are not 10 mm lines');
  assert.deepEqual(lines.x, [0, 0, 0, 128, 0, 0]);
  assert.deepEqual(lines.y, [0, 0, 0, 0, 128, 0]);
  assert.ok(lines.major.every((value, index) => index % 3 !== 2 || value === 0),
    'every plate line lies in Z = 0');
  assert.deepEqual(gridFade(1), { major: 1, minor: 0 });
  assert.equal(gridFade(14).minor, 1);
});

test('segments outside the depth slab move along their eye rays and keep their pixels',
  () => {
    const bounds = { min: [0, 0, 0], max: [30, 20, 20] };
    const pane = { x: 0, y: 0, width: 800, height: 600, clipX: 0, clipWidth: 800 };
    for (const projection of ['orthographic', 'perspective']) {
      const camera = { convention: 2, projection, target: [15, 10, 10], yaw: 2.3562,
        pitch: -0.6155, height: 80 };
      const slab = depthSlab({ camera, bounds });
      assert.ok(slab.hi > slab.lo);
      // Across the view (its depth changes along the line).
      const line = [-128, 128, 0, 128, -128, 0];
      const clamped = clampSegments(line, slab);
      assert.ok(clamped.length >= 12, `${projection}: split into pieces`);
      const { toward } = basis(camera);
      // The screen line of the original segment, from two of its points in front
      // of the eye (in perspective the plate ends can lie behind it).
      const along = t => line.slice(0, 3).map((value, axis) => value + (line[axis + 3] - value)
        * t);
      const a = project(along(0.45), camera, pane);
      const b = project(along(0.55), camera, pane);
      const length = Math.hypot(b.x - a.x, b.y - a.y);
      for (let index = 0; index < clamped.length; index += 3) {
        const point = clamped.slice(index, index + 3);
        const depth = (point[0] - 15) * toward[0] + (point[1] - 10) * toward[1]
          + (point[2] - 10) * toward[2];
        assert.ok(depth >= slab.lo - 1e-9 && depth <= slab.hi + 1e-9, 'inside the slab');
        const at = project(point, camera, pane);
        assert.ok(Number.isFinite(at.x) && Number.isFinite(at.y), 'in front of the eye');
        const cross = (b.x - a.x) * (at.y - a.y) - (b.y - a.y) * (at.x - a.x);
        assert.ok(Math.abs(cross / length) < 1e-6, `${projection}: stays on the screen line`);
      }
    }
    assert.equal(clampSegments([1, 2, 3, 4, 5, 6], null).length, 6, 'no slab: unchanged');
  });

// ---- Client: the feature in the fake environment -------------------------------------

const { features: legacyFeatures } = await loadFeatures(LEGACY_FEATURES);
const modelId = 'c'.repeat(64);
const flush = async (times = 6) => {
  for (let index = 0; index < times; index++) await new Promise(done => setImmediate(done));
};

function planeScene(id) {
  const points = [[0, 0, 0], [10, 0, 0], [10, 10, 0], [0, 10, 0]];
  return {
    id, label: 'plate', bounds: { min: [0, 0, 0], max: [10, 10, 0] },
    display: { toleranceMm: 0.02 },
    bodies: [{
      id: 'part',
      faces: [{ index: 0, surfaceType: 'plane', edgeIndices: [0], triangles: [
        { points: [points[0], points[2], points[1]], normal: [0, 0, -1] },
        { points: [points[0], points[3], points[2]], normal: [0, 0, -1] },
      ] }],
      edges: [{ index: 0, points: [points[0], points[1]], curveType: 'line' }],
      vertices: points.map((point, index) => ({ index, point })),
    }],
  };
}

function merge(target, patch) {
  const result = structuredClone(target);
  const walk = (into, from) => {
    for (const [key, value] of Object.entries(from)) {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        into[key] ??= {};
        walk(into[key], value);
      } else if (value === null) delete into[key];
      else into[key] = value;
    }
  };
  walk(result, patch);
  return result;
}

function fdmViewer() {
  const requests = [];
  let document = { schema: 'wonky.viewer-settings/1', global: {}, sources: {}, bodies: {} };
  let answer = null;
  const fake = createFakeEnvironment({
    dispatch: async (path, options = {}) => {
      const method = options.method ?? 'GET';
      requests.push({ method, path, body: options.body ? JSON.parse(options.body) : null });
      if (path === '/api/settings') {
        if (method === 'PUT') document = merge(document, JSON.parse(options.body));
        return document;
      }
      if (path.endsWith('/printability')) {
        const body = JSON.parse(options.body);
        await new Promise(resolve => {
          answer = resolve;
        });
        return {
          schema: 'wonky.viewer-printability/1', alphaDeg: body.alphaDeg,
          bodies: body.bodies.map(entry => ({
            bodyId: entry.bodyId, alias: 'B1', up: entry.up, printed: true,
            plate: { relation: 'on-plate', toleranceMm: 0.0003, exactness: 'recorded',
              bedFaces: ['B1.L1'], distanceMm: 0, minAlongUpMm: 0 },
            faces: [{ alias: 'B1.L1', fragments: ['B1.F1'], surface: 'plane', kind: 'bed' }],
            counts: { ok: 0, overhang: 0, bed: 1, 'exempt-small-bore': 0, unsupported: 0 },
          })),
        };
      }
      if (path.includes('/geometry?aliases=')) {
        return { faces: [{ alias: 'B1.F1', outwardNormal: [0, 0, -1],
          surface: { type: 'plane' } }] };
      }
      throw new Error(`Unexpected request ${method} ${path}`);
    },
  });
  const none = () => {};
  const seams = { scheduleDraw: none, renderAnnotations: none, renderLibrary: none,
    renderSaved: none, panel: none, renderInspector: none };
  const composed = createViewer(fake.env, { seams, features: [...legacyFeatures, fdmFeature],
    log: () => {} });
  const { state } = composed.harness;
  state.workspace.models = [{ id: modelId, label: 'plate', sourcePath: '/tmp/plate.brep.json' }];
  state.scenes.set(modelId, planeScene(modelId));
  Object.assign(state, { before: modelId, after: modelId, compare: false, loading: false });
  return {
    state, requests, ctx: composed.ctx, fake,
    answer: () => answer?.(),
    display: () => composed.ctx.store.get().display.fdm,
  };
}

const sbPatch = (requests, key) => requests.filter(item => item.method === 'PUT')
  .map(item => item.body.bodies?.['/tmp/plate.brep.json']?.['name:part']?.[key])
  .filter(value => value !== undefined);

test('the fdm feature asks nothing until G or Shift+G, and tints only after the answer',
  async () => {
    const viewer = fdmViewer();
    const { ctx, requests } = viewer;
    ctx.app.draw();
    await flush();
    const printability = () => requests.filter(item => item.path.endsWith('/printability'));
    assert.equal(printability().length, 0, 'a static input starts with plate and overhang off');
    ctx.commands.run('fdm.overhang');
    await flush();
    assert.equal(printability().length, 1);
    assert.deepEqual(printability()[0].body.bodies,
      [{ bodyId: 'part', up: [0, 0, 1], printed: true }]);
    assert.equal(printability()[0].body.alphaDeg, 45);
    assert.deepEqual(viewer.display().overhang.models, {}, 'no tint before the answer');
    const html = selector => viewer.fake.node(selector).innerHTML;
    assert.match(html('#fdm-legend'), /overhang pending/);
    viewer.answer();
    await flush();
    assert.equal(viewer.display().overhang.models[modelId].faces['B1.F1'], 'bed');
    assert.match(html('#fdm-legend'), /overhang α &gt; 45° from vertical|overhang α > 45°/);
    assert.match(html('#fdm-status'), /B1<\/span>.*on plate/);
    // Not printed: the flags go at once and nothing new is asked.
    ctx.app.fdmSetPrinted('part', false);
    await flush();
    assert.deepEqual(viewer.display().overhang.models, {});
    assert.equal(printability().length, 1);
    assert.deepEqual(sbPatch(requests, 'fdmPrinted'), [false],
      'printed is persisted per source and body');
  });

test('Shift+B sets up = −n of the selected planar face and persists it', async () => {
  const viewer = fdmViewer();
  const { ctx, state, requests } = viewer;
  ctx.app.draw();
  state.selection = { modelId, bodyId: 'part', entityType: 'face', entityIndex: 0 };
  const up = await ctx.app.fdmPrintOnFace();
  assert.deepEqual(up, [0, 0, 1], 'up = −n of the face normal (0, 0, −1)');
  await flush();
  assert.deepEqual(sbPatch(requests, 'fdmUpFrom'), ['B1.F1']);
  assert.ok(requests.some(item => item.path.includes('/geometry?aliases=B1.F1')));
  state.selection = null;
  assert.equal(await ctx.app.fdmPrintOnFace(), null, 'no face selected: nothing changes');
});

}
