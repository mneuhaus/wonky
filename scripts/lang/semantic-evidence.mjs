#!/usr/bin/env node
// Evidence for docs/language/semantic-core.md (semantic-core study).
//
// 1. probes: small FeatureScript programs run through wonky's real frontend
//    (src/index.mjs build, Bend JS target). Each records what wonky does today
//    next to what Onshape documents (FsDoc / std source), so divergences are
//    observed facts, not guesses. Nothing is modified; no export is written.
// 2. ast: size of today's parsed FS AST (node count, spans, bytes) for the
//    frozen r10b fixture and the examples, i.e. what a "ship the desugared AST
//    to Bend" design would have to serialize, plus warm parse time.
// 3. builtins: wonky's FS builtin surface and Python bridge ops, categorized.
// 4. stdBoundary: Onshape's own host boundary (the `@name(` builtins the MIT
//    std library calls) from the local mirror in tmp/lang/onshape-std, and
//    which corpus calls wonky lacks are pure FS in std vs kernel builtins.
// 5. syncSites: aggregate of geometry-synchronization sites from the corpus
//    scan in tmp/lang/fs-facts.json (produced by scripts/lang/scan-fs.mjs), if
//    present. Read only.
//
// Usage: node scripts/lang/semantic-evidence.mjs [out.json]
// Indicative timings only (shared, loaded machine; load averages recorded).
import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { loadavg } from 'node:os';
import { performance } from 'node:perf_hooks';
import { build } from '../../src/index.mjs';
import { buildCore } from '../../src/lang/semcore/build.mjs';
import { parse } from '../../src/parser.mjs';
import { ModelingContext } from '../../src/library.mjs';

const root = new URL('../../', import.meta.url).pathname;
const outPath = process.argv[2] ?? join(root, 'out/lang/semantic-evidence.json');
const load = () => loadavg().map(v => v.toFixed(2)).join(' ');
const header = 'FeatureScript 3044;\nimport(path : "onshape/std/geometry.fs", version : "3044.0");\n';
const main = body => `${header}export const main = defineFeature(function(context is Context, id is Id, definition is map) {\n${body}\n});`;
const cube = (name, x = 0) => `fCuboid(context, id + "${name}", {"corner1": vector(${x},0,0)*millimeter, "corner2": vector(${x + 1},1,1)*millimeter});`;
const count = 'size(evaluateQuery(context, qAllModifiableSolidBodies()))';

