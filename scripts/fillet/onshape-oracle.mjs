#!/usr/bin/env node
// Fillet harness TEST INFRASTRUCTURE: the Onshape oracle
// (docs/fillet/harness.md, "Onshape oracle").
//
//   node scripts/fillet/onshape-oracle.mjs [--check]
//
// Reads the Onshape fillet/chamfer probes built by the cad-31 session on
// 2026-09-24 (read only: ~/Workspace/cad/cad-project-041/single-step-r20/
// kernel-cases/fp-*/reference.json and fp-probes.json) and writes them into
// fixtures/fillet/reference.json as a separate `onshape` section, keyed by
// catalogue case id. Onshape is the primary oracle wherever a probe exists
// (validate.mjs verdictOf): a result on a case Onshape refuses is `wrong`, and
// where Onshape builds, the closed forms Onshape agrees with decide.
//
// Mapping: FP01-FP14 carry the catalogue id of their case. FP15 is the
// catalogue case ch-convex-120-hex-d1 (added for it). FP16's input and
// selection are the catalogue case ch-box-corner-3-d1 word for word (box
// 20 x 20 x 20, the three edges at (20, 20, 20)), so it references that case.
//
// Each record keeps Onshape's own numbers (mass properties: volume value and
// its [min, max] bounds, input volume, dV, face counts and types, mesh face
// areas) and the check that Onshape's input volume equals the kernel's
// (fixture sidecar), so the ΔV comparison is between the same inputs.
// --check: fail when reference.json's section differs from a fresh read.

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const PROBE_DIR = path.join(os.homedir(), 'Workspace/cad/cad-project-041/single-step-r20/kernel-cases');
const REF = path.join(ROOT, 'fixtures/fillet/reference.json');
const CASE_OF_PROBE = { 'chamfer-semantics-120deg-d1': 'ch-convex-120-hex-d1', 'chamfer-semantics-box-corner-d1': 'ch-box-corner-3-d1' };

export function readProbes(dir = PROBE_DIR) {
  const index = JSON.parse(fs.readFileSync(path.join(dir, 'fp-probes.json'), 'utf8'));
  const cases = {};
  for (const [probe, p] of Object.entries(index.probes)) {
    const file = path.join(dir, probe, 'reference.json');
    const bytes = fs.readFileSync(file);
    const r = JSON.parse(bytes.toString('utf8'));
    const id = CASE_OF_PROBE[p.id] ?? p.id;
    const part = r.parts?.[0] ?? null;
    const side = path.join(ROOT, 'fixtures/fillet/jobs', `${id}.json`);
    const kernelV = fs.existsSync(side) ? JSON.parse(fs.readFileSync(side, 'utf8')).kernel?.volumeMm3 ?? null : null;
    const rec = {
      code: p.code, probe, verdict: r.verdict, featureStatus: r.onshape?.featureStatus ?? null, error: r.onshape?.error ?? null,
      referenceSha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    };
    if (part) {
      const [volume, volumeMin, volumeMax] = part.volume_mm3_value_min_max;
      Object.assign(rec, {
        volume, volumeMin, volumeMax, inputVolume: part.input_volume_mm3, deltaVolume: part.delta_volume_mm3,
        faces: part.face_count, faceTypes: part.face_types, faceAreasMesh: (part.faces ?? []).map((f) => [f.type, f.area_mm2_mesh]),
      });
      if (kernelV !== null) rec.inputVolumeRelErrVsKernel = Math.abs(part.input_volume_mm3 - kernelV) / kernelV;
    }
    if (cases[id]) throw new Error(`two probes for case ${id}`);
    cases[id] = rec;
  }
  return {
    schema: 'wonky-fillet-onshape-oracle/1',
    source: 'Onshape probes FP01-FP16 (cad-31 session, 2026-09-24): ~/Workspace/cad/cad-project-041/single-step-r20/kernel-cases/fp-*/reference.json (read only)',
    method: 'Onshape opFillet / opChamfer EQUAL_OFFSETS with Onshape defaults on the case\'s own FeatureScript input; mass properties (volume value, [min, max])',
    mapping: 'FP01-FP14: the catalogue case of the same id; FP15: ch-convex-120-hex-d1; FP16: ch-box-corner-3-d1 (identical input and selection)',
    cases: Object.fromEntries(Object.entries(cases).sort(([a], [b]) => (a < b ? -1 : 1))),
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const fresh = readProbes();
  const ref = JSON.parse(fs.readFileSync(REF, 'utf8'));
  if (process.argv.includes('--check')) {
    const same = JSON.stringify(ref.onshape) === JSON.stringify(fresh);
    console.log(same ? 'onshape oracle up to date' : 'onshape oracle differs from the probes');
    process.exit(same ? 0 : 1);
  }
  ref.onshape = fresh;
  fs.writeFileSync(REF, JSON.stringify(ref, null, 1) + '\n');
  for (const [id, r] of Object.entries(fresh.cases)) {
    console.log(`${r.code} ${id.padEnd(40)} ${r.verdict.padEnd(8)} ${r.error ?? ''}${r.deltaVolume !== undefined ? `dV ${r.deltaVolume.toFixed(6)} faces ${r.faces} input vs kernel ${r.inputVolumeRelErrVsKernel?.toExponential(1)}` : ''}`);
  }
  console.log(`wrote the onshape section of ${path.relative(ROOT, REF)}: ${Object.keys(fresh.cases).length} cases`);
}
