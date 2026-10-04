import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {loadCatalog, ROOT} from '../scripts/acid/common.mjs';
import {scoreVariant} from '../scripts/acid/score.mjs';

const {catalog}=loadCatalog();
const program=String.raw`import sys,json,importlib.util
from pathlib import Path
sys.path.insert(0,'scripts/acid')
from measure import *
from extrusion_support import extrusion_support
spec=importlib.util.spec_from_file_location('frozen','scripts/acid/frozen-onshape.py')
frozen=importlib.util.module_from_spec(spec);spec.loader.exec_module(frozen)
c=json.load(open('fixtures/cad-acid/zones.json')); rows=[]; checked=0; mutated=0
for v in ['V0','V1','V2','V3','V4','V5']:
 for item in frozen.named_solids(Path('fixtures/cad-acid/onshape-ext/N24/studios/acid-'+v+'/model.step')):
  zid=item['zone']
  if zid not in ['AC100','AC101','AC102','AC106','AC108']:continue
  z=next(z for z in c['zones'] if z['id']==zid);shape=item['solid']
  raw=observe(shape,z,c,v); semantic=observe(shape,z,c,v,reference_surface_semantics=True)
  assert raw['volume']==semantic['volume'] and raw['topology']==semantic['topology']
  if zid in ['AC100','AC101','AC102']:
   assert semantic['surfaceTypes']==z['closedForm']['topology']['surfaceTypes'],(zid,v,semantic['surfaceTypes'])
   assert raw['surfaceTypes'].get('BSplineSurface') in (1,32),(zid,v)
   for face in entities(shape,TopAbs_FACE):
    a=BRepAdaptor_Surface(face)
    if surface_class(a)!='BSplineSurface':continue
    b=a.BSpline();p=extrusion_support(b,1e-7);assert p is not None
    assert p['translationErrorBoundMm']<=1e-7
    checked+=1
    # Change one row's interior pole; degree one alone does not prove extrusion.
    pt=b.Pole(2,2);pt.SetX(pt.X()+0.1);b.SetPole(2,2,pt)
    assert extrusion_support(b,1e-7) is None,(zid,v,'non-extruded planted spline')
    mutated+=1
    pt.SetX(pt.X()-0.1);b.SetPole(2,2,pt)
    b.SetWeight(2,2,1.1)
    assert extrusion_support(b,1e-7) is None,(zid,v,'unsupported rational spline')
   # Raw writer mode must retain the literal surface class even for exact nets.
   assert raw['surfaceRepresentation']['referenceSemantics'] is False
  else:
   local=local_shape(shape,frame(c,z,v));residual=0;edge_tol=0
   r=2+(0.025 if v=='V4' else 0);R=r+3;d=2 if zid=='AC108' else 0
   for e in entities(local,TopAbs_EDGE):
    a=BRepAdaptor_Curve(e)
    if str(a.GetType()).endswith('GeomAbs_BSplineCurve') and a.BSpline().Degree()>1:
     edge_tol=max(edge_tol,BRep_Tool.Tolerance_s(e))
     for i in range(1001):
      t=a.FirstParameter()+(a.LastParameter()-a.FirstParameter())*i/1000;p=a.Value(t)
      residual=max(residual,abs(math.hypot(p.X(),p.Y())-R),abs(math.hypot(p.Y()-d,p.Z())-r))
   assert residual>0.001 and edge_tol>0.001,(zid,v,residual,edge_tol)
   cf=z.get('closedFormByVariant',{}).get(v,z['closedForm'])
   assert abs(raw['volume']-float(cf['volume']['value']))/float(cf['volume']['value'])>z['tolerance']['volumeRel']['tolerance']
   assert abs(raw['area']-float(cf['area']['value']))/float(cf['area']['value'])>z['tolerance']['areaRel']['tolerance']
  # Production scorer gets real imported metrics; supplied duplicate stage here
  # isolates scoring semantics, not evidence of an executed STEP round trip.
  rows.append({'kernel':'onshape','zone':zid,'variant':v,'outcome':'built','nativeValidity':True,
   'metrics':semantic,'stepRoundTrip':{'ok':True,'metrics':semantic}})
print(json.dumps({'checked':checked,'mutated':mutated,'rows':rows}))`;

test('N24 reference extrusion proof rejects warped pole nets; cross-bores exceed unchanged acceptance bands',{skip: !process.getBuiltinModule('node:fs').existsSync(new URL('../out/build123d-performance/reference-venv/bin/python', import.meta.url)) && 'REFERENCE_VENV_UNAVAILABLE: build123d/OCCT reference observer'},()=>{
 const r=spawnSync('out/build123d-performance/reference-venv/bin/python',['-B','-c',program],{cwd:ROOT,encoding:'utf8',timeout:180000,maxBuffer:8<<20});
 assert.equal(r.status,0,r.stderr+'\n'+r.stdout.slice(-3000));
 const data=JSON.parse(r.stdout.trim());
 assert.equal(data.checked,202);assert.equal(data.mutated,202);
 assert.equal(data.rows.length,26);
 for(const row of data.rows){
  const z=catalog.zones.find(z=>z.id===row.zone);
  const verdict=scoreVariant(catalog,z,'onshape',row);
  assert.equal(verdict.status,['AC106','AC108'].includes(z.id)?'WRONG':'CORRECT',`${z.id}/${row.variant}: ${verdict.reason}`);
 }
});
