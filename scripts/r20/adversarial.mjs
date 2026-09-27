// R20 acceptance, adversarial rows (scripts/r20/acceptance.mjs --adversarial):
// rigid copies of the KT cases, rotated about (1,2,3) by 37 degrees, moved
// far from the origin, or both, plus an exact 90-degree turn with a far move.
// Generated from cad-31's read-only case sources into <out>/adversarial/;
// the Onshape references are compared after the same transform (p -> R p + T).
// From verify#1 of the gate (tmp/r20/verify-1/adv-gen.mjs), trimmed to the
// rigid frames. Expectation: build within tolerance, or refuse by name; a
// built part that misses its tolerance or its own stated deviation fails.
// A row name is <case>-<frame>, split at the FIRST '-' (frames such as
// rz1e-4 or rot-t1e3 contain one).
import fs from 'node:fs';
import path from 'node:path';

const CASES = { kt1: 'kt1_m3_hybrid', kt2: 'kt2_608_seat', kt3: 'kt3_partial_revolve', kt4: 'kt4_freespace_union', kt5: 'kt5_involute_gear', kt6: 'kt6_coplanar_union' };
// kt6-rz30 (verify#2): a rotation about Z alone left the rotated side planes
// of D and A nearly (not exactly) coplanar; corefine put crossing points far
// off their edges (kernel/hybrid/corefine/shadow.bend isect.clamp).
// kt6 turned about Z by 1e-4, 45, 60 and 89.9 degrees, and rot moved far
// (docs/hybrid-robust.md 2.3/2.4, fixtures/r20/diag-rotation): the planar arm
// declines AmbiguousContact (rotated coplanar tops 1e-14 apart stay two planes)
// and corefine refuses or leaves a needle (short edges made after the
// short-edge collapse). kt1-rotfar: the tilted relief union far out (2.1);
// kt1-t1e3: the certified-mesh chain at ~1000 mm (2.5). kt6-t1e4 leaves the
// finite +-10,000 mm envelope and must refuse by that name (DECLARED).
const DEFAULT = ['kt1-r90far', 'kt1-rot', 'kt1-far', 'kt2-rotfar', 'kt2-r90far', 'kt3-rot', 'kt5-far', 'kt6-rot', 'kt6-r90far', 'kt6-rz30',
  'kt6-rz1e-4', 'kt6-rz45', 'kt6-rz60', 'kt6-rz89.9', 'kt6-rotfar', 'kt1-rotfar', 'kt1-t1e3', 'kt6-t1e4'];

function rot(axis, deg) {
  const n = Math.hypot(...axis), [x, y, z] = axis.map(v => v / n), t = deg * Math.PI / 180, c = Math.cos(t), s = Math.sin(t), C = 1 - c;
  return [[c + x * x * C, x * y * C - z * s, x * z * C + y * s], [y * x * C + z * s, c + y * y * C, y * z * C - x * s], [z * x * C - y * s, z * y * C + x * s, c + z * z * C]];
}
const I3 = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
// A far move of size s in no axis-aligned direction (the diag-rotation sweep's
// farT; the hybrid metamorphic harness translates jobs by the same vectors).
const farT = s => [s * 1.023123456789, -s * 0.811987654321, s * 0.2475];
const ROT = rot([1, 2, 3], 37), RZ = deg => rot([0, 0, 1], deg);
const FRAMES = {
  rot: { R: ROT, T: [0, 0, 0] },
  far: { R: I3, T: [523.123456789, -811.987654321, 247.5] },
  rotfar: { R: ROT, T: [523.123456789, -811.987654321, 247.5] },
  r90far: { R: [[0, -1, 0], [1, 0, 0], [0, 0, 1]], T: [1000.25, -2000.5, 0.125] },
  rz30: { R: RZ(30), T: [0, 0, 0] },
  'rz1e-4': { R: RZ(1e-4), T: [0, 0, 0] },
  rz1: { R: RZ(1), T: [0, 0, 0] },
  rz7: { R: RZ(7), T: [0, 0, 0] },
  rz45: { R: RZ(45), T: [0, 0, 0] },
  rz60: { R: RZ(60), T: [0, 0, 0] },
  'rz89.9': { R: RZ(89.9), T: [0, 0, 0] },
  t1e3: { R: I3, T: farT(1e3) },
  'rz45-t1e3': { R: RZ(45), T: farT(1e3) },
  'rot-t1e3': { R: ROT, T: farT(1e3) },
  t1e4: { R: I3, T: farT(1e4) },
};
// Rows that must refuse, by the exact name of the declared limit they hit.
// src/brep.mjs validateSolid raises the envelope with fail() (not a capability
// error), so the generic build-or-refuse rule cannot judge them: the runner asks
// judgeDeclared below and passes {declaredRefusals: true} to adversarialCases.
const DECLARED = {
  'kt6-t1e4': { message: 'Solid exceeds the finite ±10,000 mm coordinate envelope',
    why: 'the finite +-10,000 mm coordinate envelope (src/brep.mjs validateSolid; docs/hybrid-robust.md section 8 keeps it)' },
};
const num = v => (Number.isInteger(v) ? `${v}.0` : String(v));
function frameBlock(R, T) {
  const row = (i, p) => `${num(R[i][0])} * ${p}[0] + ${num(R[i][1])} * ${p}[1] + ${num(R[i][2])} * ${p}[2]`;
  return `
// ---- R20 adversarial frame (scripts/r20/adversarial.mjs): p -> R p + T ----
function vT(p is Vector) returns Vector
{
    return vector(${row(0, 'p')} + ${num(T[0])}, ${row(1, 'p')} + ${num(T[1])}, ${row(2, 'p')} + ${num(T[2])});
}
function dT(p is Vector) returns Vector
{
    return vector(${row(0, 'p')}, ${row(1, 'p')}, ${row(2, 'p')});
}
`;
}
function must(text, from, to) {
  if (!text.includes(from)) throw new Error(`adversarial: patch anchor missing: ${from.slice(0, 80)}`);
  return text.split(from).join(to);
}
function framed(text, id, R, T) {
  let t = text.replace(/(import\(path : "onshape\/std\/common.fs", version : "3044.0"\);\n)/, `$1${frameBlock(R, T)}`);
  t = must(t, 'return plane(origin * millimeter, normal, xDirection);', 'return plane(vT(origin) * millimeter, dT(normal), dT(xDirection));');
  if (t.includes('"direction" : axis,')) t = must(t, '"direction" : axis,', '"direction" : dT(axis),');
  if (id === 'kt1') {
    t = must(t, 'vector(0, 0, 20) * millimeter,\n            vector(0, 0, -1), M3_HYBRID_DEPTH, vector(1, 0, 0), true)',
      'vT(vector(0, 0, 20)) * millimeter,\n            dT(vector(0, 0, -1)), M3_HYBRID_DEPTH, dT(vector(1, 0, 0)), true)');
    t = must(t, 'vector(-16, 0, 10) * millimeter, vector(1, 0, 0),\n            32 * millimeter, vector(0, 0, 1))',
      'vT(vector(-16, 0, 10)) * millimeter, dT(vector(1, 0, 0)),\n            32 * millimeter, dT(vector(0, 0, 1)))');
  }
  if (id === 'kt3' || id === 'kt4') {
    t = must(t, 'plane(vector(0, 0, 0) * millimeter, cross(axisDir, radial), axisDir)', 'plane(vT(vector(0, 0, 0)) * millimeter, dT(cross(axisDir, radial)), dT(axisDir))');
    t = must(t, 'line(vector(0, 0, 0) * millimeter, axisDir)', 'line(vT(vector(0, 0, 0)) * millimeter, dT(axisDir))');
  }
  return t;
}

