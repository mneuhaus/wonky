import test from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missing("fixtures/r20-modules/manifest.json");
if (publicTreeSkip) {
  test("r20-blends.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { default: fs } = await import("node:fs");
const { default: os } = await import("node:os");
const { default: path } = await import("node:path");
const { default: crypto } = await import("node:crypto");
const { spawnSync } = await import("node:child_process");
const { fileURLToPath } = await import("node:url");
const { FIXTURE_DIR, verifyFixture, verifyBlendFixture } = await import("../scripts/r20/modules.mjs");
// These locally synthesized rows exercise the verifier only. They are NOT
// Onshape references and cannot establish that any blended geometry was fetched.










const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sha256 = data => crypto.createHash('sha256').update(data).digest('hex');
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'r20-blends-verifier-'));
test.after(() => fs.rmSync(workspace, { recursive: true, force: true }));

function stlBounds(bytes) {
  const low = [Infinity, Infinity, Infinity], high = [-Infinity, -Infinity, -Infinity];
  for (let i = 0, n = bytes.readUInt32LE(80); i < n; i++) for (let v = 0; v < 3; v++)
    for (let axis = 0; axis < 3; axis++) {
      const x = bytes.readFloatLE(84 + 50 * i + 12 + 12 * v + 4 * axis);
      low[axis] = Math.min(low[axis], x);
      high[axis] = Math.max(high[axis], x);
    }
  return [...low, ...high];
}

function syntheticFixture() {
  const dir = fs.mkdtempSync(path.join(workspace, 'fixture-'));
  fs.cpSync(FIXTURE_DIR, dir, { recursive: true });
  const base = verifyFixture(dir), blends = path.join(dir, 'blends');
  fs.mkdirSync(path.join(blends, 'mesh'), { recursive: true });
  const provenance = {
    schema: 'wonky/r20-modules-blends/1',
    baseProvenanceSha256: sha256(fs.readFileSync(path.join(dir, 'provenance.json'))),
    baseStateSha256: sha256(fs.readFileSync(path.join(dir, 'onshape-state.json'))),
    document: base.provenance.onshape.document, workspace: base.provenance.onshape.workspace,
    element: base.provenance.onshape.partStudio.id, microversion: '0123456789abcdef01234567', modules: {},
  };
  for (const [m, entry] of Object.entries(base.provenance.modules)) {
    if (!entry.liveParams.includes('withBlends')) continue;
    const source = base.provenance.onshape.featureStudios[m];
    const parts = {};
    for (const ref of base.refs[m]) {
      const bytes = fs.readFileSync(ref.stl);
      fs.writeFileSync(path.join(blends, 'mesh', `${ref.key}.stl`), bytes);
      const suffix = `/d/${provenance.document}/m/${provenance.microversion}/e/${provenance.element}`;
      const endpoints = Object.fromEntries(['parts', 'tessellatedfaces', 'massproperties', 'boundingboxes']
        .map(k => [k, `/api/${k === 'parts' ? 'parts' : 'partstudios'}${suffix}${k === 'parts' ? '' : `/${k}`}?configuration=withBlends%3Dtrue`]));
      parts[ref.key] = {
        name: ref.name, partId: 'synthetic', description: ref.description.replace('withBlends:false', 'withBlends:true'),
        configuration: 'withBlends=true', fetchedAt: '2026-09-26T00:00:00Z', endpoints,
        volume_mm3_value_min_max: [ref.volume.value, ref.volume.min, ref.volume.max],
        bbox_mm: stlBounds(bytes), sha256: sha256(bytes), bytes: bytes.length, triangles: bytes.readUInt32LE(80),
      };
    }
    provenance.modules[m] = { configuration: 'withBlends=true', sourceSha256: source.uploadedSha,
      sourceMicroversion: source.sourceMicroversion, parts };
  }
  const save = () => fs.writeFileSync(path.join(blends, 'provenance.json'), JSON.stringify(provenance));
  save();
  return { base, blends, provenance, save, dir };
}

test('live blended references verify: 15 configured parts and three unchanged G0 modules', () => {
  const base = verifyFixture();
  assert.equal(base.ok, true);
  const result = verifyBlendFixture(base);
  assert.equal(result.ok, true, JSON.stringify(result.problems) + JSON.stringify(result.modules));
  assert.equal(result.provenance.microversion, 'onshape-id-2cd631ae');
  assert.equal(result.provenance.restoreVersion, 'onshape-id-2dad9be7');
  assert.equal(result.provenance.patch.name, 'm3-shared-points');
  assert.deepEqual(Object.fromEntries(Object.entries(result.refs).map(([m, refs]) => [m, refs.length])),
    { datums: 4, context: 12, probe: 2, tray: 3, edge: 1, return: 4, cores: 5, feed: 2 });
  for (const m of ['tray', 'edge', 'return', 'cores', 'feed'])
    for (const part of result.refs[m]) assert.match(part.description, /withBlends:true/);
});

