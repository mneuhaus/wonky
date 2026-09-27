// Independent verifier for the corpus run (docs/corpus/run.md, "Verifikation").
//
// Re-runs, in fresh processes and with the production CLIs on the default JS
// path, (a) a stratified sample of corpus units: every success, the anchor,
// the furthest-reaching failures and 2-3 units per failure cluster with
// distinct message patterns; (b) every documented repro invocation under
// fixtures/corpus-repro/. It compares against the recorded outcome and writes
// out/corpus/verify/results.jsonl + meta.jsonl (uptime at start/end).
//
//   node scripts/corpus/verify/verify.mjs [--only sample|repros] [--concurrency 3]
//
// Nothing under ~/Workspace/cad is written: FS units run from the corpus path
// with --out under tmp/corpus/verify/out; Python units run the existing mirror
// in tmp/corpus/src (its SHA is checked against the corpus file first).
import { spawn, execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { loadavg } from 'node:os';
import { CORPUS_ROOT, REPO, TMP_DIR, OUT_DIR, messagePattern } from '../lib.mjs';
import { loadRecords } from '../clusters.mjs';
import { REPROS } from './repros.mjs';

const args = process.argv.slice(2);
const opt = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const only = opt('--only', null);
const concurrency = Math.min(3, Number(opt('--concurrency', 3)));
const VDIR = join(OUT_DIR, 'verify');
const VOUT = join(TMP_DIR, 'verify', 'out');
mkdirSync(VDIR, { recursive: true }); mkdirSync(VOUT, { recursive: true });
const RESULTS = join(VDIR, only ? `results-${only}.jsonl` : 'results.jsonl');
const META = join(VDIR, 'meta.jsonl');
if (process.env.WONKY_BACKEND) throw new Error('WONKY_BACKEND is set; verification must use the default JS path');
const uptime = () => { try { return execSync('uptime', { encoding: 'utf8' }).trim(); } catch { return null; } };
const session = new Date().toISOString();
const meta = o => appendFileSync(META, JSON.stringify({ session, at: new Date().toISOString(), ...o }) + '\n');
const sha16 = p => createHash('sha256').update(readFileSync(p)).digest('hex').slice(0, 16);
const slug = k => k.replace(/[^A-Za-z0-9._-]+/g, '_').slice(-150);

// ------------------------------------------------------------------ sample
function hash(s) { return parseInt(createHash('sha256').update(s).digest('hex').slice(0, 8), 16); }
function sample() {
  const { recs, targets, latest, anchorUnit } = loadRecords();
  const picked = new Map();
  const add = (r, why) => { if (!picked.has(r.key)) picked.set(r.key, { r, why: [why] }); else picked.get(r.key).why.push(why); };
  for (const r of recs.filter(r => r.status === 'ok')) add(r, 'success');
  for (const r of [...recs].filter(r => r.status !== 'ok').sort((a, b) => (b.completedOperations ?? 0) - (a.completedOperations ?? 0)).slice(0, 3)) add(r, 'nearest');
  // Known failures from the viewer audit.
  for (const r of recs) if (/cad-project-025\/.*beam_frame\.py$/.test(r.key)) add(r, 'known-failure');
  const byCluster = new Map();
  for (const r of recs) if (r.status !== 'ok') { if (!byCluster.has(r.cluster)) byCluster.set(r.cluster, []); byCluster.get(r.cluster).push(r); }
  for (const [c, list] of byCluster) {
    // distinct patterns first, deterministic order, representative + non-representative
    const byPattern = new Map();
    for (const r of [...list].sort((a, b) => hash(a.key) - hash(b.key))) { const p = `${r.kind}|${r.rootPattern}`; if (!byPattern.has(p)) byPattern.set(p, []); byPattern.get(p).push(r); }
    const pats = [...byPattern.values()].sort((a, b) => b.length - a.length);
    const want = list.length > 100 ? 3 : 2;
    const chosen = [];
    for (const g of pats) { if (chosen.length >= want) break; chosen.push(g[0]); }
    if (chosen.length < want) for (const r of list) { if (chosen.length >= want) break; if (!chosen.includes(r)) chosen.push(r); }
    if (!chosen.some(r => r.representative)) { const rep = list.find(r => r.representative); if (rep) chosen.push(rep); }
    if (!chosen.some(r => !r.representative)) { const non = list.find(r => !r.representative); if (non) chosen.push(non); }
    for (const r of chosen) add(r, `cluster:${c}`);
  }
  const units = new Map(targets.units.map(u => [u.key, u]));
  const jobs = [...picked.values()].map(({ r, why }) => ({ kind: 'unit', id: r.key, why, unit: units.get(r.key), rec: r }));
  if (anchorUnit) jobs.push({ kind: 'unit', id: anchorUnit.key, why: ['anchor'], unit: anchorUnit, rec: latest.get(anchorUnit.key) });
  return jobs;
}

function unitInvocation(job) {
  const u = job.unit, s = slug(u.key), outPrefix = join(VOUT, s, 'model');
  rmSync(dirname(outPrefix), { recursive: true, force: true }); mkdirSync(dirname(outPrefix), { recursive: true });
  if (u.anchor || u.frontend === 'fs') {
    const file = u.anchor ? join(REPO, u.path) : join(CORPUS_ROOT, u.path);
    return { file, cwd: REPO, outPrefix, sourceSha: u.anchor ? null : sha16(file),
      argv: [process.execPath, 'bin/wonky.mjs', file, '--format', 'step', '--out', outPrefix, ...(u.feature ? ['--feature', u.feature] : [])] };
  }
  const file = join(TMP_DIR, 'src', u.path), cwd = join(TMP_DIR, 'verify', 'work', s);
  mkdirSync(cwd, { recursive: true });
  return { file, cwd, outPrefix, sourceSha: sha16(join(CORPUS_ROOT, u.path)), mirrorSha: existsSync(file) ? sha16(file) : null,
    argv: [process.execPath, join(REPO, 'bin/wonky-python.mjs'), file, '--python', join(TMP_DIR, 'uv-python'),
      '--timeout-ms', String(Math.max(10000, (u.timeoutS - 15) * 1000)), '--out', outPrefix] };
}

// ------------------------------------------------------------------ exec
const childEnv = { ...process.env }; delete childEnv.WONKY_BACKEND;
function exec(argv, { cwd, timeoutS }) {
  return new Promise(resolve => {
    const t0 = performance.now();
    const child = spawn(argv[0], argv.slice(1), { cwd, detached: true, stdio: ['ignore', 'pipe', 'pipe'], env: childEnv });
    let stdout = '', stderr = '', timedOut = false;
    child.stdout.on('data', d => { stdout += d; if (stdout.length > 4e6) stdout = stdout.slice(-2e6); });
    child.stderr.on('data', d => { stderr += d; if (stderr.length > 4e6) stderr = stderr.slice(-2e6); });
    const timer = setTimeout(() => { timedOut = true; try { process.kill(-child.pid, 'SIGKILL'); } catch {} }, timeoutS * 1000);
    child.on('close', (code, signal) => { clearTimeout(timer); try { process.kill(-child.pid, 'SIGKILL'); } catch {} resolve({ code, signal, stdout, stderr, timedOut, wallMs: Math.round(performance.now() - t0) }); });
    child.on('error', e => { clearTimeout(timer); resolve({ code: -1, signal: null, stdout, stderr: String(e), timedOut, wallMs: Math.round(performance.now() - t0) }); });
  });
}
const lastErr = (stderr, file) => {
  const lines = stderr.trim().split('\n').filter(Boolean).filter(l => !/^wonky: no \.\S+ written:/.test(l));
  let m = (lines.at(-1) ?? '');
  for (const p of [file, file?.replace(REPO + '/', '')].filter(Boolean)) if (m.startsWith(p + ':')) m = m.slice(p.length + 1);
  return m.replace(/^wonky(-python)?: /, '');
};
function brepTotals(prefix) {
  const p = `${prefix}.brep.json`;
  if (!existsSync(p)) return null;
  const model = JSON.parse(readFileSync(p, 'utf8'));
  const b = model.bodies ?? [];
  const vols = b.map(x => x.validation?.volumeMm3);
  return { bodies: b.length, faces: b.reduce((s, x) => s + (x.validation?.faces ?? 0), 0), edges: b.reduce((s, x) => s + (x.validation?.edges ?? 0), 0),
    volumeMm3: vols.every(v => typeof v === 'number') ? vols.reduce((s, v) => s + v, 0) : null, closed: b.every(x => x.validation?.closed !== false),
    step: existsSync(`${prefix}.step`) };
}

// ------------------------------------------------------------------ jobs
const clusterPatterns = new Map();
{ const { recs } = loadRecords(); for (const r of recs) if (r.status !== 'ok') { if (!clusterPatterns.has(r.cluster)) clusterPatterns.set(r.cluster, new Set()); clusterPatterns.get(r.cluster).add(r.rootPattern); } }

async function runUnitJob(job) {
  const inv = unitInvocation(job);
  const rec = job.rec;
  const timeoutS = job.unit.timeoutS ?? 480;
  const load = loadavg();
  const r = await exec(inv.argv, { cwd: inv.cwd, timeoutS });
  const res = { kind: 'unit', id: job.id, why: job.why, family: job.unit.family, representative: job.unit.representative,
    recorded: { status: rec?.status, kind: rec?.kind, cluster: rec?.cluster ?? null, exitCode: rec?.exitCode, message: rec?.cliMessage ?? rec?.message ?? null, wallMs: rec?.wallMs,
      line: rec?.location?.line ?? null, column: rec?.location?.column ?? null, totals: rec?.totals ?? null },
    sourceShaRecorded: job.unit.sha, sourceShaNow: inv.sourceSha, mirrorSha: inv.mirrorSha ?? undefined,
    loadavgAtStart: load.map(x => +x.toFixed(2)), wallMs: r.wallMs, exitCode: r.code, signal: r.signal, timedOut: r.timedOut };
  if (r.code === 0) res.totals = brepTotals(inv.outPrefix), res.outPrefix = inv.outPrefix.replace(REPO + '/', '');
  else res.message = lastErr(r.stderr, inv.file);
  const recMsg = rec?.cliMessage ?? rec?.message ?? '';
  const recLoc = rec?.location?.line != null ? `${rec.location.line}:${rec.location.column != null ? rec.location.column + ':' : ''} ` : '';
  res.same = rec?.status === 'ok' ? r.code === 0 && !!res.totals && res.totals.bodies === rec.totals.bodies && res.totals.faces === rec.totals.faces
      && Math.abs((res.totals.volumeMm3 ?? NaN) - rec.totals.volumeMm3) <= 1e-9 * Math.max(1, rec.totals.volumeMm3)
    : rec?.status === 'timeout' ? r.timedOut
    : r.code !== 0 && !r.timedOut && (res.message === recLoc + recMsg || res.message === recMsg || res.message.endsWith(recMsg));
  return res;
}

async function runReproJob(job) {
  const load = loadavg();
  const r = await exec([process.execPath, ...job.argv], { cwd: REPO, timeoutS: 300 });
  const e = job.expect;
  const res = { kind: 'repro', id: job.id, cluster: job.cluster, role: job.role, expect: e, loadavgAtStart: load.map(x => +x.toFixed(2)),
    wallMs: r.wallMs, exitCode: r.code, timedOut: r.timedOut, stderrTail: r.stderr.trim().split('\n').slice(-2).join('\n').slice(0, 600),
    stdoutTail: r.stdout.trim().split('\n').slice(-3).join('\n').slice(0, 600) };
  const okExit = r.code === e.exit;
  const okErr = !e.err || r.stderr.includes(e.err);
  const okOut = !e.out || r.stdout.includes(e.out);
  res.same = okExit && okErr && okOut && !r.timedOut;
  if (job.role === 'cluster' && job.cluster) {
    const msg = lastErr(r.stderr, join(REPO, job.argv[1])).replace(/^\d+(:\d+)?: /, '');
    res.pattern = messagePattern(msg.replace(/^[A-Za-z]+Error: (?=No module)/, 'ModuleNotFoundError: '));
    const pats = clusterPatterns.get(job.cluster) ?? new Set();
    res.patternInCluster = pats.has(res.pattern) || [...pats].some(p => p.startsWith(res.pattern.slice(0, 60)) || res.pattern.startsWith(p.slice(0, 60)));
  }
  return res;
}

// ------------------------------------------------------------------ main
const jobs = [];
if (only !== 'repros') jobs.push(...sample());
if (only !== 'sample') jobs.push(...REPROS.map(j => ({ ...j, kind: 'repro' })));
writeFileSync(join(VDIR, only ? `plan-${only}.json` : 'plan.json'), JSON.stringify(jobs.map(j => ({ kind: j.kind, id: j.id, why: j.why, cluster: j.cluster ?? j.rec?.cluster, role: j.role })), null, 1));
if (args.includes('--plan')) { console.log(JSON.stringify(jobs.map(j => [j.kind, j.id, (j.why ?? [j.role]).join(','), j.rec?.cluster ?? j.cluster ?? '', j.rec?.status ?? ''])).replaceAll('],[', '],\n[')); process.exit(0); }
meta({ event: 'start', only, concurrency, jobs: jobs.length, uptime: uptime(), loadavg: loadavg(), node: process.version,
  gitHead: (() => { try { return execSync('git rev-parse HEAD', { cwd: REPO, encoding: 'utf8' }).trim(); } catch { return null; } })(), backend: 'default (js)' });
// Heavy anchor first so it overlaps with the short jobs.
jobs.sort((a, b) => (b.why?.includes('anchor') ? 1 : 0) - (a.why?.includes('anchor') ? 1 : 0));
let next = 0, done = 0;
async function worker() {
  while (next < jobs.length) {
    const job = jobs[next++];
    let res;
    try { res = job.kind === 'unit' ? await runUnitJob(job) : await runReproJob(job); }
    catch (e) { res = { kind: job.kind, id: job.id, runnerError: String(e?.stack ?? e) }; }
    res.at = new Date().toISOString();
    appendFileSync(RESULTS, JSON.stringify(res) + '\n');
    done++;
    console.error(`[verify] ${done}/${jobs.length} ${res.same ? 'same' : 'DIFF'} ${job.kind} ${job.id} ${res.wallMs ?? ''}ms`);
  }
}
await Promise.all(Array.from({ length: concurrency }, worker));
meta({ event: 'end', only, done, uptime: uptime(), loadavg: loadavg() });
