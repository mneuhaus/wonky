
if (!(await import('node:fs')).existsSync(new URL('../../var/site/development-record.md', import.meta.url))) {
  console.log('local-only historical report input absent; report omitted');
  process.exit(0);
}
// scripts/reports/viewer.mjs — Bericht "Viewer: vom Review-Tool zum Cockpit".
//   node scripts/reports/viewer.mjs   → out/reports/viewer.html
//
// Reads the viewer audits, the spec, the 16 package reports and their QA JSON,
// plus the scratch output of the integration stage (test runs, browser QA of the
// integrated state, the live-session terminal log) when it exists.
// Every number comes from a file (grab()/readJson()); prose around it is German.
// Screenshots are cropped with macOS sips into out/reports/_assets/viewer/ and
// embedded as AVIF data URIs (Postplan caps a draft at 512 KiB). Crops avoid inspector panes that print absolute
// source paths (the public-safety guard cannot see pixels).

import { readFileSync, readdirSync, statSync, mkdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, basename } from 'node:path';
import {
  page, section, p, ul, esc, inline, tiles, grid, card, callout, table, details, image,
  barChart, beforeAfter, diagram, source, fmt, readJson, REPO, writeReport, assertPublicSafe,
} from './lib.mjs';

// ── sources ──────────────────────────────────────────────────────────────────
const D = 'docs/viewer';
const SPEC = `${D}/spec.md`;
const DAILY = `${D}/audit-daily-use.md`;
const RENDER_AUDIT = `${D}/audit-rendering.md`;
const FOUNDATION = `${D}/foundation.md`;
const MORNING = 'var/site/development-record.md';
const BENCH = 'out/viewer/audit-rendering/render-bench-dpr2.json';
const TRANSPORT = 'out/viewer/render-transport/a1-transport.json';
const STRESS_PICK = 'out/viewer/render-transport/a2-stress-pick.json';
const LOOK_PERF = 'out/viewer/render-look/a6-perf-333k.json';
const LIVE_TIMING = 'out/viewer/live-client/bracket.json';
const CORPUS = 'out/corpus/summary.json';
const INTEGRATION_DIR = 'tmp/viewer/integration';
const INTEGRATION_OUT = 'out/viewer/integration';
const INTEGRATION_PREV = `${INTEGRATION_DIR}/previous-run`;
/** An integration artefact: the running QA's copy in out/, else the previous run's (the stage moves it). */
const intFile = (name) => [`${INTEGRATION_OUT}/${name}`, `${INTEGRATION_PREV}/${name}`].find((rel) => existsSync(join(REPO, rel))) ?? null;
const LIVE_LOG = intFile('terminal-live.txt');
const CONTRAST = intFile('contrast.txt');
const API_CLI = intFile('api-cli.json');
const pkgDoc = (key) => `${D}/package-${key}.md`;

const cache = new Map();
const read = (rel) => {
  if (!cache.has(rel)) cache.set(rel, readFileSync(join(REPO, rel), 'utf8'));
  return cache.get(rel);
};
/**
 * First capture group of `re` in a repo file; throws when the source text drifted.
 * Markdown wraps sentences, so whitespace runs match a single space unless the
 * regex is line-anchored (`m` flag).
 */
