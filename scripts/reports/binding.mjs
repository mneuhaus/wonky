
if (!(await import('node:fs')).existsSync(new URL('../../var/site/development-record.md', import.meta.url))) {
  console.log('local-only historical report input absent; report omitted');
  process.exit(0);
}
// Builds out/reports/binding.html: "Kernel nativ: das C-Extension-Binding".
//   node scripts/reports/binding.mjs
//
// Every number comes from the native-bridge artefacts (out/native-bridge/**) or is
// parsed from the German/English reports in docs/ (need()/mdBlock() throw when a
// source no longer says what the report quotes, so a stale report fails loudly).
// Two chart forms are local to this report: a log-axis dumbbell (JS → nativ per
// workload / per kernel entry) and a <pre> command block. Both reuse lib.mjs classes.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  page, section, p, ul, tiles, grid, card, callout, table, details, barChart, stackedBar, diagram,
  fmt, readJson, esc, inline, source, REPO, writeReport, assertPublicSafe,
} from './lib.mjs';

// ── sources ──────────────────────────────────────────────────────────────────
const SRC = {
  bench: 'out/native-bridge/slice/bench.json',
  profile: 'out/native-bridge/profile/summary.json',
  analysis: 'out/native-bridge/profile/analysis/',
  full: 'out/native-bridge/slice/full-surface-build.json',
  churn: 'out/native-bridge/slice/churn.json',
  surface: 'src/native/surface.json',
  decision: 'docs/native-bridge.md',
  slice: 'docs/native-bridge/slice.md',
  proto: 'docs/native-bridge/prototype.md',
  binding: 'docs/native-bridge/binding.md',
  morning: 'var/site/development-record.md',
};

