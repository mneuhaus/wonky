import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {ROOT, ALL_VARIANTS, VARIANTS, loadCatalog, readJSON, catalogBySha, zoneVariants, closedForm, validateCatalog,sha256, loadErrata} from '../scripts/acid/common.mjs';
import {score, scoreVariant} from '../scripts/acid/score.mjs';
import {verifyStoredReferences, executionEvidence} from '../scripts/acid/execution.mjs';
import {assertPackageDelta, assertZonesLiveSince} from './helpers/catalog-delta.mjs';

// One catalog, extended in place (tmp/acid/v2/catalog-v2-proposal.md §2, §4). These tests own the
// per-zone binding and the variant semantics; the synthetic rows below exercise score decisions
// only and are never execution evidence.
const {catalog, zonesSha256} = loadCatalog();
const baseSha = catalog.history.find(h => h.baseSha256)?.baseSha256;
const base = catalogBySha(baseSha);
const added = catalog.history.flatMap(h => h.addedZones ?? []);
const REFERENCE_PYTHON = path.join(ROOT, 'out/build123d-performance/reference-venv/bin/python');
const zone = id => catalog.zones.find(z => z.id === id);

// Elementary observations taken from the zone's own declared contract (V4 from its V4 closed form).
function contractRows(id, kernel = 'occt') {
  const z = zone(id), branch = z.expected.outcomes.find(o => o.kind === 'geometry');
  return zoneVariants(z).map(variant => {
    const cf = closedForm(z, branch, variant), local = cf.bbox.variants[variant];
    const topology = Object.fromEntries(cf.topology.scored.map(k => [k, cf.topology[k]]));
    const metrics = {volume: cf.volume.valueFloat, area: cf.area.valueFloat, bodies: [{volume: cf.volume.valueFloat, centroid: [0, 0, 0]}],
      topology, bbox: {min: local.min.map((x, i) => x + z.cell.originMm[i]), max: local.max.map((x, i) => x + z.cell.originMm[i])},
      measurements: Object.fromEntries(cf.measurements.map(m => [m.name, m.valueFloat])), validity: {brep: true, closed: true, positive: true}};
    return {kernel, zone: id, variant, outcome: 'built', nativeValidity: true, metrics, stepRoundTrip: {ok: true, metrics: structuredClone(metrics)}};
  });
}

test('catalog history preserves every base zone and limits amendments to the six authorized zones', () => {
  assert.ok(base, 'base catalog copy in fixtures/cad-acid/catalog-history');
  assert.doesNotThrow(() => validateCatalog(base));
  const amended=['AC25','AC26','AC31','AC36','AC38','AC48'];
  const errata=assertPackageDelta(catalog,'AC1-2026-10-02-catalog-errata',{amended}),previous=errata.base;
  const beforeTwin=catalogBySha('3e4f8229d0f01fc7814a3ae308f6da802a22eee81eac4a7dda656b578c30423b');
  assert.deepEqual(beforeTwin.history.filter(h=>h.version!=='AC1-2026-10-02-catalog-errata').flatMap(h=>h.amendedZones??[]),['AC113','AC115']);
  // Every amendment since the base names its zones in history; base zones change only that way.
  const baseIndex=catalog.history.findIndex(h=>h.version===base.version);
  assert.ok(baseIndex>=0);
  for (const z of base.zones) if (amended.includes(z.id)) assert.deepEqual(previous.zones.find(p=>p.id===z.id), z, z.id);
  assertZonesLiveSince(catalog, base, baseIndex, base.zones.map(z=>z.id), 'base');
  for(const z of previous.zones) assert.deepEqual(errata.after.zones.find(n=>n.id===z.id).tolerance,z.tolerance,z.id+' tolerance unchanged');
  assertZonesLiveSince(catalog, errata.after, errata.index, previous.zones.map(z=>z.id), 'tolerance', z=>z.tolerance);
  // Zones sit in group order (a later batch can add to an earlier group), history in chronological
  // order: the new zones and the history's added zones are the same set, each added once.
  assert.equal(new Set(added).size, added.length, 'a zone is added by one history entry');
  assert.deepEqual(catalog.zones.map(z => z.id).filter(id => !base.zones.some(z => z.id === id)).sort(), [...added].sort());
  const noReason = structuredClone(catalog);
  delete noReason.zones.find(z => z.id === added[0]).variants;
  assert.throws(() => validateCatalog(noReason), /must declare variants/);
  const ownV5 = structuredClone(catalog), o = ownV5.zones.find(z => z.id === 'AC61').expected.outcomes[0];
  o.closedFormByVariant.V5 = 'V4';
  assert.throws(() => validateCatalog(ownV5), /closedFormByVariant/);
});

