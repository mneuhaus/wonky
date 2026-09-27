// Aggregate the fillet/chamfer corpus analysis into out/fillet/corpus.json.
//
// Inputs (all produced by scripts/fillet/*):
//   tmp/fillet/static.json            static call sites (corpus-static.mjs)
//   tmp/fillet/b3d/*.json             build123d oracle probe (run-b3d-oracle.mjs)
//   tmp/fillet/fsocct-out/*.json      FeatureScript oracle probe (run-fsocct-oracle.mjs)
//   tmp/fillet/wonky/out/*.json       wonky production probe reach (wonky-probe.mjs)
//   tmp/fillet/wonky/analysis.json    wonky pre-blend geometry, analysed (wonky_analyze.py)
//   tmp/fillet/step/*.json            post-blend STEP reconstruction (step_blends.py)
//   out/corpus/targets.json, out/corpus/runs.jsonl + bench/*/runs.jsonl (wonky reach, FS)
//
// Usage: node scripts/fillet/corpus-report.mjs
import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const REPO = new URL('../..', import.meta.url).pathname;
const J = p => JSON.parse(readFileSync(join(REPO, p), 'utf8'));
const dirJson = d => (existsSync(join(REPO, d)) ? readdirSync(join(REPO, d)).filter(f => f.endsWith('.json')).map(f => J(join(d, f))) : []);
const targets = J('out/corpus/targets.json');
const fileInfo = new Map(targets.files.map(f => [f.path, f]));
const { sites } = J('tmp/fillet/static.json');

// ------------------------------------------------------------------ classification
const STRICT_EDGE = new Set(['line:plane/plane', 'circle:cylinder-section/plane', 'circle:plane/cylinder-section']);
const EXT_EDGE = new Set(['line:cylinder-generator/plane', 'line:cylinder-generator/cylinder', 'circle:cone-section/plane', 'circle:plane/cone-section',
  'circle:cylinder-section/cylinder-section', 'circle:cone-section/cylinder-section', 'circle:cylinder-section/cone-section', 'line:cylinder/plane']);
const angleBucket = (a, conv) => {
  if (a == null) return '?';
  if (conv === 'convex') return Math.abs(a - 90) < 0.5 ? '90' : a < 90 ? 'acute' : 'obtuse';
  if (conv === 'concave') return Math.abs(a - 270) < 0.5 ? '270' : a < 270 ? 'shallow-concave' : 'deep-concave';
  return conv;
};
function edgeKey(e) {
  const a = e.alphaDeg?.length ? e.alphaDeg[Math.floor(e.alphaDeg.length / 2)] : null;
  return `${e.relation} ${e.convexity} ${angleBucket(a, e.convexity)}`;
}
function edgeLevel(e) {
  if (!['convex', 'concave'].includes(e.convexity)) return 'general';
  if (STRICT_EDGE.has(e.relation)) return 'strict';
  if (EXT_EDGE.has(e.relation)) return 'extended';
  return 'general';
}
function vertexLevel(v, kind) {
  const c = v.class;
  if (/mixed/.test(c)) return 'general';
  // equal-offset chamfers of two plane/plane edges meet in a planar mitre: trivial
  if (kind === 'chamfer' && /^corner-2-of-3/.test(c)) return 'strict';
  if (c === 'free-end/perpendicular-cap' || c === 'closed-loop-seam') return 'strict';
  if (/^tangent-chain/.test(c)) return 'strict';
  if (c === 'corner-3') return 'strict'; // three plane/plane edges, same convexity, equal radius: spherical patch
  if (c === 'free-end/oblique-planar-cap' || c === 'free-end/curved-cap' || /^corner-2-of-3/.test(c)) return 'extended';
  return 'general';
}
function callLevel(cfg, kind) {
  const lv = { strict: 0, extended: 1, general: 2 };
  let worst = 'strict';
  const bump = l => { if (lv[l] > lv[worst]) worst = l; };
  for (const e of cfg.edges) bump(edgeLevel(e));
  for (const v of cfg.vertices) bump(vertexLevel(v, kind));
  // face consumption: blend as wide as the adjacent face (face vanishes / overflow)
  if (cfg.edges.some(e => (e.sizeOverWidth ?? []).some(x => x != null && x >= 0.999))) bump('general');
  return worst;
}
function callClass(cfg, kind) {
  // coarse, human-readable configuration label for the ranking
  const rel = [...new Set(cfg.edges.map(e => `${e.relation} ${e.convexity}`))].sort();
  const vc = [...new Set(cfg.vertices.map(v => v.class.replace(/\/val\d+/, '')))].sort();
  return `${kind}: ${rel.join(' + ')} || ${vc.join(' + ')}`;
}

