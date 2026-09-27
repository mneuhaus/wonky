// Step 0 of the WK real-model spike (docs/language.md section 12): build every
// candidate once on today's production JS path, with kernel-entry counting
// (scripts/native-bridge/count-kernel-calls.mjs), and pick the first candidate
// that builds without the CURVED Boolean method.
//
// Candidate order: the four named spike candidates, then the control, then
// every other real corpus feature whose staged WK graph (judge scan,
// tmp/lang/judge/scan-planar.json) uses only the spike's op set (extrude_polygon,
// frustum, transform, pattern, boolean), ranked by op-count bound. Duplicate
// revisions of the same feature with the same op profile are built once.
//
//   node scripts/lang/wk-real-select.mjs [--timeout-s 300] [--only tag,...]
// Writes out/lang/wk/real/selection.json and one select-<tag>.json (+ .calls.json) per candidate.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync, execSync } from 'node:child_process';
import { homedir } from 'node:os';

const root = new URL('../../', import.meta.url).pathname;
const cad = join(homedir(), 'Workspace/cad');
const load = () => execSync('uptime').toString().trim().replace(/.*load averages?: /, '');
const args = process.argv.slice(2);
const opt = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const timeoutS = Number(opt('--timeout-s', 300));
const only = opt('--only', null)?.split(',');

const named = [
  { tag: 'dual-hardware', role: 'primary', path: 'cad-project-039/belt-return-r25/dual-hardware-r25.fs', feature: 'dualHardware25', bound: 21 },
  { tag: 'interface-r11', role: 'substitute 1', path: 'cad-project-014/machine-interface-r11/interface-r11.fs', feature: 'fasteners', bound: 15.5 },
  { tag: 'hopper-r16', role: 'substitute 2', path: 'cad-project-039/archive-r16/hopper.fs', feature: 'hybridHopper', bound: 10.67 },
  { tag: 'expanded-hopper-r21', role: 'substitute 3', path: 'cad-project-039/r21-expanded-hopper.fs', feature: 'expandedRearHopper21', bound: 8.5 },
  { tag: 'central-drive-r27', role: 'control', path: 'cad-project-039/belt-central-r27/central-drive-r27.fs', feature: 'centralShafts26', bound: 2 },
];
const core = new Set(['frustum', 'boolean', 'extrude_polygon', 'transform', 'pattern']);
const scan = JSON.parse(readFileSync(join(root, 'tmp/lang/judge/scan-planar.json'), 'utf8'));
const extended = [], seen = new Set(named.map(c => `${c.feature}|${c.path}`));
const profiles = new Set();
for (const r of scan.rows.filter(r => r.heavy >= 2 && Object.keys(r.ops).every(k => core.has(k))).sort((a, b) => b.bound - a.bound || b.heavy - a.heavy)) {
  const profile = `${r.feature}|${JSON.stringify(r.ops)}`;
  if (seen.has(`${r.feature}|${r.path}`) || profiles.has(profile)) continue;
  profiles.add(profile);
  const tag = `${r.path.split('/').at(-1).replace(/\.fs$/, '')}-${r.feature}`;
  extended.push({ tag, role: 'extended', path: r.path, feature: r.feature, bound: r.bound, heavy: r.heavy, span: r.span, ops: r.ops });
}
const candidates = [...named, ...extended].filter(c => !only || only.includes(c.tag));
const out = join(root, 'out/lang/wk/real');
mkdirSync(out, { recursive: true }); mkdirSync(join(root, 'tmp/lang/wk/real'), { recursive: true });
const report = { schema: 'wonky-lang-wk-real-selection/1', rule: 'first candidate in this order that builds on the JS path without the CURVED method',
  timeoutS, load: { start: load() }, candidates: [] };
for (const c of candidates) {
  const before = load();
  const jsonOut = join(out, `select-${c.tag}.json`), calls = join(out, `select-${c.tag}.calls.json`);
  const child = spawnSync(process.execPath, ['--import', './scripts/native-bridge/count-kernel-calls.mjs', 'scripts/lang/wk-js-build.mjs', join(cad, c.path), c.feature, jsonOut,
    '--bodies', join(root, `tmp/lang/wk/real/js-${c.tag}.bodies.json`)], { cwd: root, encoding: 'utf8', timeout: timeoutS * 1000,
    env: { ...process.env, BEND_NO_TELEMETRY: '1', WONKY_NB_COUNT_OUT: calls } });
  const row = { ...c, loadBefore: before, loadAfter: load() };
  if (child.error || child.status !== 0 || !existsSync(jsonOut)) row.status = child.error?.code === 'ETIMEDOUT' ? 'timeout' : 'crash', row.stderr = (child.stderr ?? '').slice(-600);
  else {
    const r = JSON.parse(readFileSync(jsonOut, 'utf8'));
    Object.assign(row, { status: r.status, error: r.error ?? null, buildMs: r.buildMs, bodies: r.bodies.length, methods: r.methods, operations: r.operations.length });
    try {
      const k = JSON.parse(readFileSync(calls, 'utf8'));
      row.kernelEntries = Object.fromEntries(k.entries.map(e => [e.name, e.calls]));
      row.kernelMs = k.totals.ms;
    } catch { row.kernelEntries = null; }
  }
  row.eligible = row.status === 'ok' && !Object.keys(row.methods ?? {}).includes('CURVED');
  report.candidates.push(row);
  console.log(JSON.stringify({ tag: c.tag, role: c.role, bound: c.bound, status: row.status, eligible: row.eligible, error: row.error?.message?.slice(0, 90) ?? null,
    line: row.error?.line ?? null, methods: row.methods, buildMs: Math.round(row.buildMs ?? 0), load: [row.loadBefore, row.loadAfter] }));
}
report.load.end = load();
const pick = report.candidates.find(c => c.eligible && c.role !== 'control');
report.selected = pick ? { tag: pick.tag, path: pick.path, feature: pick.feature, role: pick.role, bound: pick.bound } : null;
report.planarControl = report.candidates.find(c => c.eligible && Object.keys(c.methods ?? {}).includes('PLANAR'))?.tag ?? null;
if (!only) writeFileSync(join(out, 'selection.json'), JSON.stringify(report, null, 1));
console.log('selected', JSON.stringify(report.selected), 'planar control', report.planarControl);
