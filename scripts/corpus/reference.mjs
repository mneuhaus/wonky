// Compare successful corpus builds against exported reference geometry
// (STEP/STL exported by Onshape, Fusion or build123d) in the same project.
//
// Matching (documented in docs/corpus/run.md):
//   candidates  = *.step/*.stp/*.stl inside the unit's project (hidden dirs,
//                 node_modules, venvs skipped), never files written by wonky.
//   names       = source file stem, selected feature name, and wonky body names,
//                 each normalized to lowercase alphanumerics.
//   score       = 10 exact name equality | 6 containment (both sides >= 5 chars)
//               + 3 same directory or below the source directory
//               + 1 anywhere else under the source's parent directory
//               + 0.5 STEP (exact B-rep) over STL (mesh)
//   accepted    = score >= 9, i.e. an exact name match anywhere in the project,
//                 or a containment match in/below the source directory.
//   Ties keep the nearest path. Unmatched units report "no reference".
// Measurement: scripts/corpus/measure.py through `uv run` (OCP oracle only).
// Both the reference and wonky's own exported STEP are measured the same way.
// Tolerances: STEP ref: volume 0.1 % relative, bbox extents 0.05 mm.
//             STL ref:  volume 1 % relative,   bbox extents 0.2 mm (mesh chords).
// Position (bbox min corner) is compared separately; a size/volume match at a
// different position is reported as "agree-shifted", not as agreement.
//
// Usage: node scripts/corpus/reference.mjs [--label <name>]
//   without --label: baseline runs -> out/corpus/reference.json
//   with --label:    out/corpus/bench/<name>/runs.jsonl -> out/corpus/bench/<name>/reference.json
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { basename, dirname, extname, join, relative } from 'node:path';
import { REPO, CORPUS_ROOT, runPaths } from './lib.mjs';

const labelArg = process.argv.includes('--label') ? process.argv[process.argv.indexOf('--label') + 1] : null;
const { runs: RUNS, dir: OUT_DIR } = runPaths(labelArg);

const SKIP = new Set(['node_modules', 'vendor', 'site-packages', '__pycache__', 'venv', 'dist-packages']);
const norm = s => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const refsByProject = new Map();
function projectRefs(project) {
  if (refsByProject.has(project)) return refsByProject.get(project);
  const out = [];
  const visit = dir => {
    let entries; try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) { if (!SKIP.has(e.name)) visit(p); continue; }
      if (e.isFile() && /\.(step|stp|stl)$/i.test(e.name)) out.push(relative(CORPUS_ROOT, p));
    }
  };
  visit(join(CORPUS_ROOT, project));
  refsByProject.set(project, out);
  return out;
}

const latest = new Map();
for (const line of readFileSync(RUNS, 'utf8').split('\n')) {
  if (!line.trim()) continue;
  try { const r = JSON.parse(line); latest.set(r.key, r); } catch {}
}
const oks = [...latest.values()].filter(r => r.status === 'ok' && !r.key.startsWith('ANCHOR:'));

function match(r) {
  const srcDir = dirname(r.path);
  const names = [basename(r.path, extname(r.path)), r.feature, ...(r.bodies ?? []).map(b => b.name)]
    .filter(Boolean).map(n => ({ raw: n, n: norm(n) })).filter(x => x.n.length >= 3);
  let best = null;
  for (const ref of projectRefs(r.project)) {
    const stem = norm(basename(ref, extname(ref)));
    let nameScore = 0, rule = null;
    for (const { raw, n } of names) {
      if (stem === n) { if (nameScore < 10) { nameScore = 10; rule = `exact:${raw}`; } }
      else if (n.length >= 5 && stem.length >= 5 && (stem.includes(n) || n.includes(stem))) { if (nameScore < 6) { nameScore = 6; rule = `contains:${raw}`; } }
    }
    if (!nameScore) continue;
    const refDir = dirname(ref);
    const loc = refDir === srcDir || refDir.startsWith(srcDir + '/') ? 3 : refDir.startsWith(dirname(srcDir) + '/') || refDir === dirname(srcDir) ? 1 : 0;
    const score = nameScore + loc + (/\.(step|stp)$/i.test(ref) ? 0.5 : 0);
    const dist = relative(srcDir, refDir).split('/').length;
    if (!best || score > best.score || (score === best.score && dist < best.dist)) best = { ref, score, rule, loc, dist };
  }
  return best && best.score >= 9 ? best : (best ? { ...best, rejected: true } : null);
}

