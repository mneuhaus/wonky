// D5 tea box (fixtures/teabox-fillet) on the host route. The two rounded boxes (opFillet r 2 on their vertical
// edges, `profile_blend`) subtract as one prism stack: exact volume, OCCT-valid STEP, closed STL. The 0.42 foot
// chamfer cannot be stated by the stack's binary64 `stack_blend` family (the offset ring 0.002 - 0.00042 m is not
// a binary64), so the host chamfers the stack's exact general Model (F2c: rule 6 over the same source leaves, then
// the rule-11 chain chamfer: planes and four partial cone patches). Its exact 6V equals the closed form and the
// Model route in rust/wonky-ops/tests/model_rim.rs (tea_box_by_the_exact_model_route); here measure, STEP and STL.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
process.env.WONKY_BACKEND = 'rust';
const {build} = await import('../src/index.mjs');
const {toStep, toStl} = await import('../src/exporters.mjs');
const {serializeModel} = await import('../src/construction-history.mjs');
const {measureRustBody, rustModelKernel} = await import('../src/native/rust-host.mjs');

const fixture = fs.readFileSync(new URL('../fixtures/teabox-fillet/rrc-fillet.fs', import.meta.url), 'utf8');
const chamfer = /\n\s*opChamfer\(context, id \+ "foot"[^\n]*\n/;
// mm: rounded rectangles A = WD - (4 - pi) r^2; the pocket tool runs from t to beyond the top.
const [W, D, H, t, r, c] = [160, 45, 45, 2, 2, 0.42], pi = Math.PI;
const area = (a, b) => a * b - (4 - pi) * r * r;
const open = area(W, D) * H - area(W - 2 * t, D - 2 * t) * (H - t);

function closedStl(stl) {
  const d = new DataView(stl.buffer, stl.byteOffset, stl.byteLength), edges = new Map();
  let vol = 0;
  for (let f = 0; f < d.getUint32(80, true); f++) {
    const p = [0, 1, 2].map(j => [0, 1, 2].map(k => d.getFloat32(84 + 50 * f + 12 + 12 * j + 4 * k, true)));
    vol += (p[0][0] * (p[1][1] * p[2][2] - p[1][2] * p[2][1]) + p[0][1] * (p[1][2] * p[2][0] - p[1][0] * p[2][2]) + p[0][2] * (p[1][0] * p[2][1] - p[1][1] * p[2][0])) / 6;
    const keys = p.map(v => JSON.stringify(v));
    assert.equal(new Set(keys).size, 3);
    for (let j = 0; j < 3; j++) {
      const a = keys[j], b = keys[(j + 1) % 3], forward = a < b, k = forward ? `${a}|${b}` : `${b}|${a}`, e = edges.get(k) ?? {n: 0, s: 0};
      e.n++; e.s += forward ? 1 : -1; edges.set(k, e);
    }
  }
  for (const e of edges.values()) { assert.equal(e.n, 2); assert.equal(e.s, 0); }
  return vol;
}

// STEP (analytic carriers `surface`, no approximation) validated by OCCT, the construction history, and a closed
// STL whose volume is within the mesh deviation of `expected`.
function exportsValid(model, name, surface, expected) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wonky-teabox-'));
  try {
    const out = process.env.WONKY_TEABOX_OUT ?? dir;
    fs.mkdirSync(out, {recursive: true});
    const prefix = path.join(out, name);
    const step = toStep(model);
    assert.ok(step.includes(surface), `analytic ${surface} carriers`);
    assert.ok(!step.includes('B_SPLINE'), 'no approximation written');
    fs.writeFileSync(prefix + '.step', step);
    fs.writeFileSync(prefix + '.brep.json', serializeModel(model));
    const result = spawnSync('uv', ['run', 'scripts/validate-step.py', prefix], {encoding: 'utf8', maxBuffer: 4 << 20});
    process.stderr.write(result.stderr);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const stl = toStl(model, {deviationMm: 0.01});
    fs.writeFileSync(prefix + '.stl', stl);
    const v = closedStl(stl);
    assert.ok(Math.abs(v - expected) < expected * 1e-3, `${v} != ${expected}`);
  } finally {
    fs.rmSync(dir, {recursive: true, force: true});
  }
}

test('D5 tea box: the rounded boxes subtract as one prism stack (exact volume, OCCT-valid STEP, closed STL)', async () => {
  assert.match(fixture, chamfer);
  const model = await build(fixture.replace(chamfer, '\n'), {feature: 'teaBoxRounded'});
  assert.equal(model.bodies.length, 1);
  const m = measureRustBody(rustModelKernel(model), model.bodies[0]);
  assert.ok(Math.abs(m.volumeMm3 - open) < open * 1e-12, `${m.volumeMm3} != ${open}`);
  exportsValid(model, 'teabox-open', 'CYLINDRICAL_SURFACE', open);
});

test('D5 tea box: the 0.42 foot chamfer builds on the stack\'s exact Model (closed-form volume, cones, OCCT-valid STEP, STL)', async () => {
  const model = await build(fixture, {feature: 'teaBoxRounded'});
  assert.equal(model.bodies.length, 1);
  const m = measureRustBody(rustModelKernel(model), model.bodies[0]);
  // The chamfer removes L c^2 / 2 along the straights and pi (r - c/3) c^2 along the four quarter arcs (Pappus).
  const L = 2 * (W - 2 * r) + 2 * (D - 2 * r);
  const expected = open - L * c * c / 2 - pi * (r - c / 3) * c * c;
  assert.ok(Math.abs(m.volumeMm3 - expected) < expected * 1e-12, `${m.volumeMm3} != ${expected}`);
  exportsValid(model, 'teabox-chamfered', 'CONICAL_SURFACE', expected);
});
