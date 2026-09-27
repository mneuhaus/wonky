import test from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missing("local design note", "fixtures/r20/references/r20-datums-probe-volumes.json", "fixtures/r20-modules/manifest.json");
if (publicTreeSkip) {
  test("r20-references.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { createHash } = await import("node:crypto");
const { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = await import("node:fs");
const { tmpdir } = await import("node:os");
const { dirname, join } = await import("node:path");
const { BREP_VOLUMES_SCHEMA, parseBrepVolumes, studioReferences } = await import("../scripts/r20/references.mjs");
const { discoverCases, compare, statementCheck, withReferenceProblems } = await import("../scripts/r20/acceptance.mjs");
const { float32HalfSpacing, float32StorageBoundMm } = await import("../scripts/r20/mesh.mjs");
// The Onshape B-rep references of the R20 datums and probe studios
// (scripts/r20/references.mjs, schema r20/brep-volumes/v1) and how the
// acceptance runner uses them (scripts/r20/acceptance.mjs): the volume is
// checked against the B-rep value, bbox and Hausdorff stay against var/mesh,
// and a hash mismatch fails by name. Also the statement check without a fixed
// float32 allowance on our side (float32StorageBoundMm, scripts/r20/mesh.mjs).










const sha256 = data => createHash('sha256').update(data).digest('hex');

// A binary STL (the layout tools/tessellate.py writes; normals zero).
const binaryStl = triangles => {
  const buffer = Buffer.alloc(84 + 50 * triangles.length);
  buffer.writeUInt32LE(triangles.length, 80);
  triangles.forEach((t, i) => t.flat().forEach((v, k) => buffer.writeFloatLE(v, 84 + 50 * i + 12 + 4 * k)));
  return buffer;
};
// An outward-wound box [0, s] x [0, s] x [0, s].
const cube = (s = 1) => {
  const v = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]].map(p => p.map(c => c * s));
  return [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7]]
    .map(t => t.map(i => v[i]));
};

const KEYS = { datums: ['D01', 'D02', 'D03', 'D04'], probe: ['P01', 'X06'] };
const NAMES = { D01: 'D01 Achse C', D02: 'D02 Achse P', D03: 'D03 Bahn C um P', D04: 'D04 Schiene', P01: 'P01 Probe Flansch', X06: 'X06 Kontext T06' };

