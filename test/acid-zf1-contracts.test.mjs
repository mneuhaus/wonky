import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {ROOT,loadCatalog,validateCatalog} from '../scripts/acid/common.mjs';
import {assertPackageDelta,assertOwnZonesLive,assertScopedChange} from './helpers/catalog-delta.mjs';
const ids=Array.from({length:6},(_,i)=>`AC${118+i}`);
test('ZF1 changes only its own zones against its exact previous catalog',()=>{
 const {catalog}=loadCatalog();
 const pkg=assertPackageDelta(catalog,'AC1-2026-10-02-extZF1-fillet',{added:ids});
 assert.deepEqual(pkg.after.groups.find(g=>g.id==='fillet-zf1').zoneIds,ids);
 // An undeclared edit of a ZF1 zone fails; later packages touching other zones do not.
 const planted=structuredClone(catalog);planted.zones.find(z=>z.id==='AC122').construction.params.radius=0.9;
 assert.throws(()=>assertOwnZonesLive(planted,pkg),/AC122 undeclared later change/);
 const later=structuredClone(catalog);later.zones.find(z=>z.id==='AC01').planted=true;
 later.zones.push({...structuredClone(later.zones.find(z=>z.id==='AC118')),id:'AC999'});
 assert.doesNotThrow(()=>assertOwnZonesLive(later,pkg));
 const outside=structuredClone(pkg.after);outside.zones.find(z=>z.id==='AC115').planted=true;
 assert.throws(()=>assertScopedChange(pkg.base,outside,pkg.entry),/AC115 outside scope/);
});
test('ZF1 frozen contracts reproduce both routes and reject radius/placement premise mutations',async t=>{
 const {catalog}=loadCatalog();validateCatalog(catalog);
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'acid-zf1-'));
 const run=(c,disablePremises=false)=>{
  const p=path.join(tmp,'zones.json');fs.writeFileSync(p,JSON.stringify(c));
  const args=disablePremises
   ? ['run','--with','sympy==1.13.3','--with','mpmath==1.3.0','python','-c',
      "import sys,runpy;sys.path.insert(0,'scripts/acid');import zf1_forms;zf1_forms.premises=lambda z,p:[];sys.argv=['closed-forms.py',*sys.argv[1:]];runpy.run_path('scripts/acid/closed-forms.py',run_name='__main__')"]
   : ['run','scripts/acid/closed-forms.py'];
  const r=spawnSync('uv',[...args,'--zones',p,'--only',ids.join(',')],{cwd:ROOT,encoding:'utf8',timeout:120000});
  if(r.stderr)process.stderr.write(r.stderr);return r;
 };
 try{
  const good=run(catalog);assert.equal(good.status,0,good.stdout);
  assert.match(good.stdout,/single-route V3 bbox checks 0/);
  for(const id of ids)await t.test(`${id} stale radius`,()=>{
   const mutant=structuredClone(catalog);const z=mutant.zones.find(z=>z.id===id);
   z.construction.params.radius=0.9;
   const bad=run(mutant);assert.notEqual(bad.status,0,`${id}: stale radius contract accepted`);
   assert.match(bad.stdout,/FAIL/);
  });
  await t.test('oblique corner premise',()=>{
  const corner=structuredClone(catalog);
  const construction=corner.zones.find(z=>z.id==='AC122').construction;
  // Keep the V4 relation valid so only the geometric premise can reject this mutant.
  construction.params.angle='pi/2';
  construction.paramsByVariant.V4.angle='pi/2';
  const bad=run(corner);
  assert.notEqual(bad.status,0,'orthogonal substitute must fail the construction premise');
  assert.match(bad.stdout,/FAIL[^\n]*angle construction binding/,
   'the consistent mutant must exercise the named premise, not the V4 radius relation');
  const unguarded=run(corner,true);
  assert.equal(unguarded.status,0,unguarded.stdout);
  });
 }finally{fs.rmSync(tmp,{recursive:true,force:true});}
});

test('ZF1 real OCCT chamfers validate propagation and apex boundaries across profiles and frames',{skip: !process.getBuiltinModule('node:fs').existsSync(new URL('../out/build123d-performance/reference-venv/bin/python', import.meta.url)) && 'REFERENCE_VENV_UNAVAILABLE: build123d/OCCT reference observer'},()=>{
 const python=path.join(ROOT,'out/build123d-performance/reference-venv/bin/python');
 const r=spawnSync(python,['test/acid-zf1-oracle.py'],{cwd:ROOT,encoding:'utf8',timeout:120000});
 if(r.stderr)process.stderr.write(r.stderr);
 assert.equal(r.status,0,r.error?.message??r.stdout+r.stderr);
});
