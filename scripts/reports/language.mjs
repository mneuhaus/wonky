
if (!(await import('node:fs')).existsSync(new URL('../../var/site/development-record.md', import.meta.url))) {
  console.log('local-only historical report input absent; report omitted');
  process.exit(0);
}
// Builds out/reports/language.html: "Eigene Sprache? Die Entscheidung".
//   node scripts/reports/language.mjs
//
// Every number comes from a repo file. JSON is read directly; numbers that only
// exist in the German/English markdown reports are pulled with grab()/mdTable(),
// which throw if a document no longer contains the expected wording. The report
// therefore breaks loudly instead of printing stale numbers.
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import {
  page, section, p, ul, esc, inline, tiles, grid, card, callout, table, details,
  barChart, stackedBar, beforeAfter, diagram, source, fmt, readJson, writeReport, REPO,
} from './lib.mjs';

// ── sources ──────────────────────────────────────────────────────────────────
const S = {
  decision: 'docs/language.md',
  priorArt: 'docs/language/prior-art.md',
  corpusDoc: 'docs/language/corpus.md',
  corpus: 'out/lang/corpus.json',
  census: 'out/lang/wk/census.json',
  bendDoc: 'docs/language/bend-feasibility.md',
  bendRun: 'out/lang/spike/run-2/report.json',
  profileDoc: 'docs/native-bridge/profile.md',
  profile: 'out/native-bridge/profile/summary.json',
  spikeDoc: 'docs/language/spike-real-model.md',
  spikeNotes: 'docs/language/prototype.md',
  spike: 'out/lang/wk/real/summary.json',
  gateRuns: 'out/lang/wk/real/gate-runs.json',
  washers: 'out/lang/wk/real/washers.json',
  chain: 'out/lang/wk/real/chain.json',
  verbosity: 'out/lang/prior-art/verbosity.json',
  morning: 'var/site/development-record.md',
  booleanPlan: 'docs/hybrid-boolean-plan.md',
  w1: 'docs/corpus/w1.md',
  w5: 'docs/corpus/w5.md',
};

