// Aggregate the per-file corpus facts into out/lang/corpus.json.
//
// Inputs (produced by scan-fs.mjs / scan-py.mjs):
//   tmp/lang/fs-facts.json, tmp/lang/py-facts.json
// Usage: node scripts/lang/corpus-report.mjs [out=out/lang/corpus.json]
//
// Populations are reported three ways: all files, unique files (exact
// duplicates removed by SHA-256) and design families (near-duplicate clusters,
// Jaccard >= 0.6 on token 5-shingles; the most recently modified member
// represents the family). Families are the fairest unit because Marc's
// revisions (r19 -> r20 -> ...) are kept as copies.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const outPath = process.argv[2] ?? join(repo, 'out/lang/corpus.json');
const fsFacts = JSON.parse(readFileSync(join(repo, 'tmp/lang/fs-facts.json'), 'utf8'));
const pyFacts = JSON.parse(readFileSync(join(repo, 'tmp/lang/py-facts.json'), 'utf8'));
const load = execSync('uptime').toString().trim().replace(/^.*load averages?: /, '');

// ---------------------------------------------------------------- helpers
const pct = (n, d) => (d ? Math.round((1000 * n) / d) / 10 : 0);
const uniqueBySha = rows => [...new Map(rows.map(r => [r.sha, r])).values()];
const familyReps = rows => {
  const m = new Map();
  for (const r of rows) { const cur = m.get(r.family); if (!cur || r.mtime > cur.mtime) m.set(r.family, r); }
  return [...m.values()];
};
const views = rows => ({ files: rows, unique: uniqueBySha(rows), families: familyReps(rows) });
const share = (v, pred) => Object.fromEntries(Object.entries(v).map(([k, rows]) => {
  const n = rows.filter(pred).length; return [k, { n, of: rows.length, pct: pct(n, rows.length) }];
}));
// Frequency table of string keys per file: {key: {files, unique, families, total}}
function freq(v, keysOf, totalOf = null) {
  const out = new Map();
  for (const [view, rows] of Object.entries(v)) for (const r of rows) {
    for (const k of new Set(keysOf(r))) {
      const e = out.get(k) ?? { files: 0, unique: 0, families: 0, total: 0 };
      e[view]++; out.set(k, e);
    }
  }
  if (totalOf) for (const r of v.files) for (const [k, n] of Object.entries(totalOf(r) ?? {})) if (out.has(k)) out.get(k).total += n;
  return [...out].sort((a, b) => b[1].families - a[1].families || b[1].unique - a[1].unique || a[0].localeCompare(b[0]))
    .map(([key, e]) => ({ key, ...e }));
}

// ---------------------------------------------------------------- sync levels
// Level of a synchronization site. The ladder answers: what must a core
// representation express so that the frontend never has to block on the kernel?
//   1 lazy-query        kernel-resolved queries only (FS q*, inline b3d selector chains)
//   2 check             assertions / reports on geometry (deferrable, never steer modeling)
//   3 guard             "skip op when selection is empty" (total ops or a conditional node)
//   4 measured-dataflow measured values feed op parameters (arithmetic nodes over measurements)
//   5 host-selection    host code picks entities from evaluated lists (5a declarative predicate, 5b complex)
//   6 per-entity-map    loop over an evaluated selection applying the same ops to each element,
//                       no break/try/loop-carried state (a map region over a query result)
//   7 geo-control-flow  branch or sequential loop over geometry that changes which geometry ops run
// Failure recovery (try/catch that changes modeling) is tracked as a separate flag.
const LEVEL_NAMES = { 0: 'none', 1: 'lazy-query', 2: 'check', 3: 'guard', 4: 'measured-dataflow', 5: 'host-selection', 6: 'per-entity-map', 7: 'geo-control-flow' };
function fsSiteLevel(s) {
  if (s.kind === 'geo-branch') {
    if (s.sub === 'assert') return 2;
    if (s.sub === 'emptiness-guard') return 3;
    if (s.geomOp) return s.inMap ? 6 : 7;
    if (s.selects || s.filter) return 5;
    return 2;
  }
  if (s.kind === 'geo-iterate') {
    if (s.geomOp) return s.carried ? 7 : 6;
    if (s.selects) return 5;
    return 2;
  }
  if (s.kind === 'geo-data') {
    if (!s.geomOp) return s.sub === 'measure-param' ? 2 : 1; // metadata writes (names/colors)
    return s.sub === 'measure-param' ? 4 : 5;
  }
  if (s.kind === 'meta-branch') return s.sub === 'assert' ? 2 : 5;
  if (s.kind === 'meta-iterate') return 5;
  return 0;
}
const fsFailure = s => s.kind === 'failure-branch' && ['try-recover', 'try-silent-block', 'try-no-catch', 'try-result'].includes(s.sub);
function pySiteLevel(s) {
  if (s.kind === 'geo-branch') {
    if (s.sub === 'assert') return 2;
    if (s.sub === 'emptiness-guard') return 3;
    if (s.modelingInBranch) return s.inMap ? 6 : 7;
    if (s.selects || s.filter) return 5;
    return 2;
  }
  if (s.kind === 'geo-iterate') {
    if (s.sub === 'measured-values' || s.sub === 'static-trip') return s.modelingInBody ? 4 : 2;
    if (s.sub === 'comprehension-map') return s.modelingInBody ? 6 : (s.selects ? 5 : 2);
    if (s.sub === 'while-bound') return s.modelingInBody ? 7 : 2;
    if (s.modelingInBody) return s.carried ? 7 : 6;
    if (s.selects) return 5;
    return 2;
  }
  if (s.kind === 'geo-select') return 5;
  if (s.kind === 'geo-data') {
    if (s.sub === 'measure-param') return 4;
    if (s.sub === 'predicate-selection') return 5;
    return s.inline ? 1 : 5;
  }
  return 0;
}
const pyFailure = s => s.kind === 'failure-branch' && s.sub === 'try-recover';
const isComplexPred = s => s.pred === 'complex';

