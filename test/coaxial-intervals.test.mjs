import test from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missingBend();
if (publicTreeSkip) {
  test("coaxial-intervals.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { mkdirSync, writeFileSync } = await import("node:fs");
const { loadKernel, array } = await import("../src/kernel.mjs");
const { real, vector, number, coords } = await import("../src/real.mjs");
const { build } = await import("../src/index.mjs");
const { toStep } = await import("../src/exporters.mjs");








const kernel = await loadKernel();
function run({ ra = 40, rb = 38, low = 2, high = 120.00000000000001, op = 2 } = {}) {
  const args = [vector([0, 0, 0]), vector([0, 0, 120]), real(ra), vector([0, 0, low]), vector([0, 0, high]), real(rb), op];
  const before = structuredClone(args), result = kernel.boolean.coaxial(...args);
  assert.deepEqual(args, before);
  return result;
}

test('coaxial subtraction ignores a tiny empty exterior interval without moving any boundary', () => {
  for (const high of [120, 120.00000000000001, 120.00000001, 121]) {
    const result = run({ high });
    assert.equal(result.supported, true);
    const [body] = array(result.bodies);
    assert.ok(Math.abs(number(body.volume) - Math.PI * (40 ** 2 * 120 - 38 ** 2 * 118)) < 1e-8);
    assert.equal(number(body.bounds.high.z), 120);
    assert.equal(number(body.bounds.low.z), 0);
  }
});

test('empty intervals and genuine retained slivers have different resolution outcomes', () => {
  const disjoint = run({ low: 120.00000000000001, high: 122, op: 1 });
  assert.equal(disjoint.supported, true);
  assert.deepEqual(array(disjoint.bodies), []);
  const gap = run({ low: 120.00000001, high: 122, op: 0 });
  assert.equal(gap.supported, true);
  const parts = array(gap.bodies).toSorted((a, b) => number(a.bounds.low.z) - number(b.bounds.low.z));
  assert.equal(parts.length, 2);
  assert.equal(number(parts[0].bounds.high.z), 120);
  assert.equal(number(parts[1].bounds.low.z), 120.00000001);
  assert.equal(run({ rb: 39.99999999, low: 0, high: 121 }).supported, false, 'a real thin radial shell is not erased');
  assert.equal(run({ rb: 41, low: 0, high: 119.99999999 }).supported, false, 'a real thin top slab is not erased');
  assert.equal(run({ rb: 39, low: 0, high: 121 }).supported, true);
});

test('swapped short reversed cylinders retain the real gap and bounds of their actual circle supports', () => {
  for (const axis of [[0, 0, 1], [1, 0, 0], [0, -1, 0], [0.6, 0, 0.8]]) {
    const at = z => kernel.precise.scale(vector(axis), real(z));
    const args = [at(122), at(120.00000001), real(38), at(0), at(120), real(40), 0];
    const before = structuredClone(args), result = kernel.boolean.coaxial(...args);
    assert.deepEqual(args, before);
    assert.equal(result.supported, true);
    const bodies = array(result.bodies);
    assert.equal(bodies.length, 2);
    for (const body of bodies) {
      const expected = { low: [Infinity, Infinity, Infinity], high: [-Infinity, -Infinity, -Infinity] };
      for (const { curve } of array(body.solid.edges)) if (curve.$ === 'Circle') {
        const center = coords(curve.origin), n = coords(curve.normal), x = coords(curve.x), r = number(curve.radius);
        const y = [n[1] * x[2] - n[2] * x[1], n[2] * x[0] - n[0] * x[2], n[0] * x[1] - n[1] * x[0]];
        for (let i = 0; i < 3; i++) {
          const extent = r * Math.hypot(x[i], y[i]);
          expected.low[i] = Math.min(expected.low[i], center[i] - extent);
          expected.high[i] = Math.max(expected.high[i], center[i] + extent);
        }
      }
      const rimBounds = kernel.boolean.rim_bounds(body.solid.edges);
      for (const measured of [body.bounds, rimBounds]) for (const side of ['low', 'high']) {
        coords(measured[side]).forEach((value, i) => assert.ok(Math.abs(value - expected[side][i]) < 5e-10,
          `${axis}: ${side}[${i}] ${value} does not bound the represented rim at ${expected[side][i]}`));
      }
    }
    if (axis[2] === 1) {
      const parts = bodies.toSorted((a, b) => number(a.bounds.low.z) - number(b.bounds.low.z));
      assert.ok(number(parts[1].bounds.low.z) > number(parts[0].bounds.high.z), 'the real empty gap must not vanish into erroneous bounds');
    }
  }
});

test('the original 120 mm cup construction evaluates in strict FeatureScript and exports its actual B-rep', async () => {
  const source = `FeatureScript 3044;
import(path:"onshape/std/geometry.fs",version:"3044.0");
export function main(context is Context,id is Id,definition is map) {
  for (var part in [["outer", 40, 0, 120], ["cavity", 38, 2, 118]]) {
    var sk = newSketchOnPlane(context,id+part[0]+"profile",{"sketchPlane":plane(vector(0,0,part[2])*millimeter,vector(0,0,1))});
    skCircle(sk,"circle",{"center":vector(0,0)*millimeter,"radius":part[1]*millimeter});
    skSolve(sk);
    opExtrude(context,id+part[0],{"entities":qSketchRegion(id+part[0]+"profile"),"direction":vector(0,0,1),"endBound":BoundingType.BLIND,"endDepth":part[3]*millimeter});
  }
  opBoolean(context,id+"cup",{"targets":qCreatedBy(id+"outer",EntityType.BODY),"tools":qCreatedBy(id+"cavity",EntityType.BODY),"operationType":BooleanOperationType.SUBTRACTION});
}`;
  const model = await build(source);
  assert.deepEqual(model.modelingPolicy, { curvedContacts: 'strict' });
  assert.equal(model.bodies.length, 1);
  assert.ok(Math.abs(model.bodies[0].validation.volumeMm3 - 21608 * Math.PI) < 1e-8);
  assert.equal(model.bodies[0].validation.boundsMm.max[2], 120);
  const prefix = new URL('../out/coaxial-intervals/cup', import.meta.url);
  mkdirSync(new URL('../out/coaxial-intervals/', import.meta.url), { recursive: true });
  writeFileSync(new URL(prefix.href + '.brep.json'), JSON.stringify(model, null, 2) + '\n');
  writeFileSync(new URL(prefix.href + '.step'), toStep(model, 'cup'));
});

}
