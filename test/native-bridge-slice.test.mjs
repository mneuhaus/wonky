import { before, test } from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missingBend() || missing("fixtures/r10b/r10b.fs");
if (publicTreeSkip) {
  test("native-bridge-slice.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { spawnSync } = await import("node:child_process");
const { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } = await import("node:fs");
const { tmpdir } = await import("node:os");
const { dirname, join } = await import("node:path");
const { performance } = await import("node:perf_hooks");
const { fileURLToPath } = await import("node:url");
const { SLICE_OPS, SLICE_WORKLOADS, NEGATIVE_WORKLOADS, entryOf, profileCalls, checkSlice } = await import("../scripts/native-bridge/slice-ops.mjs");
const { backendBlock, compareOutputs, diffEvidence, guardPreload, runCli } = await import("../scripts/native-bridge/slice-lib.mjs");
const { checkEmitted, checkWireManifest } = await import("../scripts/native-bridge/build-native.mjs");
const { writeGenerated } = await import("../scripts/native-bridge/gen-wire.mjs");
const { countProbes } = await import("../scripts/native-bridge/wire-probe.mjs");
const { BackendDivergenceError, NativeCapabilityError, NativeKernelError, NativeKernelStaleError } = await import("../src/native/errors.mjs");
const { FeatureScriptError, UnsupportedFeatureError } = await import("../src/errors.mjs");
const { backendInfo, selectBackend } = await import("../src/native/backend.mjs");
const { locateBuild, openNativeBackend, openNativeKernel, staleCheck } = await import("../src/native/native-kernel.mjs");
const { parseKernelWiring } = await import("../src/native/kernel-wiring.mjs");
const { compareReplies, fieldPathAt } = await import("../src/native/diff-kernel.mjs");
// Native vertical slice (docs/native-bridge.md section 11): the ARM64 kernel as
// an in-process N-API addon behind WONKY_BACKEND=native|diff, bit-exact with the
// Bend JS target, and loud about everything outside its 38 entries and the
// hybrid subprocess (16 until the R20 gate added the KT6/KT2 workloads: sketch
// lines, volume, frusta, pierce, the prism Boolean arm, precise, tessellate and the STEP cylinder
// pcurves, plus wonky-hybrid for loadKernel().hybrid; 19 before the W2
// re-baseline: the F32x2 profile ring + polygon prism replaced topology.bend
// extrude/transform and geometry.bend frame/lift_points/translate; 17 until the W2
// integrate fix folded prism translations into extrusions, which left
// polygon-prism.bend:transform unused by the workloads).
//
// Needs the cached build (node scripts/native-bridge/build-native.mjs --set planar;
// `before` runs it, a cache hit takes well under a second). The workload tests
// run the unchanged CLIs in child processes, one at a time; the Python cases use
// the reference venv. The in-process tests share one native runtime (the addon's
// statics are process-global). WONKY_SLICE_TEST_QUICK=1 limits the workload
// tests to fs-bracket and py-planar-union. Fault injection into unchanged CLIs
// goes through scripts/native-bridge/fault-inject.mjs (a --import preload).




















const root = fileURLToPath(new URL('../', import.meta.url));
const work = join(root, 'tmp/native-bridge/slice/test');
const quick = process.env.WONKY_SLICE_TEST_QUICK === '1';
const workloads = quick ? SLICE_WORKLOADS.filter(w => ['fs-bracket', 'py-planar-union'].includes(w.id)) : SLICE_WORKLOADS;
const readJson = path => JSON.parse(readFileSync(path, 'utf8'));
const buildScript = join(root, 'scripts/native-bridge/build-native.mjs');
const faultPreload = join(root, 'scripts/native-bridge/fault-inject.mjs');
const referencePython = join(root, 'out/build123d-performance/reference-venv/bin/python');
let build;

// A throwaway project root for the stale check: every recorded build input,
// src/kernel.mjs (the wiring) and the Bend toolchain (binary as a symlink, so
// its identity is the original's; library copied). Edits here never touch the repo.
function rootCopy(manifest) {
  const copy = mkdtempSync(join(tmpdir(), 'wonky-root-'));
  for (const path of [...manifest.files.map(f => f.path), 'src/kernel.mjs']) {
    mkdirSync(dirname(join(copy, path)), { recursive: true });
    cpSync(join(root, path), join(copy, path));
  }
  const bend = join(copy, '.tools/bend-2.0.25');
  mkdirSync(join(bend, 'bin'), { recursive: true });
  symlinkSync(join(root, '.tools/bend-2.0.25/bin/bend'), join(bend, 'bin/bend'));
  cpSync(join(root, '.tools/bend-2.0.25/bend2'), join(bend, 'bend2'), { recursive: true });
  return copy;
}
// A throwaway copy of the cache entry (pointer + build directory).
function cacheCopy() {
  const cache = mkdtempSync(join(tmpdir(), 'wonky-cache-'));
  cpSync(join(root, 'tmp/native-bridge/cache', build.sourceHash), join(cache, build.sourceHash), { recursive: true });
  cpSync(join(root, 'tmp/native-bridge/cache/planar.json'), join(cache, 'planar.json'));
  return { cache, dir: join(cache, build.sourceHash) };
}
const editJson = (path, edit) => { const value = readJson(path); edit(value); writeFileSync(path, JSON.stringify(value, null, 1)); };

before(() => {
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });
  const run = spawnSync(process.execPath, [buildScript, '--set', 'planar'], { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  assert.equal(run.status, 0, run.stderr);
  build = JSON.parse(run.stdout.trim().split('\n').pop());
});

const guarded = (w, backend, dir, env = {}) => {
  mkdirSync(dir, { recursive: true });
  const guard = join(dir, 'guard.json');
  const run = runCli({ argv: w.args(dir), backend, preloads: [guardPreload], env: { WONKY_SLICE_GUARD_LOG: guard, ...env } });
  return { run, guard: readJson(guard).summary };
};

test('build: 38 ops, hashes, pinned FP flags, times, sizes, load; a second run is a cache hit under 1 s', () => {
  const m = readJson(join(root, 'tmp/native-bridge/cache', build.sourceHash, 'manifest.json'));
  assert.equal(m.ops.length, 38);
  assert.deepEqual(m.ops.map(op => op.spec), SLICE_OPS);
  assert.match(m.sourceHash, /^[0-9a-f]{64}$/);
  assert.match(m.wireHash, /^[0-9a-f]{64}$/);
  assert.ok(m.toolchain.flags.includes('-ffp-contract=off') && m.toolchain.flags.includes('-fno-fast-math'));
  assert.ok(m.seconds.bend > 0 && m.seconds.clang > 0 && m.emitted.cBytes > 0 && m.node.bytes > 0);
  assert.ok(m.load.before.one > 0 && m.load.after.one > 0);
  assert.equal(m.emitted.bangs, 0);
  assert.ok(m.smoke.ok && m.smoke.replays.length === 4 && m.smoke.replays.every(r => r.exact && r.heapPages > 0));
  // the routing is derived from loadJsKernel() and recorded with the toolchain probe
  assert.equal(m.wiring.root, 'topology.bend');
  assert.equal(m.wiring.fields.planarBoolean, 'ports/planar-boolean.bend');
  assert.deepEqual(m.namespaces, Object.keys(m.wiring.fields).sort());
  assert.equal(m.toolchainProbe.bend.sha256, m.toolchain.bendSha256);
  assert.equal(m.toolchainProbe.library.sha256, m.toolchain.bendLibrarySha256);
  assert.equal(m.toolchainProbe.clang.line, m.toolchain.clang);
  const again = spawnSync(process.execPath, [buildScript, '--set', 'planar'], { cwd: root, encoding: 'utf8' });
  const report = JSON.parse(again.stdout.trim().split('\n').pop());
  assert.equal(report.hit, true);
  assert.ok(report.ms < 1000, `cache hit took ${report.ms} ms`);
  assert.ok(checkSlice().ok, 'the 38 entries are exactly those the eight workloads call (hybrid entries served by wonky-hybrid)');
  // a cache hit refreshes an outdated toolchain probe (identities only; the key is unchanged)
  const { cache, dir } = cacheCopy();
  try {
    editJson(join(dir, 'manifest.json'), v => { v.toolchainProbe.bend.identity = 'reinstalled'; });
    const refresh = spawnSync(process.execPath, [buildScript, '--set', 'planar', '--cache', cache], { cwd: root, encoding: 'utf8' });
    const out = JSON.parse(refresh.stdout.trim().split('\n').pop());
    assert.deepEqual([out.hit, out.probeRefreshed, out.sourceHash], [true, true, build.sourceHash]);
    assert.deepEqual(readJson(join(dir, 'manifest.json')).toolchainProbe, m.toolchainProbe);
  } finally { rmSync(cache, { recursive: true, force: true }); }
});

test('build refuses: missing FID, arity mismatch, BANGS != 0, non-list signature, width warning', () => {
  const entry = 'def kcall(op: U32, words: List<&2, U32>) -> List<&2, U32>:\n  W.dispatch(op, words)\n';
  const c = (fid, arity, bangs) => `#define FID_MAIN 0\n${fid === null ? '' : `#define FID_KCALL ${fid}\n`}#define BANGS   ${bangs}\nCONSTV u8 FID_ARITY_T[] = {0,${arity}}\n`;
  assert.deepEqual(checkEmitted(c(1, 2, 0), entry), { fid: 1, arity: 2, bangs: 0 });
  assert.throws(() => checkEmitted(c(null, 2, 0), entry), /FID_KCALL missing/);
  assert.throws(() => checkEmitted(c(1, 3, 0), entry), /arity 3/);
  assert.throws(() => checkEmitted(c(1, 2, 1), entry), /BANGS 1 != 0/);
  assert.throws(() => checkEmitted(c(1, 2, 0), entry.replace('words: List<&2, U32>', 'words: F32')), /is not \(U32, List<&2, U32>\)/);
  const wide = writeGenerated({ types: ['section.bend:PairResolution'], ops: [], outDir: join(work, 'wide') });
  assert.ok(wide.manifest.nativeWidthWarnings.length > 0);
  assert.throws(() => checkWireManifest(wide.manifest, []), /native width warnings/);
});

test('build refuses a smoke-test failure (a copy whose manifest disagrees with info())', { timeout: 120000 }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'wonky-smoke-'));
  try {
    cpSync(join(root, 'tmp/native-bridge/cache', build.sourceHash), dir, { recursive: true });
    const m = readJson(join(dir, 'manifest.json'));
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ ...m, sourceHash: '0'.repeat(64) }));
    const smoke = spawnSync(process.execPath, [buildScript, '--smoke', dir], { encoding: 'utf8', timeout: 110000 });
    assert.equal(smoke.status, 1);
    const report = JSON.parse(smoke.stdout.trim().split('\n').pop());
    assert.equal(report.ok, false);
    assert.match(report.failures.join('\n'), /info\(\)\.sourceHash/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('build: only one compile at a time (a live lock holder makes a second build wait, then refuse)', { timeout: 60000 }, () => {
  const cache = mkdtempSync(join(tmpdir(), 'wonky-lock-'));
  try {
    writeFileSync(join(cache, '.build.lock'), JSON.stringify({ pid: process.pid, at: new Date().toISOString() }));
    const run = spawnSync(process.execPath, [buildScript, '--set', 'planar', '--cache', cache], { encoding: 'utf8', timeout: 50000,
      env: { ...process.env, WONKY_NATIVE_LOCK_WAIT_MS: '1500' } });
    assert.equal(run.status, 1);
    assert.match(run.stderr, /build lock .* held by pid \d+/);
    assert.ok(!readdirSync(cache).some(f => /^[0-9a-f]{64}$/.test(f)), 'nothing was built');
  } finally { rmSync(cache, { recursive: true, force: true }); }
});

for (const w of workloads) {
  // The R20 workloads read Marc's R20 project (read only); without it they are skipped by name.
  const skip = w.external && !existsSync(w.external) ? `R20 case not present: ${w.external}` : false;
  test(`${w.id}: native output is byte-identical to js without loading the JS kernel; diff compares every slice call word for word`, { timeout: 300000, skip }, () => {
    const js = guarded(w, 'js', join(work, w.id, 'js'));
    const native = guarded(w, 'native', join(work, w.id, 'native'));
    assert.equal(js.run.exitCode, 0, js.run.stderr);
    assert.equal(native.run.exitCode, 0, native.run.stderr);
    const same = compareOutputs({ jsDir: join(work, w.id, 'js'), nativeDir: join(work, w.id, 'native'), jsStdout: js.run.stdout, nativeStdout: native.run.stdout });
    assert.ok(same.identical, JSON.stringify(same));
    // the JS target really ran on js, and never on native
    assert.equal(js.guard.jsKernel, true);
    assert.equal(native.guard.jsKernel, false, JSON.stringify(native.guard));
    assert.deepEqual([native.guard.dataUrls, native.guard.compiler, native.guard.bendImports], [0, 0, 0]);
    assert.ok(native.guard.addons.some(a => a.endsWith('/wonky-kernel.node')));
    const block = backendBlock(readFileSync(join(work, w.id, 'native', 'model.brep.json'), 'utf8'));
    assert.deepEqual(block, { language: 'Bend', version: '2.0.25', target: 'ARM64 native (in-process N-API, planar slice)',
      sourceHash: build.sourceHash, wireHash: build.wireHash, threads: 1, precision: block.precision });
    assert.equal(backendBlock(readFileSync(join(work, w.id, 'js', 'model.brep.json'), 'utf8')).target, 'JavaScript');

    const diffDir = join(work, w.id, 'diff'), trace = join(diffDir, 'trace.json');
    mkdirSync(diffDir, { recursive: true });
    const diff = runCli({ argv: w.args(diffDir), backend: 'diff', env: { WONKY_NATIVE_TRACE: trace, WONKY_DIVERGENCE_DIR: join(diffDir, 'divergence') } });
    assert.equal(diff.exitCode, 0, diff.stderr);
    assert.ok(!existsSync(join(diffDir, 'divergence')), 'no divergence dump');
    const counts = profileCalls(w.id), stats = readJson(trace).entries;
    for (const entry of SLICE_OPS.map(entryOf)) {
      const stat = Object.values(stats).find(s => s.entry === entry);
      assert.equal(stat.compared, counts[entry] ?? 0, `${entry}: compared calls vs the profile count run`);
      assert.equal(stat.calls, stat.compared);
    }
    const diffSame = compareOutputs({ jsDir: join(work, w.id, 'js'), nativeDir: diffDir, jsStdout: js.run.stdout, nativeStdout: diff.stdout });
    assert.ok(diffSame.identical, JSON.stringify(diffSame));
  });
}

test('(a) bored-spacer on native exits 1 with a capability error naming the entry and backend; no JS kernel', { timeout: 60000 }, () => {
  const w = NEGATIVE_WORKLOADS.find(x => x.id === 'fs-bored-spacer-print');
  const { run, guard } = guarded(w, 'native', join(work, w.id));
  assert.equal(run.exitCode, 1);
  assert.match(run.stderr, /kernel entry kernel\/\S+\.bend:\w+ \(kernel\.[\w.]+\) is not in the native build [0-9a-f]{12} \(set planar, WONKY_BACKEND=native\)/);
  assert.equal(guard.jsKernel, false);
  assert.ok(!existsSync(join(work, w.id, 'model.stl')), 'nothing exported');
});

test('(a) a revolve inside `try silent` still fails with UnsupportedFeatureError on native', { timeout: 60000 }, () => {
  const dir = join(work, 'try-silent');
  mkdirSync(dir, { recursive: true });
  const source = join(dir, 'try-silent-revolve.fs');
  writeFileSync(source, `FeatureScript 3044;
import(path : "onshape/std/geometry.fs", version : "3044.0");
export function main(context is Context, id is Id, definition is map)
{
    var base = newSketchOnPlane(context, id + "base", { "sketchPlane" : plane(vector(0, 0, 0) * millimeter, vector(0, 0, 1), vector(1, 0, 0)) });
    skRectangle(base, "r", { "firstCorner" : vector(-10, -10) * millimeter, "secondCorner" : vector(10, 10) * millimeter });
    skSolve(base);
    opExtrude(context, id + "box", { "entities" : qSketchRegion(id + "base"), "direction" : vector(0, 0, 1), "endBound" : BoundingType.BLIND, "endDepth" : 4 * millimeter });
    var s = newSketchOnPlane(context, id + "s", { "sketchPlane" : plane(vector(0, 0, 0) * millimeter, vector(0, -1, 0), vector(1, 0, 0)) });
    skRectangle(s, "r", { "firstCorner" : vector(20, 0) * millimeter, "secondCorner" : vector(25, 8) * millimeter });
    skSolve(s);
    try silent(opRevolve(context, id + "ring", { "entities" : qSketchRegion(id + "s"), "axis" : line(vector(0, 0, 0) * millimeter, vector(0, 0, 1)), "angleForward" : 2 * PI * radian }));
}
`);
  // On js the snippet builds both bodies: the refusal below comes from the native build.
  const js = runCli({ argv: ['bin/wonky.mjs', source, '--check'], backend: 'js' });
  assert.equal(js.exitCode, 0, js.stderr);
  assert.equal(js.stdout.split('\n').filter(line => / vertices · /.test(line)).length, 2);
  const probe = `
    const { build } = await import(${JSON.stringify(join(root, 'src/index.mjs'))});
    const { UnsupportedFeatureError } = await import(${JSON.stringify(join(root, 'src/errors.mjs'))});
    const { NativeCapabilityError } = await import(${JSON.stringify(join(root, 'src/native/errors.mjs'))});
    const { readFileSync } = await import('node:fs');
    try { await build(readFileSync(${JSON.stringify(source)}, 'utf8')); console.log(JSON.stringify({ built: true })); }
    catch (error) { console.log(JSON.stringify({ unsupported: error instanceof UnsupportedFeatureError, capability: error instanceof NativeCapabilityError,
      entry: error.entry, backend: error.backend, message: error.message })); }`;
  const guardFile = join(dir, 'guard.json');
  const child = spawnSync(process.execPath, ['--import', guardPreload, '--input-type=module', '-e', probe], { cwd: root, encoding: 'utf8',
    env: { ...process.env, WONKY_BACKEND: 'native', WONKY_SLICE_GUARD_LOG: guardFile } });
  const out = JSON.parse(child.stdout.trim().split('\n').pop());
  assert.equal(out.unsupported, true, JSON.stringify(out));
  assert.equal(out.capability, true);
  assert.equal(out.backend, 'native');
  assert.match(out.entry, /^kernel\/\S+\.bend:\w+$/);
  assert.equal(readJson(guardFile).summary.jsKernel, false);
  const cli = runCli({ argv: ['bin/wonky.mjs', source, '--check'], backend: 'native' });
  assert.equal(cli.exitCode, 1);
  assert.match(cli.stderr, /is not in the native build/);
});

test('(b) r10b fails fast on native at the first non-slice entry, without the JS kernel', { timeout: 60000 }, () => {
  const w = NEGATIVE_WORKLOADS.find(x => x.id === 'fs-r10b-strict');
  const snapshot = readFileSync(join(root, 'fixtures/r10b/r10b.fs'));
  const { run, guard } = guarded(w, 'native', join(work, w.id));
  assert.equal(run.exitCode, 1);
  assert.ok(run.wallMs < 2000, `took ${run.wallMs} ms`);
  assert.match(run.stderr, /is not in the native build/);
  assert.equal(guard.jsKernel, false);
  assert.ok(readFileSync(join(root, 'fixtures/r10b/r10b.fs')).equals(snapshot), 'r10b.fs unchanged');
});

const staleWith = pattern => error => error instanceof NativeKernelStaleError && error.code === 'BX_STALE' && pattern.test(error.message) &&
  error.message.includes('rebuild with: node scripts/native-bridge/build-native.mjs --set planar');

test('(c) a tampered manifest or a changed closure file is a NativeKernelStaleError before anything loads', async () => {
  const opened = [], dlopen = process.dlopen;
  process.dlopen = (...args) => { opened.push(args[1]); return dlopen.apply(process, args); };
  const { cache, dir } = cacheCopy();
  const m = readJson(join(dir, 'manifest.json'));
  const copy = rootCopy(m);
  try {
    // a tampered manifest (its recorded FP flags edited) in a temp copy of the cache entry
    editJson(join(dir, 'manifest.json'), v => { v.toolchain.flags = v.toolchain.flags.filter(f => f !== '-ffp-contract=off'); });
    await assert.rejects(openNativeBackend({ cacheRoot: cache }), staleWith(/toolchain changed: clang flags/));
    // a changed kernel source in a temp copy of the closure
    const located = locateBuild();
    staleCheck(located, { root: copy });
    writeFileSync(join(copy, 'kernel/real.bend'), `${readFileSync(join(copy, 'kernel/real.bend'), 'utf8')}\n# changed\n`);
    assert.throws(() => staleCheck(located, { root: copy }), error => staleWith(/input file\(s\) changed/)(error) && error.changed.includes('kernel/real.bend'));
    assert.deepEqual(opened, [], 'no addon was opened');
  } finally {
    process.dlopen = dlopen;
    rmSync(cache, { recursive: true, force: true });
    rmSync(copy, { recursive: true, force: true });
  }
});

test('(c) the manifest routing, the binary and the codecs are covered: an edit to any of them refuses before dlopen', async () => {
  const opened = [], dlopen = process.dlopen;
  process.dlopen = (...args) => { opened.push(args[1]); return dlopen.apply(process, args); };
  try {
    const cases = [
      ['union and subtract swapped', dir => editJson(join(dir, 'manifest.json'), v => { [v.ops[0].key, v.ops[1].key] = [v.ops[1].key, v.ops[0].key]; }), /routing \(op table, namespaces, refusal names\)/],
      ['op label edited', dir => editJson(join(dir, 'manifest.json'), v => { v.ops[4].label = 'identity.box'; }), /routing/],
      ['namespace dropped', dir => editJson(join(dir, 'manifest.json'), v => { v.namespaces = v.namespaces.filter(n => n !== 'planarBoolean'); }), /routing/],
      ['refusal name edited', dir => editJson(join(dir, 'manifest.json'), v => { v.surface[0].key = 'renamed'; }), /routing/],
      ['wiring record edited', dir => editJson(join(dir, 'manifest.json'), v => { v.wiring.fields.planarBoolean = 'ports/other.bend'; }), /wiring changed: loadKernel\(\)\.planarBoolean/],
      ['node.sha256 zeroed', dir => editJson(join(dir, 'manifest.json'), v => { v.node.sha256 = '0'.repeat(64); }), /is not the binary the build recorded/],
      ['one byte of the binary flipped', dir => { const f = join(dir, 'wonky-kernel.node'), b = readFileSync(f); b[b.length >> 1] ^= 0xff; writeFileSync(f, b); }, /is not the binary the build recorded/],
      ['wire.json edited', dir => { const f = join(dir, 'wire.json'); writeFileSync(f, readFileSync(f, 'utf8').replace('"U32"', '"F32"')); }, /generated codecs .* do not hash to the wire hash/],
      ['wire.mjs edited', dir => { const f = join(dir, 'wire.mjs'); writeFileSync(f, `// edited\n${readFileSync(f, 'utf8')}`); }, /generated codecs/],
      ['pointer names another set', (dir, cache) => editJson(join(dir, 'manifest.json'), v => { v.set = 'full'; }), /is not the 'planar' build its pointer names/],
    ];
    for (const [what, edit, pattern] of cases) {
      const { cache, dir } = cacheCopy();
      try {
        edit(dir, cache);
        await assert.rejects(openNativeBackend({ cacheRoot: cache }), staleWith(pattern), what);
      } finally { rmSync(cache, { recursive: true, force: true }); }
    }
    assert.deepEqual(opened, [], 'no addon was opened');
  } finally { process.dlopen = dlopen; }
});

test('(c) a rewired loadKernel() namespace or an unparseable wiring makes the build stale', () => {
  const m = readJson(join(root, 'tmp/native-bridge/cache', build.sourceHash, 'manifest.json'));
  const copy = rootCopy(m);
  try {
    const located = locateBuild();
    staleCheck(located, { root: copy });
    // the realistic case: a bake-off rewires planarBoolean to a new module
    const next = join(copy, 'kernel/ports/planar-boolean-next.bend');
    writeFileSync(next, readFileSync(join(copy, 'kernel/ports/planar-boolean.bend'), 'utf8').replace('False{})\n', 'True{})\n'));
    const kernelMjs = join(copy, 'src/kernel.mjs'), original = readFileSync(kernelMjs, 'utf8');
    const rewired = original.replace("'../kernel/ports/planar-boolean.bend'", "'../kernel/ports/planar-boolean-next.bend'");
    assert.notEqual(rewired, original);
    writeFileSync(kernelMjs, rewired);
    assert.throws(() => staleCheck(located, { root: copy }),
      staleWith(/wiring changed: loadKernel\(\)\.planarBoolean: kernel\/ports\/planar-boolean\.bend -> kernel\/ports\/planar-boolean-next\.bend/));
    // a new field, and a statement the parser does not know, are refused as well
    writeFileSync(kernelMjs, original.replace('return { ...kernel, analytic,', 'return { ...kernel, extra: analytic, analytic,'));
    assert.throws(() => staleCheck(located, { root: copy }), staleWith(/wiring changed: loadKernel\(\)\.extra: absent -> kernel\/analytic\.bend/));
    writeFileSync(kernelMjs, original.replace('    await registerBendImports();\n', '    await registerBendImports();\n    globalThis.x = 1;\n'));
    assert.throws(() => staleCheck(located, { root: copy }), staleWith(/loadKernel\(\) wiring cannot be derived: .*unrecognised statement/));
    writeFileSync(kernelMjs, original);
    staleCheck(located, { root: copy });
  } finally { rmSync(copy, { recursive: true, force: true }); }
  // the parser itself: a spread that is not first, a duplicate field, a non-binding
  const wrap = body => `export function loadJsKernel() {\n  loaded ??= (async () => {\n    const a = await loadBend(new URL('../kernel/a.bend', import.meta.url));\n    const b = await loadBend(new URL('../kernel/b.bend', import.meta.url));\n    ${body}\n  })();\n  return loaded;\n}\n`;
  assert.deepEqual(parseKernelWiring(`\n${wrap('return { ...a, bee: b };')}`), { root: 'a.bend', fields: { bee: 'b.bend' } });
  assert.throws(() => parseKernelWiring(`\n${wrap('return { b, ...a };')}`), /single, leading spread/);
  assert.throws(() => parseKernelWiring(`\n${wrap('return { ...a, b, b };')}`), /returned twice/);
  assert.throws(() => parseKernelWiring(`\n${wrap('return { ...a, c };')}`), /c, which is not a loadBend\(\) binding/);
});

test('(c) the toolchain is re-checked on every open: Bend library, Bend binary, clang', () => {
  const m = readJson(join(root, 'tmp/native-bridge/cache', build.sourceHash, 'manifest.json'));
  const located = locateBuild();
  let copy = rootCopy(m);
  try {
    staleCheck(located, { root: copy });
    writeFileSync(join(copy, '.tools/bend-2.0.25/bend2/base.bend'), `${readFileSync(join(copy, '.tools/bend-2.0.25/bend2/base.bend'), 'utf8')}\n# edit\n`);
    assert.throws(() => staleCheck(located, { root: copy }), staleWith(/toolchain changed: Bend library \(Base, effect files\)/));
  } finally { rmSync(copy, { recursive: true, force: true }); }
  copy = rootCopy(m);
  try {
    const bin = join(copy, '.tools/bend-2.0.25/bin/bend');
    rmSync(bin);
    writeFileSync(bin, 'not the pinned Bend binary\n');
    assert.throws(() => staleCheck(located, { root: copy }), staleWith(/toolchain changed: Bend binary/));
  } finally { rmSync(copy, { recursive: true, force: true }); }
  // clang: a different compiler first on PATH, in a child (PATH is process-wide)
  const fake = mkdtempSync(join(tmpdir(), 'wonky-clang-'));
  try {
    writeFileSync(join(fake, 'clang'), '#!/bin/sh\necho "fake clang version 99.0.0"\n');
    chmodSync(join(fake, 'clang'), 0o755);
    const probe = `const { openNativeBackend } = await import(${JSON.stringify(join(root, 'src/native/native-kernel.mjs'))});
      try { await openNativeBackend(); console.log(JSON.stringify({ opened: true })); }
      catch (error) { console.log(JSON.stringify({ code: error.code, message: error.message })); }`;
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', probe], { cwd: root, encoding: 'utf8',
      env: { ...process.env, PATH: `${fake}:${process.env.PATH}` } });
    const out = JSON.parse(child.stdout.trim().split('\n').pop());
    assert.equal(out.code, 'BX_STALE', JSON.stringify(out));
    assert.match(out.message, /toolchain changed: clang --version: "[^"]+" -> "fake clang version 99\.0\.0"/);
  } finally { rmSync(fake, { recursive: true, force: true }); }
});

