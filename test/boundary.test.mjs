import test from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missingBend();
if (publicTreeSkip) {
  test("boundary.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { loadKernel, list, array } = await import("../src/kernel.mjs");
const { vector } = await import("../src/real.mjs");





let module;
async function stitch(pairs, uses, count = Math.max(...pairs.flat()) + 1) {
  await loadKernel();
  module ??= (await import('../kernel/boundary.bend')).default;
  const edges = pairs.map(([start, end]) => ({ $: 'Edge', start, end, same_sense: true,
    curve: { $: 'Line', origin: vector([0, 0, 0]), direction: vector([1, 0, 0]) } }));
  return module.stitch(list(edges), count, list(uses.map(([edge, forward = true]) => ({ $: 'Use', edge, forward }))));
}
const rings = result => {
  assert.equal(result.$, 'Stitched', JSON.stringify(result));
  return array(result.rings).map(ring => array(ring.uses).map(use => [use.edge, use.forward]));
};

test('Bend stitches shuffled directed coedges into complete, separately closed rings', async () => {
  assert.deepEqual(rings(await stitch([[0, 1], [2, 1], [2, 0]], [[1, false], [0], [2]])),
    [[[1, false], [2, true], [0, true]]]);
  assert.deepEqual(rings(await stitch([[0, 1], [1, 2], [2, 0], [3, 4], [4, 5], [5, 3]], [[4], [2], [0], [5], [1], [3]])),
    [[[4, true], [5, true], [3, true]], [[2, true], [0, true], [1, true]]]);
  assert.deepEqual(rings(await stitch([], [], 0)), []);
  // A periodic edge is topologically a complete ring. Geometry is deliberately
  // not inferred here; the analytic caller must validate its supporting curve.
  assert.deepEqual(rings(await stitch([[0, 0]], [[0]], 1)), [[[0, true]]]);
});

test('open, ambiguous, duplicate and invalid boundaries are rejected without partial rings', async () => {
  for (const [pairs, uses, count, reason] of [
    [[[0, 1], [1, 2]], [[0], [1]], 3, 'OpenBoundary'],
    [[[0, 1], [1, 0], [0, 2], [2, 0]], [[0], [1], [2], [3]], 3, 'BranchBoundary'],
    [[[0, 1], [1, 2], [2, 0]], [[0], [1], [2], [0]], 3, 'BranchBoundary'],
    [[[0, 1]], [[1]], 2, 'InvalidEdge'],
    [[[0, 2]], [[0]], 2, 'InvalidVertex'],
    // Two cycles that touch at one vertex require a geometric arrangement
    // decision. They cannot be resolved by this identity-only stitcher.
    [[[0, 1], [1, 2], [2, 0], [0, 3], [3, 4], [4, 0]], [[0], [1], [2], [3], [4], [5]], 5, 'BranchBoundary'],
  ]) {
    const result = await stitch(pairs, uses, count);
    assert.equal(result.$, 'Rejected');
    assert.equal(result.reason.$, reason, JSON.stringify(result));
    assert.equal(result.rings, undefined);
  }
});

test('nearby geometry never joins different identities and all uses survive permutations', async () => {
  const result = await stitch([[0, 1], [1, 2], [3, 0]], [[0], [1], [2]], 4);
  assert.equal(result.$, 'Rejected');
  let seed = 73;
  for (let n = 3; n < 28; n++) {
    const pairs = Array.from({ length: n }, (_, i) => i % 2 ? [(i + 1) % n, i] : [i, (i + 1) % n]);
    const uses = pairs.map((_, i) => [i, i % 2 === 0]);
    for (let i = n - 1; i > 0; i--) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const j = seed % (i + 1); [uses[i], uses[j]] = [uses[j], uses[i]];
    }
    const [ring] = rings(await stitch(pairs, uses));
    assert.equal(ring.length, n);
    assert.equal(new Set(ring.map(([edge]) => edge)).size, n);
    for (let i = 0; i < n; i++) {
      const [edge, forward] = ring[i], [next, nextForward] = ring[(i + 1) % n];
      assert.equal(pairs[edge][forward ? 1 : 0], pairs[next][nextForward ? 0 : 1]);
    }
  }
});

}
