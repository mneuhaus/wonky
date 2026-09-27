// Bend feasibility spike for a native wonky core language
// (docs/language/bend-feasibility.md).
//
//   node scripts/lang/spike-bench.mjs --build          compile native + JS target, record compile cost
//   node scripts/lang/spike-bench.mjs [--out NAME]     run every measurement against the recorded build
//   options: --no-python (skip today's build123d JS path), --quick (fewer samples)
//
// Machine etiquette (shared, loaded host): one compile at a time, at most 4
// threads for short runs, sequential samples, load average recorded before
// every group. All timings are indicative.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync, readdirSync } from 'node:fs';
import { cpus, loadavg, totalmem, arch, platform } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { compileToStream, explainError } from '../../src/lang/spike-compile.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const argv = process.argv.slice(2);
const flag = f => argv.includes(f);
const option = (f, d) => { const i = argv.indexOf(f); return i < 0 ? d : argv[i + 1]; };
const quick = flag('--quick');
const buildDir = join(root, 'out/lang/spike/build');
const astDir = join(root, 'out/lang/spike/ast');
const examples = join(root, 'kernel/lang/spike/examples');
const bend = join(root, '.tools/bend-2.0.25/bin/bend');
const python = join(root, 'out/build123d-performance/reference-venv/bin/python');
mkdirSync(buildDir, { recursive: true }); mkdirSync(astDir, { recursive: true });

const sources = () => {
  const h = createHash('sha256');
  for (const f of [...readdirSync(join(root, 'kernel/lang/spike')).filter(f => f.endsWith('.bend')).sort().map(f => `kernel/lang/spike/${f}`),
    ...readdirSync(join(root, 'kernel')).filter(f => f.endsWith('.bend')).sort().map(f => `kernel/${f}`),
    ...readdirSync(join(root, 'kernel/ports')).filter(f => f.endsWith('.bend')).sort().map(f => `kernel/ports/${f}`),
    'scripts/build123d-workload.bend']) h.update(f).update(readFileSync(join(root, f)));
  return h.digest('hex');
};
const load = () => loadavg().map(x => Math.round(x * 100) / 100);

function run(executable, args, { timeoutMs = 900000, env = {} } = {}) {
  return new Promise(resolve => {
    const start = performance.now();
    const child = spawn('/usr/bin/time', ['-l', executable, ...args], { cwd: root, env: { ...process.env, BEND_NO_TELEMETRY: '1', ...env } });
    let stdout = '', stderr = '';
    child.stdout.on('data', b => { stdout += b; }); child.stderr.on('data', b => { stderr += b; });
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.on('close', code => {
      clearTimeout(timer);
      const wallMs = performance.now() - start;
      const rss = stderr.match(/(\d+)\s+maximum resident set size/);
      const line = stdout.trim().split('\n').filter(l => l.startsWith('{')).at(-1);
      let json = null; try { json = line ? JSON.parse(line) : null; } catch { json = null; }
      resolve({ code, wallMs, maxRssBytes: rss ? Number(rss[1]) : null, json, stdout, stderr: stderr.replace(/\n\s+\d+\s+[a-z ()]+$/gm, '').slice(0, 2000) });
    });
  });
}
const median = xs => { const v = [...xs].sort((a, b) => a - b); const m = v.length >> 1; return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2; };
const f32 = bits => { const b = Buffer.alloc(4); b.writeUInt32LE(bits >>> 0); return b.readFloatLE(); };
const real = n => f32(n.hi) + f32(n.lo);

