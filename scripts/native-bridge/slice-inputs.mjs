#!/usr/bin/env node
// Refreshes the tracked build inputs of the native slice that are derived from
// measurement artefacts under out/ and tmp/ (gitignored). The build and the
// loader read only the tracked copies, so a fresh clone builds the addon without
// out/ (docs/native-bridge.md section 11):
//
//   src/native/slice-calls.json     per workload, the kernel entries it calls and
//                                   how often (from the count-kernel-calls.mjs
//                                   files); slice-ops.mjs checkSlice() compares the
//                                   slice's entry list against it
//   src/native/smoke-calls.json.gz  the captured production planarBoolean calls
//                                   (out/performance/native-build123d/captured.json,
//                                   compact JSON, gzip): the build's smoke test
//                                   replays them bit-exact
//   src/native/smoke-hybrid.json.gz two hybrid jobs of the R20 cases (KT6 union,
//                                   first KT2 seat cut; dumped with
//                                   WONKY_HYBRID_DUMP=<dir>) with the JS target's
//                                   answer, corefine mesh text and carrier classes:
//                                   the smoke test of the wonky-hybrid subprocess
//
// Only this script reads out/ (and the hybrid job dumps). Each record names its
// source file and its sha256.
//
//   node scripts/native-bridge/slice-inputs.mjs            rewrite both from out/
//   node scripts/native-bridge/slice-inputs.mjs --check    exit 1 if a tracked copy
//                                                          disagrees with its out/ source
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';
import { sha256 } from '../../src/native/build-key.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
export const SLICE_CALLS_FILE = 'src/native/slice-calls.json';
export const SMOKE_CALLS_FILE = 'src/native/smoke-calls.json.gz';
export const SMOKE_HYBRID_FILE = 'src/native/smoke-hybrid.json.gz';
const HYBRID_JOBS = {
  'r20-kt6-union': 'tmp/r20/native-hybrid/dump/kt6/model_union_step1.job',
  'r20-kt2-seat-cut': 'tmp/r20/native-hybrid/dump/kt2/model_seatCut_step0.job',
};
const CAPTURED = 'out/performance/native-build123d/captured.json';

// Where each workload's count file lives. The six planar workloads come from
// the profile stage (docs/native-bridge/profile.md); the two R20 workloads
// (local design note task 12b) from count runs of the R20 kernel cases with the
// slice workload's command (--format print --deviation-mm 0.01).
export const CALL_SOURCES = {
  'py-planar-union': 'out/native-bridge/profile/calls/py-planar-union.json',
  'py-planar-pocket': 'out/native-bridge/profile/calls/py-planar-pocket.json',
  'py-frame-with-tab': 'out/native-bridge/profile/calls/py-frame-with-tab.json',
  'fs-fuse-g1': 'out/native-bridge/profile/calls/fs-fuse-g1.json',
  'fs-cut-h1': 'out/native-bridge/profile/calls/fs-cut-h1.json',
  'fs-bracket': 'out/native-bridge/profile/calls/fs-bracket.json',
  'r20-kt6': 'out/native-bridge/profile/calls/r20-kt6.json',
  'r20-kt2': 'out/native-bridge/profile/calls/r20-kt2.json',
};

// Count files list re-exported geometry entries under topology.
const profileEntry = name => {
  const m = /^kernel\/topology\.bend:geometry\.(\w+)$/.exec(name);
  return m ? `kernel/geometry.bend:${m[1]}` : name;
};

