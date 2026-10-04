// The BSpline oracle of wonky-curve (S5): the recorded JSON is exactly the output
// of the recorded script (hash and re-run), and its anchor values are the plan's.
// The Rust side (rust/wonky-curve/tests/bspline_oracle.rs) compares the kernel to this JSON.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root = fileURLToPath(new URL('../', import.meta.url));
const dir = path.join(root, 'rust/wonky-curve/tests/oracle');
const scriptPath = path.join(dir, 'bspline_oracle.py');
const jsonPath = path.join(dir, 'bspline_oracle.json');
const oracle = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));

test('the oracle JSON records the hash of the script that produced it', () => {
  const sha = crypto.createHash('sha256').update(fs.readFileSync(scriptPath)).digest('hex');
  assert.equal(oracle.provenance.script_sha256, sha);
  assert.equal(oracle.provenance.sympy, '1.13.3');
  assert.equal(oracle.provenance.mpmath, '1.3.0');
});

test('re-running the script reproduces the JSON byte for byte (uv run)', { skip: spawnSync('uv', ['--version']).status !== 0 && 'uv not available' }, () => {
  const run = spawnSync('uv', ['run', scriptPath], { encoding: 'utf8', timeout: 300000, maxBuffer: 1 << 24 });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout, fs.readFileSync(jsonPath, 'utf8'));
});

test('anchor values of the plan are in the oracle', () => {
  const ac = oracle.ac100;
  assert.deepEqual(ac.poles, [['0/1', '0/1'], ['8/1', '6/1'], ['18/1', '6/1'], ['26/1', '0/1']]);
  // Signed for the left-to-right traversal; the magnitude is the plan's 396/5.
  assert.equal(ac.ranges[0].area, '-396/5');
  assert.equal(ac.length_exact, '28/1');
  assert.equal(ac.apex_y, '9/2');
  assert.deepEqual(ac.point.p, ['101/16', '27/8']);
  assert.deepEqual(ac.point.unit_normal, ['-12/37', '35/37']);
  assert.equal(ac.closest.dist, '37/64');
  assert.equal(ac.closest.t, '1/4');
  assert.deepEqual(oracle.ac100_elevated.ranges, ac.ranges);
  assert.equal(oracle.ac100_elevated.degree, 4);
  const s = oracle.s_edge;
  assert.equal(s.cap_area, '3039/5');
  assert.ok(s.length.startsWith('26.3290181014202718218224236877'));
  assert.ok(s.extremes.xmax.startsWith('27.6785026933109980047893771584'));
  assert.ok(s.extremes.xmax_t.startsWith('0.27404771'));
  assert.deepEqual(s.y_range, ['0/1', '24/1']);
  assert.equal(oracle.dyadic.length, 20);
  assert.equal(oracle.regularity.refusal, 'curve2/self-intersecting-spline');
  assert.equal(oracle.regularity.cusp.hodograph_zero_t, '1/2');
});