// OCCT/build123d periodic faces carry a seam edge (one face on both sides). Parasolid
// (Onshape) has none, so a seam in a selection is a kernel artifact of "all edges"
// queries, not a blend the part needs. Drop selected seams and treat the valence-2
// vertex where a closed rim meets its seam as the rim's seam vertex. Counted.
const seamStats = { edges: 0, calls: 0, files: new Set() };
function cleanSeams(cfg, path) {
  const seams = cfg.edges.filter(e => /nonmanifold-or-seam\(1\)/.test(e.relation));
  if (!seams.length) return cfg;
  seamStats.edges += seams.length; seamStats.calls++; seamStats.files.add(path);
  return { ...cfg, nSelected: cfg.nSelected - seams.length, edges: cfg.edges.filter(e => !seams.includes(e)),
    vertices: cfg.vertices.map(v => (v.valence === 2 && (v.selectedConvexity ?? []).includes('unknown')) ? { ...v, class: 'closed-loop-seam', seamArtifact: true } : v) };
}

// ------------------------------------------------------------------ geometry records
const calls = []; // normalized blend invocations with a config
const reach = new Map(); // path -> {source -> {...}}
const setReach = (path, src, v) => { if (!reach.has(path)) reach.set(path, {}); reach.get(path)[src] = v; };

for (const r of dirJson('tmp/fillet/b3d')) {
  setReach(r.path, 'build123d', { status: r.status, error: r.error ?? null, records: r.records.length, counts2d: r.counts2d ?? null });
  const root = r.path; // caller.file is relative to the mirrored project root
  for (const x of r.records) {
    if (!x.config) continue;
    calls.push({ source: 'build123d-oracle', label: 'MEASURED (oracle: build123d 0.13 / OCCT)', path: r.path, family: fileInfo.get(r.path)?.family,
      frontend: 'py', kind: x.kind, size: x.size, site: x.caller ? `${x.caller.file}:${x.caller.line}` : null, occt: x.occt, cfg: cleanSeams(x.config, r.path) });
  }
}
for (const r of dirJson('tmp/fillet/fsocct-out')) {
  const path = r.path.split('fs-src/')[1];
  const key = `${path}#${r.feature}`;
  setReach(key, 'fsocct', { status: r.status, error: r.error ?? null, records: r.records.length });
  for (const x of r.records) {
    if (!x.config) continue;
    calls.push({ source: 'fsocct-oracle', label: 'MEASURED (oracle: fsocct / OCCT 7.9, Onshape imports removed, UI defaults implied)', path, feature: r.feature,
      family: fileInfo.get(path)?.family, frontend: 'fs', kind: x.kind, size: x.size, site: (x.id ?? []).join('/'), occt: x.occt, cfg: cleanSeams(x.config, path) });
  }
}
const wonkyAnalysis = existsSync(join(REPO, 'tmp/fillet/wonky/analysis.json')) ? J('tmp/fillet/wonky/analysis.json') : [];
for (const r of dirJson('tmp/fillet/wonky/out')) setReach(r.path, 'wonky', { probed: r.calls.length, stop: r.stop });
const wonkyCalls = wonkyAnalysis.filter(r => r.config).map(r => ({ source: 'wonky-production', label: 'MEASURED (wonky production CLI; STEP analysed with OCP)', path: r.path,
  family: fileInfo.get(r.path)?.family, frontend: 'py', kind: r.kind, size: r.size, k: r.k, line: r.line, omittedBefore: r.omittedBefore, cfg: cleanSeams(r.config, r.path) }));

