// Corpus failure analysis (cluster boolean-capability): a Node module load
// hook that instruments IN MEMORY the production modules the cluster fails in.
// Nothing on disk changes. The hook is registered only by the diagnostic probe
// scripts/corpus/boolean-probe.mjs; the CLIs never load it.
//
// Always (capture):
// - src/boolean.mjs: every booleanInBend call records its operands
//   (operation, both bodies, id, loc) in globalThis.__corpusBoolean.calls
//   before the production code runs. On a refusal the last record is the
//   failing call.
// - src/library.mjs (pre-W1 sources only): the opBoolean arity refusal
//   records how many tools and targets were passed
//   (globalThis.__corpusBoolean.arity) just before it throws. Since W1,
//   production opBoolean is N-ary and library.mjs is left unpatched.
//
// WONKY_CORPUS_STUB (next-blocker discovery only; never production):
// - "nary" (pre-W1 sources only; production folds since W1): an N-ary opBoolean (union of more than two tools, union with
//   targets, subtraction with several tools or targets) is folded into
//   successive binary calls of the unchanged production booleanInBend,
//   which is what an N-ary front end would do.
// - "pass": additionally, a booleanInBend refusal from this cluster (the
//   general, through-hole and non-coaxial-cylinder messages) returns the
//   first operand unchanged instead of throwing (subtraction/intersection:
//   the target unchanged; union: the first operand, the second is dropped, so
//   the models' own one-solid checks still see one solid). The geometry is
//   then WRONG by construction; the probe uses it only to see which blocker
//   the file reaches next, and records every stubbed call.
// - "pass:<key>,<key>": as "pass", but only for refusals whose sub-cause
//   (scripts/corpus/boolean-subcause.mjs: coaxial-revolution,
//   pierce-admission, general-trim, general) is listed. Used to measure what
//   each targeted fix alone would reveal next (the fix ladder).
// - "hybrid": N-ary fold, and every refusal of this cluster is handed to the
//   bake-off's corefine + recover prototypes (scripts/corpus/boolean-hybrid.mjs);
//   their exact B-rep replaces the refusal, their refusal is re-thrown with
//   the production message plus the hybrid's stage and reason. TEST ONLY: it
//   measures what the prototype route would build, file by file.
// - "hybrid-all": as "hybrid" for every UnsupportedFeatureError of
//   booleanInBend (also the planar arrangement's InvalidTopology).
// - "pass-all": as "pass", and also every other UnsupportedFeatureError of
//   booleanInBend (the planar arrangement's InvalidTopology /
//   UnsupportedArrangement / ResolutionLimit, the coaxial path), so the probe
//   reaches the first blocker that is not a Boolean at all.
const STUB = process.env.WONKY_CORPUS_STUB ?? '';