// ── markdown / text helpers (fail loudly when a quoted source changed) ──────
const docCache = new Map();
const doc = (rel) => docCache.get(rel) ?? docCache.set(rel, readFileSync(join(REPO, rel), 'utf8')).get(rel);
const flat = (s) => s.replace(/\s+/g, ' ');
function need(rel, re) {
  const m = flat(doc(rel)).match(re);
  if (!m) throw new Error(`binding report: ${rel} no longer matches ${re}; update the report`);
  return m;
}
function mustContain(rel, ...snippets) {
  const text = flat(doc(rel));
  for (const s of snippets) if (!text.includes(s)) throw new Error(`binding report: ${rel} no longer contains "${s}"; update the report`);
}
const deNum = (s) => Number(String(s).replace(/\./g, '').replace(',', '.'));
/** Lines after `heading` up to the next heading of the same or a higher level. */
function mdBlock(rel, heading) {
  const lines = doc(rel).split('\n');
  const i = lines.findIndex((l) => l.trim() === heading);
  if (i < 0) throw new Error(`binding report: heading "${heading}" not found in ${rel}`);
  const level = heading.match(/^#+/)[0].length;
  let j = i + 1;
  while (j < lines.length && !(/^#+ /.test(lines[j]) && lines[j].match(/^#+/)[0].length <= level)) j++;
  return lines.slice(i + 1, j).join('\n');
}
const unlink = (s) => s.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
function mdTable(block) {
  const rows = block.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('|'));
  const cells = rows.map((r) => r.replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map((c) => unlink(c.trim().replace(/\\\|/g, '|'))));
  return { head: cells[0], rows: cells.slice(2) };
}
function mdNumbered(block) {
  const items = [];
  for (const line of block.split('\n')) {
    const m = line.match(/^\d+\.\s+(.*)$/);
    if (m) items.push(m[1]);
    else if (items.length && /^\s+\S/.test(line)) items[items.length - 1] += ` ${line.trim()}`;
  }
  return items.map(unlink);
}

const sum = (xs) => xs.reduce((a, b) => a + b, 0);
/** Small counts as words in running German text ("sechs Workloads"). */
const zahlwort = (n) => ['null', 'ein', 'zwei', 'drei', 'vier', 'fünf', 'sechs', 'sieben', 'acht', 'neun', 'zehn', 'elf', 'zwölf'][n] ?? fmt.num(n);
const range = (xs, f = (v) => fmt.num(v, 0)) => {
  const lo = Math.min(...xs), hi = Math.max(...xs);
  return f(lo) === f(hi) ? f(lo) : `${f(lo)}–${f(hi)}`;
};
const mb = (n) => `${fmt.num(n / 1e6, 2)} MB`; // decimal MB, as in docs/native-bridge/slice.md
const berlin = (iso) => new Date(iso).toLocaleString('de-DE', { timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

// ── data ─────────────────────────────────────────────────────────────────────
const bench = readJson(SRC.bench);
const profile = readJson(SRC.profile);
const full = readJson(SRC.full);
const churn = readJson(SRC.churn);
const surface = readJson(SRC.surface);

const W = Object.entries(bench.workloads).map(([id, w]) => ({ id, ...w }));
const cmp = new Map(bench.comparison.map((c) => [c.id, c]));
const factors = W.map((w) => w.wall.factor);
const buildId = bench.build.sourceHash.slice(0, 12);
const sliceOps = bench.build.ops;
const nRuns = W[0].samples.length;
if (W.some((w) => w.samples.length !== nRuns || w.wall.js.ms.length !== nRuns)) throw new Error('binding report: workloads have different sample counts');

const loads = [];
const addLoad = (r) => r?.load && loads.push(r.load.before?.one, r.load.after?.one);
for (const w of W) {
  for (const s of w.samples) { addLoad(s.js); addLoad(s.native); }
  [w.nativeTraced, w.jsTraced, w.diff, w.threads6].forEach(addLoad);
}
Object.values(bench.negative).forEach(addLoad);
const benchLoad = range(loads.filter((v) => v != null), (v) => fmt.num(v, 0));

// byte-identity: 3 native samples + traced + 6-thread + diff run per workload
const identityChecks = W.flatMap((w) => [...w.samples.map((s) => s.correctness.identical), w.nativeTraced.correctness.identical, w.threads6.correctness.identical, w.diff.correctness.identical]);
const identicalRuns = identityChecks.filter(Boolean).length;
const comparedCalls = sum(W.map((w) => w.diff.comparedCalls));
const comparedWords = sum(W.map((w) => w.diff.comparedWords));
const divergences = sum(W.map((w) => w.diff.divergences + w.diff.divergencesInTrace));
const countsMatch = W.every((w) => w.diff.countsMatchProfile && w.diff.countsMatchCountRun);

const coldNative = W.map((w) => w.nativeTraced.buckets.coldStartToKernelReadyMs);
const coldJs = W.map((w) => w.jsTraced.buckets.coldStartToKernelReadyMs);
const staleTotals = W.map((w) => w.nativeTraced.staleCheck.totalMs);
const t6 = W.map((w) => ({ id: w.id, gain: w.wall.native.medianMs / w.threads6.wallMs }));
const t6Bool = t6.filter((t) => t.id !== 'fs-bracket');
const guards = W.map((w) => w.nativeTraced.guard);
const guardClean = guards.every((g) => g.dataUrls === 0 && g.compiler === 0 && g.bendImports === 0 && g.jsKernel === false);

// surface.json was re-generated after the bench (W2, then the R20 gate, which also moved it to
// the tracked src/native/; docs/native-bridge/slice.md, "Re-Baseline W2" and "R20-Gate"). The
// bench, the full-surface build and the slice belong to the scan before the first rescan, so the
// coverage numbers use that count; the newest one is named in "Seit dieser Messung" and must be
// today's.
const rescans = [...doc(SRC.slice).replace(/\s+/g, ' ').matchAll(/\*\*`(?:out\/native-bridge|src\/native)\/surface\.json` neu erzeugt\*\* \(`surface-scan\.mjs`\): (\d+) Produktionseinstiege statt (\d+)/g)];
const rescan = rescans.length ? [null, rescans.at(-1)[1], rescans[0][2]] : null;
if (rescan && Number(rescan[1]) !== surface.counts.productionEntries) throw new Error(`binding report: ${SRC.surface} has ${surface.counts.productionEntries} production entries, ${SRC.slice} says ${rescan[1]}; update the report`);
const productionEntries = rescan ? Number(rescan[2]) : surface.counts.productionEntries;
const hostRoundTrip = surface.generatorEvidence.closure.replay.resultRealsThroughHostRoundTrip;

// earlier benches and machine, quoted from the German slice report
const earlier = need(SRC.slice, /frühere Benches: ([\d,]+) bis ([\d,]+)x bei Load (\d+) bis (\d+), ([\d,]+) bis ([\d,]+)x bei (\d+) bis (\d+)/);
const machine = need(SRC.slice, /Bend ([\d.]+), (Apple M\d+ \w+) \((\d+) logische CPUs\)/);
const cpus = machine[3];
const callFloor = need(SRC.binding, /\*\*Aufruf-Overhead:\*\* ([\d,]+ µs) p50/)[1];
const inputFiles = need(SRC.proto, /routing, wiring, (\d+) input files/)[1];
const testsLine = need(SRC.morning, /Tests: (\d+)\/(\d+) native-bridge/);
const sliceTests = need(SRC.slice, /Laute Fehler \(test\/native-bridge-slice\.test\.mjs, (\d+) Tests, alle grün\)/)[1];
const nextProjection = need(SRC.decision, /projiziert ([\d,]+) bis ([\d,]+)x auf allen Nicht-r10b-Workloads/);
mustContain(SRC.decision, 'CLI-Flag `--backend`');
// The morning report quoted the first bench (load 13 to 15); this report shows the latest one.
const morningRange = need(SRC.morning, /Ende-zu-Ende mit einem Thread gemessen ([\d,]+)- bis ([\d,]+)-mal schneller/);
need(SRC.slice, /der erste Bench bei 13 bis 15/);
if (morningRange[1] !== earlier[5] || morningRange[2] !== earlier[6]) throw new Error('binding report: the morning report no longer quotes the first bench; update the note');
const commit = need(SRC.morning, /`([0-9a-f]{7})`: Natives Binding/)[1];
// Context from the corpus triage: speed is not what blocks Marc's real parts today.
const triage = {
  files: need(SRC.morning, /alle ([\d.]+) eindeutigen Modelldateien/)[1],
  builds: need(SRC.morning, /Davon baut heute genau (\d+) Datei/)[1],
  medianFail: need(SRC.morning, /Der Median scheitert nach ([\d,]+) s/)[1],
  frontendShare: need(SRC.morning, /(\d+) % der Units scheitern schon im Frontend/)[1],
};

// ── profile: where the time goes today (JS path) ────────────────────────────
const BUCKETS = [
  { key: 'kern', label: 'Kern (Bend)' },
  { key: 'bend', label: 'Bend-JS-Kernel laden' },
  { key: 'fe', label: 'Frontend + Host' },
  { key: 'rest', label: 'Start, Export, sonstige', neutral: true },
];
const profRows = profile.table.map((r) => {
  const a = readJson(`${SRC.analysis}${r.id}.json`);
  const b = a.analysis.bucketsAttributedMs;
  const values = {
    kern: b.kernel,
    bend: b.bendLoad,
    fe: b.frontendParse + b.interpreter + b.hostAdaptation,
    rest: b.processStart + b.moduleLoading + b.export + b.program + b.nodeRuntime + b.other + b.gc + b.idle,
  };
  const total = sum(Object.values(values));
  const loadsP = [a.runs.profile.load1Before, a.runs.profile.load1After, ...a.runs.plain.flatMap((pl) => [pl.load1Before, pl.load1After])];
  return { id: r.id, values, total, share: (k) => values[k] / total, loads: loadsP, inSlice: cmp.has(r.id) };
});
profRows.sort((a, b) => b.share('kern') - a.share('kern'));
const heavy = profRows.filter((r) => profile.headline.kernelHeavy.includes(r.id));
const light = profRows.filter((r) => profile.headline.startupDominated.includes(r.id));
const feMax = Math.max(...profRows.map((r) => r.share('fe')));
const profLoad = range(profRows.flatMap((r) => r.loads), (v) => fmt.num(v, 1));
const bendLoadMs = profile.headline.bendLoadMsAllRuns;
const jsCacheCheckMs = profile.startupPhases.median.fingerprintAndReadMs;

// Same row order as the JS chart above, so each workload sits at the same height in both.
const profOrder = profRows.map((r) => r.id);
const nativeRows = W.map((w) => {
  const b = w.nativeTraced.buckets;
  return {
    label: w.id,
    values: { kern: b.kernelMs, bend: 0, fe: b.frontendHostMs, rest: b.coldStartToKernelReadyMs + b.exportMs + b.processOverheadMs },
  };
}).sort((a, b) => profOrder.indexOf(a.label) - profOrder.indexOf(b.label));
// kernel bucket JS-target (instrumented count run) over native (call + encode + decode), Boolean workloads only
const kernGain = W.filter((w) => w.id !== 'fs-bracket').map((w) => w.jsTraced.buckets.kernelMs / w.nativeTraced.buckets.kernelMs);

/** Stacked-bar values: an empty bucket reads "0", not "0,00 ms". */
const msOrZero = (v) => (v === 0 ? '0' : fmt.ms(v));
/** Durations for chart labels: 0,28 ms · 4,6 ms · 73 ms · 1,87 s · 15,2 s. */
const dur = (ms) => (ms >= 1000 ? `${fmt.num(ms / 1000, ms >= 10000 ? 1 : 2)} s` : ms >= 10 ? `${fmt.num(ms, 0)} ms` : ms >= 1 ? `${fmt.num(ms, 1)} ms` : `${fmt.num(ms, 2)} ms`);

// ── custom chart: dumbbell on a log axis ─────────────────────────────────────
let dbSeq = 0;
const tickLabel = (ms) => (ms >= 1000 ? `${fmt.num(ms / 1000, 0)} s` : ms >= 1 ? `${fmt.num(ms, 0)} ms` : `${fmt.num(ms, 1)} ms`);
/**
 * rows: [{label, note?, a, b, factor?, tip}] — a = JS-Target (gray), b = nativ (blue).
 * Log x axis over [lo, hi]; equal distance = equal factor. Values are labelled
 * on the outside of each pair; the factor sits right-aligned on the label line.
 */
function dumbbell({ title, sub, rows, lo, hi, ticks, labels, tableHtml, src }) {
  dbSeq++;
  const L = Math.log(hi / lo);
  const pos = (v) => (Math.log(v / lo) / L) * 100;
  const rowH = 46, top = 4, axisBand = 22;
  const H = top + rows.length * rowH + axisBand;
  const grid = ticks.map((t) => `<line x1="${pos(t).toFixed(3)}%" x2="${pos(t).toFixed(3)}%" y1="${top}" y2="${H - axisBand + 2}" class="bd-grid"/><text x="${pos(t).toFixed(3)}%" y="${H - 5}" text-anchor="middle" class="bd-tick">${esc(tickLabel(t))}</text>`);
  const body = rows.map((r, i) => {
    const y = top + i * rowH;
    const cy = y + 31;
    const pa = pos(r.a), pb = pos(r.b);
    const faster = r.b < r.a;
    // A row may carry the source's own factor (bench.json rounds it to two places); re-deriving it
    // from the medians could round differently at one place and contradict the tiles above.
    const ratio = r.factor ?? (faster ? r.a / r.b : r.b / r.a);
    const fTxt = `${fmt.num(ratio, 1)}× ${faster ? 'schneller' : 'langsamer'}`;
    const [left, right] = pa < pb ? [{ p: pa, v: r.a, cls: 't-value t-muted' }, { p: pb, v: r.b, cls: 't-value' }] : [{ p: pb, v: r.b, cls: 't-value' }, { p: pa, v: r.a, cls: 't-value t-muted' }];
    return `<g class="row"><title>${esc(r.tip)}</title><rect x="0" y="${y}" width="100%" height="${rowH}" class="hit"/>`
      // The note is hidden on narrow screens (CSS below): a long label plus note would run into the factor.
      + `<text x="0" y="${y + 13}" class="t-label">${esc(r.label)}${r.note ? `<tspan class="t-muted bd-note"> · ${esc(r.note)}</tspan>` : ''}</text>`
      + `<text x="100%" y="${y + 13}" text-anchor="end" class="t-delta ${faster ? 'good' : 'bad'}">${esc(fTxt)}</text>`
      + `<line x1="${pa.toFixed(3)}%" x2="${pb.toFixed(3)}%" y1="${cy}" y2="${cy}" class="bd-link"/>`
      + `<circle cx="${pa.toFixed(3)}%" cy="${cy}" r="5.5" class="f-n bd-dot"/><circle cx="${pb.toFixed(3)}%" cy="${cy}" r="5.5" class="f-s1 bd-dot"/>`
      + `<text x="${left.p.toFixed(3)}%" dx="-10" y="${cy + 4}" text-anchor="end" class="${left.cls}">${esc(dur(left.v))}</text>`
      + `<text x="${right.p.toFixed(3)}%" dx="10" y="${cy + 4}" class="${right.cls}">${esc(dur(right.v))}</text></g>`;
  });
  const svg = `<svg class="hchart bd-db" width="100%" height="${H}" role="img" aria-label="${esc(title)}">${grid.join('')}${body.join('')}</svg>`;
  const legend = `<ul class="legend"><li><i class="sw f-n bd-round" aria-hidden="true"></i>${inline(labels.a)}</li><li><i class="sw f-s1 bd-round" aria-hidden="true"></i>${inline(labels.b)}</li></ul>`;
  return `<figure class="chart"><figcaption><strong>${inline(title)}</strong>${sub ? `<span>${inline(sub)}</span>` : ''}</figcaption>${legend}${svg}${tableHtml ? details('Werte als Tabelle', tableHtml) : ''}${source(...[src].flat())}</figure>`;
}

/** Shell block; `# …` comments (whole line or trailing) are muted. wrap: true soft-wraps long output lines. */
const pre = (lines, { wrap = false } = {}) => `<pre class="bd-pre${wrap ? ' bd-wrap' : ''}"><code>${lines.map((l) => {
  const i = l.startsWith('#') ? 0 : l.indexOf(' #');
  return i >= 0 ? `${esc(l.slice(0, i))}<span class="c">${esc(l.slice(i))}</span>` : esc(l);
}).join('\n')}</code></pre>`;

// ── header: Kurzfassung + key numbers ───────────────────────────────────────
const kurz = `Der planare Teil des Bend-Kernels läuft jetzt als C-Extension (N-API-Addon) im Node-Prozess; die Frontends für FeatureScript und build123d bleiben in JS. `
  + `Auf den ${zahlwort(W.length)} planaren Bench-Workloads ist ein Lauf ${fmt.num(Math.min(...factors), 1)}- bis ${fmt.num(Math.max(...factors), 1)}-mal schneller, mit byte-identischen Ausgaben; `
  + `alles außerhalb der ${sliceOps} nativen Einstiege, etwa jedes gekrümmte Modell, bricht laut ab, statt still auf JS zurückzufallen.`;

// Four tiles: an even 4 × 1 row on desktop and 2 × 2 on a phone.
const header = `<div class="bd-summary"><span class="tb-k">Kurzfassung</span><p class="lede">${inline(kurz)}</p></div>`
  + tiles([
    { label: 'Ende-zu-Ende schneller', value: range(factors, (v) => fmt.num(v, 1)), unit: '×', note: `${W.length} Workloads, 1 Thread, Median aus ${nRuns} frischen Prozessen`, kind: 'gemessen' },
    { label: 'Kernaufrufe Wort für Wort verglichen', value: fmt.num(comparedCalls), note: `${fmt.num(divergences)} Divergenzen; Ausgaben in ${identicalRuns} von ${identityChecks.length} Läufen byte-identisch`, kind: 'gemessen' },
    { label: 'Start bis Kern bereit', value: range(coldNative), unit: 'ms', note: `JS-Pfad: ${range(coldJs)} ms, weil er das JS-Kernel lädt`, kind: 'gemessen' },
    { label: 'Einstiege nativ', value: String(sliceOps), unit: `von ${productionEntries}`, note: 'nur planare Modelle; gekrümmte brechen laut ab', kind: 'offen' },
  ])
  + source(SRC.bench, SRC.surface)
  + '<!--/kennzahlen-->';

// ── 1. Wohin die Zeit geht ───────────────────────────────────────────────────
const stackedTotalLabel = (html) => html.replaceAll('class="t-muted">n = ', 'class="t-muted">gesamt ');
const secTime = section('Wohin die Zeit geht',
  p(`Gemessen auf dem heutigen JS-Pfad (CPU-Profil vom 22.09., Load ${profLoad} auf ${cpus} Kernen). Es gibt zwei Regime: `
    + `Boolean-lastige Läufe verbringen ${range(heavy.map((r) => r.share('kern') * 100))} % im Kern. Kleine Modelle verbringen `
    + `${range(light.map((r) => r.share('bend') * 100))} % damit, das nach JS kompilierte Bend-Kernel zu laden (${range(bendLoadMs, (v) => fmt.num(v / 1000, 2))} s pro Lauf). `
    + `Parser, Interpreter und Host-Adaption zusammen kosten höchstens ${fmt.num(feMax * 100, 1)} % eines Laufs.`),
  stackedTotalLabel(stackedBar({
    title: 'Heute (JS-Pfad): Anteile der Laufzeit je Workload',
    sub: 'Profilierter Lauf; Frontend + Host = Parser, Interpreter, Python-Bridge, Host-Adaption; GC dem verursachenden Bereich zugeschlagen; rechts die Dauer des profilierten Laufs',
    keys: BUCKETS,
    rows: profRows.map((r) => ({ label: r.inSlice ? r.id : `${r.id} (nicht im Slice)`, values: r.values })),
    format: msOrZero,
    src: [SRC.profile, `${SRC.analysis}*.json`],
  })),
  p(`Nativ entfällt das Laden des JS-Kernels ganz. In den Boolean-Läufen bleibt der Kern der größte Block, nur ist er jetzt ${range(kernGain, (v) => fmt.num(v, 1))}-mal kürzer als im (instrumentierten) JS-Lauf. Bei \`fs-bracket\` bleiben vor allem Node-Start und Export übrig.`),
  stackedTotalLabel(stackedBar({
    title: 'Nativ (Slice): Anteile der Laufzeit je Workload',
    sub: 'Ein Trace-Lauf je Workload, 1 Thread; Kern = Aufruf + Encode + Decode; Frontend + Host wie oben; der orange Anteil (Bend-JS-Kernel laden) ist 0',
    keys: BUCKETS,
    rows: nativeRows,
    format: msOrZero,
    src: SRC.bench,
  })),
  callout('entscheidung', 'Daraus folgt die harte Regel: Das native Backend lädt das JS-Kernel nie.',
    p(`Mit weiter geladenem JS-Kernel bliebe jeder CLI-Lauf bei mindestens ${fmt.num(Math.min(...bendLoadMs) / 1000, 2)} s. Der Guard bestätigt in allen ${guards.length} nativen Trace-Läufen: kein \`data:\`-Modul, kein Bend-Compiler, kein \`.bend\`-Import.`),
    { src: [SRC.decision, SRC.bench] }),
);

// ── 2. JS gegen nativ ────────────────────────────────────────────────────────
const wallRows = [...W].sort((a, b) => b.wall.js.medianMs - a.wall.js.medianMs).map((w) => ({
  label: w.id,
  a: w.wall.js.medianMs,
  b: w.wall.native.medianMs,
  factor: w.wall.factor,
  tip: `${w.id}: JS ${w.wall.js.ms.map((v) => fmt.num(v, 0)).join(' / ')} ms → nativ ${w.wall.native.ms.map((v) => fmt.num(v, 0)).join(' / ')} ms, Faktor ${fmt.num(w.wall.factor, 2)}× (Median)`,
}));
const withinProj = bench.comparison.filter((c) => Math.abs(c.deviation) <= 0.2);
const outlier = bench.comparison.filter((c) => Math.abs(c.deviation) > 0.2);
const projFactors = bench.comparison.map((c) => c.projectedFactor);

const fwt = W.find((w) => w.id === 'py-frame-with-tab');
const jsEntry = new Map(fwt.jsTraced.entries.map((e) => [e.entry, e]));
const entryRows = fwt.nativeTraced.entries.map((e) => {
  const js = jsEntry.get(e.entry);
  if (!js) throw new Error(`binding report: no JS count for ${e.entry}`);
  const nat = e.nativeMs + e.encodeMs + e.decodeMs;
  return { label: e.label, calls: e.calls, js: js.ms, nat, e };
}).sort((a, b) => b.js - a.js);
const idBool = entryRows.find((r) => r.label === 'identity.boolean_result');
// The chart shows every entry that costs at least 1 ms on either side; the table keeps all of them.
const bigEntries = entryRows.filter((r) => r.js >= 1 || r.nat >= 1);
const smallEntries = entryRows.filter((r) => !bigEntries.includes(r));

const secWall = section('JS gegen nativ, gemessen',
  p(`Frische CLI-Prozesse, \`js\` und \`native\` abwechselnd, je ${nRuns} Läufe, Load ${benchLoad} auf ${cpus} Kernen. Die Achse ist logarithmisch: gleicher Abstand heißt gleicher Faktor. Jeder Workload rückt um etwa eine Zehnerpotenz nach links.`),
  dumbbell({
    title: 'Wall-Zeit pro Workload: JS-Target gegen nativ',
    sub: `Median aus ${nRuns} frischen Prozessen, 1 Thread, Build ${buildId}; Zeiten indikativ (geteilte Maschine)`,
    rows: wallRows,
    lo: 20, hi: 60000,
    ticks: [100, 1000, 10000],
    labels: { a: 'JS-Target (heute)', b: 'nativ, 1 Thread' },
    tableHtml: table({
      columns: ['Workload', { label: `JS ms (${nRuns} Läufe)`, align: 'right' }, { label: `nativ ms (${nRuns} Läufe)`, align: 'right' }, { label: 'Faktor', align: 'right' }, { label: 'Projektion', align: 'right' }, { label: '6 Threads ms', align: 'right' }, 'Ausgaben identisch'],
      rows: W.map((w) => {
        const c = cmp.get(w.id);
        return [w.id, w.wall.js.ms.map((v) => fmt.num(v, 0)).join(' / '), w.wall.native.ms.map((v) => fmt.num(v, 0)).join(' / '), `${fmt.num(w.wall.factor, 2)}×`, `${fmt.num(c.projectedFactor, 2)}×`, fmt.num(w.threads6.wallMs, 0), w.wall.allCorrect ? 'ja' : '**nein**'];
      }),
    }),
    src: SRC.bench,
  }),
  grid(
    card({
      eyebrow: 'Projektion gegen Messung', kind: 'geschätzt', title: `Vorab projiziert: ${range(projFactors, (v) => fmt.num(v, 1))}×`,
      body: p(`${withinProj.length} von ${bench.comparison.length} Workloads liegen innerhalb ±20 % der Projektion. `
        + outlier.map((c) => `\`${c.id}\` liegt ${c.deviation > 0 ? '+' : ''}${fmt.num(c.deviation * 100, 0)} % darüber: Ein nativer Prozess registriert die ESM-Hooks des Bend-Compilers nie, die Projektion hatte deren gebremstes Modulladen mitgerechnet.`).join(' ')),
      src: SRC.bench,
    }),
    card({
      eyebrow: 'Stabil über die Last', kind: 'gemessen', title: `${range(factors, (v) => fmt.num(v, 1))}× bei Load ${benchLoad}`,
      body: p(`Frühere Benches bei anderer Last: ${earlier[1]}–${earlier[2]}× bei Load ${earlier[3]}–${earlier[4]}, ${earlier[5]}–${earlier[6]}× bei Load ${earlier[7]}–${earlier[8]}. `
        + 'Die absoluten Zeiten folgen der Last, die Faktoren kaum.'),
      src: [SRC.bench, SRC.slice, SRC.morning],
    }),
    card({
      eyebrow: 'Mehr Threads', kind: 'gemessen', title: `6 Threads: ${range(t6Bool.map((t) => t.gain), (v) => fmt.num(v, 1))}× dazu`,
      body: p(`Je ein Lauf, bei den ${t6Bool.length} Boolean-Workloads gegen den 1-Thread-Median; \`fs-bracket\` ${fmt.num(t6.find((t) => t.id === 'fs-bracket').gain, 1)}×. Default bleibt 1 Thread, weil ein Fail-Stop auf einem Pool-Worker den Prozess beendet.`),
      src: SRC.bench,
    }),
  ),
  details(`Pro Einstieg: wo nativ gewinnt und wo nicht (py-frame-with-tab, ${entryRows.length} Einstiege)`, dumbbell({
    title: 'Kernzeit pro Einstieg (py-frame-with-tab)',
    sub: `Ein Trace-Lauf; nativ = Aufruf + Encode + Decode, JS-Target aus dem instrumentierten Count-Lauf (JS-Seite dadurch etwas zu hoch). `
      + `Gezeigt: Einstiege ab 1 ms; ${smallEntries.length} weitere kosten zusammen ${fmt.num(sum(smallEntries.map((r) => r.js)), 1)} ms im JS-Target und ${fmt.num(sum(smallEntries.map((r) => r.nat)), 1)} ms nativ (Tabelle)`,
    rows: bigEntries.map((r) => ({
      label: r.label,
      note: `${fmt.num(r.calls)} ${r.calls === 1 ? 'Aufruf' : 'Aufrufe'}`,
      a: r.js, b: r.nat,
      tip: `${r.label} (${fmt.num(r.calls)} ${r.calls === 1 ? 'Aufruf' : 'Aufrufe'}): JS-Target ${fmt.num(r.js, 2)} ms → nativ ${fmt.num(r.e.nativeMs, 2)} + Encode ${fmt.num(r.e.encodeMs, 2)} + Decode ${fmt.num(r.e.decodeMs, 2)} ms; Wörter hin ${fmt.num(r.e.requestWords)}, her ${fmt.num(r.e.replyWords)}`,
    })),
    lo: 0.01, hi: 200000, // room beside the outer dots for their labels on a 360 px phone
    ticks: [0.1, 1, 10, 100, 1000, 10000],
    labels: { a: 'JS-Target', b: 'nativ' },
    tableHtml: table({
      columns: ['Einstieg', { label: 'Aufrufe', align: 'right' }, { label: 'JS-Target ms', align: 'right' }, { label: 'nativ ms', align: 'right' }, { label: 'Encode ms', align: 'right' }, { label: 'Decode ms', align: 'right' }, { label: 'Wörter hin / her', align: 'right' }],
      rows: entryRows.map((r) => [r.label, fmt.num(r.calls), fmt.num(r.js, 2), fmt.num(r.e.nativeMs, 2), fmt.num(r.e.encodeMs, 2), fmt.num(r.e.decodeMs, 2), `${fmt.num(r.e.requestWords)} / ${fmt.num(r.e.replyWords)}`]),
    }),
    src: SRC.bench,
  })),
  p(`Die Booleans tragen den Gewinn. Kleine Einstiege mit großen Antworten werden nativ langsamer: \`identity.boolean_result\` liefert ${fmt.num(idBool.e.replyWords)} Wörter, weil Strings nativ Cons-Listen sind und jeder Code Point ein eigenes Wort über die Grenze ist (nativ ${fmt.num(idBool.e.nativeMs, 0)} ms + ${fmt.num(idBool.e.decodeMs, 0)} ms Decode gegen ${fmt.num(idBool.js, 0)} ms im JS-Target).`),
);

// ── 3. Aufbau ────────────────────────────────────────────────────────────────
const proposals = mdTable(mdBlock(SRC.decision, '## 3. Bewertung der Vorschläge').split('### 3.1')[0]).rows.map((r) => ({
  label: r[0].replace(/\*\*/g, '').replace(/\s*\(.*$/, ''),
  note: r[0].match(/\((.*)\)\s*$/)?.[1]?.replace(/`/g, '').split(',')[0], // first trait only, fits a phone row
  value: deNum(r[r.length - 1].replace(/\*\*/g, '')),
}));
const neg = Object.entries(bench.negative);
mustContain(SRC.proto, 'One addon per process: the Bend runtime is process-global', '`bend entry.bend -o kernel.c`', 'one translation unit `bx_pre.h` + unedited `kernel.c`');
const feMaxJs = fmt.num(feMax * 100, 1);
// The build123d script runs in a Python child process that talks to the JS host over pipes.
if (!/spawn\(python, [^)]*stdio: \['ignore', 'pipe'/.test(doc('src/python.mjs'))) throw new Error('binding report: src/python.mjs no longer spawns Python with pipes; update the diagram');
const secArch = section('Aufbau',
  p('Wie CPython mit einer C-Extension: Der Interpreter bleibt, wo er ist, nur der Geometriekern wird nativ.'),
  // A top-down stack instead of a left-to-right chain: it stays legible at phone width.
  grid({ wide: true },
    diagram({
      title: 'Ein Node-Prozess, zwei Backends hinter derselben Schnittstelle',
      sub: '`WONKY_BACKEND` wählt: `js` (Default) · `native` · `diff` (beide, Wort für Wort verglichen)',
      colW: 210, rowH: 88, boxW: 164, boxH: 52,
      nodes: [
        { id: 'front', label: 'Frontends · JS', sub: 'FS-Interpreter, Python-Host', col: 0, row: 0 },
        { id: 'py', label: 'Python-Prozess', sub: 'build123d-Skript + Shim', col: 1, row: 0 },
        { id: 'proxy', label: 'loadKernel()', sub: 'Proxy + Codecs · JS', col: 0, row: 1 },
        { id: 'addon', label: 'N-API-Addon', sub: 'bx_addon.c · C', col: 0, row: 2, kind: 'accent' },
        { id: 'js', label: 'Bend→JS-Target', sub: 'Referenz · js / diff', col: 1, row: 2, kind: 'muted' },
        { id: 'kern', label: 'Bend-Kern', sub: `kernel.c, ${sliceOps} Ops · C`, col: 0, row: 3, kind: 'accent' },
      ],
      edges: [
        { from: 'py', to: 'front', label: 'Pipe' },
        { from: 'front', to: 'proxy' },
        { from: 'proxy', to: 'addon', label: 'call(op, words)' },
        { from: 'proxy', to: 'js', label: 'nur js / diff' },
        { from: 'addon', to: 'kern', label: 'kcall(op, words)' },
      ],
      src: [SRC.decision, SRC.proto, 'src/python.mjs'],
    }),
    card({
      eyebrow: 'Was wo läuft', title: 'Oben JS, unten C, dazwischen eine Funktion',
      body: ul([
        `**JS:** FeatureScript-Parser und Interpreter, der Host für build123d (das Python-Skript läuft in einem Kindprozess und spricht über Pipes mit ihm), Export. Parser, Interpreter und Host-Adaption kosten laut Profil höchstens ${feMaxJs} % eines Laufs.`,
        `**Grenze:** \`call(op, Uint32Array) → Uint32Array\`, synchron. Ein leerer Aufruf kostet ${callFloor}.`,
        '**C:** `bend` emittiert den Kern als `kernel.c`; clang baut ihn unverändert mit dem Treiber `bx_addon.c` zu einer `.node`. Per Skript, ohne Handedits, ohne npm-Abhängigkeit.',
        '**Referenz:** Das nach JS kompilierte Kernel bleibt hinter derselben Schnittstelle, für `diff` und für Rechner ohne C-Toolchain. Nie als stiller Rückfall.',
        'Die Bend-Runtime ist prozessglobal: ein Addon pro Prozess.',
      ]),
      src: [SRC.decision, SRC.proto, SRC.profile],
    }),
  ),
  grid({ wide: true },
    card({
      eyebrow: 'Kein JS-Kernel', kind: 'gemessen', title: guardClean ? `${guards.length} von ${guards.length} nativen Läufen sauber` : 'Guard hat JS-Kernel gefunden',
      body: p(`Ein Preload protokolliert jedes geladene Modul: ${range(guards.map((g) => g.modules))} Module, davon 0 \`data:\`-Module, 0 Bend-Compiler, 0 \`.bend\`-Importe.`),
      src: SRC.bench,
    }),
    card({
      eyebrow: 'Laut statt still', kind: 'gemessen', title: 'Nicht abgedeckte Modelle brechen ab',
      body: ul(neg.map(([id, n]) => `\`${id}\`: Exit ${n.exitCode} nach ${fmt.num(n.wallMs, 0)} ms bei \`${n.firstRefusedEntry.replace(/^kernel\//, '')}\`, JS-Kernel ${n.jsKernelLoaded ? 'geladen' : 'nicht geladen'}`)),
      src: SRC.bench,
    }),
    card({
      eyebrow: 'Build', kind: 'gemessen', title: `${sliceOps} Ops in ${fmt.num(bench.build.seconds.bend + bench.build.seconds.clang, 0)} s`,
      body: p(`bend ${fmt.num(bench.build.seconds.bend, 1)} s + clang ${fmt.num(bench.build.seconds.clang, 1)} s, ${mb(bench.build.cBytes)} C, \`.node\` ${mb(bench.build.nodeBytes)}. Die volle Oberfläche (${full.full.ops} Ops) baut in bend ${fmt.num(full.full.bendSeconds, 1)} s + clang ${fmt.num(full.full.clangSeconds, 1)} s zu ${mb(full.full.nodeBytes)} \`.node\`, wird aber noch nie geladen.`),
      src: [SRC.bench, SRC.full],
    }),
    card({
      eyebrow: 'Addon laden', kind: 'gemessen', title: `warm ${fmt.num(bench.firstLoad.warmAfterRebuild.dlopenMs, 2)} ms`,
      body: p(`Der erste Load einer neuen Binary kostet einmalig ${fmt.num(bench.firstLoad.afterRebuild.dlopenMs, 0)} ms (macOS prüft sie), jeder weitere ${fmt.num(bench.firstLoad.warmAfterRebuild.dlopenMs, 2)} ms. Eine frische Kopie derselben Binary zahlt erneut.`),
      src: SRC.bench,
    }),
  ),
  details('Warum dieser Aufbau: drei Vorschläge im Vergleich', [
    barChart({
      title: 'Gesamtnote der Architekturvorschläge (0 bis 10)',
      sub: 'Bewertung im Schiedsspruch vom 22.09. (Speed, Exaktheit, Fehler, Migration, Dev-Loop, Parallelität, API), keine Messung',
      data: proposals.map((pr, i) => ({ label: pr.label, note: pr.note, value: pr.value, kind: 'geschätzt', highlight: i === 0 })),
      format: (v) => fmt.num(v, 1),
      max: 10,
      src: SRC.decision,
    }),
    callout('entscheidung', 'Hybrid mit dem funktionalen Vorschlag als Rückgrat',
      p('Zuerst ein generiertes, feinkörniges Compat-Backend, bitgleich zu heute (das ist der Slice). Danach werden die Einstiege gruppenweise durch wenige grobe Operationen mit exakten Carriern ersetzt. Residente Handles und Batching kommen nur, wenn Messungen sie rechtfertigen.'),
      { src: SRC.decision }),
  ].join('')),
);

// ── 4. Exaktheit ─────────────────────────────────────────────────────────────
const flagsOk = /-ffp-contract=off/.test(bench.build.flags) && /-fno-fast-math/.test(bench.build.flags);
const secExact = section('Exaktheit',
  p(`Zwei Prüfungen laufen unabhängig. Erstens werden alle Ausgaben eines nativen Laufs Byte für Byte mit einem \`js\`-Lauf derselben Runde verglichen. Zweitens ruft \`WONKY_BACKEND=diff\` für jeden Kernaufruf beide Backends auf und vergleicht die Antwortwörter; Divergenzen werden aus Dump-Verzeichnissen und Trace-Zählern gezählt, nicht aus dem Exit-Code.`),
  tiles([
    { label: 'Kernaufrufe verglichen', value: fmt.num(comparedCalls), note: `${W.length} Workloads, ${countsMatch ? 'Anzahl je Einstieg = Count-Lauf des Profils' : 'Anzahl weicht vom Profil ab'}`, kind: 'gemessen' },
    { label: 'Antwortwörter verglichen', value: fmt.num(comparedWords / 1e6, 2), unit: 'Mio.', kind: 'gemessen' },
    { label: 'Divergenzen', value: fmt.num(divergences), note: 'Dumps + Trace-Zähler', kind: 'gemessen' },
    { label: 'Läufe byte-identisch', value: `${identicalRuns}/${identityChecks.length}`, note: '3 Runden + Trace, 6 Threads, diff', kind: 'gemessen' },
  ]),
  source(SRC.bench),
  details('Pro Workload', `<div class="bd-nw1">${table({
    columns: ['Workload', { label: 'verglichene Aufrufe', align: 'right' }, { label: 'Wörter', align: 'right' }, { label: 'Divergenzen', align: 'right' }, '= Profil-Count', 'Ausgaben = js'],
    rows: W.map((w) => [w.id, fmt.num(w.diff.comparedCalls), fmt.num(w.diff.comparedWords), fmt.num(w.diff.divergences + w.diff.divergencesInTrace), w.diff.countsMatchProfile ? 'ja' : 'nein', w.diff.correctness.identical ? 'ja' : 'nein']),
    src: SRC.bench,
  })}</div>`),
  grid(
    card({
      eyebrow: 'Bits über die Grenze', title: 'F32 als Bitmuster, Real als zwei Wörter',
      // Compiler flags start with "-": keep each on one line instead of breaking after the dash on a phone.
      body: p(`Nie binary64 auf dem Wire. Der Build pinnt ${flagsOk ? '`-ffp-contract=off` und `-fno-fast-math`' : '**keine** FP-Flags'} und hasht die Flags in den Build-Schlüssel.`).replaceAll('<code>-', '<code class="bd-nw">-'),
      src: [SRC.decision, SRC.bench],
    }),
    card({
      eyebrow: 'Ketten', kind: 'offen', title: '`nativeChainExact` bleibt vorerst `false`',
      body: p(`Der Host rundet F32x2 zwischen zwei Aufrufen über binary64: ${fmt.num(hostRoundTrip.changed)} von ${fmt.num(hostRoundTrip.reals)} Result-Reals ändern sich dabei. Der Slice behält diese Rundreise auf beiden Backends bei und ist deshalb bitgleich zu heute. Exakte Carrier kommen ab Schritt 2.`),
      src: [SRC.surface, SRC.decision],
    }),
    card({
      eyebrow: 'Tests', kind: 'gemessen', title: `${testsLine[1]}/${testsLine[2]} native-bridge-Tests grün`,
      body: p(`Darunter ${sliceTests} Slice-Tests: jeder laute Fehlerfall, Manipulationen am Build, Fehlerinjektion in die unveränderten CLIs, Heap-Zustand pro Aufruf.`),
      src: [SRC.morning, SRC.slice],
    }),
  ),
);

// ── 5. Veraltete Builds ──────────────────────────────────────────────────────
const sc = (k) => range(W.map((w) => w.nativeTraced.staleCheck[k]), (v) => fmt.num(v, 1));
const fixes = mdTable(mdBlock(SRC.slice, '## Nachbesserung 2026-09-23')).rows.map((r) => [r[0], r[1]]);
const fix2 = need(SRC.slice, /\*\*Befund \(Verifikation, mittel\)\.\*\* ([^:]+):/)[1].replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '$1');
mustContain(SRC.proto, 'Build published edited code under a clean hash', 'ten edits');
mustContain(SRC.slice, 'zehn Manipulationen, jede `BX_STALE`, kein `dlopen`');
const churnKeep = churn.modes.keep.series['identity.boolean_result'];
const churnClear = churn.modes.clear.series['identity.boolean_result'];
mustContain(SRC.proto, 'ten edits (union/subtract swapped, label, namespace, refusal name, wiring record, zeroed `node.sha256`, one flipped byte of the binary, `wire.json`, `wire.mjs`, set) each give `BX_STALE` and nothing is `dlopen`ed');
mustContain(SRC.proto, 'Fixed after the workflow ended', 'refuses to publish if any of them changed');
const staleRows = [
  [`${inputFiles} Eingabedateien (Kernquellen, Skripte, Treiber, Header, \`bend.lock.json\`)`, 'sha256 jeder Datei', sc('filesMs')],
  ['`loadKernel()`-Verdrahtung in `src/kernel.mjs`', 'strenger Parser, muss dem Manifest entsprechen', sc('wiringMs')],
  ['Toolchain: Bend-Binary, Bend-Bibliothek, clang', 'Datei-Identität, bei Änderung neu hashen bzw. `clang --version`', sc('toolchainMs')],
  ['Routing: Op-Tabelle, Namensräume, Verweigerungen', 'Teil des neu gerechneten Schlüssels', sc('keyMs')],
  ['`.node`-Binary', 'sha256, Quell-Hash muss in der Binary stehen', sc('nodeMs')],
  ['Codecs (`wire.json`, `wire.bend`, `wire.mjs`)', 'Wire-Hash neu gerechnet, muss in der Binary stehen', sc('wireMs')],
];
const secStale = section('Schutz vor veralteten Builds',
  p(`Eine Binary, die nicht mehr zum Quelltext passt, würde falsche Geometrie liefern, ohne dass es jemand merkt. Deshalb rechnet der Loader den Build-Schlüssel **bei jedem Öffnen und vor \`dlopen\`** neu: ${inputFiles} Eingabedateien, die \`loadKernel()\`-Verdrahtung, die Toolchain, das Routing, die Binary selbst und die Codecs. Passt etwas nicht, gibt es \`NativeKernelStaleError\` mit der geänderten Datei und dem Build-Befehl. Eine veraltete Binary läuft nie.`),
  tiles([
    { label: 'Stale-Check pro Öffnen', value: range(staleTotals, (v) => fmt.num(v, 1)), unit: 'ms', note: `${W.length} Trace-Läufe, Load ${benchLoad}`, kind: 'gemessen' },
    { label: 'Zum Vergleich: JS-Cache-Validierung heute', value: fmt.num(jsCacheCheckMs, 0), unit: 'ms', note: `Median aus ${profile.startupPhases.runs.length} Starts (Profil vom 22.09.)`, kind: 'gemessen' },
  ]),
  source(SRC.bench, SRC.profile),
  grid(
    card({
      eyebrow: 'Test', kind: 'gemessen', title: 'Zehn Manipulationen, zehnmal `BX_STALE`',
      body: p('Union und Subtract vertauscht, Label, Namensraum, Name einer Verweigerung, Verdrahtung, genullter sha256 der Binary, ein gekipptes Byte der Binary, `wire.json`, `wire.mjs`, Set: Jede Änderung endet vor `dlopen`.'),
      src: [SRC.proto, SRC.slice],
    }),
    card({
      eyebrow: 'Nach Prüfrunde 3 behoben', title: 'Build veröffentlichte geänderten Code unter sauberem Hash',
      body: p('Eine Eingabe, die während des Builds geändert und vor dessen Ende zurückgesetzt wurde, landete unter dem sauberen Hash im Cache. Der Build merkt sich jetzt die Datei-Identitäten vor dem Start und veröffentlicht nicht, wenn sich eine geändert hat (eigener Regressionstest).'),
      src: SRC.proto,
    }),
  ),
  details(`Was bei jedem Öffnen neu geprüft wird (${staleRows.length} Punkte, Kosten je Punkt)`, table({
    columns: ['Was neu geprüft wird', 'Wie', { label: 'Kosten ms', align: 'right' }],
    rows: staleRows,
    caption: `Kosten: Spanne über ${W.length} Trace-Läufe`,
    src: [SRC.bench, SRC.proto],
  })),
);

// ── 6. Ausprobieren ──────────────────────────────────────────────────────────
// Commands and their comments come from the "Befehle" block of slice.md; long ones are
// wrapped with a shell continuation so the block reads on a phone.
const cmdBlock = mdBlock(SRC.slice, '## Befehle').match(/```sh\n([\s\S]*?)```/)[1].split('\n').filter(Boolean);
const pick = (needle) => {
  const line = cmdBlock.find((l) => l.includes(needle));
  if (!line) throw new Error(`binding report: command "${needle}" missing in ${SRC.slice}`);
  const [cmd, comment] = line.split(/\s+#\s+/);
  return { cmd: cmd.trim().replace(/\s{2,}/g, ' '), comment: comment?.trim().replace(/(\d)-(\d)/g, '$1–$2') };
};
const wrapCmd = (cmd, at) => (at && cmd.includes(at) ? cmd.replace(` ${at}`, ` \\\n  ${at}`) : cmd);
const tryCmds = [
  { ...pick('build-native.mjs --set planar'), say: 'einmal bauen, und nach jeder Kernel-Änderung' },
  { ...pick('WONKY_BACKEND=native node bin/wonky.mjs examples/bracket.fs'), say: 'ein Modell nativ bauen' },
  { ...pick('WONKY_BACKEND=diff'), say: 'beide Backends, jeder Kernaufruf Wort für Wort verglichen', at: 'fixtures/' },
  { ...pick('WONKY_NATIVE_TRACE='), say: 'Trace schreiben', at: 'node ', example: 'examples/bracket.fs --out out/bracket' },
  { ...pick('node --test test/native-bridge-slice.test.mjs'), say: 'die Tests des Slices' },
];
mustContain(SRC.slice, '`WONKY_BACKEND=js|native|diff` (ungesetzt = `js`, alles andere ist ein Fehler), `WONKY_NATIVE_THREADS` (Default 1)',
  'Node-API-Header mit Provenienz, einmal pro Node-Version');
mustContain(SRC.proto, 'WONKY_NATIVE_TRACE=trace.json WONKY_BACKEND=native node bin/wonky.mjs ... # per-entry timings at exit');
if (!existsSync(join(REPO, 'src/native/include/node_api.h'))) throw new Error('binding report: vendored Node-API headers are gone; update the "Ausprobieren" note');
/** Variable name → what it does. */
const varList = (items) => `<dl class="bd-vars">${items.map(([k, v]) => `<dt><code>${esc(k)}</code></dt><dd>${inline(v)}</dd>`).join('')}</dl>`;
const bored = bench.negative['fs-bored-spacer-print'];
const secTry = section('Ausprobieren',
  p('Ohne `WONKY_BACKEND` ändert sich nichts: Default ist `js`. Einmal bauen, dann mit der Umgebungsvariable umschalten.'),
  pre(tryCmds.flatMap((c, i) => [
    ...(i ? [''] : []),
    `# ${c.say}${c.comment ? ` (${c.comment})` : ''}`,
    wrapCmd(c.example ? c.cmd.replace(/\.\.\.$/, c.example) : c.cmd, c.at),
  ])),
  source(SRC.slice),
  p('Die Node-API-Header liegen im Repo (`src/native/include/`). Nur nach einem Wechsel der Node-Version einmal `node scripts/native-bridge/vendor-node-api.mjs` davor.'),
  // A definition list instead of a table: the long variable names would break mid-word in a phone-width column.
  varList([
    ['WONKY_BACKEND', '`js` · `native` · `diff`. Ungesetzt heißt `js`; jeder andere Wert ist ein Fehler.'],
    ['WONKY_NATIVE_THREADS', 'Default 1. Mehr Threads sind schneller, aber ein Fail-Stop auf einem Pool-Worker beendet den Prozess.'],
    ['WONKY_NATIVE_TRACE', 'Dateipfad. Schreibt beim Beenden die Zeiten pro Einstieg.'],
    ['WONKY_DIVERGENCE_DIR', 'Verzeichnis. Dumps, wenn `diff` eine Abweichung findet.'],
  ]),
  source(SRC.slice, SRC.proto),
  p('Ein Modell außerhalb des Slices bricht so ab (echte Ausgabe aus dem Bench):'),
  pre([bored.message], { wrap: true }),
  source(SRC.bench),
);

// ── 7. Offen / nächste Schritte ──────────────────────────────────────────────
mustContain(SRC.proto, 'terminating a `worker_thread` during a native kernel call crashes the whole Node process with SIGSEGV',
  '`--cache` with a relative path fails at the clang step', 'treats two NaNs with different bit patterns as a divergence',
  'Lone-surrogate `Char` words are accepted natively', 'The count-guard evidence relies on a pre-fix build');
mustContain(SRC.decision, 'an arity over 255', 'Kompatibilitäts-Backend', 'inkl. bored-spacer');
mustContain(SRC.proto, 'Paths that bypass `loadKernel()` are not routed', "`src/lang/semcore/build.mjs` hard-codes `target: 'JavaScript'`",
  'The heap clear keeps the high-water pages mapped', '`reset()` after a fail-stop', '`identity.extrusion` (`n`) and `identity.boolean_result`',
  'A bound belongs in the kernel (`kernel/identity.bend`');
const steps = mdTable(mdBlock(SRC.decision, '## 10. Migrationsschritte')).rows;
// Step 0 is half done: the full-surface build was measured, but the CLI flag does not exist yet.
if (/--backend/.test(doc('bin/wonky.mjs'))) throw new Error('binding report: bin/wonky.mjs now has --backend; update the status of step 0');
if (!steps.some((r) => r[0] === '0')) throw new Error(`binding report: step 0 missing in ${SRC.decision}`);
const step0Stand = `teilweise: Build der ${full.full.ops} Einstiege gemessen, \`--backend\` fehlt noch`;
const decisions = mdNumbered(mdBlock(SRC.decision, '## 13. Entscheidungen für Marc'));
// Status since the bench (23.09. evening): W2 re-baselines the slice in the working tree,
// and the Boolean decision names the native path for the hybrid (plan step 11).
const flatDoc = (rel) => doc(rel).replace(/\s+/g, ' ');
const needIn = (rel, re) => { const m = flatDoc(rel).match(re); if (!m) throw new Error(`binding report: ${rel} no longer matches ${re}; update the report`); return m; };
const sliceDirty = execFileSync('git', ['status', '--porcelain', '--', SRC.slice], { cwd: REPO, encoding: 'utf8' }).trim() !== '';
const w2Rebase = /## Re-Baseline W2/.test(doc(SRC.slice)) ? {
  ops: needIn(SRC.slice, /\*\*(\d+) Einstiege\*\* statt (\d+)/),
  hash: needIn(SRC.slice, /neuer `sourceHash` \*\*(\w+)\*\*/)[1],
  tests: needIn(SRC.slice, /`test\/native-bridge-slice\.test\.mjs` (\d+\/\d+): die sechs Workloads byte-identisch nativ und js/)[1],
  notRemeasured: needIn(SRC.slice, /\*\*Nicht neu gemessen\*\*: die Tabellen unten .*? stammen vom Build (\w+) mit den alten (\d+) Einstiegen/),
} : null;
const PLAN = 'docs/hybrid-boolean-plan.md';
needIn(PLAN, /\*\*Native CLI path\.\*\* .*? Then the coarse N-API entry in the native bridge: one call per operation/);
const planCommit = execFileSync('git', ['log', '-1', '--format=%h', '--', PLAN], { cwd: REPO, encoding: 'utf8' }).trim();
const statusSince = callout('offen', 'Seit dieser Messung',
  ul([
    ...(w2Rebase ? [`W2 (Konstruktionspräzision) baut polyedrische Körper jetzt in F32x2. Der Slice folgt${sliceDirty ? ' im Arbeitsbaum, nicht committet' : ''}: **${w2Rebase.ops[1]} statt ${w2Rebase.ops[2]} Einstiege**, neuer Build \`${w2Rebase.hash}\`, Slice-Tests ${w2Rebase.tests} mit byte-identischen Ausgaben.${rescan ? ` Der neue Scan zählt ${rescan[1]} statt ${rescan[2]} Produktions-Einstiege; die Abdeckung unten zeigt noch den alten Stand.` : ''} Die Zeiten und Faktoren in diesem Bericht stammen vom Build \`${w2Rebase.notRemeasured[1]}\` mit ${w2Rebase.notRemeasured[2]} Einstiegen und sind noch nicht neu gemessen.`] : []),
    `Der Boolean-Hybrid ist entschieden (\`${planCommit}\`). Nativ läuft er laut Plan (Schritt 11) zuerst als eigenes Programm, dann über einen groben N-API-Einstieg: ein Aufruf pro Operation.`,
  ]),
  { src: [SRC.slice, PLAN, 'git log', 'git status'] });
const secOpen = section('Offen / nächste Schritte',
  statusSince,
  stackedTotalLabel(stackedBar({
    title: `Abdeckung: ${productionEntries} Produktions-Einstiege des Kerns`,
    sub: `Nativ geladen wird nur der Slice. Die volle Oberfläche (${full.full.ops} Einstiege) baut, wird aber vom Loader nie geöffnet.`,
    keys: [
      { key: 'slice', label: 'nativ im Slice (läuft)' },
      { key: 'step1', label: 'emittierbar, nie geladen (Schritt 1)' },
      { key: 'blocked', label: 'nicht als C emittierbar (r10b)', neutral: true },
    ],
    rows: [{ label: '', values: { slice: sliceOps, step1: full.full.ops - sliceOps, blocked: productionEntries - full.full.ops } }],
    src: [SRC.surface, SRC.bench, SRC.full],
  })),
  grid({ wide: true },
    card({
      eyebrow: 'Mangel · mittel', kind: 'offen', title: 'Worker-Thread-Abbruch während eines nativen Aufrufs: SIGSEGV',
      body: p('Die Bend-Runtime ist prozessglobal. Wird ein `worker_thread` mitten im Aufruf beendet, stürzt der ganze Node-Prozess ab. Das Addon braucht einen Cleanup-Hook, der den Aufruf abwartet oder das Beenden verweigert.'),
      src: SRC.proto,
    }),
    card({
      eyebrow: 'Mängel · niedrig', kind: 'offen', title: 'Vier kleinere Mängel',
      body: ul([
        '`--cache` mit relativem Pfad scheitert beim clang-Schritt.',
        '`diff` wertet zwei NaNs mit verschiedenen Bitmustern als Divergenz.',
        'Einzelne Surrogat-`Char`-Wörter nimmt nativ an, das JS-Target wirft.',
        'Der Beleg für den Zählwächter hängt an einem alten Build, den kein Skript neu erzeugt.',
      ]),
      src: SRC.proto,
    }),
    card({
      eyebrow: 'Nächster Hotspot', kind: 'offen', title: 'Identity ist nativ langsamer',
      body: p(`\`identity.boolean_result\`: ${fmt.num(idBool.nat, 0)} ms nativ gegen ${fmt.num(idBool.js, 0)} ms im JS-Target (frame-with-tab). Optionen: gepackte Strings auf dem Wire, Identity im Host oder ein nativer Revisions-Hash. Das ist deine Entscheidung.`),
      src: [SRC.bench, SRC.proto],
    }),
    card({
      eyebrow: 'Kernarbeit', kind: 'offen', title: 'r10b läuft nativ erst nach einem Kern-Umbau',
      body: p(`\`bored-spacer\` bricht nativ ab, weil seine Einstiege (zuerst \`${bored.firstRefusedEntry.replace(/^kernel\//, '')}\`) nicht im Slice sind; das holt Schritt 1. r10b braucht zusätzlich \`ports/curved-intersection.bend:intersect\`, und das lässt sich mit Bend 2.0.25 nicht als C emittieren ("an arity over 255", im Kern selbst). Das braucht einen Kern-Refactor oder einen Fix in Bend, nicht die Bridge.`),
      src: [SRC.bench, SRC.decision],
    }),
  ),
  details('Weitere bekannte Lücken', [
    ul([
      'Pfade an `loadKernel()` vorbei (Viewer- und Diagnose-Adapter, die `.bend` direkt importieren) laufen nativ nicht. Aus den Produktions-CLIs ist keiner erreichbar.',
      'Code anderer Workflows nimmt noch das JS-Target an: `src/lang/semcore/build.mjs` schreibt fest `target: \'JavaScript\'`, `src/lang/dataflow/py-trace.mjs` hat eine eigene Fehlerzuordnung ohne `endsRun`.',
      'Das Heap-Leeren gibt keine Seiten zurück: Ein langlebiger Host behält den Speicher des größten Aufrufs.',
      '`reset()` nach einem Fail-Stop ist über den Proxy nicht erreichbar. Langlebige Hosts brauchen dafür erst eine Regel.',
      '`identity.extrusion` und `identity.boolean_result` bauen so viele Einträge, wie ein Zählargument verlangt. Die Grenze gehört in den Kern (`kernel/identity.bend`), auf beiden Backends gleich.',
    ]),
    source(SRC.proto),
  ].join('')),
  details(`Schon behoben: ${fixes.length + 2} Befunde aus drei Prüfrunden`, [
    table({
      columns: ['#', 'Befund'],
      rows: [...fixes, [String(fixes.length + 1), `${fix2}.`], [String(fixes.length + 2), 'Ein Build konnte geänderten Code unter einem sauberen Hash veröffentlichen (nach Runde 3 behoben, siehe Schutz vor veralteten Builds).']],
      src: [SRC.slice, SRC.proto],
    }),
    p(`Beispiel Befund 6, gemessen in einem langlebigen Prozess mit ${fmt.num(churn.recorded.calls)} aufgezeichneten Aufrufen: Ohne Heap-Leeren pro Aufruf wuchs \`identity.boolean_result\` in ${churnKeep.repeat} Wiederholungen von ${fmt.num(churnKeep.firstQuarterMedianMs, 1)} auf ${fmt.num(churnKeep.lastQuarterMedianMs, 1)} ms (Median erstes gegen letztes Viertel). Mit Heap-Leeren bleibt er flach: ${fmt.num(churnClear.firstQuarterMedianMs, 1)} → ${fmt.num(churnClear.lastQuarterMedianMs, 1)} ms.`),
    source(SRC.churn),
  ].join('')),
  callout('geschätzt', 'Als Nächstes laut Plan',
    p(`Schritt 0 misst das volle Addon im Einsatz und bringt das CLI-Flag \`--backend\`. Schritt 1 schaltet alle ${full.full.ops} emittierbaren Einstiege nativ frei, bitgleich zu heute; projiziert sind ${nextProjection[1]}–${nextProjection[2]}× auf allen Workloads außer r10b.`),
    { src: [SRC.decision, SRC.full] }),
  details('Alle Migrationsschritte laut Plan', table({
    columns: ['Schritt', 'Inhalt', 'liefert', 'Stand'],
    rows: steps.map((r) => [r[0].replace('(jetzt)', '(Slice)'), r[1], r[2], /^\*\*S/.test(r[0]) ? 'erledigt' : r[0] === '0' ? step0Stand : 'offen']),
    src: SRC.decision,
  })),
  callout('gemessen', 'Einordnung: Tempo ist für deine echten Teile noch nicht der Engpass',
    p(`Laut Triage baut heute ${triage.builds} von ${triage.files} Modelldateien aus deinem Korpus; der Median scheitert nach ${triage.medianFail} s, ${triage.frontendShare} % der Units schon im Frontend. Das Binding zahlt sich aus, sobald Frontend- und Boolean-Lücken zu sind und größere Teile durchlaufen.`),
    { src: SRC.morning }),
  callout('entscheidung', 'Entscheidungen, die bei dir liegen', ul(decisions), { src: SRC.decision }),
);

// ── 8. Quellen ───────────────────────────────────────────────────────────────
/** Latest date named in a document's header lines (ISO or German), as dd.mm.yyyy. */
const stand = (rel) => {
  const head = doc(rel).split('\n').slice(0, 8).join(' ');
  const iso = [...head.matchAll(/(\d{4})-(\d{2})-(\d{2})/g)].map((m) => `${m[1]}${m[2]}${m[3]}`);
  const de = [...head.matchAll(/\b(\d{2})\.(\d{2})\.(\d{4})\b/g)].map((m) => `${m[3]}${m[2]}${m[1]}`);
  const latest = [...iso, ...de].sort().at(-1);
  if (!latest) throw new Error(`binding report: no date in the header of ${rel}`);
  return `${latest.slice(6)}.${latest.slice(4, 6)}.${latest.slice(0, 4)}`;
};
/** Source list: path, date and what the report takes from it. A list, not a table: long paths wrap badly in a phone-width column. */
const srcList = (items) => `<ul class="bd-srclist">${items.map(([path, what, when]) => `<li><div class="bd-srchead"><code>${esc(path).replaceAll('/', '/<wbr>')}</code><span class="bd-stand">${esc(when)}</span></div><div class="bd-what">${inline(what)}</div></li>`).join('')}</ul>`;
const secSources = section('Quellen',
  srcList([
    [SRC.bench, 'Wall-Zeiten, Buckets, Kernzeit pro Einstieg, Diff-Zählungen, Byte-Vergleiche, Stale-Check, Guard, Negativfälle, Build, Addon-Load', berlin(bench.startedAt)],
    [`${SRC.profile} + ${SRC.analysis}*.json`, 'Anteile der Laufzeit auf dem JS-Pfad, Bend-Load, JS-Cache-Validierung', berlin(profile.generatedAt)],
    [SRC.full, `Build der vollen Oberfläche (${full.full.ops} Ops)`, berlin(full.measuredAt)],
    [SRC.churn, 'langlebiger Prozess, Heap-Leeren', berlin(churn.measuredAt)],
    [SRC.surface, 'Zahl der Produktions-Einstiege, Host-Rundreise der Reals', berlin(surface.generatedAt)],
    [SRC.decision, 'Entscheidung, Architektur, Bewertung der Vorschläge, Migrationsschritte, offene Entscheidungen', stand(SRC.decision)],
    [SRC.slice, 'Befunde der Prüfrunden, frühere Benches, Befehle, Umgebungsvariablen, Maschine', stand(SRC.slice)],
    [SRC.proto, 'Aufbau (Treiber, Build, Laufzeitpfad), Stale-Check-Umfang, offene Mängel und Lücken nach Prüfrunde 3', stand(SRC.proto)],
    [SRC.binding, 'Aufruf-Overhead', stand(SRC.binding)],
    [SRC.morning, 'Commit, Testzahl, erster Bench, Triage-Einordnung', stand(SRC.morning)],
  ]),
  p(`Maschine: ${machine[2]}, ${cpus} logische CPUs, macOS ${bench.machine.arch}, Node ${bench.machine.node}, Bend ${machine[1]}. Sie war mit anderen Workflows geteilt; alle absoluten Zeiten sind indikativ, die Faktoren und Anteile sind der belastbare Teil.`),
);

// ── page ─────────────────────────────────────────────────────────────────────
const EXTRA_CSS = `
.bd-summary{margin:0 0 18px}
.bd-summary .tb-k{display:block;font:600 11px/1.3 var(--font-display);letter-spacing:.09em;text-transform:uppercase;color:var(--muted);margin:0 0 6px}
.bd-summary .lede{margin:0}
.bd-db .bd-dot{stroke:var(--surface);stroke-width:2}
.bd-db .bd-link{stroke:var(--n);stroke-width:2;stroke-linecap:round}
.bd-db .bd-grid{stroke:var(--rule);stroke-width:1}
.bd-db .bd-tick{font-size:11px;fill:var(--muted);font-variant-numeric:tabular-nums}
.sw.bd-round{border-radius:50%}
pre.bd-pre{font:13px/1.55 var(--font-mono);background:var(--surface-2);border:1px solid var(--rule);border-radius:6px;padding:12px 14px;margin:0 0 18px;overflow-x:auto;-webkit-overflow-scrolling:touch}
pre.bd-pre code{font:inherit;background:none;border:0;padding:0;overflow-wrap:normal;white-space:pre}
pre.bd-pre .c{color:var(--muted)}
pre.bd-wrap code{white-space:pre-wrap;overflow-wrap:anywhere}
.more-body>.chart{margin-top:6px}
.tiles+.src{margin:-14px 0 24px}
pre.bd-pre+.src{margin:-10px 0 18px}
@media (max-width:640px){pre.bd-pre{font-size:12px}}
@media (max-width:560px){.bd-db .bd-note{display:none}}
dl.bd-vars{display:grid;grid-template-columns:max-content 1fr;gap:8px 20px;margin:0;padding:12px 0;border-top:1px solid var(--rule);border-bottom:1px solid var(--rule)}
dl.bd-vars dt,dl.bd-vars dd{margin:0}
@media (max-width:640px){dl.bd-vars{grid-template-columns:1fr;gap:2px}dl.bd-vars dd{margin:0 0 10px}}
ul.bd-srclist{list-style:none;margin:0 0 18px;padding:0;border-top:1px solid var(--rule-strong);max-width:none}
ul.bd-srclist li{padding:9px 0;border-bottom:1px solid var(--rule)}
.bd-srchead{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:baseline;gap:2px 16px}
.bd-srchead code{font-size:12.5px}
.bd-stand{font-size:12.5px;color:var(--muted);font-variant-numeric:tabular-nums;white-space:nowrap}
.bd-what{font-size:14.5px;color:var(--ink-2);margin-top:3px}
dl.bd-vars+.src{margin-bottom:20px}
code.bd-nw{white-space:nowrap}
/* Row labels are ids like py-planar-pocket: on a phone they would wrap at every hyphen; the table scrolls instead. */
.chart .tbl td:first-child,.bd-nw1 td:first-child{white-space:nowrap}
`;

let html = page({
  title: 'Kernel nativ: das C-Extension-Binding',
  date: '2026-09-23',
  meta: [
    ['Build', `\`${buildId}\` · planarer Slice, ${sliceOps} Einstiege`],
    ['Messung', `${berlin(bench.startedAt)} · Load ${benchLoad} auf ${cpus} Kernen`],
    ['Commit', `\`${commit}\`, Default unverändert \`js\``],
  ],
  sections: [header, secTime, secWall, secArch, secExact, secStale, secTry, secOpen, secSources],
});

// Kurzfassung and key numbers belong directly under the title block; the TOC follows them.
const toc = html.match(/<nav class="toc"[\s\S]*?<\/nav>/)?.[0];
if (toc) html = html.replace(toc, '').replace('<!--/kennzahlen-->', toc);
html = html.replace('</style>', `${EXTRA_CSS}</style>`);
assertPublicSafe(html);
writeReport('binding.html', html);