function ladder(v, levelOf, failureOf, baseLevel, reachableOnly) {
  const perFile = r => {
    const sites = (r.sites ?? []).filter(s => !reachableOnly || s.reachable !== false);
    let level = baseLevel(r), complex = false, failure = false, sync = 0;
    const need = new Set();
    for (const s of sites) {
      const l = levelOf(s);
      if (l > level) level = l;
      if (l >= 5 && isComplexPred(s)) complex = true;
      if (l >= 4) sync++;
      if (l === 2) need.add('checks');
      if (l === 3) need.add('emptyGuards');
      if (l === 4) need.add('measureArithmetic');
      if (l === 5) need.add(isComplexPred(s) ? 'generalPredicates' : 'declarativePredicates');
      if (l === 6) need.add('mapRegions');
      if (l === 7) need.add('generalControlFlow');
      if (failureOf(s)) { failure = true; need.add('failureCombinators'); }
    }
    return { level, complex, failure, sync, need };
  };
  const out = {};
  for (const [view, rows] of Object.entries(v)) {
    const facts = rows.map(perFile);
    const n = rows.length;
    const dist = {};
    for (let l = 0; l <= 7; l++) dist[`${l}-${LEVEL_NAMES[l]}`] = { n: facts.filter(f => f.level === l).length };
    for (const e of Object.values(dist)) e.pct = pct(e.n, n);
    const at5 = facts.filter(f => f.level === 5);
    const general = facts.filter(f => f.level === 7 || f.complex).length;
    const simple = facts.filter(f => f.level <= 3 && !f.failure).length;
    const lazy = n - general - simple;
    const requirement = k => { const m = facts.filter(f => f.need.has(k)).length; return { n: m, pct: pct(m, n) }; };
    const syncs = facts.map(f => f.sync).sort((a, b) => a - b);
    out[view] = {
      of: n, levels: dist,
      level5split: { declarativePredicates: at5.filter(f => !f.complex).length, complexPredicates: at5.filter(f => f.complex).length },
      failureRecovery: { n: facts.filter(f => f.failure).length, pct: pct(facts.filter(f => f.failure).length, n) },
      // Non-exclusive: which IR capability does each file need at least once?
      requirements: Object.fromEntries(['checks', 'emptyGuards', 'measureArithmetic', 'declarativePredicates', 'mapRegions', 'failureCombinators', 'generalPredicates', 'generalControlFlow'].map(k => [k, requirement(k)])),
      verdict: {
        simpleGraph: { n: simple, pct: pct(simple, n), meaning: 'levels 0-3 and no failure handling: a plain op graph with check nodes and total (empty-tolerant) ops' },
        lazyIr: { n: lazy, pct: pct(lazy, n), meaning: 'needs some of: arithmetic over measurements, declarative predicate queries, map regions over a query result, optional/orElse failure combinators; still one submission, no host round trip' },
        generalLanguage: { n: general, pct: pct(general, n), meaning: 'level 7 or a complex predicate: sequential control flow or arbitrary code over kernel results; a split host<->kernel design blocks here, a kernel-side language does not' },
      },
      staticSyncSitesPerFile: { median: syncs[Math.floor(syncs.length / 2)] ?? 0, p90: syncs[Math.floor(syncs.length * 0.9)] ?? 0, max: syncs.at(-1) ?? 0, total: syncs.reduce((a, b) => a + b, 0) },
    };
  }
  return out;
}

