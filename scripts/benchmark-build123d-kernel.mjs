import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, copyFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { cpus, arch, platform, totalmem, loadavg, freemem } from 'node:os';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

// The six frozen build123d cases run through the SAME production kernel
// functions on Bend's JavaScript, native ARM64 and Metal targets. This
// measures the kernel only: no Python shim, no RPC, no host validation and
// no export. It is therefore NOT comparable one-to-one with the full build
// API numbers in docs/build123d-performance.md; see that document.
const root = fileURLToPath(new URL('../', import.meta.url));
const base = join(root, 'out/build123d-kernel');
const builds = join(base, 'build');
const argument = name => { const i = process.argv.indexOf(name); return i < 0 ? null : process.argv[i + 1]; };
const quick = process.argv.includes('--quick');
const buildOnly = process.argv.includes('--build-only');
const noBuild = process.argv.includes('--no-build');
const out = join(base, argument('--out') ?? 'run');
if (existsSync(out)) throw new Error(`Report directory already exists: ${out}. Choose a new --out to preserve earlier measurements.`);
mkdirSync(out, { recursive: true });
mkdirSync(builds, { recursive: true });

const { version } = JSON.parse(readFileSync(join(root, 'bend.lock.json'), 'utf8'));
const bend = join(root, `.tools/bend-${version}/bin/bend`);
const digest = createHash('sha256');
for (const file of [...readdirSync(join(root, 'kernel')).sort().filter(f => f.endsWith('.bend')).map(f => `kernel/${f}`),
  ...readdirSync(join(root, 'kernel/ports')).sort().filter(f => f.endsWith('.bend')).map(f => `kernel/ports/${f}`),
  ...readdirSync(join(root, 'fixtures/performance-build123d/cases')).sort().map(f => `fixtures/performance-build123d/cases/${f}`),
  'scripts/build123d-workload.bend', 'scripts/benchmark-build123d-kernel.mjs', 'bend.lock.json']) {
  digest.update(file).update(readFileSync(join(root, file)));
}
const sourceSha256 = digest.digest('hex');

// Independent analytic expectations, identical to the ones the full-build
// harness checks. They are stated here, not read back from any engine.
//
// The six cases span roughly six orders of magnitude of kernel work, so a
// single shared instance count cannot serve them: it would either leave the
// analytic cases under the millisecond timer or make the planar cases take
// hours. Each case therefore carries its own sizing.
//   chain  — sequential repeats inside one leaf. Reported per instance, this is
//            the latency figure. Sized so the fastest backend stays far above
//            timer resolution.
//   fork   — the same instances arranged as a balanced tree of depth forkDepth
//            with forkCount repeats per leaf. Sized so instances stay close to
//            chain where the case is cheap, and so the slowest backend still
//            finishes a sample where it is expensive.
const CASES = [
  { id: 0, file: 'box.py', volume: 12000, chain: 16384, forkDepth: 5, forkCount: 512 },
  { id: 1, file: 'translated-cylinder.py', volume: 1280 * Math.PI, chain: 65536, forkDepth: 5, forkCount: 2048 },
  { id: 2, file: 'coaxial-bore.py', volume: 2380 * Math.PI, chain: 16384, forkDepth: 5, forkCount: 512 },
  { id: 3, file: 'planar-union.py', volume: 15500, chain: 2, forkDepth: 4, forkCount: 1 },
  { id: 4, file: 'planar-pocket.py', volume: 18240, chain: 1, forkDepth: 4, forkCount: 1 },
  { id: 5, file: 'frame-with-tab.py', volume: 13840, chain: 1, forkDepth: 3, forkCount: 1 },
];
const selected = process.argv.reduce((acc, value, i) =>
  process.argv[i - 1] === '--case' ? [...acc, Number(value)] : acc, []);
const cases = selected.length ? CASES.filter(c => selected.includes(c.id)) : CASES;

