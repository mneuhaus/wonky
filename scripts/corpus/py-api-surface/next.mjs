// Next-blocker probe for cluster py-api-surface (corpus analysis only).
//
// For every build123d file whose first blocker in out/corpus/runs.jsonl is the
// cluster "build123d API outside the Bend shim", this runs a COPY through the
// production CLI (bin/wonky-python.mjs, default JS path) after the proposed
// fix has been emulated inside the copy (scripts/corpus/py-api-surface/lazy.py):
// every build123d name is bound to the shim's capability sentinel instead of
// failing at import/annotation time. The error the copy reports is what the
// file hits once the cluster's first blocker is gone.
//
//   node scripts/corpus/py-api-surface/next.mjs [--mode lazy|lazy+localpath] [--concurrency N<=3] [--only substr]
//
// Mirror: tmp/corpus/py-api-surface/<mode>/src/<corpus path>, built from the
// corpus run's own mirror tmp/corpus/src (all .py files of the project plus
// the entry directory recursively). ~/Workspace/cad is never touched.
// Output: out/corpus/py-api-surface/next-<mode>.jsonl (rewritten per run) and
// run metadata with `uptime` in out/corpus/py-api-surface/run-meta.jsonl.
import { spawn, execSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync, copyFileSync, rmSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { loadavg } from 'node:os';
import { REPO, TMP_DIR, OUT_DIR, classify, messagePattern } from '../lib.mjs';

const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const mode = opt('--mode', 'lazy');
const concurrency = Math.min(3, Number(opt('--concurrency', 2)));
const only = opt('--only', null);
if (process.env.WONKY_BACKEND) throw new Error('WONKY_BACKEND is set; corpus runs must use the default JS path');

const HERE = join(TMP_DIR, 'py-api-surface');
const BASE = join(HERE, mode.replace(/[^a-z]+/g, '-'));
const OUT = join(OUT_DIR, 'py-api-surface');
const MIRROR_SRC = join(TMP_DIR, 'src');
const PY = join(TMP_DIR, 'uv-python');
mkdirSync(OUT, { recursive: true });
mkdirSync(BASE, { recursive: true });

// ------------------------------------------------------------ cluster members
const latest = new Map();
for (const line of readFileSync(join(OUT_DIR, 'runs.jsonl'), 'utf8').split('\n')) {
  if (!line.trim()) continue;
  const r = JSON.parse(line);
  if (r.runner === 'corpus-run/1') latest.set(r.key, r);
}
const vocab = new Set(Object.keys(JSON.parse(readFileSync(join(REPO, 'fixtures/lang/b3d-vocab.json'), 'utf8')).categories));
const inCluster = r => r.frontend === 'py' && (r.kind === 'python-api'
  || (r.kind === 'python-name-error' && vocab.has((r.message.match(/name '([^']+)' is not defined/) ?? [])[1])));
let units = [...latest.values()].filter(inCluster).filter(r => !only || r.key.includes(only));
const b3dAll = JSON.parse(readFileSync(join(HERE, 'b3d-all.json'), 'utf8'));

// ------------------------------------------------------------ mirror + transform
const copyTree = (from, to, filter) => {
  let entries; try { entries = readdirSync(from, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const p = join(from, e.name), q = join(to, e.name);
    if (e.isDirectory()) { copyTree(p, q, filter); continue; }
    if (!e.isFile() || !filter(p)) continue;
    mkdirSync(dirname(q), { recursive: true });
    copyFileSync(p, q);
  }
};
const jobs = [];
for (const u of units) {
  const project = u.path.split('/')[0];
  const root = join(BASE, 'src');
  if (!existsSync(join(root, `.${project}.mirrored`))) {
    copyTree(join(MIRROR_SRC, project), join(root, project), p => p.endsWith('.py'));
    writeFileSync(join(root, `.${project}.mirrored`), new Date().toISOString());
  }
  copyTree(join(MIRROR_SRC, dirname(u.path)), join(root, dirname(u.path)), () => true);
  jobs.push({ src: join(MIRROR_SRC, u.path), dst: join(root, u.path) });
}
const transformed = JSON.parse(execSync(`uv run --no-project --offline --quiet python ${join(REPO, 'scripts/corpus/py-api-surface/lazy.py')}`,
  { input: JSON.stringify({ b3dAll, mode, jobs }), encoding: 'utf8', maxBuffer: 1 << 26 }));
const byDst = new Map(transformed.map(t => [t.dst, t]));

// ------------------------------------------------------------ execution
const uptime = () => { try { return execSync('uptime', { encoding: 'utf8' }).trim(); } catch { return null; } };
const session = new Date().toISOString();
const meta = row => appendFileSync(join(OUT, 'run-meta.jsonl'), JSON.stringify({ session, at: new Date().toISOString(), mode, ...row }) + '\n');
meta({ event: 'start', units: units.length, concurrency, uptime: uptime(), loadavg: loadavg(), node: process.version,
  gitHead: execSync('git rev-parse HEAD', { cwd: REPO, encoding: 'utf8' }).trim(), backend: 'default (js)' });

const childEnv = { ...process.env }; delete childEnv.WONKY_BACKEND;
function exec(argv, { cwd, timeoutS }) {
  return new Promise(resolve => {
    const t0 = performance.now();
    const child = spawn(argv[0], argv.slice(1), { cwd, detached: true, stdio: ['ignore', 'pipe', 'pipe'], env: childEnv });
    let stdout = '', stderr = '', timedOut = false;
    child.stdout.on('data', d => { stdout += d; });
    child.stderr.on('data', d => { stderr += d; });
    const timer = setTimeout(() => { timedOut = true; try { process.kill(-child.pid, 'SIGKILL'); } catch {} }, timeoutS * 1000);
    child.on('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal, stdout, stderr, timedOut, wallMs: Math.round(performance.now() - t0) }); });
  });
}

const slug = key => key.replace(/[^A-Za-z0-9._-]+/g, '_').slice(-150);
const results = [];
async function runUnit(u) {
  const file = join(BASE, 'src', u.path), t = byDst.get(file);
  if (!t?.ok) return { key: u.key, status: 'skipped', message: t?.error ?? 'not transformed' };
  const cwd = join(BASE, 'work', slug(u.key)), out = join(BASE, 'out', slug(u.key), 'model');
  mkdirSync(cwd, { recursive: true });
  const timeoutS = u.timeoutS ?? 180, pyTimeout = String(Math.max(10000, (timeoutS - 15) * 1000));
  const argv = [process.execPath, join(REPO, 'bin/wonky-python.mjs'), file, '--python', PY, '--timeout-ms', pyTimeout, '--out', out];
  const load = loadavg();
  const r = await exec(argv, { cwd, timeoutS });
  const record = { key: u.key, family: u.family, representative: u.representative, mode, preamble: { line: t.insertedAtLine, how: t.how },
    firstBlocker: { line: u.location?.line ?? null, message: u.message },
    invocation: { argv: ['node', ...argv.slice(1).map(a => relative(REPO, a) || a)], cwd: relative(REPO, cwd) },
    loadavgAtStart: load.map(x => +x.toFixed(2)), wallMs: r.wallMs, exitCode: r.code };
  if (r.timedOut) return Object.assign(record, { status: 'timeout', kind: 'runner-timeout' });
  if (r.code === 0) return Object.assign(record, { status: 'ok', kind: 'ok', stdoutTail: r.stdout.slice(-600) });
  const last = r.stderr.trim().split('\n').filter(Boolean).at(-1) ?? '';
  const m = last.match(/^(.*?\.py)(?::(\d+))?(?::\d+)?: ([\s\S]*)$/);
  const p = await exec([process.execPath, join(REPO, 'scripts/corpus/probe.mjs'), 'py', file, PY, pyTimeout], { cwd, timeoutS });
  let probe = null;
  try { probe = JSON.parse(p.stdout.trim().split('\n').filter(l => l.startsWith('{')).at(-1)); } catch {}
  const message = m ? m[3] : last;
  const cls = classify({ errorClass: probe?.errorClass, message, userThrow: false, completedOperations: probe?.trace?.completed });
  const tb = probe?.traceback ?? '';
  const frames = [...tb.matchAll(/File "([^"]+)", line (\d+), in (\S+)\n\s*(.*)/g)].map(f => ({ file: relative(join(BASE, 'src'), f[1]), line: +f[2], fn: f[3], code: f[4].slice(0, 200) }));
  return Object.assign(record, cls, {
    line: m?.[2] ? +m[2] : null, message, pattern: messagePattern(message),
    errorClass: probe?.errorClass ?? null, sourceLine: probe?.sourceLine ?? null,
    completedOperations: probe?.trace?.completed ?? null, operations: probe?.trace?.operations ?? null,
    lastCompletedOperation: probe?.trace?.lastCompleted ?? null, failedOperation: probe?.trace?.failedOperation ?? null,
    frames: frames.slice(-4), probeMatches: probe ? probe.message === message || message.endsWith(probe.message ?? '\0') || (probe.message ?? '').endsWith(message) : null,
  });
}
const queue = [...units];
async function worker() {
  while (queue.length) {
    const u = queue.shift();
    let rec;
    try { rec = await runUnit(u); } catch (error) { rec = { key: u.key, status: 'runner-error', message: String(error.stack ?? error).slice(0, 1500) }; }
    results.push(rec);
    console.error(`[${results.length}/${units.length}] ${String(rec.status).padEnd(10)} ${u.key} :${rec.line ?? ''} ${(rec.message ?? '').slice(0, 150)}`);
  }
}
await Promise.all(Array.from({ length: concurrency }, worker));
results.sort((a, b) => a.key.localeCompare(b.key));
writeFileSync(join(OUT, `next-${mode.replace(/[^a-z]+/g, '-')}.jsonl`), results.map(r => JSON.stringify(r)).join('\n') + '\n');
meta({ event: 'end', done: results.length, uptime: uptime(), loadavg: loadavg() });
