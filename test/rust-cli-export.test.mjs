// Acceptance at the real CLI boundary. The STL checks inspect the binary artifact,
// not the kernel's reported topology, volume, or print manifest.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const cli = path.join(root, 'bin/wonky.mjs');
const fixture = name => path.isAbsolute(name) ? name : path.join(root, 'fixtures/cli-export', name);
const temp = t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wonky-cli-export-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  return path.join(dir, 'model');
};

function runCli(source, prefix, ...args) {
  const run = spawnSync(process.execPath, [cli, fixture(source), '--feature',
    source === 'hemisphere.fs' ? 'hemisphere' : 'teaBox', '--out', prefix, '--json', ...args], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
    timeout: 120_000,
    env: {...process.env, WONKY_BACKEND: 'rust', NODE_OPTIONS: '--max-old-space-size=8192'},
  });
  assert.ifError(run.error);
  assert.equal(run.signal, null, `CLI signal ${run.signal}; stderr: ${run.stderr}`);
  let report;
  try { report = JSON.parse(run.stdout); }
  catch (error) { assert.fail(`--json must emit one JSON object on stdout (${error.message}); stdout: ${run.stdout}; stderr: ${run.stderr}`); }
  assert.equal(report.schema, 'wonky-cli/v1');
  assert.equal(typeof report.backend, 'object');
  assert.ok(report.backend && !Array.isArray(report.backend));
  assert.ok(report.backend.language === 'Rust' || report.backend.selected === 'rust', 'report names the selected Rust backend');
  assert.equal(typeof report.source, 'object');
  if (report.status !== 'error') {
    assert.equal(typeof report.source.file, 'string');
    assert.equal(report.feature, source === 'hemisphere.fs' ? 'hemisphere' : 'teaBox');
  }
  assert.equal(typeof report.params, 'object');
  for (const key of ['bodies', 'outputs', 'skipped', 'refusals', 'warnings']) assert.ok(Array.isArray(report[key]), `${key} must be an array`);
  const measured = ['ok', 'partial'].includes(report.status) ? ['build', 'export', 'total'] : ['total'];
  for (const key of measured) {
    assert.ok(Number.isFinite(report.timingsMs?.[key]) && report.timingsMs[key] >= 0, `timingsMs.${key} must be a nonnegative duration`);
  }
  return {run, report};
}

// Edge incidence uses the exact float32 coordinates written to disk (with
// negative zero normalized); tiny seam gaps cannot be rounded into closure.
function inspectBinaryStl(file) {
  const data = fs.readFileSync(file);
  assert.ok(data.length >= 84, 'binary STL header and triangle count');
  const triangles = data.readUInt32LE(80);
  assert.ok(triangles > 0, 'nonempty mesh');
  assert.equal(data.length, 84 + 50 * triangles, 'exact binary STL length (not an ASCII or truncated mesh)');
  const edges = new Map();
  let sixTimesVolume = 0;
  const key = v => v.map(c => {
    assert.ok(Number.isFinite(c), 'finite STL vertex');
    return Object.is(c, -0) ? 0 : c;
  }).join(',');
  for (let i = 0; i < triangles; i++) {
    const offset = 84 + 50 * i;
    const v = Array.from({length: 3}, (_, j) => Array.from({length: 3}, (_, k) => data.readFloatLE(offset + 12 + 12 * j + 4 * k)));
    const ids = v.map(key);
    assert.equal(new Set(ids).size, 3, `triangle ${i} has three distinct vertices`);
    for (let j = 0; j < 3; j++) {
      const a = ids[j], b = ids[(j + 1) % 3];
      const forward = a < b;
      const undirected = forward ? `${a}|${b}` : `${b}|${a}`;
      const entry = edges.get(undirected) ?? {incidence: 0, direction: 0};
      entry.incidence++;
      entry.direction += forward ? 1 : -1;
      edges.set(undirected, entry);
    }
    const [a, b, c] = v;
    sixTimesVolume += a[0] * (b[1] * c[2] - b[2] * c[1])
      + a[1] * (b[2] * c[0] - b[0] * c[2])
      + a[2] * (b[0] * c[1] - b[1] * c[0]);
  }
  for (const [edge, {incidence, direction}] of edges) {
    assert.equal(incidence, 2, `edge ${edge} must have exactly two incident triangles`);
    assert.equal(direction, 0, `edge ${edge} must run in opposite directions`);
  }
  assert.ok(edges.size > 0);
  return {triangles, volumeMm3: sixTimesVolume / 6};
}

