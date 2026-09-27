// Build key and stale check of the Rust kernel workspace rust/
// (docs/rust-migration.md 3.1 and 6, K0). A build is identified by
//
//   sourceHash = sha256(JSON{schema, variant, cargo args, build env, cargo configs, toolchain, files: [[path, sha256]]})
//
// files = every regular file of rust/ including ignored-but-compilable directories (sources, Cargo.toml,
// Cargo.lock, rust-toolchain.toml, .cargo/config.toml, the vendored crates), plus
// this file and scripts/rust/build.mjs; nothing under rust/target (ignored).
// toolchain = `rustc -vV` and `cargo -V` as resolved inside rust/ (so the
// rust-toolchain.toml pin applies). build env = every variable that can change
// what cargo and rustc produce (keyedEnv: all CARGO_* and RUST* variables, e.g.
// CARGO_PROFILE_*, CARGO_TARGET_<triple>_RUSTFLAGS, CARGO_BUILD_*, RUSTFLAGS,
// except locations, logging, terminal and network settings, plus the C and link
// env). cargo configs = every .cargo/config[.toml] cargo reads besides the
// tracked rust/.cargo/config.toml (ancestors of rust/ and CARGO_HOME), by
// absolute path and content. The key is fail-closed: an unknown variable is
// keyed (a cache miss at worst, never another build's artifact). Without outer
// configs the key uses only paths relative to the project root and file
// contents, so a fresh checkout of the same files, built offline, has the same
// sourceHash.
//
// scripts/rust/build.mjs builds a variant and records it under
// tmp/rust/cache/<sourceHash>/ (manifest.json + the artifacts). openRustArtifact()
// is the loader: it recomputes the key from the *current* files and toolchain and
// hands out an artifact only from the cache entry of exactly that key; otherwise
// it throws RustBuildStaleError naming every changed file (against the variant's
// last build) or RustBuildMissingError.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';

export const KEY_SCHEMA = 'wonky-rust-build-key/2';
export const RUST_DIR = 'rust';
export const KEY_SCRIPTS = Object.freeze(['scripts/rust/build-key.mjs', 'scripts/rust/build.mjs']);
export const CACHE_DIR = 'tmp/rust/cache';
// Build env (K0 verify defect 3: the /1 key covered only the RUSTFLAGS family).
const KEYED_ENV = /^(CARGO_|RUST)/;
const KEYED_ENV_EXTRA = new Set(['CC', 'CXX', 'AR', 'CFLAGS', 'CXXFLAGS', 'LDFLAGS', 'MACOSX_DEPLOYMENT_TARGET', 'SDKROOT']);
// Not keyed: locations (CARGO_TARGET_DIR is set by build.mjs), logging, terminal, network, parallelism.
const UNKEYED_ENV = /^(CARGO_HOME|CARGO_TARGET_DIR|CARGO_BUILD_TARGET_DIR|CARGO_NET_.*|CARGO_HTTP_.*|CARGO_TERM_.*|CARGO_REGISTRIES_.*|CARGO_REGISTRY_.*|CARGO_LOG|CARGO_BUILD_JOBS|RUSTUP_HOME|RUST_LOG|RUST_BACKTRACE|RUST_LIB_BACKTRACE|RUST_TEST_THREADS|RUST_MIN_STACK)$/;

/** The keyed part of `env`: name -> value, sorted by name. */
export function keyedEnv(env) {
  return Object.fromEntries(Object.keys(env).filter(name => (KEYED_ENV.test(name) || KEYED_ENV_EXTRA.has(name)) && !UNKEYED_ENV.test(name)).sort().map(name => [name, env[name]]));
}

/**
 * Cargo config files outside the tracked rust/.cargo/config.toml that cargo
 * would read when run in rust/: .cargo/config and .cargo/config.toml in every
 * ancestor of rust/, then in CARGO_HOME. [[absolute path, sha256]] in cargo's order.
 */