// STEP reconstructions (post-blend) -> pseudo configs
const stepMeta = existsSync(join(REPO, 'tmp/fillet/step/index.json')) ? J('tmp/fillet/step/index.json') : [];
const stepCalls = [];
for (const m of stepMeta) {
  if (!m.out || !existsSync(join(REPO, m.out))) continue;
  const s = J(m.out);
  for (const sol of s.solids) {
    const edges = (sol.fillets ?? []).filter(f => f.relation && f.relation !== 'corner:sphere').map(f => ({
      relation: f.relation.replace('line:plane/plane', 'line:plane/plane').replace(/^line:cylinder\/plane$/, 'line:cylinder-generator/plane')
        .replace(/^circle:cylinder\/plane$/, 'circle:cylinder-section/plane'),
      convexity: f.convexity, alphaDeg: [f.alphaDeg], kind: 'fillet' }));
    const chs = (sol.chamfers ?? []).map(c => ({ relation: c.relation === 'circle:cone45' ? 'circle:cylinder-section/plane' : c.relation, convexity: 'convex', alphaDeg: [c.alphaDeg ?? 90], kind: 'chamfer' }));
    const verts = [];
    for (const f of sol.fillets ?? []) {
      if (f.relation === 'corner:sphere') { verts.push({ class: 'corner-3' }); continue; }
      for (const c of f.caps ?? []) verts.push({ class: c.perpendicular ? 'free-end/perpendicular-cap' : 'free-end/oblique-planar-cap' });
      const bs = (f.ends ?? []).filter(e => e === 'blend/sharp').length; for (let i = 0; i < bs; i++) verts.push({ class: 'corner-2-of-3', half: true });
      const bg = (f.ends ?? []).filter(e => e === 'blend/g1').length; for (let i = 0; i < bg; i++) verts.push({ class: 'tangent-chain', half: true });
      if ((f.ends ?? []).some(e => e.startsWith('patch:'))) verts.push({ class: 'corner-patch(setback/2D-round?)' });
    }
    for (const [kind, es] of [['fillet', edges], ['chamfer', chs]]) {
      if (!es.length) continue;
      stepCalls.push({ source: 'step-reconstruction', label: 'INFERRED (post-blend STEP reconstruction, OCP)', path: m.path, family: fileInfo.get(m.path)?.family,
        frontend: m.frontend, kind, size: null, step: m.step, cfg: { edges: es, vertices: kind === 'fillet' ? verts : [], chains: [] } });
    }
  }
}

// ------------------------------------------------------------------ primary geometry per file
// Priority: oracle (complete call sequence incl. earlier blends) > wonky (first call exact,
// later calls with omitted blends) > STEP reconstruction (post-blend, inferred).
const primary = [];
const byPath = new Map();
for (const c of calls) { if (!byPath.has(c.path)) byPath.set(c.path, []); byPath.get(c.path).push(c); }
for (const c of wonkyCalls) if (!byPath.has(c.path)) { byPath.set(c.path, []); }
for (const [p, cs] of byPath) primary.push(...(cs.length ? cs : wonkyCalls.filter(w => w.path === p)));
const coveredFamilies = new Set(primary.map(x => x.family));
for (const c of stepCalls) if (!coveredFamilies.has(c.family)) primary.push(c);

