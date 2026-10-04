// Interpreter/query transport and independent export agreement. Native tests
// own the geometric predicates and carrier corruption controls.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
process.env.WONKY_BACKEND='rust';
const {build}=await import('../src/index.mjs');
const {toStep}=await import('../src/exporters.mjs');
const {serializeModel}=await import('../src/construction-history.mjs');
const root=fileURLToPath(new URL('../',import.meta.url));
test('circular rim chamfers preserve queries and sewn conical faces through STEP reimport',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wonky-conical-rim-'));
  try{
    const prefixes=[];
    const identity='vector(1,0,0),vector(0,0,1)';
    const rotated='vector(0,0,1),vector(0,-1,0)';
    const oblique='vector(0.9953610106153096,0.08075849942674315,-0.05229266982293196),vector(0.05443374184663523,-0.024540530893688527,0.9982157733135806)';
    for(const [index,{axes,ends}] of [
      {axes:identity,ends:[0.5]}, {axes:rotated,ends:[0.5]}, {axes:oblique,ends:[0.5]},
      {axes:rotated,ends:[0]}, {axes:oblique,ends:[0,0.5]},
    ].entries()){
      const model=await build(`FeatureScript 3044; import(path:"onshape/std/geometry.fs",version:"3044.0");
      export const f=defineFeature(function(context is Context,id is Id,definition is map) precondition {} {
        const cs=coordSystem(vector(65536.25,-32768.5,16384.125)*millimeter,${axes});
        const axis=toWorld(cs).linear*vector(0,0,1);
        var s=newSketchOnPlane(context,id+"s",{"sketchPlane":plane(toWorld(cs,vector(0,0,0)*meter),axis,cs.xAxis)});
        skCircle(s,"c",{"center":vector(0.125,-0.25)*meter,"radius":0.25*meter}); skSolve(s);
        opExtrude(context,id+"post",{"entities":qSketchRegion(id+"s"),"direction":axis,"endBound":BoundingType.BLIND,"endDepth":0.5*meter});
        const body=qCreatedBy(id+"post",EntityType.BODY);
        const rim=qUnion([${ends.map(z=>`qClosestTo(qOwnedByBody(body,EntityType.EDGE),toWorld(cs,vector(-0.125,-0.25,${z})*meter))`).join(',')}]);
        opChamfer(context,id+"rim",{"entities":rim,"chamferType":ChamferType.EQUAL_OFFSETS,"width":0.0625*meter});
        if(size(evaluateQuery(context,qGeometry(qOwnedByBody(body,EntityType.FACE),GeometryType.CONE)))!=${ends.length})throw "conical face missing";
      });`,{feature:'f'});
      assert.equal(model.bodies.length,1);
      assert.equal(model.bodies[0].validation.certificate,'ConicalRim');
      const prefix=path.join(dir,`rim-${index}`);
      fs.writeFileSync(prefix+'.step',toStep(model,'rim'));
      fs.writeFileSync(prefix+'.brep.json',serializeModel(model));
      prefixes.push(prefix);
    }
    const result=spawnSync('uv',['run',path.join(root,'scripts/validate-step.py'),...prefixes],{cwd:root,encoding:'utf8',timeout:120000,maxBuffer:8*1024*1024});
    assert.equal(result.status,0,result.stderr||result.stdout||String(result.error));
    assert.equal(JSON.parse(result.stdout).length,prefixes.length);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
