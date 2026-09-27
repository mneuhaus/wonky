#!/usr/bin/env node
// Scripted, cached build of the native kernel addon (docs/native-bridge.md section 9).
// Nothing it writes is edited by hand:
//
//   1. op list of the set (slice-ops.mjs), each op's loadKernel() slot from the
//      wiring of loadJsKernel() in src/kernel.mjs, import closure of the op
//      modules, SOURCE_HASH over routing + wiring + closure + scripts + bx
//      driver + vendored headers + bend.lock.json + toolchain (src/native/build-key.mjs)
//   2. cache hit (tmp/native-bridge/cache/<sourceHash>/manifest.json): update
//      the <set>.json pointer and stop
//   3. otherwise, under a lock (one compile at a time):
//        gen-wire.mjs writeGenerated -> wire.{bend,mjs,json}   (exact U32 codecs, dispatch)
//        entry.bend                  -> kcall(op, words) = W.dispatch(op, words), main reaches it
//        bend entry.bend -o kernel.c (stock Bend 2.0.25 emitter, unedited)
//        kernel_ops.h                -> BX_SLICE, BX_KCALL_FID, hashes, op names
//        kernel_addon.c              -> bx_pre.h + kernel.c + kernel_ops.h + bx_addon.c (one TU)
//        clang <pinned flags> -bundle  -> wonky-kernel.node
//        set planar only: bend kernel/hybrid/native.bend -o hybrid.c and
//        clang <pinned flags> -> wonky-hybrid, the subprocess that serves
//        loadKernel().hybrid (plan step 11a; src/native/hybrid-process.mjs).
//        It carries the same source hash; its device calls ('!') run on the
//        CPU pool of its own process, never inside Node
//   4. refuse loudly on: a native width warning from the generator, bend errors,
//      a missing FID_KCALL, an arity mismatch, a non-list signature, BANGS != 0,
//      or a smoke-test failure. The smoke test runs in a child process: info()
//      hashes and op names must match, the captured production calls of
//      src/native/smoke-calls.json.gz (tracked copy of
//      out/performance/native-build123d/captured.json) must replay bit-exact,
//      and a request cut at any count word (wire-probe.mjs) must be refused
//      with the same heap pages whether it claims 1 or 2^16 elements;
//      wonky-hybrid must answer the jobs of src/native/smoke-hybrid.json.gz
//      (answer, corefine mesh text, carrier classes) byte for byte as the JS
//      target did.
//   5. atomic rename into the cache, manifest.json with times, sizes and load
//      averages, pointer update, keep the last 3 builds per set.
//
// usage: node scripts/native-bridge/build-native.mjs --set planar|full [--cache DIR]
//        node scripts/native-bridge/build-native.mjs --smoke DIR   (internal: child-process smoke test)
import { spawnSync } from 'node:child_process';
import { closeSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync, writeSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { gunzipSync } from 'node:zlib';
import { writeGenerated } from './gen-wire.mjs';
import { SMOKE_CALLS_FILE, SMOKE_HYBRID_FILE } from './slice-inputs.mjs';
import { countProbes } from './wire-probe.mjs';
import { HYBRID_DRIVER, HYBRID_HOSTED, SLICE_OPS, checkSlice, fullOps, namespaces, opTable, surfaceTable, wiring } from './slice-ops.mjs';
import { runHybridProcess, HYBRID_FILE } from '../../src/native/hybrid-process.mjs';
import { API_VERSION, BUILD_INPUTS, CLANG_FLAGS, EXE_LINK_FLAGS, LINK_FLAGS, bendClosure, bendPaths, computeSourceHash, hashFile, probeToolchain, sha256, statInputs, touchedInputs } from '../../src/native/build-key.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const NODE_FILE = 'wonky-kernel.node';
const KEEP = 3;

class BuildError extends Error {}
const refuse = message => { throw new BuildError(message); };
const uptime = () => {
  const text = spawnSync('uptime', { encoding: 'utf8' }).stdout.trim();
  const m = /load averages?:\s*([\d.]+),?\s+([\d.]+),?\s+([\d.]+)/.exec(text);
  return { text, one: m ? Number(m[1]) : null, five: m ? Number(m[2]) : null, fifteen: m ? Number(m[3]) : null };
};
const writeAtomic = (path, text) => {
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, path);
};

