// Corpus failure analysis, cluster boolean-capability: replace the records of
// a partial re-run (boolean-batch.mjs --only ... --out part.jsonl) in a full
// probe file, by unit key, keeping the full file's order. Every replaced
// record is marked with `rerunOf` (the part file) so the merge stays visible.
//
// Usage: node scripts/corpus/boolean-merge.mjs <full.jsonl> <part.jsonl>...
import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';

const [full, ...parts] = process.argv.slice(2);
if (!full || !parts.length) throw new Error('usage: boolean-merge.mjs <full.jsonl> <part.jsonl>...');
const read = f => readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
const rows = read(full);
const index = new Map(rows.map((r, i) => [r.key, i]));
let replaced = 0;
for (const part of parts) for (const r of read(part)) {
  const i = index.get(r.key);
  if (i === undefined) throw new Error(`${r.key} (from ${part}) is not in ${full}`);
  rows[i] = { ...r, rerunOf: basename(part) };
  replaced++;
}
writeFileSync(full, rows.map(r => JSON.stringify(r)).join('\n') + '\n');
console.log(`replaced ${replaced} of ${rows.length} records in ${full}`);