// ── markdown helpers (numbers that only live in prose) ───────────────────────
const docCache = new Map();
const raw = (rel) => {
  if (!docCache.has(rel)) docCache.set(rel, readFileSync(join(REPO, rel), 'utf8'));
  return docCache.get(rel);
};
const flat = (rel) => raw(rel).replace(/\s+/g, ' ');
/** First match of `re` in the whitespace-collapsed document; throws when the wording changed. */
function grab(rel, re) {
  const m = flat(rel).match(re);
  if (!m) throw new Error(`language.mjs: ${rel} no longer matches ${re}`);
  return m;
}
/** German number: "2.037" → 2037, "7,2" → 7.2, "0.81" (English) → 0.81. */
const num = (s) => {
  const t = String(s).trim();
  return /,/.test(t) || /^\d{1,3}(\.\d{3})+$/.test(t) ? Number(t.replace(/\./g, '').replace(',', '.')) : Number(t);
};
/** Markdown table whose header line matches `headerRe` → array of cell arrays (links reduced to text). */
function mdTable(rel, headerRe) {
  const lines = raw(rel).split('\n');
  const start = lines.findIndex((l) => l.startsWith('|') && headerRe.test(l));
  if (start < 0) throw new Error(`language.mjs: table ${headerRe} not found in ${rel}`);
  const rows = [];
  for (let i = start + 2; i < lines.length && lines[i].startsWith('|'); i++) {
    rows.push(lines[i].slice(1, -1).split(/(?<!\\)\|/).map((c) => c.trim().replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')));
  }
  return rows;
}
/** Bullet list directly after a line matching `anchorRe`. */
function mdList(rel, anchorRe) {
  const lines = raw(rel).split('\n');
  const start = lines.findIndex((l) => anchorRe.test(l));
  if (start < 0) throw new Error(`language.mjs: list ${anchorRe} not found in ${rel}`);
  const items = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (!lines[i].trim()) { if (items.length) break; continue; }
    if (!lines[i].startsWith('- ')) break;
    items.push(lines[i].slice(2).replace(/[;.]$/, ''));
  }
  return items;
}
const firstBold = (s) => s.match(/\*\*([^*]+)\*\*/)?.[1] ?? s;
const median = (xs) => { const a = [...xs].sort((x, y) => x - y); const m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };
const NB = ' '; // keeps "1,2 %" and "15 ms" together on narrow screens
const sec = (ms) => (ms >= 1000 ? `${fmt.num(ms / 1000, 2)}${NB}s` : `${fmt.num(ms, 0)}${NB}ms`);
const secOnly = (ms) => `${fmt.num(ms / 1000, 2)}${NB}s`; // one unit per chart, so 931 ms reads as 0,93 s next to 1,49 s
const pct1 = (x) => `${fmt.num(x, 1)}${NB}%`;
const pct0 = (x) => `${fmt.num(x, 0)}${NB}%`;
const DE_COUNT = ['keine', 'eine', 'zwei', 'drei', 'vier', 'fünf'];
const loadRange = (loads) => {
  const ones = loads.flat().filter((x) => x != null).map((x) => (Array.isArray(x) ? x[0] : Number(String(x).split(' ')[0])));
  return [Math.min(...ones), Math.max(...ones)].map((v) => fmt.num(v, 0));
};

// ── data ─────────────────────────────────────────────────────────────────────
const corpus = readJson(S.corpus);
const census = readJson(S.census);
const profile = readJson(S.profile);
const bend = readJson(S.bendRun);
const spike = readJson(S.spike).workloads;
const chain = readJson(S.chain);
const verbosity = readJson(S.verbosity);

const decisionDate = grab(S.decision, /Stand: (\d{4}-\d{2}-\d{2})/)[1];
const spikeDate = grab(S.spikeDoc, /Stand: (\d{4}-\d{2}-\d{2})/)[1];
const spikeRounds = grab(S.spikeDoc, /Stand: \d{4}-\d{2}-\d{2}, (mit [^.]+)\./)[1];
const deDate = (iso) => iso.split('-').reverse().join('.');

// Wall-time profile (JS path today).
const frontendShareMax = profile.headline.frontendShareMax;
const wl = profile.workloads;
const r10b = wl['fs-r10b-strict'].bucketsMs;
const r10bFrontMs = r10b.frontendParse + r10b.interpreter;
const r10bTotalMs = Object.values(r10b).reduce((a, b) => a + b, 0);

// Corpus: how often does control flow depend on kernel results?
const fsU = corpus.featureScript.sync.unique;
const fsF = corpus.featureScript.sync.families;
const pyU = corpus.python.sync.unique;
const pyF = corpus.python.sync.families;
const loops = corpus.featureScript.constructShares.loopsGeometryIndependent;
const fsShares = corpus.featureScript.constructShares;
const predFs = corpus.featureScript.predicateKinds;
const predFsTotal = Object.values(predFs).reduce((a, b) => a + b, 0);
const predFsMixed = Object.entries(predFs).filter(([k]) => k.includes('+')).reduce((a, [, v]) => a + v, 0);
const predPy = corpus.python.predicateKinds;
const predPyTotal = Object.values(predPy).reduce((a, b) => a + b, 0);
const vocabFam = corpus.featureScript.coverage.kernelVocabularyOnly.families;

// WK census: the FS corpus recorded as one graph.
const cu = census.unique;
const oc = cu.outcomes;

// Bend spike (run-2).
const fwtKernel = bend.kernel.find((k) => k.name === 'frame-with-tab');
const fwtJs = bend.jsPath.find((j) => j.case === 'frame-with-tab.py');
const fwt4 = median(bend.threads.find((t) => t.program === 'frame-with-tab' && t.threads === 4).samples.map((s) => s.evalMs));
const bendLoad = loadRange([fwtKernel.loadBefore, fwtKernel.loadAfter, fwtJs.loadBefore, fwtJs.loadAfter, ...bend.threads.filter((t) => t.program === 'frame-with-tab').map((t) => t.loadBefore)]);
const fib = bend.evaluator.find((e) => e.name === 'fib').summary;
const sumsq = bend.evaluator.find((e) => e.name === 'sumsq').summary;
const buildC = bend.builds.steps.find((s) => s.name === 'main: bend -> C');
const buildClang = bend.builds.steps.find((s) => s.name === 'main: clang -O3');
const f32 = bend.numberSemantics;
const occtMs = num(grab(S.bendDoc, /Real build123d\/OCCT builds frame-with-tab in ([\d.]+) ms/)[1]);

// Prior art and LLM literature (English report, prose numbers).
const kcl = grab(S.priorArt, /\((\d+) GitHub contributors\)\. The KCL implementation in `kcl-lib` is about ([\d.]+) MB of Rust source\. KCL went through (\w+) language versions/);
const rawFs = grab(S.priorArt, /Raw FeatureScript with the new annotations: invalid rate \*\*(\d+) %\*\*\. Standardized FeatureScript: \*\*(\d+) %\*\*/);
const explicit = grab(S.priorArt, /Explicit sketch parametrization[^:]*: invalid rate \*\*(\d+) % to (\d+) %\*\*/);
const vsPy = grab(S.priorArt, /But the invalid rate is \*\*(\d+) % against (\d+) %\*\*/);
const cadfsN = grab(S.priorArt, /fine-tuning on (\d+k) cleaned real programs/)[1];
const cadsmith = grab(S.priorArt, /median IoU from (\d+(?:\.\d+)?) to (\d+(?:\.\d+)?)/);
const ids = grab(S.priorArt, /Deterministic ids \("F0", "E0"\) instead of random ones: median chamfer distance (\d+(?:\.\d+)?) to (\d+(?:\.\d+)?)/);
const MONTH_DE = { January: 'Januar', February: 'Februar', March: 'März', May: 'Mai', June: 'Juni', July: 'Juli', October: 'Oktober', December: 'Dezember' };
const kclFixes = grab(S.priorArt, /In (\w+ \d{4}) Zoo still ships fixes for topology tags/)[1].replace(/^\w+/, (m) => MONTH_DE[m] ?? m);
const versionsDe = { two: 'zwei', three: 'drei', four: 'vier', five: 'fünf' }[kcl[3]] ?? kcl[3];
// The FS-vs-Python comparison has two caveats the report must carry: the Python model had more training
// data, and CADFS was better on shape fidelity.
const cadrilleN = grab(S.priorArt, /Cadrille, however, trained on ([\d.]+)M examples/)[1];
const cadfsCd = grab(S.priorArt, /CADFS text-to-CAD chamfer distance ([\d.]+) against Cadrille's ([\d.]+)/);
const curvArchived = grab(S.priorArt, /GitHub repo archived (\d{4}); maintained on Codeberg/)[1];
const fornjotArchived = grab(S.priorArt, /\| \*\*Fornjot\*\* \|[^\n]*\| Archived (\d{4})-(\d{2}) \|/);

// Decision document (German).
const planar = grab(S.decision, /Von (\d+) realen Korpus-Features, deren schwere Arbeit nur aus Booleans besteht, sind nur \*\*(\d+)\*\* rein planar/);
const evalLines = grab(S.decision, /Ein Graph-Auswerter erster Ordnung ist dagegen klein \((\d+) Zeilen\)/)[1];
const evalThreads = grab(S.decision, /\d+ Zeilen, keine Fuel außer Baumtiefe, Memo über Graphen, bitgleich über ([\d/]+) Threads/)[1].split('/');
const studyParts = grab(S.decision, /(\d+) bis (\d+) Teile aus Marcs Familien/);
const studyConds = grab(S.decision, /(\w+) Bedingungen: build123d auf CPython/)[1];
const breakTarget = grab(S.decision, /mindestens (\d+) % der verarbeitbaren Dateien ohne Break erreichen/)[1];
const measLoad = grab(S.decision, /Load (\d+) bis (\d+) in allen Quellmessungen/);
const bindingX = grab(S.decision, /Das Binding liefert gemessen ([\d,]+) bis ([\d,]+)x Ende-zu-Ende/);
const claims = mdTable(S.decision, /^\| # \| Behauptung \| Ergebnis \|/);
const scores = mdTable(S.decision, /^\| Vorschlag \| N \| L \|/);
const blocks = mdTable(S.decision, /^\| Baustein \| Herkunft \| Warum \|/);
const steps = mdTable(S.decision, /^\| # \| Schritt \| liefert \|/);
const triggers = mdTable(S.decision, /^\| Beobachtung \| Folge \|/);
const dontBuild = mdList(S.decision, /^\*\*Nicht bauen:\*\*/);
const idea = raw(S.decision).split('\n').filter((l) => l.startsWith('> ')).map((l) => l.slice(2)).join(' ');

// Spike on a real part (German).
const nodesSame = grab(S.spikeDoc, /\*\*(\d+) von (\d+) Körperknoten byte-gleich\*\*/);
const volDelta = flat(S.spikeDoc).match(/um \*\*([\d,]+)·10⁻¹³ mm³\*\*/)?.[1];
// Fix-Runde 3 (§16) reports node 93 as byte-identical while §1/§5 still carry the old count.
const node93Fixed = /Knoten 93 von dual-hardware ist jetzt byte-gleich/.test(flat(S.spikeDoc));
const dualLine = nodesSame[1] === nodesSame[2]
  ? `dual-hardware: **alle ${nodesSame[2]}** Körperknoten byte-gleich zu den heutigen Adaptern`
  : `dual-hardware: **${nodesSame[1]} von ${nodesSame[2]}** Körperknoten byte-gleich${volDelta ? `; einer wich nur im Volumen ab, um ${volDelta}·10⁻¹³ mm³` : ''}${node93Fixed ? '. Laut Fix-Runde 3 ist auch dieser Knoten inzwischen byte-gleich; die Zählung im Spike-Bericht ist noch nicht nachgezogen' : ''}`;
const buildsOne = grab(S.spikeDoc, /von (\d+) geprüften Features baut genau eines \((\w+)\)/);
const recheck = grab(S.spikeDoc, /mindestens (\d+) ms Kernarbeit/)[1];
const evalRebuild = grab(S.spikeDoc, /Jede Auswerter-Änderung kostet (\d+) bis (\d+) s und bis zu (\d+) GB/);
const bridgeEntries = grab(S.spikeDoc, /Das Binding braucht die ([\w-]+, [\w-]+ und [\w-]+)-Einstiege \((Bridge-Schritte [\d/]+)\)/);
const spikeLoad = grab(S.spikeDoc, /die 1-Minuten-Load lag bei \*\*(\d+) bis (\d+)\*\*/);
const regressionPrograms = grab(S.spikeDoc, /\*\*washers\*\* \(das eine echte Teil, das heute baut\), frame-with-tab, (\d+) Regressionsprogramme/)[1];
const GATE = num(grab(S.decision, /erreicht bei 4 Threads < ([\d,]+)x gegenüber dem seriellen nativen Pfad/)[1]);
const gw = spike.washers;
const dual = spike['dual-hardware'];
const washersNodes = readJson(S.washers).record.nodes;
// Gate: the headline quote is the main run in summary.json (the value the spike report quotes in §1);
// the repeated runs (gate-runs.json, summarised in summary.json) decide "robust" and give the spread.
const gateStats = Object.fromEntries(Object.entries(spike).filter(([, w]) => w.gateRuns).map(([id, w]) => [
  id, { min: w.gateMin, max: w.gateMax, pass: w.gateRunsPassing, n: w.gateRuns, robust: w.robustPass },
]));
const gateRuns = readJson(S.gateRuns);
const gateLoad = loadRange(Object.values(gateRuns.workloads).flatMap((w) => w.rows.flatMap((x) => [x.loadBefore, x.loadAfter])));
const gws = gateStats.washers;
const dualSaveMs = dual.median.W_best_ms - dual.median.T4_ms;
// The spike report's §6.2 gate table may still carry an older fix round than §1 and the raw data.
const tableWashersGate = raw(S.spikeDoc).match(/^\| \*\*washers \(Gate\)\*\* \|[^|]*\|[^|]*\| \*\*([\d,]+)\*\* \|/m)?.[1];

// Morning report 2026-09-23: what already moved on the critical path.
const slice = grab(S.morning, /Der planare Teil des Bend-Kernels \((\d+) Einstiege\) läuft als N-API-Addon/);
const sweepTopics = grab(S.morning, /\*\*W1 Frontend-Sweep\*\* \(gestartet ([\d:]+)\): ([^.]+)\./);
const triageBuiltins = grab(S.morning, /\| fehlende Builtins, z\. B\. `opTransform` \| (\d+) \|/)[1];
const booleanPlanProd = /Nothing here is implemented in production yet/.test(flat(S.booleanPlan));
// Since then (23.09. evening): commits of the Boolean decision and of W1, and the two
// follow-ups the frontend workflows left for the language workflow.
const lastCommit = (rel) => execFileSync('git', ['log', '-1', '--format=%h', '--', rel], { cwd: REPO, encoding: 'utf8' }).trim();
const planCommit = lastCommit(S.booleanPlan);
const w1Commit = lastCommit(S.w1);
const w1Parser = grab(S.w1, /`fs-parser-syntax`: (\d+) units → (\d+)\./);
const w1LangTests = grab(S.w1, /Two failures are language-workflow tests that assert the old `try` behavior and need their owner/);
const w1TryFix = grab(S.w1, /`src\/lang\/wk\/record-fs\.mjs:[\d-]+` \(`todayError`\) rebuilds a replayed failure as a plain `FeatureScriptError`, which `try` no longer catches/);
const w5Trace = grab(S.w5, /`src\/lang\/dataflow\/py-trace\.mjs` read the pre-contract `handle` of the runner's `complete` message, so `lang-dataflow` traced `\[null\]` outputs .*? the tracer should read `outputs` \(follow-up for the language workflow\)/);

// ── custom blocks (extra CSS below, injected into <head>) ────────────────────
/** Verdict sheet: one column per question, the verdict on top and the tile that backs it underneath. */
const ruling = (items) =>
  `<div class="ruling" role="list">${items
    .map((v) => `<div class="pair" role="listitem"><div class="v-cell v-${v.tone}"><span class="v-topic">${inline(v.topic)}</span><span class="v-word">${esc(v.word)}</span><span class="v-sub">${inline(v.sub)}</span></div>${tiles([v.tile])}</div>`)
    .join('')}</div>`;

const verdictTone = (text) => (/widerlegt/.test(text) ? 'no' : /geteilt/.test(text) ? 'split' : 'yes');
const claimsLedger = (rows, notes = {}) =>
  `<div class="claims">${rows
    .map(([id, claim, result]) => {
      const verdict = firstBold(result).replace(/[.,]$/, '');
      const why = result.replace(/^\*\*[^*]+\*\*[.,]?\s*/, '');
      return `<div class="claim"><span class="c-id">${esc(id)}</span><span class="c-text">${inline(claim)}</span><span class="c-verdict c-${verdictTone(verdict)}">${esc(verdict)}</span><span class="c-why">${inline(why)}${notes[id] ? `<span class="c-note">${inline(notes[id])}</span>` : ''}</span></div>`;
    })
    .join('')}</div>`;

const EXTRA_CSS = `
.lead{margin:0 0 30px}
.kurz{border-left:4px solid var(--ink);padding:2px 0 2px 16px;margin:0 0 22px}
.kurz .tb-k{margin-bottom:4px}
.kurz p{font-size:clamp(17px,2.2vw,19px);line-height:1.5;margin:0;max-width:66ch}
.ruling{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));grid-template-rows:auto auto;border:1.5px solid var(--rule-strong);margin:0 0 18px}
.pair{display:grid;grid-row:span 2;grid-template-rows:subgrid;row-gap:0;border-right:1px solid var(--rule);min-width:0}
.pair:last-child{border-right:0}
.pair .tiles{border:0;border-top:1px solid var(--rule);margin:0;grid-template-columns:minmax(0,1fr)}
.pair .tile{border:0;margin:0}
.v-cell{display:flex;flex-direction:column;gap:5px;padding:12px 14px 14px;min-width:0}
.hchart .thr{stroke:var(--ink);stroke-width:2;stroke-dasharray:3 2}
.v-topic{font:600 11px/1.3 var(--font-display);letter-spacing:.09em;text-transform:uppercase;color:var(--muted)}
.v-word{font:700 clamp(26px,3.6vw,34px)/1 var(--font-display);letter-spacing:.03em;text-transform:uppercase}
.v-yes .v-word{color:var(--accent)}
.v-no .v-word{color:var(--ink)}
.v-hold .v-word{color:var(--ink-2)}
.v-yes{box-shadow:inset 0 4px 0 var(--accent)}
.v-no{box-shadow:inset 0 4px 0 var(--ink)}
.v-hold{box-shadow:inset 0 4px 0 var(--warn-line)}
.v-sub{font-size:13px;line-height:1.35;color:var(--ink-2)}
.idea{margin:0 0 20px;padding:4px 0 4px 16px;border-left:3px solid var(--rule);font-size:17px;line-height:1.5;max-width:66ch;color:var(--ink)}
.idea cite{display:block;margin-top:6px;font:600 11px/1.3 var(--font-display);letter-spacing:.09em;text-transform:uppercase;color:var(--muted);font-style:normal}
.claims{border-top:1.5px solid var(--rule-strong);margin:0 0 22px}
.claim{display:grid;grid-template-columns:2rem minmax(0,1fr) auto;gap:4px 12px;padding:10px 0;border-bottom:1px solid var(--rule);align-items:baseline}
.c-id{font:700 18px/1 var(--font-display);color:var(--muted)}
.c-text{font-weight:600}
.c-verdict{justify-self:end;font:600 11px/1 var(--font-display);letter-spacing:.07em;text-transform:uppercase;padding:4px 7px;border:1.5px solid currentColor;border-radius:3px;white-space:nowrap}
.c-yes{color:var(--accent)} .c-no{color:var(--fail)} .c-split{color:var(--warn)} .c-never{color:var(--ink-2)}
.steps .c-text{font-weight:400}
.steps .c-id{font-size:16px}
.only-narrow{display:none}
.c-why{grid-column:2 / -1;font-size:14.5px;color:var(--ink-2);max-width:78ch}
.c-note{display:block;margin-top:3px;color:var(--ink)}
.c-note::before{content:"Stand ${deDate(spikeDate)}: ";font-weight:620}
.claims+.src{margin:-12px 0 22px}
.grid>.callout{margin:0;max-width:none}
.quellen code{overflow-wrap:normal}
.plan-h{font:600 11px/1.3 var(--font-display);letter-spacing:.09em;text-transform:uppercase;color:var(--muted);margin:30px 0 8px}
@media (max-width:640px){
  .only-wide{display:none} .only-narrow{display:block}
  .ruling{grid-template-columns:repeat(2,minmax(0,1fr))}
  .pair:nth-child(2n){border-right:0}
  .pair:nth-child(-n+2){border-bottom:1.5px solid var(--rule-strong)}
  .v-cell{padding:11px 12px 12px}
  .claim{grid-template-columns:1.6rem minmax(0,1fr)}
  .c-verdict{grid-column:2;justify-self:start}
}
`;

// ── header block ─────────────────────────────────────────────────────────────
// Two sentences: the verdict, then the three measured reasons.
const kurzfassung = `Ja zu einem gemeinsamen Kern: **WK/0**, ein Graph-IR aus Kernel-Operationen, in das FeatureScript und build123d übersetzt werden. Nein zu einer neuen Sprache und zu einem Interpreter in Bend, denn das Tempo kommt vom nativen Kern (Parser plus Interpreter ≤${NB}${pct1(frontendShareMax * 100)} der Wall-Zeit), nur ${pct1(fsU.verdict.generalLanguage.pct)} von Marcs FS-Dateien verzweigen über Kernergebnisse, und LLMs schreiben Python zuverlässiger als seltene CAD-Sprachen.`;

const lead = `<div class="lead">
<div class="kurz"><span class="tb-k">Kurzfassung</span><p>${inline(kurzfassung)}</p></div>
${ruling([
  {
    tone: 'yes', topic: 'Gemeinsamer Kern', word: 'Ja', sub: '**WK/0**: Graph-IR aus Kernel-Ops, erst auf dem Host (Preflight, Diff, Cache)',
    tile: { label: 'FS-Dateien schon heute als ein Graph ohne Break', value: fmt.num(cu.singleGraphShareOfAll, 1), unit: '%', note: `${cu.singleGraph} von ${cu.files} eindeutigen; ${pct0(cu.singleGraphShareOfStaged)} der verarbeitbaren`, kind: 'gemessen', src: S.census },
  },
  {
    tone: 'no', topic: 'Neue Sprache', word: 'Nein', sub: `Marcs Code braucht sie nicht (${pct1(fsU.verdict.generalLanguage.pct)} der FS-Dateien verzweigen über Kernergebnisse), LLMs auch nicht`,
    tile: { label: 'Ungültige LLM-Ausgaben: FeatureScript gegen CadQuery', value: `${vsPy[1]} : ${vsPy[2]}`, unit: '%', note: `Literaturwert (CADFS), trotz Fine-Tuning auf ${cadfsN} FS-Programmen`, src: S.priorArt },
  },
  {
    tone: 'no', topic: 'Interpreter in Bend', word: 'Nein', sub: 'kein messbarer Gewinn, F32x2 statt binary64, lange Compiles',
    tile: { label: 'Parser + Interpreter an der Wall-Zeit', value: `≤ ${fmt.num(frontendShareMax * 100, 1)}`, unit: '%', note: `über ${Object.keys(wl).length} Workloads; r10b ${fmt.num(r10bFrontMs, 0)}${NB}ms von ${fmt.num(r10bTotalMs / 1000, 1)}${NB}s`, kind: 'gemessen', src: S.profile },
  },
  {
    tone: 'hold', topic: 'Graph-Auswertung in Bend', word: 'Vorerst nein', sub: `Spike ${deDate(spikeDate)}: kein \`run_graph\`, der Graph bleibt auf dem Host`,
    tile: { label: `Fork-Join-Gate ≥ ${fmt.num(GATE, 1)}x auf dem echten Teil`, value: `${gws.pass} von ${gws.n}`, unit: 'Läufen', note: `washers: Gate-Quote ${fmt.num(gw.gateRatio, 2)}; Wiederholungen ${fmt.num(gws.min, 2)} bis ${fmt.num(gws.max, 2)}`, kind: 'fehlgeschlagen', src: [S.spike, S.gateRuns] },
  },
])}
</div><!--/lead-->`;

// ── 1. idea and claims ───────────────────────────────────────────────────────
const tones = claims.map(([, , r]) => verdictTone(firstBold(r)));
const count = (t) => tones.filter((x) => x === t).length;
const cap = (s) => s[0].toUpperCase() + s.slice(1);
const s1 = section(
  { title: 'Marcs Idee, geprüft', note: `Die Idee wurde in ${DE_COUNT[claims.length] ?? claims.length} prüfbare Behauptungen zerlegt. ${cap(DE_COUNT[count('yes')])} halten, ${DE_COUNT[count('split')]} hält teilweise, ${DE_COUNT[count('no')]} fallen.` },
  `<blockquote class="idea">${inline(idea.replace(/\*([^*]+)\*/g, '**$1**'))}<cite>Marc, zitiert in docs/language.md §2</cite></blockquote>`,
  claimsLedger(claims, { D: `Der Spike auf einem echten Teil verwirft \`run_graph\` (Gate ≥ ${fmt.num(GATE, 1)} in ${gws.pass} von ${gws.n} Läufen). Der Kernel-Graph bleibt vorerst auf dem Host.` }),
  source(S.decision, S.spikeDoc),
);