// ---------------------------------------------------------------- coverage curves
// A file is covered by construct set S when every construct it uses is in S.
function coverage(rows, constructsOf) {
  const sets = rows.map(r => new Set(constructsOf(r)));
  const counts = new Map();
  for (const s of sets) for (const c of s) counts.set(c, (counts.get(c) ?? 0) + 1);
  const n = rows.length;
  // Frequency-ordered prefix curve.
  const order = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([c]) => c);
  const rank = new Map(order.map((c, i) => [c, i + 1]));
  const need = sets.map(s => Math.max(0, ...[...s].map(c => rank.get(c))));
  const freqCurve = [];
  for (let k = 1; k <= order.length; k++) freqCurve.push([k, need.filter(x => x <= k).length]);
  const kFor = (curve, target) => (curve.find(([, c]) => c >= target * n) ?? [null])[0];
  // Greedy: repeatedly add the missing constructs of the uncovered file that
  // maximizes newly covered files per added construct.
  const chosen = new Set(), covered = new Array(n).fill(false), greedyCurve = [[0, 0]], steps = [];
  const missing = i => [...sets[i]].filter(c => !chosen.has(c));
  let coveredCount = 0;
  for (let i = 0; i < n; i++) if (!sets[i].size) { covered[i] = true; coveredCount++; }
  while (coveredCount < n) {
    let best = null;
    const candidates = new Map();
    for (let i = 0; i < n; i++) if (!covered[i]) { const m = missing(i); candidates.set(m.sort().join('\u0001'), m); }
    for (const m of candidates.values()) {
      const add = new Set(m); let gain = 0;
      for (let j = 0; j < n; j++) if (!covered[j]) { let ok = true; for (const c of sets[j]) if (!chosen.has(c) && !add.has(c)) { ok = false; break; } if (ok) gain++; }
      const score = gain / Math.max(1, m.length);
      if (!best || score > best.score || (score === best.score && m.length < best.m.length)) best = { m, gain, score };
    }
    for (const c of best.m) chosen.add(c);
    for (let j = 0; j < n; j++) if (!covered[j] && [...sets[j]].every(c => chosen.has(c))) { covered[j] = true; coveredCount++; }
    greedyCurve.push([chosen.size, coveredCount]);
    steps.push({ added: best.m, size: chosen.size, covered: coveredCount });
  }
  const greedyAt = target => {
    const i = greedyCurve.findIndex(([, c]) => c >= target * n);
    const size = greedyCurve[i][0];
    const set = new Set(); for (const s of steps) { if (s.size > size) break; for (const c of s.added) set.add(c); }
    return { constructs: size, set: [...set].sort((a, b) => (counts.get(b) - counts.get(a)) || a.localeCompare(b)) };
  };
  const at = t => ({ frequencyOrdered: kFor(freqCurve, t), greedy: greedyAt(t).constructs });
  return {
    files: n, universe: order.length,
    for50: at(0.5), for80: at(0.8), for95: at(0.95), for100: at(1),
    set80: greedyAt(0.8).set, set95: greedyAt(0.95).set,
    greedyCurve: greedyCurve.map(([k, c]) => [k, pct(c, n)]),
    frequencyCurve: freqCurve.filter(([k]) => k <= 40 || k % 10 === 0 || k === order.length).map(([k, c]) => [k, pct(c, n)]),
  };
}

// ---------------------------------------------------------------- FeatureScript
const fsModel = fsFacts.files.filter(r => r.role === 'feature' || r.role === 'library');
const fsV = views(fsModel);
const fsAll = fsFacts.files;
const fsCats = name => (
  /^op[A-Z]/.test(name) ? 'op (kernel operation)'
    : /^sk[A-Z]/.test(name) ? 'sk (sketch)'
      : /^f[A-Z]/.test(name) ? 'f (std primitive feature)'
        : /^q[A-Z]/.test(name) ? 'q (lazy query)'
          : name === 'evaluateQuery' || name === 'isQueryEmpty' ? 'evaluateQuery (topology read-back)'
            : /^ev[A-Z]/.test(name) ? 'ev (measurement read-back)'
              : /^(defineFeature|newSketch|newSketchOnPlane|instantiate|newInstantiator|addInstance|setProperty|getProperty|setAttribute|getAttribute|getAttributes|setVariable|getVariable|regenError|reportFeature\w*|makeRobustQuery|startFeature|endFeature|lastModifyingOperationId|makeId|newId|setFeatureComputedParameter)$/.test(name) ? 'feature API / context'
                : /^(vector|plane|line|transform|rotationAround|matrix|coordSystem|toWorld|fromWorld|mirrorAcross|box3d|identityTransform|identityMatrix|cross|dot|norm|normalize|squaredNorm|planeToWorld|worldToPlane|xyPlane|yzPlane|xzPlane|worldPlane|perpendicularVector|rotationMatrix3d|scaleUniformly|zeroVector|unitVector|angleBetween|project|inverse|transpose|circularPattern|linearPattern)$/.test(name) ? 'geometry value (vectors, planes, transforms)'
                  : 'value / std library');
const callKeys = r => Object.keys(r.calls ?? {}).filter(k => k.startsWith('call:')).map(k => k.slice(5));
const fsCallTable = freq(fsV, callKeys, r => Object.fromEntries(Object.entries(r.calls ?? {}).filter(([k]) => k.startsWith('call:')).map(([k, v]) => [k.slice(5), v])));
const fsCategoryTable = (() => {
  const m = new Map();
  for (const e of fsCallTable) {
    const c = fsCats(e.key); const x = m.get(c) ?? { category: c, distinct: 0, calls: 0, familiesUsingAny: new Set() };
    x.distinct++; x.calls += e.total; m.set(c, x);
  }
  for (const r of fsV.families) for (const k of callKeys(r)) m.get(fsCats(k)).familiesUsingAny.add(r.family);
  return [...m.values()].map(x => ({ ...x, familiesUsingAny: x.familiesUsingAny.size, familiesPct: pct(x.familiesUsingAny.size, fsV.families.length) }))
    .sort((a, b) => b.calls - a.calls);
})();
const fsSyntaxTable = freq(fsV, r => Object.keys(r.constructs ?? {}).filter(k => k.startsWith('syntax:')).map(k => k.slice(7)),
  r => Object.fromEntries(Object.entries(r.constructs ?? {}).filter(([k]) => k.startsWith('syntax:')).map(([k, v]) => [k.slice(7), v])));
