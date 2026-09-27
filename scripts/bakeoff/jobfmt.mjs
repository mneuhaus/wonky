// Boolean bake-off test infrastructure: the job/result text format.
//
// This module only encodes and decodes text. It computes no geometry.
// The grammar is documented in docs/bakeoff.md ("Job format"); the Bend
// side lives in kernel/hybrid/mesh-io.bend (kernel/proto/mesh-io.bend is a
// symlink to it) and must stay byte-compatible.
//
// Every real is written as two decimal U32 words, the IEEE-754 bit patterns
// of hi = fround(x) and lo = fround(x - hi). The value a consumer must use
// is hi + lo (exactly representable in a double). Fixture geometry is
// quantized to that value before it is written, so JS, Python and Bend all
// read identical numbers.

export const JOB_MAGIC = 'wonky-bakeoff-job 1';
export const OPS = ['union', 'subtract', 'intersect'];
export const PRIMS = ['box', 'cylinder', 'cone', 'sphere', 'torus', 'prism', 'brep'];
export const SURFACES = { plane: 9, cylinder: 10, cone: 11, sphere: 4, torus: 8 };

const f32 = new Float32Array(1);
const u32 = new Uint32Array(f32.buffer);

export function bitsOf(x) {
  f32[0] = x;
  return u32[0];
}

export function fromBits(w) {
  u32[0] = w >>> 0;
  return f32[0];
}

export function split(x) {
  if (!Number.isFinite(x)) throw new Error(`non-finite real ${x}`);
  if (x === 0) x = 0; // no negative zero on the wire
  const hi = Math.fround(x);
  const lo = Math.fround(x - hi);
  return [hi, lo];
}

// The canonical value of x in this format.
export function quantize(x) {
  const [hi, lo] = split(x);
  const q = hi + lo;
  return Object.is(q, -0) ? 0 : q;
}

export function encodeReal(x) {
  const [hi, lo] = split(x);
  return `${bitsOf(hi)} ${bitsOf(lo)}`;
}

export function decodeReal(hiWord, loWord) {
  return fromBits(Number(hiWord)) + fromBits(Number(loWord));
}

// ---------------------------------------------------------------------------
// Tree

function encodeTree(node, out) {
  if (node.leaf !== undefined) {
    out.push(`leaf ${node.leaf}`);
    return;
  }
  if (!OPS.includes(node.op)) throw new Error(`unknown op ${node.op}`);
  out.push(node.op);
  encodeTree(node.children[0], out);
  encodeTree(node.children[1], out);
}

export function countNodes(node) {
  return node.leaf !== undefined ? 1 : 1 + countNodes(node.children[0]) + countNodes(node.children[1]);
}

// ---------------------------------------------------------------------------
// Job
//
// job = {
//   id, deviation,
//   tree: {leaf: i} | {op, children: [a, b]},   (leaf indices into prims)
//   prims: [{kind, params: number[], matrix: number[12]}],
//   faces: [{leaf, faceIndex, surface: {type, ...}}],  (tag = array index)
//   meshes: [{leaf, vertices: [[x,y,z]], triangles: [[a,b,c,tag]]}]
// }

export function surfaceReals(s) {
  switch (s.type) {
    case 'plane': return [...s.o, ...s.n, ...s.x];
    case 'cylinder': return [...s.o, ...s.n, ...s.x, s.r];
    case 'cone': return [...s.o, ...s.n, ...s.x, s.r, s.a];
    case 'sphere': return [...s.o, s.r];
    case 'torus': return [...s.o, ...s.n, s.R, s.r];
    default: throw new Error(`unknown surface ${s.type}`);
  }
}

export function surfaceFromReals(type, r) {
  switch (type) {
    case 'plane': return { type, o: r.slice(0, 3), n: r.slice(3, 6), x: r.slice(6, 9) };
    case 'cylinder': return { type, o: r.slice(0, 3), n: r.slice(3, 6), x: r.slice(6, 9), r: r[9] };
    case 'cone': return { type, o: r.slice(0, 3), n: r.slice(3, 6), x: r.slice(6, 9), r: r[9], a: r[10] };
    case 'sphere': return { type, o: r.slice(0, 3), r: r[3] };
    case 'torus': return { type, o: r.slice(0, 3), n: r.slice(3, 6), R: r[6], r: r[7] };
    default: throw new Error(`unknown surface ${type}`);
  }
}

