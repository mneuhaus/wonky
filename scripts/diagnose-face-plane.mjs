import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { loadKernel, array, extrudeInBend } from '../src/kernel.mjs';
import { importOnshapeBody, transformAnalytic } from '../src/analytic.mjs';
import { classificationInput, loadFaceClassifier } from '../src/face-classification.mjs';
import { loadFacePlane } from '../src/face-plane.mjs';
import { intersectionTolerance } from '../src/intersections.mjs';
import { vector } from '../src/real.mjs';

const root = new URL('../', import.meta.url);
const read = file => readFileSync(new URL(file, root));
const hash = value => createHash('sha256').update(value).digest('hex');
const frozen = {
  'fixtures/r10b/r10b.fs': '219ee9630f37f9e54fe7e1b4e09094ab25748a811ed8f9e8b9ebf4892d8b8349',
  'fixtures/r10b/modules/base/ZtoDD.body.json': 'b78a8546970e360ee2a3a22661c87d4f9e835d24fe50cedeedde6a19add20dc9',
};
const implementations = ['bend.lock.json', 'scripts/diagnose-face-plane.mjs',
  ...['face-plane', 'face-bounds', 'face-classification', 'cylinder-classification', 'solid-classification',
    'edge-plane', 'curve-plane', 'intersections', 'ray', 'analytic', 'real', 'precise', 'topology',
    'geometry', 'identity', 'halfspace', 'boundary'].map(name => `kernel/${name}.bend`),
  ...['bend-loader', 'kernel', 'face-plane', 'face-classification', 'intersections', 'analytic',
    'real', 'identity', 'brep', 'errors'].map(name => `src/${name}.mjs`),
];
const implementation = () => Object.fromEntries(implementations.sort().map(file => [file, hash(read(file))]));
for (const [file, expected] of Object.entries(frozen)) assert.equal(hash(read(file)), expected, file);
const before = implementation();
const k = await loadKernel(), F = await loadFaceClassifier(), P = await loadFacePlane();
const reconstruction = {
  rows: [[1, 0, 0], [0, 0.9063077870366499, -0.42261826174069944], [0, 0.42261826174069944, 0.9063077870366499]],
  offset: [0, 85.7915071334, -183.980480768],
  boxPoints: [[-119, 4], [-92.79, 4], [-92.79, 46], [-119, 46]],
  boxPlane: { origin: [0, 0, -61], normal: [0, 0, 1], x: [1, 0, 0] }, boxDelta: [0, 0, 129],
};
const body = transformAnalytic(k, importOnshapeBody(k,
  JSON.parse(read('fixtures/r10b/modules/base/ZtoDD.body.json')).bodies[0], 'face-sections-P10',
  { source: 'frozen face-section diagnostic', sha256: frozen['fixtures/r10b/modules/base/ZtoDD.body.json'] }),
  'face-sections-g0', reconstruction.rows, reconstruction.offset);
const box = extrudeInBend(k, 'face-sections-box', reconstruction.boxPoints, reconstruction.boxPlane, reconstruction.boxDelta);
assert.equal(box.faces[3].surface.origin[0], -92.79000091552734);
assert.deepEqual([body.vertices.length, body.edges.length, body.faces.length], [348, 529, 189]);
const native = classificationInput(body, F), planes = [];
const tolerance = { linear: 1e-7, angular: 1e-10 }, nativeTolerance = intersectionTolerance(tolerance);
for (const [index, face] of box.faces.entries()) {
  const counts = {}, results = [], endpointDegrees = new Map();
  let sections = 0;
  for (let f = 0; f < body.faces.length; f++) {
    const result = P.intersect(native.solid, f, native.domains, vector(face.surface.origin),
      vector(face.surface.normal), nativeTolerance, native.sourceBudget);
    const key = result.$ + ':' + (result.relation?.$ ?? result.reason?.$) +
      (result.reason?.reason?.$ ? ':' + result.reason.reason.$ : '');
    counts[key] = (counts[key] ?? 0) + 1;
    if (result.$ === 'Resolved') for (const section of array(result.sections)) {
      sections++;
      // Diagnostic identity counts only. These are not stitched wires or
      // permission to merge points; the complete native records are retained.
      for (const endpoint of [section.first, section.last]) if (endpoint.$ === 'Boundary') {
        const key = JSON.stringify([endpoint.event.edge, endpoint.event.hit.parameter]);
        const users = endpointDegrees.get(key) ?? [];
        users.push(f); endpointDegrees.set(key, users);
      }
    }
    if (result.$ !== 'Resolved' || result.relation.$ !== 'Empty') results.push({ face: f, result });
  }
  const sharedEdgeRootDegrees = {};
  for (const users of endpointDegrees.values()) sharedEdgeRootDegrees[users.length] = (sharedEdgeRootDegrees[users.length] ?? 0) + 1;
  planes.push({ index, plane: face.surface, counts, sections, sharedEdgeRootDegrees, results });
}
assert.deepEqual(implementation(), before, 'Relevant implementation changed during the diagnostic');
for (const [file, expected] of Object.entries(frozen)) assert.equal(hash(read(file)), expected, file);
const report = { schema: 'wonky-face-plane-diagnostic/1', createdAt: new Date().toISOString(),
  scope: 'Finite P10 face sections on the six unbounded box planes. Not trimmed to box faces, not assembled wires, no Boolean geometry.',
  inputs: frozen, reconstruction, tolerance,
  implementation: { stable: true, sha256: hash(JSON.stringify(before)), files: before }, planes };
const output = new URL('out/face-plane/diagnostic.json', root);
mkdirSync(new URL('out/face-plane/', root), { recursive: true });
writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ path: fileURLToPath(output), implementationStable: true,
  planes: planes.map(({ index, counts, sections, sharedEdgeRootDegrees }) => ({ index, counts, sections, sharedEdgeRootDegrees })) }, null, 2));
