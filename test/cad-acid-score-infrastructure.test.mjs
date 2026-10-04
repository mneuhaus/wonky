import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {gunzipSync} from 'node:zlib';
import {spawnSync} from 'node:child_process';
import {ROOT,loadCatalog,sha256} from '../scripts/acid/common.mjs';
import {scoreVariant,score} from '../scripts/acid/score.mjs';
const {catalog,zonesSha256}=loadCatalog();
const zone=catalog.zones.find(z=>z.id==='AC01');
// Numerical test observation only; no synthetic row can earn live points.
function row() {
  const metrics={volume:768,area:640,bodies:[{volume:768,centroid:[6,4,4]}],
    topology:{bodies:1,shells:1,faces:8,edges:18,vertices:12,genus:0,singularPoints:0},
    bbox:structuredClone(zone.closedForm.bbox.variants.V0),measurements:{probe_notch:6,probe_far:4},
    validity:{brep:true,closed:true,positive:true}};
  return {kernel:'occt',zone:'AC01',variant:'V0',outcome:'built',nativeValidity:true,metrics,
    stepRoundTrip:{ok:true,metrics:structuredClone(metrics)}};
}
const verdict=r=>scoreVariant(catalog,zone,'occt',r);
for(const [name,execution,reason] of [
  ['timeout',{ok:false,status:0,error:'spawnSync uv ETIMEDOUT'},'spawnSync uv ETIMEDOUT'],
  ['signal',{ok:false,status:null,signal:'SIGKILL'},'signal SIGKILL'],
  ['spawn error',{ok:false,status:null,error:'spawnSync uv ENOENT'},'spawnSync uv ENOENT'],
  ['interpreter unavailable',{ok:false,status:2,stderrTail:['error: No interpreter found for Python 9.99 in virtual environments or search path']},'error: No interpreter found for Python 9.99 in virtual environments or search path'],
  ['missing interpreter',{ok:false,status:2,stderrTail:['error: Failed to spawn: python','No such file or directory (os error 2)']},'error: Failed to spawn: python'],
])test(`STEP observation ${name} is ERROR in strict and tiered scoring`,()=>{
  const r=row();r.builtBeforeFailure=true;r.stepRoundTrip={ok:false,reason:'STEP_MEASUREMENT_FAILED',execution};
  const expected=`observation infrastructure: STEP measurement did not complete (${reason})`;
  assert.deepEqual(verdict(r),{status:'ERROR',strictStatus:'ERROR',reason:expected});
  const cell=score(catalog,{zonesSha256,rows:[r]}).zones.find(z=>z.kernel==='occt'&&z.zone==='AC01');
  assert.equal(cell.status,'ERROR');assert.equal(cell.strictStatus,'ERROR');assert.equal(cell.points,0);
  assert.equal(cell.variants.V0.reason,expected);
  // A legacy post-build outcome must preserve the subprocess evidence.
  r.outcome='error';assert.equal(verdict(r).status,'ERROR');assert.equal(verdict(r).reason,expected);
});
test('completed invalid/mismatching STEP and absent round trip remain WRONG',()=>{
  assert.equal(verdict(row()).status,'CORRECT');
  for(const mutate of [
    r=>{r.stepRoundTrip={ok:false,execution:{ok:true,status:0}};},
    r=>{r.stepRoundTrip={ok:false,execution:{ok:false,status:1,stderrTail:['invalid STEP']}};},
    r=>{r.stepRoundTrip={ok:false,execution:{ok:false,status:1,stderrTail:['No such file or directory: model.step']}};},
    r=>{r.stepRoundTrip.ok=false;r.stepRoundTrip.metrics.validity.brep=false;},
    r=>{r.stepRoundTrip.metrics.volume*=1.01;},
    r=>{delete r.stepRoundTrip;},
    // Existing measurement output cannot be erased by a later subprocess failure.
    r=>{r.stepRoundTrip.ok=false;r.stepRoundTrip.execution={ok:false,error:'spawnSync uv ETIMEDOUT'};},
  ]){const r=row();mutate(r);assert.equal(verdict(r).status,'WRONG');assert.equal(verdict(r).strictStatus,'WRONG');}
});
test('second import uses the same infrastructure distinction',()=>{
  const r=row();r.stepRoundTrip.secondImport={ok:false,execution:{ok:false,signal:'SIGTERM'}};
  assert.equal(verdict(r).status,'ERROR');assert.match(verdict(r).reason,/signal SIGTERM/);
  r.stepRoundTrip.secondImport={ok:false,execution:{ok:true,status:0}};
  assert.equal(verdict(r).status,'WRONG');
});

