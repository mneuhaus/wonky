#!/usr/bin/env node
// Boolean bake-off TEST INFRASTRUCTURE: fixture job generator.
//
// Reads fixtures/bakeoff/cases.json, tessellates every leaf with
// scripts/bakeoff/tessellate.mjs and writes, per case:
//   <dir>/<case>.job       full job: tree, prims, face table, leaf meshes
//   <dir>/<case>.csg.job   same without meshes (input for 'csg' prototypes)
//   fixtures/bakeoff/jobs/<case>.json   sidecar: per-leaf counts, measured
//                                       deviation, hashes, where the job lives
// <dir> is fixtures/bakeoff/jobs for jobs up to SMALL_LIMIT bytes and the
// gitignored out/bakeoff/jobs for larger ones; those are regenerated on
// demand (ensureJobs) and verified against the sidecar sha256.
//
// Usage: node scripts/bakeoff/fixtures.mjs [--cases id,...] [--check]
//   --check  regenerate in memory and fail if any committed file differs.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodeJob } from './jobfmt.mjs';
import { analyticVolume, primParams, tessellateLeaf } from './tessellate.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const CASES_PATH = path.join(ROOT, 'fixtures/bakeoff/cases.json');
export const JOBS_DIR = path.join(ROOT, 'fixtures/bakeoff/jobs');
export const LARGE_JOBS_DIR = path.join(ROOT, 'out/bakeoff/jobs');
export const SMALL_LIMIT = 256 * 1024;

const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');

export function loadCases() {
  return JSON.parse(fs.readFileSync(CASES_PATH, 'utf8')).cases;
}

function collectLeaves(node, leaves) {
  if (node.prim) {
    leaves.push(node);
    return { leaf: leaves.length - 1 };
  }
  return { op: node.op, children: node.children.map((c) => collectLeaves(c, leaves)) };
}

// case -> {job, sidecar}
export function buildCase(c) {
  const leaves = [];
  const tree = collectLeaves(c.csg, leaves);
  const faces = [];
  const meshes = [];
  const prims = [];
  const leafInfo = [];
  leaves.forEach((leaf, index) => {
    const t = tessellateLeaf(leaf, c.deviationMm);
    if (t.deviation.measured > c.deviationMm) {
      throw new Error(`${c.id} leaf ${index} (${leaf.prim}): measured deviation ${t.deviation.measured} exceeds stated ${c.deviationMm}`);
    }
    const tagOf = new Map();
    for (const f of t.faces) {
      tagOf.set(f.faceIndex, faces.length);
      faces.push({ leaf: index, faceIndex: f.faceIndex, surface: f.surface });
    }
    meshes.push({ leaf: index, vertices: t.vertices, triangles: t.triangles.map(([a, b, cc, f]) => [a, b, cc, tagOf.get(f)]) });
    prims.push({ kind: leaf.prim, params: primParams(leaf), matrix: t.matrix });
    leafInfo.push({
      leaf: index,
      prim: leaf.prim,
      vertices: t.vertices.length,
      triangles: t.triangles.length,
      tags: [...tagOf.values()],
      segments: t.segments,
      minorSegments: t.minorSegments,
      deviationMeasuredMm: t.deviation.measured,
      deviationMethod: t.deviation.method,
      vertexOnSurfaceMaxMm: t.deviation.vertexOnSurfaceMax,
      sourceToleranceMm: t.deviation.sourceToleranceMm,
      analyticVolume: analyticVolume(leaf),
    });
  });
  const job = { id: c.id, deviation: c.deviationMm, tree, prims, faces, meshes };
  return { job, leafInfo };
}

export function jobPaths(id, large) {
  const dir = large ? LARGE_JOBS_DIR : JOBS_DIR;
  return {
    job: path.join(dir, `${id}.job`),
    csg: path.join(dir, `${id}.csg.job`),
    sidecar: path.join(JOBS_DIR, `${id}.json`),
  };
}

