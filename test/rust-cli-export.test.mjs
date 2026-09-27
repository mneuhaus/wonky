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
  for (const key of ['bodies', 'outputs', 'skipped', 'refusals']) assert.ok(Array.isArray(report[key]), `${key} must be an array`);
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

test('Rust --format all emits one JSON report, keeps optional HTML skipped, and writes a watertight box mesh', t => {
  const prefix = temp(t);
  const {run, report} = runCli('tea-box.fs', prefix, '--format', 'all');
  assert.equal(run.status, 0, run.stderr);
  assert.equal(report.status, 'ok');
  assertBoxBody(report);
  assert.equal(report.refusals.length, 0);
  assert.ok(report.outputs.some(output => output.format === 'step' && fs.statSync(output.path).size > 0), 'STEP written');
  assert.ok(report.skipped.some(item => item.format === 'html' && item.code && item.hint), 'optional unavailable HTML reported, not silently ignored');
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

test('fillet-first original refuses once with operation, location, hint, and exit 2', t => {
  const prefix = temp(t);
  const {run, report} = runCli('tea-box-F.fs', prefix, '--format', 'all');
  assert.equal(run.status, 2, run.stderr);
  assert.equal(report.status, 'refused');
  assert.equal(report.refusals.length, 1);
  const [refusal] = report.refusals;
  assert.equal(refusal.code, 'fillet/trim-not-representable');
  assert.equal(refusal.operation, 'opFillet');
  assert.match(refusal.location?.file, /tea-box-F\.fs$/);
  assert.ok(Number.isInteger(refusal.location.line) && refusal.location.line > 0);
  assert.ok(Number.isInteger(refusal.location.column) && refusal.location.column > 0);
  assert.match(refusal.hint, /\S/);
  assert.equal(report.outputs.some(output => output.format === 'stl'), false, 'no fabricated success mesh');
  assert.equal(fs.existsSync(`${prefix}.stl`), false);
});

test('unported modeling operations report their precise Rust capability without recommending a retired backend', t => {
  const prefix = temp(t), source = `${prefix}.fs`;
  // Arcs are ported; loft still exercises the CLI's unported-operation report.
  fs.writeFileSync(source, `FeatureScript 3044;
import(path : "onshape/std/geometry.fs", version : "3044.0");
export const teaBox = defineFeature(function(context is Context, id is Id, definition is map) {
  opLoft(context, id + "loft", {"profileSubqueries": []});
});`);
  const {run, report} = runCli(source, prefix, '--check');
  assert.equal(run.status, 2, run.stderr);
  assert.equal(report.status, 'refused');
  assert.equal(report.refusals.length, 1);
  assert.match(report.refusals[0].message,
    /^kernel entry host\/loft:invoke \(kernel\.opLoft\) is not ported to the Rust kernel [0-9a-f]{12} \(WONKY_BACKEND=rust\)$/);
  assert.doesNotMatch(JSON.stringify(report.refusals), /WONKY_BACKEND=js|\bBend\b/);
});

test('explicit HTML request is a typed unavailable export with exit 3, not a silent skip', t => {
  const prefix = temp(t);
  const {run, report} = runCli('tea-box.fs', prefix, '--format', 'html');
  assert.equal(run.status, 3, run.stderr);
  assert.equal(report.status, 'partial');
  assert.ok(report.refusals.some(item => item.format === 'html' && item.code === 'EXPORT_UNAVAILABLE' && item.hint));
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
