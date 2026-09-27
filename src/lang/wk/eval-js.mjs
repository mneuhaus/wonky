// JS reference evaluator for WK/0 graphs (prototype, proposal-core-ir.md §7.3).
//
// It executes the top-level nodes of a staged graph in node order with the
// SAME kernel adapters the FeatureScript library calls today (extrudeInBend,
// circularFrustumInBend, booleanInBend, transformInBend on the Bend-to-JS
// kernel). It is the oracle for "staging preserves meaning": the bodies it
// produces must equal those of src/index.mjs build() for the same source.
// Unsupported ops raise a capability error at the node's span; nothing is
// skipped. Regions are not evaluated by this prototype.
import { loadKernel, extrudeInBend, transformInBend } from '../../kernel.mjs';
import { circularFrustumInBend, transformAnalytic } from '../../analytic.mjs';
import { booleanInBend } from '../../boolean.mjs';
import { UnsupportedFeatureError, FeatureScriptError } from '../../errors.mjs';
import { Ref, Param } from './ir.mjs';

const spanLoc = (graph, node) => node.span >= 0 ? graph.spans[node.span] : undefined;

export async function evaluateGraphJS(graph, { modelingPolicy } = {}) {
  const kernel = await loadKernel();
  const values = new Array(graph.nodes.length);
  const value = v => v instanceof Ref ? (v.out === null ? values[v.node] : values[v.node]?.[v.out])
    : v instanceof Param ? (() => { throw new Error('region parameter outside region'); })()
      : Array.isArray(v) ? v.map(value) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, value(x)])) : v;
  const bodies = v => { const x = value(v); return (Array.isArray(x) ? x : [x]).flat(Infinity).filter(Boolean); };
  const trace = [];
  for (const node of graph.nodes) {
    if (node.region !== null) continue;
    const loc = spanLoc(graph, node), a = node.args, id = node.id ?? `wk/${node.n}`;
    const t0 = performance.now();
    try {
      switch (node.op) {
        case 'extrude_polygon':
          if (node.attrs?.invalid) throw new FeatureScriptError(node.attrs.invalid, loc);
          values[node.n] = [extrudeInBend(kernel, id, a.points, a.plane, a.delta, a.offset ?? undefined, node.attrs?.primitive ? { primitive: node.attrs.primitive } : {})];
          break;
        case 'frustum':
          values[node.n] = [circularFrustumInBend(kernel, id, { type: 'circle', ...a.first }, a.second ? { type: 'circle', ...a.second } : null, a.delta, a.offset ?? undefined)];
          break;
        case 'transform': {
          const rows = a.rotation ?? a.transform?.linear, offset = a.offset ?? a.transform?.translation;
          values[node.n] = bodies(a.bodies).map((body, i) => (body.geometry === 'analytic' ? transformAnalytic : transformInBend)(kernel, body, `${id}/${i}`, rows, offset));
          break;
        }
        case 'boolean': {
          const operation = { union: 'UNION', subtract: 'SUBTRACTION', intersect: 'INTERSECTION' }[a.kind];
          const targets = bodies(a.targets), tools = bodies(a.tools);
          const [x, y] = operation === 'SUBTRACTION' ? [targets[0], tools[0]] : [tools[0], tools[1]];
          if ((operation === 'SUBTRACTION' ? targets.length !== 1 || tools.length !== 1 : tools.length !== 2 || targets.length))
            throw new UnsupportedFeatureError('the JS reference evaluator supports Boolean with two operands only (as the FS library today)', loc);
          const result = booleanInBend(kernel, x, y, operation, id, loc, { modelingPolicy });
          // Names/appearance follow the kept record, as library.mjs does.
          for (const body of result) for (const k of ['name', 'appearance']) if (x[k] !== undefined) body[k] = x[k];
          values[node.n] = [...result];
          break;
        }
        case 'evaluate': values[node.n] = bodies(a.query); break;
        case 'count': values[node.n] = value(a.of).length; break;
        case 'cmp': {
          const [x, y] = [value(a.a), value(a.b)];
          values[node.n] = { '==': x === y, '!=': x !== y, '<': x < y, '<=': x <= y, '>': x > y, '>=': x >= y }[a.op];
          break;
        }
        case 'not': values[node.n] = !value(a.x); break;
        case 'choose': values[node.n] = value(a.cond) ? value(a.then) : value(a.else); break;
        case 'expect': if (!value(a.cond)) throw new FeatureScriptError(a.message, loc); values[node.n] = true; break;
        default: throw new UnsupportedFeatureError(`WK op '${node.op}' is not implemented by the JS reference evaluator`, loc);
      }
    } catch (error) {
      error.wkNode = node.n; error.wkId = node.id; error.wkSpan = loc;
      throw error;
    }
    trace.push({ n: node.n, op: node.op, ms: performance.now() - t0 });
  }
  const outputs = graph.outputs.map(o => {
    const out = bodies(o.value);
    for (const body of out) { if (o.name) body.name = o.name; if (o.appearance) body.appearance = o.appearance; }
    return out;
  });
  return { bodies: outputs.flat(), trace };
}
