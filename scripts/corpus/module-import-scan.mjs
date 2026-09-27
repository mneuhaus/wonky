// Static triage of the fs-module-import cluster (docs/corpus/cluster-fs-module-import.md).
//
// For every corpus file with at least one unit in the cluster (latest record
// per unit in out/corpus/runs.jsonl, kind import-*), parse the source with the
// production parser (read only) and record:
//   - its namespace imports: path form (same-document element, other document
//     doc/x/elem, local path) and version (microversion or "local");
//   - every NS::name it references (build = Part Studio bodies, anything else =
//     Feature Studio code);
//   - every addInstance call: definition keys, whether a loadedContext is
//     passed, and the shape of the partQuery (source-feature-id query via
//     makeId, name lookup, qEverything, ...);
//   - callees that are neither declared in the file nor production builtins
//     (a static hint of later frontend blockers);
//   - the unit statuses of the file (import units vs units blocked elsewhere);
//   - whether a sibling modules.json exists and whether a same-named file of the
//     same folder is byte-identical to the frozen r10b fixture.
//
// Usage: node scripts/corpus/module-import-scan.mjs
// Writes out/corpus/module-import/scan.json. Never writes into the corpus.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { CORPUS_ROOT, OUT_DIR, REPO, RUNS } from './lib.mjs';
import { parse } from '../../src/parser.mjs';
import { loadKernel } from '../../src/kernel.mjs';
import { ModelingContext } from '../../src/library.mjs';

const OUT = join(OUT_DIR, 'module-import');
mkdirSync(OUT, { recursive: true });

const latest = new Map();
for (const line of readFileSync(RUNS, 'utf8').split('\n')) {
  if (!line.trim()) continue;
  const r = JSON.parse(line);
  if (r.runner === 'corpus-run/1') latest.set(r.key, r);
}
const targets = JSON.parse(readFileSync(join(OUT_DIR, 'targets.json'), 'utf8'));
const fileInfo = new Map(targets.files.map(f => [f.path, f]));
const byPath = new Map();
for (const r of latest.values()) { if (!byPath.has(r.path)) byPath.set(r.path, []); byPath.get(r.path).push(r); }
const clusterPaths = [...byPath].filter(([, rs]) => rs.some(r => r.kind?.startsWith('import-'))).map(([p]) => p).sort();

const kernel = await loadKernel();
const builtinNames = new Set(Object.keys(new ModelingContext(kernel).builtins()));
const r10bFixtureSha = createHash('sha256').update(readFileSync(join(REPO, 'fixtures/r10b/r10b.fs'))).digest('hex');

const ID = '[0-9a-f]{24}';
const pathForm = spec => spec.version === 'local' ? 'local-path'
  : new RegExp(`^${ID}$`).test(spec.path) ? 'same-document-element'
  : new RegExp(`^${ID}/${ID}/${ID}$`).test(spec.path) ? 'other-document'
  : 'other';

