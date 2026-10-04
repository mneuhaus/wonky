// The gear outline oracle of wonky-curve (S6): the recorded JSON is exactly the
// output of the recorded script (hash and re-run), the AC102 payload and area come
// from the catalog's own closed-forms.py (hash recorded), and its anchors are the
// zone's and design-robustness's. The Rust side (rust/wonky-curve/tests/
// spline_arrangement.rs) arranges both outlines from this JSON.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root = fileURLToPath(new URL('../', import.meta.url));
const dir = path.join(root, 'rust/wonky-curve/tests/oracle');
const scriptPath = path.join(dir, 'gear_outlines.py');
const jsonPath = path.join(dir, 'gear_outlines.json');
const closedForms = path.join(root, 'scripts/acid/closed-forms.py');
const pinnedForms = path.join(root, 'fixtures/cad-acid/checker-history/6284d9bcb13692dbd20497551435fd3b03faaa6310984a3be56a5215bb2586b3.py');
const pinnedProvenance = JSON.parse(fs.readFileSync(pinnedForms.replace(/\.py$/, '.provenance.json'), 'utf8'));
const oracle = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

test('the oracle JSON records the hashes of its script and of closed-forms.py', () => {
  assert.equal(oracle.provenance.script_sha256, sha(scriptPath));
  assert.equal(oracle.provenance.closed_forms_sha256, sha(pinnedForms));
  assert.equal(pinnedProvenance.sha256, sha(pinnedForms));
  assert.equal(oracle.provenance.sympy, '1.13.3');
  assert.equal(oracle.provenance.mpmath, '1.3.0');
});

// Sibling modules a checker script imports, transitively (e.g. z1_forms, z3_forms).
function localImports(script, seen = new Set()) {
  for (const [, name] of fs.readFileSync(script, 'utf8').matchAll(/^(?:import|from)\s+(\w+)/gm)) {
    const file = path.join(path.dirname(script), `${name}.py`);
    if (!seen.has(file) && fs.existsSync(file)) { seen.add(file); localImports(file, seen); }
  }
  return seen;
}

// Replay the unchanged generator with its exact historical dependencies. Then
// require the current checker/catalog to produce the identical geometry payload.
function replay(historical) {
  const checkout = fs.mkdtempSync(path.join(os.tmpdir(), 'gear-oracle-'));
  try {
    const copy = (source, relative) => {
      const target = path.join(checkout, relative);
      fs.mkdirSync(path.dirname(target), {recursive: true});
      fs.copyFileSync(source, target);
    };
    copy(scriptPath, 'rust/wonky-curve/tests/oracle/gear_outlines.py');
    copy(historical ? pinnedForms : closedForms, 'scripts/acid/closed-forms.py');
    copy(historical ? path.join(root, `fixtures/cad-acid/catalog-history/${pinnedProvenance.catalogSha256}.json`) : path.join(root, 'fixtures/cad-acid/zones.json'), 'fixtures/cad-acid/zones.json');
    if (!historical) for (const file of localImports(closedForms)) copy(file, path.relative(root, file));
    const run = spawnSync('uv', ['run', path.join(checkout, 'rust/wonky-curve/tests/oracle/gear_outlines.py')], { encoding: 'utf8', timeout: 300000, maxBuffer: 1 << 26 });
    assert.equal(run.status, 0, run.stderr);
    return run.stdout;
  } finally { fs.rmSync(checkout, {recursive: true, force: true}); }
}

test('re-running the unchanged script with pinned dependencies reproduces the JSON byte for byte (uv run)', { skip: spawnSync('uv', ['--version']).status !== 0 && 'uv not available' }, () => {
  const catalogFile = path.join(root, `fixtures/cad-acid/catalog-history/${pinnedProvenance.catalogSha256}.json`);
  assert.equal(sha(catalogFile), pinnedProvenance.catalogSha256);
  assert.equal(replay(true), fs.readFileSync(jsonPath, 'utf8'));
});

test('current checker and catalog preserve the historical gear geometry', () => {
  const current = JSON.parse(replay(false));
  assert.equal(current.provenance.closed_forms_sha256, sha(closedForms));
  assert.deepEqual(current.ac102, oracle.ac102);
  assert.deepEqual(current.z45, oracle.z45);
  assert.deepEqual({...current.provenance, closed_forms_sha256: oracle.provenance.closed_forms_sha256}, oracle.provenance);
});

test('anchor values: the AC102 zone notes and design-robustness section 1', () => {
  const g = oracle.ac102;
  assert.equal(g.params.teeth, 16);
  assert.equal(g.teeth.length, 16);
  assert.deepEqual(g.params.handles, ['1/16', '5/8']);
  // The zone's notes: cap area 438.008481544518 mm^2 (the payload route).
  assert.ok(g.area_mm2.startsWith('438.008481544518'), g.area_mm2);
  // Tooth 0 is centred on +x: its tip midpoint is (ra, 0) as SI metres.
  assert.deepEqual(g.teeth[0].tipMid, ['0.0135', '0.0']);
  const z = oracle.z45;
  assert.equal(z.teeth.length, 45);
  assert.ok(z.teeth.every(t => t.lower.points.length === 6 && t.upper.params.length === 6));
  // design-robustness section 1: 5 Bezier pieces, controls up to 464 bits.
  assert.equal(z.tooth0_upper.controls.length, 5);
  assert.equal(z.max_control_bits, 464);
  assert.ok(Number(z.area_mm2) > Math.PI * 21.25 ** 2 && Number(z.area_mm2) < Math.PI * 23.5 ** 2, z.area_mm2);
});
