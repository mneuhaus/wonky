// Like scripts/corpus/probe.mjs (fs only), plus explicit feature parameters.
// Calls the production entrypoint src/index.mjs build with the CLI's default
// modeling policy. Run it with `node --import ./prototype/register.mjs` to get
// the prototype fix of cluster fs-interpreter-semantics applied in memory.
//
// Usage: node scripts/corpus/fs-interpreter-semantics/probe-params.mjs <file.fs> [feature] [paramsJSON]
// Prints one JSON line on stdout. Never writes geometry.
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const [file, feature, paramsJson] = process.argv.slice(2);
const source = readFileSync(file, 'utf8');
const lines = source.split('\n');
const parameters = paramsJson ? JSON.parse(paramsJson) : {};
const t0 = performance.now();

function summarizeTrace(trace) {
  const ops = trace?.operations ?? [];
  const failed = [...ops].reverse().find(o => o.status === 'failed') ?? null;
  const running = [...ops].reverse().find(o => o.status === 'running') ?? null;
  const at = failed ?? running;
  return {
    operations: ops.length,
    completed: ops.filter(o => o.status === 'completed').length,
    failedOperation: at ? {
      name: at.name, operationId: at.operationId, status: at.status,
      line: at.source?.span?.line ?? null, column: at.source?.span?.column ?? null,
      callChain: (at.callStack ?? []).map(f => `${f.name}@${f.calledAt?.line ?? '?'}:${f.calledAt?.column ?? '?'}`),
      error: at.error ?? null,
    } : null,
    lastCompleted: [...ops].reverse().find(o => o.status === 'completed')?.name ?? null,
  };
}

try {
  const { build } = await import('../../../src/index.mjs');
  const { normalizeModelingPolicy } = await import('../../../src/modeling-policy.mjs');
  const sibling = resolve(dirname(file), 'modules.json');
  const model = await build(source, {
    feature: feature || undefined, parameters, moduleManifest: existsSync(sibling) ? sibling : undefined,
    sourcePath: resolve(file), modelingPolicy: normalizeModelingPolicy({ curvedContacts: 'strict' }),
  });
  const volume = model.bodies.reduce((s, b) => s + (b.validation?.volumeMm3 ?? 0), 0);
  console.log(JSON.stringify({ ok: true, bodies: model.bodies.length, volumeMm3: volume, operations: model.sourceMap?.operations?.length ?? null, ms: performance.now() - t0 }));
} catch (error) {
  const line = error.line ?? null;
  const text = line ? lines[line - 1] ?? '' : '';
  const userThrow = line != null && /\bthrow\b|regenError\s*\(/.test(text) && error.name === 'FeatureScriptError';
  console.log(JSON.stringify({
    ok: false, ms: performance.now() - t0,
    errorClass: error.name ?? error.constructor?.name ?? null,
    message: String(error.message ?? error).slice(0, 1000),
    line, column: error.column ?? null, sourceLine: text.trim().slice(0, 240), userThrow,
    trace: summarizeTrace(error.modelTrace),
  }));
}
