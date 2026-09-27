// Frozen Onshape inputs for any FeatureScript source (docs/onshape-inputs.md).
// Generalizes scripts/snapshot-r10b-modules.mjs onto the shared store in
// var/onshape-store/. The corpus is read in place and never written.
//
//   node scripts/snapshot-modules.mjs seed-r10b
//       Copy the frozen r10b capture (fixtures/r10b, 2026-09-21) byte for byte
//       into the store, keyed by element@microversion. Offline.
//   node scripts/snapshot-modules.mjs manifests [--all | <file>...] [--corpus-root DIR] [--document ID]
//       Write var/onshape-store/manifests/<corpus-relative path>.json for every
//       source that imports at least one revision the store holds. Offline.
//   node scripts/snapshot-modules.mjs plan [--all | <file>...] [--corpus-root DIR] [--document ID]
//       Which imported revisions and parts are missing, and the Onshape calls a
//       capture of them would cost, per endpoint. Offline.
//   node scripts/snapshot-modules.mjs capture [--resume | --all | <file>...] [--document ID]
//         [--dry-run] [--reserve 0.2] [--max-bodies N] [--query-answers]
//       Capture missing part lists and B-reps through Marc's signed-in session
//       bridge (http://127.0.0.1:8317 only, read-only, serial). Checks health,
//       session, limits and metering first, keeps 20 % of every endpoint
//       bucket in reserve, believes retry-after, and compares the metering
//       counters at the end. Held files are never fetched again, so a run that
//       stops at a budget is continued with `capture --resume` (= --all).
//
// Priority: families of the fs-module-import cluster first
// (out/corpus/module-import/scan.json, --scan), cheapest complete family
// first, so each call unblocks as many corpus families as possible. Family
// names come from out/corpus/targets.json (--families).
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { homedir } from 'node:os';
import {
  REPO, STORE, CAPTURE_SCHEMA, sha256, revisionKey, bodyFile, writeJson, writeOnce, revisionDir, readRevision, newRevision,
  writeRevision, revisionCoverage, importsOf, hostDocumentFor, manifestFor, namespaceUses, isCodeImport,
  elementDocumentEvidence, staticPartQueries, pinnedMicroversion,
} from './onshape-store.mjs';
import { Bridge, BudgetStop, BRIDGE, METERING_PATH, CAPS, meteringOf, meteringMoved, fsValue } from './onshape-bridge.mjs';

const GENERATOR = 'scripts/snapshot-modules.mjs';
const args = process.argv.slice(2);
const command = args.shift();
const option = name => { const i = args.indexOf(name); if (i < 0) return null; const [, value] = args.splice(i, 2); if (!value) throw new Error(`${name} needs a value`); return value; };
const flag = name => { const i = args.indexOf(name); if (i < 0) return false; args.splice(i, 1); return true; };

const corpusRoot = resolve(option('--corpus-root') ?? process.env.WONKY_CORPUS_ROOT ?? join(homedir(), 'Workspace', 'cad'));
const document = option('--document');
const resume = flag('--resume');
const all = flag('--all') || resume;
const scanPath = option('--scan') ?? join(REPO, 'out/corpus/module-import/scan.json');
const familiesPath = option('--families') ?? join(REPO, 'out/corpus/targets.json');
const dryRun = flag('--dry-run');
const reserveFraction = Number(option('--reserve') ?? 0.2);
const maxBodiesArg = option('--max-bodies');
const maxBodies = maxBodiesArg === null ? Infinity : Number(maxBodiesArg);
if (!(reserveFraction >= 0.2 && reserveFraction < 1)) throw new Error('--reserve must be at least 0.2 (the bridge rule) and below 1');
const queryAnswers = flag('--query-answers');
const rescanEvidence = flag('--rescan-evidence');
const tilde = path => path.startsWith(homedir()) ? '~' + path.slice(homedir().length) : path;

// ------------------------------------------------------------------ sources
const SKIP = new Set(['node_modules', 'vendor', 'site-packages', '__pycache__', 'venv', 'dist-packages', '.git']);
function corpusSources() {
  const found = [];
  const visit = dir => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith('.')) continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) { if (!SKIP.has(e.name)) visit(p); }
      else if (e.isFile() && e.name.endsWith('.fs') && statSync(p).size < 4 << 20 && /\b[A-Za-z_]\w*::import\s*\(/.test(readFileSync(p, 'utf8'))) found.push(p);
    }
  };
  visit(corpusRoot);
  return found.sort();
}
function sources() {
  const files = all ? corpusSources() : args.map(f => resolve(f));
  if (!files.length) throw new Error('Pass source files or --all');
  return files.map(path => {
    const text = readFileSync(path, 'utf8');
    const rel = relative(corpusRoot, path);
    if (rel.startsWith('..')) throw new Error(`${path} is outside the corpus root ${corpusRoot}; pass --corpus-root`);
    let imports = null, error = null;
    try { imports = importsOf(text); } catch (e) { error = e.message; }
    return { path, rel, text, imports, error };
  });
}