function grab(rel, re, group = 1) {
  const text = re.flags.includes('m') ? read(rel) : read(rel).replace(/\s+/g, ' ');
  const m = text.match(re);
  if (!m) throw new Error(`viewer report: ${re} not found in ${rel}`);
  return m[group];
}
/** "10,404" / "9.07" (English source notation) → Number. */
const num = (s) => Number(String(s).replace(/,/g, ''));
/** English decimal notation inside prose → German ("8.00000" → "8,00000"). */
const de = (s) => String(s).replace(/(\d)\.(\d)/g, '$1,$2').replace(/(\d) to (\d)/g, '$1 bis $2');
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const hhmm = (d) => d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
/** ["a", "b", "c"] → "a, b und c". */
const listDe = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} und ${xs.at(-1)}`);

// ── spec: packages, waves, acceptance counts ─────────────────────────────────
const spec = read(SPEC);
const waveText = spec.slice(spec.indexOf('- **Wave 1**'), spec.indexOf('Nobody edits'))
  .replace(/\n[ \t]+/g, ' ');
const waves = [...waveText.matchAll(/- \*\*Wave (\d)\*\*[^:\n]*: ([^\n]+)/g)].map(([, w, list]) => ({
  wave: Number(w),
  keys: list.replace(/\.\s*$/, '').split(/,\s*/).map((s) => s.trim()),
}));
const pkgBlocks = new Map(
  [...spec.matchAll(/^\*\*([a-z0-9-]+) \((P\d)\)\.\*\*([\s\S]*?)(?=^\*\*[a-z0-9-]+ \(P\d\)\.\*\*|^#{2,3} )/gm)]
    .map(([, key, prio, body]) => [key, { prio, criteria: (body.split('Acceptance:')[1] || '').match(/^\d+\. /gm)?.length ?? 0 }]),
);
const packages = waves.flatMap(({ wave, keys }) => keys.map((key) => {
  const block = pkgBlocks.get(key);
  if (!block) throw new Error(`viewer report: package ${key} has no spec block`);
  const doc = pkgDoc(key);
  const delivered = existsSync(join(REPO, doc));
  const conditional = delivered && /pass \((field needs|workspace `sources`)|needs integration step|pass with integration request|hold only with the patch|pass for this package; see note|pass for selection and measurement/.test(read(doc));
  return { key, wave, ...block, doc, delivered, conditional };
}));
const delivered = packages.filter((x) => x.delivered);
if (packages.length !== 16) console.warn(`note: spec lists ${packages.length} packages`);

// ── audit: the 8 daily-use tasks ─────────────────────────────────────────────
const taskRows = read(DAILY).split('\n').filter((l) => /^\| [1-8] \| /.test(l)).map((l) => {
  const c = l.split('|').slice(1, -1).map((s) => s.trim());
  if (c.length !== 7) throw new Error(`viewer report: task row has ${c.length} cells: ${l.slice(0, 60)}`);
  const [n, task, possible, , time, , severity] = c;
  const st = /^\*\*No\*\*|^No/.test(possible) ? 'nein' : /^Partly/.test(possible) ? 'teil' : /^Yes/.test(possible) ? 'ja' : null;
  if (!st) throw new Error(`viewer report: unknown status "${possible}"`);
  return { n: Number(n), task, possible, time, severity, st };
});
const SEV = { High: 'hoch', 'Medium–high': 'mittel bis hoch', Medium: 'mittel', 'Low–medium': 'niedrig bis mittel' };
const sevDe = (s) => {
  const [, base, extra] = s.match(/^([^(]+?)\s*(?:\(([^)]+)\))?$/);
  const x = { 'adoption blocker': 'Blocker für den Umstieg', FDM: 'für FDM' }[extra] ?? extra;
  return `${SEV[base] ?? base}${x ? `, ${x}` : ''}`;
};
const taskTime = (n, re) => grab(DAILY, new RegExp(`^\\| ${n} \\|[^\\n]*?${re.source}`, 'm'));

// ── measured numbers ─────────────────────────────────────────────────────────
const bench = readJson(BENCH);
const benchModel = (label) => bench.models.find((m) => m.open?.label === label) ?? (() => { throw new Error(`bench: ${label}`); })();
const stress = benchModel('stress-r10b-8x8');
const r10bOld = benchModel('r10b-retained');
const transport = readJson(TRANSPORT);
const stressPick = readJson(STRESS_PICK);
const lookPerf = readJson(LOOK_PERF);
const liveTiming = readJson(LIVE_TIMING).timing;
const corpus = readJson(CORPUS);

const saveToPaint = liveTiming.medianSaveToPaintedMs;
const saveRuns = liveTiming.runs.length;
const pickBefore = stress.hover.pick.p50; // ms, per hover, old CPU picker
const pickAfterRuns = stressPick.runs.map((r) => r.medianMs); // all 0 at 0.1 ms timer resolution
const PICK_TIMER = num(grab(pkgDoc('render-transport'), /\(timer resolution ([\d.]+) ms\)/));
const pickAfterBound = Math.max(...pickAfterRuns, PICK_TIMER); // upper bound (timer resolution)
const pickBatch = stressPick.batch.median;
const stressTris = stressPick.model.counts.triangles;
const lookDefault = lookPerf.runs.filter((r) => r.mode === 'default' && !r.sync);
const gpuAfter = median(lookDefault.map((r) => r.gpuMedianMs));
const cpuAfter = median(lookDefault.map((r) => r.cpuMedianMs));
const gpuBefore = stress.orbit.gpu.p50;
const frameBudget = num(grab(SPEC, /Frame median ≤ (\d+) ms at 333k/));
const xrayMs = grab(pkgDoc('render-look'), /X-ray on the 333k scene costs ([\d.]+) ms/);

const MB = 1e6;
const r10bJson = r10bOld.transfer.bytes / MB;
const r10bDraw = transport.drawPayload.rawBytes / MB;
const r10bGzip = transport.drawPayload.gzipBytes / MB;
const stressJson = stress.transfer.bytes / MB;
const stressDraw = stressPick.model.bytes / MB;
const stressWire = stressPick.model.transferSize / MB;

const edgeBefore = grab(RENDER_AUDIT, /Edges are 1 device pixel, which is ([\d.]+) CSS px on Retina/);
const edgeContrastBefore = grab(RENDER_AUDIT, /Their contrast to the faces\s+is ([\d.]+ to [\d.]+):1/);
const edgeAfter = grab(pkgDoc('render-look'), /median ([\d.]+) CSS px, P10/);
const edgeContrastAfter = grab(pkgDoc('render-look'), /worst contrast ([\d.]+):1/);
const hoverDeBefore = grab(RENDER_AUDIT, /Hover is\s+hard to see: ΔE (\d+)/);
const hoverDeAfter = grab(pkgDoc('render-look'), /CIE76 ΔE ([\d.]+) and/);
const farAbs = grab(pkgDoc('render-transport'), /absolute float32 coordinates would be off by ([\d.]+) px/);
const farNow = grab(pkgDoc('render-transport'), /differ by at most ([\d.]+) px/);
const r10bPickBefore = r10bOld.hover.pick.p50;

// topology: raw vs logical faces, straight from the package table
const topoRows = read(pkgDoc('topology-classes')).split('\n')
  .filter((l) => /^\| [a-z]/.test(l) && !/^\| Model/.test(l))
  .map((l) => l.split('|').slice(1, -1).map((s) => s.trim()))
  .map(([model, raw, logical]) => ({ model: model.replace('bodies', 'Körper'), raw: Number(raw), logical: Number(logical) }));
const topoChanged = topoRows.filter((r) => r.raw !== r.logical);
const topoSame = topoRows.filter((r) => r.raw === r.logical);

// quoted UI strings (verbatim from the package evidence)
const q = {
  hover: grab(pkgDoc('exact-measure'), /(Cylinder hole Ø[\d.]+ mm · exact ±[\d.]+)/),
  offset: grab(pkgDoc('exact-measure'), /(Parallel offset [\d.]+ mm · exact ±[\d.]+)/),
  thick: grab(pkgDoc('thickness-probe'), /reads `([\d.]+ mm kernel)/),
  gap: grab(SPEC, /pin-in-bore: radial gap ([\d.]+ mm)/),
  radialGap: grab(pkgDoc('exact-measure'), /`(Radial gap [\d.]+ mm exact ±[\d.]+)`/),
  pinBore: grab(pkgDoc('exact-measure'), /Ø([\d.]+) mm bore and a separate/),
  skarc: grab(pkgDoc('source-links'), /headline `(skArc "right" · line \d+)`/),
  helper: grab(SPEC, /reads "(copyBody \(line \d+\) called from r10b\.fs:\d+)"/),
  floats: grab(pkgDoc('fdm'), /"B1 (floats [\d.]+ mm above the plate)/),
  banner: grab(pkgDoc('live-client'), /"(Showing last good r2\. Source now fails: [^"]+)"/),
  cancelMs: grab(pkgDoc('live-server'), /`build-cancelled` (\d+) ms after the second save/),
  plate: grab(SPEC, /Bambu A1 (\d+ × \d+) mm/),
  alpha: grab(SPEC, /cad-khana convention, default (\d+)°/),
  bridge: grab(SPEC, /bridge exemption \(≤ (\d+) mm\) not applied/),
  bore: grab(SPEC, /hole cylinders with Ø ≤ (\d+) mm are exempt/),
  tol: grab(SPEC, /display envelope ±([\d.]+) mm/),
  debounce: grab(SPEC, /fs\.watch`, (\d+) ms debounce/),
  grace: grab(SPEC, /after at most (\d+) ms\s+grace/),
  fdmChecks: grab(pkgDoc('fdm'), /Final QA pass: (\d+ of \d+) checks/),
  camChecks: grab(pkgDoc('camera-navigation'), /Final run [^,]+, (\d+\/\d+) checks/),
  topoChecks: grab(pkgDoc('topology-classes'), /(\d+\/\d+) checks in `qa-results\.json`/),
  arrows: grab(SPEC, /Arrows orbit (15°, Ctrl 5°, Shift 90°)/),
  port: grab(pkgDoc('live-server'), /Derived stable port \((4400 \+ SHA-256 of the real path mod 100)/),
  oldPort: grab(SPEC, /CLI-02 default port (\d+)/),
  apiWorkspace: grab(DAILY, /`GET \/api\/workspace` takes ([\d–]+) ms/),
  apiEntity: grab(DAILY, /entity detail about (\d+) ms/),
  dark: grab(pkgDoc('render-look'), /reach ([\d.]+ to [\d.]+):1 against/),
  contrastMin: grab(SPEC, /every text ≥ ([\d.]+):1 and ≥ (\d+) px/),
  contrastPx: grab(SPEC, /every text ≥ [\d.]+:1 and ≥ (\d+) px/),
  maxEntities: grab(pkgDoc('exact-measure'), /At most (\d+) entities are measured/),
  auditDate: grab(DAILY, /^Date: ([^.]+)\./m),
  specRev: grab(SPEC, /binding spec for the viewer rework, (revision \d+, \d{4}-\d\d-\d\d)/),
  foundationDone: grab(FOUNDATION, /section 11, done (\d{4}-\d\d-\d\d)/),
  auditCount: grab(SPEC, /Inputs:\s+the (\w+) audits/),
};
const AUDIT_COUNT = { six: 6, five: 5, seven: 7 }[q.auditCount] ?? q.auditCount;
const specRevNo = q.specRev.match(/revision (\d+)/)[1];

// Load averages the audits and package reports quote ("load 46 to 124", "Load average 13").
const loads = [...[DAILY, RENDER_AUDIT, ...readdirSync(join(REPO, D)).filter((f) => /^package-.*\.md$/.test(f)).map((f) => `${D}/${f}`)]
  .flatMap((rel) => [...read(rel).matchAll(/\bload(?: averages?)? (\d+(?:\.\d+)?)(?: to (\d+(?:\.\d+)?))?/gi)])
  .flatMap((m) => [m[1], m[2]].filter(Boolean).map(Number))];
const loadMin = Math.min(...loads), loadMax = Math.max(...loads);

// ── integration: scratch output of the stage that merges the 16 packages ─────
const exists = (rel) => existsSync(join(REPO, rel));
const mtime = (rel) => statSync(join(REPO, rel)).mtime;
const ls = (rel) => (exists(rel) ? readdirSync(join(REPO, rel)) : []);

/** node --test TAP summaries: baseline, intermediate and latest run. */
const testRuns = ls(INTEGRATION_DIR).filter((f) => /^(baseline-tests|tests-[\w-]+)\.txt$/.test(f)).map((f) => {
  const rel = `${INTEGRATION_DIR}/${f}`;
  const t = read(rel);
  const n = (k) => Number(t.match(new RegExp(`^# ${k} (\\d+)`, 'm'))?.[1]);
  const failing = [...t.matchAll(/^not ok \d+ - (.+)\n([\s\S]*?)(?=^(?:ok|not ok|# Subtest)|$(?![\s\S]))/gm)].map(([, name, block]) => {
    const quoted = block.match(/^\s+error: '(.+)'$/m)?.[1];
    const multi = block.match(/^\s+error: \|-\n((?:\s{4}.*\n)+)/m)?.[1].split('\n').map((s) => s.trim()).filter(Boolean).pop();
    return { name, error: quoted ?? multi ?? '' };
  });
  return { rel, at: mtime(rel), tests: n('tests'), pass: n('pass'), fail: n('fail'), failing, baseline: f.startsWith('baseline') };
}).filter((r) => Number.isFinite(r.tests)).sort((a, b) => a.at - b.at);
const lastTests = testRuns.at(-1) ?? null;
const baseTests = testRuns.find((r) => r.baseline) ?? null;

/**
 * Browser QA runs of the integrated viewer. A run is a results JSON (results*.json, with
 * startedAt/finishedAt) or a console log (qa-run*.log, "EXIT n" when done); the same run can
 * appear as both. The stage deletes out/ at the start of a run, so the logs are the history.
 */
const qaStep = (session, n, name, ok, detail, load) => ({ key: `${session} ${n}`, session, n, name, ok, detail: detail ?? {}, load: Number(String(load ?? '').match(/[\d.]+/)?.[0]) });
const qaRuns = [];
function addRun(run) {
  const twin = qaRuns.find((x) => Math.abs(x.at - run.at) < 90e3);
  if (!twin) qaRuns.push(run);
  else if (run.kind === 'json' && (twin.kind !== 'json' || run.complete)) Object.assign(twin, run);
}
for (const rel of [INTEGRATION_DIR, INTEGRATION_PREV, INTEGRATION_OUT].flatMap((dir) => ls(dir).filter((f) => /^results.*\.json$/.test(f)).map((f) => `${dir}/${f}`))) {
  let j;
  try { j = readJson(rel); } catch { continue; } // being rewritten by a running QA
  if (!/^wonky\.viewer-integration-qa\//.test(j.schema ?? '')) continue;
  const steps = j.steps.flatMap((x) => { const m = x.name.match(/^(\d\d) (.+)$/); return m ? [qaStep(x.session, m[1], m[2], x.ok, x.detail, x.load)] : []; });
  // The harness merges targeted reruns into the same file: mtime after finishedAt marks them.
  const rerunUntil = j.finishedAt && mtime(rel) - Date.parse(j.finishedAt) > 60e3 ? mtime(rel) : null;
  addRun({ kind: 'json', rel, at: new Date(j.startedAt), complete: Boolean(j.finishedAt), steps, rerunUntil });
}
for (const f of ls(INTEGRATION_DIR).filter((x) => /^qa-run.*\.log$/.test(x))) {
  const rel = `${INTEGRATION_DIR}/${f}`;
  const text = read(rel);
  // The log truncates long detail JSON, so the name ends at " {" and the JSON is optional.
  const steps = [...text.matchAll(/^(ok|FAIL)\s+(\w+) (\d\d) ([^{\n]+?)(?: (\{.*))?$/gm)].map(([, ok, session, n, name, json]) => {
    let detail = {};
    try { detail = JSON.parse(json ?? '{}'); } catch { /* truncated detail */ }
    return qaStep(session, n, name, ok === 'ok', detail);
  });
  addRun({ kind: 'log', rel, at: statSync(join(REPO, rel)).birthtime, complete: /^EXIT \d+$/m.test(text), steps });
}
qaRuns.sort((a, b) => a.at - b.at);
const FULL_RUN = 20; // a run with fewer numbered steps is a targeted rerun, not a full QA pass
const qaFull = qaRuns.filter((r) => r.complete && r.steps.length >= FULL_RUN);
const qaRun = qaFull.at(-1) ?? qaRuns.filter((r) => r.complete).at(-1) ?? null;
const qaLater = qaRun ? qaRuns.filter((r) => r.at > qaRun.at && !r.complete) : [];
const qaByKey = new Map((qaRun?.steps ?? []).map((x) => [x.key, { ...x, at: qaRun.at, rel: qaRun.rel }]));
const QA_SESSIONS = [
  ['static', 'Einzelfunktionen'],
  ['live', 'Live-Sitzung: speichern, Fehler, Neustart'],
  ['slow', 'Langsamer Build: Abbrechen, Fehler im Helfer'],
];
const qaOf = (session) => [...qaByKey.values()].filter((x) => x.session === session).sort((a, b) => a.n.localeCompare(b.n));
const qaAll = QA_SESSIONS.flatMap(([session]) => qaOf(session));
const qaOk = qaAll.filter((x) => x.ok).length;
const qaFail = qaAll.filter((x) => !x.ok);
const qaSrc = qaRun ? [qaRun.rel] : [];
const liveSave = Number.isFinite(qaByKey.get('live 02')?.detail.saveToModelMs) ? qaByKey.get('live 02') : null;
/** Absolute paths from result details → repo-relative or bare file name (the drafts are public). */
const scrub = (t) => String(t).replaceAll(`${REPO}/`, '').replace(/\/(?:Users|home)\/[^\s'"]+/g, (m) => basename(m));

// German labels for the QA steps (short form for the task matrix, long form for the list).
const QA_DE = {
  'static 01': ['Start', 'Start auf einem Modell'],
  'static 02': ['Verträge', 'Verträge gegen den laufenden Viewer'],
  'static 03': ['Ansichten', 'Ansichtstasten, Menü, Projektion, Einpassen'],
  'static 04': ['Pick', 'Pick in Perspektive landet unter dem Zeiger'],
  'static 05': ['Hover', 'Hover über Bohrung: exakte Statuszeile'],
  'static 06': ['Bohrung', 'Klick auf Bohrung: exakte Geometrie, Quelle'],
  'static 07': ['Messen', 'Wände per Shift-Klick messen, Maßlinie'],
  'static 08': ['Wandstärke', 'Wandstärke mit `K`'],
  'static 09': ['Schnitt', 'Schnitt `X` mit Deckflächen'],
  'static 10': ['FDM', 'FDM-Platte und Overhang-Legende'],
  'static 11': ['Teilebaum', 'Teilebaum: Tab, Auge, `Shift+Y`'],
  'static 12': ['Vergleich', 'Vergleich: `W`, Delta-Leiste, Layouts'],
  'static 13': ['Quelle', 'Quell-Links: Skizzen-Element zuerst, Quell-Schublade'],
  'static 14': ['Review', 'Review: Kommentar, Speichern, LLM-Kontext'],
  'static 15': ['Hilfe', 'Hilfe und Einstellungen'],
  'static 16': ['Checks', 'Checks-Tab und Berichte'],
  'static 17': ['Farben', 'r10b-retained: Modellfarben und Teile'],
  'static 18': ['WebGL', 'WebGL-Kontextverlust und Wiederherstellung'],
  'static 19': ['Dunkel', 'Dunkelmodus und Fensterbreiten'],
  'static 20': ['Kontrast', 'Kontrast-Audit hell und dunkel'],
  'static 21': ['Extras', 'Extras: Suche, Refresh, Werkzeuge, Undo, Tausch, Split, Kopieren'],
  'live 01': ['Build r1', 'Erster Build: „Current r1“, Teile, Druckplatte'],
  'live 02': ['Speichern', 'Speichern: r2 in unter 1 s, Kamera bleibt, Delta-Leiste'],
  'live 03': ['Fehler', 'Syntaxfehler: Banner mit Datei:Zeile:Spalte, letztes gutes Modell bleibt'],
  'live 04': ['Korrektur', 'Korrektur: „Current r4“, `W` vergleicht mit der Vorversion'],
  'live 05': ['Ghost', 'Ghost `Shift+W` mit Delta aus Kernel und Aufzeichnung'],
  'live 06': ['Follow', 'Follow aus (`L`): „available“, `L` holt wieder auf'],
  'live 07': ['LLM', 'LLM-Kontext einer Live-Revision kopieren'],
  'live 08': ['Neustart', 'Server-Neustart: der Tab verbindet sich neu, kein neuer Tab'],
  'live 09': ['Inspect', 'Kopierte `wonky-inspect`-Befehle laufen nach dem Server-Stopp'],
  'slow 01': ['Abbrechen', 'Langsamer Build: Phase, Zeit, Abbrechen behält das letzte gute Modell'],
  'slow 02': ['Helfer', 'Fehler im Helfer: Banner mit Datei:Zeile:Spalte und Aufrufer'],
  'slow 03': ['Trust-Chip', 'Trust-Chip bleibt bei 1100, 900 und 650 px sichtbar'],
};
const qaShort = (s) => QA_DE[s.key]?.[0] ?? s.name;
const qaLong = (s) => QA_DE[s.key]?.[1] ?? s.name;

const contrast = CONTRAST
  ? [...read(CONTRAST).matchAll(/^(light|dark): (\d+) texts in (\d+) states, (\d+) below ([\d.]+):1/gm)]
    .map(([, mode, texts, states, below, min]) => ({ mode, texts: Number(texts), states: Number(states), below: Number(below), min }))
  : [];
/** What the result file says about a red step, in German; empty when it does not say. */
function qaFinding(s) {
  const d = s.detail;
  if (d.error) return /timed out/i.test(d.error) ? `Zeitüberschreitung: „${scrub(d.error)}“` : `Prüfung brach ab: „${scrub(d.error)}“`;
  if (/Kernel section failed[^.]*/.test(d.exact ?? '')) return `exakte Kontur: „${d.exact.match(/Kernel section failed[^.]*/)[0]}“`;
  if (Array.isArray(d.tail) && d.tail.some((l) => /:1 /.test(l))) {
    const ratios = d.tail.flatMap((l) => [...l.matchAll(/(\d+\.\d+):1/g)].map((m) => Number(m[1])));
    const after = contrast.length && mtime(CONTRAST) > s.at ? ` Danach neu gemessen (${hhmm(mtime(CONTRAST))}): ${contrast.map((c) => `${c.mode === 'light' ? 'hell' : 'dunkel'} ${fmt.num(c.below)} von ${fmt.num(c.texts)} Texten`).join(', ')} unter ${de(contrast[0].min)}:1.` : '';
    return `Achsen-Triade nur ${fmt.num(Math.min(...ratios), 2)} bis ${fmt.num(Math.max(...ratios), 2)}:1.${after}`;
  }
  if (typeof d.back === 'string' && d.disconnected) return `Getrennt („${d.disconnected}“), danach zeigt der Tab wieder „${d.back}“; welche Teilprüfung rot war, steht nicht im Ergebnis.`;
  const value = (d.measurement ?? '').match(/Parallel offset ?([\d.]+ mm) ?exact/);
  if (value) return `Messwert erscheint („Parallel offset ${value[1]} exact“); welche Teilprüfung rot war, steht nicht im Ergebnis.`;
  return 'Welche Teilprüfung rot war, steht nicht im Ergebnis.';
}

const apiCli = API_CLI ? readJson(API_CLI).rows : [];

/** Terminal log of the live QA session: one entry per revision line. */
const liveSessions = LIVE_LOG
  ? read(LIVE_LOG).split(/^(?=wonky-view )/m).filter((s) => s.trim()).map((chunk) => {
    const lines = chunk.split('\n');
    const revs = [];
    for (const [i, line] of lines.entries()) {
      const ok = line.match(/^(r\d+) ok ([\d.]+) s · (?:.* · )?(\d+×\d+×\d+ mm)/);
      const failed = line.match(/^(r\d+) FAILED (\w+) (\S+?):(\d+):(\d+) (.+)$/);
      if (ok) {
        const cold = lines.slice(0, i).some((l) => l.startsWith(`${ok[1]} building`) && /cold worker/.test(l));
        const fresh = i > 0 && lines.slice(0, i).reverse().find((l) => /^r\d+ (ok|FAILED|building)/.test(l) || /recycled/.test(l))?.includes('recycled');
        revs.push({ rev: ok[1], ok: true, s: Number(ok[2]), size: ok[3], cold, fresh });
      } else if (failed) {
        revs.push({ rev: failed[1], ok: false, kind: failed[2], where: `${basename(failed[3])}:${failed[4]}:${failed[5]}`, message: failed[6], keeps: lines[i + 1]?.match(/showing last good (r\d+)/)?.[1] });
      }
    }
    return { revs, resumed: /^r0 previous session/m.test(chunk) };
  })
  : [];
const liveFirst = liveSessions[0]?.revs ?? [];
const liveFail = liveFirst.find((r) => !r.ok);

/** Viewer code in git: the rework commit (the newest one after the initial import), and what changed since. */
const git = (...args) => execFileSync('git', args, { cwd: REPO, encoding: 'utf8' }).trim();
const VIEWER_PATHS = ['viewer', 'src/viewer', 'src/review-server.mjs', 'bin/wonky-view.mjs'];
const viewerLog = git('log', '--since', '2026-09-22', '--format=%h|%aI|%s', '--', ...VIEWER_PATHS).split('\n').filter((l) => l && !/\|Initial import/.test(l));
const viewerCommits = viewerLog.length;
const parseCommit = (line) => { const [hash, at, subject] = line.split('|'); return { hash, at: new Date(at), subject }; };
const viewerCommit = viewerLog.length ? parseCommit(viewerLog.at(-1)) : null; // the rework itself
const followUp = viewerLog.length > 1 ? parseCommit(viewerLog[0]) : null; // newest fix commit after it
/** What the follow-up commit message says it fixed: bullets under "Measurement:" and "Live loop:". */
const FU = (() => {
  if (!followUp) return null;
  const body = git('show', '-s', '--format=%B', followUp.hash);
  const bullets = (head) => (body.split(new RegExp(`^${head}:\\s*$`, 'm'))[1] ?? '').split(/\n\s*\n/)[0].split('\n').filter((l) => /^- /.test(l)).length;
  const one = body.replace(/\s+/g, ' ');
  return {
    measure: bullets('Measurement'), live: bullets('Live loop'),
    bothHigh: /no longer deadlock the worker pool/.test(one) && /old coaxial formula stated wrong exact values for off-axis holes/.test(one),
    tests: one.match(/(\d+\/\d+) viewer and review tests pass/)?.[1] ?? null,
  };
})();
const viewerDirty = git('status', '--porcelain', '--', ...VIEWER_PATHS, 'docs/viewer', 'docs/viewer-ui.md').split('\n').filter(Boolean).length;
const committed = Boolean(viewerCommit);

// Newest integration file: the "Zwischenstand" time.
const integrationFiles = [
  ...ls(INTEGRATION_DIR).filter((f) => /\.(txt|json|md)$/.test(f)).map((f) => `${INTEGRATION_DIR}/${f}`),
  ...ls(INTEGRATION_OUT).filter((f) => /\.(txt|json|png)$/.test(f)).map((f) => `${INTEGRATION_OUT}/${f}`),
  ...ls(INTEGRATION_PREV).filter((f) => /\.(txt|json|png)$/.test(f)).map((f) => `${INTEGRATION_PREV}/${f}`),
];
const integrationAt = integrationFiles.length ? new Date(Math.max(...integrationFiles.map((f) => mtime(f).getTime()))) : null;
const integrationDoc = ['docs/viewer/integration.md', 'docs/viewer/package-integration.md'].find(exists) ?? null;

// ── the committed state: checks in the user guide, open defects in the spec ──
const UI = 'docs/viewer-ui.md';
const V = committed ? {
  qa: grab(UI, /\*\*Browser-QA\*\* .*?\*\*(\d+ von \d+) Schritten bestanden\*\*/),
  fix1: grab(UI, /\*\*Fix-Runde\*\* .*?\*\*(\d+ von \d+) Schritten bestanden\*\*/),
  fix2: grab(UI, /\*\*Fix-Runde 2\*\* .*?\*\*statisch (\d+ von \d+), live (\d+ von \d+) Schritten bestanden\*\*/, 0).match(/statisch (\d+ von \d+), live (\d+ von \d+)/).slice(1),
  api: grab(UI, /\*\*CLI und API\*\* .*?: (\d+ von \d+) Zeilen bestanden/),
  tests: grab(UI, /\*\*Tests\*\* .*?\*\*(\d+ von \d+) bestanden\*\*/),
  round: grab(SPEC, /The (\w+) verification round left the following open/),
  rollout: grab(SPEC, /the viewers already running on (\d+ and \d+) still serve the old server code/),
} : null;
const ROUND_DE = { first: 'ersten', second: 'zweiten', third: 'dritten', fourth: 'vierten' }; // dative
const ROUND_NOM = { first: 'erste', second: 'zweite', third: 'dritte', fourth: 'vierte' };
/** "Open defects at the first commit" (spec): high/medium items, and which the follow-up marks as fixed. */
const openDefects = (() => {
  const sec = spec.split(/^## Open defects at the first commit[^\n]*\n/m)[1]?.split(/^## /m)[0];
  if (!sec) return null;
  const items = [];
  let top = null;
  for (const l of sec.split('\n')) {
    let m;
    if ((m = l.match(/^- \*\*([^*:]+?):?\*\*:?\s*(.*)$/))) { top = m[1].split(',')[0]; if (m[2].trim()) items.push({ sev: top, text: m[2] }); continue; }
    if ((m = l.match(/^ {2}- (.*)$/)) && top) { items.push({ sev: top, text: m[1] }); continue; }
    if (/^\s+\S/.test(l) && items.length) items[items.length - 1].text += ` ${l.trim()}`;
  }
  const of = (sev) => items.filter((i) => i.sev === sev);
  const fixed = (xs) => xs.filter((i) => /\*Fixed/.test(i.text));
  return { high: of('high').length, highFixed: fixed(of('high')).length, medium: of('medium').length, mediumFixed: fixed(of('medium')).length };
})();
if (committed && !openDefects) throw new Error('viewer report: spec has no "Open defects at the first commit" section; update the report');
const specDirty = git('status', '--porcelain', '--', SPEC) !== '';

// ── screenshots ──────────────────────────────────────────────────────────────
const ASSETS = 'out/reports/_assets/viewer';
mkdirSync(join(REPO, ASSETS), { recursive: true });
// AVIF, not JPEG: Postplan rejects drafts over 512 KiB, and JPEG q60 put this page at 1.2 MB.
// AVIF q50 is about a third of JPEG q60 at the same width and looks the same on UI text.
// Needs Safari 16+, Chrome 85+ or Firefox 93+.
const SHOT_FORMAT = 'avif';
const SHOT_QUALITY = 50;
const NATIVE_QUALITY = 80; // small UI crops at native size: text edges stay crisp
const pxWidth = (rel) => Number(execFileSync('sips', ['-g', 'pixelWidth', join(REPO, rel)], { encoding: 'utf8' }).match(/pixelWidth: (\d+)/)[1]);
/** Crop (x, y, w, h in source pixels) with sips into ASSETS; returns the repo-relative crop. */
function cropTo(rel, [x, y, w, h]) {
  const out = `${ASSETS}/${rel.replace(/^out\/viewer\//, '').replace(/[/.]/g, '_')}-${x}-${y}-${w}-${h}.png`;
  // sips treats a 0 offset as "centered"; 1 px off the edge is invisible.
  execFileSync('sips', ['--cropOffset', String(Math.max(1, y)), String(Math.max(1, x)), '-c', String(h), String(w), join(REPO, rel), '--out', join(REPO, out)], { stdio: 'ignore' });
  return out;
}
/**
 * Embed a screenshot, optionally cropped. Default: SHOT_FORMAT at SHOT_QUALITY, at most maxWidth px.
 * `native: true` keeps a small UI crop at its native pixel size (no resampling) at NATIVE_QUALITY.
 */
function shot(rel, { crop, alt, caption, maxWidth = 920, native = false }) {
  const src = crop ? `\`${rel}\` (Ausschnitt)` : rel;
  const use = crop ? cropTo(rel, crop) : rel;
  const quality = native ? NATIVE_QUALITY : SHOT_QUALITY;
  const out = `${ASSETS}/${basename(use, '.png')}-${native ? 'native' : `w${maxWidth}`}-q${quality}.${SHOT_FORMAT}`;
  const resample = !native && pxWidth(use) > maxWidth ? ['--resampleWidth', String(maxWidth)] : [];
  execFileSync('sips', [...resample, '-s', 'format', SHOT_FORMAT, '-s', 'formatOptions', String(quality), join(REPO, use), '--out', join(REPO, out)], { stdio: 'ignore' });
  return image(out, { alt, caption, maxKB: 120, src });
}
/** The <img> of an image() figure, for composite figures. */
const imgTag = (figure) => figure.match(/<img [^>]*>/)[0];
const pair = (a, b) => `<div class="pair">${a}${b}</div>`;
const pxSize = (rel) => {
  const out = execFileSync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', join(REPO, rel)], { encoding: 'utf8' });
  return `${out.match(/pixelWidth: (\d+)/)[1]} × ${out.match(/pixelHeight: (\d+)/)[1]}`;
};

// ── custom blocks (styles appended to the kit's stylesheet below) ───────────
const ST = {
  nein: 'nein',
  teil: 'teilweise',
  ja: 'ja, mit Reibung',
  pass: 'Abnahme bestanden',
};
const stChip = (k) => `<span class="st st-${k}"><i aria-hidden="true"></i>${esc(ST[k])}</span>`;

/** One line per task: how the integrated state did in the browser QA (live log as fallback for task 4). */
function integrationLine(r) {
  const steps = r.qa.map((k) => qaByKey.get(k)).filter(Boolean);
  if (!steps.length && r.n === 4 && liveFirst.length) {
    const warm = liveFirst.filter((x) => x.ok && !x.cold).map((x) => x.s);
    return `<p class="tm-int"><span>Integrierter Stand, Live-Log ${hhmm(mtime(LIVE_LOG))}:</span> ${warm.length ? `Builds ${fmt.num(Math.min(...warm), 2)} bis ${fmt.num(Math.max(...warm), 2)} s` : ''}${liveFail ? `, Fehler bei <code>${esc(liveFail.where)}</code>, ${esc(liveFail.keeps ?? '')} bleibt stehen` : ''}. Kein gespeichertes Prüfergebnis.</p>`;
  }
  if (!steps.length) return '';
  const at = new Date(Math.max(...steps.map((s) => s.at.getTime())));
  return `<p class="tm-int"><span>Integrierter Stand, Browser-QA ${esc(hhmm(at))}:</span> ${steps.map((s) => `<b class="${s.ok ? 'qa-ok' : 'qa-bad'}">${s.ok ? '✓' : '✕'} ${esc(qaShort(s))}</b>`).join(' ')}</p>`;
}

function taskMatrix(rows) {
  const head = '<li class="tm-row tm-head" aria-hidden="true"><span>Aufgabe aus deinem Alltag</span><span>Audit 22.09.</span><span>Jetzt: Paket-Abnahme, dazu integrierter Stand</span></li>';
  const body = rows.map((r) => `<li class="tm-row"><div class="tm-task"><span class="tm-n">Aufgabe ${r.n}</span><strong>${inline(r.name)}</strong><span class="tm-sev">Gewicht im Audit: ${esc(r.sev)}</span></div><div class="tm-cell" data-label="Audit 22.09.">${stChip(r.st)}<p>${inline(r.before)}</p></div><div class="tm-cell tm-now" data-label="Jetzt (Paket-Abnahme)">${stChip('pass')}<p>${inline(r.after)}</p><p class="tm-pk">${r.pkgs.map((k) => `<code>${esc(k)}</code>`).join(' ')}</p>${integrationLine(r)}</div></li>`);
  const legend = `<div class="tm-legend">${['nein', 'teil', 'ja', 'pass'].map(stChip).join('')}<span class="st"><b class="qa-ok">✓</b>/<b class="qa-bad">✕</b> Schritt der Browser-QA am integrierten Stand</span></div>`;
  return `${legend}<ol class="tm">${head}${body.join('')}</ol>`;
}

/** One cell per QA step and session: filled = bestanden, outlined ✕ = rot. Table twin in a details block. */
function qaStrip() {
  if (!qaAll.length) return '';
  const strips = QA_SESSIONS.map(([session, label]) => {
    const list = qaOf(session);
    if (!list.length) return '';
    const cells = list.map((s) => `<li class="${s.ok ? 'ok' : 'bad'}" title="${esc(`${s.n} ${qaLong(s).replaceAll('`', '')}: ${s.ok ? 'bestanden' : 'rot'}`)}"><span class="qa-n">${s.ok ? '' : '✕ '}${esc(s.n)}</span><span class="qa-l">${esc(qaShort(s))}</span></li>`);
    return `<p class="qa-head"><strong>${esc(label)}</strong> <span>${list.filter((s) => s.ok).length} von ${list.length}</span></p><ol class="qa-strip">${cells.join('')}</ol>`;
  });
  const fails = qaFail.map((s) => `<li><strong>${s.session === 'live' ? 'Live ' : ''}${esc(s.n)} ${inline(qaLong(s))}.</strong> ${inline(qaFinding(s))}</li>`);
  const tableHtml = table({
    columns: ['Sitzung', 'Schritt', 'Prüfung', 'Ergebnis'],
    rows: qaAll.map((s) => [s.session, s.n, qaLong(s), s.ok ? 'bestanden' : 'rot']),
  });
  const note = ` · Lauf ${hhmm(qaRun.at)}, der neueste vollständige${qaRun.rerunUntil ? `, einzelne Schritte bis ${hhmm(qaRun.rerunUntil)} wiederholt` : ''}${qaLater.length ? `; ein weiterer läuft seit ${hhmm(qaLater.at(-1).at)}` : ''}`;
  return `<figure class="chart qa"><figcaption><strong>Browser-QA am integrierten Stand: ${qaOk} von ${qaAll.length} Schritten bestanden</strong><span>Chromium headless · gemessen${esc(note)}</span></figcaption><ul class="legend"><li><i class="sw f-s1" aria-hidden="true"></i>bestanden</li><li><i class="sw sw-bad" aria-hidden="true"></i>rot</li></ul>${strips.join('')}${fails.length ? `<ul class="qa-fails">${fails.join('')}</ul>` : ''}${details('Alle Schritte als Tabelle', tableHtml)}${source(qaSrc, ...(contrast.length ? [CONTRAST] : []))}</figure>`;
}

const EXTRA_CSS = `
.tm-legend{display:flex;flex-wrap:wrap;gap:6px 18px;margin:0 0 10px}
.tm{list-style:none;margin:0 0 10px;padding:0;border-top:1.5px solid var(--rule-strong);max-width:none}
.tm-row{display:grid;grid-template-columns:minmax(0,.78fr) minmax(0,1fr) minmax(0,1.22fr);gap:6px 22px;padding:13px 0 14px;border-bottom:1px solid var(--rule);margin:0}
.tm-head{padding:8px 0;font:600 11px/1.3 var(--font-display);letter-spacing:.09em;text-transform:uppercase;color:var(--muted)}
.tm-n{display:block;font:600 10.5px/1.2 var(--font-display);letter-spacing:.09em;text-transform:uppercase;color:var(--muted);margin-bottom:3px}
.tm-task strong{display:block;font-size:16px;line-height:1.3}
.tm-sev{display:block;font-size:12.5px;color:var(--muted);margin-top:4px}
.tm-cell p{font-size:14px;line-height:1.45;margin:6px 0 0;color:var(--ink-2);max-width:none}
.tm-now{border-left:2px solid var(--accent);padding-left:14px}
.tm-now p{color:var(--ink)}
.tm-pk{display:flex;flex-wrap:wrap;gap:4px}
.tm-pk code{font-size:11px;color:var(--ink-2)}
.st{display:inline-flex;align-items:center;gap:6px;font:600 11px/1.2 var(--font-display);letter-spacing:.07em;text-transform:uppercase;color:var(--ink-2);white-space:nowrap}
.st i{width:11px;height:11px;flex:none;display:inline-block}
.st-nein i{background:linear-gradient(45deg,transparent 42%,var(--fail) 42% 58%,transparent 58%),linear-gradient(-45deg,transparent 42%,var(--fail) 42% 58%,transparent 58%)}
.st-teil i{border:1.6px solid var(--warn-line);border-radius:50%;background:linear-gradient(90deg,var(--warn-line) 50%,transparent 50%)}
.st-ja i{border:1.6px solid var(--muted);border-radius:50%}
.st-pass i{background:var(--accent)}
.st-pass{color:var(--ink)}
.pair{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px 20px;margin:0 0 24px;align-items:start}
.pair>.img,.grid>.img{margin:0}
.lead-tiles .tiles{margin-bottom:10px}
.pk-list{list-style:none;padding:0;margin:0}
.pk-list li{padding:7px 0;border-top:1px solid var(--rule);font-size:14px;line-height:1.4;margin:0}
.pk-list li:first-child{border-top:0;padding-top:2px}
.pk-list code{font-size:12px}
.pk-list .pk-meta{display:block;font-size:12px;color:var(--muted);margin-top:2px}
.sub-h{font:640 17px/1.3 var(--font-body);margin:34px 0 6px}
.tm-legend .st b{font:700 12px/1 var(--font-body)}
.tm-cell p.tm-int{font-size:12.5px;line-height:1.6;color:var(--ink-2);margin-top:8px;padding-top:6px;border-top:1px solid var(--rule)}
.tm-int>span{color:var(--muted);margin-right:2px}
.qa-head{font-size:14px;margin:4px 0 8px;max-width:none}
.qa-head span{color:var(--muted);font-size:13px;margin-left:6px}
.tm-int b{font-weight:600;white-space:nowrap;margin-right:6px}
.qa-ok{color:var(--accent)} .qa-bad{color:var(--fail)}
.hero{margin:6px 0 30px}
.hero .pair{margin-bottom:0}
.hero>.img{margin:18px 0 0}
.hero>.nat{margin:18px 0 0}
.nat>.img{margin:0}
.hero .img img{box-shadow:0 1px 0 var(--rule)}
.hero-cap{font-size:13px;color:var(--muted);margin:10px 0 0;max-width:none}
.qa-strip{list-style:none;padding:0;margin:0 0 14px;display:grid;grid-template-columns:repeat(auto-fill,minmax(78px,1fr));gap:4px;max-width:none}
.qa-strip li{margin:0;padding:6px 7px 7px;border-radius:4px;background:var(--s1);color:var(--on-s1);display:flex;flex-direction:column;gap:1px;min-width:0}
.qa-strip li.bad{background:var(--surface);color:var(--fail);box-shadow:inset 0 0 0 1.5px var(--fail)}
.qa-n{font:600 12px/1.2 var(--font-body);font-variant-numeric:tabular-nums}
.qa-l{font-size:11px;line-height:1.25;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.qa-strip li.bad .qa-l{color:var(--ink-2);opacity:1}
.pk-strip{grid-template-columns:repeat(auto-fill,minmax(168px,1fr))}
.pk-strip .qa-l{font:500 12px/1.3 var(--font-mono)}
.pk-strip .qa-n{font-size:11px;font-weight:500}
.qa-strip li.open{background:var(--surface);color:var(--ink-2);box-shadow:inset 0 0 0 1.5px var(--warn-line)}
.sw-open{background:var(--surface);box-shadow:inset 0 0 0 1.5px var(--warn-line);border-radius:50%}
.sw-bad{background:var(--surface);box-shadow:inset 0 0 0 1.5px var(--fail)}
.qa-fails{list-style:none;padding:0;margin:0 0 4px;max-width:none}
.qa-fails li{font-size:14px;line-height:1.45;padding:7px 0 7px 14px;border-top:1px solid var(--rule);margin:0;position:relative}
.qa-fails li::before{content:"✕";position:absolute;left:0;top:7px;color:var(--fail);font-size:11px}
.qa-fails .t-when{color:var(--muted);font-size:12.5px}
.src+.callout,.src+.chart,.src+.grid{margin-top:16px}
.ls-list{list-style:none;padding:0;margin:4px 0 0;max-width:none}
.ls-list li{display:grid;grid-template-columns:minmax(12rem,15rem) minmax(0,1fr);gap:8px 22px;align-items:start;padding:14px 0;border-top:1px solid var(--rule);margin:0}
.ls-list li:first-child{border-top:0;padding-top:6px}
.ls-key{display:block;font:600 10.5px/1.3 var(--font-display);letter-spacing:.09em;text-transform:uppercase;color:var(--muted);margin-bottom:2px}
.ls-k strong{font-size:15px;line-height:1.3;margin-right:8px}
.ls-qa{font-size:12px;font-weight:600;white-space:nowrap}
.ls-k p{font-size:13.5px;line-height:1.45;color:var(--ink-2);margin:4px 0 0;max-width:none}
.ls-img{min-width:0}
.srcs{list-style:none;padding:0;margin:0 0 18px;max-width:none;border-top:1.5px solid var(--rule-strong)}
.srcs li{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:3px 20px;align-items:baseline;padding:8px 0;border-bottom:1px solid var(--rule);margin:0;font-size:14px;line-height:1.4}
.srcs code{font-size:12.5px;justify-self:start;overflow-wrap:anywhere}
.hover-fig img+img{margin-top:8px}
.ls-list li.ls-wide{grid-template-columns:1fr;gap:10px}
.ls-wide .ls-k p{max-width:75ch}
.ls-img img{display:block;max-width:100%;height:auto;border:1px solid var(--rule);border-radius:4px;background:#fff}
@media (max-width:640px){
  .tm-row{grid-template-columns:1fr;gap:10px}
  .tm-head{display:none}
  .tm-cell::before{content:attr(data-label);display:block;font:600 10.5px/1.4 var(--font-display);letter-spacing:.09em;text-transform:uppercase;color:var(--muted);margin-bottom:4px}
  .pair{grid-template-columns:1fr}
  .qa-strip{grid-template-columns:repeat(4,minmax(0,1fr))}
  .pk-strip{grid-template-columns:repeat(2,minmax(0,1fr))}
  .ls-list li{grid-template-columns:1fr}
  .srcs li{grid-template-columns:1fr}
  .nat{overflow-x:auto}
  .nat img{max-width:none}
  .nat figcaption,.nat .src{position:sticky;left:0;max-width:calc(100vw - 48px)}
}
`;

// ── content ──────────────────────────────────────────────────────────────────
const now = new Date();
const stand = `${now.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })}, ${hhmm(now)}`;
const integrationTime = integrationAt ? hhmm(integrationAt) : null;
const testsTxt = lastTests ? `${fmt.num(lastTests.pass)} von ${fmt.num(lastTests.tests)} Tests grün` : null;
const qaTxt = qaAll.length ? `${qaOk} von ${qaAll.length} Browser-Prüfungen bestanden` : null;
const pkgList = (keys) => keys.map(pkgDoc);
const passedCount = delivered.length;
const conditionalCount = delivered.filter((x) => x.conditional).length;
const criteriaTotal = delivered.reduce((a, x) => a + x.criteria, 0);

const TASKS = {
  1: {
    name: 'Teil öffnen und ansehen',
    before: 'Zwei Befehle (CLI, dann Viewer), kein `.fs` direkt. Der Arbeitsbereich öffnet im Wipe gegen ein fremdes Modell. Die Farben aus dem Modell werden ignoriert, alles ist grün.',
    after: '`wonky-view part.fs` öffnet den Tab selbst und startet auf einem Modell ohne Vorher/Nachher-Rahmen. Modellfarben, Achsen-Triade, sieben Ansichten per Zifferntaste.',
    pkgs: ['live-server', 'model-first-compare', 'render-look', 'camera-navigation'],
  },
  2: {
    name: 'Bohrung finden, Ø ablesen',
    before: `Der Inspector zeigt „Surface cylinder“, aber keinen Radius. Umweg über JSON oder CLI: ${taskTime(2, /Workaround ≈ ([\d–]+ min)/)}.`,
    after: `Hover genügt: „${q.hover}“. Klick zeigt Achse und Achspunkt.`,
    pkgs: ['exact-measure', 'topology-classes'],
  },
  3: {
    name: 'Wandstärke prüfen',
    before: `Nicht möglich: nur eine Auswahl, kein Messwerkzeug, die Wand zerfällt in Fragmente. Umweg über die Ebenenliste: ${taskTime(3, /Workaround ≈ ([\d–]+ min)/)}, fehleranfällig.`,
    after: `Zwei Shift-Klicks: „${q.offset}“. Oder \`K\` und ein Klick: „${q.thick}“.`,
    pkgs: ['exact-measure', 'thickness-probe', 'topology-classes'],
  },
  4: {
    name: 'Parameter ändern, Ergebnis sehen',
    before: `Von Hand: CLI neu, „Refresh workspace“, neue Revision suchen, etwa ${taskTime(4, /Human ≈ ([\d–]+ s) per iteration/)} pro Runde (Schätzung im Audit). Ein fehlgeschlagener Build bleibt unsichtbar.`,
    after: `Speichern genügt: neues Bild nach ${fmt.num(saveToPaint)} ms (Median von ${saveRuns}, gemessen), die Kamera bleibt. Fehler erscheinen als Banner mit Datei:Zeile:Spalte und Aufrufkette, das letzte gute Modell bleibt stehen.`,
    pkgs: ['live-server', 'live-client'],
  },
  5: {
    name: 'Vorher und nachher vergleichen',
    before: '„Before“ bleibt auf einem fremden Modell stehen. Unterschiede nur als Bild, keine Zahlen zu Volumen oder Bounds.',
    after: '`W` vergleicht mit der vorigen Revision derselben Quelle. Die Delta-Leiste nennt Flächen, Volumen, Bounds und geänderte Quellzeilen, jeweils mit Herkunft. `Shift+W` legt den Vorgänger als Ghost darüber.',
    pkgs: ['model-first-compare', 'diff-overlay'],
  },
  6: {
    name: 'Quellzeile einer Fläche finden',
    before: 'Zeigt nur die letzte Operation des Körpers (die Bohrung zeigt auf `opBoolean`), keine Aufrufkette, kein Editor-Link.',
    after: `Das Skizzen-Element zuerst („${q.skarc}“), bei Helfern die Aufrufkette als Überschrift, \`zed://\`-Link. Ein Klick auf eine Quellzeile markiert die Geometrie, die sie erzeugt hat.`,
    pkgs: ['source-links'],
  },
  7: {
    name: 'Druckbarkeit beurteilen',
    before: 'Keine Druckplatte, keine Unteransicht, keine Overhang-Anzeige. Das Gegenstück zu `inspect(FDM(...))` fehlt.',
    after: `Druckplatte ${de(q.plate)} mm, Overhang-Tönung ab ${q.alpha}° (cad-khana-Konvention), Auflage-Status wie „${q.floats}“. \`Shift+B\` legt den Körper auf eine gewählte Fläche.`,
    pkgs: ['fdm', 'section', 'parts-tree'],
  },
  8: {
    name: 'Kontext für ein LLM kopieren',
    before: 'Geht, enthält aber das fremde „Before“-Modell. Die Auswahl ist nur verlinkt, nicht eingebettet.',
    after: 'Nur das sichtbare Modell und die Auswahl, mit exakten Daten. Jeder kopierte `wonky-inspect`-Befehl läuft auch nach dem Stoppen des Servers (Exit 0).',
    pkgs: ['reviews-context'],
  },
};
// Which steps of the integration QA exercise each task (task 4 lives in the live session).
const TASK_QA = {
  1: ['static 01', 'static 03', 'static 17', 'live 01'],
  2: ['static 05', 'static 06'],
  3: ['static 07', 'static 08'],
  4: ['live 02', 'live 03', 'slow 02', 'slow 01'],
  5: ['static 12', 'live 05'],
  6: ['static 13'],
  7: ['static 10', 'static 09', 'static 11'],
  8: ['static 14', 'live 07', 'live 09'],
};
const matrixRows = taskRows.map((r) => ({ ...TASKS[r.n], n: r.n, st: r.st, sev: sevDe(r.severity), qa: TASK_QA[r.n] ?? [] }));
const auditNo = taskRows.filter((r) => r.st === 'nein').length;
const auditPart = taskRows.filter((r) => r.st === 'teil').length;

// Package one-liners (German), numbers grabbed above.
const PKG_TEXT = {
  'live-server': `\`wonky-view part.fs\`: beobachtet die Quelle, baut im warmen Worker, bricht überholte Builds ab (\`build-cancelled\` ${q.cancelMs} ms nach dem zweiten Speichern).`,
  'camera-navigation': `Spiegelbild behoben, rechtshändige Kamera, sieben Ansichten, Zoom zum Mauszeiger. Browser-QA ${q.camChecks}.`,
  'render-transport': `Binäre Draw-Payload statt JSON: r10b-retained ${fmt.num(r10bDraw, 2)} MB statt ${fmt.num(r10bJson, 2)} MB. Picking typisiert auf der CPU.`,
  'topology-classes': `Kantenklassen und logische Flächen: pocket plate ${topoRows.find((r) => r.model === 'pocket plate')?.raw} → ${topoRows.find((r) => r.model === 'pocket plate')?.logical} Flächen. Browser-QA ${q.topoChecks}.`,
  'exact-measure': `Exakte Parameter im Inspector, Messen per Shift-Klick, Maßlinie im Viewport; pin-in-bore Radialspalt ${de(q.gap)}.`,
  'model-first-compare': 'Start auf einem Modell; `W` vergleicht mit der vorigen Revision; Revisionen pro Quelle gruppiert; Delta-Leiste.',
  'render-look': `Kanten ${fmt.num(num(edgeAfter), 1)} CSS px, Licht, Modellfarben, X-Ray (\`T\`); Frame ${fmt.num(gpuAfter + cpuAfter, 2)} ms bei ${fmt.num(stressTris)} Dreiecken.`,
  'live-client': `Pill und Trust-Chip, Abbrechen, Fehlerbanner mit Aufrufkette, Follow live (\`L\`); Speichern → Bild ${fmt.num(saveToPaint)} ms.`,
  'source-links': 'Skizzen-Element statt Körper-Operation, Aufrufkette für Helfer, `zed://`-Links, Quellzeile → Geometrie.',
  'reviews-context': 'Dirty-Regel, einmalige Markup-Werkzeuge, LLM-Kontext nur für das Sichtbare, Druck-Export (STL + Manifest).',
  'parts-tree': 'Teile-Tab mit Auge, Farbfeld, Isolieren (`I`); Ausblenden überlebt einen Neustart; Spalten einklappbar.',
  fdm: `Platte ${de(q.plate)} mm, Overhang α > ${q.alpha}°, Auflage-Status, Druck auf Fläche (\`Shift+B\`). Browser-QA ${de(q.fdmChecks).replace(' of ', ' von ')}.`,
  section: `Schnittebene (\`X\`) mit Deckflächen „display ±${de(q.tol)} mm“; exakte Kontur vom Kernel auf Knopfdruck.`,
  'diff-overlay': 'Ghost der vorigen Revision (`Shift+W`) mit Blend-Regler; Bounds-Δ vom Kernel, wo keine aufgezeichnet sind.',
  'thickness-probe': `\`K\` und ein Klick: Wandstärke entlang der exakten Normalen, z. B. „${q.thick}“.`,
  'help-a11y': `\`?\` listet alle Tasten, Dunkelmodus, Kontrast ≥ ${de(q.contrastMin)}:1 bei ≥ ${q.contrastPx} px, deutsche Anleitung \`docs/viewer-ui.md\`.`,
};
for (const x of packages) if (!PKG_TEXT[x.key]) throw new Error(`viewer report: no text for package ${x.key}`);

const WAVE_TITLE = {
  1: 'Grundlagen: Live-Server, Kamera, Transport, Messen',
  2: 'Aussehen, Live-Client, Quelle, Reviews',
  3: 'Teilebaum, FDM, Schnitt, Diff, Wandstärke, Hilfe',
};
/** Packages as cells per wave, the same visual language as the QA strip below. */
function pkgStrip() {
  const rows = waves.map(({ wave }) => {
    const list = packages.filter((x) => x.wave === wave);
    const done = list.filter((x) => x.delivered).length;
    const cells = list.map((x) => `<li class="${x.delivered ? 'ok' : 'open'}" title="${esc(`${x.key} (${x.prio}): ${PKG_TEXT[x.key].replaceAll('`', '')}`)}"><span class="qa-n">${esc(x.prio)} · ${x.criteria} Kriterien</span><span class="qa-l">${esc(x.key)}</span></li>`);
    return `<p class="qa-head"><strong>Welle ${wave}: ${esc(WAVE_TITLE[wave] ?? '')}</strong> <span>${done} von ${list.length} abgenommen</span></p><ol class="qa-strip pk-strip">${cells.join('')}</ol>`;
  });
  return `<figure class="chart qa"><figcaption><strong>Pakete der Spec: ${passedCount} von ${packages.length} abgenommen</strong><span>je Paket eigene Arbeitskopie und eigenes Browser-QA · Priorität laut Spec · gemessen</span></figcaption><ul class="legend"><li><i class="sw f-s1" aria-hidden="true"></i>abgenommen</li><li><i class="sw sw-open" aria-hidden="true"></i>offen</li></ul>${rows.join('')}${source(SPEC, 'docs/viewer/package-*.md')}</figure>`;
}

const waveCards = waves.map(({ wave, keys }) => {
  const list = packages.filter((x) => x.wave === wave);
  const done = list.filter((x) => x.delivered).length;
  return card({
    eyebrow: `Welle ${wave} · ${done}/${list.length} abgenommen`,
    title: WAVE_TITLE[wave] ?? `Welle ${wave}`,
    kind: done === list.length ? 'gemessen' : 'offen',
    body: `<ul class="pk-list">${list.map((x) => `<li><code>${esc(x.key)}</code> <strong>${x.prio}</strong><span class="pk-meta">${inline(PKG_TEXT[x.key])}</span><span class="pk-meta">${x.criteria} Abnahmekriterien${x.conditional ? ' · teils nur mit Integrations-Patch' : ''}</span></li>`).join('')}</ul>`,
    src: 'docs/viewer/package-<paket>.md',
  });
});

// ── sections ─────────────────────────────────────────────────────────────────
const lead = `<div class="lead-tiles">${tiles([
  {
    label: 'Pakete der Spec abgenommen',
    value: `${passedCount} / ${packages.length}`,
    note: `${criteriaTotal} Kriterien im eigenen Browser-QA; ${conditionalCount} Pakete teils nur mit Integrations-Patch`,
    kind: 'gemessen',
    src: [SPEC, 'docs/viewer/package-*.md'],
  },
  {
    label: 'Speichern → neues Bild',
    value: fmt.num(saveToPaint),
    unit: 'ms',
    note: `Median von ${saveRuns}, bracket, Paket-QA${liveSave ? `; integriert ${fmt.num(liveSave.detail.saveToModelMs)} ms (1 Lauf)` : ''}; vorher etwa ${taskTime(4, /Human ≈ ([\d–]+ s) per iteration/)} von Hand (Schätzung)`,
    kind: 'gemessen',
    src: [LIVE_TIMING, ...(liveSave ? [liveSave.rel] : []), DAILY],
  },
  {
    label: `Hover-Pick bei ${fmt.num(stressTris)} Dreiecken`,
    value: `< ${fmt.num(pickAfterBound, 1)}`,
    unit: 'ms',
    note: `vorher ${fmt.num(pickBefore, 0)} ms (Median); ${fmt.num(pickBatch, 3)} ms pro Pick im Batch`,
    kind: 'gemessen',
    src: [BENCH, STRESS_PICK],
  },
  committed
    ? {
      label: 'Committeter Stand: Tests grün',
      value: V.tests.replace(' von ', ' / '),
      note: `committet \`${viewerCommit.hash}\`; Browser-QA ${V.qa}, Fix-Runden ${V.fix1} und ${V.fix2.join(' + ')}, CLI/API ${V.api}`,
      kind: 'gemessen',
      src: UI,
    }
    : lastTests
    ? {
      label: 'Gemeinsamer Stand: Tests grün',
      value: `${fmt.num(lastTests.pass)} / ${fmt.num(lastTests.tests)}`,
      note: `Zwischenstand ${integrationTime} Uhr${qaTxt ? `; ${qaTxt}` : ''}; ${committed ? 'committet' : 'nicht committet'}`,
      kind: 'offen',
      src: [lastTests.rel, ...qaSrc],
    }
    : { label: 'Integration in einen Stand', value: 'offen', note: committed ? '' : 'Viewer-Code nicht committet', kind: 'offen', src: MORNING },
])}</div>`;

// Hero: the same situation (a save that fails to build) in the old and the integrated viewer.
const HERO_COMMITTED = 'out/viewer/verify-live/r3-a05-syntax-error.png';
const heroNow = committed && exists(HERO_COMMITTED) ? HERO_COMMITTED : intFile('l03-failure-banner.png');
const heroIsCommitted = heroNow === HERO_COMMITTED;
const hero = heroNow
  ? `<figure class="hero">${pair(
    shot('out/viewer/audit/daily-use/22-build-error-invisible.png', { maxWidth: 960, alt: 'Alter Viewer nach einem fehlgeschlagenen Build: Toast "Workspace refreshed", Wipe gegen die vorige Version, kein Hinweis auf den Fehler', caption: '**Vorher, Audit 22.09.** Der Build ist fehlgeschlagen. Der Viewer meldet „Workspace refreshed“, zeigt im Wipe das alte Modell und keinen Fehler.' }),
    heroIsCommitted
      ? shot(heroNow, { maxWidth: 960, alt: 'Committeter Viewer: Pille "Last good r5, r6 fails at bracket.fs:31", amber Banner "Showing last good r5. Source now fails: input error at bracket.fs:31:9" mit Details und Open in editor, Delta-Leiste gegen r4, Modellliste mit "r6 fails"', caption: `**Jetzt, committeter Stand (aus der ${ROUND_DE[V.round] ?? V.round} Prüfrunde, ${hhmm(mtime(heroNow))} Uhr).** Gleiche Lage im Live-Loop: Pille und Banner nennen Datei, Zeile und Spalte, das letzte gute Modell bleibt stehen, darüber die Delta-Leiste gegen die Vorversion. In der Modellliste steht „fails“ unter der Quelle.` })
      : shot(heroNow, { maxWidth: 960, alt: 'Integrierter Viewer: Pill "Last good r2, r3 fails at bracket.fs:31", amber Fehlerbanner mit Details und Open in editor, Delta-Leiste gegen r1, Revisionsliste pro Quelle', caption: `**Jetzt, integrierter Stand ${hhmm(mtime(heroNow))}.** Gleiche Lage im Live-Loop: Banner mit Fehlerort${liveFail ? ` \`${liveFail.where}\`` : ''}, ${liveFail?.keeps ?? 'das letzte gute Modell'} bleibt stehen, darüber die Delta-Leiste gegen r1.` }),
  )}<div class="nat">${shot(heroNow, { crop: [232, 80, 1024, 132], native: true, alt: 'Ausschnitt in Originalgröße: Delta-Leiste gegen die Vorversion und amber Fehlerbanner mit Details und Open in editor', caption: `**Ausschnitt rechts oben in Originalgröße.** Delta-Leiste gegen die Vorversion mit Herkunft je Wert (${heroIsCommitted ? 'recorded, kernel' : 'recorded'}), darunter das Banner mit „Details“ und „Open in editor“.` })}</div><p class="hero-cap">Beide Vollbilder aus Chromium, ${(() => { const a = pxSize('out/viewer/audit/daily-use/22-build-error-invisible.png'), b = pxSize(heroNow); return esc(a === b ? `je ${a}` : `${a} und ${b}`); })()} px, unbeschnitten. ${heroIsCommitted ? `Rechts der Stand der ${ROUND_DE[V.round] ?? V.round} Prüfrunde des Live-Loops, kurz vor dem Commit <code>${esc(viewerCommit.hash)}</code>.` : 'Rechts ein Zwischenstand der Integration, noch nicht abgenommen.'}</p></figure>`
  : '';

// The committed cockpit: whole-window shots from the fix round and the third browser
// verification round. Both crops keep the inspector, which shows no paths here.
const COCKPIT = 'out/viewer/integration/g08-ghost-and-overhang-1280.png';
const PARTS = 'out/viewer/verify-browser/w1600-17-multibody-parts.png';
const hm = (d) => d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' });
const defectsLineOld = openDefects ? `Die Spec listet für den ersten Commit ${openDefects.high} hohe und ${openDefects.medium} mittlere offene Defekte. ${openDefects.highFixed || openDefects.mediumFixed ? `${openDefects.highFixed} hoher und ${openDefects.mediumFixed} mittlere sind in der Folgerunde behoben${specDirty ? ' (Arbeitsbaum, nicht committet)' : ''}` : 'Behoben ist davon noch keiner'}; offen ist unter anderem der hohe Live-Defekt: Hängen überholte Builds, blockiert der Build-Pool, und die Korrektur bleibt in der Warteschlange.` : '';
if (committed) grab(SPEC, /\*\*high, live:\*\* the build pool deadlocks when superseded builds hang/);
const fuWhen = followUp ? `\`${followUp.hash}\`, ${hm(followUp.at)} Uhr` : '';
const defectsLine = FU && openDefects
  ? `Die ${ROUND_NOM[V.round] ?? V.round} Prüfrunde ließ ${openDefects.high} hohe und ${openDefects.medium} mittlere Defekte offen (Liste am Ende der Spec). Die Folgerunde ist committet (${fuWhen}): laut Commit-Nachricht ${FU.measure} Korrekturen am Messen und ${FU.live} am Live-Loop${FU.bothHigh ? ', darunter beide hohen Defekte (ein falscher „exakter“ Abstand bei versetzten Bohrungen, der Deadlock des Build-Pools)' : ''}${FU.tests ? `; ${FU.tests.replace('/', ' von ')} Viewer- und Review-Tests grün` : ''}.`
  : defectsLineOld;
if (FU) grab(SPEC, /The low-severity layout, a11y and label items are listed in the verifier reports/);
const s0 = committed ? section(
  { title: 'Committet: das neue Cockpit', note: `Commit \`${viewerCommit.hash}\` vom ${viewerCommit.at.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', timeZone: 'Europe/Berlin' })}, ${hm(viewerCommit.at)} Uhr, nach der Integration, zwei Fix-Runden und ${{ first: 'einer', second: 'zwei', third: 'drei' }[V.round] ?? V.round} unabhängigen Prüfrunden (Browser, Regression, Exaktheit, Live-Loop).` },
  tiles([
    { label: 'Tests im committeten Stand', value: V.tests.replace(' von ', ' / '), note: 'Viewer-, Review- und Anzeige-Tests, Lauf nach der Fix-Runde 2', kind: 'gemessen', src: UI },
    { label: 'Browser-QA der Integration', value: V.qa.replace(' von ', ' / '), note: `dazu Fix-Runde ${V.fix1}, Fix-Runde 2 statisch ${V.fix2[0]} und live ${V.fix2[1]}`, kind: 'gemessen', src: UI },
    { label: 'CLI und API', value: V.api.replace(' von ', ' / '), note: 'Port, Traversal, Host-Allowlist, Routen der Spec, `wonky-inspect`', kind: 'gemessen', src: UI },
    FU
      ? { label: `Defekte der ${ROUND_DE[V.round] ?? V.round} Prüfrunde`, value: `${openDefects.high} + ${openDefects.medium}`, unit: 'hoch + mittel', note: `Folgerunde committet (${fuWhen})${FU.bothHigh ? ': beide hohen behoben, laut Commit-Nachricht' : ''}`, kind: 'gemessen', src: [SPEC, `git show ${followUp.hash}`] }
      : { label: 'Offene Defekte beim Commit', value: `${openDefects.high} + ${openDefects.medium}`, unit: 'hoch + mittel', note: `in der Folgerunde behoben: ${openDefects.highFixed} + ${openDefects.mediumFixed}${specDirty ? ', Arbeitsbaum' : ''}`, kind: 'offen', src: SPEC },
  ]),
  shot(COCKPIT, { maxWidth: 920, alt: 'Committeter Viewer bei 1280 px: Pille "Current r7 · bracket.fs · Follow on", Modellliste mit bracket.fs und main.py, Delta-Leiste gegen r5, blauer Ghost der Vorversion mit Blend-Regler, Overhang-Legende mit Schwelle 45°, Inspector mit Modellübersicht und LLM-Kontext', caption: `**Das Cockpit, Fix-Runde 2 (${hm(mtime(COCKPIT))} Uhr).** Live-Quelle \`bracket.fs\` in Revision 7, links die Modelle pro Quelle, oben die Delta-Leiste gegen r5 mit Herkunft je Wert, im Viewport der Ghost der Vorversion (\`Shift+W\`) und die FDM-Legende, rechts Inspector und LLM-Kontext.` }),
  shot(PARTS, { crop: [1, 72, 1296, 828], alt: 'Teilebaum mit vier Körpern (Base plate, Bracket, Pin, spacer) in Modellfarben, Flächenzahlen roh und logisch, Revisionen der Quelle', caption: `**Teilebaum, Prüfrunde im Browser (${hm(mtime(PARTS))} Uhr).** Vier Körper mit Namen, Farbe aus dem Modell, Auge und Flächenzahl „roh (logisch)“.` }),
  callout('offen', 'Was nach dem Commit offen ist', p(`${FU ? `${defectsLine} Offen bleiben laut Spec die Punkte niedriger Schwere (Layout, Barrierefreiheit, Beschriftungen) aus den Prüfberichten und ein Alltagstest mit deinen ${taskRows.length} Aufgaben.` : `${defectsLine} Die Folgerunde läuft, ihr Stand ist nicht committet.`} Viewer, die schon vor dem Commit liefen (Ports ${V.rollout.replace(' and ', ' und ')}), zeigen alten Server-Code, bis sie neu gestartet werden.`), { src: [SPEC, FU ? `git show ${followUp.hash}` : 'git status'] }),
) : '';

const s1 = section(
  { title: 'Deine Alltagsaufgaben: vorher und jetzt', note: `Das Audit vom ${q.auditDate.replace(' September ', '.09.').replace(/^(\d)\./, '0$1.')} hat acht Aufgaben aus deinem OCP-Loop mit echten Modellen durchgespielt. Rechts steht, welches Paket die Aufgabe abdeckt und was seine Abnahme im Browser gezeigt hat, darunter das Ergebnis der Browser-QA am integrierten Stand.` },
  taskMatrix(matrixRows),
  source(DAILY, 'docs/viewer/package-*.md', LIVE_TIMING),
  callout('offen', 'Die rechte Spalte ist zugeordnet, nicht im Alltag nachgemessen',
    p(`Im Audit waren ${auditNo} von ${taskRows.length} Aufgaben gar nicht und ${auditPart} nur teilweise möglich. Die neuen Werte stammen aus den Paket-Abnahmen, jede in ihrer eigenen Arbeitskopie.${qaAll.length ? ` Die Zeilen „Integrierter Stand“ zeigen die Browser-QA am gemeinsamen Stand${qaFail.length ? `: ${qaFail.length} von ${qaAll.length} Schritten ${qaFail.length === 1 ? 'ist' : 'sind'} dort rot (${listDe(qaFail.map(qaShort))})` : `: alle ${qaAll.length} Schritte bestanden`}.` : ''} Die acht Aufgaben wurden am integrierten Viewer noch nicht als Alltagstest durchgespielt. Das ist der nächste Test.`),
    { src: qaAll.length ? qaSrc : undefined }),
  ...(hero ? [] : [pair(
    shot('out/viewer/audit/daily-use/22-build-error-invisible.png', { crop: [232, 72, 1024, 828], alt: 'Alter Viewer nach einem fehlgeschlagenen Build: Toast "Workspace refreshed", altes Modell, kein Hinweis auf den Fehler', caption: '**Vorher (Audit, Aufgabe 4).** Der Build ist fehlgeschlagen. Der Viewer meldet „Workspace refreshed“ und zeigt das alte Modell ohne Hinweis.' }),
    shot('out/viewer/live-client/a3-failure-banner.png', { crop: [232, 1, 1024, 900], alt: 'Neuer Viewer: amber Banner mit Fehlerort part.fs:32:5, Delta-Leiste und Pill "Last good r2"', caption: `**Jetzt (live-client).** Amber Banner: „${q.banner}“. Darüber die Delta-Leiste, unten der Trust-Chip.` }),
  )]),
  pair(
    shot('out/viewer/audit/daily-use/06-hole-face-picked.png', { crop: [620, 130, 916, 520], alt: 'Alter Inspector nach Klick in eine Bohrung: Surface cylinder, Boundary edges 3, kein Radius', caption: '**Vorher (Audit, Aufgabe 2).** Bohrung angeklickt: „Surface cylinder“, drei Randkanten, eine lange Warnung, aber kein Durchmesser.' }),
    shot('out/viewer/exact-measure/08-pin-in-bore-radial-gap.png', { crop: [620, 330, 916, 520], alt: 'Neuer Viewer: Maßlinie mit Radialspalt 0.2000 mm exact und Inspector-Abschnitt Exact geometry mit Cylinder hole Ø8.4000 mm', caption: `**Jetzt (exact-measure).** Inspector mit „Exact geometry“ für die Ø${de(q.pinBore)}-Bohrung, im Viewport die Maßlinie „${q.radialGap}“. Schon beim Hover steht „${q.hover}“ in der Statuszeile.` }),
  ),
  details('Zwei weitere Vorher/Jetzt-Paare: Startansicht und Farben', [
    pair(
      shot('out/viewer/audit/daily-use/03-workspace-default.png', { crop: [232, 72, 1024, 828], alt: 'Alter Viewer: Wipe zwischen compare-before und compare-after, zwei fremde Modelle halb und halb', caption: '**Vorher (Audit, Aufgabe 1).** Der Arbeitsbereich mit zehn Modellen öffnet im Wipe gegen ein fremdes Modell.' }),
      shot('out/viewer/model-first-compare/01-ten-model-startup.png', { crop: [232, 72, 1024, 828], alt: 'Neuer Viewer: derselbe Arbeitsbereich startet auf einem Modell, Leiste "No earlier revision of this source"', caption: '**Jetzt (model-first-compare).** Derselbe Arbeitsbereich startet auf einem Modell. Vergleich nur auf Wunsch.' }),
    ),
    pair(
      shot('out/viewer/audit/daily-use/19-r10b-retained-single.png', { crop: [232, 152, 1024, 748], alt: 'Alter Viewer: r10b-retained, alle fünf Teile grün, gespiegelte Projektion', caption: '**Vorher (Audit).** r10b-retained: alle fünf Teile grün, und die Projektion ist gespiegelt (Rendering-Audit R1).' }),
      shot('out/viewer/render-look/a3-r10b-retained-appearance.png', { alt: 'Neuer Viewer: r10b-retained mit Appearance-Farben aus dem Modell, dunkle Kanten', caption: `**Jetzt (render-look).** Farben aus dem Modell, ${fmt.num(num(edgeAfter), 1)}-px-Kanten, Legende mit Anzeigetoleranz. Andere Kamera als links.` }),
    ),
  ].join('')),
  grid(
    card({
      eyebrow: 'Audit 22.09.', title: 'Was schon funktionierte', kind: 'gemessen',
      body: ul([
        'Eingefrorene Quell-Snapshots haben eine Live-Änderung überstanden.',
        'Ein Körper aus der Liste angeklickt hebt das Teil im Viewport hervor.',
        'Wipe und Side-by-side laufen synchron, gespeicherte Reviews öffnen wieder.',
        `Die API ist schnell: \`GET /api/workspace\` ${q.apiWorkspace} ms, Entity-Detail etwa ${q.apiEntity} ms. Die UI zeigte nur nicht, was der Server schon hatte.`,
      ]),
      src: DAILY,
    }),
    card({
      eyebrow: 'Rendering-Audit 22.09.', title: 'Was darunter kaputt war', kind: 'fehlgeschlagen',
      body: ul([
        'Jede Ansicht war ein Spiegelbild. „Top“ zeigte +Y nach unten, händige Teile sahen aus wie ihr Zwilling.',
        `Ein Hover-Pick kostete ${fmt.num(pickBefore, 0)} ms bei ${fmt.num(stress.open.triangles)} Dreiecken.`,
        `Die Szene kam als JSON: ${fmt.num(stressJson, 1)} MB für die große Testszene.`,
        `Kanten ${de(edgeBefore)} CSS px breit, Kontrast ${de(edgeContrastBefore)}:1.`,
      ]),
      src: [RENDER_AUDIT, BENCH],
    }),
  ),
);

const liveLoop = diagram({
  title: 'Live-Loop, wie er gebaut ist',
  sub: `${q.debounce} ms und ${q.grace} ms sind Vorgaben der Spec; ${fmt.num(saveToPaint)} ms ist gemessen (bracket, Median von ${saveRuns})`,
  nodes: [
    { id: 'ed', label: 'Editor', sub: 'part.fs speichern', col: 0, row: 0 },
    { id: 'w', label: 'Watcher', sub: `${q.debounce} ms, Hash der Quelle`, col: 1, row: 0 },
    { id: 'b', label: 'Build-Worker', sub: 'warm, plus Ersatz', col: 2, row: 0, kind: 'accent' },
    { id: 'v', label: 'Browser', sub: `Bild nach ${fmt.num(saveToPaint)} ms`, col: 3, row: 0 },
    { id: 'c', label: 'Abbruch', sub: `neuer Save, ≤ ${q.grace} ms`, col: 1, row: 1, kind: 'muted' },
    { id: 'f', label: 'Fehler-Banner', sub: 'letztes gutes Modell', col: 3, row: 1 },
  ],
  edges: [
    { from: 'ed', to: 'w', label: 'speichern' },
    { from: 'w', to: 'b', label: 'Job' },
    { from: 'b', to: 'v', label: 'revision' },
    { from: 'w', to: 'c' },
    { from: 'b', to: 'f', label: 'build-failed' },
  ],
  src: [SPEC, pkgDoc('live-server'), LIVE_TIMING],
});

/**
 * The live loop as you see it: native-size crops of the status pill, delta strip and banner
 * from the integration QA screenshots, in the order a session runs through them. Crop
 * rectangles are source pixels; every crop avoids the inspector and the failure drawer
 * (both print absolute paths). A state whose screenshot is missing is left out.
 */
function liveStates() {
  const d = (key) => qaByKey.get(key)?.detail ?? {};
  const STATES = [
    { file: 'w01-building.png', crop: [432, 14, 440, 42], step: 'slow 01', key: 'Speichern', title: 'Build läuft',
      text: `Phase, laufende Zeit und Abbrechen. Die Anzeige kam ${Number.isFinite(d('slow 01').firstMs) ? `${fmt.num(d('slow 01').firstMs)} ms` : 'kurz'} nach dem Speichern.`,
      alt: 'Status-Pille: Building r2, evaluating, 0.9 s, part.fs, Knöpfe Cancel und Follow on' },
    { file: 'w01-cancelled.png', crop: [432, 14, 440, 42], step: 'slow 01', key: 'Abbrechen', title: 'Abgebrochen',
      text: 'Das letzte gute Modell bleibt stehen, „Rebuild“ startet neu.',
      alt: `Status-Pille: ${d('slow 01').cancelled ?? 'Last good r1, r2 cancelled'}, Knöpfe Rebuild und Follow on` },
    { file: 'l02-current-r2-delta.png', crop: [250, 16, 990, 130], step: 'live 02', key: 'Build fertig', title: 'Neue Revision mit Delta',
      text: `Bauzeit in der Pille, darunter die Delta-Leiste gegen r1, jeder Wert mit Herkunft. Speichern bis Modell im Tab: ${Number.isFinite(d('live 02').saveToModelMs) ? `${fmt.num(d('live 02').saveToModelMs)} ms` : 'unter 1 s'}.`,
      alt: 'Pille Current r2, 0.02 s, bracket.fs; Kopf bracket.fs r2 latest; Delta-Leiste gegen r1 mit Volumen +4,416 mm³ recorded, Bounds-Delta und geänderter Quellzeile' },
    { file: 'w02-helper-failure-banner.png', crop: [240, 16, 1000, 194], step: 'slow 02', key: 'Fehler', title: 'Build scheitert im Helfer',
      text: 'Pille und Banner nennen Datei, Zeile, Spalte und den Aufrufer. Hier ist es eine echte Kernel-Lücke: `opBoolean` kann den Fall nicht.',
      alt: 'Pille Last good r1, r3 fails at part.fs:32; amber Banner: capability error at part.fs:32:5 in opBoolean, called from part.fs:57, Knöpfe Details und Open in editor' },
    { file: 'l06-follow-off-available.png', crop: [16, 700, 348, 36], step: 'live 06', key: 'Taste L', title: 'Follow aus',
      text: 'Du bleibst auf deiner Revision, die neue wird nur angeboten. `L` holt wieder auf.',
      alt: `Statuszeile: Viewing r4, r5 is latest; Chip ${d('live 06').available ?? 'r5 available, follow off (L)'}` },
    { file: 'l08-disconnected.png', crop: [16, 700, 272, 36], step: 'live 08', key: 'Neustart', title: 'Server weg',
      text: 'Der Tab zeigt weiter das letzte Modell und verbindet sich neu, ohne neuen Tab.',
      alt: `Statuszeile: ${d('live 08').disconnected ?? 'Disconnected, showing r5, reconnecting'}` },
  ].map((x) => ({ ...x, rel: intFile(x.file) })).filter((x) => x.rel);
  if (!STATES.length) return '';
  const rows = STATES.map((x) => {
    const s = qaByKey.get(x.step);
    const mark = s ? `<span class="ls-qa ${s.ok ? 'qa-ok' : 'qa-bad'}">${s.ok ? '✓' : '✕'} QA ${esc(s.session === 'live' ? 'Live' : 'Build')} ${esc(s.n)}</span>` : '';
    return `<li${x.crop[2] > 700 ? ' class="ls-wide"' : ''}><div class="ls-k"><span class="ls-key">${inline(x.key)}</span><strong>${esc(x.title)}</strong>${mark}<p>${inline(x.text)}</p></div><div class="ls-img${x.crop[2] > 700 ? ' nat' : ''}">${imgTag(shot(x.rel, { crop: x.crop, native: true, alt: x.alt }))}</div></li>`;
  });
  const at = new Date(Math.max(...STATES.map((x) => mtime(x.rel).getTime())));
  return `<figure class="chart ls"><figcaption><strong>Live-Loop im integrierten Stand: was du beim Speichern siehst</strong><span>Ausschnitte in Originalgröße aus der Browser-QA, ${hhmm(at)} · zwei Sitzungen: bracket.fs und ein Testteil mit langem Build · gemessen</span></figcaption><ol class="ls-list">${rows.join('')}</ol>${source(...new Set(STATES.map((x) => x.rel)), ...qaSrc)}</figure>`;
}

const liveOk = liveSessions.flatMap((s, si) => s.revs.filter((r) => r.ok).map((r) => ({ ...r, restart: si > 0 })));
const liveChart = liveOk.length ? barChart({
  title: 'Live-Loop im integrierten Stand: Build-Zeit je gespeicherter Revision',
  sub: `Terminal-Log der Live-QA, ${hhmm(mtime(LIVE_LOG))}, bracket.fs · der erste Build startet einen kalten Worker${Number.isFinite(qaByKey.get('live 01')?.load) ? ` (Load ${fmt.num(qaByKey.get('live 01').load, 0)})` : ''}, danach baut der warme${liveFail ? ` · ${liveFail.rev} baute nicht (\`${liveFail.where}\`), ${liveFail.keeps ?? 'das letzte gute Modell'} blieb stehen` : ''}`,
  data: liveOk.map((r) => ({
    label: `${r.restart ? 'nach Neustart, ' : ''}${r.rev}`,
    value: r.s,
    note: r.cold ? 'kalter Worker' : r.fresh ? `Ersatz-Worker (Kernel geändert), ${r.size}` : r.size,
    kind: 'gemessen',
  })),
  format: (v) => `${fmt.num(v, 2)} s`,
  src: LIVE_LOG,
}) : '';

const s2 = section(
  { title: 'Zielbild: das Cockpit neben dem Editor', note: `Aus der Spec (${q.specRev.replace('revision', 'Revision')}): ein Befehl, ein Tab, jede gespeicherte Änderung sofort sichtbar, jede Zahl mit ihrer Genauigkeit.` },
  grid({ wide: true },
    card({ eyebrow: 'Spec §3.1 · P0', kind: 'entscheidung', title: 'Live-Loop',
      body: p('`wonky-view part.fs` beobachtet die Quelle, baut im Hintergrund neu und schiebt jede Revision in den Browser. Die Kamera bleibt stehen. Fehler zeigen Datei, Zeile, Spalte und Aufrufkette, im Terminal und im Viewport.')
        + p(`**Stand:** \`live-server\` und \`live-client\` abgenommen, Speichern → Bild ${fmt.num(saveToPaint)} ms.`),
      src: [SPEC, LIVE_TIMING] }),
    card({ eyebrow: 'Spec §3.4 · P0', kind: 'entscheidung', title: 'Model-first',
      body: p('Ein Modell statt Vorher/Nachher-Rahmen. Verglichen wird nur auf Wunsch, dann gegen die vorige Revision derselben Quelle und mit Zahlen.')
        + p('**Stand:** `model-first-compare` und `diff-overlay` abgenommen.'),
      src: SPEC }),
    card({ eyebrow: 'Spec §3.3 · P0', kind: 'entscheidung', title: 'Exakt messen',
      body: p(`Werte kommen aus den B-rep-Parametern, nicht aus dem Anzeige-Mesh. Jeder Wert trägt ein Etikett: exact, kernel, recorded oder display ±${de(q.tol)} mm. Ohne geschlossene Formel steht „unsupported“ da, nie eine Schätzung.`)
        + p('**Stand:** `exact-measure`, `thickness-probe` und `topology-classes` abgenommen.'),
      src: SPEC }),
    card({ eyebrow: 'Spec §3.6 · P0', kind: 'entscheidung', title: 'FDM',
      body: p(`Druckplatte (Bambu A1, ${de(q.plate)} mm), Overhang ab ${q.alpha}° nach cad-khana-Konvention, Bohrungen bis Ø ${q.bore} mm ausgenommen, Auflage-Status pro Körper, Export fürs Slicen.`)
        + p(`**Stand:** \`fdm\` abgenommen. Die Brücken-Ausnahme (≤ ${q.bridge} mm) fehlt und die Legende sagt das.`),
      src: [SPEC, pkgDoc('fdm')] }),
  ),
  liveLoop,
  liveStates(),
  liveChart,
  callout('offen', 'Der Loop wird oft Fehler zeigen',
    p(`Im Audit baute keins deiner echten Teile unverändert (cad-project-025, Port des Beam-Frames, cad-project-012-Welle). Die Korpus-Triage bestätigt das: ${fmt.num(corpus.totals.fileStatus.ok)} von ${fmt.num(corpus.totals.filesRun)} Dateien aus deinem CAD-Ordner baut heute. Deshalb hat die Fehleranzeige dieselbe Priorität wie das Rendering. Die Kernel-Lücken selbst kann der Viewer nicht schließen, nur sichtbar und auffindbar machen.`),
    { src: [DAILY, CORPUS] }),
);

const pipeline = diagram({
  title: 'Vom Audit zum Commit',
  sub: `Stand ${stand}${committed && !followUp ? '; gestrichelt = läuft oder offen' : ''}`,
  nodes: [
    { id: 'a', label: 'Audits', sub: `${AUDIT_COUNT} Berichte · 22.09.`, col: 0, row: 0 },
    { id: 's', label: `Spec Rev. ${specRevNo}`, sub: 'mit zwei Kritiken · 22.09.', col: 1, row: 0 },
    { id: 'f', label: 'Fundament F1–F4', sub: `fertig · ${q.foundationDone.slice(8, 10)}.${q.foundationDone.slice(5, 7)}.`, col: 2, row: 0 },
    ...waves.map(({ wave, keys }, i) => {
      const done = keys.filter((k) => packages.find((x) => x.key === k)?.delivered).length;
      const pos = [[3, 0], [3, 1], [2, 1]][i] ?? [2, 1];
      return { id: `w${wave}`, label: `Welle ${wave}`, sub: `${done} von ${keys.length} abgenommen`, col: pos[0], row: pos[1] };
    }),
    { id: 'i', label: 'Integration', sub: lastTests ? `Tests ${lastTests.pass}/${lastTests.tests}${qaAll.length ? ` · QA ${qaOk}/${qaAll.length}` : ''}` : 'läuft', col: 1, row: 1, kind: 'accent' },
    committed
      ? { id: 'c', label: 'Prüfrunden, Commit', sub: `${V.round === 'third' ? 3 : V.round} Runden · ${viewerCommit.hash}`, col: 0, row: 1, kind: 'accent' }
      : { id: 'c', label: 'Alltagstest, Commit', sub: 'offen', col: 0, row: 1, kind: 'planned' },
    ...(committed ? [{ id: 'x', label: 'Folgerunde', sub: followUp ? `${followUp.hash} · Alltagstest offen` : 'läuft · Alltagstest offen', col: 0, row: 2, kind: followUp ? undefined : 'planned' }] : []),
  ],
  edges: [
    { from: 'a', to: 's' }, { from: 's', to: 'f' }, { from: 'f', to: 'w1' },
    { from: 'w1', to: 'w2' }, { from: 'w2', to: 'w3' }, { from: 'w3', to: 'i' },
    { from: 'i', to: 'c', planned: !committed },
    ...(committed ? [{ from: 'c', to: 'x', planned: !followUp }] : []),
  ],
  src: [SPEC, FOUNDATION, 'docs/viewer/package-*.md', ...(committed ? [UI, 'git log'] : [MORNING])],
});

const allGreen = lastTests?.fail === 0 && qaAll.length > 0 && qaFail.length === 0;
const integrationCallout = committed
  ? callout('gemessen', 'Danach: zwei Fix-Runden, Prüfrunden, Commit',
    p(`Nach diesem Lauf folgten zwei Fix-Runden (Browser-QA ${V.fix1}, dann statisch ${V.fix2[0]} und live ${V.fix2[1]}) und unabhängige Prüfrunden zu Browser, Regression, Exaktheit und Live-Loop. Committet ist der Stand nach der ${ROUND_DE[V.round] ?? V.round} Runde: ${V.tests} Tests grün, CLI und API ${V.api}.`),
    { src: [UI, SPEC] })
  : allGreen
  ? callout('offen', 'Grün heißt noch nicht fertig',
    p(`Im gemeinsamen Stand sind alle ${fmt.num(lastTests.tests)} Tests und alle ${qaAll.length} Browser-Schritte grün. Es fehlen die unabhängige Prüfung der Integration, ihr Bericht und der Commit. Bei ${conditionalCount} Paketen hing die eigene Abnahme für einzelne Punkte an einem Patch, der erst mit der Integration kam; die Paketberichte listen diese Anfragen.`),
    { src: [lastTests.rel, ...qaSrc, 'docs/viewer/package-*.md'] })
  : callout('offen', 'Abgenommen heißt noch nicht integriert',
    p(`Alle ${passedCount} Pakete haben ihre Kriterien im eigenen Browser-QA erfüllt. Bei ${conditionalCount} Paketen gilt das für einzelne Punkte nur mit einem Patch an fremden Dateien, der erst in der Integration kommt. Die Paketberichte listen diese Anfragen einzeln.`),
    { src: 'docs/viewer/package-*.md' });

const s3 = section(
  { title: committed ? 'Pakete und Integration' : 'Pakete: was fertig ist, was noch läuft', note: `Jedes Paket hat in einer eigenen Arbeitskopie gebaut und seine Abnahmekriterien im Browser geprüft.${committed ? ' Die Integration hat sie am Vormittag zu einem Stand zusammengeführt.' : ' Der gemeinsame Stand entsteht gerade.'}` },
  pipeline,
  pkgStrip(),
  details('Alle 16 Pakete einzeln: was jedes gebaut hat', grid(...waveCards)),
  ...(testRuns.length || qaAll.length ? [
    committed
      ? `<h3 class="sub-h">Integration: der erste vollständige Lauf${qaRun ? `, ${esc(hhmm(qaRun.at))} Uhr` : ''}</h3>`
      : `<h3 class="sub-h">Zwischenstand der Integration${integrationTime ? `, ${esc(integrationTime)} Uhr` : ''}</h3>`,
    p(`Die Integration führt alle Pakete in einem Arbeitsbaum zusammen und prüft ihn mit \`npm test\` und einer eigenen Browser-QA.${committed ? ' Die Zahlen unten stammen aus den Arbeitsdateien dieses Laufs; was danach kam, steht im Kasten darunter und oben unter „Committet“.' : integrationDoc ? '' : ' Einen Integrationsbericht gibt es noch nicht; die Zahlen unten stammen aus den Arbeitsdateien der Stufe.'}`),
    qaStrip(),
    grid({ wide: true },
      apiCli.length || liveOk.length || contrast.length ? card({
        eyebrow: 'weitere Prüfungen', kind: 'gemessen', title: 'Server, CLI, Live-Log, Kontrast',
        body: ul([
          ...(apiCli.length ? [`API und CLI (Lauf ${hhmm(mtime(API_CLI))}): ${apiCli.filter((r) => r.ok).length} von ${apiCli.length} Prüfungen bestanden, z. B. Port-Konflikt, Pfad-Traversal, Modell-ID = SHA-256 der Bytes.`] : []),
          ...(liveOk.length ? [`Live-Log (${hhmm(mtime(LIVE_LOG))}): ${liveFirst.length} Revisionen aus Speichern, ${liveFail ? `eine davon mit Syntaxfehler (\`${liveFail.where}\`)` : 'alle gebaut'}.${liveSave ? ` Speichern bis Modell im Tab: ${fmt.num(liveSave.detail.saveToModelMs)} ms (Browser-QA, 1 Lauf).` : ''}`] : []),
          ...(contrast.length ? [`Kontrast nach der Farb-Migration (${hhmm(mtime(CONTRAST))}): ${contrast.map((c) => `${c.mode === 'light' ? 'hell' : 'dunkel'} ${fmt.num(c.below)} von ${fmt.num(c.texts)} Texten`).join(', ')} unter ${de(contrast[0].min)}:1.`] : []),
        ]),
        src: [...(apiCli.length ? [API_CLI] : []), ...(liveOk.length ? [LIVE_LOG] : []), ...(liveSave ? [liveSave.rel] : []), ...(contrast.length ? [CONTRAST] : [])],
      }) : '',
      lastTests?.failing.length ? card({
        eyebrow: `Testlauf ${hhmm(lastTests.at)}`, kind: 'offen', title: `${lastTests.fail === 1 ? 'Ein Test' : `${lastTests.fail} Tests`} rot`,
        body: ul(lastTests.failing.map((t) => `\`${t.name}\`${t.error ? ` → „${scrub(t.error)}“` : ''}`))
          + p(`${lastTests.failing.every((t) => /timed out|504/i.test(t.error)) ? 'Alle sind Zeitüberschreitungen. Ob die Last der Maschine die Ursache ist, ist nicht geprüft. ' : ''}${baseTests ? `Zum Vergleich die Ausgangslage: ${baseTests.fail} rote von ${fmt.num(baseTests.tests)} Tests, die erwarteten Fälle aus den Paketberichten (alte Kamera-Konvention, Stub-Annahmen, Multi-Selection-Buffer).` : ''}`),
        src: [lastTests.rel, ...(baseTests ? [baseTests.rel] : [])],
      }) : '',
    ),
    integrationCallout,
    ...(testRuns.length || qaFull.length ? [details('Verlauf: rote Tests und rote QA-Schritte je Lauf', grid({ wide: true },
      testRuns.length ? barChart({
        title: 'Rote Tests im gemeinsamen Stand',
        sub: 'node --test, Viewer und Kernel · kleiner ist besser',
        data: testRuns.map((r, i) => ({
          label: `${hhmm(r.at)} ${r.baseline ? 'Ausgangslage' : i === testRuns.length - 1 ? 'letzter Lauf' : 'Zwischenlauf'}`,
          note: `${fmt.num(r.tests)} Tests`,
          value: r.fail,
          kind: 'gemessen',
          highlight: i === testRuns.length - 1,
        })),
        format: (v) => `${fmt.num(v)} rot`,
        src: testRuns.map((r) => r.rel),
      }) : '',
      qaFull.length ? barChart({
        title: 'Rote Schritte der Browser-QA',
        sub: 'vollständige Läufe am integrierten Stand · kleiner ist besser',
        data: qaFull.map((r, k) => ({
          label: `${hhmm(r.at)} ${k === qaFull.length - 1 ? 'letzter Lauf' : 'Lauf'}`,
          note: `${r.steps.length} Schritte${r.rerunUntil ? `, einzelne bis ${hhmm(r.rerunUntil)} wiederholt` : ''}`,
          value: r.steps.filter((x) => !x.ok).length,
          kind: 'gemessen',
          highlight: k === qaFull.length - 1,
        })),
        format: (v) => `${fmt.num(v)} rot`,
        src: qaFull.map((r) => r.rel),
      }) : '',
    ))] : []),
    ...(baseTests ? [details(`Die ${baseTests.fail} roten Tests der Ausgangslage`, ul(baseTests.failing.map((t) => `\`${t.name}\``)) + source(baseTests.rel))] : []),
  ] : [integrationCallout]),
);

const fmtPick = (v) => (v <= PICK_TIMER ? `< ${fmt.num(PICK_TIMER, 1)} ms` : fmt.ms(v));
const s4 = section(
  { title: 'Messwerte vorher und nachher', note: 'Gleiche Szenen, alter Viewer (Audit 22.09.) gegen Paket-QA (23.09.). Die Maschine war beide Male stark ausgelastet; Zeiten sind Obergrenzen.' },
  grid({ wide: true },
    beforeAfter({
      title: 'Szene zum Browser: r10b-retained', sub: `5 Teile · kleiner ist besser · ${fmt.num(r10bGzip, 3)} MB gzip auf der Leitung`, unit: 'MB',
      labels: { before: 'JSON-Szene', after: 'Draw-Payload (roh)' },
      data: [{ label: 'r10b-retained', before: r10bJson, after: r10bDraw }],
      format: (v) => `${fmt.num(v, v < 1 ? 3 : 2)} MB`,
      src: [BENCH, TRANSPORT],
    }),
    beforeAfter({
      title: `Szene zum Browser: ${fmt.num(stressTris)} Dreiecke`, sub: `Stresstest r10b 8 × 8 · kleiner ist besser · ${fmt.num(stressWire, 1)} MB gzip auf der Leitung`, unit: 'MB',
      labels: { before: 'JSON-Szene', after: 'Draw-Payload (roh)' },
      data: [{ label: 'stress r10b 8 × 8', before: stressJson, after: stressDraw }],
      format: (v) => `${fmt.num(v, 1)} MB`,
      src: [BENCH, STRESS_PICK],
    }),
    barChart({
      title: `Hover-Pick bei ${fmt.num(stressTris)} Dreiecken`,
      sub: `Median pro Mausbewegung · nachher unter der Timer-Auflösung von ${fmt.num(PICK_TIMER, 1)} ms, Batch: ${fmt.num(pickBatch, 3)} ms pro Pick`,
      data: [
        { label: 'Audit 22.09.: alter Picker', value: pickBefore, kind: 'gemessen' },
        { label: 'Paket-QA 23.09.: typisierter Picker', value: pickAfterBound, kind: 'gemessen' },
      ],
      format: fmtPick,
      src: [BENCH, STRESS_PICK],
    }),
    beforeAfter({
      title: `Was es kostet: GPU-Zeit pro Frame, ${fmt.num(stressTris)} Dreiecke`,
      sub: `kleiner ist besser · Budget ${frameBudget} ms · neu: 1,5-px-Kanten, Licht, Kantenklassen`,
      unit: 'ms',
      labels: { before: 'Audit 22.09.', after: 'Paket-QA 23.09.' },
      data: [{ label: 'GPU, Median beim Drehen', before: gpuBefore, after: gpuAfter }],
      format: (v) => `${fmt.num(v, 2)} ms`,
      src: [BENCH, LOOK_PERF],
    }),
  ),
  beforeAfter({
    title: 'Flächen: B-rep-Fragmente gegen logische Flächen',
    sub: `kleiner heißt weniger Stücke pro Wand · unverändert: ${topoSame.map((r) => r.model).join(', ')}`,
    unit: 'Flächen',
    labels: { before: 'roh (Fragmente)', after: 'logisch (was du anklickst)' },
    data: topoChanged.map((r) => ({ label: r.model, before: r.raw, after: r.logical })),
    format: (v) => fmt.num(v),
    src: pkgDoc('topology-classes'),
  }),
  table({
    caption: 'Weitere Werte',
    columns: ['Größe', { label: 'vorher', align: 'right' }, { label: 'nachher', align: 'right' }, 'Anmerkung'],
    rows: [
      ['Kantenbreite', `${de(edgeBefore)} CSS px`, `${fmt.num(num(edgeAfter), 1)} CSS px`, 'Median, DPR 2'],
      ['Kantenkontrast zur Fläche', `${de(edgeContrastBefore)}:1`, `≥ ${de(edgeContrastAfter)}:1`, 'nachher: schlechtester Wert der Viewer-Palette'],
      ['Hover-Tönung', `ΔE ${hoverDeBefore}`, `ΔE ${de(hoverDeAfter)}`, 'CIE76 auf der beleuchteten Fläche'],
      ['Hover-Pick r10b-retained', `${fmt.num(r10bPickBefore, 1)} ms`, `< ${fmt.num(PICK_TIMER, 1)} ms`, 'nachher am Stresstest gemessen, nicht an r10b'],
      ['Modell 100 m vom Ursprung', `${de(farAbs)} px`, `${de(farNow)} px`, 'Abstand Fläche zu Auswahllinie, 1000 px/mm; vorher = absolute float32'],
      ['Projektion', 'gespiegelt', 'rechtshändig', `Top zeigt das L aufrecht; Kamera-QA ${q.camChecks}`],
    ],
    src: [RENDER_AUDIT, pkgDoc('render-look'), pkgDoc('render-transport'), pkgDoc('camera-navigation'), BENCH],
  }),
  callout('geschätzt', 'Wie belastbar die Zeiten sind',
    p(`Alle Läufe fanden auf einer geteilten Maschine statt. Audits und Paketberichte nennen Load-Averages von ${fmt.num(loadMin)} bis ${fmt.num(loadMax)}. Build- und Frame-Zeiten sind deshalb Obergrenzen. Die Byte-Größen und Flächenzahlen hängen davon nicht ab.`),
    { src: [DAILY, RENDER_AUDIT, 'docs/viewer/package-*.md'] }),
);

/** Hover: the marked bore (cropped) and the status line under it at native size. */
function hoverFigure() {
  const HOVER = 'out/viewer/exact-measure/01-hover-bore.png';
  const top = shot(HOVER, { crop: [250, 12, 536, 290], alt: 'Hover über der Bohrung einer Distanzhülse: die ganze Bohrung ist gelb markiert' });
  const status = shot(HOVER, { crop: [458, 700, 300, 34], native: true, alt: `Statuszeile: ${q.hover} · B1.F3` });
  return `<figure class="img hover-fig">${imgTag(top)}${imgTag(status)}<figcaption>${inline(`**Hover.** Ohne Klick markiert der Viewer die ganze Bohrung. Die Statuszeile (darunter in Originalgröße) zeigt „${q.hover}“.`)}</figcaption>${source(`\`${HOVER}\` (Ausschnitte)`)}</figure>`;
}

const s5 = section(
  { title: 'Neue Funktionen in Bildern', note: 'Screenshots aus den Paket-Abnahmen, Chromium headless. Pfade und IDs aus den Inspector-Bereichen sind abgeschnitten.' },
  grid({ wide: true },
    shot('out/viewer/fdm/a4-cross-bore-16-band.png', { alt: 'FDM: Overhang-Band rot in einer Ø16-Querbohrung, Legende mit Schwelle 45°', caption: `**FDM.** Overhang-Band in einer Ø16-Querbohrung. Die Legende nennt die Schwelle und dass die Brücken-Ausnahme fehlt.` }),
    shot('out/viewer/thickness-probe/a1-1-bracket-top-8mm.png', { crop: [60, 80, 660, 520], alt: 'Wandstärke-Sonde: 8.00000 mm kernel mit Maßlinie', caption: '**Wandstärke.** `K` und ein Klick: der Kernel misst entlang der exakten Normalen.' }),
    hoverFigure(),
    shot('out/viewer/section/a2-1-bored-spacer-caps.png', { crop: [300, 20, 724, 690], alt: 'Schnitt durch eine Distanzhülse mit schraffierter Deckfläche und Schnitt-Panel', caption: `**Schnitt.** Deckfläche als Anzeige (±${de(q.tol)} mm), exakte Kontur vom Kernel per Knopf.` }),
    shot('out/viewer/diff-overlay/02-shift-w-r3-ghost-blend-35.png', { crop: [300, 250, 724, 420], alt: 'Diff-Ghost der vorigen Revision blau über der aktuellen, Leiste mit Bounds-Delta und Volumen-Delta', caption: '**Diff-Ghost.** `Shift+W`: r3 blau über r4, Bounds-Δ vom Kernel, Volumen-Δ aus den Aufzeichnungen.' }),
    shot('out/viewer/parts-tree/a1-multibody-parts-tab.png', { crop: [1, 230, 880, 560], alt: 'Teilebaum mit vier Körpern, Farbfeldern, Augen und Flächenzahlen roh und logisch', caption: '**Teilebaum.** Vier Körper mit Farbe, Sichtbarkeit und Flächenzahl „roh (logisch)“.' }),
    shot('out/viewer/source-links/01-arc-face-page.png', { crop: [560, 141, 976, 497], alt: 'Inspector: Sketch source skArc right line 10 für eine gewählte Zylinderfläche', caption: `**Quelle.** Fläche gewählt, der Inspector nennt zuerst das Skizzen-Element („${q.skarc}“).` }),
    shot('out/viewer/help-a11y/10-dark-theme-integrated.png', { crop: [232, 72, 1304, 620], alt: 'Viewer im Dunkelmodus mit Bracket und Inspector', caption: '**Dunkelmodus.** Teil von `help-a11y`, dazu `?` für die Tastenübersicht.' }),
  ),
);

const s6 = section(
  { title: 'Offen / nächste Schritte' },
  grid(
    committed ? card({ eyebrow: FU ? 'erledigt' : 'läuft', kind: FU ? 'gemessen' : 'offen', title: FU ? 'Folgerunde committet' : 'Offene Defekte beheben',
      body: p(defectsLine),
      src: [SPEC, FU ? `git show ${followUp.hash}` : 'git status'] }) : card({ eyebrow: 'jetzt', kind: 'offen', title: 'Integration fertigstellen',
      body: p(`Die Integrationsanfragen aus ${passedCount} Paketberichten sind in einem Stand zusammengeführt${lastTests ? `; zuletzt ${lastTests.fail} rote von ${fmt.num(lastTests.tests)} Tests` : ''}${qaFail.length ? ` und ${qaFail.length === 1 ? 'ein roter Browser-Schritt' : `${qaFail.length} rote Browser-Schritte`} (${listDe(qaFail.map(qaLong))})` : ''}. Offen: ${lastTests?.fail || qaFail.length ? 'diese Fälle beheben, ' : ''}${qaOf('live').length ? '' : 'ein QA-Lauf mit gespeichertem Ergebnis für die Live-Sitzung, '}die unabhängige Prüfung und der Integrationsbericht.`),
      src: [...(lastTests ? [lastTests.rel] : []), ...qaSrc, ...(lastTests || qaSrc.length ? [] : [MORNING])] }),
    card({ eyebrow: 'danach', kind: 'offen', title: 'Alltagstest wiederholen',
      body: p(`Dieselben ${taskRows.length} Aufgaben am integrierten Viewer, mit einem echten Teil von dir. Erst dann ist die rechte Spalte oben gemessen statt zugeordnet.`),
      src: DAILY }),
    card({ eyebrow: committed ? 'erledigt' : 'danach', kind: committed ? 'gemessen' : 'offen', title: committed ? 'Committet' : 'Committen',
      body: p(committed
        ? `Der Viewer ist committet: \`${viewerCommit.hash}\` vom ${viewerCommit.at.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', timeZone: 'Europe/Berlin' })}, ${hm(viewerCommit.at)} Uhr${followUp ? `, die Folgerunde als ${fuWhen}` : ''}.${viewerDirty ? ` Seitdem sind ${viewerDirty} Pfade unter \`viewer/\`, \`src/viewer/\` und \`docs/viewer/\` geändert, nicht committet.` : ' Der Arbeitsbaum ist an diesen Pfaden sauber.'}`
        : `Nach dem Initial-Import vom 22.09. gibt es ${viewerCommits ? `${viewerCommits} Viewer-Commit${viewerCommits === 1 ? '' : 's'}` : 'keinen Viewer-Commit'}. ${viewerDirty} Pfade unter \`viewer/\`, in \`src/review-server.mjs\` und \`bin/wonky-view.mjs\` sind geändert, gelöscht oder neu. Committet wird erst nach der Integrationsprüfung.`),
      src: ['git log --since 2026-09-22 · git status', ...(committed ? [] : [MORNING])] }),
  ),
  details('Bekannte Lücken, die du im Alltag merken wirst', grid(
    card({ title: 'Kernel und Frontends', kind: 'offen',
      body: ul([
        `Echte Teile bauen kaum (${fmt.num(corpus.totals.fileStatus.ok)} von ${fmt.num(corpus.totals.filesRun)} Dateien). Der Viewer zeigt dann den Fehler, beheben muss es der Kernel.`,
        committed ? '`.py`: Bei den Paket-Abnahmen hatte der Teilebaum keine Namen und Farben, und lokale Imports scheiterten am `-I -S`-Start. Das Python-Frontend (W5, committet) hat seitdem `sys.path` wie `python model.py` und Namen und Farben über `cad_khana`; am Viewer ist das nicht nachgeprüft.' : '`.py`: Teilebaum ohne Namen und Farben, lokale Imports scheitern am `-I -S`-Start. Liegt beim Python-Frontend.',
        'Kein Fortschritt pro Operation: dafür fehlt ein `onOperation`-Hook in `build()`.',
      ]),
      src: [CORPUS, SPEC, ...(committed ? ['docs/corpus/w5.md'] : [])] }),
    card({ title: 'Messen und FDM', kind: 'offen',
      body: ul([
        'Kein allgemeiner Minimalabstand, keine Interferenz, kein Flächeninhalt: Bend hat dafür noch keine Funktionen. Der Viewer sagt „unsupported“.',
        `Höchstens ${q.maxEntities} Entitäten pro Messung; Kegel nur über ihre Achse.`,
        `Brücken-Ausnahme (≤ ${q.bridge} mm) nicht angewandt: flache Decken bis ${q.bridge} mm werden getönt.`,
        'Overhang pro logischer Fläche, ohne Fläche in mm².',
      ]),
      src: [pkgDoc('exact-measure'), pkgDoc('fdm')] }),
    card({ title: 'Darstellung', kind: 'offen',
      body: ul([
        `X-Ray bei ${fmt.num(stressTris)} Dreiecken: ${de(xrayMs)} ms pro Frame, über dem Budget von ${frameBudget} ms.`,
        `Dunkle Modellfarben: Kantenkontrast nur ${de(q.dark)}:1.`,
        'Keine Silhouettenlinien an gekrümmten Flächen.',
        'Schnitt: ein Pick auf eine Deckfläche trifft die verdeckte Fläche dahinter.',
      ]),
      src: [pkgDoc('render-look'), pkgDoc('section')] }),
    card({ title: 'Browser und Kleinkram', kind: 'offen',
      body: ul([
        'Getestet nur in Chromium. Safari kann das Kopieren nach der Server-Antwort ablehnen.',
        'Dunkelmodus: beim Laden kann ein heller Frame aufblitzen.',
        'Quellzeilen-Links auf Flächenebene nur für Linien- und Bogen-Skizzen; Koaxial- und Durchstoß-Booleans haben keine `faceOrigins`.',
      ]),
      src: [pkgDoc('reviews-context'), pkgDoc('help-a11y'), pkgDoc('source-links')] }),
  )),
  details('Was sich an der Bedienung ändert', table({
    columns: ['Bisher', 'Neu'],
    rows: [
      ['Vergleich (Wipe) ist Standard', 'Aus, pro Quelle gemerkt; `W` vergleicht mit der vorigen Revision'],
      ['`F` setzt die Ansicht zurück', '`F` passt ein und behält die Blickrichtung; `0`/Home ist die Standardansicht'],
      ['Pfeiltasten drehen in kleinen Schritten', `Pfeiltasten: ${de(q.arrows).replace('Ctrl', 'Strg').replace('Shift', 'Umschalt')}`],
      ['Ziehen bewegt die Kamera', 'Ziehen dreht das Modell mit dem Zeiger, wie im OCP-Viewer'],
      ['Markup-Werkzeuge bleiben aktiv', 'Einmal-Werkzeuge; Doppelklick hält sie fest, Escape löst'],
      [`Port ${q.oldPort} fest`, `Port aus dem Quellpfad (${q.port}), \`--port\` bleibt strikt`],
      ['WebGL1', 'WebGL2 nötig; ohne gibt es eine klare Meldung, der Inspector geht weiter'],
    ],
    src: [SPEC, pkgDoc('camera-navigation'), pkgDoc('live-server')],
  })),
);

