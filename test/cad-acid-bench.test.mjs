import test from 'node:test';
import os from 'node:os';
import path from 'node:path';
import {registeredFiles, buildSystemFiles, selectRustTests, readTestPaths, validateRustTestRegistry} from '../scripts/test-rust.mjs';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {aggregate, selectCases, summarize, geometryDigest, checkOcctRepeat} from '../scripts/acid/bench-report.mjs';
import {ROOT, loadCatalog, loadErrata, readJSON} from '../scripts/acid/common.mjs';

// Synthetic scoreboard inputs exercise the benchmark's filtering contract only.
// They are not kernel proof and are never passed to execution admission.
const catalog = {zones: [{id: 'AC01'}, {id: 'AC02'}]};
function row(kernel, zone, statuses, status = 'PASS') {
  return {kernel, zone, status, reasons: ['aggregate metamorphic check'],
    variants: Object.fromEntries(statuses.map((value, i) => [`V${i}`, {status: value, reason: 'test score'}]))};
}

test('the explicit Rust CI lane includes the benchmark regression suite', () => {
  // This file path is the CI routing contract, not a copied inventory of the lane.
  assert.ok(registeredFiles.includes('test/cad-acid-bench.test.mjs'));
});

// Tiny files here exercise registry admission, not geometry or live CAD proof.
function registryScratch(fn) {
  const cwd = mkdtempSync(path.join(os.tmpdir(), 'wonky-test-registry-'));
  try {
    mkdirSync(path.join(cwd, 'scripts'));
    mkdirSync(path.join(cwd, 'test'));
    for (const name of ['included', 'excluded']) writeFileSync(path.join(cwd, `test/${name}.test.mjs`), '');
    writeFileSync(path.join(cwd, 'scripts/test-rust.list'), '# registration\r\ntest/included.test.mjs # inline comment\r\n\r\n');
    writeFileSync(path.join(cwd, 'scripts/test-rust-excluded.list'), 'test/excluded.test.mjs\n');
    writeFileSync(path.join(cwd, 'scripts/test-rust-heavy.list'), 'test/included.test.mjs\n');
    return fn(cwd);
  } finally { rmSync(cwd, {recursive: true, force: true}); }
}

test('registry reads comments and CRLF, and accounts for every exact path', () => {
  validateRustTestRegistry();
  registryScratch(cwd => {
    assert.deepEqual(readTestPaths('scripts/test-rust.list', cwd), ['test/included.test.mjs']);
    assert.doesNotThrow(() => validateRustTestRegistry({cwd}));
  });
});

test('registry rejects missing registered files and new unaccounted tests', () => {
  registryScratch(cwd => {
    writeFileSync(path.join(cwd, 'scripts/test-rust.list'), 'test/missing.test.mjs\n');
    assert.throws(() => validateRustTestRegistry({cwd}), /RUST_TEST_FILES_MISSING: registered test\/missing\.test\.mjs/);
    writeFileSync(path.join(cwd, 'scripts/test-rust.list'), 'test/included.test.mjs\n');
    writeFileSync(path.join(cwd, 'test/new.test.mjs'), '');
    assert.throws(() => validateRustTestRegistry({cwd}), /RUST_TEST_FILES_UNREGISTERED: test\/new\.test\.mjs/);
  });
});

test('registry rejects stale exclusions, overlap, duplicates and invalid heavy entries', () => {
  registryScratch(cwd => {
    const check = options => validateRustTestRegistry({cwd, ...options});
    assert.throws(() => check({excluded: ['test/missing.test.mjs']}), /RUST_TEST_FILES_MISSING: excluded/);
    assert.throws(() => check({excluded: ['test/included.test.mjs']}), /registered and excluded/);
    assert.throws(() => check({registered: ['test/included.test.mjs', 'test/included.test.mjs']}), /duplicate registered path/);
    assert.throws(() => check({priority: ['test/excluded.test.mjs']}), /heavy path is not registered/);
    assert.throws(() => check({registered: ['../test/included.test.mjs']}), /invalid registered path/);
    assert.throws(() => check({registered: []}), /registration is empty/);
  });
});