function assertMeshOutput(report, prefix, deviationMm) {
  const stl = report.outputs.find(output => output.format === 'stl');
  assert.ok(stl, 'STL must appear among actual outputs');
  assert.equal(stl.path, `${prefix}.stl`);
  assert.equal(stl.bytes, fs.statSync(stl.path).size, 'JSON bytes reflects written STL');
  assert.equal(stl.exact, false, 'a tessellated STL must not claim exact curved geometry');
  assert.equal(stl.approximation, 'tessellated mesh');
  assert.equal(stl.deviationMm, deviationMm);
  return inspectBinaryStl(stl.path);
}

function assertBoxBody(report) {
  assert.equal(report.bodies.length, 1, 'open-top tea box has one solid body');
  const [body] = report.bodies;
  assert.equal(body.topology.faces, 11, '4 outside walls, 4 inside walls, bottom + floor + rim');
  assert.equal(body.topology.vertices, 16, '8 outer and 8 inner corner vertices');
  assert.equal(body.topology.edges, 24, '12 outer and 12 inner edges');
  assert.equal(body.topology.loops, 12, 'one loop per wall/floor plus two on the rim');
  assert.equal(body.topology.shells, 1);
  assert.ok(Math.abs(body.volumeMm3 - 48972) < 1e-6, `outer block minus open pocket: ${body.volumeMm3} mm³`);
  for (const [side, expected] of [['min', [0, 0, 0]], ['max', [160, 45, 45]]]) {
    assert.equal(body.bboxMm?.[side]?.length, 3);
    expected.forEach((coordinate, axis) => assert.ok(Math.abs(body.bboxMm[side][axis] - coordinate) < 1e-6,
      `bbox ${side}[${axis}] must be ${coordinate} mm`));
  }
  assert.equal(body.exactness?.volume, 'bounded');
  assert.ok(Number.isFinite(body.volumeRelBound) && body.volumeRelBound >= 0);
}

test('Rust --format all emits one JSON report, writes the HTML preview from the Rust mesh, and a watertight box mesh', t => {
  const prefix = temp(t);
  const {run, report} = runCli('tea-box.fs', prefix, '--format', 'all');
  assert.equal(run.status, 0, run.stderr);
  assert.equal(report.status, 'ok');
  assertBoxBody(report);
  assert.equal(report.refusals.length, 0);
  assert.ok(report.outputs.some(output => output.format === 'step' && fs.statSync(output.path).size > 0), 'STEP written');
  const html = report.outputs.find(output => output.format === 'html');
  assert.ok(html && html.exact === false && fs.statSync(html.path).size > 0, 'HTML preview written and marked inexact');
  assert.match(fs.readFileSync(html.path, 'utf8'), /chordal deviation at most 0\.02 mm; volume from the Rust kernel measurement/);
  assert.equal(report.skipped.length, 0, 'nothing skipped');
  const mesh = assertMeshOutput(report, prefix, 0.02);
  assert.ok(mesh.triangles >= 12);
  assert.equal(mesh.volumeMm3, 48972, 'signed volume integrated independently from binary triangles');
});

test('Rust --format print writes the print STL and manifest with a declared deviation', t => {
  const prefix = temp(t);
  const {run, report} = runCli('tea-box.fs', prefix, '--format', 'print', '--deviation-mm', '0.04');
  assert.equal(run.status, 0, run.stderr);
  assert.equal(report.status, 'ok');
  assertBoxBody(report);
  assert.equal(report.refusals.length, 0);
  const mesh = assertMeshOutput(report, prefix, 0.04);
  assert.equal(mesh.volumeMm3, 48972);
  const manifest = report.outputs.find(output => output.format === 'print.json');
  assert.ok(manifest && fs.statSync(manifest.path).size > 0, 'print manifest written');
  assert.equal(manifest.path, `${prefix}.print.json`);
  const printManifest = JSON.parse(fs.readFileSync(manifest.path, 'utf8'));
  assert.equal(printManifest.deviationMm, 0.04);
  assert.equal(printManifest.triangles, mesh.triangles, 'manifest agrees with the independently parsed STL');
  assert.equal(printManifest.bodies.length, 1);
  assert.equal(printManifest.bodies[0].approximation, 'tessellated mesh');
});

