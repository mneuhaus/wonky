import test from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missing("fixtures/r10b/provenance.json", "fixtures/r10b/r10b.fs");
if (publicTreeSkip) {
  test("acceptance.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { readFileSync } = await import("node:fs");
const { inventorySource, operationProgress, traceBuild, verifyFrozenSource } = await import("../scripts/check-acceptance.mjs");
const { Interpreter } = await import("../src/interpreter.mjs");






const sourceData = readFileSync(new URL('../fixtures/r10b/r10b.fs', import.meta.url));
const source = sourceData.toString('utf8');
const provenance = JSON.parse(readFileSync(new URL('../fixtures/r10b/provenance.json', import.meta.url), 'utf8'));

test('acceptance source verification rejects changed bytes and changed provenance', () => {
  assert.equal(verifyFrozenSource(sourceData, provenance).passed, true);
  assert.equal(verifyFrozenSource(Buffer.concat([sourceData, Buffer.from('\n')]), provenance).passed, false);
  assert.equal(verifyFrozenSource(sourceData, { ...provenance, sha256: '0'.repeat(64) }).passed, false);
});

test('r10b inventory separates required stages and reachable operations from inactive helpers and imports', () => {
  const inventory = inventorySource(source);
  assert.deepEqual(inventory.stages.map(stage => stage.name), ['buildUpperCore', 'buildLowerCore', 'buildCarriage',
    'buildSideDrive', 'buildFrames', 'buildTrayArms', 'buildCameraSupports', 'buildTransferEdge', 'buildRetainedContext']);
  const sites = name => inventory.operationCallSites.filter(call => call.name === name);
  assert.equal(sites('opBoolean').filter(call => call.reachable).length, 6);
  assert.equal(sites('skArc').filter(call => call.reachable).length, 1);
  assert.equal(sites('opRevolve').filter(call => call.reachable).length, 1);
  assert.deepEqual(sites('opFillet').map(call => [call.helper, call.reachable]), [['roundX', false], ['filletXWindow', false]]);
  assert.equal(sites('opSweep').length, 0);
  assert.deepEqual(inventory.imports.find(spec => spec.namespace === 'floor').calledByReachableFunctions, []);
  assert.equal(inventory.unresolvedCallees.length, 0);
  assert.equal(inventory.runtimeInvocationTotalExpected, null);
  const volume = sites('evVolume')[0];
  assert.equal(volume.helper, 'finish');
  assert.deepEqual(volume.guards.map(guard => guard.kind), ['if', 'for']);
});

test('acceptance tracing preserves unsupported failure inside try silent and does not execute later geometry', async () => {
  const text = `FeatureScript 3044;
import(path:"onshape/std/geometry.fs",version:"3044.0");
function missing() { try silent(opAcceptanceDeliberatelyUnsupported()); }
export function main(context is Context, id is Id, definition is map) {
  missing();
  fCuboid(context,id+"box",{"corner1":vector(0,0,0)*millimeter,"corner2":vector(1,1,1)*millimeter});
}`;
  const originalExpression = Interpreter.prototype.expression, originalCall = Interpreter.prototype.call;
  const inventory = inventorySource(text, 'main');
  const result = await traceBuild(text, { feature: 'main' }, inventory);
  assert.equal(result.model, null);
  assert.equal(result.error.name, 'UnsupportedFeatureError');
  assert.equal(result.error.line, 3);
  assert.equal(result.firstFailure.name, 'opAcceptanceDeliberatelyUnsupported');
  assert.equal(result.firstFailure.status, 'failed');
  assert.equal(result.events.some(event => event.name === 'fCuboid'), false);
  assert.equal(result.events.find(event => event.kind === 'required-stage').status, 'failed');
  assert.equal(operationProgress(inventory, result.events).find(row => row.name === 'fCuboid').status, 'not-reached');
  assert.equal(Interpreter.prototype.expression, originalExpression);
  assert.equal(Interpreter.prototype.call, originalCall);
});

test('acceptance tracing keeps real successful geometry and records completed operations', async () => {
  const text = readFileSync(new URL('../examples/box.fs', import.meta.url), 'utf8');
  const result = await traceBuild(text, { feature: 'box' });
  assert.equal(result.error, null);
  assert.equal(result.firstFailure, null);
  assert.equal(result.model.bodies.length, 1);
  assert.ok(Math.abs(result.model.bodies[0].validation.volumeMm3 - 4000) < 1e-8);
  const operation = result.events.find(event => event.name === 'fCuboid');
  assert.equal(operation.status, 'completed');
  assert.equal(operation.operationId, 'model/box');
  assert.equal(operation.solidBodiesBefore, 0);
  assert.equal(operation.solidBodiesAfter, 1);
});

test('a caught modeling exception is recorded without being misreported as the terminal capability failure', async () => {
  const text = `FeatureScript 3044;
import(path:"onshape/std/geometry.fs",version:"3044.0");
export function main(context is Context, id is Id, definition is map) {
  fCuboid(context,id+"box",{"corner1":vector(0,0,0)*millimeter,"corner2":vector(1,1,1)*millimeter});
  var ignored=try silent(evBox3d(context,{"topology":qCreatedBy(id+"absent",EntityType.BODY)}));
}`;
  const result = await traceBuild(text, { feature: 'main' });
  assert.equal(result.model.bodies.length, 1);
  assert.equal(result.error, null);
  assert.equal(result.firstFailure, null);
  const failure = result.events.find(event => event.name === 'evBox3d');
  assert.equal(failure.error.name, 'FeatureScriptError');
  // Both backends reject an empty selection; their wording is not the contract.
  assert.match(failure.error.message, /empty (?:topology|query)/i);
});

}
