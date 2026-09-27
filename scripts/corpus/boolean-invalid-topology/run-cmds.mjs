// Cluster boolean-invalid-topology: run a list of commands (one JSON array of argv
// per line in a jobs file) with at most 3 processes, a per-command timeout, and
// `uptime` recorded at start and end. Appends one JSON record per command to --out.
//   node scripts/corpus/boolean-invalid-topology/run-cmds.mjs --jobs <file> --out <jsonl> [--timeout 300] [--env K=V,...]
import { spawn, execSync } from 'node:child_process';
import { readFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const jobs = readFileSync(opt('--jobs'), 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
const out = opt('--out');
const timeoutS = Number(opt('--timeout', 300));
const extraEnv = Object.fromEntries((opt('--env', '') || '').split(',').filter(Boolean).map(kv => kv.split('=')));
if (process.env.WONKY_BACKEND || extraEnv.WONKY_BACKEND) throw new Error('corpus runs use the default JS path; unset WONKY_BACKEND');
mkdirSync(dirname(out), { recursive: true });
const uptime = () => execSync('uptime').toString().trim();
appendFileSync(out, JSON.stringify({ event: 'start', at: new Date().toISOString(), uptime: uptime(), jobs: jobs.length, timeoutS, concurrency: 3, env: extraEnv, backend: 'default JS path' }) + '\n');

function runOne(job) {
  const argv = Array.isArray(job) ? job : job.argv;
  const label = Array.isArray(job) ? argv.slice(1).join(' ') : job.label;
  return new Promise(done => {
    const child = spawn(argv[0], argv.slice(1), { cwd: REPO, detached: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...extraEnv } });
    let stdout = '', stderr = '';
    child.stdout.on('data', d => { stdout += d; });
    child.stderr.on('data', d => { stderr += d; });
    const t0 = Date.now();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; try { process.kill(-child.pid, 'SIGKILL'); } catch {} }, timeoutS * 1000);
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      const record = { label, argv, code, signal, timedOut, wallMs: Date.now() - t0, stdout: stdout.slice(-4000), stderr: stderr.slice(-2000), uptime: uptime() };
      appendFileSync(out, JSON.stringify(record) + '\n');
      console.error(`${label} -> ${timedOut ? 'TIMEOUT' : code} ${record.wallMs}ms ${(stderr.trim().split('\n')[0] ?? '').slice(0, 200)}`);
      done();
    });
  });
}
const queue = [...jobs];
await Promise.all([0, 1, 2].map(async () => { while (queue.length) await runOne(queue.shift()); }));
appendFileSync(out, JSON.stringify({ event: 'end', at: new Date().toISOString(), uptime: uptime() }) + '\n');
