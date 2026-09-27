// Joins the corpus run records, the harness passes (p1: prototypes only;
// p1b: same plus the empty all-bodies instrumentation; p2: prototypes + source stubs) and the static scans into
// out/corpus/cluster-fs-missing-builtin.json.
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const DATA = join(here, '..', '..', '..', 'tmp', 'corpus', 'fs-missing-builtin');
const repo = join(here, '..', '..', '..');
const read = f => readFileSync(join(DATA, f), 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
const files = JSON.parse(readFileSync(join(DATA, 'cluster-files.json'), 'utf8'));
const staticMissing = new Map(JSON.parse(readFileSync(join(DATA, 'static-missing.json'), 'utf8')).map(r => [r.path, r.missing.map(m => m.name)]));
const p1 = new Map(read('next-p1b.jsonl').map(r => [r.key, r]));
const p2 = new Map(read('next-p2.jsonl').map(r => [r.key, r]));
const stubs = JSON.parse(readFileSync(join(here, 'stubs-p2.json'), 'utf8'));
// The Boolean each Boolean-blocked unit reaches, as a recover-next.mjs case
// (the corpus file's own values), with the bake-off recover verdict.
const recoverFile = join(repo, 'out/corpus/cluster-fs-missing-builtin-recover.json');
let recoverRows = new Map();
try { recoverRows = new Map(JSON.parse(readFileSync(recoverFile, 'utf8')).rows.map(r => [r.id, r])); } catch (error) { if (error.code !== 'ENOENT') throw error; }
function booleanShape(path, feature, chain) {
  if (feature === 'cableClamp' && /interface-r4\.fs$/.test(path)) return 'fs95-r4-cableclamp';
  if (feature === 'cableClamp' && /interface-r5\.fs$/.test(path)) return 'fs95-r5-cs-first';
  if (feature === 'cableClamp' && /> cs@\d+ > cut@/.test(chain ?? '')) return 'fs95-cs-first';
  return { frameR4Diagonal: 'r4-diagonal-headpilot', frameR4HeadRetainer: 'r4-head-retainer', motorCrossmemberU2: 'u2-boss-join' }[feature] ?? null;
}
function recoverOf(path, feature, chain) {
  const id = booleanShape(path, feature, chain);
  if (!id) return null;
  const r = recoverRows.get(id);
  return { case: id, verdict: r?.verdict ?? 'not run', ...(r?.reason ? { reason: r.reason } : {}), ...(r?.exact ? { volumeRelErr: r.exact.volumeRelErr } : {}) };
}

// Cluster keys as in scripts/corpus/summarize.mjs clusterOf(), applied to the
// raw fields (the runner's status/kind plus message patterns).
function clusterOfRun(u) {
  const m = u.message ?? '';
  if (u.status === 'ok') return 'ok';
  if (/is not defined or not implemented by this prototype/.test(m)) return 'fs-missing-builtin';
  if (/Unresolved Onshape module/.test(m)) return 'fs-module-import';
  if (/InvalidTopology|UnsupportedArrangement/.test(m)) return 'boolean-invalid-topology';
  if (/opBoolean/.test(m)) return 'boolean-capability';
  if (u.kind === 'model-check-before-geometry' || u.kind === 'ui-selection-missing') return 'fs-needs-partstudio-input';
  if (/opLoft|Profile has collinear|A profile must have|Face vertices do not lie|Plane frame is not orthonormal|cannot mix entities/.test(m)) return 'kernel-sketch-and-ops';
  if (/^Expected '|Unexpected /.test(m)) return 'fs-parser-syntax';
  return `${u.status}:${u.kind}`;
}
function clusterOfNext(r) {
  if (!r) return null;
  if (r.ok) return 'ok';
  const m = r.message ?? '';
  if (r.stage === 'timeout') return 'timeout';
  if (/is not defined or not implemented by this prototype/.test(m)) return `fs-missing-builtin (${m.match(/^'(\w+)'/)?.[1]})`;
  if (/Unresolved Onshape module/.test(m)) return 'fs-module-import';
  if (r.protoCalls?.emptyAllBodiesQuery) return 'fs-needs-partstudio-input (empty all-bodies source query)';
  if (/InvalidTopology|UnsupportedArrangement/.test(m)) return 'boolean-invalid-topology';
  if (/opBoolean/.test(m)) return 'boolean-capability';
  if (r.kind === 'model-check-before-geometry' || r.kind === 'ui-selection-missing') return 'fs-needs-partstudio-input';
  if (/^Expected IntegerBoundSpec|^Expected [A-Z]\w*BoundSpec/.test(m)) return 'fs-interpreter-semantics (type tag)';
  if (/Feature precondition failed/.test(m)) return 'fs-interpreter-semantics (feature parameter default)';
  if (/opLoft|Field '\w+' is not supported|Native line\/arc sketch unsupported|Revolve of a profile touching the axis|Profile has collinear|A profile must have/.test(m)) return 'kernel-sketch-and-ops';
  return `${r.status}:${r.kind}`;
}

const rows = files.map(f => {
  const unitRows = f.units.map(u => ({ feature: u.feature, cluster: clusterOfRun(u), inCluster: u.inCluster, builtin: u.inCluster ? u.message.match(/^'(\w+)'/)?.[1] : undefined,
    completedBefore: u.completed }));
  const failing = unitRows.filter(u => u.cluster !== 'ok');
  const counts = {}; for (const u of failing) counts[u.cluster] = (counts[u.cluster] ?? 0) + 1;
  const primary = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0];
  const inCluster = unitRows.filter(u => u.inCluster);
  const next = f.units.filter(u => u.inCluster).map(u => {
    const a = p1.get(u.key), b = p2.get(u.key);
    return { feature: u.feature, builtin: u.message.match(/^'(\w+)'/)?.[1], completedBefore: u.completed,
      next: clusterOfNext(a), nextMessage: (a?.message ?? '').slice(0, 200), completedAfter: a?.completed ?? null, protoCalls: a?.protoCalls ?? null,
      chain: a?.failingOperation?.chain ?? null,
      ...(clusterOfNext(a) === 'boolean-capability' ? { recover: recoverOf(f.path, u.feature, a?.failingOperation?.chain) } : {}),
      ...(b ? { stubbed: stubs[f.path], thenNext: clusterOfNext(b), thenMessage: (b.message ?? '').slice(0, 200), thenCompleted: b.completed ?? null, thenBodies: b.bodies ?? null } : {}) };
  });
  return {
    path: f.path, family: f.family, representative: f.representative, lines: f.lines,
    units: unitRows.length, clusterUnits: inCluster.length, okUnits: unitRows.length - failing.length,
    firstBlocker: inCluster.length === failing.length ? 'sole' : primary === 'fs-missing-builtin' ? 'primary' : 'minor',
    otherClusters: Object.fromEntries(Object.entries(counts).filter(([k]) => k !== 'fs-missing-builtin')),
    staticMissing: staticMissing.get(f.path) ?? [], next,
  };
});
const summary = {
  schema: 'wonky-corpus-cluster-analysis/1', cluster: 'fs-missing-builtin', generatedAt: new Date().toISOString(),
  harness: 'tmp/corpus/fs-missing-builtin/harness.mjs (production parser/interpreter/library/kernel + prototype builtins, defined only in tmp)',
  runMeta: readFileSync(join(DATA, 'run-meta.jsonl'), 'utf8').trim().split('\n').map(JSON.parse),
  files: rows.length, units: rows.reduce((s, r) => s + r.clusterUnits, 0),
  firstBlocker: rows.reduce((c, r) => ({ ...c, [r.firstBlocker]: (c[r.firstBlocker] ?? 0) + 1 }), {}),
  nextAfterPrototypes: rows.flatMap(r => r.next).reduce((c, n) => ({ ...c, [n.next]: (c[n.next] ?? 0) + 1 }), {}),
  nextAfterPrototypesFiles: Object.fromEntries(Object.entries(rows.reduce((c, r) => { for (const n of new Set(r.next.map(x => x.next))) (c[n] ??= new Set()).add(r.path); return c; }, {})).map(([k, s]) => [k, s.size])),
  booleanNextRecover: rows.flatMap(r => r.next.filter(n => n.recover).map(n => `${n.recover.case}: ${n.recover.verdict}`)).reduce((c, k) => ({ ...c, [k]: (c[k] ?? 0) + 1 }), {}),
  rows,
};
writeFileSync(join(repo, 'out/corpus/cluster-fs-missing-builtin.json'), JSON.stringify(summary, null, 1) + '\n');
console.log(JSON.stringify({ files: summary.files, units: summary.units, firstBlocker: summary.firstBlocker, next: summary.nextAfterPrototypes, nextFiles: summary.nextAfterPrototypesFiles }, null, 1));
for (const r of rows) console.log(`${r.firstBlocker.padEnd(7)} ${String(r.clusterUnits).padStart(2)}/${String(r.units).padEnd(3)} ${r.path}  -> ${[...new Set(r.next.map(n => n.next + (n.thenNext ? ' => ' + n.thenNext : '')))].join('; ')}`);
