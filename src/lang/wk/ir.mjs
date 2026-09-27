// WK/0, the wonky kernel graph: the core IR proposed in
// docs/language/proposal-core-ir.md.
//
// A WK graph is first-order SSA over immutable values. Every node is one kernel
// operation, measurement, query, check or structured region. There are no
// closures, no general recursion, no mutable variables and no host callbacks,
// so one graph can be submitted to the Bend evaluator as a whole and needs no
// host<->kernel synchronization until it finishes. Frontends (FeatureScript,
// build123d) *stage* their programs into WK on the host: all value-level
// computation runs there in IEEE binary64; only kernel work and the values
// that depend on kernel results become nodes. Where a program forces such a
// value (branching on it, looping over it) and no structured node covers the
// idiom, the frontend ends the current graph: a "graph break", the only
// synchronization point (see stage-fs.mjs).
//
// Node   { n, op, args: {name: value}, type, id, span, stack, region }
// Value  number (binary64, mm / rad) | string | boolean | null | array | record
//        (plain object, canonical key order) | Ref (%n or %n.k) | Param ($name)
// Region a sub-graph with parameters, used by `select`, `map` and `fold`; its
//        nodes live in the same node array with `region` = the owner's index.
//
// Content hashes are Merkle hashes over the canonical form of (op, args) with
// references replaced by the referenced node's hash. Ids and spans are NOT
// part of the hash: they name results and map errors back to source, but two
// frontends that request the same geometry get the same hash (proposal §6.6).
import { createHash } from 'node:crypto';

export const WK_SCHEMA = 'wonky-kernel-graph/0';

export class Ref {
  constructor(node, out = null) { this.node = node; this.out = out; }
  toString() { return this.out === null ? `%${this.node}` : `%${this.node}.${this.out}`; }
}
export class Param {
  constructor(region, name) { this.region = region; this.name = name; }
  toString() { return `$${this.name}`; }
}

// Heavy operations dominate kernel time (docs/native-bridge/profile.md: one
// or two Boolean calls carry 76-99.9 % of kernel time). Used for the
// parallelism bound: work / span over heavy nodes.
export const HEAVY = new Set(['boolean', 'fillet', 'chamfer', 'offset_face', 'loft', 'revolve', 'sweep', 'split', 'shell',
  'thicken', 'draft', 'delete_face', 'move_face', 'import', 'text', 'fold']);
// Kernel functions the prototype stages as generic `op` nodes count as heavy too.
const HEAVY_GENERIC = /^(opFillet|opChamfer|opOffsetFace|opRevolve|opSweep|opLoft|opThicken|opSplitPart|opShell|opDraft|opDeleteFace|opMoveFace|opReplaceFace|opBoolean)$/;
export const isHeavy = (node, heavy = HEAVY) => heavy.has(node.op) || (node.op === 'op' && HEAVY_GENERIC.test(node.args.fn ?? ''));

export const canonicalNumber = x => Object.is(x, -0) ? '-0' : String(x);

export function canonical(value, refText = r => r.toString()) {
  if (value instanceof Ref) return refText(value);
  if (value instanceof Param) return value.toString();
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'number') return canonicalNumber(value);
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return `[${value.map(v => canonical(v, refText)).join(', ')}]`;
  if (typeof value === 'object') {
    const keys = Object.keys(value).filter(k => value[k] !== undefined).sort();
    return `{${keys.map(k => `${k}: ${canonical(value[k], refText)}`).join(', ')}}`;
  }
  throw new TypeError(`WK: value ${String(value)} has no canonical form`);
}

export function refsOf(value, out = []) {
  if (value instanceof Ref) out.push(value.node);
  else if (Array.isArray(value)) value.forEach(v => refsOf(v, out));
  else if (value && typeof value === 'object' && !(value instanceof Param)) Object.values(value).forEach(v => refsOf(v, out));
  return out;
}

