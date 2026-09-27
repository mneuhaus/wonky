// Next-blocker probe for the fs-module-import cluster
// (docs/corpus/cluster-fs-module-import.md). Triage only: never used for
// production geometry, never writes geometry, never touches the corpus.
//
//   node scripts/corpus/module-import-probe.mjs rebind <file.fs> <feature|-> <manifest.json>
//     The production entrypoint src/index.mjs build() (what bin/wonky.mjs calls),
//     unchanged, with an explicit frozen-module manifest. Used with manifests that
//     re-bind the already captured r10b input snapshot (same Onshape element and
//     microversion, same body files) to a different source SHA-256.
//
//   node scripts/corpus/module-import-probe.mjs stub1|stub2 <file.fs> <feature|->
//     A copy of build() whose module resolver and instantiator are STUBS:
//       NS::build(...)      -> an empty read-only source context;
//       NS::<function>(...) -> a 10 mm placeholder cube under the given Id;
//       addInstance         -> accepts any definition (partQuery, loadedContext,
//                              transform, configuration) without resolving it;
//       instantiate         -> one 10 mm placeholder cube per instance, recorded as
//                              created by the instance Id and by the instantiator Id
//                              (Onshape resolves qCreatedBy hierarchically).
//     stub2 additionally never evaluates addInstance partQuery expressions (they
//     select source parts in the source Part Studio, which a snapshot has to
//     answer), so the probe reaches the first blocker after the import idiom.
//     Placeholder geometry is wrong by construction: frontend blockers reached
//     are real, kernel/capability outcomes and model checks after geometry are
//     only indicative.
//
// Prints one JSON line.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const [mode, file, featureArg, manifest] = process.argv.slice(2);
const feature = featureArg && featureArg !== '-' ? featureArg : undefined;
const source = readFileSync(file, 'utf8');
const lines = source.split('\n');
const t0 = performance.now();

function summarizeTrace(trace) {
  const ops = trace?.operations ?? [];
  const failed = [...ops].reverse().find(o => o.status === 'failed') ?? null;
  const running = [...ops].reverse().find(o => o.status === 'running') ?? null;
  const at = failed ?? running;
  return {
    operations: ops.length,
    completed: ops.filter(o => o.status === 'completed').length,
    failedOperation: at ? {
      name: at.name, status: at.status, line: at.source?.span?.line ?? null,
      callChain: (at.callStack ?? []).map(f => `${f.name}@${f.calledAt?.line ?? '?'}:${f.calledAt?.column ?? '?'}`),
      error: at.error?.message ? String(at.error.message).slice(0, 300) : null,
    } : null,
  };
}

const { normalizeModelingPolicy } = await import('../../src/modeling-policy.mjs');
const modelingPolicy = normalizeModelingPolicy({ curvedContacts: 'strict' });
const stubStats = { placeholders: 0, instances: 0, codeCalls: 0, partQueriesSkipped: 0 };

