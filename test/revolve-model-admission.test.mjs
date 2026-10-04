// V1 stays a library-only Model producer until V2 owns interpreter admission.
import test from 'node:test';
import assert from 'node:assert/strict';
process.env.WONKY_BACKEND = 'rust';
const { build } = await import('../src/index.mjs');
const { measureRustBody, rustModelKernel } = await import('../src/native/rust-host.mjs');
const source = (angle, points) => `FeatureScript 3083;
import(path : "onshape/std/geometry.fs", version : "3083.0");
export const probe = defineFeature(function(context is Context, id is Id, definition is map) {
 const cs = coordSystem(vector(0,0,0)*millimeter,vector(1,0,0),vector(0,0,1));
 var sk = newSketchOnPlane(context,id+"sk",{"sketchPlane":plane(cs.origin,-cross(cs.zAxis,cs.xAxis),cs.xAxis)});
 skPolyline(sk,"profile",{"points":[${[...points,points[0]].map(([r,z])=>`vector(${r},${z})*millimeter`).join(',')}]});
 skSolve(sk);
 opRevolve(context,id+"body",{"entities":qSketchRegion(id+"sk",false),"axis":line(cs.origin,cs.zAxis),"angleForward":${angle}*degree});
 opDeleteBodies(context,id+"cleanup",{"entities":qCreatedBy(id+"sk",EntityType.BODY)});
});`;
const rectangle = [[4,0],[8,0],[8,6],[4,6]];
test('V1 preserves existing full and quarter admission', async () => {
 for (const angle of [90,360]) {
  const m=await build(source(angle,rectangle),{feature:'probe',trace:false});
  assert.equal(m.bodies.length,1);
  const measured=measureRustBody(rustModelKernel(m),m.bodies[0]);
  assert.ok(Math.abs(measured.volumeMm3-288*Math.PI*angle/360)<1e-6);
 }
});
test('V1 does not route KT3 or snap a near-quarter angle', async () => {
 for (const [angle,profile] of [[135,[[0,0],[6,0],[6,4],[0,10]]],[90.000001,rectangle]]) {
  await assert.rejects(build(source(angle,profile),{feature:'probe',trace:false}),e=>{
   assert.equal(e.name,'RustCapabilityError');
   assert.match(e.reason,/angle|quarter/);
   return true;
  });
 }
});
