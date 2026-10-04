import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {loadCatalog,validateCatalog,zoneVariants,sha256} from '../scripts/acid/common.mjs';
import {assertPackageDelta,assertOwnZonesLive,assertScopedChange} from './helpers/catalog-delta.mjs';
const ids=['AC106','AC107','AC108'];
const {catalog}=loadCatalog();
function check(c,only=ids) {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'z3-contract-'));
 try {
  const file=path.join(dir,'zones.json');fs.writeFileSync(file,JSON.stringify(c));
  return spawnSync('uv',['run','scripts/acid/closed-forms.py','--zones',file,'--only',only.join(',')],{encoding:'utf8',timeout:180000,maxBuffer:1<<20});
 } finally {fs.rmSync(dir,{recursive:true,force:true});}
}
test('Z3 changes only its own zones against its exact previous catalog',()=>{
 const pkg=assertPackageDelta(catalog,'AC1-2026-10-02-extZ3-curved-booleans',{added:ids});
 assert.doesNotThrow(()=>validateCatalog(catalog));
 for(const id of ids){
  const z=catalog.zones.find(z=>z.id===id);
  assert.deepEqual(zoneVariants(z),['V0','V1','V2','V3','V4']);
  assert(z.closedFormByVariant.V4);assert.match(z.kernelNotes.onshape,/Awaiting capture/);
 }
 // An undeclared edit of a Z3 zone fails; later packages touching other zones do not.
 const planted=structuredClone(catalog);planted.zones.find(z=>z.id==='AC107').kernelNotes.onshape+=' planted';
 assert.throws(()=>assertOwnZonesLive(planted,pkg),/AC107 undeclared later change/);
 const later=structuredClone(catalog);later.zones.find(z=>z.id==='AC01').planted=true;
 later.zones.push({...structuredClone(later.zones.find(z=>z.id==='AC106')),id:'AC999'});
 assert.doesNotThrow(()=>assertOwnZonesLive(later,pkg));
 const outside=structuredClone(pkg.after);outside.zones.find(z=>z.id==='AC01').planted=true;
 assert.throws(()=>assertScopedChange(pkg.base,outside,pkg.entry),/AC01 outside scope/);
});
test('Z3 checker reproduces both routes, exposed areas, topology and V4',()=>{
 const r=check(catalog);assert.equal(r.status,0,r.stdout+'\n'+r.stderr);
});
test('Z3 moved parameters cannot retain a frozen contract',()=>{
 for(const id of ids){
  const bad=structuredClone(catalog);bad.zones.find(z=>z.id===id).construction.params.tool[0][1]+=1;
  const r=check(bad,[id]);assert.equal(r.status,1,r.stdout+'\n'+r.stderr);assert.match(r.stdout,/tool endpoints bind construction/);
 }
});
test('AC108 chart discriminant has exactly the prescribed real branch events',()=>{
 const r=spawnSync('uv',['run','--no-project','--with','sympy==1.13.3','--with','mpmath==1.3.0','python','-c',
  'import sys,json,sympy as s;sys.path.insert(0,"scripts/acid");from z3_forms import branch_discriminant;c=json.load(open("fixtures/cad-acid/zones.json"));p=next(z for z in c["zones"] if z["id"]=="AC108")["construction"]["params"];t=s.Symbol("t");D=branch_discriminant(p);assert s.expand(D-80*t*(t-2)*(2*t-1)*(t*t+1)**2)==0;assert s.polys.polytools.intervals(D,eps=s.Rational(1,10**20))==[((0,0),1),((s.Rational(1,2),s.Rational(1,2)),1),((2,2),1)];p["tool"][0][1]=1;assert s.expand(branch_discriminant(p)-D)!=0'],{encoding:'utf8',timeout:30000});
 assert.equal(r.status,0,r.stdout+'\n'+r.stderr);
});

test('complete extension group size still rejects incomplete two-zone captures',()=>{
 const bad=structuredClone(catalog),g=bad.groups.find(g=>g.id==='boolean-z3');
 g.zoneIds.pop();bad.zones=bad.zones.filter(z=>z.id!=='AC108');
 const r=check(bad,[]);assert.equal(r.status,1,r.stdout+'\n'+r.stderr);
 assert.match(r.stdout,/group boolean-z3 size 3\.\.12 2/);
});

