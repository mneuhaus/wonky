// Corpus failure analysis, cluster boolean-capability: run
// scripts/corpus/boolean-probe.mjs over every unit of the cluster (latest
// record per unit in out/corpus/runs.jsonl whose root message is an opBoolean
// capability refusal of this cluster), at most 3 processes at once, with a
// per-unit timeout. Records `uptime` at start and end.
//
// Usage: node scripts/corpus/boolean-batch.mjs [--stub nary|pass|pass:<subcause,...>|pass-all|hybrid|hybrid-all]
//        [--out file] [--only substr] [--timeout-s N] [--step-dir dir]
// Default output: out/corpus/boolean-capability/probe[-<stub>].jsonl
import { spawn, execSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, appendFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '../..');
const CAD = join(process.env.HOME, 'Workspace/cad');
const argv = process.argv.slice(2);
const opt = k => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
const stub = opt('--stub') ?? '';
const only = opt('--only');
const stepDir = opt('--step-dir');
const outFile = opt('--out') ?? join(REPO, `out/corpus/boolean-capability/probe${stub ? '-' + stub.replace(/[:,]/g, '-') : ''}.jsonl`);
const TIMEOUT_MS = Number(opt('--timeout-s') ?? 180) * 1000;
const CONCURRENCY = 3;

export function clusterUnits() {
  const latest = new Map();
  for (const l of readFileSync(join(REPO, 'out/corpus/runs.jsonl'), 'utf8').split('\n')) {
    if (!l.trim()) continue;
    const r = JSON.parse(l);
    if (r.runner === 'corpus-run/1') latest.set(r.key, r);
  }
  const units = [];
  for (const r of latest.values()) {
    let m = r.message ?? '';
    const op = r.failingOperation;
    if (op?.status === 'failed' && op.error?.message && m.endsWith(op.error.message)) m = op.error.message;
    if (r.status === 'capability' && /^opBoolean/.test(m) && !/InvalidTopology|UnsupportedArrangement/.test(m)) units.push({ ...r, rootMessage: m });
  }
  return units.sort((a, b) => a.key.localeCompare(b.key));
}

function runOne(u) {
  return new Promise(res => {
    const t0 = Date.now();
    const args = ['scripts/corpus/boolean-probe.mjs', join(CAD, u.path), ...(u.feature ? [u.feature] : [])];
    const env = { ...process.env, WONKY_CORPUS_STUB: stub, ...(stepDir ? { WONKY_CORPUS_STEP: join(stepDir, u.key.replace(/[^A-Za-z0-9_.-]+/g, '_')) } : {}) };
    const child = spawn('node', args, { cwd: REPO, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    let so = '', se = '', timedOut = false;
    child.stdout.on('data', d => { so += d; });
    child.stderr.on('data', d => { se += d; });
    const timer = setTimeout(() => { timedOut = true; try { process.kill(-child.pid, 'SIGKILL'); } catch {} }, TIMEOUT_MS);
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      let probe = null;
      try { probe = JSON.parse(so.trim().split('\n').pop()); } catch {}
      res({ key: u.key, path: u.path, feature: u.feature, family: u.family, representative: u.representative, project: u.project,
        corpusMessage: u.rootMessage, corpusCompleted: u.completedOperations, stub: stub || null,
        wallMs: Date.now() - t0, code, signal, timedOut, probe, stderrTail: probe ? undefined : se.slice(-1500) });
    });
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  let units = clusterUnits();
  if (only) units = units.filter(u => u.key.includes(only));
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, '');
  const meta = join(REPO, 'out/corpus/boolean-capability/run-meta.jsonl');
  appendFileSync(meta, JSON.stringify({ event: 'start', at: new Date().toISOString(), stub: stub || null, units: units.length, uptime: execSync('uptime').toString().trim(), concurrency: CONCURRENCY, timeoutMs: TIMEOUT_MS, backend: process.env.WONKY_BACKEND ?? 'default JS path', simulate: process.env.WONKY_CORPUS_SIMULATE || null, out: outFile }) + '\n');
  if (process.env.WONKY_BACKEND) throw new Error('refusing to run with WONKY_BACKEND set');
  let next = 0, done = 0;
  const worker = async () => {
    while (next < units.length) {
      const u = units[next++];
      const r = await runOne(u);
      appendFileSync(outFile, JSON.stringify(r) + '\n');
      done++;
      if (done % 20 === 0) process.stderr.write(`${done}/${units.length}\n`);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  appendFileSync(meta, JSON.stringify({ event: 'end', at: new Date().toISOString(), stub: stub || null, units: units.length, uptime: execSync('uptime').toString().trim() }) + '\n');
  console.log(`wrote ${units.length} records to ${outFile}`);
}