// ------------------------------------------------------------------ seed-r10b
function seedR10b() {
  const root = join(REPO, 'fixtures/r10b');
  const manifestBytes = readFileSync(join(root, 'modules.json'));
  const fixture = JSON.parse(manifestBytes);
  const requestsBytes = readFileSync(join(root, 'snapshot-requests.json'));
  const captureId = `seed-r10b-${fixture.capturedAt.replace(/[:.]/g, '-')}`;
  const capture = {
    schema: CAPTURE_SCHEMA, id: captureId, kind: 'seed', seededAt: new Date().toISOString(), generator: GENERATOR,
    note: 'Files copied byte for byte from the frozen r10b fixture. No Onshape request was made by the seed.',
    from: { manifest: 'fixtures/r10b/modules.json', manifestSha256: sha256(manifestBytes), requests: 'fixtures/r10b/snapshot-requests.json', requestsSha256: sha256(requestsBytes), provenance: 'fixtures/r10b/provenance.json' },
    original: { capturedAt: fixture.capturedAt, document: fixture.document, status: fixture.status, bridge: 'http://127.0.0.1:8317 (session bridge, scripts/snapshot-r10b-modules.mjs)', metering: fixture.metering, requests: JSON.parse(requestsBytes).length },
    revisions: [],
  };
  if (fixture.schema !== 'wonky-onshape-inputs/1' || fixture.status !== 'complete') throw new Error('Unexpected r10b manifest');
  for (const module of fixture.modules) {
    const key = revisionKey(module.element, module.microversion), dir = revisionDir(key);
    const revision = readRevision(key) ?? newRevision({ document: fixture.document, element: module.element, microversion: module.microversion });
    if (revision.document !== fixture.document || revision.documentVersion !== null) throw new Error(`Store revision ${key} belongs to another document`);
    const partsBytes = readFileSync(join(root, 'modules', module.namespace, 'parts.json'));
    if (sha256(partsBytes) !== module.partsSha256) throw new Error(`r10b part list checksum mismatch: ${module.namespace}`);
    writeOnce(join(dir, 'parts.json'), partsBytes);
    revision.parts ??= { file: 'parts.json', sha256: module.partsSha256, capture: captureId, apiPath: `/api/parts/d/${fixture.document}/m/${module.microversion}/e/${module.element}` };
    for (const body of module.bodies) {
      const bytes = readFileSync(join(root, body.file));
      if (sha256(bytes) !== body.sha256) throw new Error(`r10b body checksum mismatch: ${body.file}`);
      const held = revision.bodies.find(b => b.partId === body.partId);
      writeOnce(join(dir, held?.file ?? bodyFile(body.partId)), bytes);
      if (!held) {
        const { file, ...rest } = body;
        revision.bodies.push({ ...rest, file: bodyFile(body.partId), capture: captureId });
      }
    }
    if (!revision.captures.includes(captureId)) revision.captures.push(captureId);
    writeRevision(revision);
    const coverage = revisionCoverage(revision);
    capture.revisions.push({ key, namespaceInR10b: module.namespace, bodies: module.bodies.length, solids: coverage.solids });
    console.log(`${key}  ${module.namespace.padEnd(8)} ${coverage.captured}/${coverage.solids} solid parts held`);
  }
  writeJson(join(STORE, 'captures', `${captureId}.json`), capture);
  console.log(`Seeded ${capture.revisions.length} revisions from fixtures/r10b into ${tilde(STORE)}.`);
}

// ------------------------------------------------------------------ manifests
function manifests() {
  let written = 0, skipped = 0;
  for (const src of sources()) {
    if (!src.imports) { console.log(`skip  ${src.rel}: does not parse (${src.error})`); skipped++; continue; }
    if (!src.imports.length) continue;
    const manifestPath = join(STORE, 'manifests', `${src.rel}.json`);
    const host = hostDocumentFor(src.path, { document, stopAt: corpusRoot });
    const manifest = manifestFor({ text: src.text, sourceRelPath: src.rel, corpusRoot: tilde(corpusRoot), manifestPath, host, generator: GENERATOR });
    if (!manifest.modules.length) { skipped++; continue; }
    writeJson(manifestPath, { ...manifest, generatedAt: new Date().toISOString() });
    written++;
    const held = manifest.modules.map(m => `${m.namespace} ${m.coverage.captured}/${m.coverage.solids}`).join(', ');
    console.log(`wrote ${src.rel}  [${held}]${manifest.unresolved.length ? `  unresolved: ${manifest.unresolved.map(u => u.namespace).join(', ')}` : ''}`);
  }
  console.log(`${written} manifests written under ${tilde(join(STORE, 'manifests'))}; ${skipped} sources skipped (no captured revision or no parse).`);
}

// ------------------------------------------------------------------ targets
// Family names (out/corpus/targets.json) and the fs-module-import cluster
// (out/corpus/module-import/scan.json). Both only order the work; without
// them every source is its own family.
function loadFamilies() {
  const families = new Map(), cluster = new Set();
  const read = path => existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')).files ?? [] : [];
  for (const f of read(familiesPath)) if (f.family) for (const p of [f.path, ...(f.duplicatePaths ?? [])]) families.set(p, f.family);
  for (const f of read(scanPath)) { cluster.add(f.path); if (f.family) families.set(f.path, f.family); }
  return { families, cluster };
}

// Every Part Studio revision the sources import, with its document, the
// families that need it and the static makeId partQuery texts that a B-rep
// cannot answer.
function collectTargets(srcs) {
  const { families, cluster } = loadFamilies();
  const rows = new Map(), problems = [];
  for (const src of srcs) {
    if (!src.imports) { problems.push({ source: src.rel, problem: `does not parse: ${src.error}` }); continue; }
    const uses = namespaceUses(src.text), queries = staticPartQueries(src.text);
    const host = hostDocumentFor(src.path, { document, stopAt: corpusRoot });
    const family = families.get(src.rel) ?? `file:${src.rel}`;
    for (const spec of src.imports) {
      if (!spec.target) { problems.push({ source: src.rel, namespace: spec.namespace, problem: `not an Onshape Part Studio path: ${spec.path} (stage 4)` }); continue; }
      if (isCodeImport(uses, spec.namespace)) { problems.push({ source: src.rel, namespace: spec.namespace, problem: `Feature Studio code import (${[...uses.get(spec.namespace)].join(', ')}): stage 4, not captured` }); continue; }
      const key = revisionKey(spec.target.element, spec.version);
      const row = rows.get(key) ?? { key, element: spec.target.element, microversion: spec.version, document: null, documentFrom: null,
        documentVersions: new Set(), sameDocument: false, sources: new Set(), families: new Set(), clusterFamilies: new Set(), queries: [] };
      rows.set(key, row);
      let doc = spec.target.document, from = doc ? 'import path' : null;
      if (!doc && host) { doc = host.document; from = `host ${host.from}`; }
      if (!doc && readRevision(key)) { doc = readRevision(key).document; from = 'store revision'; }
      if (spec.target.documentVersion) row.documentVersions.add(spec.target.documentVersion); else row.sameDocument = true;
      if (doc && row.document && row.document !== doc) problems.push({ source: src.rel, namespace: spec.namespace, problem: `revision ${key} imported from documents ${row.document} and ${doc}` });
      else if (doc && !row.document) { row.document = doc; row.documentFrom = from; }
      row.sources.add(src.rel); row.families.add(family);
      if (cluster.has(src.rel)) row.clusterFamilies.add(family);
      for (const q of queries) if (q.namespace === spec.namespace && /\bmakeId\s*\(/.test(q.query) && evaluableQuery(q.query) && !row.queries.some(x => x.query === q.query)) row.queries.push({ source: src.rel, query: q.query });
    }
  }
  const undocumented = [...rows.values()].filter(r => !r.document);
  if (undocumented.length) {
    const evidence = elementDocumentEvidence(undocumented.map(r => r.element), { corpusRoot, rescan: rescanEvidence });
    for (const r of undocumented) {
      const e = evidence.get(r.element);
      if (e?.document) { r.document = e.document; r.documentFrom = `corpus URL evidence (${e.fileCount} files, e.g. ${e.files[0]})`; }
      else problems.push({ revision: r.key, sources: [...r.sources], problem: e && Object.keys(e.documents).length ? `conflicting document evidence ${JSON.stringify(e.documents)}` : 'no host document: pass --document or add a state.json' });
    }
  }
  return { rows: [...rows.values()], problems };
}

// A partQuery that one FeatureScript evaluation in the source Part Studio can
// answer on its own: after removing string literals, every identifier is a
// standard-library query builtin or enum. Queries that name the importing
// file's constants or loop variables (makeId(SOURCE_FEATURE) + item.operation)
// are not evaluable there and are left alone.
const QUERY_WORDS = new Set(['makeId', 'qCreatedBy', 'qBodyType', 'qUnion', 'qSubtraction', 'qIntersection', 'qOwnerBody', 'qEntityFilter',
  'EntityType', 'BODY', 'FACE', 'EDGE', 'VERTEX', 'BodyType', 'SOLID', 'SHEET', 'WIRE', 'POINT', 'MATE_CONNECTOR', 'COMPOSITE']);
const evaluableQuery = text => [...text.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '""').matchAll(/[A-Za-z_]\w*/g)].every(([w]) => QUERY_WORDS.has(w));