test('Git union merges concurrent test registrations without dropping either path', () => {
  registryScratch(cwd => {
    const git = (...args) => {
      const result = spawnSync('git', args, {cwd, encoding: 'utf8', env: {...process.env,
        GIT_AUTHOR_NAME: 'Lane test', GIT_AUTHOR_EMAIL: 'lane@example.com',
        GIT_COMMITTER_NAME: 'Lane test', GIT_COMMITTER_EMAIL: 'lane@example.com'}});
      assert.equal(result.status, 0, `${args.join(' ')}\n${result.stdout}\n${result.stderr}`);
      return result.stdout;
    };
    git('init', '-q', '-b', 'base');
    writeFileSync(path.join(cwd, '.gitattributes'), readFileSync(new URL('../.gitattributes', import.meta.url)));
    git('add', '.'); git('-c', 'commit.gpgsign=false', 'commit', '-qm', 'registry base');
    for (const branch of ['left', 'right']) {
      git('checkout', '-qb', branch, 'base');
      const list = path.join(cwd, 'scripts/test-rust.list');
      writeFileSync(list, readFileSync(list, 'utf8') + `test/${branch}.test.mjs\n`);
      writeFileSync(path.join(cwd, `test/${branch}.test.mjs`), '');
      git('add', '.'); git('-c', 'commit.gpgsign=false', 'commit', '-qm', `append ${branch}`);
    }
    const output = git('-c', 'commit.gpgsign=false', 'merge', '--no-edit', 'left');
    assert.match(output, /Merge made/);
    assert.equal(git('status', '--porcelain'), '');
    assert.deepEqual(readTestPaths('scripts/test-rust.list', cwd).sort(),
      ['test/included.test.mjs', 'test/left.test.mjs', 'test/right.test.mjs']);
    validateRustTestRegistry({cwd});
    console.log(`Planted union merge: ${output.trim()}; both appended paths retained`);
  });
});

test('benchmark denominator retains exclusions and admits only matched PASS, never expected refusals', () => {
  const selection = selectCases(catalog, {zones: [
    row('wonky-rust', 'AC01', ['PASS', 'PASS', 'REFUSED', 'PASS'], 'REFUSED'),
    row('occt', 'AC01', ['PASS', 'NOT_RUN', 'PASS', 'DISPUTED'], 'NOT_RUN'),
    row('wonky-rust', 'AC02', ['PASS', 'PASS', 'PASS', 'PASS'], 'WRONG'),
    row('occt', 'AC02', ['PASS', 'PASS', 'PASS', 'PASS']),
  ]});
  assert.equal(selection.included.length, 1);
  assert.equal(selection.included[0].zone, 'AC01');
  assert.equal(selection.included[0].variant, 'V0');
  assert.equal(selection.excluded.length, 7);
  assert.match(selection.excluded.find(c => c.zone === 'AC02').reason, /zone: WRONG/);
  assert.match(selection.excluded.find(c => c.zone === 'AC01' && c.variant === 'V2').reason, /REFUSED/);
  const expectedRefusals = selectCases(catalog, {zones: ['wonky-rust', 'occt'].map(kernel =>
    row(kernel, 'AC01', Array(4).fill('REFUSED_EXPECTED'), 'REFUSED_EXPECTED'))});
  assert.equal(expectedRefusals.included.length, 0);
  assert.match(expectedRefusals.excluded[0].reason, /REFUSED_EXPECTED/);
  // v2's CORRECT includes expected refusals; only its preserved strict PASS
  // qualifies. A practical-only aggregate must not leak passing variants in.
  const v2 = (kernel, strictStatus, status = 'CORRECT') => {
    const cell = row(kernel, 'AC01', Array(4).fill(status), status);
    cell.strictStatus = strictStatus;
    for (const variant of Object.values(cell.variants)) variant.strictStatus = strictStatus;
    return cell;
  };
  const strict = v2('wonky-rust', 'PASS');
  assert.equal(selectCases(catalog, {zones:[strict,v2('occt','PASS')]}).included.length,4);
  assert.equal(selectCases(catalog, {zones:[strict,v2('occt','REFUSED_EXPECTED')]}).included.length,0);
  const tolerant = v2('occt','PASS');tolerant.status='TOLERANT';tolerant.strictStatus='WRONG';
  assert.equal(selectCases(catalog, {zones:[strict,tolerant]}).included.length,0);
  const limited = selectCases(catalog, {zones: []}, ['AC01']);
  assert.equal(limited.included.length, 0);
  assert.equal(limited.excluded.filter(c => c.reason === 'outside requested zone selection').length, 4);
});

