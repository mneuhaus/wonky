// Compare a benchmark run against the baseline (or another benchmark run).
//
//   node scripts/corpus/compare.mjs --label <name> [--base <label>] [--json <path>]
//
// Without --base the baseline is out/corpus/runs.jsonl. Only units present in
// BOTH runs are compared, so a partial benchmark (--only, --cluster, --phase 1)
// is compared on its own units. Reports:
//   - files and families that build, per frontend (units run in both);
//   - status/cluster transitions per unit;
//   - new successes, and regressions (ok before, not ok now; or an ok unit whose
//     body count or volume changed by more than 1e-9 relative);
//   - wall time p50/p99 of the compared units.
// Writes out/corpus/bench/<label>/compare.json by default.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runPaths } from './lib.mjs';
import { loadRecords } from './clusters.mjs';

const args = process.argv.slice(2);
const opt = name => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const label = opt('--label');
if (!label) throw new Error('Usage: compare.mjs --label <name> [--base <label>] [--json <path>]');
const baseLabel = opt('--base');
const before = loadRecords({ runs: runPaths(baseLabel).runs });
const after = loadRecords({ runs: runPaths(label).runs });
const outPath = opt('--json') ?? join(runPaths(label).dir, 'compare.json');

const A = new Map(before.recs.map(r => [r.key, r]));
const B = new Map(after.recs.map(r => [r.key, r]));
const keys = [...B.keys()].filter(k => A.has(k));
const tag = r => (r.status === 'ok' ? 'ok' : r.cluster ?? r.status);

// Files: compared only when every unit of the file is present in both runs.
const unitsOf = new Map();
for (const u of after.units) { if (!unitsOf.has(u.path)) unitsOf.set(u.path, []); unitsOf.get(u.path).push(u.key); }
const fileInfo = new Map(after.targets.files.map(f => [f.path, f]));
const comparedFiles = [...unitsOf].filter(([, ks]) => ks.every(k => A.has(k) && B.has(k)));
const fileOk = (map, ks) => ks.every(k => map.get(k).status === 'ok');
const tally = map => {
  const out = { fs: { files: 0, families: new Set() }, py: { files: 0, families: new Set() } };
  for (const [path, ks] of comparedFiles) if (fileOk(map, ks)) { const f = fileInfo.get(path); out[f.frontend].files++; out[f.frontend].families.add(f.family); }
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, { files: v.files, families: v.families.size }]));
};

const transitions = {};
const newOk = [], regressions = [], changed = [];
for (const k of keys) {
  const a = A.get(k), b = B.get(k);
  const t = `${tag(a)} -> ${tag(b)}`;
  if (tag(a) !== tag(b)) transitions[t] = (transitions[t] ?? 0) + 1;
  if (a.status !== 'ok' && b.status === 'ok') newOk.push({ key: k, bodies: b.totals?.bodies, volumeMm3: b.totals?.volumeMm3 });
  if (a.status === 'ok' && b.status !== 'ok') regressions.push({ key: k, now: tag(b), message: (b.rootMessage ?? '').slice(0, 200) });
  if (a.status === 'ok' && b.status === 'ok') {
    const va = a.totals?.volumeMm3, vb = b.totals?.volumeMm3;
    if (a.totals?.bodies !== b.totals?.bodies || (va != null && vb != null && Math.abs(va - vb) > 1e-9 * Math.max(1, Math.abs(va))))
      regressions.push({ key: k, now: 'ok (geometry changed)', message: `bodies ${a.totals?.bodies} -> ${b.totals?.bodies}, volume ${va} -> ${vb}` });
  }
  if (a.status !== 'ok' && b.status !== 'ok' && tag(a) === tag(b) && a.rootPattern !== b.rootPattern) changed.push({ key: k, cluster: tag(b), before: a.rootMessage?.slice(0, 120), after: b.rootMessage?.slice(0, 120) });
}
const pct = (recs, p) => { const w = recs.map(r => r.wallMs).filter(Number.isFinite).sort((x, y) => x - y); return w.length ? w[Math.min(w.length - 1, Math.floor(p * w.length))] : null; };
const aRecs = keys.map(k => A.get(k)), bRecs = keys.map(k => B.get(k));
const result = {
  schema: 'wonky-corpus-compare/1', generatedAt: new Date().toISOString(), base: baseLabel ?? 'baseline', label,
  units: { compared: keys.length, onlyInLabel: [...B.keys()].filter(k => !A.has(k)).length },
  files: { compared: comparedFiles.length, before: tally(A), after: tally(B) },
  unitsOk: { before: aRecs.filter(r => r.status === 'ok').length, after: bRecs.filter(r => r.status === 'ok').length },
  transitions: Object.fromEntries(Object.entries(transitions).sort((x, y) => y[1] - x[1])),
  newOk, regressions, sameClusterNewMessage: changed.length, sameClusterNewMessageExamples: changed.slice(0, 20),
  wallMs: { before: { p50: pct(aRecs, 0.5), p99: pct(aRecs, 0.99) }, after: { p50: pct(bRecs, 0.5), p99: pct(bRecs, 0.99) } },
};
writeFileSync(outPath, JSON.stringify(result, null, 1));
console.log(JSON.stringify({ ...result, sameClusterNewMessageExamples: undefined, newOk: result.newOk.length, regressions: result.regressions }, null, 1));
if (regressions.length) process.exitCode = 2;
