import test from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missingBend();
if (publicTreeSkip) {
  test("python-runner.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { createHash } = await import("node:crypto");
const { spawnSync } = await import("node:child_process");
const { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, utimesSync, writeFileSync } = await import("node:fs");
const { tmpdir } = await import("node:os");
const { dirname, join } = await import("node:path");
const { fileURLToPath } = await import("node:url");
const { buildPython, PythonExecutionError } = await import("../src/python.mjs");
const { UnsupportedFeatureError } = await import("../src/errors.mjs");
// Python runner (W5 "runner"): sys.path like `python model.py`, provenance of
// project modules, the installed-package policy and the result contract.
// Python runs through `uv run`, never a bare python3.











const root = fileURLToPath(new URL('../', import.meta.url));
const workspace = realpathSync(mkdtempSync(join(tmpdir(), 'wonky-python-runner-')));
const python = join(workspace, 'uv-python');
writeFileSync(python, '#!/bin/sh\nexec uv run --no-project --quiet python "$@"\n');
chmodSync(python, 0o755);
test.after(() => rmSync(workspace, { recursive: true, force: true }));

let serial = 0;
// Writes files below a fresh project directory and returns its absolute path.
const project = files => {
  const directory = join(workspace, `p${++serial}`);
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(dirname(join(directory, name)), { recursive: true });
    writeFileSync(join(directory, name), text);
  }
  return directory;
};
const run = (directory, file, options = {}) => {
  const filename = join(directory, file);
  return buildPython(readFileSync(filename, 'utf8'), { filename, python, ...options });
};
const sha256 = file => createHash('sha256').update(readFileSync(file)).digest('hex');
const capability = pattern => error => {
  assert.ok(error instanceof UnsupportedFeatureError, `${error.name}: ${error.message}`);
  assert.match(error.message, pattern);
  return true;
};

test('model directory and nearest pyproject root are importable and every project module is hashed', async () => {
  const directory = project({
    'pyproject.toml': '[project]\nname = "demo"\n',
    'shared.py': 'HEIGHT = 5\n',
    'pkg/__init__.py': '',
    'pkg/dims.py': 'WIDTH = 10\n',
    'parts/sibling.py': 'from build123d import *\n\ndef plate(width, height):\n    return Box(width, 4, height)\n',
    'parts/model.py': [
      'import sys, subprocess, zipfile  # stdlib optional-module probes stay ordinary',
      'from build123d import *',
      'import sibling, shared',
      'from pkg.dims import WIDTH',
      'assert sys.argv == [__file__] and __name__ == "__main__"',
      'assert sys.modules["__main__"].__file__ == __file__',
      'from dataclasses import dataclass',
      '@dataclass',
      'class Spec:\n    width: float',
      'result = sibling.plate(Spec(WIDTH).width, shared.HEIGHT)',
    ].join('\n') + '\n',
  });
  const model = await run(directory, 'parts/model.py');
  assert.equal(model.bodies.length, 1);
  assert.ok(Math.abs(model.bodies[0].validation.volumeMm3 - 200) < 1e-9);
  assert.equal(model.source.result, 'result');
  assert.deepEqual(model.source.environment.projectPath, [join(directory, 'parts'), directory]);
  assert.equal(model.source.environment.isolation, '-I -S -B');
  const expected = [['sibling', 'parts/sibling.py'], ['shared', 'shared.py'], ['pkg', 'pkg/__init__.py'], ['pkg.dims', 'pkg/dims.py']]
    .map(([module, file]) => ({ module, path: join(directory, file), sha256: sha256(join(directory, file)) }));
  assert.deepEqual(model.source.modules, expected);
});

test('directories the model adds to sys.path itself are importable and their modules are hashed too', async () => {
  // Corpus: cad-project-012/sim/ramp_sim.py inserts ../parts, preload_z/coupon.py a parent directory.
  const directory = project({
    'parts/common.py': 'DEPTH = 3\n',
    'sim/model.py': [
      'import sys',
      'from pathlib import Path',
      'sys.path.insert(0, str(Path(__file__).parent.parent / "parts"))',
      'from build123d import *',
      'import common',
      'result = Box(1, 1, common.DEPTH)',
    ].join('\n') + '\n',
  });
  const model = await run(directory, 'sim/model.py');
  assert.ok(Math.abs(model.bodies[0].validation.volumeMm3 - 3) < 1e-9);
  assert.deepEqual(model.source.environment.projectPath, [join(directory, 'sim')], 'no pyproject.toml: the model directory only');
  const file = join(directory, 'parts/common.py');
  assert.deepEqual(model.source.modules, [{ module: 'common', path: file, sha256: sha256(file) }]);
});

test('a site-packages directory put on sys.path by the model stays unavailable', async () => {
  const directory = project({
    '.venv/lib/python3.13/site-packages/numpy/__init__.py': 'def array(values):\n    return values\n',
    'part.py': [
      'import sys, os',
      'sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".venv/lib/python3.13/site-packages"))',
      'from build123d import *',
      'import numpy',
      'result = Box(1, 1, 1)',
    ].join('\n') + '\n',
  });
  await assert.rejects(run(directory, 'part.py'), error =>
    capability(/Python package 'numpy' resolves to an installed package at .*site-packages\/numpy\/__init__\.py \(imported at part\.py:4\)\. Policy: installed third-party packages are not importable/)(error)
    && error.line === 4 && error.sourceFiles.length === 0);
});

test('the unavailable-package error names the package-specific reason from _wonky_packages', async () => {
  const directory = project({ 'part.py': 'from build123d import *\nfrom bd_warehouse.thread import IsoThread\n' });
  await assert.rejects(run(directory, 'part.py'), error =>
    capability(/package 'bd_warehouse' is not available .*installed third-party packages are not importable, and wonky does not provide bd_warehouse: its threads.* See docs\/python-khana\.md\./)(error)
    && error.line === 2);
});

test('projectPath: false keeps the model directory off sys.path and says so at the import line', async () => {
  const directory = project({ 'helpers.py': 'WIDTH = 20\n', 'part.py': 'from build123d import *\nfrom helpers import WIDTH\nresult = Box(WIDTH, 1, 1)\n' });
  await assert.rejects(run(directory, 'part.py', { projectPath: false }), error =>
    capability(/Python package 'helpers' is not available.*project path: disabled/)(error) && error.line === 2);
});

test('an error inside a project module keeps its file in provenance and in the message', async () => {
  const directory = project({
    'helpers.py': 'WIDTH = 20\n\ndef broken():\n    raise ValueError("bad width")\n',
    'part.py': 'from build123d import *\nimport helpers\nhelpers.broken()\nresult = Box(1, 1, 1)\n',
  });
  await assert.rejects(run(directory, 'part.py'), error => {
    assert.ok(error instanceof PythonExecutionError);
    assert.equal(error.line, 3);
    assert.equal(error.format('part.py'), 'part.py:3: ValueError: bad width (in helpers.py:4)');
    assert.deepEqual(error.sourceFiles.map(item => item.module), ['helpers']);
    assert.equal(error.sourceFiles[0].sha256, sha256(join(directory, 'helpers.py')));
    return true;
  });
  const syntax = project({ 'helpers.py': 'def (\n', 'part.py': 'import helpers\n' });
  await assert.rejects(run(syntax, 'part.py'), error => error instanceof PythonExecutionError
    && /SyntaxError/.test(error.message) && error.line === 1 && error.sourceFile.endsWith('helpers.py') && error.sourceLine === 1);
});

test('installed packages and external kernels are capability errors at the import line, even when caught', async () => {
  const directory = project({
    'numpy_user.py': 'from build123d import *\ntry:\n    import numpy as np\nexcept ImportError:\n    np = None\nresult = Box(1, 1, 1)\n',
    'nested.py': 'import helper\nresult = helper.shape\n',
    'helper.py': 'from build123d import *\nimport bd_warehouse.thread\nshape = Box(1, 1, 1)\n',
    'ocp.py': 'from build123d import *\ntry:\n    from OCP.BRepAdaptor import BRepAdaptor_Surface\nexcept ImportError:\n    pass\nresult = Box(1, 1, 1)\n',
    'kernel.py': 'from cad_khana_does_not_exist import Assembly\n',
  });
  await assert.rejects(run(directory, 'numpy_user.py'), error => capability(
    /Python package 'numpy' is not available to wonky models \(imported at numpy_user\.py:3\)\. Policy:.*installed third-party packages are not importable/)(error)
    && error.line === 3);
  await assert.rejects(run(directory, 'nested.py'), error =>
    capability(/package 'bd_warehouse' .*imported at helper\.py:2/)(error) && error.line === 1);
  await assert.rejects(run(directory, 'ocp.py'), error => capability(/External geometry import 'OCP' is disabled/)(error) && error.line === 3);
  await assert.rejects(run(directory, 'kernel.py'), error =>
    capability(/package 'cad_khana_does_not_exist' is not available.*wonky-provided modules \([^)]*build123d[^)]*ocp_vscode/)(error) && error.line === 1);
});