test('(d) a missing build is BX_LOAD with the build command', async () => {
  const empty = mkdtempSync(join(tmpdir(), 'wonky-empty-'));
  await assert.rejects(openNativeBackend({ cacheRoot: empty }), error => error instanceof NativeKernelError && error.code === 'BX_LOAD' &&
    error.message.includes('node scripts/native-bridge/build-native.mjs --set planar'));
  rmSync(empty, { recursive: true, force: true });
  const child = runCli({ argv: ['bin/wonky.mjs', 'examples/bracket.fs', '--check'], backend: 'native', env: { WONKY_NATIVE_CACHE: join(work, 'no-cache-here') } });
  assert.equal(child.exitCode, 1);
  assert.match(child.stderr, /BX_LOAD: no native kernel build for set 'planar'/);
});

test('(e) malformed words and an unknown op are NativeKernelErrors; the runtime keeps working; the proxy refuses what it cannot serve', async () => {
  const backend = await openNativeBackend();
  const { kernel } = await openNativeKernel();
  const max = backend.manifest.ops.find(op => op.spec === 'real.bend:max'), codec = backend.wire.ops[max.id];
  assert.throws(() => backend.call(max.id, Uint32Array.of(1, 2, 3)), error => error instanceof NativeKernelError && error.code === 'BX_WIRE' && error.status === 1);
  assert.throws(() => backend.call(9999, new Uint32Array(0)), error => error instanceof NativeKernelError && error.code === 'BX_ARGS' && /unknown op 9999/.test(error.message));
  assert.throws(() => backend.call(-1, new Uint32Array(0)), { code: 'BX_ARGS' });
  assert.throws(() => backend.call(max.id, [1, 2]), { code: 'BX_ARGS' });
  const R = (hi, lo) => ({ $: 'Real', hi, lo });
  const reply = backend.call(max.id, codec.encode([R(1, 0), R(2, -0)]));
  assert.ok(Object.is(codec.decode(reply).lo, -0), 'a valid call after the refusals, -0 intact');
  // compat proxy: exact value shapes, Promise-safe, refusals by entry name
  assert.deepEqual(kernel.real.max(R(3, 0), R(2, 0)), R(3, 0));
  assert.equal(kernel.then, undefined);
  assert.equal(kernel.analytic.then, undefined);
  assert.equal(kernel[Symbol.iterator], undefined);
  assert.equal(await Promise.resolve(kernel), kernel);
  assert.throws(() => kernel.revolve.sweep(), error => error instanceof NativeCapabilityError && error instanceof UnsupportedFeatureError &&
    error.entry === 'kernel/revolve.bend:sweep' && error.backend === 'native');
  assert.throws(() => kernel.boolean.coaxial(), error => error instanceof NativeCapabilityError && error.entry === 'kernel/boolean.bend:coaxial');
  assert.throws(() => kernel.curvedIntersection.intersect(), NativeCapabilityError);
  assert.throws(() => kernel.analytic.no_such_def(), NativeCapabilityError);
  assert.throws(() => { kernel.extrude = () => 0; }, TypeError);
  // arguments the strict codecs cannot carry exactly are a bridge error, never a silent rounding
  assert.throws(() => kernel.real.max(R(0.1, 0), R(0, 0)), error => error instanceof NativeKernelError && error.code === 'BX_ARGS' && !(error instanceof FeatureScriptError));
  assert.deepEqual(kernel.real.max(R(1, 0), R(0.5, 0)), R(1, 0));
});

