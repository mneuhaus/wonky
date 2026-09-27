import test from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missingBend();
if (publicTreeSkip) {
  test("native-bridge-batched.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { simulate } = await import("../scripts/native-bridge/sync-trace.mjs");
// Flush-policy semantics behind docs/native-bridge/proposal-batched.md (no kernel, no build).




const op = (seq, name, inputs, kernelMs, extra = {}) => ({ seq, name, kind: 'op', inputs, kernelMs, kernelCalls: kernelMs ? 1 : 0, tryDepth: 0, outputs: 1, ...extra });
const read = (seq, name, inputs, extra = {}) => ({ seq, name, kind: 'read', inputs, kernelMs: 0, kernelCalls: 0, tryDepth: 0, ...extra });

// a, b independent; c = a op b; d independent of everything (a diamond plus a free node).
const diamond = { events: [op(0, 'opExtrude', [], 2), op(1, 'opExtrude', [], 3), op(2, 'opBoolean', [0, 1], 10), op(3, 'opExtrude', [], 20)], tryFrames: [] };

test('eager flushes once per op; speculative once per build without geometry reads', () => {
  assert.equal(simulate(diamond, 'eager').flushes, 4);
  const s = simulate(diamond, 'speculative');
  assert.equal(s.flushes, 1);
  assert.equal(s.kernelMsTotal, 35);
  assert.equal(s.kernelMsSpan, 20);            // max(3 + 10, 20)
  assert.equal(s.booleans, 1);
  assert.equal(s.booleanSpan, 1);
});

test('a geometric read of a pending body forces a flush; a structural read does not', () => {
  const run = { events: [op(0, 'opExtrude', [], 1), read(1, 'getProperty', [0]), op(2, 'opExtrude', [], 1),
    read(3, 'evVolume', [2], { geometric: true }), op(4, 'opExtrude', [], 1)], tryFrames: [] };
  const s = simulate(run, 'speculative');
  assert.equal(s.flushes, 2);
  assert.deepEqual(s.batches.map(b => b.reason), ['geometric-read', 'end']);
});

test('conservative policy flushes at try exits and before count-dependent Boolean inputs', () => {
  const run = { events: [op(0, 'opExtrude', [], 1, { tryDepth: 1 }), op(1, 'opExtrude', [], 1, { tryDepth: 1 }),
    op(2, 'opBoolean', [0, 1], 5, { tryDepth: 1 }), op(3, 'opBoolean', [2, 1], 5)], tryFrames: [{ kind: 'try', line: 1, ops: 3, closesAtSeq: 3 }] };
  const c = simulate(run, 'conservative');
  assert.deepEqual(c.batches.map(b => b.reason), ['try-exit', 'end']);
  const noTry = simulate({ ...run, tryFrames: [] }, 'conservative');
  assert.deepEqual(noTry.batches.map(b => b.reason), ['count-dependent-admission', 'end']);
  assert.equal(simulate({ ...run, tryFrames: [] }, 'speculative').flushes, 1);
});

test('speculation counts Boolean mispredictions and catchable errors inside try as replays', () => {
  const run = { events: [op(0, 'opExtrude', [], 1), op(1, 'opExtrude', [], 1), op(2, 'opBoolean', [0, 1], 5, { outputs: 2 }),
    op(3, 'opBoolean', [2, 1], 5, { tryDepth: 1, outputs: undefined, error: { name: 'FeatureScriptError', catchable: true } })], tryFrames: [] };
  const s = simulate(run, 'speculative');
  assert.equal(s.mispredictions, 1);
  assert.equal(s.replays, 1);
});

}
