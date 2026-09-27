import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {ROOT,loadCatalog,VARIANTS,validateCatalog,verifyFrozenReference,sha256,readJSON} from '../scripts/acid/common.mjs';
import {score,scoreVariant} from '../scripts/acid/score.mjs';
import {artifactHashes,codeIdentity,observationProbes,verifyExactObservation} from '../scripts/acid/evidence.mjs';
import {callPlan,assertBridge} from '../scripts/acid/onshape-push.mjs';
const {catalog,zonesSha256}=loadCatalog();
const noErrata={schema:'wonky/cad-acid-errata/1',zonesSha256,entries:[]};
// Independent elementary L-prism observations, not values copied by the scorer.
// Deliberately synthetic: exercise score decisions, not claim a live kernel pass.
function observations() {
  return {zonesSha256,rows:VARIANTS.map(variant=>{
    const cf=catalog.zones.find(z=>z.id==='AC01');
    const metrics={volume:768,area:640,bodies:[{volume:768,centroid:[6,4,4]}],
      topology:{bodies:1,shells:1,faces:8,edges:18,vertices:12,genus:0,singularPoints:0},
      bbox:structuredClone(cf.closedForm.bbox.variants[variant]),measurements:{probe_notch:6,probe_far:4},
      validity:{brep:true,closed:true,positive:true}};
    return {kernel:'occt',zone:'AC01',variant,outcome:'built',nativeValidity:true,metrics,stepRoundTrip:{ok:true,metrics:structuredClone(metrics)}};
  })};
}
const REFERENCE_PYTHON=path.join(ROOT,'out/build123d-performance/reference-venv/bin/python');
const verdict=r=>score(catalog,r,{zonesSha256}).zones.find(z=>z.kernel==='occt'&&z.zone==='AC01');
test('frozen catalog schema and grid exclude unintended inter-zone contact in every variant',()=>{
  assert.doesNotThrow(()=>validateCatalog(catalog));
  const overlap=structuredClone(catalog);overlap.zones[1].cell=structuredClone(overlap.zones[0].cell);
  assert.throws(()=>validateCatalog(overlap),/GRID_INTERACTION/);
  const duplicate=structuredClone(catalog);duplicate.zones[1].id=duplicate.zones[0].id;
  assert.throws(()=>validateCatalog(duplicate),/duplicate zone/);
});
test('all-refuse capability kernel earns zero, including refusal-expected zones',()=>{
  const result={zonesSha256,rows:catalog.zones.flatMap(z=>VARIANTS.map(variant=>({kernel:'wonky-rust',zone:z.id,variant,outcome:'refused',
    refusal:{name:'UnsupportedFeatureError',category:z.expected.outcomes.find(o=>o.kind==='refusal')?.refusalCategory??'capability',capability:true,operationUnderTest:true}})))};
  const scored=score(catalog,result,{zonesSha256});
  assert.equal(scored.kernels['wonky-rust'].score,0);assert.equal(scored.kernels['wonky-rust'].WRONG,0);
  assert(scored.zones.filter(z=>z.kernel==='wonky-rust').every(z=>['UNVERIFIED','DISPUTED'].includes(z.status)));
});
test('geometry baseline passes and planted semantic/validity defects cannot earn a point',()=>{
  const baseline=observations(),zone=catalog.zones.find(z=>z.id==='AC01');
  for(const row of baseline.rows)assert.equal(scoreVariant(catalog,zone,'occt',row).status,'CORRECT','numerical baseline, not a reference claim');
  assert.equal(verdict(baseline).status,'UNVERIFIED');assert.equal(verdict(baseline).points,0);
  const cases=[
    ['volume error 1e-3',r=>r.rows[0].metrics.volume*=1.001,'WRONG',/volume/],
    ['missing body',r=>r.rows[0].metrics.bodies=[],'WRONG',/body count/],
    ['named capability refusal',r=>Object.assign(r.rows[0],{outcome:'refused',refusal:{name:'UnsupportedFeatureError',capability:true,category:'capability'}}),'REFUSED',null],
    ['silently skipped V3',r=>r.rows.pop(),'NOT_RUN',null],
    ['invalid body',r=>r.rows[0].metrics.validity.brep=false,'WRONG',/BRepCheck/],
    ['round-trip lost notch',r=>r.rows[0].stepRoundTrip.metrics.measurements.probe_notch=0,'WRONG',/round trip/],
    ['missing canonical count',r=>delete r.rows[0].metrics.topology.genus,'WRONG',/genus/],
    ['missing independent measurement',r=>delete r.rows[0].metrics.measurements.probe_far,'WRONG',/probe_far/],
  ];
  for(const [name,mutate,expected,reason] of cases){const r=observations();mutate(r);const v=verdict(r);assert.equal(v.status,expected,name);assert.equal(v.points,0,name);if(reason)assert.match(v.variants.V0.reason,reason,name);}
});
test('v1 refusal classification needs actual under-test category, not a crash or unrelated failure',()=>{
  const make=refusal=>({zonesSha256,rows:VARIANTS.map(variant=>({kernel:'occt',zone:'AC31',variant,outcome:'refused',refusal}))});
  const good={name:'BlendInfeasible',category:'infeasible-blend',capability:false,operationUnderTest:true};
  const v=r=>score(catalog,r,{zonesSha256,errata:noErrata}).zones.find(z=>z.kernel==='occt'&&z.zone==='AC31');
  const zone=catalog.zones.find(z=>z.id==='AC31');
  const acceptedRefusal=scoreVariant(catalog,zone,'occt',make(good).rows[0],null,{errata:noErrata});
  assert.equal(acceptedRefusal.status,'CORRECT');
  assert.equal(acceptedRefusal.strictStatus,'REFUSED_EXPECTED');
  assert.equal(acceptedRefusal.expectedRefusal,true);
  assert.equal(v(make(good)).status,'UNVERIFIED');assert.equal(v(make(good)).points,0);
  assert.equal(v(make({...good,operationUnderTest:false})).points,0);
  assert.equal(v(make({...good,category:'empty-result'})).points,0);
  assert.equal(v(make({...good,name:null})).status,'ERROR');
});
test('unavailable Rust and absent variants stay in denominator; stale references refuse by name',()=>{
  const s=score(catalog,{zonesSha256,rows:[]},{zonesSha256});
  assert.equal(s.kernels['wonky-rust'].score,0);assert.equal(s.kernels['wonky-rust'].total,catalog.zones.length);
  assert.equal(s.kernels['wonky-rust'].counts.NOT_RUN+s.kernels['wonky-rust'].counts.DISPUTED,catalog.zones.length);
  assert.throws(()=>score(catalog,{zonesSha256:'0'.repeat(64),rows:[]},{zonesSha256}),{name:'REFERENCE_ZONES_SHA_MISMATCH'});
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'acid-reference-'));
  try{fs.writeFileSync(path.join(dir,'provenance.json'),JSON.stringify({zonesSha256:'0'.repeat(64)}));assert.throws(()=>verifyFrozenReference(dir,zonesSha256),{name:'REFERENCE_ZONES_SHA_MISMATCH'});}finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('dry-run CLI performs no network requests and reserves scarce endpoint pots',()=>{
  const plan=callPlan(catalog);assert.equal(plan.constraints.features_get,0);assert.equal(plan.constraints.fs_eval,0);
  assert(plan.constraints.features_get_max<=4);
  assert.throws(()=>assertBridge('https://cad.onshape.com'),/BRIDGE_BASE_REFUSED/);
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'acid-no-network-'));
  try {
    const preload=path.join(dir,'deny-network.mjs');
    fs.writeFileSync(preload,`import net from 'node:net';import {syncBuiltinESMExports} from 'node:module';globalThis.fetch=()=>{throw new Error('NETWORK_FORBIDDEN')};net.Socket.prototype.connect=()=>{throw new Error('NETWORK_FORBIDDEN')};syncBuiltinESMExports();`);
    const run=spawnSync(process.execPath,['--import',preload,path.join(ROOT,'scripts/acid/onshape-push.mjs')],{encoding:'utf8',env:{...process.env,NODE_OPTIONS:'--max-old-space-size=8192'}});
    assert.equal(run.status,0,run.stderr);assert.equal(JSON.parse(run.stdout).networkRequests,0);
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
test('second STEP re-import is scored, not just the first export/import',()=>{
  const r=observations();
  r.rows[0].stepRoundTrip.secondImport={ok:true,metrics:structuredClone(r.rows[0].metrics)};
  r.rows[0].stepRoundTrip.secondImport.metrics.topology.faces=6;
  assert.equal(verdict(r).status,'WRONG');
});
test('independent OCCT observer measures primitive topology and genuine empty STEP round trip',t=>{
  if(!fs.existsSync(REFERENCE_PYTHON)){t.skip('REFERENCE_VENV_UNAVAILABLE: no live OCCT observer claim');return;}
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'acid-occt-'));
  try {
    const output=path.join(dir,'observed.json');
    const code=`import sys,json\nfrom pathlib import Path\nsys.path.insert(0,sys.argv[1])\nfrom measure import canonical,export_step,read_step,props\nfrom OCP.BRepPrimAPI import BRepPrimAPI_MakeBox,BRepPrimAPI_MakeCylinder,BRepPrimAPI_MakeCone,BRepPrimAPI_MakeTorus\nfrom OCP.BRep import BRep_Builder\nfrom OCP.TopoDS import TopoDS_Compound\ns=TopoDS_Compound();BRep_Builder().MakeCompound(s)\nshapes=[BRepPrimAPI_MakeBox(4,5,6).Shape(),BRepPrimAPI_MakeCylinder(4,8).Shape(),BRepPrimAPI_MakeCone(4,0,8).Shape(),BRepPrimAPI_MakeTorus(8,2).Shape(),s]\nrows=[]\nfor i,shape in enumerate(shapes):\n p=Path(sys.argv[2])/f'{i}.step';export_step(shape,p);r=read_step(p);rows.append({'topology':canonical(r)[0],'volume':props(r)['volume']})\nPath(sys.argv[3]).write_text(json.dumps(rows))\n`;
    const run=spawnSync('uv',['run','--no-project',REFERENCE_PYTHON,'-B','-c',code,path.join(ROOT,'scripts/acid'),dir,output],{encoding:'utf8',timeout:60000,maxBuffer:1<<20});
    assert.equal(run.status,0,run.stderr);
    const rows=JSON.parse(fs.readFileSync(output));
    const fields=['bodies','faces','edges','vertices','genus','singularPoints'];
    assert.deepEqual(rows.map(r=>fields.map(k=>r.topology[k])),[[1,6,12,8,0,0],[1,3,2,0,0,0],[1,2,1,0,0,1],[1,1,0,0,1,0],[0,0,0,0,0,0]]);
    assert(Math.abs(rows[0].volume-120)<1e-8);
    assert(Math.abs(rows[1].volume-128*Math.PI)<1e-6);
    assert.equal(rows[4].volume,0);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('curved b3d twin Booleans equal the build123d fuse/cut/intersect their b3dFeatures name',t=>{
  // The twin runs its own serial Boolean + clean(); build123d's named operations are the spec (CE3, AC19).
  if(!fs.existsSync(REFERENCE_PYTHON)){t.skip('REFERENCE_VENV_UNAVAILABLE: no live OCCT claim');return;}
  const zones=catalog.zones.filter(z=>z.group==='curved'&&z.b3dFeatures.some(f=>['fuse','cut','intersect'].includes(f))).map(z=>z.id);
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'acid-curved-'));
  try {
    const output=path.join(dir,'observed.json');
    const code=`import importlib.util, json, sys
from pathlib import Path
sys.path.insert(0, sys.argv[1])
from measure import canonical, props
from OCP.BRepCheck import BRepCheck_Analyzer
from build123d import Compound
spec = importlib.util.spec_from_file_location("acid_curved", sys.argv[2])
twin = importlib.util.module_from_spec(spec)
sys.modules["acid_curved"] = twin
spec.loader.exec_module(twin)
def observe(solids):
    c = Compound(list(solids)).wrapped
    t = canonical(c)[0]
    return {"topology": [t[k] for k in ("bodies", "shells", "faces", "edges", "vertices", "genus")], "volume": props(c)["volume"], "valid": BRepCheck_Analyzer(c).IsValid()}
names = {"BRepAlgoAPI_Common": "intersect", "BRepAlgoAPI_Fuse": "fuse", "BRepAlgoAPI_Cut": "cut"}
own, calls, rows = twin._boolean, [], []
def named(operation, left, right):
    calls.append(operation.__name__)
    return getattr(left, names[operation.__name__])(right)
for zone in sys.argv[4].split(","):
    for variant in ("V0", "V1", "V2", "V3"):
        twin._boolean = own
        mine = observe(twin.build_zone(zone, variant))
        calls.clear()
        twin._boolean = named
        rows.append({"zone": zone, "variant": variant, "twin": mine, "named": observe(twin.build_zone(zone, variant)), "calls": list(calls)})
Path(sys.argv[3]).write_text(json.dumps(rows))
`;
    const run=spawnSync('uv',['run','--no-project',REFERENCE_PYTHON,'-B','-c',code,path.join(ROOT,'scripts/acid'),path.join(ROOT,'fixtures/cad-acid/b3d/acid_curved.py'),output,zones.join(',')],{encoding:'utf8',timeout:120000,maxBuffer:1<<22});
    assert.equal(run.status,0,run.stderr);
    const rows=JSON.parse(fs.readFileSync(output));
    assert.equal(rows.length,zones.length*VARIANTS.length);
    for(const r of rows) {
      const at=`${r.zone} ${r.variant}`;
      assert.equal(r.calls.length,1,`${at}: the named operation replaced the twin's Boolean`);
      assert.deepEqual(r.twin.topology,r.named.topology,at);
      assert.equal(r.twin.valid,r.named.valid,at);
      assert(Math.abs(r.twin.volume-r.named.volume)<=1e-9*Math.abs(r.named.volume),at);
    }
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
test('observer merges smooth edge splits only within OCCT angular resolution 1e-12 (AC20 V3 kink stays split)',t=>{
  // AC20 V3 re-imports its quartic as edges with tangent kinks of sin 1.4e-11..2.9e-11 (CE2).
  // Loosening this rule would erase that WRONG by observer, not by kernel.
  if(!fs.existsSync(REFERENCE_PYTHON)){t.skip('REFERENCE_VENV_UNAVAILABLE: no live OCCT observer claim');return;}
  const code=`import sys, json
sys.path.insert(0, sys.argv[1])
from measure import canonical
from OCP.BRepBuilderAPI import BRepBuilderAPI_MakePolygon, BRepBuilderAPI_MakeFace
from OCP.gp import gp_Pnt
rows = []
for sine in (1e-11, 1e-13):
    poly = BRepBuilderAPI_MakePolygon()
    for x, y in ((0, 0), (5, 2.5 * sine), (10, 0), (10, 4), (0, 4)):
        poly.Add(gp_Pnt(x, y, 0))
    poly.Close()
    topology = canonical(BRepBuilderAPI_MakeFace(poly.Wire(), True).Face())[0]
    rows.append([topology["edges"], topology["vertices"]])
print(json.dumps(rows))
`;
  const run=spawnSync('uv',['run','--no-project',REFERENCE_PYTHON,'-B','-c',code,path.join(ROOT,'scripts/acid')],{encoding:'utf8',timeout:60000,maxBuffer:1<<20});
  assert.equal(run.status,0,run.stderr);
  // Kink of sin 1e-11: two edges and the split vertex remain. Kink of sin 1e-13: one edge.
  assert.deepEqual(JSON.parse(run.stdout),[[5,5],[4,4]]);
});
test('individually in-band variants still fail when their invariants disagree',()=>{
  const r=observations();
  r.rows[0].metrics.volume=768*(1-0.75e-6);
  r.rows[1].metrics.volume=768*(1+0.75e-6);
  const v=verdict(r);assert.equal(v.status,'WRONG');assert(v.reasons.some(s=>s.includes('metamorphic')));
});
test('tolerance-only merged gap is forbidden for exact kernels and branch drift is WRONG',()=>{
  const z=catalog.zones.find(z=>z.id==='AC39');
  const build=(variant,merged,kernel='occt')=>{
    const cf=merged?z.expected.outcomes.find(o=>o.id==='G1').closedForm:z.closedForm;
    const local=cf.bbox.variants[variant];
    const metrics={volume:256,area:merged?288:320,bodies:Array.from({length:merged?1:2},()=>({volume:merged?256:128,centroid:[0,0,0]})),
      topology:{bodies:merged?1:2,shells:merged?1:2,faces:merged?6:12,edges:merged?12:24,vertices:merged?8:16,genus:0,singularPoints:0},
      bbox:{min:local.min.map((x,i)=>x+z.cell.originMm[i]),max:local.max.map((x,i)=>x+z.cell.originMm[i])},
      measurements:{gap:0},validity:{brep:true,closed:true,positive:true}};
    return {kernel,zone:z.id,variant,outcome:'built',nativeValidity:true,metrics,stepRoundTrip:{ok:true,metrics:structuredClone(metrics)}};
  };
  const get=(rows,k='occt')=>score(catalog,{zonesSha256,rows},{zonesSha256}).zones.find(v=>v.zone===z.id&&v.kernel===k);
  assert.equal(scoreVariant(catalog,z,'occt',build('V0',true)).status,'CORRECT','numerical tolerance branch');
  assert.equal(get(VARIANTS.map(v=>build(v,true))).status,'UNVERIFIED');
  assert.equal(get(VARIANTS.map(v=>build(v,true,'wonky-rust')),'wonky-rust').status,'UNVERIFIED');
  const mixed=get(VARIANTS.map(v=>build(v,v!=='V3')));
  assert.equal(mixed.status,'WRONG');assert(mixed.reasons.some(s=>s.includes('branch')));
});
test('a tolerance STEP observation cannot self-certify an exact kernel',()=>{
  const r=observations();r.rows.forEach(row=>row.kernel='wonky-rust');
  const s=score(catalog,r,{zonesSha256}).zones.find(z=>z.zone==='AC01'&&z.kernel==='wonky-rust');
  assert.equal(s.points,0);assert.equal(s.status,'UNVERIFIED');
  assert.match(s.variants.V0.reason,/LIVE_EXECUTION_REQUIRED/);
});
test('twin agreement pairs equal-volume pattern bodies by position, not by volume noise',()=>{
  // AC08: four equal cylinders; last-bit volume noise must not permute the comparison.
  const centres=[[1492,0,2],[1508,0,2],[1500,-8,2],[1500,8,2]];
  const row=(kernel,order,noise)=>({kernel,zone:'AC08',variant:'V0',outcome:'built',metrics:{volume:4*16*Math.PI,area:1,bbox:null,
    bodies:order.map((c,i)=>({volume:16*Math.PI*(1+noise*i),centroid:centres[c]})),topology:{},measurements:{probe_origin:6,probe_between:6}}});
  const pair=rows=>score(catalog,{zonesSha256,rows},{zonesSha256}).twinAgreement.find(t=>t.zone==='AC08'&&t.variant==='V0'&&t.pair==='onshape-FS / occt-b3d');
  assert.equal(pair([row('occt',[2,3,0,1],1e-15),row('onshape',[0,1,2,3],1e-15)]).status,'AGREE');
  const moved=row('onshape',[0,1,2,3],0);moved.metrics.bodies[3].centroid=[1500,9,2];
  const differ=pair([row('occt',[0,1,2,3],0),moved]);
  assert.equal(differ.status,'DIFFER');assert(differ.reasons.some(s=>/centroid/.test(s)));
});
test('an OCCT body reaches v1 refusal-only scoring as WRONG, not ERROR (CE8 supersedes v1)',t=>{
  if(!fs.existsSync(REFERENCE_PYTHON)){t.skip('REFERENCE_VENV_UNAVAILABLE: no live OCCT claim');return;}
  // Planted v1-contract mismatch: 1 mm radius guarantees OCCT returns a body; no AC31 infeasibility claim.
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'acid-ac31-'));
  try {
    const twin=path.join(ROOT,'fixtures/cad-acid/b3d/acid_blend.py'),source=path.join(dir,'ac31_feasible.py'),out=path.join(dir,'out');
    fs.writeFileSync(source,`import copy, importlib.util, sys
spec = importlib.util.spec_from_file_location("acid_blend", ${JSON.stringify(twin)})
twin = importlib.util.module_from_spec(spec)
sys.modules["acid_blend"] = twin
spec.loader.exec_module(twin)
zone = copy.deepcopy(twin.ZONES["AC31"])
zone["construction"]["params"]["radius"] = 1.0
twin.ZONES["AC31"] = zone
build = twin.build
`);
    const catalogFile=path.join(ROOT,'fixtures/cad-acid/zones.json'),request=path.join(dir,'request.json');
    fs.writeFileSync(request,JSON.stringify({source,sourceSha256:sha256(fs.readFileSync(source)),zonesSha256,zone:'AC31',variant:'V0',out,catalog:catalogFile}));
    const run=spawnSync('uv',['run','--no-project',REFERENCE_PYTHON,'-B',path.join(ROOT,'scripts/acid/build-occt.py'),request],{encoding:'utf8',timeout:120000,maxBuffer:1<<22});
    assert.equal(run.status,0,run.stderr);
    const row={kernel:'occt',zone:'AC31',variant:'V0',...readJSON(path.join(out,'build.json'))};
    assert.equal(row.outcome,'built',JSON.stringify(row.error));
    const v=scoreVariant(catalog,catalog.zones.find(z=>z.id==='AC31'),'occt',row,null,{errata:noErrata});
    assert.equal(v.status,'WRONG');assert.match(v.reason,/only a named refusal/);
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});

// Integrity regressions own the real scorer/merge CLI/build lifecycle. No test-only
// production hooks: the export failure is a real filesystem failure after build.
test('F1: bare exact-basis forged empty AC13 rows cannot earn a point',()=>{
  const metrics={basis:'native-f64-construction',volume:0,area:0,bodies:[],bbox:null,measurements:{},
    topology:{bodies:0,shells:0,faces:0,edges:0,vertices:0,genus:0,singularPoints:0},validity:{brep:true,closed:true,positive:true}};
  const rows=VARIANTS.map(variant=>({kernel:'wonky-rust',zone:'AC13',variant,outcome:'built',nativeValidity:true,metrics,stepRoundTrip:{ok:true,metrics}}));
  const v=score(catalog,{zonesSha256,rows},{zonesSha256}).zones.find(z=>z.kernel==='wonky-rust'&&z.zone==='AC13');
  assert.equal(v.status,'UNVERIFIED');assert.equal(v.points,0);
});
test('F2: native construction binding is required; requested-kernel exit ignores frozen neighbours',{skip: !fs.existsSync(REFERENCE_PYTHON) && 'REFERENCE_VENV_UNAVAILABLE: frozen STEP observer integration'},async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'acid-binding-'));
  try {
    const run=spawnSync(process.execPath,[path.join(ROOT,'scripts/acid/run.mjs'),'--out',dir,'--kernels','wonky-rust','--zones','AC01','--variants','V0','--no-smoke','--json-only'],
      {cwd:ROOT,encoding:'utf8',timeout:120000,maxBuffer:1<<22,env:{...process.env,WONKY_BACKEND:'rust',NODE_OPTIONS:'--max-old-space-size=8192'}});
    const results=readJSON(path.join(dir,'results.json')),row=results.rows.find(r=>r.kernel==='wonky-rust');
    const zone=catalog.zones.find(z=>z.id==='AC01');
    assert.equal(row.outcome,'built',row.reason??row.error?.message);
    assert.equal(readJSON(path.join(dir,'scoreboard.json')).zones.find(z=>z.kernel==='wonky-rust'&&z.zone==='AC01').variants.V0.status,'CORRECT','unmodified live positive control');
    assert.equal(verifyExactObservation(zone,row).ok,true);
    await t.test('F2: a body not bound to construction is UNVERIFIED',()=>{
      const planted=structuredClone(row);planted.nativeObservation.bodies[0].boundToConstruction=false;
      const v=verifyExactObservation(zone,planted);
      assert.equal(v.ok,false);assert.match(v.reason,/construction/i);
    });
    await t.test('F1/F2: native coverage and artifact integrity fail closed',()=>{
      for(const [mutate,reason] of [
        [r=>r.nativeObservation.bodies[0].probes.pop(),/probe coverage/],
        [r=>r.nativeObservation.bodies[0].probes[0].refused='unavailable',/native response/],
        [r=>r.backend.sourceHash='0'.repeat(64),/sourceHash/],
        [r=>r.bodies.push({...r.bodies[0],id:'unobserved'}),/body coverage/],
        [r=>delete r.artifactHashes['model.step'],/artifact hash missing/],
        [r=>r.metrics={...r.metrics,observer:'forged'},/scored metrics/],
      ]) {const planted=structuredClone(row);mutate(planted);const v=verifyExactObservation(zone,planted);assert.equal(v.ok,false);assert.match(v.reason,reason);}
      const brep=path.resolve(ROOT,row.artifacts,'model.brep.json'),original=fs.readFileSync(brep);
      fs.appendFileSync(brep,' ');
      const changed=verifyExactObservation(zone,row);assert.equal(changed.ok,false);assert.match(changed.reason,/artifact hash mismatch/);
      fs.writeFileSync(brep,original);
      // A standalone score must recheck disk, not reuse run.mjs's evidence flag.
      const unavailable={...results,rows:[{...row,artifacts:path.join(dir,'absent')}]},input=path.join(dir,'unavailable.json');
      fs.writeFileSync(input,JSON.stringify(unavailable));
      const cli=spawnSync(process.execPath,[path.join(ROOT,'scripts/acid/score.mjs'),input,path.join(dir,'rescored'),'--json-only'],{encoding:'utf8'});
      const report=readJSON(path.join(dir,'rescored/scoreboard.json'));
      assert.equal(report.verification.status,'UNVERIFIED');assert.equal(report.kernels['wonky-rust'].score,0);assert.notEqual(cli.status,0);
    });
    await t.test('requested-kernel CLI exit',()=>assert.equal(run.status,0,run.stderr));
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
test('F3: merge refuses distinct dirty code identities even at the same HEAD',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'acid-merge-'));
  try {
    for(const [i,hash] of ['a','b'].entries()){
      const p=path.join(dir,String(i));fs.mkdirSync(p);
      fs.writeFileSync(path.join(p,'results.json'),JSON.stringify({schema:'wonky/cad-acid-results/1',zonesSha256,sources:{},code:{head:'same',treeSha256:hash.repeat(64)},finishedAt:'2026-09-26',closedForms:{ok:true},rows:[],smoke:[]}));
    }
    const r=spawnSync(process.execPath,[path.join(ROOT,'scripts/acid/merge-results.mjs'),path.join(dir,'merged'),path.join(dir,'0'),path.join(dir,'1')],{encoding:'utf8'});
    assert.notEqual(r.status,0);assert.match(r.stderr,/CODE_IDENTITY_MISMATCH/);assert(!fs.existsSync(path.join(dir,'merged/results.json')));
    const first=readJSON(path.join(dir,'0/results.json')),second=readJSON(path.join(dir,'1/results.json'));
    second.code=first.code;
    for(const [batch,variant] of [[first,'V0'],[second,'V1']])batch.rows=[{kernel:'wonky-rust',zone:'AC01',variant,outcome:'refused',code:batch.code,backend:{sourceHash:'c'.repeat(64)}}];
    const write=()=>{fs.writeFileSync(path.join(dir,'0/results.json'),JSON.stringify(first));fs.writeFileSync(path.join(dir,'1/results.json'),JSON.stringify(second));};
    const merge=()=>spawnSync(process.execPath,[path.join(ROOT,'scripts/acid/merge-results.mjs'),path.join(dir,'merged'),path.join(dir,'0'),path.join(dir,'1')],{encoding:'utf8'});
    write();assert.equal(merge().status,0,'same identity positive control');assert.equal(readJSON(path.join(dir,'merged/results.json')).rows.length,2);
    second.rows[0].backend.sourceHash='d'.repeat(64);write();const mixed=merge();assert.notEqual(mixed.status,0);assert.match(mixed.stderr,/BACKEND_IDENTITY_MISMATCH/);
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
test('F4: a real export failure stays built and is WRONG only after live execution',{skip: !fs.existsSync(REFERENCE_PYTHON) && 'REFERENCE_VENV_UNAVAILABLE: frozen STEP observer integration'},()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'acid-export-'));
  try {
    // Plant a real EISDIR exactly at export time, after successful construction.
    // This preload changes the filesystem, not the result or scoring function.
    const preload=path.join(dir,'export-directory.mjs');
    fs.writeFileSync(preload,`import fs from 'node:fs';import path from 'node:path';import {syncBuiltinESMExports} from 'node:module';const write=fs.writeFileSync;fs.writeFileSync=function(file,...args){if(path.basename(String(file))==='model.step')fs.mkdirSync(file,{recursive:true});return write.call(this,file,...args);};syncBuiltinESMExports();`);
    const r=spawnSync(process.execPath,['--import',preload,path.join(ROOT,'scripts/acid/run.mjs'),'--out',dir,'--kernels','wonky-rust','--zones','AC01','--variants','V0','--no-smoke','--json-only'],
      {cwd:ROOT,encoding:'utf8',timeout:120000,env:{...process.env,WONKY_BACKEND:'rust',NODE_OPTIONS:'--max-old-space-size=8192'}});
    const row=readJSON(path.join(dir,'results.json')).rows.find(r=>r.kernel==='wonky-rust');
    assert.equal(row.stage,'export');assert.equal(row.error.name,'Error');assert.match(row.error.message,/EISDIR/);
    assert.equal(row.outcome,'built');assert.equal(row.bodies.length,1);assert.equal(row.stepRoundTrip.ok,false);assert.notEqual(r.status,0);
    const v=readJSON(path.join(dir,'scoreboard.json')).zones.find(z=>z.kernel==='wonky-rust'&&z.zone==='AC01').variants.V0;
    assert.equal(v.status,'WRONG');assert(v.types.includes('validity'));
    assert.equal(scoreVariant(catalog,catalog.zones.find(z=>z.id==='AC01'),'wonky-rust',row).status,'UNVERIFIED','serialized failure is not execution evidence');
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
test('F5: declared errata override PASS and WRONG uniformly; removing an entry restores v1',()=>{
  const zone=catalog.zones.find(z=>z.id==='AC31');
  const row={variant:'V0',outcome:'built',nativeValidity:true,metrics:{}};
  assert.equal(scoreVariant(catalog,zone,'onshape',row).status,'DISPUTED');
  assert.equal(scoreVariant(catalog,zone,'onshape',row,null,{errata:noErrata}).status,'WRONG');
  // CE11 AC26's frozen primitive measurements pass v1, but cannot prove a revolve.
  const torus=catalog.zones.find(z=>z.id==='AC26'),b=torus.closedForm.bbox.variants.V0;
  const metrics={volume:64*Math.PI*Math.PI,area:64*Math.PI*Math.PI,bodies:[{volume:64*Math.PI*Math.PI}],
    topology:{bodies:1,shells:1,faces:1,edges:0,vertices:0,genus:1,singularPoints:0},
    bbox:{min:b.min.map((v,i)=>v+torus.cell.originMm[i]),max:b.max.map((v,i)=>v+torus.cell.originMm[i])},
    measurements:{probe_hole:6,probe_above:Math.sqrt(89)-2},validity:{brep:true,closed:true,positive:true}};
  const primitive={variant:'V0',outcome:'built',nativeValidity:true,metrics,stepRoundTrip:{ok:true,metrics}};
  assert.equal(scoreVariant(catalog,torus,'occt',primitive,null,{errata:noErrata}).status,'CORRECT');
  assert.equal(scoreVariant(catalog,torus,'occt',primitive).status,'DISPUTED');
  const affected=['AC25','AC26','AC31','AC36','AC38','AC48'];
  const report=score(catalog,{zonesSha256,rows:[]},{zonesSha256});
  for(const z of report.zones.filter(z=>affected.includes(z.zone))){assert.equal(z.status,'DISPUTED');assert.equal(z.points,0);}
});

// Execution admission belongs at the public CLI boundary. These deliberately
// forged files are attack inputs, not native geometry evidence or golden output.
function forgedRows(id, dir, code, backend) {
  const zone=catalog.zones.find(z=>z.id===id), cf=zone.closedForm;
  const source=catalog.groups.find(g=>g.id===zone.group).fs;
  return VARIANTS.map(variant=>{
    const local=cf.bbox.variants[variant];
    const bbox=Object.fromEntries(['min','max'].map(s=>[s,local[s].map((x,i)=>x+zone.cell.originMm[i])]));
    const topology=Object.fromEntries(Object.entries(cf.topology).filter(([,v])=>typeof v==='number'));
    const metrics={basis:'native-f64-construction',volume:cf.volume.valueFloat,area:cf.area.valueFloat,
      bodies:[{volume:cf.volume.valueFloat,area:cf.area.valueFloat,centroid:[0,0,0],bbox,topology}],bbox,localBbox:cf.bbox.local,topology,
      measurements:Object.fromEntries(cf.measurements.map(p=>[p.name,p.valueFloat])),cellAttribution:true,validity:{brep:true,closed:true,positive:true}};
    const row={kernel:'wonky-rust',zone:id,variant,outcome:'built',nativeValidity:true,metrics};
    if(id==='AC41')return {...row,builtBeforeFailure:true,stepRoundTrip:{ok:false,unhealedSliver:{closedShells:1,distinctShellPoints:8,localExtentX:2**-30}}};
    const out=path.join(dir,variant);fs.mkdirSync(out,{recursive:true});
    const body={id:`model/${id}/solid`,wc0Sha256:sha256(`invented-${variant}`)};
    const nativeObservation={sourceHash:backend.sourceHash,bodies:[{...body,boundToConstruction:true,probes:observationProbes(zone).map(p=>({name:p.name,inside:false,distanceMm:metrics.measurements[p.name]}))}],metrics};
    const bodies=[{id:body.id}],stamp={source,zonesSha256,sourceSha256:sha256(fs.readFileSync(path.join(ROOT,source)))};
    const step=`ISO-10303-21; invented ${variant}`,stepRoundTrip={ok:true,metrics},stepSha256=sha256(step);
    const artifacts={
      'request.json':{...stamp,zone:id,variant},
      'build.json':{...row,bodies,backend,nativeObservation,stamp},
      'model.brep.json':{backend,bodies:[{...body,words:[]}]},
      'measure.json':{stepSha256,stepRoundTrip},
    };
    for(const [file,value] of Object.entries(artifacts))fs.writeFileSync(path.join(out,file),JSON.stringify(value));
    fs.writeFileSync(path.join(out,'model.step'),step);
    return {...row,code,backend,bodies,nativeObservation,stepRoundTrip,stepSha256,artifacts:out,artifactHashes:artifactHashes(out)};
  });
}
function scoreCLI(dir, results, reverify=false) {
  fs.mkdirSync(dir,{recursive:true});const input=path.join(dir,'results.json'),out=path.join(dir,'score');
  fs.writeFileSync(input,JSON.stringify(results));
  const cli=spawnSync(process.execPath,[path.join(ROOT,'scripts/acid/score.mjs'),input,out,'--json-only',...(reverify?['--reverify']:[])],
    {cwd:ROOT,encoding:'utf8',timeout:180000,maxBuffer:1<<22,env:{...process.env,NODE_OPTIONS:'--max-old-space-size=8192',WONKY_BACKEND:'rust'}});
  assert(fs.existsSync(path.join(out,'scoreboard.json')),cli.stderr);
  return {cli,report:readJSON(path.join(out,'scoreboard.json'))};
}
test('execution admission: forged files, export-failure sliver and naked refusal never earn points',{skip: !fs.existsSync(REFERENCE_PYTHON) && 'REFERENCE_VENV_UNAVAILABLE: frozen STEP observer integration'},async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'acid-reexecute-'));
  try {
    const {locateRustBuild,rustStaleCheck}=await import('../src/native/rust-kernel.mjs');
    const {openKernel,backendInfo}=await import('../src/native/backend.mjs');
    const live=rustStaleCheck(locateRustBuild());
    const code=codeIdentity(),backend={...backendInfo(await openKernel('rust')),addonSha256:sha256(fs.readFileSync(live.path))};
    const cases=[
      ['N2 self-consistent AC02 with real identity',()=>forgedRows('AC02',path.join(dir,'artifacts'),code,backend),'AC02'],
      ['N1 evidence-free AC41 export failure',()=>forgedRows('AC41',dir).map(r=>({...r,code,backend})),'AC41'],
      ['AC45 evidence-free refusal',()=>VARIANTS.map(variant=>({kernel:'wonky-rust',zone:'AC45',variant,code,backend,outcome:'refused',refusal:{name:'InventedRefusal',category:'open-profile',capability:false,operationUnderTest:true}})),'AC45'],
      ['recorded addon differs from live addon',()=>forgedRows('AC02',path.join(dir,'wrong-addon'),code,{...backend,sourceHash:'f'.repeat(64)}),'AC02'],
    ];
    for(const [i,[name,make,zone]] of cases.entries())await t.test(name,()=>{
      const rows=make(),results={zonesSha256,code,rows};
      for(const replay of [false,true]) {
        const {cli,report}=scoreCLI(path.join(dir,`${i}-${replay}`),results,replay);
        assert.equal(report.kernels['wonky-rust'].score,0,`${name}, reverify=${replay}`);
        const cell=report.zones.find(z=>z.kernel==='wonky-rust'&&z.zone===zone);
        assert.equal(cell.status,'UNVERIFIED');assert.notEqual(cli.status,0);
        if(replay) {
          const m=report.verification.mismatches.find(m=>m.zone===zone);assert(m,'re-execution mismatch is disclosed');
          assert.match(m.reason,i===3?/addon sourceHash/:/observation differs/,'the intended execution mismatch, not an unrelated guard');
        }
      }
    });
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
test('execution admission: live AC01/AC45 scores 2/48; serialized claims require replay and frozen split batches merge',{skip: !fs.existsSync(REFERENCE_PYTHON) && 'REFERENCE_VENV_UNAVAILABLE: frozen STEP observer integration'},()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'acid-live-replay-'));
  try {
    const live=spawnSync(process.execPath,[path.join(ROOT,'scripts/acid/run.mjs'),'--out',dir,'--kernels','wonky-rust','--zones','AC01,AC45','--no-smoke'],
      {cwd:ROOT,encoding:'utf8',timeout:180000,maxBuffer:1<<22,env:{...process.env,NODE_OPTIONS:'--max-old-space-size=8192',WONKY_BACKEND:'rust'}});
    assert.equal(live.status,0,live.stderr);
    const result=readJSON(path.join(dir,'results.json')),report=readJSON(path.join(dir,'scoreboard.json'));
    assert.equal(report.kernels['wonky-rust'].score,2);assert.equal(report.kernels['wonky-rust'].total,48);
    const saved={...result,rows:result.rows.filter(r=>r.kernel==='wonky-rust')};
    assert.equal(scoreCLI(path.join(dir,'offline'),saved).report.kernels['wonky-rust'].score,0);
    const replay=scoreCLI(path.join(dir,'replay'),saved,true);
    assert.equal(replay.cli.status,0,replay.cli.stderr);assert.equal(replay.report.kernels['wonky-rust'].score,2);
    assert.equal(report.verification.kernels['wonky-rust'].status,'live');
    assert.equal(report.verification.kernels.onshape.status,'frozen');
    assert.equal(report.verification.kernels.occt.status,'frozen');
    assert.equal(replay.report.verification.kernels['wonky-rust'].status,'re-verified');
    const header=fs.readFileSync(path.join(dir,'scoreboard.md'),'utf8').split('| Kernel |')[0];
    const addon=saved.rows[0].backend;
    for(const hash of [result.code.treeSha256,addon.sourceHash,addon.addonSha256])assert(header.includes(hash),'published header identifies the live tree and addon');
    assert.equal(report.verification.addons['wonky-rust'][0].sourceHash,addon.sourceHash);
    assert.equal(report.verification.addons['wonky-rust'][0].addonSha256,addon.addonSha256);
    // Published reference provenance identifies the checked freeze, not caller claims.
    for(const [kernel,files] of Object.entries({occt:['observations.json','SHA256SUMS'],onshape:['SHA256SUMS']})) {
      for(const file of files) {
        const relative=`fixtures/cad-acid/${kernel}/${file}`,digest=sha256(fs.readFileSync(path.join(ROOT,relative)));
        assert.equal(report.verification.referenceFixtures?.[kernel]?.[relative],digest,`${kernel} checked fixture digest`);
        assert(header.includes(digest),`${kernel} fixture digest in published Markdown header`);
      }
    }
    const external={...result,rows:result.rows.filter(r=>['onshape','occt'].includes(r.kernel)),referenceFixtures:{occt:{'observations.json':'f'.repeat(64)}}};
    const rescored=scoreCLI(path.join(dir,'reference-provenance'),external).report;
    for(const kernel of ['occt','onshape'])for(const [file,digest] of Object.entries(report.verification.referenceFixtures[kernel]))
      assert.equal(rescored.verification.referenceFixtures[kernel][file],digest,'standalone scoring records its own verified fixture bytes');
    // Each documented zone batch carries the same verified frozen neighbours.
    const dirs=['AC01','AC45'].map(zone=>{
      const d=path.join(dir,zone);fs.mkdirSync(d);
      fs.writeFileSync(path.join(d,'results.json'),JSON.stringify({...result,rows:result.rows.filter(r=>!r.kernel.startsWith('wonky-')||r.zone===zone)}));return d;
    });
    const merge=spawnSync(process.execPath,[path.join(ROOT,'scripts/acid/merge-results.mjs'),path.join(dir,'merged'),...dirs],{encoding:'utf8'});
    assert.equal(merge.status,0,merge.stderr);
    assert.equal(readJSON(path.join(dir,'merged/results.json')).rows.length,result.rows.length);
    const second=readJSON(path.join(dirs[1],'results.json'));
    second.rows.find(r=>r.kernel==='onshape'&&r.outcome==='built').metrics.volume+=1;
    fs.writeFileSync(path.join(dirs[1],'results.json'),JSON.stringify(second));
    const conflict=spawnSync(process.execPath,[path.join(ROOT,'scripts/acid/merge-results.mjs'),path.join(dir,'conflict'),...dirs],{encoding:'utf8'});
    assert.notEqual(conflict.status,0);assert.match(conflict.stderr,/ROW_CODE_IDENTITY_MISMATCH.*onshape\/AC01/,'a changed frozen row loses the local-identity exemption');
    const changed=scoreCLI(path.join(dir,'changed-onshape'),{...second,rows:second.rows.filter(r=>r.kernel==='onshape')});
    assert.equal(changed.report.zones.find(z=>z.kernel==='onshape'&&z.zone==='AC01').status,'UNVERIFIED');
    assert.equal(changed.report.verification.kernels.onshape.status,'unverified');
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
test('frozen reference admission: self-consistent non-fixture rows cannot score or deduplicate as frozen',{skip: !fs.existsSync(REFERENCE_PYTHON) && 'REFERENCE_VENV_UNAVAILABLE: frozen STEP observer integration'},async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'acid-reference-admission-'));
  try {
    const {verifyStoredReferences}=await import('../scripts/acid/execution.mjs');
    const frozen=readJSON(path.join(ROOT,'fixtures/cad-acid/occt/observations.json'));
    const positive={...frozen,rows:frozen.rows.filter(r=>r.zone==='AC01')};
    await verifyStoredReferences(positive,{out:dir});
    const good=score(catalog,positive,{zonesSha256});
    assert.equal(good.kernels.occt.score,1);assert.equal(good.verification.kernels.occt.status,'frozen');
    const forged=observations(),source=catalog.groups.find(g=>g.zoneIds.includes('AC01')).b3d;
    forged.code=codeIdentity();forged.sources=frozen.sources;forged.smoke=[];forged.finishedAt='finished';forged.closedForms={ok:true};
    for(const row of forged.rows) {
      row.code=forged.code;
      row.metrics.observer='self-written, not a frozen observation';
      const out=path.join(dir,row.variant);fs.mkdirSync(out);
      fs.writeFileSync(path.join(out,'build.json'),JSON.stringify({...row,stamp:{zonesSha256,sourceSha256:sha256(fs.readFileSync(path.join(ROOT,source)))}}));
      row.artifacts=out;row.artifactHashes=artifactHashes(out);
    }
    // Direct score() is also a publication boundary, not an artifact admission bypass.
    assert.equal(score(catalog,forged,{zonesSha256}).kernels.occt.score,0);
    for(const replay of [false,true]) {
      const {cli,report}=scoreCLI(path.join(dir,`forged-${replay}`),forged,replay);
      assert.equal(cli.status,1);assert.equal(report.kernels.occt.score,0);
      assert.equal(report.verification.kernels.occt.status,'unverified');
      assert.equal(report.zones.find(z=>z.kernel==='occt'&&z.zone==='AC01').status,'UNVERIFIED');
    }
    const batch=path.join(dir,'forged-false');
    const merge=(out,inputs)=>spawnSync(process.execPath,[path.join(ROOT,'scripts/acid/merge-results.mjs'),out,...inputs],{encoding:'utf8'});
    const duplicated=merge(path.join(dir,'duplicate'),[batch,batch]);
    assert.notEqual(duplicated.status,0);assert.match(duplicated.stderr,/DUPLICATE_OBSERVATION/,'unverified rows cannot use frozen deduplication');
    const out=path.join(dir,'merged'),single=merge(out,[batch]);
    assert.equal(single.status,0,single.stderr);
    const merged=scoreCLI(path.join(dir,'merged-score'),readJSON(path.join(out,'results.json'))).report;
    assert.equal(merged.kernels.occt.score,0);assert.equal(merged.verification.kernels.occt.status,'unverified');
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
test('live OCCT without a frozen fixture earns zero; live observations never replace the frozen column',async t=>{
  if(!fs.existsSync(REFERENCE_PYTHON)){t.skip('REFERENCE_VENV_UNAVAILABLE: no live OCCT claim');return;}
  const dir=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'acid-live-reference-')));
  try {
    // Separate real checkout-shaped files: never hide or mutate the working tree's freeze.
    for(const relative of ['scripts','src','fixtures/cad-acid'])fs.cpSync(path.join(ROOT,relative),path.join(dir,relative),{recursive:true});
    fs.symlinkSync(path.join(ROOT,'node_modules'),path.join(dir,'node_modules'));
    fs.mkdirSync(path.join(dir,'out'));
    fs.symlinkSync(path.join(ROOT,'out/build123d-performance'),path.join(dir,'out/build123d-performance'));
    assert.equal(spawnSync('git',['init','--quiet',dir],{encoding:'utf8'}).status,0);
    fs.rmSync(path.join(dir,'fixtures/cad-acid/onshape'),{recursive:true});
    const fixture=path.join(dir,'fixtures/cad-acid/occt');
    fs.renameSync(fixture,`${fixture}-held`);
    for(const present of [false,true])await t.test(present?'frozen and live remain separate':'P1: missing frozen fixture',()=>{
      if(present)fs.renameSync(`${fixture}-held`,fixture);
      const out=path.join(dir,present?'present':'missing');
      const cli=spawnSync(process.execPath,[path.join(dir,'scripts/acid/run.mjs'),'--out',out,'--kernels','occt','--zones','AC01','--no-smoke'],
        {cwd:dir,encoding:'utf8',timeout:180000,maxBuffer:1<<22,env:{...process.env,NODE_OPTIONS:'--max-old-space-size=8192'}});
      assert(fs.existsSync(path.join(out,'scoreboard.json')),`status=${cli.status}, signal=${cli.signal}, error=${cli.error?.message}\n${cli.stderr}`);
      const report=readJSON(path.join(out,'scoreboard.json')),result=readJSON(path.join(out,'results.json'));
      const scored=result.rows.filter(r=>r.kernel==='occt');
      if(!present) {
        assert.equal(cli.status,0,cli.stderr);
        assert.equal(report.kernels.occt.score,0,'live AC01 must not mint the missing frozen reference point');
        assert.equal(scored.length,0,'live observations stay outside the scored rows');
        assert.equal(Object.keys(report.verification.referenceFixtures.occt).length,0,'no fixture identity is invented');
      } else {
        assert.equal(scored.length,192,'all frozen rows survive a selected live run');
        assert.equal(report.verification.kernels.occt.status,'frozen');
        assert.equal(report.verification.kernels.occt.counts.frozen,192);
        const frozen=readJSON(path.join(fixture,'observations.json'));
        for(const row of scored)assert.equal(sha256(JSON.stringify(row)),sha256(JSON.stringify(frozen.rows.find(r=>r.zone===row.zone&&r.variant===row.variant))));
      }
      assert.equal(result.liveReferences.length,4);
      for(const row of result.liveReferences) {
        assert.equal(row.kernel,'occt');assert.equal(row.outcome,'built');
        assert.equal(row.evidence.status,'live-reference');assert.equal(row.evidence.scored,false);
        assert.equal(scoreVariant(catalog,catalog.zones.find(z=>z.id==='AC01'),'occt',row).status,'CORRECT','real live geometry, not a failed build hiding the scoring bug');
      }
      // Relocating saved diagnostics into scored rows cannot fill a missing freeze.
      if(!present) {
        const input=path.join(out,'live-claims.json');fs.writeFileSync(input,JSON.stringify({...result,rows:result.liveReferences}));
        const replay=spawnSync(process.execPath,[path.join(dir,'scripts/acid/score.mjs'),input,path.join(out,'replay'),'--json-only'],
          {cwd:dir,encoding:'utf8',timeout:180000,maxBuffer:1<<22});
        assert.equal(replay.status,1,replay.stderr);
        const rescored=readJSON(path.join(out,'replay/scoreboard.json'));
        assert.equal(rescored.kernels.occt.score,0);assert.equal(rescored.verification.kernels.occt.status,'unverified');
      } else {
        const merged=path.join(out,'merged');
        const merge=spawnSync(process.execPath,[path.join(dir,'scripts/acid/merge-results.mjs'),merged,out],{cwd:dir,encoding:'utf8',timeout:180000,maxBuffer:1<<22});
        assert.equal(merge.status,0,merge.stderr);
        const saved=readJSON(path.join(merged,'results.json'));
        assert.equal(saved.rows.length,192);assert.equal(saved.liveReferences.length,4,'merge retains live diagnostics separately');
      }
    });
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
test('tree identity changes with validator and transitive live script bytes, including untracked files',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'acid-code-identity-'));
  try {
    assert.equal(spawnSync('git',['init','--quiet',dir],{encoding:'utf8'}).status,0);
    for(const file of ['scripts/validate-step.py','scripts/acid/measure.py','scripts/r20/modules.mjs','scripts/r20/acceptance.mjs','scripts/runtime-helper.mjs']) {
      const target=path.join(dir,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,'original\n');
      const before=codeIdentity(dir).treeSha256;
      fs.writeFileSync(target,'modified\n');
      assert.notEqual(codeIdentity(dir).treeSha256,before,file);
      fs.writeFileSync(target,'original\n');assert.equal(codeIdentity(dir).treeSha256,before,'restored bytes restore identity');
    }
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
test('score refuses a doctored catalog rather than reporting the frozen hash for different bands',()=>{
  assert.equal(score(structuredClone(catalog),{zonesSha256,rows:[]}).zonesSha256,zonesSha256);
  const changed=structuredClone(catalog);changed.zones[0].tolerance.volumeRel.exact=1;
  for(const options of [{},{zonesSha256}])assert.throws(()=>score(changed,{zonesSha256,rows:[]},options),/SCORING_CATALOG_MISMATCH/);
  assert.throws(()=>score(catalog,{zonesSha256:'0'.repeat(64),rows:[]}),/REFERENCE_ZONES_SHA_MISMATCH/);
});
test('AC41 exact-class bands do not inherit the tolerance-only sliver envelope',()=>{
  // Numerical scoring contract, not an execution claim: assign an external row
  // to the exact class so that no wonky execution-admission bypass is needed.
  const c=structuredClone(catalog);c.kernelClasses.tolerance.kernels=c.kernelClasses.tolerance.kernels.filter(k=>k!=='onshape');c.kernelClasses.exact.kernels.push('onshape');
  const row=forgedRows('AC41')[0],zone=c.zones.find(z=>z.id==='AC41');
  assert.equal(scoreVariant(c,zone,'onshape',row).status,'CORRECT');
  for(const field of ['volume','area']) {
    const wrong=structuredClone(row);wrong.metrics[field]*=1+2e-9;
    const v=scoreVariant(c,zone,'onshape',wrong);assert.equal(v.status,'WRONG',field);assert.match(v.reason,new RegExp(field));
  }
  const loose=structuredClone(row);loose.metrics.volume=1e-7;loose.metrics.area=32.0005;
  assert.equal(scoreVariant(catalog,zone,'onshape',loose).status,'CORRECT','tolerance sliver branch remains available');
});