const fsEnumTable = freq(fsV, r => Object.keys(r.constructs ?? {}).filter(k => k.startsWith('enum:')).map(k => k.slice(5))).slice(0, 60);
const fsUnitTable = freq(fsV, r => Object.keys(r.constructs ?? {}).filter(k => k.startsWith('unit:')).map(k => k.slice(5)));
const fsOpParams = (() => {
  const m = new Map();
  for (const r of fsV.unique) for (const [op, keys] of Object.entries(r.opParams ?? {})) {
    const e = m.get(op) ?? {}; for (const [k, n] of Object.entries(keys)) e[k] = (e[k] ?? 0) + n; m.set(op, e);
  }
  return Object.fromEntries([...m].filter(([op]) => /^(op|ev|sk)/.test(op)).sort((a, b) => a[0].localeCompare(b[0])));
})();
const fsHelperNames = freq(fsV, r => (r.functionNames ?? []).map(n => n.toLowerCase())).slice(0, 60);
const fsConstructs = r => [
  ...Object.keys(r.constructs ?? {}).filter(k => (k.startsWith('syntax:') && !['syntax:userCall', 'syntax:importedCall'].includes(k)) || k.startsWith('unit:')),
  ...callKeys(r).map(k => `call:${k}`),
];
const fsFeaturesOnly = r => fsConstructs(r).filter(k => k.startsWith('call:') && /^call:(op|sk|f|q|ev)[A-Z]|^call:evaluateQuery$|^call:newSketch/.test(k));
const fsControl = share(fsV, r => ['forIn', 'forInKeyed', 'forC', 'while'].some(k => r.constructs?.[`syntax:${k}`]));

const fsReport = {
  population: {
    files: fsAll.length,
    byRole: Object.fromEntries(Object.entries(fsAll.reduce((m, r) => ({ ...m, [r.role]: (m[r.role] ?? 0) + 1 }), {}))),
    modelingFiles: { files: fsV.files.length, unique: fsV.unique.length, families: fsV.families.length },
    generated: Object.fromEntries(Object.entries(fsModel.reduce((m, r) => ({ ...m, [r.generated ?? 'handwritten']: (m[r.generated ?? 'handwritten'] ?? 0) + 1 }), {}))),
    lines: { total: fsAll.reduce((a, r) => a + r.lines, 0), medianModelingFile: [...fsV.unique].map(r => r.lines).sort((a, b) => a - b)[Math.floor(fsV.unique.length / 2)] },
    evalLambdas: fsAll.filter(r => r.role === 'eval').length,
    parseFailures: fsAll.filter(r => r.parseError).map(r => ({ path: r.path, role: r.role, error: r.parseError })),
  },
  constructShares: {
    loops: fsControl,
    geometryReadBack: share(fsV, r => (r.counts?.geoSourceCalls ?? 0) > 0),
    lambdas: share(fsV, r => (r.counts?.lambdas ?? 0) > 0),
    capturingClosures: share(fsV, r => (r.counts?.closures ?? 0) > 0),
    recursion: share(fsV, r => (r.counts?.recursion ?? 0) > 0),
    boxes: share(fsV, r => r.constructs?.['syntax:newBox'] || r.constructs?.['syntax:unbox']),
    tryAny: share(fsV, r => ['tryCatch', 'trySilentBlock', 'tryNoCatch', 'tryExpr', 'trySilentExpr'].some(k => r.constructs?.[`syntax:${k}`])),
    trySilent: share(fsV, r => r.constructs?.['syntax:trySilentBlock'] || r.constructs?.['syntax:trySilentExpr']),
    documentImports: share(fsV, r => (r.imports?.document ?? 0) > 0),
    instantiator: share(fsV, r => r.calls?.['call:newInstantiator']),
    userFunctions: share(fsV, r => (r.counts?.functions ?? 0) > 0),
    typeOrPredicateDecls: share(fsV, r => (r.counts?.types ?? 0) + (r.counts?.predicates ?? 0) + (r.counts?.operators ?? 0) > 0),
    enumDecls: share(fsV, r => (r.counts?.enums ?? 0) > 0),
    mapLiterals: share(fsV, r => r.constructs?.['syntax:mapLiteral']),
    preconditionsWithBody: share(fsV, r => (r.constructs?.['syntax:precondition'] ?? 0) > 0),
    loopsGeometryIndependent: (() => { let t = 0, g = 0; for (const r of fsV.unique) { t += r.loops?.total ?? 0; g += r.loops?.geometryDependent ?? 0; } return { loops: t, geometryDependent: g, independentPct: pct(t - g, t) }; })(),
    getSetVariable: share(fsV, r => r.calls?.['call:getVariable'] || r.calls?.['call:setVariable']),
    attributes: share(fsV, r => r.calls?.['call:setAttribute'] || r.calls?.['call:getAttribute'] || r.calls?.['call:getAttributes']),
  },
  callCategories: fsCategoryTable,
  calls: fsCallTable,
  syntax: fsSyntaxTable,
  enums: fsEnumTable,
  units: fsUnitTable,
  opParams: fsOpParams,
  helperFunctionNames: fsHelperNames,
  sync: ladder(fsV, fsSiteLevel, fsFailure, r => ((r.calls && Object.keys(r.calls).some(k => /^call:q[A-Z]/.test(k))) ? 1 : 0), true),
  predicateKinds: (() => {
    const m = {};
    for (const r of fsV.unique) for (const s of r.sites ?? []) if (s.reachable && s.kind === 'geo-branch' && s.pred && (s.selects || s.filter)) m[s.pred] = (m[s.pred] ?? 0) + 1;
    return m;
  })(),
  coverage: {
    allConstructs: { unique: coverage(fsV.unique, fsConstructs), families: coverage(fsV.families, fsConstructs) },
    kernelVocabularyOnly: { unique: coverage(fsV.unique, fsFeaturesOnly), families: coverage(fsV.families, fsFeaturesOnly) },
  },
};

