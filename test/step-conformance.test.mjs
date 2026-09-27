import test from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missingBend();
if (publicTreeSkip) {
  test("step-conformance.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { mkdirSync, writeFileSync } = await import("node:fs");
const { spawnSync } = await import("node:child_process");
const { fileURLToPath } = await import("node:url");
const { build } = await import("../src/index.mjs");
const { toStep } = await import("../src/exporters.mjs");
// Owner boundary: serialized STEP read by the independent AP214 subset + OCCT
// validator. Existing PCurve tests check UV geometry, not EXPRESS WR3 or reader
// healing. Regression: a bare TRIMMED_CURVE is accepted by OCCT but not AP214.








const root = fileURLToPath(new URL('../', import.meta.url));
const out = new URL('../tmp/step-conformance/', import.meta.url);
mkdirSync(out, { recursive: true });
const source = `FeatureScript 3044;
import(path : "onshape/std/geometry.fs", version : "3044.0");
export function halfDisc(context is Context, id is Id, definition is map) {
  var sk = newSketchOnPlane(context, id + "s", { "sketchPlane" : plane(vector(0,0,0) * millimeter, vector(0,0,1)) });
  skArc(sk, "a", { "start" : vector(-5,0) * millimeter, "mid" : vector(0,5) * millimeter, "end" : vector(5,0) * millimeter });
  skLineSegment(sk, "l", { "start" : vector(5,0) * millimeter, "end" : vector(-5,0) * millimeter });
  skSolve(sk);
  opExtrude(context, id + "p", { "entities" : qSketchRegion(id + "s"), "direction" : vector(0,0,1), "endBound" : BoundingType.BLIND, "endDepth" : 3 * millimeter });
}`;
const validate = prefix => spawnSync('uv', ['run', 'scripts/validate-step.py', prefix], {
  cwd: root, encoding: 'utf8', maxBuffer: 1024 * 1024, timeout: 120_000,
});

test('half-disc STEP preserves volume, trims and tolerance without a forbidden edge basis', async () => {
  const model = await build(source, { feature: 'halfDisc' });
  assert.equal(model.bodies.length, 1);
  assert.ok(Math.abs(model.bodies[0].validation.volumeMm3 - 37.5 * Math.PI) < 1e-10);
  const prefix = fileURLToPath(new URL('half-disc', out));
  const step = toStep(model);
  writeFileSync(prefix + '.brep.json', JSON.stringify(model));
  writeFileSync(prefix + '.step', step);
  const positive = validate(prefix);
  assert.equal(positive.status, 0, `${positive.error ?? ''}\n${positive.stderr}${positive.stdout}`);
  const report = JSON.parse(positive.stdout.slice(positive.stdout.indexOf('[\n')))[0];
  assert.equal(report.sameParameter, true);
  assert.equal(report.sameRange, true);
  assert.equal(report.schemaSubset.edgesChecked, model.bodies[0].edges.length);
  assert.ok(Math.abs(report.volumeMm3 - 37.5 * Math.PI) < 1e-8);

  // Plant a legal generic curve that violates ADVANCED_FACE WR3 specifically.
  // The topology/coordinates are untouched and OCCT normally heals this.
  const line = /^#(\d+)=LINE\(/m.exec(step);
  assert.ok(line);
  const next = Math.max(...[...step.matchAll(/^#(\d+)=/gm)].map(m => Number(m[1]))) + 1;
  const edge = new RegExp(`(EDGE_CURVE\\('',[^\\n;]*,)#${line[1]}(,\\.[TF]\\.\\))`);
  assert.ok(edge.test(step));
  const mutant = step.replace(edge, `$1#${next}$2`).replace('ENDSEC;\nEND-ISO',
    `#${next}=TRIMMED_CURVE('',#${line[1]},(PARAMETER_VALUE(0.)),(PARAMETER_VALUE(10.)),.T.,.PARAMETER.);\nENDSEC;\nEND-ISO`);
  try {
    writeFileSync(prefix + '.step', mutant);
    const negative = validate(prefix);
    assert.notEqual(negative.status, 0);
    assert.match(negative.stderr, /AP214 ADVANCED_FACE.WR3:.*EDGE_CURVE -> TRIMMED_CURVE is forbidden/);
  } finally { writeFileSync(prefix + '.step', step); }
});

}
