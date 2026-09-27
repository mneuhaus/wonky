// Aggregate a corpus run into summary.json.
//
// Records, normalization and clusters come from clusters.mjs (latest record
// per unit wins; the anchor unit, the frozen r10b fixture, is reported
// separately and excluded from totals). A file is "blocked" by a cluster when
// at least one of its units fails in it; a family when at least one of its
// unique files is.
//
// Usage: node scripts/corpus/summarize.mjs [--label <name>]
//   without --label: out/corpus/runs.jsonl -> out/corpus/summary.json (baseline)
//   with --label:    out/corpus/bench/<name>/runs.jsonl -> .../summary.json
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runPaths } from './lib.mjs';
import { CLUSTERS, loadRecords } from './clusters.mjs';

const args = process.argv.slice(2);
const label = args.includes('--label') ? args[args.indexOf('--label') + 1] : null;
const paths = runPaths(label);
const META = paths.meta;
const { targets, latest, units, anchorUnit, recs } = loadRecords({ runs: paths.runs });
const reference = existsSync(join(paths.dir, 'reference.json')) ? JSON.parse(readFileSync(join(paths.dir, 'reference.json'), 'utf8')) : null;

// ------------------------------------------------------------ aggregate
const byFile = new Map();
for (const r of recs) { if (!byFile.has(r.path)) byFile.set(r.path, []); byFile.get(r.path).push(r); }
const fileInfo = new Map(targets.files.map(f => [f.path, f]));
const expectedUnits = new Map();
for (const u of units) expectedUnits.set(u.path, (expectedUnits.get(u.path) ?? 0) + 1);

const fileStatus = path => {
  const rs = byFile.get(path) ?? [];
  if (rs.length < expectedUnits.get(path)) return 'incomplete';
  if (rs.every(r => r.status === 'ok')) return 'ok';
  if (rs.filter(r => r.status !== 'ok').every(r => r.status === 'timeout')) return 'timeout';
  return 'failed';
};
const files = [...fileInfo.values()].filter(f => byFile.has(f.path));
const statusOf = new Map(files.map(f => [f.path, fileStatus(f.path)]));
const familiesRun = new Set(files.map(f => `${f.frontend}:${f.family}`));
const familiesOk = new Set(files.filter(f => statusOf.get(f.path) === 'ok').map(f => `${f.frontend}:${f.family}`));
const familiesPartial = new Set(files.filter(f => (byFile.get(f.path) ?? []).some(r => r.status === 'ok')).map(f => `${f.frontend}:${f.family}`));
const count = (arr, key) => arr.reduce((c, x) => ({ ...c, [key(x)]: (c[key(x)] ?? 0) + 1 }), {});