export function setOps(set) {
  if (set === 'planar') {
    const check = checkSlice();
    if (!check.ok) refuse(`slice entry set disagrees with the profile call files: missing ${check.missing.join(', ') || '-'}, unused ${check.unused.join(', ') || '-'}`);
    return { ops: SLICE_OPS, table: opTable(SLICE_OPS), hybrid: { driver: HYBRID_DRIVER, namespace: 'hybrid', hosted: [...HYBRID_HOSTED] } };
  }
  if (set === 'full') {
    const ops = fullOps();
    const places = new Map(surfaceTable().map(e => [e.entry, e]));
    return { ops, table: ops.map((spec, id) => {
      const p = places.get(`kernel/${spec}`);
      return { id, spec, entry: `kernel/${spec}`, scope: p.scope, namespace: p.namespace, key: p.key,
        label: p.namespace ? `${p.namespace}.${p.key}` : p.key };
    }) };
  }
  return refuse(`unknown set '${set}' (known: planar, full)`);
}

// bend.lock.json pins the release archive; the installed binary, its library
// tree (Base, effect files the emitter splices in) and clang are probed here.
export function toolchain() {
  try { return probeToolchain(root); }
  catch (error) { return refuse(error.message); }
}

// Everything the build key covers, computed without generating anything. The
// routing (op table, namespaces, refusal names) and the wiring are part of the
// key, so the loader recomputes the key from the manifest's routing and the
// current src/kernel.mjs and refuses a build whose routing was edited or whose
// namespace now points to another module.
export function buildKey(set) {
  const { ops, table, hybrid = null } = setOps(set);
  const modules = [...new Set([...ops.map(spec => join('kernel', spec.split(':')[0])), ...(hybrid ? [hybrid.driver] : [])])];
  const closure = bendClosure(root, modules);
  const paths = [...new Set([...closure, ...BUILD_INPUTS])].sort();
  const files = paths.map(path => ({ path, sha256: hashFile(root, path) }));
  const absent = files.filter(f => f.sha256 === null).map(f => f.path);
  if (absent.length) refuse(`build inputs missing: ${absent.join(', ')} (run node scripts/native-bridge/vendor-node-api.mjs for the headers)`);
  const { toolchain: tools, probe } = toolchain();
  const route = { set, ops: table, namespaces: namespaces(), surface: surfaceTable(), hybrid, wiring: wiring() };
  return { ...route, specs: ops, table, files, closure, toolchain: tools, probe, sourceHash: computeSourceHash({ ...route, files, toolchain: tools }) };
}

// ---------------------------------------------------------------- hybrid subprocess

