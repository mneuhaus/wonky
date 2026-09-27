import test from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missingBend();
if (publicTreeSkip) {
  test("sketch-lines.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { readFileSync } = await import("node:fs");
const { build } = await import("../src/index.mjs");
const { array, list, loadKernel } = await import("../src/kernel.mjs");
const { coords, number, real, vector } = await import("../src/real.mjs");
const { toStep } = await import("../src/exporters.mjs");
const { UnsupportedFeatureError } = await import("../src/errors.mjs");









const kernel = await loadKernel();
const sourcePoint = ([x, y]) => {
  const bits = new DataView(new ArrayBuffer(16));
  bits.setFloat64(0, x); bits.setFloat64(8, y);
  return { $: 'SourcePoint', x_high: bits.getUint32(0), x_low: bits.getUint32(4), y_high: bits.getUint32(8), y_low: bits.getUint32(12) };
};
const point = (xy, sourceMeters = xy.map(value => value / 1000)) => {
  const original = [...xy, 0], value = vector(original), stored = coords(value);
  return { $: 'Point', value, remainder: vector(original.map((v, i) => v - stored[i])), source: sourcePoint(sourceMeters) };
};
const segment = (index, start, end) => ({ $: 'Segment', index, start: point(start), end: point(end) });
const loop = (points, firstIndex = 0) => points.map((start, i) => segment(firstIndex + i, start, points[(i + 1) % points.length]));
const solve = segments => kernel.sketchLines.solve(list(segments));
const solvedPoints = result => {
  assert.equal(result.$, 'Solved', JSON.stringify(result));
  return array(result.points).map(({ x, y, z }) => [x, y, z]);
};
const triangle = [[0, 0], [3, 0], [0, 4]];
const rectangle = [[-3, -2], [6, -2], [6, 5], [-3, 5]];
const concave = [[0, 0], [8, 0], [8, 2], [3, 2], [3, 7], [0, 7]];
const permutations = values => values.length ? values.flatMap((first, i) => permutations(values.filter((_, j) => j !== i)).map(rest => [first, ...rest])) : [[]];
const reverse = segment => ({ ...segment, start: segment.end, end: segment.start });
const near = (actual, expected, epsilon = 1e-10) => assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} != ${expected}`);

const header = 'FeatureScript 3000; import(path : "onshape/std/geometry.fs", version : "3000.0");';
const feature = body => `${header}\nexport function main(context is Context, id is Id, definition is map) {\n${body}\n}`;
const sketch = 'var s = newSketchOnPlane(context, id + "s", {"sketchPlane":plane(vector(0,0,0)*millimeter, vector(0,0,1), vector(1,0,0))});';
const line = (id, start, end, extra = '') => `skLineSegment(s,"${id}",{"start":vector(${start.join(',')})*millimeter,"end":vector(${end.join(',')})*millimeter${extra}});`;
const lines = points => points.map((p, i) => line(`edge${i}`, p, points[(i + 1) % points.length])).join('\n');
const extrude = (direction = 'vector(0,0,1)') => `opExtrude(context,id+"e",{"entities":qSketchRegion(id+"s"),"direction":${direction},"endBound":BoundingType.BLIND,"endDepth":5*millimeter});`;
const modelSource = (segments, direction) => feature(`${sketch}\n${segments}\nskSolve(s);\n${extrude(direction)}`);

test('native line assembly creates one simple convex or concave CCW profile', () => {
  for (const [points, area] of [[triangle, 6], [rectangle, 63], [concave, 31]]) {
    const source = loop(points), result = solve([reverse(source.at(-1)), ...source.slice(0, -1).reverse()]);
    assert.deepEqual(solvedPoints(result), points.map(p => [...p, 0]));
    near(number(result.area), area); near(number(result.source_area), area);
    assert.equal(number(result.quantization_error), 0);
    assert.ok(number(result.linear_resolution) > 0);
  }
});

test('native profile start and winding survive every triangle ordering and independent direction', () => {
  const source = loop(triangle), expected = triangle.map(p => [...p, 0]);
  for (const order of permutations(source)) for (let mask = 0; mask < 8; mask++) {
    const input = order.map((s, i) => (mask & 1 << i) ? reverse(s) : s);
    const result = solve(input);
    assert.deepEqual(solvedPoints(result), expected);
    assert.deepEqual(array(result.source), input, 'native source retains insertion order and every original endpoint word');
    assert.deepEqual(array(result.uses).map(u => u.segment.index), [0, 1, 2]);
    for (const use of array(result.uses)) {
      const before = input.find(s => s.index === use.segment.index);
      assert.deepEqual(use.segment, before);
      assert.deepEqual(coords((use.forward ? use.segment.start : use.segment.end).value), expected[use.segment.index]);
    }
  }
});

test('native concave profiles use the same canonical start in either walk direction', () => {
  const source = loop(concave), expected = concave.map(p => [...p, 0]);
  for (let offset = 0; offset < source.length; offset++) for (const backwards of [false, true]) {
    const input = [...source.slice(offset), ...source.slice(0, offset)].map((s, i) => i % 2 ? reverse(s) : s);
    assert.deepEqual(solvedPoints(solve(backwards ? input.reverse() : input)), expected);
  }
});

test('native source words and sub-prefix remainders stay separate from explicit F32 geometry', () => {
  const points = [[1.1, 0], [3.2, 0], [1.1, 2.1]], input = loop(points), result = solve(input);
  assert.deepEqual(solvedPoints(result), points.map(([x, y]) => [Math.fround(x), Math.fround(y), 0]));
  assert.deepEqual(array(result.source), input);
  assert.notEqual(number(input[0].start.remainder.x), 0);
  near(number(input[0].start.value.x) + number(input[0].start.remainder.x), 1.1, 0);
  assert.ok(number(result.quantization_error) > 0);
  assert.notEqual(number(result.source_area), number(result.area));
});

const rejectionCases = [
  ['empty or incomplete input', () => [], 'SegmentCount'],
  ['two segments', () => loop(triangle).slice(0, 2), 'SegmentCount'],
  ['more than 256 segments', () => Array.from({ length: 257 }, (_, i) => segment(i, [i, 0], [i, 1])), 'SegmentCount'],
  ['open endpoint', () => [segment(0, [0, 0], [3, 0]), segment(1, [3, 0], [0, 4]), segment(2, [0, 4], [0, 1e-10])], 'OpenEndpoint'],
  ['branch endpoint', () => [...loop(triangle), segment(3, [0, 0], [-1, -1])], 'BranchEndpoint'],
  ['duplicate index', () => loop(triangle).map((s, i) => ({ ...s, index: i === 2 ? 0 : i })), 'DuplicateId'],
  ['duplicate segment', () => [...loop(triangle), segment(3, [0, 0], [3, 0])], 'DuplicateSegment'],
  ['reversed duplicate', () => [...loop(triangle), segment(3, [3, 0], [0, 0])], 'DuplicateSegment'],
  ['zero segment', () => [segment(0, [0, 0], [0, 0]), ...loop(triangle, 1)], 'DegenerateSegment'],
  ['separate loops', () => [...loop(triangle), ...loop([[10, 0], [13, 0], [10, 4]], 3)], 'MultipleRegions'],
  ['nested loops', () => [...loop([[0, 0], [10, 0], [0, 10]]), ...loop([[1, 1], [2, 1], [1, 2]], 3)], 'MultipleRegions'],
  ['crossing loop', () => loop([[0, 0], [10, 10], [0, 10], [10, 0]]), 'SelfIntersectionOrTouch'],
  ['vertex touching a nonadjacent edge', () => loop([[0, 0], [4, 0], [4, 4], [2, 0], [0, 4]]), 'SelfIntersectionOrTouch'],
  ['collinear corner', () => loop([[0, 0], [5, 0], [10, 0], [0, 5]]), 'CollinearCorner'],
  ['unresolved short edge', () => loop([[0, 0], [1e-6, 0], [0, 1]]), 'ShortEdge'],
  ['unresolved area', () => loop([[0, 0], [1, 0], [0, 3e-5]]), 'UnresolvedArea'],
  ['F32 vertex collapse', () => loop([[9999, 9999], [9999.0001, 9999], [9999, 9999.5]]), 'QuantizationCollapse'],
  ['out-of-range coordinate', () => loop([[0, 0], [10001, 0], [0, 4]]), 'InvalidPoint'],
];
for (const [name, input, reason] of rejectionCases) test(`native line assembly rejects ${name}`, () => {
  const result = solve(input());
  assert.equal(result.$, 'Rejected'); assert.equal(result.reason.$, reason);
});

test('native line assembly rejects malformed, nonplanar and displacement-like input words', () => {
  for (const mutate of [
    p => { p.value.x.hi = NaN; },
    p => { p.value.x.hi = Infinity; },
    p => { p.value.x.lo = Infinity; },
    p => { p.value.x = { $: 'Real', hi: 1, lo: 1 }; },
    p => { p.value.z = real(1); },
    p => { p.remainder.z = real(1e-15); },
    p => { p.remainder.x = real(0.001); },
    p => { p.remainder.x.hi = NaN; },
    p => { p.source = sourcePoint([Infinity, 0]); },
    p => { p.source = sourcePoint([NaN, 0]); },
    p => { p.source = sourcePoint([10.0000000001, 0]); },
  ]) {
    const input = loop(triangle); mutate(input[0].start);
    assert.deepEqual(solve(input), { $: 'Rejected', reason: { $: 'InvalidPoint', segment: 0 } });
  }
});

test('distinct endpoints with identical F32x2 prefixes remain open in Bend and FeatureScript', async () => {
  const a = 1.1, b = 1.1 + Number.EPSILON, input = loop([[a, 0], [3, 0], [a, 4]]);
  input[2].end = point([b, 0]);
  assert.notEqual(a, b);
  assert.deepEqual(input[0].start.value, input[2].end.value);
  assert.notDeepEqual(input[0].start.remainder, input[2].end.remainder);
  assert.equal(solve(input).reason.$, 'OpenEndpoint');
  const source = modelSource(line('a', [a, 0], [3, 0]) + line('b', [3, 0], [a, 4]) + line('c', [a, 4], [b, 0]));
  await assert.rejects(build(source), error => error instanceof UnsupportedFeatureError && /OpenEndpoint/.test(error.message));
});

test('original SI words prevent closure when different quantities round to identical millimetres', async () => {
  const a = 1.1000000000000085, b = 1.1000000000000087;
  assert.notEqual(a, b); assert.equal(a * 1000, b * 1000);
  const input = loop([[a * 1000, 0], [3000, 0], [a * 1000, 4000]]);
  input[0].start = point([a * 1000, 0], [a, 0]);
  input[2].end = point([b * 1000, 0], [b, 0]);
  assert.deepEqual(input[0].start.value, input[2].end.value);
  assert.deepEqual(input[0].start.remainder, input[2].end.remainder);
  assert.notDeepEqual(input[0].start.source, input[2].end.source);
  assert.equal(solve(input).reason.$, 'OpenEndpoint');
  const source = feature(`${sketch}\n${line('a', [a, 0], [3, 0]).replaceAll('millimeter', 'meter')}\n${line('b', [3, 0], [a, 4]).replaceAll('millimeter', 'meter')}\n${line('c', [a, 4], [b, 0]).replaceAll('millimeter', 'meter')}\ntry silent(skSolve(s));\n${extrude()}`);
  await assert.rejects(build(source), error => {
    assert.ok(error instanceof UnsupportedFeatureError); assert.match(error.message, /OpenEndpoint/);
    assert.equal(error.modelTrace.operations.find(op => op.name === 'skSolve').status, 'failed');
    assert.equal(error.modelTrace.operations.some(op => op.name === 'opExtrude'), false);
    return true;
  });
  const closed = await build(source.replace(String(b), String(a)));
  const first = closed.bodies[0].sketchProfile.segments[0];
  assert.equal(first.startMeters[0], a); assert.equal(first.startMm[0], a * 1000);
  assert.deepEqual(array(closed.bodies[0].sketchProfile.native.source)[0].start.source, sourcePoint([a, 0]));
});

test('signed zero retains its source bits while representing the same native endpoint', () => {
  const input = loop(triangle);
  input[0].start = point([-0, 0], [-0, 0]);
  const result = solve(input);
  assert.equal(result.$, 'Solved');
  assert.equal(array(result.source)[0].start.source.x_high, 0x80000000);
});

test('the supported 256-segment boundary yields one closed profile', () => {
  const points = Array.from({ length: 256 }, (_, i) => [20 * Math.cos(i * Math.PI / 128), 20 * Math.sin(i * Math.PI / 128)]);
  const result = solve(loop(points));
  assert.equal(solvedPoints(result).length, 256);
  assert.equal(array(result.source).length, 256);
});

test('real FeatureScript line calls create an extruded solid, STEP and retained segment provenance', async () => {
  const source = readFileSync(new URL('../examples/line-sketch.fs', import.meta.url), 'utf8');
  const model = await build(source, { sourcePath: '/models/line-sketch.fs' }), body = model.bodies[0];
  // The prism takes the segments' own binary64 endpoints, so the volume is the
  // source's 2.1 mm triangle; only the solver's native words stay F32.
  const side = Math.fround(2.1);
  near(body.validation.volumeMm3, 2.1 * 2.1 / 2 * 5);
  assert.deepEqual([body.vertices.length, body.edges.length, body.faces.length], [6, 9, 5]);
  assert.equal(body.validation.closed, true);
  assert.equal(body.sketchProfile.schema, 'wonky-line-sketch/1');
  assert.deepEqual(body.sketchProfile.segments.map(s => s.id), ['slope', 'entry', 'axis']);
  assert.deepEqual(body.sketchProfile.profileUses, [
    { entityId: 'entry', sourceIndex: 1, forward: true },
    { entityId: 'slope', sourceIndex: 0, forward: false },
    { entityId: 'axis', sourceIndex: 2, forward: true },
  ]);
  assert.equal(body.sketchProfile.segments[0].startMm[1], 2.1);
  assert.equal(array(body.sketchProfile.native.source)[0].start.value.y.hi, side);
  for (const original of body.sketchProfile.segments) assert.match(source.split('\n')[original.location.line - 1], /skLineSegment/);
  const operations = model.sourceMap.operations.filter(op => /^(skLineSegment|skSolve|opExtrude)$/.test(op.name));
  assert.deepEqual(operations.map(op => [op.name, op.status]), [
    ['skLineSegment', 'completed'], ['skLineSegment', 'completed'], ['skLineSegment', 'completed'], ['skSolve', 'completed'], ['opExtrude', 'completed'],
  ]);
  for (const op of operations) {
    assert.equal(op.source.file, '/models/line-sketch.fs');
    assert.match(source.split('\n')[op.source.span.line - 1], new RegExp(op.name));
  }
  const step = toStep(model);
  assert.equal((step.match(/EDGE_CURVE\(/g) ?? []).length, 9);
  assert.equal((step.match(/ADVANCED_FACE\(/g) ?? []).length, 5);
  assert.match(step, /MANIFOLD_SOLID_BREP\(/);
});

test('insertion order and original segment direction do not churn solid geometry or topology IDs', async () => {
  const source = loop(triangle);
  const geometry = body => ({ vertices: body.vertices, edges: body.edges, faces: body.faces, revision: body.identity.revision,
    ids: [body.identity, ...Object.values(body.identity.topology).flat()].map(({ originId, instanceId, revision }) => ({ originId, instanceId, revision })) });
  for (const direction of ['vector(0,0,1)', 'vector(0,0,-1)']) {
    let expected;
    for (const order of permutations(source)) for (const mask of [0, 2, 5, 7]) {
      const input = order.map((s, i) => mask & 1 << i ? reverse(s) : s);
      const body = (await build(modelSource(input.map(s => line(`edge${s.index}`, coords(s.start.value).slice(0, 2), coords(s.end.value).slice(0, 2))).join('\n'), direction))).bodies[0];
      if (!expected) expected = geometry(body);
      else assert.deepEqual(geometry(body), expected);
      near(body.validation.volumeMm3, 30);
      assert.deepEqual(body.sketchProfile.profileUses.map(u => u.entityId), ['edge0', 'edge1', 'edge2']);
    }
  }
});

test('concave line profile extrudes without filling its notch', async () => {
  const body = (await build(modelSource(lines(concave)))).bodies[0];
  near(body.validation.volumeMm3, 155);
  assert.deepEqual([body.vertices.length, body.edges.length, body.faces.length], [12, 18, 8]);
  assert.equal(body.validation.closed, true);
});

test('mixing segments with existing profile modes is explicit in both insertion orders', async () => {
  const legacy = [
    'skCircle(s,"legacy",{"center":vector(5,5)*millimeter,"radius":2*millimeter});',
    'skRectangle(s,"legacy",{"firstCorner":vector(1,1)*millimeter,"secondCorner":vector(2,2)*millimeter});',
    'skPolyline(s,"legacy",{"points":[vector(0,0)*millimeter,vector(3,0)*millimeter,vector(0,4)*millimeter,vector(0,0)*millimeter]});',
  ];
  for (const other of legacy) for (const calls of [other + lines(triangle), lines(triangle) + other]) {
    await assert.rejects(build(modelSource(calls)), error => error instanceof UnsupportedFeatureError && /cannot mix/.test(error.message));
  }
});

test('line calls enforce IDs, length units, supported fields and sketch mutability', async () => {
  const valid = lines(triangle);
  for (const [calls, pattern] of [
    [line('', [0, 0], [1, 0]), /nonempty and unique/],
    [line('same', [0, 0], [1, 0]) + line('same', [1, 0], [0, 1]), /nonempty and unique/],
    [line('a', [0, 0], [1, 0]).replace('vector(0,0)*millimeter', 'vector(0,0)'), /length with units/],
    [line('a', [0, 0, 0], [1, 0]), /2D Vector/],
    [line('a', [0, 0], [1, 0], ',"construction":true'), /Construction/],
    [line('a', [0, 0], [1, 0], ',"constraints":[]'), /constraints.*not supported/],
    [valid + 'skSolve(s);' + line('later', [10, 0], [11, 0]), /already been solved/],
    [valid + 'skSolve(s);skSolve(s);', /already been solved/],
    [valid + 'skSolve(s);skRectangle(s,"later",{"firstCorner":vector(5,5)*millimeter,"secondCorner":vector(6,6)*millimeter});', /already been solved/],
    [valid + 'skSolve(s);skCircle(s,"later",{"center":vector(5,5)*millimeter,"radius":1*millimeter});', /already been solved/],
  ]) await assert.rejects(build(feature(sketch + calls)), pattern);
  // Line-only profiles above 256 segments are admitted by the line/arc solver
  // (test/sketch-arcs-limit.test.mjs); the FeatureScript bound is 1024.
  await assert.rejects(build(feature(sketch + Array.from({ length: 1025 }, (_, i) => line(`edge${i}`, [i, 0], [i, 1])).join(''))), /at most 1024/);
});

test('construction false is accepted and unsupported line solves escape try silent with a failed source record', async () => {
  const valid = triangle.map((p, i) => line(`edge${i}`, p, triangle[(i + 1) % triangle.length], ',"construction":false')).join('\n');
  near((await build(modelSource(valid))).bodies[0].validation.volumeMm3, 30);
  const source = feature(`${sketch}\n${line('a', [0, 0], [3, 0])}\n${line('b', [3, 0], [0, 4])}\n${line('c', [0, 4], [1e-10, 0])}\ntry silent(skSolve(s));\n${extrude()}`);
  await assert.rejects(build(source, { sourcePath: '/models/rejected-line.fs' }), error => {
    assert.ok(error instanceof UnsupportedFeatureError); assert.match(error.message, /OpenEndpoint/);
    const op = error.modelTrace.operations.find(op => op.name === 'skSolve');
    assert.equal(op.status, 'failed'); assert.deepEqual(op.outputs, []);
    assert.equal(op.source.file, '/models/rejected-line.fs');
    assert.equal(error.line, op.source.span.line); assert.equal(error.column, op.source.span.column);
    assert.match(source.split('\n')[error.line - 1], /try silent\(skSolve/);
    assert.equal(error.modelTrace.operations.some(op => op.name === 'opExtrude'), false);
    return true;
  });
});

test('multiple regions, mixed modes and unsafe contours also escape try silent', async () => {
  const separate = lines(triangle) + loop([[10, 0], [13, 0], [10, 4]], 3).map(s => line(`edge${s.index}`, coords(s.start.value).slice(0, 2), coords(s.end.value).slice(0, 2))).join('');
  const nested = lines([[0, 0], [10, 0], [0, 10]]) + loop([[1, 1], [2, 1], [1, 2]], 3).map(s => line(`edge${s.index}`, coords(s.start.value).slice(0, 2), coords(s.end.value).slice(0, 2))).join('');
  for (const [calls, expected] of [
    [separate + 'try silent(skSolve(s));', /MultipleRegions/],
    [nested + 'try silent(skSolve(s));', /MultipleRegions/],
    [lines([[0, 0], [10, 10], [0, 10], [10, 0]]) + 'try silent(skSolve(s));', /SelfIntersectionOrTouch/],
    [lines([[9999, 9999], [9999.0001, 9999], [9999, 9999.5]]) + 'try silent(skSolve(s));', /QuantizationCollapse/],
    [line('a', [0, 0], [3, 0]) + 'try silent(skCircle(s,"circle",{"center":vector(0,0)*millimeter,"radius":1*millimeter}));', /cannot mix/],
    ['try silent(' + line('a', [0, 0], [1, 0], ',"construction":true').slice(0, -1) + ');', /Construction/],
    ['try silent(' + line('a', [0, 0], [1e-50, 0]).slice(0, -1) + ');', /cannot be represented/],
  ]) await assert.rejects(build(feature(sketch + calls)), error => error instanceof UnsupportedFeatureError && expected.test(error.message));
});

test('a missing operation remains an explicit capability error even after line sketch solving', async () => {
  await assert.rejects(build(feature(`${sketch}\n${lines(triangle)}\nskSolve(s);\ntry silent(opSweep(context,id+"r",{}));`)), error => error instanceof UnsupportedFeatureError && /opSweep/.test(error.message));
});

}