const freeze=path.join(ROOT,'fixtures/cad-acid/score-infrastructure');
function frozen(name) {
  const bytes=gunzipSync(fs.readFileSync(path.join(freeze,name)));
  const provenance=JSON.parse(fs.readFileSync(path.join(freeze,'provenance.json')));
  assert.equal(sha256(bytes),provenance.files.find(f=>f.file===name).sha256);
  return bytes;
}
// Replay is deliberately isolated from production admission. It tests numerical
// scoring of the original bytes, with recorded admission/consistency supplied by
// mocks. This is neither live execution nor permission to reuse a landing gate.
function replay(name) {
  const results=frozen(`${name}-results.json.gz`),board=frozen(`${name}-scoreboard.json.gz`);
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'acid-score-replay-'));
  try {
    fs.writeFileSync(path.join(tmp,'results.json'),results);fs.writeFileSync(path.join(tmp,'board.json'),board);
    const script=`import fs from 'node:fs';import {registerHooks} from 'node:module';import {pathToFileURL} from 'node:url';
      const root=${JSON.stringify(ROOT)},tmp=${JSON.stringify(tmp)};
      const {createHash}=await import('node:crypto');
      globalThis.replayErrata=JSON.parse(fs.readFileSync(root+'/fixtures/cad-acid/catalog-history/52771c0fae55085ad80858ee3ea4446b3b7117fa1929e1020b91b531d5f420cf.errata.json'));
      const results=JSON.parse(fs.readFileSync(tmp+'/results.json')),board=JSON.parse(fs.readFileSync(tmp+'/board.json'));
      if(createHash('sha256').update(JSON.stringify(globalThis.replayErrata)).digest('hex')!==board.errata.sha256)throw new Error('REPLAY_ERRATA_MISMATCH');
      globalThis.replayProof=row=>({status:row.kernel.startsWith('wonky-')?'live':'frozen',fixtures:board.verification.referenceFixtures[row.kernel]??{}});
      registerHooks({resolve(specifier,context,next){
        if(context.parentURL===pathToFileURL(root+'/scripts/acid/score.mjs').href){
          if(specifier==='./execution.mjs')return {shortCircuit:true,url:'data:text/javascript,'+encodeURIComponent('export * from '+JSON.stringify(pathToFileURL(root+'/scripts/acid/execution.mjs').href)+';export const executionEvidence=row=>globalThis.replayProof(row);')};
          if(specifier==='./evidence.mjs')return {shortCircuit:true,url:'data:text/javascript,'+encodeURIComponent('export * from '+JSON.stringify(pathToFileURL(root+'/scripts/acid/evidence.mjs').href)+';export const verifyExactObservation=()=>({ok:true});')};
          if(specifier==='./common.mjs')return {shortCircuit:true,url:'data:text/javascript,'+encodeURIComponent('export * from '+JSON.stringify(pathToFileURL(root+'/scripts/acid/common.mjs').href)+';export const loadCatalog=()=>globalThis.replayCatalog;export const loadErrata=()=>globalThis.replayErrata;')};
        }return next(specifier,context);
      }});
      const {catalogBySha}=await import(pathToFileURL(root+'/scripts/acid/common.mjs'));
      const {score}=await import(pathToFileURL(root+'/scripts/acid/score.mjs'));
      // Replay the original catalog; extensions change report ordering and cells.
      const zonesSha256=results.zonesSha256,catalog=catalogBySha(zonesSha256);
      if(!catalog)throw new Error('REPLAY_CATALOG_MISSING: '+zonesSha256);
      globalThis.replayCatalog={catalog,zonesSha256};
      fs.writeFileSync(tmp+'/replayed.json',JSON.stringify(score(catalog,results,{zonesSha256}),null,2)+'\\n');`;
    const run=spawnSync(process.execPath,['--input-type=module','-e',script],{encoding:'utf8',env:{...process.env,NODE_OPTIONS:'--max-old-space-size=8192'}});
    if(run.stderr)process.stderr.write(run.stderr);
    assert.equal(run.status,0);
    return {original:board,replayed:fs.readFileSync(path.join(tmp,'replayed.json'))};
  }finally{fs.rmSync(tmp,{recursive:true,force:true});}
}
test('failed stored run changes only AC91 V0 numerical verdict',{skip: !process.getBuiltinModule('node:fs').existsSync(new URL('../fixtures/cad-acid/score-infrastructure/provenance.json', import.meta.url)) && 'local-only fixture: frozen replay inputs keep their original evidence paths'},()=>{
  const {original,replayed}=replay('failed'),before=JSON.parse(original),after=JSON.parse(replayed);
  const changed=[];
  for(let i=0;i<before.zones.length;i++)for(const v of Object.keys(before.zones[i].variants))
    if(JSON.stringify(before.zones[i].variants[v])!==JSON.stringify(after.zones[i].variants[v]))changed.push(`${before.zones[i].kernel}/${before.zones[i].zone}/${v}`);
  assert.deepEqual(changed,['wonky-rust/AC91/V0']);
  const cell=after.zones.find(z=>z.kernel==='wonky-rust'&&z.zone==='AC91');
  assert.equal(cell.status,'ERROR');assert.equal(cell.strictStatus,'ERROR');
  assert.deepEqual(cell.variants.V0,{status:'ERROR',reason:'observation infrastructure: STEP measurement did not complete (spawnSync uv ETIMEDOUT)',strictStatus:'ERROR'});
  assert.equal(after.kernels['wonky-rust'].counts.CORRECT,before.kernels['wonky-rust'].counts.CORRECT);
  assert.equal(after.kernels['wonky-rust'].counts.WRONG,0);assert.equal(after.kernels['wonky-rust'].counts.ERROR,1);
  for(let i=0;i<before.zones.length;i++)if(before.zones[i].kernel!=='wonky-rust'||before.zones[i].zone!=='AC91')assert.deepEqual(after.zones[i],before.zones[i]);
});
test('latest main landed completed run replays to a byte-identical scoreboard',{skip: !process.getBuiltinModule('node:fs').existsSync(new URL('../fixtures/cad-acid/score-infrastructure/provenance.json', import.meta.url)) && 'local-only fixture: frozen replay inputs keep their original evidence paths'},()=>{
  const {original,replayed}=replay('landed');assert.deepEqual(replayed,original);
});
