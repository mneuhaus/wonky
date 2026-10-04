// The verification record of the Rust addon stale check (src/native/rust-verified.mjs):
// an unchanged repeat skips the toolchain probes and the rehash; every change,
// including an edit whose mtime is restored, runs the full check, which still
// refuses a stale build. Checks run in child processes that count the
// `rustc`/`cargo` probes, on throwaway copies of the key inputs and the cache.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { KEY_SCRIPTS } from '../src/native/rust-build-key.mjs';
import { locateRustBuild } from '../src/native/rust-kernel.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
let work, copy, cache, located;

before(() => {
  const run = spawnSync(process.execPath, [join(root, 'scripts/rust/build-node.mjs')], { cwd: root, encoding: 'utf8', maxBuffer: 64 << 20 });
  assert.equal(run.status, 0, run.stderr);
  work = mkdtempSync(join(tmpdir(), 'wonky-rust-verified-'));
  copy = join(work, 'root');
  cpSync(join(root, 'rust'), join(copy, 'rust'), { recursive: true, filter: src => !src.includes('/rust/target') });
  for (const path of KEY_SCRIPTS) { mkdirSync(dirname(join(copy, path)), { recursive: true }); cpSync(join(root, path), join(copy, path)); }
  const real = locateRustBuild();
  cache = join(work, 'cache');
  cpSync(real.dir, join(cache, real.manifest.sourceHash), { recursive: true });
  cpSync(join(dirname(real.dir), 'node.json'), join(cache, 'node.json'));
  located = locateRustBuild({ cacheRoot: cache });
  writeFileSync(join(work, 'count.mjs'), `import cp from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
const original = cp.spawnSync; globalThis.probes = 0;
cp.spawnSync = function (cmd, ...rest) { if (cmd === 'rustc' || cmd === 'cargo') globalThis.probes++; return original.call(this, cmd, ...rest); };
syncBuiltinESMExports();\n`);
});
after(() => rmSync(work, { recursive: true, force: true }));

// One process: the given checks in order; [{ ok, probes, code?, message? }, ...].
function checks(script) {
  const kernel = pathToFileURL(join(root, 'src/native/rust-kernel.mjs')).href;
  const body = `const { locateRustBuild, openRustBackend, rustStaleCheck } = await import(${JSON.stringify(kernel)});
const cacheRoot = ${JSON.stringify(cache)}, root = ${JSON.stringify(copy)}, out = [];
const step = async fn => { const before = globalThis.probes; try { const v = await fn(); out.push({ ok: true, probes: globalThis.probes - before, sourceHash: v.sourceHash }); }
  catch (error) { out.push({ ok: false, probes: globalThis.probes - before, code: error.code, message: error.message }); } };
${script}
console.log(JSON.stringify(out));`;
  const run = spawnSync(process.execPath, ['--import', pathToFileURL(join(work, 'count.mjs')).href, '--input-type=module', '-e', body], { cwd: root, encoding: 'utf8', maxBuffer: 64 << 20 });
  assert.equal(run.status, 0, run.stderr);
  return JSON.parse(run.stdout.trim().split('\n').pop());
}
const check = 'await step(() => rustStaleCheck(locateRustBuild({ cacheRoot }), { root }));';
const record = () => join(cache, 'node.verified.json');
// Whole-second times survive utimesSync exactly, so a rewrite with restored
// times and the same size leaves only ctime to tell (inode is kept in place).
const PINNED = 1_700_000_000;
const pin = path => utimesSync(path, PINNED, PINNED);
const rewrite = (path, bytes) => { writeFileSync(path, bytes); pin(path); };

test('a repeated check with unchanged inputs skips the probes; the first one runs them and records', () => {
  rmSync(record(), { force: true });
  const [first, second] = checks(check + check);
  assert.deepEqual(first, { ok: true, probes: 2, sourceHash: located.manifest.sourceHash });
  assert.deepEqual(second, { ok: true, probes: 0, sourceHash: located.manifest.sourceHash });
  const kept = JSON.parse(readFileSync(record(), 'utf8'));
  assert.equal(kept.sourceHash, located.manifest.sourceHash);
  assert.deepEqual(checks(check), [{ ok: true, probes: 0, sourceHash: located.manifest.sourceHash }], 'a new process reuses the record');
});

test('an edit with restored mtime, an added file or a tampered binary runs the full check and stays stale', () => {
  const lib = join(copy, 'rust/wonky-wire/src/lib.rs'), original = readFileSync(lib), node = join(located.dir, 'wonky-node.node');
  pin(lib); pin(node);
  checks(check);
  const mtime = statSync(lib, { bigint: true }).mtimeNs;
  const edited = Buffer.from(original); edited[edited.length - 1] = edited[edited.length - 1] === 0x0a ? 0x20 : 0x0a;
  rewrite(lib, edited);
  assert.equal(statSync(lib, { bigint: true }).mtimeNs, mtime, 'the planted edit keeps mtime and size');
  let [result] = checks(check);
  assert.equal(result.ok, false); assert.equal(result.code, 'BX_STALE'); assert.equal(result.probes, 2);
  assert.match(result.message, /rust\/wonky-wire\/src\/lib\.rs changed/);
  rewrite(lib, original);
  assert.deepEqual(checks(check + check).map(r => [r.ok, r.probes]), [[true, 2], [true, 0]]);

  const extra = join(copy, 'rust/wonky-node/src/extra.rs');
  writeFileSync(extra, '// new file\n');
  [result] = checks(check);
  assert.equal(result.code, 'BX_STALE'); assert.match(result.message, /rust\/wonky-node\/src\/extra\.rs added/);
  rmSync(extra);
  checks(check);

  const bytes = readFileSync(node);
  const flipped = Buffer.from(bytes); flipped[flipped.length - 1] ^= 1;
  rewrite(node, flipped);
  [result] = checks(check);
  assert.equal(result.code, 'BX_STALE'); assert.match(result.message, /sha256 differs/);
  rewrite(node, bytes);
  assert.deepEqual(checks(check).map(r => [r.ok, r.probes]), [[true, 2]]);
});

test('an unreadable or foreign record is ignored, never trusted', () => {
  writeFileSync(record(), '{ torn');
  assert.deepEqual(checks(check).map(r => [r.ok, r.probes]), [[true, 2]]);
  const kept = JSON.parse(readFileSync(record(), 'utf8'));
  writeFileSync(record(), JSON.stringify({ ...kept, fingerprint: '0'.repeat(64) }));
  assert.deepEqual(checks(check).map(r => [r.ok, r.probes]), [[true, 2]]);
  writeFileSync(record(), JSON.stringify({ ...kept, sourceHash: 'f'.repeat(64) }));
  assert.deepEqual(checks(check).map(r => [r.ok, r.probes]), [[true, 2]]);
});

test('openRustBackend checks a build once per process; rustStaleCheck always checks', () => {
  rmSync(record(), { force: true });
  const lib = join(copy, 'rust/wonky-wire/src/lib.rs'), original = readFileSync(lib);
  try {
    const results = checks(`await step(() => openRustBackend({ cacheRoot, root }));
(await import('node:fs')).appendFileSync(${JSON.stringify(lib)}, '\\n// edit\\n');
await step(() => openRustBackend({ cacheRoot, root }));
${check}`);
    assert.deepEqual(results.map(r => [r.ok, r.probes]), [[true, 2], [true, 0], [false, 2]]);
    assert.equal(results[2].code, 'BX_STALE');
  } finally { writeFileSync(lib, original); }
});