// Per revision: what is held, what is missing (solid, non-mesh parts only).
function status(row) {
  const revision = readRevision(row.key);
  if (revision?.notCapturable) return { revision, partList: true, notCapturable: revision.notCapturable, parts: [], solids: 0, missing: [], mesh: [], queriesMissing: [] };
  if (!revision?.parts) return { revision, partList: false, missing: null, mesh: [] };
  const parts = JSON.parse(readFileSync(join(revisionDir(row.key), revision.parts.file), 'utf8'));
  const held = new Set(revision.bodies.map(b => b.partId));
  const solids = parts.filter(p => p.bodyType === 'solid');
  return { revision, partList: true, parts, solids: solids.length,
    missing: solids.filter(p => !p.isMesh && !held.has(p.partId)), mesh: solids.filter(p => p.isMesh).map(p => p.partId),
    queriesMissing: row.queries.filter(q => !revision.queryAnswers.some(a => a.query === q.query)) };
}

const rowOrder = (a, b) => b.clusterFamilies.size - a.clusterFamilies.size || b.families.size - a.families.size || b.sources.size - a.sources.size || a.key.localeCompare(b.key);

// Families with the revisions they need and the body calls still missing.
function familyCosts(rows) {
  const byFamily = new Map();
  for (const row of rows) for (const f of row.families) (byFamily.get(f) ?? byFamily.set(f, { family: f, cluster: false, rows: [] }).get(f)).rows.push(row);
  for (const row of rows) for (const f of row.clusterFamilies) byFamily.get(f).cluster = true;
  return [...byFamily.values()].map(f => {
    const st = f.rows.map(status);
    return { ...f, blocked: f.rows.some(r => !r.document), partListsMissing: st.filter(s => !s.partList).length,
      bodiesMissing: st.reduce((n, s) => n + (s.missing?.length ?? 0), 0), complete: st.every(s => s.partList && s.missing.length === 0) };
  });
}

// ------------------------------------------------------------------ plan
function plan() {
  const { rows, problems } = collectTargets(sources());
  rows.sort(rowOrder);
  const out = rows.map(row => {
    const s = status(row);
    return { key: row.key, document: row.document, documentFrom: row.documentFrom, documentVersions: [...row.documentVersions], sources: row.sources.size,
      families: [...row.families], cluster: row.clusterFamilies.size > 0, pin: s.revision?.pin ? `${s.revision.pin.mode}${s.revision.pin.of ? ` of ${s.revision.pin.of}` : ''} @${pinnedMicroversion(s.revision)}` : null, partList: s.notCapturable ? 'not capturable' : s.partList ? 'held' : 'missing', solids: s.solids ?? null,
      captured: s.partList ? s.solids - s.missing.length - s.mesh.length : 0, missingBodies: s.missing?.length ?? null, mesh: s.mesh.length, makeIdQueries: row.queries.length };
  });
  const fam = familyCosts(rows);
  const calls = {
    parts: out.filter(r => r.partList === 'missing' && r.document).length,
    bodydetailsKnown: out.reduce((n, r) => n + (r.missingBodies ?? 0), 0),
    bodydetailsUnknownRevisions: out.filter(r => r.partList === 'missing').length,
    featurescript: queryAnswers ? rows.reduce((n, r) => n + (status(r).queriesMissing?.length ?? r.queries.length), 0) : 0,
    fixedChecks: { health: 1, sessioninfo: 1, limits: 1, meteringSummary: '2 + 1 per 100 Onshape calls' },
  };
  console.log(JSON.stringify({ store: tilde(STORE), corpusRoot: tilde(corpusRoot), revisions: rows.length,
    clusterRevisions: rows.filter(r => r.clusterFamilies.size).length, calls,
    families: { total: fam.length, complete: fam.filter(f => f.complete).length, cluster: fam.filter(f => f.cluster).length, clusterComplete: fam.filter(f => f.cluster && f.complete).length },
    rows: out, problems }, null, 2));
}

