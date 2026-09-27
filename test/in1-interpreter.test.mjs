import test from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missingBend();
if (publicTreeSkip) {
  test("in1-interpreter.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { build } = await import("../src/index.mjs");
const { scalarBuiltins } = await import("../src/scalars.mjs");
const { Quantity } = await import("../src/values.mjs");
const { validateSolid } = await import("../src/brep.mjs");
const { UnsupportedFeatureError } = await import("../src/errors.mjs");
const { recordFeatureScript } = await import("../src/lang/wk/record-fs.mjs");
const { oracleNodes } = await import("../src/lang/wk/real-oracle.mjs");
const { loadKernel } = await import("../src/kernel.mjs");











const header = 'FeatureScript 3044; import(path:"onshape/std/geometry.fs",version:"3044.0");';
const feature = body => `${header} export function main(context is Context,id is Id,definition is map){${body}}`;
const box = 'fCuboid(context,id+"box",{"corner1":vector(1,2,3)*millimeter,"corner2":vector(5,8,10)*millimeter});';
const signedVolume = body => body.faces.reduce((volume, face) => {
  const points = face.loops[0].map(use => {
    const edge = body.edges[use.edge];
    return body.vertices[use.forward ? edge.start : edge.end];
  });
  const [a, ...rest] = points;
  return volume + rest.slice(0, -1).reduce((sum, b, i) => {
    const c = rest[i + 1];
    return sum + (a[0] * (b[1] * c[2] - b[2] * c[1])
      + a[1] * (b[2] * c[0] - b[0] * c[2])
      + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
  }, 0);
}, 0);

test('sqrt halves unit dimensions and retains numeric overload; a dimensionless mutant is rejected', async () => {
  const sqrt = scalarBuiltins().sqrt.call;
  const length = sqrt([new Quantity(0.000025, 2)]);
  const areaRoot = sqrt([new Quantity(9e-6, 2)]);
  assert.deepEqual([length.value, length.dimension, length.angle], [0.005, 1, 0]);
  assert.deepEqual([areaRoot.value, areaRoot.dimension], [0.003, 1]);
  assert.equal(sqrt([9]), 3);
  assert.throws(() => sqrt([new Quantity(-1, 2)]), /non-finite/);
  const model = await build(feature(`const side=sqrt((25*millimeter*millimeter));
    if(side!=5*millimeter) throw regenError("sqrt lost length units");
    const area=9*millimeter^2; if(sqrt(area)!=3*millimeter) throw regenError("sqrt area units");
    ${box}`));
  assert.equal(model.bodies.length, 1);
});

test('opTransform mutates selected solids, preserves signed volume under mirror, and tracks createdBy', async () => {
  const mirror = await build(feature(`${box}
    opTransform(context,id+"mirror",{"bodies":qCreatedBy(id+"box",EntityType.BODY),
      "transform":transform(matrix([[-1,0,0],[0,1,0],[0,0,1]]),vector(11,0,0)*millimeter)});
    if(size(evaluateQuery(context,qCreatedBy(id+"mirror",EntityType.BODY)))!=1) throw regenError("missing transform lineage");`));
  assert.equal(mirror.bodies.length, 1);
  const body = mirror.bodies[0];
  assert.deepEqual(body.validation.boundsMm, { min: [6, 2, 3], max: [10, 8, 10] });
  assert.ok(Math.abs(body.validation.volumeMm3 - 168) < 1e-8);
  assert.ok(Math.abs(signedVolume(body) - 168) < 1e-8);
  const unflipped = { ...body, faces: body.faces.map(face => ({ ...face,
    loops: face.loops.map(loop => [...loop].reverse().map(use => ({ ...use, forward: !use.forward }))) })) };
  assert.ok(Math.abs(signedVolume(unflipped) + 168) < 1e-8);
  assert.throws(() => validateSolid(unflipped), /orientation|nonpositive/);
  const rigid = await build(feature(`${box}
    opTransform(context,id+"move",{"bodies":qCreatedBy(id+"box",EntityType.BODY),
      "transform":transform(vector(10,0,0)*millimeter)});`));
  assert.equal(rigid.bodies.length, 1);
  assert.deepEqual(rigid.bodies[0].validation.boundsMm, { min: [11, 2, 3], max: [15, 8, 10] });
});

test('feed-style transform moves two queried bodies in place without changing their volumes', async () => {
  const model = await build(feature(`${box}
    fCuboid(context,id+"second",{"corner1":vector(20,2,3)*millimeter,"corner2":vector(24,8,10)*millimeter});
    const c=0; const s=1;
    opTransform(context,id+"world",{"bodies":qUnion([qCreatedBy(id+"box",EntityType.BODY),qCreatedBy(id+"second",EntityType.BODY)]),
      "transform":transform(matrix([[1,0,0],[0,c,s],[0,-s,c]]),vector(0,100,0)*millimeter)});
    if(size(evaluateQuery(context,qCreatedBy(id+"world",EntityType.BODY)))!=2) throw regenError("feed transform lost a part");`));
  assert.equal(model.bodies.length, 2);
  assert.deepEqual(model.bodies.map(b => b.validation.boundsMm), [
    { min: [1, 103, -8], max: [5, 110, -2] },
    { min: [20, 103, -8], max: [24, 110, -2] },
  ]);
  assert.ok(model.bodies.every(b => Math.abs(b.validation.volumeMm3 - 168) < 1e-8));
});

// A failed nested defineFeature restores both geometry and its query lineage.
// In particular, deleting bodies by the aborted operation must not delete the
// original body after the caller catches the FeatureScript exception.
const abortedTransform = `${header}
  const sub = defineFeature(function(context is Context, id is Id, definition is map) precondition {} {
    opTransform(context, id + "move", {"bodies":qCreatedBy(makeId("model") + "box", EntityType.BODY),
      "transform":transform(vector(10,0,0)*millimeter)});
    throw regenError("abort after transform");
  });
  export const main = defineFeature(function(context is Context, id is Id, definition is map) precondition {} {
    ${box}
    try silent { sub(context, id + "sub", {}); }
    if (size(evaluateQuery(context, qCreatedBy(id + "sub" + "move", EntityType.BODY))) != 0)
      throw regenError("aborted transform lineage survived");
    opDeleteBodies(context, id + "deleteAborted", {"entities":qCreatedBy(id + "sub" + "move", EntityType.BODY)});
    fCuboid(context, id + "marker", {"corner1":vector(20,2,3)*millimeter,"corner2":vector(24,8,10)*millimeter});
  });`;

test('build rolls back aborted nested opTransform lineage and keeps the original body', async () => {
  const model = await build(abortedTransform);
  assert.equal(model.bodies.length, 2);
  assert.deepEqual(model.bodies.map(body => body.validation.boundsMm), [
    { min: [1, 2, 3], max: [5, 8, 10] },
    { min: [20, 2, 3], max: [24, 8, 10] },
  ]);
});

test('WK recorder rolls back aborted nested opTransform lineage and keeps both outputs', () => {
  const recorded = recordFeatureScript(abortedTransform, { feature: 'main' });
  assert.equal(recorded.status, 'complete', recorded.error?.message);
  assert.deepEqual(recorded.outputs.map(body => body.bodyId), ['model/box', 'model/marker']);
});

test('WK recorder records in-place opTransform and refuses unsupported reflected graph nodes', () => {
  const source = feature(`${box}
    opTransform(context,id+"shift",{"bodies":qCreatedBy(id+"box",EntityType.BODY),
      "transform":transform(vector(5,0,0)*millimeter)});`);
  const recorded = recordFeatureScript(source, { feature: 'main' });
  assert.equal(recorded.status, 'complete', recorded.error?.message);
  assert.deepEqual(recorded.graph.nodes.map(n => n.op), ['extrude_polygon', 'transform']);
  assert.equal(recorded.outputs.length, 1);
  assert.equal(recorded.outputs[0].ref.node, 1);
  const reflected = recordFeatureScript(feature(`${box}
    opTransform(context,id+"mirror",{"bodies":qCreatedBy(id+"box",EntityType.BODY),
      "transform":transform(matrix([[-1,0,0],[0,1,0],[0,0,1]]),vector(0,0,0)*millimeter)});`), { feature: 'main' });
  assert.equal(reflected.status, 'unsupported');
  assert.match(reflected.error.message, /orientation reversal/);
});

test('opTransform routes proper analytic-body rotation through existing analytic kernel', async () => {
  const model = await build(feature(`var sk=newSketchOnPlane(context,id+"sk",{"sketchPlane":plane(vector(0,0,0)*millimeter,vector(0,0,1))});
    skCircle(sk,"c",{"center":vector(0,0)*millimeter,"radius":2*millimeter}); skSolve(sk);
    opExtrude(context,id+"c",{"entities":qSketchRegion(id+"sk"),"direction":vector(0,0,1),"endBound":BoundingType.BLIND,"endDepth":10*millimeter});
    opTransform(context,id+"move",{"bodies":qCreatedBy(id+"c",EntityType.BODY),
      "transform":transform(matrix([[0,0,1],[0,1,0],[-1,0,0]]),vector(25,0,0)*millimeter)});`));
  assert.equal(model.bodies.length, 1);
  assert.equal(model.bodies[0].geometry, 'analytic');
  assert.ok(Math.abs(model.bodies[0].validation.volumeMm3 - 40 * Math.PI) < 1e-7);
  assert.deepEqual(model.bodies[0].primitive?.top, [35, 0, 0]);
});

test('opTransform rejects scale and unsupported analytic reflection explicitly', async () => {
  await assert.rejects(build(feature(`${box}
    opTransform(context,id+"scale",{"bodies":qCreatedBy(id+"box",EntityType.BODY),
      "transform":transform(matrix([[2,0,0],[0,1,0],[0,0,1]]),vector(0,0,0)*millimeter)});`)), UnsupportedFeatureError);
  await assert.rejects(build(feature(`var sk=newSketchOnPlane(context,id+"sk",{"sketchPlane":plane(vector(0,0,0)*millimeter,vector(0,0,1))});
    skCircle(sk,"c",{"center":vector(0,0)*millimeter,"radius":2*millimeter}); skSolve(sk);
    opExtrude(context,id+"c",{"entities":qSketchRegion(id+"sk"),"direction":vector(0,0,1),"endBound":BoundingType.BLIND,"endDepth":10*millimeter});
    opTransform(context,id+"mirror",{"bodies":qCreatedBy(id+"c",EntityType.BODY),
      "transform":transform(matrix([[-1,0,0],[0,1,0],[0,0,1]]),vector(0,0,0)*millimeter)});`)), /reflection of analytic bodies/);
});

// A split Boolean returns two real bodies, but the recorder's symbolic store
// initially assumes one. A subsequent in-place transform must retain that
// uncertainty until a body-count query can check it.
test('recorded transform preserves speculative split counts and the oracle rejects the wrong count', async () => {
  const source = feature(`fCuboid(context,id+"stock",{"corner1":vector(0,0,0)*millimeter,"corner2":vector(30,10,10)*millimeter});
    fCuboid(context,id+"saw",{"corner1":vector(10,-1,-1)*millimeter,"corner2":vector(20,11,11)*millimeter});
    opBoolean(context,id+"split",{"targets":qCreatedBy(id+"stock",EntityType.BODY),
      "tools":qCreatedBy(id+"saw",EntityType.BODY),"operationType":BooleanOperationType.SUBTRACTION});
    opTransform(context,id+"shift",{"bodies":qCreatedBy(id+"stock",EntityType.BODY),
      "transform":transform(vector(0,20,0)*millimeter)});
    const n=size(evaluateQuery(context,qCreatedBy(id+"stock",EntityType.BODY)));
    fCuboid(context,id+"count",{"corner1":vector(0,50,0)*millimeter,"corner2":vector(n,51,1)*millimeter});`);
  const direct = await build(source);
  const countBody = direct.bodies.find(body => Math.abs(body.validation.volumeMm3 - 2) < 1e-9);
  assert.ok(countBody, 'build() must observe both halves and produce a 2 mm³ count box');
  const recorded = recordFeatureScript(source, { feature: 'main' });
  assert.equal(recorded.status, 'complete', recorded.error?.message);
  const checks = recorded.graph.nodes.filter(node => node.op === 'expect_count');
  assert.equal(checks.length, 2, 'both the transform input and the later observed count must be guarded');
  const transform = recorded.graph.nodes.find(node => node.op === 'transform');
  assert.ok(checks[0].n < transform.n && checks[1].n > transform.n);
  const oracle = oracleNodes(recorded.graph, await loadKernel());
  assert.match(oracle.errors.get(checks[0].n)?.message ?? '', /count speculation failed/);
});

test('tiny non-rigid scale is refused for analytic solids and by the WK recorder', async () => {
  const source = feature(`var sk=newSketchOnPlane(context,id+"sk",{"sketchPlane":plane(vector(0,0,0)*millimeter,vector(0,0,1))});
    skCircle(sk,"c",{"center":vector(0,0)*millimeter,"radius":2*millimeter}); skSolve(sk);
    opExtrude(context,id+"c",{"entities":qSketchRegion(id+"sk"),"direction":vector(0,0,1),"endBound":BoundingType.BLIND,"endDepth":10*millimeter});
    opTransform(context,id+"scale",{"bodies":qCreatedBy(id+"c",EntityType.BODY),
      "transform":transform(matrix([[1.0000005,0,0],[0,1,0],[0,0,1]]),vector(0,0,0)*millimeter)});`);
  await assert.rejects(build(source), error => error instanceof UnsupportedFeatureError && /rigid/.test(error.message));
  const recorded = recordFeatureScript(source, { feature: 'main' });
  assert.equal(recorded.status, 'unsupported');
  assert.match(recorded.error.message, /rigid/);
  assert.ok(recorded.graph.nodes.every(node => node.op !== 'transform'));
});

}
