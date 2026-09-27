// WK/0 -> integer stream for the native Bend evaluator (kernel/lang/wk/).
//
// The native prototype covers the planar subset the linked kernel builtins of
// the language spike support (kernel/lang/spike/kernel-ops.bend): extrusions
// of polygons in xy planes along +Z, union and subtraction with one result
// body, volume and face count, and two checks. Everything else is rejected
// HERE, before submission, with the node's span: a host-side preflight (the
// "mock execution" of proposal §8.2), never a silent fallback or a skipped node.
//
// Lowering (WK -> native ops):
//   extrude_polygon (xy plane, +Z)                  -> 1 extrude
//   boolean union [a, b] / subtract [t] - [u]       -> 2 union / 3 subtract
//   expect(not(cmp('!=', count(evaluate(x)), 1)))   -> 7 expect_single(x)
//   (and cmp('==', count(evaluate(x)), 1))            the chain nodes are absorbed
//   every output body                               -> body, 4 volume, 5 faces
//
// Input precision contract: extrude takes F32 coordinates, as the production
// polyhedral path (src/kernel.mjs vector() = Math.fround). The encoder applies
// exactly that rounding and reports every number it changed.
//
// Stream (decimal U32 tokens), sealed like the real-model stream (real-host.mjs):
//   stream  := count checksum session      count = tokens after the seal,
//                                          checksum = their sum mod 2^32
//   session := ngraphs graph*
//   graph   := nlevels level* nouts ref*
//   level   := nnodes node*                       nodes of one level are independent
//   node    := op span hashHi hashLo payload
//     1 extrude : npoints (f32 x, f32 y)* f32 z f32 h
//     2 union, 3 subtract : ref ref      4 volume, 5 faces, 7 expect_single : ref
//     6 expect_range : ref real lo real hi
//   f32  := s m e      (-1)^s * m * 2^(e-200), m < 2^24 (the spike's word format)
//   real := f32 f32    (hi word, lo word of an F32x2 value)
//   ref  := distance d, 0 = the most recently evaluated node before this level
import { createHash } from 'node:crypto';
import { Ref } from './ir.mjs';

export class NativeCapabilityError extends Error {
  constructor(message, node) { super(message); this.name = 'NativeCapabilityError'; this.node = node?.n ?? null; this.span = node?.span ?? -1; }
}

export function f32Words(x) {
  const v = Math.fround(x);
  if (!Number.isFinite(v)) throw new RangeError(`non-finite ${x}`);
  if (v === 0) return [Object.is(v, -0) ? 1 : 0, 0, 200];
  const s = v < 0 ? 1 : 0; let a = Math.abs(v), e = 0;
  while (a >= 2 ** 24) { a /= 2; e++; }
  while (a < 2 ** 23) { a *= 2; e--; }
  if (!Number.isInteger(a)) throw new RangeError(`cannot encode ${x}`);
  return [s, a, e + 200];
}
const realWords = x => { const hi = Math.fround(x), lo = Math.fround(x - hi); return [...f32Words(hi), ...f32Words(lo)]; };
const xyPlane = p => p && p.normal.join() === '0,0,1' && p.x.join() === '1,0,0';
const sha16 = s => createHash('sha256').update(s).digest('hex').slice(0, 16);
const hashWords = hex => [parseInt(hex.slice(0, 8), 16), parseInt(hex.slice(8, 16), 16)];
const one = v => v instanceof Ref ? v : Array.isArray(v) && v.length === 1 && v[0] instanceof Ref ? v[0] : null;