test('result contract: result wins over assembly, assembly over captured outputs', async () => {
  const assemblyClass = [
    'class Assembly:',
    '    def __init__(self, parts):\n        self.parts = parts',
    '    def _wonky_parts(self):\n        return self.parts',
  ].join('\n');
  const directory = project({
    'both.py': `from build123d import *\n${assemblyClass}\nassembly = Assembly([("a", Box(1, 1, 1), None)])\nexport_step(Box(2, 2, 2), "x.step")\nresult = Box(3, 3, 3)\n`,
    'assembly.py': `from build123d import *\n${assemblyClass}\n`
      + 'assembly = Assembly([("base", Box(10, 10, 2), (1, 0, 0)), ("post", Pos(20, 0, 0) * Box(2, 2, 10), "#00ff0080")])\n'
      + 'export_step(Box(9, 9, 9), "ignored.step")\n',
  });
  // Exports are written relative to Python's working directory (test/python-exports.test.mjs).
  const both = await run(directory, 'both.py', { cwd: directory });
  assert.equal(both.source.result, 'result');
  assert.equal(both.source.ignoredCaptures, 1);
  assert.deepEqual(both.bodies.map(body => body.validation.volumeMm3), [27]);
  assert.equal(both.bodies[0].name, undefined, 'the result binding adds no name');

  const assembly = await run(directory, 'assembly.py', { cwd: directory });
  assert.equal(assembly.source.result, 'assembly');
  assert.deepEqual(assembly.bodies.map(({ name, appearance }) => ({ name, appearance })), [
    { name: 'base', appearance: { red: 1, green: 0, blue: 0 } },
    { name: 'post', appearance: { red: 0, green: 1, blue: 0, alpha: 128 / 255 } },
  ]);
  assert.deepEqual(assembly.source.outputs.map(output => [output.kind, output.name]), [['assembly', 'base'], ['assembly', 'post']]);
});