// ------------------------------------------------------------------ static aggregates
const live = sites.filter(s => s.reachable);
const fam = xs => new Set(xs.map(x => x.family)).size, fil = xs => new Set(xs.map(x => x.path)).size;
const sizeHist = {};
for (const s of live) for (const v of (s.sizeVia === 'helper-param' ? (s.extra.helperCalls ?? []).filter(h => h.reachable).map(h => h.value) : s.sizeValuesMm)) {
  const k = `${s.kind} ${v == null ? '?' : +Number(v).toFixed(3)}`; sizeHist[k] ??= { calls: 0, files: new Set(), families: new Set() };
  sizeHist[k].calls++; sizeHist[k].files.add(s.path); sizeHist[k].families.add(s.family);
}
const selHist = {};
for (const s of live) for (const k of (s.selection.length ? s.selection : ['unclassified'])) {
  const key = `${s.frontend} ${k}`; selHist[key] ??= { sites: 0, files: new Set(), families: new Set() };
  selHist[key].sites++; selHist[key].files.add(s.path); selHist[key].families.add(s.family);
}
const ctx = { inLoop: live.filter(s => s.inLoop).length, inTry: live.filter(s => s.inTry).length, inIf: live.filter(s => s.inIf).length };

// ------------------------------------------------------------------ geometric aggregates
function rank(items, keyFn) {
  const m = new Map();
  for (const c of items) for (const k of keyFn(c)) {
    if (!m.has(k)) m.set(k, { key: k, calls: 0, edges: 0, files: new Set(), families: new Set(), sources: new Set() });
    const r = m.get(k); r.calls++; r.files.add(c.path); r.families.add(c.family); r.sources.add(c.source);
  }
  return [...m.values()].map(r => ({ key: r.key, calls: r.calls, files: r.files.size, families: r.families.size, sources: [...r.sources] }))
    .sort((a, b) => b.families - a.families || b.files - a.files || b.calls - a.calls);
}
const edgeCount = {}; // edges per key
for (const c of primary) for (const e of c.cfg.edges) { const k = `${c.kind} ${edgeKey(e)}`; edgeCount[k] = (edgeCount[k] ?? 0) + 1; }
const edgeRank = rank(primary, c => [...new Set(c.cfg.edges.map(e => `${c.kind} ${edgeKey(e)}`))]).map(r => ({ ...r, edges: edgeCount[r.key] ?? 0, level: null }));
for (const r of edgeRank) { const rel = r.key.split(' ')[1]; const conv = r.key.split(' ')[2]; r.level = edgeLevel({ relation: rel, convexity: conv }); }
const vertRank = rank(primary, c => [...new Set(c.cfg.vertices.map(v => `${c.kind} ${v.class.replace(/\/val\d+/, '')}`))]).map(r => ({ ...r, level: vertexLevel({ class: r.key.split(' ').slice(1).join(' ') }, r.key.split(' ')[0]) }));
const callRank = rank(primary, c => [callClass(c.cfg, c.kind)]);
const levels = { strict: [], extended: [], general: [] };
for (const c of primary) levels[callLevel(c.cfg, c.kind)].push(c);
// file/family level: worst call level per file/family
const worstBy = keyf => {
  const m = new Map(); const lv = { strict: 0, extended: 1, general: 2 };
  for (const c of primary) { const k = keyf(c); const l = callLevel(c.cfg, c.kind); if (!m.has(k) || lv[l] > lv[m.get(k)]) m.set(k, l); }
  const out = { strict: 0, extended: 0, general: 0 }; for (const l of m.values()) out[l]++; return { ...out, total: m.size };
};
const ratioStats = (() => {
  const xs = []; for (const c of primary) for (const e of c.cfg.edges) for (const x of e.sizeOverWidth ?? []) if (x != null) xs.push(x);
  xs.sort((a, b) => a - b); const q = p => xs.length ? xs[Math.min(xs.length - 1, Math.floor(p * xs.length))] : null;
  return { n: xs.length, p50: q(0.5), p90: q(0.9), p99: q(0.99), max: xs.at(-1) ?? null, over05: xs.filter(x => x > 0.5).length, over1: xs.filter(x => x >= 0.999).length };
})();
const edgesPerCall = (() => { const xs = primary.map(c => c.cfg.edges.length).sort((a, b) => a - b); return { n: xs.length, median: xs[Math.floor(xs.length / 2)] ?? null, max: xs.at(-1) ?? null }; })();
const occt = { ok: calls.filter(c => c.occt === 'ok').length, failed: calls.filter(c => c.occt === 'failed').length };
const occtFailures = rank(calls.filter(c => c.occt === 'failed'), c => [callClass(c.cfg, c.kind)]);

