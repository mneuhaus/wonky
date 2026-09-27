import test from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missingBend();
if (publicTreeSkip) {
  test("print-mesh.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { execFileSync, spawnSync } = await import("node:child_process");
const { mkdtempSync, readFileSync, readdirSync, rmSync } = await import("node:fs");
const { tmpdir } = await import("node:os");
const { join } = await import("node:path");
const { fileURLToPath } = await import("node:url");
const { loadKernel } = await import("../src/kernel.mjs");
const { real, number } = await import("../src/real.mjs");
const { revolveInBend } = await import("../src/analytic.mjs");
const { printMesh, withHoles } = await import("../src/print-mesh.mjs");
const { UnsupportedFeatureError } = await import("../src/errors.mjs");













const root = fileURLToPath(new URL('../', import.meta.url));
const kernel = await loadKernel();
const revolve = profile => revolveInBend(kernel, 'part', profile, [0, 0, 0], [0, 0, 1], [1, 0, 0], 1e-7);
const tube = [[2, 0], [5, 0], [5, 8], [2, 8]];
const groove = [[3, 0], [8, 0], [8, 3], [6, 4], [6, 6], [8, 7], [8, 10], [3, 10]];

// Directed, not merely paired. A mesh is watertight and consistently oriented
// exactly when every edge appears once in each direction. Counting undirected
// edges would pass a mesh with a face turned inside out, since flipping a face
// keeps its edges paired and only reverses them -- which is precisely the
// failure the per-face outward test exists to prevent.
function seams(triangles) {
  const key = p => p.map(v => v.toPrecision(12)).join(',');
  const edges = new Map();
  for (const triangle of triangles) {
    const corners = triangle.map(key);
    for (let i = 0; i < 3; i++) {
      const [a, b] = [corners[i], corners[(i + 1) % 3]];
      const id = a < b ? `${a}|${b}` : `${b}|${a}`;
      const entry = edges.get(id) ?? { forward: 0, backward: 0 };
      a < b ? entry.forward++ : entry.backward++;
      edges.set(id, entry);
    }
  }
  return [...edges.values()].filter(e => e.forward !== 1 || e.backward !== 1).length;
}

const meshVolume = triangles => triangles.reduce((sum, [a, b, c]) =>
  sum + (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6, 0);

test('a revolved body meshes watertight at every deviation', () => {
  for (const profile of [tube, groove])
    for (const deviation of [0.05, 0.02, 0.005]) {
      const mesh = printMesh(kernel, revolve(profile), deviation);
      assert.equal(seams(mesh.triangles), 0, `${mesh.triangles.length} triangles at ${deviation} mm left open edges`);
    }
});

test('conical faces are oriented, whichever side of the part they are on', () => {
  // The cone branch of the outward test read the half-angle as a double-word
  // Real when decodeAnalytic had already resolved it to a number, so it was
  // NaN and the flip it guards never fired. The strip winding happened to
  // agree, so no volume moved; these pin the orientation rather than the
  // volume, and cover an outer taper, a tapered bore and both at once.
  for (const profile of [[[2, 0], [5, 0], [3, 6], [2, 6]],
    [[2, 0], [5, 0], [5, 8], [3, 8]],
    [[2, 0], [5, 0], [3, 6], [2.5, 6]]]) {
    const body = revolve(profile);
    assert.ok(body.faces.some(f => f.surface.type === 'cone'));
    const mesh = printMesh(kernel, body, 0.01);
    assert.equal(seams(mesh.triangles), 0);
    const volume = meshVolume(mesh.triangles);
    assert.ok(volume > 0 && volume < body.validation.volumeMm3);
    assert.ok((body.validation.volumeMm3 - volume) / body.validation.volumeMm3 < 0.01);
  }
});

test('a bored body meshes watertight even though its annulus is two loops', () => {
  // The bore carries its hole as an inner loop while a revolve closes the same
  // face with a seam. Both have to reach the same strip.
  const dir = mkdtempSync(join(tmpdir(), 'wonky-print-'));
  try {
    const prefix = join(dir, 'bore');
    execFileSync(process.execPath, ['bin/wonky.mjs', 'examples/bored-spacer.fs', '--format', 'step', '--out', prefix], { cwd: root });
    const model = JSON.parse(readFileSync(prefix + '.brep.json', 'utf8'));
    const mesh = printMesh(kernel, model.bodies[0], 0.02);
    assert.equal(seams(mesh.triangles), 0);
    assert.ok(mesh.triangles.length > 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the deviation it reports is one it actually holds, and it never exceeds the request', () => {
  for (const deviation of [0.05, 0.02, 0.005]) {
    const mesh = printMesh(kernel, revolve(tube), deviation);
    assert.ok(mesh.achievedDeviationMm <= deviation,
      `achieved ${mesh.achievedDeviationMm} exceeds the requested ${deviation}`);
    // The bound is the kernel's, recomputed here from the same count.
    const largest = number(kernel.tessellate.sagitta(real(5), mesh.count));
    assert.equal(mesh.achievedDeviationMm, largest);
  }
});

test('mesh volume sits just inside the exact solid and converges as the deviation tightens', () => {
  const body = revolve(tube), exact = body.validation.volumeMm3;
  const errors = [0.05, 0.02, 0.005].map(deviation => {
    const volume = meshVolume(printMesh(kernel, body, deviation).triangles);
    // Chords are inscribed, so the mesh is always slightly the smaller solid.
    assert.ok(volume < exact, `mesh volume ${volume} is not inside the exact ${exact}`);
    return (exact - volume) / exact;
  });
  assert.ok(errors[1] < errors[0] / 2, `${errors[1]} did not improve on ${errors[0]}`);
  assert.ok(errors[2] < errors[1] / 2, `${errors[2]} did not improve on ${errors[1]}`);
  assert.ok(errors[2] < 0.002);
});

test('one chord count serves the whole body, which is why the seams close', () => {
  // The bore is 2 mm and the wall 5 mm, so a per-face count would differ and
  // the two faces meeting on each circle would not share vertices.
  const mesh = printMesh(kernel, revolve(tube), 0.02);
  assert.equal(mesh.count, kernel.tessellate.chord_count(real(5), real(0.02)));
  assert.ok(mesh.count > kernel.tessellate.chord_count(real(2), real(0.02)));
  assert.equal(mesh.triangles.length, 4 * 2 * mesh.count);
});

test('a deviation too fine to hold is refused rather than silently coarsened', () => {
  assert.throws(() => printMesh(kernel, revolve(tube), 1e-12), UnsupportedFeatureError);
  assert.throws(() => printMesh(kernel, revolve(tube), 1e-12), /chord cap/);
});

test('--format print writes a mesh and a manifest for a body STL alone refuses', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wonky-printcli-'));
  try {
    const prefix = join(dir, 'spacer');
    const result = spawnSync(process.execPath,
      ['bin/wonky.mjs', 'examples/bored-spacer.fs', '--format', 'print', '--deviation-mm', '0.01', '--out', prefix],
      { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(readdirSync(dir).sort(), ['spacer.brep.json', 'spacer.print.json', 'spacer.step', 'spacer.stl']);
    const manifest = JSON.parse(readFileSync(prefix + '.print.json', 'utf8'));
    assert.equal(manifest.schema, 'wonky.print-mesh/1');
    assert.equal(manifest.deviationMm, 0.01);
    assert.ok(manifest.bodies[0].achievedDeviationMm <= 0.01);
    assert.ok(manifest.bodies[0].chordCount > 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// The R20 E01 seam foot plane with its chamfered corners (edge.fs, withBlends),
// in its own (x, y) frame: the outline edges at y 81.291507 from x -90.8 to -88
// and from 88 to 90.8 lie on one line, and so do those at y 72.291507.
const e01Foot = [[90.8, 81.291507], [92.8, 83.291507], [92.8, 85.291507], [-92.8, 85.291507], [-92.8, 83.291507], [-90.8, 81.291507],
    [-88, 81.291507], [-88, 72.291507], [-70, 72.291507], [-70, 63.791507], [-50, 63.791507], [-50, 72.291507], [50, 72.291507],
    [50, 63.791507], [70, 63.791507], [70, 72.291507], [88, 72.291507], [88, 81.291507]];

test('a cap whose outline edges line up across a notch is ear clipped without reversed triangles (E01 foot)', () => {
  // An ear whose new edge ran from 88 to -90.8 through the vertex at -88 left
  // an outline touching itself there; the last triangle came out reversed and
  // the print mesh had 6 misoriented edges.
  const ring = e01Foot;
  const signedArea = ([a, b, c]) => ((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / 2;
  const outline = ring.reduce((sum, p, k) => sum + (p[0] * ring[(k + 1) % ring.length][1] - ring[(k + 1) % ring.length][0] * p[1]) / 2, 0);
  for (const points of [ring, [...ring].reverse()]) {
    const triangles = withHoles(points.map(([x, y]) => [x, y, 0]), [], [0, 0, 1], [1, 0, 0]);
    assert.equal(triangles.length, ring.length - 2);
    assert.equal(triangles.filter(t => !(signedArea(t) > 0)).length, 0, 'every triangle counter-clockwise about the normal');
    const covered = triangles.reduce((sum, t) => sum + signedArea(t), 0);
    assert.ok(Math.abs(covered - outline) < 1e-9 * outline, `${covered} covers the outline's ${outline}`);
  }
});

test('a 3 mm prism on the E01 foot outline meshes watertight turned by any angle about its normal', () => {
  // Turned, the lined-up outline edges are collinear only to rounding (1e-14
  // mm): rounded orientation signs clipped an ear across them (35, 304, 305 and
  // 326 degrees: a reversed sliver, 3 misoriented edges), and slivers whose
  // rounded 3D normal was zero were dropped (open edges). Every half degree.
  const prism = (points) => {
    const n = points.length, use = (edge, forward = true) => ({ edge, forward });
    const plane = (normal, x, loop) => ({ sameSense: true, surface: { type: 'plane', normal, x }, loops: [loop] });
    const faces = [plane([0, 0, -1], [1, 0, 0], points.map((_, i) => use(i, false)).reverse()), plane([0, 0, 1], [1, 0, 0], points.map((_, i) => use(n + i)))];
    points.forEach((p, i) => {
      const q = points[(i + 1) % n], dx = q[0] - p[0], dy = q[1] - p[1], len = Math.hypot(dx, dy);
      faces.push(plane([dy / len, -dx / len, 0], [dx / len, dy / len, 0], [use(i), use(2 * n + (i + 1) % n), use(n + i, false), use(2 * n + i, false)]));
    });
    return { id: 'turned-foot', geometry: 'analytic', vertices: [...points.map(p => [...p, 0]), ...points.map(p => [...p, 3])],
      edges: [...points.map((_, i) => ({ start: i, end: (i + 1) % n, curve: 'line' })), ...points.map((_, i) => ({ start: n + i, end: n + (i + 1) % n, curve: 'line' })),
        ...points.map((_, i) => ({ start: i, end: n + i, curve: 'line' }))], faces };
  };
  const refused = [];
  for (let degrees = 0; degrees < 360; degrees += 0.5) {
    const a = degrees * Math.PI / 180, turned = e01Foot.map(([x, y]) => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)]);
    try {
      assert.equal(printMesh(null, prism(turned), 0.01).triangles.length, 4 * e01Foot.length - 4);
    } catch (error) {
      refused.push(`${degrees}: ${error.message.slice(0, 100)}`);
    }
  }
  assert.deepEqual(refused, []);
});

test('a pierced plate meshes watertight, hole and all', async () => {
  const { build } = await import('../src/index.mjs');
  const source = `FeatureScript 3044;
import(path : "onshape/std/geometry.fs", version : "3044.0");
export function part(context is Context, id is Id, definition is map)
{
    var p = newSketchOnPlane(context, id + "p", { "sketchPlane" : plane(vector(0,0,0)*millimeter, vector(0,0,1)) });
    skRectangle(p, "r", { "firstCorner" : vector(-20,-15)*millimeter, "secondCorner" : vector(20,15)*millimeter });
    skSolve(p);
    opExtrude(context, id + "plate", { "entities" : qSketchRegion(id + "p"),
        "direction" : vector(0,0,1), "endBound" : BoundingType.BLIND, "endDepth" : 5*millimeter });
    var t = newSketchOnPlane(context, id + "t", { "sketchPlane" : plane(vector(0,0,-1)*millimeter, vector(0,0,1)) });
    skCircle(t, "c", { "center" : vector(0,0)*millimeter, "radius" : 4*millimeter });
    skSolve(t);
    opExtrude(context, id + "tool", { "entities" : qSketchRegion(id + "t"),
        "direction" : vector(0,0,1), "endBound" : BoundingType.BLIND, "endDepth" : 7*millimeter });
    opBoolean(context, id + "bore", { "targets" : qCreatedBy(id + "plate", EntityType.BODY),
        "tools" : qCreatedBy(id + "tool", EntityType.BODY), "operationType" : BooleanOperationType.SUBTRACTION });
}`;
  const body = (await build(source, { feature: 'part' })).bodies[0];
  for (const deviation of [0.05, 0.02, 0.005]) {
    const mesh = printMesh(kernel, body, deviation);
    assert.equal(seams(mesh.triangles), 0, `open or mis-wound edges at ${deviation} mm`);
    // A pierced cap is a polygon with a hole, so the hole is bridged into the
    // outline and ear clipped. Pairing the two boundaries by angle instead
    // reaches across the hole from a far corner and inverts triangles.
    const volume = meshVolume(mesh.triangles), exact = body.validation.volumeMm3;
    // Over, not under: the outline is exact and only the hole is approximated,
    // and an inscribed rim leaves the opening smaller than nominal.
    assert.ok(volume > exact, `${volume} should exceed the exact ${exact}`);
    assert.ok((volume - exact) / exact < 0.01);
  }
});

}