const report = {
  schema: 'wonky.build123d-kernel-benchmark/1', capturedAt: new Date().toISOString(), sourceSha256,
  environment: { cpu: cpus()[0]?.model, logicalCpus: cpus().length, memoryBytes: totalmem(), freeBytes: freemem(),
    architecture: arch(), platform: platform(), node: process.version, bend: version, loadAverageBefore: loadavg() },
  method: {
    workloads: 'The six frozen fixtures/performance-build123d cases rebuilt in scripts/build123d-workload.bend from the production kernel functions the JavaScript adapter calls (topology.extrude, analytic.frustum, boolean.coaxial, ports/planar-boolean union and subtract, ports/solid-intersection.planar_measures). Identical source for all backends.',
    boundary: 'Kernel only. Excludes the Python shim, its per-call process, RPC, host decoding, host validation, identity and STEP export. The full build API boundary is measured separately by scripts/benchmark-build123d.mjs.',
    timing: 'IO.now monotonic milliseconds around each batch, excluding printing. Warmup samples are discarded. Compilation and process startup are measured separately.',
    phases: 'latency = a sequential chain of instances in one leaf, divided by the instance count, on one native thread plus JavaScript and Metal. Per instance this is what one build costs and is the figure comparable to a single build123d build. throughput = the same instances arranged as a balanced fork tree across every backend and thread count, the figure for independent builds. chainThreads = the latency chain deliberately re-run across thread counts, which measures what the scheduler costs on a chain of small dependent steps rather than what a build costs.',
    sizing: 'Per case, because the six span roughly six orders of magnitude of kernel work. Instance counts are chosen so the fastest backend stays far above the millisecond timer and the slowest still finishes a sample; they are recorded per run as depth, count and instances. Chain linearity was verified against the compiled native target before the counts were fixed, so the per-instance figure is not an artefact of shared evaluation.',
    correctness: 'Per case: B-rep hash equality against the JavaScript target, zero reported errors, and the kernel volume against the independent analytic expectation. Metal additionally requires runtime evidence that the Metal command path ran.',
    limitations: ['No CPU affinity or isolated thermal environment; read loadAverageBefore and loadAverageAfter before trusting the thread scaling',
      'No production backend change: the CLI still runs the JavaScript target',
      'Kernel-only times must not be compared directly with full build API times',
      'The volume gate checks the accumulated sum over all instances, so its effective precision falls as the instance count rises',
      'The batch phase varies instance count per case, so throughput may be compared across backends but not across cases'],
  },
  cases: cases.map(({ id, file, volume }) => ({ id, file, expectedVolumeMm3: volume })),
  builds: {}, startup: {}, runs: [],
};
const save = () => writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');

async function command(executable, args, label, timeoutMs = 1800000) {
  const start = performance.now();
  return await new Promise(resolve => {
    const child = spawn(executable, args, { cwd: root, env: { ...process.env, BEND_NO_TELEMETRY: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', timedOut = false;
    child.stdout.on('data', b => { stdout += b; });
    child.stderr.on('data', b => { stderr += b; });
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs);
    child.on('error', error => { stderr += error.message; });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      writeFileSync(join(out, `${label}.log`), stdout + '\n--- stderr ---\n' + stderr);
      resolve({ code, signal, timedOut, wallMs: performance.now() - start, stdout, stderr });
    });
  });
}

const entry = gpu => `import Base
import ../../../scripts/build123d-workload.bend as W

def samples(left: Nat, +depth: Nat, +count: Nat, +id: Nat, +index: U32) -> IO(Unit):
  match left:
    case 0n:
      IO.pure(Unit, Unit{})
    case 1n+p:
      do IO<Unit>:
        t0 : Nat <- IO.now()
        result : W.Evidence = W.batch${gpu ? '!' : ''}(depth, count, id)
        t1 : Nat <- IO.now()
        IO.print("{\\"index\\":" ++ U32.show(index) ++ ",\\"elapsedMs\\":" ++ Nat.show(Nat.sub(t1, t0)) ++ "," ++ W.evidence_json(result) ++ "}")
        samples(p, depth, count, id, (index + 1 : U32))

def launch(args: List<String>) -> IO(Unit):
  match args:
    case id <> depth <> count <> n <> Nil{}:
      samples(W.number(Nat.read(n)), W.number(Nat.read(depth)), W.number(Nat.read(count)), W.number(Nat.read(id)), 0)
    case _:
      IO.die(Unit, 2, "expected: case depth count samples")

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args()
    launch(args)
`;