test('unverified aggregate cannot promote otherwise passing variants into benchmark results', () => {
  const selection = selectCases(catalog, {zones: [
    row('wonky-rust', 'AC01', ['PASS', 'PASS', 'PASS', 'PASS'], 'UNVERIFIED'),
    row('occt', 'AC01', ['PASS', 'PASS', 'PASS', 'PASS']),
  ]});
  assert.equal(selection.included.length, 0);
  assert.equal(selection.excluded.length, 8);
  assert.match(selection.excluded.find(c => c.zone === 'AC01').reason, /UNVERIFIED/);
  assert.match(selection.excluded.find(c => c.zone === 'AC02').reason, /NOT_RUN/);
});

test('report totals sum timing medians, use maximum observed RSS, and keep uninstrumented kernel time null', () => {
  const series = (times, rss) => ({summary: summarize(times.map((ms, i) => ({
    constructionMs: ms, peakRssMiB: rss[i], kernelOnlyMs: null,
  })))});
  const a = {'wonky-rust': series([7, 1, 3], [80, 90, 120]), occt: series([2, 6, 4], [100, 200, 300])};
  const b = {'wonky-rust': series([11, 13, 9], [60, 75, 100]), occt: series([10, 8, 12], [90, 100, 200])};
  assert.equal(a['wonky-rust'].summary.constructionMs.n, 3);
  assert.equal(a['wonky-rust'].summary.constructionMs.min, 1);
  assert.equal(a['wonky-rust'].summary.constructionMs.median, 3);
  assert.equal(a['wonky-rust'].summary.constructionMs.max, 7);
  const total = aggregate([a, b]);
  assert.equal(total.constructionMs.wonky, 14);
  assert.equal(total.constructionMs.occt, 14);
  assert.equal(total.constructionMs.ratio, 1);
  assert.equal(total.peakRssMiB.wonky, 120);
  assert.equal(total.peakRssMiB.occt, 300);
  assert.equal(total.peakRssMiB.ratio, 0.4);
  assert.equal(total.kernelOnlyMs.wonky, null);
  assert.equal(total.kernelOnlyMs.ratio, null);
  assert.equal(aggregate([]).constructionMs.ratio, null);
  assert.equal(summarize([{constructionMs: 2}, {constructionMs: 4}]).constructionMs.median, 3);
});

test('repeat binding rejects topology, volume and bbox divergence from qualified geometry', () => {
  const {catalog: realCatalog} = loadCatalog();
  const zone = realCatalog.zones.find(z => z.id === 'AC01');
  const qualified = readJSON(`${ROOT}/fixtures/cad-acid/occt/observations.json`).rows.find(r => r.zone === 'AC01' && r.variant === 'V0');
  const errata = loadErrata();
  assert.equal(checkOcctRepeat(realCatalog, zone, qualified, qualified.metrics, errata), null);
  for (const mutate of [m => { m.volume += 1; }, m => { m.topology.faces += 1; }, m => { m.bbox.min[0] -= 1; }]) {
    const changed = structuredClone(qualified.metrics);
    mutate(changed);
    assert.notEqual(geometryDigest(changed), geometryDigest(qualified.metrics));
    assert.notEqual(checkOcctRepeat(realCatalog, zone, qualified, changed, errata), null);
  }
  const cold = summarize([{coldStartMs: 2, coldPeakRssMiB: 20}, {coldStartMs: 4, coldPeakRssMiB: 40}], true);
  assert.equal(cold.coldStartMs.median, 3);
  assert.equal(cold.coldPeakRssMiB.max, 40);
  assert.equal(aggregate([]).coldStartMs, undefined, 'cold startup is never an additive per-case metric');
});

test('CLI requires five production reps, accepts one only as smoke, and refuses invalid arguments before execution', () => {
  const cli = fileURLToPath(new URL('../scripts/acid/bench.mjs', import.meta.url));
  const cases = [
    [['--reps', '1'], /At least 5 reps/],
    [['--reps', '4'], /At least 5 reps/],
    [['--smoke', '--reps', '0'], /At least 5 reps/],
    [['--reps', '5.5'], /At least 5 reps/],
    [['--timeout', 'NaN'], /Invalid timeout/],
    [['--zones'], /needs a value/],
    // AC06 (retired, never reused) exercises the next real guard: parsing accepted the repetition count.
    [['--zones', 'AC06', '--reps', '1', '--smoke'], /Unknown zone/],
    [['--zones', 'AC06', '--reps', '5'], /Unknown zone/],
    [['--zones', 'AC06'], /Unknown zone/],
  ];
  for (const [args, reason] of cases) {
    const result = spawnSync(process.execPath, [cli, ...args], {encoding: 'utf8', timeout: 10_000,
      env: {...process.env, NODE_OPTIONS: '--max-old-space-size=8192'}});
    assert.equal(result.status, 1, `${args}: ${result.stderr}`);
    assert.match(result.stderr, reason);
  }
});


