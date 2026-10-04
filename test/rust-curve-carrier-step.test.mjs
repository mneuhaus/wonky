// Spline carriers through the real STEP consumers. OCCT (validate-step.py) and
// FreeCAD are oracles only. AC100 is a hand-assembled writer test body (an
// extruded cubic Bezier arch), not the result of a kernel operation: it proves
// the writer emits B_SPLINE_CURVE_WITH_KNOTS and SURFACE_OF_LINEAR_EXTRUSION
// that both readers take as an exact extrusion.
//
// Planted negative: `--features plant_step_bspline_surface` makes the writer emit
// the same extrusion as a B_SPLINE_SURFACE_WITH_KNOTS. The OCCT surface-type
// assertion (uv, every host) must then fail because OCCT reads a BSplineSurface;
// the FreeCAD assertion (only where freecadcmd exists) must fail the same way.
//
// FreeCAD is installed on the MacBook only. Its assertions live in their own tests
// that carry a visible TAP skip naming the missing FreeCAD; everything OCCT checks
// (validity, topology, volume, surface types) runs unconditionally.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const freecadcmd = process.env.WONKY_FREECADCMD ?? '/Applications/FreeCAD.app/Contents/Resources/bin/freecadcmd';
const freecadSkip = fs.existsSync(freecadcmd) ? false
  : `FreeCAD is not installed on this host (no freecadcmd at ${freecadcmd}; set WONKY_FREECADCMD): the FreeCAD surface-type assertions did not run, the OCCT surface-type assertions did`;

// Each writer variant is generated once and shared by the OCCT and the FreeCAD test; removed after the file.
const artifacts = new Map();
after(() => { for (const dir of artifacts.values()) fs.rmSync(dir, { recursive: true, force: true }); });

function writeAc100(features = []) {
  const key = features.join(',');
  if (artifacts.has(key)) return path.join(artifacts.get(key), 'ac100');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wonky-s7-ac100-'));
  artifacts.set(key, dir);
  const run = spawnSync('cargo', ['test', '--offline', '--locked', '--manifest-path', 'rust/Cargo.toml', '-p', 'wonky-ops',
    ...(features.length ? ['--features', features.join(',')] : []), '--test', 'curve_carrier', 'ac100_artifacts', '--', '--exact'],
  { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, env: { ...process.env, WONKY_S7_ARTIFACTS: dir } });
  assert.equal(run.status, 0, `ac100_artifacts failed:\n${run.stdout}\n${run.stderr}`);
  return path.join(dir, 'ac100');
}

// OCCT through scripts/validate-step.py: the same checks and the surface types of the read faces.
function occtReport(prefix) {
  const validate = spawnSync('uv', ['run', path.join(root, 'scripts/validate-step.py'), prefix], {
    cwd: root, encoding: 'utf8', timeout: 180000, maxBuffer: 8 * 1024 * 1024,
  });
  assert.equal(validate.status, 0, validate.stdout + validate.stderr);
  const [report] = JSON.parse(validate.stdout);
  return report;
}

// The assertion the planted negative must break on every host.
function assertOcctExtrusionCarrier(report) {
  assert.equal(report.valid, true);
  assert.equal(report.faces, 4);
  assert.equal(report.solids, 1);
  assert.equal(report.volumeComparedWithKernel, true);
  assert.ok(Math.abs(report.volumeMm3 - 316.8) < 316.8 * 2e-5, `volume ${report.volumeMm3}`);
  assert.deepEqual(report.surfaceTypes, { Plane: 3, SurfaceOfExtrusion: 1 }, `OCCT surface types ${JSON.stringify(report.surfaceTypes)}`);
}

function freecadSurfaces(step) {
  const run = spawnSync(freecadcmd, [path.join(root, 'scripts/freecad-surface-types.py')], {
    cwd: root, encoding: 'utf8', timeout: 180000, env: { ...process.env, WONKY_STEP: step },
  });
  assert.equal(run.status, 0, `freecadcmd (${freecadcmd}) failed:\n${run.stdout}\n${run.stderr}`);
  const line = run.stdout.split('\n').find(l => l.startsWith('SURFACE_TYPES '));
  assert.ok(line, `no SURFACE_TYPES line from FreeCAD:\n${run.stdout}\n${run.stderr}`);
  return JSON.parse(line.slice('SURFACE_TYPES '.length));
}

// The FreeCAD assertion the planted negative must break where FreeCAD exists.
function assertFreecadExtrusionCarrier(step) {
  const read = freecadSurfaces(step);
  assert.equal(read.solids, 1);
  assert.equal(read.faces, 4);
  assert.equal(read.surfaces.SurfaceOfExtrusion, 1, JSON.stringify(read));
  assert.equal(read.surfaces.Plane, 3, JSON.stringify(read));
  assert.ok(Math.abs(read.volume - 316.8) < 316.8 * 2e-5, `volume ${read.volume}`);
}

test('AC100 extrusion carrier: OCCT BRepCheck valid, 4 faces, 316.8 mm3, OCCT reads SurfaceOfExtrusion 1 and Plane 3', () => {
  const prefix = writeAc100();
  const step = fs.readFileSync(prefix + '.step', 'utf8');
  assert.match(step, /SURFACE_OF_LINEAR_EXTRUSION/);
  assert.doesNotMatch(step, /B_SPLINE_SURFACE_WITH_KNOTS/);
  assertOcctExtrusionCarrier(occtReport(prefix));
});

test('AC100 extrusion carrier: FreeCAD reads SurfaceOfExtrusion 1 and Plane 3', { skip: freecadSkip }, () => {
  assertFreecadExtrusionCarrier(writeAc100() + '.step');
});

test('planted: a writer emitting B_SPLINE_SURFACE_WITH_KNOTS fails the OCCT type assertion (--features plant_step_bspline_surface)', () => {
  const prefix = writeAc100(['plant_step_bspline_surface']);
  const step = fs.readFileSync(prefix + '.step', 'utf8');
  assert.match(step, /B_SPLINE_SURFACE_WITH_KNOTS/, 'the planted writer must emit the spline surface');
  // The planted body is still a valid solid of the right volume: only the surface type gives it away.
  const report = occtReport(prefix);
  assert.throws(() => assertOcctExtrusionCarrier(report), /OCCT surface types/);
  assert.equal(report.surfaceTypes.SurfaceOfExtrusion ?? 0, 0, JSON.stringify(report.surfaceTypes));
  assert.equal(report.surfaceTypes.BSplineSurface, 1, JSON.stringify(report.surfaceTypes));
});

test('planted: the same writer fails the FreeCAD type assertion', { skip: freecadSkip }, () => {
  const step = writeAc100(['plant_step_bspline_surface']) + '.step';
  assert.throws(() => assertFreecadExtrusionCarrier(step), /SurfaceOfExtrusion|BSplineSurface|faces|Plane/);
  const read = freecadSurfaces(step);
  assert.equal(read.surfaces.SurfaceOfExtrusion ?? 0, 0, JSON.stringify(read));
  assert.equal(read.surfaces.BSplineSurface, 1, JSON.stringify(read));
});
