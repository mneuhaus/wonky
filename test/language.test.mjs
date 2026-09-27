import test from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missingBend() || missing("fixtures/r10b/provenance.json", "fixtures/r10b/r10b.fs");
if (publicTreeSkip) {
  test("language.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { readFileSync } = await import("node:fs");
const { createHash } = await import("node:crypto");
const { parse } = await import("../src/parser.mjs");
const { Interpreter } = await import("../src/interpreter.mjs");
const { ModelingContext } = await import("../src/library.mjs");
const { build } = await import("../src/index.mjs");
const { loadKernel } = await import("../src/kernel.mjs");
const { UnsupportedFeatureError } = await import("../src/errors.mjs");











const header = 'FeatureScript 3044; import(path:"onshape/std/common.fs",version:"3044.0");';
const feature = body => `${header} export function main(context is Context,id is Id,definition is map){${body}}`;
const box = 'fCuboid(context,id+"b",{"corner1":vector(0,0,0)*millimeter,"corner2":vector(10,20,30)*millimeter});';
const fixturePath = new URL('../fixtures/r10b/r10b.fs', import.meta.url);

test('r10b fixture is immutable and parses completely without preprocessing', () => {
  const source = readFileSync(fixturePath);
  const provenance = JSON.parse(readFileSync(new URL('../fixtures/r10b/provenance.json', import.meta.url), 'utf8'));
  assert.equal(createHash('sha256').update(source).digest('hex'), provenance.sha256);
  const program = parse(source.toString('utf8'));
  assert.equal(program.version, 3044); assert.equal(program.imports.length, 10);
  assert.equal(program.declarations.length, 69);
  assert.ok(program.declarations.some(d => d.name === 'singleStepR10b' && d.exported));
});

test('C-style loops, continue/break, while, map/array assignments preserve value semantics', async () => {
  const source = feature(`
    var a = {"nested":[1,2]}; var b = a; b.nested[0] = 9;
    if (a.nested[0] != 1 || b.nested[0] != 9) throw regenError("Value semantics violated");
    var sum=0;
    for (var i=0;i<10;i+=1) { if(i==3)continue; if(i==6)break; sum+=i; }
    while(sum<20){sum+=1;}
    if(sum!=20)throw regenError("Bad loop behavior");
    ${box}`);
  assert.equal((await build(source)).bodies.length, 1);
});

test('try/catch and try silent catch modeling exceptions but never missing implementation', async () => {
  const model = await build(feature(`
    var caught=false;try{throw regenError("expected");}catch(e){caught=true;}
    if(!caught)throw regenError("Did not catch");
    var n=try silent(1/0);if(n!=undefined)throw regenError("Expected undefined");${box}`));
  assert.equal(model.bodies.length, 1);
  await assert.rejects(build(feature('var result=try silent(opShell(context,id,{}));' + box)), UnsupportedFeatureError);
  await assert.rejects(build(feature('try{opSweep(context,id,{});}catch(e){}' + box)), UnsupportedFeatureError);
});

test('shared immutable values remain isolated across arguments, returns, append, and Vector casts', async () => {
  const source = `${header}
    function change(a is array) returns array {a[0].values[1]=9;return a;}
    export function main(context is Context,id is Id,definition is map){
      var a=[{"values":[1,2]}];var b=change(a);var c=append(a,b[0]);
      b[0].values[0]=8;c[0].values[0]=7;c[1].values[1]=6;
      if(a[0].values!=[1,2]||b[0].values!=[8,9]||c[0].values!=[7,2]||c[1].values!=[1,6])throw regenError("Aliasing");
      var v=vector(1,2);var w=v;var items=v as array;items[0]=5;w[1]=3;
      if(v!=vector(1,2)||w!=vector(1,3)||items!=[5,2])throw regenError("Vector aliasing");
      ${box}
    }`;
  assert.equal((await build(source)).bodies.length,1);
});

test('execution budgets are configurable and enforced', async () => {
  await assert.rejects(build(feature('while(true){}'), {maxSteps:100}), /Execution limit exceeded \(100/);
  await assert.rejects(build(feature(box), {maxSteps:NaN}), /positive safe integer/);
});

test('enum and length-bound UI defaults, with explicit enum overrides', async () => {
  const source = `${header}
    export enum Choice { annotation {"Name":"Small"} SMALL, LARGE }
    export const main=defineFeature(function(context is Context,id is Id,definition is map)
      precondition {
        annotation {"Default":Choice.SMALL} definition.choice is Choice;
        isLength(definition.width,{(millimeter):[1,10,40]} as LengthBoundSpec);
      } {
        const w=definition.choice==Choice.SMALL?definition.width:2*definition.width;
        fCuboid(context,id+"b",{"corner1":vector(0,0,0)*millimeter,"corner2":vector(w,2*millimeter,3*millimeter)});
      });`;
  assert.equal(Math.round((await build(source)).bodies[0].validation.volumeMm3), 60);
  assert.equal(Math.round((await build(source, { parameters: { choice: 'Choice.LARGE', width: '20*millimeter' } })).bodies[0].validation.volumeMm3), 240);
  await assert.rejects(build(source, { parameters: { width: '41*millimeter' } }), /precondition|PARAMETER_OUT_OF_RANGE/);
});

test('angle units, matrix transforms and inverse preserve FeatureScript dimensions', async () => {
  const model = await build(feature(`
    if(abs(sin(90*degree)-1)>1e-10)throw regenError("Angle mismatch");
    const t=transform(matrix([[0,-1,0],[1,0,0],[0,0,1]]),vector(5,6,7)*millimeter);
    const p=vector(1,2,3)*millimeter;
    if(norm(inverse(t)*(t*p)-p)>1e-10*millimeter)throw regenError("Transform roundtrip");
    ${box}`));
  assert.equal(model.bodies.length, 1);
  await assert.rejects(build(feature('const a=degree+millimeter;'+box)), /Incompatible units/);
});

test('queries, properties, Bend rigid pattern, and body deletion', async () => {
  const model = await build(feature(`${box}
    var original=qCreatedBy(id+"b",EntityType.BODY);
    setProperty(context,{"entities":original,"propertyType":PropertyType.NAME,"value":"source box"});
    opPattern(context,id+"copy",{"entities":original,"transforms":[transform(matrix([[0,-1,0],[1,0,0],[0,0,1]]),vector(40,0,0)*millimeter)],"instanceNames":["one"]});
    var copied=qCreatedBy(id+"copy",EntityType.BODY);
    if(size(evaluateQuery(context,qAllModifiableSolidBodies()))!=2)throw regenError("Body count");
    if(size(evaluateQuery(context,qOwnedByBody(copied,EntityType.EDGE)))!=12)throw regenError("Edge count");
    if(abs(evVolume(context,{"entities":copied})/(millimeter^3)-6000)>0.1)throw regenError("Volume");
    var bounds=evBox3d(context,{"topology":copied,"tight":true});
    if(bounds.minCorner[0]!=20*millimeter)throw regenError("Bounds");
    if(getProperty(context,{"entity":copied,"propertyType":PropertyType.NAME})!="source box")throw regenError("Property");
    opDeleteBodies(context,id+"cleanup",{"entities":original});
  `));
  assert.equal(model.bodies.length, 1);
  assert.deepEqual(model.bodies[0].validation.boundsMm, { min: [20, 0, 0], max: [40, 10, 30] });
});

test('actual r10b scalar helpers execute with the original AST', async () => {
  const interpreter = new Interpreter(new ModelingContext(await loadKernel()).builtins());
  const program = parse(readFileSync(fixturePath, 'utf8'));
  for (const declaration of program.declarations) interpreter.statement(declaration, interpreter.global);
  const fn = interpreter.global.get('edgeDegrees');
  const angles = interpreter.global.get('R10bEdgeAngle');
  assert.equal(interpreter.call(fn, [angles.K15]), 15);
  const profile = interpreter.call(interpreter.global.get('r10bTrayInside'), [4, 0.5, 3.2]);
  assert.equal(profile.length, 122);
  assert.ok(profile.every(p => p.items?.every(Number.isFinite)));
  assert.equal(createHash('sha256').update(JSON.stringify(profile)).digest('hex'), '7f54945c81d4dd454e5bba141538891ea3df35e78b982dc241d8eeba44f79f0d');
});

}