// ── 2. the decision ──────────────────────────────────────────────────────────
// One architecture, two layouts: 4 columns on wide screens, 2 columns on phones
// (a 4-column SVG scaled to 330 px would shrink its labels to about 7 px).
const ARCH = {
  title: 'Wo WK/0 sitzt',
  sub: 'FS und build123d bleiben die Eingänge. WK/0 zeichnet auf, was sie vom Kern wollen. Gestrichelt: geplant, nach dem Spike vorerst verworfen.',
  nodes: [
    { id: 'fs', label: 'FeatureScript', sub: 'unverändert', wide: [0, 0], narrow: [0, 0] },
    { id: 'py', label: 'build123d', sub: 'CPython', wide: [0, 1], narrow: [1, 0] },
    { id: 'int', label: 'FS-Interpreter', sub: 'Host, binary64', wide: [1, 0], narrow: [0, 1] },
    { id: 'shim', label: 'Shim', sub: 'stabile Call-Path-IDs', wide: [1, 1], narrow: [1, 1] },
    { id: 'wk', label: 'WK/0 Graph-IR', sub: 'Hash, Diff, Preflight', wide: [2, 0], narrow: [0, 2], kind: 'accent' },
    { id: 'core', label: 'Bend-Kern', sub: 'nativ über das Binding', wide: [3, 0], narrow: [0, 3] },
    { id: 'rg', label: 'run_graph', sub: 'Fork-Join in Bend', wide: [3, 1], narrow: [1, 3], kind: 'planned' },
  ],
  edges: [
    { from: 'fs', to: 'int' },
    { from: 'py', to: 'shim' },
    { from: 'int', to: 'wk', label: 'Op-Records' },
    { from: 'shim', to: 'wk' },
    { from: 'wk', to: 'core', label: 'Fassaden-Ops' },
    { from: 'wk', to: 'rg', planned: true },
  ],
};
const archFor = (layout, geom) => diagram({
  title: ARCH.title, sub: ARCH.sub, edges: ARCH.edges, src: S.decision, ...geom,
  nodes: ARCH.nodes.map(({ wide, narrow, ...n }) => ({ ...n, col: (layout === 'wide' ? wide : narrow)[0], row: (layout === 'wide' ? wide : narrow)[1] })),
});
// lib's diagram() attaches a cross-column edge at the middle of a box side. In the 2-column phone layout the
// Shim → WK/0 edge and the dashed WK/0 → run_graph edge would share WK/0's right midpoint and the gap
// column, so the dashed edge leaves lower on that side and runs 5 px further right.
const NARROW = { colW: 176, boxW: 150, boxH: 54, rowH: 92, pad: 8 }; // boxH, rowH, pad = lib defaults
function rerouteNarrow(html) {
  const { colW, boxW, boxH, rowH, pad } = NARROW;
  const at = (id) => { const [c, r] = ARCH.nodes.find((n) => n.id === id).narrow; return { x: pad + c * colW, y: pad + r * rowH }; };
  const a = at('wk'), b = at('rg');
  const x1 = a.x + boxW, x2 = b.x, y2 = b.y + boxH / 2, mx = (x1 + x2) / 2;
  const before = `d="M${x1} ${a.y + boxH / 2} H${mx} V${y2} H${x2 - 2}" class="edge planned"`;
  if (!html.includes(before)) throw new Error('language.mjs: phone diagram edge WK/0 → run_graph not found; did lib diagram() routing change?');
  return html.replace(before, `d="M${x1} ${a.y + boxH - 10} H${mx + 5} V${y2} H${x2 - 2}" class="edge planned"`);
}
const archDiagram = `<div class="only-wide">${archFor('wide', { colW: 250 })}</div><div class="only-narrow">${rerouteNarrow(archFor('narrow', { colW: NARROW.colW, boxW: NARROW.boxW }))}</div>`;

