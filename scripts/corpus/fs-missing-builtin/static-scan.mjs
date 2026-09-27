// Static scan: every free name a cluster file references that is neither
// declared in the file nor provided by the production builtins. Read-only use
// of the production parser and ModelingContext (dummy kernel: builtins() only
// builds the name table). Reads the corpus, writes only next to this script.
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { parse } from '../../../src/parser.mjs';
import { ModelingContext } from '../../../src/library.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const DATA = join(here, '..', '..', '..', 'tmp', 'corpus', 'fs-missing-builtin');
const corpus = join(homedir(), 'Workspace', 'cad');
const files = JSON.parse(readFileSync(join(DATA, 'cluster-files.json'), 'utf8'));
const builtins = new Set(Object.keys(new ModelingContext({}).builtins()));

function scan(program) {
  const declared = new Set(), used = new Map();
  const use = (name, loc) => { if (!used.has(name)) used.set(name, loc?.line ?? null); };
  const walk = node => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(walk); return; }
    switch (node.kind) {
      case 'name': use(node.name, node.loc); return;
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
  const missing = [...used].filter(([n]) => !declared.has(n) && !builtins.has(n) && !n.includes('::'));
  return missing.map(([name, line]) => ({ name, line }));
}

const rows = [];
for (const f of files) {
  const source = readFileSync(join(corpus, f.path), 'utf8');
  let missing, error = null;
  try { missing = scan(parse(source)); } catch (e) { error = e.message; missing = []; }
  rows.push({ path: f.path, family: f.family, missing, error });
}
writeFileSync(join(DATA, 'static-missing.json'), JSON.stringify(rows, null, 1));
const tally = {};
for (const r of rows) for (const m of r.missing) (tally[m.name] ??= new Set()).add(r.path);
for (const [n, s] of Object.entries(tally).sort((a, b) => b[1].size - a[1].size)) console.log(String(s.size).padStart(3), n);
for (const r of rows) console.log(r.path, '->', r.missing.map(m => m.name).join(', '), r.error ?? '');
