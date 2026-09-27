// The hybrid Boolean's codec (docs/hybrid-codec.md; docs/hybrid-boolean-plan.md
// section 8, step 6): wonky bodies -> hybrid job text, and the hybrid's answer
// -> wonky bodies with provenance. I/O only. Every coordinate that enters a job
// comes from Bend (printMesh samples in kernel/tessellate.bend, or the vertices
// of an earlier hybrid result), and every coordinate of a decoded body is the
// F32x2 Real recover wrote. This module decides no geometry: it welds equal
// coordinates, numbers faces, groups triangles by shared vertices and matches
// tags, nothing else.
//
// The grammar is the bake-off job/result format (docs/bakeoff.md "Job
// format"; kernel/hybrid/mesh-io.bend is the Bend side) and the hybrid entry's
// answer (kernel/hybrid/main.bend header); scripts/bakeoff/jobfmt.mjs and
// recover-brep.mjs are the test harness's copies, and test/hybrid-roundtrip
// checks that both produce the same bytes and the same bodies.

import { fail, unsupported } from './errors.mjs';
import { geometryRevision } from './identity.mjs';
import { printMesh } from './print-mesh.mjs';
import { isMeshBody, meshDescription } from './hybrid-mesh.mjs';

// ---------------------------------------------------------------------------
// Reals: two F32 bit patterns, hi = fround(x), lo = fround(x - hi); the value
// is hi + lo.

const f32 = new Float32Array(1);
const u32 = new Uint32Array(f32.buffer);
const bitsOf = x => { f32[0] = x; return u32[0]; };
const fromBits = w => { u32[0] = w >>> 0; return f32[0]; };

export function encodeReal(x) {
  if (!Number.isFinite(x)) fail(`Hybrid job: non-finite real ${x}`);
  if (x === 0) x = 0; // no negative zero on the wire
  const hi = Math.fround(x), lo = Math.fround(x - hi);
  if (hi + lo !== x) fail(`Hybrid job: ${x} is not an F32x2 value; the encoder writes Bend's coordinates, it does not round them`);
  return `${bitsOf(hi)} ${bitsOf(lo)}`;
}

// A parameter (the job deviation) is written as its nearest F32x2 value; the
// job states that value, and recover checks against it.
const encodeParameter = x => { const hi = Math.fround(x); return encodeReal(hi + Math.fround(x - hi)); };

export const decodeReal = (hi, lo) => fromBits(Number(hi)) + fromBits(Number(lo));

// ---------------------------------------------------------------------------
// Encoder

export const HYBRID_DEVIATION_MM = 0.01;
const OPS = { UNION: 'union', SUBTRACTION: 'subtract', INTERSECTION: 'intersect' };
const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];

// The wire form of a body surface (the job's face table). sphere and torus
// carry only what the job grammar has (origin, radius; origin, axis, radii).
export function wireSurface(s) {
  switch (s.type) {
    case 'plane': return { type: 'plane', o: s.origin, n: s.normal, x: s.x };
    case 'cylinder': return { type: 'cylinder', o: s.origin, n: s.axis, x: s.x, r: s.radius };
    case 'cone': return { type: 'cone', o: s.origin, n: s.axis, x: s.x, r: s.radius, a: s.angle };
    case 'sphere': return { type: 'sphere', o: s.origin, r: s.radius };
    case 'torus': return { type: 'torus', o: s.origin, n: s.axis, R: s.major, r: s.minor };
    default: return unsupported(`Hybrid Boolean: a ${s?.type} face has no job wire form`);
  }
}

const surfaceReals = s => {
  switch (s.type) {
    case 'plane': return [...s.o, ...s.n, ...s.x];
    case 'cylinder': return [...s.o, ...s.n, ...s.x, s.r];
    case 'cone': return [...s.o, ...s.n, ...s.x, s.r, s.a];
    case 'sphere': return [...s.o, s.r];
    case 'torus': return [...s.o, ...s.n, s.R, s.r];
    default: return fail(`Hybrid job: unknown surface ${s.type}`);
  }
};

// Equal coordinates become one vertex (exact key; a printMesh triangle list
// repeats every shared sample point bit for bit).
function weld(triangleCoordinates, tags) {
  const index = new Map(), vertices = [];
  const vid = p => {
    const key = p.join(',');
    if (!index.has(key)) { index.set(key, vertices.length); vertices.push(p); }
    return index.get(key);
  };
  return { vertices, triangles: triangleCoordinates.map((t, i) => [...t.map(vid), tags[i]]) };
}

// A body's attached hybrid mesh, when it may stand for the body in a job at
// deviationMm: the body is unchanged since the mesh was attached (its
// geometry revision) and the mesh holds the deviation. Otherwise the reason.
export function reusableMesh(body, deviationMm) {
  const m = body.hybridMesh;
  if (!m) return { reason: 'no attached hybrid mesh' };
  if (m.refused) return { reason: `attached hybrid mesh refused: ${m.refused}` };
  if (!(m.deviationMm <= deviationMm)) return { reason: `attached hybrid mesh holds ${m.deviationMm} mm, the job asks for ${deviationMm} mm` };
  if (m.revision !== geometryRevision(body)) return { reason: 'the body changed after its hybrid mesh was attached' };
  return { mesh: m };
}

