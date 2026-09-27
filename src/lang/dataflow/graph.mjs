// WGraph/0: the dataflow-graph IR of the language study
// (docs/language/proposal-dataflow.md).
//
// A WGraph is the *evaluated trace* of one frontend run: every node is one
// kernel operation (FeatureScript op*/f*/sk* call, build123d request) or one
// kernel-side query/check, with fully concrete, unit-exact arguments and edges
// to the nodes that produced its input bodies. Host-language control flow and
// value computation are already folded away by the frontend; parameters live
// in the source program, not in the graph. A parameter edit is therefore
// "re-run the cheap frontend, diff the graphs by content hash, recompute the
// dirty nodes" (Salsa/Build-Systems-a-la-Carte style verifying traces).
//
// Node identity: `name` is the frontend's operation id (FeatureScript Id path,
// or a span-derived id for Python). Content identity: a Merkle hash over
// (op, canonical args, input hashes) - the `geom` hash - plus the id for the
// `full` hash, because kernel/identity.bend derives topology names from the
// operation id. Spans and call stacks are metadata and never hashed.
import { createHash } from 'node:crypto';

export const WGRAPH_VERSION = 'wgraph/0';

// Cost classes. The measured kernel profile (docs/native-bridge/profile.md)
// puts 76-99.9 % of kernel time into Boolean entry points; blends and face
// operations are Boolean-class algorithms in every B-rep kernel.
export const COST = {
  'boolean.union': 'heavy', 'boolean.subtract': 'heavy', 'boolean.intersect': 'heavy',
  fillet: 'heavy', chamfer: 'heavy', offsetFace: 'heavy', deleteFace: 'heavy', moveFace: 'heavy',
  splitPart: 'heavy', shell: 'heavy', draft: 'heavy',
  loft: 'medium', sweep: 'medium', revolve: 'medium', thicken: 'medium',
};
export const costOf = op => COST[op] ?? (op.startsWith('boolean.') ? 'heavy' : 'light');

const sha = text => createHash('sha256').update(text).digest('hex');

export class Graph {
  constructor(meta = {}) {
    this.meta = { version: WGRAPH_VERSION, ...meta };
    this.nodes = []; this.byName = new Map(); this.outputs = [];
  }
  // node: { name, op, args (canonical text with $i input slots), inputs: [names],
  //         kind: 'op'|'meta'|'select'|'check', span, stack, record, notes }
  add(node) {
    if (this.byName.has(node.name)) throw new Error(`WGraph: duplicate node name '${node.name}'`);
    for (const input of node.inputs) if (!this.byName.has(input)) throw new Error(`WGraph: node '${node.name}' refers to unknown input '${input}' (no forward references)`);
    const kind = node.kind ?? 'op';
    const full = { args: '', span: null, ...node, kind, cost: node.cost ?? (kind === 'op' ? costOf(node.op) : 'light') };
    this.nodes.push(full); this.byName.set(full.name, full);
    return full;
  }
  freshName(base) {
    if (!this.byName.has(base)) return base;
    for (let i = 2; ; i++) if (!this.byName.has(`${base}~${i}`)) return `${base}~${i}`;
  }
}

// --- hashing -----------------------------------------------------------------------------
// geom: op + args + input geom hashes. Meta nodes (names, colours) pass the geometry
// hash of their single input through, so renaming a part never dirties geometry.
// full: geom + the node name (operation id) + input full hashes.
export function hashGraph(graph) {
  const out = new Map();
  for (const n of graph.nodes) {
    const ins = n.inputs.map(i => out.get(i));
    const geom = n.kind === 'meta' && ins.length === 1 ? ins[0].geom
      : sha(`${WGRAPH_VERSION}\0${n.kind}\0${n.op}\0${n.args}\0${ins.map(h => h.geom).join(',')}`);
    const full = sha(`${geom}\0${n.name}\0${n.kind === 'meta' ? `${n.op}\0${n.args}` : ''}\0${ins.map(h => h.full).join(',')}`);
    out.set(n.name, { geom, full });
  }
  return out;
}

