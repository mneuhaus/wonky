#!/usr/bin/env node
// Sync-point trace for the batched native-binding design (docs/native-bridge/proposal-batched.md).
//
// Question: if the interpreter recorded kernel operations and submitted them in batches, how often
// would real models force a flush, and how much independent work would each batch contain?
//
// Each workload runs in its own child process. The child patches prototypes (ModelingContext.builtins,
// Interpreter.statement/expression) and wraps the loadKernel() object in place. Nothing under src/,
// kernel/ or bin/ is edited. Two modes:
//
//   eager   the production path with the real JS-target kernel. Records every modeling builtin in
//           program order: kernel ms charged to it, the earlier operations whose bodies it consumes,
//           try-nesting, reads of kernel results, catchable errors, and the actual Boolean result count.
//   record  kernel-backed builtins are replaced by bookkeeping-only stand-ins that predict one body per
//           Boolean (the recorder the proposal describes). Host checks that do not need geometry still
//           run. Reads that need geometry are recorded as hard syncs; the value is fabricated so the
//           program can continue, and everything after the first fabricated value is marked estimated.
//           Two builtins wonky does not implement (opRevolve, opFillet) get stand-ins in this mode only,
//           flagged 'hypothetical', so the structure of the whole r10b program becomes visible.
//
// The parent then replays the event list under three flush policies (see simulate()).
//
//   node scripts/native-bridge/sync-trace.mjs [--only id,id] [--modes eager,record]
// Output: out/native-bridge/batched/sync-trace.json
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

const root = fileURLToPath(new URL('../../', import.meta.url));
const outPath = join(root, 'out/native-bridge/batched/sync-trace.json');
const python = join(root, 'out/build123d-performance/reference-venv/bin/python');
const cases = join(root, 'fixtures/performance-build123d/cases');

export const workloads = [
  { id: 'py-planar-union', frontend: 'python', file: join(cases, 'planar-union.py') },
  { id: 'py-planar-pocket', frontend: 'python', file: join(cases, 'planar-pocket.py') },
  { id: 'py-frame-with-tab', frontend: 'python', file: join(cases, 'frame-with-tab.py') },
  { id: 'fs-bracket', frontend: 'featurescript', file: join(root, 'examples/bracket.fs') },
  { id: 'fs-bored-spacer-print', frontend: 'featurescript', file: join(root, 'examples/bored-spacer.fs') },
  { id: 'fs-fuse-g1', frontend: 'featurescript', file: join(root, 'fixtures/public-boolean-regressions/adapted/fuse-g1.fs') },
  { id: 'fs-cut-h1', frontend: 'featurescript', file: join(root, 'fixtures/public-boolean-regressions/adapted/cut-h1.fs') },
  { id: 'fs-r10b-strict', frontend: 'featurescript', file: join(root, 'fixtures/r10b/r10b.fs'), feature: 'singleStepR10b',
    modules: join(root, 'fixtures/r10b/modules.json') },
  // Acceptance policy (local design note): reaches UpperCore/g10, so it measures g2/g4/g7/g9. Eager only.
  { id: 'fs-r10b-tolerated', frontend: 'featurescript', file: join(root, 'fixtures/r10b/r10b.fs'), feature: 'singleStepR10b',
    modules: join(root, 'fixtures/r10b/modules.json'), policy: { curvedContacts: 'tolerated-regularized', contactCapMm: 1e-7 }, eagerOnly: true },
  // The nine exported r10b subassembly features, record mode only (structure; no kernel execution).
  ...['UpperCore', 'LowerCore', 'Carriage', 'SideDrive', 'Frames', 'TrayArms', 'CameraSupports', 'TransferEdge', 'RetainedContext'].map(part => ({
    id: `fs-r10b-part-${part}`, frontend: 'featurescript', file: join(root, 'fixtures/r10b/r10b.fs'), feature: `r10b${part}`,
    modules: join(root, 'fixtures/r10b/modules.json'), recordOnly: true })),
];