test('recorded Bend JS blended baseline: 5 passing modules, 3 named refusals, 24 checked parts', () => {
  const baseline = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, 'blends/baseline-bend-js.json')));
  const source = fs.readFileSync(path.join(FIXTURE_DIR, 'blends/provenance.json'));
  assert.equal(baseline.blends, true);
  assert.equal(baseline.fixture.blendsProvenanceSha256, sha256(source));
  assert.equal(baseline.summary.modules.pass, 5);
  assert.equal(baseline.summary.modules.refused, 3);
  assert.equal(baseline.summary.parts.allChecks, 24);
  assert.deepEqual(Object.fromEntries(Object.entries(baseline.modules).map(([m, row]) => [m, row.status])),
    { datums: 'PASS', context: 'PASS', probe: 'PASS', tray: 'REFUSED', edge: 'PASS',
      return: 'REFUSED', cores: 'PASS', feed: 'REFUSED' });
  for (const m of ['tray', 'return', 'feed'])
    assert.equal(baseline.modules[m].error.class, 'UnsupportedFeatureError');
});

test('planted: missing configured reference fails closed before CLI execution', () => {
  const base = verifyFixture();
  const result = verifyBlendFixture(base, path.join(workspace, 'missing-blends'));
  assert.equal(result.ok, false);
  assert.match(result.modules.edge.problems.join(' '), /provenance.json missing/);
  assert.equal(result.refs.datums.length, 4);
});

test('synthetic verifier specimen validates all five module slots without claiming live geometry', () => {
  const x = syntheticFixture();
  assert.equal(verifyFixture(x.dir).ok, true);
  const result = verifyBlendFixture(x.base);
  assert.equal(result.ok, true, JSON.stringify(result.problems) + JSON.stringify(result.modules));
  assert.deepEqual(Object.fromEntries(Object.entries(result.refs).map(([m, refs]) => [m, refs.length])),
    { datums: 4, context: 12, probe: 2, tray: 3, edge: 1, return: 4, cores: 5, feed: 2 });
});

test('planted: flipped STL byte is rejected for its module before CLI executes', () => {
  const x = syntheticFixture(), file = path.join(x.blends, 'mesh/K15.stl');
  const bytes = fs.readFileSync(file); bytes[100] ^= 1; fs.writeFileSync(file, bytes);
  assert.match(verifyBlendFixture(x.base).modules.edge.problems.join(' '), /sha256, size or binary STL/);
  const out = path.join(workspace, 'out-flipped');
  const run = spawnSync(process.execPath, [path.join(root, 'scripts/r20/modules.mjs'), '--blends', '--only', 'edge',
    '--fixtures', x.dir, '--out', out], { cwd: root, encoding: 'utf8', timeout: 30000,
    env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=8192' } });
  assert.equal(run.status, 1, run.stderr);
  const report = JSON.parse(fs.readFileSync(path.join(out, 'report.json')));
  assert.equal(report.modules[0].status, 'PROVENANCE');
  assert.equal(report.modules[0].exitCode, undefined);
  assert.equal(fs.existsSync(path.join(out, 'edge/cli.log')), false);
});

test('planted: a mismatched bounding box cannot be certified by a correctly hashed STL', () => {
  const x = syntheticFixture();
  x.provenance.modules.edge.parts.K15.bbox_mm[0] -= 1;
  x.save();
  assert.match(verifyBlendFixture(x.base).modules.edge.problems.join(' '), /bbox_mm does not match the frozen STL vertices/);
});

test('planted: mismatched query configuration and mislabeled live parameter are rejected', () => {
  const x = syntheticFixture();
  x.provenance.modules.edge.parts.K15.endpoints.parts = x.provenance.modules.edge.parts.K15.endpoints.parts.replace('withBlends%3Dtrue', 'withBlends%3Dfalse');
  x.provenance.modules.edge.parts.K15.description = x.provenance.modules.edge.parts.K15.description.replace('withBlends:true', 'withBlends:false');
  x.save();
  const problems = verifyBlendFixture(x.base).modules.edge.problems.join(' ');
  assert.match(problems, /immutable read-only endpoint/);
  assert.match(problems, /blended live-parameter stamp/);
});

}