export function outerCargoConfigs(root, env = process.env) {
  const dirs = [];
  for (let dir = resolve(root); ; dir = dirname(dir)) {
    dirs.push(join(dir, '.cargo'));
    if (dirname(dir) === dir) break;
  }
  // cargo runs in rust/ and lets the OS resolve a relative CARGO_HOME there (symlinks before '..'),
  // so the path is joined as text and resolved with the native realpath, never lexically.
  dirs.push(env.CARGO_HOME ? osPath(isAbsolute(env.CARGO_HOME) ? env.CARGO_HOME : `${join(resolve(root), RUST_DIR)}${sep}${env.CARGO_HOME}`) : join(homedir(), '.cargo'));
  const seen = new Set(), out = [];
  for (const dir of dirs) {
    for (const name of ['config', 'config.toml']) {
      const path = join(dir, name);
      if (!existsSync(path)) continue;
      const real = realpathSync(path);
      if (seen.has(real)) continue;
      seen.add(real);
      out.push([path, sha256(readFileSync(path))]);
    }
  }
  return out;
}

/** A path as the OS resolves it (symlinks, then '..'); unchanged when it does not exist. */
export const osPath = path => existsSync(path) ? realpathSync.native(path) : path;

/** Whether a cargo artifact lies inside rust/ but outside rust/target (both resolved by the OS). */
export function artifactInsideSources(artifact, rustDir) {
  const lib = osPath(artifact), rust = osPath(rustDir);
  return (lib === rust || lib.startsWith(`${rust}${sep}`)) && !lib.startsWith(`${join(rust, 'target')}${sep}`);
}

// What each variant builds. Artifacts are paths relative to its cargo target dir.
export const VARIANTS = Object.freeze({
  release: { cargo: ['build', '--release', '--offline', '--locked', '--workspace'], artifacts: { 'planar-spike': 'release/planar-spike' } },
  // the spike's S3 planted negatives (PLANT=flip|vertex), never used for measurements
  plant: { cargo: ['build', '--release', '--offline', '--locked', '-p', 'wonky-replay', '--features', 'plant'], artifacts: { 'planar-spike': 'release/planar-spike' } },
});
export const buildCommand = variant => `node scripts/rust/build.mjs${variant === 'release' ? '' : ` --variant ${variant}`}`;

export class RustBuildStaleError extends Error {
  constructor(message, { changed = [], variant } = {}) { super(message); this.name = 'RustBuildStaleError'; this.changed = changed; this.variant = variant; }
}
export class RustBuildMissingError extends Error {
  constructor(message, { variant } = {}) { super(message); this.name = 'RustBuildMissingError'; this.variant = variant; }
}

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

/** Tracked or trackable files of rust/ plus the key scripts, sorted, relative to root. */
export function sourceFiles(root) {
  const out = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', RUST_DIR, ...KEY_SCRIPTS], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const files = new Set(out.split('\0').filter(Boolean).filter(path => existsSync(join(root, path))));
  for (const path of walkRustFiles(root)) files.add(path);
  const sorted = [...files].sort();
  for (const script of KEY_SCRIPTS) if (!sorted.includes(script)) throw new Error(`${script} is missing from the key's file list`);
  return sorted;
}

// Shared with the N-API addon key: reject symlinks and other non-regular
// inputs instead of silently omitting sources that Cargo may follow.
export function walkRustFiles(root) {
  const files = new Set();
  // Ignore only workspace build output, not ignored-but-compilable directories.
  const walk = dir => {
    for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
      if (dir === RUST_DIR && entry.name === 'target') continue;
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile()) files.add(path);
      else throw new Error(`unexpected Rust input ${path} (not a regular file or directory)`);
    }
  };
  walk(RUST_DIR);
  return [...files].sort();
}

export function hashFiles(root, files = sourceFiles(root)) {
  return files.map(path => [path, sha256(readFileSync(join(root, path)))]);
}

/** rustc/cargo as rustup resolves them inside rust/ (rust-toolchain.toml applies). */
export function currentToolchain(root) {
  const run = (cmd, args) => execFileSync(cmd, args, { cwd: join(root, RUST_DIR), encoding: 'utf8' }).trim();
  return { rustc: run('rustc', ['-vV']), cargo: run('cargo', ['-V']) };
}

