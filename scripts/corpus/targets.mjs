// Build the ordered run list for the corpus runner.
//
// Population and dedup come from the corpus inventory scanners
// (scripts/lang/scan-fs.mjs, scripts/lang/scan-py.mjs; see
// docs/language/corpus.md). Those scanners are re-run into tmp/corpus/facts so
// that the run list matches the corpus as it is on disk now.
//
//   FeatureScript modeling file = role 'feature' or 'library'
//   build123d modeling file     = role 'b3d-model'
//   unique                      = SHA-256 of file bytes (first path in sorted order is the copy we run)
//   family                      = union-find over Jaccard >= 0.6 of token 5-shingles
//   representative              = most recently modified member of the family (inventory rule)
//
// Run units: one per (file, feature). A FeatureScript file with several
// exported features gets one unit per feature, because the production CLI
// builds one feature per invocation (--feature). Python files are one unit.
//
// Order: family representatives first (FS, then Python), then the remaining
// unique files (FS, then Python). Within a group: smaller files first so the
// cheap signal lands early.
//
// Usage: node scripts/corpus/targets.mjs [--rescan]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { REPO, CORPUS_ROOT, FACTS_DIR, OUT_DIR } from './lib.mjs';

const rescan = process.argv.includes('--rescan');
mkdirSync(FACTS_DIR, { recursive: true });
const fsFacts = join(FACTS_DIR, 'fs-facts.json'), pyFacts = join(FACTS_DIR, 'py-facts.json');
if (rescan || !existsSync(fsFacts)) spawnSync(process.execPath, [join(REPO, 'scripts/lang/scan-fs.mjs'), fsFacts], { stdio: 'inherit', cwd: REPO });
if (rescan || !existsSync(pyFacts)) spawnSync(process.execPath, [join(REPO, 'scripts/lang/scan-py.mjs'), pyFacts], { stdio: 'inherit', cwd: REPO });

const fs = JSON.parse(readFileSync(fsFacts, 'utf8'));
const py = JSON.parse(readFileSync(pyFacts, 'utf8'));

// Heavy files: the viewer audit reports r10b at ~56 s before failing on the JS
// target, and Boolean-heavy multi-part studios take minutes. They start with a
// longer budget instead of burning a 180 s attempt first.
const HEAVY = [
  /single-step-r10\//, /single-step-r20\//, /r10b/i, /cad-project-043\/fsocct\/cases\//,
  /cad-project-014\/.*(interface|geometry-body|drive-purpose|native-source)/,
  /cad-project-012/i, /lego-beam/i,
];
const timeoutFor = (row) => (HEAVY.some(r => r.test(row.path)) || row.lines > 1500 ? 480 : 180);

function population(rows, frontend) {
  const byFamily = new Map();
  for (const r of rows) {
    const c = byFamily.get(r.family);
    if (!c || r.mtime > c.mtime || (r.mtime === c.mtime && r.path < c.path)) byFamily.set(r.family, r);
  }
  const repSha = new Set([...byFamily.values()].map(r => r.sha));
  // One runnable copy per SHA: the representative's own path if the SHA is a
  // representative, otherwise the first path in sorted order.
  const seen = new Map();
  for (const rep of byFamily.values()) seen.set(rep.sha, rep);
  for (const r of [...rows].sort((a, b) => a.path.localeCompare(b.path))) if (!seen.has(r.sha)) seen.set(r.sha, r);
  const uniques = [...seen.values()];
  const duplicates = rows.filter(r => seen.get(r.sha).path !== r.path).map(r => ({ path: r.path, sameAs: seen.get(r.sha).path }));
  const familySize = new Map();
  for (const r of rows) familySize.set(r.family, (familySize.get(r.family) ?? 0) + 1);
  return {
    frontend, files: rows.length, unique: uniques.length, families: byFamily.size,
    uniques: uniques.map(r => ({
      frontend, path: r.path, project: r.project, family: r.family, sha: r.sha, lines: r.lines, mtime: r.mtime,
      representative: repSha.has(r.sha) && byFamily.get(r.family).sha === r.sha,
      features: frontend === 'fs' ? (r.features ?? []) : [],
      generated: r.generated ?? null,
      imports: frontend === 'py' ? r.imports : r.imports?.paths,
      duplicatePaths: rows.filter(x => x.sha === r.sha && x.path !== r.path).map(x => x.path),
      timeoutS: timeoutFor(r),
    })),
    duplicates,
  };
}

