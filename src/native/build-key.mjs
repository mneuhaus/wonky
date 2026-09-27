// Build key of the native kernel addon, shared by the build
// (scripts/native-bridge/build-native.mjs) and the loader's stale check
// (src/native/native-kernel.mjs). A build is identified by SOURCE_HASH:
//
//   sha256(JSON{schema, set, ops, namespaces, surface, hybrid, wiring, files: [(path, sha256)], toolchain})
//
// ops/namespaces/surface = the routing the loader applies (op id -> Bend def ->
// loadKernel() slot, and the entry names of refusals); hybrid = the driver of
// the wonky-hybrid subprocess built with the addon and the loadKernel().hybrid
// keys it serves (null for a set without it); wiring = loadKernel()'s
// namespace -> module table parsed from src/kernel.mjs (kernel-wiring.mjs);
// files = the Bend import closure of the op modules and of the hybrid driver
// (kernel sources), the
// generator and build scripts, the bx driver files and the vendored Node-API
// headers, bend.lock.json and the tracked slice inputs src/native/surface.json,
// slice-calls.json, smoke-calls.json.gz and smoke-hybrid.json.gz (nothing under out/, so a fresh
// clone builds); toolchain = Bend
// version, Bend binary sha256, Bend library (Base, effect files) sha256,
// `clang --version`, the exact clang flags (the FP flags are pinned here),
// arch/platform and the targeted N-API version.
//
// The binary carries SOURCE_HASH (info().sourceHash). On every open the loader
// recomputes it from the *current* files, the *current* wiring and the
// *current* toolchain plus the manifest's routing, so neither a changed input
// nor an edited manifest can run a binary under the wrong name.
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash, hash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, readlinkSync, realpathSync, statSync } from 'node:fs';
import { delimiter, dirname, join, relative, resolve } from 'node:path';

export const KEY_SCHEMA = 'wonky-native-build-key/3';
export const API_VERSION = 1;
export const NAPI_TARGET = 8;
// The only build WONKY_BACKEND=native|diff ever opens: the validated slice.
export const SLICE_SET = 'planar';
export const BUILD_COMMAND = set => `node scripts/native-bridge/build-native.mjs --set ${set}`;

// Pinned FP semantics (docs/native-bridge.md section 6): no FMA contraction, no fast-math.
export const CLANG_FLAGS = Object.freeze(['-std=c11', '-O3', '-fPIC', '-ffp-contract=off', '-fno-fast-math',
  '-Wno-unused-function', '-Wno-unused-variable']);
export const LINK_FLAGS = Object.freeze(['-bundle', '-undefined', 'dynamic_lookup', '-lpthread', '-lm']);
// The wonky-hybrid subprocess: an executable, same compile flags.
export const EXE_LINK_FLAGS = Object.freeze(['-lpthread', '-lm']);

// Inputs besides the kernel closure (paths relative to the project root). All
// of them are tracked; the build reads nothing under out/ (gitignored).
export const BUILD_INPUTS = Object.freeze([
  'bend.lock.json',
  'src/native/surface.json', // entry list and refusal names baked into the manifest (surface-scan.mjs)
  'src/native/slice-calls.json', // measured entries per slice workload, checked against the op list (slice-inputs.mjs)
  'src/native/smoke-calls.json.gz', // captured production calls the smoke test replays bit-exact (slice-inputs.mjs)
  'src/native/smoke-hybrid.json.gz', // hybrid jobs with the JS target's answers, the wonky-hybrid smoke test (slice-inputs.mjs)
  'scripts/native-bridge/build-native.mjs',
  'scripts/native-bridge/gen-wire.mjs',
  'scripts/native-bridge/slice-inputs.mjs',
  'scripts/native-bridge/slice-ops.mjs',
  'scripts/native-bridge/wire-probe.mjs', // count-guard probes of the smoke test
  'src/native/build-key.mjs',
  'src/native/kernel-wiring.mjs',
  'src/native/binding/bx_pre.h',
  'src/native/binding/bx_addon.c',
  'src/native/include/node_api.h',
  'src/native/include/js_native_api.h',
  'src/native/include/js_native_api_types.h',
  'src/native/include/node_api_types.h',
  'src/native/include/PROVENANCE.json',
]);