const scoreRows = scores.map((r) => ({ name: firstBold(r[0]), desc: r[0].replace(/^\*\*[^*]+\*\*\s*/, '').replace(/^\(|\)$/g, ''), mean: num(r[7]), final: num(firstBold(r[8])) }));
const s2 = section(
  { title: 'Die Entscheidung: WK/0 statt neuer Sprache', note: 'Ein internes, content-adressiertes Graph-IR aus Kernel-Operationen. Menschen und LLMs schreiben weiter FeatureScript und build123d.' },
  archDiagram,
  grid(
    card({
      title: 'Bauen',
      kind: 'entscheidung',
      body: ul([
        'Recorder im **unveränderten** FS-Interpreter: eine FS-Semantik statt zwei',
        'Knotenset = grobe Fassaden-Ops des Bindings: ein Vertrag, einmal entworfen',
        'zwei Hashes pro Knoten (`geom` ohne IDs, `full` mit IDs) für Cache und Diff',
        'stabile IDs und eine kanonische Textform `wonky-kernel-graph/0` zum Lesen, nicht zum Schreiben',
        '`wonky graph --check` und `--diff`, auch als MCP-Werkzeug für Agenten',
      ]),
      src: S.decision,
    }),
    card({ title: 'Nicht bauen', kind: 'entscheidung', body: ul(dontBuild), src: S.decision }),
  ),
  details(`Wie die drei Vorschläge abgeschnitten haben (${scoreRows.map((r) => `${r.name} ${fmt.num(r.final, 1)}`).join(', ')})`, [
    barChart({
      title: 'Bewertung der drei Vorschläge',
      sub: 'Mittel über die Kriterien Nutzen, LLM, Korpus, Bend-Risiko, inkrementeller Pfad und Binding-Fit (je 0 bis 10), nach Abzug für nicht gedeckte Behauptungen. Urteil des Schiedsspruchs, keine Messung.',
      data: scoreRows.map((r) => ({ label: r.name, note: r.desc, value: r.final, kind: 'geschätzt' })),
      format: (v) => fmt.num(v, 1),
      max: 10,
      src: S.decision,
    }),
    p('Keiner gewinnt allein. core-ir und dataflow sind zwei Umsetzungen derselben Idee. Der Hybrid nimmt die Aufzeichnung aus dataflow (gemessene Op-für-Op-Treue) und Knotenset, Regionen und nativen Auswerter aus core-ir. surface (WPy) liefert Bausteine für später.'),
    table({ columns: ['Baustein', 'Herkunft', 'Warum'], rows: blocks, caption: 'Die Bausteine des Hybrids mit Herkunft', src: S.decision }),
  ].join('\n')),
);

