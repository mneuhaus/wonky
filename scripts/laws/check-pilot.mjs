#!/usr/bin/env node
// Gate for the pilot law batch in kernel/laws/pilot/. Fails (exit 1) on any
// open, false, missing, extra or drifted law.
//
//   node scripts/laws/check-pilot.mjs [--per-law] [--timeout SECONDS] [--dir DIR]
//
// --dir checks a copy of the pilot at the same depth (used to self-test the
// pin: a weakened copy must be rejected before the checker runs).
//
// 1. Statement pin: kernel/laws/pilot/LAWS.bend states exactly the laws of
//    scripts/laws/pilot-batch.json (same names, same text up to whitespace),
//    and its spec helpers (the LAWS.bend header, topology-spec.bend,
//    arith-spec.bend) have the pinned SHA-256. A weakened or dropped law, or an
//    edited spec helper, fails here before the checker runs.
// 2. Pairing: every law has exactly one `def Laws.<name>` in PROOF.bend and
//    PROOF.bend defines no Laws.* that is not a law.
// 3. Hygiene + verdict: scripts/laws/gate.mjs kernel/laws/pilot (no @unsafe, no
//    ?hole, no foreign import; `bend PROOF.bend --check-only` must end with
//    exactly "All terms check."). Its wall time and `uptime` land in
//    out/laws/gate-timings.jsonl.
// 4. --per-law (optional, for docs/laws/pilot.md): checks every law alone in a
//    copy under tmp/laws/pilot-per-law/ and records wall time, proof lines and
//    the lemma modules the proof uses in out/laws/pilot-per-law.json. Runs one
//    checker at a time.
import { spawnSync, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { splitLaws, splitProof, writeSubset } from './pilot-split.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const dirAt = args.indexOf('--dir');
const pilot = dirAt >= 0 ? resolve(args[dirAt + 1]) : join(root, 'kernel/laws/pilot');
const perLaw = args.includes('--per-law');
const timeoutAt = args.indexOf('--timeout');
const timeout = timeoutAt >= 0 ? Number(args[timeoutAt + 1]) : 300;
const fail = message => { console.error(`check-pilot: ${message}`); process.exit(1); };
const norm = text => text.replace(/\s+/g, ' ').trim();
const sha256 = data => createHash('sha256').update(data).digest('hex');

// 1. Statement pin
const batch = JSON.parse(readFileSync(join(root, 'scripts/laws/pilot-batch.json'), 'utf8'));
const lawsText = readFileSync(join(pilot, 'LAWS.bend'), 'utf8');
const proofText = readFileSync(join(pilot, 'PROOF.bend'), 'utf8');
const { header: lawsHeader, laws } = splitLaws(lawsText);
const { proofs } = splitProof(proofText);
const problems = [];
const expected = new Map(batch.laws.map(l => [l.name, l.statement]));
for (const [name, statement] of expected) {
  if (!laws.has(name)) problems.push(`law ${name} is missing from LAWS.bend`);
  else if (norm(laws.get(name)) !== norm(statement)) problems.push(`law ${name} differs from the pinned statement:\n    pinned: ${norm(statement)}\n    found:  ${norm(laws.get(name))}`);
}
for (const name of laws.keys()) if (!expected.has(name)) problems.push(`law ${name} is not part of the pilot batch`);
if ((lawsText.match(/^law /gm) ?? []).length !== laws.size) problems.push('LAWS.bend has law blocks the splitter could not parse');
if (sha256(lawsHeader) !== batch.lawsHeaderSha256) problems.push('LAWS.bend spec helpers (header before the first law) changed');
for (const [file, hash] of Object.entries(batch.specFiles)) {
  if (sha256(readFileSync(join(root, file))) !== hash) problems.push(`spec file ${file} changed`);
}
// 2. Pairing
const defCounts = new Map();
for (const m of proofText.matchAll(/^def Laws\.(\w+)\(/gm)) defCounts.set(m[1], (defCounts.get(m[1]) ?? 0) + 1);
for (const name of laws.keys()) {
  const n = defCounts.get(name) ?? 0;
  if (n !== 1) problems.push(`law ${name} has ${n} proof defs in PROOF.bend (open claim if 0)`);
}
for (const name of defCounts.keys()) if (!laws.has(name)) problems.push(`PROOF.bend defines Laws.${name}, which is not a law`);
if (problems.length) fail(`pilot statements/pairing:\n  ${problems.join('\n  ')}`);
console.log(`check-pilot: ${laws.size} laws match scripts/laws/pilot-batch.json, each with one proof def`);

// 3. Hygiene + verdict via the shared gate
const gate = spawnSync(process.execPath, [join(root, 'scripts/laws/gate.mjs'), pilot, '--timeout', String(timeout)], { stdio: 'inherit' });
if (gate.status !== 0) fail('gate rejected kernel/laws/pilot');

// 4. Per-law timings and sizes
if (perLaw) {
  const { version } = JSON.parse(readFileSync(join(root, 'bend.lock.json'), 'utf8'));
  const bend = join(root, '.tools', `bend-${version}`, 'bin', 'bend');
  const work = join(root, 'tmp/laws/pilot-per-law');
  rmSync(work, { recursive: true, force: true });
  const copyBend = (from, to) => {
    mkdirSync(to, { recursive: true });
    for (const name of readdirSync(from)) if (name.endsWith('.bend')) cpSync(join(from, name), join(to, name));
  };
  copyBend(join(root, 'kernel'), join(work, 'kernel'));
  copyBend(join(root, 'kernel/ports'), join(work, 'kernel/ports'));
  cpSync(pilot, join(work, 'kernel/laws/pilot'), { recursive: true });
  cpSync(join(root, 'kernel/laws/spike'), join(work, 'kernel/laws/spike'), { recursive: true });
  const aliases = [...proofText.matchAll(/^import (\S+) as (\w+)$/gm)].filter(m => /lemmas\.bend$/.test(m[1]));
  const uptime = () => execFileSync('uptime', { encoding: 'utf8' }).trim();
  const rows = [];
  for (const name of laws.keys()) {
    const dir = join(work, 'kernel/laws/one');
    rmSync(dir, { recursive: true, force: true });
    writeSubset(join(work, 'kernel/laws/pilot'), dir, [name]);
    const body = proofs.get(name);
    const lemmas = aliases.filter(([, , alias]) => new RegExp(`\\b${alias}\\.`).test(body)).map(([, path]) => path.replace(/^\.\.\/spike\//, ''));
    const before = uptime(), start = process.hrtime.bigint();
    const run = spawnSync(bend, ['PROOF.bend', '--check-only'], { cwd: dir, encoding: 'utf8', timeout: timeout * 1000, maxBuffer: 64 << 20, env: { ...process.env, BEND_NO_TELEMETRY: '1' } });
    const seconds = Number((Number(process.hrtime.bigint() - start) / 1e9).toFixed(2));
    const output = `${run.stdout ?? ''}${run.stderr ?? ''}`;
    const ok = run.status === 0 && output.trim().split('\n').at(-1) === 'All terms check.';
    rows.push({ name, ok, seconds, proofLines: body.split('\n').length, lemmas, uptime: before });
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${name.padEnd(38)} ${String(seconds).padStart(6)} s  ${String(body.split('\n').length).padStart(3)} lines  ${lemmas.join(', ')}`);
  }
  mkdirSync(join(root, 'out/laws'), { recursive: true });
  writeFileSync(join(root, 'out/laws/pilot-per-law.json'), JSON.stringify(rows, null, 2) + '\n');
  if (rows.some(r => !r.ok)) fail('a law failed when checked alone');
}
