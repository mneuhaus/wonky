// What would the fs-module-import files hit next? (docs/corpus/cluster-fs-module-import.md)
//
// Needs out/corpus/module-import/scan.json (scripts/corpus/module-import-scan.mjs).
// For every cluster unit (file, feature) whose first blocker is the unresolved
// module import, run scripts/corpus/module-import-probe.mjs:
//   rebind  only for files whose imports are ALL pinned to an Onshape
//           element@microversion that fixtures/r10b/modules.json already holds.
//           A manifest in tmp/corpus/module-import/rebind/ binds the unchanged
//           captured bodies (copied, hash-checked) to that file's own SHA-256.
//           Production build() and production frozen-module loader, no stubs.
//   stub1   import resolved by stubs (see module-import-probe.mjs).
//   stub2   stub1 + addInstance partQuery expressions not evaluated.
//
// Max 3 processes (shared machine), per-job timeout, resumable: results are
// appended to out/corpus/module-import/next.jsonl; uptime is recorded in
// out/corpus/module-import/run-meta.jsonl at start and end.
//
// Usage: node scripts/corpus/module-import-next.mjs [--modes rebind,stub1,stub2] [--only substr] [--rerun]
import { spawn, execSync } from 'node:child_process';
import { appendFileSync, cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { loadavg } from 'node:os';
import { CORPUS_ROOT, OUT_DIR, REPO, TMP_DIR, classify } from './lib.mjs';

const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const modes = opt('--modes', 'rebind,stub1,stub2').split(',');
const only = opt('--only', null);
const rerun = args.includes('--rerun');
const CONCURRENCY = 3;

const OUT = join(OUT_DIR, 'module-import');
const RESULTS = join(OUT, 'next.jsonl'), META = join(OUT, 'run-meta.jsonl');
const REBIND = join(TMP_DIR, 'module-import', 'rebind');
const { files } = JSON.parse(readFileSync(join(OUT, 'scan.json'), 'utf8'));

// ------------------------------------------------------------ rebind manifests
const fixture = JSON.parse(readFileSync(join(REPO, 'fixtures/r10b/modules.json'), 'utf8'));
const byRevision = new Map(fixture.modules.map(m => [`${m.element}@${m.microversion}`, m]));
const slug = p => p.replace(/[^A-Za-z0-9._-]+/g, '_');
const rebindManifest = new Map();
mkdirSync(REBIND, { recursive: true });
if (!existsSync(join(REBIND, 'modules'))) cpSync(join(REPO, 'fixtures/r10b/modules'), join(REBIND, 'modules'), { recursive: true });
for (const f of files) {
  const imports = f.imports ?? [];
  if (!imports.length || !imports.every(i => byRevision.has(`${i.path}@${i.version}`))) continue;
  const text = readFileSync(join(CORPUS_ROOT, f.path));
  const manifest = {
    schema: 'wonky-onshape-inputs/1', document: fixture.document, capturedAt: fixture.capturedAt,
    sourceSha256: createHash('sha256').update(text).digest('hex'),
    rebound: { from: 'fixtures/r10b/modules.json', fromSourceSha256: fixture.sourceSha256, corpusPath: f.path,
      note: 'Triage only. Same Onshape element@microversion, same captured body files; only the source binding and namespace names differ.' },
    modules: imports.map(i => ({ ...byRevision.get(`${i.path}@${i.version}`), namespace: i.namespace })),
  };
  const path = join(REBIND, `${slug(f.path)}.modules.json`);
  writeFileSync(path, JSON.stringify(manifest, null, 1));
  rebindManifest.set(f.path, path);
}

// ------------------------------------------------------------ jobs
const done = new Set();
if (existsSync(RESULTS) && !rerun) for (const l of readFileSync(RESULTS, 'utf8').split('\n')) if (l.trim()) { const r = JSON.parse(l); done.add(r.job); }
const jobs = [];
for (const f of files) {
  if (only && !f.path.includes(only)) continue;
  for (const u of f.units.filter(u => u.cluster === 'fs-module-import')) {
    const feature = u.feature ?? '-';
    const heavy = /single-step-r10|r10b|fsocct|interface-r|native-source|module-r4/.test(f.path) || f.lines > 1500;
    for (const mode of modes) {
      if (mode === 'rebind' && !rebindManifest.has(f.path)) continue;
      const job = `${mode}:${f.path}#${feature}`;
      if (done.has(job)) continue;
      const late = mode === 'rebind' && feature === 'singleStepR10b';
      jobs.push({ job, mode, path: f.path, family: f.family, representative: f.representative, feature, heavy, late,
        timeoutS: mode === 'rebind' ? 360 : heavy ? 240 : 120 });
    }
  }
}
jobs.sort((a, b) => (a.late - b.late) || ({ stub2: 0, stub1: 1, rebind: 2 }[a.mode] - { stub2: 0, stub1: 1, rebind: 2 }[b.mode]));

const uptime = () => { try { return execSync('uptime', { encoding: 'utf8' }).trim(); } catch { return null; } };
const session = new Date().toISOString();
appendFileSync(META, JSON.stringify({ session, at: session, event: 'start', args, jobs: jobs.length, concurrency: CONCURRENCY, uptime: uptime(), loadavg: loadavg(), node: process.version }) + '\n');

function runJob(j) {
  return new Promise(resolveJob => {
    const argv = ['scripts/corpus/module-import-probe.mjs', j.mode, join(CORPUS_ROOT, j.path), j.feature, ...(j.mode === 'rebind' ? [rebindManifest.get(j.path)] : [])];
    const started = Date.now(), load = loadavg();
    const env = { ...process.env }; delete env.WONKY_BACKEND; // default JS path
    const child = spawn(process.execPath, argv, { cwd: REPO, detached: true, stdio: ['ignore', 'pipe', 'pipe'], env });
    let out = '', err = '', timedOut = false;
    child.stdout.on('data', d => { out += d; }); child.stderr.on('data', d => { err += d; });
    const timer = setTimeout(() => { timedOut = true; try { process.kill(-child.pid, 'SIGKILL'); } catch {} }, j.timeoutS * 1000);
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      let result = null;
      try { result = JSON.parse(out.trim().split('\n').at(-1)); } catch {}
      const cls = timedOut ? { status: 'timeout', kind: 'runner-timeout' }
        : !result ? { status: 'crash', kind: signal ? `signal-${signal}` : 'no-output' }
        : result.ok ? { status: 'ok', kind: 'ok' }
        : classify({ errorClass: result.errorClass, message: result.message, userThrow: result.userThrow, completedOperations: result.trace?.completed ?? 0 });
      const record = { job: j.job, mode: j.mode, path: j.path, family: j.family, representative: j.representative, feature: j.feature, session,
        startedAt: new Date(started).toISOString(), wallMs: Date.now() - started, timeoutS: j.timeoutS, loadavgAtStart: load, exitCode: code, signal,
        ...cls, result, stderrTail: err.slice(-800) };
      appendFileSync(RESULTS, JSON.stringify(record) + '\n');
      console.log(`${cls.status.padEnd(10)} ${String(record.wallMs).padStart(6)}ms ${j.mode} ${j.path}#${j.feature} ${result?.message ? '— ' + result.message.slice(0, 110) : ''}`);
      resolveJob();
    });
  });
}
let next = 0;
await Promise.all(Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, async () => { while (next < jobs.length) await runJob(jobs[next++]); }));
appendFileSync(META, JSON.stringify({ session, at: new Date().toISOString(), event: 'end', jobs: jobs.length, uptime: uptime(), loadavg: loadavg() }) + '\n');