// Both rounded boxes (profile_blend fillets of single boxes) subtract as one exact prism stack
// (fillets3d F2b). Before that operand existed, this source refused planar-boolean/curved-operand
// at the Boolean; the result must now be the exact open box, not a fabricated mesh.
test('fillet-first original builds: the rounded boxes subtract exactly, with STEP and a watertight STL', t => {
  const prefix = temp(t);
  const {run, report} = runCli('tea-box-F.fs', prefix, '--format', 'all');
  assert.equal(run.status, 0, run.stderr);
  assert.equal(report.status, 'ok');
  assert.equal(report.refusals.length, 0);
  assert.equal(report.bodies.length, 1, 'one open-top box');
  const [body] = report.bodies;
  // Rounded rectangles A = WD - (4 - pi) r^2 (r 2): outer 160 x 45 x 45 less the pocket 156 x 41 from z 2.
  const area = (a, b) => a * b - (4 - Math.PI) * 4;
  const exact = area(160, 45) * 45 - area(156, 41) * 43;
  assert.ok(Math.abs(body.volumeMm3 - exact) < exact * 1e-12, `${body.volumeMm3} vs ${exact} mm³`);
  for (const [side, expected] of [['min', [0, 0, 0]], ['max', [160, 45, 45]]]) {
    expected.forEach((coordinate, axis) => assert.ok(Math.abs(body.bboxMm[side][axis] - coordinate) < 1e-6,
      `bbox ${side}[${axis}] must be ${coordinate} mm`));
  }
  assert.ok(report.outputs.some(output => output.format === 'step' && fs.statSync(output.path).size > 0), 'STEP written');
  const mesh = assertMeshOutput(report, prefix, 0.02);
  assert.ok(Math.abs(mesh.volumeMm3 - exact) < exact * 1e-3, `STL ${mesh.volumeMm3} vs ${exact} mm³`);
});

test('loft with missing profiles reports its precise Rust capability without recommending a retired backend', t => {
  const prefix = temp(t), source = `${prefix}.fs`;
  fs.writeFileSync(source, `FeatureScript 3044;
import(path : "onshape/std/geometry.fs", version : "3044.0");
export const teaBox = defineFeature(function(context is Context, id is Id, definition is map) {
  opLoft(context, id + "loft", {"profileSubqueries": []});
});`);
  const {run, report} = runCli(source, prefix, '--check');
  assert.equal(run.status, 2, run.stderr);
  assert.equal(report.status, 'refused');
  assert.equal(report.refusals.length, 1);
  assert.match(report.refusals[0].message, /loft\/two-profiles-required/);
  assert.doesNotMatch(JSON.stringify(report.refusals), /WONKY_BACKEND=js|\bBend\b/);
});

// HTML is drawn from the Rust mesh path; a body that path refuses (the planar foot
// chamfer: export/stl/chamfer-witness-metric-unimplemented) has no HTML.
test('explicit HTML request on a body the Rust mesh refuses is a typed unavailable export with exit 3, not a silent skip', t => {
  const prefix = temp(t);
  const {run, report} = runCli(path.join(root, 'examples/tea-box-chamfer.fs'), prefix, '--format', 'html');
  assert.equal(run.status, 3, run.stderr);
  assert.equal(report.status, 'partial');
  assert.ok(report.refusals.some(item => item.format === 'html' && item.code === 'EXPORT_UNAVAILABLE' && item.hint
    && /chamfer-witness-metric-unimplemented/.test(item.message)));
  assert.equal(report.outputs.some(output => output.format === 'html'), false);
  assert.equal(fs.existsSync(`${prefix}.html`), false);
});

test('invalid CLI arguments exit 1 with one JSON error rather than reporting a geometry refusal', t => {
  const prefix = temp(t);
  const {run, report} = runCli('tea-box.fs', prefix, '--format', 'not-a-format');
  assert.equal(run.status, 1, run.stderr);
  assert.equal(report.status, 'error');
  assert.equal(report.outputs.length, 0);
  assert.equal(fs.existsSync(`${prefix}.stl`), false);
});

