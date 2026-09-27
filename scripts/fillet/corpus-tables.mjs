// Render the ranked tables of out/fillet/corpus.json as Markdown (for docs/fillet/corpus.md).
// Usage: node scripts/fillet/corpus-tables.mjs > tmp/fillet/tables.md
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const REPO = new URL('../..', import.meta.url).pathname;
const r = JSON.parse(readFileSync(join(REPO, 'out/fillet/corpus.json'), 'utf8'));
const P = JSON.parse(readFileSync(join(REPO, 'tmp/fillet/primary-calls.json'), 'utf8'));
const g = r.geometry;
const out = [];
const row = cells => out.push(`| ${cells.join(' | ')} |`);

out.push('### Edge configurations (one row per blend kind, edge relation, convexity, dihedral bucket)\n');
row(['#', 'kind', 'edge (curve: adjacent surfaces)', 'convexity', 'dihedral', 'families', 'files', 'calls', 'edges', 'class']);
row(['---:', '---', '---', '---', '---', '---:', '---:', '---:', '---:', '---']);
g.rankEdges.forEach((x, i) => { const [kind, rel, conv, ...b] = x.key.split(' '); row([i + 1, kind, '`' + rel + '`', conv, b.join(' '), x.families, x.files, x.calls, x.edges, x.level]); });

out.push('\n### End-vertex configurations\n');
row(['#', 'kind', 'vertex class', 'families', 'files', 'calls', 'class']);
row(['---:', '---', '---', '---:', '---:', '---:', '---']);
g.rankVertices.forEach((x, i) => { const [kind, ...c] = x.key.split(' '); row([i + 1, kind, '`' + c.join(' ') + '`', x.families, x.files, x.calls, x.level]); });

out.push('\n### Whole-call configurations (top 25)\n');
row(['#', 'configuration (edges || end vertices)', 'families', 'files', 'calls', 'class']);
row(['---:', '---', '---:', '---:', '---:', '---']);
const lvOf = new Map(P.map(c => [c.cls, c.level]));
g.rankCalls.slice(0, 25).forEach((x, i) => row([i + 1, '`' + x.key + '`', x.families, x.files, x.calls, lvOf.get(x.key) ?? '?']));

out.push('\n### Per family\n');
row(['family', 'representative file', 'files', 'calls', 'source', 'strict/ext/general calls', 'dominant edges', 'dominant end vertices']);
row(['---', '---', '---:', '---:', '---', '---', '---', '---']);
const fam = {};
for (const c of P) {
  const f = fam[c.family] ??= { files: new Set(), calls: 0, src: new Set(), lv: { strict: 0, extended: 0, general: 0 }, rel: {}, vc: {} };
  f.files.add(c.path); f.calls++; f.src.add(c.source); f.lv[c.level]++;
  for (const e of c.cfg.edges) { const k = `${e.relation} ${e.convexity}`; f.rel[k] = (f.rel[k] ?? 0) + 1; }
  for (const v of c.cfg.vertices) f.vc[v.class] = (f.vc[v.class] ?? 0) + 1;
}
const top = o => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${k} ×${v}`).join('; ');
for (const [k, f] of Object.entries(fam).sort((a, b) => b[1].files.size - a[1].files.size || b[1].calls - a[1].calls)) {
  row([k, '`' + [...f.files].sort()[0] + '`', f.files.size, f.calls, [...f.src].join(', '), `${f.lv.strict}/${f.lv.extended}/${f.lv.general}`, top(f.rel), top(f.vc)]);
}
console.log(out.join('\n'));
