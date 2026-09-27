import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, copyFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { cpus, arch, platform, totalmem } from 'node:os';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const out = join(root, 'out/hardware');
mkdirSync(out, { recursive: true });
const { version } = JSON.parse(readFileSync(join(root, 'bend.lock.json'), 'utf8'));
const bend = join(root, `.tools/bend-${version}/bin/bend`);
const quick = process.argv.includes('--quick');
const buildOnly = process.argv.includes('--build-only');
const noBuild = process.argv.includes('--no-build');
// CPU thread counts to measure, e.g. --threads 1,4,10 on a 10-core M4; Metal runs with the largest.
const threadsAt = process.argv.indexOf('--threads');
const threadCounts = threadsAt < 0 ? [1, 6, 12, 18] : process.argv[threadsAt + 1].split(',').map(Number);
if (!threadCounts.length || !threadCounts.every(t => Number.isInteger(t) && t > 0)) throw new Error('--threads needs a comma list of positive integers');
// Walks subdirectories; listing kernel/ one level deep made readFileSync trip
// over kernel/ports with EISDIR, which stopped this benchmark before it began.
const walk = directory => readdirSync(join(root, directory), { withFileTypes: true }).flatMap(entry =>
  entry.isDirectory() ? walk(`${directory}/${entry.name}`) : [`${directory}/${entry.name}`]);
const digest = createHash('sha256');
for (const file of [...walk('kernel').sort(),
  'scripts/hardware-workload.bend', 'scripts/benchmark-hardware.mjs', 'bend.lock.json']) {
  digest.update(file).update(readFileSync(join(root, file)));
}
const sourceSha256 = digest.digest('hex');
const report = {
  schema: 'wonky.hardware-benchmark/1', capturedAt: new Date().toISOString(), sourceSha256,
  environment: { cpu: cpus()[0]?.model, logicalCpus: cpus().length, memoryBytes: totalmem(), architecture: arch(), platform: platform(), node: process.version, bend: version },
  method: {
    workloads: 'Production F32x2 coaxial Boolean through-bores (full B-rep) and cylinder comparisons, varied dimensions and placements. Every output field feeds a bitwise hash; volumes also accumulate in F32x2. Identical workload source for all backends.',
    timing: 'IO.now monotonic milliseconds around each batch, excludes printing. First three batches warm up. Process wall time separately includes process/runtime initialization, warmups and printing. Compilation measured separately. No FeatureScript, host validation, STEP or full r10b in these kernel measurements.',
    parallelism: 'Balanced binary tree of independent operations; leaf loop controls task granularity. This measures throughput, not acceleration of a single dependent feature history.',
    correctness: 'Per-batch hash, errors and F32x2 accumulated volume compared to JavaScript reference. Unsupported output or any mismatch invalidates the run.',
    limitations: ['No CPU affinity or isolated thermal environment', 'No automatic production backend change', 'GPU results are accepted only with runtime evidence that Metal executed', 'Millisecond timer: inspect batch lengths before interpreting small differences'],
  }, builds: {}, startup: {}, runs: [],
};
const save = () => writeFileSync(join(out, quick ? 'report-quick.json' : 'report.json'), JSON.stringify(report, null, 2) + '\n');