// Fix round 2: the generated Bend decoder used to decode a claimed count of
// elements before noticing the request had run out; 4 request bytes claiming
// 2^25 Vec3s pinned 2 GiB of heap pages in the host (and 2^32 - 1 would have
// needed ~270 GB). Probes cut a sample request of every op at every List and
// String count word (scripts/native-bridge/wire-probe.mjs) and append a claim.
test('(j) a count word that claims more than the request carries is refused before decoding: heap pages do not depend on the claim', async () => {
  const backend = await openNativeBackend();
  const { addon, wireManifest } = backend;
  const probes = countProbes(wireManifest);
  assert.ok(probes.length >= 200, `${probes.length} probes`);
  // 17 types and 20 ops since the R20 gate (11 and 13 after the W2 integrate fix; 13 and 14 before)
  assert.equal(new Set(probes.map(p => p.type)).size, 17, 'every List element type and String of the slice is probed');
  assert.equal(new Set(probes.map(p => p.op)).size, 20, 'every op whose request can hold a List or String is probed (not the residuals, max, the frustum family, precise.*, tessellate.*)');
  const call = (op, words) => {
    const reply = addon.call(op, Uint32Array.from(words));
    return { status: reply[0], length: reply.length, pages: addon.stats().lastCallPages };
  };
  const rssBefore = addon.stats().maxRssBytes, t0 = performance.now();
  for (const p of probes) {
    // no word follows the count, so 1 is already impossible: 2^20 and 2^32 - 1 must cost exactly as little
    const runs = [1, 2 ** 20, 0xffffffff].map(claim => call(p.op, [...p.prefix, claim]));
    assert.deepEqual(runs.map(r => [r.status, r.length]), [[1, 1], [1, 1], [1, 1]], `${p.name} ${p.path}`);
    assert.equal(new Set(runs.map(r => r.pages)).size, 1, `${p.name} ${p.path} (${p.type}): heap pages ${runs.map(r => r.pages)} grow with the claimed count`);
  }
  // The rule is count * minWords(element) <= words left: 2^16 elements of at
  // least 2 words each do not fit into the 2^16 words that follow, so the
  // count is refused exactly like an impossible one.
  const K = 2 ** 16, zeros = new Array(K).fill(0);
  const wide = probes.filter(p => p.w >= 2);
  assert.ok(wide.length >= 100, `${wide.length} probes of elements at least 2 words wide`);
  for (const p of wide) {
    const within = call(p.op, [...p.prefix, K, ...zeros]), impossible = call(p.op, [...p.prefix, 0xffffffff, ...zeros]);
    assert.deepEqual([within.status, impossible.status], [1, 1], `${p.name} ${p.path}`);
    assert.equal(within.pages, impossible.pages, `${p.name} ${p.path} (${p.type}, w ${p.w}): a count of ${K} over ${K} words was decoded (${within.pages} pages, refused: ${impossible.pages})`);
  }
  const ms = performance.now() - t0;
  assert.ok(ms < 20000, `${probes.length * 3 + wide.length * 2} probe calls took ${ms.toFixed(0)} ms`);
  // the verifier's reproduction through the backend: BX_WIRE at once, no resident growth
  const box = backend.manifest.ops.find(op => op.spec === 'identity.bend:box_layout');
  assert.throws(() => backend.call(box.id, Uint32Array.of(0x2000000)), error => error instanceof NativeKernelError && error.code === 'BX_WIRE' && error.status === 1);
  const grown = addon.stats().maxRssBytes - rssBefore;
  assert.ok(grown < 64 * 2 ** 20, `max RSS grew by ${(grown / 2 ** 20).toFixed(0)} MiB`);
  // and the runtime keeps serving valid calls
  const max = backend.manifest.ops.find(op => op.spec === 'real.bend:max'), codec = backend.wire.ops[max.id];
  const R = (hi, lo) => ({ $: 'Real', hi, lo });
  assert.deepEqual(codec.decode(backend.call(max.id, codec.encode([R(1, 0), R(2, 0)]))), R(2, 0));
});

