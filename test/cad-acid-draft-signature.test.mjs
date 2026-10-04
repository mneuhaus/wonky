import test from 'node:test';
import assert from 'node:assert/strict';
import { traceFeatureScript } from '../src/lang/dataflow/fs-trace.mjs';

const source = (definition, silent = false, setup = '') => `FeatureScript 3000;
import(path : "onshape/std/geometry.fs", version : "3000.0");
export const f = defineFeature(function(context is Context, id is Id, definition is map) precondition {} {
  fCuboid(context, id + "box", { "corner1" : vector(0,0,0)*millimeter, "corner2" : vector(16,16,8)*millimeter });
  ${setup}
  ${silent ? 'try silent {' : ''}
  opDraft(context, id + "draft", { ${definition}, "draftFaces" : qOwnedByBody(qCreatedBy(id + "box", EntityType.BODY), EntityType.FACE), "pullVec" : vector(0,0,1), "angle" : atan(0.125) });
  ${silent ? '}' : ''}
});`;
const plane = 'plane(vector(0,0,0)*millimeter, vector(0,0,1))';

for (const alias of [
  `"draftType" : DraftType.NEUTRAL_PLANE, "referenceSurface" : ${plane}`,
  `"draftType" : DraftType.REFERENCE_SURFACE, "neutralPlane" : ${plane}`,
]) for (const silent of [false, true]) test(`reject obsolete draft alias, try silent=${silent}: ${alias}`, () => {
  const result = traceFeatureScript(source(alias, silent));
  assert.equal(result.status, 'error');
  assert.equal(result.error.code, 'draft/invalid-neutral-plane-alias');
  assert.match(result.error.hint, /DraftType\.REFERENCE_SURFACE.*referenceSurface/);
  assert.equal(result.graph.nodes.some(n => n.op === 'draft'), false);
});

test('trace the Onshape reference-surface signature without inventing geometry', () => {
  const result = traceFeatureScript(source(`"draftType" : DraftType.REFERENCE_SURFACE, "referenceSurface" : ${plane}`));
  assert.equal(result.status, 'complete');
  const draft = result.graph.nodes.find(n => n.op === 'draft');
  assert.ok(draft);
  assert.match(draft.args, /referenceSurface:/);
  assert.doesNotMatch(draft.args, /neutralPlane:/);
});

test('a reference-surface body is a dependency and remains unchanged by draft', () => {
  const reference = 'qOwnedByBody(qCreatedBy(id + "reference", EntityType.BODY), EntityType.FACE)';
  const setup = 'fCuboid(context, id + "reference", { "corner1" : vector(0,0,-1)*millimeter, "corner2" : vector(16,16,0)*millimeter });';
  const result = traceFeatureScript(source(`"draftType" : DraftType.REFERENCE_SURFACE, "referenceSurface" : ${reference}`, false, setup));
  assert.equal(result.status, 'complete');
  assert.ok(result.graph.outputs.includes('model/reference'));
  assert.ok(result.graph.outputs.includes('model/draft'));
  assert.equal(result.graph.outputs.includes('model/box'), false);
  const selections = result.graph.nodes.filter(n => n.kind === 'select');
  assert.ok(selections.some(n => n.inputs.includes('model/reference')));
});
