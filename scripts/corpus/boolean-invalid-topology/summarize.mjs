// Cluster boolean-invalid-topology: join the per-unit diagnosis runs into
// out/corpus/boolean-invalid-topology/summary.json and print a table.
//   admission.jsonl                   production run with admission predicates (why stage 1 refuses)
//   simulate-linearc.jsonl            polygon prisms through the F32x2 line/arc extruder (the fix, simulated)
//   next-linearc-pass-all.jsonl       same, plus every Boolean refusal stubbed (first non-Boolean blocker)
// Diagnosis only; float64 numbers in these files never feed geometry.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { OUT_DIR } from '../lib.mjs';

const DIR = join(OUT_DIR, 'boolean-invalid-topology');
const load = name => existsSync(join(DIR, name)) ? readFileSync(join(DIR, name), 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
const key = r => `${r.key}#${r.feature ?? ''}`;
const byKey = rows => new Map(rows.map(r => [key(r), r]));
const admission = load('admission.jsonl'), linearc = byKey(load('simulate-linearc.jsonl')), passAll = byKey(load('next-linearc-pass-all.jsonl'));
const files = JSON.parse(readFileSync(join(DIR, 'files.json'), 'utf8')).files;
const famOf = new Map(files.map(f => [f.path, f.family]));

const final = row => row?.records?.find(r => r.ok !== undefined) ?? null;
const mask = m => String(m ?? '').replace(/\(stage (\d+), detail \d+\)/, '(stage $1)').replace(/\(tool \d+, face \d+\)/, '');
function admissionVerdict(row) {
  const calls = row.records.filter(r => r.call !== undefined);
  const rejected = calls.find(c => c.result !== 'Bodies' && !String(c.result).startsWith('Bodies'));
  if (!rejected) return { kind: 'convex-tool-intersection', detail: mask(final(row)?.message) };
  const side = s => {
    if (!s) return 'n/a';
    const f = s.family;
    if (!f.lineEdges || !f.planeFaces || !f.singleFaces) return 'family';
    if (!s.sourceSize) return `size(${s.counts.vertices}V/${s.counts.edges}E/${s.counts.faces}F)`;
    if (s.audit.valid && s.occtPlanarValid && s.vertexLinks) return 'ok';
    const noncoplanar = s.badFaces.some(b => b.fittedResidual > s.resolution);
    return `${noncoplanar ? 'noncoplanar' : 'carrier'} ${s.audit.required.toExponential(1)}>${s.audit.allowance.toExponential(1)}`;
  };
  return { kind: [rejected.first, rejected.second].map(side).map(v => v.split(' ')[0].replace(/\(.*/, '')).join('+'), a: side(rejected.first), b: side(rejected.second) };
}
const outcome = row => {
  if (!row) return null;
  const f = final(row);
  if (!f) return { ok: false, message: row.signal ? `killed ${row.signal}` : 'no result' };
  if (f.ok) return { ok: true, bodies: f.bodies };
  return { ok: false, message: mask(f.message), completed: f.completed, chain: (f.failedOperation?.callChain ?? []).filter(x => !/@\?:\?/.test(x)).join(' > ') };
};
const units = admission.map(row => {
  const k = key(row), stubs = passAll.get(k)?.records?.find(r => r.stubMode !== undefined)?.stubs ?? null;
  return { key: row.key, path: row.path, feature: row.feature, family: famOf.get(row.path) ?? row.family, corpusMessage: mask(row.corpusMessage),
    admission: admissionVerdict(row), withFix: outcome(linearc.get(k)), withFixAndBooleanStubs: outcome(passAll.get(k)),
    stubbedBooleans: stubs ? stubs.map(s => mask(s.message).slice(0, 90)) : null };
});
const tally = (xs, f) => xs.reduce((m, x) => { const v = f(x); m[v] = (m[v] ?? 0) + 1; return m; }, {});
const summary = {
  schema: 'wonky-corpus-cluster-summary/1', cluster: 'boolean-invalid-topology', generatedAt: new Date().toISOString(), units: units.length,
  admission: tally(units, u => u.admission.kind),
  withFix: tally(units, u => u.withFix ? (u.withFix.ok ? 'ok' : u.withFix.message) : 'not run'),
  withFixAndBooleanStubs: tally(units, u => u.withFixAndBooleanStubs ? (u.withFixAndBooleanStubs.ok ? 'ok (with stubbed Booleans)' : u.withFixAndBooleanStubs.message) : 'not run'),
  unitsList: units,
};
writeFileSync(join(DIR, 'summary.json'), JSON.stringify(summary, null, 1) + '\n');
console.log(JSON.stringify({ admission: summary.admission, withFix: summary.withFix, withFixAndBooleanStubs: summary.withFixAndBooleanStubs }, null, 1));
for (const u of units) console.log(`${u.family} ${u.path.split('/').slice(-2).join('/')}#${u.feature ?? ''} | ${u.admission.kind} | fix: ${u.withFix?.ok ? 'OK' : u.withFix?.message?.slice(0, 70)} | stubs: ${u.withFixAndBooleanStubs?.ok ? 'OK' : u.withFixAndBooleanStubs?.message?.slice(0, 60)} (${u.stubbedBooleans?.length ?? '-'} stubbed)`);