// Python user code with a broad except around a Boolean (the verifier's swallow.py).
const SWALLOW_PY = `from build123d import Align, Box, Pos

first = Box(40, 30, 10, align=Align.MIN)
second = Pos(20, 10, 0) * Box(30, 25, 10, align=Align.MIN)
try:
    result = first + second
except Exception as error:
    print("caught:", type(error).__name__, str(error)[:120])
    result = first
`;

test('(e) a native/JS divergence or a bridge error ends the run in both frontends; user code never catches it', { timeout: 180000 }, () => {
  const dir = join(work, 'swallow');
  mkdirSync(dir, { recursive: true });
  const script = join(dir, 'swallow.py');
  writeFileSync(script, SWALLOW_PY);
  const py = out => ['bin/wonky-python.mjs', script, '--python', referencePython, '--out', join(out, 'model')];
  const fault = (kind, op = 'ports/planar-boolean.bend:union') => ({ WONKY_FAULT_OP: op, WONKY_FAULT_KIND: kind, WONKY_FAULT_WORD: '7' });
  // on js the broad except is never needed: the Boolean succeeds
  const js = runCli({ argv: py(join(dir, 'js')), backend: 'js' });
  assert.equal(js.exitCode, 0, js.stderr);
  assert.ok(!js.stdout.includes('caught:'));
  // diff + a flipped reply word: the Python run fails with the divergence, the except never runs
  const d = join(dir, 'diff-py');
  const diffPy = runCli({ argv: py(d), backend: 'diff', preloads: [faultPreload],
    env: { ...fault('flip'), WONKY_DIVERGENCE_DIR: join(d, 'divergence'), WONKY_NATIVE_TRACE: join(d, 'trace.json') } });
  assert.equal(diffPy.exitCode, 1, diffPy.stdout);
  assert.match(diffPy.stderr, /native and JS target diverge in op 0 \(kernel\/ports\/planar-boolean\.bend:union\) at reply word 7/);
  assert.ok(!diffPy.stdout.includes('caught:') && !diffPy.stderr.includes('caught:'), 'the Python except clause never ran');
  assert.ok(!existsSync(join(d, 'model.brep.json')), 'nothing exported');
  // the bench counts divergences from the evidence, not from the exit code
  const evidence = diffEvidence({ dumpDir: join(d, 'divergence'), traceFile: join(d, 'trace.json') });
  assert.equal(evidence.divergences, 1);
  assert.equal(evidence.divergencesInTrace, 1);
  assert.equal(readJson(join(d, 'divergence', evidence.dumps[0], 'meta.json')).entry, 'kernel/ports/planar-boolean.bend:union');
  // native + a refused reply (status 1): BX_WIRE ends the Python run as well
  const nativePy = runCli({ argv: py(join(dir, 'native-py')), backend: 'native', preloads: [faultPreload], env: fault('status') });
  assert.equal(nativePy.exitCode, 1);
  assert.match(nativePy.stderr, /BX_WIRE: op 0 \(kernel\/ports\/planar-boolean\.bend:union\) answered status 1/);
  assert.ok(!nativePy.stdout.includes('caught:') && !nativePy.stderr.includes('caught:'));
  // FeatureScript: the same divergence is fatal
  const fsRun = runCli({ argv: ['bin/wonky.mjs', 'fixtures/public-boolean-regressions/adapted/fuse-g1.fs', '--check'], backend: 'diff', preloads: [faultPreload],
    env: { ...fault('flip'), WONKY_DIVERGENCE_DIR: join(dir, 'diff-fs', 'divergence') } });
  assert.equal(fsRun.exitCode, 1);
  assert.match(fsRun.stderr, /diverge in op 0/);
  // a host that catches the divergence itself still cannot exit 0
  const probe = `
    const { build } = await import(${JSON.stringify(join(root, 'src/index.mjs'))});
    const { readFileSync } = await import('node:fs');
    try { await build(readFileSync(${JSON.stringify(join(root, 'fixtures/public-boolean-regressions/adapted/fuse-g1.fs'))}, 'utf8')); console.log(JSON.stringify({ built: true })); }
    catch (error) { console.log(JSON.stringify({ caught: error.name })); }`;
  const host = spawnSync(process.execPath, ['--import', faultPreload, '--input-type=module', '-e', probe], { cwd: root, encoding: 'utf8',
    env: { ...process.env, BEND_NO_TELEMETRY: '1', WONKY_BACKEND: 'diff', ...fault('flip'), WONKY_DIVERGENCE_DIR: join(dir, 'diff-host', 'divergence') } });
  assert.deepEqual(JSON.parse(host.stdout.trim().split('\n').pop()), { caught: 'BackendDivergenceError' });
  assert.equal(host.status, 1);
  assert.match(host.stderr, /1 divergence\(s\) between the native build and the JS target were raised and caught; exiting 1/);
});