test('captured show/show_object/export calls become named bodies in call order without duplicates', async () => {
  const directory = project({
    'main.py': [
      'from build123d import *',
      'from ocp_vscode import show, show_object',
      'def build():\n    return Box(10, 10, 10)',
      'if __name__ == "__main__":',
      '    housing = build()',
      '    lid = Pos(0, 0, 20) * Box(10, 10, 2)',
      '    export_step(housing, "out/housing.step")',
      '    export_stl(housing, "out/housing.stl", tolerance=0.01)',
      '    show(housing, lid, names=["Housing", "Lid"], colors=[(0.5, 0.5, 0.5), None], reset_camera=True)',
      '    show_object(Pos(40, 0, 0) * Box(1, 1, 1), name="pin", options={"color": "#ff0000"})',
      '    show({"knob": Pos(60, 0, 0) * Cylinder(2, 4)})',
      '    import sys\n    sys.exit(0)',
    ].join('\n') + '\n',
    'out/.keep': '',
  });
  const model = await run(directory, 'main.py', { cwd: directory });
  assert.equal(model.source.result, 'capture');
  assert.deepEqual(model.bodies.map(body => body.name), ['housing', 'Lid', 'pin', 'knob']);
  assert.deepEqual(model.bodies.map(body => body.appearance ?? null),
    [null, null, { red: 1, green: 0, blue: 0 }, null]);
  const outputs = model.source.outputs.map(({ kind, name, path, written, bodyIds, location, ignoredOptions }) =>
    ({ kind, name, path, written, bodies: bodyIds.length, line: location.line, ignoredOptions }));
  assert.deepEqual(outputs, [
    { kind: 'export_step', name: 'housing', path: 'out/housing.step', written: true, bodies: 1, line: 8, ignoredOptions: undefined },
    { kind: 'export_stl', name: 'housing', path: 'out/housing.stl', written: true, bodies: 1, line: 9, ignoredOptions: undefined },
    { kind: 'show', name: 'Housing', path: undefined, written: undefined, bodies: 1, line: 10, ignoredOptions: ['reset_camera'] },
    { kind: 'show', name: 'Lid', path: undefined, written: undefined, bodies: 1, line: 10, ignoredOptions: ['reset_camera'] },
    { kind: 'show_object', name: 'pin', path: undefined, written: undefined, bodies: 1, line: 11, ignoredOptions: undefined },
    { kind: 'show', name: 'knob', path: undefined, written: undefined, bodies: 1, line: 12, ignoredOptions: undefined },
  ]);
  // The same body exported three times appears once, under its first name.
  assert.equal(new Set(model.source.outputs.slice(0, 3).map(output => output.bodyIds[0])).size, 1);
});

