#!/usr/bin/env node
// Fillet harness TEST INFRASTRUCTURE: builds every case's input body with the
// wonky kernel (src/index.mjs build(), the production FeatureScript path, JS
// backend) and writes
//   fixtures/fillet/jobs/<id>.job     the job text (scripts/fillet/brepfmt.mjs)
//   fixtures/fillet/jobs/<id>.json    sidecar: job sha256, kernel volume/area,
//                                     resolved edges with a sample point each
//   out/fillet/input-step/<id>.step   the input body through src/exporters.mjs
//                                     toStep, for the OCCT oracle
//   fixtures/fillet/jobs/index.json   build summary
// It computes no blend. Edge selectors are resolved geometrically against the
// built body (docs/fillet/harness.md, "Selectors").
//
//   node scripts/fillet/fixtures.mjs [--cases a,b] [--check]

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodeJob, quantizationError } from './brepfmt.mjs';
import { ROOT, loadCases } from './cases.mjs';
import { curvePoint, dist, dot, edgeConvexity, edgeInterval, edgeLength, edgeSamples, edgeUses, normaliseBody, pointEdgeDistance, sub, unit } from './geom.mjs';

export const JOBS_DIR = path.join(ROOT, 'fixtures/fillet/jobs');
export const STEP_DIR = path.join(ROOT, 'out/fillet/input-step');
const TOL = 1e-6;
const sha256 = (x) => crypto.createHash('sha256').update(x).digest('hex');

const isSeam = (uses) => uses.length === 2 && uses[0].face === uses[1].face;

function segDist(p, a, b) {
  const ab = sub(b, a), t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / dot(ab, ab)));
  return dist(p, [a[0] + ab[0] * t, a[1] + ab[1] * t, a[2] + ab[2] * t]);
}

export function resolveSelection(body, select) {
  const uses = edgeUses(body), picked = new Set();
  const candidates = body.edges.map((e, i) => i).filter((i) => !isSeam(uses[i]));
  const samples = (i) => edgeSamples(body.edges[i], body.vertices, 16).map((s) => s.p);
  for (const s of select) {
    let hit;
    if (s.near) {
      hit = candidates.filter((i) => pointEdgeDistance(body.edges[i], body.vertices, s.near) < TOL);
      if (hit.length !== 1) throw new Error(`selector near ${JSON.stringify(s.near)} matched ${hit.length} edges`);
    } else if (s.all) {
      hit = candidates;
    } else if (s.parallel) {
      const ax = unit(s.parallel);
      hit = candidates.filter((i) => body.edges[i].curve.type === 'line' && Math.abs(dot(unit(body.edges[i].curve.direction), ax)) > 1 - 1e-12);
    } else if (s.inPlane) {
      const n = unit(s.inPlane.normal);
      hit = candidates.filter((i) => samples(i).every((p) => Math.abs(dot(sub(p, s.inPlane.point), n)) < TOL));
    } else if (s.segment) {
      hit = candidates.filter((i) => body.edges[i].curve.type === 'line' && samples(i).every((p) => segDist(p, s.segment.a, s.segment.b) < TOL));
      const covered = hit.reduce((L, i) => L + edgeLength(body.edges[i], body.vertices, 2), 0);
      if (Math.abs(covered - dist(s.segment.a, s.segment.b)) > TOL) throw new Error(`selector segment covers ${covered} of ${dist(s.segment.a, s.segment.b)} mm`);
    } else throw new Error(`unknown selector ${JSON.stringify(s)}`);
    if (!hit.length) throw new Error(`selector ${JSON.stringify(s)} matched no edge`);
    hit.forEach((i) => picked.add(i));
  }
  return [...picked].sort((a, b) => a - b);
}

let buildFn = null;
async function kernelBuild(source) {
  buildFn ??= (await import('../../src/index.mjs')).build;
  return buildFn(source, { feature: 'filletInput', trace: false });
}

