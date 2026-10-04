import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { keyedEnv } from '../scripts/rust/build-key.mjs';
import { computeKey } from '../src/native/rust-build-key.mjs';
import { sharedSources } from '../scripts/rust/shared-sources.mjs';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sha256 } from '../scripts/rust/build-key.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
// Fixed tools isolate environment policy; real compiler/build/load proof runs on the host.
const tools = { rustc: 'test compiler identity', cargo: 'test cargo identity' };
const key = env => computeKey(root, { tools, env });

test('compiler cache settings leave the addon key identical', () => {
  const baseline = key({});
  for (const env of [
    { RUSTC_WRAPPER: 'sccache' },
    { CARGO_BUILD_RUSTC_WRAPPER: '/opt/homebrew/bin/sccache' },
    { SCCACHE_DIR: '/tmp/compiler-cache', SCCACHE_NAMESPACE: 'another-checkout' },
    { RUSTC_WRAPPER: 'sccache', CARGO_BUILD_RUSTC_WRAPPER: 'sccache', SCCACHE_RECACHE: '1' },
  ]) {
    assert.deepEqual(keyedEnv(env), {});
    assert.deepEqual(key(env), baseline);
  }
});

test('shared sources refuse unkeyed Cargo config at the real snapshot location', () => {
  const directory = mkdtempSync(join(tmpdir(), 'wonky-shared-config-'));
  try {
    const checkout = join(directory, 'checkout'), cache = join(directory, 'cache');
    mkdirSync(join(checkout, 'rust'), { recursive: true });
    writeFileSync(join(checkout, 'rust/Cargo.toml'), '[workspace]');
    const inputs = { sourceHash: 'config-probe', files: [{ path: 'rust/Cargo.toml', sha256: sha256('[workspace]') }] };
    sharedSources(checkout, cache, inputs);
    const alias = join(directory, 'alias');
    symlinkSync(cache, alias, 'dir');
    for (const location of [cache, join(cache, inputs.sourceHash)]) {
      for (const name of ['config', 'config.toml']) {
        mkdirSync(join(location, '.cargo'), { recursive: true });
        writeFileSync(join(location, '.cargo', name), '[build]\nrustflags = ["--cfg", "unkeyed_setting"]\n');
        assert.throws(() => sharedSources(checkout, alias, inputs), /SHARED_SOURCES_OUTER_CONFIG/);
        rmSync(join(location, '.cargo'), { recursive: true });
      }
    }
    assert.equal(sharedSources(checkout, cache, inputs), join(cache, inputs.sourceHash, 'rust'));
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('planted output-changing RUSTFLAGS still invalidate the addon key with sccache', () => {
  const flags = { RUSTFLAGS: '-C panic=abort' };
  assert.deepEqual(keyedEnv({ ...flags, RUSTC_WRAPPER: 'sccache' }), flags);
  assert.notEqual(key(flags).sourceHash, key({}).sourceHash);
  assert.deepEqual(key({ ...flags, RUSTC_WRAPPER: 'sccache' }), key(flags));
});

test('shared compiler sources reuse identical checkouts and reject changed inputs', () => {
  const directory = mkdtempSync(join(tmpdir(), 'wonky-shared-sources-'));
  try {
    const a = join(directory, 'a'), b = join(directory, 'b'), cache = join(directory, 'shared');
    for (const checkout of [a, b]) {
      mkdirSync(join(checkout, 'rust/crate/src'), { recursive: true });
      writeFileSync(join(checkout, 'rust/crate/src/lib.rs'), 'pub fn value() -> u32 { 7 }');
    }
    const file = 'rust/crate/src/lib.rs';
    const inputs = { sourceHash: 'same-key', files: [{ path: file, sha256: sha256(readFileSync(join(a, file))) }] };
    const first = sharedSources(a, cache, inputs);
    assert.equal(sharedSources(b, cache, inputs), first);
    assert.equal(readFileSync(join(first, 'crate/src/lib.rs'), 'utf8'), 'pub fn value() -> u32 { 7 }');
    writeFileSync(join(first, 'crate/src/lib.rs'), 'pub fn value() -> u32 { 8 }');
    assert.throws(() => sharedSources(b, cache, inputs), /SHARED_SOURCE_CORRUPT/);
    writeFileSync(join(first, 'crate/src/lib.rs'), 'pub fn value() -> u32 { 7 }');
    writeFileSync(join(first, 'crate/src/injected.rs'), 'pub fn injected() {}');
    assert.throws(() => sharedSources(b, cache, inputs), /input file set changed/);
    const changed = { sourceHash: 'different-key', files: [{ path: file, sha256: sha256('different content') }] };
    assert.throws(() => sharedSources(b, cache, changed), /SHARED_SOURCE_CORRUPT/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