test('no result is an explicit error listing module-level bindings; several shapes are never guessed', async () => {
  const directory = project({
    'two.py': 'from __future__ import annotations\nfrom build123d import *\nimport math\nfrom pathlib import Path\nWIDTH = 4\nbase = Box(WIDTH, 1, 1)\nlid = Box(1, 1, 1)\ndef helper():\n    pass\n',
    'wrong.py': 'from build123d import *\nassembly = [Box(1, 1, 1)]\n',
    'exit.py': 'from build123d import *\nimport sys\nresult = Box(1, 1, 1)\nsys.exit(2)\n',
    'color.py': 'from ocp_vscode import show\nfrom build123d import *\nshow(Box(1, 1, 1), colors=[(2, 0, 0)])\n',
    'named.py': 'from ocp_vscode import show\nfrom build123d import *\nshow(Box(1, 1, 1), colors=["red"])\n',
    'viewer.py': 'from ocp_vscode import set_port\n',
  });
  await assert.rejects(run(directory, 'two.py'), error => error instanceof PythonExecutionError
    && /has no result: bind its final Shape to module-level 'result' or 'assembly', or pass it to show\(\), show_object\(\), export_step\(\) or export_stl\(\)\. Found at module level: WIDTH: int, base: Shape, lid: Shape, helper: function$/.test(error.message));
  await assert.rejects(run(directory, 'wrong.py'), /module-level 'assembly' must be a Bend Shape or an assembly, found list/);
  await assert.rejects(run(directory, 'exit.py'), /SystemExit: 2/);
  await assert.rejects(run(directory, 'color.py'), error => capability(/show\(\): color \(2, 0, 0\) is not supported/)(error) && error.line === 3);
  // A color name resolves through build123d Color (python/_wonky_color.py).
  assert.deepEqual((await run(directory, 'named.py')).bodies[0].appearance, { red: 1, green: 0, blue: 0, alpha: 1 });
  await assert.rejects(run(directory, 'viewer.py'), error => capability(/ocp_vscode\.set_port is not provided by wonky/)(error) && error.line === 1);
});

test('CLI builds a sibling-importing model, names captured exports and honors --no-project-path', () => {
  const directory = project({
    'params.py': 'WIDTH = 20\n',
    'part.py': 'from build123d import *\nfrom params import WIDTH\nexport_step(Box(WIDTH, 10, 5), "part.step")\n',
  });
  const cli = args => spawnSync(process.execPath, [join(root, 'bin/wonky-python.mjs'), join(directory, 'part.py'), '--python', python, ...args],
    { cwd: directory, encoding: 'utf8' });
  const prefix = join(directory, 'out', 'part');
  const built = cli(['--out', prefix]);
  assert.equal(built.status, 0, built.stderr);
  assert.match(built.stdout, /python\/1 "part": 8 vertices .* 1000 mm³/);
  assert.match(built.stdout, new RegExp(`export_step\\('part\\.step'\\) wrote ${join(directory, 'part.step')} \\(STEP, \\d+ bytes, sha256 ${sha256(join(directory, 'part.step'))}\\) ← python/1`));
  const model = JSON.parse(readFileSync(`${prefix}.brep.json`, 'utf8'));
  assert.deepEqual(model.source.modules.map(item => item.path), [join(directory, 'params.py')]);
  const isolated = cli(['--check', '--no-project-path']);
  assert.equal(isolated.status, 1);
  assert.match(isolated.stderr, /part\.py:2:1: Python package 'params' is not available/);
});

