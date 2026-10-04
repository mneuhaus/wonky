import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, loadCatalog, loadErrata, sourceHashes, verifyFrozenReference, zoneVariants } from '../scripts/acid/common.mjs';
import { scoreVariant } from '../scripts/acid/score.mjs';

const { catalog } = loadCatalog();
const sources = sourceHashes(catalog);
const N24 = path.join(ROOT, 'fixtures/cad-acid/onshape-ext/N24');
const provenance = JSON.parse(fs.readFileSync(path.join(N24, 'provenance.json'), 'utf8'));
const zone = id => catalog.zones.find(z => z.id === id);

// Same decoding as scripts/acid/frozen-onshape.py plain(): BTFSValue tree to plain JSON.
function plain(value) {
  if (!value || typeof value !== 'object') return value;
  const kind = value.btType ?? '';
  if (kind.endsWith('BTFSValueMap')) return Object.fromEntries(value.value.map(e => [plain(e.key), plain(e.value)]));
  if (kind.endsWith('BTFSValueArray')) return value.value.map(plain);
  if ('value' in value) return value.typeTag ? `${value.typeTag}.${value.value}` : value.value;
  return value;
}
function frozenErrors() {
  const errors = {};
  for (const studio of provenance.partStudios)
    if (studio.featureErrors) Object.assign(errors, plain(JSON.parse(fs.readFileSync(path.join(N24, studio.featureErrors), 'utf8')).result));
  return Object.fromEntries(provenance.studios.filter(s => s.featureStatus !== 'OK')
    .map(s => [`${s.zone}/${s.variant}`, errors[s.featureId]]));
}

test('N24 freeze is admitted for every declared cell of its 24 zones and for no cell another freeze holds', () => {
  const declared = provenance.zones.flatMap(id => zoneVariants(zone(id)).map(v => `${id}/${v}`)).sort();
  assert.equal(provenance.zones.length, 24);
  assert.equal(declared.length, 127);
  const { active } = verifyFrozenReference(N24, catalog, sources);
  assert.deepEqual([...active].sort(), declared);
  for (const dir of ['onshape', 'onshape-ext/A', 'onshape-ext/CE9-CE10']) {
    const other = verifyFrozenReference(path.join(ROOT, 'fixtures/cad-acid', dir), catalog, sources);
    assert.deepEqual(declared.filter(k => other.active.has(k)), [], dir);
  }
});

test('N24 frozen feature errors are exactly the 15 triaged cells', () => {
  const expected = {};
  for (const v of ['V0', 'V1', 'V2', 'V3', 'V4']) expected[`AC111/${v}`] = { bodies: 0, error: 'ErrorStringEnum.REGEN_ERROR' };
  for (const v of ['V0', 'V1', 'V2', 'V3', 'V4', 'V5']) expected[`AC129/${v}`] = { bodies: 0, error: 'ErrorStringEnum.REGEN_ERROR' };
  for (const v of ['V0', 'V1', 'V2', 'V3']) expected[`AC115/${v}`] = { bodies: 0, error: 'ErrorStringEnum.BOOLEAN_NON_MANIFOLD_RESULT' };
  assert.deepEqual(frozenErrors(), expected);
  assert.equal(provenance.studios.find(s => s.zone === 'AC115' && s.variant === 'V4').featureStatus, 'OK');
});

test('CE13 and CE14 dispute only AC111 and AC129; AC115 stays a genuine Onshape error', () => {
  const errata = loadErrata();
  const ids = errata.entries.filter(e => ['CE13', 'CE14'].includes(e.id));
  assert.deepEqual(ids.map(e => [e.id, e.zones, e.kernels, e.reason]), [
    ['CE13', ['AC111'], ['*'], 'awaiting live Onshape re-capture of the corrected twin'],
    ['CE14', ['AC129'], ['*'], 'awaiting live Onshape re-capture of the corrected twin'],
  ]);
  assert.equal(errata.entries.some(e => e.zones.includes('AC115')), false);
  const error = (z, v, enumName) => ({ kernel: 'onshape', zone: z, variant: v, outcome: 'error', onshapeError: `ErrorStringEnum.${enumName}`,
    reason: `ONSHAPE_FEATURE_STATUS_ERROR (ErrorStringEnum.${enumName}): no predeclared mapping from Onshape errors to refusal categories` });
  // The frozen Onshape error rows and every other kernel's cells (executed or not) are DISPUTED.
  assert.equal(scoreVariant(catalog, zone('AC111'), 'onshape', error('AC111', 'V0', 'REGEN_ERROR'), null, { errata }).status, 'DISPUTED');
  assert.equal(scoreVariant(catalog, zone('AC129'), 'onshape', error('AC129', 'V5', 'REGEN_ERROR'), null, { errata }).status, 'DISPUTED');
  for (const kernel of ['occt', 'wonky-rust'])
    for (const id of ['AC111', 'AC129']) assert.equal(scoreVariant(catalog, zone(id), kernel, null, null, { errata }).status, 'DISPUTED', `${kernel} ${id}`);
  assert.equal(scoreVariant(catalog, zone('AC115'), 'onshape', error('AC115', 'V0', 'BOOLEAN_NON_MANIFOLD_RESULT'), null, { errata }).status, 'ERROR');
});

test('corrected twins change only the disputed call against the frozen originals', () => {
  const read = name => fs.readFileSync(path.join(ROOT, 'fixtures/cad-acid/fs', name), 'utf8').split('\n');
  const changed = (a, b) => ({ removed: a.filter(l => !b.includes(l)), added: b.filter(l => !a.includes(l)) });
  const z1 = changed(read('acid-boolean-z1.fs'), read('acid-boolean-z1-errata.fs'));
  assert.deepEqual(z1.removed.map(l => l.trim()), ['fSphere(context, id + "sphere", { "center" : vector(10,2,10) * millimeter, "radius" : (4 + acidRadiusDelta(variant)) * millimeter });']);
  assert.deepEqual(z1.added.filter(l => !l.trim().startsWith('//')).map(l => l.trim()), ['opSphere(context, id + "sphere", { "center" : vector(10,2,10) * millimeter, "radius" : (4 + acidRadiusDelta(variant)) * millimeter });']);
  const zw1 = changed(read('acid-sweep-zw1.fs'), read('acid-sweep-zw1-errata.fs'));
  assert.equal(zw1.removed.length, 2);
  for (const line of zw1.removed) assert.match(line, /qClosestTo\(qCreatedBy\(id\+"(low|high)",EntityType\.VERTEX\)/);
  const code = zw1.added.filter(l => !l.trim().startsWith('//')).join('\n');
  assert.match(code, /qAdjacent\(qSketchRegion\(sketchId,false\),AdjacencyType\.VERTEX,EntityType\.VERTEX\)/);
  assert.equal((code.match(/qClosestTo\(zwRegionVertices\(id\+"(low|high)"\)/g) ?? []).length, 2);
  assert.doesNotMatch(code, /qCreatedBy\(id\+"(low|high)",EntityType\.VERTEX\)/);
});
