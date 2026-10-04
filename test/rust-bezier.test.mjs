// Strand S10: FeatureScript skBezier on WONKY_BACKEND=rust (src/native/rust-host.mjs).
// The points of std sketch.fs skBezier are CONTROL points, the degree is the point
// count minus one (at most 7, the WC0 carrier limit), and a sketch holding a Bezier
// is one closed chain extruded by the curve-profile prism (S9,
// rust/wonky-ops/src/curve_profile.rs) through host ops CURVE_REGION (skSolve) and
// CURVE_EXTRUDE (opExtrude).
//
// AC100 (fixtures/cad-acid/zones.json) is the arch of the cubic Bezier with the
// controls (0,0) (8,6) (18,6) (26,0) mm over its chord, extruded 4 mm; V5 is its exact
// degree-4 elevation. Closed forms: volume 1584/5, area 1872/5, bbox
// (0,0,0)-(26,4.5,4), F4 E6 V4, probe_normal (49/8, 251/64, 2) -> 37/64, probe_apex
// (13, 5.5, 2) -> 1. Read as fit (through) points the same four points give another
// curve, which passes through (8,6) and rises above y = 6.
//
// The live CAD-Acid run (scripts/acid/run.mjs) is the kernel evidence; these tests pin
// the frontend contract: the catalog FS builds in every declared variant, the entity
// data reach Rust bit for bit (E9), the degree follows the point count, and what the
// path cannot take refuses by name. The dataflow tracer's closure rule is pinned here
// too (a fit spline or Bezier whose first and last points coincide bounds a region).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

process.env.WONKY_BACKEND = 'rust';
const { build } = await import('../src/index.mjs');
const { toStep } = await import('../src/exporters.mjs');
const { serializeModel } = await import('../src/construction-history.mjs');
const { FeatureScriptException } = await import('../src/errors.mjs');
const { RustCapabilityError, describeRustBody, measureRustBody, rustModelKernel } = await import('../src/native/rust-host.mjs');
const { traceFeatureScript } = await import('../src/lang/dataflow/fs-trace.mjs');

const root = fileURLToPath(new URL('../', import.meta.url));
const catalogFs = path.join(root, 'fixtures/cad-acid/fs/acid-splines-a.fs');
const splines = fs.readFileSync(catalogFs, 'utf8');
const bits = x => { const b = Buffer.alloc(8); b.writeDoubleLE(x); return b.readBigUInt64LE().toString(16).padStart(16, '0'); };
const near = (actual, expected, what, rel = 1e-12) =>
  assert.ok(Math.abs(actual - expected) <= rel * Math.max(1, Math.abs(expected)), `${what}: ${actual} != ${expected}`);
const ac100 = variant => build(splines, { feature: 'acidSplinesA', parameters: { variant: `AcidVariant.${variant}`, zone: 'AcidSplinesAZone.AC100' } });

const feature = body => `FeatureScript 3044;\nimport(path : "onshape/std/geometry.fs", version : "3044.0");
export const f = defineFeature(function(context is Context, id is Id, definition is map) precondition {} {
var s = newSketchOnPlane(context, id + "s", { "sketchPlane" : plane(vector(0, 0, 0) * millimeter, vector(0, 0, 1), vector(1, 0, 0)) });
${body}
});`;
const mm = p => `vector(${p[0]}, ${p[1]}) * millimeter`;
const bezier = (name, points, extra = '') => `skBezier(s, "${name}", { "points" : [${points.map(mm).join(', ')}]${extra} });`;
const line = (name, a, b) => `skLineSegment(s, "${name}", { "start" : ${mm(a)}, "end" : ${mm(b)} });`;
const extrude = `skSolve(s);
opExtrude(context, id + "e", { "entities" : qSketchRegion(id + "s"), "direction" : vector(0, 0, 1), "endBound" : BoundingType.BLIND, "endDepth" : 4 * millimeter });`;
const refusal = async body => build(feature(body), { feature: 'f' }).then(() => null, error => error);
const V0 = [[0, 0], [8, 6], [18, 6], [26, 0]];