// ---------------------------------------------------------------------------
if (flag('--build')) {
  const builds = { sourceSha256: sources(), capturedAt: new Date().toISOString(), steps: [] };
  const step = async (name, exe, args) => {
    const loadBefore = load();
    const r = await run(exe, args);
    builds.steps.push({ name, code: r.code, wallMs: r.wallMs, maxRssBytes: r.maxRssBytes, loadBefore });
    if (r.code !== 0) throw new Error(`${name} failed:\n${r.stdout}\n${r.stderr}`);
    console.log(name, Math.round(r.wallMs), 'ms, load', loadBefore.join(' '));
  };
  for (const target of ['main', 'main-pure']) {
    const src = join(root, `kernel/lang/spike/${target}.bend`);
    await step(`${target}: bend -> C`, bend, [src, '-o', join(buildDir, `${target}.c`)]);
    await step(`${target}: clang -O3`, 'clang', ['-std=c11', '-O3', join(buildDir, `${target}.c`), '-lpthread', '-lm', '-o', join(buildDir, target)]);
    await step(`${target}: bend -> JS`, bend, [src, '-o', join(buildDir, `${target}.js`)]);
    writeFileSync(join(buildDir, `${target}.cjs`), readFileSync(join(buildDir, `${target}.js`)));
    for (const ext of ['', '.c', '.js']) builds[`${target}${ext || '.bin'}Bytes`] = statSync(join(buildDir, target + ext)).size;
  }
  // Control: the same pure evaluator with the depth fuel removed and `step`
  // marked @unsafe (Bend then reports every caller as relying on unsafe code).
  // Generated mechanically from core.bend so it cannot drift.
  const nofuel = join(buildDir, 'nofuel');
  mkdirSync(nofuel, { recursive: true });
  const relink = s => s.split('../../../kernel/').join('../../../../../kernel/');
  let core = relink(readFileSync(join(root, 'kernel/lang/spike/core.bend'), 'utf8'));
  const at = core.indexOf('def step(');
  const header = 'def step(~kernel: U32 -> Op -> List<&2, Value> -> Value, fuel: Nat, task: Task) -> Value:\n  match fuel:\n    case 0n:\n      err(5, 0, "evaluation depth fuel exhausted")\n    case 1n+ +f:\n      match task:\n';
  if (!core.slice(at).startsWith(header)) throw new Error('core.bend step header changed; update the nofuel generator');
  const runAt = core.indexOf('\ndef run(');
  const body = core.slice(at + header.length, runAt).split('\n').map(l => l.startsWith('    ') ? l.slice(4) : l).join('\n').split('step(~kernel, f, ').join('step(~kernel, ');
  core = core.slice(0, at) + '@unsafe def step(~kernel: U32 -> Op -> List<&2, Value> -> Value, task: Task) -> Value:\n  match task:\n' + body
    + '\ndef run(~kernel: U32 -> Op -> List<&2, Value> -> Value, fuel: Nat, prog: Expr) -> Value:\n  step(~kernel, TEval{prog, Nil{}})\n';
  writeFileSync(join(nofuel, 'core.bend'), core);
  for (const f of ['frontend.bend', 'tokenize.bend', 'main-pure.bend']) writeFileSync(join(nofuel, f), relink(readFileSync(join(root, 'kernel/lang/spike', f), 'utf8')));
  await step('nofuel control: bend -> C', bend, [join(nofuel, 'main-pure.bend'), '-o', join(nofuel, 'main-nofuel.c')]);
  await step('nofuel control: clang -O3', 'clang', ['-std=c11', '-O3', join(nofuel, 'main-nofuel.c'), '-lpthread', '-lm', '-o', join(nofuel, 'main-nofuel')]);
  writeFileSync(join(buildDir, 'builds.json'), JSON.stringify(builds, null, 2) + '\n');
  process.exit(0);
}

// ---------------------------------------------------------------------------
const builds = JSON.parse(readFileSync(join(buildDir, 'builds.json'), 'utf8'));
if (builds.sourceSha256 !== sources()) throw new Error('Spike or kernel sources changed since the recorded build; rerun with --build.');
const outDir = join(root, 'out/lang/spike', option('--out', `run-${new Date().toISOString().replace(/[:.]/g, '-')}`));
if (existsSync(outDir)) throw new Error(`refusing to overwrite ${outDir}`);
mkdirSync(outDir, { recursive: true });
const main = join(buildDir, 'main'), mainJs = join(buildDir, 'main.cjs');
const report = {
  schema: 'wonky.lang.bend-spike/1', capturedAt: new Date().toISOString(), builds,
  environment: { cpu: cpus()[0]?.model, logicalCpus: cpus().length, memoryBytes: totalmem(), arch: arch(), platform: platform(), node: process.version, bend: '2.0.25', loadAtStart: load() },
  programs: {}, evaluator: [], kernel: [], threads: [], jsPath: [], tokenizer: [], errors: [], startup: [],
};
const save = () => writeFileSync(join(outDir, 'report.json'), JSON.stringify(report, null, 2) + '\n');