// --- canonical text ------------------------------------------------------------------------
// One node per line, in trace order (a valid topological order):
//   <name> = <op>(<args with input names>)  [kind]  @<line>:<column>
// Names are printed bare when they are plain id paths, otherwise JSON-quoted.
const plainName = name => /^[A-Za-z0-9_./:#~*@-]+$/.test(name) && !/^\d/.test(name);
export const showName = name => plainName(name) ? name : JSON.stringify(name);
const KIND_PREFIX = { op: '', meta: 'meta ', select: 'select ', check: 'check ' };

export function substitute(args, inputs) {
  return args.replace(/\$(\d+)/g, (_, i) => showName(inputs[Number(i)]));
}

export function printGraph(graph, { spans = true, hashes = false } = {}) {
  const h = hashes ? hashGraph(graph) : null;
  const lines = [`${WGRAPH_VERSION} ${Object.entries(graph.meta).filter(([k]) => k !== 'version').map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(' ')}`.trimEnd()];
  for (const n of graph.nodes) {
    let line = `${KIND_PREFIX[n.kind]}${showName(n.name)} = ${n.op}(${substitute(n.args, n.inputs)})`;
    if (spans && n.span) line += `  @${n.span.line}:${n.span.column ?? 0}`;
    if (h) line += `  #${h.get(n.name).geom.slice(0, 10)}`;
    lines.push(line);
  }
  for (const o of graph.outputs) lines.push(`out ${showName(o)}`);
  return lines.join('\n') + '\n';
}

// Parser for the canonical text (round trip of printGraph without hashes).
// Input references are the names of earlier nodes; everything else is literal text.
export function parseGraph(text) {
  const lines = text.split('\n').filter(l => l.trim() && !l.trim().startsWith(';'));
  const head = lines.shift();
  if (!head?.startsWith(WGRAPH_VERSION)) throw new Error(`WGraph: expected '${WGRAPH_VERSION}' header`);
  const meta = {};
  for (const m of head.slice(WGRAPH_VERSION.length).matchAll(/([A-Za-z]+)=("(?:[^"\\]|\\.)*"|\S+)/g)) meta[m[1]] = JSON.parse(m[2]);
  const graph = new Graph(meta);
  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith('out ')) { graph.outputs.push(readName(line.slice(4).trim())); continue; }
    let kind = 'op', rest = line;
    for (const k of ['meta', 'select', 'check']) if (rest.startsWith(`${k} `)) { kind = k; rest = rest.slice(k.length + 1); }
    const eq = rest.indexOf(' = ');
    if (eq < 0) throw new Error(`WGraph: cannot parse line '${line}'`);
    const name = readName(rest.slice(0, eq));
    let body = rest.slice(eq + 3), span = null;
    const at = body.match(/\s+@(\d+):(\d+)\s*$/);
    if (at) { span = { line: Number(at[1]), column: Number(at[2]) }; body = body.slice(0, at.index); }
    const open = body.indexOf('(');
    if (open < 0 || !body.endsWith(')')) throw new Error(`WGraph: expected op(args) in '${line}'`);
    const op = body.slice(0, open), argText = body.slice(open + 1, -1);
    // Replace references to known node names by $i slots (longest names first, whole tokens only).
    const inputs = [];
    const args = argText.replace(/"(?:[^"\\]|\\.)*"|[A-Za-z0-9_./:#~*@-]+/g, token => {
      const candidate = token.startsWith('"') ? safeJson(token) : token;
      if (typeof candidate !== 'string' || !graph.byName.has(candidate)) return token;
      let i = inputs.indexOf(candidate);
      if (i < 0) { i = inputs.length; inputs.push(candidate); }
      return `$${i}`;
    });
    graph.add({ name, op, args, inputs, kind, span });
  }
  return graph;
}
const safeJson = s => { try { return JSON.parse(s); } catch { return null; } };
const readName = s => s.startsWith('"') ? JSON.parse(s) : s;

