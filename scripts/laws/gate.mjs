#!/usr/bin/env node
// Proof gate for a law area (a directory holding LAWS.bend + PROOF.bend).
//
//   node scripts/laws/gate.mjs <dir> [--lock <lock.json>] [--timeout SECONDS]
//   node scripts/laws/gate.mjs <dir> --write-lock <lock.json> <spec files...>
//
// Checks, in order, and fails loudly on the first problem:
// 1. Lock: every file listed in the lock (LAWS.bend and the spec helpers its
//    claims call) still has the approved SHA-256. Changing a law or a spec
//    helper therefore needs a new lock, which only Marc writes (docs/laws.md §5).
// 2. Hygiene: no @unsafe, no foreign `import "…"`, no `?hole` in the .bend files
//    of <dir> (not recursive) and of kernel/laws/ (recursive), and PROOF.bend
//    imports ./LAWS.bend as Laws.
// 3. Verdict: `bend PROOF.bend --check-only` must end with exactly
//    "All terms check." (Bend 2.0.25 exits 0 for "All terms check, but N defs
//    rely on unsafe or foreign code", see docs/laws/prior-art.md §1.6) and must
//    finish within the timeout.
// Appends one JSON line with wall time and `uptime` to out/laws/gate-timings.jsonl.
import { spawnSync, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
let timeout = 120;
let lock = null;
let writeLock = null;
const positional = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--timeout') timeout = Number(args[++i]);
  else if (args[i] === '--lock') lock = args[++i];
  else if (args[i] === '--write-lock') writeLock = args[++i];
  else positional.push(args[i]);
}
const [dirArg, ...specFiles] = positional;
if (!dirArg) throw new Error('usage: gate.mjs <dir> [--lock lock.json] [--timeout s] | <dir> --write-lock lock.json <spec files...>');
const dir = resolve(dirArg);
const lawsFile = join(dir, 'LAWS.bend');
const proofFile = join(dir, 'PROOF.bend');
const sha256 = file => createHash('sha256').update(readFileSync(file)).digest('hex');
const fail = message => { console.error(`laws gate: ${message}`); process.exit(1); };

if (writeLock) {
  const files = [lawsFile, ...specFiles.map(f => resolve(f))];
  const entries = Object.fromEntries(files.map(f => [relative(root, f), sha256(f)]));
  writeFileSync(resolve(writeLock), JSON.stringify({ approvedBy: 'Marc', approvedAt: new Date().toISOString(), files: entries }, null, 2) + '\n');
  console.log(`wrote ${relative(root, resolve(writeLock))} for ${files.length} files`);
  process.exit(0);
}

// 1. Lock
if (lock) {
  const { files } = JSON.parse(readFileSync(resolve(lock), 'utf8'));
  if (!files?.[relative(root, lawsFile)]) fail(`${lock} does not lock ${relative(root, lawsFile)}`);
  for (const [file, expected] of Object.entries(files)) {
    const path = join(root, file);
    if (!existsSync(path)) fail(`locked spec file ${file} is missing`);
    const actual = sha256(path);
    if (actual !== expected) fail(`locked spec file ${file} changed (sha256 ${actual}, approved ${expected}). Laws and spec helpers change only with Marc's approval.`);
  }
}

// 2. Hygiene
// <dir> itself is scanned flat (it may be the repository root); kernel/laws/ recursively.
const bendFiles = readdirSync(dir).filter(name => name.endsWith('.bend')).map(name => join(dir, name));
const walk = d => {
  for (const name of readdirSync(d)) {
    const path = join(d, name);
    if (statSync(path).isDirectory()) walk(path);
    else if (name.endsWith('.bend')) bendFiles.push(path);
  }
};
if (existsSync(join(root, 'kernel/laws'))) walk(join(root, 'kernel/laws'));
const problems = [];
for (const file of new Set(bendFiles)) {
  readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
    const code = line.replace(/#.*$/, '').replace(/"(?:[^"\\]|\\.)*"/g, '""');
    const where = `${relative(root, file)}:${i + 1}`;
    if (/@unsafe\b/.test(code)) problems.push(`${where}: @unsafe`);
    if (/^\s*import\s+"/.test(code)) problems.push(`${where}: foreign import`);
    if (/(^|[^\w])\?[A-Za-z_]/.test(code)) problems.push(`${where}: open ?hole`);
  });
}
if (!/^import \.\/LAWS\.bend as Laws$/m.test(readFileSync(proofFile, 'utf8'))) problems.push(`${relative(root, proofFile)}: must import ./LAWS.bend as Laws`);
if (problems.length) fail(`proof hygiene:\n  ${problems.join('\n  ')}`);

// 3. Verdict
const { version } = JSON.parse(readFileSync(join(root, 'bend.lock.json'), 'utf8'));
const bend = join(root, '.tools', `bend-${version}`, 'bin', 'bend');
if (!existsSync(bend)) fail('run npm run setup to install the pinned Bend compiler');
const uptime = () => execFileSync('uptime', { encoding: 'utf8' }).trim();
const before = uptime();
const start = process.hrtime.bigint();
const run = spawnSync(bend, ['PROOF.bend', '--check-only'], {
  cwd: dir, encoding: 'utf8', timeout: timeout * 1000, maxBuffer: 64 << 20,
  env: { ...process.env, BEND_NO_TELEMETRY: '1' },
});
const seconds = Number((Number(process.hrtime.bigint() - start) / 1e9).toFixed(2));
const output = `${run.stdout ?? ''}${run.stderr ?? ''}`;
const verdict = output.trim().split('\n').at(-1) ?? '';
const ok = !run.error && run.status === 0 && verdict === 'All terms check.';
const laws = (readFileSync(lawsFile, 'utf8').match(/^law /gm) ?? []).length;
mkdirSync(join(root, 'out/laws'), { recursive: true });
appendFileSync(join(root, 'out/laws/gate-timings.jsonl'), JSON.stringify({
  at: new Date().toISOString(), dir: relative(root, dir), laws, ok, status: run.error ? String(run.error.code ?? run.error.message) : run.status,
  verdict, seconds, uptimeBefore: before, uptimeAfter: uptime(),
}) + '\n');
if (!ok) fail(`${relative(root, proofFile)} rejected after ${seconds} s:\n${output.split('\n').slice(-40).join('\n')}`);
console.log(`laws gate: ${relative(root, dir) || '.'}: ${laws} laws, All terms check. (${seconds} s, ${before})`);
