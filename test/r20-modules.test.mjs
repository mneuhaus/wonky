import test from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missing("fixtures/r20-modules/baseline-bend-js.json", "fixtures/r20-modules/manifest.json");
if (publicTreeSkip) {
  test("r20-modules.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { default: fs } = await import("node:fs");
const { default: os } = await import("node:os");
const { default: path } = await import("node:path");
const { default: crypto } = await import("node:crypto");
const { spawnSync } = await import("node:child_process");
const { fileURLToPath } = await import("node:url");
const { FIXTURE_DIR, verifyFixture, pythonCanonicalJson, parsePythonJson, regressions } = await import("../scripts/r20/modules.mjs");
// The R20 module gate (package G0, scripts/r20/modules.mjs) on its frozen
// fixture: the fixture verifies as frozen, and each planted defect is caught
// where the gate claims to catch it. The full 8-module Bend JS run (about
// 7 minutes) is evidence, recorded in fixtures/r20-modules/baseline-bend-js.json,
// and not repeated here; the builds below are the datums module (about 1 s).










const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RUNNER = path.join(ROOT, 'scripts/r20/modules.mjs');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'wonky-r20-modules-'));
test.after(() => fs.rmSync(work, { recursive: true, force: true }));

const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
let copies = 0;
const copyFixture = () => { const dir = path.join(work, `fixture-${copies++}`); fs.cpSync(FIXTURE_DIR, dir, { recursive: true }); return dir; };
// Makes provenance.json (and, when asked, SHA256SUMS) agree with edited files:
// a forgery that is consistent, so only the checks behind provenance can catch it.
function reseal(dir, rels, { sums = false } = {}) {
  const provenance = readJson(path.join(dir, 'provenance.json'));
  if (sums) {
    const file = path.join(dir, 'studios/SHA256SUMS');
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').split('\n').map(line => {
      const name = line.slice(66), rel = `studios/${name}`;
      return rels.includes(rel) ? `${sha256(fs.readFileSync(path.join(dir, rel)))}  ${name}` : line;
    }).join('\n'));
    rels = [...rels, 'studios/SHA256SUMS'];
  }
  for (const f of provenance.files) if (rels.includes(f.path)) { const bytes = fs.readFileSync(path.join(dir, f.path)); f.sha256 = sha256(bytes); f.bytes = bytes.length; }
  fs.writeFileSync(path.join(dir, 'provenance.json'), JSON.stringify(provenance, null, 1) + '\n');
}
function runGate(args) {
  const run = spawnSync(process.execPath, [RUNNER, ...args], { cwd: ROOT, encoding: 'utf8', timeout: 120000,
    env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=8192', WONKY_BACKEND: 'js' } });
  const out = args[args.indexOf('--out') + 1];
  return { ...run, report: fs.existsSync(path.join(out, 'report.json')) ? readJson(path.join(out, 'report.json')) : null };
}
const problemsOf = (v, m) => v.modules[m].problems.join('\n');

test('the frozen fixture verifies: 8 modules, 33 parts, every file as frozen, every reference bound to the frozen sources', () => {
  const v = verifyFixture();
  assert.deepEqual(v.problems, []);
  for (const [m, entry] of Object.entries(v.modules)) assert.deepEqual(entry.problems, [], m);
  assert.ok(v.ok);
  assert.equal(v.provenance.onshape.reference.microversion, 'onshape-id-8d240508');
  assert.equal(v.provenance.onshape.patch.name, 'topplate-mouth-corner-fix');
  assert.deepEqual(v.provenance.onshape.patch.modules_changed, ['context']);
  assert.equal(v.provenance.onshape.reference.configuration, 'withBlends=false (default)');
  assert.deepEqual(Object.fromEntries(Object.entries(v.refs).map(([m, r]) => [m, r.length])),
    { datums: 4, context: 12, probe: 2, tray: 3, edge: 1, return: 4, cores: 5, feed: 2 });
  assert.equal(v.provenance.files.length, 79);
  for (const f of v.provenance.files) assert.ok(path.isAbsolute(f.origin) && /^[0-9a-f]{64}$/.test(f.sha256), f.path);
});

test('canonical JSON keeps Python float lexemes (the tessellation fingerprint depends on them)', () => {
  assert.equal(pythonCanonicalJson(parsePythonJson('{"b":[3.0,0.5,3],"a":{"z":true,"y":null,"x":"ä"}}')), '{"a":{"x":"ä","y":null,"z":true},"b":[3.0,0.5,3]}');
  assert.throws(() => pythonCanonicalJson(parsePythonJson('[1e-7]')), /outside the range/);
});

test('planted: one flipped byte in a studio is rejected at provenance, before anything is built', () => {
  const dir = copyFixture(), file = path.join(dir, 'studios/datums.fs'), bytes = fs.readFileSync(file);
  bytes[1000] ^= 0x01;
  fs.writeFileSync(file, bytes);
  const v = verifyFixture(dir);
  assert.match(problemsOf(v, 'datums'), /studios\/datums\.fs: sha256 [0-9a-f]{12} \(40594 bytes\) differs from provenance 5f879596b05e/);
  assert.match(problemsOf(v, 'datums'), /studios\/datums\.fs: differs from the snapshot's SHA256SUMS/);
  for (const m of Object.keys(v.modules).filter(x => x !== 'datums')) assert.deepEqual(v.modules[m].problems, [], m);
  const out = path.join(work, 'out-byte');
  const run = runGate(['--only', 'datums', '--fixtures', dir, '--out', out]);
  assert.equal(run.status, 1, run.stderr);
  assert.equal(run.report.modules[0].status, 'PROVENANCE');
  assert.equal(run.report.modules[0].exitCode, undefined);
  assert.ok(!fs.existsSync(path.join(out, 'datums', 'cli.log')), 'nothing was built');
});

test('planted: a studio edited after the Onshape build is stale for its module only, even when resealed', () => {
  const dir = copyFixture();
  fs.appendFileSync(path.join(dir, 'studios/datums.fs'), '\n');
  reseal(dir, ['studios/datums.fs'], { sums: true });
  const v = verifyFixture(dir);
  assert.match(problemsOf(v, 'datums'), /studios\/datums\.fs sha256 [0-9a-f]{12} is not the source Onshape built .*: the references are stale for this module/);
  for (const m of Object.keys(v.modules).filter(x => x !== 'datums')) assert.deepEqual(v.modules[m].problems, [], m);
  assert.deepEqual(v.problems, []);
});

test('planted: meshes fetched for another Onshape state are refused for every module; an unlisted file is named', () => {
  const dir = copyFixture(), state = path.join(dir, 'onshape-state.json');
  fs.writeFileSync(state, fs.readFileSync(state, 'utf8').replace('"catchPitch": 4.0', '"catchPitch": 4.5'));
  reseal(dir, ['onshape-state.json']);
  fs.writeFileSync(path.join(dir, 'mesh', 'EXTRA.stl'), 'solid x\nendsolid x\n');
  const v = verifyFixture(dir);
  for (const m of Object.keys(v.modules)) assert.match(problemsOf(v, m), /fingerprint [0-9a-f]{12} is not the hash [0-9a-f]{12} of onshape-state\.json/, m);
  assert.deepEqual(v.problems, ['mesh/EXTRA.stl: not listed in provenance.json']);
});

test('planted: a reference scaled by 1.001 passes provenance when resealed and fails Hausdorff for exactly that part', () => {
  const dir = copyFixture(), stl = path.join(dir, 'mesh/D02.stl'), buf = fs.readFileSync(stl);
  for (let i = 0, n = buf.readUInt32LE(80); i < n; i++)
    for (let k = 0; k < 9; k++) { const o = 84 + 50 * i + 12 + 4 * k; buf.writeFloatLE(buf.readFloatLE(o) * 1.001, o); }
  fs.writeFileSync(stl, buf);
  const manifest = readJson(path.join(dir, 'mesh/tessellate-manifest.json'));
  manifest.parts.D02.sha256 = sha256(buf);
  fs.writeFileSync(path.join(dir, 'mesh/tessellate-manifest.json'), JSON.stringify(manifest, null, 2));
  reseal(dir, ['mesh/D02.stl', 'mesh/tessellate-manifest.json']);
  assert.ok(verifyFixture(dir).ok, 'a consistent forgery is not a provenance problem');

  const run = runGate(['--only', 'datums', '--fixtures', dir, '--out', path.join(work, 'out-scaled')]);
  assert.equal(run.status, 1, run.stderr);
  const row = run.report.modules[0];
  assert.equal(row.status, 'FAIL');
  assert.equal(row.guard.bendLoaded, true, 'the guard sees the Bend JS kernel on WONKY_BACKEND=js');
  const byKey = Object.fromEntries(row.parts.map(p => [p.key, p]));
  assert.equal(byKey.D02.checks.hausdorff.ok, false);
  assert.ok(byKey.D02.checks.hausdorff.mm > 0.2 && byKey.D02.checks.hausdorff.mm > byKey.D02.toleranceMm, String(byKey.D02.checks.hausdorff.mm));
  assert.equal(byKey.D02.checks.volume.ok, true, 'the volume reference is the Onshape B-rep volume, not the STL');
  for (const key of ['D01', 'D03', 'D04']) assert.equal(byKey[key].ok, true, `${key}: ${JSON.stringify(byKey[key].checks)}`);

  const baseline = readJson(path.join(FIXTURE_DIR, 'baseline-bend-js.json'));
  const found = regressions(baseline, run.report.modules);
  assert.ok(found.includes('datums: PASS -> FAIL') && found.includes('datums/D02: hausdorff ok -> failed'), found.join('; '));
  assert.ok(!found.some(r => /D0[134]/.test(r)), found.join('; '));
});

test('planted: a reference measured with other live parameters fails the stamp check of its part', () => {
  const dir = copyFixture(), file = path.join(dir, 'studios/r20-modules-volumes.json'), volumes = readJson(file);
  volumes.parts.D03.description = volumes.parts.D03.description.replace(' live=- |', ' live=withBlends:true |');
  fs.writeFileSync(file, JSON.stringify(volumes, null, 1));
  reseal(dir, ['studios/r20-modules-volumes.json'], { sums: true });
  assert.ok(verifyFixture(dir).ok, 'the stamp still names the module; only the build can tell');
  const run = runGate(['--only', 'datums', '--fixtures', dir, '--out', path.join(work, 'out-stamp')]);
  assert.equal(run.status, 1, run.stderr);
  const failed = run.report.modules[0].parts.flatMap(p => Object.entries(p.checks).filter(([, c]) => !c.ok).map(([k]) => `${p.key} ${k}`));
  assert.deepEqual(failed, ['D03 stamp']);
});

test('planted: --require-no-bend fails a module whose process loaded Bend', () => {
  const run = runGate(['--only', 'datums', '--require-no-bend', '--out', path.join(work, 'out-guard')]);
  assert.equal(run.status, 1, run.stderr);
  const row = run.report.modules[0];
  assert.equal(row.status, 'FAIL');
  assert.equal(row.guard.ok, false);
  assert.ok(row.guard.markers['data-url'] > 0, JSON.stringify(row.guard));
  assert.match(row.reason, /Bend was loaded/);
  assert.ok(row.parts.every(p => p.ok), 'the geometry itself passed; only the guard fails it');
});

test('the recorded Bend JS baseline: 7 of 8 modules, 31 of 33 parts pass every check, feed refused by name at 344:5', () => {
  const b = readJson(path.join(FIXTURE_DIR, 'baseline-bend-js.json'));
  assert.equal(b.backend, 'js');
  assert.deepEqual(b.summary.modules, { total: 8, built: 7, pass: 7, fail: 0, refused: 1, provenance: 0 });
  assert.equal(b.summary.parts.total, 33);
  assert.equal(b.summary.parts.allChecks, 31);
  assert.equal(b.modules.feed.status, 'REFUSED');
  assert.deepEqual([b.modules.feed.error.class, b.modules.feed.error.line, b.modules.feed.error.column], ['UnsupportedFeatureError', 344, 5]);
  // Bend is retired (no re-runs, ever): this baseline is frozen history, measured
  // against the pre-G4 fixture (microversion onshape-id-2cd631ae), not the
  // current one (microversion onshape-id-8d240508). The hash below is that
  // old provenance.json's sha256, kept as a historical binding, not a live check.
  assert.equal(b.fixture.provenanceSha256, 'bc0c7e92893a3b9ad85230d67afd6b790f19a84524a6f7a56de0485f4c2f34fa',
    'the baseline is bound to the pre-G4 fixture it was actually measured on (Bend is retired; never re-run)');
});

}
