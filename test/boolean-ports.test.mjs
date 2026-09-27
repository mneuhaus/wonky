import test from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missingBend();
if (publicTreeSkip) {
  test("boolean-ports.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { booleanPortCases } = await import("../scripts/boolean-port-cases.mjs");
const { booleanPortNames, clipWithPort, decodePortResult, loadBooleanPort, portComponents, preparePortClip, runPortClip } = await import("../src/boolean-ports.mjs");
const { array } = await import("../src/kernel.mjs");
const { vector } = await import("../src/real.mjs");
const { UnsupportedFeatureError } = await import("../src/errors.mjs");








const corpus = booleanPortCases({ imported: false });
const byId = async id => (await corpus).find(c => c.id === id);
const volume = body => {
  let value = 0;
  const ref = body.vertices[0], delta = p => p.map((x, i) => x - ref[i]);
  for (const face of body.faces) for (const loop of face.loops) {
    const points = loop.map(use => { const e = body.edges[use.edge]; return delta(body.vertices[use.forward ? e.start : e.end]); });
    const a = points[0];
    for (let i = 1; i + 1 < points.length; i++) {
      const b = points[i], c = points[i + 1];
      value += (a[0] * (b[1] * c[2] - b[2] * c[1]) + a[1] * (b[2] * c[0] - b[0] * c[2]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
    }
  }
  return value;
};

test('all three independent Bend paths construct complete concave and convex solids on a common contract', async () => {
  for (const name of booleanPortNames) for (const id of ['box-transverse', 'box-oblique', 'L-height', 'L-side', 'U-height', 'box-rotated', 'box-permuted']) {
    const fixture = await byId(id), before = JSON.stringify(fixture.body);
    const result = await clipWithPort(name, fixture.body, fixture.plane);
    assert.ok(['Clipped', 'Components'].includes(result.$), `${name}/${id}: ${JSON.stringify(result.reason)}`);
    const bodies = await decodePortResult(result, name, id);
    assert.ok(Math.abs(bodies.reduce((sum, body) => sum + volume(body), 0) - fixture.expected.volume) < 1e-7, `${name}/${id}`);
    assert.equal(JSON.stringify(fixture.body), before);
    for (const body of bodies) {
      assert.equal(body.validation.closed, true);
      assert.equal(body.construction.faceOrigins.length, body.faces.length);
      assert.equal(body.construction.edgeOrigins.length, body.edges.length);
    }
  }
});

test('observed contact and disconnected-component strengths remain explicit', async () => {
  const contact = await byId('box-edge'), disconnected = await byId('U-components');
  assert.equal((await clipWithPort('truck', contact.body, contact.plane)).reason.$, 'AmbiguousContact');
  for (const name of ['occt', 'solvespace']) assert.equal((await clipWithPort(name, contact.body, contact.plane)).$, 'Clipped');
  assert.equal((await clipWithPort('solvespace', disconnected.body, disconnected.plane)).reason.$, 'UnsupportedArrangement');
  for (const name of ['occt', 'truck']) {
    const result = await clipWithPort(name, disconnected.body, disconnected.plane);
    assert.equal(result.$, 'Components'); assert.equal(portComponents(result).length, 2);
  }
});

test('native hybrid selects the measured construction strengths and retains complete output', async () => {
  const hybrid = await loadBooleanPort('hybrid');
  for (const [id, route] of [['box-transverse', 'TransversePlanar'], ['box-edge', 'ContactPlanar'], ['box-vertex', 'ContactPlanar'], ['U-components', 'TransversePlanar']]) {
    const fixture = await byId(id), input = await preparePortClip(fixture.body, fixture.plane);
    assert.equal(hybrid.route(input.solid, input.origin, input.normal).$, route);
    const result = runPortClip(hybrid, input), bodies = await decodePortResult(result, 'hybrid', id);
    assert.equal(bodies.length, fixture.expected.components);
    assert.ok(Math.abs(bodies.reduce((sum, body) => sum + volume(body), 0) - fixture.expected.volume) < 1e-7);
  }
});

test('hybrid BSP audit checks new section edges against the actual concave source face', async () => {
  const h = await loadBooleanPort('hybrid'), fixture = await byId('L-height');
  const input = await preparePortClip(fixture.body, fixture.plane), face = array(input.solid.faces)[0];
  const found = { $: 'Some', value: face }, resolution = h.resolution(input.solid);
  assert.equal(h.source_midpoint(found, input.solid, vector([2, 3, 0]), resolution), true);
  assert.equal(h.source_midpoint(found, input.solid, vector([6, 4, 0]), resolution), false);
  assert.equal(h.source_midpoint({ $: 'None' }, input.solid, vector([2, 3, 0]), resolution), false);
});

test('hybrid constructs analytic circular and elliptical caps and chains curved results', async () => {
  const hybrid = await loadBooleanPort('hybrid');
  for (const id of ['cylinder-axial', 'cylinder-oblique']) {
    const fixture = await byId(id), input = await preparePortClip(fixture.body, fixture.plane);
    assert.equal(hybrid.route(input.solid, input.origin, input.normal).$, 'CylindricalCandidate');
    const first = runPortClip(hybrid, input);
    assert.equal(first.$, 'Clipped');
    const [body] = await decodePortResult(first, 'hybrid', id);
    assert.equal(body.validation.closed, true);
    assert.equal(body.faces.length, 3);
    assert.deepEqual(body.edges.map(edge => edge.curve.type).sort(),
      id === 'cylinder-axial' ? ['circle', 'circle', 'line'] : ['circle', 'ellipse', 'line']);
    const second = await clipWithPort('hybrid', first.solid, { origin: [0, 0, 1], normal: [0, 0, -1] }, { domains: array(first.domains) });
    assert.equal(second.$, 'Clipped');
    assert.equal((await decodePortResult(second, 'hybrid'))[0].validation.closed, true);
  }
  const diameter = await byId('cylinder-diameter');
  const unresolved = await clipWithPort('hybrid', diameter.body, diameter.plane);
  assert.equal(unresolved.$, 'Unresolved');
  await assert.rejects(decodePortResult(unresolved, 'hybrid'), UnsupportedFeatureError);
});

test('hybrid results remain valid inputs for repeated clipping with explicit domains', async () => {
  const fixture = await byId('L-height'), h = await loadBooleanPort('hybrid');
  const first = await clipWithPort('hybrid', fixture.body, fixture.plane);
  assert.equal(first.$, 'Clipped');
  const secondInput = await preparePortClip(first.solid, { origin: [4, 0, 0], normal: [1, 0, 0] }, { domains: array(first.domains) });
  const second = runPortClip(h, secondInput), bodies = await decodePortResult(second, 'hybrid');
  assert.equal(bodies.length, 1); assert.ok(Math.abs(volume(bodies[0]) - 40) < 1e-7);
});

test('all ports and hybrid reject malformed input and keep unresolved results out of exports', async () => {
  for (const name of [...booleanPortNames, 'hybrid']) for (const id of ['open-shell', 'reversed-face', 'zero-normal', 'zero-tolerance', 'zero-volume-shell']) {
    const fixture = await byId(id), result = await clipWithPort(name, fixture.body, fixture.plane, fixture.options);
    assert.equal(result.$, 'Unresolved', `${name}/${id}`);
    assert.equal(result.solid, undefined); assert.equal(result.bodies, undefined);
    await assert.rejects(decodePortResult(result, name), UnsupportedFeatureError);
  }
  assert.throws(() => loadBooleanPort('../occt'), TypeError);
});

}
