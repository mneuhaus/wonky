import test from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missingBend() || missing("local design note");
if (publicTreeSkip) {
  test("hybrid-roundtrip.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { createHash } = await import("node:crypto");
const { build } = await import("../src/index.mjs");
const { loadKernel } = await import("../src/kernel.mjs");
const { validateAnalytic } = await import("../src/analytic.mjs");
const { UnsupportedFeatureError } = await import("../src/errors.mjs");
const { attachResultMesh, carrierClasses, decodeAnswer, decodeHybrid, decodeRecover, encodeJob, encodeMeshResult, encodeReal, hybridBoolean, reusableMesh, setHybridMesh, roundTripInput, runHybrid, tagOperand, toBodies, wireSurface } = await import("../src/hybrid.mjs");
const { ROUNDTRIP, roundTripInput: bakeoffRoundTripInput } = await import("../scripts/bakeoff/recover-roundtrip.mjs");
const { decodeRecover: bakeoffDecodeRecover, toBodies: bakeoffToBodies } = await import("../scripts/bakeoff/recover-brep.mjs");
const { encodeJob: bakeoffEncodeJob } = await import("../scripts/bakeoff/jobfmt.mjs");
const { tessellateBrep } = await import("../scripts/bakeoff/brep-tessellate.mjs");
const { analyticForm } = await import("../scripts/corpus/boolean-hybrid.mjs");
// The hybrid Boolean's codec src/hybrid.mjs (docs/hybrid-codec.md;
// docs/hybrid-boolean-plan.md section 8, step 6): body -> tagged job text,
// the hybrid's answer -> wonky bodies with provenance, and a recovered body's
// attached result mesh as its next job's leaf. Budget: about a minute on the
// JS target (kernel load, 13 recoveries, 3 stub-probe Booleans and a chain).















const kernel = await loadKernel();
const recover = text => kernel.hybrid['recover/main.run'](text);
const sha256 = text => createHash('sha256').update(text).digest('hex');
const validate = body => validateAnalytic(body, kernel);
const geometryOf = b => JSON.stringify({ vertices: b.vertices, edges: b.edges, faces: b.faces, shell: b.shell, voids: b.voids ?? null });

// --- comparison helpers (test side) ----------------------------------------

const tally = xs => xs.reduce((m, x) => ({ ...m, [x]: (m[x] ?? 0) + 1 }), {});
const surfaceKey = s => `${s.type}${s.radius !== undefined ? ` r${+s.radius.toFixed(9)}` : ''}${s.angle !== undefined ? ` a${+s.angle.toFixed(9)}` : ''}`;
const curveKey = c => `${c.type ?? c}${c.radius !== undefined ? ` r${+c.radius.toFixed(9)}` : ''}${c.major !== undefined ? ` ${+c.major.toFixed(9)}x${+c.minor.toFixed(9)}` : ''}`;
const nonLine = m => Object.fromEntries(Object.entries(m).filter(([k]) => !k.startsWith('line')));

// The same exact geometry in another representation: vertices bit for bit,
// every face by its oriented carrier (plane: outward normal and offset;
// cylinder/cone: axis line up to sign, radius, angle, sense) to 1e-12 and its
// loops as cycles of exact vertices with the curve kind and radius. The
// bake-off tessellator re-normalizes and quantizes the face table
// (scripts/bakeoff/brep-tessellate.mjs); the codec passes the body's values.
const r12 = x => Math.round(x * 1e12) / 1e12 + 0;
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
function carrier(f) {
  const s = f.surface, sign = f.sameSense ? 1 : -1;
  if (s.type === 'plane') { const n = s.normal.map(v => v * sign); return ['plane', ...n.map(r12), r12(dot(n, s.origin))]; }
  let a = s.axis;
  if (s.type !== 'cone' && a[a.findIndex(v => Math.abs(v) > 1e-9)] < 0) a = a.map(v => -v);
  const foot = s.origin.map((v, i) => v - a[i] * dot(s.origin, a));
  return [s.type, ...a.map(r12), ...(s.type === 'cone' ? s.origin : foot).map(r12), r12(s.radius), r12(s.angle ?? 0), sign];
}
function geometryKey(body) {
  const v = i => body.vertices[i].join(',');
  const loopKey = loop => {
    const keys = loop.map(u => {
      const e = body.edges[u.edge], [p, q] = u.forward ? [e.start, e.end] : [e.end, e.start];
      return `${v(p)}>${v(q)}:${e.curve.type ?? e.curve}${e.curve.radius !== undefined ? r12(e.curve.radius) : ''}`;
    });
    return keys.map((_, i) => [...keys.slice(i), ...keys.slice(0, i)].join('|')).sort()[0];
  };
  return JSON.stringify({ vertices: body.vertices.map(p => p.join(',')).sort(),
    faces: body.faces.map(f => JSON.stringify([carrier(f), f.loops.map(loopKey).sort()])).sort() });
}
const sameGeometry = (a, b) => a.length === b.length && JSON.stringify(a.map(geometryKey).sort()) === JSON.stringify(b.map(geometryKey).sort());

// Every recovered vertex within tol of a distinct original vertex.
function sameVertices(original, recovered, tol) {
  if (original.length !== recovered.length) return false;
  const used = new Set();
  return recovered.every(p => {
    const i = original.findIndex((q, j) => !used.has(j) && Math.max(...q.map((x, k) => Math.abs(x - p[k]))) <= tol);
    if (i < 0) return false;
    used.add(i);
    return true;
  });
}

// --- 1. body -> tagged mesh -> recover, the 13 round-trip bodies ------------

test('round trip body -> tagged mesh -> recover is exact on the 13 round-trip bodies', async () => {
  const ids = Object.keys(ROUNDTRIP);
  assert.equal(ids.length, 13);
  const exact = [];
  for (const id of ids) {
    const bodies = await ROUNDTRIP[id](kernel);
    assert.equal(bodies.length, 1, id);
    const original = bodies[0];
    const input = roundTripInput(kernel, original, { id });
    // The codec writes the bake-off round trip's bytes (OpenCascade checks
    // those in scripts/bakeoff/recover-roundtrip.mjs).
    assert.equal(input.text, bakeoffRoundTripInput(kernel, original, id).text, `${id}: job text`);
    const text = recover(input.text);
    const d = decodeRecover(text);
    assert.equal(d.status, 'ok', `${id}: ${d.reason}`);
    const classes = carrierClasses(kernel, input.job);
    const [body, ...rest] = toBodies(d.raw, id, { job: input.job, operands: [original], stats: d.stats, classes });
    assert.equal(rest.length, 0, `${id}: one body`);
    assert.equal(geometryOf(body), geometryOf(bakeoffToBodies(bakeoffDecodeRecover(text).raw, id)[0]), `${id}: decoder == bake-off decoder`);
    body.validation = validate(body);
    assert.equal(body.faces.length, original.faces.length, `${id}: faces`);
    assert.deepEqual(tally(body.faces.map(f => surfaceKey(f.surface))), tally(original.faces.map(f => surfaceKey(f.surface))), `${id}: surfaces`);
    assert.deepEqual(nonLine(tally(body.edges.map(e => curveKey(e.curve)))), nonLine(tally(original.edges.map(e => curveKey(e.curve)))), `${id}: curves`);
    // F32x2 sources (every round-trip body): recovery intersects the exact
    // carriers, so the vertices agree to 1e-9 mm (recover-roundtrip.mjs).
    assert.equal(original.precision, 'F32x2', id);
    assert.ok(sameVertices(original.vertices, body.vertices, 1e-9), `${id}: vertices within 1e-9 mm`);
    // Provenance: every face comes from the one operand, from a face on its
    // own carrier class.
    for (const f of body.provenance.faces) {
      assert.equal(f.carrier.leaf, 0);
      assert.ok(f.carrierClass.some(r => r.tag === f.tag));
    }
    // The input mesh is the result mesh here: it attaches, face by face.
    attachResultMesh([body], d.raw, d.stats, input.job.meshes[0], input.job.deviation, classes, { job: input.job, operands: [original] });
    assert.equal(body.hybridMesh.refused, undefined, `${id}: ${body.hybridMesh.refused}`);
    assert.equal(body.hybridMesh.triangles.length, input.job.meshes[0].triangles.length);
    assert.deepEqual(body.provenance.operands, [0]);
    for (const f of body.provenance.faces) assert.ok(f.sources.length >= 1 && f.sources.every(s => classes[s.tag] === f.tag));
    // The groove's two r = 8 bands share one carrier; their neighbours tell
    // them apart.
    if (id === 'rt-revolve-groove') assert.ok(new Set(body.provenance.faces.map(f => f.tag)).size < body.faces.length);
    // ... and stands for the body in its next job: recovery gives it back.
    const again = roundTripInput(kernel, body, { id });
    assert.equal(again.job.leaves[0].via, 'attached');
    const d2 = decodeRecover(recover(again.text));
    assert.equal(d2.status, 'ok', `${id} (attached mesh): ${d2.reason}`);
    assert.ok(sameGeometry(toBodies(d2.raw, id), [body]), `${id}: recovery from the attached mesh`);
    exact.push(id);
  }
  assert.equal(exact.length, 13);
});

// --- 2. the stub-probe jobs of KT2, KT6 and KS07 ---------------------------

// The R20 kernel cases' helpers (single-step-r20/kernel-cases/*/case.fs).
const HELPERS = `FeatureScript 3044;
import(path : "onshape/std/common.fs", version : "3044.0");
function ktPlane(origin is Vector, normal is Vector, xDirection is Vector) returns Plane
{
    return plane(origin * millimeter, normal, xDirection);
}
function ktPrism(context is Context, id is Id, sketchPlane is Plane, points is array, depth is number) returns Query
{
    var sketch = newSketchOnPlane(context, id + "sketch", { "sketchPlane" : sketchPlane });
    for (var i = 0; i < size(points); i += 1)
    {
        const j = (i + 1) % size(points);
        skLineSegment(sketch, "s" ~ i, { "start" : points[i] * millimeter, "end" : points[j] * millimeter });
    }
    skSolve(sketch);
    opExtrude(context, id + "extrude", { "entities" : qSketchRegion(id + "sketch", false),
        "direction" : sketchPlane.normal, "endBound" : BoundingType.BLIND, "endDepth" : depth * millimeter });
    opDeleteBodies(context, id + "clean", { "entities" : qCreatedBy(id + "sketch", EntityType.BODY) });
    return qCreatedBy(id + "extrude", EntityType.BODY);
}
function ktBlock(context is Context, id is Id, lo is Vector, hi is Vector) returns Query
{
    const base = ktPlane(vector(0, 0, lo[2]), vector(0, 0, 1), vector(1, 0, 0));
    return ktPrism(context, id, base,
        [vector(lo[0], lo[1]), vector(hi[0], lo[1]), vector(hi[0], hi[1]), vector(lo[0], hi[1])], hi[2] - lo[2]);
}
function ktCylinder(context is Context, id is Id, origin is Vector, axis is Vector, r is number, length is number) returns Query
{
    const xDirection = abs(axis[2]) > 0.9 ? vector(1, 0, 0) : vector(0, 0, 1);
    var sketch = newSketchOnPlane(context, id + "sketch", { "sketchPlane" : ktPlane(origin, axis, cross(axis, cross(xDirection, axis))) });
    skCircle(sketch, "c", { "center" : vector(0, 0) * millimeter, "radius" : r * millimeter });
    skSolve(sketch);
    opExtrude(context, id + "extrude", { "entities" : qSketchRegion(id + "sketch", false),
        "direction" : axis, "endBound" : BoundingType.BLIND, "endDepth" : length * millimeter });
    opDeleteBodies(context, id + "clean", { "entities" : qCreatedBy(id + "sketch", EntityType.BODY) });
    return qCreatedBy(id + "extrude", EntityType.BODY);
}
`;
const operandsOf = async body => (await build(`${HELPERS}
export const operands = defineFeature(function(context is Context, id is Id, definition is map)
    precondition {}
    {
${body}
    });
`, { feature: 'operands' })).bodies;

// The Boolean each case hands to the hybrid, with its operands built as the
// case builds them, and the sha256 of the stub probe's job and of the native
// answer (tmp/corpus/boolean-capability/hybrid/<pid>/0.job, `exact` + 0.brep;
// local design note section 3; local-development-evidence).
const STUB = {
  kt2: {
    operation: 'SUBTRACTION', job: 'd700dea29c21621ee6eee8b7e13a4541d0c153d3a69d09ee3f8e27bb805fb4b9', answer: 'e5b7a3522379cec923a7374562e4b2ec0581284a0e872ec8375b762d5ef92c23',
    body: `        ktBlock(context, id + "block", vector(-20, -20, 0), vector(20, 20, 12));
        ktCylinder(context, id + "seat", vector(0, 0, 12 - 7.3), vector(0, 0, 1), 11.1, 7.3 + 0.5);`,
  },
  kt6: {
    operation: 'UNION', job: '96093eeb9a976547fedaa064ddc9c2fbec25010eca5080b0401b9047de77f527', answer: '2f1674cbd535c657a11fbd44e3a5c4b56c98be58fed19cb65d1463a441578337',
    body: `        const a = ktBlock(context, id + "a", vector(0, 0, 0), vector(20, 20, 10));
        const b = ktBlock(context, id + "b", vector(19.5, 0, 0), vector(40, 20, 10));
        ktBlock(context, id + "c", vector(39.5, 19.5, 0), vector(50, 30, 10));
        opBoolean(context, id + "union", { "tools" : qUnion([a, b]), "operationType" : BooleanOperationType.UNION });`,
  },
  ks07: {
    operation: 'UNION', job: '1e98e26ba7e261128fc100519e9849439716e9e24a64955887bc86b6e64389c2', answer: 'd14e4627d817e9dcd9d4661c464e8962a5824eb302140fb567af7db3e8d4c513',
    body: `        ktBlock(context, id + "a", vector(0, 0, 0), vector(30, 20, 10));
        const c = cos(7 * degree);
        const s = sin(7 * degree);
        var pts = [];
        for (var p in [vector(0, 0), vector(20, 0), vector(20, 20), vector(0, 20)])
            pts = append(pts, vector(25 + c * p[0] - s * p[1], s * p[0] + c * p[1]));
        ktPrism(context, id + "b", ktPlane(vector(0, 0, 0), vector(0, 0, 1), vector(1, 0, 0)), pts, 10);`,
  },
};

// The bake-off route's job (scripts/corpus/boolean-hybrid.mjs: brep-tessellate
// of analyticForm, face table from the tessellator, job id of its first call).
function bakeoffJob(operands, operation) {
  const faces = [], meshes = [], prims = [];
  operands.forEach((body, leaf) => {
    const t = tessellateBrep(analyticForm(body), 0.01), tagOf = new Map();
    for (const f of t.faces) { tagOf.set(f.faceIndex, faces.length); faces.push({ leaf, faceIndex: f.faceIndex, surface: f.surface }); }
    meshes.push({ leaf, vertices: t.vertices, triangles: t.triangles.map(([p, q, r, f]) => [p, q, r, tagOf.get(f)]) });
    prims.push({ kind: 'brep', params: [], matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0] });
  });
  const op = { UNION: 'union', SUBTRACTION: 'subtract' }[operation];
  return bakeoffEncodeJob({ id: 'hybrid-1', deviation: 0.01, tree: { op, children: [{ leaf: 0 }, { leaf: 1 }] }, prims, faces, meshes });
}

for (const [key, c] of Object.entries(STUB)) {
  test(`${key}: the stub-probe job decodes to the bake-off route's B-rep; the codec's own job gives the same geometry`, async () => {
    const operands = await operandsOf(c.body);
    assert.equal(operands.length, 2);
    const jobText = bakeoffJob(operands, c.operation);
    assert.equal(sha256(jobText), c.job, 'the rebuilt operands give the stub probe\'s job byte for byte');
    const { text, meshText } = runHybrid(kernel, jobText);
    assert.equal(text, kernel.hybrid.boolean(jobText), 'runHybrid answers as the entry');
    assert.equal(sha256(text), c.answer, 'the JS answer is the native stub probe\'s');
    const decoded = decodeHybrid(text, { id: key, validate });
    assert.equal(decoded.status, 'exact');
    const bakeoff = bakeoffToBodies(bakeoffDecodeRecover(`ok\n${text.slice('exact\n'.length)}`).raw, key);
    assert.deepEqual(decoded.bodies.map(geometryOf), bakeoff.map(geometryOf), 'same B-rep as the bake-off decoder');

    const mine = hybridBoolean(kernel, operands, c.operation, { id: `model/${key}`, validate });
    assert.equal(mine.status, 'exact', mine.reason);
    assert.ok(sameGeometry(mine.bodies, bakeoff), 'the codec\'s own job recovers the same exact geometry');
    for (const body of mine.bodies) {
      assert.equal(body.construction.method, 'hybrid corefine+recover');
      assert.equal(body.hybridMesh.refused, undefined, body.hybridMesh.refused);
      assert.equal(body.hybridMesh.deviationMm, 0.01);
      // Every face names its sources, from the operands' face tables.
      for (const f of body.provenance.faces) {
        assert.ok(f.sources.length >= 1);
        for (const s of f.sources) assert.ok(operands[s.leaf] && s.face < operands[s.leaf].faces.length && s.operand === operands[s.leaf].id);
      }
    }
    if (key === 'kt6') {
      // The top face at z = 10 of (a u b) u c comes from the three coplanar
      // tops of a u b and the top of c: four sources, both operands.
      const top = mine.bodies[0].provenance.faces.find((_, i) => {
        const s = mine.bodies[0].faces[i].surface;
        return s.type === 'plane' && s.normal[2] === 1 && s.origin[2] === 10;
      });
      assert.equal(top.sources.length, 4);
      assert.deepEqual([...new Set(top.sources.map(s => s.leaf))], [0, 1]);
      assert.deepEqual(mine.bodies[0].provenance.operands, [0, 1]);
    }
    assert.deepEqual(mine.job.leaves.map(l => l.via), ['print-mesh', 'print-mesh']);
  });
}

// --- 3. a chain through attached meshes -------------------------------------

test('KT2 chain: the recovered body re-enters each job by its attached mesh, exact at every step', async () => {
  const [block, seat, bore, hole] = await operandsOf(`        ktBlock(context, id + "block", vector(-20, -20, 0), vector(20, 20, 12));
        ktCylinder(context, id + "seat", vector(0, 0, 12 - 7.3), vector(0, 0, 1), 11.1, 7.3 + 0.5);
        ktCylinder(context, id + "bore", vector(0, 0, -0.5), vector(0, 0, 1), 6.0, 13.0);
        ktCylinder(context, id + "hole0", vector(-15.5, -15.5, -0.5), vector(0, 0, 1), 1.7, 13.0);`);
  let body = block, reference = block;
  for (const [step, tool] of [seat, bore, hole].entries()) {
    const r = hybridBoolean(kernel, [body, tool], 'SUBTRACTION', { id: `chain${step}`, validate });
    assert.equal(r.status, 'exact', r.reason);
    if (step > 0) assert.equal(r.job.leaves[0].via, 'attached');
    const b = decodeHybrid(runHybrid(kernel, bakeoffJob([reference, tool], 'SUBTRACTION')).text, { id: `chain${step}` });
    assert.ok(sameGeometry(r.bodies, b.bodies), `step ${step}: same geometry as re-tessellating every step`);
    assert.equal(r.bodies[0].faces.length, 8 + step);
    [body] = r.bodies;
    [reference] = b.bodies;
  }
  // The attached mesh is not body data: exports and copies do not carry it.
  assert.ok(!JSON.stringify(body).includes('hybridMesh'));
  assert.match(reusableMesh(structuredClone(body), 0.01).reason, /no attached hybrid mesh/);
  // A changed body no longer matches its attached mesh.
  const moved = setHybridMesh({ ...body, vertices: body.vertices.map(p => [p[0] + 1, p[1], p[2]]) }, body.hybridMesh);
  assert.match(reusableMesh(moved, 0.01).reason, /changed after its hybrid mesh was attached/);
  assert.match(reusableMesh(body, 0.005).reason, /holds 0.01 mm, the job asks for 0.005 mm/);
  assert.ok(reusableMesh(body, 0.02).mesh);
});

// --- 4. codec units ----------------------------------------------------------

test('job text: the bake-off grammar byte for byte, all five carrier wire forms, read by Bend', () => {
  const surfaces = [
    { type: 'plane', origin: [0, 0, 1], normal: [0, 0, 1], x: [1, 0, 0] },
    { type: 'cylinder', origin: [0, 0, 0], axis: [0, 0, 1], x: [1, 0, 0], radius: 2.5 },
    { type: 'cone', origin: [0, 0, 0], axis: [0, 0, 1], x: [1, 0, 0], radius: 2, angle: 0.5 },
    { type: 'sphere', origin: [1, 2, 3], axis: [0, 0, 1], x: [1, 0, 0], radius: 0.75 },
    { type: 'torus', origin: [0, 0, 5], axis: [0, 1, 0], x: [1, 0, 0], major: 12, minor: 3 },
  ];
  const job = { id: 'wire', deviation: 0.01, tree: { op: 'union', children: [{ leaf: 0 }, { leaf: 1 }] },
    prims: [0, 1].map(() => ({ kind: 'brep', params: [], matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0] })),
    faces: surfaces.map((s, i) => ({ leaf: i < 3 ? 0 : 1, faceIndex: i, surface: wireSurface(s) })), meshes: [] };
  assert.equal(encodeJob(job), bakeoffEncodeJob(job));
  assert.deepEqual(wireSurface(surfaces[3]), { type: 'sphere', o: [1, 2, 3], r: 0.75 });
  assert.deepEqual(wireSurface(surfaces[4]), { type: 'torus', o: [0, 0, 5], n: [0, 1, 0], R: 12, r: 3 });
  // Bend parses the table and classes it: five distinct carriers.
  assert.deepEqual(carrierClasses(kernel, job), [0, 1, 2, 3, 4]);
  const twice = { ...job, faces: [...job.faces, { leaf: 1, faceIndex: 5, surface: wireSurface({ ...surfaces[0], origin: [7, -3, 1] }) }] };
  assert.deepEqual(carrierClasses(kernel, twice), [0, 1, 2, 3, 4, 0], 'the same plane through another origin is the same carrier');
  assert.throws(() => wireSurface({ type: 'nurbs' }), error => error instanceof UnsupportedFeatureError && /nurbs face has no job wire form/.test(error.message));
  // Coordinates are written as Bend gave them, never rounded.
  const tenth = Math.fround(0.1) + Math.fround(0.1 - Math.fround(0.1));
  assert.equal(encodeReal(tenth), `${new Uint32Array(new Float32Array([0.1]).buffer)[0]} ${new Uint32Array(new Float32Array([0.1 - Math.fround(0.1)]).buffer)[0]}`);
  assert.throws(() => encodeReal(Math.PI), /not an F32x2 value/);
  assert.equal(encodeMeshResult({ vertices: [[0, 0, 0]], triangles: [] }), 'ok\nmesh 1 0\n0 0 0 0 0 0\nend\n');
});