// ── 3. speed comes from the kernel ───────────────────────────────────────────
const wlLabel = { 'py-planar-union': 'planar-union (build123d)', 'py-planar-pocket': 'planar-pocket (build123d)', 'py-frame-with-tab': 'frame-with-tab (build123d)', 'fs-bracket': 'bracket (FS)', 'fs-bored-spacer-print': 'bored-spacer, Druckmesh (FS)', 'fs-fuse-g1': 'fuse-g1 (FS)', 'fs-cut-h1': 'cut-h1 (FS)', 'fs-r10b-strict': 'r10b bis Abbruch (FS)' };
const wallRows = Object.entries(wl).map(([id, w]) => {
  const sh = w.bucketSharesGcAttributed;
  const total = Object.values(w.bucketsMs).reduce((a, b) => a + b, 0);
  const front = sh.frontendParse + sh.interpreter;
  return { label: wlLabel[id] ?? id, values: { kernel: sh.kernel * total, load: sh.bendLoad * total, front: front * total, rest: (1 - sh.kernel - sh.bendLoad - front) * total } };
});
const s3 = section(
  { title: 'Warum 1: Das Tempo kommt vom Kern, nicht von der Sprache', note: `Gleiches Teil, gleicher Kern: ob direkt oder durch eine Sprache in Bend aufgerufen, macht keinen Unterschied. Der Sprung kommt vom nativen Kern (Binding: ${bindingX[1]}- bis ${bindingX[2]}-fach).` },
  barChart({
    title: 'frame-with-tab, Ende-zu-Ende',
    sub: `Bend-Spike, Lauf 2, Load ${bendLoad[0]} bis ${bendLoad[1]}: indikativ. Jede Seite misst ihre eigene Pipeline Ende-zu-Ende. Der Sprach-Pfad liefert ${fwtKernel.checks.hashEqualsDirectKernelCalls ? 'denselben' : 'einen anderen'} B-rep-Hash wie die direkten Aufrufe. Zum Vergleich: build123d/OCCT baut dasselbe Teil in ${fmt.num(occtMs, 1)}${NB}ms; diese Lücke schließt nur ein besserer Kernalgorithmus, keine Sprache.`,
    data: [
      { label: 'JS-Pfad heute (buildPython, warm)', value: fwtJs.medianMs, kind: 'gemessen' },
      { label: 'nativer Kern, direkte Aufrufe, 1 Thread', value: fwtKernel.summary.directKernelMs, kind: 'gemessen', highlight: true },
      { label: 'nativer Kern durch die Bend-Sprache, 1 Thread', value: fwtKernel.summary.coreEvalMs, kind: 'gemessen', highlight: true },
      { label: 'durch die Bend-Sprache, 4 Threads', value: fwt4, kind: 'gemessen', highlight: true },
    ],
    format: secOnly,
    src: [S.bendRun, S.bendDoc],
  }),
  // lib prints each row total as "n = …"; for durations that reads as a count, so relabel it here.
  stackedBar({
    title: 'Wohin die Wall-Zeit heute geht (JS-Pfad)',
    sub: `Parser + Interpreter ist in jeder Zeile ein Strich: höchstens ${pct1(frontendShareMax * 100)}. Große Teile verbringen die Zeit im Kern, kleine beim Laden des Bend-JS-Kerns. Rechts: Wall-Zeit gesamt.`,
    keys: [{ key: 'kernel', label: 'Kern' }, { key: 'load', label: 'Bend-JS-Kern laden' }, { key: 'front', label: 'Parser + Interpreter' }, { key: 'rest', label: 'Rest (Start, Host, Export)', neutral: true }],
    rows: wallRows,
    format: (v) => sec(v),
    src: [S.profile, S.profileDoc],
  }).replace(/>n = /g, '>gesamt '),
  details('Tree-Walker im Vergleich: Nanosekunden pro Schritt', table({
    columns: ['Programm', { label: 'Bend nativ, ns/Knoten', align: 'right' }, { label: 'V8-Tree-Walker, ns/Knoten', align: 'right' }, { label: 'wonkys FS-Interpreter, ns/Schritt', align: 'right' }],
    rows: [fib, sumsq].map((s, i) => [['fib', 'sumsq'][i], fmt.num(s.nativeNsPerNode, 1), fmt.num(s.jsCoreNsPerNode, 1), fmt.num(s.fsNsPerStep, 1)]),
    caption: `Ein nativer Auswerter ist kaum schneller als V8. Bei höchstens ${pct1(frontendShareMax * 100)} Anteil an der Wall-Zeit wäre auch ein viel schnellerer Interpreter unsichtbar.`,
    src: S.bendRun,
  })),
);

// ── 4. the corpus ────────────────────────────────────────────────────────────
const LEVELS = ['keine Rückfrage', 'lazy Query', 'Check', 'Leer-Guard', 'Messwert-Datenfluss', 'Host-Selektion', 'Map pro Entität', 'geometrieabhängige Steuerung'];
const levelData = Object.entries(fsU.levels).map(([k, v], i) => ({ label: `${i} · ${LEVELS[i]}`, value: v.n, highlight: i === 7 }));
const s4 = section(
  { title: 'Warum 2: Marcs Code braucht keine allgemeine Sprache neben dem Kern', note: 'Fast jede Datei liest Geometrie zurück, aber fast immer, um zu prüfen oder deklarativ auszuwählen. Das passt in ein Graph-IR.' },
  stackedBar({
    title: 'Was eine Datei vom Kern verlangt',
    sub: `Eindeutige Modelldateien aus Marcs Korpus, statisch gescannt. Der dritte Teil ist der, der eine allgemeine Sprache neben dem Kern bräuchte: FS ${pct1(fsU.verdict.generalLanguage.pct)}, build123d ${pct1(pyU.verdict.generalLanguage.pct)}.`,
    // The third segment is the point but too thin to carry a label; its counts go into the legend.
    keys: [{ key: 'simple', label: 'einfacher Op-Graph mit Checks' }, { key: 'lazy', label: 'lazy IR (Prädikate, Regionen, Messwerte)' }, { key: 'general', label: `allgemeine Sprache nötig: FS ${fsU.verdict.generalLanguage.n}, build123d ${pyU.verdict.generalLanguage.n} Dateien` }],
    rows: [
      { label: `FeatureScript, ${fsU.of} Dateien`, values: { simple: fsU.verdict.simpleGraph.n, lazy: fsU.verdict.lazyIr.n, general: fsU.verdict.generalLanguage.n } },
      { label: `build123d, ${pyU.of} Dateien`, values: { simple: pyU.verdict.simpleGraph.n, lazy: pyU.verdict.lazyIr.n, general: pyU.verdict.generalLanguage.n } },
    ],
    src: S.corpus,
  }),
  callout('gemessen', 'Die wenigen Ausnahmen sind Workarounds', p(`Die ${fsU.levels['7-geo-control-flow'].n} FS- und ${pyU.levels['7-geo-control-flow'].n} build123d-Dateien mit echter geometrieabhängiger Steuerung umgehen fast alle **Fillet- und Chamfer-Fehler des Kerns** (\`try silent\` pro Kante, Radius-Fallbacks). Kontrollfluss ist im Korpus kein Entwurfsidiom. Auf Familien gerechnet: FS ${pct1(fsF.verdict.generalLanguage.pct)}, build123d ${pct1(pyF.verdict.generalLanguage.pct)}.`), { src: [S.corpus, S.corpusDoc] }),
  stackedBar({
    title: 'Der FS-Korpus, aufgezeichnet als WK-Graph',
    sub: `Dynamisch: jede eindeutige FS-Modelldatei wurde tatsächlich gestaged. Parser-Lücken sind ein Frontend-Thema, keine Grenze des IR. Sonstige: ${oc['model-error']} Modellfehler, ${oc['frontend-gap']} Frontend-Lücken, ${oc['no-feature']} ohne Feature.`,
    keys: [{ key: 'one', label: 'ein Graph, 0 Breaks' }, { key: 'brk', label: 'Graph-Break' }, { key: 'parse', label: 'Parser lehnt ab' }, { key: 'other', label: 'sonstige', neutral: true }],
    rows: [{ label: 'FS eindeutig', values: { one: oc['single-graph'], brk: oc['graph-break'], parse: oc['parse-error'], other: oc['model-error'] + oc['frontend-gap'] + oc['no-feature'] } }],
    src: S.census,
  }),
  grid(
    card({ title: 'Prädikate sind einfach', eyebrow: 'Selektion', kind: 'gemessen', body: p(`${predFsTotal} Auswahl-Prädikate in FS: ${predFs.range} Bereichsfenster, ${predFs.direction} Richtungstests, ${predFsMixed} gemischt, ${predFs.type} Typtests, **0** brauchen allgemeinen Code. build123d: ${predPyTotal - predPy.complex} von ${predPyTotal} sind einfache Tests.`), src: S.corpus }),
    card({ title: 'Das Vokabular ist schmal', eyebrow: 'Kernel-Funktionen', kind: 'gemessen', body: p(`${vocabFam.for80.greedy} Funktionen decken 80${NB}%, ${vocabFam.for95.greedy} decken 95${NB}% der FS-Familien (von ${vocabFam.universe} genutzten).`), src: S.corpus }),
    card({ title: 'Marcs FS ist erster Ordnung', eyebrow: 'Sprachmittel', kind: 'gemessen', body: p(`${fsShares.lambdas.unique.n} Lambdas, ${fsShares.capturingClosures.unique.n} Closures, ${fsShares.recursion.unique.n} Rekursion in ${fsShares.lambdas.unique.of} Dateien. ${pct0(loops.independentPct)} von ${fmt.num(loops.loops)} Schleifen laufen über Sammlungen, die das Programm selbst bestimmt.`), src: S.corpus }),
  ),
  details('Rückfrage-Stufen im FS-Korpus (höchste Stufe je Datei)', barChart({
    title: 'FS-Dateien nach höchster Rückfrage-Stufe',
    sub: `${fsU.of} eindeutige Dateien. Stufen 0 bis 6 passen in ein Graph-IR ohne Host-Rundreise, Stufe 7 nicht.`,
    data: levelData,
    format: (v) => `${fmt.num(v)} Dateien`,
    src: [S.corpus, S.corpusDoc],
  })),
);

