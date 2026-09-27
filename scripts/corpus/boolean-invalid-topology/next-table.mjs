// Cluster boolean-invalid-topology: aggregate next-linearc-pass-all.jsonl (the
// simulated F32x2 fix plus every Boolean refusal stubbed) into the per-unit and
// per-file next-blocker table of docs/corpus/cluster-boolean-invalid-topology.md
// section 5.3. Diagnosis only. The last record per unit wins (re-runs append).
//   node scripts/corpus/boolean-invalid-topology/next-table.mjs [--json out/corpus/boolean-invalid-topology/next-table.json]
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { OUT_DIR } from '../lib.mjs';

const DIR = join(OUT_DIR, 'boolean-invalid-topology');
const args = process.argv.slice(2);
const jsonOut = args.includes('--json') ? args[args.indexOf('--json') + 1] : join(DIR, 'next-table.json');
const rows = new Map();
for (const line of readFileSync(join(DIR, 'next-linearc-pass-all.jsonl'), 'utf8').trim().split('\n').filter(Boolean)) {
  const r = JSON.parse(line);
  rows.set(`${r.key}#${r.feature ?? ''}`, r);
}

// Owner cluster of a final (non-Boolean) blocker message.
const OWNERS = [
  [/'skText'|'opTransform'|'opFillet'|'opChamfer'|is not defined or not implemented/, 'fs-missing-builtin'],
  [/opLoft|collinear|3–256 vertices|Plane frame|analytic plane/, 'kernel-sketch-and-ops'],
  [/Unresolved Onshape module/, 'fs-module-import'],
];
const owner = message => (OWNERS.find(([re]) => re.test(message)) ?? [null, 'other'])[1];
const short = message => String(message ?? '')
  .replace(/ is not defined or not implemented by this prototype/, ' missing')
  .replace(/^R\d+ build: /, '').slice(0, 80);
// Stub kinds (scripts/corpus/boolean-hook-loader.mjs): 'pass' = a boolean-capability
// refusal (general / through hole / coaxial), 'pass-other' = any other Boolean
// refusal, here the planar arrangement (this cluster, second level), 'nary' = N-ary fold.
const units = [...rows.values()].map(r => {
  const recs = r.records ?? [];
  const final = recs.find(x => x.ok !== undefined) ?? null;
  const stubRec = recs.find(x => x.stubMode !== undefined) ?? null;
  const stubs = stubRec?.stubs ?? [];
  const count = kind => stubs.filter(s => s.kind === kind).length;
  const planarReasons = {};
  for (const s of stubs.filter(s => s.kind === 'pass-other')) {
    const m = /(InvalidTopology|UnsupportedArrangement|AmbiguousContact|ResolutionLimit|ConstructionFailure)[^)]*\(stage (\d+)/.exec(s.message) ?? /(\w+) \((tool)/.exec(s.message);
    const k = m ? `${m[1]}${m[2] && m[2] !== 'tool' ? ` stage ${m[2]}` : ''}` : short(s.message);
    planarReasons[k] = (planarReasons[k] ?? 0) + 1;
  }
  let outcome, cluster;
  if (!final) { outcome = r.signal ? `killed (${r.signal}) after ${Math.round(r.wallMs / 1000)} s` : 'no result'; cluster = 'timeout'; }
  else if (final.ok) { outcome = `reaches the end (${final.bodies} bod${final.bodies === 1 ? 'y' : 'ies'}, Boolean stubs make it wrong)`; cluster = 'end'; }
  else { outcome = short(final.message); cluster = owner(final.message); }
  return { key: r.key, feature: r.feature ?? null, family: r.family, wallS: Math.round(r.wallMs / 1000), loadavg: r.loadavg,
    booleanCalls: stubRec?.booleanCalls ?? null, stubbedPlanar: count('pass-other'), stubbedCapability: count('pass'), naryFolds: count('nary'),
    planarReasons, completed: final?.completed ?? null, outcome, cluster };
});
units.sort((a, b) => (a.feature ?? '').localeCompare(b.feature ?? '') || a.key.localeCompare(b.key));
const tally = (xs, f) => xs.reduce((m, x) => { const v = f(x); m[v] = (m[v] ?? 0) + 1; return m; }, {});
const summary = {
  schema: 'wonky-corpus-next-table/1', cluster: 'boolean-invalid-topology', generatedAt: new Date().toISOString(),
  units: units.length, byCluster: tally(units, u => u.cluster), byOutcome: tally(units, u => u.outcome),
  byFeature: Object.fromEntries(Object.entries(Object.groupBy(units, u => u.feature ?? '(single)')).map(([f, us]) => [f, tally(us, u => u.outcome)])),
  unitsList: units,
};
writeFileSync(jsonOut, JSON.stringify(summary, null, 1) + '\n');
console.log(JSON.stringify({ units: summary.units, byCluster: summary.byCluster, byFeature: summary.byFeature }, null, 1));
for (const u of units) console.log(`${u.family} ${u.key.split('/').slice(-2).join('/')}#${u.feature ?? ''} | planar stubs ${u.stubbedPlanar} ${JSON.stringify(u.planarReasons)} | capability stubs ${u.stubbedCapability} | ${u.outcome} [${u.cluster}]`);
