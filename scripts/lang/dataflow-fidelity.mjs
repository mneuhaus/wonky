// Fidelity of the graph tracer against wonky's real FeatureScript build.
//
// The real build (src/index.mjs, Bend kernel on the JS target) records every
// modeling call with its operation id in its source map. The graph tracer
// (src/lang/dataflow/fs-trace.mjs) records the same calls as WGraph nodes
// without a kernel. For every program the real build reaches, the sequence of
// operation ids of kernel operations (op*/f*) must be identical, and the
// tracer's node for each operation must carry the same source line.
// r10b is compared up to the real build's first failure (a known capability
// limit of the Boolean kernel), under the strict default policy.
//
//   node scripts/lang/dataflow-fidelity.mjs [--no-r10b]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { loadavg } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { build } from '../../src/index.mjs';
import { traceFeatureScript } from '../../src/lang/dataflow/fs-trace.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const load = () => loadavg().map(x => Math.round(x * 100) / 100).join(' ');
const withR10b = !process.argv.includes('--no-r10b');
const kernelOp = name => /^(op[A-Z]|f[A-Z])/.test(name) && name !== 'opDeleteBodies';

export async function compare(path, { feature, moduleManifest } = {}) {
  const source = readFileSync(join(root, path), 'utf8');
  const t0 = performance.now();
  let real, failure = null;
  try { real = await build(source, { feature, moduleManifest: moduleManifest && join(root, moduleManifest), sourcePath: path }); }
  catch (error) { failure = { name: error.name, message: error.message.slice(0, 200), line: error.line }; real = { sourceMap: error.modelTrace }; }
  const realMs = performance.now() - t0;
  const ops = (real.sourceMap?.operations ?? []).filter(o => kernelOp(o.name));
  const t1 = performance.now();
  const traced = traceFeatureScript(source, { feature, moduleManifest: moduleManifest && join(root, moduleManifest), sourcePath: path });
  const traceMs = performance.now() - t1;
  const nodes = traced.graph.nodes.filter(n => n.kind === 'op' && !['sketch', 'import', 'import.select', 'import.opaque'].includes(n.op));
  const realIds = ops.map(o => o.operationId), graphIds = nodes.map(n => n.name);
  const prefix = graphIds.slice(0, realIds.length);
  const sameIds = realIds.every((id, i) => id === prefix[i]);
  const sameLines = ops.every((o, i) => o.source?.span?.line === nodes[i]?.span?.line);
  return { path, feature: feature ?? null, realOps: realIds.length, graphOps: graphIds.length, identicalPrefix: sameIds, identicalLines: sameLines,
    realFailure: failure, traceStatus: traced.status, realMs: Math.round(realMs), traceMs: Math.round(traceMs * 10) / 10,
    firstMismatch: sameIds ? null : realIds.findIndex((id, i) => id !== prefix[i]) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const report = { schema: 'wonky.lang.dataflow-fidelity/1', capturedAt: new Date().toISOString(), loadBefore: load(), cases: [] };
  const cases = ['examples/box.fs', 'examples/bracket.fs', 'examples/bored-spacer.fs', 'examples/tilted-plate.fs', 'examples/line-sketch.fs',
    'examples/conical-spacer.fs', 'examples/compare-before.fs', 'examples/convex-intersection.fs', 'examples/concave-intersection.fs',
    'fixtures/public-boolean-regressions/adapted/fuse-g1.fs', 'fixtures/public-boolean-regressions/adapted/cut-h1.fs'];
  for (const path of cases) { const r = await compare(path); report.cases.push(r); console.log(JSON.stringify(r)); }
  if (withR10b) { const r = await compare('fixtures/r10b/r10b.fs', { feature: 'singleStepR10b', moduleManifest: 'fixtures/r10b/modules.json' }); report.cases.push(r); console.log(JSON.stringify(r)); }
  report.loadAfter = load();
  mkdirSync(join(root, 'out/lang/dataflow'), { recursive: true });
  writeFileSync(join(root, 'out/lang/dataflow/fidelity.json'), JSON.stringify(report, null, 1) + '\n');
}