// ── 5. prior art and LLMs ────────────────────────────────────────────────────
const s5 = section(
  { title: 'Warum 3: Prior Art und LLMs', note: 'Reife Systeme bündeln ihre Eingänge in einer kleinen Operationsschicht. Eine neue Sprache hat nur ein Projekt am Leben gehalten, mit einem finanzierten Team.' },
  beforeAfter({
    title: 'Ungültige Ausgaben von LLMs, in %',
    sub: 'Literaturwerte (CADFS, CVPR 2026). Jede Zeile vergleicht innerhalb einer Tabelle; zwischen Zeilen nicht vergleichbar. Kleiner ist besser.',
    unit: '%',
    labels: { before: 'Ausgangsform', after: 'Variante' },
    data: [
      { label: 'rohes FS → standardisiertes FS', before: num(rawFs[1]), after: num(rawFs[2]) },
      { label: 'implizite → explizite Punkt-Parametrisierung', before: num(explicit[1]), after: num(explicit[2]) },
      { label: 'CadQuery (Python) → FeatureScript', before: num(vsPy[2]), after: num(vsPy[1]) },
    ],
    format: (v) => `${fmt.num(v)} %`,
    src: S.priorArt,
  }),
  p('Die ersten beiden Zeilen zeigen, was LLMs hilft: normalisierte Operationen und explizite Parameter. Die dritte zeigt, was schadet: eine Sprache mit wenig Trainingsdaten, selbst nach großem Fine-Tuning. Marc nutzt Frontier-Modelle ohne Fine-Tuning.'),
  p(`Einschränkung zur dritten Zeile: Das Python-Vergleichsmodell (Cadrille) hatte ${fmt.num(num(cadrilleN), 2)}${NB}Mio. Trainingsbeispiele, und in der Formtreue lag CADFS vorn (Chamfer-Distanz ${fmt.num(num(cadfsCd[1]), 2)} gegen ${fmt.num(num(cadfsCd[2]), 2)}). Die Zeile belegt die Richtung, nicht die Größe des Effekts.`),
  grid(
    card({ title: 'Zoo KCL: die eine neue CAD-Sprache, die lebt', eyebrow: 'Prior Art', body: ul([`${kcl[1]} Contributors, etwa ${fmt.num(num(kcl[2]), 1)}${NB}MB Rust in \`kcl-lib\``, `${versionsDe} Sprachversionen mit Breaking Changes`, `noch im ${kclFixes} Fixes für Topologie-Tags, die Booleans verlieren`, 'KCLs Designer: zu wenig Code, um KI zu trainieren']), src: S.priorArt }),
    card({ title: 'Die anderen neuen Sprachen und Kerne: archiviert', eyebrow: 'Prior Art', kind: 'fehlgeschlagen', body: p(`CADmium und Fornjot (${fornjotArchived[2]}/${fornjotArchived[1]}) sind archiviert, Curvs GitHub-Repo seit ${curvArchived} (heute auf Codeberg gepflegt). Fornjot scheiterte an Topologie und Umfang, nicht an Sprachfragen.`), src: S.priorArt }),
    card({ title: 'Was LLMs messbar hilft, braucht keine Syntax', eyebrow: 'Literatur', body: ul([`deterministische IDs: Chamfer-Distanz ${fmt.num(num(ids[1]), 2)} → ${fmt.num(num(ids[2]), 2)} (CADFS)`, `Kern-Feedback im Loop: IoU ${fmt.num(num(cadsmith[1]), 2)} → ${fmt.num(num(cadsmith[2]), 2)} (CADSmith)`, 'globaler Frame statt lokaler Skizzen-Frames (Makatura)', 'WK/0 liefert IDs, Preflight mit Spannen und Graph-Diffs']), src: S.priorArt }),
  ),
  details('Illustration: ein L-Winkel in vier Sprachen', barChart({
    title: 'Lexikalische Tokens für denselben L-Winkel',
    sub: 'Eine Datei, keine Sprachbewertung. Die FS-Fassung enthält den defineFeature-Rahmen und einen UI-Parameter. KCL wurde nicht ausgeführt.',
    data: verbosity.results.map((r) => ({ label: r.name, value: r.lexTokens })),
    format: (v) => `${fmt.num(v)} Tokens`,
    src: S.verbosity,
  })),
);

// ── 6. Bend as a language host ───────────────────────────────────────────────
const s6 = section(
  { title: 'Warum 4: Bend taugt als Graph-Auswerter, nicht als Sprach-Host', note: `Eine dynamische Kernsprache läuft nativ in Bend und liefert bitgleiche Kernergebnisse. Als Sprach-Host hat Bend aber drei harte Grenzen.` },
  table({
    columns: ['Frage', 'Messung'],
    rows: [
      ['Zahlen', `F32x2 statt binary64: \`${f32[0].core}\` ergibt ${f32[0].nativeF32x2}, \`${f32[1].core}\` ist ${f32[1].nativeF32x2 ? 'wahr' : 'falsch'} (JS: ${f32[1].jsDouble ? 'wahr' : 'falsch'}). FS-Arithmetik lässt sich nicht bitgleich nachbilden.`],
      ['Compile-Kosten', `Sprache plus Kern: Bend → C ${fmt.num(buildC.wallMs / 1000, 1)}${NB}s, clang ${fmt.num(buildClang.wallMs / 1000, 1)}${NB}s, ${fmt.num(buildC.maxRssBytes / 1e9, 2)}${NB}GB RSS. Keine separate Kompilierung, kein Library-Modus.`],
      ['Tempo', `frame-with-tab durch die Sprache ${sec(fwtKernel.summary.coreEvalMs)}, direkt ${sec(fwtKernel.summary.directKernelMs)}. Der Auswerter kostet nichts, bringt aber auch nichts.`],
      ['Was hineingehört', `ein kleiner Graph-Auswerter erster Ordnung (${evalLines} Zeilen), ohne Fuel, bitgleich über ${evalThreads[0]} bis ${evalThreads.at(-1)} Threads`],
    ],
    src: [S.bendRun, S.bendDoc, S.decision],
  }),
  callout('entscheidung', 'Kein FS- oder Python-Interpreter und kein Parser in Bend', p('FS-Wertarithmetik bleibt binary64 auf dem Host. Nur Kernel-Arbeit und kernabhängige Werte werden Knoten im Graphen. F32x2 entscheidet nie über Kontrollfluss.'), { src: S.decision }),
);

// ── 7. the spike on a real part ──────────────────────────────────────────────
const gateLabel = { washers: 'washers (Gate-Teil)' };
// chain.json is re-run by the spike workflow with varying sizes: build every sentence from rows that exist.
const chainToday = chain.rows.filter((r) => r.kind === 'today');
const chainNative = chain.rows.filter((r) => r.kind === 'native');
const chainSizes = [...new Set(chain.rows.filter((r) => r.status === 'ok' && r.modelBytes).map((r) => r.n))].sort((a, b) => a - b);
const chainOk = chainSizes.map((n) => chain.rows.find((r) => r.n === n && r.status === 'ok' && r.modelBytes && r.kind === 'today') ?? chain.rows.find((r) => r.n === n && r.status === 'ok' && r.modelBytes));
const chainTodayFail = chainToday.find((r) => r.status === 'error');
const chainTodayCrash = chainToday.find((r) => r.status === 'crash');
const chainNativeFail = chainNative.find((r) => r.status !== 'ok');
const chainNativeMax = chainNative.filter((r) => r.nativeEvalMs != null).at(-1);
// The re-run in chain.json may skip sizes; the spike report states where today's build breaks.
const chainDoc = grab(S.spikeDoc, /Eine Platte mit (\d+) Löchern, je ein `opBoolean`, kann der heutige Build nicht mehr exportieren \(V8-Stringgrenze\), bei (\d+) stürzt er ab \(Heap\)/);
const chainSub = [
  'Identity- und Evidence-Labels wachsen etwa mit N³; die Größe ist auf beiden Pfaden praktisch gleich.',
  !chainTodayFail && !chainTodayCrash && `Laut Spike-Bericht kann der heutige Build ab N = ${chainDoc[1]} nicht mehr exportieren (V8-Stringgrenze), bei N = ${chainDoc[2]} stürzt er ab (Heap).`,
  chainTodayFail && `Heute scheitert bei N = ${chainTodayFail.n} der Export (${chainTodayFail.error?.message ?? chainTodayFail.status}).`,
  chainTodayCrash && `Bei N = ${chainTodayCrash.n} stürzt der heutige Build ab (${chainTodayCrash.signal ?? 'Absturz'}).`,
  chainNativeFail && `Der WK-Pfad hält bei N = ${chainNativeFail.n} mit einem expliziten Capability-Fehler an${/identity replay/.test(chainNativeFail.error?.message ?? '') ? ', und zwar im Host-Replay der Identity-Labels' : ''}.`,
  chainNativeMax && `Die native Auswertung ist nicht die Grenze: bei N = ${chainNativeMax.n} braucht sie ${fmt.num(chainNativeMax.nativeEvalMs, 0)}${NB}ms.`,
].filter(Boolean).join(' ');