test('answers: exact, a certified mesh that is never exact, and named refusals', () => {
  assert.deepEqual(decodeAnswer('unresolved non-manifold contact (point)\nend\n'), { status: 'unresolved', reason: 'non-manifold contact (point)' });
  const mesh = decodeHybrid('mesh 1008981770 796246671 cylinder/cylinder intersection off a common axis is a space quartic\nmesh 3 1\n0 0 0 0 0 0\n1065353216 0 0 0 0 0\n0 0 1065353216 0 0 0\n0 1 2 0\nend\n');
  assert.equal(mesh.status, 'mesh');
  assert.equal(mesh.exact, false);
  assert.equal(mesh.approximation, true);
  assert.ok(Math.abs(mesh.deviationMm - 0.01) < 1e-15);
  assert.match(mesh.reason, /space quartic/);
  assert.deepEqual(mesh.mesh.triangles, [[0, 1, 2, 0]]);
  assert.throws(() => decodeAnswer('ok\n'), /bad status line/);
  assert.throws(() => decodeAnswer('unresolved\nend\n'), /without a reason/);
});

test('attached mesh: declines by name where the tags do not force the assignment', async () => {
  const [box] = await ROUNDTRIP['rt-box'](kernel);
  const input = roundTripInput(kernel, box, { id: 'box' });
  const d = decodeRecover(recover(input.text));
  const classes = carrierClasses(kernel, input.job);
  const attach = stats => {
    const bodies = toBodies(d.raw, 'box', { job: input.job, stats, classes });
    attachResultMesh(bodies, d.raw, stats, input.job.meshes[0], 0.01, classes, { job: input.job });
    return bodies[0].hybridMesh;
  };
  assert.equal(attach(d.stats).refused, undefined);
  assert.match(attach({ ...d.stats, slivers: 2 }).refused, /2 sliver patches were absorbed/);
  // Unified carriers within recover's own carrier tolerance are one class
  // there too; the replay decides (here it succeeds). Beyond it, declined.
  assert.equal(attach({ ...d.stats, unifiedClasses: 1, unifiedToleranceMm: 1e-12 }).refused, undefined);
  assert.match(attach({ ...d.stats, unifiedClasses: 1, unifiedToleranceMm: 1e-6 }).refused, /coplanar carriers were unified within 0.000001 mm, beyond recover's carrier tolerance/);
  // A second, disjoint copy of the mesh has no recovered shell of its own.
  const m = input.job.meshes[0], n = m.vertices.length;
  const doubled = { vertices: [...m.vertices, ...m.vertices.map(p => [p[0] + 100, p[1], p[2]])], triangles: [...m.triangles, ...m.triangles.map(([a, b, c, t]) => [a + n, b + n, c + n, t])] };
  const bodies = toBodies(d.raw, 'box', { job: input.job, stats: d.stats, classes });
  attachResultMesh(bodies, d.raw, d.stats, doubled, 0.01, classes);
  assert.match(bodies[0].hybridMesh.refused, /two mesh components match one recovered shell/);
  // Faces on one carrier whose neighbours are the same carriers are told
  // apart by their vertices. (The groove's planes and its cones merged into
  // one class each, so the two bands and the two planes each neighbour the
  // same classes.)
  const [groove] = await ROUNDTRIP['rt-revolve-groove'](kernel);
  const g = roundTripInput(kernel, groove, { id: 'groove' });
  const gd = decodeRecover(recover(g.text));
  const gc = carrierClasses(kernel, g.job);
  const merge = new Map();
  for (const type of ['plane', 'cone']) {
    const tags = [...new Set(gd.raw.faces.filter(f => f.surface.type === type).map(f => f.tag))];
    assert.equal(tags.length, 2, type);
    merge.set(tags[1], tags[0]);
  }
  const mergedClasses = gc.map(c => merge.get(c) ?? c);
  const mergedRaw = { ...gd.raw, faces: gd.raw.faces.map(f => ({ ...f, tag: merge.get(f.tag) ?? f.tag })) };
  const merged = toBodies(mergedRaw, 'groove', { job: g.job, stats: gd.stats, classes: mergedClasses });
  attachResultMesh(merged, mergedRaw, gd.stats, g.job.meshes[0], 0.01, mergedClasses);
  assert.equal(merged[0].hybridMesh.refused, undefined);
  // Each merged face keeps the triangles of its own carrier (the plane or cone
  // its tag first named, and the one merged into it): its own triangles only.
  const own = merged[0].hybridMesh.triangles;
  merged[0].faces.forEach((face, i) => {
    if (!['plane', 'cone'].includes(face.surface.type)) return;
    const onFace = own.filter(t => t[3] === i);
    assert.ok(onFace.length > 0, `face ${i}`);
    if (face.surface.type === 'plane') {
      const { origin: o, normal: n } = face.surface;
      const off = p => Math.abs((p[0] - o[0]) * n[0] + (p[1] - o[1]) * n[1] + (p[2] - o[2]) * n[2]);
      assert.equal(onFace.filter(t => t.slice(0, 3).some(v => off(merged[0].hybridMesh.vertices[v]) > 1e-9)).length, 0, `face ${i} took a triangle off its plane`);
    }
  });
  // Planted: the same mesh 1 mm away matches no face by its vertices: declined.
  const shifted = { ...g.job.meshes[0], vertices: g.job.meshes[0].vertices.map(p => [p[0] + 1, p[1], p[2]]) };
  const moved = toBodies(mergedRaw, 'groove', { job: g.job, stats: gd.stats, classes: mergedClasses });
  attachResultMesh(moved, mergedRaw, gd.stats, shifted, 0.01, mergedClasses);
  assert.match(moved[0].hybridMesh.refused, /2 faces on carrier \d+ are not told apart by their neighbours or by their vertices/);
  // A declined body is meshed again by the encoder, which says why.
  const again = tagOperand(kernel, setHybridMesh(structuredClone(box), { refused: 'test' }), 0.01);
  assert.equal(again.via, 'print-mesh');
  assert.match(again.reuseDeclined, /refused: test/);
  // The statement text travels with the bodies.
  assert.match(toBodies(d.raw, 'box', { stats: { ...d.stats, unifiedClasses: 2, unifiedToleranceMm: 5e-13 } })[0].provenance.statements[0].text, /unified within 2\^-44\*scale \(2 classes/);
});

}
