import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { loadKernel, array, extrudeInBend } from '../src/kernel.mjs';
import { coords, number, vector } from '../src/real.mjs';
import { importOnshapeBody, transformAnalytic } from '../src/analytic.mjs';
import { geometryRevision } from '../src/identity.mjs';
import { loadFaceClassifier, classificationInput } from '../src/face-classification.mjs';
import { loadEdgePlane } from '../src/edge-plane.mjs';
import { intersectionTolerance } from '../src/intersections.mjs';
import { loadJunction, associateJunction, endpointJunctionProposal } from '../src/junction.mjs';

// Diagnostic only: the previous artifact selects pairs, never geometry. Both
// endpoint proposals, their parameters, projections and decisions run in Bend.
const root = new URL('../', import.meta.url);
const read = path => readFileSync(new URL(path, root));
const hash = value => createHash('sha256').update(value).digest('hex');
const frozen = {
  'fixtures/r10b/r10b.fs': '219ee9630f37f9e54fe7e1b4e09094ab25748a811ed8f9e8b9ebf4892d8b8349',
  'fixtures/r10b/modules/base/ZtoDD.body.json': 'b78a8546970e360ee2a3a22661c87d4f9e835d24fe50cedeedde6a19add20dc9',
};
for (const [path, expected] of Object.entries(frozen)) assert.equal(hash(read(path)), expected, path);
const implementationPaths = [
  'bend.lock.json', 'kernel/junction.bend', 'kernel/edge-plane.bend', 'kernel/curve-plane.bend',
  'kernel/face-classification.bend', 'kernel/intersections.bend', 'kernel/real.bend', 'kernel/precise.bend',
  'kernel/analytic.bend', 'kernel/topology.bend', 'kernel/geometry.bend', 'kernel/identity.bend',
  'src/junction.mjs', 'src/edge-plane.mjs', 'src/curve-plane.mjs', 'src/face-classification.mjs',
  'src/intersections.mjs', 'src/real.mjs', 'src/kernel.mjs', 'src/analytic.mjs', 'src/identity.mjs',
  'scripts/diagnose-junction.mjs',
];
const implementation = () => Object.fromEntries(implementationPaths.sort().map(path => [path, hash(read(path))]));
const before = implementation();
const basisPath = 'out/edge-plane/diagnostic.json', basisBytes = read(basisPath), basis = JSON.parse(basisBytes);
const k = await loadKernel(), E = await loadEdgePlane(), F = await loadFaceClassifier(), J = await loadJunction();
const imported = importOnshapeBody(k, JSON.parse(read('fixtures/r10b/modules/base/ZtoDD.body.json')).bodies[0],
  'junction-P10', { source: 'frozen junction diagnostic', sha256: frozen['fixtures/r10b/modules/base/ZtoDD.body.json'] });
const reconstruction = {
  rows: [[1, 0, 0], [0, 0.9063077870366499, -0.42261826174069944], [0, 0.42261826174069944, 0.9063077870366499]],
  offset: [0, 85.7915071334, -183.980480768],
  boxPoints: [[-119, 4], [-92.79, 4], [-92.79, 46], [-119, 46]],
  boxPlane: { origin: [0, 0, -61], normal: [0, 0, 1], x: [1, 0, 0] }, boxDelta: [0, 0, 129],
};
const p10 = transformAnalytic(k, imported, 'junction-g0', reconstruction.rows, reconstruction.offset);
const box = extrudeInBend(k, 'junction-box', reconstruction.boxPoints, reconstruction.boxPlane, reconstruction.boxDelta);
assert.equal(box.faces[3].surface.origin[0], -92.79000091552734);
const bodies = [p10, box], inputs = bodies.map(body => classificationInput(body, F));
const preparedInputs = inputs.map(input => ({ ...input, edges: array(input.solid.edges), domainArray: array(input.domains) }));
const tolerance = { linear: 1e-7, angular: 1e-10 }, nativeTolerance = intersectionTolerance(tolerance);
const policy = { contactTolerance: 1e-7 };
const counts = { originalUnresolved: 0, endpointCases: 0, intervalCases: 0, proposals: 0,
  associated: 0, separated: 0, unresolved: 0, rejected: 0, toleratedConnections: 0, exactRepresentedPoints: 0,
  anchorPlaneCertified: 0, anchorPlaneNotCertified: 0, samplePlaneCertified: 0, samplePlaneNotCertified: 0 };
