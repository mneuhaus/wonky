#!/usr/bin/env node
// Checks for docs/language/semantic-core.md, written to out/lang/semantic-core-check.json:
//  ir      WCore/0 size of r10b and the examples (nodes, U32 words, bytes) next
//          to the source and parse-tree size, plus desugar time;
//  corpus  desugar every unique FeatureScript file of ~/Workspace/cad (read
//          only) that src/parser.mjs accepts; count failures and IR size;
//  r10b    (with --r10b) run the frozen r10b fixture through the reference
//          interpreter and through FS -> WCore/0 -> JS evaluator and compare
//          the observed modeling-operation traces call by call, up to and
//          including the first failure. Long: two full JS-target runs.
// Indicative timings only: shared, loaded machine; load averages recorded.
import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { loadavg, homedir } from 'node:os';
import { performance } from 'node:perf_hooks';
import { parse } from '../../src/parser.mjs';
import { build } from '../../src/index.mjs';
import { buildCore } from '../../src/lang/semcore/build.mjs';
import { desugarProgram } from '../../src/lang/semcore/desugar-fs.mjs';
import { irStats } from '../../src/lang/semcore/ir.mjs';

const root = new URL('../../', import.meta.url).pathname;
const outPath = join(root, 'out/lang/semantic-core-check.json');
const load = () => loadavg().map(v => v.toFixed(2)).join(' ');
const withR10b = process.argv.includes('--r10b');
// --tolerated: the acceptance configuration (tolerated-regularized curved contacts, cap 1e-7 mm), which runs further.
const tolerated = process.argv.includes('--tolerated');
const policy = tolerated ? { curvedContacts: 'tolerated-regularized', contactCapMm: 1e-7 } : undefined;
const r10bKey = tolerated ? 'r10bTolerated' : 'r10b';
const previous = existsSync(outPath) ? JSON.parse(readFileSync(outPath, 'utf8')) : {};
const report = { schema: 'wonky-lang-semantic-core-check/1', generatedAt: new Date().toISOString(), node: process.version, loadBefore: load() };

function irRow(file, source) {
  const t0 = performance.now(); const ast = parse(source); const t1 = performance.now();
  const program = desugarProgram(ast); const t2 = performance.now();
  const stats = irStats(program);
  return { file, sourceBytes: Buffer.byteLength(source), parseMs: +(t1 - t0).toFixed(2), desugarMs: +(t2 - t1).toFixed(2),
    ...stats };
}
report.ir = [irRow('fixtures/r10b/r10b.fs', readFileSync(join(root, 'fixtures/r10b/r10b.fs'), 'utf8')),
  ...readdirSync(join(root, 'examples')).filter(f => f.endsWith('.fs')).map(f => irRow(`examples/${f}`, readFileSync(join(root, 'examples', f), 'utf8')))];

// Corpus census: desugaring must never fail on a program the parser accepts.
const corpusRoot = process.env.WONKY_CORPUS_ROOT ?? join(homedir(), 'Workspace', 'cad');
const skip = new Set(['node_modules', 'vendor', 'site-packages', '__pycache__', 'venv', 'dist-packages']);
const files = [];
const walk = dir => { let entries = []; try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) { if (e.isDirectory()) { if (!skip.has(e.name) && !e.name.startsWith('.')) walk(join(dir, e.name)); } else if (e.name.endsWith('.fs')) files.push(join(dir, e.name)); } };
if (existsSync(corpusRoot)) walk(corpusRoot);
const seen = new Set();
const corpus = { root: corpusRoot, files: 0, unique: 0, parsed: 0, parseFailed: 0, desugared: 0, desugarFailed: 0, failures: [], sourceBytes: 0, irBytes: 0, irNodes: 0, desugarMs: 0 };
for (const path of files) {
  let source; try { if (statSync(path).size > 8e6) continue; source = readFileSync(path, 'utf8'); } catch { continue; }
  corpus.files++;
  const sha = createHash('sha256').update(source).digest('hex');
  if (seen.has(sha)) continue; seen.add(sha); corpus.unique++;
  let ast; try { ast = parse(source); corpus.parsed++; } catch { corpus.parseFailed++; continue; }
  try {
    const t0 = performance.now(); const program = desugarProgram(ast); corpus.desugarMs += performance.now() - t0;
    const stats = irStats(program); corpus.desugared++; corpus.sourceBytes += Buffer.byteLength(source); corpus.irBytes += stats.bytes; corpus.irNodes += stats.nodes;
  } catch (error) { corpus.desugarFailed++; corpus.failures.push({ file: relative(corpusRoot, path), error: String(error.message).slice(0, 160) }); }
}
corpus.desugarMs = +corpus.desugarMs.toFixed(1);
corpus.irBytesPerSourceByte = +(corpus.irBytes / corpus.sourceBytes).toFixed(2);
report.corpus = corpus;

// r10b trace equivalence.
const opKey = op => ({ name: op.name, operationId: op.operationId, status: op.status, at: op.source?.span ? `${op.source.span.line}:${op.source.span.column}` : null,
  error: op.error ? `${op.error.name}: ${op.error.message}` : null, outputs: op.outputs?.length ?? 0, removed: op.removedBodies?.length ?? 0 });
async function r10bRun(runner, extra = {}) {
  const source = readFileSync(join(root, 'fixtures/r10b/r10b.fs'), 'utf8');
  const loadBefore = load(), t0 = performance.now();
  let trace, failure = null, bodies = null, core = null;
  try {
    const model = await runner(source, { feature: 'singleStepR10b', moduleManifest: join(root, 'fixtures/r10b/modules.json'), sourcePath: 'fixtures/r10b/r10b.fs', modelingPolicy: policy, ...extra });
    trace = model.sourceMap; bodies = model.bodies.length; core = model.core ?? null;
  } catch (error) {
    trace = error.modelTrace; failure = { name: error.name, message: String(error.message).slice(0, 240), at: error.line ? `${error.line}:${error.column}` : null };
    core = error.coreStats ?? null;
  }
  return { wallMs: +(performance.now() - t0).toFixed(0), loadBefore, loadAfter: load(), failure, bodies, core, operations: (trace?.operations ?? []).map(opKey) };
}
if (withR10b) {
  const interpreter = await r10bRun(build);
  const core = await r10bRun(buildCore);
  const n = Math.max(interpreter.operations.length, core.operations.length);
  let firstDifference = null;
  for (let i = 0; i < n; i++) {
    if (JSON.stringify(interpreter.operations[i]) !== JSON.stringify(core.operations[i])) { firstDifference = { index: i, interpreter: interpreter.operations[i] ?? null, core: core.operations[i] ?? null }; break; }
  }
  const sameFailure = JSON.stringify(interpreter.failure) === JSON.stringify(core.failure);
  report[r10bKey] = { policy: tolerated ? 'tolerated-regularized, contactCapMm 1e-7' : 'strict (default)', feature: 'singleStepR10b', operations: [interpreter.operations.length, core.operations.length],
    identicalTrace: !firstDifference, sameFailure, firstDifference,
    interpreter: { ...interpreter, operations: undefined }, core: { ...core, operations: undefined },
    operationsSample: interpreter.operations.slice(0, 5), lastOperation: interpreter.operations.at(-1) };
}
for (const key of ['r10b', 'r10bTolerated']) if (!report[key] && previous[key]) report[key] = previous[key];

report.loadAfter = load();
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ir: report.ir[0], corpus: { ...corpus, failures: corpus.failures.slice(0, 5) }, r10b: report[r10bKey] && { ...report[r10bKey], operationsSample: undefined } }, null, 1));