// ------------------------------------------------------------------ capture
async function capture() {
  const selection = all ? ['--all'] : args.map(f => relative(corpusRoot, resolve(f)));
  const { rows, problems } = collectTargets(sources());
  rows.sort(rowOrder);
  const targets = rows.filter(r => r.document);
  const pending0 = targets.map(r => ({ row: r, s: status(r) })).filter(({ row, s }) => !s.partList || s.missing.length || (queryAnswers && s.queriesMissing.length));
  const planned = {
    parts: pending0.filter(({ s }) => !s.partList).length,
    bodydetailsKnown: pending0.reduce((n, { s }) => n + (s.missing?.length ?? 0), 0),
    bodydetailsUnknownRevisions: pending0.filter(({ s }) => !s.partList).length,
    featurescript: queryAnswers ? pending0.reduce((n, { row, s }) => n + (s.partList ? s.queriesMissing.length : row.queries.length), 0) : 0,
  };
  console.log(`capture: ${rows.length} imported revisions, ${targets.length} with a document, ${pending0.length} with something missing.`);
  console.log(`planned calls: parts ${planned.parts}, bodydetails ${planned.bodydetailsKnown} known + unknown for ${planned.bodydetailsUnknownRevisions} revisions, featurescript ${planned.featurescript}; reserve ${Math.round(reserveFraction * 100)} % per bucket (${Object.entries(CAPS).map(([b, c]) => `${b} ${Math.ceil(c * reserveFraction)}/${c}`).join(', ')})`);
  if (dryRun) { console.log('dry run: no request made.'); return; }
  if (!pending0.length) { console.log('Nothing to capture.'); return; }

  const startedAt = new Date().toISOString();
  const id = `bridge-${startedAt.replace(/[:.]/g, '-')}`;
  const recordPath = join(STORE, 'captures', `${id}.json`);
  const record = { schema: CAPTURE_SCHEMA, id, kind: 'bridge', startedAt, finishedAt: null, status: 'running', generator: GENERATOR,
    command: ['capture', ...(resume ? ['--resume'] : []), ...selection, ...(queryAnswers ? ['--query-answers'] : [])].join(' '),
    bridge: BRIDGE, reserveFraction, corpusRoot: tilde(corpusRoot), planned, session: null, limitsBefore: null, metering: null,
    buckets: null, revisions: {}, skipped: [], problems: [...problems], requests: [] };
  let bridge;
  const save = () => { record.requests = bridge?.requests ?? []; record.buckets = bridge?.summary() ?? null; writeJson(recordPath, record); };
  bridge = new Bridge({ reserveFraction, log: m => console.log(m), onRequest: save });
  let interrupted = false;
  process.on('SIGINT', () => { interrupted = true; console.log('SIGINT: stopping after the current request'); });
  const touched = key => (record.revisions[key] ??= { partList: null, bodies: [], queryAnswers: [], problems: [] });

  // 1. Preflight: bridge, session, limits, metering.
  const health = await bridge.json('GET', '/_bridge/health');
  if (!health.ok) throw new Error(`Bridge unhealthy: ${JSON.stringify(health)}`);
  const session = await bridge.json('GET', '/api/users/sessioninfo');
  if (session.isGuest !== false) throw new Error('The bridge must use a signed-in user session (isGuest false)');
  record.session = { isGuest: session.isGuest, userId: session.id ?? null };
  record.limitsBefore = await bridge.json('GET', '/_bridge/limits');
  const meterBefore = meteringOf(await bridge.json('GET', METERING_PATH));
  record.metering = { before: meterBefore, checks: [], after: null, moved: null };
  console.log('preflight ok: session signed in; metering recorded locally');
  save();
  let lastCheck = bridge.onshapeCalls;
  const checkMetering = async (final = false) => {
    const now = meteringOf(await bridge.json('GET', METERING_PATH));
    record.metering[final ? 'after' : 'checks'] = final ? now : [...record.metering.checks, { at: new Date().toISOString(), ...now }];
    lastCheck = bridge.onshapeCalls;
    if (meteringMoved(meterBefore, now)) { record.metering.moved = true; record.status = 'stopped: metering moved'; save(); throw new Error(`STOP: Onshape metering moved. Inspect the local capture record before any further request.`); }
  };
  const checkpoint = async () => { if (bridge.onshapeCalls - lastCheck >= 100) await checkMetering(); };

  let bodiesThisRun = 0;
  const stops = new Set();
  const guard = async (fn, bucket) => {
    if (interrupted || stops.has(bucket)) return false;
    try { await fn(); await checkpoint(); return true; }
    catch (e) { if (e instanceof BudgetStop) { stops.add(e.bucket); console.log(`budget stop: ${e.message}`); return false; } throw e; }
  };

  try {
    // 2. Pin every import version to an immutable document state, then fetch
    //    its part list, highest-priority revisions first. Held revisions
    //    without a pin get one first (cheap), so aliases can reuse them.
    const resolver = new PinResolver(bridge, id, stops);
    for (const row of targets) {
      const revision = readRevision(row.key);
      if (revision?.parts && !revision.pin) await guard(() => resolver.pinHeld(revision), 'elements');
    }
    for (const { row } of pending0.filter(({ s }) => !s.partList)) {
      if (interrupted || ['parts', 'elements'].some(b => stops.has(b))) break;
      await guard(() => pinAndPartList(bridge, resolver, row, id, touched(row.key)), 'parts');
    }
    record.historyPages = resolver.pagesFetched;
    // 3. Bodies, family by family: cluster families first, then the family
    //    that costs the fewest calls to complete, so the budget unblocks as
    //    many families as possible.
    const done = new Set();
    for (;;) {
      if (interrupted || stops.has('bodydetails') || bodiesThisRun >= maxBodies) break;
      const left = bridge.state('bodydetails').last === null ? Infinity : bridge.state('bodydetails').last - bridge.state('bodydetails').reserve;
      // Families whose part lists are all held (they can become complete)
      // come first; a family with an unpinnable revision still gets the
      // bodies of its other revisions afterwards.
      const open = familyCosts(targets).filter(f => !f.complete && !done.has(f.family) && f.bodiesMissing > 0);
      if (!open.length) break;
      open.sort((a, b) => (a.partListsMissing ? 1 : 0) - (b.partListsMissing ? 1 : 0) || (a.bodiesMissing <= left ? 0 : 1) - (b.bodiesMissing <= left ? 0 : 1) || (a.cluster ? 0 : 1) - (b.cluster ? 0 : 1) || a.bodiesMissing - b.bodiesMissing || a.family.localeCompare(b.family));
      const family = open[0];
      done.add(family.family);
      console.log(`family ${family.family}${family.cluster ? ' (cluster)' : ''}: ${family.bodiesMissing} bodies missing${family.bodiesMissing > left ? ` (only ${left} calls left above the reserve: partial)` : ''}`);
      for (const row of family.rows) {
        for (const part of status(row).missing ?? []) {
          if (bodiesThisRun >= maxBodies) break;
          const ok = await guard(() => captureBody(bridge, row, part, id, touched(row.key)), 'bodydetails');
          if (!ok) break;
          bodiesThisRun++;
        }
        if (interrupted || stops.has('bodydetails')) break;
      }
    }
    // 4. Capture-time answers to static makeId partQuery expressions.
    if (queryAnswers) for (const row of targets) {
      const s = status(row);
      if (!s.partList) continue;
      for (const q of s.queriesMissing) if (!(await guard(() => captureQueryAnswer(bridge, row, q, s.parts, id, touched(row.key)), 'featurescript'))) break;
      if (interrupted || stops.has('featurescript')) break;
    }
    for (const row of targets) { const s = status(row); if (s.mesh.length) record.skipped.push({ revision: row.key, meshParts: s.mesh, reason: 'mesh part: no analytic B-rep to import' }); }
  } finally {
    // 5. Metering again, pending work and the resume command.
    try { await checkMetering(true); record.metering.moved = false; }
    catch (e) { console.error(e.message); record.status = record.status === 'running' ? `error: ${e.message}` : record.status; }
    const pending = targets.map(r => ({ r, s: status(r) })).filter(({ s }) => !s.partList || s.missing.length || (queryAnswers && s.queriesMissing.length))
      .map(({ r, s }) => ({ revision: r.key, partList: s.partList, missingBodies: s.missing?.length ?? null, queries: queryAnswers ? (s.queriesMissing?.length ?? r.queries.length) : undefined }));
    record.pending = pending;
    record.unresolvedDocuments = rows.filter(r => !r.document).map(r => r.key);
    record.finishedAt = new Date().toISOString();
    if (record.status === 'running') record.status = interrupted ? 'interrupted' : pending.length ? `partial: ${[...stops].join(', ') || 'see problems'}` : 'complete';
    record.resume = 'node scripts/snapshot-modules.mjs capture --resume' + (queryAnswers ? ' --query-answers' : '');
    save();
    const b = bridge.summary();
    console.log(`\n${record.status}. Onshape calls: ${Object.entries(b).map(([k, v]) => `${k} ${v.calls} (remaining ${v.remainingBefore ?? '?'} -> ${v.remainingAfter ?? '?'})`).join(', ')}`);
    console.log('metering checks saved in the local capture record');
    console.log(`pending revisions: ${pending.length}; record ${tilde(recordPath)}; resume: ${record.resume}`);
  }
}

