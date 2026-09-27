import test from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missingBend();
if (publicTreeSkip) {
  test("source-map.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { readFileSync } = await import("node:fs");
const { createHash } = await import("node:crypto");
const { build } = await import("../src/index.mjs");
const { buildPython } = await import("../src/python.mjs");







test('a generated body links to its actual FeatureScript call, parameters and function stack',async()=>{
  const source=readFileSync(new URL('../examples/bracket.fs',import.meta.url),'utf8');
  const model=await build(source,{sourcePath:'/models/bracket.fs'}), map=model.sourceMap;
  assert.equal(map.source.sha256,createHash('sha256').update(source).digest('hex'));
  const op=map.operations.find(o=>o.name==='opExtrude');
  assert.equal(op.source.file,'/models/bracket.fs');
  assert.match(source.split('\n')[op.source.span.line-1],/opExtrude/);
  assert.equal(op.operationId,'model/extrusion');assert.equal(op.status,'completed');
  assert.ok(op.callStack.some(f=>f.name==='bracket'));
  assert.ok(JSON.stringify(op.parameters).includes('endDepth'));
  assert.equal(model.bodies[0].debug.sourceOperation,op.sequence);
  assert.equal(model.bodies[0].identity.operation.source.sha256,map.source.sha256);
  assert.equal(model.bodies[0].identity.operation.source.span.line,op.source.span.line);
});

test('Python selections retain their original call stack and parent construction sources',async()=>{
  const source='from build123d import *\ndef make_part():\n    return Cylinder(4, 8)\nbase = make_part()\nresult = Pos(3, 2, 1) * base\n';
  const model=await buildPython(source,{filename:'/models/part.py'}),map=model.sourceMap;
  assert.equal(map.source.sha256,createHash('sha256').update(source).digest('hex'));
  assert.deepEqual(map.operations.map(op=>[op.name,op.source.span.line,op.status]),[['cylinder',3,'completed'],['translate',5,'completed']]);
  // Columns come from co_positions (Python 3.11+); older Pythons report none rather than an invented one.
  const [major,minor]=model.source.pythonVersion.split('.').map(Number);
  assert.equal(map.operations[0].source.span.column,major>3||minor>=11?12:null,'real Python column or none');
  assert.deepEqual(map.operations[0].callStack.map(f=>f.name),['<module>','make_part']);
  assert.equal(model.bodies[0].identity.operation.source.span.line,5);
  assert.ok(JSON.stringify(model.bodies[0].identity.lineage.history).includes('make_part'));
  const plain=await buildPython(source,{trace:false});
  assert.equal(plain.sourceMap,undefined);
  assert.deepEqual(model.bodies[0].vertices,plain.bodies[0].vertices);
  assert.equal(model.bodies[0].identity.revision,plain.bodies[0].identity.revision);
});

test('caught Python capability failures still have failed source records and no produced bodies',async()=>{
  const source='from build123d import *\ntry:\n    result = Box(2, 3, 4) - Cylinder(1, 5)\nexcept BaseException:\n    result = Box(1, 1, 1)\n';
  await assert.rejects(buildPython(source,{filename:'/models/rejected.py'}),error=>{
    const op=error.modelTrace.operations.find(o=>o.name==='boolean');
    assert.equal(error.name,'UnsupportedFeatureError');assert.equal(op.status,'failed');
    assert.equal(op.source.span.line,3);assert.deepEqual(op.outputs,[]);return true;
  });
});

test('source tracing does not change geometry and records failed capabilities without inventing outputs',async()=>{
  const source=readFileSync(new URL('../examples/box.fs',import.meta.url),'utf8');
  const traced=await build(source),plain=await build(source,{trace:false});
  const geometry=b=>{const {debug,identity,...shape}=b;return shape;};
  assert.deepEqual(traced.bodies.map(geometry),plain.bodies.map(geometry));
  assert.equal(plain.sourceMap,undefined);
  const failed='FeatureScript 3044; import(path:"onshape/std/geometry.fs",version:"3044.0"); export function main(context is Context,id is Id,definition is map){ fCuboid(context,id+"body",{"corner1":vector(0,0,0)*millimeter,"corner2":vector(2,3,4)*millimeter}); opBoolean(context,id+"bad",{"tools":qCreatedBy(id+"body",EntityType.BODY),"operationType":BooleanOperationType.UNION}); }';
  await assert.rejects(build(failed),error=>{
    const op=error.modelTrace.operations.find(o=>o.name==='opBoolean');
    assert.equal(op.status,'failed');assert.deepEqual(op.outputs,[]);assert.equal(op.source.span.line,1);
    assert.equal(error.name,'UnsupportedFeatureError');return true;
  });
});

}
