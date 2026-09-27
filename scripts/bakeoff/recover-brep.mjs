// Boolean bake-off TEST INFRASTRUCTURE for the "recover" prototype: decodes
// the B-rep text written by kernel/proto/recover (format in its main.bend)
// into the kernel's analytic body format (what src/analytic.mjs decodeAnalytic
// produces and src/exporters.mjs consumes). Decoding only: every coordinate
// comes from Bend exactly as written (F32x2 hi + lo); splitting faces into
// bodies by their component id is bookkeeping (re-indexing), no geometry.

import { decodeReal } from './jobfmt.mjs';

class Tokens {
  constructor(text) {
    this.words = text.split(/\s+/).filter(Boolean);
    this.i = 0;
  }
  word() {
    if (this.i >= this.words.length) throw new Error('unexpected end of recover output');
    return this.words[this.i++];
  }
  expect(w) {
    const got = this.word();
    if (got !== w) throw new Error(`expected '${w}', got '${got}' at token ${this.i - 1}`);
  }
  u32() {
    const w = this.word();
    if (!/^\d+$/.test(w)) throw new Error(`expected U32, got '${w}' at token ${this.i - 1}`);
    return Number(w);
  }
  bool() {
    const v = this.u32();
    if (v > 1) throw new Error(`expected 0/1, got ${v}`);
    return v === 1;
  }
  real() {
    const hi = this.u32();
    return decodeReal(hi, this.u32());
  }
  vec() {
    return [this.real(), this.real(), this.real()];
  }
}

function curve(tok) {
  const type = tok.word();
  if (type === 'line') return { type, origin: tok.vec(), direction: tok.vec() };
  if (type === 'circle') return { type, origin: tok.vec(), normal: tok.vec(), x: tok.vec(), radius: tok.real() };
  if (type === 'ellipse') return { type, origin: tok.vec(), normal: tok.vec(), x: tok.vec(), major: tok.real(), minor: tok.real() };
  throw new Error(`unknown curve '${type}'`);
}

function surface(tok) {
  const type = tok.word();
  if (type === 'plane') return { type, origin: tok.vec(), normal: tok.vec(), x: tok.vec() };
  if (type === 'cylinder') return { type, origin: tok.vec(), axis: tok.vec(), x: tok.vec(), radius: tok.real() };
  if (type === 'cone') return { type, origin: tok.vec(), axis: tok.vec(), x: tok.vec(), radius: tok.real(), angle: tok.real() };
  // Not in the kernel body format yet (see recover-stepx.mjs): axis and seam
  // direction of the STEP frame.
  if (type === 'sphere') return { type, origin: tok.vec(), axis: tok.vec(), x: tok.vec(), radius: tok.real() };
  if (type === 'torus') return { type, origin: tok.vec(), axis: tok.vec(), x: tok.vec(), major: tok.real(), minor: tok.real() };
  throw new Error(`unknown surface '${type}'`);
}

const STATS = ['tris', 'meshVertices', 'patches', 'corners', 'closedEdges', 'seams', 'loops', 'bodies'];
const STATS_REAL = ['maxBoundaryDeviationMm', 'maxDeviationOverBound', 'maxVertexDriftMm', 'maxDriftOverBound', 'maxVertexResidualMm', 'maxTagResidualMm', 'minVertexDet'];

// -> {status: 'ok', raw: {vertices, edges, faces}, stats} | {status: 'unresolved', reason}
// (stats.unifiedClasses / unifiedToleranceMm when the job unified coplanar
// plane carriers, the optional `unified` record).
export function decodeRecover(text) {
  const nl = text.indexOf('\n');
  const first = (nl < 0 ? text : text.slice(0, nl)).trim();
  if (first.startsWith('unresolved')) return { status: 'unresolved', reason: first.slice('unresolved'.length).trim() };
  if (first !== 'ok') throw new Error(`bad status line '${first.slice(0, 80)}'`);
  const tok = new Tokens(text.slice(nl + 1));
  tok.expect('brep');
  const nb = tok.u32(), nv = tok.u32(), ne = tok.u32(), nf = tok.u32();
  const vertices = [];
  for (let i = 0; i < nv; i++) { tok.expect('v'); vertices.push(tok.vec()); }
  const edges = [];
  for (let i = 0; i < ne; i++) {
    tok.expect('e');
    const start = tok.u32(), end = tok.u32(), c = curve(tok), seam = tok.bool();
    const e = { start, end, curve: c, sameSense: true, seam, boundaryDeviationMm: tok.real(), certifiedBoundMm: tok.real() };
    const ranged = tok.bool(), first = tok.real(), last = tok.real();
    if (ranged) e.curveRange = [first, last];
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
  // Optional (plan step 4): coplanar plane carriers unified within 2^-44*scale.
  if (tok.words[tok.i] === 'unified') {
    tok.word();
    stats.unifiedClasses = tok.u32();
    stats.unifiedToleranceMm = tok.real();
  }
  tok.expect('end');
  if (new Set(faces.map((f) => f.body)).size !== nb) throw new Error('body count disagrees with face body ids');
  return { status: 'ok', raw: { vertices, edges, faces }, stats };
}

// Split into kernel bodies (one per component), re-indexing edges/vertices.
export function toBodies(raw, id) {
  const groups = [...new Set(raw.faces.map((f) => f.body))].sort((a, b) => a - b);
  return groups.map((g, gi) => {
    const faces = raw.faces.filter((f) => f.body === g);
    const edgeMap = new Map(), vertexMap = new Map();
    const vertices = [], edges = [];
    const vid = (v) => {
      if (!vertexMap.has(v)) { vertexMap.set(v, vertices.length); vertices.push(raw.vertices[v]); }
      return vertexMap.get(v);
    };
    const eid = (e) => {
      if (!edgeMap.has(e)) {
        const src = raw.edges[e];
        edgeMap.set(e, edges.length);
        edges.push({ start: vid(src.start), end: vid(src.end), curve: src.curve, sameSense: src.sameSense, ...(src.curveRange ? { curveRange: src.curveRange } : {}) });
      }
      return edgeMap.get(e);
    };
    const outFaces = faces.map((f) => ({
      surface: f.surface, sameSense: f.sameSense, loops: f.loops.map((l) => l.map((u) => ({ edge: eid(u.edge), forward: u.forward }))), outer: f.outer,
    }));
    const body = { id: groups.length > 1 ? `${id}/${gi}` : id, geometry: 'analytic', precision: 'F32x2', vertices, edges, faces: outFaces };
    // Outer shell = faces whose shell id is the body id; inner void shells
    // (not in the kernel body format yet) are listed separately.
    const shells = [...new Set(faces.map((f) => f.shell))].sort((a, b) => a - b);
    body.shell = { closed: true, faces: outFaces.flatMap((_, i) => (faces[i].shell === g ? [i] : [])) };
    const voids = shells.filter((s) => s !== g).map((s) => ({ closed: true, faces: outFaces.flatMap((_, i) => (faces[i].shell === s ? [i] : [])) }));
    if (voids.length) body.voids = voids;
    body.provenance = { method: 'recover: analytic B-rep recovery from a tagged Boolean mesh (kernel/proto/recover, Bend)', faceTags: faces.map((f) => f.tag) };
    return body;
  });
}
