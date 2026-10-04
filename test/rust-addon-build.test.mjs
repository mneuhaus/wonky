// Build/freshness machinery tests use real Cargo and the production builder
// and stale loader, on a tiny cdylib workspace. The full kernel integration
// remains in rust-wire and rust-addon-freshness and in the gate's addon build.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { addonBuildRoot, buildFixture } from './helpers/addon-build-fixture.mjs';
import { computeKey } from '../src/native/rust-build-key.mjs';
import { locateRustBuild, rustStaleCheck } from '../src/native/rust-kernel.mjs';
import { NativeKernelStaleError } from '../src/native/errors.mjs';
import { renderKey, rendererMatches, rendererPaths } from '../src/native/render-build-key.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
function checkRenderer(fixture, built) {
  const key = renderKey(fixture);
  assert.equal(built.renderer.sourceHash, key.sourceHash);
  const paths = rendererPaths(fixture, key);
  assert.ok(rendererMatches(paths.binary, JSON.parse(readFileSync(paths.manifest)), key));
  const identity = spawnSync(paths.binary, ['--build-identity'], { encoding: 'utf8' });
  assert.equal(identity.status, 0, identity.stderr);
  assert.equal(identity.stdout.trim(), key.sourceHash);
  return paths;
}
test('a changed, added or removed rust/ file, or a different binary, makes the build stale before anything loads', () => {
  const fixture = addonBuildRoot();
  checkRenderer(fixture, buildFixture(fixture));
  const fixtureCache = join(fixture, 'tmp/rust/cache');
  const located = locateRustBuild({ cacheRoot: fixtureCache });
  const copy = fixture;
  try {
    assert.equal(rustStaleCheck(located, { root: copy }).sourceHash, located.manifest.sourceHash);
    const lib = join(copy, 'rust/wonky-wire/src/lib.rs');
    const originalLib = readFileSync(lib);
    writeFileSync(lib, readFileSync(lib, 'utf8') + '\n// edit\n');
    assert.throws(() => rustStaleCheck(located, { root: copy }), error => error instanceof NativeKernelStaleError && /^BX_STALE: the Rust addon build 'rust' is stale: /.test(error.message) && /rust\/wonky-wire\/src\/lib\.rs changed/.test(error.message) && /node scripts\/rust\/build-node\.mjs/.test(error.message));
    writeFileSync(lib, originalLib);
    writeFileSync(join(copy, 'rust/wonky-node/src/extra.rs'), '// new file\n');
    assert.throws(() => rustStaleCheck(located, { root: copy }), error => error instanceof NativeKernelStaleError && /rust\/wonky-node\/src\/extra\.rs added/.test(error.message));
    rmSync(join(copy, 'rust/wonky-node/src/extra.rs'));
    rmSync(join(copy, 'rust/wonky-node/build.rs'));
    assert.throws(() => rustStaleCheck(located, { root: copy }), error => error instanceof NativeKernelStaleError && /rust\/wonky-node\/build\.rs removed/.test(error.message));
  } finally { cpSync(join(root, 'rust/wonky-node/build.rs'), join(copy, 'rust/wonky-node/build.rs')); }
  // A binary that is not the recorded one.
  const cache = mkdtempSync(join(tmpdir(), 'wonky-rust-cache-'));
  try {
    cpSync(located.dir, join(cache, located.manifest.sourceHash), { recursive: true });
    cpSync(join(dirname(located.dir), 'node.json'), join(cache, 'node.json'));
    const node = join(cache, located.manifest.sourceHash, 'wonky-node.node');
    const bytes = readFileSync(node); bytes[bytes.length - 1] ^= 1; writeFileSync(node, bytes);
    assert.throws(() => rustStaleCheck(locateRustBuild({ cacheRoot: cache }), { root: fixture }), error => error instanceof NativeKernelStaleError && /sha256 differs/.test(error.message));
    const repair = buildFixture(fixture, [], ['--cache', cache]);
    assert.equal(repair.cached, false, 'corrupt cached bytes must trigger the recommended rebuild');
    assert.equal(rustStaleCheck(locateRustBuild({ cacheRoot: cache }), { root: fixture }).sourceHash, located.manifest.sourceHash);
    assert.equal(buildFixture(fixture, [], ['--cache', cache]).cached, true);
  } finally { rmSync(cache, { recursive: true, force: true }); rmSync(fixture, { recursive: true, force: true }); }
});

