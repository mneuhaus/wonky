// Correctness references for op 5 (kernel) of the out-of-process baseline:
// the same production kernel compiled to the JS target (reference.cjs, built by
// build-baseline.mjs) and an independently formulated double-precision volume.
import { execFileSync } from 'node:child_process';
import { referenceScript } from './build-baseline.mjs';

export const KIND = Object.freeze({ comparison: 0, boolean: 1 });

export function kernelPayload(kind, depth, count, seed) {
  const payload = Buffer.alloc(16);
  [kind, depth, count, seed].forEach((word, i) => payload.writeUInt32LE(word, 4 * i));
  return payload;
}

const f32 = bits => { const b = Buffer.alloc(4); b.writeUInt32LE(bits); return b.readFloatLE(); };
export const evidenceVolume = evidence => f32(evidence.hiBits) + f32(evidence.loBits);

// Same closed form as expectedVolume in scripts/benchmark-hardware.mjs; the
// batch covers ids start .. start + count * 2^depth - 1.
export function independentVolume(kind, depth, count, start) {
  let sum = 0;
  for (let id = start; id < start + count * 2 ** depth; id++) {
    const h = 8 + (id % 17) / 4, r = 5 + (id % 31) / 16, rb = 1 + (id % 13) / 16, z = (id % 65) / 4;
    sum += kind === KIND.boolean ? Math.PI * (r * r - rb * rb) * h
      : Math.PI * ((r * r + rb * rb) * h - 2 * rb * rb * Math.max(0, h - z));
  }
  return sum;
}

// One JS-target process for all cases: [[kind, depth, count, seed], ...].
export function referenceEvidence(cases) {
  const stdout = execFileSync(process.execPath, [referenceScript, '--', ...cases.flat().map(String)], { encoding: 'utf8', timeout: 120000 });
  const rows = stdout.split('\n').filter(line => line.startsWith('{')).map(line => JSON.parse(line));
  if (rows.length !== cases.length) throw new Error(`reference produced ${rows.length} rows for ${cases.length} cases`);
  return rows;
}

// Exact hash and F32x2 words against the JS target, plus the volume within
// 1e-11 relative (the tolerance used by the hardware benchmark).
export function checkEvidence(evidence, reference, [kind, depth, count, seed]) {
  const expected = independentVolume(kind, depth, count, seed);
  const relativeVolumeError = Math.abs(evidenceVolume(evidence) - expected) / Math.max(1, Math.abs(expected));
  const same = ['hash', 'hiBits', 'loBits', 'errors'].every(key => evidence[key] === reference[key]);
  return { ok: same && evidence.errors === 0 && relativeVolumeError < 1e-11, sameAsJsTarget: same, relativeVolumeError };
}
