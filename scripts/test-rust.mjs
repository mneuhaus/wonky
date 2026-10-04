// Explicit Rust/JS lane: one node process per listed file (under the Bend guard),
// run in a bounded pool. Never fall back to node --test discovery.
// Register new tests in scripts/test-rust.list; exact exclusions are in
// scripts/test-rust-excluded.list, scheduling priorities in test-rust-heavy.list.
//
//   --gate              mandatory complete list (landing and CI)
//   --list              print the selection without running tests
//   WONKY_LANE_ALL=1     complete list even outside a gate
//   WONKY_LANE_JOBS=<n>  concurrent files (default min(6, floor(cores / 3)), at least 1;
//                        1 runs them one after another in list order, as before)
//
// Files share nothing mutable: each writes its own out/test-rust/<file>.guard.json,
// scratch output goes to per-test mkdtemp directories or to per-file fixed paths
// (out/regularized-tests, tmp/rust/test), and planted source edits happen in
// throwaway copies of the tree, never in the working tree other files load from.
// Each file's stdout/stderr is buffered and printed as one block, in list order,
// once it and every file before it finished. Fail-fast: after a failure no new file
// starts; files already running finish and are reported. Any failure fails the lane.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn, spawnSync} from 'node:child_process';
import {provisionBrowser} from './viewer/qa/provision-browser.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
// Registration is data so parallel additions can use Git's union merge driver.
// Exclusions are exact paths: new tests cannot disappear behind a glob.
export function readTestPaths(file, cwd = root) {
  return fs.readFileSync(path.join(cwd, file), 'utf8').split(/\r?\n/)
    .map(line => line.replace(/#.*$/, '').trim()).filter(Boolean);
}
export const registeredFiles = readTestPaths('scripts/test-rust.list');
const heavy = readTestPaths('scripts/test-rust-heavy.list');
export function validateRustTestRegistry({cwd = root,
  registered = readTestPaths('scripts/test-rust.list', cwd),
  excluded = readTestPaths('scripts/test-rust-excluded.list', cwd),
  priority = readTestPaths('scripts/test-rust-heavy.list', cwd)} = {}) {
  if (!registered.length) throw new Error('RUST_TEST_FILES_MISSING: registration is empty');
  for (const [name, files] of [['registered', registered], ['excluded', excluded], ['heavy', priority]]) {
    if (new Set(files).size !== files.length) throw new Error(`RUST_TEST_FILES_INCONSISTENT: duplicate ${name} path`);
    for (const file of files) {
      if (!/^test\/[^/]+\.test\.mjs$/.test(file)) throw new Error(`RUST_TEST_FILES_INCONSISTENT: invalid ${name} path ${file}`);
      if (!fs.existsSync(path.join(cwd, file)) || !fs.statSync(path.join(cwd, file)).isFile())
        throw new Error(`RUST_TEST_FILES_MISSING: ${name} ${file}`);
    }
  }
  const overlap = excluded.find(file => registered.includes(file));
  if (overlap) throw new Error(`RUST_TEST_FILES_INCONSISTENT: registered and excluded ${overlap}`);
  const unregisteredPriority = priority.find(file => !registered.includes(file));
  if (unregisteredPriority) throw new Error(`RUST_TEST_FILES_INCONSISTENT: heavy path is not registered ${unregisteredPriority}`);
  const accounted = new Set([...registered, ...excluded]);
  const unlisted = fs.readdirSync(path.join(cwd, 'test')).filter(file => file.endsWith('.test.mjs'))
    .map(file => `test/${file}`).filter(file => !accounted.has(file)).sort();
  if (unlisted.length) throw new Error(`RUST_TEST_FILES_UNREGISTERED: ${unlisted.join(', ')}`);
}


// These files exercise the build system/scorer, rather than modeling.
// They remain registered and mandatory in gates. An unavailable comparison
// (including source-only runner mirrors) conservatively runs the complete lane.
export const buildSystemFiles = [
  'test/cad-acid.test.mjs',
  'test/rust-wire.test.mjs',
  'test/rust-addon-freshness.test.mjs',
  'test/rust-addon-build.test.mjs',
];
export function selectRustTests({cwd = root, gate = false, all = process.env.WONKY_LANE_ALL === '1'} = {}) {
  const complete = reason => ({files: [...registeredFiles], skipped: [], reason});
  if (gate) return complete('gate: every registered file is mandatory');
  if (all) return complete('WONKY_LANE_ALL=1');
  const diff = spawnSync('git', ['diff', '--name-only', '-z', 'main...HEAD'], {cwd, encoding: 'utf8'});
  if (diff.error || diff.status !== 0) {
    if (diff.stderr) process.stderr.write(diff.stderr);
    return complete('main...HEAD comparison unavailable; running all files');
  }
  const changed = diff.stdout.split('\0').filter(Boolean);
  const input = changed.find(file => file.startsWith('scripts/rust/')
    || /^src\/native\/rust-[^/]*\.mjs$/.test(file)
    || file.startsWith('scripts/acid/') || file.startsWith('fixtures/rust/addon-build/')
    || file.startsWith('fixtures/rust/addon-render/')
    || buildSystemFiles.includes(file));
  if (input) return complete(`build-system/scorer input changed against main: ${input}`);
  return {files: registeredFiles.filter(file => !buildSystemFiles.includes(file)),
    skipped: [...buildSystemFiles], reason: 'no build-system/scorer inputs changed in git diff main...HEAD'};
}

// Scheduling only: the longest files start first so the pool drains evenly. Output
// order stays the registration list order. Sequential seconds on the Studio (2026-09-28):
// rust-wire 460, cad-acid 400, rust-addon-freshness 114, cad-acid-tolerance 63,
// rust-observation 35, rust-bicylinder 10, rust-cli-export 4, cad-acid-witness 3;
// the remaining files take a few seconds or less. rust-wire and rust-addon-freshness
// both run Cargo builds and start together; freshness ends (~120 s) before rust-wire
// reaches its cold-build test. Keeping the two apart measured 527 s instead of 418 s,
// with identical results.
async function main() {
validateRustTestRegistry();
const {files, skipped, reason} = selectRustTests({gate: process.argv.includes('--gate')});
console.log(`Rust lane: ${files.length}/${registeredFiles.length} registered files selected; ${reason}`);
if (skipped.length) console.log(`Rust lane: skipped ${skipped.join(', ')}; ${reason}`);
if (process.argv.includes('--list')) {
  console.log(JSON.stringify({files, skipped, reason, registeredCount: registeredFiles.length}));
  return;
}
const jobsSetting = process.env.WONKY_LANE_JOBS ?? '';
const jobs = jobsSetting === '' ? Math.max(1, Math.min(6, Math.floor(os.availableParallelism() / 3))) : Number(jobsSetting);
if (!Number.isInteger(jobs) || jobs < 1) throw new Error(`WONKY_LANE_JOBS must be a positive integer (got '${jobsSetting}')`);
const out = path.join(root, 'out/test-rust');
fs.mkdirSync(out, {recursive:true});
// A piped child picks node:test's TAP reporter; keep the spec reporter a terminal would have shown.
const reporter = process.stdout.isTTY ? ['--test-reporter=spec'] : [];

// Browser tests are mandatory. Provision before the pool so a cold download is
// not charged to an individual test's timeout, and fail the lane on any error.
await provisionBrowser();

const running = new Set();
let failed = false;
function runFile(file) {
  const guardLog = path.join(out, `${path.basename(file)}.guard.json`);
  fs.rmSync(guardLog, {force:true});
  const chunks = [], t0 = performance.now();
  return new Promise(resolve => {
    // node:test executes on direct invocation too. One process per file means the
    // guard observes the actual test imports, not a test-runner parent process.
    const child = spawn(process.execPath, ['--import', path.join(root, 'scripts/r20/bend-guard.mjs'), ...reporter, path.join(root, file)], {
      cwd:root, stdio:['inherit', 'pipe', 'pipe'], env:{...process.env, WONKY_BACKEND:'rust', NODE_OPTIONS:'--max-old-space-size=8192', WONKY_BEND_GUARD_LOG:guardLog},
    });
    running.add(child);
    child.stdout.on('data', chunk => chunks.push([process.stdout, chunk]));
    child.stderr.on('data', chunk => chunks.push([process.stderr, chunk]));
    let settled = false;
    const settle = (status, error) => {
      if (settled) return;
      settled = true;
      running.delete(child);
      if (error) chunks.push([process.stderr, Buffer.from(`${error.stack ?? error}\n`)]);
      let guarded = false;
      try { guarded = JSON.parse(fs.readFileSync(guardLog, 'utf8')).summary?.bendLoaded === false; }
      catch (guardError) { chunks.push([process.stderr, Buffer.from(`Bend guard log ${guardLog} unreadable: ${guardError.message}\n`)]); }
      resolve({file, chunks, status, guarded, seconds:(performance.now() - t0) / 1000});
    };
    child.once('error', error => settle(null, error));
    child.once('close', status => settle(status));
  });
}

// Blocks print in list order: a finished file waits for every file listed before it.
const results = new Array(files.length);
let printed = 0;
function print({file, chunks, status, guarded}) {
  console.log(`\nRust lane: ${file}`);
  for (const [stream, chunk] of chunks) stream.write(chunk);
  if (status !== 0 || !guarded) console.error(`RUST_TEST_FAILED: ${file}; exit=${status}; Bend-free=${guarded}`);
}

const queue = jobs === 1 ? [...files] : [...heavy.filter(file => files.includes(file)), ...files.filter(file => !heavy.includes(file))];
const t0 = performance.now();
async function worker() {
  while (queue.length && !failed) {
    const file = queue.shift();
    const result = await runFile(file);
    if (result.status !== 0 || !result.guarded) failed = true;
    results[files.indexOf(file)] = result;
    while (printed < files.length && results[printed]) print(results[printed++]);
  }
}
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { failed = true; for (const child of running) child.kill(signal); });
await Promise.all(Array.from({length:Math.min(jobs, files.length)}, worker));
// After a failure, files that never started leave gaps; print the ones that ran, still in list order.
for (; printed < files.length; printed++) if (results[printed]) print(results[printed]);
const notRun = files.filter((_, i) => !results[i]);
const slowest = results.filter(Boolean).sort((a, b) => b.seconds - a.seconds).slice(0, 8).map(r => `${r.file} ${r.seconds.toFixed(1)}s`);
console.log(`\nRust lane: ${files.length - notRun.length}/${files.length} files, ${jobs} jobs, wall ${((performance.now() - t0) / 1000).toFixed(1)}s; slowest: ${slowest.join(', ')}`);
if (failed) {
  if (notRun.length) console.error(`RUST_TEST_NOT_RUN (fail-fast): ${notRun.join(' ')}`);
  process.exitCode = 1;
}

if (!process.exitCode) {
  console.log('\nRust lane: scripts/acid/test_status_page.py');
  const pageTest = spawnSync('uv', ['run', '--no-project', 'python', 'scripts/acid/test_status_page.py'], {cwd:root, stdio:'inherit'});
  if (pageTest.error) throw pageTest.error;
  if (pageTest.status !== 0) {
    console.error(`RUST_TEST_FAILED: scripts/acid/test_status_page.py; exit=${pageTest.status}`);
    process.exitCode = 1;
  }
}

}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