// ------------------------------------------------------------------ pinning
// An import `version` is not always a document microversion. Marc's tools
// write either the `microversionId` of a workspace part list (a document
// microversion) or the element's own `microversionId` from an elements
// listing (an element microversion, which `/m/<id>` does not accept: 404).
// The REST query parameter `elementMicroversionId` does not help: Onshape
// ignores it (a bogus value returns 200 with the workspace state; probed
// 2026-09-23). So every revision is pinned to a document microversion D at
// which the element had the imported state, and that pin is verified with an
// elements listing at D before any part or body is fetched:
//
//   document-microversion  version is a document microversion (D = version)
//   document-version       <doc>/<ver>/<element> import whose version-state
//                          element microversion equals the import version
//   alias                  a held revision of the same element was pinned at
//                          a D where the element had exactly this element
//                          microversion: its bytes are reused, no fetch
//   history                the document history entry that produced this
//                          element microversion (entries name the element
//                          tab; the source files' mtime bounds the search)
//
// Elements listings at /m/<D> or /v/<V>, and history pages up to /m/<M>, are
// immutable and cached under var/onshape-store/documents/<doc>/.
const HISTORY_MAX_PAGES = Number(process.env.WONKY_HISTORY_MAX_PAGES ?? 200);
const HISTORY_MAX_PROBES = Number(process.env.WONKY_HISTORY_MAX_PROBES ?? 150);
const docDir = doc => join(STORE, 'documents', doc);