// Partition view: each failed file is assigned to the cluster holding most of
// its failing units (ties: order of CLUSTERS). Sums to the failed file count.
const primary = new Map();
const clusterOrder = Object.keys(CLUSTERS);
for (const [path, rs] of byFile) {
  const failing = rs.filter(r => r.status !== 'ok');
  if (!failing.length || statusOf.get(path) === 'ok') continue;
  const c = count(failing, r => r.cluster);
  primary.set(path, Object.entries(c).sort((a, b) => b[1] - a[1] || clusterOrder.indexOf(a[0]) - clusterOrder.indexOf(b[0]))[0][0]);
}
const clusterRows = Object.entries(CLUSTERS).map(([key, [title, frontend]]) => {
  const rs = recs.filter(r => r.cluster === key);
  const primaryPaths = [...primary].filter(([, c]) => c === key).map(([p]) => p);
  const fset = new Set(rs.map(r => r.path));
  const famset = new Set(rs.map(r => `${r.frontend}:${r.family}`));
  const fams = new Set(rs.filter(r => r.representative).map(r => `${r.frontend}:${r.family}`));
  const sig = Object.entries(count(rs, r => `${r.status} · ${r.kind} · ${r.failingOperation?.name ?? '-'} · ${r.rootPattern}`)).sort((a, b) => b[1] - a[1]);
  const byName = key === 'fs-missing-builtin' ? count(rs, r => (r.rootMessage.match(/^'(\w+)'/) ?? [])[1])
    : key === 'py-imports' ? count(rs, r => `${r.kind === 'python-import-local' ? 'local' : 'installed'}:${r.module}`)
    : key === 'py-api-surface' ? count(rs, r => (r.rootMessage.match(/build123d\.(\w+)|name '(\w+)'/) ?? []).slice(1).find(Boolean))
    : key === 'fs-module-import' ? count(rs, r => {
      const ns = (r.rootMessage.match(/module '(\w+)'/) ?? [])[1];
      const use = ns ? (r.sourceLine ?? '').match(new RegExp(`${ns}::(\\w+)`)) : null;
      const what = use ? (use[1] === 'build' ? 'Part Studio bodies (NS::build)' : 'Feature Studio code (NS::function)') : 'unknown use';
      const where = /version local/.test(r.rootMessage) ? 'local path' : /<id>\/<id>\/<id>/.test(r.rootPattern) ? 'other document' : 'same document';
      return `${what}, ${where}`;
    })
    : null;
  const examples = [];
  for (const r of rs) {
    if (examples.length >= 4) break;
    if (examples.some(e => e.startsWith(r.path))) continue;
    const loc = r.location?.line ? `${r.path}:${r.location.line}${r.location.column ? ':' + r.location.column : ''}` : r.path;
    const chain = r.failingOperation?.callChain?.length ? ` [${r.failingOperation.name} via ${r.failingOperation.callChain.join(' > ')}]` : '';
    examples.push(`${loc}${r.feature ? ` (#${r.feature})` : ''}: ${(r.rootMessage ?? '').slice(0, 160)}${chain}`);
  }
  return {
    key, title, frontend, units: rs.length, files: fset.size, families: famset.size, representativeFamilies: fams.size,
    primaryFiles: primaryPaths.length, primaryFamilies: new Set(primaryPaths.map(p => `${fileInfo.get(p).frontend}:${fileInfo.get(p).family}`)).size,
    statuses: count(rs, r => r.status), kinds: count(rs, r => r.kind),
    signatures: sig.slice(0, 6).map(([s, n]) => ({ signature: s, units: n })), names: byName, examples,
  };
}).filter(c => c.units > 0).sort((a, b) => b.files - a.files || b.units - a.units);

// ------------------------------------------------------------ run metadata
const metaRows = existsSync(META) ? readFileSync(META, 'utf8').trim().split('\n').map(l => JSON.parse(l)) : [];
const walls = recs.map(r => r.wallMs).filter(Number.isFinite).sort((a, b) => a - b);
const pct = p => walls.length ? walls[Math.min(walls.length - 1, Math.floor(p * walls.length))] : null;
const anchor = anchorUnit ? latest.get(anchorUnit.key) : null;

const summary = {
  schema: 'wonky-corpus-summary/1', generatedAt: new Date().toISOString(),
  corpus: { root: targets.corpusRoot, inventory: targets.inventory, now: targets.now, scannedAt: targets.scannedAt },
  policy: {
    backend: 'default JS path (WONKY_BACKEND unset)', modelingPolicy: 'strict (CLI default)', concurrency: 'max 3 wonky processes',
    timeouts: 'per unit 180 s; 480 s for known-heavy paths (r10b/r20 cad-project-041, fsocct cases, distributor interface studios, cad-project-012, lego-beam) or > 1500 lines; --retry-timeouts re-runs with 2.5x (max 900 s)',
    units: 'one unit per (file, exported feature); files with 0-1 declared features run without --feature',
  },
  totals: {
    unitsPlanned: units.length, unitsRun: recs.length, unitStatus: count(recs, r => r.status),
    filesRun: files.length, filesPlanned: fileInfo.size, fileStatus: count(files, f => statusOf.get(f.path)),
    filesByFrontend: count(files, f => `${f.frontend}:${statusOf.get(f.path)}`),
    familiesRun: familiesRun.size, familiesOk: familiesOk.size, familiesWithAnyOkUnit: familiesPartial.size,
    wallMs: { p50: pct(0.5), p90: pct(0.9), p99: pct(0.99), max: walls.at(-1) ?? null, sum: walls.reduce((s, x) => s + x, 0) },
  },
  clusters: clusterRows,
  // Furthest-progressing failures: most completed modeling calls before the
  // blocker (production source-map trace). A proxy for "closest to building".
  nearest: recs.filter(r => r.status !== 'ok' && r.completedOperations > 0).sort((a, b) => b.completedOperations - a.completedOperations).slice(0, 20)
    .map(r => ({ key: r.key, family: r.family, cluster: r.cluster, completedOperations: r.completedOperations, failingOperation: r.failingOperation?.name ?? null,
      location: r.location?.line ? `${r.path}:${r.location.line}:${r.location.column ?? ''}` : r.path, callChain: r.failingOperation?.callChain ?? [], message: (r.rootMessage ?? '').slice(0, 200) })),
  successes: recs.filter(r => r.status === 'ok').map(r => ({ key: r.key, family: r.family, representative: r.representative, wallMs: r.wallMs, ...r.totals })),
  reference: reference ? { counts: reference.counts, rows: reference.rows.map(x => ({ key: x.key, verdict: x.verdict, reference: x.reference ?? null, match: x.match ?? null, diff: x.diff ?? null, tolerance: x.tolerance ?? null, note: x.note ?? null })) } : null,
  anchor: anchor ? { key: anchor.key, status: anchor.status, kind: anchor.kind, wallMs: anchor.wallMs, message: anchor.message, failingOperation: anchor.failingOperation, location: anchor.location, completedOperations: anchor.completedOperations, invocation: anchor.invocation } : null,
  runMeta: { sessions: [...new Set(metaRows.map(m => m.session))].length, starts: metaRows.filter(m => m.event === 'start').map(m => ({ at: m.at, uptime: m.uptime, node: m.node, python: m.python, gitHead: m.gitHead })), ends: metaRows.filter(m => m.event === 'end').map(m => ({ at: m.at, uptime: m.uptime, counts: m.counts })) },
};
writeFileSync(paths.summary, JSON.stringify({ ...summary, label }, null, 1));
console.log(JSON.stringify({ totals: summary.totals, clusters: clusterRows.map(c => [c.key, c.units, c.files, c.families]) }, null, 1));
