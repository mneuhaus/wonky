// loadKernel().hybrid on WONKY_BACKEND=native|diff (docs/hybrid-boolean-plan.md
// step 11a, docs/native-bridge.md section 14): the subprocess wonky-hybrid,
// built from kernel/hybrid/native.bend together with the addon and under the
// same source hash (scripts/native-bridge/build-native.mjs --set planar).
//
// Why a subprocess and not an addon op: corefine and recover place device
// calls ('!'); on the CPU they run on a thread pool, and a fail-stop on a pool
// worker would end the Node process (docs/native-bridge.md risk 3). In its own
// process a failure is a named NativeKernelError and Node keeps running.
//
// The host (src/hybrid.mjs) calls the hybrid entry's stages by name:
//   runHybrid:      corefine/main.run(job), then rjob, mid.go, map, finish, show
//   carrierClasses: mesh-io.parse_job, recover/topo.surfs.go, recover/topo.cls.go
// hybridNamespace() serves exactly these keys. corefine/main.run runs the whole
// hybrid in one process (mode boolean) and returns corefine's result text; the
// later stages pass opaque values of this module along and show() returns the
// answer the same process computed. parse_job runs mode classes. The values
// the host sees (texts, the Parsed/Malformed record, the classes list) are the
// JS target's; the stages in between never cross the process boundary, so no
// recover state is encoded. A stage called out of that order, or with a value
// that is not this module's, is refused by name.
//
// Work budget: every process is bounded by wall time (WONKY_HYBRID_BUDGET_S,
// default 120 s). A run that exceeds it is killed, and on native the Boolean
// gets the named refusal `unresolved work budget exceeded ...` as corefine's
// answer (src/boolean.mjs reports it as `[hybrid: work budget exceeded ...]`).
// On diff the budget ends the run (BX_BUDGET): there is nothing to compare.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { BackendDivergenceError, NativeKernelError } from './errors.mjs';

export const HYBRID_FILE = 'wonky-hybrid';
export const DEFAULT_BUDGET_S = 120;

export function budgetSeconds(value = process.env.WONKY_HYBRID_BUDGET_S) {
  if (value === undefined) return DEFAULT_BUDGET_S;
  const s = Number(value);
  if (!(s > 0) || !Number.isFinite(s)) throw new NativeKernelError('BX_ARGS', `WONKY_HYBRID_BUDGET_S must be a positive number of seconds (got '${value}')`);
  return s;
}

export const budgetRefusal = seconds => `unresolved work budget exceeded: the native hybrid (wonky-hybrid) ran longer than ${seconds} s and was stopped (WONKY_HYBRID_BUDGET_S)\nend\n`;

