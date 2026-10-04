import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {loadCatalog, catalogBySha, validateCatalog, zoneVariants} from '../scripts/acid/common.mjs';
const originalIds=['AC66','AC74','AC111','AC112','AC113','AC115','AC117'];
const ids=originalIds.filter(id=>!['AC115','AC117'].includes(id));
const withdrawn=catalogBySha('14f7a8f599a95253511234aebb294e135497947071dc8e57fd70b01eccf35b6f');
const {catalog}=loadCatalog();
// Historical Z1 preservation is bound to the exact catalog before CE9's later
// twin-metadata amendment; the CE9 test checks the entire current delta.
const beforeTwin=catalogBySha('3e4f8229d0f01fc7814a3ae308f6da802a22eee81eac4a7dda656b578c30423b');
const check=(c,only=ids)=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'z1-contract-'));
 try {
  const file=path.join(dir,'zones.json');fs.writeFileSync(file,JSON.stringify(c));
  return spawnSync('uv',['run','scripts/acid/closed-forms.py','--zones',file,'--only',only.join(',')],{encoding:'utf8',timeout:180000,maxBuffer:1<<20});
 } finally {fs.rmSync(dir,{recursive:true,force:true});}
};
test('Z1 is additive against its exact previous catalog and declares radius variants',()=>{
 const hVersion='AC1-2026-10-02-extZ1-boolean';
 const h=catalog.history.find(h=>h.version===hVersion);
 const before=catalogBySha(h.previousSha256);assert(before);
 assert.deepEqual(h.addedZones,ids);assert.deepEqual(withdrawn.history.find(h=>h.version===hVersion).addedZones,originalIds);assert.deepEqual(h.amendedZones,[]);
 const errata=catalog.history.find(h=>h.version==='AC1-2026-10-02-catalog-errata');
 const mergedMain=catalogBySha('b742021a3035026efd47da6ff70fb1da29daba22e2052ee85ef0bf05b4ac2062');
 const strandParent=catalogBySha('b30e7e99c28525f434cb443b4c3a4c38864bfe10933f4513067627b534473506');
 for(const z of before.zones){
  assert.deepEqual(strandParent.zones.find(n=>n.id===z.id),z,z.id+' original additive strand');
  assert.deepEqual(beforeTwin.zones.find(n=>n.id===z.id),errata.amendedZones.includes(z.id)?mergedMain.zones.find(n=>n.id===z.id):z,z.id);
 }
 for(const z of mergedMain.zones)assert.deepEqual(beforeTwin.zones.find(n=>n.id===z.id),z,z.id+' main preserved');
 for(const id of ids)assert.deepEqual(catalog.zones.find(n=>n.id===id),strandParent.zones.find(n=>n.id===id),id+' Z1 preserved');
 assert.doesNotThrow(()=>validateCatalog(catalog));
 for(const id of ids){const z=catalog.zones.find(z=>z.id===id);assert(zoneVariants(z).includes('V4'));assert(z.closedFormByVariant.V4);}
});
test('Z1 checker reproduces both routes, V4 and hand-derived topology',()=>{
 const r=check(catalog);assert.equal(r.status,0,r.stdout+'\n'+r.stderr);
});
test('Z1 planted parameter negatives fail construction checking',()=>{
 for(const [id,mutate,reason] of [
  ['AC113',p=>{p.profile[4][1]=-3;p.profile[5][1]=-3;},/profile binds construction/],
  ['AC111',p=>{p.frontCircleRationalPoint=true;},/no fabricated rational point/],
  ['AC112',p=>{p.unmodeledOffset=1;},/unbound:.*unmodeledOffset/]
 ]){
  const bad=structuredClone(catalog);mutate(bad.zones.find(z=>z.id===id).construction.params);
  const r=check(bad);assert.equal(r.status,1,r.stderr);assert.match(r.stdout,reason);
 }
});
test('AC115 radius-only topology transition cannot certify fabricated counts',()=>{
 const bad=structuredClone(withdrawn),z=bad.zones.find(z=>z.id==='AC115');
 z.closedFormByVariant.V4.topology=structuredClone(z.closedForm.topology);
 const r=check(bad,['AC115']);assert.equal(r.status,1,r.stderr);assert.match(r.stdout,/independently derived topology|transition matches independent/);
});

test('AC117 records the exact SI rim residual instead of claiming payload coincidence',()=>{
 const r=spawnSync('uv',['run','--no-project','--with','sympy==1.13.3','--with','mpmath==1.3.0','python','-c',
  'import sys;sys.path.insert(0,"scripts/acid");from z1_forms import rim_si_residual;assert rim_si_residual().numerator == -29975959119778023;assert rim_si_residual().denominator == 5316911983139663491615228241121378304'],{encoding:'utf8',timeout:30000});
 assert.equal(r.status,0,r.stdout+'\n'+r.stderr);
 const z=withdrawn.zones.find(z=>z.id==='AC117');assert.match(z.kernelNotes.wonkyRust,/NOT exactly coincident in SI/);
});

test('Z1 review withdrawals reserve both IDs and preserve the exact previous catalog',()=>{
 assert(withdrawn);
 const repair=catalog.history.find(h=>h.version==='AC1-2026-10-02-extZ1-review-repair');
 assert.deepEqual(repair.withdrawnZones,['AC115','AC117']);
 const restoration=catalog.history.find(h=>h.version==='AC1-2026-10-02-AC115-roundtrip');
 const repaired=catalogBySha(restoration.previousSha256);assert(repaired);
 assert.deepEqual(repaired.groups.find(g=>g.id==='boolean-z1').zoneIds,ids);
 for(const id of repair.withdrawnZones)assert(!repaired.zones.some(z=>z.id===id));
 assert(!catalog.zones.some(z=>z.id==='AC117'));
 assert.deepEqual(restoration.addedZones,['AC115']);
 assert.deepEqual(restoration.amendedZones,[]);
 for(const z of repaired.zones)assert.deepEqual(beforeTwin.zones.find(n=>n.id===z.id),z,z.id+' restoration preserves existing contracts');
 for(const id of ids)assert.deepEqual(catalog.zones.find(z=>z.id===id),withdrawn.zones.find(z=>z.id===id),id);
 const r=check(withdrawn,['AC115','AC117']);assert.equal(r.status,0,r.stdout+'\n'+r.stderr);
 const v4=catalog.zones.find(z=>z.id==='AC113').closedFormByVariant.V4;
 assert(v4.volume.value.startsWith('4309.4044057476274534'));
 assert(v4.area.value.startsWith('2083.7494929757582582'));
 assert.match(repair.note,/independently re-derived blind on 2026-10-02, agreement to 20 digits/);
});