/** Dashed threshold tick on every bar track of a lib barChart (rows are 44 px, bars at +20..+34). */
const withThreshold = (html, value, max, rows) => {
  const x = `${((value / max) * 100).toFixed(3)}%`;
  const ticks = Array.from({ length: rows }, (_, i) => `<line x1="${x}" x2="${x}" y1="${i * 44 + 16}" y2="${i * 44 + 38}" class="thr"/>`).join('');
  return html.replace('</svg>', `${ticks}</svg>`);
};
const gateData = Object.entries(spike).map(([id, w]) => {
  const g = gateStats[id];
  return {
    label: gateLabel[id] ?? id,
    value: w.gateRatio,
    highlight: Boolean(g?.robust),
    note: g
      ? `${g.pass}/${g.n} Wdh. ≥ ${fmt.num(GATE, 1)} · ${fmt.num(g.min, 2)} bis ${fmt.num(g.max, 2)}`
      : [w.costBound === 1 && 'Kette', new RegExp(`${id} ran during a load burst`).test(flat(S.spikeNotes)) && 'Lastschub', 'ohne Wdh.'].filter(Boolean).join(' · '),
    kind: 'gemessen',
  };
});
const mainLoad = grab(S.spikeNotes, /Warm evaluation in ms \(.*?\)\. Fix round 3, load (\d+) to (\d+)\./);
const gateMax = Math.ceil(Math.max(...gateData.map((d) => d.value)) / 0.8);
const gateChart = withThreshold(barChart({
  title: 'Fork-Join-Gewinn je Teil: Gate-Quote W_best / T4',
  sub: `Beste serielle Ausführung ÷ Fork bei 4 Threads (die kleinere von Median- und Mittelwert-Quote). Balken: Hauptlauf wie im Spike-Bericht §1. Gestrichelt: Schwelle ${fmt.num(GATE, 1)}. Blau: in allen Wiederholungen ≥ ${fmt.num(GATE, 1)}, also robust. washers ist das einzige echte Teil, das heute ganz baut; die drei anderen Teile sind Teilgraphen echter Mehrteil-Modelle, frame-with-tab ist eine Fixture${spike['frame-with-tab']?.costBound === 1 ? ' und eine Kette ohne Parallelität (Kostenschranke 1)' : ''}${/frame-with-tab ran during a load burst/.test(flat(S.spikeNotes)) ? ', gemessen in einem Lastschub' : ''}. Load ${mainLoad[1]} bis ${mainLoad[2]} im Hauptlauf, ${gateLoad[0]} bis ${gateLoad[1]} in den Wiederholungen: indikativ.`,
  data: gateData,
  max: gateMax,
  format: (v) => fmt.num(v, 2),
  src: [S.spike, S.gateRuns, S.spikeNotes],
}), GATE, gateMax, gateData.length);

const s7 = section(
  { title: `Spike ${deDate(spikeDate)}: ein echtes Teil als Graph`, note: 'Die riskanteste Behauptung wurde gebaut und gemessen: ein aufgezeichneter WK/0-Graph eines echten Teils, nativ in Bend ausgewertet.' },
  grid(
    callout('gemessen', 'Treue und Korrektheit: bestätigt', ul([
      'Recorder im unveränderten Parser und Interpreter',
      `${buildsOne[2]}, frame-with-tab und ${regressionPrograms} Regressionsprogramme: das native Modell ist **byte-gleich** zum heutigen Build`,
      dualLine,
    ]), { src: S.spikeDoc }),
    callout('fehlgeschlagen', `Fork-Join ≥ ${fmt.num(GATE, 1)}x: auf dem Gate-Teil widerlegt`, ul([
      `${buildsOne[2]}: Gate-Quote ${fmt.num(gw.gateRatio, 2)}, in ${gws.pass} von ${gws.n} Wiederholungen erreicht (${fmt.num(gws.min, 2)} bis ${fmt.num(gws.max, 2)}); alle ${washersNodes} Knoten kosten zusammen ${fmt.num(gw.workMs, 2)}${NB}ms`,
      `nur dual-hardware besteht robust (${fmt.num(dual.gateRatio, 2)}, ${gateStats['dual-hardware'].pass} von ${gateStats['dual-hardware'].n}), spart aber nur etwa ${fmt.num(dualSaveMs, 1)}${NB}ms pro Build`,
      '**Entscheidung nach Regel: kein `run_graph`**',
    ]), { src: [S.spike, S.gateRuns, S.spikeDoc] }),
  ),
  gateChart,
  callout('fehlgeschlagen', 'Der eigentliche Engpass: Kernfähigkeit', p(`Von ${buildsOne[1]} geprüften Korpus-Features baut heute genau eines (${buildsOne[2]}). Die Blocker sind PIERCE-Zulassung, Booleans ohne passende Methode und das fehlende \`opTransform\`. Schon der Schiedsspruch fand: von ${planar[1]} Features mit reiner Boolean-Schwerarbeit sind nur ${planar[2]} rein planar.`), { src: [S.spikeDoc, S.decision] }),
  barChart({
    title: 'Platte mit N Löchern: Größe des exportierten Modell-JSON',
    sub: `${chainSub} Load ${loadRange([chain.loadStart, chain.loadEnd])[0]} bis ${loadRange([chain.loadStart, chain.loadEnd])[1]}: Zeiten indikativ, Größen exakt.`,
    data: chainOk.map((r) => ({ label: `N = ${r.n}`, value: r.modelBytes / 1e6, kind: 'gemessen' })),
    format: (v) => `${fmt.auto(v)} MB`,
    src: [S.chain, S.spikeDoc],
  }),
);

// ── 8. open / next steps ─────────────────────────────────────────────────────
// Stand after the spike: step 1 from the spike report, steps 0 and 3 from the morning report and the Boolean plan.
const STAND = {
  0: { word: 'läuft', note: `planarer Binding-Slice mit ${slice[1]} Einstiegen committet; der Hybrid-Boolean ist entschieden (\`${planCommit}\`), die ersten Plan-Schritte laufen, ${booleanPlanProd ? 'noch nicht in Produktion' : 'Status siehe Plan'}` },
  1: { word: `erledigt ${deDate(spikeDate).slice(0, 6)}`, note: 'kein `run_graph`, siehe Spike-Abschnitt oben' },
  3: { word: 'teils erledigt', note: `der Frontend-Sweep W1 ist committet (\`${w1Commit}\`) und deckt ${sweepTopics[2]} ab; Parser-Cluster ${w1Parser[1]} → ${w1Parser[2]} Units` },
  6: { word: 'gesperrt' },
};
const standTone = (st) => (/^erledigt|^läuft/.test(st) ? 'yes' : /gesperrt/.test(st) ? 'no' : st === 'nie' ? 'never' : 'split');
const stepsLedger = (rows) =>
  `<div class="claims steps">${rows
    .map(([n, step, gives, , gate]) => {
      const { word: stand, note } = STAND[n] ?? { word: n === 'nie' ? 'nie' : 'offen' };
      const meta = [gives && `liefert: ${gives}`, gate && `Gate: ${gate}`].filter(Boolean).join(' · ');
      const why = meta || note ? `<span class="c-why">${inline(meta)}${note ? `<span class="c-note">${inline(note)}</span>` : ''}</span>` : '';
      return `<div class="claim"><span class="c-id">${esc(n === 'nie' ? '–' : n)}</span><span class="c-text">${inline(stepText(step))}</span><span class="c-verdict c-${standTone(stand)}">${esc(stand)}</span>${why}</div>`;
    })
    .join('')}</div>`;