// ---------------------------------------------------------------- Python / build123d
const pyAll = pyFacts.files;
const pyModel = pyAll.filter(r => r.role === 'b3d-model');
const pyV = views(pyModel);
const pyChecks = views(pyAll.filter(r => r.role === 'b3d-check'));
const vocab = JSON.parse(readFileSync(join(repo, 'fixtures/lang/b3d-vocab.json'), 'utf8'));
const b3dNameTable = freq(pyV, r => Object.keys(r.b3dNames ?? {}), r => r.b3dNames).map(e => ({ ...e, category: vocab.categories[e.key] }));
const b3dMemberTable = freq(pyV, r => Object.keys(r.members ?? {}), r => r.members).slice(0, 60);
// ShapeList inherits Python list methods; those say nothing about CAD semantics.
const LIST_METHODS = new Set(['append', 'insert', 'extend', 'pop', 'sort', 'index', 'copy', 'write', 'remove', 'clear', 'count', 'reverse', 'read']);
const cadMethods = r => Object.keys(r.methods ?? {}).filter(m => !LIST_METHODS.has(m));
const b3dMethodTable = freq(pyV, cadMethods, r => r.methods).slice(0, 80);
const b3dPropTable = freq(pyV, r => Object.keys(r.props ?? {}), r => r.props);
const pyConstructTable = freq(pyV, r => Object.keys(r.constructs ?? {}), r => r.constructs);
const pyCheckMethods = freq(pyChecks, r => [...cadMethods(r).map(m => `.${m}()`), ...Object.keys(r.props ?? {}).map(p => `.${p}`)]).slice(0, 30);
const pyHelperNames = freq(pyV, r => (r.functionNames ?? []).map(n => n.toLowerCase().replace(/^_+/, ''))).slice(0, 50);
const has = (r, k) => (r.constructs?.[k] ?? 0) > 0;
const MODEL_PY = new Set(['py:for', 'py:while', 'py:if', 'py:ternary', 'py:function', 'py:nestedFunction', 'py:lambda', 'py:comprehension',
  'py:comprehensionFilter', 'py:dictComprehension', 'py:class', 'py:dataclass', 'py:method', 'py:recursion', 'py:try', 'py:raise', 'py:assert',
  'py:generator', 'py:match', 'py:numpy', 'py:math', 'py:starred', 'py:varargs', 'py:defaultArgs', 'py:globalNonlocal', 'py:walrus', 'py:dictLiteral', 'py:namedtuple', 'py:enumClass']);
