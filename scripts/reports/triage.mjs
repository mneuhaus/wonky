
if (!(await import('node:fs')).existsSync(new URL('../../var/site/development-record.md', import.meta.url))) {
  console.log('local-only historical report input absent; report omitted');
  process.exit(0);
}
// Builds out/reports/triage.html: "Deine echten Teile: Korpus-Triage".
//   node scripts/reports/triage.mjs
//
// Every number comes from the corpus run, the backlog, the verification run or
// the German triage document; prose that is quoted is parsed from the docs.
// Custom marks (file grid, paired bars, track chart, plan grid) live here and
// reuse the kit's CSS tokens; a small extra stylesheet is injected after page().
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  REPO, page, section, p, esc, inline, tiles, grid, card, callout, table, details, badge, source,
  barChart, stackedBar, fmt, readJson, readJsonl, writeReport, assertPublicSafe,
} from './lib.mjs';

// ── sources ──────────────────────────────────────────────────────────────────
const DOC = 'docs/corpus-triage.md';
const RUN_DOC = 'docs/corpus/run.md';
const BOOL_DOC = 'docs/corpus/cluster-boolean-capability.md';
const MORNING = 'var/site/development-record.md';
const W4_DOC = 'docs/onshape-inputs.md';
const W5_DOC = 'docs/python-frontend.md';
const W1_REP = 'docs/corpus/w1.md';
const W4_REP = 'docs/corpus/w4.md';
const W5_REP = 'docs/corpus/w5.md';
const W2_PLAN = 'docs/corpus/w2-plan.md';
const W5B_PLAN = 'docs/corpus/w5b-plan.md';
const SUMMARY = 'out/corpus/summary.json';
const BACKLOG = 'out/corpus/backlog.json';
const VERIFY = 'out/corpus/verify/results.jsonl';
const VERIFY_META = 'out/corpus/verify/meta.jsonl';
const VALIDATE = 'out/corpus/verify/validate-successes.json';
const WASHER = 'out/corpus/verify/washer-reference.json';
const ONSHAPE_INDEX = 'out/corpus/verify/onshape-built-index.json';
const BASE_RUNS = 'out/corpus/runs.jsonl';
const BENCH = 'out/corpus/bench';

const readText = (rel) => readFileSync(join(REPO, rel), 'utf8');
const doc = readText(DOC);
const runDoc = readText(RUN_DOC);
const boolDoc = readText(BOOL_DOC);
const morning = readText(MORNING);
const summary = readJson(SUMMARY);
const backlog = readJson(BACKLOG);
const verify = readJsonl(VERIFY);
const verifyMeta = readJsonl(VERIFY_META);
const validated = readJson(VALIDATE);
const washerRef = readJson(WASHER);
const onshapeIndex = readJson(ONSHAPE_INDEX);

const GENERATED = new Date();
const T = summary.totals;
const U = T.unitStatus;
const POP = backlog.population;

// ── small helpers ────────────────────────────────────────────────────────────
const n = (v, d = 0) => fmt.num(v, d);
const NB = ' ';
/** Share as "71 %" with a no-break space, so the unit never wraps away from its number. */
const pct = (a, b, d = 0) => fmt.pct(a / b, d).replace(' %', `${NB}%`);
const must = (cond, what) => { if (!cond) throw new Error(`triage: source check failed: ${what}`); };
const match = (text, re, what) => { const m = text.match(re); must(m, what); return m; };
const deDate = (iso) => iso.replace(/^(\d{4})-(\d\d)-(\d\d)$/, '$3.$2.$1');
const sci = (v) => (v === 0 ? '0' : v.toExponential(1).replace('.', ',').replace('e-', 'e−'));

/** Markdown inline → HTML: links become their text, then `code` and **bold**. */
const mdInline = (s) => inline(String(s).replace(/\[([^\]]+)\]\([^)]+\)/g, '$1'));