// One operand as a tagged leaf: vertices, triangles [a, b, c, body face
// index], the face table in body face order, and where the mesh came from.
export function tagOperand(kernel, body, deviationMm = HYBRID_DEVIATION_MM) {
  const faces = body.faces.map((f, i) => ({ faceIndex: i, surface: wireSurface(f.surface) }));
  // A certified-mesh body (src/hybrid-mesh.mjs) is its mesh: every triangle
  // is tagged with its face, whose carrier is exact. It cannot be re-meshed
  // finer than it holds.
  if (isMeshBody(body)) {
    const m = body.mesh;
    if (!(m?.deviationMm <= deviationMm)) unsupported(`Hybrid Boolean: the operand ${meshDescription(body)} holds ${m?.deviationMm} mm; the job asks for ${deviationMm} mm, and a certified mesh cannot be refined`);
    return { vertices: m.vertices, triangles: m.triangles, faces, via: 'certified-mesh', deviationMm: m.deviationMm };
  }
  const reuse = reusableMesh(body, deviationMm);
  if (reuse.mesh) {
    return { vertices: reuse.mesh.vertices, triangles: reuse.mesh.triangles, faces, via: 'attached',
      deviationMm: reuse.mesh.deviationMm };
  }
  const declined = body.hybridMesh ? { reuseDeclined: reuse.reason } : {};
  const mesh = printMesh(kernel, body, deviationMm, { tags: true });
  return { ...weld(mesh.triangles, mesh.tags), faces, via: 'print-mesh', achievedDeviationMm: mesh.achievedDeviationMm,
    deviationMm, ...declined };
}

// tree: {leaf: operandIndex} | {op: 'union'|'subtract'|'intersect', children: [a, b]}.
export const binaryTree = operation => {
  if (!OPS[operation]) fail(`Hybrid Boolean: invalid operation '${operation}'`);
  return { op: OPS[operation], children: [{ leaf: 0 }, { leaf: 1 }] };
};

// The job object for operands under tree. Leaf i is operands[i]; tags number
// the face table leaf by leaf in body face order, so tag -> (leaf, face) is
// the table itself. `leaves` records how each operand was meshed.
export function hybridJob(kernel, operands, tree, { deviationMm = HYBRID_DEVIATION_MM, id = 'hybrid' } = {}) {
  if (!/^\S+$/.test(id)) fail(`Hybrid job id must be one word, got '${id}'`);
  const faces = [], meshes = [], prims = [], leaves = [];
  operands.forEach((body, leaf) => {
    const t = tagOperand(kernel, body, deviationMm);
    const base = faces.length;
    for (const f of t.faces) faces.push({ leaf, faceIndex: f.faceIndex, surface: f.surface });
    meshes.push({ leaf, vertices: t.vertices, triangles: t.triangles.map(([a, b, c, f]) => [a, b, c, base + f]) });
    prims.push({ kind: 'brep', params: [], matrix: IDENTITY });
    leaves.push({ via: t.via, faces: t.faces.length, vertices: t.vertices.length, triangles: t.triangles.length,
      ...(t.achievedDeviationMm !== undefined ? { achievedDeviationMm: t.achievedDeviationMm } : {}),
      ...(t.reuseDeclined ? { reuseDeclined: t.reuseDeclined } : {}) });
  });
  return { id, deviation: deviationMm, tree, prims, faces, meshes, leaves };
}

const countNodes = node => (node.leaf !== undefined ? 1 : 1 + countNodes(node.children[0]) + countNodes(node.children[1]));
function encodeTree(node, out) {
  if (node.leaf !== undefined) { out.push(`leaf ${node.leaf}`); return; }
  if (!Object.values(OPS).includes(node.op)) fail(`Hybrid job: unknown tree node ${node.op}`);
  out.push(node.op);
  encodeTree(node.children[0], out);
  encodeTree(node.children[1], out);
}
const encodeMesh = (mesh, out) => {
  for (const v of mesh.vertices) out.push(v.map(encodeReal).join(' '));
  for (const t of mesh.triangles) out.push(t.join(' '));
};

export function encodeJob(job) {
  const out = ['wonky-bakeoff-job 1', `case ${job.id}`, `deviation ${encodeParameter(job.deviation)}`, `nodes ${countNodes(job.tree)}`];
  encodeTree(job.tree, out);
  out.push(`prims ${job.prims.length}`);
  for (const p of job.prims) out.push(`prim ${p.kind} ${p.params.length} ${[...p.params, ...p.matrix].map(encodeReal).join(' ')}`);
  out.push(`faces ${job.faces.length}`);
  for (const f of job.faces) out.push(`face ${f.leaf} ${f.faceIndex} ${f.surface.type} ${surfaceReals(f.surface).map(encodeReal).join(' ')}`);
  out.push(`meshes ${job.meshes.length}`);
  for (const m of job.meshes) {
    out.push(`mesh ${m.leaf} ${m.vertices.length} ${m.triangles.length}`);
    encodeMesh(m, out);
  }
  out.push('end');
  return out.join('\n') + '\n';
}

