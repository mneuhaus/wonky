// Scan every Python file in the corpus and write per-file facts.
// The AST work happens in scripts/lang/py-facts.py (stdlib `ast`, run via uv);
// this driver enumerates files, attaches identity (sha, lines, mtime) and
// clusters build123d files into near-duplicate design families.
// Usage: node scripts/lang/scan-py.mjs [out=tmp/lang/py-facts.json]
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { listCorpus, clusterFamilies, CORPUS_ROOT } from './corpus-files.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..');
const outPath = process.argv[2] ?? join(repo, 'tmp/lang/py-facts.json');
const t0 = performance.now();
const files = listCorpus(['.py']);

const run = spawnSync('uv', ['run', '--no-project', '--offline', 'python', join(here, 'py-facts.py'), join(repo, 'fixtures/lang/b3d-vocab.json')], {
  input: JSON.stringify(files.map(f => ({ path: f.path, abs: f.abs }))),
  maxBuffer: 1 << 30, encoding: 'utf8',
});
if (run.status !== 0) throw new Error(`py-facts.py failed (${run.status}): ${run.stderr.slice(-4000)}`);
const facts = JSON.parse(run.stdout);
if (facts.length !== files.length) throw new Error(`py-facts.py returned ${facts.length} rows for ${files.length} files`);

const generatedKind = source => {
  const head = source.split('\n').slice(0, 12).join('\n');
  return /generated (by|from)|auto-?generated|do not edit/i.test(head) ? 'file' : null;
};
facts.forEach((row, i) => Object.assign(row, {
  project: files[i].project, sha: files[i].sha, lines: files[i].lines, mtime: files[i].mtime, generated: generatedKind(files[i].source),
}));

// Families only for build123d files (the modeling population of interest).
const b3dIdx = facts.map((r, i) => (r.usesB3d ? i : -1)).filter(i => i >= 0);
const tokensOf = f => f.source.replace(/#.*$/gm, '').split(/[^A-Za-z_]+/).filter(Boolean);
const family = clusterFamilies(b3dIdx.map(i => files[i]), tokensOf, 0.6);
b3dIdx.forEach((i, k) => { facts[i].family = `py${b3dIdx[family[k]]}`; });

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify({ root: CORPUS_ROOT, scannedAt: new Date().toISOString(), ms: Math.round(performance.now() - t0), files: facts }));
const roles = facts.reduce((m, r) => ({ ...m, [r.role ?? 'parse-error']: (m[r.role ?? 'parse-error'] ?? 0) + 1 }), {});
console.log(`py files ${facts.length}, b3d families ${new Set(b3dIdx.map(i => facts[i].family)).size}, roles ${JSON.stringify(roles)}, ${Math.round(performance.now() - t0)} ms`);
