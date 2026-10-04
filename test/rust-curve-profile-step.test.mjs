// Strand S9: the curve-profile (spline) prism built by the kernel operation
// (`curve_profile::build` from AC100's sketch rule 3 data), exported through the
// host STEP writer, then read by the real STEP consumers. OCCT (validate-step.py)
// and FreeCAD are oracles only.
//
// AC100 V0 is the cubic Bezier arch (0,0) (8,6) (18,6) (26,0) mm over its chord,
// extruded 4 mm; V5 is its exact degree-4 elevation; V3 is V0 in the catalog's
// binary64 rotated frame (0.1 rad about (1,2,3)); the mirror is V0 below its
// chord, where the counter-clockwise profile runs along the spline parameter
// (a forward edge and side face; the other three run against it). All must read
// back as one valid solid of 316.8 mm3 with one SurfaceOfExtrusion and three
// Planes, and OCCT must reproduce every face area the kernel measured (79.2,
// 79.2, 104, 112 mm2).
//
// FreeCAD is installed on the MacBook only (as in rust-curve-carrier-step): its
// assertions are a separate test with a visible TAP skip naming the missing
// freecadcmd; everything OCCT checks, surface types included, runs on every host.
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
const names = ['ac100-v0', 'ac100-v5', 'ac100-v3', 'ac100-mirror'];

// The artifacts are written once and shared by the OCCT and the FreeCAD test; removed after the file.
let artifacts;
after(() => { if (artifacts) fs.rmSync(artifacts, { recursive: true, force: true }); });
function prefixes() {
  if (!artifacts) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wonky-s9-ac100-'));
    artifacts = dir;
    const run = spawnSync('cargo', ['test', '--offline', '--locked', '--manifest-path', 'rust/Cargo.toml', '-p', 'wonky-ops',
      '--test', 'curve_profile_prism', 'ac100_step_artifacts', '--', '--exact'],
    { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, env: { ...process.env, WONKY_S9_ARTIFACTS: dir } });
    assert.equal(run.status, 0, `ac100_step_artifacts failed:\n${run.stdout}\n${run.stderr}`);
  }
  return names.map(name => path.join(artifacts, name));
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

test('AC100 V0, V5, V3 and the mirrored arch built by the operation: OCCT valid with every face area, 316.8 mm3, OCCT reads SurfaceOfExtrusion 1 and Plane 3', () => {
  const all = prefixes();
  for (const prefix of all) {
    const step = fs.readFileSync(prefix + '.step', 'utf8');
    assert.match(step, /SURFACE_OF_LINEAR_EXTRUSION/);
    assert.doesNotMatch(step, /B_SPLINE_SURFACE_WITH_KNOTS/);
  }
  const validate = spawnSync('uv', ['run', path.join(root, 'scripts/validate-step.py'), ...all], {
    cwd: root, encoding: 'utf8', timeout: 180000, maxBuffer: 8 * 1024 * 1024,
  });
  assert.equal(validate.status, 0, validate.stdout + validate.stderr);
  const reports = JSON.parse(validate.stdout);
  assert.equal(reports.length, all.length);
  for (const report of reports) {
    assert.equal(report.valid, true);
    assert.equal(report.solids, 1);
    assert.equal(report.faces, 4);
    assert.equal(report.edges, 6);
    assert.equal(report.vertices, 4);
    assert.equal(report.sourceFaceAreasCompared, 4, 'OCCT checked every kernel face area');
    assert.equal(report.volumeComparedWithKernel, true);
    assert.ok(Math.abs(report.volumeMm3 - 316.8) < 316.8 * 2e-5, `volume ${report.volumeMm3}`);
    assert.deepEqual(report.surfaceTypes, { Plane: 3, SurfaceOfExtrusion: 1 }, `OCCT surface types ${JSON.stringify(report.surfaceTypes)}`);
  }
});

test('the same four STEP files: FreeCAD reads SurfaceOfExtrusion 1 and Plane 3, 316.8 mm3', { skip: freecadSkip }, () => {
  for (const prefix of prefixes()) {
    const read = freecadSurfaces(prefix + '.step');
    assert.equal(read.solids, 1);
    assert.equal(read.faces, 4);
    assert.equal(read.surfaces.SurfaceOfExtrusion, 1, JSON.stringify(read));
    assert.equal(read.surfaces.Plane, 3, JSON.stringify(read));
    assert.ok(Math.abs(read.volume - 316.8) < 316.8 * 2e-5, `volume ${read.volume}`);
  }
});