test('variant semantics: undeclared variants are no cells, V4 has its own contract, V5 must equal V0', () => {
  const empty = score(catalog, {zonesSha256, rows: []}, {zonesSha256});
  assert.equal(empty.catalog.zones, catalog.zones.length);
  assert.equal(empty.catalog.cells, catalog.zones.reduce((n, z) => n + zoneVariants(z).length, 0));
  const legacy = empty.zones.find(r => r.kernel === 'occt' && r.zone === 'AC01');
  assert.deepEqual(Object.keys(legacy.variants), VARIANTS, 'no V4/V5 cell for a zone that does not declare them');
  assert.deepEqual(empty.zones.find(r => r.kernel === 'occt' && r.zone === 'AC61').declaredVariants, ALL_VARIANTS);
  const axes = empty.kernels.occt.byAxis;
  assert.equal(axes.V0.zones, catalog.zones.length);
  assert.equal(axes.V4.zones, catalog.zones.filter(z => zoneVariants(z).includes('V4')).length);
  assert.equal(Object.values(empty.kernels.occt.byFamily).reduce((n, f) => n + f.zones, 0), catalog.zones.length);

  const z = zone('AC61'), verdict = rows => score(catalog, {zonesSha256, rows}, {zonesSha256}).zones.find(r => r.kernel === 'occt' && r.zone === 'AC61');
  for (const row of contractRows('AC61')) assert.equal(scoreVariant(catalog, z, 'occt', row).status, 'CORRECT', `${row.variant} contract baseline`);
  assert.equal(verdict(contractRows('AC61')).status, 'UNVERIFIED', 'numerical baseline, not a reference claim');
  const v4asV0 = contractRows('AC61'), v0 = v4asV0.find(r => r.variant === 'V0');
  Object.assign(v4asV0.find(r => r.variant === 'V4'), {metrics: structuredClone(v0.metrics), stepRoundTrip: structuredClone(v0.stepRoundTrip)});
  const wrongV4 = verdict(v4asV0);
  assert.equal(wrongV4.status, 'WRONG'); assert.equal(wrongV4.variants.V4.status, 'WRONG', 'V4 built with V0 radii misses its own closed form');
  const drift = contractRows('AC61');
  drift.find(r => r.variant === 'V0').metrics.volume *= 1 - 0.75e-6;
  drift.find(r => r.variant === 'V5').metrics.volume *= 1 + 0.75e-6;
  const metamorphic = verdict(drift);
  assert.equal(metamorphic.status, 'WRONG'); assert(metamorphic.reasons.some(r => r.startsWith('metamorphic: V5')), 'V5 is held to V0');
  const refusedV5 = contractRows('AC61');
  Object.assign(refusedV5.find(r => r.variant === 'V5'), {outcome: 'refused', refusal: {name: 'UnsupportedFeatureError', category: 'capability', capability: true}});
  assert.equal(verdict(refusedV5).status, 'REFUSED', 'one refused declared variant refuses the zone');
});

