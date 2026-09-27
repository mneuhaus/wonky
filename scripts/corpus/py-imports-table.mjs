// Markdown per-file table for docs/corpus/cluster-py-imports.md, rendered from
// out/corpus/py-imports-files.json (scripts/corpus/py-imports-files.mjs).
//
// Usage: node scripts/corpus/py-imports-table.mjs > tmp/corpus/py-imports/table.md
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { OUT_DIR } from './lib.mjs';

const data = JSON.parse(readFileSync(join(OUT_DIR, 'py-imports-files.json'), 'utf8'));

const shortPath = path => path
  .replace('cad-project-014/bottom-drive-review-2026-09-19/tool-improvement/', 'dpl/…/')
  .replace('cad-project-041/single-step-r10/', 'cad-project-041/r10/')
  .replace(/^cad-project-003\/overnight-2026-09-05\//, 'cad-project-003/…/');

// One short label per blocker, so the table stays readable. The JSON keeps the full messages.
function label(next) {
  if (!next) return '–';
  const m = next.message;
  let hit;
  if ((hit = m.match(/No module named '([^'.]+)/))) return `import \`${hit[1]}\``;
  if ((hit = m.match(/External geometry import '([^']+)'/))) {
    const via = /ocp_vscode/.test(next.sourceLine ?? '') ? ' via `ocp_vscode`' : /cad_khana/.test(next.sourceLine ?? '') ? ' via `cad_khana`'
      : /bd_warehouse/.test(next.sourceLine ?? '') ? ' via `bd_warehouse`' : '';
    return `\`${hit[1]}\` refused${via}`;
  }
  if ((hit = m.match(/^NameError: name '([^']+)'/))) return `\`${hit[1]}\` (NameError)`;
  if ((hit = m.match(/^(?:build123d\.)?([\w.]+) is not implemented/))) {
    // The failing line is an import of a sibling module or cad_khana: name it.
    const mod = (next.sourceLine ?? '').match(/^(?:import (\w+)|from (\w+)[\w.]* import)/);
    const name = mod && (mod[1] ?? mod[2]);
    const via = name && name !== 'build123d' ? ` via \`${name}\`` : '';
    return `\`${hit[1]}\`${via}`;
  }
  if (/must bind its final Shape to 'result'/.test(m)) return 'no `result`';
  if (/attempted relative import/.test(m)) return 'relative import (package module)';
  if (/FileNotFoundError/.test(m)) return 'data file missing';
  if ((hit = m.match(/^(\w+Error): (.{0,50})/))) return `${hit[1]}: ${hit[2]}`;
  return m.slice(0, 50);
}

const roleText = row => !row.cpythonAlsoFails ? row.role : row.role === 'model' ? 'model (broken copy)' : `${row.role} (broken)`;
const order = { model: 0, tool: 1, helper: 2, test: 3 };
const rows = [...data.rows].sort((a, b) => order[a.role] - order[b.role] || a.path.localeCompare(b.path));

console.log('| file | role | first blocker | next (dir+env) | after both frontend fixes | Bend requests | missing names |');
console.log('|---|---|---|---|---|---:|---:|');
for (const r of rows) {
  const lazy = r.nextDirEnvLazy;
  const lazyText = lazy ? `${label(lazy)}${lazy.source === 'in-place' ? ' ¹' : ''}` : '–';
  console.log(`| \`${shortPath(r.path)}\` | ${roleText(r)} | \`${r.first.module}\` :${r.first.line} | ${label(r.nextDirEnv)} | ${lazyText} | ${lazy?.completedRequests ?? 0} | ${r.b3dMissing.length} |`);
}
