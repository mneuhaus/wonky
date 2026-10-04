// Strand G11: general-Boolean Models through the real STEP consumers. OCCT
// (validate-step.py) and FreeCAD are oracles only. The Models are revolution
// adapters and general Boolean results built in rust/wonky-ops/tests/model_export.rs
// (`artifacts`), under exact, reflecting and binary64 placements.
//
// Planted negative: `--features plant_step_model_circle_bspline` makes the writer
// emit every circle as an unlabelled rational B-spline (the exact circle). The
// OCCT acceptance (uv, every host) must then reject every case: OCCT's own
// pcurve of the spline on each written band fails the exact CurveOnSurface
// check (observed with cadquery-ocp 8.0.1.0.0), before the curve-type assertion
// is reached. The FreeCAD curve-type assertion (only where freecadcmd exists)
// must fail because FreeCAD reads a BSplineCurve.
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
  : `FreeCAD is not installed on this host (no freecadcmd at ${freecadcmd}; set WONKY_FREECADCMD): the FreeCAD curve-type assertions did not run, the OCCT curve-type assertions did`;

const CASES = {
  stepped: { surfaces: { Cone: 1, Cylinder: 2, Plane: 2 }, circles: 4 },
  apex: { surfaces: { Cone: 1, Plane: 1 }, circles: 1 },
  'stepped-rotated': { surfaces: { Cone: 1, Cylinder: 2, Plane: 2 }, circles: 4 },
  'stepped-mirrored': { surfaces: { Cone: 1, Cylinder: 2, Plane: 2 }, circles: 4 },
  'stepped-binary64-rotation': { surfaces: { Cone: 1, Cylinder: 2, Plane: 2 }, circles: 4 },
  annulus: { surfaces: { Cylinder: 2, Plane: 2 }, circles: 4 },
  'stepped-bore': { surfaces: { Cylinder: 3, Plane: 3 }, circles: 6 },
};

const artifacts = new Map();
after(() => { for (const dir of artifacts.values()) fs.rmSync(dir, { recursive: true, force: true }); });

function write(features = []) {
  const key = features.join(',');
  if (artifacts.has(key)) return artifacts.get(key);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wonky-g11-'));
  artifacts.set(key, dir);
  const run = spawnSync('cargo', ['test', '--offline', '--locked', '--manifest-path', 'rust/Cargo.toml', '-p', 'wonky-ops',
    ...(features.length ? ['--features', features.join(',')] : []), '--test', 'model_export', 'artifacts', '--', '--exact'],
  { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, env: { ...process.env, WONKY_G11_ARTIFACTS: dir } });
  assert.equal(run.status, 0, `model_export artifacts failed:\n${run.stdout}\n${run.stderr}`);
  return dir;
}

function occtReports(dir, names = Object.keys(CASES)) {
  const prefixes = names.map(name => path.join(dir, name));
  const validate = spawnSync('uv', ['run', path.join(root, 'scripts/validate-step.py'), ...prefixes], {
    cwd: root, encoding: 'utf8', timeout: 300000, maxBuffer: 16 * 1024 * 1024,
  });
  assert.equal(validate.status, 0, validate.stdout + validate.stderr);
  return Object.fromEntries(JSON.parse(validate.stdout).map((r, i) => [names[i], r]));
}

// The assertion the planted negative must break on every host.
function assertOcctAnalytic(name, report) {
  const want = CASES[name];
  assert.equal(report.valid, true, name);
  assert.equal(report.solids, 1, name);
  assert.equal(report.volumeComparedWithKernel, true, name);
  assert.equal(report.sourceFaceAreasCompared, report.faces, name);
  assert.deepEqual(report.surfaceTypes, want.surfaces, `${name}: OCCT surface types ${JSON.stringify(report.surfaceTypes)}`);
  // Every band carries its written seam line; every other edge is a circle.
  const curves = report.curveTypes;
  assert.deepEqual(Object.keys(curves).filter(k => k !== 'Line' && k !== 'Circle'), [], `${name}: OCCT curve types ${JSON.stringify(curves)}`);
  assert.equal(curves.Circle, want.circles + report.boundaryVerticesAdded, `${name}: OCCT curve types ${JSON.stringify(curves)}`);
}

function freecad(step) {
  const run = spawnSync(freecadcmd, [path.join(root, 'scripts/freecad-surface-types.py')], {
    cwd: root, encoding: 'utf8', timeout: 180000, env: { ...process.env, WONKY_STEP: step },
  });
  assert.equal(run.status, 0, `freecadcmd (${freecadcmd}) failed:\n${run.stdout}\n${run.stderr}`);
  const line = run.stdout.split('\n').find(l => l.startsWith('SURFACE_TYPES '));
  assert.ok(line, `no SURFACE_TYPES line from FreeCAD:\n${run.stdout}\n${run.stderr}`);
  return JSON.parse(line.slice('SURFACE_TYPES '.length));
}

function assertFreecadAnalytic(name, read) {
  const want = CASES[name];
  assert.equal(read.solids, 1, name);
  assert.deepEqual(read.surfaces, want.surfaces, `${name}: FreeCAD surface types ${JSON.stringify(read)}`);
  assert.deepEqual(Object.keys(read.curves).filter(k => k !== 'Line' && k !== 'Circle'), [], `${name}: FreeCAD curve types ${JSON.stringify(read.curves)}`);
  assert.ok(read.curves.Circle >= want.circles, `${name}: FreeCAD curve types ${JSON.stringify(read.curves)}`);
}

test('G11 Models: OCCT BRepCheck valid (exact CurveOnSurface), kernel volume and face areas, analytic surfaces and circles', () => {
  const dir = write();
  for (const name of Object.keys(CASES)) {
    const step = fs.readFileSync(path.join(dir, `${name}.step`), 'utf8');
    assert.doesNotMatch(step, /B_SPLINE/, name);
    const stl = fs.readFileSync(path.join(dir, `${name}.stl`));
    assert.match(stl.subarray(0, 80).toString('latin1'), /approximation: tessellated mesh; deviationMm=0.01/, name);
    assert.equal(stl.length, 84 + 50 * stl.readUInt32LE(80), name);
  }
  const reports = occtReports(dir);
  for (const name of Object.keys(CASES)) assertOcctAnalytic(name, reports[name]);
});

test('G11 Models: FreeCAD reads planes, cylinders, cones and circles', { skip: freecadSkip }, () => {
  const dir = write();
  for (const name of Object.keys(CASES)) assertFreecadAnalytic(name, freecad(path.join(dir, `${name}.step`)));
});

test('planted: circles written as unlabelled B-splines fail the OCCT acceptance (--features plant_step_model_circle_bspline)', () => {
  const dir = write(['plant_step_model_circle_bspline']);
  for (const name of Object.keys(CASES)) {
    assert.throws(() => assertOcctAnalytic(name, occtReports(dir, [name])[name]),
      /imported solid fails BRepCheck_Analyzer with exact CurveOnSurface checking/, name);
  }
});

test('planted: the same writer fails the FreeCAD curve-type assertion', { skip: freecadSkip }, () => {
  const dir = write(['plant_step_model_circle_bspline']);
  for (const name of Object.keys(CASES)) {
    const read = freecad(path.join(dir, `${name}.step`));
    assert.throws(() => assertFreecadAnalytic(name, read), /FreeCAD curve types/, name);
    assert.ok(read.curves.BSplineCurve >= CASES[name].circles, JSON.stringify(read.curves));
  }
});