const KERNEL_OPS = new Set(['opExtrude', 'opLoft', 'opBoolean', 'fCuboid', 'opPattern', 'instantiate', 'skSolve', 'opRevolve', 'opFillet']);
const STRUCTURAL_OPS = new Set(['opDeleteBodies', 'setProperty']);
const READS = new Set(['evaluateQuery', 'getProperty', 'evVolume', 'evBox3d', 'evLine']);
const HYPOTHETICAL = new Set(['opRevolve', 'opFillet']);

function load() {
  const text = spawnSync('uptime', { encoding: 'utf8' }).stdout.trim();
  const match = /load averages?:\s*([\d.]+),?\s+([\d.]+),?\s+([\d.]+)/.exec(text);
  return match ? Number(match[1]) : null;
}

// Wrap the shared loadKernel() object in place; only outermost host->kernel calls are timed.
function wrapKernel(kernel, onCharge) {
  let depth = 0;
  const wrap = fn => function wrapped(...args) {
    if (depth) return fn.apply(this, args);
    depth++; const t = performance.now();
    try { return fn.apply(this, args); } finally { depth--; onCharge(performance.now() - t); }
  };
  for (const [key, value] of Object.entries(kernel)) {
    if (typeof value === 'function') kernel[key] = wrap(value);
    else if (value && typeof value === 'object') kernel[key] = Object.fromEntries(Object.entries(value).map(([n, f]) => [n, typeof f === 'function' ? wrap(f) : f]));
  }
}

