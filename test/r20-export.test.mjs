import test from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missingBend();
if (publicTreeSkip) {
  test("r20-export.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { spawnSync } = await import("node:child_process");
const { createHash } = await import("node:crypto");
const { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } = await import("node:fs");
const { homedir, tmpdir } = await import("node:os");
const { join } = await import("node:path");
const { fileURLToPath } = await import("node:url");
const { loadKernel } = await import("../src/kernel.mjs");
const { revolveInBend } = await import("../src/analytic.mjs");
const { printMesh, meshDefects } = await import("../src/print-mesh.mjs");
const { R20ExportError, packStl, partKey, partKeys, r20ErrorRecord } = await import("../src/r20-export.mjs");
const { FeatureScriptError, UnsupportedFeatureError } = await import("../src/errors.mjs");
const { readR20Export, readStl, measure, hausdorff } = await import("../scripts/r20/mesh.mjs");
// The R20 check export (`--format r20-check`, src/r20-export.mjs) and the
// print-mesh defect it exposed (X06: rims with opposite normals). The export
// is read back by readR20Export (scripts/r20/mesh.mjs), which mirrors cad-31's
// checks/meshes.py.















const root = fileURLToPath(new URL('../', import.meta.url));
const kernel = await loadKernel();
const cli = (args, options = {}) => spawnSync(process.execPath, ['bin/wonky.mjs', ...args], { cwd: root, encoding: 'utf8', ...options });
const scratch = prefix => mkdtempSync(join(tmpdir(), prefix));
const sha256 = data => createHash('sha256').update(data).digest('hex');

// examples/bracket.fs with a part NAME: the export keys parts by NAME, and the
// example itself has none (that refusal is tested below).
const bracket = readFileSync(join(root, 'examples/bracket.fs'), 'utf8');
const named = (...names) => bracket.replace('        });\n    }, {', `        });\n${names.map(name =>
  `        setProperty(context, { "entities" : qCreatedBy(id + "extrusion", EntityType.BODY), "propertyType" : PropertyType.NAME, "value" : ${JSON.stringify(name)} });\n`).join('')}    }, {`);

// Two named plates, for the duplicate-key refusal.
const twoPlates = (first, second) => `FeatureScript 3044;
import(path : "onshape/std/geometry.fs", version : "3044.0");
export function plates(context is Context, id is Id, definition is map)
{
    for (var i = 0; i < 2; i += 1)
    {
        var s = newSketchOnPlane(context, id + ("s" ~ i), { "sketchPlane" : plane(vector(0, 0, 20 * i) * millimeter, vector(0, 0, 1)) });
        skRectangle(s, "r", { "firstCorner" : vector(0, 0) * millimeter, "secondCorner" : vector(10, 5) * millimeter });
        skSolve(s);
        opExtrude(context, id + ("e" ~ i), { "entities" : qSketchRegion(id + ("s" ~ i)), "direction" : vector(0, 0, 1),
            "endBound" : BoundingType.BLIND, "endDepth" : 2 * millimeter });
    }
    setProperty(context, { "entities" : qCreatedBy(id + "e0", EntityType.BODY), "propertyType" : PropertyType.NAME, "value" : ${JSON.stringify(first)} });
    setProperty(context, { "entities" : qCreatedBy(id + "e1", EntityType.BODY), "propertyType" : PropertyType.NAME, "value" : ${JSON.stringify(second)} });
}`;

test('the r20 check export of a named bracket reads back without a problem', () => {
  const dir = scratch('wonky-r20-');
  try {
    const source = join(dir, 'bracket.fs'), out = join(dir, 'r20');
    writeFileSync(source, named('B01 Wonky bracket'));
    const result = cli([source, '--format', 'r20-check', '--deviation', '0.01', '--out', out]);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(readdirSync(out).sort(), ['B01.stl', 'tessellate-manifest.json']);
    const read = readR20Export(out, { wonky: true });
    assert.deepEqual(read.problems, []);
    const { manifest } = read, row = manifest.parts.B01;
    assert.equal(manifest.schema, 'r20/tessellate-manifest/v1');
    assert.equal(manifest.part_studio, `wonky:${source}#bracket`);
    assert.match(manifest.fingerprint, /^[0-9a-f]{64}$/);
    assert.equal(row.name, 'B01 Wonky bracket');
    assert.equal(row.part_id, 'model/extrusion');
    assert.equal(row.description, null);
    // A planar prism: exact volume, and the mesh is its own facets.
    assert.equal(row.wonky.volumeMm3, 8832);
    assert.equal(row.wonky.exact, true);
    assert.equal(row.wonky.approximation, null);
    assert.equal(row.wonky.deviationMm, 0.01);
    assert.equal(row.wonky.meshDeviationMm, 0);
    assert.ok(row.wonky.float32RoundingMm >= 0 && row.wonky.float32RoundingMm < 1e-12);
    assert.equal(row.wonky.achievedDeviationMm, row.wonky.float32RoundingMm);
    assert.ok(Math.abs(read.parts.B01.measure.volumeMm3 - 8832) < 1e-6);
    assert.deepEqual(read.parts.B01.measure.bbox, [[0, 0, 0], [50, 40, 8]]);

    // Deterministic: the same build writes the same bytes and fingerprint; a
    // parameter changes the fingerprint.
    const again = cli([source, '--format', 'r20-check', '--deviation', '0.01', '--out', join(dir, 'again')]);
    assert.equal(again.status, 0, again.stderr);
    const second = JSON.parse(readFileSync(join(dir, 'again', 'tessellate-manifest.json'), 'utf8'));
    assert.equal(second.fingerprint, manifest.fingerprint);
    assert.equal(second.parts.B01.sha256, row.sha256);
    const thicker = cli([source, '--format', 'r20-check', '--deviation', '0.01', '--param', 'thickness=12*millimeter', '--out', join(dir, 'thick')]);
    assert.equal(thicker.status, 0, thicker.stderr);
    assert.notEqual(JSON.parse(readFileSync(join(dir, 'thick', 'tessellate-manifest.json'), 'utf8')).fingerprint, manifest.fingerprint);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a curved part exports watertight at the stated deviation', () => {
  const dir = scratch('wonky-r20-curved-');
  try {
    const source = join(dir, 'spacer.fs'), out = join(dir, 'r20');
    // bored-spacer.fs has no NAME either; name the body it makes.
    const text = readFileSync(join(root, 'examples/bored-spacer.fs'), 'utf8'), last = text.lastIndexOf('}');
    writeFileSync(source, `${text.slice(0, last)}    setProperty(context, { "entities" : qCreatedBy(id + "stock", EntityType.BODY), "propertyType" : PropertyType.NAME, "value" : "S01 spacer" });\n${text.slice(last)}`);
    const result = cli([source, '--format', 'r20-check', '--deviation', '0.01', '--out', out]);
    assert.equal(result.status, 0, result.stderr);
    const read = readR20Export(out, { wonky: true });
    assert.deepEqual(read.problems, []);
    const row = read.manifest.parts.S01;
    assert.ok(row.wonky.meshDeviationMm > 0 && row.wonky.meshDeviationMm <= 0.01);
    assert.ok(row.wonky.float32RoundingMm >= 0 && row.wonky.float32RoundingMm < 1e-5);
    const sum = row.wonky.meshDeviationMm + row.wonky.float32RoundingMm;
    assert.ok(row.wonky.achievedDeviationMm >= sum);
    // Binary64 addition rounds to nearest; outward addition needs at most the
    // next representable value. In binade [2^e, 2^(e+1)), one ULP is 2^(e-52).
    const ulp = 2 ** (Math.floor(Math.log2(sum)) - 52);
    assert.ok(row.wonky.achievedDeviationMm <= sum + ulp, 'stored deviation is not overstated beyond one outward ULP');
    // Inscribed chords: the mesh is inside the exact solid, by less than area x deviation.
    const mesh = read.parts.S01.measure;
    assert.ok(mesh.volumeMm3 < row.wonky.volumeMm3);
    assert.ok(row.wonky.volumeMm3 - mesh.volumeMm3 < mesh.areaMm2 * 0.01);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a part without a NAME is refused, error.json says why and nothing else is left', () => {
  const dir = scratch('wonky-r20-unnamed-');
  try {
    const out = join(dir, 'r20'), source = join(dir, 'bracket.fs');
    // A complete earlier export in the same directory must not survive a
    // failed run, or a reader would take it for the current one.
    writeFileSync(source, named('B01 Wonky bracket'));
    assert.equal(cli([source, '--format', 'r20-check', '--deviation', '0.01', '--out', out]).status, 0);
    writeFileSync(join(out, 'keep.txt'), 'not ours');
    const result = cli(['examples/bracket.fs', '--format', 'r20-check', '--deviation', '0.01', '--out', out]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /has no NAME/);
    assert.deepEqual(readdirSync(out).sort(), ['error.json', 'keep.txt']);
    const error = JSON.parse(readFileSync(join(out, 'error.json'), 'utf8'));
    assert.deepEqual(Object.keys(error), ['class', 'message', 'file', 'line', 'column']);
    assert.equal(error.class, 'R20ExportError');
    assert.match(error.message, /body model\/extrusion has no NAME/);
    assert.equal(error.file, join(root, 'examples/bracket.fs'));
    assert.throws(() => readR20Export(out, { wonky: true }), /manifest missing/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a duplicate key (case-insensitive) is refused before anything is meshed', () => {
  const dir = scratch('wonky-r20-dup-');
  try {
    const source = join(dir, 'plates.fs'), out = join(dir, 'r20');
    writeFileSync(source, twoPlates('P01 lower plate', 'p01 upper plate'));
    const result = cli([source, '--format', 'r20-check', '--deviation', '0.01', '--out', out]);
    assert.equal(result.status, 1);
    assert.deepEqual(readdirSync(out), ['error.json']);
    const error = JSON.parse(readFileSync(join(out, 'error.json'), 'utf8'));
    assert.equal(error.class, 'R20ExportError');
    assert.match(error.message, /duplicate part key p01 \(case-insensitive\)/);
    // Distinct keys build both parts.
    writeFileSync(source, twoPlates('P01 lower plate', 'P02 upper plate'));
    const ok = cli([source, '--format', 'r20-check', '--deviation', '0.01', '--out', out]);
    assert.equal(ok.status, 0, ok.stderr);
    const read = readR20Export(out, { wonky: true });
    assert.deepEqual(read.problems, []);
    assert.deepEqual(Object.keys(read.parts).sort(), ['P01', 'P02']);
    assert.ok(!existsSync(join(out, 'error.json')), 'a successful run retires the earlier error report');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the key rule matches tools/tessellate.py resolve_bodies', () => {
  assert.equal(partKey('X06 Kontext T06'), 'X06');
  assert.equal(partKey('  D01\tSchiene links'), 'D01');
  assert.equal(partKey('M3/Nut#2 insert'), 'M3_Nut_2');
  assert.equal(partKey('Grüße x'), 'Gr__e');
  const refused = (bodies, pattern) => assert.throws(() => partKeys(bodies), e => e instanceof R20ExportError && pattern.test(e.message));
  refused([{ id: 'a', name: undefined }], /body a has no NAME/);
  refused([{ id: 'a', name: '   ' }], /body a has no NAME/);
  refused([{ id: 'a', name: '.. dots' }], /no usable part key/);
  refused([{ id: 'model/x', name: 'model/x is its id' }], /is its part id/);
  refused([{ id: 'a', name: 'K1 one' }, { id: 'b', name: 'k1 two' }], /duplicate part key k1/);
  assert.deepEqual(partKeys([{ id: 'a', name: 'K1 one' }, { id: 'b', name: 'K2 two' }]), ['K1', 'K2']);
});

// A unit cube as 12 triangles, outward wound.
const cube = (offset = [0, 0, 0]) => {
  const v = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]].map(p => p.map((c, i) => c + offset[i]));
  return [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7]]
    .map(t => t.map(i => v[i]));
};

test('non-watertight, multi-body, inside-out and float32-collapsing parts are refused by name', () => {
  const refused = (triangles, pattern) => assert.throws(() => packStl(triangles, 'part T'), e => e instanceof R20ExportError && pattern.test(e.message));
  const good = packStl(cube(), 'part T');
  assert.equal(good.triangles, 12);
  assert.equal(good.buffer.length, 84 + 50 * 12);
  assert.ok(Math.abs(good.meshVolumeMm3 - 1) < 1e-12);
  refused(cube().slice(1), /not watertight as stored \(3 open/);
  refused([...cube().slice(1), cube()[0].slice().reverse()], /not watertight as stored \(0 open, 3 misoriented/);
  refused([...cube(), ...cube([3, 0, 0])], /2 separate bodies/);
  refused(cube().map(t => t.slice().reverse()), /not positive \(inside out\)/);
  // Two corners 1e-9 mm apart are one float32 point: the triangle vanishes.
  refused([[[100, 0, 0], [100 + 1e-9, 0, 0], [100, 1, 0]], ...cube()], /collapse when stored as float32/);
  refused([], /no triangles/);
});

// Stored bytes, not a duplicated mesher: the old export reported zero storage
// displacement. The multi-axis case also rejects a max-component-only bound.
test('STL storage deviation bounds every decoded vertex, including the far tetrahedron', () => {
  assert.equal(packStl(cube(), 'near cube').float32RoundingMm, 0);
  for (const origin of [[9998.01, 0, 0], [1000.1, -2000.3, 0.7]]) {
    const vertices = [[0, 0, 0], [0.37, 0, 0], [0, 0.37, 0], [0, 0, 0.37]]
      .map(p => p.map((x, i) => x + origin[i]));
    const triangles = [[0, 2, 1], [0, 1, 3], [0, 3, 2], [1, 2, 3]].map(t => t.map(i => vertices[i]));
    const packed = packStl(triangles, 'far tetrahedron');
    // All numbers in this fixture are dyadic integers at 2^200, including
    // the binary64 bound. Compare squared norms exactly, independently of hypot.
    const scaled = x => BigInt(x * 2 ** 200);
    let worst = 0n;
    triangles.forEach((t, i) => t.forEach((p, j) => {
      const square = p.reduce((sum, x, k) => {
        const stored = packed.buffer.readFloatLE(84 + 50 * i + 12 + 12 * j + 4 * k);
        const difference = scaled(stored) - scaled(x);
        return sum + difference ** 2n;
      }, 0n);
      if (square > worst) worst = square;
    }));
    assert.ok(Number.isFinite(packed.float32RoundingMm), 'storage bound is reported');
    assert.ok(scaled(packed.float32RoundingMm) ** 2n >= worst, 'bounds exact squared displacement');
    assert.ok(packed.float32RoundingMm <= Math.sqrt(Number(worst)) / 2 ** 200 * (1 + 2 ** -46), 'tight outward norm bound');
    if (origin[0] === 9998.01) assert.ok(packed.float32RoundingMm >= 0.000234);
  }
  // A deleted collapsed triangle remote from the surviving surface has no
  // barycentric coverage; a watertight cube alone does not certify its loss.
  assert.throws(() => packStl([...cube(), [[100, 0, 0], [100 + 1e-9, 0, 0], [100, 1, 0]]],
    'uncovered collapse', { collapseFloat32: true }), /collapsed.*not covered/);
});

// Separate exponent-range risk: squaring tiny but finite displacements can
// underflow. A bounded subprocess prevents a broken root-bound loop from
// hanging the test runner (no production hook).
test('STL storage bound terminates when coordinate-displacement squares underflow', () => {
  const triangles = cube().map(t => t.map(p => p.map(x => x === 0 ? 1e-200 : x)));
  const result = spawnSync(process.execPath, ['--input-type=module', '-e',
    `import { packStl } from './src/r20-export.mjs'; console.log(packStl(${JSON.stringify(triangles)}, 'tiny shift').float32RoundingMm);`],
  { cwd: root, encoding: 'utf8', timeout: 5000 });
  assert.equal(result.status, 0, `${result.error ?? ''}\n${result.stderr}`);
  const bound = Number(result.stdout.trim());
  assert.ok(bound >= Math.sqrt(3) * 1e-200 && bound < 2e-200, `${bound}: finite, tight displacement bound`);
});

// The reader's side of the statement (scripts/r20/mesh.mjs wonkyRowProblems):
// the request bounds the mesh deviation (meshDeviationMm, or
// achievedDeviationMm in a row from before the two-number contract); the
// stated deviation is about the stored file and must include the float32
// storage rounding it states.
test('the reader checks the mesh deviation against the request and the stated one against mesh + storage', () => {
  const dir = scratch('wonky-r20-statement-');
  try {
    const packed = packStl(cube(), 'part C01');
    const read = wonky => {
      writeFileSync(join(dir, 'C01.stl'), packed.buffer);
      writeFileSync(join(dir, 'tessellate-manifest.json'), JSON.stringify({ schema: 'r20/tessellate-manifest/v1', part_studio: 'wonky:c.fs#c',
        fingerprint: 'f'.repeat(64), parts: { C01: { name: 'C01 cube', part_id: 'model/c', triangles: 12, sha256: sha256(packed.buffer), description: null,
          wonky: { volumeMm3: 1, exact: true, approximation: null, deviationMm: 0.01, ...wonky } } } }));
      return readR20Export(dir, { wonky: true }).problems;
    };
    // Before the two-number contract: achievedDeviationMm is the mesh's and holds the request.
    assert.deepEqual(read({ achievedDeviationMm: 0.01 }), []);
    assert.deepEqual(read({ achievedDeviationMm: 0.0100076 }), ['part C01: mesh deviation 0.0100076 does not hold the requested 0.01']);
    // Two numbers (KS06b): the stored file may exceed the request by the stated storage term.
    const mesh = 0.01, storage = 7.612219401550312e-6, stated = (mesh + storage) * (1 + 2 ** -50);
    assert.deepEqual(read({ achievedDeviationMm: stated, meshDeviationMm: mesh, float32RoundingMm: storage }), []);
    assert.deepEqual(read({ achievedDeviationMm: mesh, meshDeviationMm: mesh, float32RoundingMm: storage }),
      [`part C01: stated deviation 0.01 is below mesh 0.01 + float32 storage ${storage}`]);
    assert.deepEqual(read({ achievedDeviationMm: 0.0110001, meshDeviationMm: 0.011, float32RoundingMm: 1e-7 }),
      ['part C01: mesh deviation 0.011 does not hold the requested 0.01']);
    assert.deepEqual(read({ achievedDeviationMm: stated, float32RoundingMm: storage }),
      ['part C01: wonky row states only one of meshDeviationMm and float32RoundingMm', `part C01: mesh deviation ${stated} does not hold the requested 0.01`,
        `part C01: stated deviation ${stated} is below mesh ${stated} + float32 storage ${storage}`]);
    assert.deepEqual(read({ achievedDeviationMm: stated, meshDeviationMm: mesh, float32RoundingMm: -1 }),
      ['part C01: wonky.float32RoundingMm -1 is not a measured rounding']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('error.json records the class and the source location of a build error', () => {
  const dir = scratch('wonky-r20-err-');
  try {
    const source = join(dir, 'bad.fs'), out = join(dir, 'r20');
    writeFileSync(source, 'FeatureScript 3044;\nimport(path : "onshape/std/geometry.fs", version : "3044.0");\nexport function bad(context is Context, id is Id, definition is map)\n{\n    opFillet(context, id + "f", {});\n}\n');
    const result = cli([source, '--format', 'r20-check', '--deviation', '0.01', '--out', out]);
    assert.equal(result.status, 1);
    const error = JSON.parse(readFileSync(join(out, 'error.json'), 'utf8'));
    assert.equal(error.file, source);
    assert.equal(error.line, 5);
    assert.ok(error.column > 0);
    assert.match(error.message, /opFillet/);
    assert.ok(['UnsupportedFeatureError', 'FeatureScriptError'].includes(error.class), error.class);
    // A refused argument still reaches the report when the directory is known.
    rmSync(out, { recursive: true, force: true });
    const argument = cli([source, '--format', 'r20-check', '--deviation', '-1', '--out', out]);
    assert.equal(argument.status, 1);
    assert.match(JSON.parse(readFileSync(join(out, 'error.json'), 'utf8')).message, /--deviation expects a positive number/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
  assert.deepEqual(r20ErrorRecord(new UnsupportedFeatureError('no', { line: 3, column: 4 }), 'x.fs'),
    { class: 'UnsupportedFeatureError', message: 'no', file: join(process.cwd(), 'x.fs'), line: 3, column: 4 });
  assert.equal(r20ErrorRecord(new Error('plain')).class, 'Error');
});

test('a refusal inside a shared helper names the operation id chain and the call that reached it', () => {
  // The helper's line is the same for both calls; only the operation id and
  // the call stack tell that the second call (line 11, id B) refused.
  const dir = scratch('wonky-r20-helper-');
  try {
    const source = join(dir, 'helper.fs'), out = join(dir, 'r20');
    writeFileSync(source, `FeatureScript 3044;
import(path : "onshape/std/geometry.fs", version : "3044.0");
function step(context is Context, id is Id, refuse is boolean)
{
    if (refuse) opFillet(context, id + "fillet", {});
    else fCuboid(context, id + "box", { "corner1" : vector(0, 0, 0) * millimeter, "corner2" : vector(1, 1, 1) * millimeter });
}
export function helpers(context is Context, id is Id, definition is map)
{
    step(context, id + "A", false);
    step(context, id + "B", true);
}
`);
    const result = cli([source, '--format', 'r20-check', '--deviation', '0.01', '--out', out]);
    assert.equal(result.status, 1);
    const error = JSON.parse(readFileSync(join(out, 'error.json'), 'utf8'));
    assert.equal(error.line, 5, 'line and column stay the innermost location, inside the helper');
    assert.equal(error.operation.id, 'model/B/fillet');
    assert.equal(error.operation.name, 'opFillet');
    assert.deepEqual(error.operation.callStack.map(f => [f.function, f.line]), [['helpers', null], ['step', 11]]);
    assert.match(result.stderr, /helper\.fs:5:\d+: .*\nwonky: in operation model\/B\/fillet \(opFillet\), call chain helpers, step \(called at line 11\)\n/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// --- the print-mesh defect (X06) -------------------------------------------------

const revolve = profile => revolveInBend(kernel, 'part', profile, [0, 0, 0], [0, 0, 1], [1, 0, 0], 1e-7);
const tube = [[2, 0], [5, 0], [5, 8], [2, 8]];
const meshVolume = triangles => measure(triangles).volumeMm3;

// A copy of a body with one circle edge re-described: the same circle, with
// its normal reversed and/or its x axis turned. Every face that uses the edge
// still shares one ring, so a correct mesher stays watertight.
function redescribe(body, edgeIndex, { flip = false, turn = 0 }) {
  const copy = structuredClone(body), c = copy.edges[edgeIndex].curve;
  const y = [c.normal[1] * c.x[2] - c.normal[2] * c.x[1], c.normal[2] * c.x[0] - c.normal[0] * c.x[2], c.normal[0] * c.x[1] - c.normal[1] * c.x[0]];
  c.x = c.x.map((v, i) => Math.cos(turn) * v + Math.sin(turn) * y[i]);
  if (flip) c.normal = c.normal.map(v => -v);
  return copy;
}

test('a band whose rims run opposite ways or start elsewhere still meshes watertight (X06)', () => {
  const body = revolve(tube), exact = body.validation.volumeMm3;
  const circles = body.edges.map((e, i) => (e.curve.type === 'circle' ? i : -1)).filter(i => i >= 0);
  assert.ok(circles.length >= 2);
  const reference = printMesh(kernel, body, 0.01);
  for (const variant of [{ flip: true }, { turn: 0.3 * 2 * Math.PI / reference.count }, { flip: true, turn: 1.7 }]) {
    for (const edge of circles) {
      const mesh = printMesh(kernel, redescribe(body, edge, variant), 0.01);
      assert.ok(meshDefects(mesh.triangles).watertight, `${JSON.stringify(variant)} on edge ${edge}`);
      const volume = meshVolume(mesh.triangles);
      // Inscribed: inside the exact solid, and no worse than twice the reference's shortfall.
      assert.ok(volume < exact && exact - volume <= 2 * (exact - meshVolume(reference.triangles)) + 1e-9,
        `${JSON.stringify(variant)} on edge ${edge}: ${volume} vs ${exact}`);
    }
  }
});

test('printMesh refuses a mesh that is not watertight instead of returning it', () => {
  // A tube with one of its faces missing: every face that is left meshes
  // fine, but the whole is open. The self-check is what catches it.
  const body = revolve(tube);
  assert.ok(meshDefects(printMesh(kernel, body, 0.02).triangles).watertight);
  const broken = structuredClone(body);
  broken.faces.splice(broken.faces.findIndex(f => f.surface.type === 'cylinder'), 1);
  assert.throws(() => printMesh(kernel, broken, 0.02), e => e instanceof FeatureScriptError && /self-check failed/.test(e.message) && /open/.test(e.message));
  const open = meshDefects(cube().slice(2));
  assert.equal(open.watertight, false);
  assert.ok(open.open > 0);
});

// X06 itself: the imported rear hopper wall, against Onshape's own mesh.
const R20 = process.env.R20_ROOT ?? join(homedir(), 'Workspace/cad/cad-project-041/single-step-r20');
const x06 = join(root, 'tmp/r20/scratch/probe/x06.fs'), x06Ref = join(R20, 'var/mesh/X06.stl');
test('X06 exports watertight and within tolerance of Onshape', { skip: !(existsSync(x06) && existsSync(x06Ref)) && 'X06 scratch or R20 reference not present' }, () => {
  const dir = scratch('wonky-r20-x06-');
  try {
    const out = join(dir, 'r20');
    const result = cli([x06, '--feature', 'x06', '--format', 'r20-check', '--deviation', '0.01', '--out', out]);
    assert.equal(result.status, 0, result.stderr);
    const read = readR20Export(out, { wonky: true });
    assert.deepEqual(read.problems, []);
    const ours = read.parts.X06.triangles, ref = readStl(x06Ref).flatMap(s => s.triangles);
    const a = measure(ours), b = measure(ref);
    const halfDiagonal = Math.hypot(...[0, 1, 2].map(i => b.bbox[1][i] - b.bbox[0][i])) / 2;
    const tol = 0.01 + halfDiagonal * (1 - Math.cos(0.025)) + 1e-4;
    assert.ok(a.watertight && a.components === 1);
    for (const side of [0, 1]) for (const i of [0, 1, 2]) assert.ok(Math.abs(a.bbox[side][i] - b.bbox[side][i]) <= tol);
    const h = hausdorff(ours, ref, { extra: 5000 }).hausdorffMm;
    assert.ok(h <= tol, `Hausdorff ${h} > ${tol}`);
    assert.ok(Math.abs(a.volumeMm3 - b.volumeMm3) <= b.areaMm2 * tol);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('--help offers r20-check', () => {
  assert.match(cli(['--help']).stdout, /r20-check/);
});

}