export function callRecord(path) {
  const bytes = readFileSync(join(root, path));
  const data = JSON.parse(bytes.toString('utf8'));
  if (data.exitCode !== 0) throw new Error(`${path} records exit ${data.exitCode}`);
  const entries = {};
  for (const e of data.entries) {
    if (typeof e.name !== 'string' || !Number.isInteger(e.calls)) throw new Error(`${path}: unexpected entry record`);
    const name = profileEntry(e.name);
    entries[name] = (entries[name] ?? 0) + e.calls;
  }
  const sorted = Object.fromEntries(Object.entries(entries).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  return { source: path, sha256: sha256(bytes), exitCode: data.exitCode, entries: sorted };
}

export function sliceCalls() {
  const workloads = {};
  for (const [id, path] of Object.entries(CALL_SOURCES)) {
    if (!existsSync(join(root, path))) throw new Error(`${path} is missing (count run: WONKY_NB_COUNT_OUT=${path} node --import ./scripts/native-bridge/count-kernel-calls.mjs ...)`);
    workloads[id] = callRecord(path);
  }
  return { schema: 'wonky-native-slice-calls/1', generator: 'scripts/native-bridge/slice-inputs.mjs', workloads };
}

export function smokeCalls() {
  const bytes = readFileSync(join(root, CAPTURED));
  const captured = JSON.parse(bytes.toString('utf8'));
  const text = JSON.stringify({ ...captured, trackedFrom: { source: CAPTURED, sha256: sha256(bytes) } });
  return gzipSync(Buffer.from(text, 'utf8'), { level: 9 });
}

// The JS target's hybrid stages on each job text, as src/hybrid.mjs calls them
// (runHybrid; carrierClasses on the job's face table with n = its face count).
export async function smokeHybrid() {
  const { loadJsKernel } = await import('../../src/kernel.mjs');
  const { runHybrid } = await import('../../src/hybrid.mjs');
  const kernel = await loadJsKernel(), h = kernel.hybrid;
  const cases = [];
  for (const [id, path] of Object.entries(HYBRID_JOBS)) {
    const bytes = readFileSync(join(root, path)), job = bytes.toString('utf8');
    const { text: answer, meshText: mesh } = runHybrid(kernel, job);
    const parsed = h['mesh-io.parse_job'](job);
    if (parsed.$ !== 'Parsed') throw new Error(`${path}: the job does not parse (${parsed.reason})`);
    let n = 0;
    for (let l = parsed.job.faces; l.$ === 'Con'; l = l.tail) n += 1;
    const classes = [];
    for (let l = h['recover/topo.cls.go'](h['recover/topo.surfs.go'](parsed.job.faces, { $: 'Nil' }), n); l.$ === 'Con'; l = l.tail) classes.push(l.head);
    cases.push({ id, source: path, sha256: sha256(bytes), job, answer, mesh, classes });
  }
  const text = JSON.stringify({ schema: 'wonky-native-smoke-hybrid/1', generator: 'scripts/native-bridge/slice-inputs.mjs', cases });
  return gzipSync(Buffer.from(text, 'utf8'), { level: 9 });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const check = process.argv.includes('--check');
  const calls = JSON.stringify(sliceCalls(), null, 1) + '\n';
  const smoke = smokeCalls();
  const hybrid = await smokeHybrid();
  if (check) {
    const problems = [];
    if (readFileSync(join(root, SLICE_CALLS_FILE), 'utf8') !== calls) problems.push(`${SLICE_CALLS_FILE} differs from its out/ sources`);
    if (gunzipSync(readFileSync(join(root, SMOKE_CALLS_FILE))).toString('utf8') !== gunzipSync(smoke).toString('utf8')) problems.push(`${SMOKE_CALLS_FILE} differs from ${CAPTURED}`);
    if (gunzipSync(readFileSync(join(root, SMOKE_HYBRID_FILE))).toString('utf8') !== gunzipSync(hybrid).toString('utf8')) problems.push(`${SMOKE_HYBRID_FILE} differs from the JS target on its jobs`);
    console.log(JSON.stringify({ ok: !problems.length, problems }));
    if (problems.length) process.exitCode = 1;
  } else {
    writeFileSync(join(root, SLICE_CALLS_FILE), calls);
    writeFileSync(join(root, SMOKE_CALLS_FILE), smoke);
    writeFileSync(join(root, SMOKE_HYBRID_FILE), hybrid);
    console.log(JSON.stringify({ written: [SLICE_CALLS_FILE, SMOKE_CALLS_FILE, SMOKE_HYBRID_FILE], smokeBytes: smoke.length, hybridBytes: hybrid.length }));
  }
}
