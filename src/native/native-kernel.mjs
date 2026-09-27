// Native kernel backend: the Bend kernel compiled to ARM64 and loaded into this
// Node process as an N-API addon (docs/native-bridge.md, sections 5 and 11).
//
// openNativeBackend() finds the cached build of the validated slice
// (tmp/native-bridge/cache/planar.json -> <sourceHash>/manifest.json) and, before
// anything is loaded, recomputes the build key from the current inputs: the
// recorded files, the loadKernel() wiring parsed from src/kernel.mjs, the
// current toolchain (Bend binary, Bend library, clang) and the manifest's
// routing (op table, namespaces, refusal names). It then checks the binary's
// sha256 and the generated codecs' wire hash. Any difference is a
// NativeKernelStaleError and nothing loads. Then process.dlopen(), init({threads}),
// and info() must carry exactly the recomputed source and wire hashes.
// compatKernel() then mirrors today's loadKernel() namespace: slice entries
// encode their arguments with the generated codecs, run natively and decode to
// exactly the JS target's value shapes; loadKernel().hybrid is served by the
// build's wonky-hybrid subprocess (src/native/hybrid-process.mjs); every other
// entry throws NativeCapabilityError when called. Export-scope ops (the STEP
// pcurve modules) are reached through exportKernels() (backend.mjs). Nothing
// here loads the Bend JS kernel.
//
// Environment: WONKY_NATIVE_THREADS (default 1), WONKY_NATIVE_CACHE (default
// tmp/native-bridge/cache), WONKY_NATIVE_TRACE=<file> (timings per entry,
// written at exit). Only the planar slice build is ever opened; the full
// full-surface build is a measurement artifact, and WONKY_NATIVE_SET with any other
// value is refused.
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { NativeCapabilityError, NativeKernelError, NativeKernelStaleError } from './errors.mjs';
import { API_VERSION, BUILD_COMMAND, CLANG_FLAGS, SLICE_SET, changedFiles, computeSourceHash, currentToolchain, sha256, toolchainChanges, wireHashOf } from './build-key.mjs';
import { KernelWiringError, kernelWiring, wiringChanges } from './kernel-wiring.mjs';
import { budgetSeconds, hybridNamespace, hybridStats } from './hybrid-process.mjs';

export const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
export const defaultCacheRoot = () => process.env.WONKY_NATIVE_CACHE ?? join(projectRoot, 'tmp/native-bridge/cache');
export const TARGET = { native: 'ARM64 native (in-process N-API, planar slice)', diff: 'diff' };
// The routing of the hybrid subprocess as the build key covers it.
const hybridRoute = manifest => manifest.hybrid ? { driver: manifest.hybrid.driver, namespace: manifest.hybrid.namespace, hosted: manifest.hybrid.hosted } : null;
const NODE_FILE = 'wonky-kernel.node'; // the build's fixed binary name, never taken from the manifest

const readJson = (path, what, set) => {
  try { return JSON.parse(readFileSync(path, 'utf8')); }
  catch (error) {
    if (error.code === 'ENOENT') throw new NativeKernelError('BX_LOAD', `no native kernel build for set '${set}' (${what} ${path} is missing); build it with: ${BUILD_COMMAND(set)}`);
    throw new NativeKernelError('BX_LOAD', `unreadable ${what} ${path}: ${error.message}; rebuild with: ${BUILD_COMMAND(set)}`);
  }
};

// Only the validated slice is ever opened. WONKY_NATIVE_SET exists for no
// production purpose; a value other than the slice is refused, never honoured
// and never ignored.
export function sliceSet(value = process.env.WONKY_NATIVE_SET) {
  if (value !== undefined && value !== SLICE_SET) {
    throw new NativeKernelError('BX_BACKEND', `WONKY_NATIVE_SET=${value} is not supported: WONKY_BACKEND=native|diff only opens the validated '${SLICE_SET}' slice build ` +
      `(the full build is a measurement artifact, never wired into production); unset WONKY_NATIVE_SET`);
  }
  return SLICE_SET;
}

export function locateBuild({ cacheRoot = defaultCacheRoot(), set } = {}) {
  if (set !== undefined && set !== SLICE_SET) throw new NativeKernelError('BX_BACKEND', `only the '${SLICE_SET}' slice build can be opened (asked for '${set}')`);
  set = sliceSet();
  const pointer = readJson(join(cacheRoot, `${set}.json`), 'build pointer', set);
  if (!/^[0-9a-f]{64}$/.test(pointer.sourceHash ?? '')) throw new NativeKernelError('BX_LOAD', `invalid build pointer for set '${set}' in ${cacheRoot}; rebuild with: ${BUILD_COMMAND(set)}`);
  const dir = join(cacheRoot, pointer.sourceHash);
  const manifest = readJson(join(dir, 'manifest.json'), 'manifest', set);
  return { dir, manifest, pointer, set };
}