// A tagged mesh as a result text (`ok` + mesh): recover's second input.
export function encodeMeshResult(mesh) {
  const out = ['ok', `mesh ${mesh.vertices.length} ${mesh.triangles.length}`];
  encodeMesh(mesh, out);
  out.push('end');
  return out.join('\n') + '\n';
}

// Recover mode's input for one body (the round trip body -> tagged mesh ->
// recover): a job with one brep leaf, followed by that leaf's mesh as the
// result. Recover must give the body back.
export function roundTripInput(kernel, body, { deviationMm = HYBRID_DEVIATION_MM, id = 'roundtrip' } = {}) {
  const job = hybridJob(kernel, [body], { leaf: 0 }, { deviationMm, id });
  return { job, text: encodeJob(job) + encodeMeshResult(job.meshes[0]) };
}

// ---------------------------------------------------------------------------
// Running the entry (kernel.hybrid = kernel/hybrid/main.bend)

// The answer of hybrid.boolean(jobText), byte for byte, plus corefine's result
// text, which the `exact` answer does not repeat and a recovered body keeps as
// its attached mesh. The stages are the entry's own (boolean = show(finish(m,
// map(m))) with m = mid.of(corefine)); corefine's refusal is the answer as is.
export function runHybrid(kernel, jobText) {
  const h = kernel.hybrid;
  if (!h) unsupported('The hybrid Boolean is not loaded in this kernel');
  const meshText = h['corefine/main.run'](jobText);
  if (!meshText.startsWith('ok\n')) return { text: meshText, meshText: null };
  const mid = h['mid.go'](meshText, h.rjob(jobText));
  return { text: h.show(h.finish(mid, h.map(mid))), meshText };
}

const bendArray = l => { const out = []; for (; l.$ === 'Con'; l = l.tail) out.push(l.head); if (l.$ !== 'Nil') fail('Hybrid: invalid Bend list'); return out; };

// recover's carrier classes of the job's face table: class of a tag = the
// first tag whose carrier is the same surface (kernel/hybrid/recover/topo.bend
// stage 1, S.same, decided in Bend; the face-table part of the job only). A
// recovered face's tag is its class; a triangle of tag t lies in a face of tag
// classes[t]. Carrier unification (rotated near-coplanar planes, `unified`)
// is not part of this table.
export function carrierClasses(kernel, job) {
  const h = kernel.hybrid;
  if (!h) unsupported('The hybrid Boolean is not loaded in this kernel');
  const parsed = h['mesh-io.parse_job'](encodeJob({ ...job, meshes: [] }));
  if (parsed.$ !== 'Parsed') fail(`Hybrid job face table does not parse: ${parsed.reason}`);
  const classes = bendArray(h['recover/topo.cls.go'](h['recover/topo.surfs.go'](parsed.job.faces, { $: 'Nil' }), job.faces.length));
  if (classes.length !== job.faces.length || classes.some((c, t) => !(Number.isInteger(c) && c <= t && classes[c] === c)))
    fail('Hybrid carrier classes are not a class table of the face table');
  return classes;
}

// ---------------------------------------------------------------------------
// Decoder

class Tokens {
  constructor(text, what) { this.words = text.split(/\s+/).filter(Boolean); this.i = 0; this.what = what; }
  word() {
    if (this.i >= this.words.length) fail(`${this.what}: unexpected end`);
    return this.words[this.i++];
  }
  expect(w) {
    const got = this.word();
    if (got !== w) fail(`${this.what}: expected '${w}', got '${got}' at token ${this.i - 1}`);
  }
  u32() {
    const w = this.word();
    if (!/^\d+$/.test(w) || Number(w) > 0xffffffff) fail(`${this.what}: expected U32, got '${w}' at token ${this.i - 1}`);
    return Number(w);
  }
  bool() {
    const v = this.u32();
    if (v > 1) fail(`${this.what}: expected 0/1, got ${v}`);
    return v === 1;
  }
  real() { const hi = this.u32(); return decodeReal(hi, this.u32()); }
  vec() { return [this.real(), this.real(), this.real()]; }
}

// A result text (`ok` + tagged mesh | `unresolved <reason>`).
export function decodeMeshResult(text) {
  const nl = text.indexOf('\n'), first = (nl < 0 ? text : text.slice(0, nl)).trim();
  if (first.startsWith('unresolved')) return { status: 'unresolved', reason: first.slice(10).trim() };
  if (first !== 'ok') fail(`Hybrid mesh result: bad status line '${first.slice(0, 80)}'`);
  const tok = new Tokens(text.slice(nl + 1), 'Hybrid mesh result');
  tok.expect('mesh');
  const nv = tok.u32(), nt = tok.u32();
  const vertices = Array.from({ length: nv }, () => tok.vec());
  const triangles = Array.from({ length: nt }, () => [tok.u32(), tok.u32(), tok.u32(), tok.u32()]);
  tok.expect('end');
  return { status: 'ok', mesh: { vertices, triangles } };
}

