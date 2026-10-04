import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {ROOT, loadCatalog, readJSON, VARIANTS, sha256} from '../scripts/acid/common.mjs';
import {loadToleranceRules} from '../scripts/acid/tolerance.mjs';
import {score, scoreVariant} from '../scripts/acid/score.mjs';
import {executeRun} from '../scripts/acid/execution.mjs';

const {catalog,zonesSha256}=loadCatalog(), rules=loadToleranceRules();
const frozen=readJSON(path.join(ROOT,'fixtures/cad-acid/occt/observations.json'));
const zone=id=>catalog.zones.find(z=>z.id===id);
const original=(id,variant='V0')=>structuredClone(frozen.rows.find(r=>r.zone===id&&r.variant===variant));
// Owner boundary: rule numbers are policy, not audit receipts. Actual frozen
// observations + checked STEP supports are positive controls; negatives cross
// one acceptance condition, not the execution-admission gate.
test('contact and sub-fuzzy-gap rules accept only unchanged valid material with witnessed physical genus',()=>{
  for(const [id,ruleId] of [['AC22','OCCT-CONTACT-IMPRINT-1'],['AC44','OCCT-FUZZY-CONTACT-1']]) {
    const only={...rules,rules:rules.rules.filter(r=>r.id===ruleId)};
    const classify=row=>scoreVariant(catalog,zone(id),'occt',row,null,{toleranceRules:only});
    for(const variant of VARIANTS) {
      const baseline=classify(original(id,variant));
      assert.equal(baseline.strictStatus,'WRONG');assert.equal(baseline.status,'TOLERANT',`${id}/${variant}`);
      assert.equal(baseline.toleranceRuleIds[0],ruleId);
    }
    for(const [name,plant] of [
      ['native volume beyond unchanged v1 band',r=>r.metrics.volume*=1.000002],
      ['lost body',r=>r.metrics.bodies.pop()],
      ['invalid native material',r=>r.metrics.validity.brep=false],
      ['unverified native body',r=>r.nativeValidity=false],
      ['unsupported support',r=>r.metrics.surfaceTypes.Torus=1],
      ['real handle in raw Euler',r=>r.metrics.bodies[0].rawTopology.edges+=2],
      ['round-trip volume beyond band',r=>r.stepRoundTrip.metrics.volume*=1.000002],
      ['second import invalid',r=>r.stepRoundTrip.secondImport.metrics.validity.brep=false],
      ['second import absent',r=>delete r.stepRoundTrip.secondImport],
      ['missing physical cell decomposition',r=>delete r.metrics.bodies[0].rawTopology],
    ]) {
      const planted=original(id);plant(planted);
      assert.equal(classify(planted).status,'WRONG',`${id}: ${name}`);
    }
    const changed=structuredClone(zone(id));changed.construction.params.C2.center[0]=8+2e-7;
    assert.equal(scoreVariant(catalog,changed,'occt',original(id),null,{toleranceRules:only}).status,'WRONG',`${id}: gap above the rule's limit`);
  }
});

test('every rule is checked across all 48 zones; invalid OCCT lens and exact class never inherit tolerance',()=>{
  for(const rule of rules.rules) {
    const options={toleranceRules:{...rules,rules:[rule]}}, upgraded=new Set();
    for(const row of frozen.rows) {
      const verdict=scoreVariant(catalog,zone(row.zone),'occt',row,null,options);
      if(verdict.status==='TOLERANT')upgraded.add(row.zone);
      if(row.zone==='AC27') {
        assert.equal(row.metrics.validity.brep,false,'real frozen invalid-lens negative control');
        assert.equal(verdict.status,'WRONG',`${rule.id}/${row.variant}`);
      }
    }
    assert.deepEqual([...upgraded].sort(),rule.id==='OCCT-CONTACT-IMPRINT-1'?['AC22']:['AC44']);
    // Numerical exact-class control exercises the class guard, not a failed
    // wonky execution receipt. No unadmitted wonky row can prove a capability.
    const exact=structuredClone(catalog);
    exact.kernelClasses.tolerance.kernels=exact.kernelClasses.tolerance.kernels.filter(k=>k!=='occt');
    exact.kernelClasses.exact.kernels.push('occt');
    for(const id of ['AC22','AC44'])assert.equal(scoreVariant(exact,zone(id),'occt',original(id),null,options).status,'WRONG');
  }
});