export function buildKey(root, variant, { toolchain = currentToolchain(root), env = process.env } = {}) {
  const spec = VARIANTS[variant];
  if (!spec) throw new Error(`unknown Rust build variant '${variant}' (${Object.keys(VARIANTS).join(', ')})`);
  const key = {
    schema: KEY_SCHEMA,
    variant,
    cargo: spec.cargo,
    env: keyedEnv(env),
    cargoConfigs: outerCargoConfigs(root, env),
    toolchain,
    files: hashFiles(root),
  };
  return { key, sourceHash: sha256(JSON.stringify(key)) };
}

export const cacheEntry = (root, sourceHash) => join(root, CACHE_DIR, sourceHash);
export const pointerFile = (root, variant) => join(root, CACHE_DIR, `${variant}.json`);

/** Files that differ between two keys' file lists (added, removed or changed). */
export function changedFiles(before, after) {
  const a = new Map(before), b = new Map(after);
  return [...new Set([...a.keys(), ...b.keys()])].filter(path => a.get(path) !== b.get(path)).sort();
}

function keyChanges(old, now) {
  const changes = changedFiles(old.files, now.files);
  if (JSON.stringify(old.toolchain) !== JSON.stringify(now.toolchain)) changes.push('<toolchain: rustc/cargo -V>');
  const envNames = [...new Set([...Object.keys(old.env ?? {}), ...Object.keys(now.env)])].sort();
  const envChanged = envNames.filter(name => (old.env?.[name] ?? null) !== (now.env[name] ?? null));
  if (envChanged.length) changes.push(`<build env: ${envChanged.join(', ')}>`);
  for (const path of changedFiles(old.cargoConfigs ?? [], now.cargoConfigs)) changes.push(`<cargo config: ${path}>`);
  if (JSON.stringify(old.cargo) !== JSON.stringify(now.cargo) || old.schema !== now.schema) changes.push('<cargo arguments or key schema>');
  return changes;
}

/**
 * The loader: path of `artifact` built from exactly the current sources,
 * toolchain and build env. Throws RustBuildStaleError (with the changed files)
 * or RustBuildMissingError; never returns a binary of another key.
 */
export function openRustArtifact(root, { variant = 'release', artifact = 'planar-spike', ...options } = {}) {
  const { key, sourceHash } = buildKey(root, variant, options);
  const manifestFile = join(cacheEntry(root, sourceHash), 'manifest.json');
  if (existsSync(manifestFile)) {
    let manifest;
    try { manifest = JSON.parse(readFileSync(manifestFile, 'utf8')); }
    catch (error) { throw new RustBuildStaleError(`Rust build cache manifest ${manifestFile} is unreadable (${error.message}); rebuild with ${buildCommand(variant)}`, { variant, changed: [manifestFile] }); }
    const entry = manifest.artifacts?.[artifact];
    if (manifest.sourceHash !== sourceHash || !entry) throw new RustBuildStaleError(`Rust build cache entry ${sourceHash} is inconsistent (no artifact '${artifact}'); rebuild with ${buildCommand(variant)}`, { variant });
    const path = join(cacheEntry(root, sourceHash), artifact);
    const actual = existsSync(path) ? sha256(readFileSync(path)) : null;
    if (actual !== entry.sha256) throw new RustBuildStaleError(`Rust artifact ${path} does not hash to its manifest (${entry.sha256}); rebuild with ${buildCommand(variant)}`, { variant, changed: [path] });
    return { path, sourceHash, manifest };
  }
  const pointer = pointerFile(root, variant);
  if (!existsSync(pointer)) throw new RustBuildMissingError(`no Rust build of variant '${variant}'; run ${buildCommand(variant)}`, { variant });
  const last = JSON.parse(readFileSync(pointer, 'utf8'));
  const lastManifest = join(cacheEntry(root, last.sourceHash), 'manifest.json');
  const old = existsSync(lastManifest) ? JSON.parse(readFileSync(lastManifest, 'utf8')).key : null;
  const changed = old ? keyChanges(old, key) : ['<last build manifest missing>'];
  throw new RustBuildStaleError(`Rust build '${variant}' is stale (built ${last.sourceHash.slice(0, 12)}, sources now ${sourceHash.slice(0, 12)}): changed ${changed.join(', ')}; rebuild with ${buildCommand(variant)}`, { variant, changed });
}