// Each probe: wonky source, the Onshape reference behavior and where it is
// documented. `onshape` is quoted/paraphrased from the cited source; entries
// marked "undocumented" are open questions, not claims.
const probes = [
  { name: 'valueSemantics', source: main(`var a = [1, 2]; var b = a; b[0] = 9; ${cube('a')} throw regenError("a0=" ~ a[0] ~ " b0=" ~ b[0]);`),
    onshape: 'Values behave as if copied on assignment: a0=1 b0=9.', ref: 'https://cad.onshape.com/FsDoc/variables.html' },
  { name: 'closureCapture', source: main(`var x = 1; const f = function() { return x; }; x = 2; ${cube('a')} throw regenError("closure sees " ~ f());`),
    onshape: 'Undocumented. FsDoc equality: lambdas are equal if created by the same definition and their bound values (captured from an enclosing block scope) are equal, i.e. captures are treated as values.', ref: 'https://cad.onshape.com/FsDoc/relational.html' },
  { name: 'overloadByType', source: `${header}function f(a is number) { return "num"; }\nfunction f(a is string) { return "str"; }\nexport const main = defineFeature(function(context is Context, id is Id, definition is map) { ${cube('a')} throw regenError(f(1) ~ f("x")); });`,
    onshape: 'Overload resolution picks the most specific satisfying overload by argument count and type; std relies on it (e.g. 4 qCreatedBy overloads).', ref: 'https://cad.onshape.com/FsDoc/top-level.html' },
  { name: 'arrowLambda', source: main(`const f = x => x + 1; ${cube('a')} throw regenError("f=" ~ f(1));`),
    onshape: 'Valid: `x => x^2` lambda form.', ref: 'https://cad.onshape.com/FsDoc/syntax.html' },
  { name: 'mapForInKeyValue', source: main(`var n = 0; for (var k, v in {"a": 1, "b": 2}) { n += v; } ${cube('a')} throw regenError("n=" ~ n);`),
    onshape: 'Valid; iteration proceeds in (deterministic) key order.', ref: 'https://cad.onshape.com/FsDoc/syntax.html' },
  { name: 'boxReference', source: main(`var b = new box(1); var c = b; c[] = 2; ${cube('a')} throw regenError("b=" ~ b[]);`),
    onshape: 'Boxes give reference semantics: b=2.', ref: 'https://cad.onshape.com/FsDoc/variables.html' },
  { name: 'exceptionIsValue', source: main(`${cube('a')} try { throw regenError("inner"); } catch (e) { throw regenError("caught " ~ e.message); }`),
    onshape: 'Exceptions are values; library errors are usually maps with a message field, so e.message is "inner".', ref: 'https://cad.onshape.com/FsDoc/exceptions.html' },
  { name: 'enumIsTypeTagged', source: main(`${cube('a')} if (!(BoundingType.BLIND is BoundingType)) throw regenError("enum value is not tagged"); throw regenError("tagged");`),
    onshape: 'An enum value is the string with the enum type tag, so BoundingType.BLIND is BoundingType.', ref: 'https://cad.onshape.com/FsDoc/top-level.html' },
  { name: 'trySilentStatementForm', source: main(`${cube('a')} try silent { throw regenError("x"); } throw regenError("continued");`),
    onshape: 'Valid: try silent may be used in either the statement or the expression form; expected "continued".', ref: 'https://cad.onshape.com/FsDoc/exceptions.html' },
  { name: 'trySilentCapability', source: main(`${cube('a')} const r = try silent(opFillet(context, id + "f", {"entities": qCreatedBy(id + "a", EntityType.EDGE), "radius": 0.1 * millimeter})); throw regenError("continued");`),
    onshape: 'try silent suppresses reporting of all exceptions raised within it. wonky deliberately differs: a missing capability is not a model exception (AGENTS.md).', ref: 'https://cad.onshape.com/FsDoc/exceptions.html' },
  { name: 'tryExpressionUndefined', source: main(`const g = function() { throw regenError("x"); }; const v = try(g()); ${cube('a')} throw regenError("v is undefined: " ~ (v == undefined));`),
    onshape: 'try(expr) yields undefined if an exception is raised; without silent the exception is still reported in the notices flyout.', ref: 'https://cad.onshape.com/FsDoc/exceptions.html' },
  { name: 'undefinedNameInTry', source: main(`${cube('a')} const v = try(notDefinedAnywhere()); throw regenError("continued");`),
    onshape: 'An undefined identifier is reported by Onshape before execution, not as a catchable runtime exception.', ref: 'analysis (Onshape editor behavior; not quoted)' },
  { name: 'qCreatedByPrefix', source: main(`${cube('a')} throw regenError("prefix bodies " ~ size(evaluateQuery(context, qCreatedBy(id, EntityType.BODY))));`),
    onshape: 'qCreatedBy(featureId) selects entities created by the feature, including its sub-operations (id + "a").', ref: 'tmp/lang/onshape-std/query.fs (qCreatedBy)' },
  { name: 'nestedFeatureRollback', source: `${header}const sub = defineFeature(function(context is Context, id is Id, definition is map) { ${cube('a')} throw regenError("sub fails after creating a body"); });\nexport const main = defineFeature(function(context is Context, id is Id, definition is map) { try { sub(context, id + "sub", {}); } catch (e) { } ${cube('b', 2)} throw regenError("bodies " ~ ${count}); });`,
    onshape: 'defineFeature wraps the body in startFeature/endFeature and calls @abortFeature on failure, then rethrows for non-top-level ids: the nested body is rolled back, bodies 1.', ref: 'tmp/lang/onshape-std/feature.fs defineFeature' },
  { name: 'opPatternPartialCommit', source: main(`${cube('a')} try { opPattern(context, id + "p", {"entities": qCreatedBy(id + "a", EntityType.BODY), "transforms": [transform(vector(5, 0, 0) * millimeter), 5], "instanceNames": ["i1", "i2"]}); } catch (e) { } throw regenError("bodies " ~ ${count});`),
    onshape: 'Undocumented for single ops; an op that throws should not leave half its output (required for try/catch to be meaningful). Atomic result: bodies 1.', ref: 'analysis' },
  { name: 'failedOpKeepsIdClaim', source: main(`${cube('a')} try { opDeleteBodies(context, id + "d", {"entities": 5}); } catch (e) { } opDeleteBodies(context, id + "d", {"entities": qCreatedBy(id + "a", EntityType.BODY)}); ${cube('c', 3)} throw regenError("bodies " ~ ${count});`),
    onshape: 'Undocumented. std notes abortFeature does not roll back computed data, so an aborted id should not be reused.', ref: 'tmp/lang/onshape-std/feature.fs abortFeature' },
  { name: 'staleTransientReference', source: main(`fCuboid(context, id + "a", {"corner1": vector(0,0,0)*millimeter, "corner2": vector(10,10,10)*millimeter});
      fCuboid(context, id + "b", {"corner1": vector(5,5,5)*millimeter, "corner2": vector(15,15,15)*millimeter});
      const edges = evaluateQuery(context, qOwnedByBody(qCreatedBy(id + "a", EntityType.BODY), EntityType.EDGE));
      const before = evLine(context, {"edge": edges[3]});
      opBoolean(context, id + "u", {"tools": qUnion([qCreatedBy(id + "a", EntityType.BODY), qCreatedBy(id + "b", EntityType.BODY)]), "operationType": BooleanOperationType.UNION});
      const after = try(evLine(context, {"edge": edges[3]}));
      throw regenError("same edge after union: " ~ (after != undefined && before.origin == after.origin && before.direction == after.direction) ~ ", resolved: " ~ (after != undefined));`),
    onshape: 'std query.fs: "All transient queries are only valid until the context is modified again." Using one afterwards must not silently name a different entity.', ref: 'tmp/lang/onshape-std/query.fs qTransient' },
  { name: 'selfRecursiveConstLambda', source: main(`const f = function(n) { return n == 0 ? 0 : 1 + f(n - 1); }; ${cube('a')} throw regenError("depth " ~ f(50));`),
    onshape: 'Undocumented whether a const lambda can reference its own binding (capture of values at creation would not see it).', ref: 'analysis' },
  { name: 'recursionDepth', source: main(`const f = function(n) { return n == 0 ? 0 : 1 + f(n - 1); }; ${cube('a')} throw regenError("depth " ~ f(100));`),
    onshape: 'No documented recursion limit (a lambda also cannot name itself before its const is bound, so this is also a scoping probe).', ref: 'analysis' },
  { name: 'binary64Numbers', source: main(`${cube('a')} throw regenError("eq " ~ ((2^53 + 1) == 2^53) ~ " sum " ~ (0.1 + 0.2));`),
    onshape: 'Numbers are IEEE binary64: (2^53+1)==2^53 is true.', ref: 'https://cad.onshape.com/FsDoc/variables.html' },
  { name: 'unitsMismatch', source: main(`${cube('a')} throw regenError("x " ~ (1 * meter + 1));`),
    onshape: 'Adding a length and a number is an error.', ref: 'FsDoc units' },
];

