// Diagnosis only. Runs the Part Studio seeding prototype
// (tmp/corpus/cluster-partstudio/seeded-build.mjs) with the in-memory Boolean
// hook of scripts/corpus/boolean-hook-loader.mjs registered, so that
// WONKY_CORPUS_STUB (pass-all | hybrid-all | ...) applies. Prints the seeded
// build's JSON line, then one line {stubMode, booleanCalls, stubs}.
//   WONKY_CORPUS_STUB=pass-all node scripts/corpus/fs-needs-partstudio-input/seeded-hooked.mjs <target.fs> [seeded-build args]
import { register } from 'node:module';
register('../boolean-hook-loader.mjs', import.meta.url);
const exit = process.exit;
const report = () => {
  const log = globalThis.__corpusBoolean ?? { calls: [], stubs: [] };
  console.log(JSON.stringify({ stubMode: process.env.WONKY_CORPUS_STUB ?? null, booleanCalls: log.calls.length,
    stubs: (log.stubs ?? []).map(s => ({ kind: s.kind, operation: s.operation, id: String(s.id ?? ''), message: String(s.message ?? '').slice(0, 140),
      line: s.loc?.line ?? null, refused: s.refused ?? null, bodies: s.bodies ?? null, ms: s.ms ?? null })) }));
};
process.exit = code => { report(); exit(code); };
await import('../../../tmp/corpus/cluster-partstudio/seeded-build.mjs');
report();