const root = fileURLToPath(new URL('../', import.meta.url));
function git(cwd, ...args) {
  const r = spawnSync('git', args, {cwd, encoding: 'utf8', env: {...process.env,
    GIT_AUTHOR_NAME: 'Lane test', GIT_AUTHOR_EMAIL: 'lane@example.com',
    GIT_COMMITTER_NAME: 'Lane test', GIT_COMMITTER_EMAIL: 'lane@example.com'}});
  if (r.stderr) process.stderr.write(r.stderr);
  assert.equal(r.status, 0, r.stderr);
  return r.stdout;
}
function plant(cwd, file) {
  mkdirSync(path.dirname(path.join(cwd, file)), {recursive:true});
  writeFileSync(path.join(cwd, file), 'planted path change\n');
  git(cwd, 'add', file);
  git(cwd, 'commit', '-qm', `plant ${file}`);
}

test('real main...HEAD path comparison skips exactly four machinery files, and planted inputs restore them', () => {
  const cwd = mkdtempSync(path.join(os.tmpdir(), 'wonky-lane-filter-'));
  try {
    git(cwd, 'init', '-q', '-b', 'main');
    plant(cwd, 'README.md');
    git(cwd, 'checkout', '-qb', 'strand/lane-test');
    plant(cwd, 'src/interpreter.mjs');
    const selected = selectRustTests({cwd, all:false});
    assert.deepEqual(selected.skipped, buildSystemFiles);
    assert.deepEqual(selected.files, registeredFiles.filter(f => !buildSystemFiles.includes(f)));
    assert.equal(selected.files.length, registeredFiles.length - 4);
    for (const options of [{gate:true, all:false}, {all:true}]) {
      assert.deepEqual(selectRustTests({cwd, ...options}).files, registeredFiles);
      assert.deepEqual(selectRustTests({cwd, ...options}).skipped, []);
    }
    // Each plant starts with the same clean, unrelated-change branch.
    const unrelated = git(cwd, 'rev-parse', 'HEAD').trim();
    for (const input of ['scripts/acid/planted.mjs', 'scripts/rust/planted.mjs',
      'src/native/rust-build-key.mjs', 'fixtures/rust/addon-build/Cargo.toml',
      'fixtures/rust/addon-render/Cargo.toml', ...buildSystemFiles]) {
      git(cwd, 'reset', '--hard', '-q', unrelated);
      plant(cwd, input);
      const selected = selectRustTests({cwd, all:false});
      assert.deepEqual(selected.files, registeredFiles, input);
      assert.deepEqual(selected.skipped, [], input);
      assert.match(selected.reason, /input changed against main/);
    }
    git(cwd, 'branch', '-D', 'main');
    assert.deepEqual(selectRustTests({cwd, all:false}).files, registeredFiles,
      'missing baseline must run all, never silently skip');
  } finally { rmSync(cwd, {recursive:true, force:true}); }
});

test('gate entry point and ALL override preserve the complete registered set', () => {
  for (const [entry, args, env] of [
    ['scripts/gate-parallel-lanes.mjs', ['--list'], {WONKY_LANE_ALL:'0'}],
    ['scripts/test-rust.mjs', ['--gate', '--list'], {WONKY_LANE_ALL:'0'}],
    ['scripts/test-rust.mjs', ['--list'], {WONKY_LANE_ALL:'1'}],
  ]) {
    const run = spawnSync(process.execPath, [entry, ...args], {cwd:root, encoding:'utf8',
      env:{...process.env, ...env}});
    if (run.stderr) process.stderr.write(run.stderr);
    assert.equal(run.status, 0, run.stderr);
    const result = JSON.parse(run.stdout.trim().split('\n').at(-1));
    assert.deepEqual(result.files, registeredFiles, entry);
    assert.deepEqual(result.skipped, [], entry);
    assert.equal(result.registeredCount, registeredFiles.length);
  }
  assert.match(readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf8'), /run: pnpm test:rust --gate/);
  assert.equal(new Set(registeredFiles).size, registeredFiles.length);
  for (const file of buildSystemFiles) assert.ok(registeredFiles.includes(file), file);
});
