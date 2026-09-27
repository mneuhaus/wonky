// Mini status sheet: wonky since the first commit (code size, effort estimate, R20 status, readiness).
// Line counts and test cases are measured from the tracked tree at HEAD; the person-year figure and the
// readiness score are estimates and are marked as such. Usage: node scripts/reports/stats.mjs
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO, page, section, tiles, barChart, table, callout, ul, writeReport } from './lib.mjs';

const git = (...args) => execFileSync('git', ['-C', REPO, ...args], { encoding: 'utf8' }).trim();
const AREAS = [
  ['Kernel (Bend)', /^(kernel\/.*|LAWS|PROOF)\.bend$|^kernel\/.*\.bend$/],
  ['Frontend / CLI (JS)', /^(src|bin)\/.*\.m?js$/],
  ['Viewer', /^viewer\/.*\.(m?js|css|html)$/],
  ['Scripts (oracles, bake-offs, native bridge)', /^scripts\/.*\.(m?js|py)$/],
  ['Tests', /^test\/.*\.m?js$/],
];
const files = git('ls-files').split('\n');
const lines = f => readFileSync(join(REPO, f), 'utf8').split('\n').length - 1;
const sizes = AREAS.map(([label, re]) => { const fs = files.filter(f => re.test(f)); return { label, files: fs.length, lines: fs.reduce((s, f) => s + lines(f), 0) }; });
const code = sizes.reduce((s, a) => s + a.lines, 0);
const docs = files.filter(f => /^docs\/.*\.md$/.test(f)).reduce((s, f) => s + lines(f), 0);
const tests = files.filter(f => /^test\/.*\.test\.m?js$/.test(f)).reduce((s, f) => s + (readFileSync(join(REPO, f), 'utf8').match(/^\s*(test|it)\(/gm) ?? []).length, 0);
const head = git('rev-parse', '--short', 'HEAD');
const commits = git('rev-list', '--count', 'HEAD');
const first = git('log', '--reverse', '--format=%ad', '--date=format:%Y-%m-%d %H:%M').split('\n')[0];
const k = n => `${Math.round(n / 100) / 10}k`;

const html = page({
  title: 'wonky: status since day one',
  kicker: 'wonky · status sheet',
  date: `25.09.2026, main @ ${head}`,
  meta: [['First commit', first], ['Wall clock', '≈ 76 h'], ['Commits', commits]],
  lede: 'An exact B-rep CAD kernel written entirely in Bend, with an Onshape FeatureScript and build123d frontend. Built with agent teams since Tuesday afternoon. Counts are measured from the tracked tree; effort and readiness are estimates.',
  sections: [
    section('Key numbers',
      tiles([
        { label: 'Code, tracked', value: k(code), unit: 'lines', kind: 'gemessen', note: `kernel, frontend, viewer, scripts, tests at ${head}` },
        { label: 'Test cases', value: String(tests), unit: `in ${files.filter(f => /^test\/.*\.test\.m?js$/.test(f)).length} files`, kind: 'gemessen' },
        { label: 'Human-equivalent effort', value: '10–15', unit: 'person-years', kind: 'geschätzt', note: '≈ 100 debugged lines per day for exact-geometry code, plus research and verification' },
        { label: 'Readiness for R20 / daily FDM', value: '60–63', unit: '/ 100', kind: 'geschätzt', note: '≈ 70 if the in-flight packages pass verification' },
      ])),
    section('Where the code is',
      barChart({ title: 'Lines of code by area', sub: `tracked files at ${head}; docs and research add ${k(docs)} lines of Markdown`, unit: 'lines', data: sizes.map(s => ({ label: s.label, value: s.lines, highlight: s.label.startsWith('Kernel') })) }),
      table({ columns: ['Area', { label: 'Lines', align: 'right' }, { label: 'Files', align: 'right' }], rows: sizes.map(s => [s.label, s.lines.toLocaleString('en'), String(s.files)]) })),
    section('What works today',
      ul([
        'Unmodified Onshape FeatureScript and build123d run on an exact B-rep kernel, entirely in Bend. Targets: JS, native ARM64 with 1–18 threads, Metal.',
        'Hybrid Booleans: exact where proven, certified mesh otherwise, a named refusal instead of a guess.',
        'Fillets and chamfers, including real R20 cases; STEP, STL and 3MF export.',
        'R20 step feeder: all 7 modules build; all 24 comparable parts match Onshape volumes (exact within 8e-9 mm³, certified mesh within 2.7e-7 relative). 13 parts are still certified mesh, not exact B-rep.',
        'One viewer for the whole project, with assemblies. Digital-twin MVP: virtual control boards drive the unmodified LEGO-sorter backend (verified, not yet committed).',
      ])),
    section('What is left',
      callout('offen', 'R20 tier: about 25–28 agent-days, ETA roughly 5–9 October', 'Exact quartic intersections through STEP, vertex recovery for the 8 degenerate-vertex parts, conic sections. Not included: speed (the product CLI still runs the slow JS target; a native path is planned) and motion/clearance checking (+8–10 agent-days).'),
      callout('entscheidung', 'Nothing lands unverified', 'Every package passes independent verification rounds with another model family, and critical kernel packages get a final Fable review. Today alone these rounds caught two silent-wrong classes and one hidden acceptance failure before any commit.')),
  ],
  footer: 'Measured: line counts and test cases (git ls-files at HEAD). Estimated: person-years (order of magnitude) and readiness (judgement against local design note).',
});
writeReport('stats.html', html);
