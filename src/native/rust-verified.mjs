// Verification record of the Rust addon stale check (src/native/rust-kernel.mjs).
//
// The full check recomputes the build key: it runs `rustc -vV` and `cargo -V`
// (about 60 ms through the rustup proxies) and hashes every rust/ input file
// (760 files, 40-110 ms cold). Every process that opens the addon paid that,
// and an acid cell paid it three times (pkg-perf-frontend, 2026-10-02: 90 of
// the 94 ms median "frontend" per cell).
//
// After a full check succeeds, the loader records a stat fingerprint of
// everything the key reads; a later check whose fingerprint is identical skips
// the rehash and the probes. Any difference, or a missing/unreadable record,
// falls back to the full check, which stays the only authority for staleness.
//
// The fingerprint is (size, mtime ns, ctime ns, inode) of: every key input
// (the same walk as the key, so an added or removed file changes it), the
// addon binary, the pointer and manifest, the toolchain binaries the probes
// would run (rustc/cargo on PATH and their targets, every rustup toolchain's
// bin/rustc, bin/cargo and librustc_driver, rustup's settings.toml), plus the
// keyed build environment, the outer Cargo configs (by content hash), the
// rustup-relevant environment and the project root. ctime cannot be set from
// user space and changes on every write, so a content change with restored
// mtime is still seen. Assumption: a toolchain change touches one of the
// stamped files (the binaries print the version `rustc -vV` reports).
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, realpathSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { keyedEnv, outerCargoConfigs } from '../../scripts/rust/build-key.mjs';
import { inputFiles, pointerName } from './rust-build-key.mjs';

export const VERIFIED_SCHEMA = 'wonky-rust-verified/1';

const stamp = path => {
  try { const s = statSync(path, { bigint: true }); return `${s.size}:${s.mtimeNs}:${s.ctimeNs}:${s.ino}`; }
  catch (error) { if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return 'absent'; throw error; }
};
const listing = dir => { try { return readdirSync(dir).sort(); } catch (error) { if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return []; throw error; } };

// The binaries `rustc -vV` and `cargo -V` resolve to, as seen from rust/.
function toolchainStamps(env) {
  const out = [['env', ['PATH', 'HOME', 'RUSTUP_HOME', 'RUSTUP_TOOLCHAIN', 'CARGO_HOME'].map(name => env[name] ?? null)]];
  for (const tool of ['rustc', 'cargo']) {
    const found = (env.PATH ?? '').split(delimiter).filter(Boolean).map(dir => join(dir, tool)).find(path => existsSync(path));
    out.push([tool, found ?? null, found ? stamp(found) : null, found ? realpathSync(found) : null, found ? stamp(realpathSync(found)) : null]);
  }
  const rustup = env.RUSTUP_HOME ? resolve(env.RUSTUP_HOME) : join(homedir(), '.rustup');
  out.push(['settings', stamp(join(rustup, 'settings.toml'))], ['toolchains', stamp(join(rustup, 'toolchains'))]);
  for (const name of listing(join(rustup, 'toolchains'))) {
    const dir = join(rustup, 'toolchains', name);
    const drivers = listing(join(dir, 'lib')).filter(file => file.startsWith('librustc_driver'));
    out.push([name, stamp(dir), stamp(join(dir, 'bin/rustc')), stamp(join(dir, 'bin/cargo')), ...drivers.map(file => [file, stamp(join(dir, 'lib', file))])]);
  }
  return out;
}

export function verificationFingerprint({ dir, features }, root, env = process.env) {
  const cacheRoot = dirname(dir);
  const files = inputFiles(root).map(path => [path, stamp(join(root, path))]);
  const value = {
    schema: VERIFIED_SCHEMA, root: resolve(root), dir, features: [...features].sort(),
    pointer: stamp(join(cacheRoot, pointerName(features))), manifest: stamp(join(dir, 'manifest.json')), node: stamp(join(dir, 'wonky-node.node')),
    env: keyedEnv(env), cargoConfigs: outerCargoConfigs(root, env), toolchain: toolchainStamps(env), files,
  };
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

const recordPath = ({ dir, features }) => join(dirname(dir), pointerName(features).replace(/\.json$/, '.verified.json'));

// The record of an earlier full check with this fingerprint, or null.
export function readVerified(located, fingerprint) {
  let record;
  try { record = JSON.parse(readFileSync(recordPath(located), 'utf8')); }
  catch { return null; }
  const ok = record?.schema === VERIFIED_SCHEMA && record.fingerprint === fingerprint && record.sourceHash === located.manifest.sourceHash && typeof record.path === 'string';
  return ok ? { sourceHash: record.sourceHash, path: record.path } : null;
}

// Written after a full check; atomic, so parallel cells never read a torn record.
export function writeVerified(located, fingerprint, verified) {
  const path = recordPath(located), temp = `${path}.${process.pid}.tmp`;
  try {
    writeFileSync(temp, JSON.stringify({ schema: VERIFIED_SCHEMA, fingerprint, sourceHash: verified.sourceHash, path: verified.path }) + '\n');
    renameSync(temp, path);
  } catch { /* a read-only cache keeps working with the full check */ }
}