// wonky-hybrid: the stock emitter's C of the driver, compiled as an executable
// with the pinned flags. A one-line wrapper TU puts the source hash into the
// binary (the loader checks it, as for the addon); the emitted C is unedited.
function buildHybrid(key, staging) {
  const t0 = performance.now();
  const bend = spawnSync(bendPaths(root).bin, [join(root, key.hybrid.driver), '-o', 'hybrid.c'], { cwd: staging, encoding: 'utf8',
    env: { ...process.env, BEND_NO_TELEMETRY: '1' }, maxBuffer: 64 * 1024 * 1024, timeout: 30 * 60 * 1000 });
  const bendSeconds = (performance.now() - t0) / 1000;
  const bendOutput = `${bend.stdout ?? ''}${bend.stderr ?? ''}`.trim();
  if (bend.status !== 0) refuse(`bend ${key.hybrid.driver} -o hybrid.c failed (status ${bend.status ?? bend.signal}): ${bendOutput.split('\n').slice(-5).join(' | ')}`);
  if (/warn/i.test(bendOutput)) refuse(`bend emitted warnings for the hybrid driver: ${bendOutput}`);
  const cText = readFileSync(join(staging, 'hybrid.c'), 'utf8');
  const bangs = /^#define BANGS\s+(\d+)/m.exec(cText) ?? refuse('hybrid.c: no BANGS define');
  if (!/^#define FID_MAIN \d+$/m.test(cText)) refuse('hybrid.c: no FID_MAIN (the driver has no main)');
  writeFileSync(join(staging, 'hybrid_main.c'), [
    '// GENERATED by scripts/native-bridge/build-native.mjs. Do not edit.',
    `__attribute__((used)) static const char wonky_hybrid_source_hash[] = ${cString(key.sourceHash)};`,
    `#include "${join(staging, 'hybrid.c')}"`,
    '',
  ].join('\n'));
  const t1 = performance.now();
  const clang = spawnSync('clang', [...CLANG_FLAGS, join(staging, 'hybrid_main.c'), ...EXE_LINK_FLAGS, '-o', join(staging, HYBRID_FILE)],
    { cwd: staging, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 60 * 60 * 1000 });
  const clangSeconds = (performance.now() - t1) / 1000;
  const clangOutput = `${clang.stdout ?? ''}${clang.stderr ?? ''}`.trim();
  if (clang.status !== 0) refuse(`clang failed for wonky-hybrid (status ${clang.status ?? clang.signal}): ${clangOutput.split('\n').slice(-8).join(' | ')}`);
  const bytes = readFileSync(join(staging, HYBRID_FILE));
  if (!bytes.includes(key.sourceHash, 0, 'latin1')) refuse('wonky-hybrid does not carry the source hash');
  return { file: HYBRID_FILE, driver: key.hybrid.driver, namespace: key.hybrid.namespace, hosted: key.hybrid.hosted,
    bytes: bytes.length, sha256: sha256(bytes), cBytes: Buffer.byteLength(cText), bangs: Number(bangs[1]),
    link: [...EXE_LINK_FLAGS], seconds: { bend: bendSeconds, clang: clangSeconds }, bendOutput, clangOutput };
}

// ---------------------------------------------------------------- lock

// One compile at a time. A lock whose holder is gone is taken over; a live
// holder is waited for (WONKY_NATIVE_LOCK_WAIT_MS, default 45 minutes), then refused.
function acquireLock(cache) {
  const path = join(cache, '.build.lock');
  const started = Date.now(), patience = Number(process.env.WONKY_NATIVE_LOCK_WAIT_MS ?? 45 * 60 * 1000);
  let told = 0;
  for (;;) {
    try {
      const fd = openSync(path, 'wx');
      writeSync(fd, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }));
      closeSync(fd);
      return () => rmSync(path, { force: true });
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      let holder = null;
      try { holder = JSON.parse(readFileSync(path, 'utf8')); } catch { /* being written */ }
      const alive = holder?.pid && (() => { try { process.kill(holder.pid, 0); return true; } catch { return false; } })();
      if (holder && !alive) { rmSync(path, { force: true }); continue; }
      if (Date.now() - started > patience) refuse(`build lock ${path} held by pid ${holder?.pid}; gave up after ${patience} ms`);
      if (Date.now() - told > 30000) { told = Date.now(); console.error(`build-native: waiting for the build lock held by pid ${holder?.pid}`); }
      spawnSync('sleep', ['1']);
    }
  }
}

// ---------------------------------------------------------------- generation

const ENTRY = `# GENERATED by scripts/native-bridge/build-native.mjs. Do not edit.
import Base
import ./wire.bend as W

# The one def the addon binds: op id as in wire.json, request words ->
# status word (0 ok, 1 malformed request, 2 unknown op) + result words.
def kcall(op: U32, words: List<&2, U32>) -> List<&2, U32>:
  W.dispatch(op, words)

# The addon never runs main. It exists because Bend emits only what main
# reaches; the op id 2^32-1 takes the dispatcher's unknown-op arm.
def main() -> IO(Unit):
  IO.print(U32.show(U32.from_nat(List.length(&2, U32, kcall(4294967295, Nil{})))))
`;

function kindOf(type) {
  const t = type.replace(/\s+/g, '');
  if (t === 'U32') return 'u';
  if (/^List<&2,U32>$/.test(t)) return 'l';
  return null;
}

