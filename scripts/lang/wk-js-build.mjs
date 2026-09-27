// Today's production JS path for one FeatureScript feature (src/index.mjs
// build(), Bend kernel compiled to JavaScript), as a child process of the WK
// real-model spike (scripts/lang/wk-real.mjs). Writes a JSON summary:
//   status, error (with FS span), wall time, the source-map operation list
//   (operation ids, names, spans: the fidelity reference for the recorder),
//   every output body (geometry revision, faces, F32x2 volume words, identity
//   labels) and the Boolean method of every opBoolean (operation evidence).
// Run with the kernel-entry counter to get per-entry call counts:
//   WONKY_NB_COUNT_OUT=<file> node --import ./scripts/native-bridge/count-kernel-calls.mjs \
//     scripts/lang/wk-js-build.mjs <model.fs> <feature> <out.json> [--bodies <bodies.json>]
// Production code is only imported, never modified.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { execSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';

const load = () => execSync('uptime').toString().trim().replace(/.*load averages?: /, '');
const [file, feature, out, ...rest] = process.argv.slice(2);
const bodiesOut = rest.includes('--bodies') ? rest[rest.indexOf('--bodies') + 1] : null;
if (!file || !feature || !out) throw new Error('usage: wk-js-build.mjs <model.fs> <feature> <out.json> [--bodies <file>]');

const t0 = performance.now();
const { build } = await import('../../src/index.mjs');
const { geometryRevision } = await import('../../src/identity.mjs');
const { methodOf } = await import('../../src/lang/wk/record-fs.mjs');
const t1 = performance.now();
const source = readFileSync(file, 'utf8');
const loadBefore = load();
const report = { schema: 'wonky-lang-wk-js-build/1', file, feature, loadBefore, importMs: t1 - t0 };
let model = null;
const t2 = performance.now();
try {
  model = await build(source, { feature, sourcePath: resolve(file) });
  report.status = 'ok';
} catch (error) {
  report.status = error.name === 'UnsupportedFeatureError' ? 'capability' : 'error';
  report.error = { name: error.name, message: String(error.message).slice(0, 400), line: error.line ?? null, column: error.column ?? null };
  model = { sourceMap: error.modelTrace, operationEvidence: error.completedOperationEvidence ?? [], bodies: [] };
}
report.buildMs = performance.now() - t2;
report.loadAfter = load();
report.operations = (model.sourceMap?.operations ?? []).map(o => ({ seq: o.sequence, id: o.operationId, name: o.name,
  line: o.source?.span?.line ?? null, column: o.source?.span?.column ?? null, status: o.status }));
report.booleans = (model.operationEvidence ?? []).map(e => ({ id: e.operationId, operation: e.operation, method: methodOf(e.method), methodText: e.method, status: e.status }));
report.methods = report.booleans.reduce((m, b) => ({ ...m, [b.method]: (m[b.method] ?? 0) + 1 }), {});
const words = v => { const hi = Math.fround(v), lo = Math.fround(v - hi); return [hi, lo]; };
report.bodies = model.bodies.map(body => ({ id: body.id, name: body.name ?? null, geometry: body.geometry ?? 'planar', precision: body.precision ?? 'F32',
  vertices: body.vertices.length, edges: body.edges.length, faces: body.faces.length, revision: geometryRevision(body),
  volumeMm3: body.validation?.volumeMm3 ?? null, volumeWords: body.validation?.volumeMm3 == null ? null : words(body.validation.volumeMm3),
  method: body.construction?.method ?? null, identity: body.identity ? JSON.stringify(body.identity) : null }));
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(report, null, 1));
if (bodiesOut) { mkdirSync(dirname(bodiesOut), { recursive: true }); writeFileSync(bodiesOut, JSON.stringify(model.bodies)); }
console.log(JSON.stringify({ file, feature, status: report.status, error: report.error?.message ?? null, line: report.error?.line ?? null,
  buildMs: Math.round(report.buildMs), bodies: report.bodies.length, methods: report.methods, load: [loadBefore, report.loadAfter] }));