// The build key recomputed from what is on disk now. Returns the verified
// hashes and the recomputation's timings; throws NativeKernelStaleError (with
// every changed input and the build command) before anything is loaded.
export function staleCheck({ dir, manifest, pointer, set }, { root = projectRoot } = {}) {
  const t0 = performance.now();
  const command = BUILD_COMMAND(set);
  const stale = details => new NativeKernelStaleError({ set, command, ...details });
  if (manifest.set !== set || pointer.sourceHash !== manifest.sourceHash || basename(dir) !== manifest.sourceHash) {
    throw stale({ reason: `manifest ${join(dir, 'manifest.json')} is not the '${set}' build its pointer names (set ${manifest.set}, sourceHash ${String(manifest.sourceHash).slice(0, 12)})` });
  }
  if (!Array.isArray(manifest.files) || !Array.isArray(manifest.ops) || !manifest.toolchain || manifest.node?.file !== NODE_FILE) {
    throw stale({ reason: `manifest ${join(dir, 'manifest.json')} lacks the build key fields of this loader (built by an older build-native.mjs)` });
  }
  // 1. recorded input files
  const changed = changedFiles(root, manifest.files);
  if (changed.length) throw stale({ changed });
  const t1 = performance.now();
  // 2. loadKernel() wiring, parsed from src/kernel.mjs now
  let wiring;
  try { wiring = kernelWiring(root); }
  catch (error) {
    if (error instanceof KernelWiringError) throw stale({ reason: `the loadKernel() wiring cannot be derived: ${error.message}` });
    throw error;
  }
  const t2 = performance.now();
  // 3. toolchain now (Bend binary, Bend library, clang, flags, arch, N-API target)
  const { toolchain, timings } = currentToolchain(root, manifest.toolchainProbe);
  const t3 = performance.now();
  // 4. the key over all of it plus the manifest's routing
  const recomputed = computeSourceHash({ set, ops: manifest.ops, namespaces: manifest.namespaces ?? [], surface: manifest.surface ?? [],
    hybrid: hybridRoute(manifest), wiring, files: manifest.files, toolchain });
  // The manifest's own records of wiring and toolchain must also match: the
  // hash is recomputed from the current values, and an edited record is refused
  // just like a changed input.
  const reasons = [
    ...wiringChanges(manifest.wiring, wiring).map(c => `wiring changed: ${c}`),
    ...toolchainChanges(manifest.toolchain, toolchain).map(c => `toolchain changed: ${c}`),
  ];
  if (recomputed !== manifest.sourceHash || reasons.length) {
    if (!reasons.length) reasons.push('the manifest\'s routing (op table, namespaces, refusal names) differs from what the build hashed');
    throw stale({ reason: `build key ${recomputed.slice(0, 12)} vs recorded ${String(manifest.sourceHash).slice(0, 12)}: ${reasons.join('; ')}` });
  }
  const t4 = performance.now();
  // 5. the binary has the recorded bytes and carries this source hash
  const nodePath = join(dir, manifest.node.file);
  let bytes;
  try { bytes = readFileSync(nodePath); }
  catch (error) { throw stale({ reason: `${nodePath} is unreadable (${error.code ?? error.message})` }); }
  if (sha256(bytes) !== manifest.node.sha256) throw stale({ reason: `${nodePath} (${bytes.length} bytes) is not the binary the build recorded (sha256 differs)` });
  if (!bytes.includes(manifest.sourceHash, 0, 'latin1')) throw stale({ reason: `${nodePath} does not carry source hash ${manifest.sourceHash.slice(0, 12)}` });
  const t5 = performance.now();
  // 6. the generated codecs hash to the wire hash the binary was built with
  let wireHash = null;
  try { wireHash = wireHashOf(dir); } catch { /* reported below */ }
  if (wireHash === null || wireHash !== manifest.wireHash || !bytes.includes(wireHash, 0, 'latin1')) {
    throw stale({ reason: `generated codecs in ${dir} (wire.json, wire.bend, wire.mjs) do not hash to the wire hash the binary was built with` });
  }
  // 7. the hybrid subprocess has the recorded bytes and carries this source hash
  if (manifest.hybrid) {
    const hybridPath = join(dir, manifest.hybrid.file);
    let hybridBytes;
    try { hybridBytes = readFileSync(hybridPath); }
    catch (error) { throw stale({ reason: `${hybridPath} is unreadable (${error.code ?? error.message})` }); }
    if (sha256(hybridBytes) !== manifest.hybrid.sha256) throw stale({ reason: `${hybridPath} (${hybridBytes.length} bytes) is not the wonky-hybrid binary the build recorded (sha256 differs)` });
    if (!hybridBytes.includes(manifest.sourceHash, 0, 'latin1')) throw stale({ reason: `${hybridPath} does not carry source hash ${manifest.sourceHash.slice(0, 12)}` });
  }
  const t6 = performance.now();
  if (manifest.toolchain.arch !== process.arch || manifest.toolchain.platform !== process.platform) {
    throw new NativeKernelError('BX_ABI', `build is ${manifest.toolchain.platform}-${manifest.toolchain.arch}, this process is ${process.platform}-${process.arch}; rebuild with: ${command}`);
  }
  if (!(Number(process.versions.napi) >= manifest.toolchain.napi)) {
    throw new NativeKernelError('BX_ABI', `build targets N-API ${manifest.toolchain.napi}, this Node offers ${process.versions.napi}`);
  }
  return { sourceHash: recomputed, wireHash, nodeSha256: manifest.node.sha256,
    timings: { filesMs: t1 - t0, wiringMs: t2 - t1, toolchainMs: t3 - t2, keyMs: t4 - t3, nodeMs: t5 - t4, wireMs: t6 - t5, ...timings } };
}