const curve = tok => {
  const type = tok.word();
  if (type === 'line') return { type, origin: tok.vec(), direction: tok.vec() };
  if (type === 'circle') return { type, origin: tok.vec(), normal: tok.vec(), x: tok.vec(), radius: tok.real() };
  if (type === 'ellipse') return { type, origin: tok.vec(), normal: tok.vec(), x: tok.vec(), major: tok.real(), minor: tok.real() };
  return fail(`Recovered B-rep: unknown curve '${type}'`);
};
const surface = tok => {
  const type = tok.word();
  if (type === 'plane') return { type, origin: tok.vec(), normal: tok.vec(), x: tok.vec() };
  if (type === 'cylinder') return { type, origin: tok.vec(), axis: tok.vec(), x: tok.vec(), radius: tok.real() };
  if (type === 'cone') return { type, origin: tok.vec(), axis: tok.vec(), x: tok.vec(), radius: tok.real(), angle: tok.real() };
  // Same field order as kernel/analytic.bend Sphere{origin, axis, x, radius}
  // and Torus{origin, axis, x, major, minor}.
  if (type === 'sphere') return { type, origin: tok.vec(), axis: tok.vec(), x: tok.vec(), radius: tok.real() };
  if (type === 'torus') return { type, origin: tok.vec(), axis: tok.vec(), x: tok.vec(), major: tok.real(), minor: tok.real() };
  return fail(`Recovered B-rep: unknown surface '${type}'`);
};

const STATS = ['tris', 'meshVertices', 'patches', 'corners', 'closedEdges', 'seams', 'loops', 'bodies'];
const STATS_REAL = ['maxBoundaryDeviationMm', 'maxDeviationOverBound', 'maxVertexDriftMm', 'maxDriftOverBound', 'maxVertexResidualMm', 'maxTagResidualMm', 'minVertexDet'];

// recover's B-rep text (kernel/hybrid/recover/main.bend header), with its
// leading `ok` line -> {status: 'ok', raw: {vertices, edges, faces}, stats}
// | {status: 'unresolved', reason}.
export function decodeRecover(text) {
  const nl = text.indexOf('\n'), first = (nl < 0 ? text : text.slice(0, nl)).trim();
  if (first.startsWith('unresolved')) return { status: 'unresolved', reason: first.slice(10).trim() };
  if (first !== 'ok') fail(`Recovered B-rep: bad status line '${first.slice(0, 80)}'`);
  const tok = new Tokens(text.slice(nl + 1), 'Recovered B-rep');
  tok.expect('brep');
  const nb = tok.u32(), nv = tok.u32(), ne = tok.u32(), nf = tok.u32();
  const vertices = [];
  for (let i = 0; i < nv; i++) { tok.expect('v'); vertices.push(tok.vec()); }
  const edges = [];
  for (let i = 0; i < ne; i++) {
    tok.expect('e');
    const start = tok.u32(), end = tok.u32(), c = curve(tok), seam = tok.bool();
    const e = { start, end, curve: c, sameSense: true, seam, boundaryDeviationMm: tok.real(), certifiedBoundMm: tok.real() };
    const ranged = tok.bool(), t0 = tok.real(), t1 = tok.real();
    if (ranged) e.curveRange = [t0, t1];
    edges.push(e);
  }
  const faces = [];
  for (let i = 0; i < nf; i++) {
    tok.expect('f');
    const body = tok.u32(), shell = tok.u32(), sameSense = tok.bool(), s = surface(tok), tag = tok.u32(), nloops = tok.u32();
    const loops = [], outer = [];
    for (let k = 0; k < nloops; k++) {
      tok.expect('l');
      outer.push(tok.bool());
      const n = tok.u32(), uses = [];
      for (let j = 0; j < n; j++) uses.push({ edge: tok.u32(), forward: tok.bool() });
      loops.push(uses);
    }
    faces.push({ body, shell, surface: s, sameSense, tag, loops, outer });
  }
  tok.expect('stats');
  const stats = {};
  for (const k of STATS) stats[k] = tok.u32();
  for (const k of STATS_REAL) stats[k] = tok.real();
  stats.slivers = tok.u32();
  if (tok.words[tok.i] === 'unified') {
    tok.word();
    stats.unifiedClasses = tok.u32();
    stats.unifiedToleranceMm = tok.real();
    // classes past the 32-bit class limit (kernel/hybrid/unify.bend), only when > 0
    if (tok.words[tok.i] !== 'end') stats.unifiedOverLimit = tok.u32();
  }
  tok.expect('end');
  if (new Set(faces.map(f => f.body)).size !== nb) fail('Recovered B-rep: body count disagrees with face body ids');
  return { status: 'ok', raw: { vertices, edges, faces }, stats };
}

