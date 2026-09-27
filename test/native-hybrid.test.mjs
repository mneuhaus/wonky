import { before, test } from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missingBend();
if (publicTreeSkip) {
  test("native-hybrid.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { spawnSync } = await import("node:child_process");
const { chmodSync, cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = await import("node:fs");
const { tmpdir } = await import("node:os");
const { join } = await import("node:path");
const { fileURLToPath } = await import("node:url");
const { gunzipSync } = await import("node:zlib");
const { HYBRID_HOSTED, SLICE_OPS, SURFACE_FILE, checkSlice, hybridEntry } = await import("../scripts/native-bridge/slice-ops.mjs");
const { SLICE_CALLS_FILE, SMOKE_CALLS_FILE, SMOKE_HYBRID_FILE } = await import("../scripts/native-bridge/slice-inputs.mjs");
const { BUILD_INPUTS } = await import("../src/native/build-key.mjs");
const { BackendDivergenceError, NativeCapabilityError, NativeKernelError, NativeKernelStaleError } = await import("../src/native/errors.mjs");
const { budgetRefusal, budgetSeconds, hybridNamespace, hybridStats, runHybridProcess } = await import("../src/native/hybrid-process.mjs");
const { compatKernel, locateBuild, openNativeKernel, staleCheck } = await import("../src/native/native-kernel.mjs");
const { runHybrid } = await import("../src/hybrid.mjs");
// The hybrid Boolean on WONKY_BACKEND=native|diff (docs/native-bridge.md
// section 14, docs/hybrid-boolean-plan.md step 11a): the wonky-hybrid
// subprocess built with the addon, its host namespace, work budget and named
// refusals, and the tracked build inputs that let a fresh clone build.
//
// Needs the cached build (node scripts/native-bridge/build-native.mjs --set
// planar; `before` runs it, a cache hit takes well under a second). The R20
// end-to-end runs (KT6, KT2 byte-identical on native, 0 divergences on diff)
// are workloads of test/native-bridge-slice.test.mjs.
















const root = fileURLToPath(new URL('../', import.meta.url));
const readJson = path => JSON.parse(readFileSync(path, 'utf8'));
const smoke = () => JSON.parse(gunzipSync(readFileSync(join(root, SMOKE_HYBRID_FILE))).toString('utf8')).cases;
let build, located, binary;

before(() => {
  const run = spawnSync(process.execPath, [join(root, 'scripts/native-bridge/build-native.mjs'), '--set', 'planar'], { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  assert.equal(run.status, 0, run.stderr);
  build = JSON.parse(run.stdout.trim().split('\n').pop());
  located = locateBuild();
  binary = join(located.dir, located.manifest.hybrid.file);
});

test('a fresh clone builds: every build input is tracked (none under out/, none git-ignored)', () => {
  assert.ok(BUILD_INPUTS.includes(SURFACE_FILE) && BUILD_INPUTS.includes(SLICE_CALLS_FILE) && BUILD_INPUTS.includes(SMOKE_CALLS_FILE) && BUILD_INPUTS.includes(SMOKE_HYBRID_FILE));
  const paths = located.manifest.files.map(f => f.path);
  assert.ok(paths.every(p => !p.startsWith('out/') && !p.startsWith('tmp/')), paths.filter(p => p.startsWith('out/') || p.startsWith('tmp/')).join(', '));
  const ignored = spawnSync('git', ['check-ignore', '--no-index', ...paths], { cwd: root, encoding: 'utf8' });
  assert.equal(ignored.stdout.trim(), '', `git-ignored build inputs: ${ignored.stdout}`);
  assert.ok(checkSlice().ok);
});

test(`the build: ${SLICE_OPS.length} addon ops (BANGS 0) plus wonky-hybrid (its own process, same source hash), smoke-tested`, () => {
  const m = located.manifest;
  assert.equal(m.ops.length, SLICE_OPS.length);
  assert.equal(m.emitted.bangs, 0);
  assert.deepEqual(m.hybrid.hosted, [...HYBRID_HOSTED]);
  assert.equal(m.hybrid.driver, 'kernel/hybrid/native.bend');
  assert.ok(m.hybrid.bangs > 0, 'corefine and recover place device calls');
  assert.ok(m.files.some(f => f.path === 'kernel/hybrid/native.bend') && m.files.some(f => f.path === 'kernel/hybrid/corefine/main.bend'));
  assert.ok(readFileSync(binary).includes(build.sourceHash, 0, 'latin1'));
  assert.ok(m.smoke.hybrid.runs.length === 2 && m.smoke.hybrid.runs.every(r => r.exact), JSON.stringify(m.smoke.hybrid));
});

test('wonky-hybrid answers the smoke jobs exactly as the JS target (answer, corefine text, carrier classes)', () => {
  for (const c of smoke()) {
    const b = runHybridProcess({ binary }, 'boolean', c.job);
    assert.equal(b.answer, c.answer, c.id);
    assert.equal(b.mesh, c.mesh, c.id);
    assert.ok(b.phases.meshMs >= 0 && b.phases.finishMs >= 0);
    assert.deepEqual(runHybridProcess({ binary }, 'classes', c.job, c.classes.length).classes, c.classes);
  }
  assert.match(runHybridProcess({ binary }, 'classes', 'not a job', 0).malformed, /./);
});

test('the host namespace gives src/hybrid.mjs runHybrid the JS answer, with the native kernel never loading Bend JS', async () => {
  const { kernel } = await openNativeKernel();
  for (const c of smoke()) {
    const { text, meshText } = runHybrid(kernel, c.job);
    assert.equal(text, c.answer, c.id);
    assert.equal(meshText, c.mesh, c.id);
  }
  // keys outside the served stages refuse by name, like every entry outside the build
  assert.throws(() => kernel.hybrid.boolean('x'), error => error instanceof NativeCapabilityError && /kernel\.hybrid\.boolean/.test(error.message));
});

test('stages out of order, or with foreign values, are named refusals (BX_ARGS)', () => {
  const { hosted } = hybridNamespace({ backend: 'native', binary });
  const refused = (fn, pattern) => assert.throws(fn, error => error instanceof NativeKernelError && error.code === 'BX_ARGS' && pattern.test(error.message));
  refused(() => hosted['mid.go']('ok\n', { kind: 'rjob', job: 'x' }), /expected the rjob value/);
  refused(() => hosted.map({}), /expected the mid value/);
  const job = smoke()[0].job;
  const mid = hosted['mid.go']('ok\nmesh 0 0\nend\n', hosted.rjob(job));
  refused(() => hosted.show(hosted.finish(mid, hosted.map(mid))), /no native run of corefine\/main\.run gave this job/);
  const other = hosted['mid.go']('ok\n', hosted.rjob(job));
  refused(() => hosted.finish(mid, hosted.map(other)), /the map belongs to another stage value/);
  const parsed = hosted['mesh-io.parse_job'](job);
  assert.equal(parsed.$, 'Parsed');
  refused(() => hosted['recover/topo.cls.go'](hosted['recover/topo.surfs.go'](parsed.job.faces, { $: 'Nil' }), 3), /is not the job's face count/);
});

test('work budget: a run over WONKY_HYBRID_BUDGET_S is killed; native answers a named refusal, diff ends the run', () => {
  assert.equal(budgetSeconds(undefined), 120);
  assert.throws(() => budgetSeconds('0'), /positive number/);
  const job = smoke()[1].job;
  assert.equal(runHybridProcess({ binary, budgetS: 0.001 }, 'boolean', job).budget, true);
  const stats = hybridStats();
  const native = hybridNamespace({ backend: 'native', binary, budgetS: 0.001, stats });
  assert.equal(native.hosted['corefine/main.run'](job), budgetRefusal(0.001));
  assert.match(budgetRefusal(0.001), /^unresolved work budget exceeded: .* \(WONKY_HYBRID_BUDGET_S\)\nend\n$/);
  assert.equal(stats.boolean.budget, 1);
  const diff = hybridNamespace({ backend: 'diff', binary, budgetS: 0.001, js: {}, divergence: { first: null, count: 0 } });
  assert.throws(() => diff.hosted['corefine/main.run'](job), error => error instanceof NativeKernelError && error.code === 'BX_BUDGET');
});

test('a failing or missing binary is a NativeKernelError (BX_FAILSTOP, BX_LOAD); Node keeps running', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wonky-hybrid-test-'));
  try {
    const failing = join(dir, 'fail');
    writeFileSync(failing, '#!/bin/sh\necho "boom" >&2\nexit 3\n');
    chmodSync(failing, 0o755);
    assert.throws(() => runHybridProcess({ binary: failing }, 'boolean', 'job'), error => error.code === 'BX_FAILSTOP' && /exited 3: boom/.test(error.message));
    assert.throws(() => runHybridProcess({ binary: join(dir, 'missing') }, 'boolean', 'job'), error => error.code === 'BX_LOAD');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('diff: a differing native answer is a BackendDivergenceError with a dump', () => {
  const dumpDir = mkdtempSync(join(tmpdir(), 'wonky-hybrid-div-'));
  try {
    const c = smoke()[0];
    const js = { 'corefine/main.run': () => c.mesh.replace(/^ok\n/, 'ok\n ') };
    const divergence = { first: null, count: 0 };
    const { hosted } = hybridNamespace({ backend: 'diff', binary, js, divergence, dumpDir, sourceHash: build.sourceHash });
    assert.throws(() => hosted['corefine/main.run'](c.job), error => error instanceof BackendDivergenceError && error.wordIndex === 3 && /corefine mesh text/.test(error.message));
    assert.equal(divergence.count, 1);
    assert.equal(readJson(join(divergence.first.dump, 'meta.json')).charIndex, 3);
    // sticky: every later stage refuses with the same divergence
    assert.throws(() => hosted.rjob(c.job), error => error === divergence.first);
  } finally { rmSync(dumpDir, { recursive: true, force: true }); }
});

test('the stale check covers wonky-hybrid: a changed binary refuses before anything loads', () => {
  const cache = mkdtempSync(join(tmpdir(), 'wonky-cache-'));
  try {
    cpSync(located.dir, join(cache, build.sourceHash), { recursive: true });
    cpSync(join(located.dir, '..', 'planar.json'), join(cache, 'planar.json'));
    const copy = locateBuild({ cacheRoot: cache });
    staleCheck(copy);
    const file = join(copy.dir, 'wonky-hybrid'), bytes = readFileSync(file);
    bytes[bytes.length >> 1] ^= 0xff;
    writeFileSync(file, bytes);
    assert.throws(() => staleCheck(copy), error => error instanceof NativeKernelStaleError && /not the wonky-hybrid binary the build recorded/.test(error.message));
  } finally { rmSync(cache, { recursive: true, force: true }); }
});

test('compatKernel serves hosted keys only in the hybrid namespace', () => {
  const manifest = { ...located.manifest };
  const kernel = compatKernel({ manifest, backend: 'native', member: () => () => 'op', hosted: { rjob: () => 'hosted' } });
  assert.equal(kernel.hybrid.rjob(), 'hosted');
  assert.throws(() => kernel.rjob(), NativeCapabilityError);
  assert.equal(hybridEntry('show'), 'kernel/hybrid/main.bend:show');
});

}
