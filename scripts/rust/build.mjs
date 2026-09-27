#!/usr/bin/env node
// Cached, offline build of the Rust kernel workspace rust/ (docs/rust-migration.md 3.1, 6 K0).
//
//   1. key and sourceHash of the variant (scripts/rust/build-key.mjs)
//   2. cache hit: tmp/rust/cache/<sourceHash>/manifest.json whose artifacts still
//      hash to the manifest -> update the variant pointer, no cargo run
//   3. miss: cargo <variant args> (--offline --locked, vendored crates only) into
//      rust/target/<variant>, recompute the key (sources must not have changed
//      during the build), copy the artifacts into a staging dir, write
//      manifest.json, rename it into the cache, update the pointer
//   4. --test: afterwards run the workspace tests (cargo test --release, not cached)
// W0 addon builds remain in build-node.mjs: they embed a feature-specific source hash
// and have their own node.json pointer/manifest contract. Folding those into
// this planar-replay builder would change the loader contract, not just the
// Cargo command. Both build keys cover the integrated workspace; unify only
// alongside an addon loader migration and cache compatibility tests.
// cargo output goes to stderr; stdout carries only the JSON result lines.
//
// usage: node scripts/rust/build.mjs [--variant release|plant] [--test | --test-package NAME]
// Prints one JSON line: {variant, sourceHash, cacheHit, artifacts, ms}.
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { CACHE_DIR, RUST_DIR, VARIANTS, buildKey, cacheEntry, openRustArtifact, pointerFile, sha256 } from './build-key.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));

function cargo(args, targetDir) {
  const run = spawnSync('cargo', args, { cwd: join(root, RUST_DIR), stdio: ['ignore', 2, 2], env: { ...process.env, CARGO_TARGET_DIR: targetDir } });
  if (run.error) throw run.error;
  if (run.status !== 0) throw new Error(`cargo ${args.join(' ')} failed with status ${run.status}`);
}

// A build whose artifacts are taken from cargo's own compiler-artifact messages: with an explicit
// target triple (CARGO_BUILD_TARGET, [build] target) cargo writes target/<triple>/release/..., and a
// fixed path would hand out a stale binary from an earlier build under the new key.
function cargoBuild(args, targetDir) {
  const run = spawnSync('cargo', [...args, '--message-format=json-render-diagnostics'], { cwd: join(root, RUST_DIR), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 2], env: { ...process.env, CARGO_TARGET_DIR: targetDir } });
  if (run.error) throw run.error;
  if (run.status !== 0) throw new Error(`cargo ${args.join(' ')} failed with status ${run.status}`);
  return run.stdout.split('\n').filter(line => line.startsWith('{')).map(line => JSON.parse(line)).filter(message => message.reason === 'compiler-artifact');
}

export function reportedExecutable(messages, name) {
  const paths = messages.filter(message => message.target?.name === name && message.target.kind?.includes('bin') && message.executable).map(message => message.executable);
  if (paths.length !== 1) throw new Error(`cargo did not report exactly one '${name}' executable (${paths.length})`);
  return paths[0];
}

export function build(variant = 'release') {
  const t0 = performance.now();
  const { key, sourceHash } = buildKey(root, variant);
  const pointer = pointerFile(root, variant);
  mkdirSync(join(root, CACHE_DIR), { recursive: true });
  try {
    const hit = openRustArtifact(root, { variant, artifact: Object.keys(VARIANTS[variant].artifacts)[0] });
    writeFileSync(pointer, JSON.stringify({ sourceHash: hit.sourceHash }) + '\n');
    return { variant, sourceHash, cacheHit: true, artifacts: hit.manifest.artifacts, ms: Math.round(performance.now() - t0) };
  } catch (error) {
    if (!['RustBuildStaleError', 'RustBuildMissingError'].includes(error.name)) throw error;
  }
  const targetDir = join(root, RUST_DIR, 'target', variant);
  const c0 = performance.now();
  const messages = cargoBuild(VARIANTS[variant].cargo, targetDir);
  const cargoMs = Math.round(performance.now() - c0);
  const after = buildKey(root, variant);
  if (after.sourceHash !== sourceHash) throw new Error(`sources changed during the build (${sourceHash} -> ${after.sourceHash}); rebuild`);
  const entry = cacheEntry(root, sourceHash);
  const staging = `${entry}.staging-${process.pid}`;
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(staging, { recursive: true });
  const artifacts = {};
  for (const name of Object.keys(VARIANTS[variant].artifacts)) {
    const from = reportedExecutable(messages, name);
    copyFileSync(from, join(staging, name));
    artifacts[name] = { sha256: sha256(readFileSync(join(staging, name))), bytes: statSync(join(staging, name)).size };
  }
  const uptime = spawnSync('uptime', { encoding: 'utf8' }).stdout.trim();
  writeFileSync(join(staging, 'manifest.json'), JSON.stringify({ schema: 'wonky-rust-build/1', sourceHash, variant, key, artifacts, cargoMs, builtAt: new Date().toISOString(), uptime }, null, 1) + '\n');
  rmSync(entry, { recursive: true, force: true });
  renameSync(staging, entry);
  writeFileSync(pointer, JSON.stringify({ sourceHash }) + '\n');
  return { variant, sourceHash, cacheHit: false, artifacts, cargoMs, ms: Math.round(performance.now() - t0) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const i = args.indexOf('--variant');
  const variant = i >= 0 ? args[i + 1] : 'release';
  const p = args.indexOf('--test-package');
  const testPackage = p >= 0 ? args[p + 1] : null;
  if (p >= 0 && !/^[a-zA-Z0-9_-]+$/.test(testPackage ?? '')) throw new Error('--test-package requires a crate name');
  console.log(JSON.stringify(build(variant)));
  if (args.includes('--test') || testPackage) {
    const t0 = performance.now();
    const scope = testPackage ? ['--package', testPackage] : ['--workspace'];
    cargo(['test', '--release', '--offline', '--locked', ...scope], join(root, RUST_DIR, 'target', 'test'));
    console.log(JSON.stringify({ test: `cargo test --release ${scope.join(' ')}`, ok: true, ms: Math.round(performance.now() - t0) }));
  }
}
