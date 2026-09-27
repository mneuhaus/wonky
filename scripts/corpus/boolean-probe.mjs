// Corpus failure analysis, cluster boolean-capability: re-run one FS unit
// through the production entry point (src/index.mjs build, same options as
// scripts/corpus/probe.mjs) with the in-memory instrumentation of
// scripts/corpus/boolean-hook-loader.mjs, and describe the failing opBoolean:
// operation, operand topology, which admission gate each operand misses, and
// for through-hole refusals the tool axis against the target's planar faces.
//
// Usage: node scripts/corpus/boolean-probe.mjs <file.fs> [feature] [--dump <operands.json.gz>]
//        WONKY_CORPUS_STUB=nary|pass|pass:<subcause,...>|pass-all|hybrid|hybrid-all node scripts/corpus/boolean-probe.mjs ...
//        WONKY_CORPUS_SIMULATE=linearc (F32x2 polygon prisms, see below; combinable with any stub)
// Prints one JSON line. --dump writes the failing operands as
// wonky-acceptance-operands/1 (gzip), the bake-off's frozen B-rep leaf format.
import { register } from 'node:module';
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { subcause } from './boolean-subcause.mjs';

register('./boolean-hook-loader.mjs', import.meta.url);

const args = process.argv.slice(2);
const dumpAt = args.indexOf('--dump');
const dump = dumpAt >= 0 ? args.splice(dumpAt, 2)[1] : null;
const [file, feature] = args;
const source = readFileSync(file, 'utf8');
const t0 = performance.now();

// WONKY_CORPUS_SIMULATE=linearc (diagnosis only, never production): every
// polygon prism (skPolyline, rectangle, line-only sketches, fCuboid) is built
// by the existing native F32x2 line/arc extruder (kernel/sketch-arcs.bend)
// instead of the F32 polygon extruder, exactly as
// scripts/corpus/boolean-invalid-topology/dump-operands.mjs --linearc does.
// It measures what the F32x2 prism fix proposed in
// docs/corpus/cluster-boolean-invalid-topology.md changes for this cluster.
const simulate = process.env.WONKY_CORPUS_SIMULATE ?? '';
if (simulate && simulate !== 'linearc') throw new Error(`unknown WONKY_CORPUS_SIMULATE '${simulate}'`);
if (simulate === 'linearc') {
  const { ModelingContext } = await import('../../src/library.mjs');
  const { solveSketchArcs, extrudeSketchArcs } = await import('../../src/sketch-arcs.mjs');
  ModelingContext.prototype.body = function (id, points, plane, delta, offset, loc) {
    const entities = points.map((p, i) => {
      const q = points[(i + 1) % points.length];
      return { type: 'line', index: i, id: `l${i}`, startMeters: p.map(v => v / 1000), endMeters: q.map(v => v / 1000) };
    });
    const profile = solveSketchArcs(this.kernel.sketchArcs, entities, loc);
    this.addSolid(id, extrudeSketchArcs(this.kernel.sketchArcs, this.kernel, profile, id.toString(), plane, delta, offset ?? [0, 0, 0], loc));
  };
}

let out;
try {
  const { build } = await import('../../src/index.mjs');
  const { normalizeModelingPolicy } = await import('../../src/modeling-policy.mjs');
  const sibling = resolve(dirname(file), 'modules.json');
  const model = await build(source, {
    feature: feature || undefined, parameters: {}, moduleManifest: existsSync(sibling) ? sibling : undefined,
    sourcePath: resolve(file), modelingPolicy: normalizeModelingPolicy({ curvedContacts: 'strict' }),
  });
  out = { ok: true, bodies: model.bodies.length, volumesMm3: model.bodies.map(b => b.validation?.volumeMm3 ?? null) };
  // WONKY_CORPUS_STEP=<prefix>: write <prefix>.step and .brep.json like the CLI,
  // for scripts/validate-step.py (used with the hybrid modes).
  if (process.env.WONKY_CORPUS_STEP) {
    const { toStep } = await import('../../src/exporters.mjs');
    const prefix = process.env.WONKY_CORPUS_STEP;
    mkdirSync(dirname(prefix), { recursive: true });
    writeFileSync(`${prefix}.brep.json`, JSON.stringify(model, null, 2) + '\n');
    try { writeFileSync(`${prefix}.step`, toStep(model, prefix.split('/').pop())); out.step = `${prefix}.step`; }
    catch (error) { out.stepError = String(error.message).slice(0, 300); }
  }
} catch (error) {
  const trace = error.modelTrace?.operations ?? [];
  const failed = [...trace].reverse().find(o => o.status === 'failed') ?? null;
  out = { ok: false, errorClass: error.name, message: String(error.message).slice(0, 400), line: error.line ?? null, column: error.column ?? null,
    completed: trace.filter(o => o.status === 'completed').length,
    failedOperation: failed ? { name: failed.name, operationId: failed.operationId, chain: (failed.callStack ?? []).map(f => `${f.name}@${f.calledAt?.line ?? '?'}:${f.calledAt?.column ?? '?'}`) } : null };
}
const log = globalThis.__corpusBoolean ?? { calls: [], stubs: [] };
out.booleanCalls = log.calls.length;
out.stubs = (log.stubs ?? []).map(s => ({ kind: s.kind, subcause: s.subcause ?? (s.kind === 'nary' ? 'nary' : null), operation: s.operation, id: s.id, message: s.message?.slice(0, 60), tools: s.tools, targets: s.targets, line: s.loc?.line, ...(s.kind === 'hybrid' ? { ms: s.ms, refused: s.refused, bodies: s.bodies } : {}) }));
if (log.arity && /two tools/.test(out.message ?? '')) { out.arity = { ...log.arity, loc: log.arity.loc ? { line: log.arity.loc.line, column: log.arity.loc.column } : null }; out.subcause = { key: 'nary', flags: [] }; }
const last = log.calls.at(-1);
if (!out.ok && last && /opBoolean|InvalidTopology|Unresolved|arrangement/.test(out.message) && !(log.arity && /two tools/.test(out.message))) {
  const sc = subcause(last.operation, last.a, last.b, out.message);
  out.subcause = { key: sc.key, flags: sc.flags, detail: sc.detail };
  out.failingBoolean = { operation: last.operation, id: last.id, a: sc.a, b: sc.b, arm: sc.arm, revolution: sc.revolution, pierce: sc.pierce };
  if (dump) {
    mkdirSync(dirname(dump), { recursive: true });
    const doc = { schema: 'wonky-acceptance-operands/1', sourceSha256: createHash('sha256').update(source).digest('hex'),
      purpose: `Exact inputs to the failing opBoolean of ${file}${feature ? '#' + feature : ''} (corpus cluster boolean-capability); not a completed model.`,
      operation: last.operation, operationId: last.id, location: last.loc ? { line: last.loc.line, column: last.loc.column } : null,
      bodies: [{ role: last.operation === 'SUBTRACTION' ? 'targets' : 'tools', body: last.a }, { role: 'tools', body: last.b }] };
    writeFileSync(dump, gzipSync(JSON.stringify(doc)));
    out.dumped = dump;
  }
}
out.ms = Math.round(performance.now() - t0);
if (simulate) out.simulate = simulate;
console.log(JSON.stringify(out));