async function outcomeOf(run) {
  try {
    const model = await run();
    return { status: 'ok', bodies: model.bodies.length };
  } catch (error) {
    return { status: error.name, message: String(error.message).slice(0, 220), at: error.line ? `${error.line}:${error.column}` : null };
  }
}
// Each probe runs through the reference interpreter (wonky today) and through
// FS -> WCore/0 -> JS reference evaluator with transactions (src/lang/semcore).
async function runProbes() {
  const rows = [];
  for (const probe of probes) {
    const t0 = performance.now();
    const wonky = await outcomeOf(() => build(probe.source, { trace: false }));
    const core = await outcomeOf(() => buildCore(probe.source, { trace: false }));
    rows.push({ name: probe.name, wonky, core, onshape: probe.onshape, ref: probe.ref, ms: +(performance.now() - t0).toFixed(1) });
  }
  return rows;
}

function astStats(source) {
  const times = [];
  let program;
  for (let i = 0; i < 7; i++) { const t0 = performance.now(); program = parse(source); times.push(performance.now() - t0); }
  times.sort((a, b) => a - b);
  let nodes = 0, spans = 0, maxDepth = 0, names = 0, calls = 0, literalBytes = 0;
  const kinds = {};
  const seen = new WeakSet();
  const walk = (value, depth) => {
    if (!value || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) { for (const v of value) walk(v, depth); return; }
    if (typeof value.kind === 'string' && !('column' in value && 'value' in value && !('loc' in value) && ['name', 'string', 'number', 'symbol', 'eof'].includes(value.kind))) {
      nodes++; kinds[value.kind] = (kinds[value.kind] ?? 0) + 1; maxDepth = Math.max(maxDepth, depth);
      if (value.loc) spans++;
      if (value.kind === 'name') names++;
      if (value.kind === 'call') calls++;
      if (value.kind === 'literal' && typeof value.value === 'string') literalBytes += value.value.length;
    }
    for (const [key, child] of Object.entries(value)) if (key !== 'loc') walk(child, depth + 1);
  };
  walk(program, 0);
  // Compact form: every loc token replaced by [line, column].
  const compact = JSON.stringify(program, (key, value) => key === 'loc' && value ? [value.line, value.column] : value);
  return { sourceBytes: Buffer.byteLength(source), nodes, spans, calls, names, maxDepth, literalStringBytes: literalBytes,
    compactJsonBytes: Buffer.byteLength(compact), bytesPerNode: +(Buffer.byteLength(compact) / nodes).toFixed(1),
    parseMsMedian: +times[3].toFixed(2), parseMsMin: +times[0].toFixed(2), distinctKinds: Object.keys(kinds).length };
}

