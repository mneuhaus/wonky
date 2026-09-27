// Corpus-wide static tally of free names that neither the file declares nor
// the production builtins provide (all 332 unique FS files). Namespaced
// (NS::x) names are module imports and are excluded. Header-less fragments
// are parsed with a synthetic header so their names still count; they are
// reported separately. Writes corpus-missing.json next to this script.
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { parse } from '../../../src/parser.mjs';
import { ModelingContext } from '../../../src/library.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const DATA = join(here, '..', '..', '..', 'tmp', 'corpus', 'fs-missing-builtin');
const repo = join(here, '..', '..', '..');
const corpus = join(homedir(), 'Workspace', 'cad');
const targets = JSON.parse(readFileSync(join(repo, 'out/corpus/targets.json'), 'utf8'));
const builtins = new Set(Object.keys(new ModelingContext({}).builtins()));
const HEADER = 'FeatureScript 2909;\nimport(path : "onshape/std/geometry.fs", version : "2909.0");\n';

function scan(program) {
  const declared = new Set(), used = new Map();
  const walk = node => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(walk); return; }
    switch (node.kind) {
      case 'name': if (!used.has(node.name)) used.set(node.name, node.loc?.line ?? null); return;
      case 'declaration': declared.add(node.name); break;
      case 'enum': declared.add(node.name); return;
      case 'for': declared.add(node.name); break;
      case 'try': if (node.name) declared.add(node.name); break;
      case 'function': for (const p of node.params ?? []) declared.add(p.name); break;
      case 'access': walk(node.value); if (node.key?.kind !== 'literal') walk(node.key); return;
      case 'map': for (const [k, v] of node.fields) { if (k.kind !== 'literal') walk(k); walk(v); } return;
    }
    for (const [key, value] of Object.entries(node)) if (key !== 'loc' && key !== 'annotations') walk(value);
    for (const a of node.annotations ?? []) walk(a);
  };
  walk(program.declarations);
  return [...used].filter(([n]) => !declared.has(n) && !builtins.has(n) && !n.includes('::')).map(([n]) => n);
}

const rows = [];
for (const f of targets.files.filter(f => f.frontend === 'fs')) {
  const source = readFileSync(join(corpus, f.path), 'utf8');
  let missing = null, error = null, fragment = false;
  try { missing = scan(parse(source)); }
  catch (e) {
    try { missing = scan(parse(HEADER + source)); fragment = true; }
    catch (e2) { error = e.message; }
  }
  rows.push({ path: f.path, family: f.family, representative: f.representative, missing, fragment, error });
}
writeFileSync(join(DATA, 'corpus-missing.json'), JSON.stringify(rows, null, 1));
const tally = Object.create(null);
for (const r of rows) for (const n of r.missing ?? []) {
  const t = (tally[n] ??= { files: new Set(), families: new Set(), fragmentFiles: new Set() });
  t.files.add(r.path); t.families.add(r.family); if (r.fragment) t.fragmentFiles.add(r.path);
}
console.log('parsed', rows.filter(r => r.missing).length, 'of', rows.length, '| fragments', rows.filter(r => r.fragment).length, '| parse errors', rows.filter(r => r.error).length);
console.log('files using no missing name:', rows.filter(r => r.missing && !r.missing.length).length);
for (const [n, t] of Object.entries(tally).sort((a, b) => b[1].files.size - a[1].files.size))
  console.log(String(t.files.size).padStart(4), String(t.families.size).padStart(4), String(t.fragmentFiles.size).padStart(4), n);
