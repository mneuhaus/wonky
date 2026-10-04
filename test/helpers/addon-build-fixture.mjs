// Checkout-shaped fixture: runs the unmodified builder, generators, key and
// stale loader. Only the Cargo crates are reduced; no fake Cargo process,
// prebuilt binary, generator bypass or production fixture mode is involved.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
export function addonBuildRoot() {
  const copy = realpathSync(mkdtempSync(join(tmpdir(), 'wonky-addon-machinery-')));
  for (const path of ['scripts', 'src', 'kernel']) {
    cpSync(join(root, path), join(copy, path), { recursive: true,
      filter: path => !path.startsWith(join(root, 'scripts/tmp')) });
  }
  cpSync(join(root, 'package.json'), join(copy, 'package.json'));
  cpSync(join(root, 'fixtures/rust/addon-build'), join(copy, 'rust'), { recursive: true });
  cpSync(join(root, 'fixtures/rust/addon-render'), join(copy, 'render/wonky-render'), { recursive: true });
  for (const path of ['build.rs', 'rust-toolchain.toml']) {
    cpSync(join(root, 'render/wonky-render', path), join(copy, 'render/wonky-render', path));
  }
  // Keep the real generation checks and the pinned toolchain/configuration.
  for (const path of ['rust-toolchain.toml', '.cargo/config.toml',
    'wonky-wire/src/generated.rs', 'wonky-node/build.rs',
    'wonky-ops/host-operations.json', 'wonky-ops/src/host.rs']) {
    mkdirSync(join(copy, 'rust', path, '..'), { recursive: true });
    cpSync(join(root, 'rust', path), join(copy, 'rust', path));
  }
  // The tiny crate keeps the real addon's compile-time host-safety invariant.
  const guard = '#[cfg(not(panic = "unwind"))]\ncompile_error!("wonky-node requires panic=unwind: abort would terminate the Node host");';
  assert.ok(readFileSync(join(root, 'rust/wonky-node/src/lib.rs'), 'utf8').includes(guard));
  assert.ok(readFileSync(join(copy, 'rust/wonky-node/src/lib.rs'), 'utf8').includes(guard));
  return copy;
}
export function buildFixture(copy, features = [], extraArgs = [], env = { ...process.env, CARGO_TARGET_DIR: join(copy, 'rust/target') }) {
  const run = spawnSync(process.execPath, [join(copy, 'scripts/rust/build-node.mjs'),
    ...(features.length ? ['--features', features.join(',')] : []), ...extraArgs],
    { cwd: copy, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (run.stderr) process.stderr.write(run.stderr);
  assert.equal(run.status, 0, run.stderr);
  return JSON.parse(run.stdout.trim().split('\n').at(-1));
}