test('(h) every native call starts on an empty heap (no allocator churn across calls)', async () => {
  const backend = await openNativeBackend();
  assert.equal(backend.addon.info().heap, 'clear');
  const { cases } = readJson(join(root, 'fixtures/native-bridge/captured-planar-union.json'));
  const call = cases.find(c => c.id === 'planar-union').calls[0];
  const op = backend.wire.ops.find(o => o.name === `ports/planar-boolean.bend:${call.operation}`);
  const request = op.encode(call.args);
  const before = backend.addon.stats().heapClears;
  const runs = [0, 1, 2].map(() => {
    const reply = backend.call(op.id, request);
    const s = backend.addon.stats();
    return { reply: Buffer.from(reply.buffer).toString('base64'), start: s.lastCallStartPage, pages: s.lastCallPages };
  });
  assert.equal(backend.addon.stats().heapClears - before, 3);
  assert.deepEqual(runs.map(r => r.start), [1, 1, 1], 'each call starts at bump page 1');
  assert.equal(new Set(runs.map(r => r.pages)).size, 1, `every repeat reaches the same heap pages (${runs.map(r => r.pages)})`);
  assert.equal(new Set(runs.map(r => r.reply)).size, 1);
  // the invariant is sensitive: with the old behaviour (heap 'keep', measurement
  // only) the second call starts on the first call's leftovers
  const probe = `
    const { locateBuild, staleCheck } = await import(${JSON.stringify(join(root, 'src/native/native-kernel.mjs'))});
    const { join } = await import('node:path');
    const located = locateBuild(); staleCheck(located);
    const module = { exports: {} };
    process.dlopen(module, join(located.dir, located.manifest.node.file));
    const addon = module.exports;
    addon.init({ threads: 1, heap: 'keep' });
    const request = Uint32Array.from(${JSON.stringify(Array.from(request))});
    const starts = [0, 1].map(() => { addon.call(${op.id}, request); return addon.stats().lastCallStartPage; });
    let refused = null;
    try { addon.init({ threads: 1, heap: 'sometimes' }); } catch (error) { refused = error.code; }
    console.log(JSON.stringify({ heap: addon.info().heap, starts, refused }));`;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', probe], { cwd: root, encoding: 'utf8' });
  const out = JSON.parse(child.stdout.trim().split('\n').pop());
  assert.equal(out.heap, 'keep');
  assert.equal(out.starts[0], 1);
  assert.ok(out.starts[1] > 1, `keep: the second call starts at page ${out.starts[1]}`);
  assert.equal(out.refused, 'BX_ARGS');
});

