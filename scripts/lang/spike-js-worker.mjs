// JavaScript-side measurements for scripts/lang/spike-bench.mjs, run in a
// fresh Node process per task so memory and JIT state stay separate.
//   core <ast.json> <reps> <warmups>       JS reference core evaluator
//   fs <fs-file> <fn> <arg> <reps> <warmups> wonky's FeatureScript interpreter
//   tokenize <fs-file> <reps> <warmups>     src/parser.mjs tokenize (+ parse)
//   python <py-file> <python> <reps> <warmups>  today's build123d JS path
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { evaluate } from '../../src/lang/spike-eval.mjs';
import { tokenize, parse } from '../../src/parser.mjs';
import { Interpreter } from '../../src/interpreter.mjs';
import { tokenSummary } from '../../src/lang/token-summary.mjs';

const [task, ...args] = process.argv.slice(2);
const print = x => process.stdout.write(JSON.stringify({ ...x, rssBytes: process.memoryUsage().rss }) + '\n');
const timed = (reps, warmups, fn) => {
  let result;
  for (let i = 0; i < warmups; i++) result = fn();
  const samples = [];
  for (let i = 0; i < reps; i++) { const t = performance.now(); result = fn(); samples.push(performance.now() - t); }
  return { samples, result };
};

if (task === 'core') {
  const [file, reps, warmups] = args;
  const ast = JSON.parse(readFileSync(file, 'utf8'));
  const { samples, result } = timed(Number(reps), Number(warmups), () => evaluate(ast));
  const v = result.value;
  print({ task, samples, nodes: result.nodes, value: v instanceof Map ? Object.fromEntries(v) : v });
} else if (task === 'fs') {
  const [file, fn, arg, reps, warmups] = args;
  const program = parse(readFileSync(file, 'utf8'));
  const interpreter = new Interpreter({}, { maxSteps: Number.MAX_SAFE_INTEGER });
  for (const d of program.declarations) interpreter.statement(d, interpreter.global);
  const f = interpreter.global.get(fn);
  let steps = 0;
  const { samples, result } = timed(Number(reps), Number(warmups), () => {
    const before = interpreter.steps; const r = interpreter.call(f, [Number(arg)], null); steps = interpreter.steps - before; return r;
  });
  print({ task, samples, steps, value: result });
} else if (task === 'tokenize') {
  const [file, reps, warmups] = args;
  const source = readFileSync(file, 'utf8');
  const { samples, result } = timed(Number(reps), Number(warmups), () => tokenize(source));
  const parseRun = timed(3, 1, () => parse(source));
  print({ task, samples, summary: tokenSummary(source, result), chars: source.length, parseSamples: parseRun.samples });
} else if (task === 'python') {
  const [file, python, reps, warmups] = args;
  const { buildPython } = await import('../../src/python.mjs');
  const source = readFileSync(file, 'utf8');
  const samples = []; let model;
  for (let i = 0; i < Number(warmups) + Number(reps); i++) {
    const t = performance.now();
    model = await buildPython(source, { filename: file, python });
    if (i >= Number(warmups)) samples.push(performance.now() - t);
  }
  print({ task, samples, bodies: model.bodies.map(b => ({ faces: b.validation.faces, volumeMm3: b.validation.volumeMm3 })), backend: model.backend });
} else throw new Error(`unknown task ${task}`);
