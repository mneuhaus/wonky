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
test('CLI exports every format the Rust kernel can render with parameter overrides, HTML from the Rust mesh', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wonky-cli-'));
  try {
    const prefix = join(dir, 'bracket');
    // The HTML preview is drawn from the Rust mesh path and states its deviation; the volume on
    // the page is the kernel measurement. (A body the mesh path refuses has no HTML:
    // test/rust-cli-export.test.mjs.)
    const run = spawnSync(process.execPath, ['bin/wonky.mjs', 'examples/bracket.fs', '--out', prefix, '--param', 'thickness=12*millimeter'], { cwd: root, encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    assert.deepEqual(readdirSync(dir).sort(), ['bracket.brep.json', 'bracket.html', 'bracket.step', 'bracket.stl']);
    const model = JSON.parse(readFileSync(`${prefix}.brep.json`, 'utf8'));
    assert.ok(Math.abs(model.bodies[0].validation.volumeMm3 - 13248) < 1e-5);
    const html = readFileSync(`${prefix}.html`, 'utf8');
    assert.match(html, /chordal deviation at most 0\.02 mm; volume from the Rust kernel measurement<br>13,248 mm³/);
    assert.doesNotMatch(run.stderr, /EXPORT_UNAVAILABLE/);
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

test('CLI exports a curved revolved cone as STEP and B-rep without requesting a mesh', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wonky-curved-'));
  try {
    const prefix = join(dir, 'spacer');
    execFileSync(process.execPath, ['bin/wonky.mjs', 'fixtures/cli-export/conical-spacer.fs', '--format', 'step', '--out', prefix], { cwd: root });
    assert.deepEqual(readdirSync(dir).sort(), ['spacer.brep.json', 'spacer.step']);
    assert.match(readFileSync(prefix + '.step', 'utf8'), /CONICAL_SURFACE/);
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