test('(i) only the validated planar slice is ever opened: WONKY_NATIVE_SET=full is refused, compare fails loudly', { timeout: 60000 }, async () => {
  await assert.rejects(openNativeBackend({ set: 'full' }), error => error instanceof NativeKernelError && error.code === 'BX_BACKEND');
  const run = runCli({ argv: ['bin/wonky.mjs', 'examples/bracket.fs', '--out', join(work, 'set-full', 'model')], backend: 'native', env: { WONKY_NATIVE_SET: 'full' } });
  assert.equal(run.exitCode, 1);
  assert.match(run.stderr, /BX_BACKEND: WONKY_NATIVE_SET=full is not supported/);
  assert.ok(!existsSync(join(work, 'set-full', 'model.brep.json')));
  const planar = runCli({ argv: ['bin/wonky.mjs', 'examples/bracket.fs', '--check'], backend: 'native', env: { WONKY_NATIVE_SET: 'planar' } });
  assert.equal(planar.exitCode, 0, planar.stderr);
  // wonky-compare labels its report 'JavaScript'; on native it can never write one
  const compare = runCli({ argv: ['bin/wonky-compare.mjs', 'examples/compare-before.fs', 'examples/compare-after.fs', '--out', join(work, 'compare', 'report')], backend: 'native' });
  assert.equal(compare.exitCode, 1);
  assert.match(compare.stderr, /is not in the native build [0-9a-f]{12} \(set planar, WONKY_BACKEND=native\)/);
  assert.ok(!existsSync(join(work, 'compare', 'report.json')));
});