if (!noBuild) {
  for (const [name, extension, gpu] of [['js', '.js', false], ['cpu', '', false], ['metal', '', true]]) {
    const source = join(builds, `${name}.bend`);
    writeFileSync(source, entry(gpu));
    console.log(`Building ${name}…`);
    let r;
    if (gpu && platform() === 'darwin') {
      const started = performance.now(), cfile = join(builds, 'metal.c'), binary = join(builds, name);
      r = await command(bend, [source, '-o', cfile], 'emit-metal', 900000);
      if (r.code === 0) {
        let c = readFileSync(cfile, 'utf8');
        const pass = 'static void gpu_pass(u32 f) {\n  @autoreleasepool {';
        const done = '  io_sync();\n  return code;';
        if (!c.includes(pass) || !c.includes(done)) throw new Error('Pinned Metal runtime instrumentation anchors changed.');
        c = c.replace(pass, 'static unsigned long wonky_metal_passes = 0;\nstatic void gpu_pass(u32 f) {\n  wonky_metal_passes++;\n  @autoreleasepool {')
          .replace(done, '  io_sync();\n  fprintf(stderr, "wonky_metal_passes=%lu\\n", wonky_metal_passes);\n  return code;');
        writeFileSync(cfile, c);
        // Same native flags as Bend 2.0.25's CLI. The host-only counter proves
        // the Metal command path ran. No geometry or device arithmetic changes.
        r = await command('clang', ['-DBEND_METAL=1', '-x', 'objective-c', '-fobjc-arc', '-fmodules', '-std=c11', '-O3', cfile, '-lpthread', '-lm', '-o', binary], 'build-metal', 900000);
        if (r.code === 0) r = await command(binary, ['--gpu-build'], 'build-metal-device', 900000);
      }
      r.wallMs = performance.now() - started;
    } else r = await command(bend, [source, '-o', join(builds, name + extension)], `build-${name}`, 900000);
    report.builds[name] = { wallMs: r.wallMs, code: r.code, signal: r.signal, timedOut: r.timedOut };
    // package.json declares ES modules; Bend emits CommonJS.
    if (name === 'js' && r.code === 0) copyFileSync(join(builds, 'js.js'), join(builds, 'js.cjs'));
    save();
    if (r.code !== 0) console.log(`${name} unavailable: see ${out}/build-${name}.log`);
  }
  writeFileSync(join(builds, 'builds.json'), JSON.stringify({ sourceSha256, builds: report.builds }, null, 2) + '\n');
} else {
  const previous = JSON.parse(readFileSync(join(builds, 'builds.json'), 'utf8'));
  if (previous.sourceSha256 !== sourceSha256) throw new Error('Kernel benchmark sources changed; rebuild instead of --no-build.');
  report.builds = previous.builds;
}
if (buildOnly) { save(); process.exit(0); }

for (const [name, executable, args] of [
  ['cpuTopology', 'sysctl', ['hw.perflevel0.name', 'hw.perflevel0.physicalcpu', 'hw.perflevel1.name', 'hw.perflevel1.physicalcpu']],
  ['compiler', 'clang', ['--version']],
  ['thermalBefore', 'pmset', ['-g', 'therm']],
]) {
  const r = await command(executable, args, `environment-${name}`, 120000);
  report.environment[name] = r.code === 0 ? r.stdout.trim() : null;
}

const backends = [
  { name: 'js', build: 'js', executable: process.execPath, prefix: [join(builds, 'js.cjs')], args: [] },
  ...[1, 6, 12, 18].map(threads => ({ name: `cpu-${threads}`, build: 'cpu', executable: join(builds, 'cpu'), prefix: [], args: ['--threads', String(threads), '--gpu', 'off'] })),
  { name: 'metal', build: 'metal', executable: join(builds, 'metal'), prefix: [], args: ['--threads', '18', '--gpu', '1GB'] },
];
const available = backends.filter(b => report.builds[b.build]?.code === 0 && (b.build === 'js' || existsSync(b.executable)));
const stats = values => {
  const v = [...values].sort((a, b) => a - b);
  const quartile = q => { const p = q * (v.length - 1), i = Math.floor(p); return v[i] + (v[Math.min(i + 1, v.length - 1)] - v[i]) * (p - i); };
  return { medianMs: quartile(0.5), q1Ms: quartile(0.25), q3Ms: quartile(0.75), minMs: v[0], maxMs: v.at(-1), samples: v.length };
};

for (const backend of available) {
  const values = [];
  for (let i = 0; i < 3; i++) {
    const r = await command(backend.executable, [...backend.prefix, ...backend.args, '--', '0', '0', '0', '0'], `startup-${backend.name}-${i}`, 600000);
    if (r.code !== 0) throw new Error(`Startup check failed: ${backend.name}; see ${out}/startup-${backend.name}-${i}.log`);
    values.push(r.wallMs);
  }
  report.startup[backend.name] = { ...stats(values), method: 'Three fresh processes executing zero batches; includes runtime and device initialization. OS disk and shader caches may be warm.' };
  save();
}