test('AC100 from the catalog FS: one Bezier edge per cap over the control points, V0-V3 and V5', async () => {
  for (const variant of ['V0', 'V1', 'V2', 'V3', 'V5']) {
    const model = await ac100(variant);
    assert.equal(model.bodies.length, 1, variant);
    const body = model.bodies[0], kernel = rustModelKernel(model);
    const m = measureRustBody(kernel, body);
    assert.equal(m.certificate, 'CurveProfilePrism', variant);
    near(m.volumeMm3, 1584 / 5, `${variant} volume`);
    near(m.areaMm2, 1872 / 5, `${variant} area`);
    assert.deepEqual([m.topology.faces, m.topology.edges, m.topology.vertices], [4, 6, 4], variant);
    // The arch is a degree n - 1 carrier over the interpreter's binary64 metres, never a polyline.
    const splineCurves = describeRustBody(kernel, body).body.curves.filter(c => c.geometry.kind === 'BSpline');
    assert.equal(splineCurves.length, 2, `${variant}: one spline edge per cap`);
    const controls = variant === 'V5' ? [[0, 0], [6, 4.5], [13, 6], [20, 4.5], [26, 0]] : V0;
    const sketchEdge = splineCurves.find(c => c.geometry.controls.every(p => p[2] === bits(0)));
    assert.equal(sketchEdge.geometry.degree, controls.length - 1, `${variant} degree`);
    assert.deepEqual(sketchEdge.geometry.controls.map(p => p.slice(0, 2)), controls.map(p => p.map(k => bits(k * 0.001))), `${variant} controls (E9)`);
  }
  // V0 in its cell (origin (0, 3500, 0) mm): bbox and the three probes of the zone.
  const model = await ac100('V0');
  const m = measureRustBody(rustModelKernel(model), model.bodies[0], { probes: [[49 / 8, 3500 + 251 / 64, 2], [13, 3505.5, 2], [8, 3506, 2]] });
  for (const [got, want] of [...m.bboxMm.min, ...m.bboxMm.max].map((x, i) => [x, [0, 3500, 0, 26, 3504.5, 4][i]])) near(got, want, 'bbox', 1e-9);
  near(m.probes[0].distanceMm, 37 / 64, 'probe_normal');
  near(m.probes[1].distanceMm, 1, 'probe_apex');
  // The control point (8, 6) is not on the curve: the curve does not interpolate its controls.
  assert.equal(m.probes[2].inside, false);
  assert.ok(m.probes[2].distanceMm > 2, `control point (8,6) is ${m.probes[2].distanceMm} mm off the curve`);
});

