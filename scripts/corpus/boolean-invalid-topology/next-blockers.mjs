// Cluster boolean-invalid-topology: next-blocker discovery (diagnosis only).
// Runs scripts/corpus/diagnose-planar-admission.mjs (same arguments, e.g.
// --simulate linearc) with the in-memory hook of scripts/corpus/boolean-hook-loader.mjs
// registered. With WONKY_CORPUS_STUB=pass-all every Boolean refusal returns the
// first operand unchanged (WRONG geometry by construction), so the unit runs on to
// the first blocker that is not a Boolean. Prints the diagnose lines, then one
// line {stubs: [...]} listing every stubbed Boolean.
//   WONKY_CORPUS_STUB=pass-all node scripts/corpus/boolean-invalid-topology/next-blockers.mjs <file.fs> [feature] --simulate linearc
import { register } from 'node:module';
register('../boolean-hook-loader.mjs', import.meta.url);
await import('../diagnose-planar-admission.mjs');
const log = globalThis.__corpusBoolean ?? { calls: [], stubs: [] };
console.log(JSON.stringify({ stubMode: process.env.WONKY_CORPUS_STUB ?? null, booleanCalls: log.calls.length,
  stubs: (log.stubs ?? []).map(s => ({ kind: s.kind, operation: s.operation, id: s.id, message: String(s.message ?? '').slice(0, 120), line: s.loc?.line ?? null })) }));