function builtinInventory() {
  const names = Object.keys(new ModelingContext(null).builtins()).sort();
  const category = name =>
    /^(op[A-Z]|f[A-Z])/.test(name) ? 'kernel-op' :
    /^(sk[A-Z]|newSketchOnPlane)/.test(name) ? 'sketch' :
    /^q[A-Z]/.test(name) ? 'query-constructor' :
    /^(ev[A-Z]|evaluateQuery)/.test(name) ? 'query-evaluation/measure' :
    /^(setProperty|getProperty)$/.test(name) ? 'properties' :
    /^(newInstantiator|addInstance|instantiate)$/.test(name) ? 'instantiator/import' :
    /^(defineFeature|isLength|regenError|unstableIdComponent)$/.test(name) ? 'feature-machinery' :
    /^(meter|centimeter|millimeter|inch|foot|degree|radian|PI|LENGTH_BOUNDS|POSITIVE_LENGTH_BOUNDS)$/.test(name) ? 'units/constants' :
    /^[A-Z][A-Za-z]+$/.test(name) ? 'enum' : 'value/math';
  const byCategory = {};
  for (const name of names) (byCategory[category(name)] ??= []).push(name);
  const python = [...readFileSync(join(root, 'src/python.mjs'), 'utf8').matchAll(/case '(\w+)'/g)].map(m => m[1]);
  return { featureScriptCount: names.length, byCategory, pythonBridgeOps: python };
}

