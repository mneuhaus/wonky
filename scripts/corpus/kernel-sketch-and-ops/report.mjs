// Aggregates out/corpus/cluster-kernel-sketch-and-ops.jsonl (drive.mjs passes diag, next, deep,
// xframe, xarea, and the re-check passes xloft-rerun, xloft-motor) into
// out/corpus/cluster-kernel-sketch-and-ops.summary.json and prints the markdown tables used in
// docs/corpus/cluster-kernel-sketch-and-ops.md.
// Usage: node scripts/corpus/kernel-sketch-and-ops/report.mjs
import { readFileSync, writeFileSync } from 'node:fs';
const REPO = new URL('../../../', import.meta.url).pathname;
const rows = readFileSync(REPO + 'out/corpus/cluster-kernel-sketch-and-ops.jsonl', 'utf8').trim().split('\n').map(l => JSON.parse(l));
const meta = rows.filter(r => r.meta);
const runs = rows.filter(r => !r.meta);
const pass = label => new Map(runs.filter(r => r.label === label).map(r => [r.key, r]));
const diag = pass('diag'), next = pass('next'), deep = pass('deep'), xframe = pass('xframe'), xarea = pass('xarea');
const units = JSON.parse(readFileSync(REPO + 'tmp/corpus/kso/units.json', 'utf8'));
const files = JSON.parse(readFileSync(REPO + 'tmp/corpus/kso/files.json', 'utf8'));
const xunits = JSON.parse(readFileSync(REPO + 'tmp/corpus/kso/xunits.json', 'utf8'));

const cause = m => /opLoft/.test(m) ? 'loft' : /collinear/.test(m) ? 'collinear' : /3–256/.test(m) ? 'max-vertices'
  : /analytic plane|orthonormal/.test(m) ? 'cap-normal' : /cannot mix/.test(m) ? 'inner-loops' : 'other';
const loftClass = l => {
  if (!l.error) return 'admitted (coaxial circles)';
  if (l.count !== 2) return 'multi-section';
  if (/circle/.test(l.profiles) && /polygon|line-arc/.test(l.profiles)) return 'polygon-to-circle';
  if (/line-arc/.test(l.profiles)) return l.parallel ? 'line/arc profiles, parallel planes' : 'line/arc profiles';
  if (l.maxQuadNonPlanarityMm === undefined) return 'vertex counts differ';
  if (l.maxQuadNonPlanarityMm <= 1e-9) return 'planar sides';
  return l.parallel ? 'twisted' : 'twisted, non-parallel planes';
};
const outcome = r => !r ? 'not run' : r.timedOut ? 'timeout' : r.result?.ok ? 'OK'
  : `${r.result?.failing?.name ?? '-'}: ${(r.result?.failing?.error ?? r.result?.message ?? r.stderr ?? '').replace(/opBoolean supports coaxial cylinder primitives.*/, 'general trimmed-face Boolean not implemented').replace(/ is not defined or not implemented by this prototype/, ' missing').replace(/currently requires two tools for union\/intersection, or one target and one tool for subtraction/, 'arity limit (more than two tools)').slice(0, 110)}`;
const count = (arr, f) => arr.reduce((c, x) => { const k = f(x); c[k] = (c[k] ?? 0) + 1; return c; }, {});
const table = obj => Object.entries(obj).sort((a, b) => b[1] - a[1]);

