// Cluster fs-headerless-include: header-less FeatureScript fragments that the
// inventory counted as modeling files. For each fragment this script finds
//
//   - the headed "twin" the generator splices it into (a corpus .fs file with a
//     "FeatureScript N;" header that contains the fragment's lines and exported
//     features), and whether the fragment is spliced verbatim;
//   - the generator script(s) in the project that read the fragment;
//   - the twin's recorded corpus result for each of the fragment's features,
//     i.e. the fragment's real next blocker (from out/corpus/runs.jsonl, no re-run);
//   - optionally (--stub), what a header-prepended copy hits standalone. The copy
//     lives in tmp/corpus/headerless/stub/ and gets the twin's header (or the
//     default Onshape Feature Studio header when there is no twin). The corpus
//     stays untouched; nothing is written next to it.
//
// Read-only for the corpus and for production code. Stub runs call the
// production CLI (bin/wonky.mjs --check) with at most 3 processes, a per-unit
// timeout, and record `uptime` in out/corpus/fragments.json.
//
// Usage: node scripts/corpus/fragments.mjs [--stub] [--concurrency N<=3]
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { spawn, execSync } from 'node:child_process';
import { REPO, CORPUS_ROOT, FACTS_DIR, OUT_DIR, TMP_DIR, RUNS, classify, messagePattern } from './lib.mjs';

const args = process.argv.slice(2);
const stub = args.includes('--stub');
const concurrency = Math.min(3, Number(args[args.indexOf('--concurrency') + 1]) || 2);
const STUB_DIR = join(TMP_DIR, 'headerless/stub');
const DEFAULT_HEADER = 'FeatureScript 2909;\nimport(path : "onshape/std/common.fs", version : "2909.0");\n';
const jsEnv = { ...process.env }; delete jsEnv.WONKY_BACKEND; // default JS path for all corpus runs
const uptime = () => { try { return execSync('uptime', { encoding: 'utf8' }).trim(); } catch { return null; } };

const targets = JSON.parse(readFileSync(join(OUT_DIR, 'targets.json'), 'utf8'));
const facts = JSON.parse(readFileSync(join(FACTS_DIR, 'fs-facts.json'), 'utf8')).files;
const latest = new Map();
for (const line of readFileSync(RUNS, 'utf8').split('\n')) {
  if (!line.trim()) continue;
  const r = JSON.parse(line);
  if (r.runner === 'corpus-run/1') latest.set(r.key, r);
}

// Same cluster keys as scripts/corpus/summarize.mjs clusterOf(). That script
// writes summary.json on import, so the mapping is restated here.
function clusterOf(r) {
  let message = r.message ?? '', userThrow = r.userThrow;
  const op = r.failingOperation;
  if (op?.status === 'failed' && op.error?.message && message !== op.error.message && message.endsWith(op.error.message)) { message = op.error.message; userThrow = false; }
  let { status, kind } = classify({ errorClass: op?.status === 'failed' ? (op.error?.name ?? r.errorClass) : r.errorClass, message, userThrow, completedOperations: r.completedOperations });
  if (/Face vertices do not lie on the analytic plane|Plane frame is not orthonormal|Profile has collinear|A profile must have/.test(message)) { status = 'kernel'; kind = 'sketch-profile-validation'; }
  if (/^Expected a length with units|^Expected an angle with units/.test(message) && /definition\./.test(r.sourceLine ?? '')) kind = 'feature-parameter-default';
  if (kind === 'precondition' && /\bis boolean\b/.test(r.sourceLine ?? '')) kind = 'feature-parameter-default';
  if (r.status === 'ok' || status === 'ok') return { status: 'ok', kind: 'ok', cluster: null, message: null };
  let cluster = 'other';
  if (kind.startsWith('import-')) cluster = 'fs-module-import';
  else if (kind === 'parse-headerless-include') cluster = 'fs-headerless-include';
  else if (kind === 'undefined-builtin') cluster = 'fs-missing-builtin';
  else if (kind === 'parse') cluster = 'fs-parser-syntax';
  else if (['type-check', 'condition-not-boolean', 'units', 'precondition', 'featurescript-error', 'feature-parameter-default'].includes(kind)) cluster = 'fs-interpreter-semantics';
  else if (kind === 'model-check-before-geometry' || kind === 'ui-selection-missing') cluster = 'fs-needs-partstudio-input';
  else if (kind === 'invalid-topology' || /UnsupportedArrangement/.test(message)) cluster = 'boolean-invalid-topology';
  else if (status === 'capability' && /opBoolean/.test(message)) cluster = 'boolean-capability';
  else if (kind === 'sketch-profile-validation' || status === 'capability') cluster = 'kernel-sketch-and-ops';
  return { status, kind, cluster, message: message.slice(0, 240) };
}

