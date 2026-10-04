import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {ROOT,loadCatalog,catalogBySha,sha256,sourceHashes,verifyFrozenReference} from '../scripts/acid/common.mjs';
import {assertPackageDelta,assertZonesLiveSince} from './helpers/catalog-delta.mjs';
const {catalog}=loadCatalog();
const amended=['AC25','AC26','AC31','AC36','AC38','AC48'];
test('catalog errata preserve the previous exact bytes and every unamended contract',()=>{
  const entry=catalog.history.find(h=>h.version==='AC1-2026-10-02-catalog-errata');
  const bytes=fs.readFileSync(path.join(ROOT,'fixtures/cad-acid/catalog-history',`${entry.previousSha256}.json`));
  assert.equal(sha256(bytes),entry.previousSha256);
  // The errata changed exactly the amended zones; later packages check their own deltas.
  const pkg=assertPackageDelta(catalog,entry.version,{amended}),old=pkg.base;
  assert.deepEqual(old,catalogBySha(entry.previousSha256));
  for(const z of old.zones)assert.deepEqual(pkg.after.zones.find(n=>n.id===z.id).tolerance,z.tolerance,z.id);
  assertZonesLiveSince(catalog,pkg.after,pkg.index,old.zones.map(z=>z.id),'tolerance',z=>z.tolerance);
  const binding=verifyFrozenReference(path.join(ROOT,'fixtures/cad-acid/onshape'),catalog,sourceHashes(catalog));
  for(const z of old.zones.filter(z=>!['AC36','AC38'].includes(z.id)))for(const v of ['V0','V1','V2','V3']) {
    // Extended zones live in separate freezes; the base capture must retain all its original unaffected rows.
    if(binding.catalog.zones.some(n=>n.id===z.id))assert.ok(binding.active.has(`${z.id}/${v}`),`${z.id}/${v}`);
  }
});
test('overflow forms have an independent exact meridian integral',()=>{
  const program=`import importlib.util, sys, sympy as s, json
spec=importlib.util.spec_from_file_location('forms',sys.argv[1]);f=importlib.util.module_from_spec(spec);spec.loader.exec_module(f)
cat=json.load(open(sys.argv[2]));z=next(z for z in cat['zones'] if z['id']=='AC31')
m={'checks':[], 'used':set(), 'fn':{}}
f._m31(z,z['construction']['params'],m,cat)
for field,key in [('volume','V'),('area','A')]:
 assert s.simplify(m[key]-s.sympify(z['closedForm'][field]['expression']))==0,(field,m[key])
print('independent exact overflow forms agree')`;
  const r=spawnSync('uv',['run','--no-project','--with','sympy==1.13.3','--with','mpmath==1.3.0','python','-B','-c',program,path.join(ROOT,'scripts/acid/closed-forms-errata.py'),path.join(ROOT,'fixtures/cad-acid/zones.json')],{encoding:'utf8',timeout:60000});
  assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/exact overflow forms agree/);
});
test('actual OCCT revolves count axis contacts independently of surface class, before and after STEP',{skip: !process.getBuiltinModule('node:fs').existsSync(new URL('../out/build123d-performance/reference-venv/bin/python', import.meta.url)) && 'REFERENCE_VENV_UNAVAILABLE: build123d/OCCT reference observer'},()=>{
  const program=`import sys, tempfile
sys.path[:0]=[sys.argv[1]+'/scripts/acid',sys.argv[1]+'/fixtures/cad-acid/b3d']
from acid_curved_errata import build_zone
from acid_precision_errata import build
from acid_precision import zone_frame
from measure import canonical, export_step, read_step, revolution_axis_contacts, BRepAdaptor_Surface, surface_class
from build123d import Torus, Axis, Edge, Face, Plane, Solid, Wire
from OCP.Geom import Geom_Circle, Geom_SurfaceOfRevolution
from OCP.gp import gp_Ax1, gp_Ax2, gp_Pnt, gp_Dir
from OCP.BRepBuilderAPI import BRepBuilderAPI_MakeFace
for variant in ['V0','V1','V2','V3']:
 for zone in ['AC25','AC26','AC48']:
  solid=(build(variant,zone=zone) if zone=='AC48' else build_zone(zone,variant))[0]
  expected=(1,1,0) if zone=='AC48' else ((1,0,0) if zone=='AC25' else (0,0,1))
  with tempfile.TemporaryDirectory() as d:
   export_step(solid.wrapped,d+'/model.step')
   for stage,shape,resolution in [('native',solid.wrapped,0),('STEP',read_step(d+'/model.step'),1e-7)]:
    t,raw,h=canonical(shape,coordinate_resolution=resolution)
    assert (t['singularPoints'],t['pinchPoints'],t['genus'])==expected,(zone,variant,stage,t,raw,h)
for gap in [1,1e-6,1e-10,1e-12]:
 for body in [Torus(4+gap,4), Solid.revolve(Face(Wire([Edge.make_circle(4,Plane(origin=(4+gap,0,0),x_dir=(1,0,0),z_dir=(0,-1,0)))])),360,Axis.Z)]:
  for variant in ['V0','V1','V2','V3']:
   placed=zone_frame('AC48',variant).transform(body)
   t,_,_=canonical(placed.wrapped)
   assert (t['singularPoints'],t['pinchPoints'],t['genus'])==(0,0,1),(gap,variant,t)
# A supporting horn circle touches the axis, but the revolved outer
# semicircle is trimmed away from it and bounds a valid annular solid.
from OCP.BRepCheck import BRepCheck_Analyzer
profile=Face(Wire([Edge.make_three_point_arc((4,0,-4),(8,0,0),(4,0,4)),Edge.make_line((4,0,4),(4,0,-4))]))
annular=Solid.revolve(profile,360,Axis.Z)
for variant in ['V0','V1','V2','V3']:
 placed=zone_frame('AC48',variant).transform(annular)
 with tempfile.TemporaryDirectory() as d:
  export_step(placed.wrapped,d+'/annular.step')
  for stage,shape,resolution in [('native',placed.wrapped,0),('STEP',read_step(d+'/annular.step'),1e-7)]:
   assert BRepCheck_Analyzer(shape).IsValid(),(variant,stage)
   t,raw,h=canonical(shape,coordinate_resolution=resolution)
   assert h.get('SurfaceOfRevolution')==1,(variant,stage,h)
   assert (t['singularPoints'],t['pinchPoints'],t['genus'])==(0,0,1),(variant,stage,t,raw,h)
# Force the same SurfaceOfRevolution representation for contact and positive
# holes, so an OCCT Torus optimisation cannot make this assertion pass.
for gap in [0,1e-12]:
 meridian=Geom_Circle(gp_Ax2(gp_Pnt(4+gap,0,0),gp_Dir(0,-1,0)),4)
 surface=Geom_SurfaceOfRevolution(meridian,gp_Ax1(gp_Pnt(0,0,0),gp_Dir(0,0,1)))
 local=Face(BRepBuilderAPI_MakeFace(surface,1e-7).Face())
 for variant in ['V0','V1','V2','V3']:
  face=zone_frame('AC48',variant).transform(local).wrapped
  adaptor=BRepAdaptor_Surface(face)
  assert surface_class(adaptor)=='SurfaceOfRevolution'
  contacts,_=revolution_axis_contacts(adaptor,face)
  assert len(contacts)==(1 if gap==0 else 0),(gap,variant,contacts)
# A trimmed open patch of the same surface also excludes the contact.
import math
meridian=Geom_Circle(gp_Ax2(gp_Pnt(4,0,0),gp_Dir(0,-1,0),gp_Dir(1,0,0)),4)
surface=Geom_SurfaceOfRevolution(meridian,gp_Ax1(gp_Pnt(0,0,0),gp_Dir(0,0,1)))
local=Face(BRepBuilderAPI_MakeFace(surface,0,2*math.pi,-math.pi/4,math.pi/4,1e-7).Face())
for variant in ['V0','V1','V2','V3']:
 face=zone_frame('AC48',variant).transform(local).wrapped
 contacts,_=revolution_axis_contacts(BRepAdaptor_Surface(face),face)
 assert len(contacts)==0,(variant,contacts)
print('real revolves and positive-hole counterexamples verified')`;
  const r=spawnSync('uv',['run','--no-project',path.join(ROOT,'out/build123d-performance/reference-venv/bin/python'),'-B','-c',program,ROOT],{encoding:'utf8',timeout:120000,maxBuffer:1<<20});
  assert.equal(r.status,0,r.stderr+'\n'+r.stdout);assert.match(r.stdout,/counterexamples verified/);
});

test('fresh frozen real-revolve observations score and overflow refusal names its capability',async()=>{
  const {verifyStoredReferences}=await import('../scripts/acid/execution.mjs');
  const {scoreVariant}=await import('../scripts/acid/score.mjs');
  const os=await import('node:os');
  const data=JSON.parse(fs.readFileSync(path.join(ROOT,'fixtures/cad-acid/occt-ext/catalog-errata/observations.json')));
  const out=fs.mkdtempSync(path.join(os.tmpdir(),'catalog-errata-freeze-'));
  try {
    await verifyStoredReferences(data,{out});
    assert.equal(data.rows.length,16);
    for(const row of data.rows){
      assert.equal(scoreVariant(catalog,catalog.zones.find(z=>z.id===row.zone),'occt',row).status,row.zone==='AC31'?'REFUSED':'CORRECT',row.zone+'/'+row.variant);
      if(row.zone==='AC31'){
        assert.equal(row.refusal.capability,true);
        assert.match(row.error.message,/opFillet edge overflow/);
      }
    }
  } finally {fs.rmSync(out,{recursive:true,force:true});}
});
