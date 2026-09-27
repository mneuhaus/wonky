import test from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missingBend();
if (publicTreeSkip) {
  test("viewer-topology-classes.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { createHash } = await import("node:crypto");
const { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } = await import("node:fs");
const { join } = await import("node:path");
const { fileURLToPath } = await import("node:url");
const { build } = await import("../src/index.mjs");
const { EDGE_CLASS, EDGE_CLASSES, bodyTolerances, classifyEdges, joinFragments } = await import("../src/viewer/edge-classes.mjs");
const { logicalFaces } = await import("../src/viewer/logical-faces.mjs");
// Exact edge classes and logical faces (package topology-classes).
//
// Synthetic bodies pin every decision rule (support identity, recorded
// origins, disagreement, chain drift, seams, capability limits); real kernel
// models pin the acceptance counts. Real models are built once and cached in
// tmp/viewer/topology-classes/cache/, keyed by the source and a stat
// fingerprint of the kernel sources.










const root = fileURLToPath(new URL('../', import.meta.url));

// ---------------------------------------------------------------------------
// Real models, built by the kernel and cached.

const kernelFingerprint = (() => {
  const entries = [];
  for (const directory of ['kernel', 'kernel/ports', 'src']) {
    for (const file of readdirSync(join(root, directory)).sort()) {
      if (!/\.(bend|mjs)$/.test(file)) continue;
      const stat = statSync(join(root, directory, file));
      entries.push(`${directory}/${file}:${stat.size}:${stat.mtimeMs}`);
    }
  }
  return createHash('sha256').update(entries.join('\n')).digest('hex').slice(0, 12);
})();

async function kernelModel(name, source) {
  const key = createHash('sha256').update(source).update(kernelFingerprint).digest('hex')
    .slice(0, 16);
  const directory = join(root, 'tmp/viewer/topology-classes/cache');
  const path = join(directory, `${name}-${key}.brep.json`);
  if (existsSync(path)) return JSON.parse(readFileSync(path, 'utf8'));
  const text = JSON.stringify(await build(source, { sourcePath: `/fixtures/${name}.fs` }));
  mkdirSync(directory, { recursive: true });
  writeFileSync(path, text);
  return JSON.parse(text);
}

const read = path => readFileSync(join(root, path), 'utf8');

// FeatureScript twin of the build123d frame-with-tab performance case
// (fixtures/performance-build123d/cases/frame-with-tab.py).
const FRAME_WITH_TAB = `FeatureScript 3044;
import(path : "onshape/std/geometry.fs", version : "3044.0");

export function frameWithTab(context is Context, id is Id, definition is map)
{
    fCuboid(context, id + "stock", { "corner1" : vector(0, 0, 0) * millimeter,
        "corner2" : vector(50, 40, 10) * millimeter });
    fCuboid(context, id + "opening", { "corner1" : vector(8, 8, -1) * millimeter,
        "corner2" : vector(42, 32, 11) * millimeter });
    opBoolean(context, id + "frame", { "targets" : qCreatedBy(id + "stock", EntityType.BODY),
        "tools" : qCreatedBy(id + "opening", EntityType.BODY),
        "operationType" : BooleanOperationType.SUBTRACTION });
    fCuboid(context, id + "tab", { "corner1" : vector(48, 10, 0) * millimeter,
        "corner2" : vector(60, 30, 10) * millimeter });
    opBoolean(context, id + "join", { "tools" : qUnion([qCreatedBy(id + "stock", EntityType.BODY),
        qCreatedBy(id + "tab", EntityType.BODY)]),
        "operationType" : BooleanOperationType.UNION });
}
`;

// ---------------------------------------------------------------------------
// Synthetic planar strips: k fragments side by side along x (10 mm each,
// y 0..10). Fragment i lies on a plane tilted by tilts[i] rad about the y
// axis that passes through the line it shares with fragment i - 1, so every
// shared edge lies exactly on both planes.

const unit = v => {
  const length = Math.hypot(...v);
  return v.map(value => value / length);
};

const ORIGIN_RECORDS = {
  FaceSubdivision: () => ({
    $: 'FaceSubdivision',
    faces: { $: 'Con', head: { $: 'FaceRef', operand: 0, index: 0 }, tail: { $: 'Nil' } },
  }),
  FaceIntersection: () => ({
    $: 'FaceIntersection',
    first: { $: 'FaceRef', operand: 0, index: 0 },
    second: { $: 'FaceRef', operand: 1, index: 0 },
  }),
  OriginalEdge: index => ({ $: 'OriginalEdge', operand: 0, index }),
};

function strip(tilts, {
  origin = 'FaceSubdivision', origins, legacy = false, sameSense, tolerance = 3e-4,
} = {}) {
  const k = tilts.length;
  const z = [0];
  for (let i = 1; i <= k; i++) z.push(z[i - 1] + 10 * Math.tan(tilts[i - 1]));
  const vertices = [];
  for (let i = 0; i <= k; i++) vertices.push([10 * i, 0, z[i]]);
  for (let i = 0; i <= k; i++) vertices.push([10 * i, 10, z[i]]);
  const bottom = i => i;
  const top = i => k + 1 + i;
  const edges = [];
  const line = (start, end) => {
    const [a, b] = [vertices[start], vertices[end]];
    const delta = b.map((value, index) => value - a[index]);
    return legacy ? { curve: 'line', start, end } : {
      start, end, sameSense: true, curveRange: [0, Math.hypot(...delta)],
      curve: { type: 'line', origin: a, direction: unit(delta) },
    };
  };
  const vertical = [];
  for (let i = 0; i <= k; i++) vertical.push(edges.push(line(bottom(i), top(i))) - 1);
  const lower = [];
  const upper = [];
  for (let i = 0; i < k; i++) {
    lower.push(edges.push(line(bottom(i), bottom(i + 1))) - 1);
    upper.push(edges.push(line(top(i), top(i + 1))) - 1);
  }
  const faces = tilts.map((tilt, i) => {
    const face = {
      surface: {
        type: 'plane', origin: vertices[bottom(i)], x: [Math.cos(tilt), 0, Math.sin(tilt)],
        normal: [-Math.sin(tilt), 0, Math.cos(tilt)],
      },
      loops: [[
        { edge: lower[i], forward: true }, { edge: vertical[i + 1], forward: true },
        { edge: upper[i], forward: false }, { edge: vertical[i], forward: false },
      ]],
    };
    if (!legacy) {
      face.sameSense = sameSense?.[i] ?? true;
      face.outer = [true];
    }
    return face;
  });
  const body = {
    id: 'synthetic/strip', vertices, edges, faces,
    validation: tolerance === null ? {} : { toleranceMm: tolerance },
  };
  if (!legacy) Object.assign(body, { geometry: 'analytic', precision: 'F32x2' });
  const internal = vertical.slice(1, k);
  if (origin || origins) {
    body.construction = {
      edgeOrigins: edges.map((_edge, index) => {
        const at = internal.indexOf(index);
        const tag = at < 0 ? 'OriginalEdge' : origins?.[at] ?? origin;
        return ORIGIN_RECORDS[tag](index);
      }),
    };
  }
  return { model: { schema: 'wonky-brep/1', bodies: [body] }, internal };
}

const classOf = (model, edge) => EDGE_CLASSES[classifyEdges(model).bodies[0].classes[edge]];
const evidenceOf = (model, edge) => classifyEdges(model).bodies[0].evidence[edge];
const groupsOf = model => logicalFaces(model).bodies[0].groups.map(group => group.fragments);
const flatTolerance = bodyTolerances(strip([0, 0, 0]).model.bodies[0]).angularToleranceRad;

test('coplanar fragments confirmed by FaceSubdivision are subdivision edges and one logical face',
  () => {
    const { model, internal } = strip([0, 0, 0]);
    assert.deepEqual(internal.map(edge => classOf(model, edge)), ['subdivision', 'subdivision']);
    assert.deepEqual(evidenceOf(model, internal[0]), {
      support: 'identical', origin: 'FaceSubdivision', angleRad: null, reason: null,
    });
    assert.deepEqual(groupsOf(model), [[0, 1, 2]]);
    const [group] = logicalFaces(model).bodies[0].groups;
    assert.equal(group.alias, 'B1.L1');
    assert.equal(group.support.type, 'plane');
    assert.equal(group.support.fragment, 0);
    assert.equal(group.support.sameSense, true);
    assert.deepEqual([...logicalFaces(model).bodies[0].logicalOf], [0, 0, 0]);
  });

test('without a construction record, or with an inherited OriginalEdge, support decides', () => {
  for (const options of [
    { origin: null }, { origin: 'OriginalEdge' }, { legacy: true, origin: null },
  ]) {
    const { model, internal } = strip([0, 0, 0], options);
    assert.deepEqual(internal.map(edge => classOf(model, edge)), ['subdivision', 'subdivision'],
      JSON.stringify(options));
    assert.deepEqual(groupsOf(model), [[0, 1, 2]]);
  }
});

test('evidence that disagrees leaves the edge unresolved and the faces unmerged', () => {
  const intersection = strip([0, 0, 0], { origins: ['FaceIntersection', 'FaceSubdivision'] });
  assert.equal(classOf(intersection.model, intersection.internal[0]), 'unresolved');
  assert.match(evidenceOf(intersection.model, intersection.internal[0]).reason,
    /identical supports but recorded as FaceIntersection/);
  assert.equal(classOf(intersection.model, intersection.internal[1]), 'subdivision');
  assert.deepEqual(groupsOf(intersection.model), [[0], [1, 2]]);

  const tilted = strip([0, 0, 5 * flatTolerance]);
  assert.equal(classOf(tilted.model, tilted.internal[1]), 'unresolved');
  assert.match(evidenceOf(tilted.model, tilted.internal[1]).reason,
    /recorded as FaceSubdivision but the supports differ \(normals differ/);
  assert.deepEqual(groupsOf(tilted.model), [[0, 1], [2]]);

  const reversed = strip([0, 0, 0], { sameSense: [true, true, false] });
  assert.equal(classOf(reversed.model, reversed.internal[1]), 'unresolved');
  assert.match(evidenceOf(reversed.model, reversed.internal[1]).reason, /opposite orientation/);
  assert.deepEqual(groupsOf(reversed.model), [[0, 1], [2]]);
});

// A closed cylinder r = 2, h = 5: two rims, one seam, a cylinder and two caps.
function cylinderBody() {
  const rim = (vertex, z) => ({
    start: vertex, end: vertex, sameSense: true,
    curve: { type: 'circle', origin: [0, 0, z], normal: [0, 0, 1], x: [1, 0, 0], radius: 2 },
  });
  const plane = (z, sameSense, edge) => ({
    surface: { type: 'plane', origin: [0, 0, z], normal: [0, 0, 1], x: [1, 0, 0] },
    sameSense, loops: [[{ edge, forward: sameSense }]], outer: [true],
  });
  return {
    schema: 'wonky-brep/1',
    bodies: [{
      id: 'synthetic/cylinder', geometry: 'analytic', precision: 'F32x2',
      vertices: [[2, 0, 0], [2, 0, 5]],
      edges: [rim(0, 0), rim(1, 5), {
        start: 0, end: 1, sameSense: true, curveRange: [0, 5],
        curve: { type: 'line', origin: [2, 0, 0], direction: [0, 0, 1] },
      }],
      faces: [{
        surface: { type: 'cylinder', origin: [0, 0, 0], axis: [0, 0, 1], x: [1, 0, 0], radius: 2 },
        sameSense: true, outer: [true],
        loops: [[{ edge: 0, forward: true }, { edge: 2, forward: true },
          { edge: 1, forward: false }, { edge: 2, forward: false }]],
      }, plane(0, false, 0), plane(5, true, 1)],
      validation: { toleranceMm: 3e-4 },
    }],
  };
}

test('a periodic seam is a seam only when its two uses run in opposite directions', () => {
  const closed = cylinderBody();
  assert.deepEqual(classifyEdges(closed).bodies[0].counts,
    { sharp: 2, tangent: 0, seam: 1, subdivision: 0, unresolved: 0 });
  assert.deepEqual(groupsOf(closed), [[0], [1], [2]]);
  const same = cylinderBody();
  same.bodies[0].faces[0].loops[0][3].forward = true;
  assert.equal(classOf(same, 2), 'unresolved');
  assert.match(evidenceOf(same, 2).reason, /used twice by one face in the same direction/);
  const intersection = cylinderBody();
  intersection.bodies[0].construction = { edgeOrigins: [
    ORIGIN_RECORDS.OriginalEdge(0), ORIGIN_RECORDS.OriginalEdge(1),
    ORIGIN_RECORDS.FaceIntersection(),
  ] };
  assert.match(evidenceOf(intersection, 2).reason, /seam of one face but recorded as FaceInter/);
});

test('distinct supports without a same-support record are sharp; a fin is sharp', () => {
  const kinked = strip([0, 0, 5 * flatTolerance], { origin: null });
  assert.equal(classOf(kinked.model, kinked.internal[1]), 'sharp');
  const [low, high] = evidenceOf(kinked.model, kinked.internal[1]).angleRad;
  assert.ok(Math.abs(low - 5 * flatTolerance) < 1e-9 && Math.abs(high - low) < 1e-9);
  const fin = strip([0, 0, 0], { origin: null, sameSense: [true, true, false] });
  assert.equal(classOf(fin.model, fin.internal[1]), 'sharp');
  assert.ok(Math.abs(evidenceOf(fin.model, fin.internal[1]).angleRad[0] - Math.PI) < 1e-12);
});

test('a chain of subdivisions that drifts beyond the tolerance is not merged', () => {
  const step = 0.7 * flatTolerance;
  const { model, internal } = strip([0, step, 2 * step]);
  assert.deepEqual(internal.map(edge => classOf(model, edge)), ['unresolved', 'unresolved']);
  assert.match(evidenceOf(model, internal[0]).reason, /subdivision chain drifts: F3 and F1/);
  assert.deepEqual(groupsOf(model), [[0], [1], [2]]);
  const pair = strip([0, step]);
  assert.equal(classOf(pair.model, pair.internal[0]), 'subdivision', 'within tolerance');
});

test('capability limits are explicit unresolved classes, never guesses', () => {
  const open = strip([0, 0, 0]);
  const boundary = open.model.bodies[0].edges
    .findIndex((_edge, index) => !open.internal.includes(index));
  assert.equal(classOf(open.model, boundary), 'unresolved');
  assert.match(evidenceOf(open.model, boundary).reason, /edge has 1 face uses \(expected 2\)/);

  const untolerated = strip([0, 0, 0], { tolerance: null });
  assert.equal(classOf(untolerated.model, untolerated.internal[0]), 'unresolved');
  assert.match(evidenceOf(untolerated.model, untolerated.internal[0]).reason,
    /no recorded model tolerance/);

  const spline = strip([0, 0, 0]);
  spline.model.bodies[0].edges[spline.internal[0]].curve = { type: 'bspline' };
  assert.match(evidenceOf(spline.model, spline.internal[0]).reason,
    /curve type bspline cannot be evaluated/);

  const off = strip([0, 0, 0]);
  const edge = off.model.bodies[0].edges[off.internal[0]];
  edge.curve.origin = [edge.curve.origin[0], 0, 0.01];
  assert.match(evidenceOf(off.model, off.internal[0]).reason,
    /edge point lies 1\.00e-2 mm off the support of face F1/);

  const slit = strip([0]);
  slit.model.bodies[0].faces[0].loops[0].push({ edge: 1, forward: false });
  slit.model.bodies[0].faces[0].loops[0][1] = { edge: 1, forward: true };
  assert.match(evidenceOf(slit.model, 1).reason, /edge is used twice by one plane face/);

  const torus = strip([0, 0, 0]);
  torus.model.bodies[0].faces[2].surface = {
    type: 'torus', origin: [0, 0, 0], axis: [0, 0, 1], x: [1, 0, 0],
  };
  assert.match(evidenceOf(torus.model, torus.internal[1]).reason,
    /FaceSubdivision but support comparison unsupported for plane\/torus/);
});

test('results are deterministic, cached per model object and identical for a clone', () => {
  const { model } = strip([0, 0, 0]);
  assert.equal(classifyEdges(model), classifyEdges(model, null));
  const clone = structuredClone(model);
  assert.deepEqual(classifyEdges(clone), classifyEdges(model));
  assert.deepEqual(logicalFaces(clone), logicalFaces(model));
  const support = logicalFaces(model).bodies[0].groups[0].support;
  support.surface.normal[2] = 5;
  assert.equal(model.bodies[0].faces[0].surface.normal[2], 1, 'support is a copy');
});

test('joinFragments orders groups by their smallest face', () => {
  const { groupOf, groups } = joinFragments(6, [[4, 1], [5, 2], [2, 4]]);
  assert.deepEqual(groups, [[0], [1, 2, 4, 5], [3]]);
  assert.deepEqual([...groupOf], [0, 1, 1, 2, 1, 1]);
});

// ---------------------------------------------------------------------------
// Real kernel output.

const faceCenter = (body, face) => {
  const points = body.faces[face].loops.flat()
    .map(use => body.vertices[body.edges[use.edge].start]);
  return [0, 1, 2].map(axis => points.reduce((sum, point) => sum + point[axis], 0)
    / points.length);
};

// Outward plane of a face as "nx,ny,nz@offset", rounded to 1e-6.
const planeKey = (body, face) => {
  const { surface, sameSense } = body.faces[face];
  const sign = sameSense === false ? -1 : 1;
  const round = value => Math.round(value * 1e6) / 1e6 + 0;
  const normal = surface.normal.map(value => round(value * sign));
  const offset = round(sign * surface.normal.reduce((sum, value, axis) => sum
    + value * surface.origin[axis], 0));
  return `${normal.join(',')}@${offset}`;
};

test('arc slot: 4 tangent line/arc transitions, 4 sharp side edges, 4 sharp rims', async () => {
  const model = await kernelModel('arc-slot', read('scripts/viewer/audit-data/arc-slot.fs'));
  const body = model.bodies[0];
  const { classes, adjacent, counts } = classifyEdges(model).bodies[0];
  assert.deepEqual(counts, { sharp: 8, tangent: 4, seam: 0, subdivision: 0, unresolved: 0 });
  const types = edge => [adjacent[2 * edge], adjacent[2 * edge + 1]]
    .map(face => body.faces[face].surface.type).sort().join('/');
  body.edges.forEach((edge, index) => {
    const name = EDGE_CLASSES[classes[index]];
    if (edge.curve.type === 'circle') assert.equal(name, 'sharp', `rim E${index + 1}`);
    else if (types(index) === 'cylinder/plane') assert.equal(name, 'tangent', `E${index + 1}`);
    else assert.equal(name, 'sharp', `E${index + 1}`);
  });
  assert.equal(logicalFaces(model).bodies[0].groups.length, 6);
});

test('bored spacer and other curved parts: periodic seams are seam edges', async () => {
  const spacer = await kernelModel('bored-spacer', read('examples/bored-spacer.fs'));
  const body = spacer.bodies[0];
  const { classes, counts } = classifyEdges(spacer).bodies[0];
  assert.deepEqual(counts, { sharp: 4, tangent: 0, seam: 2, subdivision: 0, unresolved: 0 });
  const bore = body.faces
    .findIndex(face => face.surface.type === 'cylinder' && face.sameSense === false);
  const uses = body.faces[bore].loops.flat().map(use => use.edge);
  const seam = uses.find(edge => uses.indexOf(edge) !== uses.lastIndexOf(edge));
  assert.equal(classes[seam], EDGE_CLASS.seam, 'bore seam');
  const cone = await kernelModel('conical-spacer', read('examples/conical-spacer.fs'));
  assert.deepEqual(classifyEdges(cone).bodies[0].counts,
    { sharp: 2, tangent: 0, seam: 1, subdivision: 0, unresolved: 0 });
  const cross = await kernelModel('cross-bore', read('scripts/viewer/audit-data/cross-bore.fs'));
  assert.deepEqual(classifyEdges(cross).bodies[0].counts,
    { sharp: 14, tangent: 0, seam: 1, subdivision: 0, unresolved: 0 });
  const bracket = await kernelModel('bracket', read('examples/bracket.fs'));
  assert.deepEqual(classifyEdges(bracket).bodies[0].counts,
    { sharp: 18, tangent: 0, seam: 0, subdivision: 0, unresolved: 0 });
});

test('pocket plate: 46 raw faces, 11 logical faces, 48 subdivision edges', async () => {
  const model = await kernelModel('pocket-plate',
    read('scripts/viewer/audit-data/pocket-plate.fs'));
  const body = model.bodies[0];
  const classified = classifyEdges(model).bodies[0];
  assert.deepEqual(classified.counts,
    { sharp: 44, tangent: 0, seam: 0, subdivision: 48, unresolved: 0 });
  body.construction.edgeOrigins.forEach((origin, edge) => {
    assert.equal(classified.classes[edge] === EDGE_CLASS.subdivision,
      origin.$ === 'FaceSubdivision', `E${edge + 1} ${origin.$}`);
  });
  const { groups } = logicalFaces(model, { classes: classifyEdges(model) }).bodies[0];
  assert.equal(body.faces.length, 46);
  assert.equal(groups.length, 11);
  for (const group of groups) {
    assert.equal(new Set(group.fragments.map(face => planeKey(body, face))).size, 1, group.alias);
  }
  assert.equal(new Set(groups.map(group => planeKey(body, group.fragments[0]))).size, 11);
});

test('coplanar pads: two separate pad tops on one plane stay two logical faces', async () => {
  const model = await kernelModel('coplanar-pads',
    read('scripts/viewer/qa/fixtures/coplanar-pads.fs'));
  const body = model.bodies[0];
  const { groups } = logicalFaces(model).bodies[0];
  assert.equal(groups.length, 16, '6 plate faces + 5 per pad');
  const tops = groups.filter(group => planeKey(body, group.fragments[0]) === '0,0,1@8');
  assert.equal(tops.length, 2);
  assert.deepEqual(tops.map(group => Math.round(faceCenter(body, group.fragments[0])[0])),
    [10, 30]);
  const plate = groups.filter(group => planeKey(body, group.fragments[0]) === '0,0,1@4');
  assert.equal(plate.length, 1, 'the plate top around both pads is one logical face');
  assert.ok(plate[0].fragments.length > 1);
  assert.equal(classifyEdges(model).bodies[0].counts.unresolved, 0);
});

test('frame with tab: each inner wall is one logical face across its fragments', async () => {
  const model = await kernelModel('frame-with-tab', FRAME_WITH_TAB);
  const body = model.bodies[0];
  const { groups } = logicalFaces(model).bodies[0];
  assert.equal(groups.length, 14);
  const onPlane = key => groups.filter(group => planeKey(body, group.fragments[0]) === key);
  for (const wall of ['1,0,0@8', '-1,0,0@-42', '0,1,0@8', '0,-1,0@-32']) {
    assert.equal(onPlane(wall).length, 1, `inner wall ${wall}`);
    const fragments = body.faces.map((_face, index) => index)
      .filter(face => planeKey(body, face) === wall);
    assert.deepEqual(onPlane(wall)[0].fragments, fragments, `all fragments of ${wall}`);
  }
  assert.equal(onPlane('-1,0,0@-42')[0].fragments.length, 3);
  assert.equal(onPlane('1,0,0@8')[0].fragments.length, 3);
  assert.equal(onPlane('1,0,0@50').length, 2, 'the tab separates the outer wall');
  assert.equal(classifyEdges(model).bodies[0].counts.unresolved, 0);
});

}