export class Graph {
  constructor(meta = {}) {
    this.meta = { schema: WK_SCHEMA, ...meta };
    this.nodes = []; this.spans = []; this.spanKeys = new Map(); this.outputs = [];
    this.regionStack = [];
  }
  span(loc, file = this.meta.file ?? null) {
    if (!loc?.line) return -1;
    const key = `${file}:${loc.line}:${loc.column ?? 0}`;
    if (!this.spanKeys.has(key)) { this.spanKeys.set(key, this.spans.length); this.spans.push({ file, line: loc.line, column: loc.column ?? 0 }); }
    return this.spanKeys.get(key);
  }
  get region() { return this.regionStack.at(-1) ?? null; }
  add(op, args = {}, { type = 'value', id = null, span = -1, stack = null, attrs = null } = {}) {
    const n = this.nodes.length;
    this.nodes.push({ n, op, args, type, id, span, stack, attrs, region: this.region?.owner ?? null });
    return new Ref(n);
  }
  // A region is a sub-graph with parameters. It is opened before the owner
  // node exists; the owner index is reserved so that region nodes can name it.
  openRegion(params) {
    const owner = this.nodes.length;
    this.nodes.push(null);
    const region = { owner, params: params.map(p => new Param(owner, p)), results: null };
    this.regionStack.push(region);
    return region;
  }
  closeRegion(region, op, args, results, options = {}) {
    if (this.regionStack.pop() !== region) throw new Error('WK: unbalanced region');
    region.results = results;
    const { type = 'value', id = null, span = -1, stack = null, attrs = null } = options;
    this.nodes[region.owner] = { n: region.owner, op, args, type, id, span, stack, attrs, region: this.region?.owner ?? null,
      body: { params: region.params.map(p => p.name), results } };
    return new Ref(region.owner);
  }
  output(value, { name = null, appearance = null, span = -1 } = {}) { this.outputs.push({ value, name, appearance, span }); }

  topLevel() { return this.nodes.filter(node => node.region === null); }
  inside(owner) { return this.nodes.filter(node => node.region === owner); }
}

// --- content hashes -------------------------------------------------------

export function contentHashes(graph) {
  const hashes = new Array(graph.nodes.length);
  // Memoized and dependency-ordered: a region owner's index precedes its body
  // nodes, and its hash covers the body (params, inner hashes, results).
  const hash = n => {
    if (hashes[n]) return hashes[n];
    const node = graph.nodes[n];
    const refText = r => `#${hash(r.node)}${r.out === null ? '' : `.${r.out}`}`;
    const head = `${node.op}(${canonical(node.args, refText)})`;
    hashes[n] = sha(node.body
      ? `${head}{${node.body.params.join(',')}|${graph.inside(n).map(x => hash(x.n)).join(',')}|${canonical(node.body.results, refText)}}`
      : head);
    return hashes[n];
  };
  for (const node of graph.nodes) hash(node.n);
  return hashes;
}
const sha = text => createHash('sha256').update(text).digest('hex').slice(0, 16);

// --- canonical text -----------------------------------------------------------