function threadCount(value = process.env.WONKY_NATIVE_THREADS ?? '1') {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 64) throw new NativeKernelError('BX_ARGS', `WONKY_NATIVE_THREADS must be an integer in 1..64 (got '${value}')`);
  return n;
}

const fromAddon = (error, what) => error instanceof NativeKernelError ? error
  : new NativeKernelError(typeof error?.code === 'string' && error.code.startsWith('BX_') ? error.code : 'BX_ABI', `${what}: ${error?.message ?? error}`, { cause: error });

const STATUS = { 1: 'malformed request words', 2: 'unknown op' };

// The Bend runtime inside an addon is process-global and initialises once, so
// one opened backend per addon file is shared by every caller in the process.
const opened = new Map();

// The Level-1 interface: call(op, Uint32Array) -> Uint32Array ([0, ...result]).
// Every open re-runs the stale check, before anything is loaded.
export async function openNativeBackend(options = {}) {
  const t0 = performance.now();
  const located = locateBuild(options);
  const t1 = performance.now();
  const verified = staleCheck(located, options);
  const t2 = performance.now();
  const threads = threadCount(options.threads);
  const path = join(located.dir, located.manifest.node.file);
  if (!opened.has(path)) opened.set(path, openAddon(located, verified, threads, [t0, t1, t2]));
  const backend = await opened.get(path);
  if (backend.threads !== threads) throw new NativeKernelError('BX_ABI', `this process already runs ${path} with ${backend.threads} thread(s); asked for ${threads}`);
  return backend;
}

