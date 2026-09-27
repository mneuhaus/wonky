// Per-node oracle for the WK real-model spike: today's production kernel
// adapters on the JS target (or WONKY_BACKEND=native op-at-a-time), applied
// to a recorded WK/0 graph node by node, exactly as src/library.mjs /
// src/queries.mjs call them:
//
//   extrude_polygon -> extrudeInBend(kernel, id, points, plane, delta, offset, {primitive})
//   frustum         -> circularFrustumInBend(kernel, id, first, second, delta, offset)
//   transform       -> transformInBend / transformAnalytic (opPattern)
//   boolean         -> booleanInBend(kernel, a, b, operation, id, loc, {modelingPolicy})
//                      then name/appearance of the kept record (opBoolean), as the
//                      recorder saw them when the operation ran (node.attrs.props)
//
// Unlike build(), a failing node does not stop the run: its error becomes the
// node's value and every dependent node reports "input failed". This is only
// a comparison instrument for graphs that today's build stops on (it never
// produces a model); where build() completes, its bodies are compared too.
import { performance } from 'node:perf_hooks';
import { extrudeInBend, transformInBend, carryPrismInputs } from '../../kernel.mjs';
import { circularFrustumInBend, transformAnalytic } from '../../analytic.mjs';
import { booleanInBend } from '../../boolean.mjs';
import { methodOf } from './record-fs.mjs';

export class InputFailed extends Error {
  constructor(node) { super(`input %${node} failed`); this.name = 'InputFailed'; this.input = node; }
}

export function oracleNodes(graph, kernel, { modelingPolicy, sourceMap = null } = {}) {
  const values = new Map(), errors = new Map(), ms = new Map(), methods = new Map();
  const operations = sourceMap?.operations ?? [];
  const input = ref => {
    if (errors.has(ref.node)) throw new InputFailed(ref.node);
    return values.get(ref.node);
  };
  for (const node of graph.nodes) {
    const a = node.args, loc = node.span >= 0 ? graph.spans[node.span] : null;
    const t0 = performance.now();
    try {
      let bodies;
      switch (node.op) {
        case 'extrude_polygon':
          bodies = [extrudeInBend(kernel, node.id, a.points, a.plane, a.delta, a.offset ?? undefined, node.attrs?.primitive ? { primitive: node.attrs.primitive } : {})];
          break;
        case 'frustum': {
          const circle = c => c && { type: 'circle', center: c.center, radius: c.radius, plane: c.plane };
          bodies = [circularFrustumInBend(kernel, node.id, circle(a.first), circle(a.second), a.delta ?? undefined, a.offset ?? undefined)];
          break;
        }
        case 'transform': {
          // the source body object as production held it when the pattern ran:
          // setProperty had written name / appearance into it (the recorder's props)
          // (the same object there, so it keeps the prism inputs a translation folds, src/kernel.mjs)
          const source = carryPrismInputs(input(a.bodies)[0], { ...input(a.bodies)[0], ...Object.fromEntries(node.attrs?.props ?? []) });
          bodies = [(source.geometry === 'analytic' ? transformAnalytic : transformInBend)(kernel, source, node.id, a.rotation, a.offset)];
          break;
        }
        case 'boolean': {
          const operation = { union: 'UNION', subtract: 'SUBTRACTION', intersect: 'INTERSECTION' }[a.kind];
          const [x, y] = operation === 'SUBTRACTION' ? [a.targets[0], a.tools[0]] : [a.tools[0], a.tools[1]];
          const first = input(x)[0], second = input(y)[0];
          try {
            bodies = [...booleanInBend(kernel, first, second, operation, node.id, loc, { modelingPolicy })];
            methods.set(node.n, methodOf(bodies.operationEvidence?.[0]?.method ?? booleanEvidence(bodies)));
          } catch (error) { methods.set(node.n, error.operationEvidence?.[0]?.method ? methodOf(error.operationEvidence[0].method) : null); throw error; }
          const props = new Map(node.attrs?.props ?? []); // opBoolean: the target body object's name / appearance then
          for (const body of bodies) for (const key of ['name', 'appearance']) if (props.get(key) !== undefined) body[key] = props.get(key);
          break;
        }
        case 'expect_count': {
          const n = a.of.reduce((sum, ref) => sum + input(ref).length, 0);
          if (n !== a.count) throw Object.assign(new Error(`count speculation failed: observed ${a.count}, produced ${n}`), { name: 'ExpectError' });
          bodies = null;
          break;
        }
        default: throw Object.assign(new Error(`WK op '${node.op}' has no production adapter`), { name: 'UnsupportedFeatureError' });
      }
      if (bodies) {
        values.set(node.n, bodies);
        const record = operations[node.sequence];
        if (record) for (const body of bodies) {
          body.debug = { sourceOperation: record.sequence, operationId: record.operationId, source: record.source, callStack: record.callStack };
          if (body.identity?.operation) Object.assign(body.identity.operation, { source: record.source, parameters: record.parameters, callStack: record.callStack });
        }
      }
    } catch (error) {
      errors.set(node.n, { name: error.name, message: String(error.message), line: error.line ?? null, input: error.input ?? null });
    }
    ms.set(node.n, performance.now() - t0);
  }
  return { values, errors, ms, methods };
}
const booleanEvidence = bodies => bodies[0]?.construction?.method ?? null;