export function printGraph(graph, { spans = true, ids = true, hashes = null, sourceName = null } = {}) {
  const lines = [`${graph.meta.schema} frontend=${graph.meta.frontend ?? '?'}${graph.meta.source ? ` source=${graph.meta.source}` : ''}`];
  const where = node => {
    const parts = [];
    if (ids && node.id) parts.push(`@id ${node.id}`);
    if (spans && node.span >= 0) { const s = graph.spans[node.span]; parts.push(`@ ${sourceName ?? s.file ?? ''}:${s.line}:${s.column}`); }
    if (hashes) parts.push(`#${hashes[node.n]}`);
    return parts.length ? `   ; ${parts.join('  ')}` : '';
  };
  const argText = node => Object.entries(node.args).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}=${canonical(v)}`).join(' ');
  const emit = (owner, indent) => {
    for (const node of graph.nodes) {
      if (node.region !== owner) continue;
      const pad = ' '.repeat(indent);
      if (node.body) {
        lines.push(`${pad}%${node.n} = ${node.op} ${argText(node)} (${node.body.params.map(p => `$${p}`).join(' ')}) {${where(node)}`);
        emit(node.n, indent + 2);
        lines.push(`${pad}  yield ${canonical(node.body.results)}`);
        lines.push(`${pad}}`);
      } else lines.push(`${pad}%${node.n} = ${node.op} ${argText(node)}${where(node)}`);
    }
  };
  emit(null, 0);
  for (const out of graph.outputs) {
    const extra = [out.name ? `name=${JSON.stringify(out.name)}` : '', out.appearance ? `appearance=${canonical(out.appearance)}` : ''].filter(Boolean).join(' ');
    lines.push(`out ${canonical(out.value)}${extra ? ` ${extra}` : ''}`);
  }
  return lines.join('\n');
}

// --- structure: levels, work and span ---------------------------------------

// Dependencies of a top-level node, including references made from inside its
// region body (a region depends on everything its body reads from outside).
function deps(graph, node) {
  const own = refsOf(node.args);
  if (node.body) {
    const inner = graph.nodes.filter(x => x && isInside(graph, x, node.n));
    for (const x of inner) own.push(...refsOf(x.args));
    own.push(...refsOf(node.body.results));
  }
  return [...new Set(own)].map(n => topOwner(graph, n)).filter(n => n !== node.n);
}
function isInside(graph, node, owner) {
  for (let r = node.region; r !== null; r = graph.nodes[r].region) if (r === owner) return true;
  return false;
}
function topOwner(graph, n) {
  let node = graph.nodes[n];
  while (node.region !== null) node = graph.nodes[node.region];
  return node.n;
}

// Heavy weight: 1 per heavy op; a region weighs the heavy ops inside it (one
// iteration for fold/reduce). The two `when` arms of one converted if are
// mutually exclusive: work counts only the heavier arm, and the lighter arm
// is ordered after the heavier one for the span, so the bound stays
// conservative (it never counts an if's two arms as parallel work).
export function structure(graph, heavy = HEAVY) {
  const top = graph.topLevel();
  const children = new Map();
  for (const node of graph.nodes) if (node.region !== null) (children.get(node.region) ?? children.set(node.region, []).get(node.region)).push(node);
  const weightOf = new Map();
  const weight = node => {
    if (weightOf.has(node.n)) return weightOf.get(node.n);
    const w = (isHeavy(node, heavy) ? 1 : 0) + (children.get(node.n) ?? []).reduce((s, c) => s + weight(c), 0);
    weightOf.set(node.n, w); return w;
  };
  const arms = new Map();
  for (const node of top) if (node.op === 'when' && node.attrs?.arm) (arms.get(node.attrs.arm) ?? arms.set(node.attrs.arm, []).get(node.attrs.arm)).push(node);
  const extra = new Map(), excluded = new Set();
  for (const pair of arms.values()) if (pair.length === 2) {
    const [heavier, lighter] = weight(pair[0]) >= weight(pair[1]) ? pair : [pair[1], pair[0]];
    excluded.add(lighter.n);
    if (lighter.n > heavier.n) extra.set(lighter.n, heavier.n);
    else extra.set(heavier.n, lighter.n);
  }
  const level = new Map(), heavyDepth = new Map();
  for (const node of top) {
    const ds = deps(graph, node);
    if (extra.has(node.n)) ds.push(extra.get(node.n));
    level.set(node.n, ds.length ? 1 + Math.max(...ds.map(d => level.get(d))) : 0);
    heavyDepth.set(node.n, weight(node) + (ds.length ? Math.max(...ds.map(d => heavyDepth.get(d))) : 0));
  }
  const heavyCount = top.reduce((s, n) => s + (excluded.has(n.n) ? 0 : weight(n)), 0);
  const heavySpan = top.length ? Math.max(0, ...heavyDepth.values()) : 0;
  const levels = top.length ? Math.max(...level.values()) + 1 : 0;
  const widest = [...Array(levels).keys()].reduce((w, l) => Math.max(w, [...level.values()].filter(v => v === l).length), 0);
  const byOp = {};
  for (const node of graph.nodes) byOp[node.op] = (byOp[node.op] ?? 0) + 1;
  return { nodes: graph.nodes.length, topLevel: top.length, levels, widest, heavyCount, heavySpan,
    heavyParallelism: heavySpan ? heavyCount / heavySpan : 1, byOp, level };
}
