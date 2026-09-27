// Builds out/reports/_csp-test.html: one PNG data URI + CSS-only interactivity,
// plus one of every component so the postplan CSP check covers SVG patterns,
// clip paths, CSS custom properties and <details>. Numbers are real repo data.
//   node scripts/reports/csp-test.mjs
import {
  page, section, p, tiles, grid, card, callout, table, details, image,
  barChart, stackedBar, beforeAfter, diagram, fmt, readJson, writeReport,
} from './lib.mjs';

const CORPUS = 'out/corpus/summary.json';
const BENCH = 'out/native-bridge/slice/bench.json';
const corpus = readJson(CORPUS);
const bench = readJson(BENCH);
const u = corpus.totals.unitStatus;

const html = page({
  title: 'CSP-Test Berichtsvorlage',
  date: '2026-09-23',
  meta: [['Zweck', 'Prüft, was postplan rendert'], ['Erzeugt von', '`scripts/reports/csp-test.mjs`'], ['Inhalt', 'echte Repo-Zahlen, keine Aussage']],
  lede: 'Testseite für den Upload auf postplan.dev. Sie enthält ein eingebettetes PNG (data URI), aufklappbare Blöcke ohne JavaScript und jede Diagrammform der Vorlage.',
  sections: [
    section('Bild als data URI',
      image('out/viewer-qa/side-by-side-744.png', { alt: 'Viewer im Side-by-side-Modus mit zwei L-Profilen', caption: 'Viewer-QA-Screenshot, unverändert eingebettet (PNG).' }),
    ),
    section('Kennzahlen und Hinweise',
      tiles([
        { label: 'Einheiten gelaufen', value: fmt.num(corpus.totals.unitsRun), kind: 'gemessen', src: CORPUS },
        { label: 'Einheiten ok', value: fmt.num(u.ok), note: `von ${fmt.num(corpus.totals.unitsPlanned)}`, kind: 'gemessen', src: CORPUS },
        { label: 'Bend-Kompilat', value: fmt.num(bench.build.seconds.bend, 1), unit: 's', kind: 'gemessen', src: BENCH },
        { label: 'Beispiel offen', value: '–', note: 'Platzhalter für offene Werte', kind: 'offen' },
      ]),
      callout('entscheidung', 'Beispiel Entscheidung', p('So sieht eine Entscheidung aus.')),
      callout('geschätzt', 'Beispiel Schätzung', p('Schraffur heißt: geschätzt, nicht gemessen.')),
      grid(
        card({ title: 'Karte', eyebrow: 'Komponente', kind: 'gemessen', body: p('Karten gruppieren kurze Befunde.') }),
        card({ title: 'Fehlgeschlagen', kind: 'fehlgeschlagen', body: p('Was nicht geklappt hat, bekommt dieses Label.') }),
      ),
      details('Aufklappen (CSS-only, details/summary)', table({
        columns: ['Status', { label: 'Einheiten', align: 'right' }],
        rows: Object.entries(u).map(([k, v]) => [k, fmt.num(v)]),
        src: CORPUS,
      })),
    ),
    section('Diagramme',
      stackedBar({
        title: 'Korpus-Einheiten nach Ergebnis',
        keys: [{ key: 'frontend', label: 'Frontend' }, { key: 'capability', label: 'Capability' }, { key: 'kernel', label: 'Kernel' }, { key: 'ok', label: 'ok' }],
        rows: [{ label: 'alle', values: u }],
        src: CORPUS,
      }),
      barChart({
        title: 'Native Build: Zeit pro Schritt',
        unit: 's',
        data: Object.entries(bench.build.seconds).map(([label, value]) => ({ label, value: Math.round(value * 100) / 100, kind: 'gemessen' })),
        src: BENCH,
      }),
      beforeAfter({
        title: 'dlopen: erster vs. warmer Load',
        labels: { before: 'erster Load', after: 'warm' },
        data: [{ label: 'dlopen', before: bench.build.firstLoad.dlopenMs, after: bench.build.warmLoad.dlopenMs }],
        format: fmt.ms,
        src: BENCH,
      }),
      diagram({
        title: 'Architektur (vereinfacht)',
        sub: 'Illustration aus der Paketbeschreibung',
        nodes: [
          { id: 'fs', label: 'FeatureScript', col: 0, row: 0 },
          { id: 'py', label: 'build123d', col: 0, row: 1 },
          { id: 'k', label: 'Bend-Kernel', sub: 'B-rep', col: 1, row: 0, kind: 'accent' },
          { id: 'v', label: 'Viewer', col: 2, row: 0 },
          { id: 'n', label: 'Native Binding', col: 1, row: 1, kind: 'planned' },
        ],
        edges: [{ from: 'fs', to: 'k' }, { from: 'py', to: 'k' }, { from: 'k', to: 'v', label: 'Mesh' }, { from: 'k', to: 'n', planned: true }],
      }),
    ),
  ],
});

writeReport('_csp-test.html', html);
