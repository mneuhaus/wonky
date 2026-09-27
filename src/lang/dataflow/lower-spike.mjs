// Lower WGraph/0 stages to one program of the Bend core-language spike
// (kernel/lang/spike, docs/language/bend-feasibility.md), so that graphs run
// natively on the production planar-Boolean kernel without a new Bend build.
//
// The spike is used here only as a *graph executor*: every node becomes one
// `let` of a kernel builtin; independent heavy nodes of the same dependency
// level become one balanced `(par ...)` tree (fork-join); and several stages
// (graph versions, sweep variants) can share one process, with nodes whose
// content hash was already evaluated reused as resident values instead of
// being recomputed - the in-process equivalent of resident body handles in the
// native binding.
//
// Supported subset (everything else is a capability error, never approximated):
//   build123d box / translate-of-box (folded into a placed box), boolean.union,
//   boolean.subtract; FeatureScript sketch(polyline|rectangle on a plane with
//   normal +Z, x +X) + extrude(+Z, blind).
import { hashGraph } from './graph.mjs';

export class LoweringError extends Error { constructor(message) { super(message); this.name = 'LoweringError'; } }
const f32exact = x => Math.fround(x) === x;
const n = x => { if (!Number.isFinite(x) || !f32exact(x)) throw new LoweringError(`coordinate ${x} is not F32-exact (the spike's extrude takes F32)`); return String(x); };
const signedArea = pts => pts.reduce((s, [x, y], i) => { const [u, v] = pts[(i + 1) % pts.length]; return s + x * v - u * y; }, 0) / 2;

// Placement of a build123d box after folding translations: {x0,y0,z0,l,w,h}.
function placement(graph, name) {
  const node = graph.byName.get(name);
  if (node.op === 'box') {
    const off = { MIN: 0, CENTER: 0.5, MAX: 1 };
    const [l, w, h] = node.data.size;
    return { x0: -l * off[node.data.align[0]], y0: -w * off[node.data.align[1]], z0: -h * off[node.data.align[2]], l, w, h };
  }
  if (node.op === 'translate') {
    const p = placement(graph, node.inputs[0]);
    if (!p) return null;
    const [dx, dy, dz] = node.data.offset;
    return { ...p, x0: p.x0 + dx, y0: p.y0 + dy, z0: p.z0 + dz };
  }
  return null;
}

function nodeExpr(graph, node, ref) {
  switch (node.op) {
    case 'box': case 'translate': {
      const p = placement(graph, node.name);
      if (!p) throw new LoweringError(`translate of a non-box (${node.inputs[0]}) needs a transform builtin the spike lacks`);
      return `(box ${n(p.x0)} ${n(p.y0)} ${n(p.z0)} ${n(p.x0 + p.l)} ${n(p.y0 + p.w)} ${n(p.h)})`;
    }
    case 'extrude': {
      const sketch = graph.byName.get(node.inputs[0]);
      const plane = sketch?.data?.plane, d = node.data;
      if (!plane || !d || String(plane.normal) !== '0,0,1' || String(plane.x) !== '1,0,0' || String(d.direction) !== '0,0,1' || d.start)
        throw new LoweringError(`extrude ${node.name}: only +Z blind extrusions of XY-plane sketches are lowered`);
      const ents = sketch.data.entities;
      if (ents.length !== 1) throw new LoweringError(`extrude ${node.name}: exactly one closed profile is lowered`);
      const e = ents[0];
      let pts = e.kind === 'skPolyline' ? e.points.slice(0, -1) : e.kind === 'skRectangle' ? [[e.a[0], e.a[1]], [e.b[0], e.a[1]], [e.b[0], e.b[1]], [e.a[0], e.b[1]]] : null;
      if (!pts) throw new LoweringError(`extrude ${node.name}: ${e.kind} profiles are not lowered`);
      pts = pts.map(([u, v]) => [plane.origin[0] + u, plane.origin[1] + v]);
      if (signedArea(pts) < 0) pts.reverse();
      // FeatureScript lengths are binary64 meters (18 * millimeter * 1000 = 18.000000000000004 mm).
      // The polyhedral extrude takes F32; round exactly as production does in src/kernel.mjs
      // extrudeInBend (Math.fround, reported there as precision F32). Explicit, not silent.
      const f = x => n(Math.fround(x));
      return `(extrude (list ${pts.map(([x, y]) => `(list ${f(x)} ${f(y)})`).join(' ')}) ${f(plane.origin[2])} ${f(d.depthMm)})`;
    }
    case 'boolean.union': return `(union ${ref(node.inputs[0])} ${ref(node.inputs[1])})`;
    case 'boolean.subtract': return `(subtract ${ref(node.inputs[0])} ${ref(node.inputs[1])})`;
    default: throw new LoweringError(`op '${node.op}' has no builtin in the spike kernel set`);
  }
}