export async function generateCase(c) {
  const t0 = performance.now();
  const model = await kernelBuild(c.input.source);
  const buildMs = performance.now() - t0;
  if (model.bodies.length !== 1) throw new Error(`${c.id}: the snippet produced ${model.bodies.length} bodies`);
  const raw = model.bodies[0];
  const body = normaliseBody(raw);
  const select = resolveSelection(body, c.select);
  const uses = edgeUses(body);
  const bad = uses.map((u, i) => [u.length, i]).filter(([n]) => n !== 2);
  if (bad.length) throw new Error(`${c.id}: input edges not used exactly twice: ${bad.slice(0, 5).map(([n, i]) => `e${i}:${n}`).join(' ')}`);
  const edges = select.map((i) => {
    const e = body.edges[i], cx = edgeConvexity(body, i, uses);
    const { t0: a, t1: b } = edgeInterval(e, body.vertices);
    return { edge: i, curve: e.curve.type, faces: uses[i].map((u) => body.faces[u.face].surface.type), convexity: cx.convexity,
      dihedralDeg: cx.dihedralDeg, length: edgeLength(e, body.vertices), sample: curvePoint(e.curve, (a + b) / 2) };
  });
  const seen = [...new Set(edges.map((e) => e.convexity))];
  const unexpected = seen.filter((x) => !c.convexity.includes(x));
  if (unexpected.length) throw new Error(`${c.id}: selected edges are ${seen.join('/')}, case states ${c.convexity.join('/')} (normal convention or selector wrong)`);
  const job = encodeJob({ id: c.id, op: c.op, size: c.size, chamferType: c.chamferType, tangentPropagation: c.tangentPropagation, body, select });
  const { toStep } = await import('../../src/exporters.mjs');
  const { version } = JSON.parse(fs.readFileSync(path.join(ROOT, 'bend.lock.json'), 'utf8'));
  const step = toStep({ bodies: [raw], backend: { version } }, c.id);
  const v = raw.validation ?? {};
  const sidecar = {
    id: c.id, jobSha256: sha256(job), jobBytes: job.length, sourceSha256: sha256(c.input.source), buildMs,
    kernel: { closed: v.closed ?? null, volumeMm3: v.volumeMm3 ?? null, areaMm2: v.areaMm2 ?? null, precision: raw.precision, geometry: raw.geometry ?? 'planar' },
    counts: { vertices: body.vertices.length, edges: body.edges.length, faces: body.faces.length },
    surfaces: body.faces.reduce((m, f) => ({ ...m, [f.surface.type]: (m[f.surface.type] ?? 0) + 1 }), {}),
    quantizationErrorMm: quantizationError(body),
    selected: edges,
    step: path.relative(ROOT, path.join(STEP_DIR, `${c.id}.step`)),
  };
  return { job, sidecar, step };
}

export function jobPath(id) {
  return path.join(JOBS_DIR, `${id}.job`);
}

export function readSidecar(id) {
  const p = path.join(JOBS_DIR, `${id}.json`);
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null;
}

async function main(argv) {
  const only = argv.includes('--cases') ? argv[argv.indexOf('--cases') + 1].split(',') : null;
  const check = argv.includes('--check');
  const cases = loadCases().filter((c) => !only || only.includes(c.id));
  fs.mkdirSync(JOBS_DIR, { recursive: true });
  fs.mkdirSync(STEP_DIR, { recursive: true });
  const indexPath = path.join(JOBS_DIR, 'index.json');
  const index = fs.existsSync(indexPath) ? JSON.parse(fs.readFileSync(indexPath, 'utf8')) : { schema: 'wonky-fillet-jobs/1', cases: {} };
  let failures = 0;
  for (const c of cases) {
    try {
      const { job, sidecar, step } = await generateCase(c);
      if (check) {
        const old = readSidecar(c.id);
        const same = old?.jobSha256 === sidecar.jobSha256;
        if (!same) failures++;
        console.log(`${c.id.padEnd(44)} ${same ? 'same' : 'CHANGED'}`);
        continue;
      }
      fs.writeFileSync(jobPath(c.id), job);
      fs.writeFileSync(path.join(JOBS_DIR, `${c.id}.json`), JSON.stringify(sidecar, null, 1) + '\n');
      fs.writeFileSync(path.join(ROOT, sidecar.step), step);
      index.cases[c.id] = { ok: true, jobSha256: sidecar.jobSha256, counts: sidecar.counts, selected: sidecar.selected.length, volumeMm3: sidecar.kernel.volumeMm3 };
      console.log(`${c.id.padEnd(44)} ${String(sidecar.counts.faces).padStart(3)}f ${String(sidecar.selected.length).padStart(3)} edges ${sidecar.selected.map((e) => e.convexity[0] + e.dihedralDeg.toFixed(1)).slice(0, 4).join(' ')} vol ${sidecar.kernel.volumeMm3?.toFixed(6)} ${sidecar.buildMs.toFixed(0)}ms`);
    } catch (err) {
      failures++;
      index.cases[c.id] = { ok: false, error: err.message.slice(0, 400) };
      console.log(`${c.id.padEnd(44)} FAILED ${err.message.slice(0, 300)}`);
    }
  }
  if (!check) {
    index.generatedAt = new Date().toISOString();
    fs.writeFileSync(indexPath, JSON.stringify(index, null, 1) + '\n');
  }
  if (failures) {
    console.log(`${failures} case(s) ${check ? 'changed or failed' : 'failed'}`);
    process.exit(1);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(err.stack ?? err.message);
    process.exit(1);
  });
}
