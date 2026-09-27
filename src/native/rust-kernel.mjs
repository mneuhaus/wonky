// The Rust kernel behind WONKY_BACKEND=rust | rust-diff | rust-mixed
// (docs/rust-migration.md 3.3, package W0).
//
// openRustBackend() finds the cached addon build (tmp/rust/cache/node.json ->
// <sourceHash>/manifest.json; scripts/rust/build-node.mjs writes it) and,
// before anything is loaded, recomputes the build key from the files on disk
// and the toolchain (src/native/rust-build-key.mjs), checks the binary's
// sha256 and that it carries the source hash. Any difference is a
// NativeKernelStaleError and nothing loads. Then process.dlopen(), init(), and
// info() must carry this source hash, the wire hash and op table of the
// generated JS codecs (src/native/rust-wire.mjs) and no planted feature.
//
// Replies are status words (wonky-wire): 0 ok, 1 malformed, 2 unknown op, 3
// invalid value (NaN/Inf), 5 kernel fault (a panic caught in the addon, or a
// result that does not encode), 6 unavailable (not ported). 6 becomes a
// NativeCapabilityError naming the entry (an UnsupportedFeatureError, so
// FeatureScript `try silent` cannot swallow it); every other nonzero status a
// NativeKernelError, which ends the run.
//
// The hybrid implementations below are disabled in P0; B1 must port entries
// and repair per-build provenance (including direct Bend services) first.
// The three backends:
//   rust        only Rust, wire v2 (binary64). The host serialises reals as
//               binary64 (src/real.mjs, src/kernel.mjs vector): no Math.fround,
//               no F32x2 split. Nothing Bend is loaded; every entry Rust does
//               not serve throws NativeCapabilityError when called.
//   rust-diff   Bend JS (the reference) and Rust on every call, wire v1: the
//               host stays on F32x2 so both kernels see the same words. An
//               entry Rust does not serve throws NativeCapabilityError; Bend
//               never answers in its place. Replies are compared word for word
//               (the JS result re-encoded in v1); the first difference is a
//               BackendDivergenceError with a dump. R3 replaces this exact
//               comparator with the declared per-family bounds.
//   rust-mixed  an explicit op table (src/native/rust-mixed.json, or the file
//               WONKY_RUST_MIXED names) routes the listed entries to Rust (wire
//               v1, F32x2 host), everything else to Bend JS. A Rust refusal is
//               an error, never a fallback to Bend. The table is recorded in
//               brep.json.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { BackendDivergenceError, NativeCapabilityError, NativeKernelError, NativeKernelStaleError } from './errors.mjs';
import { NODE_FILE, buildCommand, computeKey, keyChanges, pointerName, sha256 } from './rust-build-key.mjs';
import { kernelWiring } from './kernel-wiring.mjs';
import * as rustWire from './rust-wire.mjs';
import { registerRustHost } from './rust-host.mjs';

export const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
export const defaultRustCache = () => process.env.WONKY_RUST_CACHE ?? join(projectRoot, 'tmp/rust/cache');
export const MIXED_TABLE = 'src/native/rust-mixed.json';
export const TARGET = { rust: 'Rust (in-process N-API, WC0 v3 host ops + wire v2 leaf entries)', 'rust-diff': 'rust-diff (Bend JS reference + Rust, wire v1)', 'rust-mixed': 'rust-mixed (Rust + Bend JS by op table, wire v1)' };
export const STATUS = Object.freeze({ OK: 0, MALFORMED: 1, UNKNOWN_OP: 2, INVALID: 3, FAULT: 5, UNAVAILABLE: 6 });
const STATUS_TEXT = { 1: 'malformed request', 2: 'unknown op', 3: 'invalid value', 5: 'kernel fault' };