async function openAddon(located, verified, threads, [t0, t1, t2]) {
  const { dir, manifest, set } = located;
  const module = { exports: {} };
  try { process.dlopen(module, join(dir, manifest.node.file)); }
  catch (error) { throw new NativeKernelError('BX_LOAD', `cannot load ${join(dir, manifest.node.file)}: ${error.message}; rebuild with: ${BUILD_COMMAND(located.set)}`, { cause: error }); }
  const t3 = performance.now();
  const addon = module.exports;
  let initialised;
  try { initialised = addon.init({ threads }); }
  catch (error) { throw fromAddon(error, 'init'); }
  const t4 = performance.now();
  const info = addon.info();
  const mismatch = [
    info.sourceHash !== verified.sourceHash && `sourceHash ${info.sourceHash} (recomputed ${verified.sourceHash})`,
    info.wireHash !== verified.wireHash && `wireHash ${info.wireHash} (recomputed ${verified.wireHash})`,
    info.apiVersion !== API_VERSION && `apiVersion ${info.apiVersion} (loader ${API_VERSION})`,
    info.set !== set && `set ${info.set}`,
    JSON.stringify(info.ops) !== JSON.stringify(manifest.ops.map(op => op.spec)) && 'op table',
    info.flags !== CLANG_FLAGS.join(' ') && `flags '${info.flags}'`,
    info.bangs !== 0 && `bangs ${info.bangs}`,
    info.heap !== 'clear' && `heap mode ${info.heap}`,
    info.threads !== threads && `threads ${info.threads} (asked ${threads})`,
  ].filter(Boolean);
  if (mismatch.length) throw new NativeKernelError('BX_ABI', `addon ${dir} does not match its manifest: ${mismatch.join(', ')}`);
  const t5 = performance.now();
  const wire = await import(pathToFileURL(join(dir, 'wire.mjs')).href);
  if (wire.WIRE_HASH !== info.wireHash || wire.API_VERSION !== API_VERSION || wire.SOURCE_HASH !== manifest.sourceHash ||
      wire.ops.length !== manifest.ops.length || wire.ops.some((op, i) => op.name !== manifest.ops[i].spec || op.id !== i)) {
    throw new NativeKernelError('BX_ABI', `generated codecs ${join(dir, 'wire.mjs')} do not match the addon`);
  }
  const t6 = performance.now();
  const wireManifest = JSON.parse(readFileSync(join(dir, 'wire.json'), 'utf8'));
  return {
    kind: 'native', set, dir, manifest, wire, wireManifest, addon, threads,
    info: { target: TARGET.native, apiVersion: info.apiVersion, wireHash: info.wireHash, sourceHash: info.sourceHash, bend: info.bend, threads, set },
    open: { startedAt: t0, readyAt: t6, locateMs: t1 - t0, staleMs: t2 - t1, stale: verified.timings, dlopenMs: t3 - t2, initMs: t4 - t3, infoMs: t5 - t4,
      wireImportMs: t6 - t5, totalMs: t6 - t0, init: initialised },
    call(op, words) {
      let reply;
      try { reply = addon.call(op, words); }
      catch (error) { throw fromAddon(error, `op ${op}${manifest.ops[op] ? ` (${manifest.ops[op].entry})` : ''}`); }
      if (reply.length === 0 || reply[0] !== 0) {
        const status = reply.length ? reply[0] : 'none';
        throw new NativeKernelError('BX_WIRE', `op ${op}${manifest.ops[op] ? ` (${manifest.ops[op].entry})` : ''} answered status ${status}: ${STATUS[status] ?? 'unknown status'}`, { op, status });
      }
      return reply;
    },
  };
}

// ---------------------------------------------------------------- compat namespace

const slot = (namespace, key) => `${namespace ?? ''}\u0000${key}`;

// Mirrors loadKernel(): the root (topology spread, 'geometry.*' re-exports)
// plus one sub-namespace per loadKernel().X. `then` and symbols are undefined so
// a Promise can resolve to the proxy; every other string key is a function.
// hosted: loadKernel().hybrid keys served by the wonky-hybrid subprocess
// (hybrid-process.mjs). Export-scope ops are not part of this namespace; they
// are reached through exportNamespace().
export function compatKernel({ manifest, backend, member, hosted = null }) {
  const ops = new Map(manifest.ops.filter(op => op.scope !== 'export').map(op => [slot(op.namespace, op.key), op]));
  const hostedNamespace = manifest.hybrid?.namespace ?? null;
  const known = new Map(manifest.surface.filter(e => e.scope === 'kernel').map(e => [slot(e.namespace, e.key), e.entry]));
  const namespaces = new Set(manifest.namespaces);
  const functions = new Map(), children = new Map();
  const refuse = (namespace, key) => {
    const label = namespace ? `${namespace}.${key}` : key;
    const entry = known.get(slot(namespace, key)) ?? `${label} (not a production entry of src/native/surface.json)`;
    return function unavailable() {
      throw new NativeCapabilityError({ entry, label, backend, sourceHash: manifest.sourceHash, set: manifest.set });
    };
  };
  const fn = (namespace, key) => {
    const id = slot(namespace, key);
    if (!functions.has(id)) {
      functions.set(id, ops.has(id) ? member(ops.get(id))
        : hosted && namespace === hostedNamespace && Object.hasOwn(hosted, key) ? hosted[key]
          : refuse(namespace, key));
    }
    return functions.get(id);
  };
  const handler = namespace => ({
    get(_, key) {
      if (typeof key !== 'string' || key === 'then') return undefined;
      if (namespace === null && namespaces.has(key)) {
        if (!children.has(key)) children.set(key, new Proxy(Object.create(null), handler(key)));
        return children.get(key);
      }
      return fn(namespace, key);
    },
    set() { return false; },
    defineProperty() { return false; },
    deleteProperty() { return false; },
  });
  return new Proxy(Object.create(null), handler(null));
}