// ------------------------------------------------------------ cluster files
const clusterRecs = [...latest.values()].filter(r => /^Expected 'FeatureScript', found/.test(r.message ?? ''));
const fragmentPaths = [...new Set(clusterRecs.map(r => r.path))].sort();
const fileInfo = new Map(targets.files.map(f => [f.path, f]));
const runCopyOf = new Map(targets.duplicates.map(d => [d.path, d.sameAs]));
for (const f of targets.files) runCopyOf.set(f.path, f.path);

const read = p => readFileSync(join(CORPUS_ROOT, p), 'utf8');
// Significant lines: trimmed, no comments, long enough to be distinctive.
const sigLines = text => text.split('\n').map(l => l.trim()).filter(l => l.length >= 12 && !l.startsWith('//'));
// Twin candidates: every headed corpus file, plus two sources outside the
// corpus that are headed versions of fragments whose corpus twins cannot show
// the next blocker: the frozen acceptance fixture (its modules.json resolves the
// r10b Part Studio imports) and generator output written to
// tmp/corpus/headerless/generated/ (e.g. single-step-r20 tools/build_fs.py run on
// a tmp copy, because the corpus has no built studios).
const GENERATED_DIR = join(TMP_DIR, 'headerless/generated');
const exportedFeatures = text => [...text.matchAll(/export\s+const\s+([A-Za-z_]\w*)\s*=\s*defineFeature\b/g)].map(m => m[1]);
const listFs = dir => { const out = []; if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) { const q = join(dir, e.name); if (e.isDirectory()) out.push(...listFs(q)); else if (e.name.endsWith('.fs')) out.push(q); } return out; };
const headed = facts.filter(r => r.header === true).map(r => ({ source: 'corpus', path: r.path, abs: join(CORPUS_ROOT, r.path), features: r.features ?? [], mtime: r.mtime }));
for (const abs of [join(REPO, 'fixtures/r10b/r10b.fs'), ...listFs(GENERATED_DIR)]) {
  const text = readFileSync(abs, 'utf8');
  headed.push({ source: abs.includes('/fixtures/') ? 'fixture' : 'generated', path: abs.slice(REPO.length + 1), abs, features: exportedFeatures(text), mtime: statSync(abs).mtimeMs });
}
const headedText = new Map();
const headedLines = new Map();
for (const h of headed) { const t = readFileSync(h.abs, 'utf8'); headedText.set(h.path, t); headedLines.set(h.path, new Set(sigLines(t))); }