test('runtime capability errors carry the use-site column and name the project-module frame', async () => {
  const directory = project({
    'helpers.py': 'from ocp_vscode import show\n\ndef make():\n    show(1)\n',
    'main.py': 'from build123d import *\nimport helpers\nx = 1;  helpers.make()\n',
  });
  await assert.rejects(run(directory, 'main.py'), error => capability(/show\(\): int objects cannot be model outputs.* \(at helpers\.py:4:5\)$/)(error)
    && error.line === 3 && error.column === 9 && error.useSite?.line === 4 && error.useSite.column === 5);
});

// Fix round (verifier defects of 2026-09-23). An installation record written by
// pip/uv (`<dist>.dist-info/RECORD`, `<egg>.egg-info/installed-files.txt`)
// marks installed packages outside site-packages too: `pip install --target
// .deps`, uv's archive cache. Corpus: cad-project-039/.../design_wall.py
// appends '.deps' to sys.path and imports ezdxf and numpy from there.
test('installed packages in a --target or cache directory the model adds to sys.path stay unavailable', async () => {
  const record = files => files.map(file => `${file},sha256=AAAA,1`).join('\n') + '\n';
  const directory = project({
    '.deps/vendored.py': 'SIZE = 2\n',
    '.deps/vendored-1.0.dist-info/RECORD': record(['vendored.py', 'vendored-1.0.dist-info/RECORD']),
    '.deps/pkg/__init__.py': 'from .inner import SIZE\n',
    '.deps/pkg/inner.py': 'SIZE = 3\n',
    '.deps/pkg-2.0.dist-info/RECORD': record(['pkg/__init__.py', 'pkg/inner.py']),
    'cache/archive-v0/abc123/cached_egg/__init__.py': 'SIZE = 4\n',
    'cache/archive-v0/abc123/cached_egg-1.0.egg-info/installed-files.txt': '../cached_egg/__init__.py\n',
    // An editable checkout's own egg-info lists no installed files: still project code.
    'editable/src_mod.py': 'SIZE = 5\n',
    'editable/src_mod.egg-info/SOURCES.txt': 'src_mod.py\n',
    'module.py': [
      'import sys, os',
      'here = os.path.dirname(__file__)',
      'sys.path.append(os.path.join(here, ".deps"))',
      'sys.path.append(os.path.join(here, "cache", "archive-v0", "abc123"))',
      'sys.path.append(os.path.join(here, "editable"))',
      'from build123d import *',
      'import src_mod',
      'import vendored',
      'result = Box(1, 1, vendored.SIZE)',
    ].join('\n') + '\n',
  });
  const source = readFileSync(join(directory, 'module.py'), 'utf8');
  await assert.rejects(run(directory, 'module.py'), error =>
    capability(/Python package 'vendored' resolves to an installed package at .*\/\.deps\/vendored\.py \(imported at module\.py:8\)\. Policy: installed third-party packages are not importable, also not from a site-packages .*, --target or cache directory .*recognized by its installation record .*vendored-1\.0\.dist-info\/RECORD/)(error)
    && error.line === 8 && error.sourceFiles.map(item => item.module).join() === 'src_mod');
  for (const [statement, name, line] of [['import pkg.inner', 'pkg', 8], ['from cached_egg import SIZE', 'cached_egg', 8]]) {
    writeFileSync(join(directory, 'variant.py'), source.replace('import vendored', statement));
    await assert.rejects(run(directory, 'variant.py'), error =>
      capability(new RegExp(`Python package '${name}' resolves to an installed package .*recognized by its installation record`))(error)
      && error.line === line);
  }
  // Loading an installed file by path is refused like importing it.
  writeFileSync(join(directory, 'by_path.py'), [
    'import importlib.util, os',
    'path = os.path.join(os.path.dirname(__file__), ".deps", "vendored.py")',
    'spec = importlib.util.spec_from_file_location("vendored", path)',
    'module = importlib.util.module_from_spec(spec)',
    'spec.loader.exec_module(module)',
  ].join('\n') + '\n');
  await assert.rejects(run(directory, 'by_path.py'), error =>
    capability(/Python package 'vendored' resolves to an installed package .*recognized by its installation record/)(error) && error.line === 5);
});