const parTree = exprs => (exprs.length === 1 ? `(list ${exprs[0]})` : `(par ${parTree(exprs.slice(0, exprs.length >> 1))} ${parTree(exprs.slice(exprs.length >> 1))})`);

// stages: [{ graph, reuse: bool }]; options.par: fork-join independent heavy nodes.
// Returns { text, stats: [{ evaluated, reused, heavyEvaluated, heavyReused, levels }] }.
export function lowerStages(stages, { par = true, outputs = 'measures' } = {}) {
  const lines = [], bound = new Map(); // geom hash -> variable
  let counter = 0; const stats = []; const results = [];
  for (const [s, { graph, reuse }] of stages.entries()) {
    const hashes = hashGraph(graph), varOf = new Map();
    const st = { evaluated: 0, reused: 0, heavyEvaluated: 0, heavyReused: 0, levels: 0 };
    // Light nodes are emitted on first use, so a box folded into its translation is never built.
    const deferred = new Map();
    const ref = name => {
      if (!varOf.has(name) && deferred.has(name)) { const { node, key } = deferred.get(name); deferred.delete(name); const v = `s${s}n${counter++}`; lines.push(`(let ${v} ${nodeExpr(graph, node, ref)})`); varOf.set(name, v); bound.set(key, v); st.evaluated++; }
      const v = varOf.get(name); if (!v) throw new LoweringError(`input ${name} is not bound`); return v;
    };
    const live = new Set(), stack = [...(graph.variantOutputs ?? [graph.outputs]).flat()];
    while (stack.length) { const x = stack.pop(); if (live.has(x)) continue; live.add(x); stack.push(...graph.byName.get(x).inputs); }
    const nodes = graph.nodes.filter(x => x.kind === 'op' && x.op !== 'sketch' && live.has(x.name));
    st.pruned = graph.nodes.filter(x => x.kind === 'op' && !live.has(x.name)).length;
    const heavyLevel = new Map();
    const pending = new Map(); // level -> [node]
    for (const node of nodes) {
      const key = hashes.get(node.name).geom;
      if (reuse && bound.has(key)) { varOf.set(node.name, bound.get(key)); st.reused++; if (node.cost === 'heavy') st.heavyReused++; heavyLevel.set(node.name, 0); continue; }
      const lvl = (node.cost === 'heavy' ? 1 : 0) + Math.max(0, ...node.inputs.filter(i => heavyLevel.has(i)).map(i => heavyLevel.get(i)));
      heavyLevel.set(node.name, lvl);
      if (node.cost !== 'heavy') {
        if (lvl > 0) throw new LoweringError(`light node ${node.name} depends on a heavy result; not lowered`);
        deferred.set(node.name, { node, key });
        continue;
      }
      if (!pending.has(lvl)) pending.set(lvl, []);
      pending.get(lvl).push({ node, key });
    }
    // Emit heavy levels in order; a level's nodes depend only on lower levels.
    for (const lvl of [...pending.keys()].sort((a, b) => a - b)) {
      const group = pending.get(lvl); st.levels++;
      for (const { node } of group) node.inputs.forEach(ref); // materialize light inputs before the level
      if (!par || group.length === 1) {
        for (const { node, key } of group) { const v = `s${s}n${counter++}`; lines.push(`(let ${v} ${nodeExpr(graph, node, ref)})`); varOf.set(node.name, v); bound.set(key, v); }
      } else {
        const listVar = `s${s}L${lvl}_${counter++}`;
        lines.push(`(let ${listVar} ${parTree(group.map(({ node }) => nodeExpr(graph, node, ref)))})`);
        group.forEach(({ node, key }, i) => { const v = `s${s}n${counter++}`; lines.push(`(let ${v} (nth ${listVar} ${i}))`); varOf.set(node.name, v); bound.set(key, v); });
      }
      st.evaluated += group.length; st.heavyEvaluated += group.length;
    }
    stats.push(st);
    for (const o of (graph.variantOutputs ?? [graph.outputs]).flat()) results.push(outputs === 'measures' ? `(list (volume ${ref(o)}) (faces ${ref(o)}) ${ref(o)})` : ref(o));
  }
  lines.push(`(list ${results.join(' ')})`);
  return { text: lines.join('\n') + '\n', stats };
}
