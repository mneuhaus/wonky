import test from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missingBend() || missing("fixtures/r10b/r10b.fs");
if (publicTreeSkip) {
  test("sketch-arcs-native.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { createHash } = await import("node:crypto");
const { mkdirSync, readFileSync, writeFileSync } = await import("node:fs");
const { resolve } = await import("node:path");
const { loadBend } = await import("../src/bend-loader.mjs");
const { array, list } = await import("../src/kernel.mjs");
const { number, real, vector } = await import("../src/real.mjs");
const { toStep } = await import("../src/exporters.mjs");
const { encodeSketchArcEntities, solveSketchArcs, loadSketchArcs, decodeSketchArcExtrusion } = await import("../src/sketch-arcs.mjs");
const { UnsupportedFeatureError } = await import("../src/errors.mjs");












const native = await loadSketchArcs();
const kernel = { analytic: await loadBend(new URL('../kernel/analytic.bend', import.meta.resolve('../src/kernel.mjs'))),
  precise: await loadBend(new URL('../kernel/precise.bend', import.meta.resolve('../src/kernel.mjs'))) };
const artifact = resolve('out/sketch-arcs');
mkdirSync(artifact, { recursive: true });
const mm = point => point.map(v => v * 0.001);
const line = (start, end, index) => ({ type: 'line', startMeters: mm(start), endMeters: mm(end), ...(index === undefined ? {} : { index }) });
const arc = (start, mid, end, index) => ({ type: 'arc', startMeters: mm(start), midMeters: mm(mid), endMeters: mm(end), ...(index === undefined ? {} : { index }) });
const reversed = entity => ({ ...entity, startMeters: entity.endMeters, endMeters: entity.startMeters });
const loop = points => points.map((p, i) => line(p, points[(i + 1) % points.length], i));
const rectangle = loop([[0, 0], [3, 0], [3, 4], [0, 4]]);
const half = [arc([2, 0], [0, 2], [-2, 0], 0), line([-2, 0], [2, 0], 1)];
const lens = [arc([0, Math.sqrt(3)], [-1, 0], [0, -Math.sqrt(3)], 0), arc([0, -Math.sqrt(3)], [1, 0], [0, Math.sqrt(3)], 1)];
const circle = [arc([2, 0], [0, 2], [-2, 0], 0), arc([-2, 0], [0, -2], [2, 0], 1)];
const major = [arc([2, 0], [-2, 0], [0, -2], 0), line([0, -2], [2, 0], 1)];
const capsule = [line([-2, -1], [2, -1], 0), arc([2, -1], [3, 0], [2, 1], 1),
  line([2, 1], [-2, 1], 2), arc([-2, 1], [-3, 0], [-2, -1], 3)];
const source = readFileSync('fixtures/r10b/r10b.fs');
const rawArcs = JSON.parse(source.toString().match(/const M3_HYBRID_ARCS = (\[[\s\S]*?\n\]);/)[1]);
const original = rawArcs.map(([a, m, b], i) => arc(a, m, b, i));
// Independent 80-digit mpmath 3x3 circle solve + adaptive Green quadrature of
// the unchanged source: out/sketch-arcs/area-oracle.py and area-oracle.json.
const originalArea = 9.648054371424785598135941652668;
const originalLengths = [1.725604349589898, 0.7241132487369242, 1.471108101631218, 0.7241132487369243,
  1.7256043495898987, 0.724113248736924, 1.4711081016312213, 0.7241132487369227,
  1.725604349589898, 0.7241132487369238, 1.4711081016312195, 0.7241132487369237];
const near = (actual, expected, tolerance = 1e-10) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
const solve = entities => native.solve(encodeSketchArcEntities(entities));
const geometry = body => ({ vertices: body.vertices, edges: body.edges, faces: body.faces });

function extrude(profile, name, { depth = 5, origin = [0, 0, 0], normal = [0, 0, 1], x = [1, 0, 0], delta = [0, 0, depth] } = {}) {
  const result = native.extrude(profile, vector(origin), vector(normal), vector(x), vector(delta));
  assert.equal(result.$, 'Extruded', JSON.stringify(result));
  assert.equal(result.audit.valid, true);
  assert.equal(number(result.source_budget), 0);
  assert.equal(number(result.audit.allowance), number(result.audit.resolution));
  assert.ok(number(result.audit.required) <= number(result.audit.resolution));
  near(number(result.audit.volume), number(result.volume));
  const body = decodeSketchArcExtrusion(result, name, kernel);
  assert.equal(body.vertices.length - body.edges.length + body.faces.length, 2);
  for (const edge of body.edges) {
    assert.equal(edge.curveRange.length, 2);
    assert.ok(edge.curveRange[1] > edge.curveRange[0]);
    if (edge.curve.type === 'circle') assert.ok(edge.curveRange[1] - edge.curveRange[0] < 2 * Math.PI);
  }
  return { result, body };
}

function publish(body, profile, area, lengths, depth = 5) {
  const perimeter = lengths.reduce((a, b) => a + b, 0);
  const ordered = array(profile.uses).map(use => lengths[use.fit.source.index]);
  body.referenceMeasurements = { source: 'independent closed formula or frozen-point 80-digit adaptive quadrature; test oracle only',
    faceAreasMm2: [area, area, ...ordered.map(length => length * Math.abs(depth))],
    facePerimetersMm: [perimeter, perimeter, ...ordered.map(length => 2 * (length + Math.abs(depth)))],
    faceTolerancesMm: body.faces.map(() => body.construction.allowanceMm) };
  const model = { schema: 'wonky-brep/1', units: 'millimeter', backend: { language: 'Bend', version: '2.0.25' }, bodies: [body] };
  const step = toStep(model, body.id);
  assert.ok(!step.includes('FACETED_BREP') && !step.includes('POLYLINE'));
  writeFileSync(`${artifact}/${body.id}.brep.json`, JSON.stringify(model, null, 2) + '\n');
  writeFileSync(`${artifact}/${body.id}.step`, step);
}

for (const [name, entities, area, lengths] of [
  ['rectangle', rectangle, 12, [3, 4, 3, 4]],
  ['semicircle', half, 2 * Math.PI, [2 * Math.PI, 4]],
  ['lens', lens, 8 * Math.PI / 3 - 2 * Math.sqrt(3), [4 * Math.PI / 3, 4 * Math.PI / 3]],
  ['circle-two-arcs', circle, 4 * Math.PI, [2 * Math.PI, 2 * Math.PI]],
  ['major-arc', major, 3 * Math.PI + 2, [3 * Math.PI, 2 * Math.sqrt(2)]],
  ['capsule', capsule, 8 + Math.PI, [4, Math.PI, 4, Math.PI]],
  ['m3-original', original, originalArea, originalLengths],
]) test(`native ${name}: analytic area, finite domains, closed extrusion and STEP artifact`, () => {
  const before = structuredClone(entities), encoded = encodeSketchArcEntities(entities), profile = native.solve(encoded);
  assert.equal(profile.$, 'Solved', JSON.stringify(profile));
  assert.deepEqual(entities, before);
  assert.deepEqual(profile.source, encoded);
  near(number(profile.area), area);
  assert.ok(number(profile.fit_error) <= number(profile.resolution));
  assert.ok(number(profile.endpoint_gap) <= number(profile.resolution));
  const { result, body } = extrude(profile, name);
  near(body.validation.volumeMm3, area * 5);
  const n = entities.length;
  assert.deepEqual([body.vertices.length, body.edges.length, body.faces.length], [2 * n, 3 * n, n + 2]);
  assert.equal(body.faces.filter(face => face.surface.type === 'cylinder').length, entities.filter(entity => entity.type === 'arc').length);
  publish(body, profile, area, lengths);
  if (name === 'm3-original') writeFileSync(`${artifact}/m3-checked.native.json`, JSON.stringify(result, null, 2) + '\n');
});

test('frozen M3 source hash, nonzero original endpoint disagreement and source budget stay explicit', () => {
  assert.equal(createHash('sha256').update(source).digest('hex'), '219ee9630f37f9e54fe7e1b4e09094ab25748a811ed8f9e8b9ebf4892d8b8349');
  const profile = solve(original);
  assert.equal(profile.$, 'Solved');
  assert.ok(number(profile.endpoint_gap) > 0);
  assert.equal(number(profile.source_budget), 0);
  assert.equal(array(profile.source).length, 12);
  const broken = structuredClone(original);
  broken[0].startMeters[0] += 1e-9;
  assert.equal(solve(broken).reason.$, 'OpenEndpoint');
  assert.deepEqual(solve(original), profile, 'a failed attempt must not enlarge a subsequent attempt budget');
});

test('canonical geometry is unchanged by input order, original direction and winding', () => {
  for (const entities of [half, lens, rectangle, original]) {
    const reference = extrude(solve(entities), 'reference').body;
    for (const candidate of [entities.toReversed(), entities.map(reversed), entities.toReversed().map(reversed),
      [...entities.slice(1), entities[0]].map((entity, i) => i % 2 ? reversed(entity) : entity)]) {
      const profile = solve(candidate);
      assert.equal(profile.$, 'Solved', JSON.stringify(profile));
      assert.deepEqual(geometry(extrude(profile, 'variant').body), geometry(reference));
    }
  }
});

test('negative depth and rigid frame preserve native volume and strict STEP topology', () => {
  const profile = solve(original);
  const negative = extrude(profile, 'm3-negative', { depth: -5 }).body;
  near(negative.validation.volumeMm3, originalArea * 5);
  publish(negative, profile, originalArea, originalLengths, -5);
  const moved = extrude(profile, 'm3-rigid', { origin: [19, -23, 47], normal: [0.6, 0, 0.8], x: [0.8, 0, -0.6], delta: [3, 0, 4] }).body;
  near(moved.validation.volumeMm3, originalArea * 5);
  publish(moved, profile, originalArea, originalLengths);
});

const invalid = [
  ['too few entities', [], 'EntityCount'],
  ['open loop', [line([0, 0], [3, 0]), line([3, 0], [3, 4])], 'OpenEndpoint'],
  ['zero line', [line([0, 0], [0, 0]), ...rectangle.map((e, i) => ({ ...e, index: i + 1 }))], 'DegenerateEntity'],
  ['collinear three-point arc', [arc([0, 0], [1, 0], [2, 0]), line([2, 0], [0, 0])], 'UnresolvedArc'],
  ['coincident arc endpoints', [arc([0, 0], [1, 1], [0, 0]), line([0, 0], [1, 0])], 'DegenerateEntity'],
  ['duplicate entity id', half.map(entity => ({ ...entity, index: 7 })), 'DuplicateId'],
  ['duplicate arc carrier and interval', [half[0], { ...half[0], index: 1 }], 'UnresolvedArea'],
  ['multiple loops', [...rectangle, ...loop([[10, 0], [13, 0], [13, 4], [10, 4]]).map((e, i) => ({ ...e, index: i + 4 }))], 'MultipleRegions'],
  ['branch at shared endpoint', [...rectangle, line([0, 0], [-1, 0], 4)], 'AmbiguousEndpoint'],
  ['crossed straight profile', loop([[0, 0], [4, 3], [0, 4], [3, 0]]), 'SelfIntersectionOrTouch'],
  ['line crossing a finite arc interior', [major[0], line([0, -2], [-3, 3], 1), line([-3, 3], [2, 0], 2)], 'SelfIntersectionOrTouch'],
  ['coordinate outside source envelope', loop([[0, 0], [10001, 0], [0, 4]]), 'InvalidPoint'],
];
for (const [name, entities, reason] of invalid) test(`native rejects ${name}`, () => {
  const result = solve(entities);
  assert.equal(result.$, 'Rejected');
  assert.equal(result.reason.$, reason);
});

test('short and ambiguous endpoint incidences reject without automatic budget growth', () => {
  const short = loop([[0, 0], [1e-13, 0], [3, 0], [3, 4], [0, 4]]);
  assert.equal(solve(short).reason.$, 'DegenerateEntity');
  const branches = [...rectangle, line([1e-13, 1e-13], [-1, -1], 4)];
  assert.equal(solve(branches).reason.$, 'AmbiguousEndpoint');
});

test('native representation rejects malformed source words and nonplanar points', () => {
  const source = array(encodeSketchArcEntities(half));
  source[0].mid.value.z = real(1);
  assert.equal(native.solve(list(source)).reason.$, 'InvalidPoint');
  const other = array(encodeSketchArcEntities(half));
  other[0].mid.source.x_high = 0x7ff00000;
  assert.equal(native.solve(list(other)).reason.$, 'InvalidPoint');
});

test('extrusion rejects oblique, zero and invalid-frame sweeps', () => {
  const profile = solve(half);
  const evaluate = (normal, x, delta) => native.extrude(profile, vector([0, 0, 0]), vector(normal), vector(x), vector(delta));
  assert.equal(evaluate([0, 0, 1], [1, 0, 0], [1, 0, 5]).reason.$, 'NonNormalSweep');
  assert.equal(evaluate([0, 0, 1], [1, 0, 0], [0, 0, 0]).reason.$, 'UnresolvedDepth');
  assert.equal(evaluate([0, 0, 1], [1, 0, 1], [0, 0, 5]).reason.$, 'InvalidFrame');
  assert.equal(evaluate([0, 0, 0], [1, 0, 0], [0, 0, 5]).reason.$, 'InvalidFrame');
});

test('adapter exposes capability failures and never silently returns a partial sketch', () => {
  assert.throws(() => solveSketchArcs(native, [line([0, 0], [3, 0]), line([3, 0], [3, 4])]), UnsupportedFeatureError);
  assert.throws(() => encodeSketchArcEntities([{ type: 'spline' }]), UnsupportedFeatureError);
  assert.throws(() => encodeSketchArcEntities([{ ...half[0], construction: true }]), UnsupportedFeatureError);
});


// The bound itself (1024) is covered in test/sketch-arcs-limit.test.mjs.
test('native entity count bound admits 256 simple segments and rejects 1025', () => {
  const points = Array.from({ length: 256 }, (_, i) => [5 * Math.cos(2 * Math.PI * i / 256), 5 * Math.sin(2 * Math.PI * i / 256)]);
  const entities = loop(points);
  const result = solve(entities);
  assert.equal(result.$, 'Solved', JSON.stringify(result));
  near(number(result.area), 256 * 25 * Math.sin(2 * Math.PI / 256) / 2);
  const many = Array.from({ length: 1025 }, (_, i) => [5 * Math.cos(2 * Math.PI * i / 1025), 5 * Math.sin(2 * Math.PI * i / 1025)]);
  assert.equal(solve(loop(many)).reason.$, 'EntityCount');
});

test('native volume guard rejects a tampered solved area', () => {
  const profile = solve(half);
  profile.area = real(42);
  const result = native.extrude(profile, vector([0, 0, 0]), vector([0, 0, 1]), vector([1, 0, 0]), vector([0, 0, 5]));
  assert.equal(result.$, 'Unsupported');
  assert.equal(result.reason.$, 'NativeAudit');
});


test('two candidate endpoints on one other entity are an ambiguous incidence', () => {
  const a = 0.49e-12;
  const entities = [arc([-a, -a], [Math.SQRT1_2, -Math.SQRT1_2], [a, a], 0),
    arc([-a, a], [0.98, 0.98], [a, -a], 1)];
  const result = solve(entities);
  assert.equal(result.$, 'Rejected');
  assert.equal(result.reason.$, 'AmbiguousEndpoint');
});

}
