#!/usr/bin/env node
// Build the viewer QA fixtures into tmp/viewer/fixtures/.
//
//   node scripts/viewer/qa/fixtures.mjs [--out tmp/viewer/fixtures] [--only a,b] [--force]
//
// Builds the example models used by the viewer spec (bracket, bored spacer,
// conical spacer, compare-before/after), the audit samples in
// scripts/viewer/audit-data/ (arc slot, cross bore, pocket plate) and every
// .fs file in scripts/viewer/qa/fixtures/. Each build runs `bin/wonky.mjs`
// under `nice`, one at a time, so the shared machine stays responsive.
// Existing outputs whose source did not change are kept unless --force.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
};
const out = resolve(root, option('--out', 'tmp/viewer/fixtures'));
const only = option('--only', '').split(',').filter(Boolean);
const force = args.includes('--force');

const examples = [
  ['bracket', 'examples/bracket.fs', []],
  ['bored-spacer', 'examples/bored-spacer.fs', []],
  ['conical-spacer', 'examples/conical-spacer.fs', []],
  ['compare-before', 'examples/compare-before.fs', []],
  ['compare-after', 'examples/compare-after.fs', []],
];
const directoryFixtures = directory => {
  const path = join(root, directory);
  if (!existsSync(path)) return [];
  return readdirSync(path)
    .filter(file => file.endsWith('.fs'))
    .sort()
    .map(file => [basename(file, '.fs'), join(directory, file), []]);
};
const fixtures = [
  ...examples,
  ...directoryFixtures('scripts/viewer/audit-data'),
  ...directoryFixtures('scripts/viewer/qa/fixtures'),
].filter(([name]) => !only.length || only.includes(name));

mkdirSync(out, { recursive: true });
const manifestPath = join(out, 'manifest.json');
const manifest = existsSync(manifestPath)
  ? JSON.parse(readFileSync(manifestPath, 'utf8'))
  : { schema: 'wonky.viewer-qa-fixtures/1', fixtures: {} };
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

let failed = 0;
for (const [name, source, extra] of fixtures) {
  const prefix = join(out, name);
  const sourceHash = sha256(readFileSync(join(root, source)));
  const previous = manifest.fixtures[name];
  if (!force && previous?.sourceSha256 === sourceHash && existsSync(prefix + '.brep.json')) {
    console.log(`kept    ${name}`);
    continue;
  }
  const started = Date.now();
  try {
    execFileSync('nice', [
      '-n', '10', process.execPath, 'bin/wonky.mjs', source,
      '--format', 'step', '--out', prefix, ...extra,
    ], { cwd: root, stdio: ['ignore', 'ignore', 'pipe'] });
    const bytes = readFileSync(prefix + '.brep.json');
    manifest.fixtures[name] = {
      source,
      sourceSha256: sourceHash,
      modelSha256: sha256(bytes),
      path: relative(root, prefix + '.brep.json'),
      seconds: (Date.now() - started) / 1000,
    };
    console.log(`built   ${name} (${manifest.fixtures[name].seconds.toFixed(1)} s)`);
  } catch (error) {
    failed++;
    const reason = String(error.stderr ?? error.message).trim().split('\n').at(-1);
    manifest.fixtures[name] = { source, sourceSha256: sourceHash, failed: reason };
    console.error(`FAILED  ${name}: ${reason}`);
  }
}
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
console.log(`fixtures in ${relative(root, out)}/`);
process.exitCode = failed ? 1 : 0;