// Compile the example programs. The prelude (box) is prepended to kernel programs.
const prelude = readFileSync(join(examples, 'prelude.core'), 'utf8');
const program = (name, { usesPrelude = false, replace = null } = {}) => {
  let text = readFileSync(join(examples, `${name}.core`), 'utf8');
  if (replace) text = text.replace(replace[0], replace[1]);
  const full = (usesPrelude ? prelude + '\n' : '') + text;
  const key = replace ? `${name}-${replace[1].replace(/\W+/g, '_')}` : name;
  const t = performance.now();
  const compiled = compileToStream(full, { file: `kernel/lang/spike/examples/${name}.core${usesPrelude ? ' (after prelude.core)' : ''}` });
  const compileMs = performance.now() - t;
  const file = join(astDir, `${key}.ast`);
  writeFileSync(file, compiled.text);
  writeFileSync(join(astDir, `${key}.ast.json`), JSON.stringify(compiled.ast));
  writeFileSync(join(astDir, `${key}.spans.json`), JSON.stringify(compiled.spans));
  report.programs[key] = { source: name, astInts: compiled.ints.length, spans: compiled.spans.length - 1, hostCompileMs: compileMs };
  return { key, file, json: join(astDir, `${key}.ast.json`), spans: compiled.spans, text: compiled.text };
};

// --- 1. evaluator overhead ----------------------------------------------------
const FS_BENCH = join(outDir, 'bench.fs');
writeFileSync(FS_BENCH, `FeatureScript 2909;
import(path : "onshape/std/geometry.fs", version : "2909.0");

function fib(n) { if (n < 2) { return n; } return fib(n - 1) + fib(n - 2); }

function sumsq(n) { var acc = 0; for (var i = 0; i < n; i += 1) { acc += i * i; } return acc; }
`);
const samples = quick ? 2 : 3;
const pure = [
  { name: 'fib', prog: program('fib', { replace: ['(fib 22)', '(fib 25)'] }), reps: 3, fs: ['fib', 25], expected: 75025 },
  { name: 'sumsq', prog: program('sumsq'), reps: 10, fs: ['sumsq', 20000], expected: 2666466670000 },
  { name: 'lists', prog: program('lists'), reps: 10, fs: null, expected: [5000, 41654167500, 24990001] },
];
for (const b of pure) {
  const entry = { name: b.name, reps: b.reps, loadBefore: load(), native: [], bendJs: [], jsCore: null, fs: null };
  for (let i = 0; i < samples; i++) {
    const r = await run(main, ['--threads', '1', '--gpu', 'off', '--', 'pure', b.prog.file, '100000000', String(b.reps)]);
    if (r.code !== 0 || !r.json) throw new Error(`native ${b.name} failed: ${r.stderr}`);
    entry.native.push({ evalMs: r.json.evalMs, decodeMs: r.json.decodeMs, wallMs: r.wallMs, maxRssBytes: r.maxRssBytes });
    entry.nativeValue = r.json.value;
  }
  for (let i = 0; i < (quick ? 1 : 2); i++) {
    const r = await run(process.execPath, ['--stack-size=7800', mainJs, 'pure-arg', b.prog.text, '100000000', '1']);
    entry.bendJs.push(r.code === 0 && r.json ? { evalMs: r.json.evalMs, wallMs: r.wallMs, maxRssBytes: r.maxRssBytes, reps: 1 } : { failed: r.code, stderr: r.stderr.slice(0, 400) });
  }
  const js = await run(process.execPath, ['--stack-size=7800', join(root, 'scripts/lang/spike-js-worker.mjs'), 'core', b.prog.json, String(samples), '2']);
  entry.jsCore = js.json ? { samplesMs: js.json.samples.map(x => x * b.reps), perRunSamplesMs: js.json.samples, nodesPerRun: js.json.nodes, value: js.json.value, maxRssBytes: js.maxRssBytes } : { failed: js.code, stderr: js.stderr.slice(0, 600) };
  if (b.fs) {
    const fs = await run(process.execPath, [join(root, 'scripts/lang/spike-js-worker.mjs'), 'fs', FS_BENCH, b.fs[0], String(b.fs[1]), String(samples), '2']);
    entry.fs = fs.json ? { perRunSamplesMs: fs.json.samples, samplesMs: fs.json.samples.map(x => x * b.reps), stepsPerRun: fs.json.steps, value: fs.json.value, maxRssBytes: fs.maxRssBytes } : { failed: fs.code, stderr: fs.stderr.slice(0, 600) };
  }
  // Correctness: native F32x2 result versus the JS double reference.
  const nv = entry.nativeValue, want = b.expected;
  const nativeNums = Array.isArray(nv) ? nv.map(real) : real(nv);
  entry.correct = JSON.stringify(nativeNums) === JSON.stringify(want) && JSON.stringify(entry.jsCore.value) === JSON.stringify(want)
    && (!b.fs || entry.fs.value === want);
  const nodes = entry.jsCore.nodesPerRun * b.reps;
  const nat = median(entry.native.map(s => s.evalMs));
  const bendJsOk = entry.bendJs.filter(s => s.evalMs !== undefined);
  entry.summary = {
    nodesTotal: nodes, nativeEvalMs: nat, nativeNsPerNode: nat * 1e6 / nodes,
    bendJsNsPerNode: bendJsOk.length ? median(bendJsOk.map(s => s.evalMs)) * 1e6 / entry.jsCore.nodesPerRun : null,
    jsCoreMs: median(entry.jsCore.samplesMs), jsCoreNsPerNode: median(entry.jsCore.samplesMs) * 1e6 / nodes,
    fsMs: entry.fs ? median(entry.fs.samplesMs) : null, fsNsPerStep: entry.fs ? median(entry.fs.perRunSamplesMs) * 1e6 / entry.fs.stepsPerRun : null,
    fsOverNative: entry.fs ? median(entry.fs.samplesMs) / nat : null,
  };
  entry.loadAfter = load();
  report.evaluator.push(entry); save();
  console.log('evaluator', b.name, JSON.stringify(entry.summary), 'correct', entry.correct);
}