function stdBoundary() {
  const dir = join(root, 'tmp/lang/onshape-std');
  if (!existsSync(dir)) return { available: false };
  const files = readdirSync(dir).filter(f => f.endsWith('.fs'));
  const src = files.map(f => readFileSync(join(dir, f), 'utf8')).join('\n');
  const at = [...new Set([...src.matchAll(/@([A-Za-z]\w*)\s*\(/g)].map(m => m[1]))].sort();
  const cat = n => /^op/.test(n) ? 'op' : /^ev/.test(n) ? 'ev' : /^sk/.test(n) ? 'sk' : /^(start|end|abort)Feature$/.test(n) ? 'featureTransaction' :
    /^(get|set)(Variable|Attribute|Property|AllVariables|AllAttributes|Attributes)$|^removeAttributes$/.test(n) ? 'contextState' : 'other';
  const byCategory = {};
  for (const n of at) byCategory[cat(n)] = (byCategory[cat(n)] ?? 0) + 1;
  const exportedFunctions = (src.match(/^export (?:function|const|predicate|operator)\s*\w*/gm) ?? []).length;
  const overloaded = {};
  for (const m of src.matchAll(/^export function (\w+)\s*\(/gm)) overloaded[m[1]] = (overloaded[m[1]] ?? 0) + 1;
  const overloadedNames = Object.entries(overloaded).filter(([, n]) => n > 1);
  let missing = null;
  const censusPath = join(root, 'out/lang/semantic-census.json');
  if (existsSync(censusPath)) {
    const census = JSON.parse(readFileSync(censusPath, 'utf8'));
    const rows = Object.entries(census.featureScript.missingCallFiles).map(([name, files]) => {
      const re = new RegExp(`export (?:function|const|predicate) ${name}\\b`, 'g');
      const bodies = []; let m;
      while ((m = re.exec(src))) { const next = src.indexOf('\nexport ', m.index + 10); bodies.push(src.slice(m.index, next < 0 ? undefined : next)); }
      if (!bodies.length) return { name, files, kind: 'user' };
      const prims = [...new Set([...bodies.join('\n').matchAll(/@([A-Za-z]\w*)\s*\(/g)].map(x => x[1]))];
      return { name, files, kind: prims.some(p => /^(op|ev|sk|evaluateQuery)/.test(p)) ? 'std-over-kernel-builtin' : prims.length ? 'std-over-value-builtin' : 'std-pure-fs' };
    });
    const sum = kind => rows.filter(r => r.kind === kind);
    missing = Object.fromEntries(['std-pure-fs', 'std-over-kernel-builtin', 'std-over-value-builtin', 'user'].map(k => [k, { names: sum(k).length, fileMentions: sum(k).reduce((s, r) => s + r.files, 0), top: sum(k).slice(0, 12).map(r => `${r.name}(${r.files})`) }]));
  }
  return { available: true, source: 'github.com/javawizard/onshape-std-library-mirror (MIT), local copy', files: files.length,
    lines: src.split('\n').length, bytes: Buffer.byteLength(src), exportedDeclarations: exportedFunctions,
    overloadedExportedFunctions: overloadedNames.length, overloadExamples: overloadedNames.slice(0, 10).map(([n, c]) => `${n}×${c}`),
    atBuiltins: at.length, atBuiltinsByCategory: byCategory, wonkyMissingCallsInCorpus: missing };
}

function syncSites() {
  const path = join(root, 'tmp/lang/fs-facts.json');
  if (!existsSync(path)) return { available: false };
  const d = JSON.parse(readFileSync(path, 'utf8'));
  const files = d.files.filter(f => ['feature', 'library'].includes(f.role));
  const families = new Map();
  for (const f of files) {
    const sites = (f.sites ?? []).filter(s => s.reachable);
    const fam = families.get(f.family) ?? { kinds: new Set() };
    for (const s of sites) fam.kinds.add(`${s.kind}/${s.sub}`);
    families.set(f.family, fam);
  }
  const byKind = {};
  for (const fam of families.values()) for (const k of fam.kinds) byKind[k] = (byKind[k] ?? 0) + 1;
  const withAny = [...families.values()].filter(f => f.kinds.size).length;
  const withBranch = [...families.values()].filter(f => [...f.kinds].some(k => k.startsWith('geo-branch'))).length;
  const withIterate = [...families.values()].filter(f => [...f.kinds].some(k => k.startsWith('geo-iterate'))).length;
  return { available: true, scannedAt: d.scannedAt, unit: 'file families (revisions clustered by scripts/lang/corpus-files.mjs)',
    families: families.size, familiesWithReachableSyncSite: withAny, familiesWithGeometryDependentBranch: withBranch,
    familiesWithGeometryDependentIteration: withIterate,
    familiesByKind: Object.fromEntries(Object.entries(byKind).sort((a, b) => b[1] - a[1])) };
}

const report = { schema: 'wonky-lang-semantic-evidence/1', generatedAt: new Date().toISOString(), node: process.version,
  target: 'Bend 2.0.25 JavaScript target (probes only; no timing claims about native)', loadBefore: load() };
report.probes = await runProbes();
report.ast = {};
for (const file of ['fixtures/r10b/r10b.fs', ...readdirSync(join(root, 'examples')).filter(f => f.endsWith('.fs')).map(f => `examples/${f}`)]) {
  report.ast[file] = astStats(readFileSync(join(root, file), 'utf8'));
}
report.builtins = builtinInventory();
report.stdBoundary = stdBoundary();
report.syncSites = syncSites();
report.loadAfter = load();
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(report, null, 2));
for (const p of report.probes) console.log(p.name.padEnd(24), '|', p.wonky.message ?? `bodies ${p.wonky.bodies}`, '|', JSON.stringify(p.core) === JSON.stringify(p.wonky) ? 'core: same' : `core: ${p.core.status} ${p.core.message ?? ''}`);
console.log('r10b ast', JSON.stringify(report.ast['fixtures/r10b/r10b.fs']));
console.log('load', report.loadBefore, '->', report.loadAfter, 'written', outPath);
