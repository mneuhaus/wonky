#!/usr/bin/env node
// Fillet harness TEST INFRASTRUCTURE: cross-check of two prototypes' harness
// reports (docs/fillet/proto-kpart.md, "Stage A3"). The oracles are weak in
// known places (OCCT solves 49 of 70 cases and is wrong or refuses in known
// places; Onshape was probed on 16), so two independent prototypes are
// compared with each other: for every case both build, the OCCT-measured
// volumes, the areas and the blend surface types.
//
//   node scripts/fillet/crosscheck.mjs [--a fillet-kpart] [--b fillet-rollingball-tori] [--json out.json]
//
// Reads out/fillet/<proto>/report.json of both (run scripts/fillet/run.mjs
// first). The volume tolerance is the validator's 1e-7 × input volume plus the
// area times the larger stated approximation tolerance of the two results.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const arg = (k, d) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d);
const A = arg('--a', 'fillet-kpart'), B = arg('--b', 'fillet-rollingball-tori');
const load = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, 'out/fillet', p, 'report.json'), 'utf8'));

export function crosscheck(ra, rb) {
  const byId = new Map(rb.cases.map((c) => [c.id, c]));
  const rows = [];
  for (const a of ra.cases) {
    const b = byId.get(a.id);
    if (!b) continue;
    const ca = a.report?.comparison, cb = b.report?.comparison;
    const builtA = a.status === 'ok' && a.report?.valid, builtB = b.status === 'ok' && b.report?.valid;
    const row = { id: a.id, expect: a.expect, a: a.verdict, b: b.verdict, both: builtA && builtB && !!ca?.volume && !!cb?.volume };
    if (row.both) {
      const tolA = Math.max(0, ...(a.report.surfaces?.approximated ?? []).map((x) => x.tolMm));
      const tolB = Math.max(0, ...(b.report.surfaces?.approximated ?? []).map((x) => x.tolMm));
      row.dVolume = ca.volume - cb.volume;
      row.tolerance = 1e-7 * Math.max(1, ca.inputVolume ?? ca.volume) + Math.max(ca.area, cb.area) * Math.max(tolA, tolB);
      row.volumesAgree = Math.abs(row.dVolume) <= row.tolerance;
      row.dArea = ca.area - cb.area;
      row.typesA = a.report.surfaces.exactBlendTypes.concat((a.report.surfaces.approximated ?? []).map((x) => `${x.type}~`));
      row.typesB = b.report.surfaces.exactBlendTypes.concat((b.report.surfaces.approximated ?? []).map((x) => `${x.type}~`));
      row.facesA = a.report.topology.faces;
      row.facesB = b.report.topology.faces;
    } else row.only = builtA ? 'a' : builtB ? 'b' : 'neither';
    rows.push(row);
  }
  const both = rows.filter((r) => r.both);
  return {
    a: ra.proto, b: rb.proto, cases: rows.length,
    bothBuild: both.length, volumesAgree: both.filter((r) => r.volumesAgree).length,
    maxAbsVolumeDiff: Math.max(0, ...both.map((r) => Math.abs(r.dVolume))),
    sameFaceCount: both.filter((r) => r.facesA === r.facesB).length,
    onlyA: rows.filter((r) => r.only === 'a').map((r) => r.id), onlyB: rows.filter((r) => r.only === 'b').map((r) => r.id),
    neither: rows.filter((r) => r.only === 'neither').map((r) => r.id), rows,
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const x = crosscheck(load(A), load(B));
  for (const r of x.rows.filter((r) => r.both)) {
    console.log(`${r.id.padEnd(44)} dV ${r.dVolume.toExponential(2).padStart(10)} (tol ${r.tolerance.toExponential(1)}) ${r.volumesAgree ? 'agree' : 'DIFFER'}  faces ${r.facesA}/${r.facesB}  ${r.typesA.join('+')} / ${r.typesB.join('+')}`);
  }
  console.log(`\n${x.a} vs ${x.b}: ${x.cases} cases; both build ${x.bothBuild}, volumes agree ${x.volumesAgree} (max |dV| ${x.maxAbsVolumeDiff.toExponential(2)}), same face count ${x.sameFaceCount}`);
  console.log(`only ${x.a} builds (${x.onlyA.length}): ${x.onlyA.join(', ')}`);
  console.log(`only ${x.b} builds (${x.onlyB.length}): ${x.onlyB.join(', ')}`);
  console.log(`neither (${x.neither.length}): ${x.neither.join(', ')}`);
  const out = arg('--json', null);
  if (out) fs.writeFileSync(out, JSON.stringify(x, null, 1) + '\n');
}