test('addon poisoning: environment and ancestor config never masquerade as the canonical build', () => {
  const fixture = addonBuildRoot();
  checkRenderer(fixture, buildFixture(fixture));
  const canonical = locateRustBuild({ cacheRoot: join(fixture, 'tmp/rust/cache') });
  const cache = mkdtempSync(join(tmpdir(), 'wonky-addon-poison-'));
  const copy = addonBuildRoot();
  try {
    const poisoned = buildFixture(fixture, [], ['--cache', cache], { ...process.env, CARGO_TARGET_DIR: join(fixture, 'rust/target'), CARGO_PROFILE_RELEASE_OPT_LEVEL: '0' });
    assert.notEqual(poisoned.sourceHash, canonical.manifest.sourceHash);
    assert.throws(() => rustStaleCheck(locateRustBuild({ cacheRoot: cache }), { root: fixture }),
      e => e instanceof NativeKernelStaleError && /CARGO_PROFILE_RELEASE_OPT_LEVEL/.test(e.message));
    for (const variable of ['CARGO_PROFILE_RELEASE_PANIC', 'RUSTFLAGS']) {
      const run = spawnSync(process.execPath, [join(fixture, 'scripts/rust/build-node.mjs'), '--cache', cache, '--features', 'plant-panic'],
        { cwd: fixture, encoding: 'utf8', env: { ...process.env, CARGO_TARGET_DIR: join(fixture, 'rust/target'), [variable]: variable === 'RUSTFLAGS' ? '-C panic=abort' : 'abort' } });
      assert.notEqual(run.status, 0, `${variable} must not produce a loadable abort addon`);
      assert.match(run.stderr, /wonky-node requires panic=unwind/);
    }
    // A config in the parent of rust/ is deliberately outside the keyed tree.
    mkdirSync(join(copy, '.cargo'));
    writeFileSync(join(copy, '.cargo/config.toml'), '[profile.release]\npanic="abort"\n');
    assert.throws(() => rustStaleCheck(canonical, { root: copy }),
      e => e instanceof NativeKernelStaleError && /cargo config/.test(e.message));
    const run = spawnSync('cargo', ['build', '--release', '--offline', '--locked', '-p', 'wonky-node'],
      { cwd: join(copy, 'rust'), encoding: 'utf8', env: { ...process.env, CARGO_TARGET_DIR: join(copy, 'rust/target') } });
    assert.notEqual(run.status, 0);
    assert.match(run.stderr, /wonky-node requires panic=unwind/);
  } finally {
    rmSync(cache, { recursive: true, force: true }); rmSync(copy, { recursive: true, force: true });
    rmSync(fixture, { recursive: true, force: true });
  }
});

test('cold addon build follows Cargo artifact messages for all target-dir mechanisms (P7)', { timeout: 180000 }, () => {
  const fixture = addonBuildRoot();
  const dir = mkdtempSync(join(tmpdir(), 'wonky-cargo-artifact-'));
  const home = join(dir, 'cargo-home');
  mkdirSync(home);
  writeFileSync(join(home, 'config.toml'), `[build]\ntarget-dir = ${JSON.stringify(join(dir, 'configured'))}\n`);
  try {
    for (const [name, env, target] of [
      ['CARGO_TARGET_DIR', { CARGO_TARGET_DIR: join(dir, 'direct') }, join(dir, 'direct')],
      ['CARGO_BUILD_TARGET_DIR', { CARGO_BUILD_TARGET_DIR: join(dir, 'build-env') }, join(dir, 'build-env')],
      ['build.target-dir', { CARGO_HOME: home }, join(dir, 'configured')],
    ]) {
      const built = buildFixture(fixture, [], ['--cache', join(dir, `cache-${name}`)], {
        ...process.env, CARGO_TARGET_DIR: undefined, CARGO_BUILD_TARGET_DIR: undefined, ...env,
      });
      assert.equal(built.cached, false, name);
      assert.equal(built.cargoArtifact, join(target, 'release', process.platform === 'darwin' ? 'libwonky_node.dylib' : 'libwonky_node.so'), name);
      assert.ok(existsSync(join(built.dir, 'wonky-node.node')), name);
      assert.equal(built.renderer.cached, name === 'CARGO_BUILD_TARGET_DIR',
        `${name}: target paths reuse the renderer; changed Cargo config rebuilds it`);
      assert.ok(built.renderer.sourceHash, `${name}: renderer identity must be published`);
      // Each mechanism is a separate cold build. Its checked artifacts are no
      // longer needed; retaining all three targets multiplies scratch usage.
      rmSync(target, { recursive: true, force: true });
      rmSync(join(dir, `cache-${name}`), { recursive: true, force: true });
    }
  } finally { rmSync(dir, { recursive: true, force: true }); rmSync(fixture, { recursive: true, force: true }); }
});