// ---------------------------------------------------------------- child ---
async function child(id, mode, resultPath) {
  const workload = workloads.find(w => w.id === id);
  const { ModelingContext } = await import('../../src/library.mjs');
  const { Interpreter } = await import('../../src/interpreter.mjs');
  const { resolveTopology } = await import('../../src/queries.mjs');
  const { loadKernel } = await import('../../src/kernel.mjs');
  const { FeatureScriptError, UnsupportedFeatureError, unsupported } = await import('../../src/errors.mjs');
  const { Quantity, map, Vector } = await import('../../src/values.mjs');

  const events = [], tryStack = [], tryFrames = [];
  let current = null, estimatedFrom = null;
  const producer = new WeakMap();                 // body or sketch object -> event seq
  const unattributed = { kernelMs: 0, kernelCalls: 0 };
  // Every host->kernel call is charged to the running modeling builtin (FeatureScript) or request (Python).
  const kernel = await loadKernel();
  if (workload.frontend === 'featurescript') wrapKernel(kernel, (ms) => { const target = current ?? unattributed; target.kernelMs += ms; target.kernelCalls++; });

  // try / try silent nesting.
  const tracked = (kind, line, run) => {
    const frame = { kind, line, ops: 0, pendingOps: [] }; tryStack.push(frame);
    try { return run(); } finally {
      tryStack.pop();
      if (frame.ops) tryFrames.push({ kind, line, ops: frame.ops, closesAtSeq: events.length });
    }
  };
  const statement = Interpreter.prototype.statement;
  Interpreter.prototype.statement = function (node, env, precondition) {
    return node.kind === 'try' ? tracked('try', node.loc?.line, () => statement.call(this, node, env, precondition)) : statement.call(this, node, env, precondition);
  };
  const expression = Interpreter.prototype.expression;
  Interpreter.prototype.expression = function (node, env) {
    return node.kind === 'tryExpression' ? tracked('try silent', node.loc?.line, () => expression.call(this, node, env)) : expression.call(this, node, env);
  };

  const ownedIn = query => !!query && typeof query === 'object' && (query.kind === 'owned' ||
    ['query', 'a', 'b'].some(k => ownedIn(query[k])) || (Array.isArray(query.queries) && query.queries.some(ownedIn)));
  const inputsOf = (engine, name, args) => {
    // Queries resolve in the context they name; a frozen module context holds imports only.
    const scope = args[0]?.engine ?? engine;
    const rowsOf = query => { try { return resolveTopology(scope, query); } catch { return []; } };
    const sources = [];
    const fromRows = rows => {
      for (const row of rows) {
        if (scope !== engine || engine.records.get(row.record.key) !== row.record) { sources.push('import'); continue; }
        if (row.record.kind === 'sketch') { sources.push(producer.get(row.record.sketch) ?? 'host'); continue; }
        sources.push(producer.get(row.record.body) ?? 'untracked');
      }
    };
    const d = args[2] ?? {};
    const sketchOf = q => engine.sketches.get(q?.id?.key?.());
    switch (name) {
      case 'opExtrude': sources.push(producer.get(sketchOf(d.entities)) ?? 'host'); break;
      case 'opLoft': for (const q of d.profileSubqueries ?? []) sources.push(producer.get(sketchOf(q)) ?? 'host'); break;
      case 'opRevolve': sources.push(producer.get(sketchOf(d.entities)) ?? 'host'); break;
      case 'opBoolean': fromRows(rowsOf(d.tools)); if (d.targets) fromRows(rowsOf(d.targets)); break;
      case 'opPattern': case 'opDeleteBodies': case 'opFillet': fromRows(rowsOf(d.entities)); break;
      case 'setProperty': fromRows(rowsOf(args[1]?.entities)); break;
      case 'instantiate': sources.push('import'); break;
      case 'evaluateQuery': fromRows(rowsOf(args[1])); break;
      case 'getProperty': fromRows(rowsOf(args[1]?.entity)); break;
      case 'evVolume': fromRows(rowsOf(args[1]?.entities)); break;
      case 'evBox3d': fromRows(rowsOf(args[1]?.topology)); break;
      case 'evLine': fromRows(rowsOf(args[1]?.edge)); break;
    }
    return sources;
  };
  const opIdOf = args => { const v = args.find(a => a?.constructor?.name === 'Id'); return v ? String(v) : null; };

  // ---- record-mode stand-ins (bookkeeping only; predicted one body per Boolean) ----
  const placeholder = (id, extra = {}) => ({ id, placeholder: true, geometry: 'placeholder', vertices: [], edges: [], faces: [], validation: { volumeMm3: null, boundsMm: null }, ...extra });
  const recordModeBuiltins = (engine, real) => {
    const withBody = (name, fn) => ({ ...real[name] ?? { type: 'builtin', name, min: 3, max: 3 }, call: fn });
    const bool = (args, loc) => {
      const [context, id, d] = args;
      const operation = d.operationType?.name;
      const tools = resolveTopology(engine, d.tools, loc), targets = d.targets === undefined ? [] : resolveTopology(engine, d.targets, loc);
      const subtract = operation === 'SUBTRACTION';
      if (subtract ? tools.length !== 1 || targets.length !== 1 : tools.length !== 2 || d.targets !== undefined) unsupported('opBoolean currently requires two tools for union/intersection, or one target and one tool for subtraction', loc);
      const records = (subtract ? [...targets, ...tools] : tools).map(r => r.record);
      engine.claim(context, id, loc);
      const lineage = new Set([...records[0].createdBy, ...(subtract ? [] : records[1].createdBy), id.key()]);
      if (!subtract || !d.keepTools) engine.records.delete(records[1].key);
      records[0].body = placeholder(String(id), { name: records[0].body?.name });
      records[0].createdBy = lineage;
    };
    return {
      skSolve: withBody('skSolve', (args, loc, interp) => {
        const [sketch] = args;
        if (!sketch.curveEntities?.length) return real.skSolve.call(args, loc, interp);   // polyline/rect/circle: no kernel call
        engine.sketch(sketch, loc, true);
        sketch.profiles.push(sketch.curveEntities.some(e => e.type === 'arc') ? { type: 'line-arc', native: null } : [[0, 0], [1, 0], [0, 1]]);
        sketch.solved = true;
        const key = String(engine.nextRecord++); engine.records.set(key, { key, kind: 'sketch', sketch, createdBy: new Set([sketch.id.key()]) });
      }),
      opExtrude: withBody('opExtrude', ([context, id, d], loc) => { engine.resolve(d.entities, loc); engine.claim(context, id, loc); engine.addSolid(id, placeholder(String(id))); }),
      opLoft: withBody('opLoft', ([context, id, d], loc) => { for (const q of d.profileSubqueries) engine.resolve(q, loc); engine.claim(context, id, loc); engine.addSolid(id, placeholder(String(id))); }),
      opRevolve: withBody('opRevolve', ([context, id, d], loc) => { engine.resolve(d.entities, loc); engine.claim(context, id, loc); engine.addSolid(id, placeholder(String(id))); }),
      opFillet: withBody('opFillet', ([context, id], loc) => { engine.claim(context, id, loc); }),
      fCuboid: withBody('fCuboid', ([context, id], loc) => { engine.claim(context, id, loc); engine.addSolid(id, placeholder(String(id))); }),
      opBoolean: withBody('opBoolean', bool),
      opPattern: withBody('opPattern', ([context, id, d], loc) => {
        engine.claim(context, id, loc);
        const source = resolveTopology(engine, d.entities, loc);
        d.transforms.forEach((t, i) => { for (const row of source) engine.addSolid(id, placeholder(`${id}/${d.instanceNames[i]}`)); });
      }),
      instantiate: withBody('instantiate', ([context, instantiator], loc) => {
        const instances = instantiator.instances.flatMap(i => i.rows.map(row => ({ id: i.id, name: row.record.name })));
        engine.claim(context, instantiator.id, loc);
        for (const { id, name } of instances) engine.addSolid(id, placeholder(String(id), { name }));
        instantiator.done = true;
      }),
      // Hard syncs: the value would need geometry. Fabricate and mark the rest of the run as estimated.
      evaluateQuery: withBody('evaluateQuery', (args, loc, interp) => {
        if (ownedIn(args[1])) { estimatedFrom ??= events.length; return []; }
        return real.evaluateQuery.call(args, loc, interp);
      }),
      evVolume: withBody('evVolume', () => { estimatedFrom ??= events.length; return new Quantity(1e-6, 3); }),
      evBox3d: withBody('evBox3d', () => { estimatedFrom ??= events.length; const z = new Vector([new Quantity(0), new Quantity(0), new Quantity(0)]); return map({ minCorner: z, maxCorner: z }); }),
      evLine: withBody('evLine', (args, loc) => { estimatedFrom ??= events.length; throw new FeatureScriptError('fabricated: evLine needs geometry', loc); }),
    };
  };

  const builtins = ModelingContext.prototype.builtins;
  ModelingContext.prototype.builtins = function () {
    const engine = this, real = builtins.call(this);
    const table = mode === 'record' ? { ...real, ...recordModeBuiltins(engine, real) } : real;
    for (const [name, fn] of Object.entries(table)) {
      if (fn?.type !== 'builtin' || !(KERNEL_OPS.has(name) || STRUCTURAL_OPS.has(name) || READS.has(name))) continue;
      const call = fn.call;
      table[name] = { ...fn, call(args, loc, interp) {
        const event = { seq: events.length, name, opId: opIdOf(args), line: loc?.line ?? null, tryDepth: tryStack.length,
          kind: KERNEL_OPS.has(name) ? 'op' : STRUCTURAL_OPS.has(name) ? 'structural' : 'read',
          inputs: [], kernelMs: 0, kernelCalls: 0, hypothetical: HYPOTHETICAL.has(name) || undefined };
        if (name === 'evaluateQuery' && ownedIn(args[1])) event.geometric = true;
        if (['evVolume', 'evBox3d', 'evLine'].includes(name)) event.geometric = true;
        event.inputs = inputsOf(engine, name, args);
        if (event.kind === 'op') for (const frame of tryStack) frame.ops++;
        const before = new Set(engine.bodies);
        const outer = current; current = event; const t = performance.now();
        let result, error;
        try { result = call.call(this, args, loc, interp); return result; }
        catch (caught) {
          error = caught;
          event.error = { name: caught?.name, catchable: caught instanceof FeatureScriptError && !(caught instanceof UnsupportedFeatureError), message: String(caught?.message).slice(0, 200) };
          throw caught;
        } finally {
          event.wallMs = performance.now() - t; current = outer;
          if (!error) {
            const produced = engine.bodies.filter(b => !before.has(b));
            for (const body of produced) producer.set(body, event.seq);
            event.outputs = produced.length;
            if (name === 'skSolve') { producer.set(args[0], event.seq); event.outputs = 1; }
            if (name === 'evaluateQuery' && Array.isArray(result)) event.count = result.length;
          }
          if (estimatedFrom !== null && estimatedFrom <= event.seq) event.estimated = true;
          events.push(event);
        }
      } };
    }
    return table;
  };

  const loadBefore = load(), t0 = performance.now();
  let status = 'ok', failure = null, extra = {};
  try {
    if (workload.frontend === 'featurescript') {
      const { build } = await import('../../src/index.mjs');
      const { normalizeModelingPolicy } = await import('../../src/modeling-policy.mjs');
      const source = readFileSync(workload.file, 'utf8');
      const model = await build(source, { feature: workload.feature, moduleManifest: workload.modules, sourcePath: workload.file,
        modelingPolicy: normalizeModelingPolicy(workload.policy ?? { curvedContacts: 'strict' }) });
      extra.bodies = model.bodies.length;
    } else {
      extra = await pythonRun(workload, kernel, events);
    }
  } catch (error) {
    status = 'error';
    failure = { name: error?.name, message: String(error?.message).slice(0, 300), line: error?.line ?? null, capability: error instanceof UnsupportedFeatureError };
  }
  const result = { id, mode, status, failure, wallMs: performance.now() - t0, load: [loadBefore, load()], estimatedFrom, tryFrames, events, unattributed, ...extra };
  writeFileSync(resultPath, JSON.stringify(result));
}