// <case>-<frame>, split at the first '-'.
export function splitRow(name) {
  const at = name.indexOf('-');
  return at < 0 ? [name, ''] : [name.slice(0, at), name.slice(at + 1)];
}

// The acceptance runner's cases for `names` (default: the gate's set). A row
// with a declared refusal gets expect 'refuse-by-name' and `refusal`; a runner
// that does not call judgeDeclared would fail it for refusing as intended, so
// the default set includes such rows only for a runner that declares
// {declaredRefusals: true} (a row named explicitly always runs).
export function adversarialCases(r20, outDir, base, names = DEFAULT, { declaredRefusals = false } = {}) {
  const kc = path.join(r20, 'kernel-cases');
  const selected = names === DEFAULT && !declaredRefusals ? names.filter(n => !DECLARED[n]) : names;
  return selected.map(name => {
    const [id, frameName] = splitRow(name);
    const frame = FRAMES[frameName], dir = CASES[id];
    if (!frame || !dir) throw new Error(`adversarial: unknown variant ${name}`);
    const text = framed(fs.readFileSync(path.join(kc, dir, 'case.fs'), 'utf8'), id, frame.R, frame.T);
    const caseDir = path.join(outDir, 'adversarial', name);
    fs.mkdirSync(caseDir, { recursive: true });
    const source = path.join(caseDir, 'case.fs');
    fs.writeFileSync(source, text);
    const canonical = base.find(c => c.id === id);
    return { ...canonical, id: `adv:${name}`, dir: `adversarial/${name}`, source, adversarial: true,
      ...(DECLARED[name] ? { expect: 'refuse-by-name', refusal: DECLARED[name] } : { expect: 'build-or-refuse' }),
      transform: frame, refs: canonical.refs.map(r => ({ ...r, sha256: r.sha256, transform: frame })) };
  });
}

// The status of a row with a declared refusal (null for any other row):
// REFUSED when the CLI stopped with exactly the declared message, FAIL when it
// built, timed out or stopped with anything else.
export function judgeDeclared(c, { built, timedOut = false, error = null }) {
  if (!c.refusal) return null;
  if (built) return { status: 'FAIL', reason: `built, but it must refuse by name: ${c.refusal.message}` };
  if (!timedOut && String(error?.message ?? '').includes(c.refusal.message)) return { status: 'REFUSED', reason: `refused by its declared name: ${c.refusal.why}` };
  return { status: 'FAIL', reason: `must refuse by name "${c.refusal.message}", stopped with: ${timedOut ? 'a timeout' : error?.message ?? 'no message'}` };
}
export const ADVERSARIAL_DEFAULT = DEFAULT;
export const ADVERSARIAL_FRAMES = FRAMES;
export const ADVERSARIAL_DECLARED = DECLARED;
