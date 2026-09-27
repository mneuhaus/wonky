// The kernel-operation graph that a WPy program evaluates to. The host
// evaluator (eval.mjs) runs all value-level Python code and emits one node per
// kernel-relevant value: primitives, sketches, placements, Booleans, measures,
// selections, checks. Nodes are pure: a node's result depends only on its op,
// its literal parameters and its inputs. That gives three properties the
// surface language is built around:
//
//   id    - stable, source-derived name (call path / binding / loop index / op),
//           independent of statement order elsewhere in the file;
//   hash  - content hash over (op, params, input hashes), independent of ids and
//           spans; equal hashes mean equal results (cache key, early cutoff);
//   span  - the source location that created the node, for every error.

import { createHash } from 'node:crypto';

export const GRAPH_SCHEMA = 'wonky-graph/0';

const canon = value => {
  if (typeof value === 'number') {
    if (Object.is(value, -0)) return { f64: '-0' };
    if (!Number.isFinite(value)) return { f64: String(value) };
    return value;
  }
  if (typeof value === 'bigint') return { int: value.toString() };
  if (Array.isArray(value)) return value.map(canon);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, canon(value[k])]));
  return value;
};
export const stableJson = value => JSON.stringify(canon(value));

export class Graph {
  constructor({ file = '<wpy>' } = {}) {
    this.file = file;
    this.nodes = [];
    this.byId = new Map();
    this.outputs = [];           // [{name, node}]
    this.checks = [];            // node indices of check nodes
    this.notices = [];           // reported, never control flow
    this.syncPoints = [];        // host reads of kernel results
    this.failureSites = [];      // try blocks around kernel work (orElse sites)
  }
  add(op, params, inputs, { id, span, kind = 'body' }) {
    let finalId = id, n = 2;
    while (this.byId.has(finalId)) finalId = `${id}#${n++}`;
    const hash = createHash('sha256').update(stableJson([op, params, inputs.map(i => this.nodes[i].hash)])).digest('hex').slice(0, 16);
    const node = { index: this.nodes.length, id: finalId, op, params, inputs, span, kind, hash };
    this.nodes.push(node);
    this.byId.set(finalId, node.index);
    return node.index;
  }
  // Nodes a set of roots depends on, in index (= topological) order.
  cone(roots) {
    const seen = new Set(), stack = [...roots];
    while (stack.length) {
      const i = stack.pop();
      if (seen.has(i)) continue;
      seen.add(i);
      stack.push(...this.nodes[i].inputs);
    }
    return [...seen].sort((a, b) => a - b);
  }
  // Canonical text form: one line per node, used for golden tests, diffs and
  // LLM inspection. Literal parameters print as stable JSON.
  text({ spans = true, hashes = true } = {}) {
    const lines = [`; ${GRAPH_SCHEMA} ${this.file}`];
    for (const n of this.nodes) {
      const args = [n.params === null || (typeof n.params === 'object' && !Object.keys(n.params).length) ? null : stableJson(n.params),
        ...n.inputs.map(i => `%${i}`)].filter(x => x !== null);
      const meta = [`id=${n.id}`, spans && n.span ? `at=${n.span.line}:${n.span.col}` : null, hashes ? `h=${n.hash}` : null].filter(Boolean).join(' ');
      lines.push(`%${n.index} = ${n.op}(${args.join(', ')})  ; ${meta}`);
    }
    for (const o of this.outputs) lines.push(`output ${JSON.stringify(o.name)} = %${o.node}`);
    for (const c of this.checks) lines.push(`check %${c}`);
    return lines.join('\n');
  }
  summary() {
    const ops = {};
    for (const n of this.nodes) ops[n.op] = (ops[n.op] ?? 0) + 1;
    return { nodes: this.nodes.length, ops, outputs: this.outputs.length, checks: this.checks.length, syncPoints: this.syncPoints.length, failureSites: this.failureSites.length, notices: this.notices.length };
  }
}

// Structural diff of two graphs by stable id: which nodes kept their result
// (same hash), which changed, which appeared or vanished.
export function diffGraphs(before, after) {
  const out = { unchanged: [], changed: [], added: [], removed: [] };
  for (const n of after.nodes) {
    const j = before.byId.get(n.id);
    if (j === undefined) out.added.push(n.id);
    else if (before.nodes[j].hash === n.hash) out.unchanged.push(n.id);
    else out.changed.push(n.id);
  }
  for (const n of before.nodes) if (!after.byId.has(n.id)) out.removed.push(n.id);
  return out;
}