// --- analysis --------------------------------------------------------------------------------
// work = number of nodes of a cost class; span = the largest number of such nodes on
// any dependency path. work/span bounds fork-join speedup (Brent) under equal node cost.
export function analyze(graph, { classes = ['heavy'] } = {}) {
  const weight = n => (n.kind === 'op' && classes.includes(n.cost) ? 1 : 0);
  const depth = new Map(), level = new Map();
  let work = 0, span = 0;
  for (const n of graph.nodes) {
    const w = weight(n); work += w;
    const d = w + Math.max(0, ...n.inputs.map(i => depth.get(i)));
    depth.set(n.name, d); span = Math.max(span, d);
    level.set(n.name, 1 + Math.max(-1, ...n.inputs.map(i => level.get(i))));
  }
  // Width profile of weighted nodes by weighted depth (a greedy fork-join schedule).
  const perDepth = new Map();
  for (const n of graph.nodes) if (weight(n)) perDepth.set(depth.get(n.name), (perDepth.get(depth.get(n.name)) ?? 0) + 1);
  const counts = {};
  for (const n of graph.nodes) counts[n.kind === 'op' ? n.cost : n.kind] = (counts[n.kind === 'op' ? n.cost : n.kind] ?? 0) + 1;
  // Weakly connected components among op nodes (independent parts / sub-assemblies).
  const parent = new Map(graph.nodes.map(n => [n.name, n.name]));
  const find = x => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
  for (const n of graph.nodes) if (n.kind !== 'check') for (const i of n.inputs) parent.set(find(n.name), find(i)); // checks are sinks
  const components = new Map();
  for (const n of graph.nodes) if (weight(n)) components.set(find(n.name), (components.get(find(n.name)) ?? 0) + 1);
  return {
    nodes: graph.nodes.length, counts, work, span,
    parallelism: span ? work / span : null,
    maxWidth: Math.max(0, ...perDepth.values()),
    heavyComponents: [...components.values()].sort((a, b) => b - a),
    levels: Math.max(0, ...level.values()) + (graph.nodes.length ? 1 : 0),
  };
}

// --- diff / incremental reuse -----------------------------------------------------------------
// A node of `next` is reusable when a node with the same hash was computed for `prev`
// (content-addressed cache, any name). `key` = 'full' keeps operation ids in the key.
export function diffGraphs(prev, next, { key = 'full', classes = ['heavy'] } = {}) {
  const hp = hashGraph(prev), hn = hashGraph(next);
  const cached = new Set([...hp.values()].map(h => h[key]));
  let reused = 0, dirty = 0, heavyReused = 0, heavyDirty = 0;
  const dirtyNames = [];
  for (const n of next.nodes) {
    const hit = cached.has(hn.get(n.name)[key]);
    const w = n.kind === 'op' && classes.includes(n.cost);
    if (hit) { reused++; if (w) heavyReused++; } else { dirty++; dirtyNames.push(n.name); if (w) heavyDirty++; }
  }
  const prevNames = new Set(prev.nodes.map(n => n.name)), nextNames = new Set(next.nodes.map(n => n.name));
  return {
    nodes: next.nodes.length, reused, dirty, heavy: heavyReused + heavyDirty, heavyReused, heavyDirty,
    heavyDirtyFraction: heavyReused + heavyDirty ? heavyDirty / (heavyReused + heavyDirty) : 0,
    added: [...nextNames].filter(x => !prevNames.has(x)).length,
    removed: [...prevNames].filter(x => !nextNames.has(x)).length,
    dirtyNames,
  };
}

// Hash-consing union of several graphs (parameter sweeps, configuration variants):
// structurally identical subgraphs are stored and evaluated once.
export function mergeGraphs(graphs, { key = 'full' } = {}) {
  const merged = new Graph({ frontend: 'merge', variants: graphs.length });
  const seen = new Map(); const outputs = [];
  graphs.forEach((g, v) => {
    const h = hashGraph(g); const rename = new Map();
    for (const n of g.nodes) {
      const k = h.get(n.name)[key];
      if (seen.has(k)) { rename.set(n.name, seen.get(k)); continue; }
      const name = merged.freshName(seen.size && merged.byName.has(n.name) ? `v${v}:${n.name}` : n.name);
      merged.add({ ...n, name, inputs: n.inputs.map(i => rename.get(i)) });
      rename.set(n.name, name); seen.set(k, name);
    }
    outputs.push(g.outputs.map(o => rename.get(o)));
  });
  merged.outputs = outputs.flat();
  merged.variantOutputs = outputs;
  return merged;
}