test('builder honors an absolute CARGO_TARGET_DIR and still validates source hash', () => {
  const fixture = addonBuildRoot();
  const cache = mkdtempSync(join(tmpdir(), 'wonky-node-target-'));
  try {
    const target = join(fixture, 'rust/target');
    const built = buildFixture(fixture, [], ['--cache', cache], { ...process.env, CARGO_TARGET_DIR: target });
    assert.equal(built.cached, false);
    checkRenderer(fixture, built);
    assert.equal(built.sourceHash, computeKey(fixture).sourceHash);
    assert.equal(buildFixture(fixture, [], ['--cache', cache], { ...process.env, CARGO_TARGET_DIR: target }).cached, true);
    const nested = spawnSync(process.execPath, [join(fixture, 'scripts/rust/build-node.mjs'), '--cache', cache], { cwd: fixture, encoding: 'utf8',
      env: { ...process.env, CARGO_TARGET_DIR: 'nested-output' } });
    assert.notEqual(nested.status, 0);
    assert.match(nested.stderr, /CARGO_TARGET_DIR.*rust\/target/);
    const rootOutput = spawnSync(process.execPath, [join(fixture, 'scripts/rust/build-node.mjs'), '--cache', cache], { cwd: fixture, encoding: 'utf8',
      env: { ...process.env, CARGO_TARGET_DIR: '.' } });
    assert.notEqual(rootOutput.status, 0);
    assert.match(rootOutput.stderr, /CARGO_TARGET_DIR.*rust\/target/);
  } finally { rmSync(cache, { recursive: true, force: true }); rmSync(fixture, { recursive: true, force: true }); }
});

test('addon cache hits still build, validate and repair the required renderer', () => {
  const fixture = addonBuildRoot();
  try {
    const cold = buildFixture(fixture);
    assert.equal(cold.renderer.cached, false);
    const paths = checkRenderer(fixture, cold);
    const warm = buildFixture(fixture);
    assert.equal(warm.cached, true);
    assert.equal(warm.renderer.cached, true);
    checkRenderer(fixture, warm);
    const bytes = readFileSync(paths.binary);
    bytes[bytes.length - 1] ^= 1;
    writeFileSync(paths.binary, bytes);
    const repaired = buildFixture(fixture);
    assert.equal(repaired.cached, true);
    assert.equal(repaired.renderer.cached, false, 'corrupt renderer must be rebuilt even on an addon cache hit');
    checkRenderer(fixture, repaired);
    const source = join(fixture, 'render/wonky-render/src/main.rs');
    const original = readFileSync(source, 'utf8');
    writeFileSync(source, original.replace('env!("WONKY_RENDER_SOURCE_HASH")', '"planted-wrong-identity"'));
    const rejected = spawnSync(process.execPath, [join(fixture, 'scripts/rust/build-node.mjs')],
      { cwd: fixture, encoding: 'utf8', env: { ...process.env, CARGO_TARGET_DIR: join(fixture, 'rust/target') } });
    if (rejected.stderr) process.stderr.write(rejected.stderr);
    assert.notEqual(rejected.status, 0, 'a renderer without the keyed identity must fail the addon builder');
    assert.match(rejected.stderr, /render\/build-identity-mismatch/);
    writeFileSync(source, original);
    checkRenderer(fixture, buildFixture(fixture));
  } finally { rmSync(fixture, { recursive: true, force: true }); }
});