function walk(node, visit) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) { for (const x of node) walk(x, visit); return; }
  visit(node);
  for (const [k, v] of Object.entries(node)) if (k !== 'loc' && v && typeof v === 'object') walk(v, visit);
}
// Compact shape of an expression: call names nested, literals masked.
function shape(e, depth = 0) {
  if (!e || depth > 6) return '…';
  switch (e.kind) {
    case 'call': return `${shape(e.callee, depth + 1)}(${e.args.map(a => shape(a, depth + 1)).join(',')})`;
    case 'name': return e.name;
    case 'literal': return typeof e.value === 'string' ? '"…"' : String(e.value);
    case 'access': return `${shape(e.value, depth + 1)}[${shape(e.key, depth + 1)}]`;
    case 'binary': return `${shape(e.left, depth + 1)}${e.operator}${shape(e.right, depth + 1)}`;
    case 'map': return '{…}';
    case 'array': return `[${e.items.map(i => shape(i, depth + 1)).join(',')}]`;
    default: return e.kind;
  }
}
function partQueryKind(e) {
  const s = shape(e);
  if (/makeId\(/.test(s)) return 'source-feature-id (qCreatedBy(makeId("<source feature id>")+...))';
  if (e?.kind === 'access') return 'name lookup in loaded context (r10b idiom)';
  if (/qEverything|qAllModifiableSolidBodies|qAllSolidBodies/.test(s)) return 'all bodies of the source';
  if (/qCreatedBy/.test(s)) return 'qCreatedBy(other id)';
  if (/qTransient|qPartsAttachedTo|qNthElement/.test(s)) return 'other query';
  return `other: ${s.slice(0, 80)}`;
}

const rows = [];
for (const path of clusterPaths) {
  const abs = join(CORPUS_ROOT, path);
  const text = readFileSync(abs, 'utf8');
  const sha256 = createHash('sha256').update(text).digest('hex');
  const units = byPath.get(path);
  const row = {
    path, family: units[0].family, representative: units[0].representative, lines: text.split('\n').length, sha256,
    siblingModulesJson: existsSync(join(dirname(abs), 'modules.json')),
    byteIdenticalToR10bFixture: sha256 === r10bFixtureSha,
    duplicatePaths: fileInfo.get(path)?.duplicatePaths ?? [],
    units: units.map(r => ({ feature: r.feature, status: r.status, kind: r.kind, cluster: r.kind?.startsWith('import-') ? 'fs-module-import' : null,
      message: (r.message ?? '').slice(0, 200), location: r.location ? `${r.location.line}:${r.location.column}` : null, completedOperations: r.completedOperations })),
  };
  let ast;
  try { ast = parse(text); } catch (error) { row.parseError = error.message; rows.push(row); continue; }
  row.imports = ast.imports.filter(i => i.namespace).map(i => ({ namespace: i.namespace, path: i.path, version: i.version, form: pathForm(i) }));
  const nsNames = new Set(row.imports.map(i => i.namespace));
  const refs = {}, addInstances = [], callees = new Set(), declared = new Set();
  for (const d of ast.declarations) declared.add(d.name);
  walk(ast.declarations, node => {
    if (node.kind === 'declaration' && node.name) declared.add(node.name);
    if (node.kind === 'function') for (const p of node.params ?? []) declared.add(p.name);
    if (node.kind === 'for' && node.name) declared.add(node.name);
    if (node.kind === 'try' && node.name) declared.add(node.name);
    if (node.kind === 'name' && node.name.includes('::')) {
      const [ns, name] = node.name.split('::');
      if (nsNames.has(ns)) { refs[ns] ??= {}; refs[ns][name] = (refs[ns][name] ?? 0) + 1; }
    }
    if (node.kind === 'call' && node.callee.kind === 'name') {
      const name = node.callee.name;
      if (!name.includes('::')) callees.add(name);
      if (name === 'addInstance') {
        const def = node.args[2];
        const keys = def?.kind === 'map' ? def.fields.map(([k]) => k.kind === 'literal' ? k.value : '(expr)') : ['(non-literal)'];
        const pq = def?.kind === 'map' ? def.fields.find(([k]) => k.value === 'partQuery')?.[1] : null;
        addInstances.push({ build: shape(node.args[1]), keys, loadedContext: keys.includes('loadedContext'), configuration: keys.includes('configuration'),
          partQuery: pq ? partQueryKind(pq) : null, partQueryShape: pq ? shape(pq).slice(0, 160) : null });
      }
    }
  });
  row.nsReferences = refs;
  row.usesBuild = Object.values(refs).some(r => r.build);
  row.usesCode = Object.values(refs).some(r => Object.keys(r).some(n => n !== 'build'));
  row.codeNames = [...new Set(Object.entries(refs).flatMap(([ns, r]) => Object.keys(r).filter(n => n !== 'build').map(n => `${ns}::${n}`)))];
  row.addInstance = {
    count: addInstances.length,
    withLoadedContext: addInstances.filter(a => a.loadedContext).length,
    withConfiguration: addInstances.filter(a => a.configuration).length,
    keys: [...new Set(addInstances.flatMap(a => a.keys))].sort(),
    partQueryKinds: Object.entries(addInstances.reduce((c, a) => ({ ...c, [a.partQuery]: (c[a.partQuery] ?? 0) + 1 }), {})),
    example: addInstances[0]?.partQueryShape ?? null,
  };
  row.undeclaredCallees = [...callees].filter(n => !declared.has(n) && !builtinNames.has(n)).sort();
  row.importUnits = units.filter(r => r.kind?.startsWith('import-')).length;
  row.otherUnits = units.length - row.importUnits;
  row.okUnits = units.filter(r => r.status === 'ok').length;
  rows.push(row);
}

const count = (arr, f) => arr.reduce((c, x) => { for (const k of [].concat(f(x))) c[k] = (c[k] ?? 0) + 1; return c; }, {});
const summary = {
  schema: 'wonky-corpus-module-import-scan/1', generatedAt: new Date().toISOString(),
  files: rows.length, families: new Set(rows.map(r => r.family)).size,
  units: rows.reduce((s, r) => s + r.importUnits, 0),
  filesAllUnitsInCluster: rows.filter(r => r.otherUnits === 0).length,
  filesWithSiblingModulesJson: rows.filter(r => r.siblingModulesJson).length,
  filesByteIdenticalToR10bFixture: rows.filter(r => r.byteIdenticalToR10bFixture).length,
  importForms: count(rows.flatMap(r => r.imports ?? []), i => i.form),
  filesByUse: count(rows, r => r.usesBuild && r.usesCode ? 'build+code' : r.usesBuild ? 'build' : r.usesCode ? 'code' : 'none'),
  addInstanceTotals: {
    calls: rows.reduce((s, r) => s + (r.addInstance?.count ?? 0), 0),
    withLoadedContext: rows.reduce((s, r) => s + (r.addInstance?.withLoadedContext ?? 0), 0),
    withConfiguration: rows.reduce((s, r) => s + (r.addInstance?.withConfiguration ?? 0), 0),
    partQueryKinds: rows.flatMap(r => r.addInstance?.partQueryKinds ?? []).reduce((c, [k, n]) => ({ ...c, [k]: (c[k] ?? 0) + n }), {}),
    keys: count(rows, r => r.addInstance?.keys ?? []),
  },
  codeNames: count(rows, r => r.codeNames ?? []),
  undeclaredCallees: Object.entries(count(rows, r => r.undeclaredCallees ?? [])).sort((a, b) => b[1] - a[1]),
};
writeFileSync(join(OUT, 'scan.json'), JSON.stringify({ summary, files: rows }, null, 1));
console.log(JSON.stringify(summary, null, 1));
