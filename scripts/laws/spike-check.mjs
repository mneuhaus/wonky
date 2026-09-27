#!/usr/bin/env node
// Runs the pinned Bend checker on one proof file and records wall time, exit
// status, the checker's output tail and `uptime` before/after (the machine is
// shared with other agents, so timings without load averages mean little).
//
// Usage: node scripts/laws/spike-check.mjs <file.bend> [label] [--timeout SECONDS]
// Appends one JSON line to out/laws/spike-timings.jsonl and prints it.
import { spawnSync, execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const { version } = JSON.parse(readFileSync(join(root, 'bend.lock.json'), 'utf8'));
const bend = join(root, '.tools', `bend-${version}`, 'bin', 'bend');
if (!existsSync(bend)) throw new Error('Run npm run setup to install the pinned Bend compiler.');

const args = process.argv.slice(2);
let timeout = 600;
const positional = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--timeout') timeout = Number(args[++i]);
  else positional.push(args[i]);
}
const [file, label = ''] = positional;
if (!file) throw new Error('usage: spike-check.mjs <file.bend> [label] [--timeout SECONDS]');
const target = resolve(file);
const uptime = () => execFileSync('uptime', { encoding: 'utf8' }).trim();

const before = uptime();
const start = process.hrtime.bigint();
const run = spawnSync(bend, [target, '--check-only'], {
  cwd: dirname(target), encoding: 'utf8', timeout: timeout * 1000, maxBuffer: 64 << 20,
  env: { ...process.env, BEND_NO_TELEMETRY: '1' },
});
const seconds = Number(process.hrtime.bigint() - start) / 1e9;
const output = `${run.stdout ?? ''}${run.stderr ?? ''}`;
const record = {
  at: new Date().toISOString(), file: relative(root, target), label,
  lines: readFileSync(target, 'utf8').split('\n').length,
  status: run.error ? `error: ${run.error.code ?? run.error.message}` : run.status,
  ok: run.status === 0 && output.includes('All terms check.'),
  seconds: Number(seconds.toFixed(2)), uptimeBefore: before, uptimeAfter: uptime(),
  outputTail: output.split('\n').slice(-40).join('\n'),
};
mkdirSync(join(root, 'out/laws'), { recursive: true });
appendFileSync(join(root, 'out/laws/spike-timings.jsonl'), JSON.stringify(record) + '\n');
console.log(output.split('\n').slice(-60).join('\n'));
console.log(JSON.stringify({ ...record, outputTail: undefined }));
process.exit(record.ok ? 0 : 1);
