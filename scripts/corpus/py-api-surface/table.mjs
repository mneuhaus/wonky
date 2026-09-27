// Markdown per-file table for docs/corpus/cluster-py-api-surface.md, from
// out/corpus/py-api-surface/surface.json (run surface.mjs first).
//   node scripts/corpus/py-api-surface/table.mjs
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { OUT_DIR } from '../lib.mjs';

const s = JSON.parse(readFileSync(join(OUT_DIR, 'py-api-surface', 'surface.json'), 'utf8'));
const short = m => (m ?? '')
  .replace(/^build123d\.(\S+) is not implemented by the Python frontend$/, '`$1`')
  .replace(/^Shape\.(\S+) is not implemented by the Python frontend$/, '`Shape.$1`')
  .replace(/^NameError: name '(\S+)' is not defined$/, 'NameError `$1`')
  .replace(/^ModuleNotFoundError: No module named '([^']+)'.*$/, 'import `$1`')
  .replace(/^External geometry import '(\S+)' is disabled.*$/, 'import `$1` (refused)')
  .replace(/^ValueError: Python source must bind its final Shape to 'result'$/, 'no `result`')
  .replace(/^opBoolean (.{0,60}).*$/, 'opBoolean: $1…');
const next = n => n ? `${n.line ? `${n.line}: ` : ''}${short(n.message)}` : '-';
const pick = (r, t, k) => r.tiers[t].filter(c => !c.startsWith('.') || k).slice(0, 6).join(' ');
console.log('| file | first blocker | next, API gap closed | next, + local path + cad_khana | still missing (C / X tier) | third-party |');
console.log('|---|---|---|---|---|---|');
for (const r of s.rows) {
  const first = `${r.firstBlocker.line}: ${short(r.firstBlocker.message)} (${r.firstBlockerAt})`;
  const c = [pick(r, 'C', false), pick(r, 'X', false)].filter(Boolean).join(' · ') || '(none)';
  console.log(`| \`${r.key}\` | ${first} | ${next(r.next.lazy)} | ${next(r.next.lazyLocalPathKhana)} | ${c} | ${r.thirdParty.join(', ') || '-'} |`);
}
