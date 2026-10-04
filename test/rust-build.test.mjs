// K0 (docs/rust-migration.md 6): the Rust workspace builds offline from exactly
// the files git tracks (or would track) in rust/ plus scripts/rust/build*.mjs,
// with the same sourceHash as this checkout; a second build is a cache hit; the
// workspace tests (wonky-num property suite: 1e6 random + 1e5 near-degenerate
// cases per predicate against num-rational) pass in that export; and the loader
// refuses a stale or tampered build, naming the changed file. A build under a
// changed build env (CARGO_PROFILE_*, CARGO_TARGET_<triple>_RUSTFLAGS) or an
// outer .cargo/config.toml gets another key, so it can never stand in for the
// canonical build (K0 verify defect 3: the /1 key cached an opt-level=0 build
// under the canonical sourceHash).
//
// Everything runs in a temporary export (git init + add, like a fresh clone)
// with an empty CARGO_HOME, so no registry cache can stand in for rust/vendor.
// The export sits one level below its own temp dir, so a planted outer
// .cargo/config.toml never touches the shared temp dir.
// Slow lane: two cold cargo release builds plus `cargo test --release` (about two minutes).
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { computeKey as addonKey } from '../src/native/rust-build-key.mjs';
import { artifactInsideSources, outerCargoConfigs } from '../scripts/rust/build-key.mjs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildKey, openRustArtifact, sourceFiles } from '../scripts/rust/build-key.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
let exportBase, exportDir, cargoHome;

function build(dir, args = [], extraEnv = {}) {
  const run = spawnSync(process.execPath, ['--max-old-space-size=8192', 'scripts/rust/build.mjs', ...args], {
    cwd: dir, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, CARGO_HOME: cargoHome, CARGO_NET_OFFLINE: 'true', ...extraEnv },
  });
  assert.equal(run.status, 0, `build.mjs ${args.join(' ')} failed:\n${run.stderr}`);
  return run.stdout.trim().split('\n').map(line => JSON.parse(line));
}

before(() => {
  exportBase = mkdtempSync(join(tmpdir(), 'wonky-rust-export-'));
  exportDir = join(exportBase, 'checkout');
  cargoHome = mkdtempSync(join(tmpdir(), 'wonky-cargo-home-'));
  for (const path of sourceFiles(root)) {
    mkdirSync(dirname(join(exportDir, path)), { recursive: true });
    cpSync(join(root, path), join(exportDir, path));
  }
  // Rust tests include fixtures outside rust/ (include_bytes!/include_str!); the offline export needs them.
  for (const path of sourceFiles(root).filter(file => file.endsWith('.rs'))) {
    for (const match of readFileSync(join(root, path), 'utf8').matchAll(/include_(?:bytes|str)!\(\s*"([^"]+)"/g)) {
      const target = relative(root, resolve(dirname(join(root, path)), match[1]));
      if (target.startsWith('..') || !existsSync(join(root, target)) || existsSync(join(exportDir, target))) continue;
      mkdirSync(dirname(join(exportDir, target)), { recursive: true });
      cpSync(join(root, target), join(exportDir, target));
    }
  }
  execFileSync('git', ['init', '-q'], { cwd: exportDir });
  execFileSync('git', ['add', '-A'], { cwd: exportDir });
});

after(() => {
  rmSync(exportBase, { recursive: true, force: true });
  rmSync(cargoHome, { recursive: true, force: true });
});