// A separate checkout-shaped copy, never the working tree's own fixtures.
function scratchTree(catalogBytes) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'acid-extension-')));
  for (const relative of ['scripts', 'src', 'fixtures/cad-acid']) fs.cpSync(path.join(ROOT, relative), path.join(dir, relative), {recursive: true});
  fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(dir, 'node_modules'));
  fs.mkdirSync(path.join(dir, 'out'));
  if (fs.existsSync(path.join(ROOT, 'out/build123d-performance'))) fs.symlinkSync(path.join(ROOT, 'out/build123d-performance'), path.join(dir, 'out/build123d-performance'));
  const original=fs.readFileSync(path.join(ROOT,'fixtures/cad-acid/zones.json'));
  fs.writeFileSync(path.join(dir,'fixtures/cad-acid/catalog-history',`${sha256(original)}.json`),original);
  if (catalogBytes) {
    fs.writeFileSync(path.join(dir, 'fixtures/cad-acid/zones.json'), catalogBytes);
    fs.copyFileSync(path.join(ROOT,'fixtures/cad-acid/catalog-history/52771c0fae55085ad80858ee3ea4446b3b7117fa1929e1020b91b531d5f420cf.errata.json'),path.join(dir,'fixtures/cad-acid/errata.json'));
  }
  return dir;
}
const child = (dir, code) => spawnSync(process.execPath, ['--input-type=module', '-e', code], {cwd: dir, encoding: 'utf8', timeout: 180000, maxBuffer: 1 << 24,
  env: {...process.env, NODE_OPTIONS: '--max-old-space-size=8192'}});
const OCCT_SCORE = `
  import fs from 'node:fs';
  import {loadCatalog,readJSON} from './scripts/acid/common.mjs';
  import {score} from './scripts/acid/score.mjs';
  import {verifyStoredReferences,executionEvidence} from './scripts/acid/execution.mjs';
  const {catalog,zonesSha256}=loadCatalog(),frozen=readJSON('fixtures/cad-acid/occt/observations.json');
  if(catalog.version==='AC1-2026-10-02-catalog-errata')frozen.rows=frozen.rows.filter(r=>!['AC25','AC26','AC31','AC36','AC38','AC48'].includes(r.zone));
  await verifyStoredReferences(frozen,{out:fs.mkdtempSync('out/stored-')});
  const report=score(catalog,frozen,{zonesSha256});
  console.log(JSON.stringify({zones:report.zones.filter(r=>r.kernel==='occt'),admitted:frozen.rows.map(r=>executionEvidence(r)?.status)}));`;

test('frozen v1 references score identically under the extended catalog and under the base copy', async () => {
  const dir = scratchTree(fs.readFileSync(path.join(ROOT, 'fixtures/cad-acid/catalog-history', `${baseSha}.json`)));
  try {
    const pristine = child(dir, OCCT_SCORE);
    assert.equal(pristine.status, 0, pristine.stderr);
    const underBase = JSON.parse(pristine.stdout);
    const frozen = readJSON(path.join(ROOT, 'fixtures/cad-acid/occt/observations.json'));
    await assert.rejects(verifyStoredReferences(frozen,{out:path.join(dir,'stale')}),/REFERENCE_ZONES_SHA_MISMATCH/);
    frozen.rows=frozen.rows.filter(r=>!['AC25','AC26','AC31','AC36','AC38','AC48'].includes(r.zone));
    await verifyStoredReferences(frozen, {out: path.join(dir, 'extended')});
    assert(frozen.rows.every(r => executionEvidence(r)?.status === 'frozen'), 'every v1 OCCT row stays active');
    const extended = score(catalog, frozen, {zonesSha256}).zones.filter(r => r.kernel === 'occt');
    const strip = ({family, declaredVariants, ...row}) => row;
    for (const row of underBase.zones.filter(r=>!['AC25','AC26','AC31','AC36','AC38','AC48'].includes(r.zone))) assert.deepEqual(strip(extended.find(r => r.zone === row.zone)), strip(row), row.zone);
    // Errata policy: a listed zone is DISPUTED for every kernel, including unexecuted cells.
    const disputed = new Set(loadErrata().entries.flatMap(e => e.zones));
    for (const id of added) {
      const row = extended.find(r => r.zone === id);
      assert.equal(row.status, disputed.has(id) ? 'DISPUTED' : 'NOT_RUN', id); assert.equal(row.points, 0); assert.equal(row.practicalPoints, 0);
    }
  } finally {fs.rmSync(dir, {recursive: true, force: true});}
});