// Python: requests are answered in the 'line' handler of src/python.mjs. Each response write on the
// request pipe closes one request; kernel calls made since the previous write belong to it. Request
// parameters and handles come from the Python source map (pythonSourceTracker).
async function pythonRun(workload, kernel, events) {
  const net = await import('node:net');
  const { buildPython } = await import('../../src/python.mjs');
  const responses = [];
  // Kernel ms accumulate until the next response write drains them into that request.
  let acc = { kernelMs: 0, kernelCalls: 0 };
  wrapKernel(kernel, ms => { acc.kernelMs += ms; acc.kernelCalls++; });
  const write = net.Socket.prototype.write;
  net.Socket.prototype.write = function (chunk, ...rest) {
    if (typeof chunk === 'string' && chunk.startsWith('{"id":')) {
      try { const message = JSON.parse(chunk); responses.push({ ...message, ...acc }); } catch { /* not a bridge response */ }
      acc = { kernelMs: 0, kernelCalls: 0 };
    }
    return write.call(this, chunk, ...rest);
  };
  const source = readFileSync(workload.file, 'utf8');
  const model = await buildPython(source, { filename: workload.file, python, trace: true });
  const operations = model.sourceMap.operations;
  const producerOf = new Map();
  for (const response of responses) {
    const operation = operations.find(o => o.requestId === response.id);
    const name = operation?.name ?? 'volume';
    const params = operation?.parameters ?? {};
    const inputs = ['handle', 'left', 'right'].filter(k => typeof params[k] === 'string').map(k => producerOf.get(params[k]) ?? 'untracked');
    const event = { seq: events.length, name, opId: `python/${response.id}`, line: operation?.source?.span?.line ?? null, tryDepth: 0,
      kind: name === 'volume' ? 'read' : 'op', geometric: name === 'volume' || undefined, inputs, kernelMs: response.kernelMs, kernelCalls: response.kernelCalls,
      outputs: response.ok && typeof response.value === 'string' ? 1 : 0 };
    if (!response.ok) event.error = { name: response.error?.type, catchable: response.error?.type !== 'UnsupportedFeatureError', message: response.error?.message };
    if (typeof response.value === 'string') producerOf.set(response.value, event.seq);
    events.push(event);
  }
  return { bodies: model.bodies.length, pythonTryExcept: /^\s*try\s*:/m.test(source), requests: model.execution.requests };
}