class PinResolver {
  constructor(bridge, captureId, stops) {
    this.bridge = bridge; this.captureId = captureId; this.stops = stops;
    this.workspaces = new Map(); this.pages = new Map(); this.pagesFetched = 0;
  }
  // Elements of a document at an immutable state ('m' or 'v'). null on 404.
  // With `element`, only that element is listed (small responses for the
  // history search); a cached full listing answers that too.
  async elementsAt(doc, kind, id, element = null) {
    const full = join(docDir(doc), kind, id, 'elements.json');
    const file = element ? join(docDir(doc), kind, id, `elements-${element}.json`) : full;
    for (const cached of new Set([file, full])) if (existsSync(cached)) return { list: JSON.parse(readFileSync(cached, 'utf8')), file: relative(STORE, cached), sha256: sha256(readFileSync(cached)), cached: true };
    const path = `/api/documents/d/${doc}/${kind}/${id}/elements${element ? `?elementId=${element}` : ''}`;
    const r = await this.bridge.request('GET', path);
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`Bridge ${r.status}: GET ${path}: ${r.text.slice(0, 200)}`);
    writeOnce(file, r.text);
    return { list: JSON.parse(r.text), file: relative(STORE, file), sha256: sha256(r.text), apiPath: path, cached: false };
  }
  evidence(at, kind, id, element) {
    const e = at.list.find(x => x.id === element);
    return { listing: `${kind}/${id}`, file: at.file, sha256: at.sha256, elementName: e?.name ?? null, elementType: e?.elementType ?? null, elementMicroversion: e?.microversionId ?? null };
  }
  // A pin for an already held revision (fixtures/r10b seed): its version is
  // the document microversion its bytes name; record the element microversion.
  async pinHeld(revision) {
    const at = await this.elementsAt(revision.document, 'm', pinnedMicroversion(revision));
    if (!at) throw new Error(`Held revision ${revision.key}: document microversion ${pinnedMicroversion(revision)} not found`);
    const ev = this.evidence(at, 'm', pinnedMicroversion(revision), revision.element);
    if (!ev.elementMicroversion) throw new Error(`Held revision ${revision.key}: element absent at its own microversion`);
    const fresh = readRevision(revision.key);
    fresh.pin = { mode: 'document-microversion', documentMicroversion: pinnedMicroversion(revision), elementMicroversion: ev.elementMicroversion, evidence: [ev], capture: this.captureId };
    writeRevision(fresh);
    console.log(`  ${revision.key}: held, pinned (element microversion ${ev.elementMicroversion})`);
  }
  // A held revision of the same element whose pinned state has this element
  // microversion.
  aliasFor(row, elementMicroversion) {
    const dir = join(STORE, 'revisions');
    for (const key of existsSync(dir) ? readdirSync(dir) : []) {
      if (key === row.key || !key.startsWith(row.element + '@')) continue;
      const r = readRevision(key);
      if (r?.parts && r.document === row.document && r.pin?.elementMicroversion === elementMicroversion) return r;
    }
    return null;
  }
  async workspacesOf(doc) {
    if (!this.workspaces.has(doc)) {
      const path = `/api/documents/d/${doc}/workspaces`;
      const r = await this.bridge.request('GET', path);
      if (!r.ok) throw new Error(`Bridge ${r.status}: GET ${path}`);
      writeJson(join(docDir(doc), 'workspaces.json'), { fetchedAt: new Date().toISOString(), apiPath: path, workspaces: JSON.parse(r.text) });
      this.workspaces.set(doc, JSON.parse(r.text));
    }
    return this.workspaces.get(doc);
  }
  // History page ending at a workspace head (mutable, kept in memory) or at a
  // microversion M (immutable, cached on disk).
  async historyPage(doc, kind, id) {
    const key = `${doc}/${kind}/${id}`;
    if (this.pages.has(key)) return this.pages.get(key);
    const file = join(docDir(doc), 'history', `${id}.json`);
    let list;
    if (kind === 'm' && existsSync(file)) list = JSON.parse(readFileSync(file, 'utf8'));
    else {
      if (this.stops.has('documenthistory')) throw new BudgetStop('documenthistory', 'documenthistory stopped');
      const path = `/api/documents/d/${doc}/${kind}/${id}/documenthistory`;
      const r = await this.bridge.request('GET', path);
      if (!r.ok) throw new Error(`Bridge ${r.status}: GET ${path}`);
      this.pagesFetched++;
      list = JSON.parse(r.text);
      if (kind === 'm') writeOnce(file, r.text);
    }
    this.pages.set(key, list);
    return list;
  }
  // Newest-first history entries of one workspace, extended one page at a
  // time on demand (pages up to /m/<M> are immutable and cached on disk).
  historyCursor(doc, workspace) {
    const entries = [], seen = new Set();
    let next = null, pages = 0, done = false;
    const more = async () => {
      if (done || pages >= HISTORY_MAX_PAGES) return false;
      const page = await this.historyPage(doc, pages ? 'm' : 'w', pages ? next : workspace);
      pages++;
      for (const e of page) if (!seen.has(e.microversionId)) { seen.add(e.microversionId); entries.push(e); }
      next = page.at(-1)?.nextMicroversionId ?? null;
      if (!next || !page.length) done = true;
      return true;
    };
    return { entries, at: async i => { while (i >= entries.length) if (!(await more())) return null; return entries[i]; } };
  }
  // The element microversion at a document microversion (null: element absent).
  async elementAt(doc, microversion, element, probes) {
    const at = await this.elementsAt(doc, 'm', microversion, element);
    const ev = at ? this.evidence(at, 'm', microversion, element) : null;
    probes.push({ microversion, elementMicroversion: ev?.elementMicroversion ?? null });
    return ev;
  }
  // Each element microversion covers one contiguous stretch of the history.
  // Start at the newest entry not after the sources' mtime (the version was
  // read before the file was written) and walk back interval by interval: a
  // gallop plus binary search finds where the element's microversion changes,
  // the entry just older than that holds the previous one. Tab names are not
  // used: tabs get renamed.
  async fromHistory(row, notAfter) {
    const probes = [];
    for (const ws of await this.workspacesOf(row.document)) {
      const cur = this.historyCursor(row.document, ws.id);
      let i = 0;
      for (let e = await cur.at(0); e && Date.parse(e.date) > notAfter; e = await cur.at(++i)) { /* skip newer entries */ }
      let entry = await cur.at(i);
      if (!entry) continue;
      let ev = await this.elementAt(row.document, entry.microversionId, row.element, probes);
      while (ev?.elementMicroversion && probes.length < HISTORY_MAX_PROBES) {
        if (ev.elementMicroversion === row.microversion)
          return { mode: 'history', documentMicroversion: entry.microversionId, elementMicroversion: row.microversion, workspace: ws.id,
            historyEntry: { date: entry.date, description: entry.description }, evidence: [ev], probes };
        const current = ev.elementMicroversion;
        // gallop to an older entry with another element microversion
        let lo = i, hi = null, step = 1;
        for (;;) {
          const e = await cur.at(i + step);
          if (!e) break;
          const x = await this.elementAt(row.document, e.microversionId, row.element, probes);
          if (x?.elementMicroversion !== current) { hi = i + step; break; }
          lo = i + step; step *= 2;
          if (probes.length >= HISTORY_MAX_PROBES) break;
        }
        if (hi === null) break;
        while (hi - lo > 1 && probes.length < HISTORY_MAX_PROBES) {
          const mid = (lo + hi) >> 1;
          const x = await this.elementAt(row.document, (await cur.at(mid)).microversionId, row.element, probes);
          if (x?.elementMicroversion === current) lo = mid; else hi = mid;
        }
        i = hi; entry = await cur.at(i);
        ev = await this.elementAt(row.document, entry.microversionId, row.element, probes);
      }
    }
    return { probes };
  }
  // Find and store the pin of one revision. Returns the pin or null.
  async pin(row, log) {
    const revision = readRevision(row.key) ?? newRevision({ document: row.document, element: row.element, microversion: row.microversion });
    if (revision.pin) return revision.pin;
    if (revision.document !== row.document) throw new Error(`Store revision ${row.key} belongs to document ${revision.document}, not ${row.document}`);
    let pin = null;
    const notes = [];
    // alias on a held revision with a known element microversion == version
    const direct = this.aliasFor(row, row.microversion);
    if (direct) pin = { mode: 'alias', of: direct.key, documentMicroversion: pinnedMicroversion(direct), elementMicroversion: row.microversion, evidence: direct.pin.evidence };
    // the version is a document microversion
    if (!pin) {
      const at = await this.elementsAt(row.document, 'm', row.microversion);
      if (at) {
        const ev = this.evidence(at, 'm', row.microversion, row.element);
        if (!ev.elementMicroversion) notes.push(`element absent at document microversion ${row.microversion}`);
        else {
          const other = this.aliasFor(row, ev.elementMicroversion);
          pin = other
            ? { mode: 'alias', of: other.key, documentMicroversion: pinnedMicroversion(other), elementMicroversion: ev.elementMicroversion, versionIs: 'document-microversion', evidence: [ev, ...other.pin.evidence] }
            : { mode: 'document-microversion', documentMicroversion: row.microversion, elementMicroversion: ev.elementMicroversion, evidence: [ev] };
        }
      } else notes.push(`${row.microversion} is not a document microversion of ${row.document} (404)`);
    }
    // <doc>/<version>/<element>: the version state has this element microversion
    for (const v of pin ? [] : row.documentVersions) {
      const at = await this.elementsAt(row.document, 'v', v);
      if (!at) { notes.push(`document version ${v} not found`); continue; }
      const ev = this.evidence(at, 'v', v, row.element);
      if (ev.elementType && ev.elementType !== 'PARTSTUDIO') { notes.push(`element is a ${ev.elementType} ('${ev.elementName}') at version ${v}: a code import, stage 4, no part list`); break; }
      if (ev.elementMicroversion === row.microversion) { pin = { mode: 'document-version', documentVersion: v, documentMicroversion: null, elementMicroversion: row.microversion, evidence: [ev] }; break; }
      notes.push(`element microversion at version ${v} is ${ev.elementMicroversion}, not ${row.microversion}`);
    }
    // the document history
    if (!pin && !this.stops.has('documenthistory')) {
      const notAfter = Math.min(...[...row.sources].map(s => statSync(join(corpusRoot, s)).mtimeMs)) + 60000;
      let found = await this.fromHistory(row, notAfter);
      // A copied source can carry an mtime older than the version it names:
      // then search again from the workspace heads.
      if (!found.mode) { const again = await this.fromHistory(row, Infinity); found = again.mode ? again : { probes: [...found.probes, ...again.probes] }; }
      if (found.mode) {
        const other = this.aliasFor(row, row.microversion);
        pin = other ? { mode: 'alias', of: other.key, documentMicroversion: pinnedMicroversion(other), elementMicroversion: row.microversion, evidence: [...found.evidence, ...other.pin.evidence] } : found;
      } else notes.push(`history: element microversion ${row.microversion} not found walking back from ${new Date(notAfter).toISOString()} nor from the workspace heads (${found.probes.length} probes; element microversions seen: ${[...new Set(found.probes.map(p => p.elementMicroversion?.slice(0, 8) ?? 'absent'))].join(' ')})`);
    }
    log.pin = pin ? { mode: pin.mode, documentMicroversion: pin.documentMicroversion, of: pin.of } : null;
    if (!pin) { log.problems.push(`not pinned: ${notes.join('; ')}`); console.log(`  ${row.key}: NOT PINNED: ${notes.join('; ')}`); return null; }
    revision.pin = { ...pin, capture: this.captureId };
    revision.documentFrom ??= row.documentFrom;
    revision.documentVersions = [...new Set([...(revision.documentVersions ?? []), ...row.documentVersions])];
    if (!revision.captures.includes(this.captureId)) revision.captures.push(this.captureId);
    writeRevision(revision);
    console.log(`  ${row.key}: pinned ${pin.mode}${pin.of ? ` of ${pin.of}` : ''} at ${pin.documentMicroversion ?? `version ${pin.documentVersion}`}`);
    return revision.pin;
  }
}

