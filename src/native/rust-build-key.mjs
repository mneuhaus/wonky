// Build key of the Rust addon (rust/wonky-node, docs/rust-migration.md 3.1 and
// W0). The build (scripts/rust/build-node.mjs) and the loader
// (src/native/rust-kernel.mjs) compute it the same way, from what is on disk:
// every file under rust/ except build output (including .cargo config and vendor
// checksum metadata; walked, so an added
// file changes the key too), this module and the build script, the Rust
// toolchain (`rustc -vV`, `cargo -V`), the cargo profile and the features.
// Build environment and ancestor Cargo configuration use K0's shared policy.
// The sourceHash is checkout-independent in an identical build environment.
// Only sourceHash is reproducible across checkout paths: release debug=1
// embeds source paths, so addon bytes and their integrity hashes may differ.
// We do not override Cargo-configured flags merely to remap debug paths.
import { keyedEnv, outerCargoConfigs, walkRustFiles } from '../../scripts/rust/build-key.mjs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const RUST_DIR = 'rust';
export const KEY_SCRIPTS = ['src/native/rust-build-key.mjs', 'src/native/rust-wire.mjs', 'src/native/rust-wire-provenance.json', 'scripts/rust/build-node.mjs', 'scripts/rust/build-key.mjs', 'scripts/rust/shared-sources.mjs'];
export const PROFILE = 'release';
export const NODE_FILE = 'wonky-node.node';
export const SCHEMA = 'wonky-rust-node-build/2';
export const buildCommand = (features = []) => `node scripts/rust/build-node.mjs${features.length ? ` --features ${features.join(',')}` : ''}`;
// The pointer file of a variant: node.json, node-plant-panic.json, ...
export const pointerName = (features = []) => `node${features.length ? `-${[...features].sort().join('-')}` : ''}.json`;

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

export function inputFiles(root) {
  return [...walkRustFiles(root), ...KEY_SCRIPTS].sort();
}

export function toolchain(root) {
  const probe = (cmd, args) => {
    const run = spawnSync(cmd, args, { cwd: join(root, RUST_DIR), encoding: 'utf8' });
    if (run.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed: ${run.error?.message ?? run.stderr}`);
    return run.stdout.trim();
  };
  return { rustc: probe('rustc', ['-vV']), cargo: probe('cargo', ['-V']) };
}

export function computeKey(root, { features = [], tools = toolchain(root), env = process.env } = {}) {
  const files = inputFiles(root).map(path => ({ path, sha256: sha256(readFileSync(join(root, path))) }));
  const key = { schema: SCHEMA, profile: PROFILE, features: [...features].sort(), toolchain: tools, env: keyedEnv(env), cargoConfigs: outerCargoConfigs(root, env), files };
  return { ...key, sourceHash: sha256(JSON.stringify(key)) };
}

// Differences between a recorded key and the current one, for the stale message.
export function keyChanges(recorded, now) {
  const changes = [];
  const before = new Map((recorded.files ?? []).map(f => [f.path, f.sha256]));
  const after = new Map(now.files.map(f => [f.path, f.sha256]));
  for (const [path, hash] of after) if (before.get(path) !== hash) changes.push(before.has(path) ? `${path} changed` : `${path} added`);
  for (const path of before.keys()) if (!after.has(path)) changes.push(`${path} removed`);
  if (recorded.toolchain?.rustc !== now.toolchain.rustc) changes.push('rustc -vV changed');
  if (recorded.toolchain?.cargo !== now.toolchain.cargo) changes.push('cargo -V changed');
  if (JSON.stringify(recorded.features ?? []) !== JSON.stringify(now.features)) changes.push('features changed');
  if (recorded.profile !== now.profile) changes.push('profile changed');
  if (recorded.schema !== now.schema) changes.push('key schema changed');
  for (const name of new Set([...Object.keys(recorded.env ?? {}), ...Object.keys(now.env)])) {
    if (recorded.env?.[name] !== now.env[name]) changes.push(`build env ${name} changed`);
  }
  const oldConfigs = new Map(recorded.cargoConfigs ?? []), newConfigs = new Map(now.cargoConfigs);
  for (const path of new Set([...oldConfigs.keys(), ...newConfigs.keys()])) {
    if (oldConfigs.get(path) !== newConfigs.get(path)) changes.push(`cargo config ${path} changed`);
  }
  return changes;
}