test('reference activation: a superseded twin is inactive, two active captures are ambiguous, tampering fails', t => {
  const dir = scratchTree(fs.readFileSync(path.join(ROOT, 'fixtures/cad-acid/catalog-history', `${baseSha}.json`)));
  try {
    const occt = path.join(dir, 'fixtures/cad-acid/occt');
    const verify = child(dir, OCCT_SCORE.replace("console.log(JSON.stringify({zones:report.zones.filter(r=>r.kernel==='occt'),admitted:frozen.rows.map(r=>executionEvidence(r)?.status)}));",
      "console.log(JSON.stringify(Object.fromEntries(frozen.rows.map(r=>[r.zone+'/'+r.variant,executionEvidence(r)?.status])),null,0));"));
    assert.equal(verify.status, 0, verify.stderr);
    assert(Object.values(JSON.parse(verify.stdout)).every(s => s === 'frozen'), 'positive control: all v1 rows active in the copy');
    // A changed b3d twin supersedes exactly the rows of the zones it builds.
    const blend = path.join(dir, 'fixtures/cad-acid/b3d/acid_blend.py'), original = fs.readFileSync(blend);
    fs.appendFileSync(blend, '\n# superseded\n');
    const superseded = child(dir, OCCT_SCORE);
    assert.equal(superseded.status, 0, superseded.stderr);
    const statuses = JSON.parse(superseded.stdout), blendZones = catalog.groups.find(g => g.id === 'blend').zoneIds;
    const frozenRows = readJSON(path.join(ROOT, 'fixtures/cad-acid/occt/observations.json')).rows;
    frozenRows.forEach((row, i) => assert.equal(statuses.admitted[i], blendZones.includes(row.zone) ? 'unverified' : 'frozen', `${row.zone}/${row.variant}`));
    for (const r of statuses.zones.filter(r => blendZones.includes(r.zone))) assert.equal(r.points, 0, `${r.zone} earns nothing from a superseded reference`);
    fs.writeFileSync(blend, original);
    // The same rows frozen twice are two active references for one cell.
    const duplicate = path.join(dir, 'fixtures/cad-acid/occt-ext/duplicate');
    fs.mkdirSync(duplicate, {recursive: true});
    for (const file of ['SHA256SUMS', 'observations.json', 'provenance.json']) fs.copyFileSync(path.join(occt, file), path.join(duplicate, file));
    const ambiguous = child(dir, OCCT_SCORE);
    assert.notEqual(ambiguous.status, 0); assert.match(ambiguous.stderr, /REFERENCE_AMBIGUOUS/);
    // A tampered extension manifest is a hard error, not an inactive capture.
    fs.appendFileSync(path.join(duplicate, 'observations.json'), ' ');
    const tampered = child(dir, OCCT_SCORE);
    assert.notEqual(tampered.status, 0); assert.match(tampered.stderr, /FROZEN_OCCT_CHECKSUM_MISMATCH/);
    fs.rmSync(duplicate, {recursive: true, force: true});
    // A frozen capture whose catalog copy cannot be recovered is refused by name.
    fs.writeFileSync(path.join(dir,'fixtures/cad-acid/zones.json'),fs.readFileSync(path.join(ROOT,'fixtures/cad-acid/zones.json')));
    fs.renameSync(path.join(dir, 'fixtures/cad-acid/catalog-history'), path.join(dir, 'history-held'));
    const orphan = child(dir, OCCT_SCORE);
    assert.notEqual(orphan.status, 0); assert.match(orphan.stderr, /FROZEN_OCCT_PROVENANCE_MISMATCH|REFERENCE_ZONES_SHA_MISMATCH|ERRATA_ZONES_SHA_MISMATCH/);
  } finally {fs.rmSync(dir, {recursive: true, force: true});}
});

