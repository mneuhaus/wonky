// Regression: an older-mtime workspace source can differ from its newer Cargo
// fingerprint. The content-hash cache must never publish stale object code
// under the new sourceHash, even when the caller bypasses the fixed rsync sync.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { generatedHostSource } from '../scripts/native-bridge/gen-host-ops.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const MAGIC = 0x31484b57;

function build(copy) {
  const run = spawnSync(process.execPath, ['scripts/rust/build-node.mjs'], {
    cwd: copy, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, CARGO_TARGET_DIR: join(copy, 'tmp/target') },
  });
  if (run.stderr) process.stderr.write(run.stderr);
  assert.equal(run.status, 0, `addon build failed:\n${run.stderr}`);
  return JSON.parse(run.stdout.trim().split('\n').at(-1));
}

function opFive(buildResult) {
  const addon = { exports: {} };
  process.dlopen(addon, join(buildResult.dir, 'wonky-node.node'));
  addon.exports.init({ threads: 1 });
  const reply = addon.exports.hostOp(Uint32Array.from([MAGIC, 1, 5]));
  return String.fromCodePoint(...reply.subarray(1));
}

test('older-mtime changed workspace dependency rebuilds and publishes the STL host operation', { timeout: 600000 }, () => {
  const copy = mkdtempSync(join(tmpdir(), 'wonky-addon-freshness-'));
  try {
    for (const path of ['rust', 'scripts', 'src', 'kernel', 'render']) {
      cpSync(join(root, path), join(copy, path), {
        recursive: true,
        filter: source => !source.startsWith(join(root, 'render/wonky-render/target')) && !source.startsWith(join(root, 'rust/target')) && !source.startsWith(join(root, 'scripts', 'tmp')),
      });
    }
    cpSync(join(root, 'package.json'), join(copy, 'package.json'));
    const source = join(copy, 'rust/wonky-ops/src/host.rs');
    const current = readFileSync(source, 'utf8');
    assert.match(current, /pub const OP_STL: u32 = 5;/);
    // Mutate the registry and regenerate its Rust consumer together: an addon
    // build correctly refuses a handwritten change to a generated constant.
    const registryFile = join(copy, 'rust/wonky-ops/host-operations.json');
    const currentRegistry = readFileSync(registryFile, 'utf8');
    const registry = JSON.parse(currentRegistry);
    const stl = registry.operations.find(op => op.name === 'STL');
    assert.equal(stl?.number, 5);
    stl.number = 55;
    writeFileSync(registryFile, JSON.stringify(registry));
    writeFileSync(source, generatedHostSource(current, registry));
    const oldBuild = build(copy);
    assert.match(opFive(oldBuild), /unknown host op 5/);

    // The new bytes are deliberately older than Cargo's existing fingerprints.
    writeFileSync(source, current);
    writeFileSync(registryFile, currentRegistry);
    const ancient = new Date('2000-01-01T00:00:00Z');
    utimesSync(source, ancient, ancient);
    utimesSync(registryFile, ancient, ancient);
    const fingerprints = readdirSync(join(copy, 'tmp/target/release/.fingerprint'))
      .filter(name => name.startsWith('wonky-ops-'))
      .map(name => join(copy, 'tmp/target/release/.fingerprint', name, 'lib-wonky_ops'))
      .filter(path => { try { return statSync(path).isFile(); } catch { return false; } });
    assert.ok(fingerprints.length > 0, 'first build must have a dependency fingerprint');
    assert.ok(fingerprints.every(path => statSync(source).mtimeMs < statSync(path).mtimeMs));

    const fresh = build(copy);
    assert.equal(fresh.cached, false);
    assert.notEqual(fresh.sourceHash, oldBuild.sourceHash);
    assert.match(opFive(fresh), /request ends early/);
    assert.doesNotMatch(opFive(fresh), /unknown host op 5/);
  } finally {
    rmSync(copy, { recursive: true, force: true });
  }
});
