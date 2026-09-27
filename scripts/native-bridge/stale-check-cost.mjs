#!/usr/bin/env node
// Upper bound for the native loader's stale check (docs/native-bridge/proposal-resident.md, section 11):
// read and sha256 every production kernel .bend file (kernel/proto and kernel/service excluded), plus
// bend.lock.json and a stat record of the compiler binary. The real check hashes only the api import
// closure, a subset. Writes out/native-bridge/resident/stale-check.json with the load average.
//   node scripts/native-bridge/stale-check-cost.mjs
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { loadavg } from 'node:os';
import { join } from 'node:path';

const root = new URL('../../', import.meta.url).pathname;
const files = [];
(function walk(dir) {
  for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) { if (!['kernel/proto', 'kernel/service'].includes(path)) walk(path); }
    else if (path.endsWith('.bend')) files.push(path);
  }
})('kernel');
files.sort();
const loadBefore = loadavg();
const runs = [];
for (let r = 0; r < 7; r++) {
  const t = performance.now(), h = createHash('sha256');
  for (const f of files) h.update(f).update(createHash('sha256').update(readFileSync(join(root, f))).digest());
  h.update(readFileSync(join(root, 'bend.lock.json')));
  const s = statSync(join(root, '.tools/bend-2.0.25/bin/bend'));
  h.update(`${s.size}:${s.mtimeMs}:${s.ino}`).digest('hex');
  runs.push(performance.now() - t);
}
const sorted = [...runs].sort((a, b) => a - b);
const result = { schema: 'wonky-stale-check-cost/1', files: files.length,
  bytes: files.reduce((sum, f) => sum + statSync(join(root, f)).size, 0),
  firstMs: runs[0], medianMs: sorted[3], minMs: sorted[0], maxMs: sorted.at(-1), loadBefore, loadAfter: loadavg(),
  at: new Date().toISOString() };
mkdirSync(join(root, 'out/native-bridge/resident'), { recursive: true });
writeFileSync(join(root, 'out/native-bridge/resident/stale-check.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result));
