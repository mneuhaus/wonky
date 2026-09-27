// Runs harness.mjs over every unit of the fs-missing-builtin cluster.
// At most 3 processes, per-unit timeout, uptime recorded at start and end.
// Usage: node scripts/corpus/fs-missing-builtin/batch.mjs [--pass name] [--only substr] [--all-units] [--stubs-file f.json]
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const DATA = join(here, '..', '..', '..', 'tmp', 'corpus', 'fs-missing-builtin');
const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const pass = opt('--pass', 'p1'), only = opt('--only', null), allUnits = args.includes('--all-units');
const stubsFile = opt('--stubs-file', null);
const stubMap = stubsFile ? JSON.parse(readFileSync(join(here, stubsFile), 'utf8')) : {};
const files = JSON.parse(readFileSync(join(DATA, 'cluster-files.json'), 'utf8'));
const units = files.flatMap(f => f.units.filter(u => allUnits || u.inCluster).map(u => ({ path: f.path, feature: u.feature, key: u.key, family: f.family })))
  .filter(u => !only || u.key.includes(only)).filter(u => !args.includes('--stubbed-only') || stubMap[u.path])
  .filter(u => !opt('--keys-file', null) || readFileSync(join(DATA, opt('--keys-file')), 'utf8').split('\n').includes(u.key));
const passFlags = args.includes('--fold-booleans') ? ['--fold-booleans'] : [];
const out = join(DATA, `next-${pass}.jsonl`);
writeFileSync(out, '');
const meta = { pass, start: new Date().toISOString(), uptimeStart: execSync('uptime').toString().trim(), units: units.length, concurrency: 3, timeoutS: 240 };
const timeoutMs = meta.timeoutS * 1000;
let next = 0;
async function worker() {
  while (next < units.length) {
    const u = units[next++];
    const argv = [join(here, 'harness.mjs'), u.path, ...(u.feature ? ['--feature', u.feature] : [])];
    for (const s of stubMap[u.path] ?? []) argv.push('--stub', s);
    argv.push(...passFlags);
    const t0 = Date.now();
    const result = await new Promise(resolve => {
      const child = spawn('node', argv, { cwd: join(here, '..', '..', '..'), detached: true });
      let stdout = '', stderr = '';
      child.stdout.on('data', d => { stdout += d; }); child.stderr.on('data', d => { stderr += d; });
      const timer = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} resolve({ ok: false, stage: 'timeout', message: `killed after ${meta.timeoutS} s` }); }, timeoutMs);
      child.on('close', code => {
        clearTimeout(timer);
        const line = stdout.trim().split('\n').pop();
        try { resolve(JSON.parse(line)); } catch { resolve({ ok: false, stage: 'harness-crash', message: (stderr || stdout).slice(-600), exit: code }); }
      });
    });
    const row = { key: u.key, family: u.family, wallMs: Date.now() - t0, ...result };
    appendFileSync(out, JSON.stringify(row) + '\n');
    console.log(`${row.ok ? 'OK  ' : 'FAIL'} ${u.key} :: ${row.stage} ${row.status ?? ''} ${(row.message ?? '').slice(0, 110)}`);
  }
}
await Promise.all([worker(), worker(), worker()]);
meta.end = new Date().toISOString(); meta.uptimeEnd = execSync('uptime').toString().trim();
appendFileSync(join(DATA, 'run-meta.jsonl'), JSON.stringify(meta) + '\n');
console.log(JSON.stringify(meta));