test('errata, tolerance rules and results bind per zone: a changed covered zone needs a new version', () => {
  const dir = scratchTree();
  try {
    const file = path.join(dir, 'fixtures/cad-acid/zones.json'), text = fs.readFileSync(file, 'utf8');
    const amend = id => { const needle = `"id": "${id}",\n   "group": `, next = text.replace(needle, `"id": "${id}",\n   "amendment": "planted",\n   "group": `);
      assert.notEqual(next, text, `planted amendment of ${id} applies`); fs.writeFileSync(file, JSON.stringify(JSON.parse(next), null, 1)); };
    const probe = `import {loadCatalog} from './scripts/acid/common.mjs';import {score} from './scripts/acid/score.mjs';
      const {catalog,zonesSha256}=loadCatalog(),base=catalog.history.find(h=>h.baseSha256).baseSha256;
      const attempt=(label,results)=>{try{score(catalog,results,{zonesSha256});console.log(label,'SCORED')}catch(e){console.log(label,e.message)}};
      attempt('empty',{zonesSha256,rows:[]});
      for(const id of ['AC01','AC02'])attempt(id,{zonesSha256:base,rows:[{kernel:'occt',zone:id,variant:'V0',outcome:'not_run'}]});`;
    const run = () => { const r = child(dir, probe); assert.equal(r.status, 0, r.stderr); return r.stdout; };
    // Positive control: base-catalog results remain scorable for unchanged zones.
    assert.match(run(), /empty SCORED\nAC01 SCORED\nAC02 SCORED/);
    // An uncovered zone changes: errata and tolerance stay valid, results of that zone do not.
    amend('AC01');
    assert.match(run(), /empty SCORED\nAC01 REFERENCE_ZONES_SHA_MISMATCH: results covers AC01.*\nAC02 SCORED/);
    // An open disputed zone (CE9) changes without a new errata version: scoring refuses.
    amend('AC36');
    assert.match(run(), /empty ERRATA_ZONES_SHA_MISMATCH: errata .* covers AC36/);
    // A witnessed tolerance zone changes without new tolerance evidence: scoring refuses.
    amend('AC22');
    assert.match(run(), /empty TOLERANCE_ZONES_SHA_MISMATCH: tolerance rules .* covers AC22/);
  } finally {fs.rmSync(dir, {recursive: true, force: true});}
});

test('a scored surfaceTypes histogram is compared on OCCT observations and on every STEP round trip', () => {
  // Frozen splines-a twin rows (fixtures/cad-acid/occt-ext/S); the mutations below are synthetic score inputs.
  const frozen = readJSON(path.join(ROOT, 'fixtures/cad-acid/occt-ext/S/observations.json'));
  const row = frozen.rows.find(r => r.zone === 'AC100' && r.variant === 'V0'), z = zone('AC100');
  assert.deepEqual(z.closedForm.topology.surfaceTypes, {Plane: 3, SurfaceOfExtrusion: 1});
  assert.equal(scoreVariant(catalog, z, 'occt', structuredClone(row)).status, 'CORRECT', 'positive control: the frozen twin row');
  // The observer filing the extrusion face as a plane keeps every count and fails only the declared classes.
  const asPlane = structuredClone(row);
  asPlane.metrics.surfaceTypes = {Plane: 4};
  const wrong = scoreVariant(catalog, z, 'occt', asPlane);
  assert.equal(wrong.status, 'WRONG'); assert.deepEqual(wrong.types, ['topology']); assert.match(wrong.reason, /surfaceTypes/);
  const retyped = structuredClone(row);
  retyped.stepRoundTrip.secondImport.metrics.surfaceTypes = {Plane: 3, BSplineSurface: 1};
  assert.equal(scoreVariant(catalog, z, 'occt', retyped).status, 'WRONG', 'a STEP round trip that re-types the extrusion face');
  // A native exact observation carries no classes; its OCCT-observed round trip is held to them instead.
  const native = structuredClone(row);
  native.metrics.basis = 'native-f64-construction'; delete native.metrics.surfaceTypes;
  assert.equal(scoreVariant(catalog, z, 'occt', native).status, 'CORRECT');
  native.stepRoundTrip.metrics.surfaceTypes = {Plane: 4};
  assert.equal(scoreVariant(catalog, z, 'occt', native).status, 'WRONG');
});