function elementTypeOf(row, pin) {
  for (const ev of pin.evidence ?? []) {
    if (ev.elementType) return ev.elementType;
    if (!ev.file || !existsSync(join(STORE, ev.file))) continue;
    const e = JSON.parse(readFileSync(join(STORE, ev.file), 'utf8')).find(x => x.id === row.element);
    if (e?.elementType) return e.elementType;
  }
  return null;
}

// Pin one revision, then store its part list byte for byte after checking
// that every part names the element and the pinned document microversion. An
// alias copies the part list and the held bodies of its source revision.
async function pinAndPartList(bridge, resolver, row, captureId, log) {
  const pin = await resolver.pin(row, log);
  if (!pin) return;
  const key = row.key, dir = revisionDir(key);
  // A Feature Studio (code) has no part list: stage 4. Read the element type
  // from the listing the pin was verified with, before any parts request.
  const type = elementTypeOf(row, pin);
  if (type && type !== 'PARTSTUDIO') {
    const revision = readRevision(key);
    revision.notCapturable = { elementType: type, reason: `the imported element is a ${type}: a code import (stage 4), no part list or bodies` };
    writeRevision(revision);
    log.problems.push(revision.notCapturable.reason);
    console.log(`  ${key}: ${revision.notCapturable.reason}`);
    return;
  }
  if (pin.mode === 'alias') {
    const source = readRevision(pin.of);
    const bytes = readFileSync(join(revisionDir(pin.of), source.parts.file));
    writeOnce(join(dir, 'parts.json'), bytes);
    const revision = readRevision(key);
    revision.parts = { file: 'parts.json', sha256: sha256(bytes), capture: source.parts.capture, apiPath: source.parts.apiPath, copiedFrom: pin.of };
    for (const b of source.bodies) {
      writeOnce(join(dir, b.file), readFileSync(join(revisionDir(pin.of), b.file)));
      if (!revision.bodies.some(x => x.partId === b.partId)) revision.bodies.push({ ...b, copiedFrom: pin.of });
    }
    writeRevision(revision);
    log.partList = { alias: pin.of, bodies: source.bodies.length };
    console.log(`  ${key}: part list and ${source.bodies.length} bodies copied from ${pin.of}`);
    return;
  }
  const apiPath = pin.mode === 'document-version'
    ? `/api/parts/d/${row.document}/v/${pin.documentVersion}/e/${row.element}`
    : `/api/parts/d/${row.document}/m/${pin.documentMicroversion}/e/${row.element}`;
  const r = await bridge.request('GET', apiPath);
  if (!r.ok) { log.problems.push(`${r.status} on ${apiPath}: ${r.text.slice(0, 200)}`); console.log(`  ${key}: ${r.status} on ${apiPath}`); return; }
  const parts = JSON.parse(r.text);
  const pinned = pin.documentMicroversion ?? parts[0]?.microversionId;
  const wrong = Array.isArray(parts) ? parts.filter(p => p.elementId !== row.element || p.microversionId !== pinned) : null;
  if (!wrong || wrong.length || !pinned) { log.problems.push(`part list from ${apiPath} does not name ${row.element} at ${pinned}: ${JSON.stringify((wrong ?? [parts]).slice(0, 2).map(p => ({ elementId: p.elementId, microversionId: p.microversionId })))}`); console.log(`  ${key}: part list does not match the pinned state (${apiPath})`); return; }
  writeOnce(join(dir, 'parts.json'), r.text);
  const revision = readRevision(key);
  if (!revision.pin.documentMicroversion) revision.pin.documentMicroversion = pinned;
  revision.parts = { file: 'parts.json', sha256: sha256(r.text), capture: captureId, apiPath };
  writeRevision(revision);
  const solids = parts.filter(p => p.bodyType === 'solid');
  log.partList = { apiPath, parts: parts.length, solids: solids.length, mesh: solids.filter(p => p.isMesh).length };
  console.log(`  ${key}: part list ${parts.length} parts, ${solids.length} solids  [parts ${r.remaining ?? '?'} left]`);
}

