#!/usr/bin/env node
// Merge per-batch run.mjs results into one results.json. Refuses batches that
// were run against a different catalog, different twin sources or another HEAD.
import fs from 'node:fs';
import path from 'node:path';
import {canonical} from './evidence.mjs';
import {verifyStoredReferences,executionEvidence} from './execution.mjs';
const [out, ...inputs] = process.argv.slice(2);
if (!out || !inputs.length) throw new Error('usage: merge-results.mjs <out-dir> <batch-dir>...');
const batches = inputs.map(dir => ({dir, r: JSON.parse(fs.readFileSync(path.join(dir, 'results.json'), 'utf8'))}));
const first = batches[0].r;
const backendHashes = new Map();
for (const {dir, r} of batches) {
  await verifyStoredReferences({...r,rows:r.rows.filter(row=>['onshape','occt'].includes(row.kernel))},{out:path.join(out,'frozen-reference')});
  if (!/^[a-f0-9]{64}$/.test(r.code?.treeSha256 ?? '') || r.code.treeSha256 !== first.code?.treeSha256)
    throw new Error(`CODE_IDENTITY_MISMATCH: ${dir}`);
  for (const row of [...r.rows, ...(r.smoke ?? []), ...(r.liveReferences ?? [])]) {
    if (['onshape','occt'].includes(row.kernel)&&executionEvidence(row)?.status==='frozen') continue; // frozen external provenance stays on the row
    if (row.code?.treeSha256 !== r.code.treeSha256) throw new Error(`ROW_CODE_IDENTITY_MISMATCH: ${dir}/${row.kernel}/${row.zone}`);
    const hash = row.backend?.sourceHash;
    if (row.kernel === 'wonky-rust' && row.outcome !== 'not_run' && !/^[a-f0-9]{64}$/.test(hash ?? ''))
      throw new Error(`BACKEND_IDENTITY_MISSING: ${dir}/${row.zone}`);
    if (hash) {
      if (backendHashes.has(row.kernel) && backendHashes.get(row.kernel) !== hash) throw new Error(`BACKEND_IDENTITY_MISMATCH: ${dir}/${row.kernel}`);
      backendHashes.set(row.kernel, hash);
    }
  }
  if (r.zonesSha256 !== first.zonesSha256) throw new Error(`ZONES_SHA_MISMATCH: ${dir}`);
  if (JSON.stringify(r.sources) !== JSON.stringify(first.sources)) throw new Error(`SOURCES_MISMATCH: ${dir}`);
  if (r.code?.head !== first.code?.head) throw new Error(`HEAD_MISMATCH: ${dir}`);
  if (!r.finishedAt) throw new Error(`BATCH_UNFINISHED: ${dir}`);
  if (r.closedForms?.ok !== true) throw new Error(`CLOSED_FORMS_NOT_OK: ${dir}`);
}
const merged = {
  schema: first.schema, zonesSha256: first.zonesSha256, sources: first.sources, code: first.code,
  closedForms: first.closedForms,
  rows: batches.flatMap(b => b.r.rows), smoke: batches.flatMap(b => b.r.smoke),
  liveReferences: batches.flatMap(b => b.r.liveReferences ?? []),
  batches: batches.map(({dir, r}) => ({dir, startedAt: r.startedAt, finishedAt: r.finishedAt, rows: r.rows.length, smoke: r.smoke.length})),
  startedAt: batches.map(b => b.r.startedAt).sort()[0], finishedAt: batches.map(b => b.r.finishedAt).sort().at(-1),
};
const keys = new Map();
merged.rows=merged.rows.filter(row=>{
  const key=`${row.kernel}/${row.zone}/${row.variant}`,prior=keys.get(key);
  if(prior) {
    if((['onshape','occt'].includes(row.kernel)&&executionEvidence(row)?.status==='frozen')&&canonical(prior)===canonical(row))return false;
    throw new Error(`DUPLICATE_OBSERVATION: ${key}`);
  }
  keys.set(key,row);return true;
});
fs.mkdirSync(out, {recursive: true});
fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(merged, null, 2) + '\n');
console.log(`merged ${merged.rows.length} rows, ${merged.smoke.length} smoke from ${batches.length} batches`);
