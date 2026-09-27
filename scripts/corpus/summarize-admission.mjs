// Summarize out/corpus/boolean-invalid-topology/admission.jsonl: per unit, the
// rejected planar-arrangement call, which operand failed which predicate, and
// whether the offending faces have exactly coplanar F32 vertices (a carrier
// problem) or not (a vertex problem). Float64 residuals are diagnosis only.
import { readFileSync } from 'node:fs';
const file = process.argv[2] ?? 'out/corpus/boolean-invalid-topology/admission.jsonl';
const rows = readFileSync(file, 'utf8').trim().split('\n').map(JSON.parse);
const verdictOf = side => {
  if (!side) return null;
  const f = side.family;
  if (!f.lineEdges || !f.planeFaces || !f.singleFaces || !side.sourceSize) return `family(line=${f.lineEdges},plane=${f.planeFaces},single=${f.singleFaces},size=${side.sourceSize})`;
  if (side.audit.valid && side.occtPlanarValid && side.vertexLinks) return 'ok';
  const bad = side.badFaces;
  const res = side.resolution;
  const carrier = bad.filter(b => b.fittedResidual <= res && b.storedResidual > res).length;
  const vertex = bad.filter(b => b.fittedResidual > res).length;
  const other = bad.length - carrier - vertex;
  return `bad ${bad.length}/${side.faceCount} faces (carrier ${carrier}, noncoplanar ${vertex}, other ${other}); links=${side.vertexLinks}; required=${side.audit.required.toExponential(2)} allowance=${side.audit.allowance.toExponential(2)}; maxFitted=${Math.max(0, ...bad.map(b => b.fittedResidual)).toExponential(2)}`;
};
const tally = {};
for (const row of rows) {
  const calls = row.records.filter(r => r.call !== undefined);
  const final = row.records.find(r => r.ok !== undefined);
  const rejected = calls.find(c => c.result !== 'Bodies');
  const okCalls = calls.filter(c => c.result === 'Bodies').length;
  let verdict;
  if (!rejected) verdict = `no planar call rejected (${calls.length} planar calls ok); final: ${final?.message}`;
  else verdict = `call ${rejected.call} ${rejected.op} -> ${rejected.result.reason}/${rejected.result.stage}/${rejected.result.detail}; A: ${verdictOf(rejected.first)} | B: ${verdictOf(rejected.second)}`;
  const kind = !rejected ? 'other-path' : [rejected.first, rejected.second].map(s => { const v = verdictOf(s); return v === 'ok' ? 'ok' : v.startsWith('family') ? 'family' : /noncoplanar [1-9]/.test(v) ? 'noncoplanar' : /carrier [1-9]/.test(v) ? 'carrier' : 'other'; }).join('+');
  tally[kind] = (tally[kind] ?? 0) + 1;
  console.log(`${row.key}#${row.feature ?? ''}\n    [${kind}] okPlanarCallsBefore=${okCalls} ${verdict}`);
}
console.log(JSON.stringify(tally));
