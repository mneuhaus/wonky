// Cluster fs-needs-partstudio-input, second probe level (diagnosis only).
// Takes every unit whose next blocker (out/corpus/next-blocker-fs-needs-partstudio-input.jsonl)
// is an opBoolean refusal and re-runs it with the same stand-in seed and the
// same stubbed copy, now with the Boolean hook:
//   --mode pass-all    every Boolean refusal returns its first operand (WRONG
//                      geometry by construction): shows the first blocker that
//                      is not a Boolean. Model checks that fail afterwards are
//                      marked as possibly caused by the stub.
//   --mode hybrid-all  every Boolean refusal goes to the bake-off corefine +
//                      recover prototypes (native builds in out/bakeoff/):
//                      shows how far the prototype route gets on today's operands.
// At most 3 processes, per-unit timeout, uptime at start and end.
//   node scripts/corpus/fs-needs-partstudio-input/deep-next-blocker.mjs --mode pass-all [--jobs 3] [--timeout 300]
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync } from 'node:fs';
import { spawn, execSync } from 'node:child_process';
import { join } from 'node:path';
import { homedir } from 'node:os';

const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const mode = opt('--mode', 'pass-all');
const jobs = Math.min(3, Number(opt('--jobs', 3)));
const timeoutS = Number(opt('--timeout', 300));
const CAD = join(homedir(), 'Workspace/cad');
const HERE = 'tmp/corpus/cluster-partstudio';
const SEEDS = `${HERE}/seeds/standins.fs`;
const OUT = `out/corpus/fs-needs-partstudio-input/deep-next-blocker-${mode}.jsonl`;
mkdirSync('out/corpus/fs-needs-partstudio-input', { recursive: true });

const prior = readFileSync('out/corpus/next-blocker-fs-needs-partstudio-input.jsonl', 'utf8').trim().split('\n').map(l => JSON.parse(l)).filter(r => !r.meta);
const units = prior.filter(r => r.failedOperation?.name === 'opBoolean').map(r => {
  const stubbed = `${HERE}/stubbed/${r.path.replaceAll('/', '_')}`;
  return { path: r.path, feature: r.feature, family: r.family, seed: r.seed, stubs: r.stubs,
    target: r.stubs?.length ? stubbed : join(CAD, r.path), level1: { line: r.line, message: String(r.message).slice(0, 200), completed: r.completed } };
});
for (const u of units) if (!existsSync(u.target)) throw new Error(`missing target ${u.target}`);

const uptime = () => execSync('uptime').toString().trim();
writeFileSync(OUT, JSON.stringify({ meta: true, mode, startedAt: new Date().toISOString(), uptimeStart: uptime(), node: process.version, concurrency: jobs, timeoutS,
  units: units.length, harness: 'scripts/corpus/fs-needs-partstudio-input/seeded-hooked.mjs',
  note: 'Stand-in parts satisfy the guards only. pass-all geometry is wrong by construction after the first stubbed Boolean; hybrid-all is a test-only prototype route.' }) + '\n');
const MODEL_CHECK = /regenError|must regenerate|Unexpected|could not be identified|Expected exactly/;
const runOne = u => new Promise(resolve => {
  const argv = ['scripts/corpus/fs-needs-partstudio-input/seeded-hooked.mjs', u.target, ...(u.feature ? ['--feature', u.feature] : []), ...(u.seed ? ['--seed-fs', `${SEEDS}:${u.seed}`] : [])];
  const t0 = Date.now();
  const child = spawn('node', argv, { stdio: ['ignore', 'pipe', 'pipe'], detached: true, env: { ...process.env, WONKY_CORPUS_STUB: mode } });
  let out = '', err = '';
  child.stdout.on('data', d => out += d); child.stderr.on('data', d => err += d);
  const timer = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }, timeoutS * 1000);
  child.on('close', (code, signal) => {
    clearTimeout(timer);
    const lines = out.trim().split('\n').filter(Boolean);
    let build = null, hook = null;
    for (const l of lines) { try { const j = JSON.parse(l); if ('stubMode' in j) hook = j; else if ('target' in j) build = j; } catch {} }
    const rec = { path: u.path, feature: u.feature, family: u.family, seed: u.seed, stubs: u.stubs, level1: u.level1, wallMs: Date.now() - t0,
      ...(build ?? { ok: false, stage: signal ? 'timeout' : 'harness-error', stderr: err.slice(-800) }),
      booleanCalls: hook?.booleanCalls ?? null, stubbedBooleans: hook?.stubs ?? [] };
    delete rec.target;
    rec.afterStub = rec.stubbedBooleans.length > 0;
    rec.possiblyStubArtifact = !rec.ok && rec.afterStub && mode === 'pass-all' && MODEL_CHECK.test(String(rec.message ?? '')) && rec.errorClass === 'FeatureScriptError';
    appendFileSync(OUT, JSON.stringify(rec) + '\n');
    console.log(`${rec.ok ? 'OK ' : '-- '} ${u.path.slice(-64).padEnd(64)} stubs=${rec.stubbedBooleans.length} ${rec.ok ? `${rec.bodies} bodies` : `${rec.failedOperation?.name ?? rec.stage ?? ''}: ${String(rec.message ?? '').slice(0, 110)}`}`);
    resolve();
  });
});
const queue = [...units];
await Promise.all(Array.from({ length: jobs }, async () => { while (queue.length) await runOne(queue.shift()); }));
appendFileSync(OUT, JSON.stringify({ meta: true, endedAt: new Date().toISOString(), uptimeEnd: uptime() }) + '\n');
