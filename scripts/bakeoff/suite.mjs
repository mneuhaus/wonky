#!/usr/bin/env node
// Boolean bake-off TEST INFRASTRUCTURE: prepares an extra case set (e.g. a
// verifier's fixtures/bakeoff/adversarial-*.json) as a suite directory that
// scripts/bakeoff/run.mjs --suite <dir> runs exactly like the corpus:
//
//   <dir>/cases.json            the cases whose fixtures could be generated
//   <dir>/jobs/<id>.job         full job (harness tessellation, buildCase)
//   <dir>/jobs/<id>.csg.job     job without meshes (csg prototypes)
//   <dir>/results/<id>.result   manifold3d result dump (recover-mode source)
//   <dir>/reference.json        OCCT exact CSG + manifold3d, with the job hash
//   <dir>/suite.json            source file, fixture errors, leaf validity
//
// The oracles are the harness's own reference.py functions, run through
// scripts/bakeoff/recover-extra.py (uv, PEP 723 pins). Nothing here computes
// production geometry.
//
//   node scripts/bakeoff/suite.mjs <cases.json> <dir> [--no-oracle]

import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, buildCase } from './fixtures.mjs';
import { encodeJob } from './jobfmt.mjs';
import { validateMesh } from './validate.mjs';

const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');

export function prepareSuite(casesFile, dir, { oracle = true } = {}) {
  const doc = JSON.parse(fs.readFileSync(casesFile, 'utf8'));
  fs.mkdirSync(path.join(dir, 'jobs'), { recursive: true });
  const fixtureErrors = {};
  const leafInvalid = {};
  const kept = [];
  const hashes = {};
  for (const c of doc.cases) {
    let built;
    try {
      built = buildCase(c);
    } catch (err) {
      fixtureErrors[c.id] = err.message;
      continue;
    }
    const { job } = built;
    const bad = [];
    for (const m of job.meshes) {
      const v = validateMesh({ vertices: m.vertices, triangles: m.triangles }, { faces: job.faces, deviation: c.deviationMm });
      if (!v.valid) bad.push({ leaf: m.leaf, issues: v.issues.slice(0, 3) });
    }
    if (bad.length) leafInvalid[c.id] = bad;
    const full = encodeJob(job);
    fs.writeFileSync(path.join(dir, 'jobs', `${c.id}.job`), full);
    fs.writeFileSync(path.join(dir, 'jobs', `${c.id}.csg.job`), encodeJob(job, { meshes: false }));
    hashes[c.id] = sha256(full);
    kept.push(c);
  }
  fs.writeFileSync(path.join(dir, 'cases.json'), JSON.stringify({ source: path.relative(ROOT, casesFile), cases: kept }, null, 1) + '\n');
  fs.writeFileSync(path.join(dir, 'suite.json'), JSON.stringify({ schema: 'wonky-bakeoff-suite/1', source: path.relative(ROOT, casesFile), cases: kept.length, fixtureErrors, leafInvalid }, null, 1) + '\n');
  if (oracle) {
    const r = spawnSync('uv', ['run', '--quiet', 'scripts/bakeoff/recover-extra.py', dir], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 26 });
    if (r.status !== 0) throw new Error(`oracle failed: ${r.stderr.slice(-3000)}`);
    const ref = JSON.parse(fs.readFileSync(path.join(dir, 'reference.json'), 'utf8'));
    for (const [id, e] of Object.entries(ref.cases)) e.jobSha256 = hashes[id];
    ref.generator = 'node scripts/bakeoff/suite.mjs (uv run scripts/bakeoff/recover-extra.py)';
    fs.writeFileSync(path.join(dir, 'reference.json'), JSON.stringify(ref, null, 1) + '\n');
  }
  return { cases: kept.length, fixtureErrors, leafInvalid };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const [casesFile, dir] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  if (!casesFile || !dir) {
    console.error('usage: node scripts/bakeoff/suite.mjs <cases.json> <dir> [--no-oracle]');
    process.exit(2);
  }
  const s = prepareSuite(path.resolve(casesFile), path.resolve(dir), { oracle: !process.argv.includes('--no-oracle') });
  console.log(JSON.stringify(s, null, 1));
}