// A namespace whose every entry is outside the build (the STEP pcurve modules).
export function refusingNamespace({ file, backend, sourceHash = 'unbuilt', set = 'planar' }) {
  return new Proxy(Object.create(null), {
    get(_, key) {
      if (typeof key !== 'string' || key === 'then') return undefined;
      return function unavailable() {
        throw new NativeCapabilityError({ entry: `${file}:${key}`, label: `${file.replace(/^kernel\/|\.bend$/g, '')}.${key}`, backend, sourceHash, set });
      };
    },
    set() { return false; },
  });
}

// The export-scope ops of the kernel opened in this process, by namespace
// (stepPCurves, stepCylinderPCurves): exportKernels() hands out namespaces
// that resolve their entries here when called. src/exporters.mjs imports
// them before loadKernel() opens the build; exports run after it.
const exportMembers = new Map();
export function registerExportOps(manifest, member) {
  for (const op of manifest.ops.filter(o => o.scope === 'export')) exportMembers.set(slot(op.namespace, op.key), { op, fn: member(op) });
}
export function exportNamespace({ file, namespace, backend, sourceHash = 'unbuilt', set = 'planar' }) {
  const refusing = refusingNamespace({ file, backend, sourceHash, set });
  return new Proxy(Object.create(null), {
    get(_, key) {
      if (typeof key !== 'string' || key === 'then') return undefined;
      return function exportEntry(...args) {
        const hit = exportMembers.get(slot(namespace, key));
        return hit ? hit.fn(...args) : refusing[key](...args);
      };
    },
    set() { return false; },
  });
}

// ---------------------------------------------------------------- trace

export function entryStats(manifest) {
  return Object.fromEntries(manifest.ops.map(op => [op.label, { entry: op.entry, op: op.id, calls: 0, encodeMs: 0, nativeMs: 0, decodeMs: 0, requestWords: 0, replyWords: 0 }]));
}

export function writeTraceAtExit(file, snapshot) {
  process.on('exit', () => {
    try { writeFileSync(file, JSON.stringify(snapshot(), null, 1) + '\n'); }
    catch (error) { process.stderr.write(`wonky native trace: cannot write ${file}: ${error.message}\n`); }
  });
}

// ---------------------------------------------------------------- native kernel

export async function openNativeKernel(options = {}) {
  const backend = await openNativeBackend(options);
  const { manifest, wire } = backend;
  const stats = entryStats(manifest);
  const clock = { firstCallAt: null, lastCallEndAt: null };
  const member = op => {
    const codec = wire.ops[op.id], stat = stats[op.label];
    return function nativeEntry(...args) {
      const t0 = performance.now();
      clock.firstCallAt ??= t0;
      let request;
      try { request = codec.encode(args); }
      catch (error) { throw new NativeKernelError('BX_ARGS', `${op.entry} (kernel.${op.label}): the arguments do not fit the wire: ${error.message}`, { op: op.id, entry: op.entry, cause: error }); }
      const t1 = performance.now();
      const reply = backend.call(op.id, request);
      const t2 = performance.now();
      let value;
      try { value = codec.decode(reply); }
      catch (error) { throw new NativeKernelError('BX_WIRE', `${op.entry}: the native reply does not decode: ${error.message}`, { op: op.id, entry: op.entry, cause: error }); }
      const t3 = performance.now();
      stat.calls += 1; stat.encodeMs += t1 - t0; stat.nativeMs += t2 - t1; stat.decodeMs += t3 - t2;
      stat.requestWords += request.length; stat.replyWords += reply.length;
      clock.lastCallEndAt = t3;
      return value;
    };
  };
  const hybrid = manifest.hybrid ? hybridNamespace({ backend: 'native', binary: join(backend.dir, manifest.hybrid.file), threads: backend.threads,
    budgetS: budgetSeconds(), sourceHash: manifest.sourceHash, stats: hybridStats() }) : null;
  registerExportOps(manifest, member);
  const kernel = compatKernel({ manifest, backend: 'native', member, hosted: hybrid?.hosted });
  const trace = () => ({
    schema: 'wonky-native-trace/1', backend: 'native', set: manifest.set, sourceHash: manifest.sourceHash, threads: backend.threads,
    pid: process.pid, open: backend.open, firstCallAt: clock.firstCallAt, lastCallEndAt: clock.lastCallEndAt, exitAt: performance.now(),
    entries: stats, hybrid: hybrid?.stats ?? null, stats: backend.addon.stats(),
  });
  if (process.env.WONKY_NATIVE_TRACE) writeTraceAtExit(process.env.WONKY_NATIVE_TRACE, trace);
  return { kernel, backend, stats, trace };
}
