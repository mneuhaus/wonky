import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const python=path.join(ROOT,'out/build123d-performance/reference-venv/bin/python');
const script=path.join(ROOT,'scripts/acid/tolerance-witness.py');
const evidence=path.join(ROOT,'fixtures/cad-acid/occt');
const run=(args,timeout=120000)=>spawnSync('uv',['run','--no-project',python,...args],{
  encoding:'utf8',timeout,maxBuffer:4<<20,env:{...process.env,NODE_OPTIONS:'--max-old-space-size=8192'}});

function assertCylinderBody(body,center) {
  assert.equal(body.valid,true);
  assert.equal(body.closed,true);
  assert.equal(body.nondegenerateEdges,true);
  assert.equal(body.allFacesSingleWire,true);
  assert.equal(body.unsupportedFaces,0);
  assert.equal(body.rawEuler,2);
  assert.equal(body.rawGenus,0);
  assert.equal(body.planes.length,2);
  assert(body.cylinders.length>=1);
  for(const support of body.cylinders){
    assert(Math.abs(support.radius-4)<1e-7);
    assert(Math.abs(support.axisOrigin[0]-center)<1e-6);
    assert(Math.abs(support.axisOrigin[1])<1e-6);
    assert(Math.abs(support.axisDirection[2]-1)<1e-7);
    assert(Math.abs(support.zMin)<1e-6);
    assert(Math.abs(support.zMax-16)<1e-6);
  }
  const byHeight=body.planes.toSorted((a,b)=>a.origin[2]-b.origin[2]);
  for(const [i,cap] of byHeight.entries()){
    assert(Math.abs(cap.origin[2]-16*i)<1e-6);
    assert(Math.abs(cap.area-16*Math.PI)<1e-6);
  }
  assert(Math.abs(body.volume-256*Math.PI)<1e-5);
  assert(Math.abs(body.area-160*Math.PI)<1e-5);
}

test('frozen STEP support independently establishes genus zero despite split-face canonical genus',()=>{
  const reference=JSON.parse(fs.readFileSync(path.join(evidence,'observations.json')));
  const witness=JSON.parse(fs.readFileSync(path.join(evidence,'tolerance-witness.json')));
  const selected=witness.rows.filter(row=>['AC22','AC44'].includes(row.zone));
  assert.equal(selected.length,8);
  for(const row of selected){
    const source=reference.rows.find(r=>r.kernel===row.kernel&&r.zone===row.zone&&r.variant===row.variant);
    assert.equal(source.metrics.topology.genus,-0.5,'strict canonical v1 is intentionally unchanged');
    assert.equal(source.stepImport.topology.genus,0,'raw STEP import differs from native canonical');
    assert.equal(row.nativeRawFromFrozenObservationOnly.length,2);
    for(const native of row.nativeRawFromFrozenObservationOnly){
      assert.equal(native.rawEuler,2);
      assert.equal(native.rawGenus,0);
    }
    for(const stage of ['stepImport','stepRoundTrip']){
      const physical=row.witness[stage];
      assert.equal(physical.valid,true);
      assert.equal(physical.closed,true);
      assert.equal(physical.bodies.length,2);
      for(const [index,body] of physical.bodies.entries())assertCylinderBody(body,8*index);
    }
  }
});

test('observer rejects wrong radius, extra through-hole and face-only topology at STEP boundary',t=>{
  if(!fs.existsSync(python)){t.skip('REFERENCE_VENV_UNAVAILABLE');return;}
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'acid-physical-witness-'));
  try {
    const make=`import sys
sys.path.insert(0,sys.argv[1])
from measure import export_step,entities,TopAbs_FACE
from OCP.BRepPrimAPI import BRepPrimAPI_MakeCylinder
from OCP.BRepAlgoAPI import BRepAlgoAPI_Cut
from OCP.BRep import BRep_Builder
from OCP.TopoDS import TopoDS_Compound
from OCP.gp import gp_Ax2,gp_Pnt,gp_Dir
from pathlib import Path
out=Path(sys.argv[2])
def cylinder(x,r): return BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(x,0,0),gp_Dir(0,0,1)),r,16).Shape()
def group(*solids):
 c=TopoDS_Compound();b=BRep_Builder();b.MakeCompound(c)
 for s in solids:b.Add(c,s)
 return c
export_step(group(cylinder(0,5),cylinder(8,4)),out/'wrong-radius.step')
cut=BRepAlgoAPI_Cut(cylinder(0,4),cylinder(0,1));cut.Build()
assert cut.IsDone()
export_step(group(cut.Shape(),cylinder(8,4)),out/'extra-hole.step')
export_step(entities(cylinder(0,4),TopAbs_FACE)[0],out/'face-only.step')
`;
    const generated=run(['-c',make,path.join(ROOT,'scripts/acid'),directory]);
    assert.equal(generated.status,0,generated.stderr);
    const inspect=name=>{
      const output=path.join(directory,name+'.json');
      const result=run([script,'inspect','--step',path.join(directory,name+'.step'),
        '--zone','AC22','--variant','V0','--out',output]);
      assert.equal(result.status,0,result.stderr);
      return JSON.parse(fs.readFileSync(output)).witness.stepImport;
    };
    const radius=inspect('wrong-radius');
    assert.equal(radius.bodies.length,2);
    assert(radius.bodies.some(body=>body.cylinders.some(c=>Math.abs(c.radius-4)>0.5)));
    const hole=inspect('extra-hole');
    assert.equal(hole.bodies.length,2);
    assert(hole.bodies.some(body=>body.rawGenus===1||body.planes.length!==2));
    const face=inspect('face-only');
    assert.equal(face.valid,false);
    assert.equal(face.closed,false);
    assert.equal(face.bodies.length,0);
  }finally{fs.rmSync(directory,{recursive:true,force:true});}
});
