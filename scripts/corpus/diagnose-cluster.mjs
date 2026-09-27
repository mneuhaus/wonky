// Run scripts/corpus/diagnose-planar-admission.mjs (or another per-unit script)
// over the units of one corpus cluster. At most 3 processes, per-unit timeout,
// uptime recorded at start and end. Reads the corpus in place (read only).
//
//   node scripts/corpus/diagnose-cluster.mjs --out out/corpus/boolean-invalid-topology/admission.jsonl
//        [--script scripts/corpus/diagnose-planar-admission.mjs] [--timeout 300] [--match <regex on message>]
//        [--root <dir to resolve unit paths, default ~/Workspace/cad>] [--only <substring>] [--extra "<args passed to the script>"]
//        [--keys <file with one "key#feature" per line>] [--append] [--skip-done]
//   --append keeps existing records in --out; --skip-done also skips units already recorded there.
import { spawn, execSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, appendFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { REPO, CORPUS_ROOT, OUT_DIR } from './lib.mjs';

const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const out = opt('--out', join(OUT_DIR, 'boolean-invalid-topology', 'admission.jsonl'));
const script = opt('--script', 'scripts/corpus/diagnose-planar-admission.mjs');
const timeoutS = Number(opt('--timeout', 300));
const match = new RegExp(opt('--match', 'InvalidTopology|UnsupportedArrangement'));
const root = opt('--root', CORPUS_ROOT);
const only = opt("--only", null);
const extra = (opt("--extra", "") ?? "").split(" ").filter(Boolean);
const keysFile = opt('--keys', null);
const keys = keysFile ? new Set(readFileSync(keysFile, 'utf8').split('\n').map(s => s.trim()).filter(Boolean)) : null;
const append = args.includes('--append') || args.includes('--skip-done');
const done = new Set(args.includes('--skip-done') && existsSync(out)
  ? readFileSync(out, 'utf8').trim().split('\n').filter(Boolean).map(l => { const r = JSON.parse(l); return `${r.key}#${r.feature ?? ''}`; }) : []);

const latest = new Map();
for (const line of readFileSync(join(OUT_DIR, 'runs.jsonl'), 'utf8').trim().split('\n')) {
  const r = JSON.parse(line); latest.set(`${r.key}#${r.feature ?? ''}`, r);
}
const units = [...latest.values()].filter(r => r.frontend === 'fs' && match.test(r.message ?? '') && r.phase !== 0 && (!only || r.key.includes(only))
  && (!keys || keys.has(`${r.key}#${r.feature ?? ''}`)) && !done.has(`${r.key}#${r.feature ?? ''}`));
mkdirSync(dirname(out), { recursive: true });
if (!append) writeFileSync(out, '');
const uptime = () => execSync('uptime').toString().trim();
const meta = { script, timeoutS, extra, units: units.length, startUptime: uptime(), startedAt: new Date().toISOString() };
console.error(JSON.stringify(meta));

function runOne(unit) {
  return new Promise(done => {
    const file = join(root, unit.path);
    const argv = [script, file, ...(unit.feature ? [unit.feature] : []), ...extra];
    const child = spawn('node', argv, { cwd: REPO, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', d => { stdout += d; });
    child.stderr.on('data', d => { stderr += d; });
    const t0 = Date.now();
    const timer = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }, timeoutS * 1000);
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      const lines = stdout.trim().split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return { raw: l }; } });
      appendFileSync(out, JSON.stringify({ key: unit.key, path: unit.path, feature: unit.feature, family: unit.family,
        corpusMessage: unit.message, argv: ['node', ...argv], wallMs: Date.now() - t0, code, signal,
        loadavg: uptime(), records: lines, stderrTail: stderr.slice(-800) }) + '\n');
      console.error(`${unit.key}#${unit.feature ?? ''} ${code ?? signal} ${Date.now() - t0}ms`);
      done();
    });
  });
}
const queue = [...units];
await Promise.all([0, 1, 2].map(async () => { while (queue.length) await runOne(queue.shift()); }));
meta.endUptime = uptime(); meta.endedAt = new Date().toISOString();
appendFileSync(join(dirname(out), 'run-meta.jsonl'), JSON.stringify({ out, ...meta }) + '\n');
console.error(JSON.stringify(meta));
