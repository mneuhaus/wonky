import { missingBend } from './helpers/public-tree.mjs';
// K0 (docs/rust-migration.md 6): the decision spike's planar Boolean, adopted
// as wonky-ops::planar on top of wonky-num, still reproduces the Bend kernel on
// all 9 frozen planar-Boolean calls (fixtures/rust/planar-spike: accept/refuse,
// stats, topology, origins, domains, volume, bbox, every vertex within 1e-9 mm)
// with zero undecided comparisons; and the comparison catches the spike's
// planted negatives (a flipped membership predicate in the code, a moved vertex
// in the output).
//
// `before` builds both variants through scripts/rust/build.mjs (a cache hit
// takes well under a second; a miss is one cargo release build each).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { compare, plainBend, runCompare } from '../scripts/rust/planar-spike/compare.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const frozen = join(root, 'fixtures/rust/planar-spike');

before(() => {
  for (const variant of ['release', 'plant']) {
    const run = spawnSync(process.execPath, ['scripts/rust/build.mjs', '--variant', variant], { cwd: root, encoding: 'utf8' });
    assert.equal(run.status, 0, `Rust build ${variant} failed:\n${run.stderr}`);
  }
});

test('all 9 frozen planar-Boolean calls agree with Bend, 0 undecided', () => {
  const result = runCompare();
  assert.equal(result.total, 9);
  assert.deepEqual(result.details.filter(d => d.diffs.length), []);
  assert.equal(result.details.reduce((n, d) => n + d.rustUndecided, 0), 0);
  // the one refusal (r20-kt6 call 1) is the same named refusal on both sides
  assert.equal(result.details.find(d => d.call === 'r20-kt6.1').bend, 'UnsupportedArrangement/6');
});

test('the same holds with 6 threads and for the propagation variant', () => {
  for (const extra of [['--threads', '6'], ['--propagate']]) assert.equal(runCompare({ extra }).differ, 0, extra.join(' '));
});

test('planted: a well-formed but altered request and Bend result both fail fixture integrity', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wonky-rust-fixture-'));
  const calls = join(dir, 'calls');
  mkdirSync(calls);
  const call = JSON.parse(readFileSync(join(frozen, 'index.json'), 'utf8')).calls[0];
  const base = `${call.workload}.${call.call}`;
  const req = `${base}.req.bin`, result = `${base}.bend.json.gz`;
  writeFileSync(join(dir, 'index.json'), JSON.stringify({ calls: [call] }));
  copyFileSync(join(frozen, 'calls', req), join(calls, req));
  copyFileSync(join(frozen, 'calls', result), join(calls, result));
  try {
    const requestFile = join(calls, req);
    const original = readFileSync(requestFile);
    const changed = Buffer.from(original);
    changed[changed.length - 1] ^= 1;
    writeFileSync(requestFile, changed);
    assert.throws(() => runCompare({ fixtureDir: dir }), error => error.message.includes(req) && error.message.includes('requestSha256'));
    writeFileSync(requestFile, original);
    const resultFile = join(calls, result);
    writeFileSync(resultFile, gzipSync(Buffer.concat([gunzipSync(readFileSync(resultFile)), Buffer.from(' ')])));
    assert.throws(() => runCompare({ fixtureDir: dir }), error => error.message.includes(result) && error.message.includes('bendResultSha256'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('planted: a flipped membership predicate in the Rust code is flagged on every call', () => {
  assert.equal(runCompare({ variant: 'plant' }).differ, 0, 'the plant build without PLANT behaves like release');
  assert.equal(runCompare({ variant: 'plant', plantEnv: 'flip' }).differ, 9);
});

test('planted: a vertex moved by 1e-8 mm or a flipped face sense in the output is flagged on every body', () => {
  // 8 of the 9 calls return bodies; r20-kt6 call 1 is a refusal on both sides
  for (const postPlant of ['vertex', 'flip']) assert.equal(runCompare({ postPlant }).differ, 8, postPlant);
});


test('plainBend rejects a null or nonnumeric Real word before comparison', () => {
  const captured = JSON.parse(gunzipSync(readFileSync(join(frozen, 'calls/fs-fuse-g1.0.bend.json.gz'))));
  for (const bad of [null, '0', NaN]) {
    const mutated = structuredClone(captured);
    mutated.bodies.head.solid.vertices.head.x.hi = bad;
    assert.throws(() => plainBend(mutated), /Real/);
  }
});

test('every planar carrier field and valid domain is compared (F5 corruption plants)', () => {
  const original = plainBend(JSON.parse(gunzipSync(readFileSync(join(frozen, 'calls/fs-fuse-g1.0.bend.json.gz')))));
  const plants = {
    edgeOrigin: b => { b.solid.edges[0].origin = [1e9,1e9,1e9]; },
    zeroDirection: b => { b.solid.edges[0].direction = [0,0,0]; },
    zeroPlaneX: b => { b.solid.faces[0].surface.x = [0,0,0]; },
    missingDomains: b => { b.domains = []; },
    wrongDomainVariant: b => { b.domains[0] = 'auto'; },
    reversedDomain: b => { b.domains[0] = [1,0]; },
    nullSurface: b => { b.solid.faces[0].surface = null; },
    roundEdge: b => { b.solid.edges[0] = { start:0, end:1, sense:true, round:true }; },
    nullVertex: b => { b.solid.vertices[0][0] = null; },
    nanVertex: b => { b.solid.vertices[0][0] = NaN; },
    missingOrigin: b => { delete b.edge_origins; },
    extraField: b => { b.solid.faces[0].ignored = 1; },
  };
  assert.deepEqual(compare(original, structuredClone(original)).diffs, []);
  for (const [name, plant] of Object.entries(plants)) {
    const changed = structuredClone(original); plant(changed.bodies[0]);
    assert.ok(compare(original, changed).diffs.length, `${name} escaped comparison`);
  }
});

test('a direct Node heap flag cold-compiles a scratch Bend module (P8)', { timeout: 30000, skip: missingBend() }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'wonky-bend-cold-'));
  const module = join(dir, 'small.bend'), cache = join(dir, 'empty-cache');
  writeFileSync(module, 'import Base\n\ndef small() -> U32:\n  {1 : U32}\n');
  try {
    assert.equal(readFileSync(module, 'utf8').includes('small'), true);
    const code = `import { loadBend } from ${JSON.stringify(join(root, 'src/bend-loader.mjs'))};
      const m = await loadBend(${JSON.stringify(module)}, { cacheDirectory: ${JSON.stringify(cache)} });
      console.log('COLD_BEND=' + m.small());`;
    const run = spawnSync(process.execPath, ['--max-old-space-size=8192', '--input-type=module', '-e', code], {
      cwd: root, encoding: 'utf8', timeout: 25000, env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=8192' },
    });
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /COLD_BEND=1/);
    assert.ok(existsSync(cache), 'the initially empty scratch cache must be populated');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('capture launches a Bend worker without invalid direct Node exec flags', { skip: missingBend() }, () => {
  const capture = spawnSync(process.execPath, ['scripts/rust/planar-spike/capture.mjs', 'fs-fuse-g1'], { cwd: root,
    env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=8192' }, encoding: 'utf8' });
  assert.equal(capture.status, 0, capture.stderr);
  assert.match(capture.stdout, /"id":"fs-fuse-g1"/);
});
