import test from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missingBend() || missing("fixtures/r10b/r10b.fs");
if (publicTreeSkip) {
  test("lang-semantic-core.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { readFileSync, readdirSync } = await import("node:fs");
const { createHash } = await import("node:crypto");
const { build } = await import("../src/index.mjs");
const { parse } = await import("../src/parser.mjs");
const { loadKernel } = await import("../src/kernel.mjs");
const { ModelingContext } = await import("../src/library.mjs");
const { geometryRevision } = await import("../src/identity.mjs");
const { isRustBody, rustBodySha256, measureRustBody } = await import("../src/native/rust-host.mjs");
const { buildCore } = await import("../src/lang/semcore/build.mjs");
const { desugarProgram } = await import("../src/lang/semcore/desugar-fs.mjs");
const { CoreEvaluator } = await import("../src/lang/semcore/eval.mjs");
const { irStats } = await import("../src/lang/semcore/ir.mjs");
// Semantic-core study (docs/language/semantic-core.md): wonky's FeatureScript
// frontend desugars into the expression-only WCore/0 IR without changing
// results. Every case runs through the reference interpreter (src/index.mjs)
// and through FS -> WCore/0 -> JS reference evaluator (src/lang/semcore/) and
// compares geometry revisions or the exact error. Intended semantic changes
// of the core (value capture, transactional ops/features) are tested
// explicitly. Run: node --test test/lang-semantic-core.test.mjs















const root = new URL('../', import.meta.url);
const header = 'FeatureScript 3044; import(path:"onshape/std/common.fs",version:"3044.0");';
const feature = body => `${header} export function main(context is Context,id is Id,definition is map){${body}}`;
const box = 'fCuboid(context,id+"b",{"corner1":vector(0,0,0)*millimeter,"corner2":vector(10,20,30)*millimeter});';
const cube = (name, x = 0) => `fCuboid(context,id+"${name}",{"corner1":vector(${x},0,0)*millimeter,"corner2":vector(${x + 1},1,1)*millimeter});`;
const main = body => `${header} export const main=defineFeature(function(context is Context,id is Id,definition is map){${body}});`;
const count = 'size(evaluateQuery(context,qAllModifiableSolidBodies()))';

// A Rust body has no legacy B-rep view (vertices/edges/faces), so its revision is the digest of its WC0 words.
const revisionOf = body => isRustBody(body) ? rustBodySha256(body) : geometryRevision(body);
const outcome = async (run) => {
  try {
    const model = await run();
    return { ok: model.bodies.map(b => `${b.id}|${revisionOf(b)}|${b.identity?.originId}|${b.name ?? ''}`) };
  } catch (error) { return { error: `${error.name}: ${error.message}`, at: error.line ? `${error.line}:${error.column}` : null }; }
};
const same = async (source, options = {}) => {
  const interpreted = await outcome(() => build(source, { trace: false, ...options }));
  const core = await outcome(() => buildCore(source, { trace: false, ...options }));
  assert.deepEqual(core, interpreted);
  return core;
};

// The examples the Rust kernel does not build yet: each is refused by name, and the core IR
// must refuse it identically (same() compares the exact error). A new entry here is a gap; a
// listed example that starts to build fails this test until it is removed.
const refusedOnRust = {
  'conical-spacer.fs': /opLoft: loft\/planar-line-profiles-required is not implemented on the Rust kernel/,
  'tilted-plate.fs': /opExtrude: startBound\/startDepth is not implemented on the Rust kernel/,
};
test('every example builds identical bodies through the core IR', async () => {
  const files = readdirSync(new URL('examples/', root)).filter(f => f.endsWith('.fs'));
  assert.deepEqual(Object.keys(refusedOnRust).filter(f => !files.includes(f)), []);
  for (const file of files) {
    const result = await same(readFileSync(new URL(`examples/${file}`, root), 'utf8'));
    if (refusedOnRust[file]) assert.match(result.error ?? '', refusedOnRust[file], file);
    else assert.ok(result.ok?.length, `${file}: ${result.error}`);
  }
});

test('concave intersection builds the independently calculated solid through both frontends', async () => {
  const input = readFileSync(new URL('examples/concave-intersection.fs', root), 'utf8');
  for (const run of [build, buildCore]) {
    const model = await run(input, {trace:false});
    assert.equal(model.bodies.length, 1);
    const measured = measureRustBody(await loadKernel(), model.bodies[0]);
    // After x clipping, the L is 6*2 + 2*4 = 20 mm²; z clipping leaves 2 mm.
    assert.ok(Math.abs(measured.volumeMm3 - 40) <= 40e-12);
    assert.equal(measured.boundToConstruction, true);
    assert.equal(measured.validity.closed, true);
    assert.equal(measured.topology.genus, 0);
    assert.equal(measured.topology.faces, 8);
    assert.equal(measured.topology.edges, 18);
    assert.equal(measured.topology.vertices, 12);
    for (let axis = 0; axis < 3; axis++) {
      assert.ok(Math.abs(measured.bboxMm.min[axis] - [1,0,1][axis]) <= 1e-12);
      assert.ok(Math.abs(measured.bboxMm.max[axis] - [7,6,3][axis]) <= 1e-12);
    }
  }
});

test('loops, break/continue, value semantics and member assignment desugar exactly', async () => {
  await same(feature(`
    var a = {"nested":[1,2]}; var b = a; b.nested[0] = 9;
    if (a.nested[0] != 1 || b.nested[0] != 9) throw regenError("Value semantics violated");
    var sum=0;
    for (var i=0;i<10;i+=1) { if(i==3)continue; if(i==6)break; sum+=i; }
    while(sum<20){sum+=1;}
    if(sum!=20)throw regenError("Bad loop behavior");
    var total=0; for (var x in [1,2,3,4]) { if (x == 2) continue; if (x == 4) break; total += x; }
    if (total != 4) throw regenError("Bad for-in");
    ${box}`));
  // Shared immutable values across arguments, returns, append and casts.
  await same(`${header}
    function change(a is array) returns array {a[0].values[1]=9;return a;}
    export function main(context is Context,id is Id,definition is map){
      var a=[{"values":[1,2]}];var b=change(a);var c=append(a,b[0]);
      b[0].values[0]=8;c[0].values[0]=7;c[1].values[1]=6;
      if(a[0].values!=[1,2]||b[0].values!=[8,9]||c[0].values!=[7,2]||c[1].values!=[1,6])throw regenError("Aliasing");
      var v=vector(1,2);var w=v;var items=v as array;items[0]=5;w[1]=3;
      if(v!=vector(1,2)||w!=vector(1,3)||items!=[5,2])throw regenError("Vector aliasing");
      ${box}
    }`);
});

test('try/catch, returns from try blocks and capability errors keep their semantics', async () => {
  await same(feature(`
    var caught=false;try{throw regenError("expected");}catch(e){caught=true;}
    if(!caught)throw regenError("Did not catch");
    var n=try silent(1/0);if(n!=undefined)throw regenError("Expected undefined");
    const early = function(k) { for (var i = 0; i < 5; i += 1) { try { if (i == k) return i * 10; } catch (e) { } } return -1; };
    if (early(3) != 30 || early(7) != -1) throw regenError("Return through try inside loop");
    var hits = 0; for (var i = 0; i < 4; i += 1) { try { if (i == 1) continue; if (i == 3) break; hits += 1; } catch (e) { } }
    if (hits != 1) throw regenError("break/continue through try");
    var after = 0; try { after = 1; } catch (e) { after = 2; } if (after != 1) throw regenError("try normal exit");
    ${box}`));
  await same(feature('var result=try silent(opFillet(context,id,{}));' + box));
  await same(feature('try{opRevolve(context,id,{});}catch(e){}' + box));
  await same(feature('throw regenError("user failure at a known span");'));
});

test('budgets, defaults, parameters, units, transforms and queries match', async () => {
  // Budgets: same error; step counts (and so the reported span) legitimately differ.
  for (const run of [build, buildCore]) assert.match((await outcome(() => run(feature('while(true){}'), { trace: false, maxSteps: 100 }))).error, /Execution limit exceeded \(100/);
  const defaults = `${header}
    export enum Choice { annotation {"Name":"Small"} SMALL, LARGE }
    export const main=defineFeature(function(context is Context,id is Id,definition is map)
      precondition {
        annotation {"Default":Choice.SMALL} definition.choice is Choice;
        isLength(definition.width,{(millimeter):[1,10,40]} as LengthBoundSpec);
      } {
        const w=definition.choice==Choice.SMALL?definition.width:2*definition.width;
        fCuboid(context,id+"b",{"corner1":vector(0,0,0)*millimeter,"corner2":vector(w,2*millimeter,3*millimeter)});
      });`;
  await same(defaults);
  await same(defaults, { parameters: { choice: 'Choice.LARGE', width: '20*millimeter' } });
  assert.match((await same(defaults, { parameters: { width: '41*millimeter' } })).error, /precondition|PARAMETER_OUT_OF_RANGE/); // valueBounds.fs verifyBounds throws PARAMETER_OUT_OF_RANGE
  await same(feature(`
    if(abs(sin(90*degree)-1)>1e-10)throw regenError("Angle mismatch");
    const t=transform(matrix([[0,-1,0],[1,0,0],[0,0,1]]),vector(5,6,7)*millimeter);
    const p=vector(1,2,3)*millimeter;
    if(norm(inverse(t)*(t*p)-p)>1e-10*millimeter)throw regenError("Transform roundtrip");
    ${box}`));
  assert.match((await same(feature('const a=degree+millimeter;' + box))).error, /Incompatible units/);
  const queried = await same(feature(`
    var base=newSketchOnPlane(context,id+"base",{"sketchPlane":plane(vector(0,0,0)*millimeter,vector(0,0,1))});
    skRectangle(base,"rect",{"firstCorner":vector(0,0)*millimeter,"secondCorner":vector(10,20)*millimeter});skSolve(base);
    opExtrude(context,id+"b",{"entities":qSketchRegion(id+"base"),"direction":vector(0,0,1),"endBound":BoundingType.BLIND,"endDepth":30*millimeter});
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
    opDeleteBodies(context,id+"cleanup",{"entities":original});`));
  assert.equal(queried.ok?.length, 1, queried.error); // Identical refusals are not successful query/deletion semantics.
  await same(feature(`const a = 1; a = 2; ${box}`)).then(r => assert.match(r.error, /Cannot assign to constant 'a'/));
  await same(feature(`var q = 1; var q = 2; ${box}`)).then(r => assert.match(r.error, /Duplicate declaration 'q'/));
  await same(feature(`notDefinedAnywhere(1); ${box}`)).then(r => assert.match(r.error, /UnsupportedFeatureError/));
});

test('r10b scalar helpers give bit-identical results through the core IR', async () => {
  const program = desugarProgram(parse(readFileSync(new URL('fixtures/r10b/r10b.fs', root), 'utf8')));
  const evaluator = new CoreEvaluator(new ModelingContext(await loadKernel()).builtins());
  evaluator.spans = program.spans;
  for (const def of program.globals) evaluator.define(def.name, evaluator.evaluate(def.value, evaluator.root), def.span);
  assert.equal(evaluator.call(evaluator.globals.get('edgeDegrees'), [evaluator.globals.get('R10bEdgeAngle').K15]), 15);
  const profile = evaluator.call(evaluator.globals.get('r10bTrayInside'), [4, 0.5, 3.2]);
  assert.equal(profile.length, 122);
  // Same digest as test/language.test.mjs asserts for the reference interpreter.
  assert.equal(createHash('sha256').update(JSON.stringify(profile)).digest('hex'), '7f54945c81d4dd454e5bba141538891ea3df35e78b982dc241d8eeba44f79f0d');
  const stats = irStats(program);
  assert.ok(stats.nodes > 0 && stats.bytes > 0);
});

test('intended core semantics: value capture and transactional ops/features', async () => {
  const capture = main(`var x = 1; const f = function() { return x; }; x = 2; ${cube('a')} throw regenError("closure sees " ~ f());`);
  assert.match((await outcome(() => build(capture, { trace: false }))).error, /closure sees 2/);
  assert.match((await outcome(() => buildCore(capture, { trace: false }))).error, /closure sees 1/);

  const nested = `${header} const sub = defineFeature(function(context is Context, id is Id, definition is map) { ${cube('a')} throw regenError("sub fails"); });
    export const main = defineFeature(function(context is Context, id is Id, definition is map) { try { sub(context, id + "sub", {}); } catch (e) { } ${cube('b', 2)} throw regenError("bodies " ~ ${count}); });`;
  // Pattern an extruded source with supported construction lineage. Deletion
  // exercises both a sketch and a solid owner; operation-id rollback is the
  // intentional difference between the interpreter and transactional core.
  const unitSketch = name => `var ${name} = newSketchOnPlane(context, id + "${name}", {"sketchPlane": plane(vector(0, 0, 0) * millimeter, vector(0, 0, 1), vector(1, 0, 0))}); skRectangle(${name}, "r", {"firstCorner": vector(0, 0) * millimeter, "secondCorner": vector(1, 1) * millimeter}); skSolve(${name});`;
  const extruded = name => `${unitSketch(name + 'Sketch')} opExtrude(context, id + "${name}", {"entities": qSketchRegion(id + "${name}Sketch"), "direction": vector(0, 0, 1), "endBound": BoundingType.BLIND, "endDepth": 1 * millimeter});`;
  const pattern = main(`${extruded('a')} try { opPattern(context, id + "p", {"entities": qCreatedBy(id + "a", EntityType.BODY), "transforms": [transform(vector(5, 0, 0) * millimeter), 5], "instanceNames": ["i1", "i2"]}); } catch (e) { } throw regenError("bodies " ~ ${count});`);
  // Independent body/sketch counts keep both owner deletions observable.
  const reuse = main(`${cube('source')}${unitSketch('a')} try { opDeleteBodies(context, id + "d", {"entities": 5}); } catch (e) { } opDeleteBodies(context, id + "d", {"entities": qUnion([qCreatedBy(id + "a", EntityType.BODY), qCreatedBy(id + "source", EntityType.BODY)])}); ${cube('c', 3)} throw regenError("bodies " ~ ${count} ~ " sketches " ~ size(evaluateQuery(context, qCreatedBy(id + "a", EntityType.BODY))));`);
  // W1: the interpreter aborts a failed sub-feature like std defineFeature
  // (feature.fs @abortFeature), and opPattern checks every transform before it
  // adds an instance, so both agree with the transactional core. Without
  // transactions the core keeps the failed sub-feature's body, as the
  // interpreter did before W1; operation ids stay claimed in the interpreter.
  for (const [source, interpreter, core, coreWithoutTransactions] of [
    [nested, /bodies 1/, /bodies 1/, /bodies 2/],
    [pattern, /bodies 1/, /bodies 1/, /bodies 1/],
    [reuse, /Duplicate operation ID 'model\/d'/, /bodies 1 sketches 0/, /Duplicate operation ID 'model\/d'/]]) {
    assert.match((await outcome(() => build(source, { trace: false }))).error, interpreter);
    assert.match((await outcome(() => buildCore(source, { trace: false }))).error, core);
    assert.match((await outcome(() => buildCore(source, { trace: false, transactions: false }))).error, coreWithoutTransactions);
  }
});

}