test('a relative CARGO_HOME is keyed where cargo reads it: relative to rust/', () => {
  // Land3 Astra gate: build-key resolved it against the node cwd while cargo (cwd rust/) read
  // another config, so an opt-level=0 build kept the canonical key.
  const tmp = mkdtempSync(join(tmpdir(), 'wonky-cargo-home-'));
  try {
    mkdirSync(join(tmp, 'repo', 'rust'), { recursive: true });
    mkdirSync(join(tmp, 'repo', 'tmp', 'relative-cargo-home'), { recursive: true });
    writeFileSync(join(tmp, 'repo', 'tmp', 'relative-cargo-home', 'config.toml'), '[profile.release]\nopt-level = 0\n');
    const configs = outerCargoConfigs(join(tmp, 'repo'), { CARGO_HOME: '../tmp/relative-cargo-home' });
    assert.deepEqual(configs.map(([path]) => path), [realpathSync(join(tmp, 'repo', 'tmp', 'relative-cargo-home', 'config.toml'))]);
    // Land3 Astra re-gate: CARGO_HOME=../tmp/link-parent/alias/.. where alias is a symlink; the OS
    // resolves alias before '..', so cargo reads elsewhere/config.toml, not link-parent/config.toml.
    mkdirSync(join(tmp, 'repo', 'tmp', 'link-parent'), { recursive: true });
    mkdirSync(join(tmp, 'repo', 'tmp', 'elsewhere', 'child'), { recursive: true });
    symlinkSync(join(tmp, 'repo', 'tmp', 'elsewhere', 'child'), join(tmp, 'repo', 'tmp', 'link-parent', 'alias'));
    writeFileSync(join(tmp, 'repo', 'tmp', 'elsewhere', 'config.toml'), '[profile.release]\nopt-level = 0\n');
    const viaSymlink = outerCargoConfigs(join(tmp, 'repo'), { CARGO_HOME: '../tmp/link-parent/alias/..' });
    assert.deepEqual(viaSymlink.map(([path]) => path), [realpathSync(join(tmp, 'repo', 'tmp', 'elsewhere', 'config.toml'))]);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('cargo artifacts in a relative target dir outside rust/ are accepted; inside rust/ they are refused', () => {
  // Land3 Astra re-gate: cargo reports rust/../tmp/relative-target/..., which a textual prefix check refused.
  const tmp = mkdtempSync(join(tmpdir(), 'wonky-target-dir-'));
  try {
    const rust = join(tmp, 'repo', 'rust');
    mkdirSync(join(rust, 'target', 'release'), { recursive: true });
    mkdirSync(join(rust, 'stray', 'release'), { recursive: true });
    mkdirSync(join(tmp, 'repo', 'tmp', 'relative-target', 'release'), { recursive: true });
    for (const dir of [join(rust, 'target', 'release'), join(rust, 'stray', 'release'), join(tmp, 'repo', 'tmp', 'relative-target', 'release')]) writeFileSync(join(dir, 'lib.dylib'), '');
    assert.equal(artifactInsideSources(`${rust}/../tmp/relative-target/release/lib.dylib`, rust), false);
    assert.equal(artifactInsideSources(join(rust, 'target', 'release', 'lib.dylib'), rust), false);
    assert.equal(artifactInsideSources(join(rust, 'stray', 'release', 'lib.dylib'), rust), true);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('offline build from the tracked files has the checkout\'s sourceHash; the second build is a cache hit', () => {
  assert.deepEqual(sourceFiles(exportDir), sourceFiles(root), 'the export holds exactly the key files');
  const expected = buildKey(root, 'release').sourceHash;
  const [first] = build(exportDir);
  assert.equal(first.cacheHit, false);
  assert.equal(first.sourceHash, expected);
  const [second] = build(exportDir);
  assert.equal(second.cacheHit, true);
  assert.equal(second.sourceHash, expected);
  assert.deepEqual(second.artifacts, first.artifacts);
  const { path } = openRustArtifact(exportDir);
  const usage = spawnSync(path, [], { encoding: 'utf8' });
  assert.equal(usage.status, 2);
  assert.match(usage.stderr, /usage: planar-spike run\|bench/);
});

test('the workspace tests pass offline in the export (wonky-num property suite)', () => {
  const [, tested] = build(exportDir, ['--test']);
  assert.equal(tested.ok, true);
});

test('a build under a changed build env gets its own key and never stands in for the canonical build', () => {
  const expected = buildKey(root, 'release').sourceHash;
  const canonical = openRustArtifact(exportDir);
  assert.equal(canonical.sourceHash, expected);
  // the verifier's poisoning repro: before key /2 this build was cached under the canonical sourceHash
  const [poisoned] = build(exportDir, [], { CARGO_PROFILE_RELEASE_OPT_LEVEL: '0' });
  assert.equal(poisoned.cacheHit, false);
  assert.notEqual(poisoned.sourceHash, expected);
  assert.notEqual(poisoned.artifacts['planar-spike'].sha256, canonical.manifest.artifacts['planar-spike'].sha256, 'opt-level 0 must produce another binary');
  const [again] = build(exportDir);
  assert.equal(again.cacheHit, true);
  assert.equal(again.sourceHash, expected);
  assert.deepEqual(again.artifacts, canonical.manifest.artifacts);
  // the loader names the keyed variable; unkeyed ones (locations, terminal) do not change the key
  const env = { ...process.env, CARGO_TARGET_AARCH64_APPLE_DARWIN_RUSTFLAGS: '-Ctarget-cpu=native' };
  assert.throws(() => openRustArtifact(exportDir, { env }), error => error.name === 'RustBuildStaleError' && error.changed.includes('<build env: CARGO_TARGET_AARCH64_APPLE_DARWIN_RUSTFLAGS>'));
  assert.equal(openRustArtifact(exportDir, { env: { ...process.env, CARGO_TERM_COLOR: 'always', CARGO_HOME: cargoHome } }).sourceHash, expected);
});

test('an outer .cargo/config.toml above rust/ makes the loader refuse the build and name the file', () => {
  const dir = join(exportBase, '.cargo');
  const config = join(dir, 'config.toml');
  mkdirSync(dir);
  writeFileSync(config, '[profile.release]\nopt-level = 0\n');
  try {
    assert.throws(() => openRustArtifact(exportDir), error => error.name === 'RustBuildStaleError' && error.changed.includes(`<cargo config: ${config}>`));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  assert.equal(openRustArtifact(exportDir).sourceHash, buildKey(root, 'release').sourceHash);
});

test('a changed .rs file makes the loader refuse the build and name the file', () => {
  const file = 'rust/wonky-num/src/predicates.rs';
  const original = readFileSync(join(exportDir, file));
  appendFileSync(join(exportDir, file), '// planted stale change\n');
  try {
    assert.throws(() => openRustArtifact(exportDir), error => error.name === 'RustBuildStaleError' && error.changed.length === 1 && error.changed[0] === file && error.message.includes(file));
  } finally {
    writeFileSync(join(exportDir, file), original);
  }
  assert.equal(openRustArtifact(exportDir).sourceHash, buildKey(root, 'release').sourceHash);
});

test('an ignored but compilable Rust source changes the key and is named when stale', () => {
  // .gitignore has an unanchored out/ pattern; git ls-files omits this module.
  const file = 'rust/wonky-num/src/out/mod.rs';
  const dir = dirname(join(exportDir, file));
  mkdirSync(dir);
  writeFileSync(join(exportDir, file), 'pub const MARKER: u8 = 1;\n');
  try {
    assert.ok(sourceFiles(exportDir).includes(file), 'ignored Rust source must be keyed');
    assert.throws(() => openRustArtifact(exportDir), error => error.name === 'RustBuildStaleError' && error.changed.includes(file) && error.message.includes(file));
    const first = buildKey(exportDir, 'release').sourceHash;
    writeFileSync(join(exportDir, file), 'pub const MARKER: u8 = 2;\n');
    assert.notEqual(buildKey(exportDir, 'release').sourceHash, first, 'edits inside ignored dirs must change the source hash');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  assert.equal(openRustArtifact(exportDir).sourceHash, buildKey(root, 'release').sourceHash);
});

test('a tampered cached artifact is refused', () => {
  const { path } = openRustArtifact(exportDir);
  const original = readFileSync(path);
  appendFileSync(path, Buffer.from([0]));
  try {
    assert.throws(() => openRustArtifact(exportDir), error => error.name === 'RustBuildStaleError' && /does not hash to its manifest/.test(error.message));
  } finally {
    writeFileSync(path, original);
  }
});

test('addon key refuses symlinked Rust input, including ignored directories', () => {
  const linked = join(exportDir, 'rust/wonky-num/src/out/linked.rs');
  mkdirSync(dirname(linked), { recursive: true });
  symlinkSync(join(exportDir, 'rust/wonky-num/src/lib.rs'), linked);
  try { assert.throws(() => addonKey(exportDir), /unexpected Rust input/); }
  finally { rmSync(dirname(linked), { recursive: true, force: true }); }
});

test('a build for an explicit cargo target triple never hands out a binary of older sources', () => {
  // Land3 Opus gate: build.mjs copied target/<variant>/release/planar-spike, but with an explicit
  // triple cargo writes target/<variant>/<triple>/release/planar-spike, so the binary of an earlier
  // default build shipped under the new key. Artifacts now come from cargo's compiler-artifact messages.
  const host = execFileSync('rustc', ['-vV'], { encoding: 'utf8' }).match(/^host: (.+)$/m)[1];
  const src = join(exportDir, 'rust/wonky-replay/src/bin/planar-spike.rs');
  const original = readFileSync(src, 'utf8');
  build(exportDir);
  try {
    writeFileSync(src, original.replace('usage: planar-spike', 'usage-triple: planar-spike'));
    build(exportDir, [], { CARGO_BUILD_TARGET: host });
    const env = { ...process.env, CARGO_HOME: cargoHome, CARGO_BUILD_TARGET: host };
    const { path } = openRustArtifact(exportDir, { env });
    const run = spawnSync(path, [], { encoding: 'utf8' });
    assert.match(run.stderr, /usage-triple: planar-spike/, `the cached binary predates the source edit:\n${run.stderr}`);
  } finally { writeFileSync(src, original); }
});