// Generator scripts: .py/.mjs/.sh files up to two levels above the fragment
// that mention its file name.
function generators(path) {
  const name = basename(path), found = new Set();
  const dirs = [dirname(path), dirname(dirname(path)), dirname(dirname(dirname(path)))].filter((d, i, a) => d && d !== '.' && a.indexOf(d) === i);
  for (const d of dirs) {
    let entries; try { entries = readdirSync(join(CORPUS_ROOT, d), { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (!e.isFile() || !/\.(py|mjs|js|sh)$/.test(e.name)) continue;
      const p = join(CORPUS_ROOT, d, e.name);
      if (statSync(p).size > 1 << 20) continue;
      if (readFileSync(p, 'utf8').includes(name)) found.add(join(d, e.name));
    }
  }
  return [...found].sort();
}

function headerOf(text) {
  // Everything up to the last top-level import line.
  const lines = text.split('\n');
  let last = -1;
  for (let i = 0; i < Math.min(lines.length, 60); i++) if (/^\s*(FeatureScript\s+\d+\s*;|([A-Za-z_]\w*::)?import\s*\()/.test(lines[i])) last = i;
  return lines.slice(0, last + 1).join('\n') + '\n';
}

// User-defined top-level functions anywhere in the FS corpus: a stub that stops
// on one of these misses its splice context, not an Onshape std builtin.
const corpusUserFunctions = new Set(facts.flatMap(r => r.functionNames ?? []));

const rows = [];
for (const path of fragmentPaths) {
  const text = read(path), lines = sigLines(text), info = fileInfo.get(path) ?? {};
  const features = info.features ?? [];
  const first = text.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, '').trim().match(/^[A-Za-z_]\w*/)?.[0] ?? null;
  const twins = [];
  for (const h of headed) {
    const hl = headedLines.get(h.path);
    const hit = lines.filter(l => hl.has(l)).length;
    const score = lines.length ? hit / lines.length : 0;
    const hFeatures = new Set(h.features ?? []);
    const featuresIn = features.filter(f => hFeatures.has(f)).length;
    if (score < 0.6 || featuresIn < features.length) continue;
    const verbatim = headedText.get(h.path).includes(text.trim());
    const runCopy = h.source === 'corpus' ? runCopyOf.get(h.path) ?? null : null;
    twins.push({ source: h.source, path: h.path, score: Number(score.toFixed(3)), verbatim, sameDir: dirname(h.path) === dirname(path), runCopy, mtime: h.mtime });
  }
  twins.sort((a, b) => (b.verbatim - a.verbatim) || (b.score - a.score) || (b.sameDir - a.sameDir) || (b.mtime - a.mtime));
  const twin = twins.find(t => t.source === 'corpus') ?? null;
  // Outside-corpus twins: the frozen fixture always (its imports resolve), a
  // generated twin only when it matches better than the best corpus twin.
  const rank = t => (t ? (t.verbatim ? 2 : t.score) : 0);
  const extraTwins = [
    ...twins.filter(t => t.source === 'fixture' && t.score >= 0.9),
    ...twins.filter(t => t.source === 'generated' && t.score >= 0.8 && rank(t) > rank(twin)).slice(0, 1),
  ];
  // Twin results for the fragment's own features (the real next blocker).
  const next = features.map(feature => {
    if (!twin?.runCopy) return { feature, twinRecord: null };
    const tf = fileInfo.get(twin.runCopy);
    const key = tf && tf.features.length > 1 ? `${twin.runCopy}#${feature}` : twin.runCopy;
    const r = latest.get(key);
    if (!r) return { feature, twinRecord: null };
    const c = clusterOf(r);
    return { feature, twinRecord: { key, status: c.status, kind: c.kind, cluster: c.cluster, completedOperations: r.completedOperations ?? null,
      failingOperation: r.failingOperation?.name ?? null, message: c.message, pattern: c.message ? messagePattern(c.message) : null } };
  });
  rows.push({
    path, family: info.family ?? null, representative: info.representative ?? null, lines: info.lines ?? null,
    duplicatePaths: info.duplicatePaths ?? [], features, units: clusterRecs.filter(r => r.path === path).length,
    firstToken: first, parseError: clusterRecs.find(r => r.path === path)?.cliMessage ?? null,
    kind: twin ? (twin.verbatim ? 'splice-verbatim' : 'splice-edited') : extraTwins.length ? 'twin-outside-corpus' : 'no-headed-twin',
    generators: generators(path), twin, extraTwins, otherTwins: twins.filter(t => t !== twin && t.source === 'corpus').slice(0, 5).map(t => `${t.path} (${t.score})`), next,
  });
}

// ------------------------------------------------------------ stub runs
function runCli(file, feature, timeoutS) {
  return new Promise(resolveRun => {
    const argv = ['bin/wonky.mjs', file, '--check', ...(feature ? ['--feature', feature] : [])];
    const t0 = Date.now();
    const child = spawn(process.execPath, argv, { cwd: REPO, detached: true, stdio: ['ignore', 'pipe', 'pipe'], env: jsEnv });
    let out = '', err = '', killed = false;
    child.stdout.on('data', d => { out += d; }); child.stderr.on('data', d => { err += d; });
    const timer = setTimeout(() => { killed = true; try { process.kill(-child.pid, 'SIGKILL'); } catch {} }, timeoutS * 1000);
    child.on('close', code => { clearTimeout(timer); resolveRun({ argv, exitCode: code, killed, wallMs: Date.now() - t0, stdout: out.slice(-2000), stderr: err.slice(-2000) }); });
  });
}
function probe(file, feature) {
  try {
    const out = execSync(`${JSON.stringify(process.execPath)} scripts/corpus/probe.mjs fs ${JSON.stringify(file)} ${feature ? JSON.stringify(feature) : ''}`,
      { cwd: REPO, encoding: 'utf8', timeout: 480_000, maxBuffer: 16 << 20, env: jsEnv });
    return JSON.parse(out.trim().split('\n').pop());
  } catch (e) { return { ok: false, probeError: String(e.message).slice(0, 400) }; }
}

const meta = { startedAt: new Date().toISOString(), uptimeStart: uptime(), stub, concurrency };
if (stub) {
  mkdirSync(STUB_DIR, { recursive: true });
  const jobs = [];
  for (const row of rows) {
    const header = row.twin ? headerOf(headedText.get(row.twin.path)) : DEFAULT_HEADER;
    const slug = row.path.replace(/[\/]/g, '_');
    const file = join(STUB_DIR, slug);
    const stubText = header + read(row.path);
    // A verbatim splice "twin header + fragment" is byte-identical to the twin:
    // its recorded corpus runs already are the stub result.
    const same = [row.twin, ...row.extraTwins].find(t => t && stubText === headedText.get(t.path));
    if (same) {
      row.stub = { identicalTo: same.path, results: same.source === 'corpus' ? 'see next[] (recorded twin runs)' : 'see extraTwinResults[]' };
      row.extraTwinResults = [];
      for (const t of row.extraTwins) for (const feature of row.features) jobs.push({ row, file: t.path, feature, into: row.extraTwinResults, twin: t.path, headerLines: 0 });
      continue;
    }
    writeFileSync(file, stubText);
    row.stub = { file: file.slice(REPO.length + 1), header: row.twin ? `twin header (${header.split('\n').length - 1} lines)` : 'default Onshape Feature Studio header (2 lines)', headerLines: header.split('\n').length - 1, results: [] };
    for (const feature of row.features.length ? row.features : [null]) jobs.push({ row, file: row.stub.file, feature, into: row.stub.results, headerLines: row.stub.headerLines });
    // Headed twins outside the corpus have no recorded run: build them for the fragment's features.
    row.extraTwinResults = [];
    for (const t of row.extraTwins) for (const feature of row.features) jobs.push({ row, file: t.path, feature, into: row.extraTwinResults, twin: t.path, headerLines: 0 });
  }
  meta.jobs = jobs.length;
  if (args.includes('--dry-run')) { console.log(jobs.map(j => `${j.file} ${j.feature ?? ''}`).join('\n')); process.exit(0); }
  let i = 0;
  const worker = async () => {
    while (i < jobs.length) {
      const job = jobs[i++];
      const run = await runCli(job.file, job.feature, 480);
      const res = { ...(job.twin ? { twin: job.twin } : {}), feature: job.feature, exitCode: run.exitCode, killed: run.killed, wallMs: run.wallMs };
      if (run.exitCode !== 0) {
        const p = probe(job.file, job.feature);
        const rec = { message: p.message, errorClass: p.errorClass, userThrow: p.userThrow, completedOperations: p.trace?.completed ?? 0,
          failingOperation: p.trace?.failedOperation ?? null, sourceLine: p.sourceLine };
        const c = clusterOf(rec);
        const undefinedName = (String(p.message ?? '').match(/^'([^']+)' is not defined or not implemented/) ?? [])[1];
        const twinFunctions = new Set([job.row.twin, ...job.row.extraTwins].filter(Boolean)
          .flatMap(t => [...headedText.get(t.path).matchAll(/^\s*(?:export\s+)?function\s+([A-Za-z_]\w*)/gm)].map(m => m[1])));
        if (c.kind === 'undefined-builtin' && !job.twin && (corpusUserFunctions.has(undefinedName) || twinFunctions.has(undefinedName))) Object.assign(c, { kind: 'splice-context-helper', cluster: 'fs-headerless-include (helper defined in the splice target)' });
        Object.assign(res, { cli: (run.stderr.trim().split('\n').pop() ?? '').replace(REPO + '/', ''), status: c.status, kind: c.kind, cluster: c.cluster,
          completedOperations: rec.completedOperations, failingOperation: rec.failingOperation?.name ?? null,
          line: p.line, fragmentLine: p.line != null && !job.twin ? p.line - job.headerLines : null, message: c.message,
          callChain: rec.failingOperation?.callChain ?? null, sourceLine: p.sourceLine ?? null });
      } else res.status = 'ok';
      job.into.push(res);
      process.stderr.write(`[fragments] ${job.twin ? job.twin + ' for ' : ''}${job.row.path}${job.feature ? '#' + job.feature : ''}: ${res.status} ${res.cluster ?? ''} ${res.wallMs} ms\n`);
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
}
// Without --stub, keep the stub and built-twin results of the previous --stub run.
const OUT_FILE = join(OUT_DIR, 'fragments.json');
if (!stub && existsSync(OUT_FILE)) {
  const prev = JSON.parse(readFileSync(OUT_FILE, 'utf8'));
  const byPath = new Map(prev.rows.map(r => [r.path, r]));
  for (const row of rows) { const old = byPath.get(row.path); if (old?.stub) { row.stub = old.stub; row.extraTwinResults = old.extraTwinResults ?? []; } }
  meta.stubResultsFrom = prev.meta?.stub ? prev.meta : prev.meta?.stubResultsFrom ?? null;
}
meta.endedAt = new Date().toISOString(); meta.uptimeEnd = uptime();

// Effective next blocker per fragment feature, in order of fidelity: a headed
// twin outside the corpus that was built here (frozen fixture with resolved
// imports, or the project's own generator output), then the recorded corpus
// twin, then (paste-ins without any twin) the header-prepended stub.
for (const row of rows) {
  row.effectiveNext = row.features.map(feature => {
    const ex = (row.extraTwinResults ?? []).find(x => x.feature === feature);
    if (ex) return { feature, via: ex.twin, status: ex.status, cluster: ex.status === 'ok' ? null : ex.cluster, message: ex.message ?? null };
    const tw = row.next.find(n => n.feature === feature)?.twinRecord;
    if (tw) return { feature, via: tw.key, status: tw.status, cluster: tw.cluster, message: tw.message };
    const st = Array.isArray(row.stub?.results) ? row.stub.results.find(x => x.feature === feature) : null;
    if (st) return { feature, via: `stub (${row.stub.header})`, status: st.status, cluster: st.status === 'ok' ? null : st.cluster, message: st.message ?? null };
    return { feature, via: null, status: 'unknown', cluster: null, message: null };
  });
  const tally = {};
  for (const n of row.effectiveNext) { const k = n.cluster ?? n.status; tally[k] = (tally[k] ?? 0) + 1; }
  row.effectivePrimary = Object.entries(tally).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  row.effectiveTally = tally;
}
const summary = {
  files: rows.length, units: rows.reduce((a, r) => a + r.units, 0), families: new Set(rows.map(r => r.family)).size,
  byKind: rows.reduce((m, r) => ({ ...m, [r.kind]: (m[r.kind] ?? 0) + 1 }), {}),
  effectiveNextBlockerUnits: rows.flatMap(r => r.effectiveNext).reduce((m, n) => { const k = n.cluster ?? n.status; return { ...m, [k]: (m[k] ?? 0) + 1 }; }, {}),
  effectivePrimaryFiles: rows.reduce((m, r) => ({ ...m, [r.effectivePrimary]: (m[r.effectivePrimary] ?? 0) + 1 }), {}),
  twinNextBlocker: rows.flatMap(r => r.next).reduce((m, n) => { const k = n.twinRecord?.cluster ?? (n.twinRecord ? 'ok' : 'no twin record'); return { ...m, [k]: (m[k] ?? 0) + 1 }; }, {}),
};
writeFileSync(OUT_FILE, JSON.stringify({ schema: 'wonky-corpus-fragments/1', meta, summary, rows }, null, 1));
console.log(JSON.stringify(summary, null, 1));
