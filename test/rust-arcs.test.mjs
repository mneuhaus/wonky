// The public FS transport owns arc ordering, reverse-depth and serialization.
// Independent closed forms protect the result, never private carrier layout.
import test from 'node:test';
import assert from 'node:assert/strict';
process.env.WONKY_BACKEND = 'rust';
const {build}=await import('../src/index.mjs');
const {toStep}=await import('../src/exporters.mjs');
const {serializeModel}=await import('../src/construction-history.mjs');
const {measureRustBody,rustModelKernel}=await import('../src/native/rust-host.mjs');
const source=body=>`FeatureScript 3044; import(path:"onshape/std/geometry.fs",version:"3044.0");
export const f=defineFeature(function(context is Context,id is Id,definition is map) precondition {} {${body}});`;
const sketch=`var s=newSketchOnPlane(context,id+"s",{"sketchPlane":plane(vector(0,0,0)*meter,vector(0,0,1),vector(1,0,0))});`;
const extrude=(reverse=false)=>`skSolve(s);opExtrude(context,id+"e",{"entities":qSketchRegion(id+"s"),"direction":vector(0,0,${reverse?-1:1}),"endBound":BoundingType.BLIND,"endDepth":0.5*meter});`;
const chain=(count=1)=>{
  const lines=[];
  for(let i=0;i<count;i++){
    const a=1+i*8/count,b=1+(i+1)*8/count;
    lines.push(`skLineSegment(s,"bottom${i}",{"start":vector(${a},0)*meter,"end":vector(${b},0)*meter});`);
    lines.push(`skLineSegment(s,"top${i}",{"start":vector(${a},2)*meter,"end":vector(${b},2)*meter});`);
  }
  // Deliberately unordered, with the upper line running opposite the boundary.
  return lines.join('\n')+`skArc(s,"left",{"start":vector(1,2)*meter,"mid":vector(0,1)*meter,"end":vector(1,0)*meter});
    skArc(s,"right",{"start":vector(9,0)*meter,"mid":vector(10,1)*meter,"end":vector(9,2)*meter});`;
};
const near=(actual,expected,rel=1e-10)=>assert.ok(Math.abs(actual-expected)<=rel*Math.max(1,Math.abs(expected)),`${actual} != ${expected}`);
test('unordered mixed arcs retain exact cylindrical trims, volume, probes and reversed depth',async()=>{
  for(const reverse of [false,true]){
    const model=await build(source(sketch+chain()+extrude(reverse)),{feature:'f'});
    assert.equal(model.bodies.length,1);
    const z=reverse?-250:250;
    const m=measureRustBody(rustModelKernel(model),model.bodies[0],{probes:[[13000,1000,z],[5000,5000,z],[5000,1000,z],[10000,1000,z]]});
    near(m.volumeMm3,(16+Math.PI)*0.5e9);
    near(m.areaMm2,(2*(16+Math.PI)+0.5*(16+2*Math.PI))*1e6);
    assert.equal(m.topology.faces,6);assert.equal(m.topology.edges,12);assert.equal(m.topology.vertices,8);
    for(let i=0;i<4;i++){assert.ok(!m.probes[i].refused);near(m.probes[i].distanceMm,[3000,3000,0,0][i]);}
    assert.equal(m.probes[2].inside,true);assert.equal(m.probes[3].inside,true);
    near(m.centroidMm[0],5000);near(m.centroidMm[1],1000);near(m.centroidMm[2],z);
    const record=JSON.parse(serializeModel(model)).bodies[0];assert.equal(record.faces.length,6);
    const step=toStep(model,'arc-chain');assert.equal(step.match(/CYLINDRICAL_SURFACE\(/g)?.length,2);assert.equal(step.match(/CIRCLE\(/g)?.length,4);
  }
});
test('432-segment tangent chain preserves 286 analytic arcs without a small-profile ceiling',async()=>{
  const pieces=[];
  const line=(a,b)=>pieces.push(`skLineSegment(s,"e${pieces.length}",{"start":vector(${a})*meter,"end":vector(${b})*meter});`);
  const arc=(a,mid,b)=>pieces.push(`skArc(s,"e${pieces.length}",{"start":vector(${a})*meter,"mid":vector(${mid})*meter,"end":vector(${b})*meter});`);
  // Integer 3-4-5 circle points produce exactly tangent quarter arcs. Each
  // 40-wide wave has area 200 above its baseline, by reflection symmetry.
  for(let j=0;j<71;j++){
    const x=j*40;
    arc([x,0],[x+3,1],[x+5,5]); arc([x+5,5],[x+7,9],[x+10,10]);
    line([x+10,10],[x+20,10]);
    arc([x+20,10],[x+23,9],[x+25,5]); arc([x+25,5],[x+27,1],[x+30,0]);
    line([x+30,0],[x+40,0]);
  }
  const width=71*40;
  arc([width,0],[width+5,-5],[width,-10]);
  for(let j=0;j<4;j++)line([width*(4-j)/4,-10],[width*(3-j)/4,-10]);
  arc([0,-10],[-5,-5],[0,0]);
  const model=await build(source(sketch+pieces.join('\n')+extrude()),{feature:'f'});
  const m=measureRustBody(rustModelKernel(model),model.bodies[0]);
  near(m.volumeMm3,(width*15+25*Math.PI)*0.5e9);
  assert.equal(m.topology.faces,434);assert.equal(m.topology.edges,1296);
  assert.equal(toStep(model,'long-chain').match(/CYLINDRICAL_SURFACE\(/g)?.length,286);
});
test('collinear arcs and disconnected mixed endpoints refuse instead of inventing closure',async()=>{
  const invalid=[chain().replace('vector(10,1)','vector(9,1)'),chain().replace('vector(9,2)*meter});','vector(9.000001,2)*meter});')];
  for(const body of invalid)await assert.rejects(build(source(sketch+body+extrude()),{feature:'f'}),e=>e.name==='RustCapabilityError'&&e.reason.startsWith('arc-profile/'));
});
