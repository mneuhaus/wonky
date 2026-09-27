import test from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missingBend();
if (publicTreeSkip) {
  test("boolean.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { mkdirSync, writeFileSync } = await import("node:fs");
const { build } = await import("../src/index.mjs");
const { toStep } = await import("../src/exporters.mjs");
const { loadKernel } = await import("../src/kernel.mjs");
const { booleanInBend } = await import("../src/boolean.mjs");
const { transformAnalytic } = await import("../src/analytic.mjs");
const { UnsupportedFeatureError } = await import("../src/errors.mjs");










const header = 'FeatureScript 3044; import(path:"onshape/std/geometry.fs",version:"3044.0");';
const cylinder = (name, z0, z1, r, x = 0) => `
var ${name} = newSketchOnPlane(context,id+"${name}",{"sketchPlane":plane(vector(${x},0,${z0})*millimeter,vector(0,0,1))});
skCircle(${name},"circle",{"center":vector(0,0)*millimeter,"radius":${r}*millimeter});skSolve(${name});
opExtrude(context,id+"${name}ex",{"entities":qSketchRegion(id+"${name}"),"direction":vector(0,0,1),"endBound":BoundingType.BLIND,"endDepth":${z1-z0}*millimeter});`;
const query = name => `qCreatedBy(id+"${name}ex",EntityType.BODY)`;
const operation = (op, keep = false) => `opBoolean(context,id+"result",{${op === 'SUBTRACTION'
  ? `"targets":${query('a')},"tools":${query('b')},"keepTools":${keep}`
  : `"tools":qUnion([${query('a')},${query('b')}])`},"operationType":BooleanOperationType.${op}});`;
const feature = body => header + `export function main(context is Context,id is Id,definition is map){${body}}`;
const close = (a,b) => assert.ok(Math.abs(a-b)<1e-8*Math.max(1,Math.abs(b)),`${a} != ${b}`);
const emit = (name, model) => {
  const prefix = new URL(`../out/boolean-tests/${name}`, import.meta.url);
  mkdirSync(new URL('../out/boolean-tests/', import.meta.url), {recursive:true});
  writeFileSync(new URL(prefix.href+'.brep.json'),JSON.stringify(model,null,2)+'\n');
  writeFileSync(new URL(prefix.href+'.step'),toStep(model,name));
};

test('coaxial cylinder booleans create analytic union, intersection, bore and separated solids in Bend', async () => {
  const cases = [
    ['union','UNION',[0,10,5],[4,14,3],1,286],
    ['intersection','INTERSECTION',[0,10,5],[4,14,3],1,54],
    ['counterbore','SUBTRACTION',[0,10,5],[4,14,3],1,196],
    ['through-bore','SUBTRACTION',[0,10,5],[-1,11,2],1,210],
    ['split','SUBTRACTION',[0,10,5],[4,6,6],2,200],
    ['disjoint-union','UNION',[0,10,5],[14,16,3],2,268],
    ['identical-union','UNION',[0,10,5],[0,10,5],1,250],
    ['touching-union','UNION',[0,10,5],[10,15,3],1,295],
    ['reverse-axis','SUBTRACTION',[0,10,5],[11,-1,2],1,210],
  ];
  for (const [name,op,a,b,count,volumeOverPi] of cases) {
    const model = await build(feature(cylinder('a',...a)+cylinder('b',...b)+operation(op)));
    assert.equal(model.bodies.length,count,name);
    close(model.bodies.reduce((v,b)=>v+b.validation.volumeMm3,0),volumeOverPi*Math.PI);
    assert.ok(model.bodies.every(b=>b.geometry==='analytic' && b.validation.closed));
    emit(name,model);
  }
});

test('empty intersections and complete subtraction are real empty Boolean results', async () => {
  const k = await loadKernel();
  const model = await build(feature(cylinder('a',0,10,5)+cylinder('b',14,16,3)));
  assert.deepEqual(booleanInBend(k,...model.bodies,'INTERSECTION','empty'),[]);
  assert.deepEqual(booleanInBend(k,model.bodies[0],model.bodies[0],'SUBTRACTION','empty'),[]);
});

test('Boolean queries track result lineage, split bodies and keepTools', async () => {
  const model = await build(feature(cylinder('a',0,10,5)+cylinder('b',4,6,6)+operation('SUBTRACTION',true)+`
if(size(evaluateQuery(context,${query('a')}))!=2)throw regenError("split result lost lineage");
if(size(evaluateQuery(context,${query('b')}))!=1)throw regenError("tool was not kept");
opDeleteBodies(context,id+"clean",{"entities":${query('b')}});`));
  assert.equal(model.bodies.length,2);
  close(model.bodies.reduce((v,b)=>v+b.validation.volumeMm3,0),200*Math.PI);
});

test('noncoaxial and general body booleans remain capability errors inside try silent', async () => {
  // The exact arms' refusals (policy exact-only); the default policy hands
  // both to the hybrid Boolean (test/hybrid-dispatch.test.mjs).
  const exactOnly = { modelingPolicy: { boolean: 'exact-only' } };
  await assert.rejects(build(feature(cylinder('a',0,10,5)+cylinder('b',0,10,3,1)+'try silent('+operation('SUBTRACTION').slice(0,-1)+');'),exactOnly),UnsupportedFeatureError);
  await assert.rejects(build(feature(`fCuboid(context,id+"aex",{"corner1":vector(0,0,0)*millimeter,"corner2":vector(5,5,5)*millimeter});`+cylinder('b',0,10,3)+operation('SUBTRACTION')),exactOnly),UnsupportedFeatureError);
  await assert.rejects(build(feature(cylinder('a',0,10,5)+cylinder('b',3,7,2)+'try silent('+operation('SUBTRACTION').slice(0,-1)+');')),e=>e instanceof UnsupportedFeatureError && /enclosed void/.test(e.message));
});

test('coaxial booleans preserve volume and tight bounds under rigid rotation', async () => {
  const k = await loadKernel();
  const model = await build(feature(cylinder('a',0,10,5)+cylinder('b',-1,11,2)));
  const rows = [[1,0,0],[0,0.8,-0.6],[0,0.6,0.8]], offset = [13,-21,17];
  const moved = model.bodies.map((b,i)=>transformAnalytic(k,b,String(i),rows,offset));
  const [body] = booleanInBend(k,...moved,'SUBTRACTION','rotated');
  close(body.validation.volumeMm3,210*Math.PI);
  body.validation.boundsMm.min.forEach((v,i)=>close(v,[8,-31,14][i]));
  body.validation.boundsMm.max.forEach((v,i)=>close(v,[18,-17,28][i]));
  const [initial] = booleanInBend(k,...model.bodies,'SUBTRACTION','initial');
  const transformed = transformAnalytic(k,initial,'transformed',rows,offset);
  close(transformed.validation.volumeMm3,body.validation.volumeMm3);
  for(const side of ['min','max']) transformed.validation.boundsMm[side].forEach((v,i)=>close(v,body.validation.boundsMm[side][i]));
  emit('rotated-through-bore',{...model,bodies:[body]});
  emit('transformed-through-bore',{...model,bodies:[transformed]});
});

}
