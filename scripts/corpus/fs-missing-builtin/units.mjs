// Lists every unit of every file in the fs-missing-builtin cluster (latest
// corpus-run/1 record per unit) into tmp/corpus/fs-missing-builtin/cluster-files.json.
// Usage: node scripts/corpus/fs-missing-builtin/units.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { RUNS, TMP_DIR } from '../lib.mjs';

export const DATA = join(TMP_DIR, 'fs-missing-builtin');
const latest = new Map();
for (const line of readFileSync(RUNS, 'utf8').split('\n')) {
  if (!line.trim()) continue;
  const r = JSON.parse(line);
  if (r.runner === 'corpus-run/1') latest.set(r.key, r);
}
const all = [...latest.values()];
const inCluster = r => /is not defined or not implemented by this prototype/.test(r.message ?? '');
const paths = [...new Set(all.filter(inCluster).map(r => r.path))];
const files = paths.map(path => {
  const rs = all.filter(r => r.path === path), first = rs.find(inCluster);
  return { path, family: first.family, representative: first.representative, sha: first.sha, lines: first.lines,
    units: rs.map(r => ({ key: r.key, feature: r.feature, status: r.status, kind: r.kind, message: r.message, line: r.location?.line,
      col: r.location?.column, completed: r.completedOperations, inCluster: inCluster(r), sourceLine: r.sourceLine })) };
});
mkdirSync(DATA, { recursive: true });
writeFileSync(join(DATA, 'cluster-files.json'), JSON.stringify(files, null, 1));
console.log(`${files.length} files, ${files.reduce((s, f) => s + f.units.length, 0)} units, ${files.reduce((s, f) => s + f.units.filter(u => u.inCluster).length, 0)} in the cluster`);