// GET one part's bodydetails and store it byte for byte, after checking the
// revision and identity the loader will check again.
async function captureBody(bridge, row, part, captureId, log) {
  const revision = readRevision(row.key);
  const pinned = pinnedMicroversion(revision);
  const file = bodyFile(part.partId);
  // The same part at the same pinned document state may already be held by
  // an alias revision: reuse its bytes instead of fetching them again.
  const twin = heldTwin(revision, part.partId);
  if (twin) {
    writeOnce(join(revisionDir(row.key), file), readFileSync(join(revisionDir(twin.revision), twin.body.file)));
    const fresh = readRevision(row.key);
    // Record the name the bytes were written under: the twin may still carry
    // its old, case-unsafe file name.
    if (!fresh.bodies.some(x => x.partId === part.partId)) fresh.bodies.push({ ...twin.body, file, copiedFrom: twin.revision });
    writeRevision(fresh);
    log.bodies.push(part.partId);
    console.log(`  ${row.key} ${part.partId}: copied from ${twin.revision}`);
    return;
  }
  const base = revision.parts.apiPath;
  const apiPath = `${base}/partid/${encodeURIComponent(part.partId)}/bodydetails`;
  const r = await bridge.request('GET', apiPath);
  if (!r.ok) { log.problems.push(`${r.status} on ${apiPath}: ${r.text.slice(0, 200)}`); console.log(`  ${row.key} ${part.partId}: ${r.status}`); return; }
  const body = JSON.parse(r.text);
  if (body.documentMicroversion !== pinned || body.bodies?.length !== 1 || body.bodies[0].id !== part.partId) {
    log.problems.push(`bodydetails ${part.partId} does not match the revision/identity (documentMicroversion ${body.documentMicroversion}, bodies ${body.bodies?.length}, id ${body.bodies?.[0]?.id})`);
    console.log(`  ${row.key} ${part.partId}: revision/identity mismatch, not stored`); return;
  }
  writeOnce(join(revisionDir(row.key), file), r.text);
  const b = body.bodies[0];
  const fresh = readRevision(row.key);
  if (!fresh.bodies.some(x => x.partId === part.partId)) fresh.bodies.push({ name: part.name, partId: part.partId, sha256: sha256(r.text), apiPath,
    vertices: b.vertices.length, edges: b.edges.length, faces: b.faces.length,
    surfaceTypes: [...new Set(b.faces.map(f => f.surface.type))], curveTypes: [...new Set(b.edges.map(e => e.curve.type))], file, capture: captureId });
  if (!fresh.captures.includes(captureId)) fresh.captures.push(captureId);
  writeRevision(fresh);
  log.bodies.push(part.partId);
  console.log(`  ${row.key} ${part.partId} ${JSON.stringify(part.name)}: ${b.faces.length} faces [${[...new Set(b.faces.map(f => f.surface.type))].join(',')}]  [bodydetails ${r.remaining ?? '?'} left]`);
}

// A held body of the same element, part and pinned document microversion.
function heldTwin(revision, partId) {
  const dir = join(STORE, 'revisions');
  for (const key of readdirSync(dir)) {
    if (key === revision.key || !key.startsWith(revision.element + '@')) continue;
    const r = readRevision(key);
    if (!r?.parts || r.document !== revision.document || pinnedMicroversion(r) !== pinnedMicroversion(revision)) continue;
    const body = r.bodies.find(b => b.partId === partId);
    if (body) return { revision: key, body };
  }
  return null;
}

// What a stored FeatureScript evaluation selected. The id FeatureScript
// returns is a transient query string; it is taken as the part id only when
// the part list has exactly that id, else the part is matched by a unique name.
function deriveAnswer(text, parts) {
  const data = JSON.parse(text);
  const result = fsValue(data.result);
  const errors = (data.notices ?? []).filter(n => /ERROR/.test(JSON.stringify(n)));
  const found = Array.isArray(result) ? result : [];
  const partOf = x => {
    if (parts.some(p => p.partId === x.id)) return { partId: x.id, matchedBy: 'id' };
    const m = parts.filter(p => p.name === x.name);
    return m.length === 1 ? { partId: m[0].partId, matchedBy: 'unique name' } : { partId: null, matchedBy: null };
  };
  const selected = found.map(x => ({ transientId: x.id, name: x.name, ...partOf(x) }));
  return { ok: !errors.length && Array.isArray(result) && selected.length > 0 && selected.every(x => x.partId), selected,
    notices: (data.notices ?? []).map(n => JSON.stringify(n).slice(0, 300)).slice(0, 5) };
}

// Offline: recompute every stored query answer from its raw response.
function reanswer() {
  let n = 0;
  for (const key of readdirSync(join(STORE, 'revisions'))) {
    const revision = readRevision(key);
    if (!revision?.queryAnswers?.length) continue;
    const parts = JSON.parse(readFileSync(join(revisionDir(key), revision.parts.file), 'utf8'));
    revision.queryAnswers = revision.queryAnswers.map(a => a.file ? { ...a, ...deriveAnswer(readFileSync(join(revisionDir(key), a.file), 'utf8'), parts) } : a);
    writeRevision(revision);
    for (const a of revision.queryAnswers) { n++; console.log(`${key} ${a.ok ? 'ok ' : 'NO '} ${a.query}: ${(a.selected ?? []).map(x => `${x.partId ?? '?'} "${x.name}"`).join(', ')}`); }
  }
  console.log(`${n} stored query answers recomputed (no Onshape request).`);
}

// One read-only FeatureScript evaluation in the source Part Studio at the
// pinned revision: which bodies a static makeId partQuery selects. The ids
// are matched against the part list; the raw response is stored.
async function captureQueryAnswer(bridge, row, q, parts, captureId, log) {
  const revision = readRevision(row.key);
  const apiPath = `/api/partstudios/d/${row.document}/m/${pinnedMicroversion(revision)}/e/${row.element}/featurescript`;
  const script = `function(context is Context, queries is map)\n{\n    var out = [];\n    for (var body in evaluateQuery(context, ${q.query}))\n        out = append(out, { "id" : transientQueriesToStrings(body), "name" : getProperty(context, { "entity" : body, "propertyType" : PropertyType.NAME }) });\n    return out;\n}`;
  const r = await bridge.request('POST', apiPath, { body: { script, queries: [] } });
  const name = `query-answers/${sha256(q.query).slice(0, 16)}.json`;
  let answer = { query: q.query, source: q.source, apiPath, capture: captureId, status: r.status };
  if (r.ok) {
    writeOnce(join(revisionDir(row.key), name), r.text);
    answer = { ...answer, file: name, sha256: sha256(r.text), ...deriveAnswer(r.text, parts) };
  } else answer.error = r.text.slice(0, 300);
  revision.queryAnswers.push(answer);
  if (!revision.captures.includes(captureId)) revision.captures.push(captureId);
  writeRevision(revision);
  log.queryAnswers.push({ query: q.query, ok: answer.ok ?? false, selected: answer.selected?.length ?? 0 });
  console.log(`  ${row.key} query ${q.query.slice(0, 60)}...: ${r.status} ${answer.selected ? `${answer.selected.length} bodies` : ''}  [featurescript ${r.remaining ?? '?'} left]`);
}

if (command === 'seed-r10b') seedR10b();
else if (command === 'manifests') manifests();
else if (command === 'plan') plan();
else if (command === 'capture') await capture();
else if (command === 'reanswer') reanswer();
else throw new Error('Usage: snapshot-modules.mjs seed-r10b | manifests [--all|<file>...] | plan [--all|<file>...] | capture [--resume|--all|<file>...] [--dry-run] [--query-answers]  [--corpus-root DIR] [--document ID]');
