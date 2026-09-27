// Scan every FeatureScript file in the corpus and write per-file facts.
// Usage: node scripts/lang/scan-fs.mjs [out=tmp/lang/fs-facts.json]
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { listCorpus, clusterFamilies, CORPUS_ROOT } from './corpus-files.mjs';
import { parseFs, tokenize } from './fs-parse.mjs';
import { analyzeFs } from './fs-analyze.mjs';

const outPath = process.argv[2] ?? 'tmp/lang/fs-facts.json';
const t0 = performance.now();
const files = listCorpus(['.fs']);

// Pass 1: parse, collect user-defined top-level names corpus-wide so calls into
// document-imported modules are not mistaken for Onshape std functions.
const corpusUserNames = new Set();
for (const f of files) {
  try { f.ast = parseFs(f.source); } catch (e) { f.parseError = e.message; continue; }
  for (const d of f.ast.declarations) if (d.value?.kind === 'function') corpusUserNames.add(d.name);
}

const generatedKind = source => {
  const head = source.split('\n').slice(0, 12).join('\n');
  if (/generated (by|from)|auto-?generated|do not edit|recipe are generated/i.test(head)) return 'file';
  if (/GENERATED\b/.test(source)) return 'block';
  // Machine-emitted SSA without a marker: many ids of the form id + "g12".
  if ((source.match(/id\s*\+\s*"g\d+"/g) ?? []).length >= 10) return 'ssa';
  return null;
};

const facts = [];
for (const f of files) {
  const row = { path: f.path, project: f.project, sha: f.sha, lines: f.lines, mtime: f.mtime, generated: generatedKind(f.source) };
  if (f.parseError) {
    row.parseError = f.parseError;
    row.role = f.source.trimStart().startsWith('FeatureScript') ? 'unparsed' : 'fragment-splice';
  } else {
    try { Object.assign(row, analyzeFs(f.ast, f.source, { corpusUserNames })); }
    catch (e) { row.analysisError = e.stack; }
  }
  facts.push(row);
}

// Design families by near-duplicate clustering.
const tokensOf = f => {
  try { return tokenize(f.source).tokens.map(t => (t.kind === 'number' ? '#' : String(t.value))); }
  catch { return f.source.split(/\s+/); }
};
const family = clusterFamilies(files, tokensOf, 0.6);
facts.forEach((row, i) => { row.family = `fs${family[i]}`; });

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify({ root: CORPUS_ROOT, scannedAt: new Date().toISOString(), ms: Math.round(performance.now() - t0), files: facts }, null, 0));
const roles = facts.reduce((m, r) => ({ ...m, [r.role]: (m[r.role] ?? 0) + 1 }), {});
console.log(`fs files ${facts.length}, families ${new Set(family).size}, roles ${JSON.stringify(roles)}, errors ${facts.filter(r => r.analysisError).length}, ${Math.round(performance.now() - t0)} ms`);
