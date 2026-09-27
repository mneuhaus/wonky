// Canonicalization of WK/0 graphs (proposal §6.7). Rewrites are applied only
// when they provably change no bit of any kernel input:
//
//  1. xy-plane normal form: an extrude_polygon on a plane with normal +Z and x
//     axis +X gets its origin's x/y folded into the profile points, origin
//     (0, 0, z). Applied only if every sum is exact in binary64 AND in F32
//     (then every real() word pair is (v, 0) and the F32x2 prism sums are
//     exact too), and only if the profile ring merge decides the same before
//     and after: the ring tolerance max(1e-5, 2^-20 * max |coordinate|)
//     depends on the translation (kernel/profile-ring.bend), so the rule
//     requires every vertex to be a clear corner and every edge clearly long
//     under the larger of the two tolerances (margin 2: nothing merged,
//     nothing refused, either way). The recorded construction.profileMerge
//     toleranceMm still follows the coordinates, like the ids: provenance.
//  2. translation folding: transform(extrude_polygon, identity, t) whose input
//     has no other user becomes one extrude_polygon with t added to the points
//     and origin z, under the same exactness and tolerance rules. Translating a built body
//     moves every vertex by the same exact amounts, so the B-rep is the same;
//     what differs is only provenance, which ids carry (and, since W2, the
//     construction record: a folded extrusion keeps its own, a rigid copy clones
//     its source's with its own incidence audit).
//  3. canonical order: nodes are renumbered in post-order from the outputs
//     (arguments in sorted key order). The order no longer depends on the
//     order in which a frontend emitted independent nodes, and dead nodes
//     disappear.
//
// Graphs with regions are returned unchanged by this prototype.
import { Graph, Ref, refsOf } from './ir.mjs';

const exactSum = (a, b) => { const s = a + b; return s - a === b && s - b === a && Math.fround(s) === s && Math.fround(a) === a; };
const isIdentity = m => Array.isArray(m) && m.every((row, i) => row.every((v, j) => v === (i === j ? 1 : 0)));
const xyPlane = p => p && p.normal.join() === '0,0,1' && p.x.join() === '1,0,0';

const ringTolerance = points => Math.max(1e-5, 2 ** -20 * Math.max(0, ...points.flatMap(([x, y]) => [Math.abs(x), Math.abs(y)])));
// Every vertex a corner whose smallest triangle height, and every edge, exceeds 2 * eps.
function clearCorners(points, eps) {
  const n = points.length, len = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
  return n >= 3 && points.every((b, i) => {
    const a = points[(i + n - 1) % n], c = points[(i + 1) % n];
    const turn = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
    return len(b, c) > 2 * eps && turn > 2 * eps * Math.max(len(a, b), len(b, c), len(a, c));
  });
}
function shifted(args, [dx, dy, dz]) {
  const { points, plane } = args;
  if (!points.every(([x, y]) => exactSum(x, dx) && exactSum(y, dy)) || !exactSum(plane.origin[2], dz)) return null;
  const moved = points.map(([x, y]) => [x + dx, y + dy]);
  const eps = Math.max(ringTolerance(points), ringTolerance(moved));
  if (!clearCorners(points, eps) || !clearCorners(moved, eps)) return null;
  return { ...args, points: moved, plane: { ...plane, origin: [0, 0, plane.origin[2] + dz] } };
}
const sortedValues = v => Array.isArray(v) ? v.flatMap(sortedValues)
  : v instanceof Ref ? [v] : v && typeof v === 'object' ? Object.keys(v).sort().flatMap(k => sortedValues(v[k])) : [];

export function canonicalize(graph) {
  if (graph.nodes.some(n => n.body || n.region !== null)) return { graph, rewrites: [] };
  const rewrites = [];
  const ops = graph.nodes.map(n => n.op), args = graph.nodes.map(n => n.args);
  const users = new Map();
  for (const n of graph.nodes) for (const r of refsOf(n.args)) users.set(r, (users.get(r) ?? 0) + 1);
  for (const o of graph.outputs) for (const r of refsOf(o.value)) users.set(r, (users.get(r) ?? 0) + 1);
  const forward = new Map(); // folded transform -> it now IS the extrusion
  for (const node of graph.nodes) {
    // Rule 0: signed zero in an extrusion's plane origin. polygon-prism.extrude
    // gets the origin only through src/kernel.mjs prismInputs, whose binary64
    // cap sums write -0 as +0 (real-host.mjs contractArgs), so -0 and +0
    // origins give bit-identical vertices; build123d's Align.MIN produces -0
    // (-size * 0), FeatureScript's fCuboid +0.
    if (ops[node.n] === 'extrude_polygon' && args[node.n].offset === null && args[node.n].plane.origin.some(v => Object.is(v, -0))) {
      args[node.n] = { ...args[node.n], plane: { ...args[node.n].plane, origin: args[node.n].plane.origin.map(v => v === 0 ? 0 : v) } };
      rewrites.push({ rule: 'signed-zero', node: node.n });
    }
    if (ops[node.n] === 'extrude_polygon' && xyPlane(args[node.n].plane) && args[node.n].offset === null) {
      const [ox, oy] = args[node.n].plane.origin;
      const moved = ox || oy ? shifted(args[node.n], [ox, oy, 0]) : null;
      if (moved) { args[node.n] = moved; rewrites.push({ rule: 'xy-plane', node: node.n }); }
    }
    if (ops[node.n] === 'transform' && isIdentity(args[node.n].rotation) && args[node.n].bodies instanceof Ref) {
      const source = args[node.n].bodies.node;
      if (ops[source] === 'extrude_polygon' && users.get(source) === 1 && xyPlane(args[source].plane)) {
        const folded = shifted(args[source], args[node.n].offset);
        if (folded) { ops[node.n] = 'extrude_polygon'; args[node.n] = folded; forward.set(source, node.n); rewrites.push({ rule: 'fold-translation', node: node.n, into: source }); }
      }
    }
  }
  const out = new Graph(graph.meta);
  out.spans = graph.spans; out.spanKeys = graph.spanKeys;
  const map = new Map();
  const remap = v => v instanceof Ref ? new Ref(map.get(v.node), v.out) : Array.isArray(v) ? v.map(remap)
    : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, remap(x)])) : v;
  const visit = n => {
    if (map.has(n)) return;
    for (const r of sortedValues(args[n])) visit(r.node);
    const node = graph.nodes[n];
    map.set(n, out.add(ops[n], remap(args[n]), { type: node.type, id: node.id, span: node.span, stack: node.stack, attrs: node.attrs }).node);
  };
  for (const o of graph.outputs) for (const r of sortedValues(o.value)) visit(r.node);
  for (const o of graph.outputs) out.output(remap(o.value), o);
  const removed = graph.nodes.length - out.nodes.length - forward.size;
  if (removed) rewrites.push({ rule: 'dead-nodes', removed });
  return { graph: out, rewrites };
}