export function checkEmitted(cText, entryText) {
  const defines = new Map([...cText.matchAll(/^#define ((?:CID|FID)_[A-Z0-9_]+) (\d+)$/gm)].map(m => [m[1], Number(m[2])]));
  const bangs = /^#define BANGS\s+(\d+)/m.exec(cText);
  if (!bangs) refuse('kernel.c: no BANGS define');
  if (Number(bangs[1]) !== 0) refuse(`kernel.c: BANGS ${bangs[1]} != 0 (a GPU '!' call is reachable; the slice build is CPU only)`);
  const sig = /^def kcall\((.*)\)\s*->\s*(.+):\s*$/m.exec(entryText) ?? refuse('entry.bend: no kcall signature');
  const params = sig[1].split(/,(?![^<]*>)/).map(p => p.split(':').slice(1).join(':').trim());
  const kinds = params.map(kindOf);
  if (kinds.join('') !== 'ul' || kindOf(sig[2]) !== 'l') refuse(`kcall signature (${params.join(', ')}) -> ${sig[2]} is not (U32, List<&2, U32>) -> List<&2, U32>`);
  const fid = defines.get('FID_KCALL');
  if (fid === undefined) refuse('kernel.c: FID_KCALL missing; Bend inlined kcall or compiled it into a loop, so it has no entry of its own');
  const arityTable = /^CONSTV u8 FID_ARITY_T\[\] = \{([^}]*)\}/m.exec(cText) ?? refuse('kernel.c: no FID_ARITY_T');
  const arity = arityTable[1].split(',').map(Number)[fid];
  if (arity !== kinds.length) refuse(`kernel.c: FID_KCALL arity ${arity} but kcall has ${kinds.length} parameters (Bend unboxed a parameter)`);
  return { fid, arity, bangs: 0 };
}

// The generator predicts Bend's "arity over 255" refusal; a warning stops the build.
export function checkWireManifest(manifest, table) {
  if (manifest.nativeWidthWarnings.length) refuse(`native width warnings: ${manifest.nativeWidthWarnings.join('; ')}`);
  if (manifest.ops.length !== table.length) refuse(`wire manifest has ${manifest.ops.length} ops, the set has ${table.length}`);
  manifest.ops.forEach((op, i) => {
    if (`${op.def.split(':')[0]}:${op.name}` !== table[i].entry) refuse(`wire op ${i} is ${op.def} ${op.name}, expected ${table[i].entry}`);
  });
}

const cString = s => JSON.stringify(s);

function opsHeader({ key, fid, wireHash, table }) {
  const t = key.toolchain;
  return [
    '// GENERATED by scripts/native-bridge/build-native.mjs. Do not edit.',
    '#define BX_MODULE_NAME "wonky-kernel"',
    '#define BX_HAS_BRIDGE 0',
    '#define BX_SLICE 1',
    `#define BX_KCALL_FID ${fid}`,
    `#define BX_NKOPS ${table.length}u`,
    `#define BX_API_VERSION ${API_VERSION}`,
    `#define BX_SOURCE_HASH ${cString(key.sourceHash)}`,
    `#define BX_WIRE_HASH ${cString(wireHash)}`,
    `#define BX_SET ${cString(key.set)}`,
    `#define BX_BEND ${cString(t.bend)}`,
    `#define BX_CLANG ${cString(t.clang)}`,
    `#define BX_FLAGS ${cString(t.flags.join(' '))}`,
    `#define BX_ARCH ${cString(t.arch)}`,
    'static const char* const BX_KOPS[] = {',
    ...table.map(op => `  ${cString(op.spec)},`),
    '};',
    '',
  ].join('\n');
}

function build(key, cache) {
  const staging = join(cache, `.staging-${key.sourceHash.slice(0, 16)}-${process.pid}`);
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(staging, { recursive: true });
  const loadBefore = uptime();
  const inputsBefore = statInputs(root, key.files);
  try {
    const tGen = performance.now();
    const wire = writeGenerated({ types: [], ops: key.specs, outDir: staging });
    checkWireManifest(wire.manifest, key.table);
    const wireFiles = ['wire.json', 'wire.bend', 'wire.mjs'].map(f => readFileSync(join(staging, f)));
    const wireHash = sha256(Buffer.concat(wireFiles));
    // Baked into wire.mjs so the loader can match codecs, addon and manifest.
    writeFileSync(join(staging, 'wire.mjs'), `${wireFiles[2]}\nexport const WIRE_HASH = ${cString(wireHash)};\nexport const API_VERSION = ${API_VERSION};\nexport const SOURCE_HASH = ${cString(key.sourceHash)};\n`);
    writeFileSync(join(staging, 'entry.bend'), ENTRY);
    const genMs = performance.now() - tGen;

    const tBend = performance.now();
    const bend = spawnSync(bendPaths(root).bin, ['entry.bend', '-o', 'kernel.c'], { cwd: staging, encoding: 'utf8',
      env: { ...process.env, BEND_NO_TELEMETRY: '1' }, maxBuffer: 64 * 1024 * 1024, timeout: 30 * 60 * 1000 });
    const bendSeconds = (performance.now() - tBend) / 1000;
    const bendOutput = `${bend.stdout ?? ''}${bend.stderr ?? ''}`.trim();
    if (bend.status !== 0) refuse(`bend entry.bend -o kernel.c failed (status ${bend.status ?? bend.signal}): ${bendOutput.split('\n').slice(-5).join(' | ')}`);
    if (/warn/i.test(bendOutput)) refuse(`bend emitted warnings: ${bendOutput}`);
    const cText = readFileSync(join(staging, 'kernel.c'), 'utf8');
    const emitted = checkEmitted(cText, ENTRY);

    writeFileSync(join(staging, 'kernel_ops.h'), opsHeader({ key, fid: emitted.fid, wireHash, table: key.table }));
    const binding = join(root, 'src/native/binding');
    writeFileSync(join(staging, 'kernel_addon.c'), [
      '// GENERATED by scripts/native-bridge/build-native.mjs. Do not edit.',
      `#include "${join(binding, 'bx_pre.h')}"`,
      `#include "${join(staging, 'kernel.c')}"`,
      `#include "${join(staging, 'kernel_ops.h')}"`,
      `#include "${join(binding, 'bx_addon.c')}"`,
      '',
    ].join('\n'));
    const tClang = performance.now();
    const clang = spawnSync('clang', [...CLANG_FLAGS, '-I', join(root, 'src/native/include'), join(staging, 'kernel_addon.c'),
      ...LINK_FLAGS, '-o', join(staging, NODE_FILE)], { cwd: staging, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 60 * 60 * 1000 });
    const clangSeconds = (performance.now() - tClang) / 1000;
    const clangOutput = `${clang.stdout ?? ''}${clang.stderr ?? ''}`.trim();
    if (clang.status !== 0) refuse(`clang failed (status ${clang.status ?? clang.signal}): ${clangOutput.split('\n').slice(-8).join(' | ')}`);
    const hybrid = key.hybrid ? buildHybrid(key, staging) : null;
    const loadAfter = uptime();

    const nodeBytes = readFileSync(join(staging, NODE_FILE));
    const manifest = {
      schema: 'wonky-native-kernel/1', generator: 'scripts/native-bridge/build-native.mjs',
      set: key.set, sourceHash: key.sourceHash, wireHash, apiVersion: API_VERSION,
      builtAt: new Date().toISOString(),
      node: { file: NODE_FILE, bytes: nodeBytes.length, sha256: sha256(nodeBytes) },
      wireMjsSha256: sha256(readFileSync(join(staging, 'wire.mjs'))),
      ops: key.table,
      namespaces: key.namespaces,
      surface: key.surface,
      hybrid,
      wiring: key.wiring,
      files: key.files,
      toolchain: key.toolchain,
      toolchainProbe: key.probe,
      command: `node scripts/native-bridge/build-native.mjs --set ${key.set}`,
      emitted: { kcallFid: emitted.fid, arity: emitted.arity, bangs: emitted.bangs, cBytes: Buffer.byteLength(cText), bendOutput },
      seconds: { generate: genMs / 1000, bend: bendSeconds, clang: clangSeconds },
      clangOutput,
      load: { before: loadBefore, after: loadAfter },
    };
    writeFileSync(join(staging, 'manifest.json'), JSON.stringify(manifest, null, 1) + '\n');

    // Smoke test and first load in a child: the runtime is process-global.
    const smoke = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--smoke', staging], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 10 * 60 * 1000 });
    const smokeReport = (() => { try { return JSON.parse(smoke.stdout.trim().split('\n').pop()); } catch { return null; } })();
    if (smoke.status !== 0 || !smokeReport?.ok) refuse(`smoke test failed (exit ${smoke.status ?? smoke.signal}): ${(smoke.stderr || smoke.stdout).trim().split('\n').slice(-6).join(' | ')}`);
    // A second, warm load (the first load of a fresh binary pays macOS' first-use check).
    const warm = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--load-only', staging], { encoding: 'utf8', timeout: 60 * 1000 });
    const warmReport = (() => { try { return JSON.parse(warm.stdout.trim().split('\n').pop()); } catch { return null; } })();
    if (warm.status !== 0 || !warmReport) refuse(`warm load failed: ${(warm.stderr || warm.stdout).trim()}`);
    manifest.smoke = smokeReport;
    manifest.firstLoad = { dlopenMs: smokeReport.dlopenMs, initMs: smokeReport.initMs, load: smokeReport.load };
    manifest.warmLoad = warmReport;
    writeFileSync(join(staging, 'manifest.json'), JSON.stringify(manifest, null, 1) + '\n');

    // The compile read the live files: refuse to publish if any of them was
    // written during the build, even if its bytes are back to the hashed ones.
    const touched = touchedInputs(root, inputsBefore);
    if (touched.length) refuse(`build inputs changed while building (${touched.join(', ')}); rerun the build`);

    const target = join(cache, key.sourceHash);
    rmSync(target, { recursive: true, force: true });
    renameSync(staging, target);
    return manifest;
  } catch (error) {
    rmSync(staging, { recursive: true, force: true });
    throw error;
  }
}

function prune(cache, set, keep) {
  const pointers = readdirSync(cache).filter(f => /^[\w-]+\.json$/.test(f)).map(f => {
    try { return JSON.parse(readFileSync(join(cache, f), 'utf8')).sourceHash; } catch { return null; }
  });
  const builds = readdirSync(cache).filter(d => /^[0-9a-f]{64}$/.test(d)).flatMap(d => {
    try { const m = JSON.parse(readFileSync(join(cache, d, 'manifest.json'), 'utf8')); return m.set === set ? [{ d, at: m.builtAt }] : []; }
    catch { return []; }
  }).sort((a, b) => b.at.localeCompare(a.at));
  const removed = [];
  for (const { d } of builds.slice(keep)) {
    if (pointers.includes(d)) continue;
    rmSync(join(cache, d), { recursive: true, force: true });
    removed.push(d);
  }
  return removed;
}

// A cache entry counts only if its manifest still hashes to its name with the
// current toolchain, its smoke test passed and the binaries (addon and, when
// the set has one, wonky-hybrid) have the recorded bytes.
function cachedManifest(cache, key) {
  const dir = join(cache, key.sourceHash);
  try {
    const m = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
    if (m.sourceHash !== key.sourceHash || !m.smoke?.ok) return null;
    const hybrid = m.hybrid ? { driver: m.hybrid.driver, namespace: m.hybrid.namespace, hosted: m.hybrid.hosted } : null;
    const recomputed = computeSourceHash({ set: m.set, ops: m.ops, namespaces: m.namespaces, surface: m.surface, hybrid, wiring: m.wiring, files: m.files, toolchain: key.toolchain });
    if (recomputed !== key.sourceHash) return null;
    if (sha256(readFileSync(join(dir, m.node.file))) !== m.node.sha256) return null;
    if (m.hybrid && sha256(readFileSync(join(dir, m.hybrid.file))) !== m.hybrid.sha256) return null;
    return m;
  } catch { return null; }
}

export function buildNative({ set, cache = join(root, 'tmp/native-bridge/cache') }) {
  const t0 = performance.now();
  mkdirSync(cache, { recursive: true });
  const key = buildKey(set);
  let manifest = cachedManifest(cache, key), hit = Boolean(manifest), removed = [];
  if (!manifest) {
    const release = acquireLock(cache);
    try {
      manifest = cachedManifest(cache, key);
      hit = Boolean(manifest);
      if (!manifest) {
        manifest = build(key, cache);
        removed = prune(cache, set, KEEP);
      }
    } finally { release(); }
  }
  // The toolchain probe is a cache of file identities that lets the loader skip
  // re-hashing the Bend binary and spawning clang. A cache hit after a reinstall
  // with identical bytes (same key, new identities) refreshes it; the key and
  // everything it covers are unchanged.
  let probeRefreshed = false;
  if (hit && JSON.stringify(manifest.toolchainProbe) !== JSON.stringify(key.probe)) {
    manifest = { ...manifest, toolchainProbe: key.probe, probeRefreshedAt: new Date().toISOString() };
    writeAtomic(join(cache, key.sourceHash, 'manifest.json'), JSON.stringify(manifest, null, 1) + '\n');
    probeRefreshed = true;
  }
  writeAtomic(join(cache, `${set}.json`), JSON.stringify({ set, sourceHash: key.sourceHash, dir: key.sourceHash }) + '\n');
  return { hit, probeRefreshed, manifest, removed, ms: performance.now() - t0, dir: join(cache, key.sourceHash) };
}

// ---------------------------------------------------------------- child modes

async function loadOnly(dir) {
  const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
  const load = uptime();
  const t0 = performance.now();
  const module = { exports: {} };
  process.dlopen(module, join(dir, manifest.node.file));
  const t1 = performance.now();
  module.exports.init({ threads: 1 });
  const t2 = performance.now();
  return { manifest, addon: module.exports, dlopenMs: t1 - t0, initMs: t2 - t1, load };
}

async function smoke(dir) {
  const { manifest, addon, dlopenMs, initMs, load } = await loadOnly(dir);
  const failures = [];
  const info = addon.info();
  const wire = await import(pathToFileURL(join(dir, 'wire.mjs')).href);
  if (info.sourceHash !== manifest.sourceHash) failures.push(`info().sourceHash ${info.sourceHash} != manifest ${manifest.sourceHash}`);
  if (info.wireHash !== manifest.wireHash || wire.WIRE_HASH !== manifest.wireHash) failures.push('wire hash mismatch between info(), wire.mjs and manifest');
  if (info.apiVersion !== API_VERSION || wire.API_VERSION !== API_VERSION) failures.push('API version mismatch');
  if (JSON.stringify(info.ops) !== JSON.stringify(manifest.ops.map(op => op.spec))) failures.push('op names differ between info() and manifest');
  if (info.bangs !== 0) failures.push(`bangs ${info.bangs}`);
  if (info.flags !== CLANG_FLAGS.join(' ')) failures.push(`flags '${info.flags}'`);
  // Status protocol: malformed words -> 1; op out of range -> BX_ARGS before the runtime.
  const empty = addon.call(0, new Uint32Array(0));
  if (empty.length !== 1 || empty[0] !== 1) failures.push(`malformed request answered [${[...empty]}]`);
  try { addon.call(manifest.ops.length, new Uint32Array(0)); failures.push('out-of-range op was not refused'); }
  catch (error) { if (error.code !== 'BX_ARGS') failures.push(`out-of-range op threw ${error.code}`); }
  // Captured production calls replay bit-exact, twice: every call starts on an
  // empty heap (bump page 1) and a repeat reaches exactly the same heap pages.
  if (info.heap !== 'clear') failures.push(`heap mode '${info.heap}' (the slice build clears the heap per call)`);
  const captured = JSON.parse(gunzipSync(readFileSync(join(root, SMOKE_CALLS_FILE))).toString('utf8'));
  const replays = [];
  for (const c of captured.cases) for (const [i, call] of c.calls.entries()) {
    const op = wire.ops.find(o => o.name === `ports/planar-boolean.bend:${call.operation}`);
    if (!op) { failures.push(`captured op ${call.operation} not in this build`); continue; }
    const request = op.encode(call.args);
    const want = wire.codecs[op.result].encode(call.result);
    const runs = [0, 1].map(() => {
      const t = performance.now();
      const reply = addon.call(op.id, request);
      const ms = performance.now() - t;
      const s = addon.stats();
      return { ms, exact: reply[0] === 0 && reply.length === want.length + 1 && want.every((w, k) => reply[k + 1] === w), start: s.lastCallStartPage, pages: s.lastCallPages, replyWords: reply.length };
    });
    const exact = runs.every(r => r.exact);
    if (!exact) failures.push(`${c.id} call ${i} (${call.operation}) is not bit-exact`);
    if (runs.some(r => r.start !== 1) || runs[0].pages !== runs[1].pages) failures.push(`${c.id} call ${i}: heap not cleared between calls (start pages ${runs.map(r => r.start)}, reached ${runs.map(r => r.pages)})`);
    replays.push({ case: c.id, call: i, operation: call.operation, requestWords: request.length, replyWords: runs[0].replyWords, ms: runs[0].ms, repeatMs: runs[1].ms,
      heapPages: runs[0].pages, exact });
  }
  if (!replays.length) failures.push('no captured calls replayed');
  // Count guard: a request cut at any List or String count word and ending in a
  // claim must be refused with the same heap pages whether it claims 1 or 2^16
  // elements (the generated decoder refuses a count the rest cannot carry
  // before decoding one element; test/native-bridge-slice.test.mjs (j) probes 2^32 - 1).
  const wireManifest = JSON.parse(readFileSync(join(dir, 'wire.json'), 'utf8'));
  const tCount = performance.now(), probes = countProbes(wireManifest);
  let countFailures = 0;
  for (const p of probes) {
    const runs = [1, 2 ** 16].map(claim => {
      const reply = addon.call(p.op, Uint32Array.from([...p.prefix, claim]));
      return { status: reply[0], length: reply.length, pages: addon.stats().lastCallPages };
    });
    if (runs.some(r => r.status !== 1 || r.length !== 1) || runs[0].pages !== runs[1].pages) {
      if (++countFailures <= 3) failures.push(`count guard: ${p.name} ${p.path} (${p.type}) claiming 1 / 2^16 elements answered ${runs.map(r => `status ${r.status}, ${r.pages} pages`).join(' / ')}`);
    }
  }
  if (!probes.length) failures.push('count guard: no count words to probe');
  if (countFailures > 3) failures.push(`count guard: ${countFailures - 3} more probes failed`);
  const countGuard = { probes: probes.length, failures: countFailures, ms: performance.now() - tCount };
  const after = addon.call(0, new Uint32Array(0));
  if (after[0] !== 1) failures.push('runtime unusable after the refusals');
  const hybrid = manifest.hybrid ? smokeHybrid(dir, manifest, failures) : null;
  return { ok: failures.length === 0, failures, dlopenMs, initMs, load, info: { ...info, ops: info.ops.length }, replays, countGuard, hybrid, stats: addon.stats() };
}

// wonky-hybrid answers the tracked jobs exactly as the JS target did: the
// answer and corefine's mesh text of mode boolean, the classes of mode classes.
function smokeHybrid(dir, manifest, failures) {
  const { cases } = JSON.parse(gunzipSync(readFileSync(join(root, SMOKE_HYBRID_FILE))).toString('utf8'));
  const binary = join(dir, manifest.hybrid.file), runs = [];
  for (const c of cases) {
    try {
      const b = runHybridProcess({ binary, threads: 1 }, 'boolean', c.job);
      const k = runHybridProcess({ binary, threads: 1 }, 'classes', c.job, c.classes.length);
      const exact = b.answer === c.answer && b.mesh === c.mesh && JSON.stringify(k.classes) === JSON.stringify(c.classes);
      if (!exact) failures.push(`wonky-hybrid ${c.id}: ${b.answer !== c.answer ? 'answer' : b.mesh !== c.mesh ? 'corefine mesh text' : 'carrier classes'} differ from the JS target`);
      runs.push({ case: c.id, exact, jobBytes: c.job.length, answerBytes: b.answer.length, wallMs: b.wallMs, phases: b.phases, classesWallMs: k.wallMs });
    } catch (error) { failures.push(`wonky-hybrid ${c.id}: ${error.message}`); }
  }
  if (!runs.length) failures.push('wonky-hybrid: no smoke job ran');
  return { runs };
}

const args = process.argv.slice(2);
const flag = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    if (args[0] === '--smoke') {
      const report = await smoke(args[1]);
      console.log(JSON.stringify(report));
      process.exitCode = report.ok ? 0 : 1;
    } else if (args[0] === '--load-only') {
      const { dlopenMs, initMs, load } = await loadOnly(args[1]);
      console.log(JSON.stringify({ dlopenMs, initMs, load }));
    } else {
      const known = new Set(['--set', '--cache']);
      args.forEach((a, i) => { if (a.startsWith('--') && !known.has(a)) refuse(`unknown option ${a}`); if (!a.startsWith('--') && !known.has(args[i - 1])) refuse(`unexpected argument ${a}`); });
      const set = flag('--set') ?? refuse('usage: build-native.mjs --set planar|full [--cache DIR]');
      const result = buildNative({ set, ...(flag('--cache') ? { cache: flag('--cache') } : {}) });
      const m = result.manifest;
      console.log(JSON.stringify({ set, hit: result.hit, probeRefreshed: result.probeRefreshed, ms: Math.round(result.ms), dir: relative(root, result.dir), sourceHash: m.sourceHash, wireHash: m.wireHash,
        ops: m.ops.length, seconds: m.seconds, cBytes: m.emitted.cBytes, nodeBytes: m.node.bytes, flags: m.toolchain.flags.join(' '),
        firstLoad: m.firstLoad, warmLoad: m.warmLoad, load: m.load, removed: result.removed }));
    }
  } catch (error) {
    console.error(`build-native: ${error instanceof BuildError ? '' : `${error.name}: `}${error.message}`);
    process.exitCode = 1;
  }
}