const pyConstructs = r => [
  ...Object.keys(r.b3dNames ?? {}).map(k => `b3d:${k}`),
  ...Object.keys(r.members ?? {}).map(k => `member:${k}`),
  ...cadMethods(r).map(k => `.${k}()`),
  ...Object.keys(r.props ?? {}).map(k => `.${k}`),
  ...Object.keys(r.constructs ?? {}).filter(k => MODEL_PY.has(k) || /^b3d:(builderMode|algebraMode|with:|algebra:|mode:|shapelistOp|select)/.test(k)),
];
const pyReport = {
  population: {
    files: pyAll.length,
    byRole: Object.fromEntries(Object.entries(pyAll.reduce((m, r) => ({ ...m, [r.role ?? 'parse-error']: (m[r.role ?? 'parse-error'] ?? 0) + 1 }), {}))),
    b3dModel: { files: pyV.files.length, unique: pyV.unique.length, families: pyV.families.length },
    b3dCheck: { files: pyChecks.files.length, unique: pyChecks.unique.length, families: pyChecks.families.length },
    cadquery: pyAll.filter(r => (r.imports ?? []).includes('cadquery')).length,
    build123dImports: pyAll.filter(r => (r.imports ?? []).includes('build123d')).length,
    cadKhanaImports: pyAll.filter(r => (r.imports ?? []).includes('cad_khana')).length,
    ocpImports: pyAll.filter(r => (r.imports ?? []).includes('OCP')).length,
    fusionFiles: pyAll.filter(r => r.role === 'fusion').length,
    featureScriptGenerators: pyAll.filter(r => r.fsText).length,
    parseFailures: pyAll.filter(r => r.parseError).map(r => ({ path: r.path, error: r.parseError })),
    lines: { b3dModelTotal: pyV.files.reduce((a, r) => a + r.lines, 0), medianB3dModel: [...pyV.unique].map(r => r.lines).sort((a, b) => a - b)[Math.floor(pyV.unique.length / 2)] },
  },
  modes: {
    builderOnly: share(pyV, r => has(r, 'b3d:builderMode') && !has(r, 'b3d:algebraMode')),
    algebraOnly: share(pyV, r => has(r, 'b3d:algebraMode') && !has(r, 'b3d:builderMode')),
    mixed: share(pyV, r => has(r, 'b3d:builderMode') && has(r, 'b3d:algebraMode')),
    directApiOnly: share(pyV, r => !has(r, 'b3d:builderMode') && !has(r, 'b3d:algebraMode')),
    sketchBuilder: share(pyV, r => has(r, 'b3d:with:BuildSketch')),
    lineBuilder: share(pyV, r => has(r, 'b3d:with:BuildLine')),
    locationContexts: share(pyV, r => has(r, 'b3d:withLocation')),
    modeKeyword: share(pyV, r => Object.keys(r.constructs ?? {}).some(k => k.startsWith('b3d:mode:'))),
    placementByMultiplication: share(pyV, r => has(r, 'b3d:algebra:place')),
    selectorOperators: share(pyV, r => Object.keys(r.constructs ?? {}).some(k => k.startsWith('b3d:shapelistOp'))),
    filterByAxisOrType: share(pyV, r => Object.keys(r.constructs ?? {}).some(k => /^b3d:filter_by:(Axis|GeomType|Plane)/.test(k))),
    filterByLambda: share(pyV, r => has(r, 'b3d:filter_by:lambda') || has(r, 'b3d:sort_by:lambda') || has(r, 'b3d:group_by:lambda')),
    sortOrGroupBy: share(pyV, r => Object.keys(r.constructs ?? {}).some(k => /^b3d:(sort_by|group_by):/.test(k))),
    selectLast: share(pyV, r => Object.keys(r.constructs ?? {}).some(k => k.startsWith('b3d:select:'))),
    exports: share(pyV, r => has(r, 'b3d:export')),
    importsGeometry: share(pyV, r => has(r, 'b3d:importGeometry')),
    viewer: share(pyV, r => has(r, 'b3d:viewer')),
    ocpDirect: share(pyV, r => (r.imports ?? []).includes('OCP')),
    cadKhana: share(pyV, r => (r.imports ?? []).includes('cad_khana')),
  },
  pythonFeatures: {
    functions: share(pyV, r => has(r, 'py:function')),
    nestedFunctions: share(pyV, r => has(r, 'py:nestedFunction')),
    lambdas: share(pyV, r => has(r, 'py:lambda')),
    comprehensions: share(pyV, r => has(r, 'py:comprehension') || has(r, 'py:dictComprehension')),
    comprehensionFilters: share(pyV, r => has(r, 'py:comprehensionFilter')),
    classes: share(pyV, r => has(r, 'py:class')),
    dataclasses: share(pyV, r => has(r, 'py:dataclass')),
    subclassesBuild123d: share(pyV, r => Object.keys(r.constructs ?? {}).some(k => k.startsWith('py:subclassB3d:'))),
    recursion: share(pyV, r => has(r, 'py:recursion')),
    generators: share(pyV, r => has(r, 'py:generator')),
    tryExcept: share(pyV, r => has(r, 'py:try')),
    numpy: share(pyV, r => has(r, 'py:numpy') || (r.imports ?? []).includes('numpy')),
    math: share(pyV, r => has(r, 'py:math') || (r.imports ?? []).includes('math')),
    typeHints: share(pyV, r => has(r, 'py:typeHints')),
    fstrings: share(pyV, r => has(r, 'py:fstring')),
    whileLoops: share(pyV, r => has(r, 'py:while')),
    match: share(pyV, r => has(r, 'py:match')),
    globalOrNonlocal: share(pyV, r => has(r, 'py:globalNonlocal')),
    subprocess: share(pyV, r => has(r, 'py:subprocess') || (r.imports ?? []).includes('subprocess')),
  },
  b3dNames: b3dNameTable,
  members: b3dMemberTable,
  methods: b3dMethodTable,
  measurementProperties: b3dPropTable,
  pythonConstructs: pyConstructTable,
  checkScriptVocabulary: pyCheckMethods,
  helperFunctionNames: pyHelperNames,
  sync: ladder(pyV, pySiteLevel, pyFailure, r => (Object.keys(r.methods ?? {}).some(m => ['faces', 'edges', 'vertices', 'solids', 'wires', 'filter_by', 'sort_by', 'group_by'].includes(m)) ? 1 : 0), false),
  predicateKinds: (() => {
    const m = {};
    for (const r of pyV.unique) for (const s of r.sites ?? []) if (s.pred && ((s.kind === 'geo-iterate' && s.sub === 'comprehension-filter') || s.kind === 'geo-select' || (s.kind === 'geo-branch' && (s.selects || s.filter)))) m[s.pred] = (m[s.pred] ?? 0) + 1;
    return m;
  })(),
  coverage: { unique: coverage(pyV.unique, pyConstructs), families: coverage(pyV.families, pyConstructs) },
};

