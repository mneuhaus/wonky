#!/usr/bin/env node
// Cached build of the Rust kernel addon (rust/wonky-node, docs/rust-migration.md W0).
//
//   1. build key (src/native/rust-build-key.mjs): rust/ sources, Cargo.lock, the
//      key scripts, rustc/cargo, profile, features -> sourceHash
//   2. cache hit (tmp/rust/cache/<sourceHash>/manifest.json): update the variant
//      pointer and stop
//   3. otherwise `cargo build --release --offline --locked -p wonky-node`, with
//      WONKY_SOURCE_HASH baked into the binary, the generated wire checked first
//      (gen-wire-rust.mjs --check: a stale rust/wonky-wire/src/generated.rs or
//      src/native/rust-wire.mjs refuses the build), then copy the cdylib to
//      <sourceHash>/wonky-node.node, write manifest.json and the pointer
//      (node.json; node-<features>.json for a planted variant). Keeps the last
//      3 builds per variant.
//
// No npm package or network: external Rust crates are vendored under rust/vendor.
//
//   node scripts/rust/build-node.mjs [--features plant-panic] [--cache DIR]
// Prints one JSON line: { sourceHash, cached, dir, features, buildMs }.
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { NODE_FILE, computeKey, pointerName, sha256 } from '../../src/native/rust-build-key.mjs';
import { artifactInsideSources } from './build-key.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const KEEP = 3;
const KNOWN_FEATURES = new Set(['plant-panic', 'plant-count']);

const args = process.argv.slice(2);
let features = [], cacheRoot = process.env.WONKY_RUST_CACHE ?? join(root, 'tmp/rust/cache');
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--features') features = args[++i].split(',').filter(Boolean);
  else if (args[i] === '--cache') cacheRoot = args[++i];
  else throw new Error(`build-node.mjs: unknown argument ${args[i]}`);
}
for (const f of features) if (!KNOWN_FEATURES.has(f)) throw new Error(`build-node.mjs: unknown feature ${f}`);
features.sort();
// The shared source walker excludes rust/target only. A nested Cargo output
// elsewhere under rust/ would invalidate the key during its own build.
const targetDir = resolve(root, 'rust', process.env.CARGO_TARGET_DIR ?? 'target');
const rustDir = join(root, 'rust');
if ((targetDir === rustDir || targetDir.startsWith(`${rustDir}${sep}`)) && targetDir !== join(rustDir, 'target')) {
  throw new Error(`CARGO_TARGET_DIR ${targetDir} must point outside rust/ or to rust/target`);
}

const writeAtomic = (path, text) => { const tmp = `${path}.${process.pid}.tmp`; writeFileSync(tmp, text); renameSync(tmp, path); };
const t0 = performance.now();
const check = spawnSync(process.execPath, [join(root, 'scripts/native-bridge/gen-wire-rust.mjs'), '--check'], { cwd: root, encoding: 'utf8' });
if (check.status !== 0) {
  process.stderr.write(check.stderr);
  throw new Error(`the generated wire is stale (${check.stdout.trim()}); run node scripts/native-bridge/gen-wire-rust.mjs`);
}
const key = computeKey(root, { features });
const dir = join(cacheRoot, key.sourceHash);
const pointer = join(cacheRoot, pointerName(features));
mkdirSync(cacheRoot, { recursive: true });

let validCache = false;
try {
  const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
  const bytes = readFileSync(join(dir, NODE_FILE));
  validCache = manifest.sourceHash === key.sourceHash && manifest.node?.sha256 === sha256(bytes)
    && manifest.node?.bytes === bytes.length && bytes.includes(key.sourceHash, 0, 'latin1');
} catch { /* Missing, malformed or corrupted entries are rebuilt below. */ }
if (validCache) {
  writeAtomic(pointer, JSON.stringify({ sourceHash: key.sourceHash, features }) + '\n');
  console.log(JSON.stringify({ sourceHash: key.sourceHash, cached: true, dir, features, buildMs: Math.round(performance.now() - t0) }));
  process.exit(0);
}

// Cargo fingerprints source freshness by mtime, while this cache key hashes
// contents. On a cache miss, clean every workspace package (not just wonky-node)
// so an older-mtime edit to any workspace dependency cannot be published under
// a new sourceHash. Vendor artifacts can remain cached: vendor changes only
// arrive with Cargo.lock/vendor updates, and get fresh mtimes through the fixed
// rsync --no-times --checksum sync, git checkouts, or fresh clones.
// Ask Cargo for the actual members rather than duplicating Cargo.toml here.
// Cargo resolves target-dir settings identically for clean and build.
const metadataArgs = ['metadata', '--no-deps', '--offline', '--locked', '--format-version', '1'];
const metadata = spawnSync('cargo', metadataArgs, { cwd: rustDir, encoding: 'utf8' });
if (metadata.error) throw metadata.error;
if (metadata.status !== 0) throw new Error(`cargo ${metadataArgs.join(' ')} exited ${metadata.status}: ${metadata.stderr}`);
const workspace = JSON.parse(metadata.stdout);
const members = workspace.packages.filter(pkg => workspace.workspace_members.includes(pkg.id)).map(pkg => pkg.name);
if (!members.length || members.length !== workspace.workspace_members.length) throw new Error('could not resolve every Cargo workspace member');
const cleanArgs = ['clean', '--release', '--offline', '--locked', ...members.flatMap(name => ['-p', name])];
const clean = spawnSync('cargo', cleanArgs, { cwd: rustDir, stdio: 'inherit' });
if (clean.error) throw clean.error;
if (clean.status !== 0) throw new Error(`cargo ${cleanArgs.join(' ')} exited ${clean.status}`);

