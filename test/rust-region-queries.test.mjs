// Sweep of every query builtin the frontend defines, each combined with
// qSketchRegion and with a point-selected region and fed to opExtrude on strict
// rust. Every combination either builds with the exact volumes of a closed form
// or refuses with a stable named code and hint (an unnamed CLI_ERROR is a bug).
// Sketch s holds three squares (a 10x10, b 10x6, c 5x5), sketch t one more
// (d 8x8); the extrusion is 4 mm, so a, b, c, d have 400, 240, 100, 256 mm^3.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.WONKY_BACKEND = 'rust';
const { build } = await import('../src/index.mjs');
const { queryBuiltins } = await import('../src/queries.mjs');
const { errorCode } = await import('../src/errors.mjs');

const root = fileURLToPath(new URL('../', import.meta.url));
const A = 400, B = 240, C = 100;
const NAMED = /^[a-z][a-z0-9-]*(\/[a-z][a-z0-9-]*)*$/;

const source = expr => `FeatureScript 3044;
import(path : "onshape/std/geometry.fs", version : "3044.0");
export const f = defineFeature(function(context is Context, id is Id, definition is map) precondition {} {
  const xy = plane(vector(0, 0, 0) * millimeter, vector(0, 0, 1), vector(1, 0, 0));
  var s = newSketchOnPlane(context, id + "s", { "sketchPlane" : xy });
  skRectangle(s, "a", { "firstCorner" : vector(0, 0) * millimeter, "secondCorner" : vector(10, 10) * millimeter });
  skRectangle(s, "b", { "firstCorner" : vector(20, 0) * millimeter, "secondCorner" : vector(30, 6) * millimeter });
  skRectangle(s, "c", { "firstCorner" : vector(40, 0) * millimeter, "secondCorner" : vector(45, 5) * millimeter });
  skSolve(s);
  var t = newSketchOnPlane(context, id + "t", { "sketchPlane" : xy });
  skRectangle(t, "d", { "firstCorner" : vector(50, 0) * millimeter, "secondCorner" : vector(58, 8) * millimeter });
  skSolve(t);
  const R = qSketchRegion(id + "s");
  const T = qSketchRegion(id + "t");
  const P = qContainsPoint(R, vector(25, 3, 0) * millimeter);
  const Pa = qContainsPoint(R, vector(5, 5, 0) * millimeter);
  opExtrude(context, id + "e", { "entities" : ${expr}, "direction" : vector(0, 0, 1), "endBound" : BoundingType.BLIND, "endDepth" : 4 * millimeter });
});`;