const SOURCES = [
  [DAILY, 'Alltags-Audit: 8 Aufgaben, Zeiten, Screenshots'],
  [RENDER_AUDIT, 'Rendering-Audit: Spiegelung, Picking, Payload, Kanten'],
  [SPEC, `Spec ${q.specRev.replace('revision', 'Revision')}: Zielbild, Wellen, Abnahmekriterien`],
  [FOUNDATION, 'Fundament F1–F4'],
  ['docs/viewer/package-*.md', `${delivered.length} Paketberichte mit Abnahme, Lücken, Integrationsanfragen`],
  [BENCH, 'Messwerte alter Viewer (Pick, Transfer, GPU)'],
  [TRANSPORT, 'Draw-Payload r10b-retained'],
  [STRESS_PICK, 'Pick und Payload Stresstest'],
  [LOOK_PERF, 'Frame-Zeit neuer Renderer'],
  [LIVE_TIMING, 'Speichern → Bild, 5 Läufe'],
  [CORPUS, 'Korpus-Triage: wie viele echte Teile bauen'],
  [MORNING, 'Local development record'],
  ...testRuns.map((r) => [r.rel, `Testlauf der Integration, ${hhmm(r.at)} (Arbeitsdatei)`]),
  ...qaSrc.map((rel) => [rel, 'Browser-QA am integrierten Stand (Arbeitsdatei)']),
  ...(LIVE_LOG ? [[LIVE_LOG, 'Terminal-Log der Live-Sitzung am integrierten Stand']] : []),
  ...(apiCli.length ? [[API_CLI, 'API- und CLI-Prüfungen am integrierten Stand']] : []),
  ...(contrast.length ? [[CONTRAST, 'Kontrast-Audit nach der Farb-Migration']] : []),
  ['out/viewer/**/*.png', 'Screenshots (Audit, Paket-Abnahmen, Integration; als AVIF eingebettet, kleine UI-Ausschnitte in Originalgröße)'],
  ...(committed ? [[UI, 'Prüfungen und Nachweise des committeten Stands: Browser-QA, Fix-Runden, CLI/API, Tests'], [`${SPEC} (Schluss)`, 'Offene Defekte beim ersten Commit, Stand der Folgerunde'], ['out/viewer/verify-*/', 'Screenshots der Prüfrunden (Browser, Exaktheit, Live-Loop, Regression)'], ['docs/corpus/w5.md', 'Python-Frontend: `sys.path`, Namen und Farben']] : []),
  ...(followUp ? [[`git show ${followUp.hash}`, 'Commit-Nachricht der Folgerunde: was sie behebt']] : []),
  ['git log --since 2026-09-22 · git status', committed ? `Viewer committet (\`${viewerCommit.hash}\`${followUp ? `, Folgerunde \`${followUp.hash}\`` : ''}), ${viewerDirty} Pfade seitdem geändert` : 'Viewer-Code nicht committet'],
];
const s7 = section('Quellen',
  // A list, not a table: paths break at their slashes and stack under the purpose on phones.
  `<ul class="srcs">${SOURCES.map(([f, w]) => `<li><code>${esc(f).replaceAll('/', '/<wbr>')}</code><span>${inline(w)}</span></li>`).join('')}</ul>`,
  p('Alle Zahlen im Bericht werden beim Erzeugen aus diesen Dateien gelesen (`scripts/reports/viewer.mjs`). „gemessen“ heißt: aus einem QA-Lauf oder Benchmark. „geschätzt“ heißt: Einschätzung im Audit, nicht gemessen.'),
);

// ── page ─────────────────────────────────────────────────────────────────────
let html = page({
  title: 'Viewer: vom Review-Tool zum Cockpit',
  kicker: 'wonky · Bericht Viewer-Rework',
  date: stand,
  meta: [
    ['Umfang', `${AUDIT_COUNT} Audits · Spec Rev. ${specRevNo} · ${packages.length} Pakete in ${waves.length} Wellen`],
    ['Code-Stand', committed ? `committet \`${viewerCommit.hash}\` (${hm(viewerCommit.at)} Uhr)${followUp ? ` · Folgerunde \`${followUp.hash}\` (${hm(followUp.at)} Uhr)` : ''}${viewerDirty ? ` · seitdem ${viewerDirty} Pfade geändert` : ''}` : `nicht committet · Integration: ${integrationDoc ? 'Bericht liegt vor' : `Zwischenstand ${integrationTime ?? 'offen'}`}`],
    ['Zahlen aus', '`docs/viewer/` und `out/viewer/`'],
  ],
  lede: committed
    ? `**Kurzfassung.** Der neue Viewer ist committet (\`${viewerCommit.hash}\`): ein Live-Cockpit neben dem Editor, das beim Speichern neu baut, ein Modell statt Vorher/Nachher zeigt, exakt misst und FDM prüft. Alle ${passedCount} Pakete der Spec sind abgenommen, der gemeinsame Stand besteht ${V.tests} Tests und ${V.qa} Schritte der Browser-QA. ${FU ? `Die ${ROUND_NOM[V.round] ?? V.round} Prüfrunde ließ ${openDefects.high} hohe und ${openDefects.medium} mittlere Defekte offen; die Folgerunde \`${followUp.hash}\` hat laut Commit-Nachricht ${FU.bothHigh ? 'beide hohen und ' : ''}die Mess- und Live-Loop-Defekte behoben. Offen ist ein Alltagstest mit deinen ${taskRows.length} Aufgaben.` : `Offen sind ${openDefects.high} hohe und ${openDefects.medium} mittlere Defekte aus der ${ROUND_DE[V.round] ?? V.round} Prüfrunde (eine Folgerunde läuft) und ein Alltagstest mit deinen ${taskRows.length} Aufgaben.`}`
    : `**Kurzfassung.** Alle ${passedCount} Pakete der Viewer-Spec sind gebaut und haben ihre Abnahme im Browser bestanden: Live-Loop aus der Quelle, model-first, exaktes Messen, FDM-Prüfung, Schnitt, Diff-Ghost und Teilebaum. ${testsTxt ? `Im gemeinsamen Stand (Zwischenstand ${integrationTime} Uhr) sind ${testsTxt}${qaTxt ? ` und ${qaTxt}` : ''}; offen sind der Rest der Integration` : 'Offen sind die Integration in einen gemeinsamen Stand'}, ein neuer Alltagstest mit deinen ${taskRows.length} Aufgaben und der Commit.`,
  sections: [lead, s0, s1, s2, s3, s4, s5, s6, s7].filter(Boolean),
  footer: 'Erzeugt von `scripts/reports/viewer.mjs` aus `docs/viewer/`, `docs/viewer-ui.md`, `out/viewer/`, `tmp/viewer/integration/` und `out/corpus/`. Screenshots: Chromium headless aus Audit, Paket-Abnahmen, Integrations-QA und den Prüfrunden.',
});

// Report-specific styles go into the kit's <style>; the TOC moves below the key tiles.
html = html.replace('</style>', () => `${EXTRA_CSS}</style>`);
const toc = html.match(/<nav class="toc"[\s\S]*?<\/nav>\n?/);
if (toc) html = html.replace(toc[0], '').replace(lead, () => `${lead}\n${hero}\n${toc[0]}`);
else html = html.replace(lead, () => `${lead}\n${hero}`);
assertPublicSafe(html);
writeReport('viewer.html', html);
