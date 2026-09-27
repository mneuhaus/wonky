// build123d -> WK/0 staging frontend (prototype, docs/language/proposal-core-ir.md).
//
// It runs the unchanged shim (python/runner.py + python/build123d.py) in
// CPython exactly like src/python.mjs, but answers every bridge request with a
// *symbolic* shape handle: a WK node instead of a constructed B-rep. Python
// control flow, functions and libraries still run in CPython; only kernel work
// becomes graph nodes. A request whose answer Python needs as a concrete value
// (`volume` today) is a read-back: without an attached backend it is a graph
// break, reported as such, never answered with an invented number.
//
// Stable operation ids come from the Python call path (source line of every
// frame in the user file) plus an occurrence counter per call path, instead of
// today's session-serial `python/N` (docs/language/semantic-core.md, case 18).
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createInterface } from 'node:readline';
import { Graph } from './ir.mjs';

export class GraphBreak extends Error {
  constructor(kind, message, loc) { super(message); this.name = 'GraphBreak'; this.kind = kind; this.loc = loc ?? null; }
}

const ALIGN = { MIN: 0, CENTER: 0.5, MAX: 1 };

// The solid count the shim asks for (python/_b3d_ops.py result classes,
// __bool__ / __len__; src/python.mjs answers get(handle).length): 1 for a
// construction, the source's for a rigid copy, and 1 for a Boolean result.
// That last one is a speculation, the same one the WK evaluator already checks
// natively for every Boolean node (real-run annotateMethods: components 1,
// kernel/lang/wk/real.bend count_ok), so a wrong guess is an expect error there.
function staticCount(graph, ref) {
  const node = graph.nodes[ref.node];
  return node.op === 'transform' ? staticCount(graph, node.args.bodies) : 1;
}
const IDENTITY = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];

// The same numbers src/python.mjs hands to the kernel for each request.
function stageRequest(graph, handles, request, where) {
  const node = (op, args, type = 'bodies') => graph.add(op, args, { type, ...where });
  const shape = handle => {
    if (!handles.has(handle)) throw new Error(`Unknown symbolic shape handle ${handle}`);
    return handles.get(handle);
  };
  switch (request.op) {
    case 'box': {
      const [l, w, h] = request.dimensions;
      const origin = [l, w, h].map((size, i) => -size * ALIGN[request.align[i]]);
      return graph.add('extrude_polygon', { points: [[0, 0], [l, 0], [l, w], [0, w]], plane: { origin, normal: [0, 0, 1], x: [1, 0, 0] },
        delta: [0, 0, h], offset: null, precision: 'F32x2' }, { type: 'bodies', ...where, attrs: { primitive: 'box' } });
    }
    case 'cylinder': {
      const { radius, height } = request;
      const offset = [2 * radius, 2 * radius, height].map((size, i) => -size * ALIGN[request.align[i]]);
      return node('frustum', { first: { center: [0, 0], radius, plane: { origin: [offset[0] + radius, offset[1] + radius, offset[2]], normal: [0, 0, 1], x: [1, 0, 0] } },
        second: null, delta: [0, 0, height], offset: null });
    }
    case 'translate': return node('transform', { bodies: shape(request.handle), rotation: IDENTITY, offset: request.offset });
    case 'boolean': {
      const kind = { UNION: 'union', SUBTRACTION: 'subtract', INTERSECTION: 'intersect' }[request.operation];
      const [a, b] = [shape(request.left), shape(request.right)];
      return kind === 'subtract' ? node('boolean', { kind, targets: [a], tools: [b], keepTools: false }) : node('boolean', { kind, targets: [], tools: [a, b], keepTools: false });
    }
    case 'count': return { count: staticCount(graph, shape(request.handle)) };
    case 'volume': throw new GraphBreak('read-back', 'Python reads a measured volume as a concrete value; this needs a graph break (execute the graph so far, then continue) and no backend is attached', where.loc);
    case 'unsupported': throw Object.assign(new Error(request.message || 'Unsupported build123d API'), { capability: true });
    default: throw Object.assign(new Error(`Unsupported Python bridge request '${request.op}'`), { capability: true });
  }
}