test('files loaded by path are recorded with SHA-256, and so is the executed model text', async () => {
  // Corpus: cad-project-041/.../endstop_print_fix.py loads a sibling with spec.loader.exec_module.
  const directory = project({
    'helper_a.py': 'SIZE = 3\n',
    'lib/helper_b.py': 'SIZE = 4\n',
    'helper_c.py': 'SIZE = 5\n',
    'helper_d.py': 'SIZE = 6\n',
    'model.py': [
      'import importlib.util, os, runpy',
      'import helper_a',
      'here = os.path.dirname(__file__)',
      'spec = importlib.util.spec_from_file_location("helper_b", os.path.join(here, "lib", "helper_b.py"))',
      'helper_b = importlib.util.module_from_spec(spec)',
      'spec.loader.exec_module(helper_b)',
      'ns = runpy.run_path(os.path.join(here, "helper_c.py"))',
      'exec(open(os.path.join(here, "helper_d.py")).read())',
      'from build123d import Box',
      'result = Box(helper_a.SIZE, helper_b.SIZE, ns["SIZE"] + SIZE)',
    ].join('\n') + '\n',
  });
  const model = await run(directory, 'model.py');
  assert.ok(Math.abs(model.bodies[0].validation.volumeMm3 - 132) < 1e-9);
  const entry = (module, file, extra = {}) => ({ module, path: join(directory, file), sha256: sha256(join(directory, file)), ...extra });
  assert.deepEqual(model.source.modules, [
    entry('helper_a', 'helper_a.py'),
    entry('helper_b', 'lib/helper_b.py', { loader: 'exec' }),
    entry('<run_path>', 'helper_c.py', { loader: 'exec' }),
    entry(null, 'helper_d.py', { loader: 'open' }),
  ]);
  assert.equal(model.source.sha256, sha256(join(directory, 'model.py')));
  writeFileSync(join(directory, 'broken.py'), 'import runpy, os\nrunpy.run_path(os.path.join(os.path.dirname(__file__), "helper_c.py"))\nraise ValueError("late")\n');
  await assert.rejects(run(directory, 'broken.py'), error => error instanceof PythonExecutionError
    && error.sourceSha256 === sha256(join(directory, 'broken.py'))
    && error.sourceFiles.some(item => item.path === join(directory, 'helper_c.py') && item.loader === 'exec'));
});

test('project modules named like standard-library modules the runner preloads win, as under python model.py', async () => {
  const directory = project({
    'json.py': 'SIZE = 7\n',
    'colorsys.py': 'SIZE = 8\n',
    'os.py': 'SIZE = 100\n',  // frozen and loaded at startup: the standard library wins in plain Python too
    'later/textwrap.py': 'SIZE = 2\n',
    'model.py': [
      'import json, colorsys, os, sys',
      'sys.path.insert(0, os.path.join(os.path.dirname(__file__), "later"))',
      'import textwrap',
      'from build123d import Box',
      'print(getattr(json, "SIZE", 1), getattr(colorsys, "SIZE", 1), getattr(os, "SIZE", 1), getattr(textwrap, "SIZE", 1))',
      'result = Box(getattr(json, "SIZE", 1), getattr(colorsys, "SIZE", 1), getattr(textwrap, "SIZE", 1) * getattr(os, "SIZE", 1))',
    ].join('\n') + '\n',
  });
  // Plain CPython in the same directory (build123d aside) picks the same modules.
  const lines = readFileSync(join(directory, 'model.py'), 'utf8').split('\n');
  writeFileSync(join(directory, 'plain.py'), [...lines.slice(0, 3), lines[4]].join('\n') + '\n');
  const plain = spawnSync(python, ['-B', join(directory, 'plain.py')], { cwd: directory, encoding: 'utf8' });
  assert.equal(plain.status, 0, plain.stderr);
  assert.equal(plain.stdout.trim(), '7 8 1 2');
  const model = await run(directory, 'model.py');
  assert.equal(model.execution.stdout.trim(), '7 8 1 2');
  assert.ok(Math.abs(model.bodies[0].validation.volumeMm3 - 112) < 1e-9);
  assert.deepEqual(model.source.modules.map(item => [item.module, item.path, item.sha256, /\/json\/__init__\.py$|\/colorsys\.py$|\/textwrap\.py$/.test(item.shadows)]), [
    ['json', join(directory, 'json.py'), sha256(join(directory, 'json.py')), true],
    ['colorsys', join(directory, 'colorsys.py'), sha256(join(directory, 'colorsys.py')), true],
    ['textwrap', join(directory, 'later/textwrap.py'), sha256(join(directory, 'later/textwrap.py')), true],
  ]);
});

