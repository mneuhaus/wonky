// Next-blocker study for cluster fs-interpreter-semantics.
//
// For every unit of the cluster (tmp/corpus/fs-interpreter-semantics/units.json,
// from ./units.mjs) this runs the production build entrypoint through
// ./probe-params.mjs in these variants:
//   current  - production code as is, no parameters (re-checks the first blocker)
//   fix      - production code + the prototype fix (./prototype, in memory),
//              no parameters: what Onshape would build when the feature is inserted
//   fix+ps   - as fix, plus the parameter values of Marc's live Part Studio
//              instance where the project records them (project-component-1c8dacbe:
//              scripts/build.mjs and the r12 feature list)
//   stub     - as fix, on a copy under tmp/corpus/fs-interpreter-semantics/stub/
//              whose source error is corrected (units subcluster: q0 * millimeter)
// Corpus files are only read. At most --concurrency (default 2, max 3) wonky
// processes run at once; each has a timeout. uptime is recorded at start and end.
//
// Regression mode (--keys-file F --out NAME): runs the units listed in F (JSON array of
// corpus-run unit keys, any cluster) in variant 'fix' only, and compares the first blocker
// with the recorded production result in out/corpus/runs.jsonl ('same' / 'changed').
//
// Usage: node scripts/corpus/fs-interpreter-semantics/next-blocker.mjs [--concurrency N] [--only substr] [--variants current,fix,...]
//        node scripts/corpus/fs-interpreter-semantics/next-blocker.mjs --keys-file tmp/corpus/fs-interpreter-semantics/regression-keys.json --out regression
// Writes out/corpus/fs-interpreter-semantics/next-blocker.jsonl (one line per run, replaced per invocation)
// and appends start/end records to out/corpus/fs-interpreter-semantics/run-meta.jsonl.
import { spawn, execSync } from 'node:child_process';
import { readFileSync, writeFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { loadavg } from 'node:os';
import { REPO, CORPUS_ROOT, TMP_DIR, OUT_DIR } from '../lib.mjs';

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
const concurrency = Math.min(3, Number(opt('--concurrency', 2)));
const only = opt('--only', null);
const wanted = opt('--variants', 'current,fix,fix+ps,stub').split(',');
const here = join(REPO, 'scripts/corpus/fs-interpreter-semantics');
const outDir = join(OUT_DIR, 'fs-interpreter-semantics');
const stubDir = join(TMP_DIR, 'fs-interpreter-semantics', 'stub');
mkdirSync(outDir, { recursive: true }); mkdirSync(stubDir, { recursive: true });
const uptime = () => { try { return execSync('uptime', { encoding: 'utf8' }).trim(); } catch { return null; } };
const meta = record => appendFileSync(join(outDir, 'run-meta.jsonl'), JSON.stringify({ at: new Date().toISOString(), ...record }) + '\n');

// Live Part Studio parameter values (cad-project-040): r1/r2 from archive/r2/snapshot/build.mjs,
// r3 onwards from archive/r7/source-before-r8/build.mjs and the r12 feature list (identical).
const zAxis = rev => ({
  position: '61.28756 * millimeter', pitchX: '15 * millimeter', pitchZ: '16 * millimeter', railEnd: '10 * millimeter', probeClearance: '3.3 * millimeter',
  ...(rev <= 2 ? { railLength: '200 * millimeter', driveCenters: '165 * millimeter' } : { railLength: '160 * millimeter', driveCenters: '144 * millimeter', beltAdjust: '3 * millimeter' }),
  hardware: 'true', probeDeployed: 'false',
});
function partStudioValues(u) {
  if (u.family !== 'fs560') return null;
  const rev = Number((u.path.match(/archive\/r(\d+)\//) ?? [])[1] ?? 99);
  return zAxis(rev);
}
function stubSource(u) {
  if (u.kind !== 'units') return null;
  const text = readFileSync(join(CORPUS_ROOT, u.path), 'utf8');
  const fixed = text.replace(/var q0=vector\(([^()]*)\);/, 'var q0=vector($1)*millimeter;');
  if (fixed === text) throw new Error(`stub pattern not found in ${u.path}`);
  const file = join(stubDir, u.path.replace(/[\/]/g, '__'));
  writeFileSync(file, fixed);
  return file;
}

const keysFile = opt('--keys-file', null), outName = opt('--out', null);
const recorded = new Map();
for (const line of readFileSync(join(OUT_DIR, 'runs.jsonl'), 'utf8').split('\n')) { if (!line.trim()) continue; const r = JSON.parse(line); if (r.runner === 'corpus-run/1') recorded.set(r.key, r); }
const units = keysFile
  ? JSON.parse(readFileSync(keysFile, 'utf8')).map(key => { const r = recorded.get(key); return { key, path: r.path, feature: r.feature, family: r.family, kind: r.kind }; })
  : JSON.parse(readFileSync(join(TMP_DIR, 'fs-interpreter-semantics', 'units.json'), 'utf8'));
units.splice(0, units.length, ...units.filter(u => !only || u.key.includes(only)));
if (keysFile) wanted.splice(0, wanted.length, 'fix');
const jobs = [];
for (const u of units) {
  const timeoutS = u.path.startsWith('cad-project-043/fsocct/cases') ? 480 : 180; // same budgets as scripts/corpus/run.mjs
  const base = { key: u.key, path: u.path, feature: u.feature, family: u.family, kind: u.kind, timeoutS };
  const file = join(CORPUS_ROOT, u.path);
  if (wanted.includes('current')) jobs.push({ ...base, variant: 'current', file, hook: false, params: {} });
  if (wanted.includes('fix')) jobs.push({ ...base, variant: 'fix', file, hook: true, params: {} });
  const ps = partStudioValues(u);
  if (ps && wanted.includes('fix+ps')) jobs.push({ ...base, variant: 'fix+ps', file, hook: true, params: ps });
  if (wanted.includes('stub')) { const stub = stubSource(u); if (stub) jobs.push({ ...base, variant: 'stub', file: stub, hook: true, params: {} }); }
}

const childEnv = { ...process.env }; delete childEnv.WONKY_BACKEND; delete childEnv.NODE_OPTIONS;
function exec(argv, timeoutS) {
  return new Promise(resolvePromise => {
    const t0 = Date.now();
    const child = spawn(argv[0], argv.slice(1), { cwd: REPO, detached: true, stdio: ['ignore', 'pipe', 'pipe'], env: childEnv });
    let stdout = '', stderr = '', timedOut = false;
    child.stdout.on('data', d => { stdout += d; }); child.stderr.on('data', d => { stderr += d; });
    const timer = setTimeout(() => { timedOut = true; try { process.kill(-child.pid, 'SIGKILL'); } catch {} }, timeoutS * 1000);
    child.on('close', (code, signal) => { clearTimeout(timer); resolvePromise({ code, signal, stdout, stderr, timedOut, wallMs: Date.now() - t0 }); });
  });
}

if (process.env.WONKY_BACKEND) throw new Error('Unset WONKY_BACKEND: corpus runs use the default JS path');
const results = [];
meta({ event: 'start', runner: 'fs-interpreter-semantics/next-blocker', jobs: jobs.length, concurrency, uptime: uptime(), loadavg: loadavg() });
let next = 0;
async function worker() {
  while (next < jobs.length) {
    const job = jobs[next++];
    const argv = [process.execPath, ...(job.hook ? ['--import', join(here, 'prototype/register.mjs')] : []), join(here, 'probe-params.mjs'), job.file, job.feature ?? '', JSON.stringify(job.params)];
    const load = loadavg()[0];
    const r = await exec(argv, job.timeoutS);
    let probe = null;
    try { probe = JSON.parse(r.stdout.trim().split('\n').pop()); } catch { probe = { ok: null, note: r.timedOut ? 'timeout' : `no JSON (exit ${r.code})`, stderrTail: r.stderr.slice(-600) }; }
    const row = { ...job, file: job.file.replace(REPO + '/', ''), loadavgAtStart: +load.toFixed(2), wallMs: r.wallMs, timedOut: r.timedOut, ...probe };
    if (keysFile) {
      const before = recorded.get(job.key);
      const beforeOk = before.status === 'ok';
      row.recorded = { status: before.status, message: before.message, line: before.location?.line ?? null };
      row.compare = probe.ok === true ? (beforeOk ? 'same' : 'changed') : beforeOk ? 'changed' : (probe.message === before.message && (probe.line ?? null) === (before.location?.line ?? null)) ? 'same' : 'changed';
    }
    results.push(row);
    process.stdout.write(`${row.compare ? row.compare.padEnd(8) : ''}${row.variant.padEnd(7)} ${(row.key).slice(0, 90).padEnd(90)} ${row.ok ? `OK bodies=${row.bodies}` : row.timedOut ? 'TIMEOUT' : `${row.line ?? ''}: ${(row.message ?? row.note ?? '').slice(0, 110)}`}\n`);
  }
}
await Promise.all(Array.from({ length: concurrency }, worker));
results.sort((a, b) => a.key.localeCompare(b.key) || a.variant.localeCompare(b.variant));
writeFileSync(join(outDir, outName ? `${outName}.jsonl` : only || wanted.join() !== 'current,fix,fix+ps,stub' ? `next-blocker.partial.jsonl` : 'next-blocker.jsonl'), results.map(r => JSON.stringify(r)).join('\n') + '\n');
meta({ event: 'end', runner: 'fs-interpreter-semantics/next-blocker', done: results.length, uptime: uptime(), loadavg: loadavg() });
