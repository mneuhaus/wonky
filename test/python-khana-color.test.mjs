import test from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missingBend();
if (publicTreeSkip) {
  test("python-khana-color.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { chmodSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } = await import("node:fs");
const { tmpdir } = await import("node:os");
const { join } = await import("node:path");
const { fileURLToPath } = await import("node:url");
const { buildPython } = await import("../src/python.mjs");
const { UnsupportedFeatureError } = await import("../src/errors.mjs");
// build123d 0.13.0 Color without OpenCascade (python/_wonky_color.py), the
// color type of every cad_khana with_part(..., color=Color(...)) in the corpus.
// The oracle (fixtures/python-color/) was frozen from the real build123d by
// scripts/python/build123d-colors.py; the shim must reproduce tuple(), repr(),
// exact-name str() and errors bit for bit. Python runs through `uv run`.









const workspace = realpathSync(mkdtempSync(join(tmpdir(), 'wonky-python-khana-color-')));
const python = join(workspace, 'uv-python');
writeFileSync(python, '#!/bin/sh\nexec uv run --no-project --quiet python "$@"\n');
chmodSync(python, 0o755);
test.after(() => rmSync(workspace, { recursive: true, force: true }));

const oraclePath = fileURLToPath(new URL('../fixtures/python-color/build123d-color-oracle.json', import.meta.url));
const fixture = path => fileURLToPath(new URL(`../fixtures/corpus-repro/py-khana/${path}`, import.meta.url));
const run = source => buildPython(source, { python });
const lastJson = model => JSON.parse(model.execution.stdout.trim().split('\n').at(-1));

// build123d.Color is python/_wonky_color.py's class, bound by the shim.
const LOAD = `
from build123d import Box, Color
`;

test('Color matches the frozen build123d 0.13.0 oracle on every case', async () => {
  const oracle = JSON.parse(readFileSync(oraclePath, 'utf8'));
  assert.equal(oracle.provenance.build123d, '0.13.0');
  const groups = new Set(oracle.cases.map(entry => entry.group));
  assert.deepEqual([...groups], ['corpus', 'edge', 'names', 'sweep', 'categorical']);
  const model = await run(`${LOAD}
import json
oracle = json.load(open(${JSON.stringify(oraclePath)}, encoding="utf-8"))
# build123d raises OCP's Standard_Failure("Color out"); wonky raises ValueError("Color out").
ERRORS = {"Standard_Failure": "ValueError"}
bad = []

def compare(color, expected):
    got = {"tuple": [repr(v) for v in tuple(color)], "repr": repr(color)}
    if "str" in expected:
        got["str"] = str(color)
    return [key for key in got if got[key] != expected[key]]

for case in oracle["cases"]:
    try:
        value = eval(case["expr"], {"Color": Color})
    except Exception as error:
        want = case.get("error")
        if want is None or [ERRORS.get(want[0], want[0]), want[1]] != [type(error).__name__, str(error)]:
            bad.append([case["expr"], type(error).__name__, str(error)])
        continue
    if "error" in case:
        bad.append([case["expr"], "expected", case["error"]])
        continue
    expected = case["colors"] if "colors" in case else [case]
    values = value if "colors" in case else [value]
    if len(values) != len(expected):
        bad.append([case["expr"], "count", len(values)])
        continue
    for color, want in zip(values, expected):
        if type(color).__name__ != "Color" or compare(color, want):
            bad.append([case["expr"], compare(color, want)])
print(json.dumps({"cases": len(oracle["cases"]), "bad": bad[:20]}))
result = Box(1, 1, 1)
`);
  const { cases, bad } = lastJson(model);
  assert.equal(cases, oracle.cases.length);
  assert.ok(cases >= 2000, `oracle has ${cases} cases`);
  assert.deepEqual(bad, []);
});

test('a Color on a cad_khana part becomes the body appearance, with its alpha', async () => {
  const model = await run(`${LOAD}
from build123d import Pos
from cad_khana.mechanism.assembly import Assembly
assembly = (Assembly()
    .with_part("hex", Box(2, 2, 2), color=Color(0x4A6E8A))
    .with_part("floats", Box(2, 2, 2), location=Pos(5, 0, 0), color=Color(0.85, 0.55, 0.1))
    .with_part("named", Box(2, 2, 2), location=Pos(10, 0, 0), color=Color("olivedrab", 0.5))
    .with_part("string", Box(2, 2, 2), location=Pos(15, 0, 0), color=Color("#dfb74580")))
`);
  assert.deepEqual(model.bodies.map(body => [body.name, body.appearance]), [
    ['hex', { red: 0.2901961, green: 0.4313726, blue: 0.5411765, alpha: 1 }],
    ['floats', { red: 0.85, green: 0.55, blue: 0.1, alpha: 1 }],
    ['named', { red: 0.4196078, green: 0.5568628, blue: 0.1372549, alpha: 0.5 }],
    ['string', { red: 0.8745098, green: 0.7176471, blue: 0.2705882, alpha: 0.5019608 }],
  ]);
});

test('Color.wrapped and str() without a CSS3 name are capability errors at their use site', async () => {
  const capability = (pattern, line) => error => {
    assert.ok(error instanceof UnsupportedFeatureError, `${error.name}: ${error.message}`);
    assert.match(error.message, pattern);
    assert.equal(error.line, line);
    return true;
  };
  const lines = LOAD.split('\n').length;
  await assert.rejects(run(`${LOAD}c = Color("red")\ntry:\n    c.wrapped\nexcept Exception:\n    pass\nresult = Box(1, 1, 1)\n`),
    capability(/build123d\.Color\.wrapped is an OCP Quantity_ColorRGBA/, lines + 2));
  const named = await run(`${LOAD}print(str(Color("red")))\nresult = Box(1, 1, 1)\n`);
  assert.equal(named.execution.stdout.trim(), "Color: (1.0, 0.0, 0.0, 1.0) is 'RED'");
  await assert.rejects(run(`${LOAD}print(Color(0.1, 0.2, 0.3))\nresult = Box(1, 1, 1)\n`),
    capability(/str\(\) of build123d\.Color\(0\.1, 0\.2, 0\.3, 1\.0\) names the nearest OCCT color/, lines));
});

test('the shim binds build123d.Color everywhere and the corpus-color repro builds', async () => {
  const path = fixture('corpus-color/assembly.py');
  const model = await buildPython(readFileSync(path, 'utf8'), { filename: path, python });
  assert.deepEqual(model.bodies.map(body => [body.name, body.appearance]),
    [['hood', { red: 0.2901961, green: 0.4313726, blue: 0.5411765, alpha: 1 }]]);
  const probe = await run('from build123d import Color\nfrom build123d.geometry import Color as G\n'
    + 'print(Color is G, Color.__module__, repr(Color(0xDDAA33)))\nfrom build123d import Box\nresult = Box(1, 1, 1)\n');
  assert.equal(probe.execution.stdout.trim(), 'True build123d.geometry Color(0.8666667, 0.6666667, 0.2, 1.0)');
  const shown = await run('from build123d import Box, Color\nfrom ocp_vscode import show\n'
    + 'show(Box(1, 1, 1), names=["b"], colors=[Color("#dfb745", 0.5)])\n');
  assert.deepEqual(shown.bodies.map(body => [body.name, body.appearance]),
    [['b', { red: 0.8745098, green: 0.7176471, blue: 0.2705882, alpha: 0.4980392 }]]);
});

}
