// Index of Onshape builds whose uploaded FeatureScript is byte-identical to a
// corpus file: Marc's upload tooling writes `<name>-state.json` / `state.json`
// with `builtHash` (SHA-256 of the uploaded Feature Studio source) and exports
// Onshape STEP next to it (`<name>-native.step`, STEP header
// originating_system 'ONSHAPE BY PTC INC'). reference.mjs matches by name only
// and misses these. Read-only over ~/Workspace/cad.
//
//   node scripts/corpus/verify/onshape-built-index.mjs  -> out/corpus/verify/onshape-built-index.json
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import { CORPUS_ROOT, OUT_DIR } from '../lib.mjs';

const targets = JSON.parse(readFileSync(join(OUT_DIR, 'targets.json'), 'utf8'));
const SKIP = new Set(['node_modules', '.git', '__pycache__', 'venv', '.venv', 'site-packages']);
const states = [];
const fsBySha = new Map();
(function walk(dir) {
  let entries; try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP.has(e.name)) walk(p); continue; }
    if (e.name.endsWith('.fs')) {
      const sha = createHash('sha256').update(readFileSync(p)).digest('hex');
      if (!fsBySha.has(sha)) fsBySha.set(sha, []);
      fsBySha.get(sha).push(relative(CORPUS_ROOT, p));
    } else if (e.name.endsWith('.json') && statSync(p).size < 5e6) {
      const text = readFileSync(p, 'utf8');
      if (!text.includes('"builtHash"')) continue;
      try { states.push({ path: p, json: JSON.parse(text) }); } catch {}
    }
  }
})(CORPUS_ROOT);

const isOnshapeStep = p => { try { return readFileSync(p, 'latin1').slice(0, 4000).includes('ONSHAPE BY PTC'); } catch { return false; } };
const rows = [];
for (const s of states) {
  const h = s.json.builtHash;
  if (typeof h !== 'string') continue;
  const stem = basename(s.path).replace(/-?state\.json$/, '');
  const dir = dirname(s.path);
  const steps = readdirSync(dir).filter(n => /\.(step|stp)$/i.test(n) && (!stem || n.startsWith(stem))).map(n => join(dir, n)).filter(isOnshapeStep);
  rows.push({ state: relative(CORPUS_ROOT, s.path), builtHash: h, uploadedHash: s.json.uploadedHash ?? null,
    sameUpload: s.json.uploadedHash === h, featureStatus: s.json.featureState?.featureStatus ?? null,
    sources: fsBySha.get(h) ?? [], onshapeSteps: steps.map(p => relative(CORPUS_ROOT, p)) });
}
const units = targets.units.filter(u => !u.anchor);
const byPath = new Map();
for (const r of rows) for (const src of r.sources) { if (!byPath.has(src)) byPath.set(src, []); byPath.get(src).push(r); }
const out = { schema: 'corpus-onshape-built-index/1', generatedAt: new Date().toISOString(), states: rows.length,
  withSource: rows.filter(r => r.sources.length).length, withSourceAndStep: rows.filter(r => r.sources.length && r.onshapeSteps.length).length,
  unitsCovered: units.filter(u => (byPath.get(u.path) ?? []).some(r => r.onshapeSteps.length)).map(u => u.key), rows };
writeFileSync(join(OUT_DIR, 'verify', 'onshape-built-index.json'), JSON.stringify(out, null, 1));
console.log(JSON.stringify({ states: out.states, withSource: out.withSource, withSourceAndStep: out.withSourceAndStep, unitsCovered: out.unitsCovered.length }));