/** Minimal Markdown block → HTML: paragraphs and nested -/1. lists. */
function mdBlock(md) {
  let html = '';
  let para = [];
  const stack = [];
  const flushPara = () => { if (para.length) { html += `<p>${mdInline(para.join(' '))}</p>`; para = []; } };
  const closeTo = (indent) => { while (stack.length && stack.at(-1).indent > indent) html += `</li></${stack.pop().type}>`; };
  for (const raw of md.split('\n')) {
    if (/^\s*\|/.test(raw) || /^\s*>/.test(raw) || /^```/.test(raw)) continue; // tables, quotes, fences: not used here
    const m = raw.match(/^(\s*)([-*]|\d+\.) (.*)$/);
    if (m) {
      flushPara();
      const indent = m[1].length;
      const type = /\d/.test(m[2]) ? 'ol' : 'ul';
      closeTo(indent);
      if (stack.length && stack.at(-1).indent === indent) html += '</li><li>';
      else { html += `<${type}><li>`; stack.push({ type, indent }); }
      html += mdInline(m[3]);
      continue;
    }
    if (!raw.trim()) { flushPara(); continue; }
    if (stack.length && /^\s+\S/.test(raw)) { html += ` ${mdInline(raw.trim())}`; continue; }
    closeTo(-1);
    para.push(raw.trim());
  }
  flushPara();
  closeTo(-1);
  return html;
}

/** Text of a Markdown heading's section (up to the next heading of the same or a higher level). */
function mdSection(md, headingRe) {
  const lines = md.split('\n');
  const start = lines.findIndex((l) => /^#{1,6} /.test(l) && headingRe.test(l));
  must(start >= 0, `heading ${headingRe}`);
  const level = lines[start].match(/^#+/)[0].length;
  const end = lines.findIndex((l, i) => i > start && /^#{1,6} /.test(l) && l.match(/^#+/)[0].length <= level);
  return lines.slice(start + 1, end < 0 ? undefined : end).join('\n');
}

/** Bold-labelled block inside a section: from "**Label**" to the next "**…**" paragraph start. */
function mdBoldBlock(text, label) {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => l.startsWith(`**${label}`));
  must(start >= 0, `bold block ${label}`);
  const end = lines.findIndex((l, i) => i > start && /^\*\*[^*]+\*\*/.test(l));
  return lines.slice(start, end < 0 ? undefined : end).join('\n');
}

/** Rows of the first Markdown table after `anchorRe` (cells trimmed, header and rule dropped). */
function mdTable(text, anchorRe) {
  const lines = text.split('\n');
  const at = lines.findIndex((l) => anchorRe.test(l));
  must(at >= 0, `table anchor ${anchorRe}`);
  const first = lines.findIndex((l, i) => i >= at && l.startsWith('|'));
  const rows = [];
  for (let i = first; i < lines.length && lines[i].startsWith('|'); i++) rows.push(lines[i].slice(1, -1).split('|').map((c) => c.trim()));
  return rows.slice(2);
}

function git(args) {
  try { return execFileSync('git', args, { cwd: REPO, encoding: 'utf8' }); } catch { return ''; }
}

/** Working-tree state of each path: geändert / neu / gelöscht / unverändert. */
function treeState(paths) {
  const out = git(['status', '--porcelain', '--untracked-files=normal', '--', ...paths]);
  const lines = out.split('\n').filter(Boolean).map((l) => ({ code: l.slice(0, 2), path: l.slice(3) }));
  return paths.map((path) => {
    const hit = lines.find((l) => l.path === path || l.path === `${path}/` || l.path.startsWith(path.endsWith('/') ? path : `${path}/`));
    const code = hit?.code ?? '';
    const state = code === '??' ? 'neu' : code.includes('D') ? 'gelöscht' : code.trim() ? 'geändert' : 'unverändert';
    return { path, state };
  });
}

/**
 * Table whose cells are already HTML (for badges inside cells).
 * stack: on phones every row becomes a block, each cell labelled with its column
 * (the first column is the row heading). Column `sm: false` hides it on phones.
 */
function htmlTable({ columns, rows, caption, src, stack = false, stackLabels = true }) {
  const cls = (c, i) => [c.align === 'right' ? 'num' : '', c.sm === false ? 'sm-hide' : '', stack && i === 0 ? 'stk-head' : ''].filter(Boolean).join(' ');
  const attr = (c, i) => (cls(c, i) ? ` class="${cls(c, i)}"` : '');
  const th = columns.map((c, i) => `<th${attr(c, i)}>${inline(c.label)}</th>`).join('');
  const label = (c, i) => (stack && i > 0 && c.label ? ` data-label="${esc(c.label)}"` : '');
  const body = rows.map((r) => `<tr>${r.map((cell, i) => `<td${attr(columns[i], i)}${label(columns[i], i)}>${cell}</td>`).join('')}</tr>`).join('');
  return `<figure class="tbl${stack ? ' stk' : ''}${stack && !stackLabels ? ' stk-nolabel' : ''}"><div class="tbl-scroll"><table>${caption ? `<caption>${inline(caption)}</caption>` : ''}<thead><tr>${th}</tr></thead><tbody>${body}</tbody></table></div>${src ? source(...[src].flat()) : ''}</figure>`;
}

const legend = (items) =>
  `<ul class="legend">${items.map((i) => `<li><i class="sw ${i.cls}" aria-hidden="true"></i>${inline(i.label)}${i.value != null ? ` <b>${inline(i.value)}</b>` : ''}</li>`).join('')}</ul>`;

const chartFigure = ({ title, sub, legendHtml = '', svg, tableHtml, src, cls = '' }) =>
  `<figure class="chart ${cls}"><figcaption><strong>${inline(title)}</strong>${sub ? `<span>${inline(sub)}</span>` : ''}</figcaption>${legendHtml}${svg}${tableHtml ? details('Werte als Tabelle', tableHtml) : ''}${src ? source(...[src].flat()) : ''}</figure>`;

/** Horizontal bar in % units with a rounded data end and a square baseline end. */
function bar(y, h, frac, cls, fill) {
  if (!(frac > 0)) return '';
  const paint = fill ? `fill="${fill}"` : `class="${cls}"`;
  const w = `${(frac * 100).toFixed(3)}%`;
  return `<rect x="0" y="${y}" width="${w}" height="${h}" rx="3" ${paint}/>${frac > 0.012 ? `<rect x="0" y="${y}" width="4" height="${h}" ${paint}/>` : ''}`;
}

// ── source checks: the doc and the data must tell the same story ─────────────
const kurz = mdSection(doc, /^## 1\. Kurzfassung/);
const totalsRows = mdTable(kurz, /^\| \| FeatureScript/);
const cellNum = (s) => Number(String(s).replace(/\*|\./g, '').replace(',', '.').match(/[\d.]+/)?.[0]);
must(cellNum(totalsRows[0][3]) === T.filesRun, 'files run (doc vs summary)');
must(cellNum(totalsRows[1][3]) === T.fileStatus.ok, 'files ok (doc vs summary)');
must(cellNum(totalsRows[5][3]) === T.unitsRun, 'units run (doc vs summary)');
must(cellNum(totalsRows[6][3]) === U.ok, 'units ok (doc vs summary)');
must(POP.files === T.filesRun, 'backlog population = run');
const stand = match(doc, /^Stand: (\d\d\.\d\d\.\d{4})\./m, 'Stand')[1];

// Per-frontend unit status, derived from the clusters (the "other" cluster is split by kind).
const byFrontend = { fs: { frontend: 0, capability: 0, kernel: 0, ok: 0 }, py: { frontend: 0, capability: 0, kernel: 0, ok: 0 } };
for (const c of summary.clusters) {
  if (c.frontend !== 'both') { for (const [s, v] of Object.entries(c.statuses)) byFrontend[c.frontend][s] += v; continue; }
  for (const [k, v] of Object.entries(c.kinds)) byFrontend[k.startsWith('python') ? 'py' : 'fs'].frontend += v;
}
byFrontend.fs.ok = U.ok; // all 7 successes are FeatureScript units
const sumOf = (o) => Object.values(o).reduce((a, b) => a + b, 0);
must(['frontend', 'capability', 'kernel', 'ok'].every((s) => byFrontend.fs[s] + byFrontend.py[s] === U[s]), 'per-frontend split sums to totals');
const totalsDocRow = match(runDoc, /units ok \/ frontend \/ capability \/ kernel \| ([\d ,/]+) \| ([\d ,/]+) \|/, 'run.md totals row');
const docSplit = (s) => s.split('/').map((x) => Number(x.trim().replace(',', '')));
must(JSON.stringify(docSplit(totalsDocRow[1])) === JSON.stringify([byFrontend.fs.ok, byFrontend.fs.frontend, byFrontend.fs.capability, byFrontend.fs.kernel]), 'FS split = run.md');
must(JSON.stringify(docSplit(totalsDocRow[2])) === JSON.stringify([byFrontend.py.ok, byFrontend.py.frontend, byFrontend.py.capability, byFrontend.py.kernel]), 'Py split = run.md');
const fsUnits = sumOf(byFrontend.fs), pyUnits = sumOf(byFrontend.py);
const fsFiles = T.filesByFrontend['fs:ok'] + T.filesByFrontend['fs:failed'];
const pyFiles = T.filesByFrontend['py:failed'] + (T.filesByFrontend['py:ok'] || 0);

// ── hero: file grid (one cell per unique file) ───────────────────────────────
const CLASSES = [
  { key: 'today', label: 'baut heute in Produktion', cls: 'wf-today', sw: 'wf-sw-today' },
  { key: 'real', label: 'baut im Prototyp mit echter Geometrie', cls: 'wf-real', sw: 'f-s1' },
  { key: 'stub', label: 'baut nur mit Stub oder Platzhalter', cls: 'wf-stub', sw: 'sw-hatch' },
  { key: 'open', label: 'offen: Kette nie bis zum Ende beobachtet', cls: 'wf-open', sw: 'wf-sw-open' },
  { key: 'excl', label: 'kein Modell (Fragment, Test, Werkzeug)', cls: 'wf-excl', sw: 'wf-sw-excl' },
];
const classOf = (f) => (f.excluded ? 'excl' : f.okToday ? 'today' : f.conf);
const EXCL_LABEL = { fragment: 'header-loses Include-Fragment', 'not-a-model': 'kein Modell (Test, Werkzeug, Bibliothek)' };
const CONF_LABEL = { today: 'baut heute', real: 'gemessen im Prototyp', stub: 'geschätzt (Stub)', open: 'offen' };
const counts = Object.fromEntries(CLASSES.map((c) => [c.key, 0]));
for (const f of backlog.files) counts[classOf(f)]++;
must(counts.excl === POP.excluded.fragment + POP.excluded['not-a-model'], 'excluded count');
must(counts.open === POP.confidence.open.files, 'open count');
must(counts.today === T.fileStatus.ok, 'built-today count');

function fileGrid(frontend) {
  const order = CLASSES.map((c) => c.key);
  const files = backlog.files
    .filter((f) => f.frontend === frontend)
    .sort((a, b) => order.indexOf(classOf(a)) - order.indexOf(classOf(b)) || a.path.localeCompare(b.path));
  const cols = 37, cell = 10, gap = 3, step = cell + gap;
  const rows = Math.ceil(files.length / cols);
  const W = cols * step - gap, H = rows * step - gap;
  const cells = files.map((f, i) => {
    const x = (i % cols) * step, y = Math.floor(i / cols) * step;
    const k = classOf(f);
    const what = f.excluded ? EXCL_LABEL[f.excluded] : CONF_LABEL[k];
    const fixes = !f.excluded && f.fixes.length ? ` · nötige Fixes: ${f.fixes.join(', ')}` : '';
    const tip = `${f.path} · ${what} · Familie ${f.family.split(':')[1]}${fixes}`;
    const shape = k === 'excl'
      ? `<circle cx="${x + cell / 2}" cy="${y + cell / 2}" r="2" class="wf-excl"/>`
      : `<rect x="${x + (k === 'open' ? 0.5 : 0)}" y="${y + (k === 'open' ? 0.5 : 0)}" width="${k === 'open' ? cell - 1 : cell}" height="${k === 'open' ? cell - 1 : cell}" rx="1.5" class="wf-cell ${CLASSES.find((c) => c.key === k).cls}"${k === 'stub' ? ' fill="url(#wf-hatch)"' : ''}/>`;
    return `<g><title>${esc(tip)}</title><rect x="${x - 1}" y="${y - 1}" width="${step}" height="${step}" class="hit"/>${shape}</g>`;
  });
  const built = files.filter((f) => f.okToday).length;
  const units = frontend === 'fs' ? fsUnits : pyUnits;
  const unitsOk = frontend === 'fs' ? byFrontend.fs.ok : byFrontend.py.ok;
  const head = `<div class="wf-head"><b>${frontend === 'fs' ? 'FeatureScript' : 'build123d'}</b><span>${n(files.length)} Dateien · ${n(built)} ${built === 1 ? 'baut' : 'bauen'} · ${n(unitsOk)} von ${n(units)} Units</span></div>`;
  const defs = frontend === 'fs' ? `<defs><pattern id="wf-hatch" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="4" height="4" class="f-s1-wash"/><rect width="1.8" height="4" class="f-s1"/></pattern></defs>` : '';
  return `<div class="wf-block">${head}<svg class="wf-svg" viewBox="-1 -1 ${W + 2} ${H + 2}" role="img" aria-label="${esc(`${files.length} ${frontend === 'fs' ? 'FeatureScript' : 'build123d'}-Dateien, ${built} baut`)}">${defs}${cells.join('')}</svg></div>`;
}

const gridTable = table({
  columns: ['Klasse', { label: 'FeatureScript', align: 'right' }, { label: 'build123d', align: 'right' }, { label: 'gesamt', align: 'right' }],
  rows: CLASSES.map((c) => {
    const of = (fe) => backlog.files.filter((f) => f.frontend === fe && classOf(f) === c.key).length;
    return [c.label, n(of('fs')), n(of('py')), n(counts[c.key])];
  }),
});
const notOpen = backlog.files.filter((f) => !f.excluded && f.conf !== 'open');
const notOpenTable = htmlTable({
  stack: true,
  columns: [{ label: 'Datei' }, { label: 'Familie' }, { label: 'nötige Fixes' }, { label: 'Beleg' }],
  rows: notOpen
    .sort((a, b) => ['today', 'real', 'stub'].indexOf(classOf(a)) - ['today', 'real', 'stub'].indexOf(classOf(b)) || a.path.localeCompare(b.path))
    .map((f) => [
      `<code>${esc(f.path)}</code>`,
      esc(f.family.split(':')[1]),
      f.fixes.length ? esc(f.fixes.join(', ')) : 'keine',
      classOf(f) === 'today' ? `${badge('gemessen')} <span class="note">Produktion</span>` : classOf(f) === 'real' ? `${badge('gemessen')} <span class="note">Prototyp</span>` : `${badge('geschätzt')} <span class="note">Stub</span>`,
    ]),
});

const heroGrid = `<figure class="waffle">
<figcaption><strong>Jede Zelle ist eine Datei aus deinem CAD-Ordner</strong><span>Die erste Zelle oben links ist <code>top-clamp-washers-r29.fs</code>, die einzige Datei, die heute vollständig baut. Die Füllung zeigt, wie gut der Weg zum Bauen belegt ist. Zeiger auf eine Zelle zeigt die Datei.</span></figcaption>
<div class="wf-body"><div class="wf-grids">${fileGrid('fs')}${fileGrid('py')}</div>
<div class="wf-side">${legend(CLASSES.map((c) => ({ cls: c.sw, label: c.label, value: n(counts[c.key]) })))}<p class="wf-total">${n(T.filesRun)} Dateien, davon ${n(POP.modelFiles)} Modelldateien in ${n(POP.modelFamilies)} Familien</p></div></div>
${details('Werte als Tabelle', gridTable)}
${details(`Die ${n(notOpen.length)} Dateien mit belegtem Weg`, notOpenTable)}
${source(BACKLOG, SUMMARY)}
</figure>`;

// ── hero: Kurzfassung + tiles ────────────────────────────────────────────────
const k13 = backlog.steps.findIndex((s) => s.fix === 'K13');
const lastEst = backlog.steps.reduce((acc, s, i) => (s.track === 'estimated' ? i : acc), -1);
const cumDays = [];
backlog.steps.reduce((acc, s) => { cumDays.push(acc + s.days); return acc + s.days; }, 0);
const estEnd = backlog.steps[lastEst];
must(lastEst === k13, 'estimated track ends at K13 (doc: "Nach Rang 7")');

const onlyFile = summary.successes.find((s) => s.key.endsWith('top-clamp-washers-r29.fs'));
must(T.fileStatus.ok === 1 && onlyFile, 'exactly one file builds, and it is the washer file');

/** Hero: headline, two-sentence Kurzfassung, key tiles, file grid. Built last (needs §4 and §5 data). */
function heroHtml() {
  const vU = verify.filter((r) => r.kind === 'unit'), vR = verify.filter((r) => r.kind === 'repro');
  const liveNew = live ? live.reduce((a, w) => a + w.newOk.length, 0) : 0;
  const liveReg = live ? live.reduce((a, w) => a + w.regressions.length, 0) : 0;
  const headline = `<p class="hero-k">Kurzfassung</p><p class="hero-h">${n(T.fileStatus.ok)} von ${n(T.filesRun)} Dateien baut.</p>`
    + `<p class="hero-file"><code>${esc(onlyFile.key.split('/').at(-1))}</code> · ${n(onlyFile.bodies)} M5-Scheiben · Familie ${esc(onlyFile.family)}${washerDv < 1e-9 ? ' · stimmt mit dem Onshape-STEP überein' : ''}</p>`;
  // Exactly two sentences: the state, then what is being done about it.
  const kurz = `<p class="hero-sum">Von ${n(T.unitsRun)} Feature-Units aus deinem CAD-Ordner bauen ${n(U.ok)}, und <strong>${pct(U.frontend, T.unitsRun)} scheitern schon im Frontend</strong>, im Median nach ${n(T.wallMs.p50 / 1000, 2)}${NB}s, bevor der Kernel überhaupt rechnet. Deshalb liefen heute zuerst die Frontend-Workflows W1, W4 und W5, alle drei sind committet: ${n(liveNew)} weitere ${liveNew === 1 ? 'Unit baut' : 'Units bauen'} (${liveReg ? `${n(liveReg)} Regressionen` : 'keine Regression'}), ${WF.W4.past[1]} von ${WF.W4.scope[3]} Onshape-Import-Units und ${WF.W5.past[1]} von ${WF.W5.builds[2]} Python-Dateien kommen über ihre Importe hinaus; jetzt läuft W2, der große Hebel danach ist der allgemeine Boolean K8.</p>`;
  const heroTiles = tiles([
    { label: 'Feature-Units gebaut', value: n(U.ok), unit: `von ${n(T.unitsRun)}`, note: `build123d: ${n(byFrontend.py.ok)} von ${n(pyUnits)}`, kind: 'gemessen' },
    { label: 'Units, die im Frontend stoppen', value: pct(U.frontend, T.unitsRun), note: `Capability ${pct(U.capability, T.unitsRun)}, Kernel ${pct(U.kernel, T.unitsRun)}`, kind: 'gemessen' },
    { label: 'Median bis zum Fehler', value: n(T.wallMs.p50 / 1000, 2), unit: 's', note: `p99 ${n(T.wallMs.p99 / 1000, 1)} s: Tempo ist nicht der erste Blocker`, kind: 'gemessen' },
    { label: `Familien nach Rang ${lastEst + 1} des Backlogs`, value: n(estEnd.estimated), unit: `von ${n(POP.modelFamilies)}`, note: `${n(estEnd.measured)} davon gemessen · ≈${NB}${n(cumDays[lastEst])} Arbeitstage`, kind: 'geschätzt' },
    { label: 'Repros unabhängig nachgeprüft', value: `${n(vR.filter((r) => r.same).length)} / ${n(vR.length)}`, note: `dazu ${n(vU.filter((r) => r.same).length)} / ${n(vU.length)} Corpus-Units, ${falseOk} falsche Erfolge`, kind: 'gemessen' },
  ]);
  return `<div class="hero">${headline}${kurz}${heroTiles}${source(SUMMARY, BACKLOG, VERIFY, WASHER)}${heroGrid}</div>`;
}

// ── 1 · Wo die Units stoppen ─────────────────────────────────────────────────
const passFrontend = T.unitsRun - U.frontend;
const passCapability = passFrontend - U.capability;
const funnel = barChart({
  title: `Wie weit ${n(T.unitsRun)} Units kommen`,
  sub: 'Jede Unit zählt nur ihren ersten Blocker. Das ist keine Pipeline: Hinter einer Capability-Grenze können noch Frontend-Lücken warten.',
  // Labels stay short: label + note must fit a 330 px phone track.
  data: [
    { label: 'Units im Lauf', value: T.unitsRun, kind: 'gemessen' },
    { label: 'am Frontend vorbei', value: passFrontend, note: `${n(U.frontend)} stoppen dort`, kind: 'gemessen' },
    { label: 'an Capability vorbei', value: passCapability, note: `${n(U.capability)} stoppen dort`, kind: 'gemessen' },
    { label: 'gebaut', value: U.ok, note: `${n(U.kernel)} stoppen im Kernel`, kind: 'gemessen', highlight: true },
  ],
  format: (v) => n(v),
  src: SUMMARY,
});
const perFrontend = stackedBar({
  title: 'Erster Blocker je Frontend',
  sub: 'Anteil der Units',
  keys: [{ key: 'frontend', label: 'Frontend' }, { key: 'capability', label: 'Capability' }, { key: 'kernel', label: 'Kernel' }, { key: 'ok', label: 'gebaut' }],
  rows: [
    { label: `FeatureScript · ${n(fsFiles)} Dateien`, values: byFrontend.fs },
    { label: `build123d · ${n(pyFiles)} Dateien`, values: byFrontend.py },
    { label: 'alle', values: U },
  ],
  src: [SUMMARY, RUN_DOC],
});

const pyImports = summary.clusters.find((c) => c.key === 'py-imports');
const pyApi = summary.clusters.find((c) => c.key === 'py-api-surface');
const pyModelFiles = backlog.files.filter((f) => f.frontend === 'py' && !f.excluded);
const pyUnreachable = pyModelFiles.filter((f) => f.unreachable);
const pyUnreachableFam = new Set(pyUnreachable.map((f) => f.family)).size;
const anchor = summary.anchor;
const runLoad = match(runDoc, /at concurrency \d+ under load (\d+) to (\d+)\./, 'run.md load range');
const runCores = match(runDoc, /on (\d+) cores/, 'run.md core count');
const statusVocab = mdBlock(runDoc.split('### Status vocabulary')[1].split('Rules:')[0]);
const korrekturen = mdBoldBlock(mdSection(doc, /^## 7\. Verifikation/), 'Korrekturen');
const correctionItems = korrekturen.split(/\n(?=\d+\. )/).slice(1).map((it) => {
  const m = it.match(/^\d+\. \*\*([^*]+)\*\*\s*([\s\S]*)$/);
  must(m, 'correction item');
  return { title: m[1].replace(/\.$/, ''), body: m[2] };
});
must(correctionItems.length === 6, 'six corrections in §7');

const sec1 = section({ title: 'Wo die Units stoppen', note: 'Eine Unit ist eine Datei × exportiertes Feature. Gezählt wird der erste Blocker jeder Unit.' },
  grid({ wide: true }, funnel, perFrontend),
  grid(
    card({
      title: `FeatureScript: ${n(byFrontend.fs.ok)} von ${n(fsUnits)} Units bauen`,
      kind: 'gemessen',
      body: p(`${n(T.fileStatus.ok)} von ${n(fsFiles)} Dateien baut vollständig. ${n(T.familiesWithAnyOkUnit)} Familien haben mindestens ein gebautes Feature, ${n(T.familiesOk)} eine vollständig gebaute Datei. ${pct(byFrontend.fs.frontend, fsUnits)} der Units stoppen im Frontend, ${pct(byFrontend.fs.capability, fsUnits)} an einer Capability-Grenze, ${pct(byFrontend.fs.kernel, fsUnits)} im Kernel.`),
      src: SUMMARY,
    }),
    card({
      title: 'build123d: an der Tür blockiert',
      kind: 'gemessen',
      body: p(`0 von ${n(pyFiles)} Dateien bauen. ${n(pyImports.files)} scheitern an Imports, weil der Runner mit \`-I -S\` startet. ${n(pyApi.files)} nutzen API außerhalb des Shims. Keine Datei bindet \`result\`. ${n(pyUnreachable.length)} der ${n(pyModelFiles.length)} Python-Modelldateien (${n(pyUnreachableFam)} Familien) brauchen externe Pakete wie \`cad_khana\` (P18, nicht geplant).`),
      src: [SUMMARY, BACKLOG],
    }),
    card({
      title: 'Tempo ist nicht der erste Blocker',
      kind: 'gemessen',
      body: p(`Pro Unit bis zum Ende oder Fehler: p50 ${n(T.wallMs.p50 / 1000, 2)} s, p90 ${n(T.wallMs.p90 / 1000, 2)} s, p99 ${n(T.wallMs.p99 / 1000, 2)} s, max ${n(T.wallMs.max / 1000, 2)} s. Ausnahme ist der r10b-Anker: ${n(anchor.wallMs / 1000, 1)} s, dann Abbruch bei \`UpperCore/g2\` unter der Standard-Policy \`strict\`. Gemessen unter Last ${runLoad[1]} bis ${runLoad[2]} auf ${runCores[1]} Kernen.`),
      src: [SUMMARY, RUN_DOC],
    }),
  ),
  details('Was „Frontend“, „Capability“ und „Kernel“ heißen', `${statusVocab}${callout('offen', 'Einordnung „Kernel“ ist eine Regel, keine Fehlerklasse', mdBlock(correctionItems[5].body), { src: DOC })}${source(RUN_DOC)}`),
);