// The hybrid entry's answer -> {status: 'exact', brep: decodeRecover(...)}
// | {status: 'mesh', deviationMm, reason, mesh} | {status: 'unresolved', reason}.
export function decodeAnswer(text) {
  const nl = text.indexOf('\n'), first = nl < 0 ? text : text.slice(0, nl), rest = nl < 0 ? '' : text.slice(nl + 1);
  if (first === 'exact') return { status: 'exact', brep: decodeRecover(`ok\n${rest}`) };
  if (first.startsWith('mesh ')) {
    const m = /^mesh (\d+) (\d+) (.+)$/.exec(first);
    if (!m) fail(`Hybrid answer: bad mesh line '${first.slice(0, 80)}'`);
    return { status: 'mesh', deviationMm: decodeReal(m[1], m[2]), reason: m[3], mesh: decodeMeshResult(`ok\n${rest}`).mesh };
  }
  if (first.startsWith('unresolved')) {
    const reason = first.slice(10).trim();
    if (!reason) fail('Hybrid answer: unresolved without a reason');
    return { status: 'unresolved', reason };
  }
  return fail(`Hybrid answer: bad status line '${first.slice(0, 80)}'`);
}


// A face-table row as a provenance reference: the tag, the leaf (operand of
// origin), that operand's face index, and the operand face's identity.
export function sourceRef(job, operands, tag) {
  const row = job?.faces[tag];
  if (!row) return { tag };
  const operand = operands[row.leaf];
  const ref = { tag, leaf: row.leaf, face: row.faceIndex };
  if (operand?.id !== undefined) ref.operand = operand.id;
  const origin = operand?.identity?.topology?.faces?.[row.faceIndex];
  if (origin) ref.identity = { originId: origin.originId, instanceId: origin.instanceId, operationId: origin.operationId };
  return ref;
}

// recover's statements (the `unified` record, absorbed slivers) as text a
// body carries.
export function recoverStatements(stats) {
  const out = [];
  if (stats?.unifiedClasses) out.push({ kind: 'unified', classes: stats.unifiedClasses, toleranceMm: stats.unifiedToleranceMm,
    ...(stats.unifiedOverLimit ? { overLimit: stats.unifiedOverLimit } : {}),
    text: `coplanar plane carriers of different operands unified within 2^-44*scale (${stats.unifiedClasses} classes, tolerance ${stats.unifiedToleranceMm} mm${stats.unifiedOverLimit ? `; ${stats.unifiedOverLimit} past the 32-bit class limit, decided without unification` : ''})` });
  if (stats?.slivers) out.push({ kind: 'slivers', count: stats.slivers,
    text: `${stats.slivers} tessellation sliver patches absorbed into neighbouring faces (area at most deviation x perimeter each)` });
  return out;
}

// recover's B-rep split into kernel bodies (one per component; edges and
// vertices re-indexed; no coordinate changes), in the kernel's analytic body
// format (src/analytic.mjs decodeAnalytic, consumed by src/exporters.mjs).
// The geometry fields are exactly scripts/bakeoff/recover-brep.mjs toBodies'.
//
// context (all optional): job (the job object; its face table maps a tag to
// leaf and operand face), operands (leaf -> body), stats (recover's),
// classes (carrierClasses). Each body gets `provenance`:
//   faces[i]: {tag: recover's tag = the carrier class, carrier: that row as a
//     source reference, carrierClass: every face-table row on the same
//     carrier, sources: the rows whose triangles form this face (set by
//     attachResultMesh; null when the mesh could not be assigned), shell}
//   edges[i]: {seam, boundaryDeviationMm, certifiedBoundMm} (recover's edge
//     certificate)
//   statements: recover's `unified` and absorbed-sliver records; stats.
export function toBodies(raw, id, { job = null, operands = [], stats = null, classes = null } = {}) {
  const groups = [...new Set(raw.faces.map(f => f.body))].sort((a, b) => a - b);
  const statements = recoverStatements(stats);
  return groups.map((g, gi) => {
    const sourceFaces = raw.faces.map((f, i) => [f, i]).filter(([f]) => f.body === g);
    const edgeMap = new Map(), vertexMap = new Map(), vertices = [], edges = [], edgeSources = [];
    const vid = v => {
      if (!vertexMap.has(v)) { vertexMap.set(v, vertices.length); vertices.push(raw.vertices[v]); }
      return vertexMap.get(v);
    };
    const eid = e => {
      if (!edgeMap.has(e)) {
        const src = raw.edges[e];
        edgeMap.set(e, edges.length);
        edges.push({ start: vid(src.start), end: vid(src.end), curve: src.curve, sameSense: src.sameSense, ...(src.curveRange ? { curveRange: src.curveRange } : {}) });
        edgeSources.push({ seam: src.seam, boundaryDeviationMm: src.boundaryDeviationMm, certifiedBoundMm: src.certifiedBoundMm });
      }
      return edgeMap.get(e);
    };
    const faces = sourceFaces.map(([f]) => ({
      surface: f.surface, sameSense: f.sameSense, loops: f.loops.map(l => l.map(u => ({ edge: eid(u.edge), forward: u.forward }))), outer: f.outer,
    }));
    const body = { id: groups.length > 1 ? `${id}/${gi}` : id, geometry: 'analytic', precision: 'F32x2', vertices, edges, faces };
    // Outer shell = faces whose shell id is the body id; inner void shells
    // (not in the kernel body format yet) are listed separately.
    const shells = [...new Set(sourceFaces.map(([f]) => f.shell))].sort((a, b) => a - b);
    body.shell = { closed: true, faces: faces.flatMap((_, i) => (sourceFaces[i][0].shell === g ? [i] : [])) };
    const voids = shells.filter(s => s !== g).map(s => ({ closed: true, faces: faces.flatMap((_, i) => (sourceFaces[i][0].shell === s ? [i] : [])) }));
    if (voids.length) body.voids = voids;
    body.provenance = {
      method: 'hybrid corefine+recover: analytic B-rep recovered from a tagged Boolean mesh (kernel/hybrid, Bend)',
      component: gi,
      faces: sourceFaces.map(([f, index]) => ({
        tag: f.tag, recoveredIndex: index, shell: f.shell, carrier: sourceRef(job, operands, f.tag),
        carrierClass: classes ? classes.flatMap((c, t) => (c === f.tag ? [sourceRef(job, operands, t)] : [])) : null,
        sources: null,
      })),
      edges: edgeSources,
      statements,
      ...(stats ? { stats } : {}),
    };
    return body;
  });
}