export async function load(url, context, nextLoad) {
  const result = await nextLoad(url, context);
  if (url.endsWith('/src/boolean.mjs')) {
    let source = String(result.source);
    const head = 'export function booleanInBend(kernel, a, b, operation, id, loc, identityContext = {}) {';
    if (!source.includes(head)) throw new Error('boolean-hook: booleanInBend signature changed');
    source = source.replace(head, 'function booleanInBendProduction(kernel, a, b, operation, id, loc, identityContext = {}) {');
    source = `import { subcause as __corpusSubcause } from ${JSON.stringify(new URL('./boolean-subcause.mjs', import.meta.url).href)};\n` +
      (STUB.startsWith('hybrid') ? `import { hybridBoolean as __corpusHybrid } from ${JSON.stringify(new URL('./boolean-hybrid.mjs', import.meta.url).href)};\n` : '') + source;
    source += `
export function booleanInBend(kernel, a, b, operation, id, loc, identityContext = {}) {
  const log = (globalThis.__corpusBoolean ??= { calls: [], stubs: [] });
  log.calls.push({ a, b, operation, id, loc });
  if (log.calls.length > 400) log.calls.shift();
  try { return booleanInBendProduction(kernel, a, b, operation, id, loc, identityContext); }
  catch (error) {
    const cluster = error?.name === 'UnsupportedFeatureError' && /^opBoolean (supports coaxial|through hole|requires coaxial cylinders)/.test(error.message);
    const any = error?.name === 'UnsupportedFeatureError';
    const stub = ${JSON.stringify(STUB)};
    // Diagnostic only; a classifier failure must never mask the production error.
    let sub = null;
    try { sub = cluster ? __corpusSubcause(operation, a, b, error.message) : null; } catch { sub = { key: 'unclassified', flags: [] }; }
    const selected = stub.startsWith('pass:') && cluster && stub.slice(5).split(',').includes(sub.key);
    if ((stub === 'hybrid' && cluster) || (stub === 'hybrid-all' && any)) {
      const h = __corpusHybrid(kernel, a, b, operation, id);
      log.stubs.push({ kind: 'hybrid', subcause: sub ? sub.key : null, operation, id, message: error.message, loc, ms: h.ms, refused: h.refused ?? null, bodies: h.bodies?.length ?? null });
      if (h.refused) { error.message = error.message + ' [hybrid ' + h.refused + ']'; throw error; }
      const out = h.bodies;
      out.operationEvidence = [];
      return out;
    }
    if (!((stub === 'pass' && cluster) || selected || (stub === 'pass-all' && any))) throw error;
    log.stubs.push({ kind: cluster ? 'pass' : 'pass-other', subcause: sub ? sub.key : null, operation, id, message: error.message, loc });
    const out = [a];
    out.operationEvidence = [];
    return out;
  }
}
`;
    return { ...result, source };
  }
  if (url.endsWith('/src/library.mjs')) {
    let source = String(result.source);
    // Since W1 (2026-09-23) production opBoolean is N-ary
    // (ModelingContext.naryBoolean, docs/corpus/w1.md): the arity guard is
    // gone, there is no arity to record, and "nary" needs no fold. The patch
    // below applies only to pre-W1 sources.
    if (source.includes('this.naryBoolean(')) return result;
    const guard = "if (subtract ? tools.length !== 1 || targets.length !== 1 : tools.length !== 2 || d.targets !== undefined) unsupported(";
    if (!source.includes(guard)) throw new Error('boolean-hook: opBoolean arity guard changed');
    const record = "(globalThis.__corpusBoolean ??= { calls: [], stubs: [] }).arity = { operation, tools: tools.length, targets: targets.length, targetsGiven: d.targets !== undefined, id: id.toString(), loc };";
    let fold = '';
    if (['nary', 'pass', 'pass-all'].includes(STUB) || STUB.startsWith('pass:') || STUB.startsWith('hybrid')) {
      // Onshape semantics: UNION merges tools and targets into its connected
      // components; SUBTRACTION removes every tool from every target.
      // Decomposed into binary production calls (UNION component-aware,
      // SUBTRACTION/INTERSECTION folded left); lineage and record bookkeeping
      // as in the binary path below (the first record keeps its identity).
      // Until 2026-09-23 04:25 the UNION fold was a left fold that continued
      // with the first result body only; the probe-nary / probe-pass* /
      // probe-hybrid files were produced with that fold.
      fold = `
        if (subtract ? (tools.length > 1 || targets.length > 1) && tools.length && targets.length : (tools.length + targets.length > 2 || (d.targets !== undefined && tools.length + targets.length === 2))) {
          globalThis.__corpusBoolean.stubs.push({ kind: 'nary', operation, tools: tools.length, targets: targets.length, id: id.toString(), loc });
          if (!subtract && d.keepTools) unsupported('keepTools is currently supported only for subtraction', loc);
          this.claim(context, id, loc);
          let step = 0;
          if (operation === 'UNION') {
            // Onshape unites all bodies at once. A pairwise step can return two
            // disjoint components that a later body connects (two cheeks that
            // meet only through a web), so every later body meets every
            // component collected so far, not just the first. A component
            // that does not touch the new body stays as it is. The record that
            // comes first in source order keeps its identity.
            const all = [...targets, ...tools].map(r => r.record);
            const order = new Map(all.map((r, i) => [r.key, i]));
            let components = [all[0]];
            for (const next of all.slice(1)) {
              let current = next;
              const apart = [];
              for (const part of components) {
                const [keep, drop] = order.get(part.key) < order.get(current.key) ? [part, current] : [current, part];
                const results = booleanInBend(this.kernel, keep.body, drop.body, operation, id.toString() + '/nary' + (step++), loc, { modelingPolicy: this.modelingPolicy });
                if (results.length !== 1) { apart.push(part); continue; }
                for (const key of ['name', 'appearance']) if (keep.body[key] !== undefined) results[0][key] = keep.body[key];
                keep.body = results[0];
                keep.createdBy = new Set([...keep.createdBy, ...drop.createdBy, id.key()]);
                this.records.delete(drop.key);
                this.operationEvidence.push(...(results.operationEvidence ?? []));
                current = keep;
              }
              components = [...apart, current];
            }
            return;
          }
          const pairs = subtract ? targets.map(t => [t.record, tools.map(r => r.record)]) : [[[...targets, ...tools][0].record, [...targets, ...tools].slice(1).map(r => r.record)]];
          for (const [first, others] of pairs) {
            for (const other of others) {
              if (!this.records.has(first.key)) break;
              const results = booleanInBend(this.kernel, first.body, other.body, operation, id.toString() + '/nary' + (step++), loc, { modelingPolicy: this.modelingPolicy });
              const lineage = new Set([...first.createdBy, ...(subtract ? [] : other.createdBy), id.key()]);
              if (!subtract) this.records.delete(other.key);
              if (!results.length) { this.records.delete(first.key); break; }
              const [head, ...rest] = results;
              for (const body of results) for (const key of ['name', 'appearance']) if (first.body[key] !== undefined) body[key] = first.body[key];
              first.body = head; first.createdBy = lineage;
              for (const body of rest) { this.addSolid(id, body); this.records.get(String(this.nextRecord - 1)).createdBy = new Set(lineage); }
              this.operationEvidence.push(...(results.operationEvidence ?? []));
            }
          }
          if (subtract && !d.keepTools) for (const t of tools) this.records.delete(t.record.key);
          return;
        }`;
    }
    source = source.replace(guard, `${record}${fold}\n        ${guard}`);
    return { ...result, source };
  }
  return result;
}
