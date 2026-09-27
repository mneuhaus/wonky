import test from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missingBend();
if (publicTreeSkip) {
  test("fillet-port.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { default: fs } = await import("node:fs");
const { loadBend } = await import("../src/bend-loader.mjs");
const { filletJob, loadFilletProduction, loadFilletValidation } = await import("../src/fillet.mjs");
const { decodeJob, decodeResult, encodeJob } = await import("../scripts/fillet/brepfmt.mjs");
const { jobPath, resolveSelection } = await import("../scripts/fillet/fixtures.mjs");
const { prismBody } = await import("../scripts/fillet/run-adversarial.mjs");
const { checkResult } = await import("../scripts/fillet/validate.mjs");
const { divVolume } = await import("../scripts/fillet/divvolume.mjs");
const { edgeUses } = await import("../scripts/fillet/geom.mjs");
// The production fillet and chamfer, kernel/fillet: prototype A ported onto
// the production carriers (docs/fillet-plan.md §8 step 2). The prototype
// (kernel/proto/fillet-kpart) stays the reference: on every catalogue job the
// port must give its result, ladder and network text byte for byte. The one
// intended differences are the riser cap (adv-rb-step-convex-into-riser, which
// A over-refused) and the width bound of an obstacle arc (below); it is checked against the closed form and C-tori
// (kernel/proto/fillet-rollingball-tori, an independent solver) by the
// divergence volume, without OpenCascade. The harness runs (run.mjs,
// run-adversarial.mjs) compare every suite and target; this file is the
// JS-only guard.













const port = await loadBend(new URL('../kernel/fillet/main.bend', import.meta.url));
const proto = await loadBend(new URL('../kernel/proto/fillet-kpart/main.bend', import.meta.url));
const tori = await loadBend(new URL('../kernel/proto/fillet-rollingball-tori/main.bend', import.meta.url));
const production = await loadFilletProduction();
const kernel = await loadFilletValidation();
const catalogue = JSON.parse(fs.readFileSync(new URL('../fixtures/fillet/cases.json', import.meta.url), 'utf8')).cases;
const job = (id) => fs.readFileSync(jobPath(id), 'utf8');

// Intended ladder differences (fillet-arc, docs/fillet-plan.md "Fix: obstacle
// extent in the width bound"): the port measures an obstacle arc over its own
// extent, the prototype over its whole circle (conservative). On these jobs
// only width-bound lines differ: same status, a port limit at least the
// prototype's. `values`: the port's limits from the outline by hand (a 50 x 30
// plate with R5 corners at x 45..50: the bottom and top edges reach each
// other's spring, 30 - 0.42; the left edge reaches the corner arcs' ends, x 45).
const ARC_LADDERS = {
  'corpus-outline-chamfer-lines-arcs-0.42': { lines: 3, values: [29.58, 29.58, 45] },
  'corpus-r22-guide-outline-chamfer-0.42': { lines: 2 },
};
const BOUND = /^(side \d+ face \d+ .* bound )(\w+) limit 1 (\d+) (\d+) by \w+ \d+$/;
const f32x2 = (hi, lo) => { const v = new DataView(new ArrayBuffer(4)); v.setUint32(0, Number(hi)); const h = v.getFloat32(0); v.setUint32(0, Number(lo)); return h + v.getFloat32(0); };
function arcLadder(id, port, proto) {
  const a = port.split('\n'), b = proto.split('\n');
  assert.equal(a.length, b.length, `${id} ladder lines`);
  const limits = [];
  a.forEach((line, i) => {
    if (line === b[i]) return;
    const x = BOUND.exec(line), y = BOUND.exec(b[i]);
    assert.ok(x && y && x[1] === y[1] && x[2] === y[2], `${id} ladder line ${i} differs outside the width bound`);
    const [v, w] = [f32x2(x[3], x[4]), f32x2(y[3], y[4])];
    assert.ok(v >= w, `${id} ladder line ${i}: the port's limit ${v} is below the prototype's ${w}`);
    limits.push(v);
  });
  const want = ARC_LADDERS[id];
  assert.equal(limits.length, want.lines, `${id}: width-bound lines changed`);
  want.values?.forEach((v, i) => assert.ok(Math.abs(limits[i] - v) < 1e-12, `${id} limit ${i}: ${limits[i]} vs ${v}`));
}

test('the port gives the prototype\'s result, ladder and network text on every catalogue job', () => {
  assert.equal(catalogue.length, 71);
  let built = 0;
  for (const { id } of catalogue) {
    const text = job(id);
    const a = port.finish(port.solve0(port.parse(text))), b = proto.finish(proto.solve0(proto.parse(text)));
    const result = port.show(a);
    assert.equal(result, proto.show(b), `${id} result`);
    if (ARC_LADDERS[id]) arcLadder(id, port.show_ladder(a), proto.show_ladder(b));
    else assert.equal(port.show_ladder(a), proto.show_ladder(b), `${id} ladder`);
    assert.equal(port.show_network(a), proto.show_network(b), `${id} network`);
    if (result.startsWith('ok\n')) built++;
  }
  assert.equal(built, 63, 'the catalogue builds 63 of 71 cases (the prototype\'s count)');
});

// The riser case as a job prism: an L profile, the lower step's convex top
// edge runs into the perpendicular riser of the tall part.
const L_PROFILE = [[0, 0], [20, 0], [20, 15], [10, 15], [10, 5], [0, 5]];
function prismJob(id, polygon, op, size) {
  const { body, volume } = prismBody(polygon, 10);
  const select = resolveSelection(body, [{ near: [5, 5, 10] }]);
  return { text: encodeJob({ id, op, size, chamferType: op === 'chamfer' ? 'equal-offsets' : 'none', tangentPropagation: true, body, select }), volume };
}
function builtVolume(jobText, resultText, id) {
  assert.match(resultText, /^ok\n/, `${id}: ${resultText.slice(0, 160)}`);
  const check = checkResult(jobText, resultText);
  assert.deepEqual(check.issues, [], `${id} validator`);
  const v = divVolume(decodeResult(resultText).body);
  assert.equal(v.errors, undefined, `${id} divergence volume`);
  return v.volume;
}

test('a convex edge into a riser: the prototype refuses, the port builds the cap as C-tori and the closed form do', () => {
  const { text, volume } = prismJob('riser-r2', L_PROFILE, 'fillet', 2);
  assert.match(proto.run(text), /^unresolved vertex-blend .*behind vertex .*setback patch needed/);
  const result = port.run(text);
  const v = builtVolume(text, result, 'riser-r2');
  const closed = volume - 10 * 2 * 2 * (1 - Math.PI / 4);
  assert.ok(Math.abs(v - closed) <= 1e-9 * volume, `closed form ${closed}, port ${v}`);
  const c = builtVolume(text, tori.run(text), 'riser-r2 C-tori');
  assert.ok(Math.abs(v - c) <= 1e-9 * volume, `C-tori ${c}, port ${v}`);
  const { body } = decodeResult(result);
  assert.deepEqual([body.vertices.length, body.edges.length, body.faces.length], [14, 21, 9]);
  const caps = body.faces.filter((f) => f.role === 'cap');
  assert.equal(caps.length, 2, 'the far end cap and the riser (grown over the spandrel end)');
});

test('the riser cap of a chamfer (setback d on both faces) removes L d^2 / 2', () => {
  const { text, volume } = prismJob('riser-d1', L_PROFILE, 'chamfer', 1);
  assert.match(proto.run(text), /^unresolved vertex-blend .*behind vertex/);
  const v = builtVolume(text, port.run(text), 'riser-d1');
  assert.ok(Math.abs(v - (volume - 10 * 1 * 1 / 2)) <= 1e-9 * volume, `port ${v}`);
});

test('a thin riser wall backs the cap; inputs the certificate cannot clear stay refused', () => {
  // a riser wall 1 mm thick: its far edges lie wholly behind the cap plane, in the material
  const thin = prismJob('riser-thin', [[0, 0], [11, 0], [11, 15], [10, 15], [10, 5], [0, 5]], 'fillet', 2);
  const v = builtVolume(thin.text, port.run(thin.text), 'riser-thin');
  assert.ok(Math.abs(v - (thin.volume - 10 * 2 * 2 * (1 - Math.PI / 4))) <= 1e-9 * thin.volume, `thin riser ${v}`);
  // the tall part starts 1 mm below the step top: air behind part of the spandrel end
  const gap = prismJob('riser-gap', [[0, 0], [10, 0], [10, 4], [20, 4], [20, 15], [10, 15], [10, 5], [0, 5]], 'fillet', 2).text;
  assert.match(port.run(gap), /^unresolved /);
  // a riser only 0.5 mm high: its top edge touches the cap plane inside the ball, so the
  // conservative certificate refuses it by name (the fillet itself would be valid)
  const short = prismJob('riser-short', [[0, 0], [20, 0], [20, 15], [10, 15], [10, 5.5], [9, 5.5], [9, 5], [0, 5]], 'fillet', 2).text;
  assert.match(port.run(short), /^unresolved vertex-blend .*behind vertex/);
});

// The record: A.Out's order and notes through kernel/fillet/production.bend.
function ladderLines(text, word) {
  return port.show_ladder(port.finish(port.solve0(port.parse(text)))).split('\n').filter((l) => l.startsWith(`${word} `));
}

test('the production record carries the deterministic stripe order and the propagation notes', () => {
  const text = job('fl-slot-one-line-propagate-r1');
  const { select } = decodeJob(text);
  const out = filletJob(production, text, 'prop', kernel);
  assert.equal(out.status, 'ok');
  assert.deepEqual(out.order, [...out.order].sort((a, b) => a - b), 'ascending edge index');
  for (const e of select) assert.ok(out.order.includes(e), `selected edge ${e} in the order`);
  const added = out.order.filter((e) => !select.includes(e));
  assert.ok(added.length > 0, 'tangent propagation added edges');
  assert.deepEqual(out.notes, added.map((e) => `propagated ${e}`));
  assert.deepEqual(out.body.fillet.order, out.order);
  assert.deepEqual(ladderLines(text, 'order'), [`order ${out.order.length} ${out.order.join(' ')}`]);
  // the selection is sorted and deduplicated: a shuffled, repeated select gives the same record and text
  const shuffled = text.replace(/\nselect [^\n]*\n/, `\nselect ${select.length * 2} ${[...select].reverse().join(' ')} ${select.join(' ')}\n`);
  assert.notEqual(shuffled, text);
  assert.equal(port.run(shuffled), port.run(text));
  assert.deepEqual(filletJob(production, shuffled, 'shuffled', kernel).order, out.order);
});

test('a selected seam edge is ignored with a note in the record', () => {
  const text = job('pc-post-top-rim-r1');
  const { body, select } = decodeJob(text);
  const seam = edgeUses(body).findIndex((us) => us.length === 2 && us[0].face === us[1].face);
  assert.ok(seam >= 0, 'the post has a seam edge');
  const withSeam = text.replace(/\nselect [^\n]*\n/, `\nselect ${select.length + 1} ${select.join(' ')} ${seam}\n`);
  const out = filletJob(production, withSeam, 'seam', kernel);
  assert.equal(out.status, 'ok');
  assert.deepEqual(out.notes, [`seam-ignored ${seam}`]);
  assert.deepEqual(out.order, select);
  assert.equal(port.run(withSeam), port.run(text), 'ignoring the seam changes nothing else');
  const refused = filletJob(production, job('hard-tangent-edge-selection-r1'), 'tangent', kernel);
  assert.equal(refused.status, 'unresolved');
  assert.equal(refused.class, 'tangent-edge');
});

}