const float = bits => { const b = Buffer.alloc(4); b.writeUInt32LE(bits); return b.readFloatLE(); };
// A single build is one dependent feature history, so latency is measured on
// one thread; handing the scheduler a chain of small independent builds costs
// far more than it returns, which chainThreads measures on its own rather than
// letting it contaminate the latency figure.
const phases = quick
  ? [{ phase: 'latency', warmup: 1, measured: 2, plan: () => ({ depth: 0, count: 1 }),
      backend: () => true, case: () => true }]
  : [{ phase: 'latency', warmup: 2, measured: 5, plan: c => ({ depth: 0, count: c.chain }),
      backend: n => n === 'js' || n === 'cpu-1' || n === 'metal', case: () => true },
     { phase: 'throughput', warmup: 1, measured: 3, plan: c => ({ depth: c.forkDepth, count: c.forkCount }),
      backend: () => true, case: () => true },
     { phase: 'chainThreads', warmup: 1, measured: 3, plan: c => ({ depth: 0, count: c.chain }),
      backend: n => n.startsWith('cpu-'), case: c => c.id === 0 }];
let failed = false;
for (const phase of phases) {
  for (const workload of cases.filter(phase.case)) {
    const { depth, count } = phase.plan(workload);
    const instances = 2 ** depth * count;
    const reference = {};
    for (const backend of available.filter(b => phase.backend(b.name))) {
      const total = phase.warmup + phase.measured;
      const label = `${phase.phase}-case${workload.id}-${backend.name}`;
      console.log(`Measuring ${label}…`);
      const r = await command(backend.executable,
        [...backend.prefix, ...backend.args, '--', String(workload.id), String(depth), String(count), String(total)], label);
      const rows = r.stdout.split('\n').filter(s => s.startsWith('{')).map(s => {
        const row = JSON.parse(s); return { ...row, volume: float(row.hiBits) + float(row.loBits) };
      });
      const run = { phase: phase.phase, case: workload.id, file: workload.file, depth, count, instances, backend: backend.name,
        processWallMs: r.wallMs, code: r.code, signal: r.signal, timedOut: r.timedOut, rows, log: `${label}.log` };
      if (backend.name === 'metal') run.metalPasses = Number(/wonky_metal_passes=(\d+)/.exec(r.stderr)?.[1] ?? 0);
      const expected = workload.volume * instances;
      run.volumeRelativeError = rows.length ? Math.abs(rows[0].volume - expected) / expected : null;
      // The first backend of the phase carries the reference B-rep. It is the
      // JavaScript target wherever the phase runs it, and otherwise a native
      // configuration whose hash the latency phase already tied back to it.
      if (reference.hash === undefined) {
        reference.hash = rows[0]?.hash; reference.volume = rows[0]?.volume; reference.backend = backend.name;
      }
      run.referenceBackend = reference.backend;
      run.valid = r.code === 0 && rows.length === total && Number.isFinite(run.volumeRelativeError) &&
        run.volumeRelativeError < 1e-11 && (backend.name !== 'metal' || run.metalPasses >= total) &&
        rows.every((row, i) => row.index === i && row.errors === 0 && row.hash === reference.hash &&
          Math.abs(row.volume - reference.volume) <= 1e-11 * Math.max(1, Math.abs(reference.volume)));
      if (run.valid) {
        run.warm = stats(rows.slice(phase.warmup).map(s => s.elapsedMs));
        run.perInstanceMs = run.warm.medianMs / instances;
      } else failed = true;
      report.runs.push(run); save();
      console.log(`${label}: ${run.valid ? `${run.warm.medianMs} ms / ${instances} = ${run.perInstanceMs.toPrecision(4)} ms` : 'INVALID — inspect log and cross-backend evidence'}`);
    }
  }
}
report.environment.loadAverageAfter = loadavg();
const thermal = await command('pmset', ['-g', 'therm'], 'environment-thermalAfter', 120000);
report.environment.thermalAfter = thermal.code === 0 ? thermal.stdout.trim() : null;
save();
console.log(`Report: ${join(out, 'report.json')}`);
if (failed) process.exitCode = 1;
