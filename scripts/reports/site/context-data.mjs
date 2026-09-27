#!/usr/bin/env node
// Freeze report context at history.json's revision; no tests or geometry are run.
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO, readJson, assertPublicSafe } from '../lib.mjs';

const { head } = readJson('out/site/data/history.json');
if (!/^[0-9a-f]{7,40}$/.test(head)) throw new Error('Invalid history revision');
const git = (...args) => execFileSync('git', args, { cwd: REPO, encoding: 'utf8' });
const read = path => git('show', `${head}:${path}`);
const packageData = JSON.parse(read('package.json'));
const timings = JSON.parse(read('test/lanes.json'));
const laneSource = read('scripts/test-lane.mjs');
const threshold = Number(laneSource.match(/const SLOW_SECONDS = (\d+);/)?.[1]);
if (!threshold || threshold !== timings.threshold_s) throw new Error('Lane threshold changed; inspect runner before updating the report');
const files = git('ls-tree', '-r', '--name-only', head, '--', 'test').trim().split('\n').filter(p => /^test\/[^/]+\.test\.mjs$/.test(p));
const rows = files.map(file => {
  const seconds = timings.seconds[file.slice(5)] ?? null;
  return { file, seconds, lane: (seconds ?? 0) < threshold ? 'fast' : 'slow' };
});
const src = [`git show ${head}:test/lanes.json`, `git show ${head}:scripts/test-lane.mjs`, `git ls-tree -r --name-only ${head} -- test`];
const data = {
  schema: 'wonky/site/context/v1', head,
  purpose: 'Quellengebundene Kontext- und Lane-Daten für die öffentliche Website; bei Regeneration ersetzen.',
  architecture: [
    { title: 'wonky core', note: 'Geometriekern vollständig in Bend. Analytische Geometrie, exakte Prädikate und ein Hybrid-Boolean-Pfad. OpenCascade ist Referenzprüfer, kein Produktionskern.', src: ['AGENTS.md', 'out/site/data/history.json#/milestones'] },
    { title: 'FeatureScript', note: 'Unveränderte FeatureScript-Syntax als Modelleingabe. Parser und Interpreter führen unterstützte Operationen aus; fehlende Fähigkeiten werden explizit verweigert.', src: ['AGENTS.md', 'out/site/data/roadmap.json#/packages'] },
    { title: 'build123d', note: 'Python-Modelle über den build123d-kompatiblen Frontend-Pfad. Geometrie entsteht in wonky; API-Kompatibilität ist keine Zusage für den gesamten build123d-Umfang.', src: ['out/site/data/history.json#/milestones', 'out/site/data/performance.json#/build123d'] },
    { title: 'Viewer', note: 'Modellzentrierter Live-Viewer mit Workspace-Dateien, Baugruppenbaum, Messungen und Rückmeldung. Die gerenderte Oberfläche ist nicht das exakte Modell.', src: ['out/site/data/history.json#/milestones', 'docs/viewer/workspace.md'] },
  ],
  tests: {
    kind: 'gemessen', thresholdSeconds: threshold,
    counts: { files: rows.length, fast: rows.filter(r => r.lane === 'fast').length, slow: rows.filter(r => r.lane === 'slow').length, recorded: rows.filter(r => r.seconds !== null).length, unrecorded: rows.filter(r => r.seconds === null).length },
    counting: 'Dateiauswahl wie im versionierten Lane-Runner: gespeicherte Zeit < Schwelle = fast; >= Schwelle = slow; neue Dateien ohne Zeit = fast. Dateianzahlen sind keine bestandenen Tests. Zeiten sind gespeicherte Warm-Cache-Werte, nicht aktuelle Laufzeiten.',
    src, rows,
    commands: ['test', 'test:fast', 'test:changed', 'test:slow', 'test:record', 'check:bend'].map(name => ({ name, command: `pnpm ${name === 'test' ? 'test' : `run ${name}`}`, implementation: packageData.scripts[name], src: [`git show ${head}:package.json`] })),
    changedNote: 'changed wählt direkt geänderte Tests und Tests mit Dateinamen-Treffern aus. Das ist eine Heuristik, keine vollständige Abhängigkeitsanalyse.',
    verification: [
      { title: 'Schnell entwickeln, vollständig integrieren', note: 'Fast und changed nutzen Fail-fast. Vollprüfung enthält Bend-Prüfung und alle Node-Testdateien. Für diese Website wurde keine neue Kernel-Gesamtabnahme ausgeführt.', src: ['package.json', 'scripts/test-lane.mjs'] },
      { title: 'Geometrie statt grüner Zähler', note: 'Eine erwartete Ablehnung kann einen Test bestehen, liefert aber noch kein Modell. Exact B-rep, Certified Mesh und verweigerte Fälle getrennt betrachten.', src: ['AGENTS.md', 'out/site/data/roadmap.json#/r20/limitations'] },
      { title: 'Unabhängige Referenzen', note: 'STEP-Exporte mit externen Werkzeugen prüfen. Volumenintervalle und Vergleichsbilder helfen, beweisen aber weder geometrische Gleichheit noch eine Hausdorff-Grenze.', src: ['AGENTS.md', 'out/site/data/models.json#/notes'] },
      { title: 'Revision und Messgrenze festhalten', note: 'Gespeicherte Läufe nicht als neue Abnahme von main ausgeben. Bei unveränderten Quellen vorhandene Belege nutzen; JS, native CPU und Metal nicht miteinander gleichsetzen.', src: ['AGENTS.md', 'out/site/data/performance.json#/provenanceConvention'] },
    ],
  },
};
const text = `${JSON.stringify(data, null, 2)}\n`;
assertPublicSafe(text);
writeFileSync(join(REPO, 'out/site/data/context.json'), text);
console.log(`context.json: ${rows.length} test files at ${head}`);
