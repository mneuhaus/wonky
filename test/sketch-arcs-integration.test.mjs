import test from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missingBend() || missing("fixtures/r10b/r10b.fs");
if (publicTreeSkip) {
  test("sketch-arcs-integration.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { readFileSync, mkdirSync, writeFileSync } = await import("node:fs");
const { createHash } = await import("node:crypto");
const { build } = await import("../src/index.mjs");
const { array, loadKernel } = await import("../src/kernel.mjs");
const { transformAnalytic } = await import("../src/analytic.mjs");
const { toStep } = await import("../src/exporters.mjs");
const { UnsupportedFeatureError } = await import("../src/errors.mjs");










const frozen = readFileSync(new URL('../fixtures/r10b/r10b.fs', import.meta.url), 'utf8');
const originalArea = 9.648054371424785598135941652668;
const out = new URL('../out/sketch-arcs-integration/', import.meta.url);
mkdirSync(out, { recursive: true });
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);
const save = (name, model) => {
  writeFileSync(new URL(`${name}.brep.json`, out), JSON.stringify(model, null, 2) + '\n');
  writeFileSync(new URL(`${name}.step`, out), toStep(model, name));
};
const originalCall = relief => `${frozen}\nexport function arcAcceptance(context is Context, id is Id, definition is map) {
  m3HybridTool(context, id + "M3", vector(-70,8,48)*millimeter, vector(0,0,-1), 8*millimeter, vector(1,0,0), ${relief});
}`;
const arcCall = r => `skArc(s,"round",{"start":vector(${r},0)*millimeter,"mid":vector(0,${r})*millimeter,"end":vector(-${r},0)*millimeter});`;
const lineCall = r => `skLineSegment(s,"base",{"start":vector(-${r},0)*millimeter,"end":vector(${r},0)*millimeter});`;
const modelSource = (calls, { direction='vector(0,0,1)', afterSolve='', solve='skSolve(s);', bounds='' }={}) => `FeatureScript 3044;
import(path:"onshape/std/common.fs",version:"3044.0");
export function main(context is Context,id is Id,definition is map) {
  var s=newSketchOnPlane(context,id+"s",{"sketchPlane":plane(vector(0,0,0)*millimeter,vector(0,0,1),vector(1,0,0))});
  ${calls}
  ${solve}
  ${afterSolve}
  opExtrude(context,id+"ex",{"entities":qSketchRegion(id+"s",false),"direction":${direction},"endBound":BoundingType.BLIND,"endDepth":5*millimeter${bounds}});
}`;

test('unchanged real r10b M3 helper executes original skArc calls and exports an analytic Bend body', async () => {
  assert.equal(createHash('sha256').update(frozen).digest('hex'), '219ee9630f37f9e54fe7e1b4e09094ab25748a811ed8f9e8b9ebf4892d8b8349');
  const source = originalCall(false), model = await build(source, { feature:'arcAcceptance', sourcePath:'/models/r10b-arc-acceptance.fs' });
  assert.equal(model.bodies.length, 1);
  const body = model.bodies[0];
  assert.equal(body.validation.closed, true);
  assert.deepEqual([body.vertices.length,body.edges.length,body.faces.length],[24,36,14]);
  near(body.validation.volumeMm3, originalArea * 8);
  assert.equal(body.constructionBudget.ceilingMm, 0);
  assert.ok(body.construction.sourceEndpointGapMm > 0);
  assert.ok(body.construction.requiredIncidenceMm <= body.construction.allowanceMm);
  assert.equal(body.sketchProfile.entities.length,12);
  assert.deepEqual(body.sketchProfile.entities.map(e=>e.id),Array.from({length:12},(_,i)=>`a${i}`));
  assert.equal(body.edges.filter(e=>e.curve.type==='circle').length,24);
  assert.equal(body.faces.filter(f=>f.surface.type==='cylinder').length,12);
  assert.ok(body.edges.every(e=>e.curveRange?.length===2));
  const calls=model.sourceMap.operations.filter(op=>op.name==='skArc');
  assert.equal(calls.length,12);
  assert.ok(calls.every(op=>op.status==='completed' && source.split('\n')[op.source.span.line-1].includes('skArc')));
  assert.ok(body.identity.topology.faces.slice(2).every(face=>face.source.kind==='sketch-entity' && face.source.span.line===calls[0].source.span.line));
  assert.equal(body.identity.operation.source.file,'/models/r10b-arc-acceptance.fs');
  const moved=transformAnalytic(await loadKernel(),body,'moved-m3',[[0,-1,0],[1,0,0],[0,0,1]],[10,20,30]);
  near(moved.validation.volumeMm3,originalArea*8);
  assert.equal(moved.constructionBudget.ceilingMm,0);
  assert.deepEqual(moved.sketchProfile,body.sketchProfile);
  assert.deepEqual(moved.identity.topology.faces.slice(2).map(f=>f.source),body.identity.topology.faces.slice(2).map(f=>f.source));
  save('r10b-m3-original-calls',model);
  save('r10b-m3-moved',{...model,bodies:[moved]});
});

test('mixed named line/arc entities retain analytic geometry and IDs across insertion order and radius edits', async () => {
  const first=(await build(modelSource(arcCall(2)+lineCall(2)))).bodies[0];
  const reordered=(await build(modelSource(lineCall(2)+arcCall(2)))).bodies[0];
  const enlarged=(await build(modelSource(arcCall(3)+lineCall(3)))).bodies[0];
  const geometry=b=>({vertices:b.vertices,edges:b.edges,faces:b.faces});
  assert.deepEqual(geometry(first),geometry(reordered));
  near(first.validation.volumeMm3,10*Math.PI); near(enlarged.validation.volumeMm3,22.5*Math.PI);
  const ids=b=>Object.values(b.identity.topology).flat().map(e=>e.originId);
  assert.deepEqual(ids(reordered),ids(first)); assert.deepEqual(ids(enlarged),ids(first));
  assert.notEqual(first.identity.revision,enlarged.identity.revision);
  for(const body of [first,reordered,enlarged]) {
    assert.deepEqual(new Set(body.identity.topology.faces.slice(2).map(e=>e.source.entityId)),new Set(['base','round']));
    assert.equal(body.sketchProfile.entities.filter(e=>e.type==='line').length,1);
    assert.equal(array(body.sketchProfile.native.source).length,2);
  }
  save('semicircle',await build(modelSource(arcCall(2)+lineCall(2))));
});

test('negative sweeps and two-sided bounds preserve source-relative start/end identity roles', async () => {
  for(const [name,options,zStart,zEnd,volume] of [
    ['negative',{direction:'vector(0,0,-1)'},0,-5,10*Math.PI],
    ['two-sided',{bounds:',"startBound":BoundingType.BLIND,"startDepth":2*millimeter'},-2,5,14*Math.PI],
  ]) {
    const model=await build(modelSource(arcCall(2)+lineCall(2),options)),body=model.bodies[0];
    near(body.validation.volumeMm3,volume);
    for(const [role,z] of [['cap/start',zStart],['cap/end',zEnd]]) {
      const index=body.identity.topology.faces.findIndex(face=>face.role===role);
      assert.ok(index>=0); near(body.faces[index].surface.origin[2],z);
    }
    save(name,model);
  }
});

test('skArc enforces fields, entity identity, units, profile modes and solved mutability', async () => {
  const circle='skCircle(s,"circle",{"center":vector(0,0)*millimeter,"radius":2*millimeter});';
  for(const calls of [arcCall(2)+circle,circle+arcCall(2)]) await assert.rejects(build(modelSource(calls)),/cannot mix/);
  for(const [calls,pattern] of [
    [arcCall(2)+arcCall(2),/nonempty and unique/],
    [arcCall(2).replace('"round"','""'),/nonempty and unique/],
    [arcCall(2).replace('"mid":','"wrong":'),/Missing required field 'mid'/],
    [arcCall(2).replace('vector(2,0)*millimeter','vector(2,0)'),/length with units/],
    [arcCall(2).replace('});',',"construction":true});'),/Construction sketch geometry/],
  ]) await assert.rejects(build(modelSource(calls)),pattern);
  await assert.rejects(build(modelSource(arcCall(2)+lineCall(2),{afterSolve:arcCall(3)})),/already been solved/);
});

test('unsupported arc profiles and oblique sweeps remain fatal inside try silent', async () => {
  const open=arcCall(2)+lineCall(2).replace('vector(2,0)','vector(2.001,0)');
  const collinear=arcCall(2).replace('vector(0,2)','vector(0,0)')+lineCall(2);
  for(const calls of [open,collinear]) await assert.rejects(build(modelSource(calls,{solve:'try silent(skSolve(s));'})),error=>{
    assert.ok(error instanceof UnsupportedFeatureError);
    assert.equal(error.modelTrace.operations.find(op=>op.name==='skSolve').status,'failed');
    assert.equal(error.modelTrace.operations.some(op=>op.name==='opExtrude'),false);
    return true;
  });
  await assert.rejects(build(modelSource(arcCall(2)+lineCall(2),{direction:'vector(1,0,1)'})),/NonNormalSweep/);
});

test('original relief request revolves its relief after the arc extrusion and unions it through the hybrid Boolean', async () => {
  // The relief cone meets the arc core's off-axis cylinders in space quartics:
  // no exact arm admits the union, and the hybrid answers a certified mesh.
  const model = await build(originalCall(true),{feature:'arcAcceptance'});
  assert.equal(model.bodies.length, 1);
  const evidence = model.operationEvidence.find(e => e.method === 'hybrid corefine+recover');
  assert.equal(evidence?.status, 'mesh');
  assert.equal(model.bodies[0].approximation?.label, 'approximation');
});

}