test("the interpreter's own lib/pythonX.Y/site-packages stays closed when the model appends it", async t => {
  // Verifier defect (fix round): that directory lies below the standard library
  // (lib/python3.13), so a prefix check let pip & co. load unrecorded.
  const probe = spawnSync(python, ['-I', '-S', '-c', [
    'import os',
    'site = os.path.join(os.path.dirname(os.__file__), "site-packages")',
    'names = sorted(os.listdir(site)) if os.path.isdir(site) else []',
    'print(next((n for n in names if n.isidentifier() and os.path.isfile(os.path.join(site, n, "__init__.py"))), ""))',
  ].join('\n')], { encoding: 'utf8' });
  const name = probe.stdout.trim();
  if (!name) return t.skip('the test interpreter has no package in its own site-packages');
  const directory = project({
    'model.py': [
      'import os, sys',
      'sys.path.append(os.path.join(os.path.dirname(os.__file__), "site-packages"))',
      'from build123d import Box',
      `import ${name}`,
      'result = Box(1, 1, 1)',
    ].join('\n') + '\n',
  });
  await assert.rejects(run(directory, 'model.py'), error =>
    capability(new RegExp(`Python package '${name}' resolves to an installed package at .*/lib/python3\\.\\d+/site-packages/${name}/__init__\\.py \\(imported at model\\.py:4\\)\\. Policy: installed third-party packages are not importable, also not from a site-packages \\(including the interpreter's own\\)`))(error)
    && error.line === 4 && error.sourceFiles.length === 0);
});

test('project modules run the hashed source, never a stale or unchecked-hash __pycache__ .pyc', async () => {
  // Verifier defect (fix round): -B only stops writing bytecode; CPython still
  // executed a matching-timestamp or unchecked-hash .pyc while the provenance
  // hashed the edited .py.
  const directory = project({
    'unchecked.py': 'K = 7\n',
    'stamped.py': 'K = 5\n',
    'bypath.py': 'K = 9\n',
    'model.py': [
      'import importlib.util, os',
      'import unchecked, stamped',
      'spec = importlib.util.spec_from_file_location("bypath", os.path.join(os.path.dirname(__file__), "bypath.py"))',
      'bypath = importlib.util.module_from_spec(spec)',
      'spec.loader.exec_module(bypath)',
      'from build123d import Box',
      'result = Box(unchecked.K, stamped.K, bypath.K)',
    ].join('\n') + '\n',
  });
  const compiled = spawnSync(python, ['-c', [
    'import py_compile',
    'for name in ("unchecked", "bypath"):',
    '    py_compile.compile(name + ".py", doraise=True, invalidation_mode=py_compile.PycInvalidationMode.UNCHECKED_HASH)',
    'py_compile.compile("stamped.py", doraise=True, invalidation_mode=py_compile.PycInvalidationMode.TIMESTAMP)',
  ].join('\n')], { cwd: directory, encoding: 'utf8' });
  assert.equal(compiled.status, 0, compiled.stderr);
  // Same-size edits; stamped.py keeps its mtime (an edit within the same second).
  const stamp = statSync(join(directory, 'stamped.py'));
  writeFileSync(join(directory, 'unchecked.py'), 'K = 2\n');
  writeFileSync(join(directory, 'stamped.py'), 'K = 3\n');
  utimesSync(join(directory, 'stamped.py'), stamp.atime, stamp.mtime);
  writeFileSync(join(directory, 'bypath.py'), 'K = 4\n');
  const model = await run(directory, 'model.py');
  assert.ok(Math.abs(model.bodies[0].validation.volumeMm3 - 2 * 3 * 4) < 1e-9, `volume ${model.bodies[0].validation.volumeMm3}`);
  const entry = (module, file, extra = {}) => ({ module, path: join(directory, file), sha256: sha256(join(directory, file)), ...extra });
  assert.deepEqual(model.source.modules, [
    entry('unchecked', 'unchecked.py'),
    entry('stamped', 'stamped.py'),
    entry('bypath', 'bypath.py', { loader: 'exec' }),
  ]);
});

}