// --- 1b. what the fuel costs: fueled vs @unsafe unfueled evaluator (same pure build) ----
report.fuel = [];
for (const b of pure) {
  const entry = { name: b.name, reps: b.reps, loadBefore: load(), fuel: [], nofuel: [] };
  for (let i = 0; i < samples; i++) {
    for (const [key, exe] of [['fuel', join(buildDir, 'main-pure')], ['nofuel', join(buildDir, 'nofuel/main-nofuel')]]) {
      const r = await run(exe, ['--threads', '1', '--gpu', 'off', '--', 'pure', b.prog.file, '100000000', String(b.reps)]);
      entry[key].push(r.json?.evalMs ?? null);
    }
  }
  entry.medianFuelMs = median(entry.fuel); entry.medianNoFuelMs = median(entry.nofuel);
  report.fuel.push(entry); save();
  console.log('fuel', b.name, entry.medianFuelMs, 'vs no fuel', entry.medianNoFuelMs);
}

// --- 1c. limits: deep object-language recursion, a large AST, number semantics ----------
report.limits = [];
{
  const deep = compileToStream(readFileSync(join(examples, 'sumsq.core'), 'utf8').replace('(loop 0 20000 0)', '(loop 0 1000000 0)'));
  writeFileSync(join(astDir, 'deep.ast'), deep.text);
  const big = compileToStream(`(len (list ${Array.from({ length: 100000 }, (_, i) => String(i * 0.5 + 0.25)).join(' ')}))`);
  writeFileSync(join(astDir, 'big.ast'), big.text);
  for (const [label, file, what] of [['deep-recursion-1e6', join(astDir, 'deep.ast'), '1,000,000 nested (non-tail) object-language calls'],
    ['large-ast-700k-ints', join(astDir, 'big.ast'), `a 100000-element number list literal, ${big.ints.length} ints, ${big.text.length} bytes`]]) {
    const loadBefore = load();
    const r = await run(main, ['--threads', '1', '--gpu', 'off', '--', 'pure', file, '100000000', '1']);
    report.limits.push({ label, what, loadBefore, decodeMs: r.json?.decodeMs, evalMs: r.json?.evalMs, wallMs: r.wallMs, maxRssBytes: r.maxRssBytes, value: r.json?.value });
  }
  const probes = ['(+ 0.1 0.2)', '(= (+ 0.1 0.2) 0.3)', '(* 3 (/ 1 3))', '(+ 16777216 1)', '(+ 281474976710656 1)', '(+ 9007199254740992 1)'];
  const semantics = [];
  for (const src of probes) {
    const r = await run(main, ['--threads', '1', '--gpu', 'off', '--', 'pure-arg', compileToStream(src).text, '1000', '1']);
    const v = r.json?.value;
    // JS doubles = FeatureScript's number semantics in wonky's JS interpreter.
    const js = Function(`"use strict"; return (${src.replace(/^\(\+ (\S+) (\S+)\)$/, '$1 + $2').replace(/^\(= \(\+ (\S+) (\S+)\) (\S+)\)$/, '($1 + $2) === $3').replace(/^\(\* 3 \(\/ 1 3\)\)$/, '3 * (1 / 3)')});`)();
    semantics.push({ core: src, nativeF32x2: typeof v === 'boolean' ? v : real(v), nativeWords: v, jsDouble: js });
  }
  report.numberSemantics = semantics; save();
}

