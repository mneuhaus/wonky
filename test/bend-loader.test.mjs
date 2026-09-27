import test from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missingBend();
if (publicTreeSkip) {
  test("bend-loader.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, unlinkSync, utimesSync, writeFileSync } = await import("node:fs");
const { join } = await import("node:path");
const { fileURLToPath, pathToFileURL } = await import("node:url");
const { execFile } = await import("node:child_process");
const { promisify } = await import("node:util");
const { compileBend, loadBend } = await import("../src/bend-loader.mjs");









const exec = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));
const originalCompiler = join(root, '.tools', 'bend-source-2.0.25', 'bend2');
const api = new URL('../src/bend-loader.mjs', import.meta.url).href;
const program = value => `import Base\n\ndef value() -> U32:\n  ${value}\n`;
function fixture(t, { cloneCompiler = false } = {}) {
  const directory = mkdtempSync(join(root, '.tools', 'bend-loader-test-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const cacheDirectory = join(directory, 'cache');
  const compilerDirectory = cloneCompiler ? join(directory, 'compiler') : originalCompiler;
  if (cloneCompiler) cpSync(originalCompiler, compilerDirectory, { recursive: true });
  const entry = join(directory, 'entry.bend');
  writeFileSync(entry, program(7));
  return { directory, entry, options: { cacheDirectory, compilerDirectory } };
}
const cacheFiles = options => readdirSync(options.cacheDirectory).filter(path => path.endsWith('.json'));
const child = async (entry, options, mode = 'load') => {
  const source = `import { compileBend, loadBend } from ${JSON.stringify(api)};
    const [entry, options, mode] = JSON.parse(process.argv[1]);
    if (mode === 'compile') {
      const result = await compileBend(entry, options);
      console.log(JSON.stringify({ key: result.key, cacheHit: result.cacheHit }));
    } else console.log(JSON.stringify({ value: (await loadBend(entry, options)).value() }));`;
  const result = await exec(process.execPath, ['--input-type=module', '--eval', source, JSON.stringify([entry, options, mode])],
    { cwd: root, env: { ...process.env, WONKY_BEND_CACHE: '1' }, maxBuffer: 1024 * 1024 });
  return JSON.parse(result.stdout);
};

test('checked source is reused across fresh processes and explicit API loads retain behavior', async t => {
  const { entry, options } = fixture(t);
  const first = await compileBend(pathToFileURL(entry), options);
  assert.equal(first.cacheHit, false);
  assert.equal((await loadBend(entry, options)).value(), 7);
  const next = await child(entry, options, 'compile');
  assert.equal(next.cacheHit, true); assert.equal(next.key, first.key);
  assert.deepEqual(await child(entry, options), { value: 7 });
  assert.equal(cacheFiles(options).length, 1);
  const artifact = JSON.parse(readFileSync(first.cachePath));
  assert.ok(artifact.manifest.sources.some(source => source.path === 'compiler:base.bend'));
  for (const name of ['main.ts', 'bend.ts', 'comp.ts']) {
    assert.ok(artifact.manifest.compiler.files.some(source => source.path === `compiler:${name}` || source.path.endsWith(`/${name}`)));
  }
  // The key holds content and relative layout only: no absolute path may leak into it.
  assert.ok(!JSON.stringify(artifact.manifest).includes(root), 'the cache manifest must not contain absolute paths');
});

test('a copy of the same sources in another directory reuses the cache artifact', async t => {
  const { directory, entry, options } = fixture(t);
  writeFileSync(entry, 'import Base\nimport ./lib/leaf.bend as L\n\ndef value() -> U32:\n  L.value()\n');
  for (const target of ['lib', 'copy/lib']) {
    mkdirSync(join(directory, target), { recursive: true });
    writeFileSync(join(directory, target, 'leaf.bend'), program(5));
  }
  cpSync(entry, join(directory, 'copy', 'entry.bend'));
  const first = await compileBend(entry, options);
  assert.equal(first.cacheHit, false);
  const copy = await child(join(directory, 'copy', 'entry.bend'), options, 'compile');
  assert.equal(copy.cacheHit, true); assert.equal(copy.key, first.key);
  writeFileSync(join(directory, 'copy', 'lib', 'leaf.bend'), program(6));
  const changed = await compileBend(join(directory, 'copy', 'entry.bend'), options);
  assert.equal(changed.cacheHit, false); assert.notEqual(changed.key, first.key);
  assert.equal((await loadBend(join(directory, 'copy', 'entry.bend'), options)).value(), 6);
});

test('entry, nested dependency and dependency-path changes invalidate without trusting timestamps', async t => {
  const { directory, entry, options } = fixture(t);
  const middle = join(directory, 'middle.bend'), leaf = join(directory, 'leaf.bend');
  writeFileSync(entry, 'import Base\nimport ./middle.bend as M\n\ndef value() -> U32:\n  M.value()\n');
  writeFileSync(middle, 'import Base\nimport ./leaf.bend as L\n\ndef value() -> U32:\n  L.value()\n');
  writeFileSync(leaf, program(2));
  const before = await compileBend(entry, options), timestamps = statSync(leaf);
  assert.equal((await loadBend(entry, options)).value(), 2);
  writeFileSync(leaf, program(3)); utimesSync(leaf, timestamps.atime, timestamps.mtime);
  const nested = await compileBend(entry, options);
  assert.equal(nested.cacheHit, false); assert.notEqual(nested.key, before.key);
  assert.equal((await loadBend(entry, options)).value(), 3);
  writeFileSync(entry, `${readFileSync(entry, 'utf8')}\n# changed entry bytes\n`);
  const changed = await compileBend(entry, options);
  assert.notEqual(changed.key, nested.key); assert.equal(changed.cacheHit, false);
  const other = join(directory, 'other.bend'); writeFileSync(other, program(4));
  writeFileSync(middle, readFileSync(middle, 'utf8').replace('./leaf.bend', './other.bend'));
  assert.equal((await loadBend(entry, options)).value(), 4);
  unlinkSync(other);
  await assert.rejects(compileBend(entry, options), { code: 'ENOENT' });
});

test('Base, lock bytes and actual compiler changes invalidate and load a fresh compiler realm', async t => {
  const { directory, entry, options } = fixture(t, { cloneCompiler: true });
  const lockFile = join(directory, 'bend.lock.json');
  cpSync(join(root, 'bend.lock.json'), lockFile); options.lockFile = lockFile;
  const first = await compileBend(entry, options);
  const base = join(options.compilerDirectory, 'base.bend');
  writeFileSync(base, `${readFileSync(base, 'utf8')}\n# local test Base revision\n`);
  const changedBase = await compileBend(entry, options);
  assert.equal(changedBase.cacheHit, false); assert.notEqual(changedBase.key, first.key);
  writeFileSync(lockFile, `${readFileSync(lockFile, 'utf8')}\n`);
  const changedLock = await compileBend(entry, options);
  assert.notEqual(changedLock.key, changedBase.key);
  const main = join(options.compilerDirectory, 'main.ts'), bytes = readFileSync(main, 'utf8');
  const original = 'return Comp.js_lib(book, outs, outs);';
  assert.ok(bytes.includes(original));
  writeFileSync(main, bytes.replace(original, 'return Comp.js_lib(book, outs, outs) + "\\nexport const compiler_revision_test = 42;\\n";'));
  const changedCompiler = await compileBend(entry, options);
  assert.equal(changedCompiler.cacheHit, false); assert.notEqual(changedCompiler.key, changedLock.key);
  assert.match(changedCompiler.source, /export const compiler_revision_test = 42;/);
  assert.equal((await loadBend(entry, options)).value(), 7);
  const comp = join(options.compilerDirectory, 'comp.ts');
  writeFileSync(comp, `${readFileSync(comp, 'utf8')}\n// actual code-generator bytes changed\n`);
  assert.notEqual((await compileBend(entry, options)).key, changedCompiler.key);
});

test('foreign JS dependencies and retargeted local symlinks cannot reuse stale artifacts', async t => {
  const { directory, entry, options } = fixture(t);
  const foreign = join(directory, 'foreign.js');
  writeFileSync(entry, `${program(7)}\ndef ignored() -> IO(U32):\n  import "foreign.js"\n`);
  writeFileSync(foreign, '// Test-only unused foreign source, first revision\n');
  const first = await compileBend(entry, options);
  writeFileSync(foreign, '// Test-only unused foreign source, second revision\n');
  assert.notEqual((await compileBend(entry, options)).key, first.key);
  const a = join(directory, 'a.bend'), b = join(directory, 'b.bend'), linked = join(directory, 'linked.bend');
  writeFileSync(a, program(1)); writeFileSync(b, program(2)); symlinkSync(a, linked);
  writeFileSync(entry, 'import Base\nimport ./linked.bend as L\n\ndef value() -> U32:\n  L.value()\n');
  assert.equal((await loadBend(entry, options)).value(), 1);
  unlinkSync(linked); symlinkSync(b, linked);
  assert.equal((await loadBend(entry, options)).value(), 2);
});

test('compile failures after a warm cache are visible and cannot publish or return an old artifact', async t => {
  const { entry, options } = fixture(t);
  const first = await compileBend(entry, options), original = readFileSync(entry, 'utf8');
  writeFileSync(entry, program('undefined_value'));
  await assert.rejects(compileBend(entry, options), /undefined_value|defined name/);
  await assert.rejects(loadBend(entry, options), /undefined_value|defined name/);
  assert.deepEqual(cacheFiles(options), [`${first.key}.json`]);
  writeFileSync(entry, program(9));
  assert.equal((await loadBend(entry, options)).value(), 9);
  writeFileSync(entry, original);
  assert.equal((await compileBend(entry, options)).cacheHit, true);
});

test('concurrent processes atomically publish one complete artifact with no partial reads', async t => {
  const { entry, options } = fixture(t);
  const results = await Promise.all([child(entry, options), child(entry, options), child(entry, options)]);
  assert.deepEqual(results, [{ value: 7 }, { value: 7 }, { value: 7 }]);
  assert.equal(cacheFiles(options).length, 1);
  assert.ok(readdirSync(options.cacheDirectory).every(path => path.endsWith('.json')));
  assert.equal((await compileBend(entry, options)).cacheHit, true);
  assert.equal((await loadBend(entry, options)).value(), 7);
});

test('explicit and environment bypass perform real compilation without reading or writing the cache', async t => {
  const { entry, options } = fixture(t);
  const original = await compileBend(entry, options), bytes = readFileSync(original.cachePath);
  const first = await compileBend(entry, { ...options, cache: false });
  const second = await compileBend(entry, { ...options, cache: false });
  assert.equal(first.cacheHit, false); assert.equal(second.cacheHit, false);
  assert.equal(first.cachePath, null); assert.equal(second.cachePath, null);
  assert.equal(first.source, original.source);
  const previous = process.env.WONKY_BEND_CACHE; process.env.WONKY_BEND_CACHE = '0';
  try {
    const bypassed = await compileBend(entry, options);
    assert.equal(bypassed.cacheHit, false); assert.equal(bypassed.cachePath, null);
  } finally {
    if (previous === undefined) delete process.env.WONKY_BEND_CACHE;
    else process.env.WONKY_BEND_CACHE = previous;
  }
  assert.deepEqual(readFileSync(original.cachePath), bytes);
});

test('corrupt cached output fails explicitly; bypass still invokes the checked compiler', async t => {
  const { entry, options } = fixture(t), first = await compileBend(entry, options);
  const artifact = JSON.parse(readFileSync(first.cachePath));
  artifact.source += '\nthrow new Error("must never execute");\n';
  writeFileSync(first.cachePath, JSON.stringify(artifact));
  await assert.rejects(loadBend(entry, options), { code: 'BEND_CACHE_CORRUPT' });
  assert.equal((await loadBend(entry, { ...options, cache: false })).value(), 7);
  writeFileSync(first.cachePath, 'null');
  await assert.rejects(compileBend(entry, options), { code: 'BEND_CACHE_CORRUPT' });
  writeFileSync(first.cachePath, '{');
  await assert.rejects(compileBend(entry, options), { code: 'BEND_CACHE_CORRUPT' });
});

test('an edit during compilation fails closed and writes no cache entry for the prior snapshot', async t => {
  const { entry, options } = fixture(t);
  const pending = compileBend(entry, options);
  writeFileSync(entry, program(8));
  await assert.rejects(pending, { code: 'BEND_SOURCES_CHANGED' });
  assert.throws(() => readdirSync(options.cacheDirectory), { code: 'ENOENT' });
  assert.equal((await loadBend(entry, options)).value(), 8);
});

test('unsupported dependency/version contracts are explicit and never treated as cache hits', async t => {
  const { directory, entry, options } = fixture(t);
  writeFileSync(entry, 'import Base\nimport 0x1234567890abcdef1234567890abcdef/x.bend as H\n\ndef value() -> U32:\n  7\n');
  await assert.rejects(compileBend(entry, options), { code: 'BEND_CACHE_REMOTE_IMPORT' });
  const lockFile = join(directory, 'unsupported.lock.json'); writeFileSync(lockFile, '{"version":"0.0.0"}');
  await assert.rejects(compileBend(entry, { ...options, lockFile }), { code: 'BEND_CACHE_VERSION' });
  writeFileSync(entry, 'import ./entry.bend as Self\n');
  await assert.rejects(compileBend(entry, options), { code: 'BEND_CACHE_IMPORT_CYCLE' });
  symlinkSync(entry, join(directory, 'alias.bend'));
  writeFileSync(entry, 'import ./alias.bend as Self\n');
  await assert.rejects(compileBend(entry, options), { code: 'BEND_CACHE_IMPORT_CYCLE' });
  await assert.rejects(compileBend(entry, { ...options, cache: 'yes' }), TypeError);
});

test('creating the implicit LAWS sibling cannot bypass the pinned PROOF import requirement', async t => {
  const { directory, options } = fixture(t), proof = join(directory, 'PROOF.bend');
  writeFileSync(proof, program(7));
  const before = await compileBend(proof, options);
  writeFileSync(join(directory, 'LAWS.bend'), program(1));
  await assert.rejects(compileBend(proof, options), { code: 'BEND_COMPILER_EXIT' });
  assert.deepEqual(cacheFiles(options), [`${before.key}.json`]);
});

}