// The attached mesh is not part of the body's data: exports (brep.json) do
// not write it, and a structured clone (a rolled-back or copied body) drops
// it, so such a copy is meshed by printMesh again.
export function setHybridMesh(body, value) {
  Object.defineProperty(body, 'hybridMesh', { value, enumerable: false, writable: true, configurable: true });
  return body;
}

// Split corefine's result mesh over the recovered bodies and renumber its
// tags to body face indices, where the tags force the assignment (recover's
// own stages 1-4, replayed on its input without geometry):
// - a triangle of tag t lies in a face whose tag is its carrier class
//   classes[t]; a patch is a set of triangles of one class joined across
//   shared mesh edges, one recovered face each;
// - a mesh component (triangles sharing vertices) is one closed shell, the
//   one recovered shell whose face tags are exactly its classes;
// - faces of one class in one shell are told apart by the classes of their
//   neighbours (across B-rep edges and across patch boundaries alike), and
//   where those agree by their recovered vertices (the one geometric input:
//   the mesh vertices they were refined from).
// Absorbed slivers and unified carriers put triangles into a face of another
// carrier, so they decline, and so does any ambiguity. A declined body keeps
// the reason (hybridMesh.refused) and is meshed by printMesh when it next
// enters a job. On success each face's provenance lists its sources: the
// face-table rows of its triangles.
export function attachResultMesh(bodies, raw, stats, mesh, deviationMm, classes, { job = null, operands = [] } = {}) {
  const decline = reason => { for (const b of bodies) setHybridMesh(b, { refused: reason }); return bodies; };
  if (!classes) return decline('no carrier classes for the job');
  if (stats.slivers) return decline(`${stats.slivers} sliver patches were absorbed into faces of other carriers`);
  // Unified carriers (kernel/hybrid/unify.bend: normals within 2^-44, offsets
  // within tau = 2^-44 * scale) are one class of recover's own table: S.same
  // takes planes parallel within 1e-10 and offsets within 1e-7 mm, and tau
  // stays below that for every scale under 1.7e6 mm. The replay below checks
  // the assignment face by face and declines by name on any mismatch.
  if (stats.unifiedClasses && !(stats.unifiedToleranceMm < 1e-7)) return decline(`coplanar carriers were unified within ${stats.unifiedToleranceMm} mm, beyond recover's carrier tolerance`);
  const T = mesh.triangles;
  if (T.some(t => !(t[3] < classes.length))) return decline('a result triangle has a tag outside the face table');
  const cls = i => classes[T[i][3]];
  const unionFind = n => {
    const parent = Array.from({ length: n }, (_, i) => i);
    const find = v => { while (parent[v] !== v) { parent[v] = parent[parent[v]]; v = parent[v]; } return v; };
    return { find, union: (x, y) => { parent[find(y)] = find(x); } };
  };
  // Shells: triangles joined through shared vertices.
  const vertexSets = unionFind(mesh.vertices.length);
  for (const [a, b, c] of T) { vertexSets.union(a, b); vertexSets.union(a, c); }
  // Patches: triangles of one class joined across shared edges.
  const edges = new Map();
  T.forEach(([a, b, c], i) => {
    for (const [p, q] of [[a, b], [b, c], [c, a]]) {
      const key = p < q ? `${p},${q}` : `${q},${p}`;
      edges.set(key, [...(edges.get(key) ?? []), i]);
    }
  });
  const patchSets = unionFind(T.length);
  for (const list of edges.values()) {
    if (list.length !== 2) return decline('the result mesh is not a closed 2-manifold');
    if (cls(list[0]) === cls(list[1])) patchSets.union(list[0], list[1]);
  }
  const patches = new Map(); // root triangle -> {cls, shell, triangles, neighbours}
  T.forEach((t, i) => {
    const root = patchSets.find(i);
    if (!patches.has(root)) patches.set(root, { cls: cls(i), shell: vertexSets.find(t[0]), triangles: [], neighbours: new Set() });
    patches.get(root).triangles.push(i);
  });
  for (const [x, y] of edges.values()) if (cls(x) !== cls(y)) {
    patches.get(patchSets.find(x)).neighbours.add(cls(y));
    patches.get(patchSets.find(y)).neighbours.add(cls(x));
  }
  const components = new Map(); // mesh shell root -> {classes, patches}
  for (const [root, p] of patches) {
    if (!components.has(p.shell)) components.set(p.shell, { classes: new Set(), patches: [] });
    components.get(p.shell).classes.add(p.cls);
    components.get(p.shell).patches.push(root);
  }
  // Recovered shells, and each face's neighbour tags across its edges.
  const edgeFaces = raw.edges.map(() => []);
  raw.faces.forEach((f, i) => { for (const loop of f.loops) for (const u of loop) edgeFaces[u.edge].push(i); });
  const neighbourTags = i => new Set(raw.faces[i].loops.flat().flatMap(u => edgeFaces[u.edge]).filter(j => j !== i).map(j => raw.faces[j].tag));
  const shells = new Map(); // body/shell -> {body, byTag: class tag -> recovered face indices}
  raw.faces.forEach((f, i) => {
    const key = `${f.body}/${f.shell}`;
    if (!shells.has(key)) shells.set(key, { body: f.body, byTag: new Map() });
    const byTag = shells.get(key).byTag;
    byTag.set(f.tag, [...(byTag.get(f.tag) ?? []), i]);
  });
  const same = (a, b) => a.size === b.size && [...a].every(x => b.has(x));
  // Faces of one carrier with the same neighbour carriers (a hub cylinder cut
  // into four by ribs, the R20 return hub) are told apart by their vertices:
  // every recovered vertex lies within the largest vertex drift recover
  // reports of the mesh vertex it was refined from, which belongs to every
  // patch meeting there. A patch matches a face when it has a mesh vertex
  // that close to each of the face's vertices; the assignment must be one to
  // one, or the attachment declines.
  const drift = (stats.maxVertexDriftMm ?? 0) + 1e-12;
  const near = (q, points) => points.some(m => Math.hypot(q[0] - m[0], q[1] - m[1], q[2] - m[2]) <= drift);
  const faceVertices = i => [...new Set(raw.faces[i].loops.flat().flatMap(u => [raw.edges[u.edge].start, raw.edges[u.edge].end]))].map(v => raw.vertices[v]);
  const patchVertices = p => [...new Set(patches.get(p).triangles.flatMap(i => T[i].slice(0, 3)))].map(v => mesh.vertices[v]);
  const matchByVertices = (own, faces) => {
    const corners = new Map(faces.map(f => [f, faceVertices(f)]));
    if ([...corners.values()].some(vs => !vs.length)) return null;
    const pairs = own.map(p => { const points = patchVertices(p); return [p, faces.filter(f => corners.get(f).every(q => near(q, points)))]; });
    if (pairs.some(([, fs]) => fs.length !== 1) || new Set(pairs.map(([, fs]) => fs[0])).size !== own.length) return null;
    return pairs.map(([p, fs]) => [p, fs[0]]);
  };
  const signature = set => [...set].sort((x, y) => x - y).join(',');
  const faceOfPatch = new Map(), shellOf = new Map();
  for (const [root, c] of components) {
    const matches = [...shells].filter(([, s]) => same(c.classes, new Set(s.byTag.keys())));
    if (matches.length !== 1) return decline(`a mesh component on ${c.classes.size} carriers matches ${matches.length} recovered shells`);
    const [key, s] = matches[0];
    if ([...shellOf.values()].includes(key)) return decline('two mesh components match one recovered shell');
    shellOf.set(root, key);
    for (const [tag, faces] of s.byTag) {
      const own = c.patches.filter(p => patches.get(p).cls === tag);
      if (own.length !== faces.length) return decline(`carrier ${tag} has ${own.length} mesh patches and ${faces.length} recovered faces in one shell`);
      if (faces.length === 1) { faceOfPatch.set(own[0], faces[0]); continue; }
      const bySignature = new Map(faces.map(i => [signature(neighbourTags(i)), i]));
      if (bySignature.size !== faces.length) {
        const byVertices = matchByVertices(own, faces);
        if (!byVertices) return decline(`${faces.length} faces on carrier ${tag} are not told apart by their neighbours or by their vertices`);
        for (const [p, face] of byVertices) faceOfPatch.set(p, face);
        continue;
      }
      for (const p of own) {
        const face = bySignature.get(signature(patches.get(p).neighbours));
        if (face === undefined || [...faceOfPatch.values()].includes(face)) return decline(`a mesh patch on carrier ${tag} matches no recovered face by its neighbours`);
        faceOfPatch.set(p, face);
      }
    }
  }
  if (shellOf.size !== shells.size) return decline(`${shells.size - shellOf.size} recovered shells have no mesh component`);
  const groups = [...new Set(raw.faces.map(f => f.body))].sort((a, b) => a - b);
  groups.forEach((g, gi) => {
    const body = bodies[gi];
    const faceOf = new Map(body.provenance.faces.map((f, i) => [f.recoveredIndex, i]));
    const vertexMap = new Map(), vertices = [], triangles = [], sources = body.faces.map(() => new Set());
    const vid = v => { if (!vertexMap.has(v)) { vertexMap.set(v, vertices.length); vertices.push(mesh.vertices[v]); } return vertexMap.get(v); };
    for (const [root, p] of patches) {
      if (raw.faces[faceOfPatch.get(root)].body !== g) continue;
      const face = faceOf.get(faceOfPatch.get(root));
      for (const i of p.triangles) {
        const [a, b, c, tag] = T[i];
        sources[face].add(tag);
        triangles.push([vid(a), vid(b), vid(c), face]);
      }
    }
    body.provenance.faces.forEach((f, i) => { f.sources = [...sources[i]].sort((x, y) => x - y).map(t => sourceRef(job, operands, t)); });
    body.provenance.operands = [...new Set(body.provenance.faces.flatMap(f => f.sources.map(s => s.leaf)))].sort((x, y) => x - y);
    setHybridMesh(body, { deviationMm, vertices, triangles, revision: geometryRevision(body),
      certificate: 'every vertex within the deviation of its face carrier, closed oriented 2-manifold (recover input checks, kernel/hybrid/recover)' });
  });
  return bodies;
}