async function command(executable, args, label, timeoutMs = 180000) {
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
import ../../scripts/hardware-workload.bend as W

def samples(left: Nat, +depth: Nat, +count: Nat, +kind: Bool, +seed: U32, +index: U32) -> IO(Unit):
  match left:
    case 0n:
      IO.pure(Unit, Unit{})
    case 1n+p:
      do IO<Unit>:
        t0 : Nat <- IO.now()
        result : W.Evidence = W.batch${gpu ? '!' : ''}(depth, count, kind, (seed + index * 1009 : U32))
        t1 : Nat <- IO.now()
        IO.print("{\\"index\\":" ++ U32.show(index) ++ ",\\"elapsedMs\\":" ++ Nat.show(Nat.sub(t1, t0)) ++ "," ++ W.evidence_json(result) ++ "}")
        samples(p, depth, count, kind, seed, (index + 1 : U32))

def launch(args: List<String>) -> IO(Unit):
  match args:
    case kind <> depth <> count <> n <> seed <> Nil{}:
      samples(W.number(Nat.read(n)), W.number(Nat.read(depth)), W.number(Nat.read(count)), String.eq(kind, "boolean"), U32.from_nat(W.number(Nat.read(seed))), 0)
    case _:
      IO.die(Unit, 2, "expected: boolean|comparison depth count samples seed")

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args()
    launch(args)
`;

if (!noBuild) {
  for (const [name, extension, gpu] of [['js', '.js', false], ['cpu', '', false], ['metal', '', true]]) {
    const source = join(out, `${name}.bend`);
    writeFileSync(source, entry(gpu));
    console.log(`Building ${name}…`);
    let r;
    if (gpu && platform() === 'darwin') {
      const started = performance.now(), cfile = join(out, 'metal.c'), binary = join(out, name);
      r = await command(bend, [source, '-o', cfile], 'emit-metal', 300000);
      if (r.code === 0) {
        let c = readFileSync(cfile, 'utf8');
        const pass = 'static void gpu_pass(u32 f) {\n  @autoreleasepool {';
        const done = '  io_sync();\n  return code;';
        if (!c.includes(pass) || !c.includes(done)) throw new Error('Pinned Metal runtime instrumentation anchors changed.');
        c = c.replace(pass, 'static unsigned long wonky_metal_passes = 0;\nstatic void gpu_pass(u32 f) {\n  wonky_metal_passes++;\n  @autoreleasepool {')
          .replace(done, '  io_sync();\n  fprintf(stderr, "wonky_metal_passes=%lu\\n", wonky_metal_passes);\n  return code;');
        writeFileSync(cfile, c);
        // Same native flags as Bend 2.0.25's CLI. Host-only counter proves the
        // Metal command path ran. No geometry, device arithmetic or scheduling change.
        r = await command('clang', ['-DBEND_METAL=1', '-x', 'objective-c', '-fobjc-arc', '-fmodules', '-std=c11', '-O3', cfile, '-lpthread', '-lm', '-o', binary], 'build-metal', 300000);
        if (r.code === 0) r = await command(binary, ['--gpu-build'], 'build-metal-device', 300000);
      }
      r.wallMs = performance.now() - started;
    } else r = await command(bend, [source, '-o', join(out, name + extension)], `build-${name}`, 300000);
    report.builds[name] = { wallMs: r.wallMs, code: r.code, signal: r.signal, timedOut: r.timedOut };
    if (name === 'js' && r.code === 0) copyFileSync(join(out, 'js.js'), join(out, 'js.cjs'));
    save();
    if (r.code !== 0) console.log(`${name} unavailable: see out/hardware/build-${name}.log`);
  }
  writeFileSync(join(out, 'builds.json'), JSON.stringify({ sourceSha256, builds: report.builds }, null, 2));
} else {
  const previous = JSON.parse(readFileSync(join(out, 'builds.json'), 'utf8'));
  if (previous.sourceSha256 !== sourceSha256) throw new Error('Hardware benchmark sources changed; rebuild instead of --no-build.');
  report.builds = previous.builds;
}
if (buildOnly) { save(); process.exit(0); }

for (const [name, executable, args] of [
  ['cpuTopology', 'sysctl', ['hw.perflevel0.name', 'hw.perflevel0.physicalcpu', 'hw.perflevel1.name', 'hw.perflevel1.physicalcpu']],
  ['compiler', 'clang', ['--version']],
  ['power', 'pmset', ['-g', 'batt']],
  ['thermalBefore', 'pmset', ['-g', 'therm']],
]) {
  const r = await command(executable, args, `environment-${name}`);
  report.environment[name] = r.code === 0 ? r.stdout.trim() : null;
}

const definitions = quick
  ? [{ kind: 'comparison', depth: 6, count: 8 }, { kind: 'boolean', depth: 6, count: 2 }]
  : [{ kind: 'comparison', depth: 8, count: 1024 }, { kind: 'comparison', depth: 12, count: 64 }, { kind: 'comparison', depth: 14, count: 16 },
     { kind: 'boolean', depth: 6, count: 256 }, { kind: 'boolean', depth: 10, count: 16 }, { kind: 'boolean', depth: 12, count: 4 }];
const backends = [
  { name: 'js', build: 'js', executable: process.execPath, prefix: [join(out, 'js.cjs')], args: [] },
  ...threadCounts.map(threads => ({ name: `cpu-${threads}`, build: 'cpu', executable: join(out, 'cpu'), prefix: [], args: ['--threads', String(threads), '--gpu', 'off'] })),
  { name: 'metal', build: 'metal', executable: join(out, 'metal'), prefix: [], args: ['--threads', String(Math.max(...threadCounts)), '--gpu', '1GB'] },
];
const stats = values => { const v = [...values].sort((a,b) => a-b); return { medianMs: v[Math.floor(v.length/2)], minMs: v[0], maxMs: v.at(-1), samples: v.length }; };
for (const backend of backends) {
  if (report.builds[backend.build]?.code !== 0) continue;
  const values = [];
  for (let i = 0; i < 7; i++) {
    const r = await command(backend.executable, [...backend.prefix, ...backend.args, '--', 'comparison', '0', '1', '0', '37'], `startup-${backend.name}-${i}`);
    if (r.code !== 0) throw new Error(`Startup check failed: ${backend.name}`);
    values.push(r.wallMs);
  }
  report.startup[backend.name] = { ...stats(values), method: 'Seven fresh processes, no kernel operations; includes runtime/device initialization, OS disk/shader caches may be warm.' };
  save();
}

function expectedVolume(kind, start, count) {
  let sum = 0;
  for (let id = start; id < start + count; id++) {
    const h = 8 + (id % 17) / 4, r = 5 + (id % 31) / 16, rb = 1 + (id % 13) / 16, z = (id % 65) / 4;
    sum += kind === 'boolean' ? Math.PI * (r*r - rb*rb) * h
      : Math.PI * ((r*r + rb*rb) * h - 2*rb*rb*Math.max(0, h-z));
  }
  return sum;
}
let failed = false;
for (const definition of definitions) {
  const { kind, depth, count } = definition;
  let reference;
  for (const backend of backends) {
    if (report.builds[backend.build]?.code !== 0 || !existsSync(backend.executable)) continue;
    const label = `${kind}-d${depth}-n${count}-${backend.name}`;
    console.log(`Measuring ${label}…`);
    const r = await command(backend.executable, [...backend.prefix, ...backend.args, '--', kind, String(depth), String(count), quick ? '5' : '10', '37'], label);
    const float = bits => { const b = Buffer.alloc(4); b.writeUInt32LE(bits); return b.readFloatLE(); };
    const rows = r.stdout.split('\n').filter(s => s.startsWith('{')).map(s => {
      const row = JSON.parse(s); return { ...row, hi: float(row.hiBits), lo: float(row.loBits) };
    });
    const n = quick ? 5 : 10;
    const run = { ...definition, operationsPerBatch: 2 ** depth * count, backend: backend.name, processWallMs: r.wallMs,
      code: r.code, signal: r.signal, timedOut: r.timedOut, rows, log: `out/hardware/${label}.log` };
    if (backend.name === 'js') reference = rows;
    if (backend.name === 'metal') run.metalPasses = Number(/wonky_metal_passes=(\d+)/.exec(r.stderr)?.[1] ?? 0);
    run.independentVolumeRelativeErrors = rows.map((row, i) => {
      const expected = expectedVolume(kind, 37 + i*1009, 2**depth*count);
      return Math.abs(row.hi + row.lo - expected) / Math.max(1, Math.abs(expected));
    });
    const valid = r.code === 0 && rows.length === n && (backend.name !== 'metal' || run.metalPasses >= n) && rows.every((row, i) => {
      const ref = reference?.[i];
      return row.index === i && row.errors === 0 && ref && ref.hash === row.hash &&
        run.independentVolumeRelativeErrors[i] < 1e-11 &&
        Number.isFinite(row.hi + row.lo) && Math.abs((row.hi + row.lo) - (ref.hi + ref.lo)) <= 1e-11 * Math.max(1, Math.abs(ref.hi + ref.lo));
    });
    run.valid = valid;
    if (valid) run.warm = stats(rows.slice(3).map(s => s.elapsedMs));
    else failed = true;
    report.runs.push(run); save();
    console.log(`${label}: ${valid ? `${run.warm.medianMs} ms/batch` : 'INVALID — inspect log and cross-backend evidence'}`);
  }
}
const thermal = await command('pmset', ['-g', 'therm'], 'environment-thermalAfter');
report.environment.thermalAfter = thermal.code === 0 ? thermal.stdout.trim() : null;
save();
if (failed) process.exitCode = 1;