const readJson = (path, what, features) => {
  try { return JSON.parse(readFileSync(path, 'utf8')); }
  catch (error) {
    if (error.code === 'ENOENT') throw new NativeKernelError('BX_LOAD', `no Rust kernel build (${what} ${path} is missing); build it with: ${buildCommand(features)}`);
    throw new NativeKernelError('BX_LOAD', `unreadable ${what} ${path}: ${error.message}; rebuild with: ${buildCommand(features)}`);
  }
};

// features: [] for the production addon; a planted variant (tests) names its features.
export function locateRustBuild({ cacheRoot = defaultRustCache(), features = [] } = {}) {
  const pointer = readJson(join(cacheRoot, pointerName(features)), 'build pointer', features);
  if (!/^[0-9a-f]{64}$/.test(pointer.sourceHash ?? '')) throw new NativeKernelError('BX_LOAD', `invalid Rust build pointer in ${cacheRoot}; rebuild with: ${buildCommand(features)}`);
  const dir = join(cacheRoot, pointer.sourceHash);
  return { dir, pointer, features, manifest: readJson(join(dir, 'manifest.json'), 'manifest', features) };
}

// Recomputes the key from disk; throws NativeKernelStaleError before anything loads.
export function rustStaleCheck({ dir, manifest, pointer, features }, { root = projectRoot } = {}) {
  const command = buildCommand(features);
  const set = features.length ? `rust+${features.join('+')}` : 'rust';
  const stale = details => new NativeKernelStaleError({ set, command, build: `the Rust addon build '${set}'`, ...details });
  if (pointer.sourceHash !== manifest.sourceHash || basename(dir) !== manifest.sourceHash || JSON.stringify(manifest.features) !== JSON.stringify([...features].sort())) {
    throw stale({ reason: `manifest ${join(dir, 'manifest.json')} is not the build its pointer names` });
  }
  const now = computeKey(root, { features });
  if (now.sourceHash !== manifest.sourceHash) {
    const changes = keyChanges(manifest, now);
    throw stale({ reason: `build key ${now.sourceHash.slice(0, 12)} vs recorded ${manifest.sourceHash.slice(0, 12)}: ${changes.join(', ') || 'the recorded key fields differ'}` });
  }
  const path = join(dir, NODE_FILE);
  let bytes;
  try { bytes = readFileSync(path); }
  catch (error) { throw stale({ reason: `${path} is unreadable (${error.code ?? error.message})` }); }
  if (sha256(bytes) !== manifest.node?.sha256) throw stale({ reason: `${path} (${bytes.length} bytes) is not the binary the build recorded (sha256 differs)` });
  if (!bytes.includes(manifest.sourceHash, 0, 'latin1')) throw stale({ reason: `${path} does not carry source hash ${manifest.sourceHash.slice(0, 12)}` });
  return { sourceHash: now.sourceHash, path };
}

function threadCount(value = process.env.WONKY_NATIVE_THREADS ?? '1') {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 64) throw new NativeKernelError('BX_ARGS', `WONKY_NATIVE_THREADS must be an integer in 1..64 (got '${value}')`);
  return n;
}

// The diagnostic String after a nonzero status.
export function replyMessage(reply) {
  if (reply.length < 2 || reply[0] === STATUS.OK || reply[1] > reply.length - 2) return '';
  const codes = reply.subarray(2, 2 + reply[1]);
  return codes.every(c => c <= 0x10ffff) ? String.fromCodePoint(...codes) : '(undecodable message)';
}

const opened = new Map();

export async function openRustBackend(options = {}) {
  const located = locateRustBuild(options);
  const verified = rustStaleCheck(located, options);
  const threads = threadCount(options.threads);
  if (!opened.has(verified.path)) opened.set(verified.path, openAddon(located, verified, threads));
  return opened.get(verified.path);
}