function encodeMeshBody(mesh, out) {
  for (const v of mesh.vertices) out.push(`${encodeReal(v[0])} ${encodeReal(v[1])} ${encodeReal(v[2])}`);
  for (const t of mesh.triangles) out.push(`${t[0]} ${t[1]} ${t[2]} ${t[3]}`);
}

export function encodeJob(job, { meshes = true } = {}) {
  const out = [JOB_MAGIC, `case ${job.id}`, `deviation ${encodeReal(job.deviation)}`];
  out.push(`nodes ${countNodes(job.tree)}`);
  encodeTree(job.tree, out);
  out.push(`prims ${job.prims.length}`);
  for (const p of job.prims) {
    if (!PRIMS.includes(p.kind)) throw new Error(`unknown prim ${p.kind}`);
    if (p.matrix.length !== 12) throw new Error('matrix must have 12 entries');
    out.push(`prim ${p.kind} ${p.params.length} ${p.params.map(encodeReal).join(' ')} ${p.matrix.map(encodeReal).join(' ')}`.replace('  ', ' '));
  }
  out.push(`faces ${job.faces.length}`);
  for (const f of job.faces) {
    out.push(`face ${f.leaf} ${f.faceIndex} ${f.surface.type} ${surfaceReals(f.surface).map(encodeReal).join(' ')}`);
  }
  const ms = meshes ? job.meshes : [];
  out.push(`meshes ${ms.length}`);
  for (const m of ms) {
    out.push(`mesh ${m.leaf} ${m.vertices.length} ${m.triangles.length}`);
    encodeMeshBody(m, out);
  }
  out.push('end');
  return out.join('\n') + '\n';
}