// --------------------------------------------------------------- parent ---
// Flush policies over one event list:
//   eager        today: every kernel op is its own round trip (and its own sync).
//   conservative defer ops; flush when (a) a read touches a pending body and depends on a result count or on geometry,
//                (b) a try block that issued pending ops closes (catchable errors must surface inside it),
//                (c) an op's host-side admission depends on a pending Boolean's result count
//                    (its inputs include a pending Boolean output), (d) end of build.
//   speculative  defer ops, predict one body per Boolean, treat a catchable error as a replay trigger.
//                Flush only for reads that need geometry (evVolume/evBox3d/evLine, edge/face enumeration,
//                Python volume) of a pending body, and at the end. Count mispredictions (replays).
export function simulate(run, policy) {
  const ops = run.events.filter(e => e.kind === 'op');
  const byseq = new Map(run.events.map(e => [e.seq, e]));
  const booleanSeqs = new Set(run.events.filter(e => e.name === 'opBoolean' || e.name === 'boolean').map(e => e.seq));
  const batches = []; let batch = []; const done = new Set();
  const flush = reason => { if (batch.length) { batches.push({ reason, seqs: batch }); for (const s of batch) done.add(s); batch = []; } };
  const tryCloses = new Map();
  for (const frame of run.tryFrames ?? []) tryCloses.set(frame.closesAtSeq, (tryCloses.get(frame.closesAtSeq) ?? 0) + 1);
  const pendingInput = e => e.inputs.some(s => typeof s === 'number' && !done.has(s) && batch.includes(s));
  for (const event of run.events) {
    if (policy === 'conservative' && tryCloses.has(event.seq)) flush('try-exit');
    if (event.kind === 'op') {
      if (policy === 'eager') { batch.push(event.seq); flush('op'); continue; }
      if (policy === 'conservative' && event.inputs.some(s => booleanSeqs.has(s) && !done.has(s))) flush('count-dependent-admission');
      batch.push(event.seq);
      continue;
    }
    if (event.kind !== 'read' || !pendingInput(event)) continue;
    if (event.geometric) flush('geometric-read');
    else if (policy === 'conservative' && event.inputs.some(s => booleanSeqs.has(s) && batch.includes(s))) flush('count-read');
  }
  flush('end');
  const summary = batches.map(({ reason, seqs }) => {
    const inBatch = new Set(seqs), finish = new Map();
    let W = 0, S = 0, kernelOps = 0;
    for (const s of seqs) {
      const e = byseq.get(s), start = Math.max(0, ...e.inputs.filter(i => inBatch.has(i)).map(i => finish.get(i) ?? 0));
      finish.set(s, start + e.kernelMs); W += e.kernelMs; S = Math.max(S, start + e.kernelMs);
      if (e.kernelCalls) kernelOps++;
    }
    // Same span in operation counts, counting only Booleans (the expensive class), for record-mode runs.
    const depth = new Map(); let booleans = 0, booleanDepth = 0;
    for (const s of seqs) {
      const e = byseq.get(s), isBool = e.name === 'opBoolean' || e.name === 'boolean';
      const d = Math.max(0, ...e.inputs.filter(i => inBatch.has(i)).map(i => depth.get(i) ?? 0)) + (isBool ? 1 : 0);
      depth.set(s, d); if (isBool) booleans++; booleanDepth = Math.max(booleanDepth, d);
    }
    return { reason, ops: seqs.length, kernelOps, W, S, booleans, booleanDepth };
  });
  const W = summary.reduce((a, b) => a + b.W, 0), S = summary.reduce((a, b) => a + b.S, 0);
  const mispredictions = policy === 'speculative' ? ops.filter(e => booleanSeqs.has(e.seq) && e.outputs !== undefined && e.outputs !== 1 && !e.error).length : 0;
  const replays = policy === 'speculative' ? ops.filter(e => e.error?.catchable && e.tryDepth > 0).length : 0;
  return { policy, flushes: batches.length, batches: summary, kernelMsTotal: W, kernelMsSpan: S, interOpParallelBound: S ? W / S : null,
    booleans: summary.reduce((a, b) => a + b.booleans, 0), booleanSpan: summary.reduce((a, b) => a + b.booleanDepth, 0), mispredictions, replays };
}