test('curved equatorial hemisphere STL is closed and its integrated volume bounds the analytic hemisphere', t => {
  const prefix = temp(t);
  const {run, report} = runCli('hemisphere.fs', prefix, '--format', 'print', '--deviation-mm', '0.02');
  assert.equal(run.status, 0, run.stderr);
  assert.equal(report.status, 'ok');
  assert.equal(report.bodies.length, 1);
  assert.equal(report.refusals.length, 0);
  const {triangles, volumeMm3} = assertMeshOutput(report, prefix, 0.02);
  assert.ok(triangles > 100, 'curved surface must be tessellated, not a planar impostor');
  const radiusMm = 8.3, deviationMm = 0.02;
  const analytic = (2 / 3) * Math.PI * radiusMm ** 3;
  // Full-sphere surface area × chord tolerance is a conservative volume
  // envelope for this half-sphere's dome and equatorial cap.
  const maxVolumeErrorMm3 = 4 * Math.PI * radiusMm ** 2 * deviationMm;
  assert.ok(volumeMm3 > 0, `outward orientation: signed volume ${volumeMm3}`);
  assert.ok(Math.abs(volumeMm3 - analytic) <= maxVolumeErrorMm3,
    `hemisphere ${analytic} mm³ versus STL ${volumeMm3} mm³ exceeds ${maxVolumeErrorMm3} mm³ at ${deviationMm} mm deviation`);
});

// The native owner proves the Boolean volume and input-order invariance. This
// public boundary adds artifact-level STEP validation and welded STL incidence.
test('overlapping pocket and bore tools export a sewn STEP and bounded watertight STL', t => {
  const prefix = temp(t), source = `${prefix}.fs`;
  fs.writeFileSync(source, `FeatureScript 3044;
import(path : "onshape/std/geometry.fs", version : "3044.0");
export const teaBox = defineFeature(function(context is Context, id is Id, definition is map) {
  fCuboid(context,id+"base",{"corner1":vector(0,0,0)*millimeter,"corner2":vector(12,14,8)*millimeter});
  fCuboid(context,id+"pocket",{"corner1":vector(3,8,-1)*millimeter,"corner2":vector(9,15,3)*millimeter});
  fCylinder(context,id+"bore",{"bottomCenter":vector(6,11,-1)*millimeter,"topCenter":vector(6,11,9)*millimeter,"radius":1.5*millimeter});
  opBoolean(context,id+"cut",{"targets":qCreatedBy(id+"base",EntityType.BODY),"tools":qUnion([qCreatedBy(id+"bore",EntityType.BODY),qCreatedBy(id+"pocket",EntityType.BODY)]),"operationType":BooleanOperationType.SUBTRACTION});
});`);
  const {run, report} = runCli(source, prefix, '--format', 'all', '--deviation-mm', '0.04');
  assert.equal(run.status, 0, run.stderr);
  assert.equal(report.bodies.length, 1, 'both overlapping tools must be consumed');
  const mesh = assertMeshOutput(report, prefix, 0.04);
  const expected = 1344 - 108 - 11.25*Math.PI;
  // Only the cylinder is tessellated. Its full surface swept through the
  // declared deviation bounds the volume error independently of kernel output.
  const envelope = 2*Math.PI*1.5*(5+1.5)*0.04;
  assert.ok(Math.abs(mesh.volumeMm3-expected) < envelope);
  const validation = spawnSync('uv', ['run','scripts/validate-step.py',prefix], {
    cwd:root,encoding:'utf8',timeout:120000,maxBuffer:8<<20,
  });
  assert.equal(validation.status, 0, validation.stderr || String(validation.error));
  assert.equal(JSON.parse(validation.stdout).length, 1);
});