// One run of the binary. mode boolean: { answer, mesh, phases, wallMs };
// mode classes: { classes } or { malformed }; either may be { budget: true }.
export function runHybridProcess({ binary, threads = 1, budgetS = DEFAULT_BUDGET_S }, mode, job, n = 0) {
  if (typeof job !== 'string') throw new NativeKernelError('BX_ARGS', `wonky-hybrid ${mode}: the job must be a string`);
  const dir = mkdtempSync(join(tmpdir(), 'wonky-hybrid-'));
  try {
    const jobFile = join(dir, 'job'), a = join(dir, 'a'), b = join(dir, 'b');
    writeFileSync(jobFile, job);
    const args = mode === 'boolean' ? ['boolean', jobFile, a, b] : ['classes', jobFile, String(n), a];
    const t0 = performance.now();
    const run = spawnSync(binary, ['--threads', String(threads), '--gpu', 'off', '--', ...args], { encoding: 'utf8',
      env: { ...process.env, BEND_NO_TELEMETRY: '1' }, timeout: budgetS * 1000, killSignal: 'SIGKILL', maxBuffer: 16 * 1024 * 1024 });
    const wallMs = performance.now() - t0;
    if (run.error?.code === 'ETIMEDOUT') return { budget: true, wallMs, budgetS };
    if (run.error) throw new NativeKernelError('BX_LOAD', `cannot run ${binary}: ${run.error.message}`, { cause: run.error });
    if (run.status !== 0) {
      const tail = `${run.stderr ?? ''}${run.stdout ?? ''}`.trim().split('\n').slice(-4).join(' | ');
      throw new NativeKernelError('BX_FAILSTOP', `wonky-hybrid ${mode} ${run.signal ? `was killed by ${run.signal}` : `exited ${run.status}`}: ${tail || '(no output)'}`,
        { status: run.status, signal: run.signal });
    }
    let phases = null;
    try { phases = JSON.parse(run.stdout.trim().split('\n').pop()); } catch { /* reported below */ }
    if (!phases) throw new NativeKernelError('BX_WIRE', `wonky-hybrid ${mode} printed no phase line: ${run.stdout.slice(0, 200)}`);
    if (mode === 'boolean') return { answer: readFileSync(a, 'utf8'), mesh: readFileSync(b, 'utf8'), phases, wallMs };
    const text = readFileSync(a, 'utf8');
    if (text.startsWith('malformed ')) return { malformed: text.slice(10).replace(/\n$/, ''), phases, wallMs };
    const m = /^classes((?: \d+)*)\n$/.exec(text);
    if (!m) throw new NativeKernelError('BX_WIRE', `wonky-hybrid classes answered '${text.slice(0, 80)}'`);
    return { classes: m[1].split(' ').filter(Boolean).map(Number), phases, wallMs };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

// ---------------------------------------------------------------- host namespace

const bendList = values => values.reduceRight((tail, head) => ({ $: 'Con', head, tail }), { $: 'Nil' });
const ENTRY = 'kernel/hybrid/native.bend';

export function hybridStats() {
  return { boolean: { calls: 0, wallMs: 0, budget: 0, phases: {}, compared: 0, jsMs: 0 }, classes: { calls: 0, wallMs: 0, compared: 0, jsMs: 0 } };
}

// options: { binary, threads, budgetS, backend: 'native'|'diff', js (the JS
// target's hybrid namespace, diff only), divergence (diff's sticky state),
// dumpDir, sourceHash, stats }
export function hybridNamespace(options) {
  const { backend, js = null, stats = hybridStats() } = options;
  const brand = new WeakSet();
  const token = (kind, data) => { const t = Object.freeze({ kind, ...data }); brand.add(t); return t; };
  const expect = (value, kind, key) => {
    if (!brand.has(value) || value.kind !== kind) {
      throw new NativeKernelError('BX_ARGS', `hybrid.${key} on WONKY_BACKEND=${backend}: expected the ${kind} value of this backend's hybrid stages ` +
        '(src/native/hybrid-process.mjs serves the call order of src/hybrid.mjs runHybrid and carrierClasses only)');
    }
    return value;
  };
  const pending = new Map(); // job text -> { answer, mesh } of its boolean run
  const run = (mode, job, n) => runHybridProcess(options, mode, job, n);
  const check = () => { if (options.divergence?.first) throw options.divergence.first; };

  // diff: the first differing character of two texts ends the run, dumped.
  const compareText = (what, job, nativeText, jsText) => {
    if (nativeText === jsText) return;
    let at = 0;
    while (at < nativeText.length && nativeText[at] === jsText[at]) at += 1;
    const dump = join(options.dumpDir, `${new Date().toISOString().replace(/[:.]/g, '-')}-hybrid-${what.replace(/\s+/g, '-')}-${process.pid}`);
    mkdirSync(dump, { recursive: true });
    writeFileSync(join(dump, 'job'), job);
    writeFileSync(join(dump, 'native'), nativeText);
    writeFileSync(join(dump, 'js'), jsText);
    writeFileSync(join(dump, 'meta.json'), JSON.stringify({ entry: `${ENTRY} (${what})`, charIndex: at, sourceHash: options.sourceHash }, null, 1) + '\n');
    const error = new BackendDivergenceError({ op: 'hybrid', entry: `${ENTRY} (${what} text)`, wordIndex: at, fieldPath: `${what} text, character ${at}`,
      nativeWord: at < nativeText.length ? nativeText.charCodeAt(at) : undefined, jsWord: at < jsText.length ? jsText.charCodeAt(at) : undefined, dump });
    options.divergence.count += 1;
    options.divergence.first ??= error;
    throw error;
  };

  const booleanRun = job => {
    check();
    const r = run('boolean', job);
    stats.boolean.calls += 1; stats.boolean.wallMs += r.wallMs;
    if (r.budget) {
      stats.boolean.budget += 1;
      if (backend === 'diff') throw new NativeKernelError('BX_BUDGET', `wonky-hybrid exceeded the work budget of ${r.budgetS} s on WONKY_BACKEND=diff; there is no native answer to compare`);
      return { answer: budgetRefusal(r.budgetS), mesh: budgetRefusal(r.budgetS) };
    }
    for (const [k, v] of Object.entries(r.phases)) stats.boolean.phases[k] = (stats.boolean.phases[k] ?? 0) + v;
    return r;
  };

  const hosted = {
    'corefine/main.run'(job) {
      const r = booleanRun(job);
      if (js) {
        const t = performance.now();
        const jsMesh = js['corefine/main.run'](job);
        stats.boolean.jsMs += performance.now() - t;
        compareText('corefine mesh', job, r.mesh, jsMesh);
      }
      if (r.mesh.startsWith('ok\n')) pending.set(job, r);
      return r.mesh;
    },
    rjob(job) {
      check();
      if (typeof job !== 'string') throw new NativeKernelError('BX_ARGS', 'hybrid.rjob: the job must be a string');
      return token('rjob', { job });
    },
    'mid.go'(mesh, rj) { check(); expect(rj, 'rjob', 'mid.go'); return token('mid', { job: rj.job, mesh }); },
    map(mid) { check(); return token('map', { mid: expect(mid, 'mid', 'map') }); },
    finish(mid, os) {
      check();
      expect(mid, 'mid', 'finish');
      if (expect(os, 'map', 'finish').mid !== mid) throw new NativeKernelError('BX_ARGS', 'hybrid.finish: the map belongs to another stage value');
      return token('finish', { mid });
    },
    show(done) {
      check();
      const { mid } = expect(done, 'finish', 'show');
      const r = pending.get(mid.job);
      if (!r || r.mesh !== mid.mesh) throw new NativeKernelError('BX_ARGS', 'hybrid.show: no native run of corefine/main.run gave this job and corefine text');
      pending.delete(mid.job);
      if (js) {
        const t = performance.now();
        const m = js['mid.go'](mid.mesh, js.rjob(mid.job));
        const jsAnswer = js.show(js.finish(m, js.map(m)));
        stats.boolean.jsMs += performance.now() - t;
        stats.boolean.compared += 1;
        compareText('answer', mid.job, r.answer, jsAnswer);
      }
      return r.answer;
    },
    'mesh-io.parse_job'(text) {
      check();
      if (typeof text !== 'string') throw new NativeKernelError('BX_ARGS', 'hybrid.mesh-io.parse_job: the job must be a string');
      const n = Number(/^faces (\d+)$/m.exec(text)?.[1] ?? 0);
      const r = run('classes', text, n);
      stats.classes.calls += 1; stats.classes.wallMs += r.wallMs;
      if (r.budget) throw new NativeKernelError('BX_BUDGET', `wonky-hybrid classes exceeded the work budget of ${r.budgetS} s`);
      if (r.malformed !== undefined) return { $: 'Malformed', reason: r.malformed };
      return { $: 'Parsed', job: Object.freeze({ faces: token('faces', { text, n, classes: r.classes }) }) };
    },
    'recover/topo.surfs.go'(faces, acc) {
      check();
      expect(faces, 'faces', 'recover/topo.surfs.go');
      if (acc?.$ !== 'Nil') throw new NativeKernelError('BX_ARGS', 'hybrid.recover/topo.surfs.go: only an empty accumulator is served');
      return token('surfs', { faces });
    },
    'recover/topo.cls.go'(surfs, n) {
      check();
      const { faces } = expect(surfs, 'surfs', 'recover/topo.cls.go');
      if (n !== faces.n) throw new NativeKernelError('BX_ARGS', `hybrid.recover/topo.cls.go: n ${n} is not the job's face count ${faces.n}`);
      if (js) {
        const t = performance.now();
        const parsed = js['mesh-io.parse_job'](faces.text);
        const out = [];
        for (let l = js['recover/topo.cls.go'](js['recover/topo.surfs.go'](parsed.job.faces, { $: 'Nil' }), n); l.$ === 'Con'; l = l.tail) out.push(l.head);
        stats.classes.jsMs += performance.now() - t;
        stats.classes.compared += 1;
        compareText('carrier classes', faces.text, faces.classes.join(' '), out.join(' '));
      }
      return bendList(faces.classes);
    },
  };
  return { hosted, stats };
}
