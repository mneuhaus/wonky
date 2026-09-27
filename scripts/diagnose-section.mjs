import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { loadKernel, array, extrudeInBend } from '../src/kernel.mjs';
import { importOnshapeBody, transformAnalytic } from '../src/analytic.mjs';
import { sectionSolid } from '../src/section.mjs';
import { number } from '../src/real.mjs';

const root = new URL('../', import.meta.url);
const read = file => readFileSync(new URL(file, root));
const hash = value => createHash('sha256').update(value).digest('hex');
const frozen = {
  'fixtures/r10b/r10b.fs': '219ee9630f37f9e54fe7e1b4e09094ab25748a811ed8f9e8b9ebf4892d8b8349',
  'fixtures/r10b/modules/base/ZtoDD.body.json': 'b78a8546970e360ee2a3a22661c87d4f9e835d24fe50cedeedde6a19add20dc9',
};
const implementations = ['bend.lock.json', 'scripts/diagnose-section.mjs', 'test/section.test.mjs', 'docs/section.md',
  ...['section', 'face-plane', 'face-bounds', 'face-classification', 'cylinder-classification', 'solid-classification',
    'edge-plane', 'curve-plane', 'intersections', 'ray', 'analytic', 'real', 'precise', 'topology',
    'geometry', 'identity', 'halfspace', 'boundary'].map(name => `kernel/${name}.bend`),
  ...['section', 'bend-loader', 'kernel', 'face-plane', 'face-classification', 'intersections', 'analytic',
    'real', 'identity', 'brep', 'errors'].map(name => `src/${name}.mjs`),
];
const implementation = () => Object.fromEntries(implementations.sort().map(file => [file, hash(read(file))]));
for (const [file, expected] of Object.entries(frozen)) assert.equal(hash(read(file)), expected, file);
const before = implementation(), k = await loadKernel();
const reconstruction = {
  rows: [[1, 0, 0], [0, 0.9063077870366499, -0.42261826174069944], [0, 0.42261826174069944, 0.9063077870366499]],
  offset: [0, 85.7915071334, -183.980480768],
  boxPoints: [[-119, 4], [-92.79, 4], [-92.79, 46], [-119, 46]],
  boxPlane: { origin: [0, 0, -61], normal: [0, 0, 1], x: [1, 0, 0] }, boxDelta: [0, 0, 129],
};
const body = transformAnalytic(k, importOnshapeBody(k,
  JSON.parse(read('fixtures/r10b/modules/base/ZtoDD.body.json')).bodies[0], 'section-P10',
  { source: 'frozen complete section diagnostic', sha256: frozen['fixtures/r10b/modules/base/ZtoDD.body.json'] }),
  'section-g0', reconstruction.rows, reconstruction.offset);
const box = extrudeInBend(k, 'section-box', reconstruction.boxPoints, reconstruction.boxPlane, reconstruction.boxDelta);
assert.equal(box.faces[3].surface.origin[0], -92.79000091552734);
assert.equal(box.faces[1].surface.origin[2], 68);
assert.deepEqual([body.vertices.length, body.edges.length, body.faces.length], [348, 529, 189]);
const tolerance = { linear: 1e-7, angular: 1e-10 }, planes = [];
for (const [index, face] of box.faces.entries()) {
  const result = await sectionSolid(body, face.surface, tolerance), faceCounts = {};
  assert.equal(array(result.faces).length, 189);
  for (const record of array(result.faces)) {
    const f = record.result;
    const key = f.$ + ':' + (f.relation?.$ ?? f.reason?.$) + (f.reason?.reason?.$ ? ':' + f.reason.reason.$ : '');
    faceCounts[key] = (faceCounts[key] ?? 0) + 1;
  }
  const summary = { status: result.$, reason: result.reason, faceCounts };
  if (result.$ === 'Resolved') {
    const pieces = array(result.pieces), roots = array(result.roots), contours = array(result.contours), edges = array(result.edges);
    summary.sections = pieces.length;
    summary.contours = contours.length;
    summary.contourLengths = contours.map(r => array(r.uses).length);
    summary.sourceRoots = roots.filter(r => r.$ === 'SourceRoot').length;
    summary.syntheticSeams = roots.filter(r => r.$ === 'SyntheticSeam').length;
    const associations = pieces.flatMap(p => [p.first, p.last]).filter(r => r.association.$ === 'BoundaryAssociation').map(r => r.association);
    summary.maximumSupportEndpointGapMm = Math.max(0, ...associations.map(a => number(a.checked.gap)));
    summary.maximumOrientationError = Math.max(0, ...pieces.map(p => number(p.orientation.parallel_error)));
    const used = [];
    for (const ring of contours) {
      const uses = array(ring.uses);
      for (const [i, use] of uses.entries()) {
        const e = edges[use.edge], next = uses[(i + 1) % uses.length], n = edges[next.edge];
        assert.equal(use.forward ? e.end : e.start, next.forward ? n.start : n.end);
        used.push(use.edge);
      }
    }
    assert.equal(used.length, pieces.length); assert.equal(new Set(used).size, pieces.length);
    for (const piece of pieces) for (const ref of [piece.first, piece.last]) if (ref.association.$ === 'BoundaryAssociation') {
      assert.equal(roots[ref.root].edge, ref.association.original.edge);
      assert.deepEqual(roots[ref.root].hit, ref.association.original.hit);
      assert.deepEqual(roots[ref.root].source, ref.association.original.source);
      assert.ok(number(ref.association.checked.gap) <= number(ref.association.margin));
    }
    if ([1, 3].includes(index)) {
      assert.equal(pieces.length, 12); assert.equal(roots.length, 12);
      assert.deepEqual(summary.contourLengths.toSorted((a, b) => a - b), index === 3 ? [4, 8] : [12]);
    } else assert.equal(pieces.length, 0);
  } else {
    assert.equal(index, 2); assert.equal(result.reason.$, 'FaceUnresolved');
    for (const key of ['pieces', 'edges', 'roots', 'contours']) assert.equal(result[key], undefined);
    assert.equal(array(result.faces).filter(f => f.result.$ === 'Unresolved').length, 16);
  }
  planes.push({ index, plane: face.surface, summary, result });
}
assert.deepEqual(implementation(), before, 'Relevant implementation changed during the diagnostic');
for (const [file, expected] of Object.entries(frozen)) assert.equal(hash(read(file)), expected, file);
const report = { schema: 'wonky-solid-plane-section-diagnostic/1', createdAt: new Date().toISOString(),
  scope: 'Complete directed P10 contours on the six unbounded box planes. No cap nesting, trimming to box faces, face splitting, or Boolean result.',
  inputs: frozen, reconstruction, tolerance,
  implementation: { stable: true, sha256: hash(JSON.stringify(before)), files: before }, planes };
const output = new URL('out/section/diagnostic.json', root);
mkdirSync(new URL('out/section/', root), { recursive: true });
writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ path: fileURLToPath(output), implementationStable: true,
  planes: planes.map(({ index, summary }) => ({ index, ...summary })) }, null, 2));