// A scratch R20 project with the files the references are checked against.
// Every mesh is a 2 mm cube (8 mm³); the B-rep volumes say [8, 7.9, 8.1].
function scratchR20() {
  const root = mkdtempSync(join(tmpdir(), 'wonky-r20-refs-'));
  const put = (rel, data) => { const file = join(root, rel); mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, data); return data; };
  const stl = binaryStl(cube(2)), meshSha = sha256(stl);
  const studioSha = {};
  for (const studio of Object.keys(KEYS)) studioSha[studio] = sha256(put(`build/studios/${studio}.fs`, `// ${studio} studio\n`));
  const keys = Object.values(KEYS).flat();
  for (const key of keys) put(`var/mesh/${key}.stl`, stl);
  put('var/state/tessellate-manifest.json', JSON.stringify({ schema: 'r20/tessellate-manifest/v1', part_studio: 'x', fingerprint: 'y',
    parts: Object.fromEntries(keys.map(key => [key, { name: NAMES[key], part_id: `J${key}`, triangles: 12, sha256: meshSha }])) }));
  const doc = { schema: BREP_VOLUMES_SCHEMA, part_studio: 'x', studio_sha256: studioSha, note: 'scratch',
    parts: Object.fromEntries(keys.map(key => [key, { name: NAMES[key], part_id: `J${key}`, volume_mm3_value_min_max: [8, 7.9, 8.1], mesh_sha256: meshSha }])) };
  const writeDoc = d => put('kernel-cases/r20-datums-probe-volumes.json', JSON.stringify(d, null, 1));
  writeDoc(doc);
  return { root, doc, put, writeDoc, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test('parseBrepVolumes maps volume_mm3_value_min_max = [value, min, max] to an onshape-brep volume', () => {
  const hex = 'a'.repeat(64);
  const parsed = parseBrepVolumes({ schema: 'r20/brep-volumes/v1', part_studio: 'ps', studio_sha256: { datums: hex },
    parts: { D01: { name: 'D01 Achse C', part_id: 'JHD', volume_mm3_value_min_max: [782.8848892745779, 782.7999454247021, 782.9698331244537], mesh_sha256: hex } } });
  assert.equal(parsed.schema, 'r20/brep-volumes/v1');
  assert.equal(parsed.partStudio, 'ps');
  assert.deepEqual(parsed.studioSha256, { datums: hex });
  assert.deepEqual(parsed.parts.D01, { key: 'D01', name: 'D01 Achse C', partId: 'JHD', meshSha256: hex,
    volume: { value: 782.8848892745779, min: 782.7999454247021, max: 782.9698331244537, basis: 'onshape-brep' } });
});

test('a malformed B-rep volume document is refused, naming what is wrong', () => {
  const hex = 'b'.repeat(64);
  const good = () => ({ schema: 'r20/brep-volumes/v1', studio_sha256: { probe: hex },
    parts: { P01: { name: 'P01 Probe Flansch', volume_mm3_value_min_max: [5170.3, 5170.0, 5170.6], mesh_sha256: hex } } });
  const refused = (mutate, pattern) => { const d = good(); mutate(d); assert.throws(() => parseBrepVolumes(d, 'v.json'), e => pattern.test(e.message), pattern.source); };
  assert.doesNotThrow(() => parseBrepVolumes(good()));
  refused(d => { d.schema = 'r20/brep-volumes/v2'; }, /^v\.json: schema is "r20\/brep-volumes\/v2", expected r20\/brep-volumes\/v1/);
  refused(d => { delete d.studio_sha256; }, /needs a 'studio_sha256' object/);
  refused(d => { d.studio_sha256.probe = 'nope'; }, /studio_sha256\.probe is not a sha256 hex digest/);
  refused(d => { delete d.parts; }, /needs a 'parts' object/);
  refused(d => { d.parts.P01.volume_mm3_value_min_max = [5170.3, 5170.0]; }, /part P01: volume_mm3_value_min_max must be \[value, min, max\]/);
  refused(d => { d.parts.P01.volume_mm3_value_min_max = [5170.3, 5170.4, 5170.6]; }, /part P01: volume interval \[5170\.4, 5170\.6\] does not contain its value 5170\.3/);
  refused(d => { d.parts.P01.volume_mm3_value_min_max = [0, 0, 0]; }, /part P01: volume 0 mm³ is not positive/);
  refused(d => { d.parts.P01.mesh_sha256 = 'x'; }, /part P01: mesh_sha256 is not a sha256 hex digest/);
  refused(d => { delete d.parts.P01.name; }, /part P01: row lacks 'name'/);
});

test('studio references check the studio source and every mesh hash, and name each mismatch', () => {
  const r = scratchR20();
  try {
    const ok = studioReferences(r.root, 'datums', KEYS.datums);
    assert.deepEqual(ok.problems, []);
    assert.deepEqual(ok.refs.map(x => x.problems), [[], [], [], []]);
    assert.deepEqual(ok.refs.map(x => x.key), KEYS.datums);
    assert.deepEqual(ok.refs[0].volume, { value: 8, min: 7.9, max: 8.1, basis: 'onshape-brep' });
    assert.equal(ok.refs[0].stl, join(r.root, 'var/mesh/D01.stl'));
    assert.equal(ok.refs[0].name, 'D01 Achse C');

    // The studio was changed after the volumes were measured: every part of it.
    r.put('build/studios/datums.fs', '// datums studio, edited\n');
    const studio = studioReferences(r.root, 'datums', KEYS.datums);
    assert.equal(studio.problems.length, 1);
    assert.match(studio.problems[0], /^studio datums: build\/studios\/datums\.fs sha256 [0-9a-f]{12} differs from the B-rep references' [0-9a-f]{12}/);
    assert.deepEqual(studioReferences(r.root, 'probe', KEYS.probe).problems, [], 'the probe studio is untouched');

    // One mesh re-tessellated: that part, against both records.
    r.put('var/mesh/X06.stl', binaryStl(cube(3)));
    const probe = studioReferences(r.root, 'probe', KEYS.probe);
    assert.deepEqual(probe.refs[0].problems, []);
    assert.equal(probe.refs[1].problems.length, 2);
    assert.match(probe.refs[1].problems[0], /^X06: var\/mesh\/X06\.stl sha256 [0-9a-f]{12} differs from the B-rep references' mesh_sha256/);
    assert.match(probe.refs[1].problems[1], /^X06: var\/mesh\/X06\.stl sha256 [0-9a-f]{12} differs from var\/state\/tessellate-manifest\.json/);

    // A part without a B-rep entry has no volume, and says so.
    const doc = structuredClone(r.doc);
    delete doc.parts.D03;
    r.writeDoc(doc);
    const missing = studioReferences(r.root, 'datums', KEYS.datums).refs.find(x => x.key === 'D03');
    assert.equal(missing.volume, null);
    assert.deepEqual(missing.problems, ['D03: no B-rep volume in r20-datums-probe-volumes.json']);

    // A wrong schema or no file at all: a studio problem, never a fallback.
    r.writeDoc({ ...r.doc, schema: 'r20/brep-volumes/v0' });
    assert.match(studioReferences(r.root, 'datums', KEYS.datums).problems[0], /B-rep reference volumes unreadable: .*schema is "r20\/brep-volumes\/v0"/);
    rmSync(join(r.root, 'kernel-cases/r20-datums-probe-volumes.json'));
    const none = studioReferences(r.root, 'probe', KEYS.probe);
    assert.match(none.problems[0], /^B-rep reference volumes missing: /);
    assert.deepEqual(none.refs.map(x => x.volume), [null, null]);
  } finally { r.cleanup(); }
});

test('the acceptance datums and probe rows take the B-rep volume and fail a hash mismatch by name', () => {
  const r = scratchR20();
  try {
    const cases = discoverCases(r.root), datums = cases.find(c => c.id === 'datums'), probe = cases.find(c => c.id === 'probe');
    assert.deepEqual(datums.refs.map(x => x.key), KEYS.datums);
    assert.deepEqual(probe.refs.map(x => x.key), KEYS.probe);
    const opts = { deviation: 0.01, samples: 200 };
    // Our part: the same 2 mm cube with an exact volume of 8 mm³.
    const ours = { name: 'D01 Achse C', triangles: cube(2), volumeMm3: 8, exact: true, approximation: null, achievedDeviationMm: 0,
      meshDeviationMm: 0, float32RoundingMm: 0 };
    const row = compare(ours, datums.refs[0], opts);
    assert.equal(row.ok, true, JSON.stringify(row.checks));
    assert.equal(row.checks.volume.refBasis, 'onshape-brep');
    assert.equal(row.checks.volume.refMm3, 8);
    assert.deepEqual(row.checks.volume.interval, [7.9, 8.1]);
    assert.ok(row.checks.hausdorff.mm < 1e-12);
    assert.equal(row.checks.bbox.maxDeltaMm, 0);
    // The volume is the B-rep one: 8.2 mm³ misses it although the mesh matches.
    assert.equal(compare({ ...ours, volumeMm3: 8.2 }, datums.refs[0], opts).checks.volume.ok, false);

    // A mesh that is not the measured one fails the part's reference check by name.
    r.put('var/mesh/D02.stl', binaryStl(cube(2).reverse()));
    const tampered = discoverCases(r.root).find(c => c.id === 'datums');
    const bad = compare({ ...ours, name: 'D02 Achse P' }, tampered.refs[1], opts);
    assert.equal(bad.ok, false);
    assert.equal(bad.checks.reference.ok, false);
    assert.match(bad.checks.reference.problems.join('\n'), /^D02: var\/mesh\/D02\.stl sha256 [0-9a-f]{12} differs from the B-rep references' mesh_sha256/m);
    assert.equal(compare(ours, tampered.refs[0], opts).ok, true, 'D01 keeps its reference');
    // The row fails by name whatever the build did: a PASS becomes FAIL, a FAIL
    // keeps its own reason and gains the mismatch.
    const passed = withReferenceProblems({ id: 'datums', status: 'PASS', reason: 'built; every part within tolerance and its statement' }, tampered);
    assert.equal(passed.status, 'FAIL');
    assert.match(passed.reason, /^reference mismatch: D02: var\/mesh\/D02\.stl sha256/);
    assert.equal(passed.referenceProblems.length, 2);
    const blocked = withReferenceProblems({ id: 'datums', status: 'FAIL', reason: 'blocked before the expected end' }, tampered);
    assert.match(blocked.reason, /^blocked before the expected end; reference mismatch: D02: /);
    const clean = discoverCases(r.root).find(c => c.id === 'probe');
    assert.deepEqual(withReferenceProblems({ id: 'probe', status: 'PASS', reason: 'ok' }, clean), { id: 'probe', status: 'PASS', reason: 'ok' });
  } finally { r.cleanup(); }
});

// The real B-rep references cad-31 supplied, frozen with provenance in fixtures/r20/references
// (tests never read the live CAD project; scripts/r20/acceptance.mjs checks the live studio and mesh hashes).
test('the R20 B-rep references: D01-D04, P01, X06 as onshape-brep volumes', () => {
  const file = new URL('../fixtures/r20/references/r20-datums-probe-volumes.json', import.meta.url);
  const bytes = readFileSync(file);
  assert.equal(sha256(bytes), '686d85c9a3b687fe9d8b4ff8d98423a26be9a2b503bb86dd3336181b5ee11dfa', 'the frozen copy matches its provenance');
  const { parts } = parseBrepVolumes(JSON.parse(bytes));
  const expected = { D01: 782.884889275, D02: 782.884889275, D03: 845.316129409, D04: 408.407044967, P01: 5170.305940728, X06: 51873.616020542 };
  for (const [key, v] of Object.entries(expected)) {
    const volume = parts[key].volume;
    assert.ok(Math.abs(volume.value - v) < 1e-9 * v, `${key}: ${volume.value} vs ${v}`);
    assert.ok(volume.min < volume.value && volume.value < volume.max);
    assert.equal(volume.basis, 'onshape-brep');
  }
  // wonky's exact datum volumes (local design note 6.1) are well within 1e-6 relative.
  assert.ok(Math.abs(782.8848892745737 - parts.D01.volume.value) / parts.D01.volume.value < 1e-12);
  assert.ok(Math.abs(845.3161294089514 - parts.D03.volume.value) / parts.D03.volume.value < 1e-12);
  assert.ok(Math.abs(408.4070449666742 - parts.D04.volume.value) / parts.D04.volume.value < 1e-12);
});

test('float32 storage bound: half the float32 spacing at each stored coordinate', () => {
  assert.equal(float32HalfSpacing(1), 2 ** -24);
  assert.equal(float32HalfSpacing(1.5), 2 ** -24);
  assert.equal(float32HalfSpacing(2), 2 ** -23, 'at a power of two the spacing above counts');
  assert.equal(float32HalfSpacing(-1000.25), 2 ** -15);
  assert.equal(float32HalfSpacing(2000.5), 2 ** -14);
  assert.equal(float32HalfSpacing(0), 2 ** -150);
  // A stored value really is within the bound of what it stores, and the bound is tight.
  for (const r of [523.123456789, -811.987654321, 1000.2500001, 1e-3, 30.000000012]) {
    const x = Math.fround(r);
    assert.ok(Math.abs(x - r) <= float32HalfSpacing(x), `${r}`);
  }
  const x = 1000 + 2 ** -14 * 0.5;
  assert.equal(Math.abs(Math.fround(x) - x), float32HalfSpacing(Math.fround(x)), 'a tie sits exactly at the bound');
  const far = [[[1000.25, -2000.5, 0.125], [1000.5, -2000.5, 0.125], [1000.25, -2000, 0.125]]];
  assert.equal(float32StorageBoundMm(far), Math.hypot(2 ** -15, 2 ** -14, 2 ** -27) * (1 + 2 ** -20));
  assert.equal(float32StorageBoundMm(cube(2)) < 3e-7, true);
});

test('the statement check has no fixed float32 allowance on our side', () => {
  const chordMm = 0.009, refFloat32Mm = 3e-6, tolMm = 0.01 + chordMm + 1e-4;
  // Two-number row: the stated total already holds the storage term.
  const stated = { achievedDeviationMm: 0.0098001854, meshDeviationMm: 0.0097365859, float32RoundingMm: 6.35995e-5, triangles: cube(2) };
  const allowed = 0.0098001854 + chordMm + refFloat32Mm;
  const at = h => statementCheck(stated, { hausdorffMm: h, chordMm, refFloat32Mm, tolMm });
  assert.equal(at(allowed).ok, true);
  assert.equal(at(allowed).allowedMm, allowed);
  assert.equal(at(allowed).float32RoundingBasis, 'stated (included in achievedDeviationMm)');
  // 5e-5 over the statement fails; the old fixed 1e-4 mm would have let it pass.
  assert.equal(at(allowed + 5e-5).ok, false);
  assert.ok(allowed + 5e-5 <= 0.0098001854 + chordMm + 1e-4);
  // A legacy row states the mesh only: the float32 bound of our stored file is added.
  const far = cube(2).map(t => t.map(p => [p[0] + 1000.25, p[1] - 2000.5, p[2]]));
  const legacy = statementCheck({ achievedDeviationMm: 0.0097365859, triangles: far }, { hausdorffMm: 0.0187, chordMm, refFloat32Mm, tolMm });
  assert.equal(legacy.float32RoundingMm, float32StorageBoundMm(far));
  assert.equal(legacy.allowedMm, 0.0097365859 + float32StorageBoundMm(far) + chordMm + refFloat32Mm);
  assert.match(legacy.float32RoundingBasis, /legacy row/);
  // No statement at all (print mode): the tolerance, as the Hausdorff check.
  const none = statementCheck({ achievedDeviationMm: null, triangles: far }, { hausdorffMm: tolMm, chordMm, refFloat32Mm, tolMm });
  assert.equal(none.ok, true);
  assert.equal(none.allowedMm, tolMm);
});

}