export async function stagePython(source, { filename = '<python>', python, timeoutMs = 30000 } = {}) {
  if (!python) throw new TypeError('stagePython needs the path of a Python interpreter (the reference venv)');
  const graph = new Graph({ frontend: 'build123d', file: filename, source: `sha256:${createHash('sha256').update(source).digest('hex').slice(0, 16)}` });
  const handles = new Map();
  const occurrences = new Map();
  let serial = 0, graphBreak = null, capability = null, completion = null, failure = null;
  const runner = fileURLToPath(new URL('../../../python/runner.py', import.meta.url));
  await new Promise((resolve, reject) => {
    const child = spawn(python, ['-I', '-S', '-B', '-u', runner], { stdio: ['ignore', 'pipe', 'pipe', 'pipe', 'pipe'] });
    let stderr = '';
    const timer = setTimeout(() => { failure ??= new Error(`Python staging exceeded ${timeoutMs} ms`); child.kill('SIGKILL'); }, timeoutMs);
    child.stderr.setEncoding('utf8'); child.stderr.on('data', c => { stderr += c; });
    child.stdout.resume();
    const lines = createInterface({ input: child.stdio[4], crlfDelay: Infinity });
    lines.on('line', line => {
      const message = JSON.parse(line);
      if (message.type === 'complete') { completion = message; return; }
      if (message.type === 'failure') { failure ??= Object.assign(new Error(`${message.error.type}: ${message.error.message}`), { line: message.error.line }); return; }
      const loc = message.location ? { line: message.location.line, column: 1 } : null;
      // Stable id: the user-file call path, plus an occurrence counter so a
      // loop or helper called twice from the same place gets distinct ids.
      const path = (message.callStack ?? []).map(f => `L${f.calledAt.line}`).join('/') || 'L?';
      const k = (occurrences.get(path) ?? 0) + 1; occurrences.set(path, k);
      const where = { id: `py/${path}#${k}`, span: graph.span(loc), loc,
        stack: (message.callStack ?? []).map(f => graph.span({ line: f.calledAt.line, column: 1 })) };
      let response;
      try {
        if (capability || graphBreak) throw capability ?? graphBreak;
        const ref = stageRequest(graph, handles, message, where);
        if (ref?.count !== undefined) response = { id: message.id, ok: true, value: ref.count };
        else {
          const handle = `wk-${++serial}`; handles.set(handle, ref);
          response = { id: message.id, ok: true, value: handle };
        }
      } catch (error) {
        if (error instanceof GraphBreak) graphBreak ??= error;
        else if (error.capability) capability ??= error;
        response = { id: message.id, ok: false, error: { type: error.capability || error instanceof GraphBreak ? 'UnsupportedFeatureError' : 'GeometryError', message: error.message } };
      }
      child.stdio[3].write(JSON.stringify(response) + '\n');
    });
    child.on('close', () => { clearTimeout(timer); lines.close(); if (!completion && !failure && !graphBreak && !capability) failure = new Error(`Python exited without a result: ${stderr.trim()}`); resolve(); });
    child.on('error', reject);
    child.stdio[3].write(JSON.stringify({ source, filename }) + '\n');
  });
  // python/runner.py reports the result as `handle` (git HEAD) or, since the
  // build123d frontend work of 2026-09-23, as `outputs` [{kind, name, handle, ...}].
  if (completion) {
    const outs = completion.handle ? [{ handle: completion.handle }] : (completion.outputs ?? []).filter(o => o.handle);
    if (!outs.length) failure = new Error('Python completed without a result shape');
    for (const o of outs) graph.output(handles.get(o.handle), { name: outs.length === 1 ? 'result' : (o.name ?? 'result') });
  }
  return { graph, graphBreak, capability, failure: completion && graph.outputs.length ? null : failure };
}