// --- 2. kernel programs ----------------------------------------------------------
const kernelCases = [
  { name: 'planar-union', ref: 3, volume: 15500, jsPy: 'planar-union.py' },
  { name: 'planar-pocket', ref: 4, volume: 18240, jsPy: 'planar-pocket.py' },
  { name: 'frame-with-tab', ref: 5, volume: 13840, jsPy: 'frame-with-tab.py' },
  { name: 'box-union-pocket', ref: null, volume: 12500 },
];
for (const c of kernelCases) {
  const prog = program(c.name, { usesPrelude: true });
  const entry = { name: c.name, loadBefore: load(), core: [], ref: [] };
  for (let i = 0; i < samples; i++) {
    const r = await run(main, ['--threads', '1', '--gpu', 'off', '--', 'eval', prog.file, '100000000', '1']);
    if (r.code !== 0 || !r.json) throw new Error(`native ${c.name} failed: ${r.stderr}`);
    entry.core.push({ evalMs: r.json.evalMs, decodeMs: r.json.decodeMs, wallMs: r.wallMs, maxRssBytes: r.maxRssBytes });
    entry.value = r.json.value;
    if (c.ref !== null) {
      const q = await run(main, ['--threads', '1', '--gpu', 'off', '--', 'ref', String(c.ref), '1']);
      entry.ref.push({ evalMs: q.json.evalMs, wallMs: q.wallMs, maxRssBytes: q.maxRssBytes });
      entry.refValue = q.json.value;
    }
  }
  const body = entry.value.at(-1).body;
  const volumes = entry.value.slice(0, -2).map(real);
  entry.checks = {
    volumeMatches: Math.abs(real({ hi: body.hiBits, lo: body.loBits }) - c.volume) < 1e-6 * c.volume,
    volumeReturnedByProgram: volumes, errors: body.errors,
    hashEqualsDirectKernelCalls: c.ref === null ? null : body.hash === entry.refValue.body.hash && body.hiBits === entry.refValue.body.hiBits && body.loBits === entry.refValue.body.loBits,
    hash: body.hash, faces: body.faces,
  };
  entry.summary = { coreEvalMs: median(entry.core.map(s => s.evalMs)), directKernelMs: entry.ref.length ? median(entry.ref.map(s => s.evalMs)) : null,
    processWallMs: median(entry.core.map(s => s.wallMs)), maxRssBytes: Math.max(...entry.core.map(s => s.maxRssBytes)) };
  entry.loadAfter = load();
  report.kernel.push(entry); save();
  console.log('kernel', c.name, JSON.stringify(entry.summary), JSON.stringify(entry.checks));
}

// --- 3. threads: one dependent chain vs four independent parts ----------------------
const par = program('par-pockets', { usesPrelude: true }), seq = program('seq-pockets', { usesPrelude: true });
const frame = program('frame-with-tab', { usesPrelude: true });
for (const [label, prog, threads] of [['frame-with-tab', frame, [1, 4]], ['seq-pockets', seq, [1, 4]], ['par-pockets', par, [1, 2, 4]]]) {
  for (const t of threads) {
    const entry = { program: label, threads: t, loadBefore: load(), samples: [] };
    for (let i = 0; i < (quick ? 1 : 2); i++) {
      const r = await run(main, ['--threads', String(t), '--gpu', 'off', '--', 'eval', prog.file, '100000000', '1']);
      entry.samples.push({ evalMs: r.json?.evalMs, wallMs: r.wallMs, maxRssBytes: r.maxRssBytes });
      entry.value = r.json?.value;
    }
    entry.medianEvalMs = median(entry.samples.map(s => s.evalMs));
    report.threads.push(entry); save();
    console.log('threads', label, t, entry.medianEvalMs, 'load', entry.loadBefore.join(' '));
  }
}

