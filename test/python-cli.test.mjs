import test from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missingBend();
if (publicTreeSkip) {
  test("python-cli.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { spawnSync } = await import("node:child_process");
const { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } = await import("node:fs");
const { tmpdir } = await import("node:os");
const { join } = await import("node:path");
const { fileURLToPath } = await import("node:url");








const root = fileURLToPath(new URL('../', import.meta.url));
const run = args => spawnSync(process.execPath, ['bin/wonky-python.mjs', ...args], { cwd: root, encoding: 'utf8' });

test('Python CLI exports an analytic Bend spacer as STEP and B-rep by default', () => {
  const directory = mkdtempSync(join(tmpdir(), 'wonky-python-cli-'));
  try {
    const prefix = join(directory, 'spacer');
    const result = run(['examples/python-spacer.py', '--out', prefix]);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(readdirSync(directory).sort(), ['spacer.brep.json', 'spacer.step']);
    const model = JSON.parse(readFileSync(`${prefix}.brep.json`, 'utf8'));
    assert.equal(model.source.language, 'Python');
    assert.equal(model.backend.language, 'Bend');
    assert.equal(model.bodies[0].faces.length, 4);
    assert.match(readFileSync(`${prefix}.step`, 'utf8'), /CYLINDRICAL_SURFACE/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('Python CLI supports planar previews and check without export', () => {
  const directory = mkdtempSync(join(tmpdir(), 'wonky-python-formats-'));
  try {
    const prefix = join(directory, 'box');
    const check = run(['examples/python-box.py', '--check', '--out', prefix]);
    assert.equal(check.status, 0, check.stderr);
    assert.deepEqual(readdirSync(directory), []);
    const result = run(['examples/python-box.py', '--format', 'all', '--out', prefix]);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(readdirSync(directory).sort(), ['box.brep.json', 'box.html', 'box.step', 'box.stl']);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('Python CLI rejects caught capability failures and unsupported mesh export without partial files', () => {
  const directory = mkdtempSync(join(tmpdir(), 'wonky-python-errors-'));
  try {
    const source = join(directory, 'unsupported.py');
    writeFileSync(source, 'from build123d import *\nresult = Box(1,1,1)\ntry:\n    Cylinder(5,10) - Cylinder(2,4)\nexcept Exception:\n    pass\n');
    const unsupported = run([source, '--out', join(directory, 'bad')]);
    assert.equal(unsupported.status, 1);
    // A coaxial cut that leaves an enclosed void is refused by name (neither an
    // exact arm nor the hybrid Boolean builds void shells), at the column of the
    // `-` expression.
    assert.match(unsupported.stderr, /unsupported.py:4:5:.*enclosed void shells are not implemented/);
    assert.deepEqual(readdirSync(directory), ['unsupported.py']);
    const curved = run(['examples/python-spacer.py', '--format', 'all', '--out', join(directory, 'curved')]);
    assert.equal(curved.status, 1);
    assert.match(curved.stderr, /STL tessellation of curved B-reps is not implemented/);
    assert.deepEqual(readdirSync(directory), ['unsupported.py']);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

}