const stepText = (step) => {
  const head = firstBold(step).replace(/:$/, '');
  const rest = step.replace(/^\*\*[^*]+\*\*:?\s*/, '');
  return rest && rest !== step && rest.length <= 90 ? `**${head}**: ${rest}` : `**${head}**`;
};
const s8 = section(
  { title: 'Offen / nächste Schritte', note: 'Erst was offen ist, dann der Plan des Schiedsspruchs mit dem Stand nach dem Spike. Jeder Schritt ist einzeln auslieferbar; der Default bleibt der heutige Pfad.' },
  grid(
    { wide: true },
    callout('offen', 'Kernfähigkeit vor Ausführungsform', p(`PIERCE-Zulassung für Ziele, die kein planares Prisma sind, die NONE-Fälle, \`opTransform\`, danach \`skText\` und Line/Arc-Skizzen. Ohne sie baut kein echtes Zylinderteil nativ; dazu braucht das Binding die ${bridgeEntries[1]}-Einstiege (${bridgeEntries[2]}). Die Korpus-Triage kommt unabhängig zum selben Schluss: fehlende Builtins wie \`opTransform\` blockieren dort ${triageBuiltins} Dateien.`), { src: [S.spikeDoc, S.morning] }),
    callout('offen', 'Identity inhaltsadressiert machen', p('Gehashte Instance-IDs und Evidence, die ihre Eingänge über die Revision referenziert. Sonst sind lange Boolean-Ketten (Platten mit vielen Löchern) auf keinem Pfad modellierbar.'), { src: S.spikeDoc }),
    callout('offen', 'LLM-Studie: ungemessen', p(`Ob ein Python-Dialekt (WPy) oder die Graph-Textform LLMs messbar besser macht, ist offen. Geplant: ${studyParts[1]} bis ${studyParts[2]} Teile aus Marcs Familien, ${studyConds} Bedingungen. WPy nur, wenn es mindestens gleichauf mit build123d liegt.`), { src: S.decision }),
    callout('offen', 'Zwei Nacharbeiten aus W1 und W5 für den Sprach-Workflow', p('W1 hat `try` an Onshape angeglichen: Es fängt nur noch echte FeatureScript-Ausnahmen. Zwei Tests des Sprach-Workflows prüfen noch das alte Verhalten; der WK-Replay baut einen Fehler als gewöhnlichen `FeatureScriptError` nach, den `try` nicht mehr fängt. W5 hat den Ergebnis-Vertrag für Python eingeführt; der Tracer in `src/lang/dataflow/py-trace.mjs` soll dafür `outputs` statt `handle` lesen.'), { src: [S.w1, S.w5] }),
    callout('geschätzt', `≥ ${breakTarget}${NB}% ohne Break: projiziert`, p(`Der Recorder mit \`select\`/\`expect\`-Idiomen soll mindestens ${breakTarget}${NB}% der verarbeitbaren FS-Dateien ohne Break erreichen. Das ist projiziert, nicht gemessen; Schritt 2 misst es. \`run_graph\` wird neu bewertet, wenn ein echtes Teil nativ baut und mindestens ${recheck}${NB}ms Kernarbeit über unabhängige Komponenten verteilt.`), { src: [S.decision, S.spikeDoc] }),
  ),
  '<h3 class="plan-h">Der Plan, Schritt für Schritt</h3>',
  stepsLedger(steps),
  source(S.decision, S.spikeDoc, S.morning, S.booleanPlan, S.w1, 'git log'),
  details('Entscheidungstrigger: was die Reihenfolge ändern würde', table({ columns: ['Beobachtung', 'Folge'], rows: triggers, src: S.decision })),
  details('Grenzen dieser Zahlen', ul([
    `Alle Zeiten stammen von einer geteilten Maschine (Load ${measLoad[1]} bis ${measLoad[2]} in den Quellmessungen des Schiedsspruchs, ${spikeLoad[1]} bis ${spikeLoad[2]} im Spike, Fix-Runde 3) und sind indikativ. Hashes, Volumenwörter, Op-Folgen und Zählungen sind exakt.`,
    ...(tableWashersGate && tableWashersGate !== fmt.num(gw.gateRatio, 2)
      ? [`Die Gate-Zahlen hier folgen den Rohdaten und §1 des Spike-Berichts (Fix-Runde 3: washers ${fmt.num(gw.gateRatio, 2)}, dual-hardware ${fmt.num(dual.gateRatio, 2)}). Die Tabelle in §6.2 und der Text in §12 des Berichts zeigen noch die Werte der Fix-Runde 2 (washers ${tableWashersGate}). Beide Fassungen verwerfen \`run_graph\`.`]
      : []),
    `Jede Änderung am nativen Auswerter kostet ${evalRebuild[1]} bis ${evalRebuild[2]}${NB}s und bis zu ${evalRebuild[3]}${NB}GB.`,
    'Die Korpus-Stufen sind statisch gezählt; die WK-Abdeckung ist dynamisch (jede Datei gestaged).',
    'Die LLM-Zahlen stammen aus Arbeiten mit anderen Modellen und Datensätzen; sie zeigen Richtungen, keine übertragbaren Werte.',
    'Nur ein echtes Teil baut heute vollständig, und es ist klein. Die Mehrteil-Aussagen stammen aus Teilgraphen.',
  ])),
);

// ── 9. sources ───────────────────────────────────────────────────────────────
// Paths break after a slash on phones, never inside a file name (same rule as lib source()).
const pathBreaks = (html) => html.replace(/<code>([^<]*)<\/code>/g, (_, c) => `<code>${c.replaceAll('/', '/<wbr>')}</code>`);
const s9 = section(
  'Quellen',
  `<div class="quellen">${pathBreaks(table({
    columns: ['Datei', 'Inhalt'],
    rows: [
      [`\`${S.decision}\``, `Schiedsspruch und Plan, Stand ${deDate(decisionDate)}`],
      [`\`${S.spikeDoc}\``, `Spike auf echtem Teil, Stand ${deDate(spikeDate)}, ${spikeRounds}`],
      [`\`${S.spikeNotes}\``, 'englische Aufbau-Notizen zum Spike (Gate-Tabelle der Fix-Runde 3, Lastschub bei frame-with-tab)'],
      [`\`${S.spike}\`, \`${S.gateRuns}\`, \`${S.washers}\`, \`${S.chain}\``, 'Gate-Quoten und Wiederholungen, Gate-Teil, Boolean-Ketten (Rohdaten)'],
      [`\`${S.corpus}\``, 'statischer Scan von Marcs Korpus (FS und build123d)'],
      [`\`${S.corpusDoc}\``, 'Korpus-Kapitel: Stufen, Prädikate, Vokabular'],
      [`\`${S.census}\``, 'FS-Korpus dynamisch als WK-Graph gestaged'],
      [`\`${S.priorArt}\``, 'Prior Art (KCL u. a.) und LLM-Literatur'],
      [`\`${S.verbosity}\``, 'L-Winkel in vier Sprachen'],
      [`\`${S.bendDoc}\`, \`${S.bendRun}\``, 'Bend-Machbarkeit: Sprache nativ, Tempo, Zahlen, Compile'],
      [`\`${S.profileDoc}\`, \`${S.profile}\``, 'Wall-Zeit-Profil des heutigen JS-Pfads'],
      ['`docs/language/proposal-core-ir.md`, `proposal-dataflow.md`, `proposal-surface.md`', 'die drei Vorschläge (WK/0, WGraph, WPy)'],
      [`\`${S.morning}\`, \`${S.booleanPlan}\``, 'Stand des kritischen Pfads: Binding-Slice, Frontend-Sweep W1, Hybrid-Boolean-Plan'],
      [`\`${S.w1}\`, \`${S.w5}\``, 'W1 und W5 (committet): Parser-Cluster, zwei Nacharbeiten für den Sprach-Workflow'],
    ],
  }))}</div>`,
);

// ── page ─────────────────────────────────────────────────────────────────────
let html = page({
  title: 'Eigene Sprache? Die Entscheidung',
  kicker: 'wonky · Bericht · Sprache',
  date: deDate(spikeDate),
  meta: [
    ['Frage', 'Eine eigene CAD-Sprache für wonky, nativ in Bend?'],
    ['Schiedsspruch', `\`docs/language.md\`, ${deDate(decisionDate)}`],
    ['Spike echtes Teil', `\`docs/language/spike-real-model.md\`, ${deDate(spikeDate)}`],
    ['Messbedingungen', 'geteilte Maschine: Zeiten indikativ, Hashes exakt'],
  ],
  sections: [lead, s1, s2, s3, s4, s5, s6, s7, s8, s9],
});

// Page-specific CSS into <head>; table of contents after the lead block.
html = html.replace('</style>', `${EXTRA_CSS}</style>`);
const toc = html.match(/<nav class="toc"[\s\S]*?<\/nav>\n?/)?.[0];
if (toc) html = html.replace(toc, '').replace('<!--/lead-->', `<!--/lead-->\n${toc}`);

writeReport('language.html', html);
