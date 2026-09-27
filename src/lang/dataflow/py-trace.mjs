// build123d -> WGraph/0 through wonky's own shim (python/runner.py,
// python/build123d.py). CPython executes the program exactly as today; the
// host answers every shim request *lazily*: it appends a graph node and hands
// back the node name as the shape handle, instead of building a B-rep. A
// request whose answer the Python program needs as a value (`volume`) is a
// graph break: it fails with an explicit capability error naming the break.
//
// Node names are derived from the call site (op @ line, plus an occurrence
// counter), not from the session-serial `python/N` handles. They are
// positional, so caches for Python graphs key on the `geom` hash (see
// graph.mjs), which does not contain names.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { Graph } from './graph.mjs';

const runner = fileURLToPath(new URL('../../../python/runner.py', import.meta.url));
const num = x => (Object.is(x, -0) ? '-0' : String(x));
const vec = xs => `[${xs.map(num).join(',')}]`;

export function tracePython(source, { filename = '<python>', python = ['uv', 'run', '--no-project', '--offline', 'python'], timeoutMs = 60000 } = {}) {
  const t0 = performance.now();
  const graph = new Graph({ frontend: 'build123d', source: filename });
  const seen = new Map();
  const name = (op, line) => {
    const base = `${op}@${line ?? 0}`; const k = (seen.get(base) ?? 0) + 1; seen.set(base, k);
    return k === 1 ? base : `${base}#${k}`;
  };
  let breakInfo = null;
  // The shim's solid count (python/_b3d_ops.py result classes, __bool__ / __len__):
  // 1 for a primitive, the input's for a translation, and 1 speculated for a
  // Boolean (as src/lang/wk/stage-py.mjs). This tracer does not check that guess;
  // the WK real-model evaluator does (every Boolean node expects 1 component).
  const count = handle => {
    const node = graph.byName.get(handle);
    if (!node) throw Object.assign(new Error(`count of unknown shape handle ${handle}`), { capability: true });
    return node.op === 'translate' ? count(node.inputs[0]) : 1;
  };
  const answer = message => {
    const line = message.location?.line ?? null, span = line ? { line, column: 0 } : null;
    const add = (op, args, inputs, data) => graph.add({ name: name(op, line), op, args, inputs, span, data }).name;
    switch (message.op) {
      case 'box': return add('box', `size=${vec(message.dimensions)}mm,align=[${message.align.join(',')}]`, [], { size: message.dimensions, align: message.align });
      case 'cylinder': return add('cylinder', `radius=${num(message.radius)}mm,height=${num(message.height)}mm,align=[${message.align.join(',')}]`, [], { radius: message.radius, height: message.height, align: message.align });
      case 'translate': return add('translate', `$0,by=${vec(message.offset)}mm`, [message.handle], { offset: message.offset });
      case 'boolean': {
        const op = { UNION: 'boolean.union', SUBTRACTION: 'boolean.subtract', INTERSECTION: 'boolean.intersect' }[message.operation];
        if (!op) throw Object.assign(new Error(`Unknown Boolean ${message.operation}`), { capability: true });
        return add(op, '$0,$1', [message.left, message.right]);
      }
      case 'count': return count(message.handle);
      case 'volume':
        breakInfo = { site: 'volume', line };
        throw Object.assign(new Error(`graph break: volume() of ${message.handle} returns a measured value to Python (line ${line})`), { capability: true });
      case 'unsupported': throw Object.assign(new Error(message.message), { capability: true });
      default: throw Object.assign(new Error(`Unsupported bridge request '${message.op}'`), { capability: true });
    }
  };
  return new Promise((resolve, reject) => {
    const [cmd, ...pre] = python;
    const child = spawn(cmd, [...pre, '-I', '-S', '-B', '-u', runner], { stdio: ['ignore', 'pipe', 'pipe', 'pipe', 'pipe'] });
    let stderr = '', result = null, failure = null;
    const timer = setTimeout(() => { failure = new Error(`Python exceeded ${timeoutMs} ms`); child.kill('SIGKILL'); }, timeoutMs);
    child.stderr.on('data', d => { stderr += d; });
    child.stdout.on('data', () => {});
    const lines = createInterface({ input: child.stdio[4], crlfDelay: Infinity });
    lines.on('line', line => {
      const message = JSON.parse(line);
      if (message.type === 'complete') { result = message; return; }
      if (message.type === 'failure') { failure ??= Object.assign(new Error(`${message.error.type}: ${message.error.message}`), { line: message.error.line }); return; }
      let response;
      try { response = { id: message.id, ok: true, value: answer(message) }; }
      catch (error) { response = { id: message.id, ok: false, error: { type: error.capability ? 'UnsupportedFeatureError' : 'GeometryError', message: error.message } }; }
      child.stdio[3].write(JSON.stringify(response) + '\n');
    });
    child.on('close', code => {
      clearTimeout(timer); lines.close();
      const ms = performance.now() - t0;
      if (result) { graph.outputs = [result.handle]; resolve({ graph, status: 'complete', ms }); return; }
      if (breakInfo) { resolve({ graph, status: 'break', break: breakInfo, ms }); return; }
      reject(failure ?? new Error(`Python exited ${code}: ${stderr.trim().slice(0, 400)}`));
    });
    child.stdio[3].write(JSON.stringify({ source, filename }) + '\n');
  });
}
