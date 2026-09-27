#!/usr/bin/env node
// Where does warmed FeatureScript build time go today (Bend JS target)?
// Splits one in-process build into: parse, interpreter-only work (tree walk,
// value ops, environments), time inside kernel-facing builtins (op*/sk*/f*/ev*
// and friends: host adaptation + Bend-compiled-to-JS geometry + validation),
// and time inside pure value builtins. Kernel is loaded once (cached Bend JS);
// cold start is NOT measured here. Indicative only: shared, loaded machine.
//
// Usage: node scripts/lang/frontend-share.mjs [rounds] [file.fs ...]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { parse } from '../../src/parser.mjs';
import { Interpreter } from '../../src/interpreter.mjs';
import { loadKernel } from '../../src/kernel.mjs';
import { ModelingContext } from '../../src/library.mjs';
import { Id, map } from '../../src/values.mjs';
import { frozenModules } from '../../src/modules.mjs';

const args = process.argv.slice(2);
const rounds = Number.isInteger(Number(args[0])) ? Number(args.shift()) : 3;
const files = args.length ? args : ['examples/box.fs', 'examples/bracket.fs', 'examples/line-sketch.fs', 'examples/tilted-plate.fs', 'examples/concave-intersection.fs', 'examples/bored-spacer.fs'];
const kernelish = name => /^(op[A-Z]|sk[A-Z]|f[A-Z]|ev[A-Z])/.test(name) || ['newSketchOnPlane', 'instantiate', 'addInstance', 'evaluateQuery', 'setProperty', 'getProperty'].includes(name);
const load = () => execSync('uptime').toString().trim().replace(/^.*load averages?: /, '');

const t0 = performance.now();
const kernel = await loadKernel();
const kernelLoadMs = performance.now() - t0;

function once(source, file) {
  const timing = { parseMs: 0, totalMs: 0, kernelBuiltinMs: 0, valueBuiltinMs: 0, kernelCalls: 0, valueCalls: 0, steps: 0 };
  let start = performance.now();
  const program = parse(source);
  timing.parseMs = performance.now() - start;
  const engine = new ModelingContext(kernel);
  // r10b: frozen module snapshots, strict default policy, runs until its first failure.
  const isR10b = file.endsWith('fixtures/r10b/r10b.fs');
  const moduleResolver = isR10b ? frozenModules('fixtures/r10b/modules.json', source, () => new ModelingContext(kernel)) : undefined;
  const builtins = engine.builtins();
  for (const [name, value] of Object.entries(builtins)) {
    if (value?.type !== 'builtin') continue;
    const inner = value.call, heavy = kernelish(name);
    value.call = (a, loc, interp) => {
      const s = performance.now();
      try { return inner(a, loc, interp); }
      finally {
        const d = performance.now() - s;
        if (heavy) { timing.kernelBuiltinMs += d; timing.kernelCalls++; } else { timing.valueBuiltinMs += d; timing.valueCalls++; }
      }
    };
  }
  const interpreter = new Interpreter(builtins, { moduleResolver });
  start = performance.now();
  try { interpreter.run(program, isR10b ? 'singleStepR10b' : undefined, engine.context, new Id(['model']), map({})); }
  catch (error) {
    timing.failure = `${error.name}: ${error.message}`.slice(0, 200);
    timing.failureAt = error.line ? `${error.line}:${error.column}` : null;
  }
  timing.totalMs = performance.now() - start;
  timing.steps = interpreter.steps;
  timing.interpreterOnlyMs = timing.totalMs - timing.kernelBuiltinMs - timing.valueBuiltinMs;
  timing.bodies = engine.bodies.length;
  return timing;
}
const median = xs => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const results = [];
for (const file of files) {
  const source = readFileSync(file, 'utf8');
  try {
    const long = file.endsWith('r10b.fs');
    if (!long) once(source, file); // warmup; the long r10b run is measured once, unwarmed
    const samples = [];
    for (let i = 0; i < (long ? 1 : rounds); i++) samples.push(once(source, file));
    const row = { file, rounds, loadBefore: load() };
    for (const key of ['parseMs', 'totalMs', 'interpreterOnlyMs', 'valueBuiltinMs', 'kernelBuiltinMs']) row[key] = +median(samples.map(s => s[key])).toFixed(3);
    Object.assign(row, { steps: samples[0].steps, kernelCalls: samples[0].kernelCalls, valueCalls: samples[0].valueCalls, bodies: samples[0].bodies, failure: samples[0].failure, failureAt: samples[0].failureAt,
      interpreterSharePct: +(100 * row.interpreterOnlyMs / (row.parseMs + row.totalMs)).toFixed(2), loadAfter: load() });
    results.push(row);
  } catch (error) { results.push({ file, error: `${error.name}: ${error.message}` }); }
}
const report = { schema: 'wonky-lang-frontend-share/1', generatedAt: new Date().toISOString(), node: process.version, target: 'Bend 2.0.25 JavaScript target (cached)', kernelLoadMs: +kernelLoadMs.toFixed(1),
  scope: 'Warmed, in-process, one kernel load. interpreterOnlyMs = interpret total minus time inside all builtins. kernelBuiltinMs includes JS host adaptation, Bend-compiled-to-JS geometry and eager validation. Indicative on a shared loaded machine.', results };
mkdirSync('out/lang', { recursive: true });
writeFileSync(files.some(f => f.endsWith('r10b.fs')) ? 'out/lang/frontend-share-r10b.json' : 'out/lang/frontend-share.json',JSON.stringify(report, null, 2));
console.table(results.map(({ file, parseMs, totalMs, interpreterOnlyMs, valueBuiltinMs, kernelBuiltinMs, interpreterSharePct, steps, kernelCalls, error }) => ({ file, parseMs, totalMs, interpreterOnlyMs, valueBuiltinMs, kernelBuiltinMs, interpreterSharePct, steps, kernelCalls, error })));
