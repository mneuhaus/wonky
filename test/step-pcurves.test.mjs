import test from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missingBend();
if (publicTreeSkip) {
  test("step-pcurves.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { mkdirSync, readFileSync, writeFileSync } = await import("node:fs");
const { createHash } = await import("node:crypto");
const { loadBend } = await import("../src/bend-loader.mjs");
const { loadKernel, array, list } = await import("../src/kernel.mjs");
const { classificationInput } = await import("../src/face-classification.mjs");
const { circularFrustumInBend, decodeAnalytic } = await import("../src/analytic.mjs");
const { vector, real } = await import("../src/real.mjs");
const { intersectionTolerance } = await import("../src/intersections.mjs");
const { loadStepPCurves, cylinderPCurve, fullBandPCurve } = await import("../src/step-pcurves.mjs");












const native = await loadStepPCurves(), kernel = await loadKernel();
const band = await loadBend(new URL('../kernel/ports/truck-cylinder.bend', import.meta.url));
const artifact = new URL('../out/step-pcurves/', import.meta.url);
mkdirSync(artifact, { recursive: true });
const { version } = JSON.parse(readFileSync(new URL('../bend.lock.json', import.meta.url)));
const frame = { origin: [0, 0, 0], normal: [0, 0, 1], x: [1, 0, 0] };
const source = () => classificationInput(circularFrustumInBend(kernel, 'round', { center: [0, 0], radius: 3, plane: frame }, null, [0, 0, 4]), kernel.faceClassifier).solid;
const cut = (solid, origin, normal) => {
  const result = band.clip(solid, list([]), vector(origin), vector(normal), intersectionTolerance(), real(0));
  assert.equal(result.$, 'Clipped');
  return result.solid;
};
const cross = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
const scaledSum = (origin, ...terms) => origin.map((v, i) => v + terms.reduce((sum, [axis, scalar]) => sum+axis[i]*scalar, 0));
const near = (a, b, eps = 1e-12) => assert.ok(Math.abs(a-b) <= eps, `${a} != ${b}`);
const evidence = [];

// An independent JS measurement oracle evaluates only already constructed
// native control points and analytic 3D curves. It constructs no output shape.
function inspect(pcurve, curve, surface) {
  assert.equal(pcurve.status, 'Resolved', JSON.stringify(pcurve));
  const segments = pcurve.knots.length-1;
  assert.equal(pcurve.degree, 3); assert.equal(pcurve.points.length, 3*segments+1);
  assert.equal(pcurve.multiplicities.length, pcurve.knots.length);
  assert.deepEqual(pcurve.multiplicities, [4, ...Array(segments-1).fill(3), 4]);
  assert.equal(pcurve.first, pcurve.knots[0]); assert.equal(pcurve.last, pcurve.knots.at(-1));
  near(pcurve.last-pcurve.first, 2*Math.PI);
  near(pcurve.totalBoundMm, pcurve.approximationBoundMm+pcurve.supportBoundMm+pcurve.numericGuardMm, 1e-19);
  assert.ok(pcurve.totalBoundMm <= 1e-8);
  const cy = cross(curve.normal, curve.x), sy = cross(surface.axis, surface.x);
  let maxDistanceMm = 0;
  for (let segment = 0; segment < segments; segment++) for (const fraction of [0, 0.25, 0.5, 0.75, 1]) {
    const basis = [(1-fraction)**3, 3*(1-fraction)**2*fraction, 3*(1-fraction)*fraction**2, fraction**3];
    const uv = [0, 1].map(component => basis.reduce((sum, weight, i) => sum+weight*pcurve.points[3*segment+i][component], 0));
    const t = pcurve.knots[segment]+fraction*(pcurve.knots[segment+1]-pcurve.knots[segment]);
    const expected = scaledSum(curve.origin, [curve.x, (curve.radius ?? curve.major)*Math.cos(t)], [cy, (curve.radius ?? curve.minor)*Math.sin(t)]);
    const actual = scaledSum(surface.origin, [surface.x, surface.radius*Math.cos(uv[0])], [sy, surface.radius*Math.sin(uv[0])], [surface.axis, uv[1]]);
    maxDistanceMm = Math.max(maxDistanceMm, Math.hypot(...actual.map((v, i) => v-expected[i])));
  }
  assert.ok(maxDistanceMm <= pcurve.totalBoundMm, `${maxDistanceMm} exceeds native bound ${pcurve.totalBoundMm}`);
  return { segments, maxDistanceMm, totalBoundMm: pcurve.totalBoundMm };
}

function verify(solid, name, volume, options) {
  const before = JSON.stringify(solid), body = decodeAnalytic(solid, name, kernel), entries = [];
  for (const edgeIndex of [0, 1]) {
    const pcurve = fullBandPCurve(native, solid, edgeIndex, 2, options);
    const check = inspect(pcurve, body.edges[edgeIndex].curve, body.faces[2].surface);
    entries.push({ edgeIndex, faceIndex: 2, pcurve, check });
  }
  assert.equal(JSON.stringify(solid), before);
  body.validation.volumeMm3 = volume;
  body.validation.scope = 'native analytic B-rep; PCurve test oracle volume';
  const model = { schema: 'wonky-brep/1', units: 'millimeter', backend: { language: 'Bend', version }, bodies: [body] };
  writeFileSync(new URL(`${name}.brep.json`, artifact), JSON.stringify(model, null, 2)+'\n');
  writeFileSync(new URL(`${name}.pcurves.json`, artifact), JSON.stringify(entries, null, 2)+'\n');
  evidence.push({ name, entries: entries.map(({ edgeIndex, check }) => ({ edgeIndex, ...check })) });
  return entries;
}

test('Bend PCurves preserve full circles and the actual pi start of an oblique ellipse', () => {
  const cylinder = source();
  const axial = verify(cut(cylinder, [0, 0, 2], [0, 0, 1]), 'focused-axial', 18*Math.PI);
  assert.ok(axial.every(entry => entry.check.segments === 1));
  const oblique = verify(cut(cylinder, [0, 0, 2], [0.2, 0, 1]), 'focused-oblique', 18*Math.PI);
  near(oblique[1].pcurve.first, Math.PI); near(oblique[1].pcurve.last, 3*Math.PI);
  near(oblique[1].pcurve.points[0][0], 0); near(oblique[1].pcurve.points.at(-1)[0], 2*Math.PI);
  assert.equal(oblique[1].check.segments, 128);
});

test('shared cylinder charts handle reversed winding, nonzero seam phase and changed curve sense', () => {
  const upper = verify(cut(source(), [0, 0, 2], [-0.2, 0, -1]), 'focused-upper', 18*Math.PI);
  near(upper[1].pcurve.points[0][0], 2*Math.PI); near(upper[1].pcurve.points.at(-1)[0], 0);
  const shifted = cut(source(), [0, 0, 2], [0.2, 0, 1]);
  array(shifted.faces)[2].surface.x = vector([0, 1, 0]);
  const phase = verify(shifted, 'focused-phase-shift', 18*Math.PI);
  for (const entry of phase) {
    near(entry.pcurve.points[0][0], 1.5*Math.PI); near(entry.pcurve.points.at(-1)[0], 3.5*Math.PI);
  }
  const reversed = cut(source(), [0, 0, 2], [0.2, 0, 1]);
  const edge = array(reversed.edges)[1];
  edge.curve.normal = kernel.precise.scale(edge.curve.normal, real(-1)); edge.same_sense = false;
  const sense = verify(reversed, 'focused-curve-sense', 18*Math.PI);
  near(sense[1].pcurve.points[0][0], 2*Math.PI); near(sense[1].pcurve.points.at(-1)[0], 0);
});

test('native PCurves retain bounds through repeated cuts and a rigid transformation', () => {
  const first = cut(source(), [0, 0, 3], [0.1, 0, 1]);
  const second = cut(first, [0, 0, 1], [0, 0.1, -1]);
  const output = verify(second, 'focused-two-ellipses', 18*Math.PI);
  near(output[1].pcurve.first, Math.PI/2);
  const rotation = { $: 'Rotation', x: vector([0.8, 0, -0.6]), y: vector([0, 1, 0]), z: vector([0.6, 0, 0.8]) };
  verify(kernel.analytic.transform(second, rotation, vector([17, -31, 59])), 'focused-transformed', 18*Math.PI);
});

test('PCurve budget drives native subdivision and refuses unresolved or oversized budgets', () => {
  const solid = cut(source(), [0, 0, 2], [0.2, 0, 1]), body = decodeAnalytic(solid, 'budget', kernel);
  const loose = fullBandPCurve(native, solid, 1, 2), fine = fullBandPCurve(native, solid, 1, 2, { budgetMm: 1e-9 });
  inspect(fine, body.edges[1].curve, body.faces[2].surface);
  assert.ok(fine.knots.length > loose.knots.length); assert.ok(fine.totalBoundMm <= 1e-9);
  for (const budgetMm of [0, -1e-8, 1e-7]) assert.deepEqual(fullBandPCurve(native, solid, 1, 2, { budgetMm }), { status: 'Unresolved', reason: 'InvalidInput' });
  assert.deepEqual(fullBandPCurve(native, solid, 1, 2, { budgetMm: 1e-14 }), { status: 'Unresolved', reason: 'ResolutionLimit' });
  assert.throws(() => fullBandPCurve(native, solid, -1, 2), /unsigned 32-bit/);
  assert.throws(() => fullBandPCurve(native, solid, 1, 2, { budgetMm: Infinity }), /finite/);
});

test('full-band adapter preserves explicit domains and rejects unsupported topology or incidence', () => {
  const solid = cut(source(), [0, 0, 2], [0.2, 0, 1]), body = decodeAnalytic(solid, 'serialization', kernel);
  const before = JSON.stringify(body);
  assert.deepEqual(fullBandPCurve(native, body, 1, 2), fullBandPCurve(native, solid, 1, 2));
  assert.equal(JSON.stringify(body), before);
  body.edges[1].curveRange = [Math.PI, 3*Math.PI];
  assert.deepEqual(fullBandPCurve(native, body, 1, 2), { status: 'Unresolved', reason: 'UnsupportedDomain' });
  assert.deepEqual(fullBandPCurve(native, body, 1, 2, { domains: list([{ $: 'AutoDomain' }, { $: 'AutoDomain' }, { $: 'AutoDomain' }]) }), { status: 'Unresolved', reason: 'UnsupportedDomain' });
  assert.deepEqual(fullBandPCurve(native, solid, 1, 2, { domains: list([{ $: 'GivenDomain', domain: { $: 'Untrimmed' } }]) }), { status: 'Unresolved', reason: 'UnsupportedDomain' });
  for (const [edgeIndex, faceIndex] of [[2, 2], [1, 0], [3, 2]]) assert.deepEqual(fullBandPCurve(native, solid, edgeIndex, faceIndex), { status: 'Unresolved', reason: 'UnsupportedEdge' });
  const missingWall = structuredClone(solid); missingWall.faces = list(array(missingWall.faces).slice(0, 2));
  assert.deepEqual(fullBandPCurve(native, missingWall, 1, 2), { status: 'Unresolved', reason: 'UnsupportedBand' });
  const badSeam = structuredClone(solid); array(badSeam.edges)[2].curve.direction = vector([1, 0, 1]);
  assert.deepEqual(fullBandPCurve(native, badSeam, 1, 2), { status: 'Unresolved', reason: 'InvalidBand' });
  assert.deepEqual(cylinderPCurve(native, body.edges[1].curve, body.faces[2].surface, body.vertices[1], [0, 3, 0]), { status: 'Unresolved', reason: 'IncidenceFailure' });
  assert.deepEqual(cylinderPCurve(native, body.edges[1].curve, body.faces[0].surface, body.vertices[1], body.vertices[0]), { status: 'Unresolved', reason: 'UnsupportedSurface' });
});

test.after(() => {
  const paths = ['kernel/step-pcurves.bend', 'src/step-pcurves.mjs', 'test/step-pcurves.test.mjs'];
  const hashes = Object.fromEntries(paths.map(path => [path, createHash('sha256').update(readFileSync(new URL(`../${path}`, import.meta.url))).digest('hex')]));
  writeFileSync(new URL('focused-evidence.json', artifact), JSON.stringify({ hashes, cases: evidence }, null, 2)+'\n');
});

}