export function generateCase(c, { write = true } = {}) {
  const { job, leafInfo } = buildCase(c);
  const full = encodeJob(job);
  const csg = encodeJob(job, { meshes: false });
  const large = Buffer.byteLength(full) > SMALL_LIMIT;
  const p = jobPaths(c.id, large);
  const sidecar = {
    schema: 'wonky-bakeoff-fixture/1',
    case: c.id,
    category: c.category,
    deviationMm: c.deviationMm,
    location: large ? 'out/bakeoff/jobs (generated on demand, gitignored)' : 'fixtures/bakeoff/jobs',
    job: path.relative(ROOT, p.job),
    csgJob: path.relative(ROOT, p.csg),
    jobBytes: Buffer.byteLength(full),
    jobSha256: sha256(full),
    csgJobSha256: sha256(csg),
    leaves: leafInfo.length,
    faces: job.faces.length,
    vertices: leafInfo.reduce((s, l) => s + l.vertices, 0),
    triangles: leafInfo.reduce((s, l) => s + l.triangles, 0),
    deviationMeasuredMaxMm: Math.max(0, ...leafInfo.map((l) => l.deviationMeasuredMm)),
    leafInfo,
  };
  if (write) {
    fs.mkdirSync(path.dirname(p.job), { recursive: true });
    fs.mkdirSync(JOBS_DIR, { recursive: true });
    fs.writeFileSync(p.job, full);
    fs.writeFileSync(p.csg, csg);
    // A case that changed size class must not leave a stale copy behind.
    const other = jobPaths(c.id, !large);
    for (const f of [other.job, other.csg]) if (fs.existsSync(f)) fs.rmSync(f);
    fs.writeFileSync(p.sidecar, JSON.stringify(sidecar, null, 1) + '\n');
  }
  return { sidecar, full, csg };
}

export function readSidecar(id) {
  const file = jobPaths(id, false).sidecar;
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
}

// Make sure every requested job exists on disk and matches its sidecar hash;
// regenerate (deterministically) otherwise. Returns {id: {job, csg, sidecar}}.
export function ensureJobs(ids) {
  const cases = new Map(loadCases().map((c) => [c.id, c]));
  const out = {};
  for (const id of ids) {
    const c = cases.get(id);
    if (!c) throw new Error(`unknown case '${id}'`);
    let sc = readSidecar(id);
    const ok = sc && fs.existsSync(path.join(ROOT, sc.job)) && fs.existsSync(path.join(ROOT, sc.csgJob))
      && sha256(fs.readFileSync(path.join(ROOT, sc.job), 'utf8')) === sc.jobSha256
      && sha256(fs.readFileSync(path.join(ROOT, sc.csgJob), 'utf8')) === sc.csgJobSha256;
    if (!ok) sc = generateCase(c).sidecar;
    out[id] = { job: path.join(ROOT, sc.job), csg: path.join(ROOT, sc.csgJob), sidecar: sc };
  }
  return out;
}

function main(argv) {
  const arg = (name) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const only = arg('--cases')?.split(',').filter(Boolean);
  const check = argv.includes('--check');
  const cases = loadCases().filter((c) => !only || only.includes(c.id));
  if (only && cases.length !== only.length) throw new Error('unknown case id in --cases');
  let failed = 0;
  const index = [];
  for (const c of cases) {
    const t0 = performance.now();
    const { sidecar, full } = generateCase(c, { write: !check });
    if (check) {
      const committed = readSidecar(c.id);
      const same = committed && committed.jobSha256 === sidecar.jobSha256 && committed.csgJobSha256 === sidecar.csgJobSha256;
      if (!same) failed++;
      console.log(`${same ? 'same' : 'DIFF'} ${c.id}`);
      continue;
    }
    index.push({ case: c.id, job: sidecar.job, bytes: sidecar.jobBytes, triangles: sidecar.triangles, sha256: sidecar.jobSha256 });
    console.log(`${c.id.padEnd(28)} leaves ${String(sidecar.leaves).padStart(3)} faces ${String(sidecar.faces).padStart(4)} tris ${String(sidecar.triangles).padStart(6)} dev ${sidecar.deviationMeasuredMaxMm.toExponential(2)} ${(full.length / 1024).toFixed(0).padStart(6)} KiB ${((performance.now() - t0) / 1000).toFixed(2)} s${sidecar.location.startsWith('out') ? ' (out/)' : ''}`);
  }
  if (!check && !only) {
    // Drop files of cases that no longer exist.
    const keep = new Set(cases.map((c) => c.id));
    for (const dir of [JOBS_DIR, LARGE_JOBS_DIR]) {
      if (!fs.existsSync(dir)) continue;
      for (const f of fs.readdirSync(dir)) {
        const id = f.replace(/(\.csg\.job|\.job|\.json)$/, '');
        if (f !== 'index.json' && !keep.has(id)) fs.rmSync(path.join(dir, f));
      }
    }
    fs.writeFileSync(path.join(JOBS_DIR, 'index.json'), JSON.stringify({ schema: 'wonky-bakeoff-fixture-index/1', cases: index }, null, 1) + '\n');
  }
  if (failed) {
    console.error(`${failed} case(s) differ from the committed sidecars`);
    process.exit(1);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main(process.argv.slice(2));
}
