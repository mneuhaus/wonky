import test from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missingBend();
if (publicTreeSkip) {
  test("python-exports.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { createHash } = await import("node:crypto");
const { spawnSync } = await import("node:child_process");
const { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } = await import("node:fs");
const { homedir, tmpdir } = await import("node:os");
const { dirname, join } = await import("node:path");
const { fileURLToPath } = await import("node:url");
const { buildPython, defaultReadOnlyRoots, ExportRefusedError, projectDirectory } = await import("../src/python.mjs");
// Python export_step()/export_stl() write real files (decision 13,
// 2026-09-24): from the Bend B-rep with the exporters of bin/wonky.mjs, at the
// path Python resolves, inside the model's project directory only, and each
// written file is recorded with its path and SHA-256 in the build provenance.
// Python runs through `uv run`, never a bare python3.










const root = fileURLToPath(new URL('../', import.meta.url));
const workspace = realpathSync(mkdtempSync(join(tmpdir(), 'wonky-python-exports-')));
const python = join(workspace, 'uv-python');
writeFileSync(python, '#!/bin/sh\nexec uv run --no-project --quiet python "$@"\n');
chmodSync(python, 0o755);
test.after(() => rmSync(workspace, { recursive: true, force: true }));

let serial = 0;
const project = files => {
  const directory = join(workspace, `p${++serial}`);
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(dirname(join(directory, name)), { recursive: true });
    writeFileSync(join(directory, name), text);
  }
  return directory;
};
// Python's working directory is the model directory unless a test says otherwise.
const run = (directory, file, options = {}) => {
  const filename = join(directory, file);
  return buildPython(readFileSync(filename, 'utf8'), { filename, python, cwd: dirname(filename), ...options });
};
const sha256 = file => createHash('sha256').update(readFileSync(file)).digest('hex');
const refused = pattern => error => {
  assert.ok(error instanceof ExportRefusedError, `${error.name}: ${error.message}`);
  assert.match(error.message, pattern);
  return true;
};

test('export_step and export_stl write at the Python-resolved path; the model reads its files back', async () => {
  const directory = project({
    'pyproject.toml': '[project]\nname = "demo"\n',
    'parts/model.py': [
      'import hashlib, os, json',
      'from pathlib import Path',
      'from build123d import *',
      'plate = Box(10, 8, 2)',
      'pin = Pos(20, 0, 0) * Cylinder(2, 6)',
      'os.makedirs("exports", exist_ok=True)',
      'assert export_step(plate, Path("exports") / "plate.step") is True',
      'assert export_stl(plate, "exports/plate.stl") is True',
      'export_stl(pin, "exports/pin.stl", tolerance=0.05, angular_tolerance=0.5, ascii_format=True)',
      'os.chdir("..")  # relative paths follow the working directory, as in CPython',
      'export_step([plate, pin], "both.step")',
      'digests = {p: hashlib.sha256(Path(p).read_bytes()).hexdigest() for p in',
      '           ["parts/exports/plate.step", "parts/exports/plate.stl", "parts/exports/pin.stl", "both.step"]}',
      'print(json.dumps(digests))',
    ].join('\n') + '\n',
  });
  const model = await run(directory, 'parts/model.py');
  const digests = JSON.parse(model.execution.stdout.trim().split('\n').at(-1));
  const files = model.source.writtenFiles;
  assert.deepEqual(files.map(file => [file.kind, file.requested, file.projectPath]), [
    ['export_step', 'exports/plate.step', 'parts/exports/plate.step'],
    ['export_stl', 'exports/plate.stl', 'parts/exports/plate.stl'],
    ['export_stl', 'exports/pin.stl', 'parts/exports/pin.stl'],
    ['export_step', 'both.step', 'both.step'],
  ]);
  for (const file of files) {
    assert.equal(file.path, join(directory, file.projectPath));
    // The recorded hash is the file on disk and what the model itself read back.
    assert.equal(file.sha256, sha256(file.path));
    assert.equal(file.sha256, digests[file.projectPath]);
    assert.equal(file.bytes, readFileSync(file.path).length);
  }
  const [step, stl, pin, both] = files;
  assert.equal(step.format, 'STEP');
  assert.match(readFileSync(step.path, 'utf8'), /^ISO-10303-21;[\s\S]*MANIFOLD_SOLID_BREP[\s\S]*END-ISO-10303-21;\n$/);
  // build123d's default is binary STL: 84-byte header plus 50 bytes per facet;
  // a box has the 12 exact facets of its B-rep.
  assert.deepEqual([stl.format, stl.mesh, stl.bytes], ['STL (binary)', 'exact-facets', 84 + 12 * 50]);
  assert.equal(readFileSync(stl.path).readUInt32LE(80), 12);
  // A curved body goes through the print mesh within the requested tolerance.
  assert.deepEqual([pin.format, pin.mesh, pin.deviationMm], ['STL (ASCII)', 'print-mesh', 0.05]);
  assert.ok(pin.achievedDeviationMm <= 0.05, pin.achievedDeviationMm);
  assert.match(pin.angularTolerance, /not applied/);
  assert.match(readFileSync(pin.path, 'utf8'), /^solid python_[0-9_]+\n/);
  assert.equal(both.bodyIds.length, 2);
  assert.equal((readFileSync(both.path, 'utf8').match(/MANIFOLD_SOLID_BREP/g) ?? []).length, 2);
  // Output records say what was written; angular_tolerance is the one option not applied.
  const outputs = model.source.outputs.filter(output => output.kind.startsWith('export_'));
  assert.ok(outputs.every(output => output.written === true && output.file.sha256 === files.find(file => file.path === output.file.path).sha256));
  assert.deepEqual(outputs.map(output => output.ignoredOptions ?? null), [null, null, ['angular_tolerance'], null, null]);
});

test('paths outside the project directory are refused and latched, even when Python catches the error', async () => {
  const outside = join(workspace, 'outside');
  mkdirSync(outside, { recursive: true });
  const directory = project({
    'model.py': 'from build123d import *\nb = Box(1, 1, 1)\nexport_step(b, "inside.step")\n',
    'absolute.py': `from build123d import *\nb = Box(1, 1, 1)\ntry:\n    export_step(b, ${JSON.stringify(join(outside, 'x.step'))})\nexcept PermissionError:\n    pass\nresult = b\n`,
    'escape.py': 'from build123d import *\nexport_stl(Box(1, 1, 1), "../escape.stl")\n',
    'linked.py': 'from build123d import *\nexport_step(Box(1, 1, 1), "link/x.step")\n',
    'self.py': 'from build123d import *\nexport_step(Box(1, 1, 1), "self.py")\n',
  });
  symlinkSync(outside, join(directory, 'link'));
  // Python's working directory elsewhere: the relative path resolves there, as in CPython.
  await assert.rejects(run(directory, 'model.py', { cwd: outside }),
    refused(new RegExp(`export_step\\('inside\\.step'\\): refusing to write ${outside}/inside\\.step: it is outside the model's project directory ${directory} \\(Python resolved 'inside\\.step' against its working directory ${outside}\\)`)));
  await assert.rejects(run(directory, 'absolute.py'), error => refused(/refusing to write .*outside\/x\.step/)(error) && error.line === 4);
  await assert.rejects(run(directory, 'escape.py'), refused(/export_stl\('\.\.\/escape\.stl'\): refusing to write .*outside the model's project directory/));
  await assert.rejects(run(directory, 'linked.py'), refused(new RegExp(`refusing to write ${outside}/x\\.step`)));
  await assert.rejects(run(directory, 'self.py'), refused(/refusing to overwrite the model's own source file/));
  assert.deepEqual([existsSync(join(directory, 'inside.step')), existsSync(join(outside, 'inside.step')), existsSync(join(outside, 'x.step'))],
    [false, false, false]);
  // In-memory source has no project directory.
  await assert.rejects(buildPython('from build123d import *\nexport_step(Box(1, 1, 1), "x.step")\n', { python, cwd: directory }),
    refused(/the model has no project directory/));
});

test('read-only roots are refused explicitly, also through a case variant; the corpus root is always read only', async () => {
  const directory = project({
    'model.py': 'from build123d import *\nexport_step(Box(1, 1, 1), "frozen/x.step")\n',
    // On a case-insensitive volume (APFS default) FROZEN is the frozen directory.
    'upper.py': 'from build123d import *\nexport_step(Box(1, 1, 1), "FROZEN/x.step")\n',
  });
  mkdirSync(join(directory, 'frozen'));
  await assert.rejects(run(directory, 'model.py', { readOnlyRoots: [join(directory, 'frozen')] }),
    refused(new RegExp(`refusing to write .*frozen/x\\.step: ${directory}/frozen is read only for this run`)));
  const caseInsensitive = existsSync(join(directory, 'FROZEN'));
  if (caseInsensitive) {
    await assert.rejects(run(directory, 'upper.py', { readOnlyRoots: [join(directory, 'frozen')] }),
      refused(new RegExp(`refusing to write ${directory}/frozen/x\\.step: ${directory}/frozen is read only for this run`)));
  }
  assert.equal(existsSync(join(directory, 'frozen', 'x.step')), false);

  // Corpus runs execute a mirror under tmp/corpus/src; the corpus itself stays read only.
  const corpus = join(workspace, 'cad'), mirror = join(root, 'tmp', 'corpus', 'src', `.wonky-test-${process.pid}`);
  mkdirSync(corpus, { recursive: true });
  mkdirSync(mirror, { recursive: true });
  const previous = process.env.WONKY_CORPUS_ROOT;
  process.env.WONKY_CORPUS_ROOT = corpus;
  try {
    const model = join(mirror, 'model.py');
    writeFileSync(model, `from build123d import *\nexport_step(Box(1, 1, 1), ${JSON.stringify(join(corpus, 'x.step'))})\n`);
    // ~/Workspace/cad stays read only even when WONKY_CORPUS_ROOT points elsewhere.
    assert.deepEqual(defaultReadOnlyRoots(), [join(homedir(), 'Workspace', 'cad'), corpus]);
    assert.equal(projectDirectory(model), realpathSync(mirror));
    const note = 'the corpus is never written: a corpus run executes the mirror under tmp/corpus/src; to export from a corpus model, run a copy outside the corpus';
    await assert.rejects(buildPython(readFileSync(model, 'utf8'), { filename: model, python, cwd: mirror }),
      refused(new RegExp(`refusing to write ${corpus}/x\\.step: ${corpus} is read only for this run \\(${note}\\)`)));
    assert.equal(existsSync(join(corpus, 'x.step')), false);
    // A model run from the corpus directly (not from the mirror) cannot write into it either.
    mkdirSync(join(corpus, 'proj'), { recursive: true });
    writeFileSync(join(corpus, 'proj', 'pyproject.toml'), '[project]\nname = "corpus"\n');
    writeFileSync(join(corpus, 'proj', 'model.py'), 'from build123d import *\nexport_step(Box(1, 1, 1), "x.step")\n');
    await assert.rejects(run(join(corpus, 'proj'), 'model.py'),
      refused(new RegExp(`refusing to write ${corpus}/proj/x\\.step: ${corpus} is read only for this run`)));
    assert.equal(existsSync(join(corpus, 'proj', 'x.step')), false);
  } finally {
    if (previous === undefined) delete process.env.WONKY_CORPUS_ROOT; else process.env.WONKY_CORPUS_ROOT = previous;
    rmSync(mirror, { recursive: true, force: true });
  }
});

test('a planted temporary-file link, a link before .. or a NUL byte cannot redirect a write', async () => {
  const outside = join(workspace, 'outside-links');
  mkdirSync(join(outside, 'inner'), { recursive: true });
  const victim = join(outside, 'victim.txt');
  writeFileSync(victim, 'ORIGINAL\n');
  // The model plants links at every temporary name it could guess (the old
  // writer used <target>.<host pid>.tmp and followed a link there).
  const directory = project({
    'pyproject.toml': '[project]\nname = "links"\n',
    'plant.py': [
      'import os',
      'from build123d import *',
      `for name in ["x.stl.${process.pid}.tmp", "x.stl.tmp", ".x.stl.tmp"]:`,
      `    os.symlink(${JSON.stringify(victim)}, name)`,
      'export_stl(Box(1, 1, 1), "x.stl", ascii_format=True)',
      'print(open("x.stl").read().splitlines()[0])',
    ].join('\n') + '\n',
    // CPython resolves link/.. through the symlink (to outside), not lexically (to the project).
    'dotdot.py': 'from build123d import *\nexport_step(Box(1, 1, 1), "link/../x.step")\n',
    'missing.py': 'from build123d import *\nexport_step(Box(1, 1, 1), "nope/../y.step")\n',
    'nul.py': 'from build123d import *\ntry:\n    export_step(Box(1, 1, 1), "a\\x00b.step")\nexcept ValueError as error:\n    print("ValueError", error)\nresult = Box(1, 1, 1)\n',
  });
  symlinkSync(join(outside, 'inner'), join(directory, 'link'));
  const model = await run(directory, 'plant.py');
  assert.equal(readFileSync(victim, 'utf8'), 'ORIGINAL\n');
  assert.match(model.execution.stdout, /^solid python_1/);
  const [file] = model.source.writtenFiles;
  assert.equal(file.path, join(directory, 'x.stl'));
  assert.equal(file.sha256, sha256(join(directory, 'x.stl')));
  assert.ok(!lstatSync(join(directory, 'x.stl')).isSymbolicLink());
  await assert.rejects(run(directory, 'dotdot.py'),
    refused(new RegExp(`refusing to write ${outside}/x\\.step: it is outside the model's project directory ${directory}`)));
  assert.deepEqual([existsSync(join(directory, 'x.step')), existsSync(join(outside, 'x.step'))], [false, false]);
  await assert.rejects(run(directory, 'missing.py'), /FileNotFoundError: export_step\('nope\/\.\.\/y\.step'\): no such directory/);
  assert.equal(existsSync(join(directory, 'y.step')), false);
  const nul = await run(directory, 'nul.py');
  assert.match(nul.execution.stdout, /ValueError export_step\(\): embedded null byte/);
  assert.equal(nul.source.writtenFiles, undefined);
});

test('a missing directory is a Python FileNotFoundError, not a silent skip; the output says it was not written', async () => {
  const directory = project({
    'model.py': [
      'from build123d import *',
      'b = Box(2, 2, 2)',
      'try:',
      '    export_step(b, "missing/b.step")',
      'except FileNotFoundError as error:',
      '    print("caught", error)',
      'result = b',
    ].join('\n') + '\n',
    'uncaught.py': 'from build123d import *\nexport_stl(Box(2, 2, 2), "missing/b.stl")\n',
  });
  const model = await run(directory, 'model.py');
  assert.match(model.execution.stdout, /caught export_step\('missing\/b\.step'\): no such directory .*missing; build123d does not create directories either/);
  assert.equal(model.source.writtenFiles, undefined);
  await assert.rejects(run(directory, 'uncaught.py'), /FileNotFoundError: export_stl\('missing\/b\.stl'\): no such directory/);
});

test('CLI reports each written file with its SHA-256 and brep.json carries them', () => {
  const directory = project({ 'part.py': 'from build123d import *\nexport_step(Box(4, 4, 4), "part.step")\n' });
  const prefix = join(directory, 'out', 'part');
  const cli = spawnSync(process.execPath, [join(root, 'bin/wonky-python.mjs'), 'part.py', '--python', python, '--out', prefix],
    { cwd: directory, encoding: 'utf8' });
  assert.equal(cli.status, 0, cli.stderr);
  const digest = sha256(join(directory, 'part.step'));
  assert.match(cli.stdout, new RegExp(`export_step\\('part\\.step'\\) wrote ${directory}/part\\.step \\(STEP, \\d+ bytes, sha256 ${digest}\\) ← python/1`));
  const model = JSON.parse(readFileSync(`${prefix}.brep.json`, 'utf8'));
  assert.deepEqual(model.source.writtenFiles.map(file => [file.path, file.sha256]), [[join(directory, 'part.step'), digest]]);
  // A refused write fails the CLI with the model line.
  const elsewhere = spawnSync(process.execPath, [join(root, 'bin/wonky-python.mjs'), join(directory, 'part.py'), '--python', python, '--check'],
    { cwd: workspace, encoding: 'utf8' });
  assert.equal(elsewhere.status, 1);
  assert.match(elsewhere.stderr, /part\.py:2: export_step\('part\.step'\): refusing to write .*outside the model's project directory/);
});

}