const perUnit = units.map(u => {
  const d = diag.get(u.key), n = next.get(u.key), dp = deep.get(u.key);
  const firstLoft = (d?.lofts ?? []).at(-1);
  const collinear = (d?.profileFailures ?? []).flatMap(f => f.collinear ?? []);
  return {
    key: u.key, family: u.family, representative: u.representative, cause: cause(u.msg), message: u.msg,
    completedBefore: u.completed,
    firstLoft: firstLoft ? loftClass(firstLoft) : null,
    loftsAfterFix: (n?.lofts ?? []).filter(l => l.error).map(loftClass).filter(c => c !== 'planar sides'),
    collinearMaxDeviationMm: collinear.length ? Math.max(...collinear.map(c => c.deviationMm)) : null,
    profileVertices: (d?.profileFailures ?? []).map(f => f.vertices),
    next: outcome(n), nextCompleted: n?.result?.completed ?? null, nextStubs: n?.stubsUsed ?? {},
    deep: outcome(dp), deepCompleted: dp?.result?.completed ?? null, deepStubs: dp?.stubsUsed ?? {},
  };
});
const unitByKey = new Map(perUnit.map(u => [u.key, u]));
const perFile = files.map(f => {
  const mine = f.units.filter(u => u.cluster === 'kernel-sketch-and-ops');
  const others = count(f.units.filter(u => u.cluster !== 'kernel-sketch-and-ops'), u => u.cluster);
  const keys = mine.map(u => f.path + (u.feature ? `#${u.feature}` : ''));
  const info = keys.map(k => unitByKey.get(k)).filter(Boolean);
  return {
    path: f.path, family: info[0]?.family, units: f.units.length, clusterUnits: mine.length, otherUnits: others,
    firstBlocker: Object.keys(others).length === 0 ? 'sole' : 'shared',
    causes: count(info, u => u.cause), next: count(info, u => u.next), deep: count(info, u => u.deep),
  };
});
const cross = xunits.map(u => {
  const b = xframe.get(u.key), a = xarea.get(u.key);
  return { key: u.key, family: u.family, before: { completed: u.completed, message: u.msg.slice(0, 90) },
    area: { completed: a?.result?.completed ?? null, outcome: outcome(a) }, frame: { completed: b?.result?.completed ?? null, outcome: outcome(b) } };
});
const moved = cross.filter(c => c.frame.completed !== c.before.completed || c.frame.outcome === 'OK');
const movedFamilies = count(moved, c => c.family);
// Re-check passes xloft-rerun (boolean-capability units whose next blocker is opLoft) and
// xloft-motor (boolean-invalid-topology motorBracket units): every loft they reach once their
// Booleans are passed by the proxy, and what they hit after exact planar lofts.
const outside = ['xloft-rerun', 'xloft-motor'].flatMap(label => [...pass(label).values()]).map(r => {
  const blocking = (r.lofts ?? []).filter(l => l.error).map(loftClass).filter(c => c !== 'planar sides');
  return { key: r.key, family: r.family, pass: r.label, planarLofts: r.stubsUsed?.loftplanar ?? 0,
    stillBlockedBy: blocking.at(-1) ?? null, next: outcome(r) };
});
const outsideLofts = outside.length ? {
  units: outside.length,
  pastAllLoftsWithPlanarLoft: outside.filter(o => !o.stillBlockedBy).length,
  stillBlockedBy: count(outside.filter(o => o.stillBlockedBy), o => o.stillBlockedBy),
  next: count(outside, o => o.next),
  rows: outside,
} : null;
const summary = {
  schema: 'wonky-corpus-cluster-analysis/1', cluster: 'kernel-sketch-and-ops', generatedAt: new Date().toISOString(),
  runs: meta, units: perUnit.length, files: perFile.length,
  causes: count(perUnit, u => u.cause),
  causeFamilies: Object.fromEntries(Object.entries(count(perUnit, u => u.cause)).map(([c]) => [c, [...new Set(perUnit.filter(u => u.cause === c).map(u => u.family))].length])),
  firstLoft: count(perUnit.filter(u => u.firstLoft), u => u.firstLoft),
  loftUnitsAfterPlanarLoft: count(perUnit.filter(u => u.cause === 'loft'), u => u.loftsAfterFix.length ? `still blocked: ${u.loftsAfterFix.at(-1)}` : 'past all lofts'),
  nextByCause: Object.fromEntries(Object.keys(count(perUnit, u => u.cause)).map(c => [c, count(perUnit.filter(u => u.cause === c), u => u.next)])),
  deep: count(perUnit, u => u.deep),
  filesSole: perFile.filter(f => f.firstBlocker === 'sole').map(f => f.path),
  crossCluster: { units: cross.length, movedWithFrame: moved.length, movedFamilies, movedWithArea: cross.filter(c => c.area.completed !== c.before.completed || c.area.outcome === 'OK').length, rows: moved },
  outsideLofts,
  perUnit, perFile,
};
writeFileSync(REPO + 'out/corpus/cluster-kernel-sketch-and-ops.summary.json', JSON.stringify(summary, null, 1));

const md = [];
md.push('## causes', ...table(summary.causes).map(([k, v]) => `| ${k} | ${v} | ${summary.causeFamilies[k]} |`));
md.push('', '## first loft', ...table(summary.firstLoft).map(([k, v]) => `| ${k} | ${v} |`));
md.push('', '## loft units after planar loft', ...table(summary.loftUnitsAfterPlanarLoft).map(([k, v]) => `| ${k} | ${v} |`));
for (const [c, t] of Object.entries(summary.nextByCause)) md.push('', `## next: ${c}`, ...table(t).map(([k, v]) => `| ${v} | ${k} |`));
md.push('', '## deep', ...table(summary.deep).map(([k, v]) => `| ${v} | ${k} |`));
md.push('', '## files', ...perFile.map(f => `| ${f.path} | ${f.family} | ${f.clusterUnits}/${f.units} | ${f.firstBlocker === 'sole' ? 'yes' : Object.entries(f.otherUnits).map(([k, v]) => `${k} ${v}`).join(', ')} | ${Object.entries(f.causes).map(([k, v]) => `${k} ${v}`).join(', ')} | ${Object.keys(f.next).join('; ')} |`));
md.push('', '## cross-cluster moved by frame', ...moved.map(c => `| ${c.key} | ${c.before.completed} | ${c.area.completed} | ${c.frame.completed} | ${c.frame.outcome} |`));
console.log(md.join('\n'));
