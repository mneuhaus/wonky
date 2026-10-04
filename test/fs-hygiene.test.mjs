import test from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missingBend();
if (publicTreeSkip) {
  test("fs-hygiene.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { spawnSync } = await import("node:child_process");
const { mkdtempSync, rmSync, writeFileSync } = await import("node:fs");
const { tmpdir } = await import("node:os");
const { join } = await import("node:path");
const { fileURLToPath } = await import("node:url");
const { build } = await import("../src/index.mjs");









const root = fileURLToPath(new URL('../', import.meta.url));
const header = 'FeatureScript 3044; import(path:"onshape/std/common.fs",version:"3044.0");';
const cuboid = (id, x, size) => `fCuboid(context,${id},{"corner1":vector(${x},0,0)*millimeter,"corner2":vector(${x + size},${size},${size})*millimeter});`;
const cube = (name, x, size) => cuboid(`id+"${name}"`, x, size);
const feature = body => `${header}\nexport const f=defineFeature(function(context is Context,id is Id,definition is map){\n${body}\n});`;
const query = name => `qCreatedBy(id+"${name}",EntityType.BODY)`;
const setup = cube('helper', 0, 10) + cube('other', 40, 3) + cube('keep', 20, 2);
const sketch = `var s=newSketchOnPlane(context,id+"sketch",{"sketchPlane":plane(vector(0,0,0)*millimeter,vector(0,0,1))});
skRectangle(s,"rect",{"firstCorner":vector(0,0)*millimeter,"secondCorner":vector(1,1)*millimeter});skSolve(s);`;
const extrude = `opExtrude(context,id+"extruded",{"entities":qSketchRegion(id+"sketch"),"direction":vector(0,0,1),"endBound":BoundingType.BLIND,"endDepth":1*millimeter});`;

function cli(source, parameters = []) {
  const dir = mkdtempSync(join(tmpdir(), 'wonky-fs-hygiene-'));
  try {
    const input = join(dir, 'input.fs');
    writeFileSync(input, source);
    const result = spawnSync(process.execPath, ['bin/wonky.mjs', input, '--json', '--check', ...parameters], {
      cwd: root, encoding: 'utf8', env: { ...process.env, WONKY_BACKEND: 'rust' },
    });
    assert.equal(result.error, undefined);
    // JSON.parse also guards the single-object stdout contract; stderr remains evidence.
    return { ...result, report: JSON.parse(result.stdout) };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
function volumes(result, expected) {
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.report.status, 'ok');
  const actual = result.report.bodies.map(body => body.volumeMm3).sort((a, b) => a - b);
  assert.equal(actual.length, expected.length);
  expected.forEach((value, i) => assert.ok(Math.abs(actual[i] - value) < 1e-8, `${actual[i]} != ${value}`));
}

// One CLI owner for deletion: independent volumes, subsequent dynamic and cached
// queries, deduplicated owners, supported set/geometry selections and empty no-ops.
for (const [name, selection, removed, expected] of [
  ['created body', query('helper'), true, [8, 27]],
  ['union of owners', `qUnion([${query('helper')},${query('other')},${query('helper')}])`, true, [8]],
  ['intersection', `qIntersection([qAllModifiableSolidBodies(),${query('helper')}])`, true, [8, 27]],
  ['subtraction', `qSubtraction(qAllModifiableSolidBodies(),${query('keep')})`, true, [8]],
  ['faces delete their owner', 'qCreatedBy(id+"helper",EntityType.FACE)', true, [8, 27]],
  ['edges delete their owner', `qOwnedByBody(${query('helper')},EntityType.EDGE)`, true, [8, 27]],
  ['vertices delete their owner', `qOwnedByBody(${query('helper')},EntityType.VERTEX)`, true, [8, 27]],
  ['geometric selection', `qClosestTo(qOwnedByBody(${query('helper')},EntityType.FACE),vector(0,5,5)*millimeter)`, true, [8, 27]],
  ['empty selection', 'qNothing()', false, [8, 27, 1000]],
  ['absent creator', 'qCreatedBy(id+"absent",EntityType.BODY)', false, [8, 27, 1000]],
]) {
  test(`opDeleteBodies: ${name} updates queries and output`, () => {
    const result = cli(feature(`${setup}
      const old=evaluateQuery(context,${query('helper')});
      const oldFaces=evaluateQuery(context,qOwnedByBody(${query('helper')},EntityType.FACE));
      opDeleteBodies(context,id+"cleanup",{"entities":${selection}});
      if(size(evaluateQuery(context,${query('helper')}))!=${removed ? 0 : 1})throw regenError("Creator query retained a deleted body");
      if(size(evaluateQuery(context,qUnion(old)))!=${removed ? 0 : 1})throw regenError("Transient query retained a deleted body");
      if(size(evaluateQuery(context,qUnion(oldFaces)))!=${removed ? 0 : 6})throw regenError("Transient faces retained their deleted owner");
      if(size(evaluateQuery(context,qAllModifiableSolidBodies()))!=${expected.length})throw regenError("Live body count");`));
    volumes(result, expected);
  });
}

test('opDeleteBodies can clear all solids and then create a fresh output', () => {
  volumes(cli(feature(`${setup}
    opDeleteBodies(context,id+"cleanup",{"entities":qAllModifiableSolidBodies()});
    if(size(evaluateQuery(context,qAllModifiableSolidBodies()))!=0)throw regenError("Deleted bodies remain");
    ${cube('fresh', 0, 4)}`)), [64]);
});

test('mixed sketch/solid deletion invalidates the sketch but retains its derived solid', () => {
  volumes(cli(feature(`${setup}${sketch}${extrude}
    opDeleteBodies(context,id+"cleanup",{"entities":qUnion([${query('helper')},${query('sketch')},qCreatedBy(id+"helper",EntityType.FACE)])});
    if(size(evaluateQuery(context,${query('sketch')}))!=0)throw regenError("Deleted sketch body remains");
    var caught=false;
    try {opExtrude(context,id+"invalid",{"entities":qSketchRegion(id+"sketch"),"direction":vector(0,0,1),"endBound":BoundingType.BLIND,"endDepth":1*millimeter});}
    catch(e){caught=true;}
    if(!caught)throw regenError("Deleted sketch remains usable");`)), [1, 8, 27]);
});

test('catching a failed subfeature restores deleted solids, transient topology and sketch usability', () => {
  const source = `${header}
    const erase=defineFeature(function(context is Context,id is Id,definition is map){
      opDeleteBodies(context,id+"cleanup",{"entities":definition.entities});throw regenError("abort");
    });
    export const f=defineFeature(function(context is Context,id is Id,definition is map){
      ${setup}${sketch}
      const old=evaluateQuery(context,${query('helper')});
      const oldEdges=evaluateQuery(context,qOwnedByBody(${query('helper')},EntityType.EDGE));
      var caught=false;
      try {erase(context,id+"sub",{"entities":qUnion([${query('helper')},${query('sketch')}])});}catch(e){caught=true;}
      if(!caught||size(evaluateQuery(context,qUnion(old)))!=1||size(evaluateQuery(context,qUnion(oldEdges)))!=12)throw regenError("Deletion not rolled back");
      ${extrude}
    });`;
  volumes(cli(source), [1, 8, 27, 1000]);
});

test('unsupported deletion selection escapes try and try silent rather than silently deleting nothing', () => {
  for (const body of [
    'try {opDeleteBodies(context,id+"cleanup",{"entities":qEverything(EntityType.BODY)});}catch(e){}',
    'try silent(opDeleteBodies(context,id+"cleanup",{"entities":qUnion([qCreatedBy(id+"helper",EntityType.BODY),qEverything(EntityType.BODY)])}));',
  ]) {
    const result = cli(feature(setup + body));
    assert.equal(result.status, 2, result.stderr);
    assert.equal(result.report.status, 'refused');
    assert.equal(result.report.refusals[0].code, 'CAPABILITY_UNAVAILABLE');
    assert.equal(result.report.refusals[0].operation, 'opDeleteBodies');
    assert.match(result.report.refusals[0].message, /qEverything.*default bodies/);
  }
});

// qCreatedBy selects an Id subtree, not a string prefix or only the leaf
// operation. Each topology kind must agree before and after owner deletion.
for (const [entity, count] of [['BODY', 2], ['FACE', 12], ['EDGE', 24], ['VERTEX', 16]]) {
  test(`ancestor ${entity} query deletes descendant owners without matching sibling Id components`, () => {
    const result = cli(feature(`
      ${cuboid('id+"helper"+"a"', 0, 2)}${cuboid('id+"helper"+"nested"+"b"', 10, 3)}
      ${cube('helperSibling', 20, 4)}${cube('hel', 30, 5)}
      const selected=qCreatedBy(id+"helper",EntityType.${entity});
      const old=evaluateQuery(context,selected);
      if(size(old)!=${count})throw regenError("Wrong ancestor selection");
      opDeleteBodies(context,id+"cleanup",{"entities":selected});
      if(size(evaluateQuery(context,selected))!=0||size(evaluateQuery(context,qUnion(old)))!=0)throw regenError("Deleted subtree still selected");
    `));
    volumes(result, [64, 125]);
    assert.deepEqual(result.report.bodies.map(body => body.id).sort(), ['model/hel', 'model/helperSibling']);
  });
}

test('ancestor deletion invalidates a nested sketch while retaining its derived solid', () => {
  const result = cli(feature(`${sketch.replaceAll('id+"sketch"', 'id+"helper"+"sketch"')}
    ${extrude.replaceAll('id+"sketch"', 'id+"helper"+"sketch"')}
    opDeleteBodies(context,id+"cleanup",{"entities":qCreatedBy(id+"helper",EntityType.BODY)});
    var caught=false;
    try {opExtrude(context,id+"invalid",{"entities":qSketchRegion(id+"helper"+"sketch"),"direction":vector(0,0,1),"endBound":BoundingType.BLIND,"endDepth":1*millimeter});}
    catch(e){caught=true;}
    if(!caught)throw regenError("Nested deleted sketch remains usable");
    ${cube('keep', 20, 2)}`));
  volumes(result, [1, 8]);
  assert.deepEqual(result.report.bodies.map(body => body.id), ['model/extruded', 'model/keep']);
});

test('registered operation creator excludes its nested profile while feature ancestors include it', () => {
  const profile = 'id+"helper"+"operation"+"profile"';
  const operation = 'id+"helper"+"operation"';
  const counts = [['BODY', 1], ['FACE', 6], ['EDGE', 12], ['VERTEX', 8]];
  const result = cli(feature(`${sketch.replaceAll('id+"sketch"', profile)}
    ${extrude.replaceAll('id+"sketch"', profile).replaceAll('id+"extruded"', operation)}
    ${counts.map(([entity, count]) => `if(size(evaluateQuery(context,qCreatedBy(${operation},EntityType.${entity})))!=${count})throw regenError("Wrong operation selection");`).join('\n')}
    opDeleteBodies(context,id+"cleanupOperation",{"entities":qCreatedBy(${operation},EntityType.BODY)});
    ${extrude.replaceAll('id+"sketch"', profile).replaceAll('id+"extruded"', 'id+"keep"')}
    opDeleteBodies(context,id+"cleanupFeature",{"entities":qCreatedBy(id+"helper",EntityType.BODY)});
    var caught=false;
    try {${extrude.replaceAll('id+"sketch"', profile).replaceAll('id+"extruded"', 'id+"invalid"')}}catch(e){caught=true;}
    if(!caught)throw regenError("Ancestor retained profile sketch");`));
  volumes(result, [1]);
  assert.deepEqual(result.report.bodies.map(body => body.id), ['model/keep']);
});

// Sketch wire/point/face ownership is not transported as WC0 topology yet.
// Do not pretend those entities are absent, even in a mixed owner selection.
for (const entity of ['FACE', 'EDGE', 'VERTEX']) {
  test(`unsupported sketch ${entity} ownership fails closed through deletion and evaluation`, () => {
    const selection = `qOwnedByBody(qUnion([${query('helper')},${query('sketch')}]),EntityType.${entity})`;
    for (const operation of [
      `opDeleteBodies(context,id+"cleanup",{"entities":${selection}})`,
      `evaluateQuery(context,${selection})`,
    ]) {
      for (const guarded of [`try {${operation};}catch(e){}`, `try silent(${operation});`]) {
        const result = cli(feature(`${setup}${sketch}${guarded}${extrude}`));
        assert.equal(result.status, 2, result.stderr);
        assert.equal(result.report.status, 'refused');
        assert.equal(result.report.refusals[0].code, 'query/owned-sketch-topology');
        assert.match(result.report.refusals[0].message, /owned-sketch-topology/);
      }
    }
  });
}

test('the reviewer sketch-edge cleanup cannot succeed with a retained sketch', () => {
  const result = cli(feature(`${sketch}
    opDeleteBodies(context,id+"cleanup",{"entities":qOwnedByBody(${query('sketch')},EntityType.EDGE)});
    try {${extrude}}catch(e){}${cube('keep', 0, 1)}`));
  assert.equal(result.status, 2, result.stderr);
  assert.equal(result.report.status, 'refused');
  assert.match(result.report.refusals[0].message, /owned-sketch-topology/);
});

for (const [name, declaration, defaults] of [
  ['builtin', 'const raw=fCuboid;', '{"corner1":vector(0,0,0)*millimeter,"corner2":vector(2,2,2)*millimeter}'],
  ['feature', `const raw=defineFeature(function(c is Context,k is Id,d is map){
    fCuboid(c,k,{"corner1":vector(0,0,0)*millimeter,"corner2":vector(d.size,d.size,d.size)*millimeter});
  },{"size":9});`, '{"size":2}'],
]) {
  test(`defineFeature wraps a ${name} callable without entering the error fallback`, () => {
    const result = cli(feature(`${declaration}
      try {const wrapped=defineFeature(raw,${defaults});wrapped(context,id+"wrapped",{});}
      catch(e){${cube('wrongFallback', 0, 1)}}`));
    volumes(result, [8]);
    assert.deepEqual(result.report.bodies.map(body => body.id), ['model/wrapped']);
  });

  test(`top-level ${name} wrapper safely reads dialog defaults and supplied overrides`, () => {
    const source = `${header}${declaration}export const f=defineFeature(raw,${defaults});`;
    const parameters = name === 'builtin'
      ? ['--param', 'corner2=vector(3,3,3)*millimeter'] : ['--param', 'size=3'];
    volumes(cli(source), [8]);
    const result = cli(source, parameters);
    volumes(result, [27]);
    assert.deepEqual(result.report.bodies.map(body => body.id), ['model']);
  });
}

test('nested callable wrappers roll back failed subfeatures before a catch continues', () => {
  const result = cli(`${header}
    const raw=defineFeature(function(context is Context,id is Id,definition is map){
      opDeleteBodies(context,id+"cleanup",{"entities":definition.entities});
      ${cube('discard', 10, 3)}throw regenError("abort wrapped feature");
    });
    const wrapped=defineFeature(raw);
    export const f=defineFeature(function(context is Context,id is Id,definition is map){
      ${cube('keep', 0, 2)}const old=evaluateQuery(context,${query('keep')});
      var caught=false;
      try {wrapped(context,id+"sub",{"entities":${query('keep')}});}catch(e){caught=true;}
      if(!caught||size(evaluateQuery(context,qUnion(old)))!=1)throw regenError("Wrapped rollback failed");
    });`);
  volumes(result, [8]);
  assert.deepEqual(result.report.bodies.map(body => body.id), ['model/keep']);
});

test('wrapped capability gaps escape catches while non-callable defineFeature arguments remain catchable', () => {
  for (const invocation of [
    `try {const wrapped=defineFeature(opExtrude);wrapped(context,id+"unsupported",{"entities":qSketchRegion(id+"sketch"),"direction":vector(0,0,1),"endBound":BoundingType.BLIND,"endDepth":1*millimeter,"startBound":BoundingType.BLIND});}catch(e){}`,
    `const wrapped=defineFeature(opExtrude);try silent(wrapped(context,id+"unsupported",{"entities":qSketchRegion(id+"sketch"),"direction":vector(0,0,1),"endBound":BoundingType.BLIND,"endDepth":1*millimeter,"startBound":BoundingType.BLIND}));`,
  ]) {
    const result = cli(feature(sketch + invocation + cube('wrongFallback', 0, 1)));
    assert.equal(result.status, 2, result.stderr);
    assert.equal(result.report.status, 'refused');
    assert.equal(result.report.refusals[0].code, 'CAPABILITY_UNAVAILABLE');
    assert.match(result.report.refusals[0].message, /startBound/);
  }
  volumes(cli(feature(`var caught=0;
    for(var invalid in [7,{}, {"type":"builtin"}]) {try {defineFeature(invalid);}catch(e){caught+=1;}}
    try {defineFeature(fCuboid,7);}catch(e){caught+=1;}
    if(caught!=4)throw regenError("Invalid wrapper arguments are not catchable");${cube('keep', 0, 2)}`)), [8]);
});

const diagnosticCases = [
  ['fractional index', feature('qNthElement(qNothing(),0.5);'), [], 'fs/invalid-argument', /integer index/],
  ['wrong query argument', feature('qNthElement(7,0);'), [], 'fs/invalid-argument', /Query/],
  ['missing operation field', feature('opDeleteBodies(context,id+"cleanup",{});'), [], 'fs/invalid-argument', /entities/, 2],
  ['wrong operation definition', feature('opDeleteBodies(context,id+"cleanup",7);'), [], 'fs/invalid-argument', /definition map/, 2],
  ['typed parameter', `${header}\nfunction typed(n is number){return n;}\n${feature('typed("wrong");').slice(header.length)}`, [], 'fs/type-mismatch', /Expected number/],
  ['typed return', `${header}\nfunction typed() returns number{return "wrong";}\n${feature('typed();').slice(header.length)}`, [], 'fs/type-mismatch', /Expected number/],
  ['precondition', `${header}\nexport const f=defineFeature(function(context is Context,id is Id,definition is map)precondition{definition.flag is boolean;}{${cube('keep', 0, 2)}});`, ['--param', 'flag=7'], 'fs/precondition-failed', /precondition failed/],
  ['bounds', `${header}\nexport const f=defineFeature(function(context is Context,id is Id,definition is map)precondition{isInteger(definition.count,POSITIVE_COUNT_BOUNDS);}{${cube('keep', 0, 2)}});`, ['--param', 'count=0'], 'fs/parameter-out-of-range', /PARAMETER_OUT_OF_RANGE/],
  ['invalid cast', feature('const p={} as Plane;'), [], 'fs/invalid-argument', /Invalid Plane/],
  ['wrong units', feature('const p=millimeter+degree;'), [], 'fs/invalid-argument', /Incompatible units/],
  ['invalid scalar', feature('sqrt("wrong");'), [], 'fs/invalid-argument', /finite numeric value/],
];
for (const [name, source, parameters, code, message, exit = 1] of diagnosticCases) {
  test(`CLI frontend diagnostic: ${name} has a stable code, hint and location`, () => {
    const result = cli(source, parameters);
    assert.equal(result.status, exit, result.stderr);
    assert.equal(result.report.status, exit === 2 ? 'refused' : 'error');
    const problem = result.report.refusals[0];
    assert.match(problem.message, message);
    assert.equal(problem.code, code, result.stderr);
    assert.ok(problem.hint.length > 20);
    assert.notEqual(problem.hint, 'Check the input and the selected backend.');
    assert.ok(problem.location.line > 0);
    assert.ok(problem.location.column > 0);
    assert.match(problem.location.file, /input\.fs$/);
  });
}

test('genuine argument, precondition, bounds and type failures remain catchable without leaking call depth', async () => {
  const source = `${header}
    function typed(n is number){return n;}
    function conditioned() precondition{false;}{}
    export const f=defineFeature(function(context is Context,id is Id,definition is map){
      var caught=0;
      for(var i=0;i<80;i+=1){try{typed("wrong");}catch(e){caught+=1;}}
      try{conditioned();}catch(e){caught+=1;}
      try{isInteger(0,POSITIVE_COUNT_BOUNDS);}catch(e){caught+=1;}
      try{qNthElement(qNothing(),0.5);}catch(e){caught+=1;}
      try{opDeleteBodies(context,id+"bad",{});}catch(e){caught+=1;}
      const result=try silent(sqrt("wrong"));
      if(caught!=84||result!=undefined)throw regenError("Frontend validation no longer catchable");
      ${cube('keep', 0, 2)}
    });`;
  const model = await build(source, { trace: false });
  assert.equal(model.bodies.length, 1);
  assert.equal(model.bodies[0].id, 'model/keep');
});

}