// Ordinary parts whose f64 tessellation used to lose a needle triangle to
// float32 rounding (export/stl/float32-triangle-inversion): a plate with six
// distinct through-holes and a cos/sin involute gear. Every vertex moves by at
// most deviation / 2 and chords stay within the deviation, so the written
// volume stays within surface area x deviation of the exact one.
test('six-hole plate and involute gear write watertight float32 STLs within the volume envelope', t => {
  const prefix = temp(t), source = `${prefix}.fs`;
  fs.writeFileSync(source, `FeatureScript 3044;
import(path : "onshape/std/geometry.fs", version : "3044.0");
export const teaBox = defineFeature(function(context is Context, id is Id, definition is map) {
  fCuboid(context,id+"plate",{"corner1":vector(0,0,0)*millimeter,"corner2":vector(120,6,60)*millimeter});
  var tools = [];
  for (var i = 0; i < 6; i += 1) {
    fCylinder(context,id+("h"~i),{"bottomCenter":vector(10+20*i,-1,30)*millimeter,"topCenter":vector(10+20*i,7,30)*millimeter,"radius":(2.75+i)*millimeter});
    tools = append(tools, qCreatedBy(id+("h"~i),EntityType.BODY));
  }
  opBoolean(context,id+"drill",{"targets":qCreatedBy(id+"plate",EntityType.BODY),"tools":qUnion(tools),"operationType":BooleanOperationType.SUBTRACTION});
});`);
  const plate = runCli(source, prefix, '--format', 'all');
  assert.equal(plate.run.status, 0, plate.run.stderr);
  assert.equal(plate.report.skipped.some(item => item.format === 'stl'), false, JSON.stringify(plate.report.skipped));
  const radii = [0, 1, 2, 3, 4, 5].map(i => 2.75 + i);
  const disks = radii.reduce((s, r) => s + Math.PI * r * r, 0);
  const area = 2 * (7200 - disks) + 2 * 6 * 180 + radii.reduce((s, r) => s + 2 * Math.PI * r * 6, 0);
  const drilled = assertMeshOutput(plate.report, prefix, 0.02);
  assert.ok(Math.abs(drilled.volumeMm3 - (43200 - 6 * disks)) <= area * 0.02, `plate STL volume ${drilled.volumeMm3}`);

  const gearPrefix = `${prefix}-gear`, gearSource = `${gearPrefix}.fs`;
  fs.writeFileSync(gearSource, `FeatureScript 3044;
import(path : "onshape/std/geometry.fs", version : "3044.0");
function inv(a) { return tan(a) - a / radian; }
export const teaBox = defineFeature(function(context is Context, id is Id, definition is map) {
  const alpha = 20 * degree; const rp = 20; const rb = rp * cos(alpha); const ra = 22; const rf = 17.5;
  const psi = (PI * 2 / 2 - 0.1) / (2 * rp); var pts = [];
  for (var k = 0; k < 20; k += 1) {
    const phi = 2 * PI * k / 20; var right = []; var left = [];
    for (var i = 0; i <= 6; i += 1) { const r = rb + (ra - rb) * i / 6; const th = psi + inv(alpha) - inv(acos(min(1, rb / r)));
      right = append(right, [r, phi - th]); left = append(left, [r, phi + th]); }
    pts = append(pts, vector(rf * cos(right[0][1] * radian), rf * sin(right[0][1] * radian)) * millimeter);
    for (var i = 0; i <= 6; i += 1) pts = append(pts, vector(right[i][0] * cos(right[i][1] * radian), right[i][0] * sin(right[i][1] * radian)) * millimeter);
    for (var i = 6; i >= 0; i -= 1) pts = append(pts, vector(left[i][0] * cos(left[i][1] * radian), left[i][0] * sin(left[i][1] * radian)) * millimeter);
    pts = append(pts, vector(rf * cos(left[0][1] * radian), rf * sin(left[0][1] * radian)) * millimeter);
  }
  var sk = newSketchOnPlane(context, id + "sk", { "sketchPlane" : plane(vector(0, 0, 0) * millimeter, vector(0, 0, 1), vector(1, 0, 0)) });
  skPolyline(sk, "teeth", { "points" : append(pts, pts[0]) });
  skSolve(sk);
  opExtrude(context, id + "disc", { "entities" : qSketchRegion(id + "sk", false), "direction" : vector(0, 0, 1), "endBound" : BoundingType.BLIND, "endDepth" : 10 * millimeter });
});`);
  const gear = runCli(gearSource, gearPrefix, '--format', 'all');
  assert.equal(gear.run.status, 0, gear.run.stderr);
  // Independent outline: the same involute formulas in JS doubles.
  const inv = a => Math.tan(a) - a, alpha = 20 * Math.PI / 180, rb = 20 * Math.cos(alpha);
  const psi = (Math.PI - 0.1) / 40, outline = [];
  for (let k = 0; k < 20; k++) {
    const phi = 2 * Math.PI * k / 20;
    const flank = [0, 1, 2, 3, 4, 5, 6].map(i => { const r = rb + (22 - rb) * i / 6; return [r, psi + inv(alpha) - inv(Math.acos(Math.min(1, rb / r)))]; });
    outline.push([17.5, phi - flank[0][1]], ...flank.map(([r, th]) => [r, phi - th]),
      ...flank.slice().reverse().map(([r, th]) => [r, phi + th]), [17.5, phi + flank[0][1]]);
  }
  const xy = outline.map(([r, a]) => [r * Math.cos(a), r * Math.sin(a)]);
  let face = 0, perimeter = 0;
  xy.forEach((p, i) => { const q = xy[(i + 1) % xy.length]; face += (p[0] * q[1] - p[1] * q[0]) / 2; perimeter += Math.hypot(q[0] - p[0], q[1] - p[1]); });
  const teeth = assertMeshOutput(gear.report, gearPrefix, 0.02);
  assert.ok(Math.abs(teeth.volumeMm3 - face * 10) <= (2 * face + 10 * perimeter) * 0.02, `gear STL volume ${teeth.volumeMm3} vs ${face * 10}`);
});