// The hybrid answer as wonky bodies:
//   exact -> {status: 'exact', bodies, stats, statements}; bodies carry
//     construction (method, deviation), provenance, validation (when
//     `validate` is given; a failure throws) and, with meshText, the attached
//     result mesh;
//   mesh -> {status: 'mesh', approximation: true, exact: false, deviationMm,
//     reason, mesh, classes}: never exact (docs/hybrid-boolean-plan.md step 8;
//     src/hybrid-mesh.mjs makes it a body);
//   unresolved -> {status: 'unresolved', reason}.
// classes: carrierClasses(kernel, job), or pass `kernel` to compute them.
export function decodeHybrid(answer, { id, job = null, operands = [], meshText = null, validate = null, kernel = null, classes = null } = {}) {
  const a = decodeAnswer(answer);
  // A mesh answer carries the carrier classes of its job: certifiedMeshBody
  // (src/hybrid-mesh.mjs) groups its triangles into faces by them.
  if (a.status === 'mesh') return { ...a, approximation: true, exact: false, classes: classes ?? (kernel && job ? carrierClasses(kernel, job) : null) };
  if (a.status !== 'exact') return a;
  if (a.brep.status !== 'ok') fail(`Hybrid answer: exact without a B-rep (${a.brep.reason})`);
  const { raw, stats } = a.brep;
  if (!classes && kernel && job) classes = carrierClasses(kernel, job);
  const bodies = toBodies(raw, id, { job, operands, stats, classes });
  for (const body of bodies) {
    body.construction = { method: 'hybrid corefine+recover', deviationMm: job?.deviation ?? null };
    if (validate) body.validation = validate(body);
  }
  if (meshText && job) {
    const r = decodeMeshResult(meshText);
    if (r.status !== 'ok') fail('Hybrid answer: exact but corefine\'s mesh is not ok');
    attachResultMesh(bodies, raw, stats, r.mesh, job.deviation, classes, { job, operands });
  }
  return { status: 'exact', bodies, stats, statements: recoverStatements(stats) };
}

// One Boolean through the hybrid: encode, run, decode. For the dispatch
// (docs/hybrid-boolean-plan.md step 7); `validate` as in decodeHybrid.
export function hybridBoolean(kernel, operands, operation, { id = 'hybrid', deviationMm = HYBRID_DEVIATION_MM, validate = null } = {}) {
  const job = hybridJob(kernel, operands, binaryTree(operation), { deviationMm, id: String(id).replace(/\s+/g, '_') });
  const jobText = encodeJob(job);
  const { text: answer, meshText } = runHybrid(kernel, jobText);
  return { job, jobText, answer, ...decodeHybrid(answer, { id, job, operands, meshText, validate, kernel }) };
}
