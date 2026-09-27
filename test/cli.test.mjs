import test from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missingBend();
if (publicTreeSkip) {
  test("cli.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { execFileSync, spawnSync } = await import("node:child_process");
const { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } = await import("node:fs");
const { tmpdir } = await import("node:os");
const { join } = await import("node:path");
const { fileURLToPath } = await import("node:url");








const root = fileURLToPath(new URL('../', import.meta.url));
test('CLI exports all four formats with parameter overrides', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wonky-cli-'));
  try {
    const prefix = join(dir, 'bracket');
    execFileSync(process.execPath, ['bin/wonky.mjs', 'examples/bracket.fs', '--out', prefix, '--param', 'thickness=12*millimeter'], { cwd: root });
    assert.deepEqual(readdirSync(dir).sort(), ['bracket.brep.json', 'bracket.html', 'bracket.step', 'bracket.stl']);
    const model = JSON.parse(readFileSync(`${prefix}.brep.json`, 'utf8'));
    assert.ok(Math.abs(model.bodies[0].validation.volumeMm3 - 13248) < 1e-5);
    assert.match(readFileSync(`${prefix}.html`, 'utf8'), /Model preview/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('CLI check writes nothing and errors exit nonzero without partial exports', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wonky-errors-'));
  try {
    execFileSync(process.execPath, ['bin/wonky.mjs', 'examples/box.fs', '--check', '--out', join(dir, 'box')], { cwd: root });
    assert.equal(readdirSync(dir).length, 0);
    const source = join(dir, 'bad.fs');
    writeFileSync(source, 'FeatureScript 3000;\nexport function bad(){opBoolean();}');
    const result = spawnSync(process.execPath, ['bin/wonky.mjs', source, '--out', join(dir, 'bad')], { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 1); assert.match(result.stderr, /Import/);
    assert.deepEqual(readdirSync(dir), ['bad.fs']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('CLI exports a curved Bend loft as STEP and B-rep without requesting a mesh', () => {
  const dir=mkdtempSync(join(tmpdir(),'wonky-curved-'));
  try {
    const prefix=join(dir,'spacer');
    execFileSync(process.execPath,['bin/wonky.mjs','examples/conical-spacer.fs','--format','step','--out',prefix],{cwd:root});
    assert.deepEqual(readdirSync(dir).sort(),['spacer.brep.json','spacer.step']);
    assert.match(readFileSync(prefix+'.step','utf8'),/CONICAL_SURFACE/);
  } finally { rmSync(dir,{recursive:true,force:true}); }
});

test('a refused mesh format no longer discards the exports that did render', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wonky-refused-'));
  try {
    // Default format, so STL and HTML are both requested and both refused for
    // a curved body. The STEP the refusal message points the reader at has to
    // survive; it used to be thrown away with them.
    const prefix = join(dir, 'spacer');
    const result = spawnSync(process.execPath, ['bin/wonky.mjs', 'examples/conical-spacer.fs', '--out', prefix],
      { cwd: root, encoding: 'utf8' });
    assert.deepEqual(readdirSync(dir).sort(), ['spacer.brep.json', 'spacer.step']);
    assert.match(readFileSync(prefix + '.step', 'utf8'), /CONICAL_SURFACE/);
    // Refusing part of what was asked for still fails the run, and says so per
    // format rather than crashing out of the triangulator.
    assert.equal(result.status, 1);
    assert.match(result.stderr, /no \.stl written: STL tessellation of curved B-reps is not implemented/);
    assert.match(result.stderr, /no \.html written: HTML preview of curved B-reps is not implemented/);
    assert.doesNotMatch(result.stderr, /TypeError|Cannot read properties/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('--format r20-check with --check meshes and checks every part but writes nothing, not even error.json', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wonky-r20check-'));
  try {
    const out = join(dir, 'r20');
    // Unnamed: refused, and in check mode the refusal is only reported.
    const refused = spawnSync(process.execPath, ['bin/wonky.mjs', 'examples/bracket.fs', '--format', 'r20-check', '--check', '--out', out], { cwd: root, encoding: 'utf8' });
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /has no NAME/);
    const source = join(dir, 'named.fs');
    writeFileSync(source, readFileSync(join(root, 'examples/bracket.fs'), 'utf8').replace('        });\n    }, {',
      '        });\n        setProperty(context, { "entities" : qCreatedBy(id + "extrusion", EntityType.BODY), "propertyType" : PropertyType.NAME, "value" : "B01 bracket" });\n    }, {'));
    const passed = spawnSync(process.execPath, ['bin/wonky.mjs', source, '--format', 'r20-check', '--check', '--deviation', '0.01', '--out', out], { cwd: root, encoding: 'utf8' });
    assert.equal(passed.status, 0, passed.stderr);
    assert.deepEqual(readdirSync(dir), ['named.fs']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

}
