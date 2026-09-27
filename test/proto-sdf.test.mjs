import test from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missingBend();
if (publicTreeSkip) {
  test("proto-sdf.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { default: fs } = await import("node:fs");
const { loadBend } = await import("../src/bend-loader.mjs");
const { decodeJob, decodeResult, encodeJob } = await import("../scripts/bakeoff/jobfmt.mjs");
const { validateResult } = await import("../scripts/bakeoff/validate.mjs");
// Bake-off prototype "sdf" (kernel/proto/sdf, docs/proto-sdf.md) on the Bend
// JavaScript target: Boolean results validated by the harness validator,
// explicit refusals, and the FDM analyses against analytic references.
// JS code here only runs the Bend module, builds reference face tables and
// validates (test infrastructure).







const JOBS = new URL('../fixtures/bakeoff/jobs/', import.meta.url);
const csgJob = (id) => fs.readFileSync(new URL(`${id}.csg.job`, JOBS), 'utf8');
const fullJob = (id) => fs.readFileSync(new URL(`${id}.job`, JOBS), 'utf8');
const sdf = await loadBend(new URL('../kernel/proto/sdf/main.bend', import.meta.url));
const fdm = await loadBend(new URL('../kernel/proto/sdf/fdm.bend', import.meta.url));

// The stats line the prototype prints after `end`.
const stats = (text) => Object.fromEntries([...(/^sdf (.*)$/m.exec(text)?.[1] ?? '').matchAll(/(\w+) (-?[\d.]+)/g)].map(([, k, v]) => [k, Number(v)]));

function validOk(jobText, resultText) {
  const { report } = validateResult(jobText, resultText);
  assert.equal(report.valid, true, JSON.stringify(report.issues?.slice(0, 3)));
  return report;
}

test('boxes: union / subtract / intersect are valid closed meshes with exact volume', () => {
  for (const [id, volume] of [['box-union-overlap', 10500], ['box-subtract-overlap', 6500], ['box-intersect-overlap', 1500]]) {
    const out = sdf.run(csgJob(id));
    assert.equal(out.split('\n', 1)[0], 'ok', id);
    const r = validOk(fullJob(id), out);
    assert.ok(Math.abs(r.volume - volume) < 1e-6 * volume, `${id} volume ${r.volume}`);
    const s = stats(out);
    assert.equal(s.fails, 0);
    assert.ok(s.devc_nm <= 10000 && s.devs_nm <= 10000, 'achieved deviation within the case deviation');
  }
});

test('a cylinder is within the stated deviation and tags every triangle with its carrier', () => {
  const out = sdf.run(csgJob('leaf-cylinder'));
  const r = validOk(fullJob('leaf-cylinder'), out);
  assert.equal(r.tags.offSurfaceCorners, 0);
  const s = stats(out);
  assert.ok(s.devs_nm > 0 && s.devs_nm <= s.dev_nm, `sampled chordal deviation ${s.devs_nm} nm`);
  // inscribed chords: slightly below pi r^2 h, within area x deviation
  assert.ok(r.volume < Math.PI * 36 * 12 && Math.PI * 36 * 12 - r.volume < 678.6 * 0.01);
});

test('refusals are explicit: tangent contact, brep leaves, offsets of non-convex prisms', () => {
  const tangent = sdf.run(csgJob('hole-tangent-edge'));
  assert.match(tangent, /^unresolved non-manifold contact: /);
  assert.match(sdf.run(csgJob('r10b-g10-union')), /^unresolved brep leaf has no analytic CSG form/);
  assert.match(fdm.run('offset', '200', csgJob('gear-48-bore')), /^fdm offset unresolved\nunresolved offset\/shell of a non-convex prism/);
});

test('A - A is empty (sampling regularises the measure-zero result)', () => {
  const out = sdf.run(csgJob('self-subtract'));
  assert.equal(decodeResult(out).mesh.triangles.length, 0);
});

// Face table of the shell/offset results: every carrier moved by d along the
// outward normal of its leaf (d is negated for faces of subtracted leaves).
function shifted(job, d, negated) {
  const move = (s, e) => {
    if (s.type === 'plane') return { ...s, o: s.o.map((x, i) => x + e * s.n[i]) };
    if (['cylinder', 'sphere', 'torus'].includes(s.type)) return { ...s, r: s.r + e };
    throw new Error(`no reference shift for ${s.type}`);
  };
  return job.faces.map((f) => ({ ...f, surface: move(f.surface, negated.has(f.leaf) ? -d : d) }));
}
const line = (text) => text.split('\n', 1)[0];
const vol = (text) => Number(/vol_mm3 (-?[\d.]+)/.exec(line(text))[1]);

test('fdm shell: box union hollowed to 2 mm walls (volume 5264 exactly, valid mesh)', () => {
  const out = fdm.run('shell', '2000', csgJob('box-union-overlap'));
  assert.equal(vol(out), 5264);
  const job = decodeJob(fullJob('box-union-overlap'));
  const withInner = { ...job, faces: [...job.faces, ...shifted(job, -2, new Set())] };
  const result = out.slice(out.indexOf('\n') + 1);
  const r = validOk(encodeJob(withInner), result);
  assert.equal(r.components, 2); // outer skin and inner skin of a closed hollow body
});

test('fdm offset: plate with hole grown by 0.3 mm matches the mitered-offset volume', () => {
  // Run at a coarser deviation (0.05 mm) than the case's 0.01 mm to keep the
  // test fast; the stated bound scales with it.
  const dev = 0.05;
  const coarse = (text) => encodeJob({ ...decodeJob(text), deviation: dev });
  const out = fdm.run('offset', '300', coarse(csgJob('plate-through-hole')));
  const exact = 40.6 * 30.6 * 5.6 - Math.PI * 2.9 * 2.9 * 5.6;
  const v = vol(out);
  // inscribed chords of the r = 2.9 hole only add volume: at most hole area x deviation
  assert.ok(v >= exact - 1e-3 && v - exact < 2 * Math.PI * 2.9 * 5.6 * dev, `offset volume ${v} vs ${exact}`);
  const job = decodeJob(coarse(fullJob('plate-through-hole')));
  const r = validOk(encodeJob({ ...job, faces: shifted(job, 0.3, new Set([1])) }), out.slice(out.indexOf('\n') + 1));
  assert.equal(r.genus, 1);
});

test('fdm interference: overlap of the two boxes is 1500 mm^3', () => {
  assert.equal(vol(fdm.run('interference', '0', csgJob('box-union-overlap'))), 1500);
});

test('fdm thickness: the pocket floor of plate-blind-pocket is 2 mm', () => {
  const out = fdm.run('thickness', '2500', csgJob('plate-blind-pocket'));
  const m = / min_um (\d+) .* thin_tris (\d+)/.exec(line(out));
  assert.ok(m, line(out));
  assert.ok(Math.abs(Number(m[1]) - 2000) <= 2, line(out));
  assert.ok(Number(m[2]) > 0);
});

}
