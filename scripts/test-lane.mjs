#!/usr/bin/env node
// Test lanes: run a subset of test/*.test.mjs, one node --test process per file.
//
//   node scripts/test-lane.mjs fast [--fail-fast]   every file whose recorded time is under the slow threshold
//   node scripts/test-lane.mjs slow                 only the slow files (end-to-end, OCCT, corpus)
//   node scripts/test-lane.mjs changed [--fail-fast] test files that mention a file changed against HEAD
//   node scripts/test-lane.mjs full                 every file (same set as npm test, without check:bend)
//   node scripts/test-lane.mjs files a.test.mjs b.test.mjs
//   node scripts/test-lane.mjs full --record        also writes test/lanes.json with per-file wall times
//
// --fail-fast stops at the first failing file (development loops only; integration and
// verification want every failure at once). Times come from test/lanes.json; a file without
// a record counts as fast, so new tests run in the fast lane until the next --record.
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const lanesFile = join(root, 'test', 'lanes.json');
const SLOW_SECONDS = 20;

const args = process.argv.slice(2);
const lane = args[0] ?? 'fast';
const failFast = args.includes('--fail-fast');
const record = args.includes('--record');
const jobsArg = args.find(a => a.startsWith('--jobs='));
const jobs = jobsArg ? Number(jobsArg.slice(7)) : Math.max(1, Math.min(8, availableParallelism() - 2));

const allFiles = readdirSync(join(root, 'test')).filter(f => f.endsWith('.test.mjs')).sort();
const lanes = existsSync(lanesFile) ? JSON.parse(readFileSync(lanesFile, 'utf8')) : { seconds: {} };
const seconds = file => lanes.seconds?.[file] ?? 0;

function changedFiles() {
  const out = execFileSync('git', ['status', '--porcelain', '-uall'], { cwd: root, encoding: 'utf8' });
  return out.split('\n').filter(Boolean).map(line => line.slice(3).trim()).filter(p => !p.startsWith('tmp/') && !p.startsWith('out/'));
}

function select() {
  if (lane === 'full') return allFiles;
  if (lane === 'fast') return allFiles.filter(f => seconds(f) < SLOW_SECONDS);
  if (lane === 'slow') return allFiles.filter(f => seconds(f) >= SLOW_SECONDS);
  if (lane === 'files') return args.slice(1).filter(a => !a.startsWith('--')).map(a => basename(a));
  if (lane === 'changed') {
    const changed = changedFiles();
    const direct = new Set(changed.filter(p => p.startsWith('test/') && p.endsWith('.test.mjs')).map(p => basename(p)));
    const names = changed.filter(p => !p.startsWith('test/')).map(p => basename(p));
    for (const file of allFiles) {
      const text = readFileSync(join(root, 'test', file), 'utf8');
      if (names.some(name => text.includes(name))) direct.add(file);
    }
    return allFiles.filter(f => direct.has(f));
  }
  throw new Error(`unknown lane ${lane} (fast, slow, changed, full, files)`);
}

const files = select();
if (!files.length) { console.log(`lane ${lane}: no test files`); process.exit(0); }
// Longest first, so the slowest files do not start last.
files.sort((a, b) => seconds(b) - seconds(a));
console.log(`lane ${lane}: ${files.length} files, ${jobs} at a time${failFast ? ', fail-fast' : ''}`);

const results = [];
const running = new Set();
let next = 0, stopped = false;
const started = Date.now();

function runFile(file) {
  return new Promise(resolve => {
    const t0 = Date.now();
    const child = spawn(process.execPath, ['--test', join('test', file)], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    running.add(child);
    let output = '';
    child.stdout.on('data', d => { output += d; });
    child.stderr.on('data', d => { output += d; });
    child.on('close', code => {
      running.delete(child);
      const result = { file, ok: code === 0, seconds: (Date.now() - t0) / 1000, killed: stopped && code !== 0, output };
      results.push(result);
      if (!result.killed) console.log(`${result.ok ? 'ok  ' : 'FAIL'} ${result.seconds.toFixed(1).padStart(6)} s  ${file}`);
      if (!result.ok && !result.killed) {
        process.stdout.write(output.split('\n').filter(l => /^not ok|error:|expected|actual|Error/.test(l)).slice(0, 12).map(l => `      ${l}`).join('\n') + '\n');
        if (failFast && !stopped) { stopped = true; for (const other of running) other.kill('SIGTERM'); }
      }
      resolve();
    });
  });
}

async function worker() {
  while (!stopped && next < files.length) await runFile(files[next++]);
}
await Promise.all(Array.from({ length: Math.min(jobs, files.length) }, worker));

const failed = results.filter(r => !r.ok && !r.killed);
const wall = (Date.now() - started) / 1000;
console.log(`\nlane ${lane}: ${results.filter(r => r.ok).length} ok, ${failed.length} failed${stopped ? `, stopped after the first failure (${files.length - results.length} not started)` : ''}, wall ${wall.toFixed(0)} s`);

if (record) {
  const updated = { threshold_s: SLOW_SECONDS, note: 'wall seconds per test file, warm Bend cache; regenerate with node scripts/test-lane.mjs full --record', seconds: { ...lanes.seconds } };
  for (const r of results) if (!r.killed) updated.seconds[r.file] = Math.round(r.seconds * 10) / 10;
  writeFileSync(lanesFile, `${JSON.stringify(updated, null, 1)}\n`);
  console.log(`recorded ${results.length} file times in test/lanes.json`);
}
process.exit(failed.length ? 1 : 0);