// Wraps a loaded addon; exported for the tests that drive a planted build.
export function rustBackendFromAddon(addon, { sourceHash, dir, threads, open = {} }) {
  const ops = rustWire.ops;
  const info = addon.info();
  return {
    kind: 'rust', addon, dir, ops, threads, sourceHash, wire: rustWire,
    info: { target: TARGET.rust, apiVersion: info.apiVersion, wireHash: info.wireHash, sourceHash: info.sourceHash, threads, set: 'rust', features: info.features },
    open,
    // [0, ...result] or a thrown error named after the entry.
    call(op, words, version = 2, mode = 'rust') {
      const entry = ops[op]?.entry ?? `op ${op}`;
      let reply;
      try { reply = addon.call(op, words, version); }
      catch (error) { throw new NativeKernelError(typeof error?.code === 'string' && error.code.startsWith('BX_') ? error.code : 'BX_ABI', `${entry}: ${error?.message ?? error}`, { op, cause: error }); }
      const status = reply.length ? reply[0] : 'none';
      if (status === STATUS.OK) return reply;
      if (status === STATUS.UNAVAILABLE) {
        throw new NativeCapabilityError({ entry, label: ops[op]?.label ?? entry, backend: mode, sourceHash, set: 'rust' });
      }
      const code = status === STATUS.FAULT ? 'BX_FAULT' : 'BX_WIRE';
      throw new NativeKernelError(code, `${entry} (wire v${version}) answered status ${status} (${STATUS_TEXT[status] ?? 'unknown status'}): ${replyMessage(reply)}`, { op, status, entry });
    },
  };
}

async function openAddon(located, verified, threads) {
  const t0 = performance.now();
  const module = { exports: {} };
  try { process.dlopen(module, verified.path); }
  catch (error) { throw new NativeKernelError('BX_LOAD', `cannot load ${verified.path}: ${error.message}; rebuild with: ${buildCommand(located.features)}`, { cause: error }); }
  const addon = module.exports;
  let init;
  try { init = addon.init({ threads }); }
  catch (error) { throw new NativeKernelError(error?.code ?? 'BX_ABI', `init: ${error.message}`, { cause: error }); }
  const info = addon.info();
  const mismatch = [
    info.sourceHash !== verified.sourceHash && `sourceHash ${info.sourceHash} (recomputed ${verified.sourceHash})`,
    info.wireHash !== rustWire.WIRE_HASH && `wireHash ${info.wireHash} (src/native/rust-wire.mjs ${rustWire.WIRE_HASH})`,
    info.apiVersion !== rustWire.API_VERSION && `apiVersion ${info.apiVersion} (codecs ${rustWire.API_VERSION})`,
    JSON.stringify(info.ops) !== JSON.stringify(rustWire.ops.map(op => op.entry)) && 'op table',
    JSON.stringify(info.features) !== JSON.stringify([...located.features].sort()) && `features [${info.features}] (asked [${located.features}])`,
    info.threads !== threads && `threads ${info.threads} (asked ${threads})`,
  ].filter(Boolean);
  if (mismatch.length) throw new NativeKernelError('BX_ABI', `Rust addon ${located.dir} does not match its build and codecs: ${mismatch.join(', ')}`);
  return rustBackendFromAddon(addon, { sourceHash: verified.sourceHash, dir: located.dir, threads, open: { totalMs: performance.now() - t0, init } });
}

// ---------------------------------------------------------------- namespaces

const slot = (namespace, key) => `${namespace ?? ''}\u0000${key}`;
const opsBySlot = new Map(rustWire.ops.filter(op => op.key !== null).map(op => [slot(op.scope === 'export' ? `export:${op.namespace}` : op.namespace, op.key), op]));