// ── 2 · Cluster ──────────────────────────────────────────────────────────────
const SHORT = {
  'fs-module-import': 'FS-Modulimporte',
  'boolean-capability': 'opBoolean außerhalb der Pfade',
  'fs-interpreter-semantics': 'Interpreter-Semantik',
  'fs-needs-partstudio-input': 'Erwartet Part-Studio-Teile',
  'py-imports': 'Python-Imports',
  'kernel-sketch-and-ops': 'Skizzen, Profile, Op-Grenzen',
  'fs-missing-builtin': 'Fehlende Std-Builtins',
  'py-api-surface': 'build123d-API außerhalb Shim',
  'fs-headerless-include': 'Header-lose Fragmente',
  'boolean-invalid-topology': 'InvalidTopology (planar)',
  'fs-parser-syntax': 'Parser-Syntax',
  other: 'Sonstiges (keine Modelle)',
};
const STATUS_DE = { frontend: 'Frontend', capability: 'Capability', kernel: 'Kernel' };
const FE_DE = { fs: 'FS', py: 'Py', both: 'FS/Py' };
const clusterDocRows = mdTable(mdSection(doc, /^## 3\. Warum/), /^\| # \| Cluster/);
must(clusterDocRows.length === summary.clusters.length, 'cluster table rows');
const clusters = summary.clusters.map((c, i) => {
  const row = clusterDocRows[i];
  must(Number(row[2]) === c.units, `cluster ${c.key} units doc=${row[2]} data=${c.units}`);
  const statusTag = Object.entries(c.statuses).sort((a, b) => b[1] - a[1]).map(([s]) => STATUS_DE[s]).join(' + ');
  return { ...c, name: row[1], short: SHORT[c.key] || row[1], cause: row[5], repro: row[6], analysis: row[7], tag: `${FE_DE[c.frontend]} · ${statusTag}` };
});

function pairBars({ title, sub, data, keys, src, tableHtml }) {
  const rowH = 52, barH = 10;
  const domain = Math.max(...data.flatMap((d) => [d.a, d.b])) / 0.85;
  const rows = data.map((d, i) => {
    const y = i * rowH;
    const fa = d.a / domain, fb = d.b / domain;
    return `<g class="row"><title>${esc(d.tip)}</title><rect x="0" y="${y}" width="100%" height="${rowH}" class="hit"/>`
      + `<text x="0" y="${y + 13}" class="t-label">${esc(d.label)}</text><text x="100%" y="${y + 13}" text-anchor="end" class="t-tag">${esc(d.tag)}</text>`
      + `${bar(y + 20, barH, fa, 'f-s1')}<text x="${(fa * 100).toFixed(3)}%" dx="6" y="${y + 28.5}" class="t-value">${esc(n(d.a))}</text>`
      + `${bar(y + 33, barH, fb, 'f-s2')}<text x="${(fb * 100).toFixed(3)}%" dx="6" y="${y + 41.5}" class="t-value">${esc(n(d.b))}</text></g>`;
  });
  const h = data.length * rowH - 6;
  const svg = `<svg class="hchart" width="100%" height="${h}" role="img" aria-label="${esc(title)}"><line x1="0.5" x2="0.5" y1="18" y2="${h}" class="axis"/>${rows.join('')}</svg>`;
  return chartFigure({ title, sub, legendHtml: legend([{ cls: 'f-s1', label: keys[0] }, { cls: 'f-s2', label: keys[1] }]), svg, tableHtml, src });
}

const clusterSorted = [...clusters].sort((a, b) => b.files - a.files || b.families - a.families);
const clusterChart = pairBars({
  title: `Die ${n(clusters.length)} Cluster nach betroffenen Dateien und Familien`,
  sub: 'Eine Datei zählt in jedem Cluster, in dem mindestens eine ihrer Units stoppt. Rechts: Frontend und Fehlerart.',
  keys: ['Dateien', 'Familien'],
  data: clusterSorted.map((c) => ({ label: c.short, tag: c.tag, a: c.files, b: c.families, tip: `${c.name}: ${n(c.files)} Dateien, ${n(c.families)} Familien, ${n(c.units)} Units · primär ${n(c.primaryFiles)} Dateien` })),
  tableHtml: table({
    columns: ['Cluster', { label: 'Units', align: 'right' }, { label: 'Dateien', align: 'right' }, { label: 'Familien', align: 'right' }, { label: 'primär Dateien', align: 'right' }, { label: 'primär Familien', align: 'right' }, 'Art'],
    rows: clusterSorted.map((c) => [c.name, n(c.units), n(c.files), n(c.families), n(c.primaryFiles), n(c.primaryFamilies), c.tag]),
  }),
  src: [SUMMARY, DOC],
});

const clusterCauseTable = htmlTable({
  stack: true,
  columns: [{ label: 'Cluster' }, { label: 'Units', align: 'right' }, { label: 'Dateien / Familien', align: 'right' }, { label: 'Ursache in einem Satz' }, { label: 'Repro' }],
  rows: clusters.map((c, i) => [`<span class="note">${i + 1}</span> ${mdInline(c.name)}`, n(c.units), `${n(c.files)} / ${n(c.families)}`, mdInline(c.cause), mdInline(c.repro || '–')]),
  src: [DOC, SUMMARY],
});

// What the analyses measured beyond the first blocker (§3, four bullets with a bold lead).
const beyond = mdBoldBlock(mdSection(doc, /^## 3\. Warum/), 'Was die Analysen');
const beyondItems = beyond.split('\n').filter((l) => /^- \*\*/.test(l)).map((l) => {
  const m = l.match(/^- \*\*([^*]+)\*\*\s*(.*)$/);
  return { title: m[1].replace(/\.$/, ''), body: m[2] };
});
must(beyondItems.length === 4, 'four "beyond the first blocker" bullets');
const recoverRe = /(\d+) von (\d+) abgelehnten Booleans exakt zurückgewonnen \((\d+,\d) %\), und (\d+) Units laufen damit bis zum Ende/;
const recoverM = match(doc, recoverRe, 'recover 722/769 sentence');
const subCause = match(boolDoc, /coaxial-revolution (\d+) of (\d+) recovered,\s+pierce-admission (\d+) of (\d+), general-trim (\d+) of (\d+), general (\d+) of (\d+)/, 'recover sub-causes');
const subRows = [
  ['koaxiale Rotationskörper', 1], ['Durchgangslöcher (pierce-admission)', 3], ['getrimmte Flächen (general-trim)', 5], ['allgemeiner Fall', 7],
].map(([label, i]) => ({ label, values: { rec: Number(subCause[i]), ref: Number(subCause[i + 1]) - Number(subCause[i]) } }));
must(subRows.reduce((a, r) => a + r.values.rec, 0) === Number(recoverM[1]), 'sub-causes sum to recovered');
const recoverChart = stackedBar({
  title: `Bake-off-Route im Corpus: ${recoverM[1]} von ${recoverM[2]} abgelehnten Booleans exakt zurück`,
  sub: 'test-only eingesetzt (corefine + recover, nativ auf der CPU), nicht in Produktion und nicht unabhängig nachgeprüft',
  keys: [{ key: 'rec', label: 'exakt zurückgewonnen' }, { key: 'ref', label: 'benannt abgelehnt', neutral: true }],
  rows: subRows,
  src: BOOL_DOC,
});

const projectRows = mdTable(kurz, /^\| Projekt \|/);
const projectTable = table({
  columns: ['Projekt', { label: 'FS-Fam.', align: 'right' }, { label: 'Py-Fam.', align: 'right' }, { label: 'Dateien', align: 'right' }, { label: 'Units', align: 'right' }, { label: 'ok', align: 'right' }, 'häufigste erste Blocker (Units)'],
  rows: projectRows,
  src: DOC,
});

const sec2 = section({ title: `Warum: ${n(clusters.length)} Cluster`, note: 'Die Cluster sind eine Arbeitsliste, keine Prognose. Jede Unit meldet nur ihren ersten Blocker.' },
  clusterChart,
  details('Ursache, Repro und Analyse je Cluster', clusterCauseTable),
  '<h3 class="sub">Was die Cluster-Analysen hinter dem ersten Blocker gemessen haben</h3>',
  // Longest two first, so each row of the two-column grid pairs cards of similar height.
  grid({ wide: true }, ...beyondItems.map((b, i) => ({ ...b, i })).sort((a, b) => b.body.length - a.body.length).map(({ i, ...b }) => card({
    title: b.title,
    kind: i === 1 ? 'gemessen' : undefined,
    eyebrow: i === 1 ? 'test-only, nicht nachgeprüft' : undefined,
    body: p(b.body.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')),
    src: i === 1 ? BOOL_DOC : DOC,
  }))),
  details('Bake-off-Route im Corpus nach Unterursache', recoverChart),
  details('Pro Projekt: Familien, Dateien, Units, erste Blocker', projectTable),
);

// ── 3 · Backlog ──────────────────────────────────────────────────────────────
const backlogDocRows = mdTable(mdSection(doc, /^## 4\. Priorisierter/), /^\| Rang \| Fix/);
must(backlogDocRows.length === backlog.steps.length, 'backlog rows doc = data');
const steps = backlog.steps.map((s, i) => {
  const row = backlogDocRows[i];
  must(row[1] === s.fix, `backlog rank ${i + 1}: doc ${row[1]} vs data ${s.fix}`);
  return { ...s, rank: i + 1, cum: cumDays[i], short: row[2] };
});
must(Math.abs(cellNum(backlogDocRows[k13][4]) - cumDays[k13]) < 1e-9, 'Σ Tage at K13 matches doc');
const fixReach = (s) => (s.fix === 'K10' ? 'Ergänzung zu K8' : `${n(s.reach.files)} / ${n(s.reach.families)}`);

must(steps.slice(k13 + 1).every((s) => s.measured === estEnd.measured && s.estimated === estEnd.estimated), 'after K13 only the upper track grows');
function trackChart() {
  const total = POP.modelFamilies;
  const maxD = steps.at(-1).cum;
  const H = 300, top = 34, bottom = 26, plotH = H - top - bottom;
  const yOf = (v) => top + plotH * (1 - v / total);
  const base = backlog.baseline;
  const intervals = [{ from: 0, to: steps[0].cum, v: base, s: null }, ...steps.map((s, i) => ({ from: s.cum, to: steps[i + 1]?.cum ?? maxD, v: s, s }))].filter((iv) => iv.to > iv.from);
  const xp = (d) => `${((d / maxD) * 100).toFixed(3)}%`;
  const wp = (a, b) => `${(((b - a) / maxD) * 100 + 0.02).toFixed(3)}%`;
  const area = (key, attrs) => intervals.map((iv) => `<rect x="${xp(iv.from)}" y="${yOf(iv.v[key]).toFixed(2)}" width="${wp(iv.from, iv.to)}" height="${(top + plotH - yOf(iv.v[key])).toFixed(2)}" ${attrs} shape-rendering="crispEdges"/>`).join('');
  const edge = intervals.map((iv) => `<rect x="${xp(iv.from)}" y="${(yOf(iv.v.upper) - 0.75).toFixed(2)}" width="${wp(iv.from, iv.to)}" height="1.5" class="tr-edge" shape-rendering="crispEdges"/>`).join('');
  const hits = intervals.map((iv) => {
    const lab = iv.s ? `bis Rang ${iv.s.rank} (${iv.s.fix}: ${iv.s.short}), Σ ${n(iv.s.cum, iv.s.cum % 1 ? 1 : 0)} Tage` : 'heute';
    return `<rect x="${xp(iv.from)}" y="${top}" width="${wp(iv.from, iv.to)}" height="${plotH}" class="hit"><title>${esc(`${lab} · gemessen ${iv.v.measured} · geschätzt ${iv.v.estimated} · Obergrenze ${iv.v.upper} von ${total} Familien`)}</title></rect>`;
  }).join('');
  const grid = [50, 100, 150].map((v) => `<line x1="0" x2="100%" y1="${yOf(v)}" y2="${yOf(v)}" class="axis"/><text x="0" y="${yOf(v) - 4}" class="t-muted">${v}</text>`).join('')
    + `<line x1="0" x2="100%" y1="${yOf(total)}" y2="${yOf(total)}" class="axis"/><text x="100%" y="${yOf(total) - 6}" text-anchor="end" class="t-muted">${total} = alle Modellfamilien</text>`;
  // Day ticks every 50; drop the ones too close to the end label (they collide on phones).
  const ticks = [0, 50, 100, 150].filter((d) => (maxD - d) / maxD > 0.25).map((d) => `<text x="${xp(d)}" y="${H - 7}" text-anchor="${d === 0 ? 'start' : 'middle'}" class="t-muted">${d}</text>`).join('')
    + `<text x="100%" y="${H - 7}" text-anchor="end" class="t-muted">${n(maxD, 1)} Tage</text>`;
  const k8 = steps.find((s) => s.fix === 'K8');
  const mark = (d, label, anchor = 'middle') => `<line x1="${xp(d)}" x2="${xp(d)}" y1="${top - 2}" y2="${top + plotH}" class="tr-mark"/><text x="${xp(d)}" y="${top - 6}" text-anchor="${anchor}" class="t-ann">${esc(label)}</text>`;
  const last = steps.at(-1);
  const ends = `<text x="100%" y="${yOf(last.upper) - 6}" text-anchor="end" class="t-value">Obergrenze ${last.upper}</text>`
    + `<text x="100%" y="${yOf(last.estimated) - 7}" text-anchor="end" class="t-value">geschätzt ${last.estimated} · gemessen ${last.measured}</text>`;
  const svg = `<svg class="hchart" width="100%" height="${H}" role="img" aria-label="Kumulierte Familien je Spur über den Aufwand"><defs><pattern id="tr-hatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="5" height="5" class="f-s1-wash"/><rect width="2" height="5" class="f-s1"/></pattern></defs>`
    + `${grid}${area('upper', 'class="tr-upper"')}${edge}${area('estimated', 'fill="url(#tr-hatch)"')}${area('measured', 'class="f-s1"')}`
    + `<line x1="0" x2="100%" y1="${top + plotH + 0.5}" y2="${top + plotH + 0.5}" class="tr-base"/>${mark(k8.cum, 'K8')}${mark(steps[k13].cum, `Rang ${k13 + 1}`, 'start')}${ends}${ticks}${hits}</svg>`;
  const lg = legend([
    { cls: 'f-s1', label: 'gemessen', value: n(last.measured) },
    { cls: 'sw-hatch', label: 'geschätzt (inkl. gemessen)', value: n(last.estimated) },
    { cls: 'sw-upper', label: 'Obergrenze (inkl. offener Ketten)', value: n(last.upper) },
  ]);
  const full = table({
    columns: [{ label: 'Rang', align: 'right' }, 'Fix', 'Inhalt', 'Aufwand', { label: 'Σ Tage', align: 'right' }, { label: 'gemessen', align: 'right' }, { label: 'geschätzt', align: 'right' }, { label: 'Obergrenze', align: 'right' }, { label: 'Reichweite Dateien / Familien', align: 'right' }],
    rows: steps.map((s) => [String(s.rank), s.fix, s.short, s.effort, n(s.cum, s.cum % 1 ? 1 : 0), n(s.measured), n(s.estimated), n(s.upper), fixReach(s)]),
  });
  return chartFigure({
    title: `Der ganze Backlog, ${steps.length} Ränge: nach Rang ${k13 + 1} wächst nur noch die Obergrenze`,
    sub: `x: kumulierter Aufwand in Arbeitstagen, grob geschätzt (${Object.entries(backlog.daysPerEffort).filter(([k]) => k !== 'XS').map(([k, v]) => `${k} = ${n(v)}`).join(', ')}). y: Familien von ${total}. Die Spur „geschätzt“ endet bei Rang ${k13 + 1}.`,
    legendHtml: lg, svg, tableHtml: full, src: [BACKLOG, DOC],
  });
}

const topTable = table({
  columns: [{ label: 'Rang', align: 'right' }, 'Fix', 'Inhalt', 'Aufwand', { label: 'Σ Tage', align: 'right' }, { label: 'gemessen', align: 'right' }, { label: 'geschätzt', align: 'right' }, { label: 'Obergrenze', align: 'right' }],
  rows: steps.slice(0, k13 + 1).map((s) => [String(s.rank), s.fix, s.short, s.effort, n(s.cum), n(s.measured), n(s.estimated), n(s.upper)]),
});

/**
 * The first ranks, zoomed in: one row per rank, three nested bars on one scale
 * (outline = Obergrenze, hatched = geschätzt, solid = gemessen), numbers in columns.
 * HTML grid for the labels (they wrap on phones), a %-geometry SVG per bar.
 */
const bundleM = match(mdSection(doc, /^### Methode/), /^Innerhalb (eines Bündels stehen die billigen Fixes zuerst)\. Die (neuen Familien erscheinen beim letzten Fix des Bündels)\./m, 'bundle rule');
const bundleRule = [null, `innerhalb ${bundleM[1]}`, `die ${bundleM[2]}`];
function rankChart() {
  const rows = steps.slice(0, k13 + 1);
  const max = Math.max(...rows.map((s) => s.upper));
  const w = (v) => `${((v / max) * 100).toFixed(3)}%`;
  const plus = (v) => (v ? `+${n(v)}` : '±0');
  const defs = `<defs><pattern id="rk-hatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="5" height="5" class="f-s1-wash"/><rect width="2" height="5" class="f-s1"/></pattern></defs>`;
  const body = rows.map((s, i) => {
    const tip = `Rang ${s.rank}, ${s.fix} (${s.short}), Σ ${n(s.cum)} Tage: gemessen ${s.measured} (${plus(s.delta.measured)}), geschätzt ${s.estimated} (${plus(s.delta.estimated)}), Obergrenze ${s.upper} (${plus(s.delta.upper)})`;
    const svg = `<svg class="rk-svg" width="100%" height="16" role="img" aria-label="${esc(tip)}">${i === 0 ? defs : ''}<title>${esc(tip)}</title>`
      + `<rect x="0.75" y="1.75" width="${w(s.upper)}" height="12.5" rx="3" class="rk-upper"/>`
      + (s.estimated ? `<rect x="0" y="1" width="${w(s.estimated)}" height="14" rx="3" fill="url(#rk-hatch)"/>` : '')
      + (s.measured ? `<rect x="0" y="1" width="${w(s.measured)}" height="14" rx="3" class="f-s1"/>` : '')
      + '</svg>';
    const gain = s.delta.estimated
      ? `<strong>+${n(s.delta.estimated)} ${s.delta.estimated === 1 ? 'Familie' : 'Familien'}</strong>${s.delta.measured ? `, ${n(s.delta.measured)} davon gemessen` : ''}`
      : '±0';
    return `<div class="rk-row"><div class="rk-label"><b>${s.rank} · ${esc(s.fix)}</b> ${esc(s.short)} <span class="rk-meta">${esc(s.effort)} · Σ ${n(s.cum)} Tage · ${gain}</span></div>`
      + `<div class="rk-bar">${svg}</div><div class="rk-n">${n(s.measured)}</div><div class="rk-n">${n(s.estimated)}</div><div class="rk-n rk-u">${n(s.upper)}</div></div>`;
  }).join('');
  const head = '<div class="rk-row rk-head"><div class="rk-label"></div><div class="rk-bar"></div><div class="rk-n">gem.</div><div class="rk-n">gesch.</div><div class="rk-n">max.</div></div>';
  const noGain = rows.filter((s) => !s.delta.estimated && !s.delta.measured).map((s) => s.fix);
  return chartFigure({
    title: `Die ersten ${rows.length} Ränge: gemessen gegen geschätzt`,
    sub: `Modellfamilien, die nach diesem Rang bauen, kumuliert. Skala 0 bis ${max} von ${POP.modelFamilies}. ${noGain.join(' und ')} ${noGain.length === 1 ? 'zeigt' : 'zeigen'} ±0, weil ${bundleRule[1]}; ${bundleRule[2]}.`,
    legendHtml: legend([
      { cls: 'f-s1', label: 'gemessen: echte Geometrie im Prototyp' },
      { cls: 'sw-hatch', label: 'geschätzt: mit Stub oder Platzhalter' },
      { cls: 'sw-outline', label: 'Obergrenze: inkl. offener Ketten' },
    ]),
    svg: `<div class="rk">${head}${body}</div>`,
    tableHtml: topTable,
    src: [BACKLOG, DOC],
  });
}

const familyRows = mdTable(mdSection(doc, /^### Die Familien auf der Spur/), /^\| Familie \|/);
const familyNote = { fs361: 'Nachprüfung: braucht K1 **und** K8; gültiges STEP nur mit simuliertem F32x2', fs365: 'Nachprüfung: stimmt mit Onshape-STEP überein' };
const familyTable = htmlTable({
  stack: true,
  columns: [{ label: 'Familie' }, { label: 'Datei' }, { label: 'nötige Fixes' }, { label: 'Beleg' }],
  rows: familyRows.map(([fam, file, fixes, beleg]) => {
    const measured = /^\*\*gemessen\*\*/.test(beleg);
    const text = beleg.replace(/^\*\*gemessen\*\*:\s*|^geschätzt:\s*/, '');
    const extra = familyNote[fam] ? `<br><span class="note">${mdInline(familyNote[fam])}</span>` : '';
    return [esc(fam), mdInline(file), esc(fixes), `${badge(measured ? 'gemessen' : 'geschätzt')} ${mdInline(text)}${extra}`];
  }),
  caption: `Die ${n(familyRows.length)} Familien auf der Spur „geschätzt“`,
  src: [DOC, BACKLOG],
});

const reachTop = Object.entries(backlog.fixes)
  .filter(([, f]) => f.reach.files > 0 && f.owner !== 'out of scope')
  .sort((a, b) => b[1].reach.files - a[1].reach.files)
  .slice(0, 10);
const reachChart = barChart({
  title: 'Reichweite: Modelldateien, deren Fix-Menge diesen Fix enthält',
  sub: `Top 10 von ${Object.keys(backlog.fixes).length} Fixes; ohne P18 (nicht geplant). Reichweite heißt nicht „baut danach“.`,
  data: reachTop.map(([k, f]) => ({ label: `${k} · ${steps.find((s) => s.fix === k)?.short ?? f.title}`, value: f.reach.files, note: `${n(f.reach.families)} Familien`, highlight: k === 'K8' })),
  format: (v) => n(v),
  src: BACKLOG,
});

const meaning = mdSection(doc, /^### Was die Zahlen bedeuten/);
const cheapFixes = match(meaning, /^4\. \*\*[^*]+\*\* (.+? kosten je etwa einen Tag)\. Sie entfernen aber (den ersten Blocker von rund \d+ Units), und (erst dahinter werden die echten Ketten sichtbar)\./m, 'meaning item 4 (cheap frontend fixes)');
const k8Step = steps.find((s) => s.fix === 'K8');
const k7Step = steps.find((s) => s.fix === 'K7');
const methodBlock = mdSection(doc, /^### Methode/);

const sec3 = section({ title: 'Was zuerst: der priorisierte Backlog', note: 'Pro Datei die Menge der nötigen Fixes; ein Greedy nimmt jeweils das Bündel mit den meisten neu bauenden Familien pro Aufwandstag.' },
  callout('geschätzt', `Ehrliches Ergebnis: ${n(estEnd.estimated)} von ${n(POP.modelFamilies)} Modellfamilien nach etwa ${n(cumDays[lastEst])} Arbeitstagen`,
    p(`${n(estEnd.measured)} davon mit echter Geometrie belegt. ${n(POP.confidence.open.families)} Familien haben offene Ketten: nicht unmöglich, sondern nie bis zum Ende beobachtet. Die Obergrenze von ${n(steps.at(-1).upper)} ist optimistisch, weil offene Ketten nur ihre bekannten Blocker enthalten.`),
    { src: [BACKLOG, DOC] }),
  rankChart(),
  trackChart(),
  grid(
    card({ title: 'K8 ist der Drehpunkt', eyebrow: `Rang ${k8Step.rank} · ${k8Step.effort}`, body: p(`recover in Produktion ist der einzige Fix mit mehreren gemessenen Familien (+${k8Step.delta.estimated} Familien, ${k8Step.delta.measured} davon gemessen) und steckt in der Fix-Menge von ${n(k8Step.reach.files)} Dateien in ${n(k8Step.reach.families)} Familien. Voraussetzung ist K1: recover lehnt heutige F32-Operanden ab.`), src: BACKLOG }),
    card({ title: `Warum ${k7Step.fix} auf Rang 1 steht`, eyebrow: 'das Greedy ist mechanisch', body: p(`${k7Step.fix} hat das beste Verhältnis, betrifft aber nur ${n(k7Step.reach.files)} Dateien: eine archivierte Rückwand und ihre fsocct-Kopie. Wenig Wert für deine aktuelle Arbeit.`), src: [BACKLOG, DOC] }),
    card({ title: 'Billige Frontend-Fixes stehen spät, gehören aber nach vorn', eyebrow: 'Wert ist Information', body: p(`${cheapFixes[1]}. Allein machen sie keine Familie fertig, aber sie entfernen ${cheapFixes[2]}. ${cheapFixes[3].replace(/^./, (c) => c.toUpperCase())}. Deshalb laufen sie als W1 und W5 zuerst.`), src: DOC }),
  ),
  familyTable,
  details('Reichweite je Fix', reachChart),
  details('Methode, Belegstufen und die Lesart der Zahlen', `${mdBlock(methodBlock)}${mdBlock(meaning)}${source(DOC)}`),
);

// ── 4 · Plan W1–W8 ───────────────────────────────────────────────────────────
const plan = mdSection(doc, /^## 6\. Vorgeschlagene/);
const planIntro = plan.split('\n### ')[0].trim();
const wHeads = [...plan.matchAll(/^### (W\d): (.+)$/gm)].map((m) => {
  const [, code, rest] = m;
  const t = rest.match(/^(.*?) \(([^)]*)\), etwa (.+)$/) || rest.match(/^(.*?), etwa (.+)$/);
  must(t, `W heading ${code}`);
  const hasFix = t.length === 4;
  const tail = (hasFix ? t[3] : t[2]).split(', ');
  return { code, title: t[1], fixes: hasFix ? t[2] : '', effort: tail[0], needs: tail.slice(1).join(', '), body: mdSection(plan, new RegExp(`^### ${code}:`)) };
});
must(wHeads.length === 8, 'eight workflows');
const W = Object.fromEntries(wHeads.map((w) => [w.code, w]));
must(/W1 Frontend-Sweep\*\* \(gestartet (\d\d:\d\d)\)/.test(morning), 'morning report: W1 running');
const w1Start = morning.match(/W1 Frontend-Sweep\*\* \(gestartet (\d\d:\d\d)\)/)[1];

// W1, W4 and W5 are committed (their integration reports carry the commit); W2 runs.
const DONE = new Set(['W1', 'W4', 'W5']);
const RUNNING = new Set(['W2']);
const PHASES = [
  { label: 'Heute committet', ws: ['W1', 'W4', 'W5'] },
  { label: 'Läuft jetzt', ws: ['W2'] },
  { label: 'Als Nächstes, dann W3', ws: ['W8', 'W3'] },
  { label: 'Später', ws: ['W6', 'W7'] },
];
must(PHASES.flatMap((ph) => ph.ws).sort().join() === Object.keys(W).sort().join(), 'phases cover W1–W8');
const runBadge = '<span class="badge k-run"><i aria-hidden="true"></i>läuft</span>';
const planBadge = '<span class="badge k-plan"><i aria-hidden="true"></i>geplant</span>';
const doneBadge = '<span class="badge k-done"><i aria-hidden="true"></i>committet</span>';
const planGrid = `<figure class="plan-fig"><figcaption><strong>Reihenfolge der Workflows</strong><span>Aufwand grob geschätzt. Gefüllt: committet; durchgezogen: läuft; gestrichelt: geplant. W5b (build123d-Namen) läuft als Nachtrag zu W5.</span></figcaption><div class="plan">${PHASES.map((ph, i) => `<div class="phase"><div class="phase-head"><span>${i + 1}</span>${esc(ph.label)}</div>${ph.ws.map((code) => {
  const w = W[code];
  return `<div class="wchip${DONE.has(code) ? ' is-done' : RUNNING.has(code) ? ' is-run' : ''}"><div class="w-top"><span class="w-code">${code}</span>${DONE.has(code) ? doneBadge : RUNNING.has(code) ? runBadge : planBadge}</div><div class="w-title">${mdInline(w.title)}</div>${w.fixes ? `<div class="w-fix">${mdInline(w.fixes)}</div>` : ''}<div class="w-days">≈ ${mdInline(w.effort)}${w.needs ? ` · ${mdInline(w.needs)}` : ''}</div></div>`;
}).join('')}</div>`).join('')}</div>${source(DOC, W1_REP, W4_REP, W5_REP, W2_PLAN, W5B_PLAN, 'git log')}</figure>`;

const stateList = (paths) => `<ul class="tree">${treeState(paths).map((s) => `<li><code>${esc(s.path)}</code> <span class="st st-${s.state === 'unverändert' ? 'same' : 'chg'}">${esc(s.state)}</span></li>`).join('')}</ul>`;
/** Repo paths named in a workflow's "Umfang" line (skips identifiers like `__path__`). */
const scopePaths = (w) => [...w.body.match(/\*\*Umfang:\*\*([^\n]*)/)[1].matchAll(/`([^`]+)`/g)].map((m) => m[1]).filter((x) => /^[\w.-]+\/[\w./-]+$/.test(x));
const w1Scope = scopePaths(W.W1);
const w5Scope = scopePaths(W.W5);
const w4Paths = ['src/modules.mjs', W4_DOC, 'scripts/onshape-store.mjs', 'scripts/snapshot-modules.mjs'];
const w5Paths = [...w5Scope, 'python/build123d_names.json', 'python/cad_khana'];
/** The "Abnahme" bullet of a workflow, without its wrapper bullet (nested items dedented). */
function abnahme(w) {
  const lines = w.body.split('\n');
  const i = lines.findIndex((l) => /^- \*\*Abnahme/.test(l));
  if (i < 0) return mdBlock(w.body);
  const head = lines[i].replace(/^- \*\*Abnahme[^*]*\*\*\s*/, '');
  const rest = [];
  for (let j = i + 1; j < lines.length && !/^- /.test(lines[j]); j++) rest.push(lines[j].replace(/^ {2}/, ''));
  return (head ? p(head) : '') + mdBlock(rest.join('\n'));
}
const w4Rules = mdSection(readText(W4_DOC), /^## Rules/);
const w4RuleTitles = [...w4Rules.matchAll(/^- \*\*([^*]+)\*\*/gm)].map((m) => m[1].replace(/\.$/, ''));
must(['Bound to revisions', 'The source hash is provenance', 'Bytes are checked', 'Nothing is invented'].every((t) => w4RuleTitles.includes(t)), 'W4 rules as described');

// ── W1, W4, W5: integration reports (docs/corpus/w*.md) and their commits ────
// Each report states its result in prose and tables; flat() joins wrapped lines.
// If a report stops saying what is quoted here, the build fails (match()).
const flat = (rel) => readText(rel).replace(/\s+/g, ' ');
const commitOf = (rel) => {
  const [hash, at, subject] = git(['log', '-1', '--format=%h|%aI|%s', '--', rel]).trim().split('|');
  return hash ? { hash, at: new Date(at), subject, dirty: git(['status', '--porcelain', '--', rel]).trim() !== '' } : null;
};
const WF = {
  W1: (() => {
    const t = flat(W1_REP);
    return {
      doc: W1_REP, commit: commitOf(W1_REP),
      parser: match(t, /`fs-parser-syntax`: (\d+) units → (\d+)\./, 'W1 parser cluster'),
      semantics: match(t, /`fs-interpreter-semantics`: (\d+) → (\d+)\./, 'W1 semantics cluster'),
      builtin: match(t, /`fs-missing-builtin`: (\d+) → (\d+),/, 'W1 builtin cluster'),
      nary: match(t, /The (\d+) opBoolean arity units: (\d+) leave `boolean-capability`/, 'W1 n-ary union'),
      compare: match(t, /`compare\.mjs` reports (\d+) regressions over (\d+) units/, 'W1 regressions'),
      oneMore: match(t, /One more unit builds: `([^`]+)`/, 'W1 new build')[1],
      repros: match(t, /\*\*Every W1 repro gives the result its README states\.\*\* (\d+) of the in-scope repro features now build/, 'W1 repros')[1],
      tests: match(t, /\*\*npm test: (\d+) of (\d+) pass, not green\*\*/, 'W1 npm test'),
      testsWhy: match(t, /Two failures are language-workflow tests .*? The other (\d+) come from other workflows' in-flight changes/, 'W1 npm test reasons'),
      next: match(t, /general trimmed-face `opBoolean` in (\d+) units; - Part Studio imports in (\d+); - `opTransform` in (\d+);/, 'W1 next blockers'),
      fix2: match(t, /\*\*Fix round 2: (\w+) of (\w+) defects are fixed\*\*/, 'W1 fix round 2'),
    };
  })(),
  W4: (() => {
    const t = flat(W4_REP), i = flat(W4_DOC);
    return {
      doc: W4_REP, commit: commitOf(W4_REP),
      scope: match(t, /(\d+) corpus files \((\d+) families, (\d+) units\) import Onshape Part Studios/, 'W4 scope'),
      past: match(t, /\| \*\*past its imports\*\* \| \*\*(\d+)\*\* \| \*\*(\d+)\*\* \| \*\*(\d+)\*\* \|/, 'W4 past imports'),
      builds: match(t, /\| of these: builds \| (\d+) \|/, 'W4 builds')[1],
      buildsWhat: match(t, /\| \*\*builds\*\* \| \*\*\d+\*\* \| \d+ \| \d+ \| \| `(\w+)` \|/, 'W4 builds feature')[1],
      baseOk: match(t, /All (\d+) are still ok with the same body, face and edge counts/, 'W4 baseline ok units')[1],
      loader: match(t, /stops in the imported-body loader [^|]*\| (\d+) \|/, 'W4 loader stops')[1],
      later: match(t, /loads the imported bodies and stops later in the model \| (\d+) \|/, 'W4 later stops')[1],
      stage4: match(t, /\| unresolved import, stage 4 [^|]*\| (\d+) \|/, 'W4 stage 4')[1],
      regress: match(t, /`compare\.mjs` reports (\d+) regressions/, 'W4 regressions')[1],
      fams: match(t, /(\d+) of the (\d+) families have every import unit past its imports/, 'W4 families'),
      revs: match(i, /(\d+) imported Part Studio revisions across the corpus/, 'W4 revisions')[1],
      captured: match(i, /(\d+) revisions hold their part list and every solid part: (\d+) bodies/, 'W4 captured'),
    };
  })(),
  W5: (() => {
    const t = flat(W5_REP);
    return {
      doc: W5_REP, commit: commitOf(W5_REP),
      builds: match(t, /\*\*No Python file builds \((\d+) of (\d+)\), as the triage expected\.\*\*/, 'W5 builds'),
      past: match(t, /\| \*\*past their imports\*\* \| \*\*(\d+)\*\* \| \*\*(\d+)\*\* \| \*\*(\d+)\*\* \|/, 'W5 past imports'),
      policy: match(t, /\| import refused by the package policy \| (\d+) \|/, 'W5 package policy')[1],
      useSite: match(t, /\| build123d \/ runtime capability at the use site \| (\d+) \|/, 'W5 use site')[1],
      repros: match(t, /All (\d+) Python repros in `scripts\/corpus\/verify\/repros\.mjs` behave as documented/, 'W5 repros')[1],
      clean: match(t, /No `ModuleNotFoundError` and no `NameError` is left/, 'W5 no ModuleNotFoundError') && true,
    };
  })(),
};
must(Object.values(WF).every((w) => w.commit), 'W1, W4, W5 reports are committed');
const WORD_NUM = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const hmBerlin = (d) => d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' });
const commitNote = (w) => `committet \`${w.commit.hash}\` um ${hmBerlin(w.commit.at)} Uhr${w.commit.dirty ? ', Bericht seitdem im Arbeitsbaum geändert' : ''}`;
// Running follow-ups, each with its plan document.
const w2Plan = match(flat(W2_PLAN), /^# W2 plan: construction precision \(([^)]+)\)/, 'W2 plan title')[1];
const w5b = match(flat(W5B_PLAN), /W5 \(commit (\w+)\) left (\d+) of Marc's (\d+) Python files at a use-site capability error for one of (\d+) build123d names/, 'W5b plan');
const w1FixRunning = existsSync(join(REPO, 'var/site/w1-status'));
const w2A1 = match(flat(W2_PLAN), /\| A1 \| none of the (\d+) `boolean-invalid-topology` units ends in `InvalidTopology \(stage 1`/, 'W2 acceptance A1')[1];

// ── laufende Workflows: letzte Messung je Unit gegen die Baseline ───────────
// Same loader and clustering as scripts/corpus/compare.mjs (latest record per
// unit, re-classified from the raw fields), merged over all bench labels of a
// workflow (w1, w1-parser, …). Working trees, not accepted, not committed.
const hhmm = (iso) => new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' });
const baseDate = deDate(match(runDoc, /^Date: (\d{4}-\d\d-\d\d),/m, 'run date')[1]);
const LIVE = [
  { code: 'W1', prefix: 'w1', clusters: ['fs-parser-syntax', 'fs-interpreter-semantics', 'fs-missing-builtin'] },
  { code: 'W4', prefix: 'w4', clusters: ['fs-module-import'] },
  { code: 'W5', prefix: 'w5', clusters: ['py-imports', 'py-api-surface'] },
];
const unitName = (key) => { const [file, feature] = key.split('#'); return `${file.split('/').at(-1)}${feature ? `#${feature}` : ''}`; };
const scopeOf = (args = []) => {
  const opt = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
  if (opt('--cluster')) return `Cluster ${SHORT_OF(opt('--cluster'))}${opt('--only') ? `, nur ${opt('--only')}` : ''}`;
  if (opt('--only')) return `alle \`${opt('--only')}\`-Units`;
  if (opt('--keys-file')) return `Stichprobe \`${opt('--keys-file').split('/').at(-1)}\``;
  // run.mjs: --phase 0 = r10b anchor, 1 = family representatives, 2 = remaining files.
  const PHASE = { 0: 'nur der r10b-Anker', 1: 'Familienvertreter', 2: 'restliche Dateien' };
  if (opt('--phase') && opt('--phase') !== 'all') return PHASE[opt('--phase')] ?? `Phase ${opt('--phase')}`;
  return 'voller Lauf';
};
// SHORT is defined in §2; resolve lazily so the order of sections stays readable.
const SHORT_OF = (c) => SHORT[c] || c;

let live = null, liveError = null;
try {
  const { loadRecords } = await import('../corpus/clusters.mjs');
  const { runPaths } = await import('../corpus/lib.mjs');
  const base = loadRecords();
  const A = new Map(base.recs.map((r) => [r.key, r]));
  const tag = (r) => (r.status === 'ok' ? 'ok' : r.cluster ?? r.status);
  const geomChanged = (a, b) => {
    const va = a.totals?.volumeMm3, vb = b.totals?.volumeMm3;
    return a.totals?.bodies !== b.totals?.bodies || (va != null && vb != null && Math.abs(va - vb) > 1e-9 * Math.max(1, Math.abs(va)));
  };
  const labels = existsSync(join(REPO, BENCH)) ? readdirSync(join(REPO, BENCH)).sort() : [];
  live = LIVE.map((w) => {
    const ls = labels.filter((l) => l === w.prefix || l.startsWith(`${w.prefix}-`));
    const B = new Map();
    for (const l of ls) for (const r of loadRecords({ runs: runPaths(l).runs }).recs) {
      const prev = B.get(r.key);
      if (!prev || r.startedAt > prev.startedAt) B.set(r.key, { ...r, label: l });
    }
    const keys = [...B.keys()].filter((k) => A.has(k));
    const count = (M) => keys.reduce((o, k) => { const s = M.get(k).status; o[s] = (o[s] || 0) + 1; return o; }, {});
    const at = keys.map((k) => B.get(k).startedAt).sort();
    const meta = ls.flatMap((l) => (existsSync(join(REPO, BENCH, l, 'run-meta.jsonl')) ? readJsonl(`${BENCH}/${l}/run-meta.jsonl`).map((m) => ({ ...m, label: l })) : []));
    const perSession = new Map();
    let anchorRun = null; // latest r10b-anchor record of this workflow (loadRecords leaves the anchor out)
    for (const l of ls) {
      if (!existsSync(join(REPO, BENCH, l, 'runs.jsonl'))) continue; // a run that just started has no results yet
      for (const r of readJsonl(`${BENCH}/${l}/runs.jsonl`)) {
        perSession.set(r.session, (perSession.get(r.session) || 0) + 1);
        if (r.key === anchor.key && (!anchorRun || r.startedAt > anchorRun.startedAt)) anchorRun = r;
      }
    }
    const sessions = [...new Set(meta.map((m) => m.session))].map((s) => {
      const ev = meta.filter((m) => m.session === s);
      return { label: ev[0].label, start: ev.find((e) => e.event === 'start'), end: ev.find((e) => e.event === 'end'), last: ev.at(-1), results: perSession.get(s) || 0 };
    }).filter((s) => s.start).sort((a, b) => a.start.at.localeCompare(b.start.at));
    return {
      ...w, labels: ls, units: keys.length, before: count(A), after: count(B),
      newOk: keys.filter((k) => A.get(k).status !== 'ok' && B.get(k).status === 'ok'),
      regressions: keys.filter((k) => (A.get(k).status === 'ok' && B.get(k).status !== 'ok') || (A.get(k).status === 'ok' && B.get(k).status === 'ok' && geomChanged(A.get(k), B.get(k)))),
      moved: keys.filter((k) => tag(A.get(k)) !== tag(B.get(k))).length,
      from: at[0], to: at.at(-1), latestSession: sessions.at(-1), anchorRun,
      clusterRows: w.clusters.map((c) => {
        const measured = keys.filter((k) => tag(A.get(k)) === c);
        const still = measured.filter((k) => tag(B.get(k)) === c);
        return { cluster: c, inBase: base.recs.filter((r) => tag(r) === c).length, measured: measured.length, still: still.length, stillRecs: still.map((k) => B.get(k)) };
      }),
    };
  });
  must(live.every((w) => w.units > 0), 'every running workflow has bench records');
} catch (e) {
  liveError = e.message.replaceAll(`${REPO}/`, '').replace(/\/(Users|home)\/[^\s'"]+/g, '<Pfad>');
  live = null;
}

const LIVE_KEYS = [{ key: 'frontend', label: 'Frontend' }, { key: 'capability', label: 'Capability' }, { key: 'kernel', label: 'Kernel' }, { key: 'ok', label: 'gebaut' }];
const liveValues = (counts) => {
  const out = { other: 0 };
  for (const [s, v] of Object.entries(counts)) if (LIVE_KEYS.some((k) => k.key === s)) out[s] = v; else out.other += v;
  return out;
};
const STATUS_LABEL = { timeout: 'Zeitlimit', crash: 'Absturz' };
const liveOtherLabel = live ? [...new Set(live.flatMap((w) => [...Object.keys(w.before), ...Object.keys(w.after)]).filter((s) => !LIVE_KEYS.some((k) => k.key === s)))].map((s) => STATUS_LABEL[s] || s) : [];
const shortDate = baseDate.slice(0, 6);
const liveSrc = live ? [BASE_RUNS, ...live.flatMap((w) => w.labels.map((l) => `${BENCH}/${l}/runs.jsonl`))] : [];
const liveChart = live && stackedBar({
  title: 'Erster Blocker vorher und jetzt: dieselben Units',
  sub: `Je Workflow oben die Baseline vom ${baseDate}, darunter die letzte Messung derselben Units (Stand ${hhmm(live.map((w) => w.to).sort().at(-1))}, Bericht erzeugt ${hhmm(GENERATED.toISOString())}). Gleiche Zuordnung wie \`compare.mjs\`. Gemessen in den Arbeitsbäumen vor dem Commit; die Berichte der Workflows zählen nach dem ersten Blocker in ihrer eigenen Einteilung.`,
  keys: [...LIVE_KEYS, ...(liveOtherLabel.length ? [{ key: 'other', label: liveOtherLabel.join(', '), neutral: true }] : [])],
  rows: live.flatMap((w) => [
    { label: `${w.code} · Baseline ${shortDate}`, values: liveValues(w.before) },
    { label: `${w.code} · jetzt, Stand ${hhmm(w.to)}`, values: liveValues(w.after) },
  ]),
  src: [BASE_RUNS, `${BENCH}/{w1*,w4*,w5*}/runs.jsonl`, 'scripts/corpus/clusters.mjs'],
});

/** Plan expectation, parsed from the triage doc; null when the doc does not state it. */
const planSays = (re) => doc.match(re)?.[1] ?? null;
const PLAN = {
  parserLeft: planSays(/(\d+) Units bleiben in `fs-parser-syntax`/),
  semanticsLeft: planSays(/In `fs-interpreter-semantics` bleiben nur die (\d+) Einheiten-Units/),
  retainedFiles: planSays(/`r10bRetainedContext` baut in allen (\d+) Dateien/),
  pyImportsPast: planSays(/(\d+) der \d+ `py-imports`-Dateien kommen über den Import hinaus/),
};

/** What the committed integration report says (docs/corpus/w*.md), as a short list. */
function docFacts(code) {
  const w = WF[code];
  const items = {
    W1: () => [
      `Cluster geleert wie vorhergesagt: Parser ${w.parser[1]} → ${w.parser[2]} Units, Interpreter-Semantik ${w.semantics[1]} → ${w.semantics[2]} (die Einheitenfehler in deiner Quelle), fehlende Builtins ${w.builtin[1]} → ${w.builtin[2]} (\`opTransform\`, \`opRevolve\`, \`skText\` bleiben für W6).`,
      `N-äre Union: ${w.nary[2]} von ${w.nary[1]} Units verlassen \`boolean-capability\`. ${w.repros} Repro-Features bauen jetzt.`,
      `${w.compare[1] === '0' ? 'Keine Regression' : `${w.compare[1]} Regressionen`} über ${n(Number(w.compare[2]))} Units (\`compare.mjs\`); eine Unit baut neu: \`${w.oneMore.split('/').at(-1)}\`.`,
      `Zwei Fix-Runden nach unabhängiger Prüfung; in Runde 2 ${WORD_NUM[w.fix2[1]] ?? w.fix2[1]} von ${WORD_NUM[w.fix2[2]] ?? w.fix2[2]} Defekten behoben.${w1FixRunning ? ' Eine weitere Fix-Runde (w1-fix) läuft.' : ''}`,
      `\`npm test\` beim Commit: ${n(Number(w.tests[1]))} von ${n(Number(w.tests[2]))} grün, nicht ganz: 2 Sprach-Tests brauchen ihren Besitzer, ${w.testsWhy[1]} kamen aus Änderungen anderer laufender Workflows.`,
      `Nächste Blocker: allgemeiner getrimmter Boolean (${w.next[1]} Units), Part-Studio-Importe (${w.next[2]}), \`opTransform\` (${w.next[3]}).`,
    ],
    W4: () => [
      `${w.past[1]} von ${w.scope[3]} Import-Units kommen über ihre Importe hinaus (vorher 0), in ${w.past[2]} von ${w.scope[1]} Dateien; ${w.fams[1]} von ${w.fams[2]} Familien vollständig.`,
      `Erfasst über deine Bridge: ${w.captured[1]} von ${w.revs} Onshape-Revisionen mit allen Teilen, ${n(Number(w.captured[2]))} Körper.`,
      `Danach: ${w.loader} Units stoppen im Loader der importierten Körper (Flächen- und Kurventypen, die Bend noch nicht lädt), ${w.later} laden die Körper und stoppen später im Modell, ${w.stage4} haben noch einen ungelösten Import (Feature-Studio-Code, lokale Bibliothek).`,
      `Neu gebaut: ${w.builds} Units (\`${w.buildsWhat}\`). Die ${w.baseOk} Units, die schon vorher bauten, sind unverändert; ${w.regress === '0' ? 'keine Regression' : `${w.regress} Regressionen`}.`,
    ],
    W5: () => [
      `${w.past[1]} von ${w.builds[2]} Python-Dateien kommen über ihre Importe hinaus (${w.past[2]} aus \`py-imports\`, ${w.past[3]} aus \`py-api-surface\`); kein \`ModuleNotFoundError\` und kein \`NameError\` mehr.`,
      `Erster Blocker jetzt: Paket-Politik an der Import-Zeile (${w.policy} Dateien), eine build123d- oder Laufzeit-Fähigkeit an der Nutzungsstelle (${w.useSite}).`,
      `Gebaut: ${w.builds[1]} von ${w.builds[2]}, wie die Triage erwartet hat. Alle ${w.repros} Python-Repros verhalten sich wie dokumentiert.`,
      `W5b läuft: die ${w5b[4]} build123d-Namen, an denen ${w5b[2]} Dateien stoppen (Plan \`${W5B_PLAN}\`).`,
    ],
  }[code]();
  return `<p class="mini-k">${badge('gemessen')} Ergebnis laut Bericht, ${esc(commitNote(w).replace(/\`/g, ''))}</p>${mdBlock(items.map((i) => `- ${i}`).join('\n'))}`;
}

function liveFacts(w) {
  if (!w) return '';
  const items = [];
  items.push(`**${n(w.units)} Units** neu gemessen, ${hhmm(w.from)}–${hhmm(w.to)}; ${n(w.moved)} stoppen jetzt an einem anderen Blocker.`);
  // Group new successes by feature (several revisions of one file share it), else by file name.
  const groups = Object.values(w.newOk.reduce((acc, k) => { const g = k.includes('#') ? k.split('#')[1] : unitName(k); (acc[g] ||= { g, keys: [] }).keys.push(k); return acc; }, {}));
  const newList = groups.slice(0, 3).map(({ g, keys: ks }) => (ks.length > 1 ? `\`${g}\` in ${n(ks.length)} Dateien` : `\`${unitName(ks[0])}\``)).join(', ') + (groups.length > 3 ? ', …' : '');
  items.push(`Neu gebaut: **${n(w.newOk.length)}**${w.newOk.length ? ` (${newList})` : ''}. Regressionen: **${n(w.regressions.length)}**.`);
  const ar = w.anchorRun;
  if (ar) {
    const opOf = (r) => r.failingOperation?.operationId?.replace(/^model\//, '').replace(/\/op$/, '') ?? null;
    const same = ar.status === anchor.status && opOf(ar) === opOf(anchor);
    const where = ar.status === 'ok' ? '**baut**' : same ? `stoppt unverändert bei \`${opOf(ar)}\`` : `stoppt jetzt bei \`${opOf(ar) ?? ar.status}\` statt \`${opOf(anchor)}\``;
    const load = ar.loadavgAtStart?.[0];
    items.push(`r10b-Anker (${hhmm(ar.startedAt)}): ${where}, nach ${n(ar.wallMs / 1000, 1)} s statt ${n(anchor.wallMs / 1000, 1)} s${load != null ? ` (Load ${n(load, 0)} beim Start)` : ''}.`);
  }
  for (const c of w.clusterRows) {
    if (!c.measured) continue;
    let plan = '';
    if (c.cluster === 'fs-parser-syntax' && PLAN.parserLeft != null) plan = ` Plan: ${PLAN.parserLeft}.`;
    if (c.cluster === 'fs-interpreter-semantics' && PLAN.semanticsLeft != null) {
      const allUnits = c.stillRecs.length && c.stillRecs.every((r) => r.kind === 'units');
      plan = ` Plan: ${PLAN.semanticsLeft} Einheitenfehler in der Quelle${allUnits ? `; alle ${n(c.still)} übrigen sind Einheitenfehler` : ''}.`;
    }
    if (c.cluster === 'py-imports' && PLAN.pyImportsPast != null) plan = ` Plan: ${PLAN.pyImportsPast} von ${n(c.inBase)} kommen über den Import hinaus.`;
    items.push(`${SHORT_OF(c.cluster)}: ${n(c.still)} von ${n(c.measured)} gemessenen Units stoppen noch dort${c.measured < c.inBase ? ` (Cluster hat ${n(c.inBase)})` : ''}.${plan}`);
  }
  if (w.code === 'W4' && PLAN.retainedFiles) {
    const retained = w.newOk.filter((k) => k.endsWith('#r10bRetainedContext')).length;
    items.push(`Plan: \`r10bRetainedContext\` baut in allen ${PLAN.retainedFiles} r10b-Dateien; bisher in ${n(retained)}.`);
  }
  if (w.code === 'W5') items.push(`Python-Units gebaut: ${n(w.after.ok || 0)}. Plan: keine, erst die wahren Folgeblocker.`);
  const s = w.latestSession;
  if (s) {
    const lastActivity = [s.last.at, w.to].sort().at(-1);
    const quiet = GENERATED - new Date(lastActivity) > 30 * 60 * 1000 ? `; seit ${hhmm(lastActivity)} keine neue Messung` : '';
    const results = s.results === 1 ? '1 Ergebnis' : s.results ? `${n(s.results)} Ergebnisse` : 'kein Ergebnis';
    const state = s.end ? `abgeschlossen ${hhmm(s.end.at)}, ${results}` : `${results}, noch kein Abschluss-Eintrag`;
    items.push(`Letzter Messlauf \`${s.label}\` (${scopeOf(s.start.args)}), Start ${hhmm(s.start.at)}: ${state}${quiet}.`);
  }
  return `<p class="mini-k">${badge('gemessen')} Zwischenstand im Arbeitsbaum</p>${mdBlock(items.map((i) => `- ${i}`).join('\n'))}`;
}
const liveOf = (code) => live?.find((w) => w.code === code);

const liveDetails = (code) => (liveOf(code) ? details('Messläufe im Detail (Bench-Labels)', liveFacts(liveOf(code))) : '');
const runningCards = grid(
  card({
    title: `W1 · ${W.W1.title}`, eyebrow: `committet ${hmBerlin(WF.W1.commit.at)} Uhr`, kind: 'gemessen',
    body: p('Parser, Interpreter-Semantik, reine Builtins, `qEverything`/`makeRobustQuery`, N-äre Union. Keine Entscheidung von dir nötig.')
      + docFacts('W1') + liveDetails('W1') + details('Geänderte Dateien seit dem Commit', stateList(w1Scope)) + details('Abnahme laut Plan', abnahme(W.W1)),
    src: [W1_REP, DOC, ...(live ? [`${BENCH}/w1*/`] : []), 'git log'],
  }),
  card({
    title: `W4 · ${W.W4.title}`, eyebrow: `committet ${hmBerlin(WF.W4.commit.at)} Uhr`, kind: 'gemessen',
    body: p('Eingefrorene Part-Studio-Snapshots und ein Loader dafür: an die Onshape-Revision gebunden, der Quell-Hash ist nur Provenienz, alle Bytes per SHA-256 geprüft, fehlende Körper werden abgelehnt statt erfunden. Die Snapshots kamen über deine Bridge.')
      + docFacts('W4') + liveDetails('W4') + details('Geänderte Dateien seit dem Commit', stateList(w4Paths)) + details('Abnahme laut Plan', abnahme(W.W4)),
    src: [W4_REP, W4_DOC, DOC, ...(live ? [`${BENCH}/w4/`] : []), 'git log'],
  }),
  card({
    title: `W5 · ${W.W5.title}`, eyebrow: `committet ${hmBerlin(WF.W5.commit.at)} Uhr`, kind: 'gemessen',
    body: p('Modell läuft wie `python model.py`: Modellverzeichnis und Projektwurzel auf `sys.path`. Fester Ergebnis-Vertrag, `cad_khana` über ein Kompatibilitätsmodul, andere Pakete als Capability-Fehler an der Import-Zeile, Fehler an der Nutzungsstelle.')
      + docFacts('W5') + liveDetails('W5') + details('Geänderte Dateien seit dem Commit', stateList(w5Paths)) + details('Abnahme laut Plan', abnahme(W.W5)),
    src: [W5_REP, W5_DOC, W5B_PLAN, DOC, ...(live ? [`${BENCH}/w5*/`] : []), 'git log'],
  }),
);

const w1Sum = WF.W1, w4Sum = WF.W4, w5Sum = WF.W5;
const doneTiles = tiles([
  { label: 'W1: Parser-Cluster', value: `${w1Sum.parser[1]} → ${w1Sum.parser[2]}`, unit: 'Units', note: `Semantik ${w1Sum.semantics[1]} → ${w1Sum.semantics[2]}, Builtins ${w1Sum.builtin[1]} → ${w1Sum.builtin[2]}; +1 Unit baut`, kind: 'gemessen', src: W1_REP },
  { label: 'W4: Import-Units über den Import hinaus', value: w4Sum.past[1], unit: `von ${w4Sum.scope[3]}`, note: `vorher 0; ${w4Sum.builds} bauen neu; ${w4Sum.captured[1]} von ${w4Sum.revs} Revisionen erfasst`, kind: 'gemessen', src: [W4_REP, W4_DOC] },
  { label: 'W5: Python-Dateien über den Import hinaus', value: w5Sum.past[1], unit: `von ${w5Sum.builds[2]}`, note: `gebaut ${w5Sum.builds[1]}; erster Blocker jetzt Paket-Politik oder Nutzungsstelle`, kind: 'gemessen', src: W5_REP },
]);
const runningNow = callout('offen', 'Was jetzt läuft', mdBlock([
  `- **W2 Konstruktionspräzision** (${w2Plan}): Plan \`${W2_PLAN}\`, ändert laut Plan selbst keine Produktionsdatei; die Umsetzung läuft.`,
  `- **W5b build123d-Namen:** die ${w5b[4]} Namen, an denen ${w5b[2]} von ${w5b[3]} Python-Dateien nach W5 stoppen (Plan \`${W5B_PLAN}\`).`,
  ...(w1FixRunning ? ['- **w1-fix:** Defekte aus der dritten Prüfrunde von W1.'] : []),
].join('\n')), { src: [W2_PLAN, W5B_PLAN, ...(w1FixRunning ? ['var/site/w1-status/'] : [])] });

const sec4 = section({ title: 'Plan W1–W8: heute committet, was läuft', note: `W1, W4 und W5 sind committet; die Zahlen stehen in ihren Berichten unter \`docs/corpus/\`. Die Balken darunter sind die letzten Messläufe derselben Units gegen die Baseline vom ${deDate(match(runDoc, /^Date: (\d{4}-\d\d-\d\d),/m, 'run date')[1])}.` },
  planGrid,
  doneTiles,
  runningNow,
  callout('entscheidung', 'Abnahme für jeden Workflow', mdBlock(planIntro), { src: DOC }),
  live ? liveChart : callout('offen', 'Zwischenmessungen nicht lesbar', p(`Die Messläufe unter \`${BENCH}/\` ließen sich nicht auswerten: ${liveError}`), { src: BENCH }),
  runningCards,
  details('W2, W3, W6, W7, W8 im Detail', ['W2', 'W8', 'W3', 'W6', 'W7'].map((c) => `<h3>${c} · ${mdInline(W[c].title)} <span class="w-inline">≈ ${mdInline(W[c].effort)}${W[c].needs ? `, ${mdInline(W[c].needs)}` : ''}</span></h3>${mdBlock(W[c].body)}`).join('') + source(DOC)),
);

// ── 5 · Nachprüfung ──────────────────────────────────────────────────────────
const vUnits = verify.filter((r) => r.kind === 'unit');
const vRepros = verify.filter((r) => r.kind === 'repro');
const roleCount = (role) => vRepros.filter((r) => r.role === role).length;
const vStart = verifyMeta.find((m) => m.event === 'start');
const vEnd = verifyMeta.find((m) => m.event === 'end');
const vAnchor = vUnits.find((r) => r.why.includes('anchor'));
const validCount = validated.filter((v) => v.valid).length;
const textOnly = vRepros.filter((r) => r.role === 'cluster' && !r.patternInCluster).length;
must(vUnits.every((r) => r.same) && vRepros.every((r) => r.same), 'verification: everything same');

const washerEntries = Object.entries(washerRef);
const onshapeWasher = washerEntries.find(([k]) => k.endsWith('native/washers-native.step'))[1];
const wonkyWasher = washerEntries.find(([k]) => k.endsWith('/model.step'))[1];
const washerDv = Math.abs(wonkyWasher.volumeMm3 - onshapeWasher.volumeMm3) / onshapeWasher.volumeMm3;
must(onshapeWasher.faces === wonkyWasher.faces && onshapeWasher.edges === wonkyWasher.edges, 'washer topology agrees');

const falseOk = /^\*\*Falsche Erfolge:\*\* keine gefunden\./m.test(doc) ? '0' : '?';
const verifyTiles = tiles([
  { label: 'Corpus-Units wie im Lauf', value: `${n(vUnits.filter((r) => r.same).length)} / ${n(vUnits.length)}`, note: 'gleicher Exit-Code, gleiche Meldung mit Zeile und Spalte', kind: 'gemessen' },
  { label: 'Repro-Aufrufe wie dokumentiert', value: `${n(vRepros.filter((r) => r.same).length)} / ${n(vRepros.length)}`, note: `${n(roleCount('cluster'))} Cluster-Repros, ${n(roleCount('next'))} Folgeblocker, ${n(roleCount('control'))} Kontrollen`, kind: 'gemessen' },
  { label: 'Gebaute Units mit gültigem STEP', value: `${n(validCount)} / ${n(validated.length)}`, note: 'OCCT `BRepCheck_Analyzer`, Volumen = Kernel', kind: 'gemessen' },
  { label: 'Falsche Erfolge', value: falseOk, note: 'kein `ok` unvollständig, ungültig oder abweichend', kind: 'gemessen' },
]);

const refRows = summary.successes.map((s) => {
  const r = summary.reference.rows.find((x) => x.key === s.key);
  const [file, feature] = s.key.split('#');
  const short = file.split('/').slice(-2).join('/');
  let ref;
  if (r.verdict === 'agree') ref = `${badge('gemessen')} stimmt (FreeCAD-STEP, ΔV ${sci(r.diff.volumeRel)})`;
  else if (s.key.endsWith('top-clamp-washers-r29.fs')) ref = `${badge('gemessen')} stimmt (Onshape-STEP, ΔV ${sci(washerDv)}), erst in der Nachprüfung gefunden`;
  else { const score = r.note?.match(/score ([\d.]+)/)?.[1]; ref = `Kopie; bester Kandidat nur ${score ? n(Number(score), 1) : '–'} Punkte, Schwelle ${match(doc, /ab (\d+) Punkten als Treffer/, 'threshold')[1]}`; }
  return [`<code>${esc(short)}</code>${feature ? `<br><span class="note">${esc(feature)}</span>` : ''}`, esc(s.family), n(s.bodies), `${n(s.faces)} / ${n(s.edges)}`, `${n(s.volumeMm3, 2)} mm³`, ref];
});
const successTable = htmlTable({
  stack: true,
  columns: [{ label: 'Unit' }, { label: 'Familie' }, { label: 'Körper', align: 'right' }, { label: 'Flächen / Kanten', align: 'right' }, { label: 'Volumen', align: 'right' }, { label: 'Referenz' }],
  rows: refRows,
  caption: `Die ${n(U.ok)} Units, die heute bauen`,
  src: [SUMMARY, WASHER, DOC],
});

const verifySec = mdSection(doc, /^## 7\. Verifikation/);
const howChecked = mdBoldBlock(verifySec, 'Wie geprüft wurde').replace(/^\*\*Wie geprüft wurde\*\*\n/, '');
const confirmed = mdBoldBlock(verifySec, 'Bestätigt').replace(/^\*\*Bestätigt\*\*\n/, '');
const notChecked = match(verifySec, /^\*\*Nicht nachgeprüft:\*\* (.+)$/m, 'Nicht nachgeprüft')[1];
const shownCorrections = [0, 3, 4];
const agreeCount = summary.reference.counts.agree + 1; // + the washer file found by the verifier
const fs365 = match(correctionItems[4].body, /fs365 fasst (\d+) Dateien zusammen: (\d+) verschiedene/, 'fs365 files/parts');
const washerOk = summary.successes.find((x) => x.key.endsWith('top-clamp-washers-r29.fs'));
const correctionLead = {
  0: `Die Scheiben-Datei hat doch eine Onshape-Referenz: \`native/washers-native.step\`, gebaut aus bytegleicher Quelle. ${n(onshapeWasher.solids)} Solids, ${n(onshapeWasher.faces)} Flächen, ${n(onshapeWasher.edges)} Kanten auf beiden Seiten, ΔV relativ ${sci(washerDv)}. Damit haben ${n(agreeCount)} der ${n(U.ok)} Erfolge eine Referenz, und alle stimmen.`,
  3: `Das ändert keine Zahl, aber die Lesart für die Abnahmeleiter („20–50 echte Teile“). Die ${n(U.ok)} Erfolge sind Referenzkörper für Kaufteile: ${n(washerOk.bodies)} M5-Scheiben, eine Welle, eine Kupplung. Über den Hybrid bauen vor allem Schrauben, Scheiben und Muttern.`,
  4: `fs365 fasst ${fs365[1]} Dateien zusammen, darunter ${fs365[2]} verschiedene Teile. „1 Familie baut“ heißt hier: 1 von ${fs365[2]} Teilen, die Scheiben. Familienzahlen ersetzen keine Teilezahlen.`,
};
const nearestN = vUnits.filter((r) => r.why.includes('nearest')).length;
const perCluster = Object.values(vUnits.reduce((acc, r) => { for (const w of r.why) if (w.startsWith('cluster:')) acc[w] = (acc[w] || 0) + 1; return acc; }, {}));

const sec5 = section({ title: `Belastbarkeit: ${n(vRepros.length)} Repros und eine unabhängige Nachprüfung`, note: `Ein zweiter Agent hat den Lauf am ${stand} zwischen ${hhmm(vStart.at)} und ${hhmm(vEnd.at)} in frischen Prozessen nachgeprüft, auf dem Standard-JS-Pfad, mit höchstens ${vStart.concurrency} Prozessen.` },
  verifyTiles,
  p(`Die Stichprobe umfasst ${n(vUnits.length)} Units: alle ${n(U.ok)} Erfolge, die ${n(nearestN)} am weitesten gekommenen Fehler, ${n(Math.min(...perCluster))} bis ${n(Math.max(...perCluster))} Units pro Cluster, einen bekannten Fehler und den r10b-Anker (diesmal ${n(vAnchor.wallMs / 1000, 1)} s statt ${n(anchor.wallMs / 1000, 1)} s, gleiche Stelle). Dazu alle ${n(vRepros.length)} Repro-Aufrufe unter \`fixtures/corpus-repro/\`; ${n(textOnly)} Cluster-Repros weichen nur im Meldungstext ab, bei gleicher Art. Load zu Beginn ${vStart.loadavg.map((v) => n(v, 1)).join(' / ')}.`),
  source(VERIFY, VERIFY_META, VALIDATE),
  '<div class="gap"></div>',
  successTable,
  '<h3 class="sub">Was die Nachprüfung korrigiert hat</h3>',
  grid(...shownCorrections.map((i) => card({
    title: correctionItems[i].title,
    eyebrow: `Korrektur ${i + 1}`,
    kind: i === 0 ? 'gemessen' : undefined,
    body: p(correctionLead[i]) + details('Wortlaut der Nachprüfung', mdBlock(correctionItems[i].body)),
    src: i === 0 ? [DOC, WASHER] : DOC,
  }))),
  details('Weitere Korrekturen der Nachprüfung', correctionItems.map((c, i) => (shownCorrections.includes(i) ? '' : `<h3>Korrektur ${i + 1}: ${mdInline(c.title)}</h3>${mdBlock(c.body)}`)).join('') + source(DOC, ONSHAPE_INDEX)),
  callout('offen', 'Nicht nachgeprüft', p(notChecked.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/^./, (c) => c.toUpperCase())), { src: DOC }),
  details('Wie geprüft wurde und was bestätigt ist', `${mdBlock(howChecked)}<h3>Bestätigt</h3>${mdBlock(confirmed)}${source(DOC)}`),
);

// ── 6 · Offen / nächste Schritte ─────────────────────────────────────────────
const decisions = mdSection(doc, /^### Entscheidungen, die Marc/).split('\n').filter((l) => l.startsWith('- **')).map((l) => {
  const m = l.match(/^- \*\*([^*]+):\*\*\s*(.*)$/);
  return { key: m[1], text: m[2] };
});
must(decisions.length === 6, 'six decisions');
// P13/P15/P18 were delegated to the product owner (w5.md); the contract text lives in python-frontend.md.
match(flat(W5_REP), /\(product owner, delegated by Marc\)/, 'W5 decisions delegated to the PO');
match(flat(W5_DOC), /The model's result is resolved after the module has run; the first match wins: 1\. a module-level `result` .*? 2\. a module-level `assembly` .*? 3\. the objects passed to `show\(\)` .*? 4\. otherwise the build fails with `NoResultError`/, 'result contract');
match(flat(W5_DOC), /any other package \(`bd_warehouse`, .*? A capability error at the import line naming the package/, 'package policy');
const P2_OPEN = /\*\*Marc's decision P2 \(a\) is open\.\*\*/.test(flat(W1_REP));
const decisionState = {
  P8: ['entscheidung', `Vom Product Owner entschieden und in W4 umgesetzt (committet \`${WF.W4.commit.hash}\`): an die Revision gebunden, \`sourceSha256\` nur Provenienz.`],
  P13: ['entscheidung', `Vom Product Owner entschieden (von dir übertragen), in W5 umgesetzt (committet \`${WF.W5.commit.hash}\`): Modellverzeichnis und Projektwurzel auf \`sys.path\`, wie \`python model.py\`.`],
  P15: ['entscheidung', `Vom Product Owner entschieden, in W5 umgesetzt: Ergebnis-Vertrag, der erste Treffer gilt: \`result\`, dann \`assembly\`, dann \`show\`/\`export_step\`/\`export_stl\`, sonst \`NoResultError\`.`],
  P2: P2_OPEN ? ['offen', 'Noch offen, bei dir: heute ein expliziter Capability-Fehler mit Hinweis auf `--param`; Onshape würde leer auswählen.'] : ['entscheidung', `Laut \`${W1_REP}\` nicht mehr offen.`],
  'Cluster 9': ['offen', 'Noch offen, gehört der Sprach-Inventur.'],
  P18: ['entscheidung', `Vom Product Owner entschieden, in W5 umgesetzt: \`cad_khana\` zum Modellieren über ein Kompatibilitätsmodul, jedes andere Paket gibt einen Capability-Fehler an der Import-Zeile.`],
};
const decisionTable = htmlTable({
  stack: true,
  caption: 'Entscheidungen aus der Triage und wo sie heute stehen',
  columns: [{ label: 'Punkt' }, { label: 'Frage laut Triage' }, { label: 'Stand' }],
  rows: decisions.map((d) => {
    const [kind, text] = decisionState[d.key] || ['offen', 'offen'];
    const question = d.key === 'P18'
      ? `Externe Pakete (\`cad_khana\`, \`bd_warehouse\`, \`import_step\`, OCP) unterstützen oder bewusst ausklammern? Betroffen: ${n(pyUnreachable.length)} Python-Modelldateien in ${n(pyUnreachableFam)} Familien.`
      : d.text;
    return [`<strong>${esc(d.key)}</strong>`, mdInline(question), `${badge(kind)} ${mdInline(text)}`];
  }),
  src: [DOC, BACKLOG, W4_REP, W5_REP, W5_DOC, W1_REP],
});

const order = mdSection(doc, /^### Empfohlene Reihenfolge/);
const refIndexNote = `${n(onshapeIndex.states)} Onshape-Build-Zustände sind bytegleich zu einer Corpus-Datei, ${n(onshapeIndex.withSourceAndStep)} Units haben schon ein Onshape-STEP daneben.`;
const k8Speed = match(meaning, /K8 kostet auf JS (.+?) pro Boolean, und fs95-Features haben ([^.]+)\./, 'K8 JS cost');

const sec6 = section({ title: 'Offen / nächste Schritte' },
  grid({ wide: true },
    card({ title: 'W2 läuft', kind: 'offen', body: p(`Konstruktionspräzision (${W.W2.fixes}), ≈ ${W.W2.effort}. Keine Entscheidung nötig. Voraussetzung für W3 (recover in Produktion) und für den r10b-Anker. Der Plan \`${W2_PLAN}\` nennt als erste Abnahme: keine der ${w2A1} \`boolean-invalid-topology\`-Units endet mehr in \`InvalidTopology (stage 1\`.`), src: [DOC, W2_PLAN] }),
    card({ title: 'W8 früh und billig', kind: 'offen', body: p(`Jede neu bauende Familie braucht eine Onshape-Referenz, bevor du daraus druckst. ${refIndexNote} W8 kann dort ohne Bridge-Zeit anfangen. \`reference.mjs\` erkennt die Konvention \`native/<stem>-native.step\` noch nicht.`), src: [DOC, ONSHAPE_INDEX] }),
    card({ title: 'Nach jedem Workflow neu zählen', kind: 'offen', body: p('Voller Label-Lauf, dann `backlog.mjs --label <run>` und die Tabelle neu schreiben. Ein Teillauf reicht nicht, weil der Backlog alle Units braucht.'), src: DOC }),
    card({ title: 'K8 auf JS ist unbewiesen', kind: 'offen', body: p(`Die Bake-off-Messungen liefen nativ. Auf JS kostet K8 ${k8Speed[1]} pro Boolean, und fs95-Features haben ${k8Speed[2]}. W3 misst das.`), src: DOC }),
  ),
  decisionTable,
  details('Empfohlene Reihenfolge laut Triage', mdBlock(order) + source(DOC)),
);

// ── 7 · Quellen ──────────────────────────────────────────────────────────────
const SOURCES = [
  [DOC, 'Triage-Dokument: Kurzfassung, Cluster-Ursachen, Backlog-Tabelle, W1–W8, Nachprüfung (§7)'],
  [RUN_DOC, 'Lauf-Protokoll: Statusdefinitionen, Summen je Frontend, r10b-Anker'],
  [SUMMARY, 'Summen, Cluster, Laufzeiten, Erfolge, Referenzvergleich'],
  [BACKLOG, 'Belegstufen je Datei, Greedy-Schritte, Reichweite je Fix'],
  [VERIFY, `Nachprüfung: ${n(vUnits.length)} Units und ${n(vRepros.length)} Repro-Aufrufe`],
  [VERIFY_META, 'Zeit und Last der Nachprüfung'],
  [VALIDATE, `OCCT-Prüfung der ${n(validated.length)} gebauten Units`],
  [WASHER, 'Vergleich der Scheiben mit dem Onshape-STEP'],
  [ONSHAPE_INDEX, 'Onshape-Build-Zustände im Corpus'],
  [BOOL_DOC, `Bake-off-Route im Corpus (${recoverM[1]}/${recoverM[2]}, Unterursachen)`],
  [MORNING, 'Start von W1'],
  [W1_REP, 'W1-Bericht: Cluster vorher/nachher, Regressionen, Tests, nächste Blocker'],
  [W4_REP, 'W4-Bericht: Import-Units über den Import hinaus, nächste Blocker, neu gebaute Units'],
  [W4_DOC, 'W4: Regeln für eingefrorene Onshape-Eingaben, erfasste Revisionen'],
  [W5_REP, 'W5-Bericht: Python-Dateien über den Import hinaus, erste Blocker, Repros'],
  [W5_DOC, 'W5: Ergebnis-Vertrag, Paket-Politik (Entscheidungen P15, P18)'],
  [W2_PLAN, 'W2-Plan (läuft): Abnahmekriterien'],
  [W5B_PLAN, 'W5b-Plan (läuft): offene build123d-Namen'],
  ['git log', 'Commits von W1, W4 und W5'],
  ...(live ? [
    [BASE_RUNS, 'Baseline je Unit für den Vergleich mit den laufenden Workflows'],
    [`${BENCH}/<label>/`, `Messläufe der laufenden Workflows (\`runs.jsonl\`, \`run-meta.jsonl\`): ${live.map((w) => `${w.code} ${w.labels.map((l) => `\`${l}\``).join(', ')}`).join('; ')}`],
    ['scripts/corpus/clusters.mjs', 'Zuordnung zu Clustern, wie in `compare.mjs` (nur gelesen)'],
  ] : []),
  ['git status', 'Geänderte Dateien seit den Commits von W1, W4, W5'],
];
const sec7 = section({ title: 'Quellen', note: 'Alle Pfade relativ zum Repo. Erzeugt von `scripts/reports/triage.mjs`; jede Zahl kommt aus einer dieser Dateien.' },
  htmlTable({ stack: true, stackLabels: false, columns: [{ label: 'Datei' }, { label: 'Was daraus stammt' }], rows: SOURCES.map(([f, w]) => [`<code>${esc(f)}</code>`, mdInline(w)]) }),
);

// ── page ─────────────────────────────────────────────────────────────────────
const commit = git(['log', '--since', '2026-09-22', '--format=%h %s']).split('\n').find((l) => / Triage /.test(l))?.split(' ')[0] || '–';
const runWhen = match(runDoc, /^Date: (\d{4}-\d\d-\d\d), (\d\d:\d\d) to (\d\d:\d\d)/m, 'run date');

let html = page({
  title: 'Deine echten Teile: Korpus-Triage',
  kicker: 'wonky · Bericht · Korpus',
  date: stand,
  meta: [
    ['Lauf', `${deDate(runWhen[1])}, ${runWhen[2]}–${runWhen[3]}`],
    ['Nachprüfung', `${stand}, ${hhmm(vStart.at)}–${hhmm(vEnd.at)}`],
    ['Pfad', `Standard-JS, Policy \`strict\`, max. ${vStart.concurrency} Prozesse`],
    ['Commit', `\`${commit}\` + Arbeitsbaum`],
    ['W1, W4, W5', `committet ${['W1', 'W4', 'W5'].map((c) => `\`${WF[c].commit.hash}\``).join(', ')}${live ? ` · letzte Messung ${hhmm(live.map((w) => w.to).sort().at(-1))}` : ''} · Bericht ${hhmm(GENERATED.toISOString())}`],
  ],
  sections: ['<!--hero-->', heroHtml(), '<!--/hero-->', sec1, sec2, sec3, sec4, sec5, sec6, sec7],
});

// The kit places the TOC right after the title block; this report leads with the hero.
const toc = html.match(/<nav class="toc"[\s\S]*?<\/nav>/)[0];
html = html.replace(toc, '').replace('<!--/hero-->', toc).replace('<!--hero-->', '');

const EXTRA = `
.hero{margin:0 0 8px}
.hero-k{font:600 11px/1.3 var(--font-display);letter-spacing:.09em;text-transform:uppercase;color:var(--muted);margin:0 0 6px}
.hero-h{font:700 clamp(40px,7.5vw,72px)/1 var(--font-display);letter-spacing:-.015em;margin:0 0 10px;max-width:none}
.hero-file{font-size:14px;color:var(--ink-2);margin:0 0 18px;max-width:none}
.hero-file code{font-size:13px}
.hero-sum{font-size:clamp(17px,2.2vw,19.5px);line-height:1.5;max-width:66ch;margin:0 0 22px}
.hero-sum strong{font-weight:680}
.card .mini-k .badge{margin-right:6px;vertical-align:-1px}
.card .mini-k{display:flex;flex-wrap:wrap;align-items:center;gap:2px 0}
.card .mini-k+ul{font-size:14px;margin-bottom:8px}
@media (max-width:640px){
  .sm-hide{display:none}
  .stk thead{display:none}
  .stk table,.stk tbody,.stk tr,.stk td{display:block;width:auto}
  .stk caption{display:block}
  .stk tr{padding:10px 0 8px;border-bottom:1px solid var(--rule)}
  .stk tr:first-child{border-top:1.5px solid var(--rule-strong)}
  .stk td{border:0;padding:1px 0}
  .stk td.num{text-align:left;display:inline-block;vertical-align:top;margin-right:18px}
  .stk.stk-nolabel td[data-label]::before{display:none}
  .hero .tiles .tile:last-child:nth-child(odd){grid-column:1 / -1}
  .stk td.stk-head{font-weight:620;padding-bottom:2px}
  .stk td[data-label]::before{content:attr(data-label);display:block;font:600 10px/1.3 var(--font-display);letter-spacing:.09em;text-transform:uppercase;color:var(--muted);margin-top:6px}
  .stk tbody tr:hover td{background:none}
}
.hero>.src{margin:-14px 0 22px}
.waffle{border:1px solid var(--rule);border-radius:6px;padding:14px 16px 12px;margin:0 0 30px}
.waffle>figcaption{display:flex;flex-direction:column;gap:2px;margin-bottom:14px}
.waffle>figcaption strong{font-size:15px}
.waffle>figcaption span{font-size:13px;color:var(--muted);max-width:75ch}
.wf-block{margin:0 0 14px;max-width:640px}
.wf-head{display:flex;flex-wrap:wrap;justify-content:space-between;gap:2px 10px;align-items:baseline;font-size:13px;color:var(--ink-2);margin:0 0 6px}
.wf-head b{font:600 12px/1.3 var(--font-display);letter-spacing:.08em;text-transform:uppercase;color:var(--ink)}
.wf-svg{display:block;width:100%;height:auto;overflow:visible}
.wf-today{fill:var(--ink)} .wf-real{fill:var(--s1)} .wf-excl{fill:var(--n)}
.wf-open{fill:none;stroke:var(--n);stroke-width:1;vector-effect:non-scaling-stroke}
g:hover>.wf-cell{stroke:var(--accent);stroke-width:2;vector-effect:non-scaling-stroke}
.sw.wf-sw-today{background:var(--ink)}
.sw.wf-sw-open{background:none;box-shadow:inset 0 0 0 1px var(--n)}
.sw.wf-sw-excl{width:5px;height:5px;border-radius:50%;background:var(--n);margin:0 3.5px}
.sw.sw-upper{background:color-mix(in srgb,var(--n) 30%,var(--surface));box-shadow:inset 0 2px 0 var(--n)}
.t-tag{font-size:12px;fill:var(--muted)}
@media (max-width:560px){.t-tag{display:none}}
.tr-upper{fill:color-mix(in srgb,var(--n) 30%,var(--surface))}
.tr-edge{fill:var(--n)}
.tr-base{stroke:var(--ink-2);stroke-width:1}
.tr-mark{stroke:var(--ink-2);stroke-width:1;stroke-opacity:.55}
.t-ann{font-size:11.5px;font-weight:600;fill:var(--ink-2)}
.hchart .hit:hover{fill:var(--accent-wash)}
.plan-fig>figcaption{display:flex;flex-direction:column;gap:2px;margin-bottom:10px}
.plan-fig>figcaption strong{font-size:15px}
.plan-fig>figcaption span{font-size:13px;color:var(--muted)}
.plan{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));border:1px solid var(--rule);border-radius:6px}
.phase{padding:10px 12px 4px;border-right:1px solid var(--rule);min-width:0}
.phase:last-child{border-right:0}
.phase-head{display:flex;align-items:center;gap:8px;font:600 11px/1.3 var(--font-display);letter-spacing:.09em;text-transform:uppercase;color:var(--muted);margin:0 0 10px}
.phase-head span{display:inline-grid;place-items:center;width:18px;height:18px;border:1.5px solid var(--rule-strong);border-radius:50%;font-size:10.5px;letter-spacing:0;color:var(--ink)}
.wchip{border:1px dashed var(--muted);border-radius:6px;padding:8px 10px;margin:0 0 8px;background:var(--surface)}
.wchip.is-run{border:1px solid var(--accent);box-shadow:inset 3px 0 0 var(--accent);background:var(--accent-wash)}
.wchip.is-done{border:1px solid var(--rule-strong);background:var(--surface-2)}
.badge.k-done i{background:var(--accent);border-radius:2px}
.w-top{display:flex;justify-content:space-between;align-items:center;gap:6px}
.w-code{font:700 17px/1.2 var(--font-display);letter-spacing:.02em}
.w-title{font-weight:620;font-size:14px;line-height:1.3;margin-top:2px}
.w-fix{font-size:12px;color:var(--ink-2);line-height:1.35;margin-top:2px}
.w-days{font-size:12px;color:var(--muted);margin-top:4px;line-height:1.35}
.w-inline{font:400 13px/1.3 var(--font-body);color:var(--muted)}
.badge.k-run i{border:1.6px solid var(--accent);border-radius:50%;background:linear-gradient(90deg,var(--accent) 50%,transparent 50%)}
.badge.k-plan i{border:1.6px dashed var(--muted);border-radius:50%}
.card .mini-k{font:600 10.5px/1.3 var(--font-display);letter-spacing:.09em;text-transform:uppercase;color:var(--muted);margin:10px 0 4px}
.tree{list-style:none;padding:0;margin:0 0 6px;font-size:13px}
.tree li{margin:2px 0;display:flex;flex-wrap:wrap;gap:2px 8px;align-items:baseline}
.st{font-size:11.5px;color:var(--muted)} .st-chg{color:var(--accent);font-weight:600}
.note{font-size:12.5px;color:var(--ink-2)}
h3.sub{font:600 12px/1.3 var(--font-display);letter-spacing:.09em;text-transform:uppercase;color:var(--muted);margin:6px 0 10px}
.gap{height:18px}
.wf-body{display:grid;grid-template-columns:minmax(0,640px) minmax(13rem,1fr);gap:4px 32px;align-items:start}
.wf-side .legend{flex-direction:column;gap:9px;margin:24px 0 10px}
.wf-side .legend li{align-items:center}
.wf-side .legend b{margin-left:auto;padding-left:12px}
.wf-total{font-size:12.5px;color:var(--muted);border-top:1px solid var(--rule);padding-top:8px;margin:0}
@media (max-width:900px){.wf-body{grid-template-columns:1fr}.wf-side .legend{flex-direction:row;margin:4px 0 8px}.wf-side .legend b{margin-left:0;padding-left:0}}
.more-body h3{margin:14px 0 6px}
td .badge{margin-right:4px}
.card ul,.card ol{padding-left:1.15em}
.card .more-body>p{margin-bottom:.5em}
@media (max-width:760px){
  .plan{grid-template-columns:repeat(2,minmax(0,1fr))}
  .phase:nth-child(2){border-right:0}
  .phase:nth-child(-n+2){border-bottom:1px solid var(--rule)}
}
@media (max-width:440px){
  .plan{grid-template-columns:1fr}
  .phase{border-right:0;border-bottom:1px solid var(--rule)}
  .phase:last-child{border-bottom:0}
  .waffle{padding:12px}
}
@media print{.wchip.is-run{background:none}}
.rk{margin:0}
.rk-row{display:grid;grid-template-columns:17rem minmax(0,1fr) repeat(3,3.2rem);column-gap:12px;align-items:center;padding:7px 0;border-bottom:1px solid var(--rule)}
.rk-row:hover{background:var(--accent-wash)}
.rk-head{padding:0 0 5px;border-bottom:1.5px solid var(--rule-strong)}
.rk-head:hover{background:none}
.rk-head .rk-n{font:600 10.5px/1.3 var(--font-display);letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
.rk-label{font-size:13.5px;line-height:1.35;min-width:0}
.rk-label b{font-weight:650}
.rk-meta{display:block;font-size:12px;color:var(--muted);margin-top:1px}
.rk-meta strong{color:var(--ink-2);font-weight:620}
.rk-n{text-align:right;font-size:13px;font-weight:600;font-variant-numeric:tabular-nums}
.rk-n.rk-u{color:var(--ink-2);font-weight:500}
.rk-svg{display:block;overflow:visible}
.rk-upper{fill:none;stroke:var(--n);stroke-width:1.5}
.sw.sw-outline{background:none;box-shadow:inset 0 0 0 1.5px var(--n)}
@media (max-width:640px){
  .rk-row{grid-template-columns:minmax(0,1fr) repeat(3,2.7rem);column-gap:8px;row-gap:5px}
  .rk-label{grid-column:1 / -1}
  .rk-head .rk-label{display:none}
}
code.path{overflow-wrap:break-word}
`;
html = html.replace('</head>', `<style>${EXTRA}</style>\n</head>`);
// Long repo paths break after "/" (not mid-word): mark every slash as a soft break.
html = html.replace(/<code>([^<]*\/[^<]*)<\/code>/g, (_, c) => `<code class="path">${c.replaceAll('/', '/<wbr>')}</code>`);
assertPublicSafe(html);
writeReport('triage.html', html);
