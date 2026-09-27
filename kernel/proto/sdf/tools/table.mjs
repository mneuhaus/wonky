// TEST INFRASTRUCTURE: render the sdf results table for docs/proto-sdf.md from a run.mjs report
//   node kernel/proto/sdf/tools/table.mjs [report.json]
import fs from 'node:fs';
const ROOT = new URL('../../../../', import.meta.url).pathname.replace(/\/$/, '');
const r = JSON.parse(fs.readFileSync(process.argv[2] ?? `${ROOT}/out/bakeoff/sdf/report.json`, 'utf8'));
const stats = (id) => {
  for (const t of ['cpuN', 'cpu1', 'js', 'metal']) {
    const p = `${ROOT}/out/bakeoff/sdf/results/${id}.${t}.result`;
    if (!fs.existsSync(p)) continue;
    const txt = fs.readFileSync(p, 'utf8');
    const line = /^sdf (.*)$/m.exec(txt)?.[1] ?? '';
    return Object.fromEntries([...line.matchAll(/(\w+) (-?[\d.]+)/g)].map(([, k, v]) => [k, Number(v)]));
  }
  return {};
};
const f = (x, d = 0) => (x === undefined || x === null || Number.isNaN(x) ? '–' : Number(x).toFixed(d));
const e = (x) => (x === undefined || x === null ? '–' : Number(x).toExponential(1));
const rows = [];
rows.push('| case | verdict | h µm | tris | devs µm | vol err vs OCCT: abs mm³ / rel (bound mm³) | vs manifold3d rel (tier) | JS warm | cpu1 | cpu18 | Metal 1GB (passes) | cpu1/cpu18 |');
rows.push('|---|---|---|---|---|---|---|---|---|---|---|---|');
const tot = {};
for (const c of r.cases) {
  const s = c.status === 'ok' ? stats(c.id) : {};
  const t = c.targets ?? {};
  const js = t.js?.outcome === 'ran' ? f(t.js.timing.computeMs) : t.js?.outcome;
  const c1 = t.cpu1?.timing?.computeMs, cn = t.cpuN?.timing?.computeMs, mt = t.metal?.timing?.computeMs;
  const mcell = t.metal?.outcome === 'ran' ? `${f(mt)} (${t.metal.metalPasses})` : (t.metal ? `${t.metal.outcome} (OOM)` : '–');
  const cmp = c.comparison ?? {};
  tot[c.verdict] = (tot[c.verdict] ?? 0) + 1;
  const occ = cmp.volumeAbsErrVsOcct !== undefined ? `${f(cmp.volumeAbsErrVsOcct, 3)} / ${cmp.occtVolume ? e(cmp.volumeAbsErrVsOcct / cmp.occtVolume) : '–'} (${f(cmp.analyticBound, 1)})` : '–';
  rows.push(`| ${c.id} | ${c.verdict}${c.targetsAgree === false ? ' (targets disagree)' : ''} | ${f(s.h_nm / 1000)} | ${c.report?.triangles ?? '–'} | ${s.devs_nm !== undefined ? f(s.devs_nm / 1000, 2) : '–'} | ${occ} | ${e(cmp.volumeRelErrVsManifold)}${c.tier ? ` (${c.tier})` : ''} | ${js} | ${f(c1)} | ${f(cn)} | ${mcell} | ${c1 && cn ? f(c1 / cn, 1) : '–'} |`);
}
console.log(rows.join('\n'));
console.log('\n' + JSON.stringify(tot));
