import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { verifyStoredReferences, executionEvidence } from '../scripts/acid/execution.mjs';
import { ROOT, loadCatalog, sourceHashes, verifyFrozenReference, catalogBySha, activeReferenceKeys, sha256 } from '../scripts/acid/common.mjs';
import { assertPackageDelta, assertOwnZonesLive } from './helpers/catalog-delta.mjs';

const { catalog } = loadCatalog();
const sources = sourceHashes(catalog);
const keys = ['AC36', 'AC38'].flatMap(z => ['V0', 'V1', 'V2', 'V3'].map(v => `${z}/${v}`));

test('CE9 changes only its OCCT twin path and history against its exact prior catalog', () => {
  const previousSha256 = '3e4f8229d0f01fc7814a3ae308f6da802a22eee81eac4a7dda656b578c30423b';
  const bytes = fs.readFileSync(path.join(ROOT, 'fixtures/cad-acid/catalog-history', `${previousSha256}.json`));
  assert.equal(sha256(bytes), previousSha256);
  const pkg = assertPackageDelta(catalog, 'AC1-2026-10-03-CE9-twin', { amended: ['AC36'] });
  assert.deepEqual(pkg.base, JSON.parse(bytes));
  // The whole post-change catalog is the prior catalog plus exactly this delta.
  const expected = JSON.parse(bytes);
  expected.zones.find(z => z.id === 'AC36').twin.b3d = 'fixtures/cad-acid/b3d/acid_blend_ce9.py';
  expected.history.push({
    version: 'AC1-2026-10-03-CE9-twin', previousSha256, amendedZones: ['AC36'],
    note: 'Independent OCCT twin moves a cylindrical periodic parameter seam away from the blend junction. Primitive geometry and Boolean/fillet operations are unchanged. No construction, outcome, closed form, topology or tolerance contract changes; all previous freezes retained.',
  });
  assert.deepEqual(pkg.after, expected);
  // An undeclared edit of AC36 fails; later packages touching other zones do not.
  const planted = structuredClone(catalog);
  planted.zones.find(z => z.id === 'AC36').twin.b3d = 'fixtures/cad-acid/b3d/acid_blend.py';
  assert.throws(() => assertOwnZonesLive(planted, pkg), /AC36 undeclared later change/);
  const later = structuredClone(catalog);
  later.zones.find(z => z.id === 'AC38').planted = true;
  later.zones.push({ ...structuredClone(later.zones.find(z => z.id === 'AC36')), id: 'AC999' });
  assert.doesNotThrow(() => assertOwnZonesLive(later, pkg));
});

test('corrected CE9/CE10 freeze is admitted and the erroneous twins stay inactive', () => {
  const corrected = verifyFrozenReference(path.join(ROOT, 'fixtures/cad-acid/onshape-ext/CE9-CE10'), catalog, sources);
  for (const key of keys) assert.ok(corrected.active.has(key), key);
  for (const dir of ['onshape', 'onshape-ext/A']) {
    const old = verifyFrozenReference(path.join(ROOT, 'fixtures/cad-acid', dir), catalog, sources);
    for (const key of keys) {
      assert.equal(old.active.has(key), false, `${dir}: ${key}`);
      const [zone, variant] = key.split('/');
      assert.equal(old.inactive.find(r => r.zone === zone && r.variant === variant)?.reason, 'twin file replaced');
    }
  }
});

test('corrected FeatureScript keeps the union survivors and uses the real draft signature', () => {
  const fsTwin = fs.readFileSync(path.join(ROOT, 'fixtures/cad-acid/fs/acid-blend-errata.fs'), 'utf8');
  assert.match(fsTwin, /qUnion\(\[post,\s*branch,\s*qCreatedBy\(id \+ "union",\s*EntityType\.BODY\)\]\)/);
  assert.match(fsTwin, /DraftType\.REFERENCE_SURFACE/);
  assert.match(fsTwin, /"referenceSurface"/);
  assert.match(fsTwin, /"pullVec"/);
  assert.doesNotMatch(fsTwin, /DraftType\.NEUTRAL_PLANE|"neutralPlane"/);
});

test('resolved CE9 and CE10 have independently reviewed evidence and no active overlays', () => {
  const errata = JSON.parse(fs.readFileSync(path.join(ROOT, 'fixtures/cad-acid/errata.json'), 'utf8'));
  for (const [id, zone] of [['CE9', 'AC36'], ['CE10', 'AC38']]) {
    assert.equal(errata.entries.some(e => e.id === id || e.zones.includes(zone)), false);
    const resolution = errata.annotations.find(e => e.id === id);
    assert.equal(resolution.status, 'resolved');
    assert.match(resolution.evidence.join(' '), /Independent reviewer at clean [a-f0-9]{40}/);
  }
  assert.equal(errata.annotations.find(e => e.id === 'CE10').followUp.status, 'resolved');
});

test('corrected OCCT freeze is admitted and historical AC36 stays inactive without replacing AC38', async () => {
  const frozen = JSON.parse(fs.readFileSync(path.join(ROOT, 'fixtures/cad-acid/occt-ext/CE9/observations.json'), 'utf8'));
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'ce9-admission-'));
  try {
    await verifyStoredReferences(frozen, { out });
    assert.deepEqual(frozen.rows.map(r => `${r.zone}/${r.variant}`).sort(), keys.filter(k => k.startsWith('AC36/')).sort());
    for (const row of frozen.rows) assert.equal(executionEvidence(row)?.status, 'frozen');
    for (const dir of ['occt', 'occt-ext/A']) {
      const p = JSON.parse(fs.readFileSync(path.join(ROOT, 'fixtures/cad-acid', dir, 'provenance.json'), 'utf8'));
      const copy = catalogBySha(p.zonesSha256, [path.join(ROOT, 'fixtures/cad-acid', dir, 'inputs/zones.json')]);
      assert.ok(copy, `${dir}: frozen catalog copy`);
      const binding = activeReferenceKeys(catalog, copy, sources, p.sources, 'occt', 'contract');
      for (const variant of ['V0', 'V1', 'V2', 'V3']) {
        assert.equal(binding.active.has(`AC36/${variant}`), false);
        assert.equal(binding.inactive.find(r => r.zone === 'AC36' && r.variant === variant)?.reason, 'twin file replaced');
        assert.equal(binding.active.has(`AC38/${variant}`), dir === 'occt');
        if (dir === 'occt-ext/A') assert.equal(binding.inactive.find(r => r.zone === 'AC38' && r.variant === variant)?.reason, 'twin file changed');
      }
    }
  } finally { fs.rmSync(out, { recursive: true, force: true }); }
});
