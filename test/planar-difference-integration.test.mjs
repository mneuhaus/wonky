import test from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missingBend();
if (publicTreeSkip) {
  test("planar-difference-integration.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { readFileSync, mkdirSync, writeFileSync } = await import("node:fs");
const { build } = await import("../src/index.mjs");
const { loadKernel, array } = await import("../src/kernel.mjs");
const { transformAnalytic } = await import("../src/analytic.mjs");
const { classifySolid } = await import("../src/solid-classification.mjs");
const { createGeometryInspector } = await import("../src/geometry-summary.mjs");
const { toStep } = await import("../src/exporters.mjs");
const { UnsupportedFeatureError } = await import("../src/errors.mjs");











const source=readFileSync(new URL('../fixtures/public-boolean-regressions/adapted/cut-h1.fs',import.meta.url),'utf8');
const out=new URL('../out/planar-difference-integration/',import.meta.url);
mkdirSync(out,{recursive:true});
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-9,`${a} != ${b}`);
const save=(name,model)=>{
  writeFileSync(new URL(`${name}.brep.json`,out),JSON.stringify(model,null,2)+'\n');
  writeFileSync(new URL(`${name}.step`,out),toStep(model,name));
};
const cube=(name,lo,hi)=>`fCuboid(context,id+"${name}",{"corner1":vector(${lo})*millimeter,"corner2":vector(${hi})*millimeter});`;
const script=(a,b,extra='')=>`FeatureScript 3044;
import(path:"onshape/std/geometry.fs",version:"3044.0");
export function main(context is Context,id is Id,definition is map) {
${cube('sentinel','20,20,20','21,21,21')}
${cube('a',...a)}
${cube('b',...b)}
${extra.includes('silent')?'try silent(':''}opBoolean(context,id+"cut",{"targets":qCreatedBy(id+"a",EntityType.BODY),"tools":qCreatedBy(id+"b",EntityType.BODY),"operationType":BooleanOperationType.SUBTRACTION${extra.includes('keep')?',"keepTools":true':''}})${extra.includes('silent')?')':''};
}`;

test('public cut-h1 executes through FeatureScript with reversed tool provenance and preserved transformed measures',async()=>{
  const model=await build(source,{sourcePath:'/fixtures/cut-h1.fs'}),body=model.bodies[0];
  assert.equal(model.bodies.length,1);assert.equal(body.validation.closed,true);near(body.validation.volumeMm3,22);
  assert.equal(body.construction.operation,'SUBTRACTION');assert.equal(body.constructionBudget.ceilingMm,0);
  const toolFaces=body.construction.faceOrigins.map((origin,i)=>array(origin.contributors).some(ref=>ref.operand===1)?i:-1).filter(i=>i>=0);
  assert.ok(toolFaces.length>0);
  const inspector=createGeometryInspector(model);
  for(const index of toolFaces){
    const detail=inspector.detail({modelId:inspector.modelId,alias:`B1.F${index+1}`}).constructionOrigin;
    assert.ok(detail.references.some(ref=>ref.operand===1 && ref.reversed && ref.status==='recorded-input-reference'));
    for(const ref of detail.references)assert.equal(ref.reversed,ref.operand===1);
  }
  for(const [point,kind] of [[[0.5,2.5,0.5],'Inside'],[[0.5,2.5,1.5],'Outside'],[[2.5,2.5,1.5],'Outside'],[[1.5,1,1],'Outside'],[[1.5,4,1],'Inside']])
    assert.equal((await classifySolid(body,point)).$ ,kind);
  const kernel=await loadKernel(),rows=[[0,-1,0],[1,0,0],[0,0,1]],offset=[10,20,30];
  const moved=transformAnalytic(kernel,body,'moved-cut',rows,offset);
  near(moved.validation.volumeMm3,22);assert.deepEqual(moved.validation.boundsMm,{min:[5,20,30],max:[10,23,32]});
  assert.equal(moved.construction.operation,'SUBTRACTION');assert.equal(moved.constructionBudget.ceilingMm,0);
  assert.deepEqual(moved.operationHistory.at(-1).transformChain.at(-1),{operationId:'moved-cut',rows,offsetMm:offset});
  save('cut-h1',model);save('cut-h1-moved',{...model,bodies:[moved]});
});

test('keepTools retains its original solid, while complete removal records an empty native result',async()=>{
  const kept=await build(source.replace('"operationType" : BooleanOperationType.SUBTRACTION','"keepTools" : true, "operationType" : BooleanOperationType.SUBTRACTION'));
  assert.equal(kept.bodies.length,2);assert.deepEqual(kept.bodies.map(b=>b.validation.volumeMm3).sort((a,b)=>a-b),[15,22]);
  assert.equal(kept.operationEvidence.at(-1).outputs.length,1);save('cut-h1-kept-tool',kept);
  for(const keep of [false,true]){
    const empty=await build(script(['0,0,0','2,2,2'],['-1,-1,-1','3,3,3'],keep?'keep':''));
    assert.equal(empty.bodies.length,keep?2:1);
    assert.equal(empty.operationEvidence.at(-1).operation,'SUBTRACTION');
    assert.deepEqual(empty.operationEvidence.at(-1).outputs,[]);
    assert.equal(empty.sourceMap.operations.find(op=>op.name==='opBoolean').status,'completed');
    assert.ok(empty.bodies.some(body=>body.id==='model/sentinel'));
  }
});

test('enclosed void shells fail atomically through FeatureScript and cannot be hidden by try silent',async()=>{
  await assert.rejects(build(script(['0,0,0','4,4,4'],['1,1,1','3,3,3'],'silent')),error=>{
    assert.ok(error instanceof UnsupportedFeatureError);assert.match(error.message,/stage 10.*\[hybrid: the recovered result has 1 enclosed void shell/);
    const evidence=error.completedOperationEvidence.at(-1);
    assert.equal(evidence.operation,'SUBTRACTION');assert.equal(evidence.status,'Refused');assert.equal(evidence.declined.stage,10);assert.equal(evidence.outputs,undefined);
    const call=error.modelTrace.operations.find(op=>op.name==='opBoolean');
    assert.equal(call.status,'failed');assert.deepEqual(call.outputs,[]);assert.deepEqual(call.removedBodies,[]);
    return true;
  });
});

}