test('AC101 declares measured D1 natural interpolation and rejects another parameter rule', () => {
  const z=zone('AC101');
  assert.equal(catalog.zones.length >= 79,true);
  assert.equal(z.construction.params.fit.points.length,6);
  assert.equal(z.construction.params.fit.parameters[0],0);
  assert.equal(z.construction.params.fit.parameters.at(-1),1);
  assert.deepEqual(z.closedForm.topology.surfaceTypes,{Plane:5,SurfaceOfExtrusion:1});
  const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'acid-fit-contract-'));
  try {
    const mutant=structuredClone(catalog);
    mutant.zones.find(z=>z.id==='AC101').construction.params.fit.parameters=[0,0.2,0.4,0.6,0.8,1];
    const file=path.join(scratch,'zones.json');fs.writeFileSync(file,JSON.stringify(mutant));
    const r=spawnSync('uv',['run',path.join(ROOT,'scripts/acid/closed-forms.py'),'--zones',file,'--only','AC101'],{cwd:ROOT,encoding:'utf8',timeout:180000,maxBuffer:1<<22});
    if(r.stderr)process.stderr.write(r.stderr);
    assert.equal(r.error,undefined);
    assert.equal(r.status,1);
    assert.match(r.stdout,/FAIL construction D1 explicit parameters bit-equal to IEEE default/);
  } finally {fs.rmSync(scratch,{recursive:true,force:true});}
});

test('OCCT integrates a real multi-span fit prism without changing its observed topology', {skip: !process.getBuiltinModule('node:fs').existsSync(new URL('../out/build123d-performance/reference-venv/bin/python', import.meta.url)) && 'REFERENCE_VENV_UNAVAILABLE: build123d/OCCT reference observer'},() => {
  const code = `
import sys, json, math
from pathlib import Path
sys.path.insert(0,str(Path.cwd()/'scripts/acid'))
sys.path.insert(0,str(Path.cwd()/'fixtures/cad-acid/b3d'))
from measure import props, canonical
from acid_fit_spline import ac101
cat=json.loads((Path.cwd()/'fixtures/cad-acid/zones.json').read_text())
z=next(z for z in cat['zones'] if z['id']=='AC101')
s=ac101('V0')[0].wrapped
before=canonical(s)
p=props(s)
for field in ('volume','area'):
    expected=z['closedForm'][field]['valueFloat']
    assert math.isclose(p[field],expected,rel_tol=z['tolerance'][field+'Rel']['exact']), (field,p[field],expected)
assert canonical(s)==before, 'property integration changed the source topology'
assert (before[0]['faces'],before[0]['edges'],before[0]['vertices'])==(6,12,8)
print(json.dumps({'volume':p['volume'],'area':p['area']}))
`;
  const r=spawnSync('uv',['run','--no-project',REFERENCE_PYTHON,'-B','-c',code],{cwd:ROOT,encoding:'utf8',timeout:180000,maxBuffer:1<<22});
  if(r.stderr)process.stderr.write(r.stderr);
  assert.equal(r.error,undefined);
  assert.equal(r.status,0,r.stdout+'\n'+r.stderr);
});
