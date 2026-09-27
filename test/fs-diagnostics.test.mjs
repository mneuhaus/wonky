import test from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missing("fixtures/diagnostics/r20-carriers.json");
if (publicTreeSkip) {
  test("fs-diagnostics.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { spawnSync } = await import("node:child_process");
const { mkdtempSync, readFileSync, rmSync, writeFileSync } = await import("node:fs");
const { tmpdir } = await import("node:os");
const { join } = await import("node:path");
const { fileURLToPath } = await import("node:url");
const { readStl, measure } = await import("../scripts/r20/mesh.mjs");
const { checkCarrierSource } = await import("./helpers/carrier-diagnostics.mjs");
// Authoring gate: the CLI owns located FS output and retained refusal inputs.
// Regressions: lost line number/log append, geometry changed by printing, or
// refused operands lost during feature unwinding. Existing r20-export tests
// cover publication, not these diagnostic artifacts. No test-only seam.










const root = fileURLToPath(new URL('../', import.meta.url));
const cli = args => {
  const result = spawnSync(process.execPath, [join(root, 'bin/wonky.mjs'), ...args], { encoding: 'utf8', env: process.env });
  process.stderr.write(result.stderr ?? '');
  return result;
};
const source = extra => `FeatureScript 3044;
import(path : "onshape/std/geometry.fs", version : "3044.0");
export const diagnosticBox = defineFeature(function(context is Context, id is Id, definition is map)
{
    fCuboid(context, id + "box", {"corner1":vector(0,0,0)*millimeter,"corner2":vector(2,3,4)*millimeter});
    setProperty(context, {"entities":qCreatedBy(id + "box", EntityType.BODY),"propertyType":PropertyType.NAME,"value":"B01 box"});
${extra}
});
`;

test('FS println/print retain file and call line, append to log and leave geometry unchanged', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wonky-println-'));
  try {
    const fs = join(dir, 'print.fs'), out = join(dir, 'out');
    writeFileSync(fs, source('    println("hello");\n    print(23);\n    println(true);\n    println(vector(1, 2));\n    println(2 * meter);\n    println([true, id]);\n    println({"b":1,"a":2*meter});\n    println();\n    println(undefined);'));
    const args = [fs, '--format', 'r20-check', '--out', out];
    const expected = `${fs}:7: hello\n${fs}:8: 23${fs}:9: true\n${fs}:10: (1, 2)\n${fs}:11: 2 meter\n${fs}:12: [ true , [ model ] ]\n${fs}:13: { a : 2 meter , b : 1 }\n${fs}:14: \n${fs}:15: undefined\n`;
    const result = cli(args);
    assert.equal(result.status, 0, result.stderr);
    assert.ok(result.stderr.includes(expected), 'stderr must include the source file AND the actual call line');
    assert.ok(!result.stdout.includes('hello'), 'FS output must not leak onto stdout');
    assert.equal(readFileSync(join(out, 'println.log'), 'utf8'), expected);
    const before = readFileSync(join(out, 'B01.stl'));
    assert.equal(cli(args).status, 0);
    assert.equal(readFileSync(join(out, 'println.log'), 'utf8'), expected.repeat(2), 'the log appends, never truncates');
    writeFileSync(fs, source(''));
    assert.equal(cli(args).status, 0);
    assert.ok(readFileSync(join(out, 'B01.stl')).equals(before), 'printing must not alter geometry');
    const manifest = JSON.parse(readFileSync(join(out, 'tessellate-manifest.json')));
    assert.equal(manifest.resources.module, 'diagnosticBox');
    assert.ok(manifest.resources.wallTimeMs > 0);
    assert.ok(manifest.resources.maxRSSKiB > 0);
    assert.equal(manifest.parts.B01.wonky.volumeMm3, 24);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('unsupported operation inside a feature dumps its input body and studio without publishing a partial model', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wonky-refusal-'));
  try {
    const fs = join(dir, 'refusal.fs'), out = join(dir, 'out');
    writeFileSync(fs, source('    opFillet(context, id + "blend", {"entities":qOwnedByBody(qCreatedBy(id + "box", EntityType.BODY),EntityType.EDGE),"radius":1*millimeter,"unimplemented":true});'));
    const result = cli([fs, '--format', 'r20-check', '--out', out]);
    assert.equal(result.status, 1);
    const error = JSON.parse(readFileSync(join(out, 'error.json')));
    assert.equal(error.class, 'UnsupportedFeatureError');
    assert.equal(error.line, 7);
    assert.match(error.message, /unimplemented/);
    assert.match(error.dump, /^refused\/\d+-opFillet\/refusal\.json$/);
    const record = JSON.parse(readFileSync(join(out, error.dump)));
    assert.equal(record.operation.operationId, 'model/blend');
    assert.equal(record.inputs.length, 1);
    assert.equal(record.studio.length, 1);
    assert.equal(record.inputs[0].bodyId, 'model/box');
    assert.equal(record.inputs[0].faceCounts.plane, 6);
    assert.deepEqual(record.inputs[0].bboxMm, { min: [0, 0, 0], max: [2, 3, 4] });
    const mesh = readStl(join(out, error.dump, '..', record.inputs[0].stl));
    assert.ok(Math.abs(measure(mesh[0].triangles).volumeMm3 - 24) < 1e-9);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// Owner boundary for fallback diagnostics: a real frozen M3 tool, not a
// mocked kernel reason. Misusing the reindexed body mesh changes the carriers
// at vertex 11 and fails the independently named a10/a11 source/radius checks.
// Base 527c739 recovers the earlier a5/a6 corner; the remaining refused corner
// is the a10/a11 join at (2.0685316552, -0.3621833672, 0) mm.
test('certified-mesh fallback resolves the original mesh vertex to its actual sketch carriers', () => {
  const out = mkdtempSync(join(tmpdir(), 'wonky-corner-'));
  try {
    const fixture = join(root, 'fixtures/diagnostics/m3-corner.fs');
    const result = cli([fixture, '--feature', 'diagnosticCorner', '--format', 'r20-check', '--deviation', '0.01', '--out', out]);
    assert.equal(result.status, 0, result.stderr);
    const record = JSON.parse(readFileSync(join(out, 'fallbacks/M3.json'))).current;
    assert.match(record.reason, /mesh vertex 11: degenerate vertex, carriers dependent/);
    assert.equal(record.meshVertex, 11);
    assert.equal(record.carriers.length, 3);
    assert.deepEqual(record.carriers.map(c=>c.type).sort(), ['cylinder','cylinder','plane']);
    const curved = record.carriers.filter(c=>c.type==='cylinder');
    assert.deepEqual(curved.flatMap(c=>c.provenance.map(p=>p.sketchEntityId)).sort(), ['a10','a11']);
    for (const c of record.carriers) checkCarrierSource(c, join(root,'fixtures/diagnostics'));
    const manifest = JSON.parse(readFileSync(join(out, 'tessellate-manifest.json')));
    assert.equal(manifest.parts.M3.wonky.exact, false, 'diagnostics cannot promote fallback geometry to exact');
    assert.equal(manifest.parts.M3.wonky.approximation.kind, 'certified-mesh');
  } finally { rmSync(out, { recursive: true, force: true }); }
});

}