function describe(run) {
  const ops = run.events.filter(e => e.kind === 'op'), reads = run.events.filter(e => e.kind === 'read');
  const count = (list, f) => list.filter(f).length;
  return {
    status: run.status, failure: run.failure, wallMs: run.wallMs, load: run.load, estimatedFrom: run.estimatedFrom,
    events: run.events.length, ops: ops.length, kernelOps: count(ops, e => e.kernelCalls > 0), kernelMs: ops.reduce((a, e) => a + e.kernelMs, 0),
    opsByName: Object.fromEntries([...new Set(ops.map(e => e.name))].map(n => [n, count(ops, e => e.name === n)])),
    booleanResultCounts: ops.filter(e => e.name === 'opBoolean' || e.name === 'boolean').map(e => e.error ? 'error' : e.outputs),
    opsInsideTry: count(ops, e => e.tryDepth > 0), tryBlocksWithOps: (run.tryFrames ?? []).length,
    reads: Object.fromEntries([...new Set(reads.map(e => e.name))].map(n => [n, count(reads, e => e.name === n)])),
    geometricReads: count(reads, e => e.geometric), structural: count(run.events, e => e.kind === 'structural'),
    catchableErrors: count(run.events, e => e.error?.catchable), capabilityErrors: count(run.events, e => e.error && !e.error.catchable),
    hypotheticalOps: count(ops, e => e.hypothetical), estimatedEvents: count(run.events, e => e.estimated),
    pythonTryExcept: run.pythonTryExcept,
  };
}

