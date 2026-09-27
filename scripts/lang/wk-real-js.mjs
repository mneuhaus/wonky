// Today's production path for one FeatureScript feature, timed in buckets, as a
// fresh child process of scripts/lang/wk-real.mjs (the WK real-model spike):
//   importMs   module graph (src/index.mjs)
//   kernelMs   loadKernel(): Bend JS target load, or with WONKY_BACKEND=native
//              the in-process addon (op-at-a-time native, docs/native-bridge.md)
//   buildMs    build(): parser + interpreter + kernel adapters + identity (cold)
//   warmMs     further build() calls in the same process (warm)
//   exportMs   JSON serialization of the model to disk
// Also: status and error (with FS span), the source-map operation list (the
// fidelity reference for the recorder), the Boolean method of every opBoolean
// and a summary of every output body (src/lang/wk/real-host.mjs bodySummary).
// Usage: node scripts/lang/wk-real-js.mjs <model.fs> <feature|-> <out.json> [--warm N] [--bodies file]
// Production code is only imported, never modified.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { createHash } from 'node:crypto';

const load = () => execSync('uptime').toString().trim().replace(/.*load averages?: /, '');
const [file, featureArg, out, ...rest] = process.argv.slice(2);
const option = name => rest.includes(name) ? rest[rest.indexOf(name) + 1] : null;
const warm = Number(option('--warm') ?? 0), bodiesOut = option('--bodies');
const feature = featureArg === '-' ? undefined : featureArg;
const report = { schema: 'wonky-lang-wk-real-js/2', file, feature: feature ?? null, backend: process.env.WONKY_BACKEND ?? 'js', loadBefore: load(),
  processStartToScriptMs: performance.now() };
let t = performance.now();
const { build } = await import('../../src/index.mjs');
const { loadKernel } = await import('../../src/kernel.mjs');
const { bodySummary } = await import('../../src/lang/wk/real-host.mjs');
const { methodOf } = await import('../../src/lang/wk/record-fs.mjs');
report.importMs = performance.now() - t;
t = performance.now();
try { await loadKernel(); } catch (error) { report.kernelError = { name: error.name, code: error.code ?? null, message: String(error.message).slice(0, 400) }; }
report.kernelMs = performance.now() - t;
const source = readFileSync(file, 'utf8');
const once = async () => build(source, { feature, sourcePath: resolve(file) });
let model, trace = null;
t = performance.now();
try { model = await once(); report.status = 'ok'; trace = model; }
catch (error) {
  report.status = error.name === 'UnsupportedFeatureError' || error.name === 'NativeCapabilityError' ? 'capability' : 'error';
  report.error = { name: error.name, code: error.code ?? null, message: String(error.message).slice(0, 400), line: error.line ?? null, column: error.column ?? null };
  trace = { sourceMap: error.modelTrace, operationEvidence: error.completedOperationEvidence ?? [] };
}
report.buildMs = performance.now() - t;
// paramsSha: the source-map snapshot of the operation's arguments (it becomes
// identity.operation.parameters), so the fidelity check sees any difference in it
report.operations = (trace.sourceMap?.operations ?? []).map(o => ({ seq: o.sequence, id: o.operationId, name: o.name,
  line: o.source?.span?.line ?? null, column: o.source?.span?.column ?? null, status: o.status,
  paramsSha: createHash('sha256').update(JSON.stringify(o.parameters ?? null)).digest('hex').slice(0, 16) }));
report.booleans = (trace.operationEvidence ?? []).map(e => ({ id: e.operationId, method: methodOf(e.method), status: e.status }));
report.warmMs = [];
if (model) for (let i = 0; i < warm; i++) { t = performance.now(); await once(); report.warmMs.push(performance.now() - t); }
if (model) {
  t = performance.now();
  writeFileSync(`${out}.model.json`, JSON.stringify(model));
  report.exportMs = performance.now() - t;
  report.bodies = model.bodies.map(bodySummary);
  if (bodiesOut) writeFileSync(bodiesOut, JSON.stringify(model.bodies));
}
report.loadAfter = load();
writeFileSync(out, JSON.stringify(report, null, 1));
console.log(JSON.stringify({ status: report.status, error: report.error?.message?.slice(0, 120) ?? null, importMs: Math.round(report.importMs), kernelMs: Math.round(report.kernelMs),
  buildMs: Math.round(report.buildMs), warmMs: report.warmMs.map(Math.round), bodies: report.bodies?.length ?? 0, operations: report.operations.length }));
