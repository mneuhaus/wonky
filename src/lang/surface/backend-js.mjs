// Reference backend: evaluates wonky-graph/0 nodes with the production wonky
// kernel functions on the Bend JS target — exactly the functions the build123d
// shim (src/python.mjs) and the FeatureScript builtins (src/library.mjs) call.
// No geometry is computed here; this file only routes node parameters to Bend.
//
// Results are memoized by (content hash, stable id): a rebuild after an edit
// re-evaluates only nodes whose hash changed (early cutoff), while identity
// metadata stays tied to the node's own id.

import { loadKernel, extrudeInBend, transformInBend } from '../../kernel.mjs';
import { circularFrustumInBend, transformAnalytic } from '../../analytic.mjs';
import { booleanInBend } from '../../boolean.mjs';
import { signedArea, validatePolygon } from '../../brep.mjs';
import { UnsupportedFeatureError } from '../../errors.mjs';
import { WpyError } from './values.mjs';

const OFFSET = { MIN: 0, CENTER: 0.5, MAX: 1, NONE: 0 };
const identity = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
const mulRows = (A, B) => [0, 1, 2].map(i => [0, 1, 2].map(j => A[i][0] * B[0][j] + A[i][1] * B[1][j] + A[i][2] * B[2][j]));
const apply = (R, v) => [0, 1, 2].map(i => R[i][0] * v[0] + R[i][1] * v[1] + R[i][2] * v[2]);

export class JsBackend {
  constructor(kernel, { namespace = 'wpy', file = null } = {}) {
    this.kernel = kernel; this.namespace = namespace; this.file = file;
    this.cache = new Map();
    this.stats = { evaluated: 0, cacheHits: 0, kernelMs: 0 };
  }
  static async create(options) { return new JsBackend(await loadKernel(), options); }

  // Wrap kernel failures: capability errors stay capability errors (never
  // catchable); anything else is a KernelError (catchable by try/except).
  guard(node, fn) {
    try { return fn(); }
    catch (error) {
      if (error instanceof WpyError) throw error;
      const kind = error instanceof UnsupportedFeatureError ? 'capability' : 'model';
      const wrapped = new WpyError(kind, `${node.op} (${node.id}): ${error.message}`, node.span, { pyType: kind === 'model' ? 'KernelError' : undefined });
      wrapped.cause = error;
      throw wrapped;
    }
  }
  ensure(graph, index, span) { return this.eval(graph, index, span); }
  valueOf(graph, index, span) { return this.eval(graph, index, span); }

  eval(graph, index) {
    const node = graph.nodes[index];
    const key = `${node.hash}|${node.id}`;
    if (this.cache.has(key)) { this.stats.cacheHits++; return this.cache.get(key); }
    const inputs = node.inputs.map(i => this.eval(graph, i));
    const t0 = performance.now();
    const value = this.guard(node, () => this.compute(node, inputs));
    this.stats.kernelMs += performance.now() - t0;
    this.stats.evaluated++;
    this.cache.set(key, value);
    return value;
  }

  identityContext(node, extra = {}) {
    return { namespace: this.namespace, operationId: node.id, occurrenceId: node.id,
      source: { file: this.file, sha256: null, span: node.span ? { line: node.span.line, column: node.span.col } : null }, ...extra };
  }
  kid(node) { return `${this.namespace}/${node.id}`; }