test('(f) an invalid WONKY_BACKEND throws', () => {
  assert.throws(() => selectBackend('arm64'), error => error instanceof NativeKernelError && error.code === 'BX_BACKEND');
  assert.throws(() => selectBackend(''), { code: 'BX_BACKEND' });
  assert.equal(selectBackend(undefined), 'js');
  const run = runCli({ argv: ['bin/wonky.mjs', 'examples/bracket.fs', '--check'], backend: 'fast' });
  assert.equal(run.exitCode, 1);
  assert.match(run.stderr, /WONKY_BACKEND must be one of js, native, diff, rust, rust-diff, rust-mixed \(got 'fast'\)/);
});

test('(g) a synthetic mismatch is a BackendDivergenceError with op, word index, field path and a dump', () => {
  const dir = join(root, 'tmp/native-bridge/cache', build.sourceHash);
  const m = readJson(join(dir, 'manifest.json')), wireManifest = readJson(join(dir, 'wire.json'));
  const op = m.ops.find(o => o.spec === 'real.bend:max');
  const dumpDir = join(work, 'divergence');
  const request = Uint32Array.of(0x3f800000, 0, 0x40000000, 0);
  assert.equal(compareReplies({ op, request, nativeReply: Uint32Array.of(0, 0x40000000, 0), jsReply: Uint32Array.of(0, 0x40000000, 0), wireManifest, dumpDir }), 3);
  assert.throws(() => compareReplies({ op, request, nativeReply: Uint32Array.of(0, 0x40000000, 1), jsReply: Uint32Array.of(0, 0x40000000, 0), wireManifest, dumpDir }),
    error => error instanceof BackendDivergenceError && error.op === op.id && error.entry === 'kernel/real.bend:max' && error.wordIndex === 2 &&
      error.fieldPath === 'result.lo (F32)' && existsSync(join(error.dump, 'request.u32')) && existsSync(join(error.dump, 'reply-native.u32')) &&
      readFileSync(join(error.dump, 'reply-js.u32')).length === 12 && readJson(join(error.dump, 'meta.json')).wordIndex === 2);
  const union = m.ops.find(o => o.spec === 'ports/planar-boolean.bend:union');
  // Result tag 0 = Bodies; bodies: 1 Body; its solid's vertices: 1 V3 whose x.hi is word 3
  assert.equal(fieldPathAt(wireManifest, wireManifest.ops[union.id].result, Uint32Array.of(0, 1, 1, 0, 0, 0), 3), 'result<Bodies>.bodies[0].solid.vertices[0].x.hi (F32)');
});

test('default off: without WONKY_BACKEND the backend block is today\'s', { timeout: 60000 }, () => {
  assert.deepEqual(backendInfo({}), { target: 'JavaScript' });
  const dir = join(work, 'default');
  mkdirSync(dir, { recursive: true });
  const run = runCli({ argv: ['bin/wonky.mjs', 'examples/bracket.fs', '--out', join(dir, 'model')], backend: 'js' });
  assert.equal(run.exitCode, 0, run.stderr);
  const text = readFileSync(join(dir, 'model.brep.json'), 'utf8');
  // the bracket is an F32x2 polygon prism since the W2 re-baseline ('F32' before)
  assert.ok(text.includes('\n  "backend": {\n    "language": "Bend",\n    "version": "2.0.25",\n    "target": "JavaScript",\n    "precision": "F32x2"\n  },\n'));
  assert.deepEqual(readdirSync(dir).sort(), ['model.brep.json', 'model.html', 'model.step', 'model.stl']);
});

}