test('real Z3 Boolean bodies preserve analytic topology and validity through STEP in every pose',{skip: !process.getBuiltinModule('node:fs').existsSync(new URL('../out/build123d-performance/reference-venv/bin/python', import.meta.url)) && 'REFERENCE_VENV_UNAVAILABLE: build123d/OCCT reference observer'},()=>{
 const program=`import sys,tempfile
sys.path[:0]=['scripts/acid','fixtures/cad-acid/b3d']
from acid_boolean_z3 import build_zone
from measure import canonical,export_step,read_step,entities,BRep_Tool,TopAbs_VERTEX,TopAbs_EDGE,TopAbs_FACE
from OCP.BRepCheck import BRepCheck_Analyzer
def max_tolerance(shape):
 return max(BRep_Tool.Tolerance_s(e) for kind in [TopAbs_VERTEX,TopAbs_EDGE,TopAbs_FACE] for e in entities(shape,kind))
for zid in ['AC106','AC107','AC108']:
 for variant in ['V0','V1','V2','V3','V4']:
  solids=build_zone(zid,variant)
  assert len(solids)==1,(zid,variant,len(solids))
  source_tolerance=max_tolerance(solids[0].wrapped)
  with tempfile.TemporaryDirectory() as directory:
   export_step(solids[0].wrapped,directory+'/body.step')
   first=read_step(directory+'/body.step')
   export_step(first,directory+'/second.step')
   second=read_step(directory+'/second.step')
   first_tolerance=max_tolerance(first)
   second_tolerance=max_tolerance(second)
   # Each import already declares 1e-7 mm coordinate resolution. A repair
   # cannot obtain validity by silently inflating the B-rep tolerance budget.
   assert first_tolerance<=source_tolerance+1e-7,(zid,variant,'first tolerance',source_tolerance,first_tolerance)
   assert second_tolerance<=first_tolerance+1e-7,(zid,variant,'second tolerance',first_tolerance,second_tolerance)
   for stage,shape,resolution in [('native',solids[0].wrapped,0),('STEP',first,1e-7),('second STEP',second,1e-7)]:
    assert BRepCheck_Analyzer(shape).IsValid(),(zid,variant,stage)
    topology,raw,histogram=canonical(shape,resolution)
    fields=['bodies','shells','faces','edges','vertices','loops','ringEdges','genus','singularPoints']
    expected=[1,1,5,5,2,8,3,0,0] if zid=='AC107' else [1,1,4,4,0,8,4,1,0]
    assert [topology[k] for k in fields]==expected,(zid,variant,stage,topology,raw)
    assert histogram=={'Plane':3,'Cylinder':2} if zid=='AC107' else histogram=={'Plane':2,'Cylinder':2},(zid,variant,stage,histogram)
print('15 actual Boolean cells: native and two STEP transfers topology and validity verified')`;
 const r=spawnSync('out/build123d-performance/reference-venv/bin/python',['-B','-c',program],{encoding:'utf8',timeout:180000,maxBuffer:1<<20});
 assert.equal(r.status,0,r.stderr+'\n'+r.stdout);
 assert.match(r.stdout,/15 actual Boolean cells/);
});

test('analytic join certificate retains tangent and unresolved intersections without catalog answers',{skip: !process.getBuiltinModule('node:fs').existsSync(new URL('../out/build123d-performance/reference-venv/bin/python', import.meta.url)) && 'REFERENCE_VENV_UNAVAILABLE: build123d/OCCT reference observer'},()=>{
 const program=`import sys
sys.path.insert(0,'scripts/acid')
from measure import transverse_analytic_join,point_shape,entities,TopAbs_VERTEX
from build123d import Solid,Plane
from OCP.BRepAdaptor import BRepAdaptor_Surface
from OCP.GeomAbs import GeomAbs_Cylinder
def wall(radius,plane):
 return next(f.wrapped for f in Solid.make_cylinder(radius,40,plane).faces() if BRepAdaptor_Surface(f.wrapped).GetType()==GeomAbs_Cylinder)
shaft=wall(5,Plane(origin=(0,0,-20)))
tool=wall(2,Plane(origin=(-10,2,0),x_dir=(0,1,0),z_dir=(1,0,0)))
def vertex(p):return entities(point_shape(p),TopAbs_VERTEX)[0]
assert transverse_analytic_join(vertex((5,0,0)),[shaft,tool])
assert transverse_analytic_join(vertex((3,4,0)),[shaft,tool])
post=wall(4,Plane(origin=(0,0,-20)))
branch=wall(4,Plane(origin=(0,0,0),x_dir=(0,1,0),z_dir=(1,0,0)))
for y in [-4,4]:
 assert not transverse_analytic_join(vertex((0,y,0)),[post,branch])
 assert not transverse_analytic_join(vertex((1e-10,y,1e-10)),[post,branch])
assert not transverse_analytic_join(vertex((5,0,0)),[shaft,shaft])
assert not transverse_analytic_join(vertex((5,0,0)),[shaft])
print('transverse, tangent, uncertainty-ball and incidence counterexamples verified')`;
 const r=spawnSync('out/build123d-performance/reference-venv/bin/python',['-B','-c',program],{encoding:'utf8',timeout:30000,maxBuffer:1<<20});
 assert.equal(r.status,0,r.stderr+'\n'+r.stdout);
 assert.match(r.stdout,/counterexamples verified/);
});

