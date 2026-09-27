// Freezes the captured planar-Boolean calls of the spike workloads
// (tmp/rust/planar-spike/calls/<id>.json, written by capture.mjs on the Bend JS
// kernel) into fixtures/rust/planar-spike/:
//   calls/<id>.<k>.req.bin      request words (LE U32) of the generated wire codec
//                               (scripts/native-bridge/gen-wire.mjs, the codec of the
//                               Bend native entry; Real = two F32 words)
//   calls/<id>.<k>.bend.json.gz the Bend JS kernel's result for that call
//   index.json                  the calls, the workload inputs' sha256 and the
//                               capture provenance (rev, clean kernel/, codec hash)
// --check writes nothing: it re-encodes the fresh capture and requires the frozen
// words and results to be identical (exit 1 otherwise).
//   node --max-old-space-size=8192 scripts/rust/planar-spike/freeze.mjs [--check]
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { gunzipSync, gzipSync } from 'node:zlib';
import { writeGenerated } from '../../native-bridge/gen-wire.mjs';
import { WORKLOADS, fixtures, root, work } from './workloads.mjs';

export const OPS = ['ports/planar-boolean.bend:union', 'ports/planar-boolean.bend:subtract'];
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const check = process.argv.includes('--check');

const wireDir = join(work, 'wire');
writeGenerated({ types: [], ops: OPS, outDir: wireDir });
const wire = await import(`file://${join(wireDir, 'wire.mjs')}?${Date.now()}`);
const codecOf = operation => wire.ops[operation === 'union' ? 0 : 1];
const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();

const calls = [];
const differences = [];
mkdirSync(join(fixtures, 'calls'), { recursive: true });
for (const w of WORKLOADS) {
  const captured = JSON.parse(readFileSync(join(work, 'calls', `${w.id}.json`), 'utf8'));
  captured.calls.forEach((call, k) => {
    const codec = codecOf(call.operation);
    const request = codec.encode(call.args);
    const words = Buffer.from(request.buffer, request.byteOffset, request.byteLength);
    const result = JSON.stringify(call.result) + '\n';
    const base = `${w.id}.${k}`;
    const reqFile = join(fixtures, 'calls', `${base}.req.bin`), bendFile = join(fixtures, 'calls', `${base}.bend.json.gz`);
    if (check) {
      if (!existsSync(reqFile) || !words.equals(readFileSync(reqFile))) differences.push(`${base}: request words differ from the fixture`);
      if (!existsSync(bendFile) || gunzipSync(readFileSync(bendFile)).toString('utf8') !== result) differences.push(`${base}: Bend result differs from the fixture`);
    } else {
      writeFileSync(reqFile, words);
      writeFileSync(bendFile, gzipSync(result, { level: 9 }));
    }
    calls.push({ workload: w.id, call: k, operation: call.operation, requestWords: request.length, requestSha256: sha256(words), bendResultSha256: sha256(result), bendStatus: call.result.$ });
  });
}

const index = {
  schema: 'wonky-rust-planar-spike-calls/1',
  purpose: 'K0 (docs/rust-migration.md 6): the decision spike\'s 9 captured planar-Boolean calls, replayed by scripts/rust/planar-spike/compare.mjs against the Rust port',
  capture: {
    rev: git(['rev-parse', 'HEAD']),
    kernelClean: git(['status', '--porcelain', '--', 'kernel', 'src']) === '',
    backend: 'js (loadKernel, WONKY_BACKEND=js)',
    codec: { generator: 'scripts/native-bridge/gen-wire.mjs', ops: OPS, wireMjsSha256: sha256(readFileSync(join(wireDir, 'wire.mjs'))) },
    node: process.versions.node,
  },
  inputs: Object.fromEntries(WORKLOADS.flatMap(w => w.inputs).map(path => [path, sha256(readFileSync(join(root, path)))])),
  workloads: WORKLOADS.map(({ id, argv }) => ({ id, argv: argv.map(a => a.startsWith(root) ? a.slice(root.length) : a) })),
  calls,
};
if (check) {
  const frozen = JSON.parse(readFileSync(join(fixtures, 'index.json'), 'utf8'));
  if (!isDeepStrictEqual(frozen.calls, calls)) differences.push('call list differs from index.json');
  if (!isDeepStrictEqual(frozen.inputs, index.inputs)) differences.push('workload inputs differ from index.json');
  console.log(JSON.stringify({ check: true, calls: calls.length, differences }));
  process.exitCode = differences.length ? 1 : 0;
} else {
  writeFileSync(join(fixtures, 'index.json'), JSON.stringify(index, null, 1) + '\n');
  console.log(JSON.stringify({ frozen: calls.length, dir: fixtures }));
}