test('strict points are v1 points, practical adds only admitted witnessed cells and CE12 is informational',{skip: !fs.existsSync(path.join(ROOT, 'out/build123d-performance/reference-venv/bin/python')) && 'REFERENCE_VENV_UNAVAILABLE: frozen STEP observer integration'},async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'acid-tolerance-'));
  try {
    // AC32 needs agreement of both references; executeRun admits both checked
    // frozen references rather than treating an OCCT-only report as proof.
    const input=await executeRun({kernels:[],out:dir,noSmoke:true});
    const report=score(catalog,input,{zonesSha256}), occt=report.kernels.occt;
    // The v1 claim is about the 48 base zones; zones added by a catalog extension
    // score their own frozen OCCT captures (occt-ext/*) and never gain a tolerance tier.
    const added=new Set(catalog.history.flatMap(h=>h.addedZones??[]));
    const cells=report.zones.filter(z=>z.kernel==='occt'),base=cells.filter(z=>!added.has(z.zone)),extension=cells.filter(z=>added.has(z.zone));
    assert.equal(base.length,48);
    const sum=(rows,key)=>rows.reduce((s,z)=>s+z[key],0);
    const resolved=new Set(['AC25','AC26','AC48','AC36','AC38']);
    // Preserve both historical assertions. Independently verified revolve,
    // crossed-cylinder blend and reference-surface draft freezes each restore
    // one strict/practical point after their errata resolve.
    const conserved=base.filter(z=>!resolved.has(z.zone));
    assert.equal(sum(conserved,'strictPoints'),37);assert.equal(sum(conserved,'practicalPoints'),39);
    for(const id of resolved){const cell=base.find(z=>z.zone===id);assert.equal(cell.status,'CORRECT',id);assert.equal(cell.strictPoints,1,id);assert.equal(cell.practicalPoints,1,id);for(const variant of VARIANTS)assert.equal(cell.variants[variant].status,'CORRECT',`${id}/${variant}`);}
    assert.equal(sum(base,'strictPoints'),37+resolved.size);assert.equal(sum(base,'practicalPoints'),39+resolved.size);
    for(const z of extension)assert.equal(z.practicalPoints,z.strictPoints,`${z.zone}: no tolerance tier outside the witnessed base cells`);
    assert.equal(occt.score,occt.strict);assert.equal(occt.practical-occt.strict,2);
    assert.equal(occt.strict,occt.strictCounts.PASS+occt.strictCounts.REFUSED_EXPECTED);
    // Open errata CE13 (AC111) and CE14 (AC129) dispute those zones for every kernel, OCCT included.
    assert.equal(occt.counts.TOLERANT,2);assert.equal(occt.counts.DISPUTED,2);
    assert.deepEqual(cells.filter(z=>z.status==='DISPUTED').map(z=>z.zone).sort(),['AC111','AC129']);
    // Preserve the original all-pre-Z1 assertion while extending the denominator.
    // Only the explicitly observed Z1 oracle limits may add WRONG verdicts.
    const z1=['AC66','AC74','AC111','AC112','AC113'];
    const previous=cells.filter(z=>!z1.includes(z.zone));
    assert.equal(previous.filter(z=>z.status==='WRONG').length,2);
    const limits=cells.filter(z=>z1.includes(z.zone)&&z.status==='WRONG');
    // The observed AC111/V3 OCCT limit is masked, not removed, while CE13 disputes AC111.
    assert.deepEqual(limits.map(z=>z.zone).sort(),[]);
    const ac111=cells.find(z=>z.zone==='AC111');
    for(const variant of ['V0','V1','V2','V3','V4'])assert.deepEqual([ac111.variants[variant].status,ac111.variants[variant].errata],['DISPUTED',['CE13']],`AC111/${variant}`);
    assert.equal(occt.counts.WRONG,2+limits.length);
    const captured=readJSON(path.join(ROOT,'fixtures/cad-acid/occt-ext/Z1/provenance.json'));
    assert.deepEqual(captured.namedLimits.map(r=>`${r.zone}/${r.variant}`).sort(),
      ['AC111/V3']);
    assert.deepEqual(captured.observedVerdicts,{CORRECT:26,WRONG:1});
    // Catalog-owner decision 4: freshly captured AddOptimal bounds still overestimate
    // the rotated trimmed sphere. The WRONG stays scored; no tolerance or point changes.
    // The frozen capture binds its original observer; main extends the live observer.
    assert.deepEqual(captured.observer,{bounds:'BRepBndLib.AddOptimal_s(shape, box, False, False)',gap:0,triangulation:false,sourceSha256:sha256(fs.readFileSync(path.join(ROOT,'fixtures/cad-acid/occt-ext/Z1/inputs/measure.py')))});
    assert(captured.errata.some(r=>r.zone==='AC111'&&r.variant==='V3'&&r.limit==='occt/AddOptimal-trimmed-sphere-bbox'));
    assert.deepEqual(captured.zones,z1);assert.equal(captured.cells,27);
    for(const id of ['AC22','AC44']) {
      const cell=report.zones.find(z=>z.kernel==='occt'&&z.zone===id);
      assert.equal(cell.strictStatus,'WRONG');assert.equal(cell.strictPoints,0);assert.equal(cell.practicalPoints,1);
    }
    assert.equal(report.kernels['wonky-rust'].counts.TOLERANT,0);
    const unauthenticated=score(catalog,structuredClone(input),{zonesSha256});
    assert.equal(unauthenticated.kernels.occt.practical,0,'copied witnesses and observations are not execution admission');
    for(const id of ['AC22','AC44'])assert.equal(unauthenticated.zones.find(z=>z.kernel==='occt'&&z.zone===id).status,'UNVERIFIED');
    const altered=structuredClone(rules);altered.rules[0].acceptance.supportAbsMm=1;
    assert.throws(()=>score(catalog,input,{zonesSha256,toleranceRules:altered}),/TOLERANCE_RULES_MISMATCH/);
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});