// A top-level feature's defineFeature defaults map loses to every dialog default,
// as in an Onshape Part Studio (Interpreter.run). The CLI keeps that build and
// names each map value it ignores; a map value equal to the dialog default, a
// key outside the dialog and a --param-supplied parameter are not warnings.
test('a dialog default that shadows a defineFeature defaults-map value is a named warning; the build is unchanged', t => {
  const prefix = temp(t), source = `${prefix}-blocks.fs`;
  fs.writeFileSync(source, `FeatureScript 3044;
import(path : "onshape/std/geometry.fs", version : "3044.0");

annotation { "Feature Type Name" : "Blocks" }
export const teaBox = defineFeature(function(context is Context, id is Id, definition is map)
    precondition
    {
        annotation { "Name" : "Count" }
        isInteger(definition.count, POSITIVE_COUNT_BOUNDS);
        annotation { "Name" : "Twist" }
        isAngle(definition.twist, ANGLE_360_BOUNDS);
        annotation { "Name" : "Side" }
        isLength(definition.side, { (millimeter) : [1, 10, 100] } as LengthBoundSpec);
    }
    {
        fCuboid(context, id + "box", { "corner1" : vector(0, 0, 0) * millimeter,
            "corner2" : vector(definition.count * definition.side, definition.side, definition.depth) });
    }, { "count" : 5, "twist" : 45 * degree, "side" : 10 * millimeter, "depth" : 3 * millimeter });
`);
  const shadowed = runCli(source, prefix, '--check');
  assert.equal(shadowed.run.status, 0, shadowed.run.stderr);
  assert.equal(shadowed.report.status, 'ok');
  assert.ok(Math.abs(shadowed.report.bodies[0].volumeMm3 - 2 * 10 * 10 * 3) < 1e-9, 'built with the dialog default count 2, not the map value 5');
  assert.deepEqual(shadowed.report.warnings.map(w => w.parameter), ['count', 'twist']);
  const [count, twist] = shadowed.report.warnings;
  assert.equal(count.code, 'params/defaults-map-shadowed');
  assert.equal(count.source, 'bound-default');
  assert.equal(count.bound, 'POSITIVE_COUNT_BOUNDS');
  assert.equal(count.usedValue, '2');
  assert.equal(count.ignoredValue, '5');
  assert.equal(count.location.line, 9);
  assert.match(count.hint, /--param 'count=5'.*IntegerBoundSpec/);
  assert.equal(twist.bound, 'ANGLE_360_BOUNDS');
  assert.equal(twist.usedValue, '30 * degree');
  assert.equal(twist.ignoredValue, '45 * degree');
  assert.match(shadowed.run.stderr, /^wonky: warning params\/defaults-map-shadowed op=defineFeature feature=teaBox parameter=count /m);
  const supplied = runCli(source, prefix, '--check', '--param', 'count=5', '--param', 'twist=45 * degree');
  assert.equal(supplied.run.status, 0, supplied.run.stderr);
  assert.deepEqual(supplied.report.warnings, []);
  assert.doesNotMatch(supplied.run.stderr, /warning/);
  assert.ok(Math.abs(supplied.report.bodies[0].volumeMm3 - 5 * 10 * 10 * 3) < 1e-9);
});