// WK graph -> native node list [{key, op, span, hash, refs, payload(words)}].
export function lowerNative(graph, hashes, report) {
  if (graph.nodes.some(n => n.region !== null)) throw new NativeCapabilityError('regions are not in the native prototype subset');
  const byN = n => graph.nodes[n];
  const absorbed = new Set(), out = [];
  const singleCheck = cond => {
    // not(cmp('!=', count(evaluate(x)), 1))  or  cmp('==', count(evaluate(x)), 1)
    let c = byN(cond.node), chain = [c.n];
    if (c.op === 'not') { const inner = byN(c.args.x.node); if (inner.op !== 'cmp' || inner.args.op !== '!=') return null; chain.push(inner.n); c = inner; }
    else if (!(c.op === 'cmp' && c.args.op === '==')) return null;
    if (!(c.args.a instanceof Ref) || c.args.b !== 1) return null;
    const count = byN(c.args.a.node); if (count.op !== 'count') return null;
    const evaluated = byN(count.args.of.node); if (evaluated.op !== 'evaluate') return null;
    const x = one(evaluated.args.query); if (!x) return null;
    return { x, chain: [...chain, count.n, evaluated.n] };
  };
  for (const node of graph.nodes) if (node.op === 'expect') {
    const m = singleCheck(node.args.cond);
    if (!m) throw new NativeCapabilityError(`expect at %${node.n} is not a recognised native check`, node);
    m.chain.forEach(n => absorbed.add(n));
    out.push({ key: node.n, node, op: 7, refs: [m.x.node], payload: [], hash: hashes[node.n] });
  }
  for (const node of graph.nodes) {
    if (absorbed.has(node.n) || node.op === 'expect') continue;
    const a = node.args;
    switch (node.op) {
      case 'extrude_polygon': {
        if (!xyPlane(a.plane) || a.offset !== null || a.delta[0] !== 0 || a.delta[1] !== 0 || !(a.delta[2] > 0))
          throw new NativeCapabilityError(`extrude_polygon at %${node.n} is outside the native subset (xy plane, +Z extrusion)`, node);
        const [ox, oy, oz] = a.plane.origin;
        const f32 = v => { if (Math.fround(v) !== v) report.rounded.push({ node: node.n, id: node.id, from: v, to: Math.fround(v) }); return f32Words(v); };
        const pts = a.points.map(([x, y]) => [x + ox, y + oy]);
        out.push({ key: node.n, node, op: 1, refs: [], payload: [pts.length, ...pts.flatMap(([x, y]) => [...f32(x), ...f32(y)]), ...f32(oz), ...f32(a.delta[2])], hash: hashes[node.n] });
        break;
      }
      case 'boolean':
        if (a.kind === 'subtract' && a.targets.length === 1 && a.tools.length === 1 && !a.keepTools) out.push({ key: node.n, node, op: 3, refs: [a.targets[0].node, a.tools[0].node], payload: [], hash: hashes[node.n] });
        else if (a.kind === 'union' && a.targets.length === 0 && a.tools.length === 2) out.push({ key: node.n, node, op: 2, refs: [a.tools[0].node, a.tools[1].node], payload: [], hash: hashes[node.n] });
        else throw new NativeCapabilityError(`boolean ${a.kind} with ${a.targets.length}+${a.tools.length} operands at %${node.n} is outside the native subset`, node);
        break;
      case 'expect_range':
        out.push({ key: node.n, node, op: 6, refs: [a.of.node], payload: [...realWords(a.lo), ...realWords(a.hi)], hash: hashes[node.n] });
        break;
      default: throw new NativeCapabilityError(`WK op '${node.op}' at %${node.n} is not in the native prototype subset`, node);
    }
  }
  for (const o of graph.outputs) {
    const r = one(o.value);
    if (!r) throw new NativeCapabilityError('outputs must be single bodies in the native prototype');
    for (const [op, tag] of [[4, 'volume'], [5, 'faces']]) out.push({ key: `${tag}:${r.node}`, node: null, op, refs: [r.node], payload: [], hash: sha16(`${tag}(#${hashes[r.node]})`) });
  }
  return out;
}

export function encodeSession(graphs, hashesPerGraph) {
  const tokens = [graphs.length], reports = [];
  graphs.forEach((graph, g) => {
    const report = { rounded: [], levels: [], outputs: [] };
    const nodes = lowerNative(graph, hashesPerGraph[g], report);
    const byKey = new Map(nodes.map(x => [x.key, x]));
    const level = new Map();
    const levelOf = x => {
      if (level.has(x.key)) return level.get(x.key);
      const l = x.refs.length ? 1 + Math.max(...x.refs.map(r => levelOf(byKey.get(r)))) : 0;
      level.set(x.key, l); return l;
    };
    nodes.forEach(levelOf);
    const levels = [...new Set(level.values())].sort((a, b) => a - b);
    const position = new Map();
    let base = 0;
    tokens.push(levels.length);
    for (const l of levels) {
      const members = nodes.filter(x => level.get(x.key) === l);
      tokens.push(members.length);
      for (const x of members) {
        const [hi, lo] = hashWords(x.hash);
        tokens.push(x.op, Math.max(x.node?.span ?? 0, 0), hi, lo, ...x.refs.map(r => base - 1 - position.get(r)), ...x.payload);
      }
      members.forEach((x, i) => position.set(x.key, base + i));
      report.levels.push(members.map(x => String(x.key)));
      base += members.length;
    }
    // Outputs: every output body with its volume and face count, then every check.
    const outs = [];
    for (const o of graph.outputs) { const r = one(o.value).node; outs.push(r, `volume:${r}`, `faces:${r}`); }
    for (const x of nodes) if (x.op === 7 || x.op === 6) outs.push(x.key);
    tokens.push(outs.length, ...outs.map(k => base - 1 - position.get(k)));
    report.outputs = outs.map(String);
    reports.push(report);
  });
  // kernel/lang/wk/main.bend checks the seal and the whole grammar before it
  // decodes anything (a malformed stream exits 3).
  for (const t of tokens) if (!Number.isInteger(t) || t < 0 || t > 4294967295) throw new Error(`WK encode: token ${t} is not a U32`);
  const seal = [tokens.length, tokens.reduce((s, t) => (s + t) % 4294967296, 0)];
  return { text: [...seal, ...tokens].join(' '), tokens: tokens.length + 2, reports };
}
