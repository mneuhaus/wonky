// Diagnostic re-run of a failed unit through the same production entrypoints
// the CLIs call (src/index.mjs build, src/python.mjs buildPython), with the
// same options. The CLIs print only "file:line:col: message"; this probe adds
// what the CLI output lacks: the JS error class, the failing modeling call
// (from the production source-map trace), its call chain, the number of
// completed modeling calls, and the JS stack top for crashes.
//
// Usage: node scripts/corpus/probe.mjs fs <file.fs> [--modules <manifest.json>] [feature]
//          (without --modules, a sibling modules.json is used as by the CLI)
//        node scripts/corpus/probe.mjs py <file.py> <python> <timeoutMs>
// Prints one JSON line on stdout. Never writes geometry.
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const argv = process.argv.slice(2);
const modulesAt = argv.indexOf('--modules');
const explicitManifest = modulesAt >= 0 ? resolve(argv.splice(modulesAt, 2)[1]) : undefined;
const [frontend, file, a, b] = argv;
const source = readFileSync(file, 'utf8');
const lines = source.split('\n');
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
  if (frontend === 'fs') {
    const { build } = await import('../../src/index.mjs');
    const { normalizeModelingPolicy } = await import('../../src/modeling-policy.mjs');
    const sibling = resolve(dirname(file), 'modules.json');
    const model = await build(source, {
      feature: a || undefined, parameters: {}, moduleManifest: explicitManifest ?? (existsSync(sibling) ? sibling : undefined),
      sourcePath: resolve(file), modelingPolicy: normalizeModelingPolicy({ curvedContacts: 'strict' }),
    });
    console.log(JSON.stringify({ ok: true, bodies: model.bodies.length, ms: performance.now() - t0 }));
  } else {
    const { buildPython } = await import('../../src/python.mjs');
    const model = await buildPython(source, { filename: resolve(file), python: a, timeoutMs: Number(b) });
    console.log(JSON.stringify({ ok: true, bodies: model.bodies.length, ms: performance.now() - t0 }));
  }
} catch (error) {
  const line = error.line ?? null;
  const text = line ? lines[line - 1] ?? '' : '';
  const userThrow = frontend === 'fs' && line != null && /\bthrow\b|regenError\s*\(/.test(text) && error.name === 'FeatureScriptError';
  const stack = String(error.stack ?? '').split('\n').slice(1, 9).map(s => s.trim().replace(/\(?\/Users\/[^)]*wonky-kernel\//, '('));
  console.log(JSON.stringify({
    ok: false, ms: performance.now() - t0,
    errorClass: error.name ?? error.constructor?.name ?? null,
    message: String(error.message ?? error).slice(0, 2000),
    line, column: error.column ?? null, sourceLine: text.trim().slice(0, 240), userThrow,
    traceback: error.traceback ? String(error.traceback).slice(-3000) : null,
    trace: summarizeTrace(error.modelTrace),
    jsStack: stack,
  }));
}