async function parent(args) {
  const only = args.includes('--only') ? args[args.indexOf('--only') + 1].split(',') : null;
  const modes = args.includes('--modes') ? args[args.indexOf('--modes') + 1].split(',') : ['eager', 'record'];
  const previous = (() => { try { return JSON.parse(readFileSync(outPath, 'utf8')); } catch { return { runs: {} }; } })();
  const report = { schema: 'wonky-native-bridge-sync-trace/1', generatedAt: new Date().toISOString(), node: process.version, runs: previous.runs ?? {} };
  mkdirSync(dirname(outPath), { recursive: true });
  for (const workload of workloads) {
    if (only && !only.includes(workload.id)) continue;
    for (const mode of modes) {
      if (mode === 'record' && workload.frontend === 'python') continue;   // Python handles are already lazy-capable; see proposal
      if (mode === 'eager' && workload.recordOnly) continue;
      if (mode === 'record' && workload.eagerOnly) continue;
      const tmp = join(root, 'tmp/native-bridge/batched', `${workload.id}.${mode}.json`);
      mkdirSync(dirname(tmp), { recursive: true });
      const t = performance.now();
      const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--child', workload.id, mode, tmp],
        { cwd: root, encoding: 'utf8', env: { ...process.env, BEND_NO_TELEMETRY: '1' }, maxBuffer: 64 << 20 });
      if (child.status !== 0) { console.error(child.stderr); throw new Error(`child ${workload.id} ${mode} exited ${child.status}`); }
      const run = JSON.parse(readFileSync(tmp, 'utf8'));
      const key = `${workload.id}:${mode}`;
      report.runs[key] = { ...describe(run), processMs: performance.now() - t,
        policies: Object.fromEntries(['eager', 'conservative', 'speculative'].map(p => [p, simulate(run, p)])),
        opSequence: run.events.filter(e => e.kind === 'op').map(e => ({ seq: e.seq, name: e.name, opId: e.opId, line: e.line, tryDepth: e.tryDepth,
          inputs: e.inputs, outputs: e.outputs, kernelMs: Number(e.kernelMs.toFixed(3)), error: e.error?.name, hypothetical: e.hypothetical, estimated: e.estimated })) };
      const r = report.runs[key], s = r.policies.speculative, c = r.policies.conservative;
      console.log(`${key}: ${r.status} ops ${r.ops} (kernel ${r.kernelOps}, ${r.kernelMs.toFixed(0)} ms) reads ${JSON.stringify(r.reads)} ` +
        `flushes eager ${r.policies.eager.flushes} / conservative ${c.flushes} / speculative ${s.flushes}; W/S spec ${s.interOpParallelBound?.toFixed(2)} ` +
        `booleans ${s.booleans} span ${s.booleanSpan}; load ${r.load.join('->')}`);
      writeFileSync(outPath, JSON.stringify(report, null, 1) + '\n');
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args[0] === '--child') await child(args[1], args[2], args[3]);
  else await parent(args);
}
