// Runs every unit of cluster kernel-sketch-and-ops (or UNITS=<json>) through harness.mjs with at
// most 3 processes and the corpus run's per-unit timeout; records uptime at start and end.
// Usage: node scripts/corpus/kernel-sketch-and-ops/drive.mjs <label> [--stub list]
//        UNITS=tmp/corpus/kso/xunits.json ONLY=<substring> ... (optional)
// Appends to out/corpus/cluster-kernel-sketch-and-ops.jsonl.
import { readFileSync, appendFileSync } from 'node:fs';
import { spawn, execSync } from 'node:child_process';
import { join } from 'node:path';
import { homedir, loadavg } from 'node:os';
const REPO = new URL('../../../', import.meta.url).pathname;
const OUT = join(REPO, 'out/corpus/cluster-kernel-sketch-and-ops.jsonl');
const [label, ...rest] = process.argv.slice(2);
const units = JSON.parse(readFileSync(join(REPO, process.env.UNITS ?? 'tmp/corpus/kso/units.json'), 'utf8'));
const only = process.env.ONLY;
const todo = units.filter(u => !only || u.key.includes(only));
const meta = event => appendFileSync(OUT, JSON.stringify({ meta: event, label, at: new Date().toISOString(), uptime: execSync('uptime').toString().trim(), units: todo.length }) + '\n');
meta('start');
let next = 0;
async function worker() {
  while (next < todo.length) {
    const u = todo[next++];
    const file = join(homedir(), 'Workspace/cad', u.path);
    const timeoutMs = (u.timeoutS ?? 180) * 1000;
    const argv = ['scripts/corpus/kernel-sketch-and-ops/harness.mjs', file, u.feature ?? '', ...rest];
    const t0 = Date.now(), load = loadavg()[0];
    const res = await new Promise(done => {
      const child = spawn('node', argv, { cwd: REPO, detached: true });
      let out = '', err = '';
      child.stdout.on('data', d => out += d); child.stderr.on('data', d => err += d);
      const timer = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }, timeoutMs);
      child.on('close', (code, signal) => { clearTimeout(timer); done({ code, signal, out, err }); });
    });
    let parsed = null; try { parsed = JSON.parse(res.out.trim().split('\n').at(-1)); } catch {}
    const row = { label, key: u.key, family: u.family, representative: u.representative, wallMs: Date.now() - t0, loadAtStart: load,
      timedOut: res.signal === 'SIGKILL', exit: res.code, ...(parsed ?? { raw: res.out.slice(-500), stderr: res.err.slice(-800) }) };
    appendFileSync(OUT, JSON.stringify(row) + '\n');
    console.log(`${u.key} ${row.timedOut ? 'TIMEOUT' : parsed?.result?.ok ? 'OK' : (parsed?.result?.failing?.name ?? '') + ': ' + (parsed?.result?.message ?? res.err.slice(-200)).slice(0, 110)} (${row.wallMs} ms)`);
  }
}
await Promise.all([worker(), worker(), worker()]);
meta('end');