const matches = oks.map(r => ({ r, m: match(r) }));
const toMeasure = new Set();
for (const { r, m } of matches) {
  if (m && !m.rejected) toMeasure.add(join(CORPUS_ROOT, m.ref));
  if (m && !m.rejected && r.step) toMeasure.add(r.step);
}
let measured = {};
if (toMeasure.size) {
  const run = spawnSync('uv', ['run', '--quiet', join(REPO, 'scripts/corpus/measure.py')], { input: JSON.stringify([...toMeasure]), encoding: 'utf8', maxBuffer: 1 << 28 });
  if (run.status !== 0) throw new Error(`measure.py failed: ${run.stderr.slice(-2000)}`);
  measured = JSON.parse(run.stdout);
}

const size = b => b && b.max.map((x, i) => x - b.min[i]);
const rows = matches.map(({ r, m }) => {
  const base = { key: r.key, path: r.path, feature: r.feature, family: r.family, wonky: { bodies: r.totals.bodies, faces: r.totals.faces, edges: r.totals.edges, volumeMm3: r.totals.volumeMm3, bboxMm: r.totals.bboxMm } };
  if (!m) return { ...base, verdict: 'no-reference', note: 'no STEP/STL in the project matches the file, feature or body names' };
  if (m.rejected) return { ...base, verdict: 'no-reference', note: `best candidate ${m.ref} (${m.rule}, score ${m.score}) below the acceptance score 9` };
  const ref = measured[join(CORPUS_ROOT, m.ref)], own = r.step ? measured[r.step] : null;
  if (!ref || ref.error) return { ...base, reference: m.ref, match: m.rule, verdict: 'reference-unreadable', note: ref?.error ?? 'not measured' };
  const isStep = ref.kind === 'step';
  const tol = isStep ? { volumeRel: 1e-3, extentMm: 0.05, positionMm: 0.05 } : { volumeRel: 1e-2, extentMm: 0.2, positionMm: 0.2 };
  const vol = r.totals.volumeMm3;
  const volumeRel = vol == null ? null : Math.abs(vol - ref.volumeMm3) / Math.max(ref.volumeMm3, 1e-9);
  const ext = size(r.totals.bboxMm), rext = size(ref.bboxMm);
  const extentDiff = ext && rext ? Math.max(...ext.map((x, i) => Math.abs(x - rext[i]))) : null;
  const posDiff = r.totals.bboxMm && ref.bboxMm ? Math.max(...r.totals.bboxMm.min.map((x, i) => Math.abs(x - ref.bboxMm.min[i]))) : null;
  const shapeAgrees = volumeRel != null && volumeRel <= tol.volumeRel && extentDiff != null && extentDiff <= tol.extentMm;
  const verdict = shapeAgrees ? (posDiff <= tol.positionMm ? 'agree' : 'agree-shifted') : 'disagree';
  return {
    ...base, reference: m.ref, referenceKind: ref.kind, match: m.rule, matchScore: m.score,
    referenceMeasured: ref, wonkyStepMeasured: own ?? null,
    diff: { volumeRel, extentMaxMm: extentDiff, positionMaxMm: posDiff }, tolerance: tol, verdict,
  };
});
const counts = rows.reduce((c, x) => ({ ...c, [x.verdict]: (c[x.verdict] ?? 0) + 1 }), {});
writeFileSync(join(OUT_DIR, 'reference.json'), JSON.stringify({ schema: 'wonky-corpus-reference/1', generatedAt: new Date().toISOString(), counts, rows }, null, 1));
console.log(JSON.stringify(counts));
