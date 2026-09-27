import test from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missingBend() || missing("fixtures/r10b/r10b.fs");
if (publicTreeSkip) {
  test("viewer-source-links.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { mkdtemp, rm, writeFile } = await import("node:fs/promises");
const { tmpdir } = await import("node:os");
const { join } = await import("node:path");
const { build } = await import("../src/index.mjs");
const { createReviewServer } = await import("../src/review-server.mjs");
const { HISTORY_SCHEMA, ancestorIds, callPath, displayParameters, helperFrame, operationHistory } = await import("../src/viewer/history.mjs");
const { createApi } = await import("../viewer/core/api.js");
const { createDom } = await import("../viewer/core/dom.js");
const { createSettings } = await import("../viewer/core/settings.js");
const { sourceFor } = await import("../viewer/core/scene-records.js");
const { EDITOR_SETTING, editorHref, headlineText, sourceLinks, sourceMarkup, sourceReference, useEditorSetting } = await import("../viewer/features/source/source-section.js");
const { createSourceDrawer, lineSummary, sourceMarks, targetReference } = await import("../viewer/features/source/source-drawer.js");
const { createFakeEnvironment } = await import("../scripts/viewer/test-support/fake-env.mjs");
// Source links (package source-links): face- and edge-level sketch sources
// before the body operation, call chain headlines for helper bodies, editor
// links, GET /api/models/:id/history and source-to-geometry in the drawer.
//
// Real kernel models (arc slot, a helper-built part) pin the recorded data
// the viewer reads; small synthetic models pin the Boolean origin, lineage
// and removal rules and the r10b call-chain shape without a 5 s r10b build.
















const ARC_SLOT = `FeatureScript 3044;
import(path : "onshape/std/geometry.fs", version : "3044.0");

export function arcSlot(context is Context, id is Id, definition is map)
{
    var s = newSketchOnPlane(context, id + "s", {
        "sketchPlane" : plane(vector(0, 0, 0) * millimeter, vector(0, 0, 1), vector(1, 0, 0))
    });
    skLineSegment(s, "bottom", { "start" : vector(-10, -5) * millimeter, "end" : vector(10, -5) * millimeter });
    skArc(s, "right", { "start" : vector(10, -5) * millimeter, "mid" : vector(15, 0) * millimeter, "end" : vector(10, 5) * millimeter });
    skLineSegment(s, "top", { "start" : vector(10, 5) * millimeter, "end" : vector(-10, 5) * millimeter });
    skArc(s, "left", { "start" : vector(-10, 5) * millimeter, "mid" : vector(-15, 0) * millimeter, "end" : vector(-10, -5) * millimeter });
    skSolve(s);
    opExtrude(context, id + "slot", { "entities" : qSketchRegion(id + "s", false),
        "direction" : vector(0, 0, 1), "endBound" : BoundingType.BLIND, "endDepth" : 4 * millimeter });
}
`;

const HELPER = `FeatureScript 3044;
import(path : "onshape/std/geometry.fs", version : "3044.0");

function makeBlock(context is Context, id is Id, size is Vector)
{
    fCuboid(context, id, { "corner1" : vector(0, 0, 0) * millimeter, "corner2" : size });
}

export function helperPart(context is Context, id is Id, definition is map)
{
    makeBlock(context, id + "a", vector(10, 10, 4) * millimeter);
    makeBlock(context, id + "b", vector(30, 4, 8) * millimeter);
}
`;

// A live source outside the repository, as on macOS ($TMPDIR, with a space).
const TMP_FILE = '/private/var/folders/q1/x y/T/wonky-live/arc slot.fs';
const MODEL_ID = 'a'.repeat(64);
const arcSlot = await build(ARC_SLOT, { sourcePath: TMP_FILE });
const helperPart = await build(HELPER, { sourcePath: '/work/cad/helper.fs' });

// JSON scene records the way src/review-scene.mjs shapes them: every face and
// edge carries the body's operation source, its identity carries the rest.
function sceneOf(model, id = MODEL_ID) {
  return {
    id, label: 'model', sourceMap: model.sourceMap,
    bodies: model.bodies.map(body => {
      const source = body.identity?.operation?.source ?? body.debug?.source;
      const topology = body.identity?.topology ?? {};
      return {
        id: body.id, name: body.name ?? body.id, identity: body.identity, source,
        debug: body.debug,
        faces: body.faces.map((face, index) => ({
          index, surfaceType: face.surface.type, edgeIndices: [], triangles: [],
          identity: topology.faces?.[index], source,
        })),
        edges: body.edges.map((edge, index) => ({
          index, curveType: typeof edge.curve === 'string' ? edge.curve : edge.curve.type,
          points: [], identity: topology.edges?.[index], source,
        })),
        vertices: body.vertices.map((point, index) => ({
          index, point, identity: topology.vertices?.[index], source,
        })),
      };
    }),
  };
}

function recordsOf(scene, bodyIndex, kind, index) {
  const body = scene.bodies[bodyIndex];
  const entity = kind === 'body' ? body : body[{ face: 'faces', edge: 'edges' }[kind]][index];
  return { scene, body, entity };
}

const text = markup => markup.replace(/<[^>]+>/g, '').replace(/&quot;/g, '"')
  .replace(/&amp;/g, '&');
const rightFace = scene => scene.bodies[0].faces
  .findIndex(face => face.identity?.source?.entityId === 'right');

test('history lists recorded calls with spans, call paths and mm/deg parameters', () => {
  const doc = operationHistory(arcSlot, { modelId: MODEL_ID });
  assert.equal(doc.schema, HISTORY_SCHEMA);
  assert.equal(doc.available, true);
  assert.deepEqual(doc.exactness,
    { operations: 'recorded', links: 'recorded', parameters: 'design-parameter' });
  assert.deepEqual(doc.operations.map(op => [op.name, op.span.line]), [
    ['newSketchOnPlane', 6], ['skLineSegment', 9], ['skArc', 10], ['skLineSegment', 11],
    ['skArc', 12], ['skSolve', 13], ['opExtrude', 14],
  ]);
  const extrude = doc.operations[6];
  assert.equal(extrude.file, TMP_FILE);
  assert.deepEqual(extrude.outputs, [{ bodyId: 'model/slot', alias: 'B1' }]);
  assert.deepEqual(extrude.callPath.map(frame => frame.name), ['arcSlot']);
  assert.equal(extrude.callSite, null, 'the feature entry is not a helper call');
  assert.deepEqual(extrude.parametersDisplay.find(row => row.path === '[1].endDepth'),
    { path: '[1].endDepth', value: 4, unit: 'mm', si: 0.004 });
  assert.deepEqual(doc.operations[2].sketch, { id: 'model/s', entityId: 'right' });
  assert.equal(doc.bodies[0].operation, 6);
});

test('faces and edges link to their sketch entity and operation', () => {
  const doc = operationHistory(arcSlot, { modelId: MODEL_ID });
  const body = doc.bodies[0];
  const right = body.faces.find(face => face.sketchEntity?.entityId === 'right');
  assert.equal(right.operation, 6);
  assert.deepEqual(right.sketchEntity.span, { line: 10, column: 5 });
  assert.equal(right.sketchEntity.operation, 2);
  assert.equal(right.sketchEntity.curveType, 'arc');
  const caps = body.edges.filter(edge => edge.sketchEntity?.entityId === 'right');
  assert.equal(caps.length, 2, 'both cap edges of the arc face carry the sketch entity');
  assert.ok(body.faces.filter(face => !face.sketchEntity).length === 2, 'caps have no entity');
});

test('the line index maps sketch lines, operation lines and blank lines', () => {
  const doc = operationHistory(arcSlot, { modelId: MODEL_ID });
  assert.equal(doc.files.length, 1);
  const { lines, file } = doc.files[0];
  assert.equal(file, TMP_FILE);
  const right = lines[10];
  assert.deepEqual(right.operations.map(op => op.name), ['skArc']);
  assert.equal(right.links[0].relation, 'sketch-entity');
  const face = right.targets.find(target => target.entityType === 'face');
  assert.deepEqual(Object.keys(targetReference(face)),
    ['modelId', 'bodyId', 'entityType', 'entityIndex']);
  assert.equal(face.alias, `B1.F${rightFace(sceneOf(arcSlot)) + 1}`);
  assert.equal(right.targets.filter(target => target.entityType === 'edge').length, 2);
  assert.deepEqual(lines[14].links.map(link => [link.relation, link.targets.map(t => t.alias)]),
    [['operation', ['B1']]]);
  assert.equal(lines[13].links[0].relation, 'sketch', 'skSolve links the whole sketch');
  assert.equal(lines[7], undefined, 'no recorded call at line 7');
});

test('helper calls: call path, call site and call links', () => {
  const doc = operationHistory(helperPart, { modelId: MODEL_ID });
  const [first, second] = doc.operations;
  assert.deepEqual(first.callSite, {
    name: 'makeBlock', line: 11, column: 5, file: '/work/cad/helper.fs',
    sha256: first.sha256,
  });
  assert.equal(second.callSite.line, 12);
  const { lines } = doc.files[0];
  assert.deepEqual(lines[6].targets.map(target => target.alias), ['B1', 'B2']);
  assert.deepEqual(lines[11].links.map(link => [link.relation, link.via,
    link.targets.map(target => target.alias)]), [['call', 'makeBlock', ['B1']]]);
  assert.deepEqual(lines[12].targets.map(target => target.alias), ['B2']);
});

test('call paths drop duplicate wrapper frames; the helper is the innermost call', () => {
  const stack = [
    { name: 'r10bRetainedContext', calledAt: null, declaration: { line: 1393, column: 48 } },
    { name: 'r10bRetainedContext', calledAt: null, declaration: { line: 1393, column: 48 } },
    { name: 'buildRetainedContext', calledAt: { line: 1393, column: 122 },
      declaration: { line: 1366, column: 10 } },
    { name: 'copyBody', calledAt: { line: 1382, column: 10 },
      declaration: { line: 19, column: 10 } },
  ];
  assert.deepEqual(callPath(stack).map(frame => frame.name),
    ['r10bRetainedContext', 'buildRetainedContext', 'copyBody']);
  assert.equal(helperFrame(stack).name, 'copyBody');
  assert.equal(helperFrame(stack.slice(0, 2)), null);
  assert.deepEqual(displayParameters([{ angle: { type: 'Quantity', value: Math.PI / 2,
    lengthPower: 0, anglePower: 1 } }]), [{ path: '[0].angle', value: 90, unit: 'deg',
    si: Math.PI / 2 }]);
});

// Synthetic Boolean: plate (line 6) minus tool (line 10) at line 14, a copy
// of a removed body (line 20 from line 30, removed at line 31).
function syntheticModel() {
  const source = { file: '/work/part.fs', sha256: 'c'.repeat(64) };
  const at = line => ({ ...source, span: { line, column: 5 } });
  const stack = [{ name: 'part', calledAt: null, declaration: { line: 4, column: 1 } }];
  const plane = { surface: { type: 'plane' }, loops: [] };
  const operations = [
    { sequence: 0, name: 'fCuboid', operationId: 'model/plate', source: at(6), callStack: stack,
      outputs: [{ bodyId: 'model/plate' }], removedBodies: [] },
    { sequence: 1, name: 'fCuboid', operationId: 'model/tool', source: at(10), callStack: stack,
      outputs: [{ bodyId: 'model/tool' }], removedBodies: [] },
    { sequence: 2, name: 'opBoolean', operationId: 'model/cut', source: at(14),
      callStack: stack, outputs: [{ bodyId: 'model/cut/0' }],
      removedBodies: ['model/plate', 'model/tool'] },
    { sequence: 3, name: 'fCuboid', operationId: 'model/src', source: at(18), callStack: stack,
      outputs: [{ bodyId: 'model/src' }], removedBodies: [] },
    { sequence: 4, name: 'opPattern', operationId: 'model/copy', source: at(20),
      callStack: [...stack, { name: 'copyBody', calledAt: { line: 30, column: 3 },
        declaration: { line: 19, column: 1 } }], outputs: [{ bodyId: 'model/copy/0' }],
      removedBodies: [] },
    { sequence: 5, name: 'opDeleteBodies', operationId: 'model/clean', source: at(31),
      callStack: stack, outputs: [], removedBodies: ['model/src'] },
    { sequence: 6, name: 'setProperty', operationId: null, source: at(33), callStack: stack,
      outputs: [], removedBodies: [] },
  ];
  const cut = {
    id: 'model/cut/0', debug: { sourceOperation: 2 }, faces: [plane, plane, plane], edges: [{}],
    vertices: [[0, 0, 0]],
    construction: {
      faceOrigins: [
        { owner: { $: 'FaceRef', operand: 0, index: 1 }, contributors: { $: 'Nil' } },
        { owner: { $: 'FaceRef', operand: 1, index: 4 }, contributors: { $: 'Nil' } },
        { owner: { $: 'FaceRef', operand: 0, index: 2 }, contributors: { $: 'Con',
          head: { $: 'FaceRef', operand: 1, index: 5 }, tail: { $: 'Nil' } } },
      ],
      edgeOrigins: [{ $: 'FaceIntersection', first: { $: 'FaceRef', operand: 0, index: 1 },
        second: { $: 'FaceRef', operand: 1, index: 4 } }],
    },
    identity: { operationId: 'model/cut', topology: { faces: [{ operationId: 'model/cut' }] } },
    operationHistory: [{ evidence: { inputs: [
      { operand: 0, bodyId: 'model/plate', identity: { operationId: 'model/plate' } },
      { operand: 1, bodyId: 'model/tool', identity: { operationId: 'model/tool' } },
    ] } }],
  };
  const copy = {
    id: 'model/copy/0', debug: { sourceOperation: 4 }, faces: [plane], edges: [], vertices: [],
    identity: { operation: { parentOperations: ['model/src'] } },
  };
  return { sourceMap: { source, operations }, bodies: [cut, copy] };
}

test('Boolean origins, recorded lineage and removals decide what a line produced', () => {
  const model = syntheticModel();
  assert.deepEqual([...ancestorIds(model.bodies[0])].sort(),
    ['model/plate', 'model/tool']);
  const { lines } = operationHistory(model, { modelId: MODEL_ID }).files[0];
  const aliases = line => lines[line].targets.map(target => target.alias);
  assert.equal(lines[6].links[0].relation, 'boolean-origin');
  assert.deepEqual(aliases(6), ['B1.F1', 'B1.F3', 'B1.E1']);
  assert.deepEqual(aliases(10), ['B1.F2', 'B1.F3', 'B1.E1']);
  assert.deepEqual(aliases(14), ['B1']);
  assert.deepEqual(lines[18].links.map(link => link.relation), ['descendant']);
  assert.deepEqual(aliases(18), ['B2']);
  assert.deepEqual(aliases(30), ['B2']);
  assert.equal(lines[30].links[0].via, 'copyBody');
  assert.deepEqual(lines[31].targets, []);
  assert.deepEqual(lines[31].notes, [{ kind: 'removed-bodies', operation: 5,
    bodies: ['model/src'] }]);
  assert.match(lineSummary(lines[31], 31).text,
    /^Line 31 \(opDeleteBodies\) produced no geometry in this revision: it removed 1 body\.$/);
  assert.match(lineSummary(lines[33], 33).text, /sets body properties, not geometry/);
  assert.match(lineSummary(lines[18], 18).text, /descendant body \(recorded lineage/);
  assert.match(lineSummary(undefined, 2).text,
    /^Line 2 has no recorded modeling call, sketch entity or helper call/);
});

test('a model without a source map answers an explicit empty history', () => {
  const doc = operationHistory({ bodies: [] }, { modelId: MODEL_ID });
  assert.equal(doc.available, false);
  assert.deepEqual(doc.operations, []);
  assert.deepEqual(doc.files, []);
  assert.match(doc.scope, /no recorded source map/);
});

test('GET /api/models/:id/history answers the history and 404 for unknown revisions',
  async t => {
    const directory = await mkdtemp(join(tmpdir(), 'wonky-source-links-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const path = join(directory, 'arc-slot.brep.json');
    await writeFile(path, JSON.stringify(arcSlot, null, 2) + '\n');
    const server = await createReviewServer({
      port: 0, modelPaths: [path], reviewDirectory: join(directory, 'reviews'), log: () => {},
    });
    t.after(() => server.close());
    const base = server.url.replace('/viewer/', '');
    const { models } = await (await fetch(`${base}/api/workspace`)).json();
    const response = await fetch(`${base}/api/models/${models[0].id}/history`);
    assert.equal(response.status, 200);
    const doc = await response.json();
    assert.equal(doc.schema, HISTORY_SCHEMA);
    assert.equal(doc.modelId, models[0].id);
    assert.equal(doc.files[0].lines[10].targets[0].modelId, models[0].id);
    const missing = await fetch(`${base}/api/models/${'f'.repeat(64)}/history`);
    assert.equal(missing.status, 404);
  });

test('the arc-slot right face shows skArc line 10 first and opExtrude line 14 as context', () => {
  const scene = sceneOf(arcSlot);
  const records = recordsOf(scene, 0, 'face', rightFace(scene));
  const links = sourceLinks(records, sourceFor(records));
  assert.equal(links.primary.kind, 'sketch-entity');
  assert.equal(links.primary.name, 'skArc');
  assert.equal(links.primary.span.line, 10);
  assert.equal(links.context.name, 'opExtrude');
  assert.equal(links.context.span.line, 14);
  const markup = sourceMarkup(sourceFor(records), records, { editor: 'zed' });
  assert.match(markup, /<h3>Sketch source<\/h3>/);
  const plain = text(markup);
  assert.match(plain, /skArc "right" · line 10/);
  assert.ok(plain.indexOf('skArc') < plain.indexOf('opExtrude'), 'sketch entity first');
  assert.match(plain, /ContextopExtrude model\/slotline 14/);
  assert.match(markup, /class="source-code-line source-current" data-line="10"/);
  assert.doesNotMatch(markup, /data-line="14"/, 'the recorded 6-line excerpt ends at 13');
  assert.match(markup, /id="open-source"/);
  assert.match(markup, /id="copy-source"/);
  const zed = 'zed://file/private/var/folders/q1/x%20y/T/wonky-live/arc%20slot.fs';
  assert.ok(markup.includes(`href="${zed}:10:5"`), 'primary editor link with line and column');
  assert.ok(markup.includes(`href="${zed}:14:5"`), 'context editor link');
});

test('arc-slot edges use their cap sketch entity; plain faces fall back to the operation', () => {
  const scene = sceneOf(arcSlot);
  const edge = scene.bodies[0].edges.findIndex(item => item.identity?.source?.entityId === 'top');
  const edgeLinks = sourceLinks(recordsOf(scene, 0, 'edge', edge));
  assert.equal(edgeLinks.primary.name, 'skLineSegment');
  assert.equal(edgeLinks.primary.span.line, 11);
  assert.match(sourceMarkup(null, recordsOf(scene, 0, 'edge', edge)),
    /Sketch entity recorded for this edge/);
  const cap = scene.bodies[0].faces.findIndex(face => !face.identity?.source);
  const capRecords = recordsOf(scene, 0, 'face', cap);
  const capLinks = sourceLinks(capRecords, sourceFor(capRecords));
  assert.equal(capLinks.primary.kind, 'operation');
  assert.equal(capLinks.context, null);
  assert.match(sourceMarkup(sourceFor(capRecords), capRecords), /<h3>Operation source<\/h3>/);
  const bodyLinks = sourceLinks(recordsOf(scene, 0, 'body'));
  assert.equal(bodyLinks.primary.name, 'opExtrude');
});

test('browser and server agree on every sketch-entity line and helper call site', () => {
  for (const model of [arcSlot, helperPart]) {
    const scene = sceneOf(model);
    const doc = operationHistory(model, { modelId: MODEL_ID });
    scene.bodies.forEach((body, bodyIndex) => {
      for (const [kind, key] of [['face', 'faces'], ['edge', 'edges']]) {
        body[key].forEach((_entity, index) => {
          const links = sourceLinks(recordsOf(scene, bodyIndex, kind, index));
          const server = doc.bodies[bodyIndex][key][index];
          const expected = server.sketchEntity?.span?.line
            ?? doc.operations[server.operation].span.line;
          assert.equal(links.primary.span.line, expected, `${kind} ${index}`);
          const site = doc.operations[server.operation].callSite?.line ?? null;
          if (!server.sketchEntity) assert.equal(links.helper?.calledAt.line ?? null, site);
        });
      }
    });
  }
});

test('helper bodies headline their call chain', () => {
  const scene = sceneOf(helperPart);
  const links = sourceLinks(recordsOf(scene, 1, 'face', 0));
  assert.equal(headlineText(links), 'makeBlock (line 6) called from helper.fs:12');
  const markup = sourceMarkup(null, recordsOf(scene, 1, 'face', 0), { editor: 'zed' });
  assert.match(text(markup), /makeBlock \(line 6\) called from helper\.fs:12/);
  assert.ok(markup.includes('href="zed://file/work/cad/helper.fs:12:5"'), 'call site link');
});

// r10b-retained body R39, as recorded (sourceMap op 9 and its body debug).
function r10bScene(file) {
  const source = { language: 'FeatureScript', file, sha256: '219e'.padEnd(64, '0'),
    span: { line: 20, column: 2 },
    excerpt: { firstLine: 18, text: 'a\nfunction copyBody(…) {try {\n opPattern(…);\n}\nb\nc' } };
  const callStack = [
    { name: 'r10bRetainedContext', calledAt: null, declaration: { line: 1393, column: 48 } },
    { name: 'r10bRetainedContext', calledAt: null, declaration: { line: 1393, column: 48 } },
    { name: 'buildRetainedContext', calledAt: { line: 1393, column: 122 },
      declaration: { line: 1366, column: 10 } },
    { name: 'copyBody', calledAt: { line: 1382, column: 10 },
      declaration: { line: 19, column: 10 } },
  ];
  const external = { namespace: '["onshape"]', entityId: 'SxXiC', document: '889f' };
  const id = 'model/gR39/copy/model/sourcecarrier/rR39';
  const body = {
    id, name: 'R39 P02 rail carrier right', debug: { sourceOperation: 9, source, callStack },
    identity: { operationId: id, source: external, operation: { source, callStack } },
    faces: [{ index: 0, surfaceType: 'plane', edgeIndices: [], triangles: [], source,
      identity: { operationId: id, stability: 'source', source: external } }],
    edges: [], vertices: [],
  };
  const operations = [{ sequence: 9, name: 'opPattern', operationId: 'model/gR39',
    status: 'completed', source, callStack, outputs: [{ bodyId: id }] }];
  return { id: MODEL_ID, label: 'r10b', sourceMap: { operations }, bodies: [body] };
}

test('an r10b helper body reads "copyBody (line 20) called from r10b.fs:1382"', () => {
  const scene = r10bScene('~/wonky-kernel/fixtures/r10b/r10b.fs');
  for (const kind of ['body', 'face']) {
    const records = recordsOf(scene, 0, kind, 0);
    const links = sourceLinks(records, sourceFor(records));
    assert.equal(links.primary.kind, 'operation', 'the external import record is not code');
    assert.equal(headlineText(links), 'copyBody (line 20) called from r10b.fs:1382');
    const markup = sourceMarkup(sourceFor(records), records, { editor: 'zed' });
    assert.match(text(markup), /copyBody \(line 20\) called from r10b\.fs:1382/);
    assert.match(markup, /<h3>Operation source<\/h3>/);
    assert.ok(markup.includes('zed://file~/wonky-kernel/fixtures/r10b/r10b.fs:1382:10'));
    assert.equal(callPath(links.primary.callStack).length, 3);
  }
  const unrecorded = r10bScene(null);
  const links = sourceLinks(recordsOf(unrecorded, 0, 'body'));
  assert.equal(headlineText(links), 'copyBody (line 20) called from line 1382');
  assert.match(sourceMarkup(null, recordsOf(unrecorded, 0, 'body')), /No file path recorded/);
});

test('editor links follow the editor setting and encode paths outside the repository', () => {
  const span = { line: 10, column: 5 };
  assert.equal(editorHref(TMP_FILE, span, 'zed'),
    'zed://file/private/var/folders/q1/x%20y/T/wonky-live/arc%20slot.fs:10:5');
  assert.equal(editorHref(TMP_FILE, span, 'vscode'),
    'vscode://file/private/var/folders/q1/x%20y/T/wonky-live/arc%20slot.fs:10:5');
  assert.equal(editorHref(TMP_FILE, span, 'cursor').slice(0, 14), 'cursor://file/');
  assert.equal(editorHref(TMP_FILE, span, 'emacs').slice(0, 11), 'zed://file/',
    'unknown schemes fall back to zed');
  assert.equal(editorHref('relative/part.fs', span, 'zed'), null);
  assert.equal(editorHref(TMP_FILE, null, 'zed'), null);
  const scene = sceneOf(arcSlot);
  const records = recordsOf(scene, 0, 'face', rightFace(scene));
  useEditorSetting(() => 'vscode');
  try {
    const markup = sourceMarkup(sourceFor(records), records);
    assert.match(markup, /href="vscode:\/\/file\/private\/var\/folders\/q1\/x%20y\/T\//);
    assert.match(markup, />Open in VS Code</);
  } finally {
    useEditorSetting(() => 'zed');
  }
  assert.deepEqual(EDITOR_SETTING.choices, ['zed', 'vscode', 'cursor']);
  assert.equal(EDITOR_SETTING.key, 'editor');
});

test('a record-only source (no source map) keeps the operation section', () => {
  const source = { file: 'intersection.fs', sha256: 'c'.repeat(64), span: { line: 14 } };
  const body = { id: 'part', source, faces: [{ index: 0, surfaceType: 'plane', source,
    identity: { operationId: 'intersection' } }], edges: [], vertices: [] };
  const records = { scene: { bodies: [body] }, body, entity: body.faces[0] };
  const markup = sourceMarkup(sourceFor(records), records);
  assert.match(markup, /<h3>Operation source<\/h3>/);
  assert.match(markup, /Line 14/);
  assert.match(markup, /No file path recorded/, 'relative paths get no editor link');
  assert.equal(sourceMarkup(null, { scene: { bodies: [] }, body: { id: 'x' }, entity: null }), '');
});

// A minimal source feature context over the fake browser environment.
function drawerContext({ legacy, dispatch, selection = null, scene = null }) {
  const fake = createFakeEnvironment({ dispatch });
  const api = createApi(fake.env);
  const selected = [];
  const state = {
    scenes: new Map(scene ? [[scene.id, scene]] : []), selection,
    selectionSet: selection ? [selection] : [], after: scene?.id ?? null, before: null,
    workspace: { models: [{ id: MODEL_ID, label: 'arc slot r1' }] },
  };
  const ctx = {
    env: fake.env, api, legacy, state, dom: createDom(fake.document),
    settings: createSettings({ api, legacy: true }),
    slots: { settings: { item() {} } },
    app: {
      renderInspector() {},
      select(references) {
        const list = [references].flat().filter(Boolean);
        selected.push(list);
        state.selection = list[0] ?? null;
        state.selectionSet = list;
      },
    },
    drawer: {
      async open({ load, render }) {
        const data = await load();
        render?.(data);
        return data;
      },
    },
  };
  return { fake, ctx, selected, state };
}

const flush = () => new Promise(resolve => setImmediate(resolve));
const click = (fake, line) => fake.node('#report-content [data-source-view="1"] .source-full')
  .emit('click', { target: { closest: () => ({ dataset: { line: String(line) } }) } });

test('the drawer marks the selection lines and makes one request under the legacy seam',
  async () => {
    const scene = sceneOf(arcSlot);
    const face = rightFace(scene);
    const requests = [];
    const { fake, ctx } = drawerContext({
      legacy: true, scene,
      selection: { modelId: MODEL_ID, bodyId: 'model/slot', entityType: 'face', entityIndex: face },
      dispatch: path => {
        requests.push(path);
        return { file: TMP_FILE, sha256: arcSlot.sourceMap.source.sha256, text: ARC_SLOT };
      },
    });
    const openSource = createSourceDrawer(ctx);
    const records = recordsOf(scene, 0, 'face', face);
    await openSource(sourceFor(records));
    assert.deepEqual(requests, [`/api/source/${arcSlot.sourceMap.source.sha256}`]);
    const markup = fake.node('#report-content').innerHTML;
    assert.match(markup, /source-current" data-line="10"/);
    assert.match(markup, /source-context-line" data-line="14"/);
    assert.match(markup, /Line 10 · skArc &quot;right&quot; \(selection\)/);
    assert.match(markup, /Line 14 · opExtrude \(context\)/);
    assert.ok(markup.includes('zed://file/private/var/folders/q1/x%20y/T/wonky-live/'
      + 'arc%20slot.fs:10:5"'), 'drawer editor link at the primary line and column');
    assert.equal(fake.node('#report-title').textContent, 'arc slot.fs');
    click(fake, 10);
    await flush();
    assert.deepEqual(requests.length, 1, 'no history request under the legacy seam');
  });

test('clicking a drawer line selects what it produced or says it produced none', async () => {
  const scene = sceneOf(arcSlot);
  const history = operationHistory(arcSlot, { modelId: MODEL_ID });
  const requests = [];
  const { fake, ctx, selected } = drawerContext({
    legacy: false, scene,
    dispatch: path => {
      requests.push(path);
      if (path.endsWith('/history')) return history;
      return { file: TMP_FILE, sha256: arcSlot.sourceMap.source.sha256, text: ARC_SLOT };
    },
  });
  const openSource = createSourceDrawer(ctx);
  await openSource({ sha256: arcSlot.sourceMap.source.sha256, span: { line: 14 } });
  await flush();
  assert.deepEqual(requests, [`/api/source/${arcSlot.sourceMap.source.sha256}`,
    `/api/models/${MODEL_ID}/history`]);
  const view = '#report-content [data-source-view="1"]';
  const linked = fake.node(`${view} [data-line="10"]`);
  assert.ok(linked.classList.contains('source-linked'), 'line 10 is marked as linked');
  assert.equal(linked.getAttribute('tabindex'), '0');
  assert.match(fake.node(`${view} .source-line-status`).textContent,
    /^7 lines of this file produced geometry in arc slot r1/);
  click(fake, 10);
  await flush();
  const face = rightFace(scene);
  assert.equal(selected.length, 1);
  assert.deepEqual(selected[0][0],
    { modelId: MODEL_ID, bodyId: 'model/slot', entityType: 'face', entityIndex: face });
  assert.equal(selected[0].length, 3, 'the arc face and its two cap edges');
  assert.match(fake.node(`${view} .source-line-status`).textContent,
    /^Line 10 \(skArc\) produced 3 entities \(recorded\): sketch entity: B1\.F\d+, B1\.E\d+, B1\.E\d+\. Selected in the viewport\.$/);
  click(fake, 7);
  await flush();
  assert.deepEqual(selected.at(-1), [], 'the drawer clears its own earlier highlight');
  assert.match(fake.node(`${view} .source-line-status`).textContent,
    /^Line 7 has no recorded modeling call/);
  const toggle = fake.node(`${view} .source-collapse`);
  toggle.emit('click');
  assert.ok(fake.node(view).classList.contains('source-collapsed'), 'Hide code collapses');
  assert.equal(toggle.textContent, 'Show code');
  toggle.emit('click');
  assert.equal(fake.node(view).classList.contains('source-collapsed'), false);
  click(fake, 9);
  await flush();
  click(fake, 13);
  await flush();
  assert.equal(requests.length, 2, 'the history is loaded once per model');
});

test('the copyable source reference keeps the recorded keys and adds the face-level source',
  () => {
    const scene = sceneOf(arcSlot);
    const records = recordsOf(scene, 0, 'face', rightFace(scene));
    const source = sourceFor(records);
    const reference = sourceReference(sourceLinks(records, source), source);
    for (const key of Object.keys(source)) assert.deepEqual(reference[key], source[key]);
    assert.equal(reference.span.line, 14, 'the recorded operation descriptor is unchanged');
    assert.equal(reference.sketchEntity.name, 'skArc');
    assert.deepEqual(reference.sketchEntity.span, { line: 10, column: 5 });
    const helper = r10bScene('/w/r10b.fs');
    const body = recordsOf(helper, 0, 'body');
    assert.deepEqual(sourceReference(sourceLinks(body, sourceFor(body)), sourceFor(body))
      .callSite, { name: 'copyBody', file: '/w/r10b.fs', line: 1382, column: 10 });
  });

test('source marks fall back to the given span without a selection', () => {
  const marks = sourceMarks('x', { sha256: 'x', span: { line: 3 } }, null);
  assert.deepEqual(marks, { current: 3, span: { line: 3 }, context: [], legend: [] });
  const helper = r10bScene('/w/r10b.fs');
  const links = sourceLinks(recordsOf(helper, 0, 'body'));
  const r10b = sourceMarks(links.primary.sha256, null, { links });
  assert.equal(r10b.current, 20);
  assert.deepEqual(r10b.context, [1382]);
  assert.equal(r10b.legend[0].text, 'opPattern model/gR39 in copyBody (selection)');
  assert.equal(r10b.legend[1].text, 'call to copyBody');
});

}