// ---------------------------------------------------------------- test cases
const corpusRoot = fsFacts.root;
const identity = rel => {
  const buf = readFileSync(join(corpusRoot, rel));
  return { path: rel, sha256: createHash('sha256').update(buf).digest('hex'), bytes: buf.length, lines: buf.toString('utf8').split('\n').length };
};
const findFs = p => fsAll.find(r => r.path === p);
const findPy = p => pyAll.find(r => r.path === p);
const caseSummary = (lang, r) => {
  const lv = lang === 'fs'
    ? ladder({ files: [r] }, fsSiteLevel, fsFailure, x => ((x.calls && Object.keys(x.calls).some(k => /^call:q[A-Z]/.test(k))) ? 1 : 0), true).files
    : ladder({ files: [r] }, pySiteLevel, pyFailure, () => 1, false).files;
  const levelOfFile = Object.entries(lv.levels).find(([, e]) => e.n === 1)?.[0];
  return { level: levelOfFile, failureRecovery: lv.failureRecovery.n > 0, staticSyncSites: lv.staticSyncSitesPerFile.total, role: r.role, generated: r.generated ?? null, family: r.family };
};
const TEST_CASES = [
  { id: 'fs-simple', lang: 'fs', path: 'cad-project-039/hopper-corner-inserts-r1/inserts.fs',
    why: 'Small handwritten feature: sketch polygon, extrude, booleans, fillet; no geometry read-back. Baseline every core form must pass.' },
  { id: 'fs-medium', lang: 'fs', path: 'cad-project-002/funnel-holder-r2/guide-r2.fs',
    why: 'Imports three other Part Studios via namespaced imports + instantiator, selects the left source body by evBox3d, selects chute-seat faces by evPlane normal and bbox window, opOffsetFace, opPattern envelopes, per-body boolean loop over evaluated bodies, sketch text engraving, try/rethrow, final solid-count assert.' },
  { id: 'fs-hard', lang: 'fs', path: 'cad-project-014/bottom-drive-purpose-2026-09-19/src/drive-purpose.fs',
    why: '915-line module with generated blocks, 27 features and 35 helper functions, getVariable/setVariable purpose registry, setAttribute, reference-body selection by measured volume, face selection by bbox window, loft routes, try/catch recovery that builds a diagnostic body.' },
  { id: 'py-medium', lang: 'py', path: 'cad-project-035/project-component-d98e059b.py',
    why: 'Algebra-mode build123d part: Pos/Rot placement, booleans, and the dominant corpus idiom edges().filter_by(Axis) + comprehension over e.center() windows -> if non-empty fillet/chamfer, with one-edge-at-a-time fallback on failure.' },
  { id: 'py-hard', lang: 'py', path: 'cad-project-046/mount.py',
    why: 'Mixed builder + algebra mode (BuildPart/BuildSketch/BuildLine), OCP edge->face adjacency maps, concave-edge classification via normals and is_inside probes, iterative fillet with topology remap (up to 24 passes) and radius fallback, deburr in a sacrificial subprocess, print-bed placement from measured bounding boxes.' },
];
const testCases = TEST_CASES.map(tc => {
  const r = tc.lang === 'fs' ? findFs(tc.path) : findPy(tc.path);
  if (!r) throw new Error(`test case not in corpus facts: ${tc.path}`);
  return { ...tc, ...identity(tc.path), scanner: caseSummary(tc.lang, r) };
});
const secondaryReferences = [
  { path: 'cad-project-047/ei.py', why: 'Simplest real build123d part: pure algebra-mode CSG, splines, no read-back.' },
  { path: 'cad-project-041/single-step-r10/src/core_geometry.py', why: 'Trace: an existing dual-backend mini CAD IR (box/cyl/prism/cone/hex/M3 tools, join/cut/intersect, rigid move, named source import, finish) that evaluates in build123d and emits straight-line FeatureScript at the same time.' },
  { path: 'cad-project-028/sorter.fs', why: '740-line machine-emitted SSA FeatureScript (g1..gN), zero read-back: the shape of compiled output.' },
].map(x => ({ ...x, ...identity(x.path) }));