// wonky vs oracle agreement on the first call of a file (no blends omitted)
const agreement = [];
const usedRefs = new Set();
for (const w of wonkyCalls) {
  // same model line, kind and size; first oracle record not matched yet
  const base = w.path.split('/').pop();
  const ref = calls.find(c => c.path === w.path && c.source === 'build123d-oracle' && !usedRefs.has(c) && c.kind === w.kind
    && Math.abs((c.size ?? 0) - (w.size ?? 0)) < 1e-9 && c.site === `${base}:${w.line}`)
    ?? calls.find(c => c.path === w.path && c.source === 'build123d-oracle' && !usedRefs.has(c) && c.kind === w.kind
      && Math.abs((c.size ?? 0) - (w.size ?? 0)) < 1e-9 && String(c.site ?? '').endsWith(`:${w.line}`));
  if (!ref) { agreement.push({ path: w.path, k: w.k, line: w.line, verdict: 'no-oracle-record' }); continue; }
  usedRefs.add(ref);
  const sig = cfg => JSON.stringify([cfg.nSelected, cfg.edges.map(edgeKey).sort(), cfg.vertices.map(v => v.class).sort()]);
  agreement.push({ path: w.path, k: w.k, line: w.line, omittedBefore: w.omittedBefore, verdict: sig(w.cfg) === sig(ref.cfg) ? 'agree' : 'differ',
    wonky: { n: w.cfg.nSelected, edges: w.cfg.edges.map(edgeKey), vertices: w.cfg.vertices.map(v => v.class) },
    oracle: { n: ref.cfg.nSelected, edges: ref.cfg.edges.map(edgeKey), vertices: ref.cfg.vertices.map(v => v.class) } });
}

// wonky reach for FS units (latest corpus run record per unit)
const fsReach = [];
{
  const runFiles = [join(REPO, 'out/corpus/runs.jsonl'), ...readdirSync(join(REPO, 'out/corpus/bench')).map(d => join(REPO, 'out/corpus/bench', d, 'runs.jsonl'))].filter(existsSync);
  const latest = new Map();
  for (const f of runFiles) for (const line of readFileSync(f, 'utf8').split('\n')) {
    if (!line.trim()) continue; let r; try { r = JSON.parse(line); } catch { continue; }
    const t = Date.parse(r.startedAt ?? 0); const k = r.key; if (!latest.has(k) || latest.get(k).t < t) latest.set(k, { t, r });
  }
  const fsFiles = new Set(live.filter(s => s.frontend === 'fs').map(s => s.path));
  for (const [k, { r }] of latest) if (fsFiles.has(r.path)) fsReach.push({ key: k, family: r.family, status: r.status, completedOperations: r.completedOperations, message: String(r.message ?? '').slice(0, 160), reachedFillet: /opFillet|opChamfer/.test(String(r.message ?? '')) });
}