// --- 4. today's JS path for the same build123d cases --------------------------------
if (!flag('--no-python')) {
  for (const c of kernelCases.filter(c => c.jsPy)) {
    const entry = { case: c.jsPy, loadBefore: load() };
    const reps = c.name === 'frame-with-tab' ? 2 : 3;
    const r = await run(process.execPath, [join(root, 'scripts/lang/spike-js-worker.mjs'), 'python', join(root, 'fixtures/performance-build123d/cases', c.jsPy), python, String(reps), '1'], { timeoutMs: 1800000 });
    Object.assign(entry, r.json ? { samplesMs: r.json.samples, medianMs: median(r.json.samples), bodies: r.json.bodies, maxRssBytes: r.maxRssBytes } : { failed: r.code, stderr: r.stderr.slice(0, 800) });
    entry.loadAfter = load();
    report.jsPath.push(entry); save();
    console.log('js path', c.jsPy, entry.medianMs, 'load', entry.loadBefore.join(' '));
  }
}

// --- 5. tokenizer -----------------------------------------------------------------
const corpus = [
  { name: 'fixtures/r10b/r10b.fs', path: join(root, 'fixtures/r10b/r10b.fs'), reps: 20 },
  { name: '~/Workspace/cad/cad-project-020/lochwand/topo-native/source.fs', path: join(process.env.HOME, 'Workspace/cad/cad-project-020/lochwand/topo-native/source.fs'), reps: 5 },
  { name: 'fixtures/cadbench/adapted/cup.fs', path: join(root, 'fixtures/cadbench/adapted/cup.fs'), reps: 200 },
];
for (const f of corpus) {
  if (!existsSync(f.path)) { report.tokenizer.push({ file: f.name, missing: true }); continue; }
  const entry = { file: f.name, bytes: statSync(f.path).size, reps: f.reps, loadBefore: load(), native: [] };
  for (let i = 0; i < samples; i++) {
    const r = await run(main, ['--threads', '1', '--gpu', 'off', '--', 'tokenize', f.path, String(f.reps)]);
    entry.native.push({ ms: r.json.ms, perRunMs: r.json.ms / f.reps, wallMs: r.wallMs, maxRssBytes: r.maxRssBytes });
    entry.nativeSummary = r.json.summary;
  }
  const js = await run(process.execPath, [join(root, 'scripts/lang/spike-js-worker.mjs'), 'tokenize', f.path, String(f.reps * samples), '3']);
  entry.js = { perRunMs: median(js.json.samples), parsePerRunMs: median(js.json.parseSamples), summary: js.json.summary, maxRssBytes: js.maxRssBytes };
  const { bad, ...nativeSummary } = entry.nativeSummary;
  entry.identicalTokens = JSON.stringify(nativeSummary) === JSON.stringify(js.json.summary) && bad === 0;
  entry.summary = { nativePerRunMs: median(entry.native.map(s => s.perRunMs)), jsPerRunMs: entry.js.perRunMs, jsOverNative: entry.js.perRunMs / median(entry.native.map(s => s.perRunMs)) };
  report.tokenizer.push(entry); save();
  console.log('tokenize', f.name, JSON.stringify(entry.summary), 'identical', entry.identicalTokens);
}

// --- 6. errors carry span ids back to the host ------------------------------------------
for (const [name, fuel] of [['error-type', '100000000'], ['error-capability', '100000000'], ['error-fuel', '5000']]) {
  const prog = program(name, { usesPrelude: name !== 'error-fuel' });
  const r = await run(main, ['--threads', '1', '--gpu', 'off', '--', 'eval', prog.file, fuel, '1']);
  report.errors.push({ program: name, fuel: Number(fuel), native: r.json?.value, explained: explainError(r.json?.value, prog.spans), exitCode: r.code });
  save();
}

// --- 7. process start ------------------------------------------------------------------
for (const [label, exe, pre] of [['native', main, ['--threads', '1', '--gpu', 'off', '--']], ['bend-js-target', process.execPath, [mainJs]]]) {
  const values = [];
  const loadBefore = load();
  for (let i = 0; i < 5; i++) { const r = await run(exe, [...pre, 'pure-arg', '4', '10', '1']); values.push({ wallMs: r.wallMs, maxRssBytes: r.maxRssBytes }); }
  report.startup.push({ backend: label, loadBefore, samples: values, medianWallMs: median(values.map(v => v.wallMs)) });
}
report.environment.loadAtEnd = load();
save();
console.log('report', join(outDir, 'report.json'));