// ---------------------------------------------------------------- verification
// Stratified hand-read of the scanners' output (2026-09-22). Every listed site
// was compared with the source; "fixes" name analyzer changes the read forced.
const verification = {
  method: 'Per stratum one file; every non-rethrow site the scanner reported was compared with the source text, and the source was grepped for evaluateQuery/ev*/selectors/loops/ifs to find misses.',
  featureScript: [
    { stratum: 'small handwritten, entity loop', path: 'cad-project-002/funnel-holder-r2/guide-r2.fs', sites: 11, verdict: 'all correct, no misses' },
    { stratum: 'geometry decision with modeling', path: 'cad-project-040/archive/r1/snapshot/z-axis.fs', sites: 11, verdict: 'correct; branches that only call setProperty were counted as modeling', fix: 'geomOp flag excludes metadata writes (setProperty/setAttribute)' },
    { stratum: 'evaluation lambda', path: 'cad-project-020/lochwand/job/geometry-eval.fs', sites: 11, verdict: 'loops correct; name-based selection was labelled topology-decision and evCollision reporting loops looked like selections', fix: 'ev*/getProperty results carry only their own taint bit' },
    { stratum: 'fragment', path: 'cad-project-002/funnel-holder-r4/primitives.fs', sites: 0, verdict: 'correct (pure primitive builders)' },
    { stratum: 'generated (marker)', path: 'cad-project-039/belt-fixed-r29/native/return-hardware-r29.fs', sites: 10, verdict: 'all correct, including unreachable helper sites' },
    { stratum: 'no sites, large', path: 'cad-project-028/sorter.fs', sites: 0, verdict: 'correct (740 lines straight-line SSA); was not detected as generated', fix: "SSA heuristic: >= 10 ids of the form id + \"g<n>\"" },
    { stratum: 'failure recovery, large', path: 'cad-project-014/bottom-drive-purpose-2026-09-19/src/drive-purpose.fs', sites: 21, verdict: 'correct; entity-selection sites inside helpers inherit caller taint (site counts over-count, file level unaffected)' },
    { stratum: 'library', path: 'cad-project-039/project-component-db8a67a0-top-plate-r1/native-helpers.fs', sites: 4, verdict: 'all correct' },
    { stratum: 'level-7 audit', path: 'cad-project-041/obsbot-free-rotation-2026-09-19/src/obsbot-free-yaw.fs', sites: 1, verdict: 'false positive: loop bound size(pts) over a literal 5-element array', fix: 'size(x) of a local array literal is static' },
  ],
  python: [
    { stratum: 'simple algebra-mode model', path: 'cad-project-047/ei.py', sites: 0, verdict: 'correct' },
    { stratum: 'predicate-selected fillets', path: 'cad-project-035/project-component-d98e059b.py', sites: 26, verdict: 'correct after fixes', fix: 'module scope no longer descends into function bodies (sites were double counted); entity lists chosen by predicates get SELPRED instead of MEASURE' },
    { stratum: 'hard, OCP + iterative fillets', path: 'cad-project-046/mount.py', sites: 60, verdict: 'correct after fixes; continue-filters inside selection loops are marked filter', fix: 'shape helpers recognised by return annotation; Location/Pos/Rot products are placement arithmetic, not measurements' },
    { stratum: 'Trace dual-backend IR', path: 'cad-project-041/single-step-r10/src/core_geometry.py', sites: 4, verdict: 'correct (checks only); modeling through the t.box/t.sub wrapper is not counted as b3d modeling calls' },
    { stratum: 'check script', path: 'cad-project-041/single-step-r10/jobs/r10b/check_side_wall_exact.py', sites: 9, verdict: 'correct (reporting decisions)' },
    { stratum: 'cad-khana example', path: 'cad-khana/skills/cad-khana/references/examples/pin_hinge/assembly.py', sites: 0, verdict: 'correct' },
    { stratum: 'dict-of-parts loops', path: 'cad-project-041/single-step-r10/jobs/belt/geometry.py', sites: 7, verdict: 'loop variable tainted through report[...][t] = ... made every helper look measured', fix: 'assignment taints only the container base name, never index expressions; static-trip loops (literal containers, .items() keys) are not geometry iteration' },
  ],
  knownLimitations: [
    'Modeling through user wrapper layers (Trace t.box/t.sub, core_geometry G.*; 26 Python files) is invisible to role detection, so such files can land in b3d-check/tooling.',
    'Dict-of-parts loops whose container comes from a function return are counted as per-entity maps (level 6), an over-approximation.',
    'Counts are static: one site inside a loop over N entities is one site, although a split host/kernel design would pay N round trips.',
    'FS reachability is per file; functions only used through document imports count as unreachable in their own file.',
  ],
};

// ---------------------------------------------------------------- write
const report = {
  schema: 'wonky-lang-corpus/1',
  generatedAt: new Date().toISOString(),
  corpusRoot,
  load,
  scanners: {
    featureScript: 'scripts/lang/scan-fs.mjs (fs-parse.mjs tolerant parser + fs-analyze.mjs taint analysis)',
    python: 'scripts/lang/scan-py.mjs (py-facts.py, stdlib ast via uv) with fixtures/lang/b3d-vocab.json (build123d ' + vocab.version + ')',
    scanMs: { featureScript: fsFacts.ms, python: pyFacts.ms },
    scannedAt: { featureScript: fsFacts.scannedAt, python: pyFacts.scannedAt },
    dedup: 'unique = SHA-256 of file bytes; families = union-find over Jaccard >= 0.6 of token 5-shingles, latest mtime represents the family',
  },
  levels: LEVEL_NAMES,
  featureScript: fsReport,
  python: pyReport,
  testCases,
  secondaryReferences,
  verification,
};
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(report, null, 1));
console.log(`wrote ${outPath}`);
for (const [lang, rep] of [['fs', fsReport], ['py', pyReport]]) {
  for (const view of ['unique', 'families']) {
    const s = rep.sync[view];
    console.log(lang, view, s.of, Object.entries(s.levels).map(([k, e]) => `${k}=${e.pct}%`).join(' '), '| fail', s.failureRecovery.pct + '%', '| verdict', Object.entries(s.verdict).map(([k, e]) => `${k}=${e.pct}%`).join(' '));
    console.log('   needs', Object.entries(s.requirements).map(([k, e]) => `${k}=${e.pct}%`).join(' '));
  }
}
const cov = (name, c) => console.log(name, `universe ${c.universe}`, '80%:', JSON.stringify(c.for80), '95%:', JSON.stringify(c.for95), '100%:', JSON.stringify(c.for100));
cov('fs all unique', fsReport.coverage.allConstructs.unique);
cov('fs all families', fsReport.coverage.allConstructs.families);
cov('fs kernel unique', fsReport.coverage.kernelVocabularyOnly.unique);
cov('fs kernel families', fsReport.coverage.kernelVocabularyOnly.families);
cov('py unique', pyReport.coverage.unique);
cov('py families', pyReport.coverage.families);
