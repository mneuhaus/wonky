import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {ROOT, loadCatalog, catalogBySha, sha256, twinSource} from '../scripts/acid/common.mjs';
import {scoreVariant} from '../scripts/acid/score.mjs';
import {assertPackageDelta,assertOwnZonesLive} from './helpers/catalog-delta.mjs';
process.env.WONKY_BACKEND='rust';
const {build}=await import('../src/index.mjs');
const {toStep}=await import('../src/exporters.mjs');
const {catalog}=loadCatalog(), zone=catalog.zones.find(z=>z.id==='AC115');
const python=path.join(ROOT,'out/build123d-performance/reference-venv/bin/python');

// Planted writer defect: replace one full ring by an out-and-back pair of
// periodic generator seam edges. Update BOTH incident loops, as a writer would.
// Merely splitting a circle into two smooth arcs is legal canonical topology;
// declaring its boundary to be two seam edges is not.
function splitRingIntoSeams(step) {
  const ring=step.match(/(#\d+)=EDGE_CURVE\('',(#\d+),\2,(#\d+),\.T\.\);/);
  assert(ring,'full ring');
  const seam=step.match(/(#\d+)=EDGE_CURVE\('',(#\d+),(#\d+),(#\d+),\.T\.\);\n/gs);
  const seamLine=seam.find(line=>{
    const geometry=line.match(/,(#\d+),\.T\.\);/)[1];
    return step.includes(`${geometry}=SEAM_CURVE(`);
  });
  assert(seamLine,'periodic generator');
  const [,a,b,curve]=seamLine.match(/EDGE_CURVE\('',(#\d+),(#\d+),(#\d+),/);
  let n=Math.max(...[...step.matchAll(/#(\d+)=/g)].map(m=>Number(m[1])));
  const second=`#${++n}`, additions=[`${second}=EDGE_CURVE('',${b},${a},${curve},.F.);`];
  let result=step.replace(ring[0],`${ring[1]}=EDGE_CURVE('',${a},${b},${curve},.T.);`);
  for(const use of [...step.matchAll(new RegExp(`(#\\d+)=ORIENTED_EDGE\\(''[,]*\\*,\\*,${ring[1]},(\\.[TF]\\.)\\);`,'g'))]) {
    const extra=`#${++n}`;
    additions.push(`${extra}=ORIENTED_EDGE('',*,*,${second},${use[2]});`);
    result=result.replace(/EDGE_LOOP\('',\(([^)]*)\)\)/g,(all,items)=>
      `EDGE_LOOP('',(${items.split(',').flatMap(id=>id===use[1]?(use[2]==='.T.'?[id,extra]:[extra,id]):[id]).join(',')}))`);
  }
  assert.equal(additions.length,3,'both adjacent loops mutated');
  return result.replace('\nENDSEC;\nEND-ISO',`\n${additions.join('\n')}\nENDSEC;\nEND-ISO`);
}

test('AC115 restoration preserves previous catalog bytes and every existing contract',()=>{
  const h=catalog.history.find(h=>h.version==='AC1-2026-10-02-AC115-roundtrip');
  const file=path.join(ROOT,'fixtures/cad-acid/catalog-history',`${h.previousSha256}.json`);
  assert.equal(sha256(fs.readFileSync(file)),h.previousSha256);
  // Restoration touched only AC115; later packages (CE9, ZW1, Z3) check their own deltas.
  const pkg=assertPackageDelta(catalog,h.version,{added:['AC115']});
  assert.deepEqual(pkg.after,catalogBySha('3e4f8229d0f01fc7814a3ae308f6da802a22eee81eac4a7dda656b578c30423b'));
  const planted=structuredClone(catalog);planted.zones.find(z=>z.id==='AC115').planted=true;
  assert.throws(()=>assertOwnZonesLive(planted,pkg),/AC115 undeclared later change/);
  assert.deepEqual(h.amendedZones,[]);
  const draft=catalogBySha('fa3a594e5f211ffb4ffe5a23d7993ea6f2114d30145f16d570792757280f6434').zones.find(z=>z.id==='AC115');
  const {twin,...contract}=zone;assert.deepEqual(contract,draft,'only source selection metadata is added');
  const frozen=JSON.parse(fs.readFileSync(path.join(ROOT,'fixtures/cad-acid/occt-ext/Z1/provenance.json')));
  for(const file of ['fixtures/cad-acid/fs/acid-boolean-z1.fs','fixtures/cad-acid/b3d/acid_boolean_z1.py']) {
    if(frozen.sources[file])assert.equal(sha256(fs.readFileSync(path.join(ROOT,file))),frozen.sources[file],file+' frozen twin preserved');
  }
});

test('live analytic ring survives binary64-preserving re-export; seam-split writer negative is rejected',{skip: !process.getBuiltinModule('node:fs').existsSync(new URL('../out/build123d-performance/reference-venv/bin/python', import.meta.url)) && 'REFERENCE_VENV_UNAVAILABLE: build123d/OCCT reference observer'},async()=>{
  assert(fs.existsSync(python),'reference observer is required');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'step-real-'));
  try {
    const source=fs.readFileSync(twinSource(catalog,catalog.groups.find(g=>g.id===zone.group),zone,'wonky-rust','V1'),'utf8');
    const model=await build(source,{feature:'acidBooleanZ1',parameters:{variant:'AcidVariant.V1',zone:'AcidBooleanZ1Zone.AC115'}});
    assert.equal(model.bodies.length,1);assert.equal(model.bodies[0].validation.closed,true);
    const step=toStep(model,'ring-roundtrip');
    assert.equal((step.match(/EDGE_CURVE\(/g)??[]).length,15);
    assert.equal((step.match(/VERTEX_POINT\(/g)??[]).length,10);
    assert.equal((step.match(/SEAM_CURVE\(/g)??[]).length,1);
    assert.equal((step.match(/EDGE_CURVE\('',(#\d+),\1,#\d+,\.T\.\)/g)??[]).length,2);
    fs.writeFileSync(path.join(dir,'original.step'),step);
    fs.writeFileSync(path.join(dir,'mutant.step'),splitRingIntoSeams(step));
    const code=`import sys,json
from pathlib import Path
sys.path.insert(0,sys.argv[1])
from measure import read_step,export_step,observe,measure
from OCP.STEPControl import STEPControl_Writer,STEPControl_AsIs
from OCP.IFSelect import IFSelect_RetDone
c=json.load(open(sys.argv[2]));z=next(z for z in c['zones'] if z['id']=='AC115');d=Path(sys.argv[3])
s=read_step(d/'original.step');first=observe(s,z,c,'V1',coordinate_resolution=1e-7)
w=STEPControl_Writer();assert w.Transfer(s,STEPControl_AsIs)==IFSelect_RetDone;assert w.Write(str(d/'legacy.step'))==IFSelect_RetDone
legacy=observe(read_step(d/'legacy.step'),z,c,'V1',coordinate_resolution=1e-7)
fixed=measure(d/'original.step',z,c,'V1')
(d/'observations.json').write_text(json.dumps({'first':first,'legacy':legacy,'fixed':fixed}))
`;
    const r=spawnSync(python,['-B','-c',code,path.join(ROOT,'scripts/acid'),path.join(ROOT,'fixtures/cad-acid/zones.json'),dir],{encoding:'utf8',timeout:180000,maxBuffer:1<<20});
    if(r.stderr)process.stderr.write(r.stderr);
    assert.equal(r.status,0,r.stdout+'\n'+r.stderr);
    const o=JSON.parse(fs.readFileSync(path.join(dir,'observations.json')));
    const topology=m=>['faces','edges','vertices','loops','ringEdges','genus'].map(k=>m.topology[k]);
    assert.deepEqual(topology(o.first),[7,14,8,10,2,1]);
    assert.deepEqual(topology(o.legacy),[7,16,10,8,0,1],'legacy decimal loss reproduces the defect');
    for(const metrics of [o.fixed.metrics,o.fixed.stepRoundTrip.metrics]) {
      assert.deepEqual(topology(metrics),[7,14,8,10,2,1]);
      assert.deepEqual(metrics.validity,{brep:true,closed:true,positive:true});
    }
    // This is a live independent OCCT observation of a wonky artifact, not an
    // execution receipt for wonky. Full live CAD-Acid supplies that separately.
    const row={variant:'V1',outcome:'built',nativeValidity:true,metrics:o.first,stepRoundTrip:o.fixed.stepRoundTrip};
    assert.equal(scoreVariant(catalog,zone,'occt',row).status,'CORRECT');
    // Run the corrupt artifact in the same separate observer process used by
    // CAD-Acid. OCCT may reject it geometrically or crash on the invalid seam.
    // Keep that distinction: a signal is infrastructure ERROR, never WRONG.
    const negative=spawnSync(python,['-B','scripts/acid/measure.py',path.join(dir,'mutant.step'),'--zone','AC115','--variant','V1','--out',path.join(dir,'mutant.json')],{cwd:ROOT,encoding:'utf8',timeout:30000,maxBuffer:1<<20});
    if(negative.stderr)process.stderr.write(negative.stderr);
    assert.ifError(negative.error);
    const measured=negative.status===0?JSON.parse(fs.readFileSync(path.join(dir,'mutant.json'))):null;
    const roundtrip=measured?{ok:true,metrics:measured.metrics,secondImport:measured.stepRoundTrip}:
      {ok:false,reason:'STEP_MEASUREMENT_FAILED',execution:{ok:false,status:negative.status,signal:negative.signal}};
    const verdict=scoreVariant(catalog,zone,'occt',{...row,stepRoundTrip:roundtrip});
    assert.equal(verdict.status,negative.signal?'ERROR':'WRONG','actual seam-split artifact must never pass');
    if(negative.signal)assert.match(verdict.reason,/observation infrastructure/);
    console.log(`Planted seam-split STEP rejected: ${verdict.status}; observer exit=${negative.status}, signal=${negative.signal}`);

  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
