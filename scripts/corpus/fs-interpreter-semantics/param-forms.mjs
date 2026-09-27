// Census over all unique FS modeling files of the corpus run (out/corpus/targets.json):
// which feature-parameter declaration forms appear in defineFeature preconditions,
// which annotation keys are used, and which type tags are used with 'is'/'as'.
// Parses with the production parser (src/parser.mjs, read-only use). Files the
// parser rejects are counted, not analysed.
//
// Usage: node scripts/corpus/fs-interpreter-semantics/param-forms.mjs
// Writes tmp/corpus/fs-interpreter-semantics/param-forms.json and prints a summary.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from '../../../src/parser.mjs';
import { OUT_DIR, TMP_DIR, CORPUS_ROOT } from '../lib.mjs';

const targets = JSON.parse(readFileSync(join(OUT_DIR, 'targets.json'), 'utf8'));
const files = targets.files.filter(f => f.frontend === 'fs');
const count = new Map(), fileSets = new Map();
const bump = (key, path) => { count.set(key, (count.get(key) ?? 0) + 1); if (!fileSets.has(key)) fileSets.set(key, new Set()); fileSets.get(key).add(path); };
let parsed = 0, failed = 0;
const perFile = [];

function walk(node, visit) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) { node.forEach(n => walk(n, visit)); return; }
  visit(node);
  for (const [k, v] of Object.entries(node)) if (k !== 'loc' && v && typeof v === 'object') walk(v, visit);
}
const paramKey = (e, param) => e?.kind === 'access' && e.value?.kind === 'name' && e.value.name === param && e.key?.kind === 'literal' ? e.key.value : null;

for (const f of files) {
  let ast;
  try { ast = parse(readFileSync(join(CORPUS_ROOT, f.path), 'utf8')); parsed++; }
  catch { failed++; continue; }
  const enums = new Set(ast.declarations.filter(d => d.kind === 'enum').map(d => d.name));
  const forms = [];
  // type tags anywhere in the file
  walk(ast.declarations, n => { if (n.kind === 'type') bump(`tag ${n.operator} ${enums.has(n.type) ? '<user enum>' : n.type}`, f.path); });
  for (const d of ast.declarations) {
    const fn = d.value?.kind === 'call' && d.value.callee?.kind === 'name' && d.value.callee.name === 'defineFeature' ? d.value.args[0] : null;
    if (!fn) continue;
    if (d.value.args.length > 1) bump('defineFeature with defaults map', f.path);
    const param = fn.params?.[2]?.name ?? 'definition';
    const visitStatement = (s, depth) => {
      if (!s) return;
      if (s.kind === 'block') { s.statements.forEach(x => visitStatement(x, depth)); return; }
      if (s.kind === 'if') { bump('precondition if-block', f.path); visitStatement(s.yes, depth + 1); visitStatement(s.no, depth + 1); return; }
      if (s.kind !== 'expression') { bump(`precondition statement ${s.kind}`, f.path); return; }
      const e = s.value; let form = null, key = null, hasDefault = false;
      for (const a of s.annotations ?? []) for (const [k, v] of a.fields ?? []) {
        const name = k.kind === 'literal' ? k.value : '?';
        bump(`annotation key ${name}`, f.path);
        if (name === 'Default') hasDefault = true;
        if (name === 'Filter' || name === 'Default') {
          let ops = new Set(); walk(v, n => { if (n.kind === 'binary' || n.kind === 'unary') ops.add(n.operator); });
          bump(`annotation ${name} ${v.kind}${ops.size ? ' ops ' + [...ops].sort().join('') : ''}`, f.path);
        }
      }
      if (e.kind === 'call' && e.callee?.kind === 'name' && (key = paramKey(e.args[0], param))) {
        const b = e.args[1];
        form = `${e.callee.name}(definition.x, ${!b ? '-' : b.kind === 'name' ? b.name : b.kind === 'type' ? `<literal as ${b.type}>` : `<${b.kind}>`})`;
      } else if (e.kind === 'type' && e.operator === 'is' && (key = paramKey(e.value, param))) {
        form = `definition.x is ${enums.has(e.type) ? '<user enum>' : e.type}`;
      } else form = `other ${e.kind}${e.kind === 'call' ? ' ' + (e.callee?.name ?? '') : ''}`;
      if (depth) form += ' [inside if]';
      if (key && !hasDefault) form += ' (no Default)';
      forms.push(form); bump(`param ${form}`, f.path);
    };
    if (fn.precondition) visitStatement(fn.precondition, 0);
  }
  perFile.push({ path: f.path, family: f.family, forms });
}
const rows = [...count].map(([k, n]) => ({ key: k, occurrences: n, files: fileSets.get(k).size })).sort((a, b) => a.key.localeCompare(b.key));
mkdirSync(join(TMP_DIR, 'fs-interpreter-semantics'), { recursive: true });
writeFileSync(join(TMP_DIR, 'fs-interpreter-semantics', 'param-forms.json'), JSON.stringify({ parsed, failed, rows, perFile }, null, 1));
console.log(`unique FS files ${files.length}, parsed ${parsed}, parser rejects ${failed}`);
for (const r of rows) console.log(String(r.occurrences).padStart(5), String(r.files).padStart(4), r.key);