const all = [A, B, C];
const empty = { code: 'empty-region' };
const topology = { code: 'sketch-region/topology-query-not-extrudable' };
const multi = { code: 'sketch-region/multi-sketch-point-selection' };
const mixed = { code: 'sketch-region/mixed-with-topology' };
// builtin -> [expression, { volumes } | { code }]. R is all three regions of
// sketch s, P the region b picked by a point, Pa the region a, T sketch t.
const rows = {
  qSketchRegion: [
    ['R', { volumes: all }], ['P', { volumes: [B] }], ['T', { volumes: [256] }],
  ],
  qUnion: [
    ['qUnion(R, P)', { volumes: all }], ['qUnion(P, Pa)', { volumes: [A, B] }], ['qUnion([P, Pa])', { volumes: [A, B] }],
    ['qUnion(P, qNothing())', { volumes: [B] }], ['qUnion(R, T)', { code: 'sketch-region/multiple-sketches' }],
    ['qUnion(P, qEverything(EntityType.FACE))', mixed],
  ],
  qSubtraction: [
    ['qSubtraction(R, P)', { volumes: [A, C] }], ['qSubtraction(R, qUnion(P, Pa))', { volumes: [C] }],
    ['qSubtraction(R, qNothing())', { volumes: all }], ['qSubtraction(P, R)', empty],
    ['qSubtraction(qUnion(R, T), T)', { volumes: all }], ['qSubtraction(P, qEverything(EntityType.FACE))', mixed],
  ],
  qIntersection: [
    ['qIntersection(R, P)', { volumes: [B] }], ['qIntersection(qUnion(P, Pa), Pa)', { volumes: [A] }],
    ['qIntersection(P, Pa)', empty], ['qIntersection(R, T)', empty], ['qIntersection(R, qEverything(EntityType.FACE))', mixed],
  ],
  qNothing: [['qNothing()', empty], ['qSubtraction(qNothing(), R)', empty]],
  qEverything: [
    ['qEverything(EntityType.FACE)', topology], ['qUnion(R, qEverything(EntityType.FACE))', mixed],
    ['qUnion(P, qEverything(EntityType.BODY))', mixed],
  ],
  qCreatedBy: [
    ['qCreatedBy(id + "s", EntityType.FACE)', topology], ['qUnion(R, qCreatedBy(id + "s", EntityType.FACE))', mixed],
  ],
  qAllModifiableSolidBodies: [
    ['qAllModifiableSolidBodies()', topology], ['qUnion(P, qAllModifiableSolidBodies())', mixed],
  ],
  qContainsPoint: [
    ['P', { volumes: [B] }], ['qContainsPoint(R, vector(30, 3, 0) * millimeter)', { volumes: [B] }], // a region is closed
    ['qContainsPoint(R, vector(15, 3, 0) * millimeter)', empty], ['qContainsPoint(R, vector(25, 3, 1) * millimeter)', empty],
    ['qContainsPoint(qUnion(P, Pa), vector(5, 5, 0) * millimeter)', { volumes: [A] }],
    ['qContainsPoint(qSubtraction(R, P), vector(25, 3, 0) * millimeter)', empty],
    ['qContainsPoint(qContainsPoint(R, vector(5, 5, 0) * millimeter), vector(25, 3, 0) * millimeter)', empty],
    ['qContainsPoint(qUnion(R, T), vector(54, 4, 0) * millimeter)', multi],
  ],
  qClosestTo: [
    ['qClosestTo(R, vector(25, 3, 0) * millimeter)', { volumes: [B] }], ['qClosestTo(R, vector(25, 3, 1) * millimeter)', { volumes: [B] }],
    ['qClosestTo(R, vector(15, 3, 0) * millimeter)', { volumes: [A, B] }], // 5 mm from a and from b: both
    ['qClosestTo(qSubtraction(R, P), vector(25, 3, 0) * millimeter)', { volumes: [A, C] }], // 15 mm from a and c
    ['qClosestTo(P, vector(0, 0, 0) * millimeter)', { volumes: [B] }], ['qClosestTo(qNothing(), vector(0, 0, 0) * millimeter)', topology],
    ['qClosestTo(qUnion(R, T), vector(60, 4, 0) * millimeter)', multi],
  ],
  qGeometry: [
    ['qGeometry(R, GeometryType.PLANE)', { volumes: all }], ['qGeometry(P, GeometryType.PLANE)', { volumes: [B] }],
    ['qGeometry(R, GeometryType.CYLINDER)', empty], ['qGeometry(P, GeometryType.LINE)', empty],
    ['qGeometry(qSubtraction(R, P), GeometryType.PLANE)', { volumes: [A, C] }],
  ],
  qEntityFilter: [
    ['qEntityFilter(R, EntityType.FACE)', { volumes: all }], ['qEntityFilter(P, EntityType.FACE)', { volumes: [B] }],
    ['qEntityFilter(R, EntityType.EDGE)', empty], ['qEntityFilter(P, EntityType.BODY)', empty],
    ['qEntityFilter(qUnion(P, Pa), EntityType.FACE)', { volumes: [A, B] }],
  ],
  qNthElement: [
    ['qNthElement(P, 0)', { volumes: [B] }], ['qNthElement(P, -1)', { volumes: [B] }],
    ['qNthElement(qNthElement(P, 0), 0)', { volumes: [B] }], ['qNthElement(qSubtraction(R, qUnion(P, Pa)), 0)', { volumes: [C] }],
    ['qNthElement(R, 0)', { code: 'sketch-region/nth-element-order-unspecified' }],
    ['qNthElement(P, 1)', { code: 'sketch-region/nth-element-out-of-range' }], ['qNthElement(P, -2)', { code: 'sketch-region/nth-element-out-of-range' }],
    ['qNthElement(qNothing(), 0)', { code: 'query/nth-element-topology-not-implemented' }],
  ],
  evaluateQuery: [
    ['evaluateQuery(context, P)[0]', { volumes: [B] }], ['qUnion(evaluateQuery(context, R))', { volumes: all }],
    ['qSubtraction(R, evaluateQuery(context, P)[0])', { volumes: [A, C] }], ['qUnion(evaluateQuery(context, qNothing()))', empty],
  ],
  qBodyType: [
    ['qBodyType(R, BodyType.SHEET)', { code: 'sketch-region/owner-body-type-undocumented' }],
    ['qBodyType(P, BodyType.SOLID)', { code: 'sketch-region/owner-body-type-undocumented' }],
  ],
  qOwnedByBody: [
    ['qOwnedByBody(R, EntityType.FACE)', { code: 'sketch-region/owner-body-undocumented' }],
    ['qOwnedByBody(P, EntityType.FACE)', { code: 'sketch-region/owner-body-undocumented' }],
    // std qOwnedByBody(queryToFilter, body): regions as the body.
    ['qOwnedByBody(qEverything(EntityType.FACE), R)', { code: 'sketch-region/owner-body-undocumented' }],
  ],
  qAdjacent: [
    ['qAdjacent(R, AdjacencyType.EDGE, EntityType.FACE)', { code: 'sketch-region/adjacency-unavailable' }],
    ['qAdjacent(P, AdjacencyType.VERTEX, EntityType.EDGE)', { code: 'sketch-region/adjacency-unavailable' }],
  ],
  qCoincidesWithPlane: [
    ['qCoincidesWithPlane(R, plane(vector(0, 0, 0) * millimeter, vector(0, 0, 1), vector(1, 0, 0)))', { code: 'sketch-region/coincidence-tolerance-unpublished' }],
    ['qCoincidesWithPlane(P, plane(vector(0, 0, 3) * millimeter, vector(0, 0, 1), vector(1, 0, 0)))', { code: 'sketch-region/coincidence-tolerance-unpublished' }],
  ],
  qParallelEdges: [
    ['qParallelEdges(R, vector(1, 0, 0))', { code: 'sketch-region/parallel-edges-of-faces-undocumented' }],
    ['qParallelEdges(P, vector(0, 1, 0))', { code: 'sketch-region/parallel-edges-of-faces-undocumented' }],
    // std qParallelEdges(queryToFilter, edges): regions as the reference edges.
    ['qParallelEdges(qEverything(EntityType.EDGE), R)', { code: 'sketch-region/parallel-edges-of-faces-undocumented' }],
  ],
  makeRobustQuery: [
    ['makeRobustQuery(context, R)', { code: 'sketch-region/robust-query-unavailable' }],
    ['makeRobustQuery(context, P)', { code: 'sketch-region/robust-query-unavailable' }],
  ],
};

