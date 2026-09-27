#!/usr/bin/env node
// Mutation check for the proof spike: does kernel/laws/spike/PROOF.bend stop
// checking when the kernel code it talks about drifts? Each mutant copies the
// kernel modules the spike imports plus kernel/laws/spike into
// tmp/laws/mutants/<name>/ (same relative layout, so imports resolve), applies
// ONE textual edit, and runs the pinned checker. Production files are only read.
//
// Usage: node scripts/laws/spike-mutants.mjs [name ...]
// Writes out/laws/spike-mutants.json.
import { spawnSync, execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const { version } = JSON.parse(readFileSync(join(root, 'bend.lock.json'), 'utf8'));
const bend = join(root, '.tools', `bend-${version}`, 'bin', 'bend');
const kernelFiles = ['geometry.bend', 'topology.bend', 'real.bend', 'precise.bend', 'robust-predicates.bend'];

// [name, file (relative to kernel/), from, to, what the mutation models]
const mutants = [
  ['control', 'topology.bend', null, null, 'unmodified copy: must still check (validates the harness)'],
  ['reverse-no-flip', 'topology.bend', 'reverse_uses(tail, flip(use) <> acc)', 'reverse_uses(tail, use <> acc)',
    'bottom loop reversed without flipping coedge orientation'],
  ['side-wrong-vertical', 'topology.bend', 'Use{(2 * n + next(i, n) : U32), True{}}', 'Use{(2 * n + i : U32), True{}}',
    'side face uses the wrong vertical edge'],
  ['next-off-by-one', 'topology.bend', 'U32.is_eq((i + 1 : U32), n)', 'U32.is_eq(i, n)',
    'ring successor wraps one step late'],
  ['transform-reverses-loops', 'topology.bend', 'G.rotate(x, rotation), boundary}', 'G.rotate(x, rotation), reverse_uses(boundary, Nil{})}',
    'rigid transform accidentally reverses every face loop'],
  ['top-face-shares-bottom-ring', 'topology.bend', 'top = {Face{G.add(first, delta), normal, ref, ring_uses(count, n, 0)} : Face}',
    'top = {Face{G.add(first, delta), normal, ref, ring_uses(count, 0, 0)} : Face}', 'top face reuses the bottom ring edges'],
  ['mag-cmp-finish-swapped', 'robust-predicates.bend', '      U32.cmp(a, b)\n    case _:\n      high', '      U32.cmp(b, a)\n    case _:\n      high',
    'digit comparison tie-break compares the wrong way round'],
  ['sub-drops-negation', 'robust-predicates.bend', 'def sub(a: Big, b: Big) -> Big:\n  add(a, neg(b))', 'def sub(a: Big, b: Big) -> Big:\n  add(a, b)',
    'exact subtraction forgets to negate'],
  ['make-keeps-negative-zero', 'robust-predicates.bend', 'Big{Bool.and(negative, Bool.not(empty(digits))), digits}', 'Big{negative, digits}',
    'normalization keeps a negative sign on zero'],
  ['mag-add-carry-shift-11', 'robust-predicates.bend', 'digit(U32.and(sum, 4095), mag_add(at, bt, U32.shrn(sum, 12n)))', 'digit(U32.and(sum, 4095), mag_add(at, bt, U32.shrn(sum, 11n)))',
    'multi-limb adder carries with the wrong shift'],
  ['mag-add-drops-carry-in', 'robust-predicates.bend', '+sum = (ah + bh + carry : U32)', '+sum = (ah + bh : U32)',
    'multi-limb adder ignores the incoming carry'],
  ['mag-add-mask-4094', 'robust-predicates.bend', 'digit(U32.and(sum, 4095), mag_add(at, Nil{}, U32.shrn(sum, 12n)))', 'digit(U32.and(sum, 4094), mag_add(at, Nil{}, U32.shrn(sum, 12n)))',
    'one-sided limb loses its lowest bit'],
  ['codec-bool-swapped', 'laws/spike/wire/wire.bend', '    case 0:\n      (False{}, c)\n    case 1:\n      (True{}, c)', '    case 0:\n      (True{}, c)\n    case 1:\n      (False{}, c)',
    'generated decoder maps Bool words the wrong way (codec drift)'],
  ['codec-ignores-trailing', 'laws/spike/wire/wire.bend', '    case True{}:\n      empty_words(words)', '    case True{}:\n      True{}',
    'generated decoder accepts trailing words'],
];

const wanted = new Set(process.argv.slice(2));
const uptime = () => execFileSync('uptime', { encoding: 'utf8' }).trim();
const results = [];
for (const [name, file, from, to, models] of mutants) {
  if (wanted.size && !wanted.has(name)) continue;
  const dir = join(root, 'tmp/laws/mutants', name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(dir, 'kernel/laws'), { recursive: true });
  for (const f of kernelFiles) cpSync(join(root, 'kernel', f), join(dir, 'kernel', f));
  cpSync(join(root, 'kernel/laws/spike'), join(dir, 'kernel/laws/spike'), { recursive: true });
  const target = join(dir, 'kernel', file);
  const source = readFileSync(target, 'utf8');
  if (from !== null) {
    const count = source.split(from).length - 1;
    if (count !== 1) throw new Error(`${name}: expected exactly one match in ${file}, found ${count}`);
    writeFileSync(target, source.replace(from, to));
  }
  const before = uptime(), start = process.hrtime.bigint();
  const run = spawnSync(bend, ['PROOF.bend', '--check-only'], {
    cwd: join(dir, 'kernel/laws/spike'), encoding: 'utf8', timeout: 600_000,
    env: { ...process.env, BEND_NO_TELEMETRY: '1' },
  });
  const seconds = Number(process.hrtime.bigint() - start) / 1e9;
  const output = `${run.stdout ?? ''}${run.stderr ?? ''}`;
  const location = /Location: (\S+)/.exec(output)?.[1] ?? null;
  const record = { name, file: `kernel/${file}`, models, caught: run.status !== 0, location,
    firstError: output.split('\n').slice(0, 4).join('\n').slice(0, 600), seconds: Number(seconds.toFixed(2)), uptime: before };
  results.push(record);
  const verdict = from === null ? (record.caught ? 'BROKEN ' : 'PASSES ') : (record.caught ? 'CAUGHT ' : 'MISSED ');
  console.log(`${verdict} ${name.padEnd(28)} ${String(location).padEnd(48)} ${record.seconds}s`);
}
mkdirSync(join(root, 'out/laws'), { recursive: true });
writeFileSync(join(root, 'out/laws/spike-mutants.json'), JSON.stringify(results, null, 2) + '\n');