async function stubBuild(skipPartQuery) {
  const { parse } = await import('../../src/parser.mjs');
  const { Interpreter } = await import('../../src/interpreter.mjs');
  const { loadKernel } = await import('../../src/kernel.mjs');
  const { ModelingContext } = await import('../../src/library.mjs');
  const { Id, map, Vector, Quantity, EnumValue } = await import('../../src/values.mjs');
  const { sourceTracker } = await import('../../src/source-map.mjs');
  const { TopologyQuery } = await import('../../src/queries.mjs');
  const { fail } = await import('../../src/errors.mjs');
  const program = parse(source);
  const kernel = await loadKernel(), engine = new ModelingContext(kernel, { modelingPolicy });
  const tracker = sourceTracker(engine, source, program, { sourcePath: resolve(file) });
  const base = engine.builtins();
  const mm = v => new Quantity(v / 1000);
  const cube = (context, id, loc) => {
    base.fCuboid.call([context, id, map({ corner1: new Vector([mm(0), mm(0), mm(0)]), corner2: new Vector([mm(10), mm(10), mm(10)]) })], loc);
    stubStats.placeholders++;
    return [...engine.records.values()].at(-1);
  };
  const BODY = new EnumValue('EntityType', 'BODY');
  const builtin = (name, min, max, call) => ({ type: 'builtin', name, min, max, call });
  // NS::name references in the source decide which code exports a module stub offers.
  const codeNames = new Map();
  for (const m of source.matchAll(/\b([A-Za-z_]\w*)::([A-Za-z_]\w*)\b/g)) if (m[2] !== 'import' && m[2] !== 'build') {
    if (!codeNames.has(m[1])) codeNames.set(m[1], new Set()); codeNames.get(m[1]).add(m[2]);
  }
  const moduleResolver = spec => {
    const exports = {
      build: builtin(`${spec.namespace}::build`, 0, 1, () => {
        const source = new ModelingContext(kernel, { modelingPolicy }); source.readOnly = true;
        source.context.moduleBuild = exports.build; return source.context;
      }),
    };
    for (const name of codeNames.get(spec.namespace) ?? []) exports[name] = builtin(`${spec.namespace}::${name}`, 0, 64, (args, loc) => {
      stubStats.codeCalls++;
      const context = args.find(a => a?.type === 'Context'), id = args.find(a => a instanceof Id);
      if (!context || !id) fail(`stub ${spec.namespace}::${name}: no Context/Id argument`, loc);
      cube(context, id, loc);
      return new TopologyQuery('created', { id, entityType: BODY });
    });
    return exports;
  };
  const overrides = {
    newInstantiator: builtin('newInstantiator', 1, 2, ([id]) => ({ type: 'StubInstantiator', id, instances: [], done: false })),
    addInstance: builtin('addInstance', 3, 3, ([inst, , definition], loc) => {
      if (inst?.type !== 'StubInstantiator' || inst.done) fail('stub addInstance: invalid instantiator', loc);
      const name = typeof definition?.name === 'string' ? definition.name : `instance${inst.instances.length}`;
      const id = new Id([...inst.id.parts, name]);
      inst.instances.push({ id }); stubStats.instances++;
      return new TopologyQuery('created', { id, entityType: BODY });
    }),
    instantiate: builtin('instantiate', 2, 2, ([context, inst], loc) => {
      if (inst?.type !== 'StubInstantiator' || inst.done) fail('stub instantiate: invalid instantiator', loc);
      for (const { id } of inst.instances) cube(context, id, loc).createdBy.add(inst.id.key());
      inst.done = true;
    }),
  };
  if (skipPartQuery) {
    const visit = node => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) { node.forEach(visit); return; }
      if (node.kind === 'call' && node.callee?.kind === 'name' && node.callee.name === 'addInstance' && node.args[2]?.kind === 'map') {
        for (const field of node.args[2].fields) if (field[0].kind === 'literal' && field[0].value === 'partQuery') {
          field[1] = { kind: 'literal', value: undefined, loc: field[1].loc }; stubStats.partQueriesSkipped++;
        }
      }
      for (const [k, v] of Object.entries(node)) if (k !== 'loc' && v && typeof v === 'object') visit(v);
    };
    visit(program.declarations);
  }
  const interpreter = new Interpreter({ ...base, ...overrides }, { moduleResolver, callObserver: tracker.observer });
  try {
    interpreter.run(program, feature, engine.context, new Id(['model']), () => map({}));
    if (!engine.bodies.length) fail('The feature produced no solid bodies');
  } catch (error) { error.modelTrace = tracker.report(); throw error; }
  return { bodies: engine.bodies };
}

try {
  let model;
  if (mode === 'rebind') {
    const { build } = await import('../../src/index.mjs');
    model = await build(source, { feature, parameters: {}, moduleManifest: manifest, sourcePath: resolve(file), modelingPolicy });
  } else if (mode === 'stub1' || mode === 'stub2') {
    model = await stubBuild(mode === 'stub2');
  } else throw new Error(`unknown mode ${mode}`);
  console.log(JSON.stringify({ ok: true, bodies: model.bodies.length, ms: performance.now() - t0, stub: mode === 'rebind' ? null : stubStats }));
} catch (error) {
  const line = error.line ?? null;
  const text = line ? lines[line - 1] ?? '' : '';
  const userThrow = line != null && /\bthrow\b|regenError\s*\(/.test(text) && error.name === 'FeatureScriptError';
  console.log(JSON.stringify({
    ok: false, ms: performance.now() - t0, errorClass: error.name ?? null,
    message: String(error.message ?? error).slice(0, 1200), line, column: error.column ?? null,
    sourceLine: text.trim().slice(0, 240), userThrow, trace: summarizeTrace(error.modelTrace),
    stub: mode === 'rebind' ? null : stubStats,
    jsStack: error.name === 'FeatureScriptError' || error.name === 'UnsupportedFeatureError' ? null : String(error.stack ?? '').split('\n').slice(1, 6).map(s => s.trim()),
  }));
}