const run = expr => build(source(expr), { feature: 'f', trace: false });
const outcome = async expr => {
  try { return { model: await run(expr) }; } catch (error) { return { error }; }
};

test('every query builtin the frontend defines has a sweep row', () => {
  const defined = Object.keys(queryBuiltins({})).filter(name => /^q[A-Z]/.test(name) || name === 'makeRobustQuery' || name === 'evaluateQuery');
  for (const name of [...defined, 'qSketchRegion']) assert.ok(rows[name]?.length >= 2, `no sweep rows for ${name}`);
  for (const name of Object.keys(rows)) assert.ok(defined.includes(name) || name === 'qSketchRegion', `row for unknown builtin ${name}`);
});

for (const [builtin, list] of Object.entries(rows)) {
  test(`${builtin} over sketch regions builds exactly or refuses by name`, async () => {
    for (const [expr, expected] of list) {
      const { model, error } = await outcome(expr);
      if (expected.volumes) {
        assert.ifError(error);
        const volumes = model.bodies.map(body => body.validation.volumeMm3).sort((x, y) => x - y);
        const want = [...expected.volumes].sort((x, y) => x - y);
        assert.equal(volumes.length, want.length, `${expr}: ${volumes}`);
        volumes.forEach((v, i) => assert.ok(Math.abs(v - want[i]) <= want[i] * 1e-9, `${expr}: ${volumes} != ${want}`));
      } else {
        assert.ok(error, `${expr} built`);
        const code = errorCode(error);
        assert.equal(code, expected.code, `${expr}: ${error.name} ${error.message}`);
        assert.match(code, NAMED, `${expr} is not a named code`);
      }
    }
  });
}

test('a refusal from a sketch-region query carries a hint and reaches the CLI as a named code', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wonky-region-'));
  try {
    const file = path.join(dir, 'f.fs');
    fs.writeFileSync(file, source('qAdjacent(R, AdjacencyType.EDGE, EntityType.FACE)'));
    const r = spawnSync(process.execPath, [path.join(root, 'bin/wonky.mjs'), file, '--feature', 'f', '--json'],
      { cwd: root, encoding: 'utf8', env: { ...process.env, WONKY_BACKEND: 'rust' } });
    assert.equal(r.status, 2, r.stderr);
    const report = JSON.parse(r.stdout);
    assert.equal(report.status, 'refused');
    const [refusal] = report.refusals;
    assert.equal(refusal.code, 'sketch-region/adjacency-unavailable');
    assert.equal(refusal.operation, 'qAdjacent');
    assert.match(refusal.hint, /qContainsPoint/);
    assert.match(r.stderr, /sketch-region\/adjacency-unavailable/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