const maxima = { diameterMm: 0, gapResolutionMm: 0, constructionResolutionMm: 0,
  projectionReferenceErrorMm: 0, gapReferenceErrorMm: 0 };
const directions = [];
for (const [name, sourceBody, targetBody] of [
  ['p10EdgesAgainstBoxPlanes', 0, 1], ['boxEdgesAgainstP10Planes', 1, 0],
]) {
  const rows = [], input = preparedInputs[sourceBody];
  for (const previous of basis[name].unresolved) {
    const surface = bodies[targetBody].faces[previous.face].surface;
    const origin = vector(surface.origin), normal = vector(surface.normal);
    const result = E.intersect(input.solid, previous.edge, input.domains, origin, normal, nativeTolerance, input.sourceBudget);
    assert.equal(result.$, 'Unresolved'); assert.deepEqual(result.reason, previous.reason);
    const preparation = E.prepare_edge({ $: 'Some', value: input.edges[previous.edge] }, previous.edge,
      input.solid.vertices, input.domainArray[previous.edge] ?? { $: 'AutoDomain' }, origin, nativeTolerance, input.sourceBudget);
    assert.equal(preparation.$, 'Prepared');
    assert.deepEqual(coords(preparation.source.start), previous.source.start);
    assert.deepEqual(coords(preparation.source.end), previous.source.end);
    counts.originalUnresolved++;
    const intervalCase = result.reason.$ === 'CurveUnresolved';
    counts[intervalCase ? 'intervalCases' : 'endpointCases']++;
    const attempts = [];
    for (const atStart of [true, false]) {
      const proposed = await endpointJunctionProposal(preparation.source, sourceBody,
        { body: targetBody, face: previous.face, plane: surface }, { atStart, sampleId: 1, projectionId: 2 });
      const specs = array(proposed.specs), association = await associateJunction(proposed.anchor, specs, policy);
      counts.proposals++; counts[association.$.toLowerCase()]++;
      const summary = { endpoint: atStart ? 'start' : 'end', vertex: proposed.anchor.vertex,
        nativeParameter: number(specs[0].parameter), status: association.$ };
      if (association.$ === 'Associated') {
        const junction = association.junction, events = array(junction.events), gaps = array(junction.gaps), foot = events[1];
        counts[junction.mode.$ === 'ToleratedConnection' ? 'toleratedConnections' : 'exactRepresentedPoints']++;
        const seedCertificate = foot.witness.seed_incidence.certificate.$;
        counts[seedCertificate === 'ExactZero' ? 'anchorPlaneCertified' : 'anchorPlaneNotCertified']++;
        const planeRef = specs[1].reference;
        const sampleIncidence = J.plane_incidence(planeRef, events[0].point);
        counts[sampleIncidence.certificate.$ === 'ExactZero' ? 'samplePlaneCertified' : 'samplePlaneNotCertified']++;
        summary.mode = junction.mode.$; summary.diameterMm = number(junction.diameter);
        summary.anchorSignedDistanceMm = number(foot.witness.seed_incidence.signed_distance);
        summary.anchorPlaneCertificate = seedCertificate;
        summary.samplePlaneIncidence = sampleIncidence;
        summary.projectionDisplacementMm = number(foot.witness.displacement);
        summary.gapsMm = gaps.map(gap => number(gap.distance));
        maxima.diameterMm = Math.max(maxima.diameterMm, summary.diameterMm);
        maxima.gapResolutionMm = Math.max(maxima.gapResolutionMm, ...gaps.map(gap => number(gap.resolution)));
        maxima.constructionResolutionMm = Math.max(maxima.constructionResolutionMm, ...events.map(event => number(event.resolution)));
        // Independent diagnostic reference only; never used for construction,
        // endpoint choice, association, certificates or any production decision.
        const point = coords(junction.anchor.point), normalLength = Math.hypot(...surface.normal);
        const unit = surface.normal.map(value => value / normalLength);
        const signed = point.reduce((sum, value, axis) => sum + (value - surface.origin[axis]) * unit[axis], 0);
        const expectedProjection = point.map((value, axis) => value - signed * unit[axis]);
        maxima.projectionReferenceErrorMm = Math.max(maxima.projectionReferenceErrorMm,
          Math.hypot(...coords(foot.point).map((value, axis) => value - expectedProjection[axis])));
        const points = new Map([[`anchor:${sourceBody}:${junction.anchor.vertex}`, point], ...events.map(event => [`event:${event.key}`, coords(event.point)])]);
        const key = value => value.$ === 'AnchorKey' ? `anchor:${value.body}:${value.vertex}` : `event:${value.key}`;
        for (const gap of gaps) {
          const first = points.get(key(gap.first)), last = points.get(key(gap.last));
          const reference = Math.hypot(...first.map((value, axis) => last[axis] - value));
          maxima.gapReferenceErrorMm = Math.max(maxima.gapReferenceErrorMm, Math.abs(reference - number(gap.distance)));
        }
      }
      attempts.push({ summary, proposal: proposed, association });
    }
    rows.push({ edge: previous.edge, face: previous.face, originalFiniteEdgeResult: result,
      source: preparation.source, intervalPolicyRequired: intervalCase,
      limitation: intervalCase ? 'Point proposals do not establish interval coverage, coincidence or ordered overlap events.' :
        'An accepted endpoint point association is not a resolved geometric root or a trimmed-face incidence certificate.', attempts });
  }
  directions.push({ name, sourceBody, targetBody, rows });
}
assert.equal(counts.originalUnresolved, 42);
assert.equal(counts.endpointCases, 21); assert.equal(counts.intervalCases, 21);
assert.equal(counts.proposals, 84); assert.equal(counts.associated, 63); assert.equal(counts.separated, 21);
assert.equal(counts.unresolved, 0); assert.equal(counts.rejected, 0);
const after = implementation();
assert.deepEqual(after, before, 'Relevant implementation changed during the diagnostic');
for (const [path, expected] of Object.entries(frozen)) assert.equal(hash(read(path)), expected, path);
const report = { schema: 'wonky-junction-diagnostic/1', createdAt: new Date().toISOString(),
  scope: 'Separate point-junction proposals only; all 42 original finite-edge intersections remain unresolved. No clipping or solid result.',
  inputs: frozen, pairBasis: { path: basisPath, sha256: hash(basisBytes), use: 'Pair indices and comparison evidence only; geometry reconstructed afresh.' },
  implementation: { stable: true, sha256: hash(JSON.stringify(before)), files: before },
  geometry: bodies.map((body, id) => ({ id, name: id === 0 ? 'P10 g0' : 'F32 clipping box', revision: geometryRevision(body),
    vertices: body.vertices.length, edges: body.edges.length, faces: body.faces.length })),
  reconstruction, tolerance, policy,
  sourceAllowancePolicy: 'Endpoint proposals carry the prepared finite-edge body-wide source budget. It does not enlarge contactTolerance.',
  counts, maxima, directions };
const output = new URL('out/junction/diagnostic.json', root);
mkdirSync(new URL('out/junction/', root), { recursive: true });
writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ path: fileURLToPath(output), counts, maxima, implementationStable: true }, null, 2));
