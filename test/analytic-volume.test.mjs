import test from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missingBend() || missing("fixtures/r10b/modules.json", "fixtures/r10b/r10b.fs");
if (publicTreeSkip) {
  test("analytic-volume.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { readFileSync, readdirSync } = await import("node:fs");
const { fileURLToPath } = await import("node:url");
const { build } = await import("../src/index.mjs");
const { loadKernel, array } = await import("../src/kernel.mjs");
const { circularFrustumInBend, importOnshapeBody, sweepInBend } = await import("../src/analytic.mjs");
const { integrateVolume, volumeInput } = await import("../src/volume.mjs");
const { printMesh } = await import("../src/print-mesh.mjs");
const { number, vector } = await import("../src/real.mjs");
const { UnsupportedFeatureError } = await import("../src/errors.mjs");
const { decodeHybrid } = await import("../scripts/bakeoff/jobfmt.mjs");
const { decodeRecover, toBodies } = await import("../scripts/bakeoff/recover-brep.mjs");
// Integrated volume with a stated bound (kernel/volume.bend, src/volume.mjs):
// closed forms, the kernel's own exact volumes, imported Onshape bodies,
// recovered hybrid B-reps and evVolume.














const kernel = await loadKernel();
const within = (value, expected, relative, what) =>
  assert.ok(Math.abs(value - expected) <= relative * Math.abs(expected), `${what}: ${value} vs ${expected} (relative ${Math.abs(value - expected) / Math.abs(expected)})`);
const T = Math.PI;
const O = [1, 2, 3], A = [0, 0, 1], X = [1, 0, 0];

const header = 'FeatureScript 3044; import(path:"onshape/std/geometry.fs",version:"3044.0");';
const feature = body => `${header} export function main(context is Context,id is Id,definition is map){${body}}`;
const circle = (name, z, r, x = 0, y = 0) => `var ${name}=newSketchOnPlane(context,id+"${name}",{"sketchPlane":plane(vector(0,0,${z})*millimeter,vector(0,0,1),vector(1,0,0))});` +
  `skCircle(${name},"c",{"center":vector(${x},${y})*millimeter,"radius":${r}*millimeter});skSolve(${name});`;
const extrude = (name, depth) => `opExtrude(context,id+"${name}ex",{"entities":qSketchRegion(id+"${name}"),"direction":vector(0,0,1),"endBound":BoundingType.BLIND,"endDepth":${depth}*millimeter});`;
const cuboid = (name, a, b) => `fCuboid(context,id+"${name}ex",{"corner1":vector(${a})*millimeter,"corner2":vector(${b})*millimeter});`;
const created = name => `qCreatedBy(id+"${name}ex",EntityType.BODY)`;

test('closed forms: cone frustum, sphere pocket, sphere sectors, tori and a partial ring within 1e-9', () => {
  const cases = [
    ['cone frustum', circularFrustumInBend(kernel, 'k', { plane: { origin: [0, 0, 0], normal: [0, 0, 1], x: [1, 0, 0] }, center: [1, 2], radius: 3 },
      { plane: { origin: [0, 0, 5], normal: [0, 0, 1], x: [1, 0, 0] }, center: [1, 2], radius: 1.5 }, null), T * 5 * (9 + 4.5 + 2.25) / 3],
    ['cylinder with a hemispherical pocket', sweepInBend(kernel, 'p', [[0, 0], [5, 0], [5, 6], { at: [3, 6], arc: { center: [0, 6], ccw: false } }, [0, 3]], O, A, X, 1e-9),
      T * 25 * 6 - 2 / 3 * T * 27],
    ['hemisphere', sweepInBend(kernel, 'h', [[0, 0], { at: [2, 0], arc: { center: [0, 0], ccw: true } }, [0, 2]], O, A, X, 1e-9), 2 / 3 * T * 8],
    ['sphere sector 135 deg', sweepInBend(kernel, 's', [{ at: [0, -2], arc: { center: [0, 0], ccw: true } }, [0, 2]], O, A, X, 1e-9, 0.75 * T), 4 / 3 * T * 8 * 0.375],
    ['torus', sweepInBend(kernel, 't', [{ at: [10, 0], arc: { center: [7, 0], ccw: true } }], O, A, X, 1e-9), 2 * T * T * 7 * 9],
    ['torus sector 60 deg', sweepInBend(kernel, 't6', [{ at: [10, 0], arc: { center: [7, 0], ccw: true } }], O, [0.6, 0, 0.8], [0, 1, 0], 1e-9, T / 3), 2 * T * T * 7 * 9 / 6],
    ['cone to its apex', sweepInBend(kernel, 'c', [[0, 0], [4, 0], [0, 3]], O, A, X, 1e-9), T * 16],
  ];
  for (const [name, body, closed] of cases) {
    const measured = integrateVolume(kernel, body);
    within(measured.volumeMm3, closed, 1e-9, name);
    assert.ok(measured.boundMm3 > 0 && measured.relativeBound < 1e-9, `${name}: bound ${measured.boundMm3}`);
    // Closed form unless a sphere or torus face is only part of its carrier.
    const partial = ['cylinder with a hemispherical pocket', 'hemisphere', 'sphere sector 135 deg', 'torus sector 60 deg'].includes(name);
    assert.equal(measured.label, partial ? 'quadrature' : 'exact', name);
  }
});

test('a box with two through holes within 1e-9 of its closed form and of the kernel', async () => {
  const model = await build(feature(cuboid('box', '0,0,0', '40,30,10') + circle('h1', -1, 4, 10, 15) + extrude('h1', 12) + circle('h2', -1, 2.5, 30, 10) + extrude('h2', 12) +
    `opBoolean(context,id+"cut1",{"targets":${created('box')},"tools":${created('h1')},"operationType":BooleanOperationType.SUBTRACTION});` +
    `opBoolean(context,id+"cut2",{"targets":${created('box')},"tools":${created('h2')},"operationType":BooleanOperationType.SUBTRACTION});`));
  assert.equal(model.bodies.length, 1);
  const body = model.bodies[0], measured = integrateVolume(kernel, body);
  within(measured.volumeMm3, 12000 - T * (16 + 6.25) * 10, 1e-9, 'box with holes');
  within(measured.volumeMm3, body.validation.volumeMm3, 1e-9, 'box with holes, kernel');
  assert.equal(measured.label, 'exact');
});

test('every kernel primitive with an exact volume integrates to it within 1e-9', async () => {
  const sources = {
    cuboid: cuboid('a', '0,0,0', '10,20,30'),
    cylinder: circle('a', 2, 5, 1, -2) + extrude('a', 8),
    loft: circle('a', 0, 5) + circle('b', 8, 2) + 'opLoft(context,id+"loft",{"profileSubqueries":[qSketchRegion(id+"a"),qSketchRegion(id+"b")]});',
    polyline: 'var p=newSketchOnPlane(context,id+"p",{"sketchPlane":plane(vector(0,0,0)*millimeter,vector(0,0,1),vector(1,0,0))});' +
      'skPolyline(p,"l",{"points":[vector(0,0)*millimeter,vector(12,0)*millimeter,vector(9,7)*millimeter,vector(2,5)*millimeter,vector(0,0)*millimeter]});skSolve(p);' + extrude('p', 4),
    arcs: 'var s=newSketchOnPlane(context,id+"s",{"sketchPlane":plane(vector(0,0,0)*millimeter,vector(0,0,1),vector(1,0,0))});' +
      'skLineSegment(s,"l1",{"start":vector(-6,0)*millimeter,"end":vector(6,0)*millimeter});' +
      'skArc(s,"a1",{"start":vector(6,0)*millimeter,"mid":vector(0,6)*millimeter,"end":vector(-6,0)*millimeter});skSolve(s);' + extrude('s', 3),
    union: cuboid('a', '0,0,0', '10,10,10') + cuboid('b', '5,5,5', '15,15,15') + `opBoolean(context,id+"u",{"tools":qUnion([${created('a')},${created('b')}]),"operationType":BooleanOperationType.UNION});`,
    coaxial: circle('a', 0, 5) + extrude('a', 10) + circle('b', 4, 3) + extrude('b', 10) + `opBoolean(context,id+"u",{"tools":qUnion([${created('a')},${created('b')}]),"operationType":BooleanOperationType.UNION});`,
    counterbore: circle('a', 0, 5) + extrude('a', 10) + circle('b', 4, 3) + extrude('b', 10) + `opBoolean(context,id+"u",{"targets":${created('a')},"tools":${created('b')},"operationType":BooleanOperationType.SUBTRACTION});`,
    intersection: cuboid('a', '-3,-3,0', '3,3,10') + circle('b', -1, 2, 0.5, 0) + extrude('b', 6) + `opBoolean(context,id+"u",{"tools":qUnion([${created('a')},${created('b')}]),"operationType":BooleanOperationType.INTERSECTION});`,
  };
  let count = 0;
  for (const [name, source] of Object.entries(sources)) {
    const model = await build(feature(source));
    for (const body of model.bodies) {
      assert.notEqual(body.validation.volumeMm3, null, name);
      within(integrateVolume(kernel, body).volumeMm3, body.validation.volumeMm3, 1e-9, name);
      count++;
    }
  }
  const sweeps = [
    [[[5, 0], [8, 0], { at: [8, 2], arc: { center: [7, 2], ccw: true } }, [7, 3], { at: [6, 3], arc: { center: [6, 4], ccw: false } }, [5, 4]], null],
    [[[5, 0], [8, 0], { at: [8, 2], arc: { center: [7, 2], ccw: true } }, [7, 3], { at: [6, 3], arc: { center: [6, 4], ccw: false } }, [5, 4]], 200 / 180 * T],
    [[[0, 0], [4, 0], [2, 3], [0, 3]], 0.75 * T],
    [[[0, -1], { at: [3, -1], arc: { center: [3, 0], ccw: true } }, [3, 1], [0, 1]], null],
  ];
  for (const [profile, angle] of sweeps) {
    const body = sweepInBend(kernel, 'sweep', profile, O, [0.6, 0, 0.8], [0, 1, 0], 1e-9, angle);
    within(integrateVolume(kernel, body).volumeMm3, body.validation.volumeMm3, 1e-9, `sweep ${JSON.stringify(profile)} ${angle}`);
    count++;
  }
  assert.ok(count >= 13);
});

const modules = fileURLToPath(new URL('../fixtures/r10b/modules/', import.meta.url));
const fixtureBodies = () => readdirSync(modules).filter(dir => !dir.startsWith('.')).flatMap(dir =>
  readdirSync(`${modules}${dir}`).filter(file => file.endsWith('.body.json')).map(file => ({ dir, file, raw: JSON.parse(readFileSync(`${modules}${dir}/${file}`, 'utf8')).bodies[0] })));

test('imported Onshape bodies: closed form, planar vector areas equal Onshape face areas, X06 against a fine mesh', () => {
  let bodies = 0, planes = 0, exact = 0;
  for (const { dir, file, raw } of fixtureBodies()) {
    const body = importOnshapeBody(kernel, raw, file, {});
    const measured = integrateVolume(kernel, body);
    assert.equal(measured.label, 'exact', file);
    assert.ok(measured.volumeMm3 > 0 && measured.relativeBound < 1e-10, file);
    // The loop integral E = int p x dp of a planar face is twice its vector
    // area: Onshape's own face areas check the boundary integration.
    const faces = array(volumeInput(body));
    body.faces.forEach((face, f) => {
      if (face.surface.type !== 'plane' || f >= raw.faces.length) return;
      const loops = kernel.volume.face_loops(faces[f].loops);
      const e = kernel.volume.sum_e_loops(loops, vector([0, 0, 0]), vector([0, 0, 0]));
      const area = Math.hypot(number(e.x), number(e.y), number(e.z)) / 2, onshape = raw.faces[f].area * 1e6;
      // Onshape keeps tolerant topology (vertices up to 0.01 mm off their
      // edges); wonky's loops run through the vertices, so a face with such a
      // vertex may differ by its perimeter times that tolerance, and a face
      // without one must agree to 1e-9 (1e-9 mm^2 for sub-mm^2 faces, whose
      // coordinates are some 100 mm from the origin).
      const tolerance = body.referenceMeasurements.faceTolerancesMm[f];
      if (tolerance === 0.0003) { assert.ok(Math.abs(area - onshape) <= 1e-9 * Math.max(onshape, 1), `${dir}/${file} face ${f} area ${area} vs ${onshape}`); exact++; }
      else assert.ok(Math.abs(area - onshape) <= body.referenceMeasurements.facePerimetersMm[f] * tolerance, `${dir}/${file} face ${f} area ${area} vs ${onshape}`);
      planes++;
    });
    bodies++;
    if (file === 'Zu2DD.body.json') {
      // X06 (T06 R6d rear hopper wall, the R20 probe's context part).
      within(measured.volumeMm3, 51873.616, 1e-8, 'X06');
      const triangles = printMesh(kernel, body, 0.001).triangles;
      const mesh = triangles.reduce((sum, [a, b, c]) => sum + (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6, 0);
      const area = raw.faces.reduce((sum, face) => sum + face.area * 1e6, 0);
      assert.ok(Math.abs(mesh - measured.volumeMm3) <= area * 0.001, `X06 mesh ${mesh}`);
    }
  }
  assert.equal(bodies, 16);
  assert.ok(planes > 900 && exact > 200, `${exact} of ${planes} planar faces compared at 1e-9`);
});

test('recovered hybrid B-reps match the bake-off reference volumes (void, cone, holes)', () => {
  const reference = JSON.parse(readFileSync(new URL('../fixtures/bakeoff/reference.json', import.meta.url), 'utf8')).cases;
  for (const name of ['internal-void', 'plate-blind-hole', 'plate-countersink']) {
    const answer = decodeHybrid(kernel.hybrid.boolean(readFileSync(new URL(`../fixtures/bakeoff/jobs/${name}.job`, import.meta.url), 'utf8')));
    assert.equal(answer.status, 'exact', name);
    const bodies = toBodies(decodeRecover(answer.okText).raw, name);
    const volume = bodies.reduce((sum, body) => sum + integrateVolume(kernel, body).volumeMm3, 0);
    within(volume, reference[name].occt.volume, 1e-9, name);
  }
});

test('evVolume integrates imported bodies and states the bound in the operation evidence', async () => {
  const source = readFileSync(new URL('../fixtures/r10b/r10b.fs', import.meta.url), 'utf8') + `
export const volumeProbe=defineFeature(function(context is Context,id is Id,definition is map) precondition {} {
  buildRetainedContext(context,id,definition);
  for (var body in evaluateQuery(context, qAllModifiableSolidBodies())) {
    if (evVolume(context, { "entities" : body }) <= 0 * millimeter ^ 3) throw regenError("volume");
  }
});`;
  const model = await build(source, { feature: 'volumeProbe', moduleManifest: fileURLToPath(new URL('../fixtures/r10b/modules.json', import.meta.url)) });
  const evidence = model.operationEvidence.filter(entry => entry.operation === 'evVolume');
  assert.equal(evidence.length, 5);
  for (const entry of evidence) {
    assert.equal(entry.volumes.length, 1);
    const [volume] = entry.volumes;
    const body = model.bodies.find(b => b.id === volume.bodyId);
    assert.ok(body, volume.bodyId);
    assert.equal(body.validation.volumeMm3, null);
    assert.equal(volume.label, 'exact');
    assert.ok(volume.boundMm3 > 0 && volume.boundMm3 < 1e-6 * volume.volumeMm3);
    assert.match(entry.operationId, /^evVolume@\d+:\d+$/);
  }
  const t06 = model.bodies.find(b => b.name.startsWith('T06'));
  within(evidence.find(entry => entry.volumes[0].bodyId === t06.id).volumes[0].volumeMm3, 51873.616, 1e-8, 'T06');
});

test('volume integration refuses by name', () => {
  const torus = sweepInBend(kernel, 't', [{ at: [10, 0], arc: { center: [7, 0], ccw: true } }], O, A, X, 1e-9);
  const spindle = structuredClone(torus);
  for (const face of spindle.faces) if (face.surface.type === 'torus') face.surface.minor = 8;
  assert.throws(() => integrateVolume(kernel, spindle), error => error instanceof UnsupportedFeatureError && /spindle or horn torus/.test(error.message));
  const odd = structuredClone(torus);
  odd.faces[0].surface = { type: 'nurbs' };
  assert.throws(() => integrateVolume(kernel, odd), error => error instanceof UnsupportedFeatureError && /'nurbs' face is not implemented/.test(error.message));
  assert.throws(() => integrateVolume({}, torus), error => error instanceof UnsupportedFeatureError && /not loaded in this kernel backend/.test(error.message));
});

}