const uniq = (arr, f) => [...new Set(arr.map(f))];
const set2 = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { ...v, files: v.files.size, families: v.families.size }]));
const report = {
  schema: 'wonky-fillet-corpus/1', generatedAt: new Date().toISOString(),
  population: {
    note: 'unique modeling files and families from out/corpus/targets.json (SHA-256 dedup; families = union-find Jaccard>=0.6 of token 5-shingles)',
    staticSites: sites.length, reachableSites: live.length,
    filesAnySite: fil(sites), familiesAnySite: fam(sites), filesReachable: fil(live), familiesReachable: fam(live),
    files3d: fil(live.filter(s => s.dim === '3d')), families3d: fam(live.filter(s => s.dim === '3d')),
    byFrontend: Object.fromEntries(['fs', 'py'].map(fe => [fe, { files: fil(live.filter(s => s.frontend === fe)), families: fam(live.filter(s => s.frontend === fe)), sites: live.filter(s => s.frontend === fe).length }])),
    byKind: Object.fromEntries(['fillet', 'chamfer'].map(k => [k, { files: fil(live.filter(s => s.kind === k && s.dim === '3d')), families: fam(live.filter(s => s.kind === k && s.dim === '3d')), sites: live.filter(s => s.kind === k && s.dim === '3d').length }])),
    twoD: { sites: live.filter(s => s.dim === '2d').length, files: fil(live.filter(s => s.dim === '2d')) },
    deadHelperSites: sites.filter(s => !s.reachable).length, deadHelperFiles: fil(sites.filter(s => !s.reachable)),
    context: ctx,
  },
  sizes: set2(sizeHist), selection: set2(selHist),
  geometry: {
    sources: {
      'build123d-oracle': { files: uniq(calls.filter(c => c.source === 'build123d-oracle'), c => c.path).length, calls: calls.filter(c => c.source === 'build123d-oracle').length },
      'fsocct-oracle': { files: uniq(calls.filter(c => c.source === 'fsocct-oracle'), c => c.path).length, calls: calls.filter(c => c.source === 'fsocct-oracle').length },
      'wonky-production': { files: uniq(wonkyCalls, c => c.path).length, calls: wonkyCalls.length },
      'step-reconstruction': { files: uniq(stepCalls, c => c.path).length, calls: stepCalls.length },
    },
    primaryCalls: primary.length, primaryFiles: uniq(primary, c => c.path).length, primaryFamilies: uniq(primary, c => c.family).length,
    edgesPerCall, sizeOverWidth: ratioStats, occt, occtFailures,
    analyticShare: {
      definition: 'strict = every edge line:plane/plane or circle:cylinder-section/plane (convex or concave), every end vertex free-end with perpendicular cap / closed loop / G1 chain / corner-3 of same convexity, no blend as wide as an adjacent face; extended = also plane/cylinder-generator lines, cone/cylinder circle sections, oblique planar caps, two-edge corners (mitre) of same convexity; general = rest (mixed convexity vertices, >3-edge corners, free-form, face consumption, smooth or non-manifold edges)',
      calls: { strict: levels.strict.length, extended: levels.extended.length, general: levels.general.length, total: primary.length },
      files: worstBy(c => c.path), families: worstBy(c => c.family),
    },
    rankEdges: edgeRank, rankVertices: vertRank, rankCalls: callRank.slice(0, 60),
    wonkyVsOracle: agreement,
    seamArtifacts: { edges: seamStats.edges, calls: seamStats.calls, files: [...seamStats.files] },
  },
  reach: { perFile: Object.fromEntries(reach), fsUnitsWonky: fsReach },
};
mkdirSync(join(REPO, 'out/fillet'), { recursive: true });
writeFileSync(join(REPO, 'out/fillet/corpus.json'), JSON.stringify(report, null, 1));
writeFileSync(join(REPO, 'tmp/fillet/primary-calls.json'), JSON.stringify(primary.map(c => ({ ...c, level: callLevel(c.cfg, c.kind), cls: callClass(c.cfg, c.kind) })), null, 1));
console.log(JSON.stringify({ population: report.population, sources: report.geometry.sources, analytic: report.geometry.analyticShare, occt }, null, 1));