const cargoArgs = ['build', '--release', '--offline', '--locked', '--message-format=json', '-p', 'wonky-node', ...(features.length ? ['--features', features.join(',')] : [])];
const t1 = performance.now();
const cargo = spawnSync('cargo', cargoArgs, { cwd: join(root, 'rust'), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  env: { ...process.env, WONKY_SOURCE_HASH: key.sourceHash } });
if (cargo.stderr) process.stderr.write(cargo.stderr);
// In JSON mode Cargo sends rustc diagnostics on stdout, not stderr. Keep
// failure reasons readable for the operator and for panic=unwind regression.
if (cargo.status !== 0 && cargo.stdout) {
  for (const line of cargo.stdout.split('\n').filter(Boolean)) {
    let message;
    try { message = JSON.parse(line); } catch { process.stderr.write(`${line}\n`); continue; }
    if (message.reason === 'compiler-message') process.stderr.write(message.message.rendered ?? `${message.message.message}\n`);
  }
}
if (cargo.error) throw cargo.error;
if (cargo.status !== 0) throw new Error(`cargo ${cargoArgs.join(' ')} exited ${cargo.status}`);
const cargoMs = performance.now() - t1;

// Cargo's compiler-artifact messages identify the actual cdylib, regardless of
// CARGO_TARGET_DIR, CARGO_BUILD_TARGET_DIR or a configured build.target-dir.
const suffix = process.platform === 'darwin' ? 'libwonky_node.dylib' : 'libwonky_node.so';
const artifacts = cargo.stdout.split('\n').filter(Boolean).map(line => JSON.parse(line))
  .filter(message => message.reason === 'compiler-artifact' && message.target?.name === 'wonky_node' && message.target.kind?.includes('cdylib'));
const paths = artifacts.flatMap(message => message.filenames).filter(path => path.endsWith(suffix));
if (paths.length !== 1) throw new Error(`cargo did not report exactly one wonky-node cdylib (${paths.length})`);
const lib = paths[0];
// Cargo reports relative target dirs unnormalized (rust/../tmp/...); compare OS-resolved paths.
if (artifactInsideSources(lib, rustDir)) {
  throw new Error(`Cargo target-dir ${lib} must point outside rust/ or to rust/target`);
}
const bytes = readFileSync(lib);
if (!bytes.includes(key.sourceHash, 0, 'latin1')) throw new Error(`${lib} does not carry source hash ${key.sourceHash} (was WONKY_SOURCE_HASH ignored?)`);
// The key must not have moved while cargo ran (an edit during the build).
const after = computeKey(root, { features, tools: key.toolchain });
if (after.sourceHash !== key.sourceHash) throw new Error('rust/ changed during the build; run it again');

const staging = `${dir}.${process.pid}.staging`;
rmSync(staging, { recursive: true, force: true });
mkdirSync(staging, { recursive: true });
copyFileSync(lib, join(staging, NODE_FILE));
const manifest = { ...key, node: { file: NODE_FILE, sha256: sha256(bytes), bytes: bytes.length }, cargo: cargoArgs, builtAt: new Date().toISOString(), cargoMs: Math.round(cargoMs) };
writeFileSync(join(staging, 'manifest.json'), JSON.stringify(manifest, null, 1) + '\n');
rmSync(dir, { recursive: true, force: true });
renameSync(staging, dir);
writeAtomic(pointer, JSON.stringify({ sourceHash: key.sourceHash, features }) + '\n');

// Keep the last KEEP builds of this variant.
const mine = readdirSync(cacheRoot).filter(name => /^[0-9a-f]{64}$/.test(name)).map(name => {
  try { return { name, m: JSON.parse(readFileSync(join(cacheRoot, name, 'manifest.json'), 'utf8')), t: statSync(join(cacheRoot, name)).mtimeMs }; } catch { return null; }
}).filter(e => e && JSON.stringify(e.m.features) === JSON.stringify(features)).sort((a, b) => b.t - a.t);
for (const old of mine.slice(KEEP)) rmSync(join(cacheRoot, old.name), { recursive: true, force: true });

console.log(JSON.stringify({ sourceHash: key.sourceHash, cached: false, dir, features, buildMs: Math.round(performance.now() - t0), cargoMs: Math.round(cargoMs), cargoArtifact: lib }));
