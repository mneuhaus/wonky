import test from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missingBend();
if (publicTreeSkip) {
  test("r20-blend-census.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { default: fs } = await import("node:fs");
const { default: os } = await import("node:os");
const { default: path } = await import("node:path");
const { build } = await import("../src/index.mjs");
const { blendCensusStem } = await import("../src/fillet-op.mjs");
const { decodeJob } = await import("../scripts/fillet/brepfmt.mjs");
const { classify, booleanFlow, expected, checkInventory } = await import("../scripts/r20/blend-census.mjs");










const fixtureDir = new URL('../fixtures/fillet/r20-sites/', import.meta.url);
const source = fs.readFileSync(new URL('../fixtures/fillet/fs-frontend.fs', import.meta.url), 'utf8');
const job = name => decodeJob(fs.readFileSync(new URL(`${blendCensusStem(name)}.job`, fixtureDir), 'utf8'));

test('real FeatureScript chamfers with formerly colliding IDs retain both input dumps; repeats cannot overwrite', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bl0-unique-'));
  const previous = process.env.WONKY_BLEND_CENSUS_DIR;
  process.env.WONKY_BLEND_CENSUS_DIR = dir;
  try {
    const ids = ['model/a_b/c', 'model/a/b_c'];
    const translated = source.replace('vector(-15, -9, 0), vector(15, 9, 26)', 'vector(35, -9, 0), vector(65, 9, 26)')
      .replace('vector(1, 1, 26)', 'vector(50, 1, 26)');
    for (const [index, id] of ids.entries()) {
      const model = await build(index === 0 ? source : translated, { feature: 'p1Box', id, trace: false });
      assert.equal(model.bodies.length, 1);
    }
    const captured = fs.readdirSync(dir).filter(name => name.endsWith('.job'));
    assert.equal(captured.length, 2, 'every distinct runtime ID must have its own dump');
    assert.notEqual(blendCensusStem(ids[0]), blendCensusStem(ids[1]));
    for (const [index, id] of ids.entries()) {
      const found = captured.find(name => decodeJob(fs.readFileSync(path.join(dir, name), 'utf8')).id === `${id}/break`);
      assert.ok(found, `missing job for ${id}`);
      const input = decodeJob(fs.readFileSync(path.join(dir, found), 'utf8'));
      assert.equal(Math.min(...input.body.vertices.map(point => point[0])), index === 0 ? -15 : 35);
    }
    await assert.rejects(build(source, { feature: 'p1Box', id: ids[0], trace: false }), { code: 'EEXIST' });
    assert.equal(fs.readdirSync(dir).filter(name => name.endsWith('.job')).length, 2);
  } finally {
    if (previous === undefined) delete process.env.WONKY_BLEND_CENSUS_DIR;
    else process.env.WONKY_BLEND_CENSUS_DIR = previous;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('R20 cap classes distinguish oblique crest from perpendicular seam, with corner types', () => {
  const crest = classify(job('model/E01/crest'));
  const seam = classify(job('model/E01/seam/backer'));
  assert.equal(crest.selected[0].carrierPairCurve, 'plane/plane:line');
  assert.equal(seam.selected[0].carrierPairCurve, 'plane/plane:line');
  assert.match(crest.selected[0].class, /oblique planar cap/);
  assert.match(seam.selected[0].class, /perpendicular planar cap/);
  assert.ok(crest.corners.every(c => c.capAngleDot < 0.9));
  assert.ok(seam.corners.every(c => c.capAngleDot > 0.99999999));
  assert.ok(classify(job('model/ARM_R/blockBlends/corners')).cornerTypes.includes('perpendicular planar cap'));
  assert.ok(classify(job('model/T01/blends/concave')).cornerTypes.some(type => /two-edge chain/.test(type)));
  assert.ok(classify(job('model/ARM_R/plateBlends/rim')).selected.some(edge => /chamfer cone on rim/.test(edge.class)));
});

test('ARM_R plate blends feed observed union, not unexecuted window cuts or features', () => {
  const plate = expected.find(row => row.id === 'model/ARM_R/plateBlends/junction');
  const flow = booleanFlow(plate, { status: 'ok' });
  assert.deepEqual(flow.observed, ['model/ARM_R/join/union1 (return execution, before return.fs:902)']);
  assert.match(flow.description, /window\/pocket cuts.*planned, NOT executed/);
  assert.doesNotMatch(plate.nextBoolean, /window/);
  const seam = expected.find(row => row.id === 'model/ARM_R/seamBlend/seam');
  assert.match(seam.blocker, /before seamBlend, window cuts, ARM_R\/features/);
  assert.deepEqual(booleanFlow(seam, { status: 'ok' }).observed, []);
});

test('inventory negatives detect missing dump and collapsed ARM_R invocation', () => {
  const rows = expected.map(row => ({ ...row, status: row.blocker ? 'OPEN' : 'dump' }));
  checkInventory(rows, () => true);
  assert.throws(() => checkInventory(rows, row => row.id !== 'model/E01/seam/foot'), /dump missing/);
  assert.throws(() => checkInventory(rows.filter(row => row.id !== 'model/ARM_R/plateBlends/junction'), () => true), /19 unique/);
});

}