const fsPop = population(fs.files.filter(r => r.role === 'feature' || r.role === 'library'), 'fs');
const pyPop = population(py.files.filter(r => r.role === 'b3d-model'), 'py');

const units = [];
const push = (file, phase) => {
  if (file.frontend === 'fs' && file.features.length > 1) {
    for (const feature of file.features) units.push({ key: `${file.path}#${feature}`, phase, feature, ...file });
  } else {
    // One declared feature: pass it explicitly (a file can also export helper
    // functions, and the CLI then refuses to pick). Zero: let the CLI pick.
    units.push({ key: file.path, phase, ...file, feature: file.features[0] ?? null });
  }
};
const bySize = (a, b) => a.lines - b.lines || a.path.localeCompare(b.path);
for (const f of fsPop.uniques.filter(f => f.representative).sort(bySize)) push(f, 1);
for (const f of pyPop.uniques.filter(f => f.representative).sort(bySize)) push(f, 1);
for (const f of fsPop.uniques.filter(f => !f.representative).sort(bySize)) push(f, 2);
for (const f of pyPop.uniques.filter(f => !f.representative).sort(bySize)) push(f, 2);
// Anchor (not part of the corpus population, excluded from corpus totals):
// the frozen acceptance fixture with its frozen module manifest, so the run
// shows the known r10b state next to the corpus copies that lack snapshots.
units.push({ key: 'ANCHOR:fixtures/r10b/r10b.fs#singleStepR10b', phase: 0, anchor: true, frontend: 'fs', abs: join(REPO, 'fixtures/r10b/r10b.fs'),
  path: 'fixtures/r10b/r10b.fs', project: '(wonky fixture)', family: 'anchor-r10b', sha: null, lines: 0, representative: false,
  feature: 'singleStepR10b', features: ['singleStepR10b'], timeoutS: 480 });
units.forEach((u, i) => { u.order = i; delete u.duplicatePaths; });

mkdirSync(OUT_DIR, { recursive: true });
const inventory = JSON.parse(readFileSync(join(REPO, 'out/lang/corpus.json'), 'utf8'));
const result = {
  schema: 'wonky-corpus-targets/1', generatedAt: new Date().toISOString(), corpusRoot: CORPUS_ROOT,
  scannedAt: { fs: fs.scannedAt, py: py.scannedAt },
  inventory: {
    source: 'out/lang/corpus.json',
    fs: inventory.featureScript.population.modelingFiles, py: inventory.python.population.b3dModel,
  },
  now: {
    fs: { files: fsPop.files, unique: fsPop.unique, families: fsPop.families },
    py: { files: pyPop.files, unique: pyPop.unique, families: pyPop.families },
  },
  unitCounts: {
    total: units.length, phase1: units.filter(u => u.phase === 1).length, phase2: units.filter(u => u.phase === 2).length,
    fs: units.filter(u => u.frontend === 'fs').length, py: units.filter(u => u.frontend === 'py').length,
  },
  files: [...fsPop.uniques, ...pyPop.uniques],
  duplicates: [...fsPop.duplicates, ...pyPop.duplicates],
  units,
};
writeFileSync(join(OUT_DIR, 'targets.json'), JSON.stringify(result, null, 1));
console.log(JSON.stringify({ inventory: result.inventory, now: result.now, unitCounts: result.unitCounts }));