// crypto.hash (Node >= 21.7) is the one-shot form; same digest.
export const sha256 = typeof hash === 'function' ? bytes => hash('sha256', bytes, 'hex') : bytes => createHash('sha256').update(bytes).digest('hex');

export function hashFile(root, path) {
  try { return sha256(readFileSync(join(root, path))); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

// Import closure of .bend files (relative to root), starting at `entries`.
// Follows `import <path>.bend as X` and foreign `import "<file>"` lines in the
// header of each file, exactly the import forms the kernel uses. `import Base`
// is the compiler's own library and is covered by the toolchain's library hash.
export function bendClosure(root, entries) {
  const seen = new Set(), order = [];
  const visit = absolute => {
    const path = relative(root, absolute);
    if (seen.has(path)) return;
    seen.add(path);
    order.push(path);
    if (!absolute.endsWith('.bend')) return;
    const text = readFileSync(absolute, 'utf8');
    // Foreign effect files (`import "x.c"`) sit inside def bodies.
    for (const m of text.matchAll(/^\s+import\s+"([^"]+)"\s*$/gm)) visit(resolve(dirname(absolute), m[1]));
    // Module imports sit in the header, as src/bend-loader.mjs also assumes.
    for (const raw of text.split('\n')) {
      const line = raw.trim();
      let m;
      if ((m = /^import\s+(\S+\.bend)\s+as\s+\w+\s*(#.*)?$/.exec(line))) visit(resolve(dirname(absolute), m[1]));
      else if ((m = /^import\s+"([^"]+)"\s*$/.exec(line))) visit(resolve(dirname(absolute), m[1]));
      else if (/^import\s+Base\s*(#.*)?$/.test(line)) continue;
      else if (line.startsWith('import')) throw new Error(`${path}: unrecognised import line '${line}'`);
      else if (line !== '' && !line.startsWith('#')) break;
    }
  };
  entries.forEach(entry => visit(resolve(root, entry)));
  return order.sort();
}

// Code-unit order: localeCompare would cost ~5 ms of ICU start-up on every load.
const byPath = (a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

export function computeSourceHash({ set, ops, namespaces, surface, hybrid = null, wiring, files, toolchain }) {
  const route = op => [op.id, op.spec, op.entry, op.scope ?? 'kernel', op.namespace, op.key, op.label];
  const refusal = e => [e.entry, e.scope, e.namespace, e.key];
  return sha256(JSON.stringify({
    schema: KEY_SCHEMA, set,
    ops: ops.map(route), namespaces: [...namespaces], surface: surface.map(refusal),
    hybrid: hybrid && [hybrid.driver, hybrid.namespace, ...hybrid.hosted],
    wiring: { root: wiring.root, fields: Object.entries(wiring.fields) },
    files: [...files].sort(byPath).map(f => [f.path, f.sha256]),
    toolchain: TOOLCHAIN_FIELDS.map(k => [k, toolchain[k]]),
  }));
}

// Re-hash the recorded files under `root`; report every path whose bytes differ.
export function changedFiles(root, files) {
  const changed = [];
  for (const file of files) {
    const now = hashFile(root, file.path);
    if (now !== file.sha256) changed.push({ path: file.path, recorded: file.sha256, now });
  }
  return changed;
}

// File identities (inode, size, mtime, ctime) of the recorded inputs. A build
// compiles the live files, so an edit that is reverted before the build ends
// leaves the content hash unchanged but not these: every write moves ctime.
export function statInputs(root, files) {
  return files.map(({ path }) => {
    const s = statSync(join(root, path), { bigint: true });
    return { path, id: `${s.ino}:${s.size}:${s.mtimeNs}:${s.ctimeNs}` };
  });
}

// Paths whose identity differs from `before` (a deleted file counts as touched).
export function touchedInputs(root, before) {
  return before.filter(({ path, id }) => {
    try {
      const s = statSync(join(root, path), { bigint: true });
      return `${s.ino}:${s.size}:${s.mtimeNs}:${s.ctimeNs}` !== id;
    } catch { return true; }
  }).map(({ path }) => path);
}

// ---------------------------------------------------------------- toolchain

// Every field is part of the key; the loader recomputes all of them.
export const TOOLCHAIN_FIELDS = Object.freeze(['bend', 'bendSha256', 'bendLibrarySha256', 'clang', 'flags', 'link', 'arch', 'platform', 'napi', 'apiVersion']);

export function bendPaths(root) {
  const { version } = JSON.parse(readFileSync(join(root, 'bend.lock.json'), 'utf8'));
  const home = join(root, `.tools/bend-${version}`);
  return { version, bin: join(home, 'bin/bend'), library: join(home, 'bend2') };
}

// Base and the effect files the emitter splices in (73 small files).
const libraryFiles = library => {
  const walk = dir => readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .flatMap(e => e.isDirectory() ? walk(join(dir, e.name)) : [relative(library, join(dir, e.name))]);
  return walk(library);
};
export function bendLibrarySha256(library) {
  return sha256(JSON.stringify(libraryFiles(library).map(path => [path, sha256(readFileSync(join(library, path)))])));
}
// Identities of every library file (same fast-path rule as the Bend binary).
const libraryIdentity = library => sha256(JSON.stringify(libraryFiles(library).map(path => [path, fileIdentity(join(library, path))])));

// A file's identity: device, inode, size, mtime and ctime in ns. ctime is set
// by the kernel on every write, rename or metadata change and cannot be set by
// utimes(), so an unchanged identity means unchanged bytes.
export function fileIdentity(path) {
  try {
    const s = statSync(path, { bigint: true });
    return `${s.dev}:${s.ino}:${s.size}:${s.mtimeNs}:${s.ctimeNs}`;
  } catch { return null; }
}

// `clang` as spawnSync('clang') finds it, without spawning anything.
function pathClang(env = process.env) {
  for (const dir of (env.PATH ?? '').split(delimiter)) {
    if (!dir) continue;
    const candidate = join(dir, 'clang');
    try { if (statSync(candidate).isFile()) return candidate; } catch { /* next */ }
  }
  return null;
}

// Everything that decides which compiler `clang` runs, observable with stats:
// the PATH hit, and on macOS the developer-directory selection behind the
// /usr/bin shim plus the real compiler xcrun resolved when the probe was taken.
export function clangFingerprint(realClang, env = process.env) {
  const resolved = pathClang(env);
  const link = (() => { try { return readlinkSync('/var/db/xcode_select_link'); } catch { return null; } })();
  return {
    resolved, resolvedId: resolved && fileIdentity(resolved),
    developerDir: env.DEVELOPER_DIR ?? null, toolchains: env.TOOLCHAINS ?? null, sdkroot: env.SDKROOT ?? null,
    xcodeSelect: process.platform === 'darwin' ? link : null,
    xcodeApp: process.platform === 'darwin' ? existsSync('/Applications/Xcode.app/Contents/Developer') : null,
    real: realClang, realId: realClang && fileIdentity(realClang),
  };
}

function clangVersionLine() {
  const run = spawnSync('clang', ['--version'], { encoding: 'utf8' });
  if (run.status !== 0) throw new Error(`clang --version failed: ${(run.stderr || run.error?.message || '').trim()}`);
  return run.stdout.split('\n')[0].trim();
}

function realClangPath() {
  if (process.platform === 'darwin') {
    try { return realpathSync(execFileSync('xcrun', ['--find', 'clang'], { encoding: 'utf8' }).trim()); } catch { /* fall through */ }
  }
  const resolved = pathClang();
  return resolved && realpathSync(resolved);
}

// Exact probe (the build): hashes the Bend binary, spawns clang. Returns the
// toolchain values plus the identities that let a later open skip the two
// expensive steps while nothing about them changed.
export function probeToolchain(root) {
  const bend = bendPaths(root);
  if (!existsSync(bend.bin)) throw new Error(`Bend ${bend.version} is not installed at ${relative(root, bend.bin)} (npm run setup)`);
  const bendSha256 = sha256(readFileSync(bend.bin));
  const clang = clangVersionLine();
  const toolchain = {
    bend: bend.version, bendSha256, bendLibrarySha256: bendLibrarySha256(bend.library), clang,
    flags: [...CLANG_FLAGS], link: [...LINK_FLAGS], arch: process.arch, platform: process.platform, napi: NAPI_TARGET, apiVersion: API_VERSION,
  };
  const probe = {
    bend: { path: relative(root, bend.bin), identity: fileIdentity(bend.bin), sha256: bendSha256 },
    library: { path: relative(root, bend.library), identity: libraryIdentity(bend.library), sha256: toolchain.bendLibrarySha256 },
    clang: { fingerprint: clangFingerprint(realClangPath()), line: clang },
  };
  return { toolchain, probe };
}

// The toolchain as it is now (the loader), with the recorded probe as a fast
// path: the Bend binary (64 MB) and the Bend library are re-hashed only when a
// file identity changed (a new file, a write, a rename or a metadata change
// always changes ctime), clang is spawned only when its fingerprint changed.
// The flags, arch, platform and N-API target are always taken as they are now.
export function currentToolchain(root, probe) {
  const bend = bendPaths(root);
  const timings = {};
  let t = performance.now();
  const identity = fileIdentity(bend.bin);
  let bendSha256 = null;
  if (identity === null) bendSha256 = null;
  else if (probe?.bend?.identity === identity && probe.bend.path === relative(root, bend.bin)) bendSha256 = probe.bend.sha256;
  else { bendSha256 = sha256(readFileSync(bend.bin)); timings.bendRehash = true; }
  timings.bendMs = performance.now() - t;
  t = performance.now();
  let library = null;
  try {
    if (probe?.library?.path === relative(root, bend.library) && probe.library.identity === libraryIdentity(bend.library)) library = probe.library.sha256;
    else { library = bendLibrarySha256(bend.library); timings.libraryRehash = true; }
  } catch { /* missing: reported as a change */ }
  timings.libraryMs = performance.now() - t;
  t = performance.now();
  const fingerprint = probe?.clang ? clangFingerprint(probe.clang.fingerprint.real) : null;
  let clang;
  if (fingerprint && JSON.stringify(fingerprint) === JSON.stringify(probe.clang.fingerprint)) clang = probe.clang.line;
  else {
    try { clang = clangVersionLine(); } catch (error) { clang = `unavailable (${error.message})`; }
    timings.clangSpawned = true;
  }
  timings.clangMs = performance.now() - t;
  return {
    toolchain: { bend: bend.version, bendSha256, bendLibrarySha256: library, clang,
      flags: [...CLANG_FLAGS], link: [...LINK_FLAGS], arch: process.arch, platform: process.platform, napi: NAPI_TARGET, apiVersion: API_VERSION },
    timings,
  };
}

const TOOLCHAIN_LABEL = {
  bend: 'Bend version (bend.lock.json)', bendSha256: 'Bend binary', bendLibrarySha256: 'Bend library (Base, effect files)',
  clang: 'clang --version', flags: 'clang flags', link: 'link flags', arch: 'arch', platform: 'platform', napi: 'N-API target', apiVersion: 'bridge API version',
};
export function toolchainChanges(recorded, now) {
  return TOOLCHAIN_FIELDS.filter(k => JSON.stringify(recorded?.[k]) !== JSON.stringify(now[k]))
    .map(k => `${TOOLCHAIN_LABEL[k]}: ${JSON.stringify(recorded?.[k] ?? null)} -> ${JSON.stringify(now[k])}`);
}

// Generated codecs: wireHash = sha256(wire.json + wire.bend + wire.mjs as
// generated). The build appends three export lines to wire.mjs; they are
// stripped again to recompute the hash the binary carries.
const WIRE_TRAILER = /\nexport const WIRE_HASH = "[0-9a-f]{64}";\nexport const API_VERSION = \d+;\nexport const SOURCE_HASH = "[0-9a-f]{64}";\n$/;
export function wireHashOf(dir) {
  const mjs = readFileSync(join(dir, 'wire.mjs'));
  const text = mjs.toString('utf8');
  const m = WIRE_TRAILER.exec(text);
  if (!m) return null;
  const generated = Buffer.from(text.slice(0, m.index), 'utf8');
  return sha256(Buffer.concat([readFileSync(join(dir, 'wire.json')), readFileSync(join(dir, 'wire.bend')), generated]));
}