test('the exports carry the spline: SURFACE_OF_LINEAR_EXTRUSION over a B-spline edge, brep.json serializes', async () => {
  const model = await ac100('V0');
  const step = toStep(model, 'ac100');
  assert.equal(step.match(/SURFACE_OF_LINEAR_EXTRUSION\(/g)?.length, 1);
  assert.equal(step.match(/B_SPLINE_CURVE_WITH_KNOTS\(/g)?.length >= 2, true);
  assert.equal(step.match(/B_SPLINE_SURFACE_WITH_KNOTS/g), null);
  const record = JSON.parse(serializeModel(model)).bodies[0];
  assert.equal(record.faces.length, 4);
  near(record.validation.volumeMm3, 1584 / 5, 'brep.json volume');
});

test('the CLI checks AC100 in one JSON object and exits 0', () => {
  const run = spawnSync(process.execPath, [path.join(root, 'bin/wonky.mjs'), catalogFs, '--param', 'zone=AcidSplinesAZone.AC100', '--json', '--check'],
    { cwd: root, encoding: 'utf8', env: { ...process.env, WONKY_BACKEND: 'rust' } });
  assert.equal(run.status, 0, run.stderr);
  const report = JSON.parse(run.stdout);
  assert.equal(report.bodies.length, 1);
  near(report.bodies[0].volumeMm3, 316.8, 'CLI volume');
});

test('the degree follows the point count up to 7; eight points build, nine refuse by name', async () => {
  // Degree 7 arch: the controls (0,0), (26k/7, h_k) with h_k > 0 inside, over the chord.
  const seven = Array.from({ length: 8 }, (_, k) => [26 * k / 7, k === 0 || k === 7 ? 0 : 3 + (k % 2)]);
  const model = await build(feature(bezier('arch', seven) + line('chord', [26, 0], [0, 0]) + extrude), { feature: 'f' });
  const kernel = rustModelKernel(model);
  const curve = describeRustBody(kernel, model.bodies[0]).body.curves.find(c => c.geometry.kind === 'BSpline');
  assert.equal(curve.geometry.degree, 7);
  // Green: the area under a Bezier graph over [0, 26] with equally spaced x controls is 26 * mean(y).
  near(measureRustBody(kernel, model.bodies[0]).volumeMm3, 4 * 26 * seven.reduce((a, p) => a + p[1], 0) / 8, 'degree-7 volume', 1e-9);
  const nine = Array.from({ length: 9 }, (_, k) => [26 * k / 8, k === 0 || k === 8 ? 0 : 3]);
  const error = await refusal(bezier('arch', nine) + line('chord', [26, 0], [0, 0]) + extrude);
  assert.ok(error instanceof RustCapabilityError, String(error));
  assert.equal(error.builtin, 'skBezier');
  assert.equal(error.reason, 'sketch/bezier-degree-cap');
  // std precondition: size(points) > 1 (a FeatureScript error, not a capability refusal).
  const one = await refusal(bezier('dot', [[0, 0]]) + extrude);
  assert.ok(one instanceof FeatureScriptException && !(one instanceof RustCapabilityError), String(one));
});

test('what the Bezier path cannot take refuses by name, never with the Bezier dropped', async () => {
  const chord = line('chord', [26, 0], [0, 0]);
  // The S-arch crosses its chord at C(1/2) = (13, 0): an algebraic vertex (strand S15).
  const sArch = await refusal(bezier('arch', [[0, 0], [8, -6], [18, 6], [26, 0]]) + chord + extrude);
  assert.ok(sArch instanceof RustCapabilityError, String(sArch));
  assert.deepEqual([sArch.builtin, sArch.reason], ['skSolve', 'curve2/crossing-needs-algebraic-vertex']);
  const construction = await refusal(bezier('arch', V0, ', "construction" : true') + chord + extrude);
  assert.deepEqual([construction?.builtin, construction?.reason], ['skBezier', 'construction geometry or sketch constraints']);
  const circle = await refusal(bezier('arch', V0) + chord + 'skCircle(s, "c", { "center" : vector(13, 2) * millimeter, "radius" : 1 * millimeter });' + extrude);
  assert.deepEqual([circle?.builtin, circle?.reason], ['skSolve', 'curve-profile/circle-in-chain']);
  const open = await refusal(bezier('arch', V0) + extrude);
  assert.ok(open instanceof RustCapabilityError, String(open));
  assert.equal(open.builtin, 'skSolve');
  // Consumers that read only the line lists must not see the arch as its chord.
  const arch = bezier('arch', V0) + chord + 'skSolve(s);';
  const revolve = await refusal(`${arch} opRevolve(context, id + "r", { "entities" : qSketchRegion(id + "s"), "axis" : line(vector(0, -1, 0) * millimeter, vector(1, 0, 0)), "angleForward" : 90 * degree });`);
  assert.deepEqual([revolve?.builtin, revolve?.reason], ['opRevolve', 'revolve/spline-profile']);
  const pick = await refusal(`${arch} opExtrude(context, id + "e", { "entities" : qContainsPoint(qSketchRegion(id + "s"), vector(13, 2, 0) * millimeter), "direction" : vector(0, 0, 1), "endBound" : BoundingType.BLIND, "endDepth" : 4 * millimeter });`);
  assert.deepEqual([pick?.builtin, pick?.reason], ['qContainsPoint', 'sketch-region/curved-profile-point-selection']);
  const loft = await refusal(`${arch} var t = newSketchOnPlane(context, id + "t", { "sketchPlane" : plane(vector(0, 0, 5) * millimeter, vector(0, 0, 1), vector(1, 0, 0)) });
    skRectangle(t, "r", { "firstCorner" : vector(0, 0) * millimeter, "secondCorner" : vector(26, 4) * millimeter }); skSolve(t);
    opLoft(context, id + "l", { "profileSubqueries" : [qSketchRegion(id + "s"), qSketchRegion(id + "t")] });`);
  assert.deepEqual([loft?.builtin, loft?.reason], ['opLoft', 'loft/planar-line-profiles-required']);
});

test('a Bezier chain with a three-point arc and a reversed extrusion measures the exact solid', async () => {
  // Below the chord a half disc of radius 13 about (13, 0): area 79.2 + 169 pi / 2.
  const body = bezier('arch', V0) + 'skArc(s, "cup", { "start" : vector(26, 0) * millimeter, "mid" : vector(13, -13) * millimeter, "end" : vector(0, 0) * millimeter });';
  const model = await build(feature(body + extrude.replace('vector(0, 0, 1), "endBound"', 'vector(0, 0, -1), "endBound"')), { feature: 'f' });
  const m = measureRustBody(rustModelKernel(model), model.bodies[0]);
  near(m.volumeMm3, 4 * (396 / 5 + 169 * Math.PI / 2), 'arch + half disc volume', 1e-9);
  near(m.bboxMm.min[2], -4, 'reversed bbox', 1e-9);
  near(m.bboxMm.max[2], 0, 'reversed bbox', 1e-9);
  assert.equal(m.topology.faces, 4);
});

test('the dataflow tracer counts a fit spline or Bezier whose ends coincide as a region', () => {
  const traced = entity => traceFeatureScript(`FeatureScript 3000;\nimport(path : "onshape/std/geometry.fs", version : "3000.0");
export const f = defineFeature(function(context is Context, id is Id, definition is map) precondition {} {
var s = newSketchOnPlane(context, id + "s", { "sketchPlane" : plane(vector(0, 0, 0) * millimeter, vector(0, 0, 1), vector(1, 0, 0)) });
skRectangle(s, "r", { "firstCorner" : vector(0, 0) * millimeter, "secondCorner" : vector(5, 5) * millimeter });
${entity}
skSolve(s);
opExtrude(context, id + "e", { "entities" : qSketchRegion(id + "s"), "direction" : vector(0, 0, 1), "endBound" : BoundingType.BLIND, "endDepth" : 1 * millimeter });
const n = size(evaluateQuery(context, qCreatedBy(id + "e", EntityType.BODY)));
});`);
  const loop = [[10, 0], [14, 8], [6, 8], [10, 0]], open = [[10, 0], [14, 8], [6, 8], [9, 0]];
  for (const name of ['skBezier', 'skFitSpline']) {
    const points = p => `{ "points" : [${p.map(mm).join(', ')}] }`;
    // A second region beside the rectangle: the body count is speculated and checked in the kernel.
    const closed = traced(`${name}(s, "b", ${points(loop)});`);
    assert.equal(closed.status, 'complete', closed.error?.message);
    assert.equal(closed.trace.speculations.length, 1, `${name} closed`);
    const openRun = traced(`${name}(s, "b", ${points(open)});`);
    assert.equal(openRun.status, 'complete', openRun.error?.message);
    assert.equal(openRun.trace.speculations.length, 0, `${name} open`);
  }
});