test('cross-bore intersection has two disjoint regular closed curves, including its chart branch events',()=>{
 const program=`import sys,json,sympy as s
sys.path.insert(0,'scripts/acid')
from z3_forms import Q
cat=json.load(open('fixtures/cad-acid/zones.json'))
t=s.Symbol('t',real=True)
for zone in [z for z in cat['zones'] if z['id'] in ['AC106','AC108']]:
 for variant in ['V0','V4']:
  p=zone['construction'].get('paramsByVariant',{}).get(variant,zone['construction']['params'])
  R,r,d=map(Q,[p['R'],p['radius'],p['tool'][0][1]])
  # Each sign of x is a separate closed curve. Strict clearance keeps
  # x away from zero; (y,z) is a circle whose speed never vanishes.
  assert R**2-(abs(d)+r)**2>0
  y,z=d+r*s.cos(t),r*s.sin(t)
  x2=R**2-y**2
  assert s.trigsimp(s.diff(y,t)**2+s.diff(z,t)**2)==r**2>0
  # n_shaft=(x,y,0), n_bore=(0,y-d,z). Their cross is nonzero
  # everywhere: this sum of squares is strictly positive even at z=0.
  norm2=s.expand((x2+y**2)*z**2+x2*(y-d)**2)
  assert s.trigsimp(norm2-r**2*(R**2*s.sin(t)**2+x2*s.cos(t)**2))==0
print('four parameter sets have two disjoint regular periodic intersection curves')`;
 const r=spawnSync('uv',['run','--no-project','--with','sympy==1.13.3','--with','mpmath==1.3.0','python','-B','-c',program],{encoding:'utf8',timeout:30000,maxBuffer:1<<20});
 assert.equal(r.status,0,r.stderr+'\n'+r.stdout);
 assert.match(r.stdout,/disjoint regular periodic/);
});


test('valid periodic pcurves preserve trimmed geometry through repeated STEP transfer',{skip: !process.getBuiltinModule('node:fs').existsSync(new URL('../out/build123d-performance/reference-venv/bin/python', import.meta.url)) && 'REFERENCE_VENV_UNAVAILABLE: build123d/OCCT reference observer'},()=>{
 const program=`import sys,tempfile,hashlib,json
sys.path[:0]=['scripts/acid']
from measure import read_step,export_step,BRepGProp,GProp_GProps,integration_shape,BRepCheck_Analyzer,Interface_Static
from pathlib import Path
root=Path('fixtures/step-regression/periodic-pcurves')
assert hashlib.sha256((root/'model.step').read_bytes()).hexdigest()==json.loads((root/'provenance.json').read_text())['sha256']
def properties(shape):
 v,a=GProp_GProps(),GProp_GProps()
 BRepGProp.VolumeProperties_s(integration_shape(shape),v,Eps=1e-10)
 BRepGProp.SurfaceProperties_s(integration_shape(shape),a,Eps=1e-10)
 return v.Mass(),a.Mass()
shape=read_step(root/'model.step')
expected=properties(shape)
mode=Interface_Static.IVal_s('write.surfacecurve.mode')
with tempfile.TemporaryDirectory() as d:
 for i in range(2):
  export_step(shape,Path(d)/'body.step')
  assert Interface_Static.IVal_s('write.surfacecurve.mode')==mode
  shape=read_step(Path(d)/'body.step')
  assert BRepCheck_Analyzer(shape).IsValid()
  actual=properties(shape)
  assert all(abs(x-y)<1e-6 for x,y in zip(expected,actual)),(expected,actual)
print('preserved periodic pcurves and geometry over two transfers')`;
 const r=spawnSync('out/build123d-performance/reference-venv/bin/python',['-B','-c',program],{encoding:'utf8',timeout:180000,maxBuffer:1<<20});
 assert.equal(r.status,0,r.stderr+'\n'+r.stdout);
 assert.match(r.stdout,/preserved periodic pcurves/);
});


test('historical capture bytes stay intact while the fresh reference is admitted uniquely',async()=>{
 const archive='fixtures/cad-acid/occt-ext-history/Z3-fix1';
 const manifest=fs.readFileSync(archive+'/SHA256SUMS');
 assert.equal(sha256(manifest),'35ef12aa34a7571ab918768ca5dab5c38ef2426dc785bd63df77825a755dad07');
 for(const line of manifest.toString().trim().split('\n')){
  const [,hash,file]=line.match(/^([a-f0-9]{64}) {2}(.+)$/);
  assert.equal(sha256(fs.readFileSync(archive+'/'+file)),hash,file);
 }
 assert.equal(fs.existsSync('fixtures/cad-acid/occt-ext/Z3-fix1/provenance.json'),false);
 const rows=JSON.parse(fs.readFileSync('fixtures/cad-acid/occt-ext/Z3-fix1b/observations.json'));
 const {verifyStoredReferences,executionEvidence}=await import('../scripts/acid/execution.mjs');
 await verifyStoredReferences(rows);
 assert.equal(rows.rows.length,15);
 for(const row of rows.rows){
  const proof=executionEvidence(row);
  assert.equal(proof?.status,'frozen',row.zone+'/'+row.variant);
  assert(Object.keys(proof.fixtures).every(file=>file.startsWith('fixtures/cad-acid/occt-ext/Z3-fix1b/')));
 }
});
