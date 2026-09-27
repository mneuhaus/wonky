import test from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missingBend();
if (publicTreeSkip) {
  test("python-shape-protocol.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { chmodSync, mkdtempSync, realpathSync, rmSync, writeFileSync } = await import("node:fs");
const { tmpdir } = await import("node:os");
const { join } = await import("node:path");
const { buildPython } = await import("../src/python.mjs");
const { UnsupportedFeatureError } = await import("../src/errors.mjs");
// build123d 0.13 Shape and Pos protocol in the shim (W5 fix round): bool(),
// len(), iteration, equality, hashing and printing either match build123d or
// raise a use-site capability error; they never silently differ.
// Expected values were produced by build123d 0.13.0 itself
// (`uv run --no-project --with build123d==0.13.0 python -B <model>`, 2026-09-23).
// Python runs through `uv run`, never a bare python3.








const workspace = realpathSync(mkdtempSync(join(tmpdir(), 'wonky-python-protocol-')));
const python = join(workspace, 'uv-python');
writeFileSync(python, '#!/bin/sh\nexec uv run --no-project --quiet python "$@"\n');
chmodSync(python, 0o755);
test.after(() => rmSync(workspace, { recursive: true, force: true }));
const build = source => buildPython(source, { python, timeoutMs: 120000 });

test('an empty Boolean result is falsy and the solid count drives len() and iteration, as in build123d', async () => {
  // Verifier defect: `if a & b:` took the overlap branch for disjoint boxes.
  const model = await build([
    'from build123d import *',
    'a = Box(1, 1, 1)',
    'c = Pos(10, 0, 0) * Box(1, 1, 1)',
    'x = a & c',
    'both = a + c',
    'got = {',
    '    "bool": [bool(a), bool(x)], "branch": "overlap" if x else "no overlap",',
    '    "len": [len(a), len(x), len(both)],',
    '    "iter": [round(p.volume, 6) for p in both],',
    '    "eq": [a == a, a == Box(1, 1, 1), __import__("copy").copy(a) == a, a in [a], c in [a]],',
    '    "placed": [len([Pos(1, 0, 0), Pos(2, 0, 0)] * a), len(Pos(1, 0, 0) * [a, c])],',
    '}',
    'expected = {',
    '    "bool": [True, False], "branch": "no overlap",',
    '    "len": [1, 0, 2],',
    '    "iter": [1.0, 1.0],',
    '    "eq": [True, False, True, True, False],',
    '    "placed": [2, 2],',
    '}',
    'assert got == expected, got',
    'alias = a',
    'a += c  # Part.__iadd__ is self + other: the alias keeps the single box',
    'assert (len(alias), len(a), alias is a) == (1, 2, False)',
    'try:',
    '    2 * a',
    '    raise AssertionError("2 * shape must fail")',
    'except TypeError as error:',
    '    assert str(error) == "Compound cannot be multiplied by int", error  # a two-solid sum is a Compound (build123d 0.13)',
    'result = alias',
  ].join('\n') + '\n');
  assert.equal(model.bodies.length, 1);
  assert.ok(Math.abs(model.bodies[0].validation.volumeMm3 - 1) < 1e-9);
});

test('Pos compares, hashes, powers and prints like a build123d Location', async () => {
  // Verifier defect: Pos(1, 2, 3) == Pos(1, 2, 3) was silently False.
  const model = await build([
    'from build123d import *',
    'rows = []',
    'for v in [Pos(1, 2, 3), Pos(1.5, -2, 1e-7), Pos(0.1 + 0.2, 1 / 3, -0.0), Pos(1, 2) * Pos(3, 4, 5), Pos(1, 2, 3) ** -1]:',
    '    rows.append([repr(v), str(v), format(v), f"{v:.2f}"])',
    'got = {',
    '    "eq": [Pos(1, 2, 3) == Pos(1, 2, 3), Pos(1, 2, 3) == Pos(1, 2, 3.000001), Pos(1, 2, 3) == Pos(1, 2, 3.00001),',
    '           Pos(1, 2, 3) == (1, 2, 3), Pos(0, 0, 0) == Pos(0, 0, -0.0)],',
    '    "hash": [hash(Pos(1, 2, 3)) == hash(((1.0, 2.0, 3.0), (0.0, 0.0, 0.0, 1.0))), len({Pos(1, 2, 3), Pos(1, 2, 3)})],',
    '    "rows": rows,',
    '}',
    'expected = {',
    '    "eq": [True, True, False, False, True],',
    '    "hash": [True, 1],',
    '    "rows": [',
    '        ["Pos((1, 2, 3), (0, 0, 0))", "Pos: (position=(1, 2, 3), orientation=(0, 0, 0))",',
    '         "((1.0, 2.0, 3.0), (-0.0, 0.0, -0.0))", "((1.00, 2.00, 3.00), (0.00, 0.00, 0.00))"],',
    '        ["Pos((1.5, -2, 0), (0, 0, 0))", "Pos: (position=(1.5, -2, 0), orientation=(0, 0, 0))",',
    '         "((1.5, -2.0, 1e-07), (-0.0, 0.0, -0.0))", "((1.50, -2.00, 0.00), (0.00, 0.00, 0.00))"],',
    '        ["Pos((0.3, 0.333333, 0), (0, 0, 0))", "Pos: (position=(0.3, 0.333333, 0), orientation=(0, 0, 0))",',
    '         "((0.30000000000000004, 0.3333333333333333, -0.0), (-0.0, 0.0, -0.0))", "((0.30, 0.33, 0.00), (0.00, 0.00, 0.00))"],',
    '        ["Location((4, 6, 5), (0, 0, 0))", "Location: (position=(4, 6, 5), orientation=(0, 0, 0))",',
    '         "((4.0, 6.0, 5.0), (-0.0, 0.0, -0.0))", "((4.00, 6.00, 5.00), (0.00, 0.00, 0.00))"],',
    '        ["Location((-1, -2, -3), (0, 0, 0))", "Location: (position=(-1, -2, -3), orientation=(0, 0, 0))",',
    '         "((-1.0, -2.0, -3.0), (-0.0, 0.0, -0.0))", "((-1.00, -2.00, -3.00), (0.00, 0.00, 0.00))"],',
    '    ],',
    '}',
    'assert got == expected, got',
    '# A composed or powered Pos is a plain Location, not a Pos, as in build123d (W5 low finding).',
    'assert [isinstance(Pos(1, 0, 0) * Pos(0, 1, 0), Pos), isinstance(Pos(1, 0, 0) ** 2, Pos)] == [False, False]',
    'assert isinstance(Pos(1, 0, 0) * Pos(0, 1, 0), Location) and isinstance(Pos(1, 0, 0), Location)',
    'result = Box(1, 1, 1)',
  ].join('\n') + '\n');
  assert.equal(model.bodies.length, 1);
});

test('the rest of the Shape and Pos protocol is a capability error at its use site, even when caught', async () => {
  const cases = [
    ['copy.deepcopy(a)', /copy\.deepcopy\(\) of a Shape is not implemented/],
    ['-Pos(1, 2, 3)', /-Pos flips the orientation/],
    ['list(Pos(1, 2, 3))', /Iterating a Pos yields build123d Vectors/],
    ['Pos(1, 0, 0) & a', /Location & \.\.\. \(intersect\) is not implemented/],
    ['Pos(1, 2, 3) ** 0.5', /Pos \*\* exponent supports only integer exponents/],
  ];
  for (const [expression, pattern] of cases) {
    const source = [
      'import copy',
      'from build123d import *',
      'a = Box(1, 1, 1)',
      'try:',
      `    value = ${expression}`,
      'except BaseException:',
      '    pass',
      'result = a',
    ].join('\n') + '\n';
    await assert.rejects(build(source), error => {
      assert.ok(error instanceof UnsupportedFeatureError, `${expression}: ${error.name}: ${error.message}`);
      assert.match(error.message, pattern);
      assert.equal(error.line, 5, expression);
      return true;
    });
  }
});

}