  compute(node, inputs) {
    const p = node.params, k = this.kernel;
    const unsupported = what => { throw new WpyError('capability', `${what} is not implemented by the wonky kernel (node ${node.id})`, node.span); };
    switch (node.op) {
      case 'box': {
        const [l, w, h] = p.size;
        const origin = p.size.map((s, i) => -s * OFFSET[p.align[i]]);
        return [extrudeInBend(k, this.kid(node), [[0, 0], [l, 0], [l, w], [0, w]], { origin, normal: [0, 0, 1], x: [1, 0, 0] }, [0, 0, h], undefined, this.identityContext(node, { primitive: 'box' }))];
      }
      case 'cylinder': {
        const { radius, height } = p;
        const off = [2 * radius, 2 * radius, height].map((s, i) => -s * OFFSET[p.align[i]]);
        return [circularFrustumInBend(k, this.kid(node), { center: [0, 0], radius, plane: { origin: [off[0] + radius, off[1] + radius, off[2]], normal: [0, 0, 1], x: [1, 0, 0] } }, null, [0, 0, height])];
      }
      // 2D profiles are data: {frame: {rows, offset}, shape}. Placement composes
      // frames; the kernel lifts the profile into 3D (geometry.frame / lift_points).
      case 'polygon': {
        const pts = p.points;
        const lo = [0, 1].map(i => Math.min(...pts.map(q => q[i]))), hi = [0, 1].map(i => Math.max(...pts.map(q => q[i])));
        const shift = [0, 1].map(i => p.align[i] === 'NONE' ? 0 : -(lo[i] + (hi[i] - lo[i]) * OFFSET[p.align[i]]));
        return { frame: { rows: identity, offset: [0, 0, 0] }, shape: { type: 'polygon', points: pts.map(q => [q[0] + shift[0], q[1] + shift[1]]) } };
      }
      case 'rectangle': {
        const [w, h] = p.size, x0 = -w * OFFSET[p.align[0]], y0 = -h * OFFSET[p.align[1]];
        return { frame: { rows: identity, offset: [0, 0, 0] }, shape: { type: 'polygon', points: [[x0, y0], [x0 + w, y0], [x0 + w, y0 + h], [x0, y0 + h]] } };
      }
      case 'circle': {
        if (p.align.some(a => a !== 'CENTER')) unsupported('Circle with non-centered align');
        return { frame: { rows: identity, offset: [0, 0, 0] }, shape: { type: 'circle', center: [0, 0], radius: p.radius } };
      }
      case 'move': {
        const [x] = inputs;
        if (node.kind === 'sketch') {
          const f = x.frame;
          return { ...x, frame: { rows: mulRows(p.rows, f.rows), offset: apply(p.rows, f.offset).map((v, i) => v + p.offset[i]) } };
        }
        return x.map((body, i) => (body.geometry === 'analytic' ? transformAnalytic : transformInBend)(k, body, `${this.kid(node)}/${i}`, p.rows, p.offset));
      }
      case 'extrude': {
        const [sk] = inputs, R = sk.frame.rows;
        const normal = [R[0][2], R[1][2], R[2][2]];
        // both=True: symmetric about the sketch plane (build123d semantics)
        const plane = { origin: p.both ? sk.frame.offset.map((v, i) => v - normal[i] * p.amount) : sk.frame.offset, x: [R[0][0], R[1][0], R[2][0]], normal };
        const delta = normal.map(v => v * p.amount * (p.both ? 2 : 1));
        if (sk.shape.type === 'circle') {
          if (p.amount <= 0) unsupported('negative circular extrusion');
          return [circularFrustumInBend(k, this.kid(node), { center: sk.shape.center, radius: sk.shape.radius, plane }, null, delta)];
        }
        validatePolygon(sk.shape.points);
        // same orientation rule as FeatureScript opExtrude (src/library.mjs body())
        const oriented = signedArea(sk.shape.points) * p.amount < 0 ? [...sk.shape.points].reverse() : sk.shape.points;
        return [extrudeInBend(k, this.kid(node), oriented, plane, delta, undefined, this.identityContext(node))];
      }
      case 'union': case 'subtract': case 'intersect': {
        const [a, b] = inputs;
        if (a.length !== 1 || b.length !== 1) unsupported('Boolean operands with several solids');
        const op = { union: 'UNION', subtract: 'SUBTRACTION', intersect: 'INTERSECTION' }[node.op];
        return booleanInBend(k, a[0], b[0], op, this.kid(node));
      }
      case 'volume': {
        const v = inputs[0].map(b => b.validation?.volumeMm3);
        if (v.some(x => !Number.isFinite(x))) unsupported('volume of this body');
        return v.reduce((s, x) => s + x, 0);
      }
      // selections are not in the Bend kernel yet; only whole-body entity counts (decoded view, as FS evaluateQuery)
      case 'entities': return { kind: p.kind, bodies: inputs[0] };
      case 'count': {
        const sel = inputs[0];
        if (!sel || !sel.kind) unsupported('counting this selection');
        return sel.kind === 'solids' ? sel.bodies.length : sel.bodies.reduce((s, b) => s + b[sel.kind].length, 0);
      }
      case 'arith': return arithNode(p, inputs);
      case 'check': return inputs[0];
      default: unsupported(`operation '${node.op}'`);
    }
  }
}

function arithNode(p, inputs) {
  let k = 0;
  const vals = p.consts.map(c => (c === null ? inputs[k++] : c));
  const [a, b] = vals;
  switch (p.op) {
    case '+': return a + b; case '-': return a - b; case '*': return a * b; case '/': return a / b;
    case '<': return a < b; case '<=': return a <= b; case '>': return a > b; case '>=': return a >= b;
    case '==': return a === b; case '!=': return a !== b; case 'abs': return Math.abs(a); case 'neg': return -a;
    case 'and': return a && b; case 'or': return a || b; case 'min': return Math.min(a, b); case 'max': return Math.max(a, b);
  }
  throw new WpyError('capability', `measure arithmetic '${p.op}' is not implemented in the reference backend`, null);
}

// Evaluate outputs and checks of a graph. Returns bodies per output and check
// results; errors keep the node's span.
export function runGraph(graph, backend) {
  const outputs = graph.outputs.map(o => ({ name: o.name, id: graph.nodes[o.node].id, bodies: backend.eval(graph, o.node) }));
  const checks = graph.checks.map(c => ({ id: graph.nodes[c].id, message: graph.nodes[c].params.message, span: graph.nodes[c].span, ok: !!backend.eval(graph, c) }));
  return { outputs, checks };
}