export function encodeResult(result) {
  if (result.status !== 'ok') {
    const reason = String(result.reason ?? 'unspecified').replace(/\s+/g, ' ').trim() || 'unspecified';
    return `unresolved ${reason}\nend\n`;
  }
  const out = ['ok', `mesh ${result.mesh.vertices.length} ${result.mesh.triangles.length}`];
  encodeMeshBody(result.mesh, out);
  out.push('end');
  return out.join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// Decoding

class Tokens {
  constructor(text) {
    this.words = text.split(/\s+/).filter(Boolean);
    this.i = 0;
  }
  word() {
    if (this.i >= this.words.length) throw new Error('unexpected end of input');
    return this.words[this.i++];
  }
  expect(w) {
    const got = this.word();
    if (got !== w) throw new Error(`expected '${w}', got '${got}' at token ${this.i - 1}`);
  }
  u32() {
    const w = this.word();
    if (!/^\d+$/.test(w) || Number(w) > 0xffffffff) throw new Error(`expected U32, got '${w}' at token ${this.i - 1}`);
    return Number(w);
  }
  real() {
    const hi = this.u32();
    const lo = this.u32();
    return decodeReal(hi, lo);
  }
  reals(n) {
    const r = new Array(n);
    for (let i = 0; i < n; i++) r[i] = this.real();
    return r;
  }
}

function decodeTree(tok, budget) {
  if (budget.left-- <= 0) throw new Error('tree has more nodes than declared');
  const w = tok.word();
  if (w === 'leaf') return { leaf: tok.u32() };
  if (!OPS.includes(w)) throw new Error(`unknown tree node '${w}'`);
  const a = decodeTree(tok, budget);
  const b = decodeTree(tok, budget);
  return { op: w, children: [a, b] };
}

function decodeMeshBody(tok, nv, nt) {
  const vertices = new Array(nv);
  for (let i = 0; i < nv; i++) vertices[i] = [tok.real(), tok.real(), tok.real()];
  const triangles = new Array(nt);
  for (let i = 0; i < nt; i++) triangles[i] = [tok.u32(), tok.u32(), tok.u32(), tok.u32()];
  return { vertices, triangles };
}

export function decodeJob(text) {
  const tok = new Tokens(text);
  tok.expect('wonky-bakeoff-job');
  tok.expect('1');
  tok.expect('case');
  const id = tok.word();
  tok.expect('deviation');
  const deviation = tok.real();
  tok.expect('nodes');
  const n = tok.u32();
  const budget = { left: n };
  const tree = decodeTree(tok, budget);
  if (budget.left !== 0) throw new Error('tree has fewer nodes than declared');
  tok.expect('prims');
  const np = tok.u32();
  const prims = [];
  for (let i = 0; i < np; i++) {
    tok.expect('prim');
    const kind = tok.word();
    const k = tok.u32();
    prims.push({ kind, params: tok.reals(k), matrix: tok.reals(12) });
  }
  tok.expect('faces');
  const nf = tok.u32();
  const faces = [];
  for (let i = 0; i < nf; i++) {
    tok.expect('face');
    const leaf = tok.u32();
    const faceIndex = tok.u32();
    const type = tok.word();
    if (!(type in SURFACES)) throw new Error(`unknown surface '${type}'`);
    faces.push({ leaf, faceIndex, surface: surfaceFromReals(type, tok.reals(SURFACES[type])) });
  }
  tok.expect('meshes');
  const nm = tok.u32();
  const meshes = [];
  for (let i = 0; i < nm; i++) {
    tok.expect('mesh');
    const leaf = tok.u32();
    const nv = tok.u32();
    const nt = tok.u32();
    meshes.push({ leaf, ...decodeMeshBody(tok, nv, nt) });
  }
  tok.expect('end');
  return { id, deviation, tree, prims, faces, meshes };
}

// Returns {status:'ok', mesh} | {status:'unresolved', reason} | throws on
// malformed text. Anything after the final 'end' is ignored.
export function decodeResult(text) {
  const nl = text.indexOf('\n');
  const first = (nl < 0 ? text : text.slice(0, nl)).trim();
  if (first.startsWith('unresolved')) {
    const reason = first.slice('unresolved'.length).trim();
    if (!reason) throw new Error('unresolved without reason');
    return { status: 'unresolved', reason };
  }
  if (first !== 'ok') throw new Error(`bad status line '${first.slice(0, 80)}'`);
  const tok = new Tokens(text.slice(nl + 1));
  tok.expect('mesh');
  const nv = tok.u32();
  const nt = tok.u32();
  const mesh = decodeMeshBody(tok, nv, nt);
  tok.expect('end');
  return { status: 'ok', mesh };
}

// The hybrid Boolean's result (kernel/hybrid/main.bend header):
//   exact\n<recover B-rep after its `ok` line>
//   mesh <dev hi> <dev lo> <reason>\n<bake-off mesh result body after `ok`>
//   unresolved <reason>\nend\n
// `okText` re-attaches the `ok` line, so the exact part reads with
// recover-brep.mjs decodeRecover and the mesh part with decodeResult.
export function decodeHybrid(text) {
  const nl = text.indexOf('\n');
  const first = nl < 0 ? text : text.slice(0, nl);
  const rest = nl < 0 ? '' : text.slice(nl + 1);
  if (first === 'exact') return { status: 'exact', okText: `ok\n${rest}` };
  if (first.startsWith('mesh ')) {
    const m = /^mesh (\d+) (\d+) (.+)$/.exec(first);
    if (!m) throw new Error(`bad hybrid mesh line '${first.slice(0, 80)}'`);
    const okText = `ok\n${rest}`;
    return { status: 'mesh', deviationMm: decodeReal(m[1], m[2]), reason: m[3], okText, mesh: decodeResult(okText).mesh };
  }
  if (first.startsWith('unresolved')) return decodeResult(text);
  throw new Error(`bad hybrid status line '${first.slice(0, 80)}'`);
}