// Run in a fresh process so the scorer cannot reuse a previously cached witness.
test('score rejects a rehashed witness with neither STEP path nor STEP digest',{skip: !fs.existsSync(path.join(ROOT, 'out/build123d-performance/reference-venv/bin/python')) && 'REFERENCE_VENV_UNAVAILABLE: frozen STEP observer integration'},()=>{
  const child=`
    import assert from 'node:assert/strict';
    import fs from 'node:fs';
    import os from 'node:os';
    import path from 'node:path';
    import {loadCatalog,sha256} from './scripts/acid/common.mjs';
    import {score} from './scripts/acid/score.mjs';
    import {executeRun,executionEvidence} from './scripts/acid/execution.mjs';
    const {catalog,zonesSha256}=loadCatalog();
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),'acid-unbound-witness-'));
    try {
      const admitted=await executeRun({kernels:[],out:dir,noSmoke:true});
      assert.equal(executionEvidence(admitted.rows.find(r=>r.kernel==='occt'&&r.zone==='AC22'))?.status,'frozen');
      const evidenceDir=path.join(process.cwd(),'fixtures/cad-acid/occt');
      const witnessPath=path.join(evidenceDir,'tolerance-witness.json');
      const manifestPath=path.join(evidenceDir,'tolerance-SHA256SUMS');
      const witness=JSON.parse(fs.readFileSync(witnessPath,'utf8'));
      for(const row of witness.rows){delete row.stepFile;delete row.sourceSTEPsha256;}
      const forged=JSON.stringify(witness);
      const manifest=sha256(Buffer.from(forged))+'  tolerance-witness.json\\n';
      const read=fs.readFileSync;
      let stepReads=0;
      fs.readFileSync=function(file,...args){
        if(String(file)===manifestPath)return args[0]==='utf8'?manifest:Buffer.from(manifest);
        if(String(file)===witnessPath)return args[0]==='utf8'?forged:Buffer.from(forged);
        if(String(file).endsWith('.step')){stepReads++;throw new Error('SIMULATED_MISSING_STEP_ARTIFACT');}
        return read.call(this,file,...args);
      };
      assert.throws(()=>score(catalog,admitted,{zonesSha256}),/TOLERANCE_WITNESS_BINDING/);
      assert.equal(stepReads,0,'the omitted manifest cannot silently earn practical points');
    } finally {fs.rmSync(dir,{recursive:true,force:true});}
  `;
  const result=spawnSync(process.execPath,['--input-type=module','-e',child],{cwd:ROOT,encoding:'utf8',env:{...process.env,NODE_OPTIONS:'--max-old-space-size=8192'}});
  assert.equal(result.status,0,result.stderr);
});