// A loadKernel()-shaped proxy: the root plus one sub-namespace per
// loadKernel().X (parsed from src/kernel.mjs, nothing Bend loaded). route(op,
// namespace, key) returns the function serving a slot; a slot no op has
// (not a production entry of src/native/surface.json) refuses by name, except
// on rust-mixed, where `unlisted` hands it to Bend JS like every entry the table
// does not list.
const EXPORT_MODULES = { stepPCurves: 'step-pcurves.bend', stepCylinderPCurves: 'step-cylinder-pcurves.bend' };
function namespaceProxy({ route, backend, sourceHash, unlisted = null }) {
  const wiring = kernelWiring(projectRoot);
  const namespaces = new Set(Object.keys(wiring.fields));
  // kernel/<module>.bend:<def> of a slot, from the loadKernel() wiring (null when it cannot be named).
  const entryOf = (namespace, key) => {
    const module = namespace?.startsWith('export:') ? EXPORT_MODULES[namespace.slice(7)] : namespace ? wiring.fields[namespace] : key.includes('.') ? null : wiring.root;
    return module ? `kernel/${module}:${key}` : null;
  };
  const functions = new Map(), children = new Map();
  const fn = (namespace, key) => {
    const id = slot(namespace, key);
    if (!functions.has(id)) {
      const op = opsBySlot.get(id);
      functions.set(id, op ? route(op, namespace, key) : unlisted ? unlisted(namespace, key) : function unavailable() {
        const label = namespace ? `${namespace.replace(/^export:/, '')}.${key}` : key;
        throw new NativeCapabilityError({ entry: `${entryOf(namespace, key) ?? label} (not in src/native/surface.json)`, label, backend, sourceHash, set: 'rust' });
      });
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
  return { kernel: new Proxy(Object.create(null), handler(null)), fn };
}

// STEP exporters are imported before the kernel opens. Bind each namespace to
// the first matching kernel when opened, never to a later kernel's route.
const openedExportRoutes = new Map();
const pendingExportRoutes = new Map();
function bindExportRoute(mode, route) {
  openedExportRoutes.set(mode, route);
  for (const binding of pendingExportRoutes.get(mode) ?? []) binding.route = route;
  pendingExportRoutes.delete(mode);
}
export function rustExportNamespace({ file, namespace, backend }) {
  const binding = { route: openedExportRoutes.get(backend) ?? null };
  if (!binding.route) {
    if (!pendingExportRoutes.has(backend)) pendingExportRoutes.set(backend, new Set());
    pendingExportRoutes.get(backend).add(binding);
  }
  return new Proxy(Object.create(null), {
    get(_, key) {
      if (typeof key !== 'string' || key === 'then') return undefined;
      return function exportEntry(...args) {
        if (!binding.route) throw new NativeKernelError('BX_LOAD', `${file}:${key} was called before loadKernel() opened WONKY_BACKEND=${backend}`);
        return binding.route(`export:${namespace}`, key)(...args);
      };
    },
    set() { return false; },
  });
}

// Encodes, calls, decodes one op on the given wire version.
function rustMember(backend, op, version, mode = 'rust') {
  const codec = op[`v${version}`];
  return function rustEntry(...args) {
    let request;
    try { request = codec.encode(args); }
    catch (error) { throw new NativeKernelError('BX_ARGS', `${op.entry} (kernel.${op.label}): the arguments do not fit wire v${version}: ${error.message}`, { op: op.id, entry: op.entry, cause: error }); }
    const reply = backend.call(op.id, request, version, mode);
    try { return codec.decode(reply); }
    catch (error) { throw new NativeKernelError('BX_WIRE', `${op.entry}: the Rust reply does not decode (wire v${version}): ${error.message}`, { op: op.id, entry: op.entry, cause: error }); }
  };
}

export async function openRustKernel(options = {}) {
  const backend = await openRustBackend(options);
  const { kernel, fn } = namespaceProxy({ backend: 'rust', sourceHash: backend.sourceHash, route: op => rustMember(backend, op, 2) });
  bindExportRoute('rust', fn);
  // The WC0 v3 host port (sketch, extrude, export of the planar slice).
  registerRustHost(kernel, backend);
  return { kernel, backend };
}

// ---------------------------------------------------------------- rust-diff

export const defaultRustDivergenceDir = () => process.env.WONKY_DIVERGENCE_DIR ?? join(projectRoot, 'tmp/rust/divergence');

// Exact word comparison of [status, ...result] replies (the R3 comparator
// with declared bounds replaces it). Returns the compared word count or
// throws BackendDivergenceError after writing the dump.
export function compareRustReplies({ op, request, rustReply, jsReply, sourceHash, dumpDir = defaultRustDivergenceDir(), write = writeDump }) {
  const n = Math.max(rustReply.length, jsReply.length);
  let at = -1;
  for (let k = 0; k < n; k += 1) if (rustReply[k] !== jsReply[k]) { at = k; break; }
  if (at < 0) return n;
  const dump = write({ op, request, rustReply, jsReply, at, sourceHash, dumpDir });
  throw new BackendDivergenceError({ op: op.id, entry: op.entry, wordIndex: at, fieldPath: at === 0 ? 'status' : `result word ${at - 1}`, nativeWord: rustReply[at], jsWord: jsReply[at], dump, target: 'rust' });
}

function writeDump({ op, request, rustReply, jsReply, at, sourceHash, dumpDir }) {
  const bytes = words => Buffer.from(words.buffer, words.byteOffset, words.byteLength);
  const dump = join(dumpDir, `${new Date().toISOString().replace(/[:.]/g, '-')}-op${op.id}-${process.pid}`);
  mkdirSync(dump, { recursive: true });
  writeFileSync(join(dump, 'request.u32'), bytes(request));
  writeFileSync(join(dump, 'reply-rust.u32'), bytes(rustReply));
  writeFileSync(join(dump, 'reply-js.u32'), bytes(jsReply));
  writeFileSync(join(dump, 'meta.json'), JSON.stringify({ op: op.id, entry: op.entry, wire: 1, wordIndex: at, rustWord: rustReply[at] ?? null, jsWord: jsReply[at] ?? null, sourceHash }, null, 1) + '\n');
  return dump;
}

async function jsReference() {
  const { loadJsKernel } = await import('../kernel.mjs');
  const js = await loadJsKernel();
  const [{ loadStepPCurves }, { loadStepCylinderPCurves }] = await Promise.all([import('../step-pcurves.mjs'), import('../step-cylinder-pcurves.mjs')]);
  const [stepPCurves, stepCylinderPCurves] = await Promise.all([loadStepPCurves(), loadStepCylinderPCurves()]);
  const exports = { stepPCurves, stepCylinderPCurves };
  // (namespace, key) as the proxy names a slot; 'export:<ns>' is an export-scope module.
  return (namespace, key) => {
    const target = namespace?.startsWith('export:') ? exports[namespace.slice(7)]?.[key] : namespace ? js[namespace]?.[key] : js[key];
    if (typeof target !== 'function') throw new NativeKernelError('BX_ABI', `the Bend JS target has no ${namespace ? `${namespace}.` : ''}${key}`);
    return target;
  };
}

export async function openRustDiffKernel(options = {}) {
  // B1: no ported entries means comparison would make a false provenance claim.
  throw new NativeKernelError('BX_BACKEND', 'WONKY_BACKEND=rust-diff is not available until package B1 ports the first entries');
  const backend = await openRustBackend(options);
  const reference = await jsReference();
  const divergence = { first: null, count: 0 };
  const dumpDir = options.dumpDir ?? defaultRustDivergenceDir();
  const route = (op, namespace, key) => {
    const codec = op.v1;
    let target = null;
    return function diffEntry(...args) {
      if (divergence.first) throw divergence.first;
      let request;
      try { request = codec.encode(args); }
      catch (error) { throw new NativeKernelError('BX_ARGS', `${op.entry} (kernel.${op.label}): the arguments do not fit wire v1: ${error.message}`, { op: op.id, entry: op.entry, cause: error }); }
      // Rust first: an entry it does not serve refuses here and Bend never answers for it.
      const rustReply = backend.call(op.id, request, 1, 'rust-diff');
      target ??= reference(namespace, key);
      const value = target(...args);
      let jsReply;
      try {
        const words = codec.encodeResult(value);
        jsReply = new Uint32Array(words.length + 1);
        jsReply.set(words, 1);
      } catch (error) {
        throw new NativeKernelError('BX_WIRE', `${op.entry}: the Bend JS result is not v1-encodable: ${error.message}`, { op: op.id, entry: op.entry, cause: error });
      }
      try { compareRustReplies({ op, request, rustReply, jsReply, sourceHash: backend.sourceHash, dumpDir }); }
      catch (error) {
        if (error instanceof BackendDivergenceError) { divergence.count += 1; divergence.first ??= error; }
        throw error;
      }
      return codec.decode(rustReply);
    };
  };
  const { kernel, fn } = namespaceProxy({ backend: 'rust-diff', sourceHash: backend.sourceHash, route });
  bindExportRoute('rust-diff', fn);
  return { kernel, backend: { ...backend, info: { ...backend.info, target: TARGET['rust-diff'] } }, divergence };
}

// ---------------------------------------------------------------- rust-mixed

// { path, sha256, rust: [entries] }: the tracked table, or WONKY_RUST_MIXED.
export function mixedTable(path = process.env.WONKY_RUST_MIXED ?? join(projectRoot, MIXED_TABLE)) {
  let text;
  try { text = readFileSync(path, 'utf8'); }
  catch (error) { throw new NativeKernelError('BX_BACKEND', `WONKY_BACKEND=rust-mixed needs its op table ${path}: ${error.message}`); }
  let table;
  try { table = JSON.parse(text); }
  catch (error) { throw new NativeKernelError('BX_BACKEND', `rust-mixed op table ${path} is not JSON: ${error.message}`); }
  if (table?.schema !== 'wonky-rust-mixed/1' || !Array.isArray(table.rust) || table.rust.some(e => typeof e !== 'string')) {
    throw new NativeKernelError('BX_BACKEND', `rust-mixed op table ${path} must be { "schema": "wonky-rust-mixed/1", "rust": [entry, ...] }`);
  }
  const known = new Set(rustWire.ops.map(op => op.entry));
  const unknown = table.rust.filter(e => !known.has(e));
  if (unknown.length) throw new NativeKernelError('BX_BACKEND', `rust-mixed op table ${path} routes entries the Rust wire does not have: ${unknown.join(', ')}`);
  if (new Set(table.rust).size !== table.rust.length) throw new NativeKernelError('BX_BACKEND', `rust-mixed op table ${path} lists an entry twice`);
  return { path: relative(projectRoot, path).startsWith('..') ? path : relative(projectRoot, path), sha256: sha256(text), rust: [...table.rust] };
}

export async function openRustMixedKernel(options = {}) {
  // B1: the per-build provenance ledger and modeling services must be accounted for first.
  throw new NativeKernelError('BX_BACKEND', 'WONKY_BACKEND=rust-mixed is not available until package B1 ports the first entries');
  const table = mixedTable(options.table);
  const backend = await openRustBackend(options);
  const reference = await jsReference();
  const toRust = new Set(table.rust);
  const executed = { rust: new Set(), bend: new Set() };
  const record = (target, entry, member) => (...args) => {
    // Record only completed calls; a refusal must not claim execution.
    const result = member(...args);
    executed[target].add(entry);
    return result;
  };
  const route = (op, namespace, key) => toRust.has(op.entry)
    ? record('rust', op.entry, rustMember(backend, op, 1, 'rust-mixed'))
    : record('bend', op.entry, reference(namespace, key));
  const unlisted = (namespace, key) => record('bend', `${namespace}.${key}`, reference(namespace, key));
  const { kernel, fn } = namespaceProxy({ backend: 'rust-mixed', sourceHash: backend.sourceHash, route, unlisted });
  bindExportRoute('rust-mixed', fn);
  return { kernel, backend: { ...backend, info: { ...backend.info, target: TARGET['rust-mixed'], mixed: table,
    mixedExecution: () => Object.fromEntries(Object.entries(executed).map(([target, entries]) => [target, [...entries].sort()])) } } };
}
