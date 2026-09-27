import { redactPrivateTerms } from '../private-terms.mjs';
// Read-only data generator for the public report site's Fortschritt/Roadmap pages.
// Consumer: the report-site HTML generator. Regenerate rather than editing derived JSON.
// No kernel execution, services, live references, or network calls. Node built-ins only.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { assertPublicSafe } from '../lib.mjs';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const OUT = join(ROOT, 'out/site/data');
const git = (...args) => execFileSync('git', ['-C', ROOT, ...args], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
const text = path => readFileSync(join(ROOT, path), 'utf8');
const json = path => JSON.parse(text(path));
const HEAD = git('rev-parse', 'HEAD').trim();
const SHORT = HEAD.slice(0, 7);
if (process.env.WONKY_LOCAL_HISTORY !== '1') {
  console.log('local-only historical report inputs: use the frozen public site instead');
  process.exit(0);
}
const trackedText = path => git('show', `${HEAD}:${path}`);
const sourceAt = (path, fragment = '') => `${path}${fragment} (main@${SHORT})`;
const rows = git('log', '--reverse', '--topo-order', '--format=%H%x09%cI%x09%aI%x09%s', HEAD).trim().split('\n').map(line => {
  const [oid, date, authorDate, ...subject] = line.split('\t');
  return { oid, hash: oid.slice(0, 7), date, authorDate, subject: subject.join('\t') };
});
const commitByHash = hash => {
  const row = rows.find(row => row.hash === hash);
  if (!row) throw new Error(`Required milestone commit absent from main: ${hash}`);
  return row;
};
const logSource = `git log --reverse --topo-order --format='%h %cI %aI %s' ${SHORT}`;
const headRow = rows.find(row => row.oid === HEAD);
const srcCommit = hash => `git show --no-patch --format='%h %cI %s %b' ${hash}`;

// Disjoint buckets. Physical lines include blank lines and comments, never claim SLOC.
const AREAS = {
  kernel: /^(?:kernel\/.*|LAWS|PROOF)\.bend$/,
  frontend: /^(?:src|bin|python)\/.*\.(?:m?js|py)$/,
  viewer: /^viewer\/.*\.(?:m?js|css|html)$/,
  twin: /^twin\/(?!tests\/).*\.py$/,
  tests: /^(?:test\/.*\.(?:m?js|py)|twin\/tests\/.*\.py)$/,
  docs: /^(?:docs\/.*\.md|(?:README|AGENTS)\.md)$/,
  tooling: /^scripts\/.*\.(?:m?js|py)$/,
};
const testPath = /^test\/[^/]+\.test\.mjs$/;
const areaOf = path => Object.entries(AREAS).find(([, re]) => re.test(path))?.[0];
const trees = new Map();
const uniqueBlobs = new Map();
for (const row of rows) {
  const entries = git('ls-tree', '-r', '-z', row.oid).split('\0').filter(Boolean).flatMap(entry => {
    const match = entry.match(/^100\d+ blob ([a-f0-9]+)\t(.+)$/s);
    if (!match) return [];
    const [, blob, path] = match;
    const area = areaOf(path);
    if (!area) return [];
    uniqueBlobs.set(blob, null);
    return [{ blob, path, area }];
  });
  trees.set(row.oid, entries);
}
// One read per distinct content, in bounded batches rather than one git-show process
// per file per commit. This is byte-identical to git show <commit>:<path>.
const ids = [...uniqueBlobs.keys()];
for (let start = 0; start < ids.length; start += 64) {
  const batch = ids.slice(start, start + 64);
  const bytes = execFileSync('git', ['-C', ROOT, 'cat-file', '--batch'], {
    input: batch.join('\n') + '\n', maxBuffer: 64 * 1024 * 1024,
  });
  let offset = 0;
  for (const id of batch) {
    const end = bytes.indexOf(10, offset);
    const [actual, type, length] = bytes.subarray(offset, end).toString().split(' ');
    if (actual !== id || type !== 'blob') throw new Error('Unexpected git cat-file response');
    const size = Number(length);
    const content = bytes.subarray(end + 1, end + 1 + size).toString('utf8');
    const physicalLines = content.length ? (content.match(/\n/g) ?? []).length + (content.endsWith('\n') ? 0 : 1) : 0;
    uniqueBlobs.set(id, { lines: physicalLines, testCases: (content.match(/^\s*(test|it)\(/gm) ?? []).length });
    offset = end + 1 + size + 1;
  }
}
const AREA_LABELS = { kernel: 'Kern (Bend)', frontend: 'Frontends und CLI', viewer: 'Viewer', twin: 'Digitaler Zwilling', tests: 'Tests und Testhelfer', docs: 'Dokumentation (Textzeilen)', tooling: 'Werkzeuge und Orakel' };
const publicText = value => redactPrivateTerms(String(value), '[privater Projektname entfernt]')
  .replace(/(?:\/Users\/|\/home\/|~\/)[^\s`"'<>]+/g, '[lokaler Pfad entfernt]')
  .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[E-Mail entfernt]')
  .replace(/\b[a-f0-9]{24}\b/gi, '[externe Kennung entfernt]');
function classify(row, paths) {
  const areas = [...new Set(paths.map(path => areaOf(path)).filter(Boolean))];
  let area;
  if (/^(?:docs\/|AGENTS\.md:|Add the .*skill|Add the Honest|Test-audit gate and AGENTS)/i.test(row.subject)) area = 'docs';
  else if (paths.some(path => path.startsWith('twin/'))) area = 'twin';
  else if (areas.includes('kernel')) area = 'kernel';
  else if (areas.includes('frontend')) area = 'frontend';
  else if (areas.includes('viewer')) area = 'viewer';
  else if (/test|lane|oracle/i.test(row.subject)) area = 'tests';
  else if (areas.every(area => ['docs', 'tooling'].includes(area)) && /report|research|design|decision|survey|plan|knowledge|language|triage|corpus/i.test(row.subject)) area = 'docs';
  else if (areas.includes('tests')) area = 'tests';
  else area = areas.includes('docs') ? 'docs' : 'kernel';
  return { area, areas: [...new Set([area, ...areas.filter(a => a !== 'tooling')])] };
}
const commits = rows.map(row => {
  const entries = trees.get(row.oid);
  const lines = Object.fromEntries(Object.keys(AREAS).map(key => [key, 0]));
  const files = { ...lines };
  let testCases = 0, testFiles = 0;
  for (const entry of entries) {
    const counts = uniqueBlobs.get(entry.blob);
    lines[entry.area] += counts.lines;
    files[entry.area]++;
    if (testPath.test(entry.path)) { testCases += counts.testCases; testFiles++; }
  }
  const paths = git('diff-tree', '--root', '--no-commit-id', '--name-only', '-r', '-m', row.oid).trim().split('\n');
  const subject = publicText(row.subject);
  return {
    hash: row.hash, date: row.date, authorDate: row.authorDate,
    subject, subjectRedacted: subject !== row.subject, ...classify(row, paths),
    testCases, testFiles, lines, files,
    codeLines: Object.entries(lines).filter(([key]) => key !== 'docs').reduce((sum, [, value]) => sum + value, 0),
    src: {
      commit: srcCommit(row.hash),
      tests: `git ls-tree -r ${row.hash} -- test; git show ${row.hash}:test/<datei>.test.mjs | count /^\\s*(test|it)\\(/gm`,
      lines: `git ls-tree -r ${row.hash}; git show ${row.hash}:<datei>; Bereichsfilter: scripts/reports/site/history.mjs`,
    },
  };
});
const dailyMap = new Map();
for (const c of [...commits].sort((a, b) => a.date.localeCompare(b.date))) {
  const day = c.date.slice(0, 10), prior = dailyMap.get(day);
  dailyMap.set(day, { date: day, commit: c.hash, commits: (prior?.commits ?? 0) + 1, testCases: c.testCases, testFiles: c.testFiles, codeLines: c.codeLines, lines: c.lines, src: [c.src.tests, c.src.lines, logSource] });
}
const milestone = (id, hash, title, note, extraSources = [], area = undefined) => {
  const c = commits.find(c => c.hash === hash);
  if (!c) throw new Error(`Missing milestone ${hash}`);
  return { id, commit: hash, date: c.date, area: area ?? c.area, title, note, kind: 'gemessen', src: [srcCommit(hash), ...extraSources] };
};
const milestones = [
  milestone('initial', 'cd9ba68', 'Erster Commit: Bend-Kern und zwei Frontends', 'Beginn der Git-Historie; kein Nachweis für den tatsächlichen Beginn der Entwicklung.'),
  milestone('revolve', '8b21014', 'Exakte Rotationskörper', 'Geschlossene Polygonprofile werden als exakte Rotationskörper ausgewertet.'),
  milestone('print-mesh', 'c50077b', 'Drucknetz mit ausgewiesener Abweichung', 'Analytische Körper bleiben von ihrer Netzdarstellung unterscheidbar.'),
  milestone('holes', '79bbfee', 'Mehrere Bohrungen in einer Platte', 'Bohrungen und ein druckbares Netz mit mehreren Löchern.'),
  milestone('native', 'fb8ab43', 'Nativer planarer Kern im Prozess', 'Ein eigener Ausführungspfad, keine pauschale Beschleunigungszahl.'),
  milestone('hybrid', '0f17ee2', 'Boolean-Hybrid ausgewählt', 'Corefine plus exakte Rekonstruktion nach dem Boolean-Vergleich.'),
  milestone('python', 'fceffef', 'build123d-Projekte direkt ausführen', 'Python-Eingaben mit Ergebnisvertrag und cad_khana-Anbindung.'),
  milestone('viewer-live', 'd866717', 'Modellzentrierter Live-Viewer', 'Ein Viewer für Modelländerungen, Messungen und Rückmeldung.'),
  milestone('r20-first-documented', 'd917992', 'Erstes dokumentiertes R20-Modul: datums', 'Eine lokale Entwicklungsnotiz dokumentiert datums auf einem noch nicht integrierten Arbeitsstand. Nicht als vollständig verifizierter main-Stand zählen.', [], 'kernel'),
  milestone('r20-gate', '6e2c1a0', 'R20-Abnahmepfad in main', 'Historische Commit-Angabe: 16/17 Abnahmefälle. Abnahmefälle sind nicht Module; erwartete Ablehnungen zählen im damaligen Gate mit.'),
  milestone('test-lanes', 'ca60a85', 'Schnelle, geänderte und langsame Test-Lanes', 'Zeitbasierte Dateiauswahl und Fail-fast.', ['test/lanes.json'], 'tests'),
  milestone('r20-real', 'd094c04', 'Reale R20-Module probe, edge und return bauen', 'Robustere Hybrid-Booleans; nicht gleichbedeutend mit durchgehend exakter B-rep.'),
  milestone('fillets', 'd501565', 'Analytische Fillets und Fasen in Produktion', 'Verrundungen in Bend sowie FeatureScript- und build123d-Anbindung; verbleibende Klassen werden benannt verweigert.'),
  milestone('r20-six', '5a7206d', 'Sechs R20-Module dokumentiert', 'Historischer Stand: sechs Module ohne vollständige Blend-Pfade; alte Referenzen ausdrücklich eingeschränkt.', [], 'kernel'),
  milestone('workspace', '833cad2', 'Ein Viewer für das ganze Projekt', 'Workspace-Dateien, Baugruppenbaum und Baugruppenansichten.', ['docs/viewer/workspace.md'], 'viewer'),
  milestone('e1-evaluators', '6931dd2', 'Kurvenauswertung und lokale Bounding-Boxen', 'E1 teilweise gelandet. Die Coincidence-Korrektur gehört noch zum nicht integrierten Korrekturlauf.'),
  milestone('lazy-fillets', '4cc7893', 'Exakte Fillet-Formen nur bei Bedarf', 'Teure Breiten- und Sehnenformen werden erst aufgebaut, wenn der Float-Filter nicht entscheidet.'),
  milestone('r20-seven', '527c739', 'Sieben von acht R20-Modulen mit Build-Beleg', 'Kombinierte eingefrorene Läufe, nicht acht frisch gebaute Module auf main. T01 ist im alten tray-Stand exakt; der aktuelle tray-Snapshot ist neuer.', ['var/site/r20/current/comparison.json', 'tmp/r20-studios-snapshot-0925-2041/r20-modules-volumes.json']),
  milestone('twin-step-one', 'fa7b77c', 'Digitaler Zwilling: virtuelle Steuerplatinen', 'Virtuelle SKR-Pico-Platinen steuern den unveränderten Backend-Ablauf. Viewer-Bewegung, Kamera und Physik sind damit nicht abgeschlossen.', ['twin/README.md'], 'twin'),
];
const latest = commits.find(c => c.hash === SHORT);
const history = {
  schema: 'wonky/site/history/v1', language: 'de', branch: 'main', head: SHORT, asOf: headRow.date,
  methodology: {
    commitOrder: 'Alle von main erreichbaren Commits, topologisch vom ältesten zum neuesten; ISO-Committerzeit plus ISO-Autorzeit. Autoridentitäten werden nicht exportiert.',
    testCases: 'Statische Deklarationen /^\\s*(test|it)\\(/gm in unmittelbar unter test/ liegenden *.test.mjs-Dateien. Keine ausgeführten Tests, keine Passzahl. Dynamische Vervielfachung durch Schleifen, test.skip/test.only, Python-Twin-Tests und Bend-Beweise sind nicht enthalten.',
    lines: 'Physische Textzeilen regulärer getrackter Dateien (Git-Modus 100…) einschließlich Leerzeilen und Kommentaren; letzte Zeile ohne Zeilenumbruch zählt mit. Symlinks zählen nicht als zusätzliche Quelldateien. Keine Aussage über ausführbare SLOC. Docs sind Textzeilen und von codeLines ausgeschlossen. Fixture-Daten und Lockfiles sind ausgeschlossen; Bend-Prototypen im kernel-Baum sind eingeschlossen.',
    counting: 'Git-Bäume je Revision; Inhalt je unverändertem Blob einmal über git cat-file --batch gelesen (bytegleich zu git show REV:PFAD). Die Abschlussprüfung liest test/*.test.mjs zusätzlich über git show.',
    classification: 'Primärbereich heuristisch nach veränderten Dateien und Betreff. Mehrere betroffene Bereiche stehen zusätzlich in areas. tooling ist nur ein Zeilenzähler, keine siebte Timeline-Kategorie.',
    areas: Object.fromEntries(Object.entries(AREAS).map(([key, re]) => [key, { label: AREA_LABELS[key], pathRegex: re.source }])),
    src: ['scripts/reports/site/history.mjs', logSource],
  },
  summary: { commitCount: commits.length, firstCommit: commits[0].hash, firstDate: commits[0].date, lastDate: headRow.date, testCases: latest.testCases, testFiles: latest.testFiles, codeLines: latest.codeLines, lines: latest.lines, files: latest.files, src: [logSource, latest.src.tests, latest.src.lines] },
  commits, daily: [...dailyMap.values()], milestones,
};

const roadmapDoc = existsSync(join(ROOT, 'local design note')) ? text('local design note') : '';
const localStatuses = existsSync(join(ROOT, 'var/site/roadmap-status.json')) ? json('var/site/roadmap-status.json') : [];
const twinDoc = trackedText('docs/digital-twin.md');
function packageRows(doc, path, twin = false) {
  return doc.split('\n').flatMap((line, index) => {
    const match = line.match(/^\|\s*((?:[A-H]|TW)\d+)\s*\|/);
    if (!match) return [];
    // All package rows use escaped pipes only inside prose; keep them in the cell.
    const cells = line.replace(/\\\|/g, '\u0001').split('|').slice(1, -1).map(c => c.trim().replaceAll('\u0001', '|'));
    const [id, scope] = cells;
    const num = value => /^\d+(?:\.\d+)?$/.test(value) ? Number(value) : null;
    const isH = id.startsWith('H');
    return [{ id, lane: id.match(/^[A-Z]+/)[0], scope: publicText(scope),
      estimateDays: num(cells[twin ? 3 : isH ? 3 : 4]),
      researcherDays: twin ? null : num(cells[isH ? 2 : 3]),
      dependsOn: [...new Set((cells.at(-1).match(/\b(?:[A-H]\d+|TW\d+|viewer-workspace)\b/g) ?? []))],
      dependencyNote: publicText(cells.at(-1)), status: 'open', completedCommit: null,
      note: 'Für den vollständigen Paketumfang kein Abschluss in main nachgewiesen.',
      kind: 'offen', src: [sourceAt(path, `:${index + 1}`)],
    }];
  });
}
const TITLES = {
  A0:'R20: erste exakte Rekonstruktion', A1:'Rangabhängige Ecken und nahezu zusammentreffende Träger', A2:'Herkunft der Ebenenversätze', A3:'Exakte planare Membran-Anordnung', A4:'Materialabtrag nachweisen', A5:'KT1-Fußpunkte und Randgrenzen',
  B1:'Quadrik-Beziehungen und besondere Ellipsenschnitte', B2:'Algebraischer Kern und Quartik-Atlas', B3:'Getrimmte Quartiken in der B-rep', B4:'Kegelspitzen und singuläre Quartikfälle', B5:'Quartik-Volumen mit Beweisgrenzen', B6:'STEP-Export zertifizierter Quartik-Splines', B7:'Fillets neben Quartikkanten',
  C1:'Parabeln und Hyperbeln als Kurventypen', C2:'Exakte Kegelschnitte mit Konstruktionsherkunft', C3:'Kegelschnitte im STEP-Export', C4:'Kegelschnitt-Volumen und Drucknetz', C5:'KS09-Gehrungen', C6:'Offene Kurven und exakte BRIDGE',
  D1:'Planare Fragmente als geometrische Kanten', D2:'Fillet-Breitenprüfung auf realer Streifendomäne', D3:'Aufgebrauchte Streifen und Fasentreffen', D4:'Grenzen von Ellipsenbögen', D5:'FP14-Torusecke', D6:'Geteilte gekrümmte Träger', D7:'KS04: algebraischer Grat',
  E1:'Kurvenauswertung, Coincidence und lokale Boxen', E2:'Skizzenabfragen und Lebensdauer von Referenzen', E3:'Transformation, Zylinder und Festkörper-Loft', E4:'Weitere Abfragen und Messverträge',
  F1:'AP214-Konformität und strenger STEP-Validator', F2:'Körperweite Parameterkurven für Kegel und Torus', F3:'Bewiesene nichtlineare Parameterkurven', F4:'Optionaler AP242-Netzexport',
  G1:'Exakte Double-Word-Addition', G2:'STL-Abweichung einschließlich Float32-Rundung', G3:'Subnormalzahlen und Metal-Schutz', G4:'Normierte Dyaden und zertifizierte Fillet-Filter', G5:'Einheitlicher Koordinaten- und Budgetvertrag',
  H1:'Bewegungsvertrag und per-Körper-Kinematik', H2:'Statischer Körperabstand mit Grenzen', H3:'B-rep-zu-Netz-Abdeckung und Verfeinerung', H4:'Kontinuierliche Bewegungs- und Spaltprüfung', H5:'Zyklusablauf, Berichte und Latenz',
  TW0:'Prototypen: virtuelle Platinen und Sensorkamera', TW1:'Twin-Szenenvertrag, Simulationsuhr und Zustände', TW2:'Virtuelle SKR-Pico-Platinen', TW3:'Twin-Modus im Viewer', TW4:'Virtuelle Sensorkamera mit MJPEG', TW5:'Virtueller Feetech-Servobus', TW6:'Fehlerinjektion, Ablaufspur und Bildidentität', TW7:'Simulationsuhr im Backend', TW8:'Geschlossener Sortierzyklus', TW9:'MJCF-Export', TW10:'Kollisionskörper und Masseneigenschaften', TW11:'MuJoCo-Physik mit Bausteinen', TW12:'Echtzeitnachweis für die Physik', TW13:'Kalibrierung mit realen Messungen', TW14:'Reale Firmware ohne Motorstrom am Twin',
};
const packages = [...packageRows(roadmapDoc, 'local design note'), ...packageRows(twinDoc, 'docs/digital-twin.md', true)].map(p => ({ ...p, title: TITLES[p.id] ?? p.id }));
function updatePackage(id, status, note, sources, completedCommit = null, landedCommits = []) {
  const p = packages.find(p => p.id === id);
  if (!p) return;
  if (completedCommit) commitByHash(completedCommit);
  p.status = status; p.note = note; p.completedCommit = completedCommit;
  p.kind = status === 'done' ? 'gemessen' : status === 'in_flight' ? 'geschätzt' : 'offen';
  p.landedCommits = landedCommits.length ? landedCommits : completedCommit ? [completedCommit] : [];
  p.src.push(...sources);
}


for (const args of localStatuses) updatePackage(...args);
const laneLabels = { A:'Rekonstruktion', B:'Quartiken', C:'Kegelschnitte', D:'Fillets', E:'FeatureScript', F:'STEP', G:'Numerik', H:'Bewegung und Abstände', TW:'Digitaler Zwilling' };
const statusCounts = Object.fromEntries(['done','in_flight','open'].map(status => [status, packages.filter(p => p.status === status).length]));
const calendar = [
  { id:'window-1', start:'2026-09-25', end:'2026-09-29', title:'Erste Rekonstruktion, Algebra und Korrekturen', packageIds:['A0','E1','A1','B2','G1','G2','F1','C1','D1'], src:['local design note'] },
  { id:'window-2', start:'2026-09-30', end:'2026-10-04', title:'Integration von Quartiken und Kegelschnitten', packageIds:['A1','A2','B1','B3','C2','C3','C6','D2','F2','H1','H2'], src:['local design note'] },
  { id:'r20-tier', start:'2026-10-05', end:'2026-10-09', title:'Geplantes R20-Ziel: exakte Teile, STEP und Blends', packageIds:['B4','B5','B6','H3','H4','H5','E2','E3','A3'], src:['local design note'] },
  { id:'motion', start:'2026-10-08', end:'2026-10-08', title:'Geplantes Bewegungs-MVP', packageIds:['H1','H2','H3','H4','H5'], src:['local design note'] },
  { id:'core-complete', start:'2026-10-14', end:'2026-10-23', target:'2026-10-16', title:'Geplantes Ende der Kernpakete', packageIds:['B7','F3','F4','G4','G5','D3','D4','D5','D6','D7','C4','C5','A4','A5'], src:['local design note'] },
  { id:'twin-mvp', start:'2026-10-03', end:'2026-10-05', title:'Geplantes Twin-MVP mit Kamera und Viewer', packageIds:['TW0','TW1','TW2','TW3','TW4','H1'], src:['docs/digital-twin.md:307-312'] },
  { id:'twin-loop', start:'2026-10-05', end:'2026-10-09', title:'Geplanter geschlossener Twin-Regelkreis', packageIds:['TW5','TW6','TW7','TW8'], src:['docs/digital-twin.md:309'] },
  { id:'twin-physics', start:'2026-10-12', end:'2026-10-18', title:'Geplante Physik und Echtzeitprüfung', packageIds:['TW9','TW10','TW11','TW12'], src:['docs/digital-twin.md:310'] },
].map(row => ({ ...row, kind:'geschätzt', status:'open', baselineDate:'2026-09-25', note:'Historische Planung aus den Quelldokumenten, nicht anhand des aktuellen Fortschritts neu geschätzt. Kein zugesagter Liefertermin.' }));

// R20: whitelist fields. Never copy a raw source manifest: it contains document IDs
// and absolute source locations. A matching volume alone is not a matching revision.
const REFERENCE = 'tmp/r20-studios-snapshot-0925-2041/r20-modules-volumes.json';
const OLD_REFERENCE = 'tmp/r20-studios-snapshot-1243/r20-modules-volumes.json';
const ref = json(REFERENCE), oldRef = json(OLD_REFERENCE);
const stamp = value => String(value ?? '').match(/module=([^\s]+)/)?.[1] ?? null;
const params = value => String(value ?? '').match(/params=([^\s]+)/)?.[1] ?? null;
const stampMatches = (actual, reference, module) => !!stamp(actual)
  && stamp(actual) === stamp(reference.module_stamps[module])
  && params(actual) === reference.params_sha
  && !/withBlends:true\b/.test(actual);
const sourceForModule = module => ['tray','edge','return'].includes(module)
  ? `var/site/r20/previous/r20/${module}/tessellate-manifest.json`
  : `var/site/r20/current/patched/${module}/tessellate-manifest.json`;
const moduleNames = Object.keys(ref.module_stamps).sort();
const moduleResults = moduleNames.map(module => {
  const path = sourceForModule(module);
  const manifest = existsSync(join(ROOT,path)) ? json(path) : null;
  const refParts = Object.entries(ref.parts).filter(([,p]) => stamp(p.description)?.startsWith(`${module}@`));
  const parts = refParts.map(([id,p]) => {
    const actual = manifest?.parts[id];
    const volume = actual?.wonky?.volumeMm3 ?? null;
    const [referenceMm3, minMm3, maxMm3] = p.volume_mm3_value_min_max;
    const compatible = actual ? stampMatches(actual.description, ref, module) : false;
    const oldCompatible = actual ? stampMatches(actual.description, oldRef, module) : false;
    const old = oldRef.parts[id]?.volume_mm3_value_min_max;
    const inInterval = volume !== null ? volume >= minMm3 && volume <= maxMm3 : null;
    const representation = actual?.wonky?.exact === true ? 'exact_brep' : actual?.wonky?.approximation?.kind === 'certified-mesh' ? 'certified_mesh' : 'not_built';
    return { id, module, representation, built: !!actual, currentReferenceCompatible: compatible,
      comparisonStatus: !actual ? 'not_built' : !compatible ? 'stale_source' : inInterval ? 'within_reference_interval' : 'outside_reference_interval',
      volumeMm3: volume, referenceMm3, referenceIntervalMm3: [minMm3,maxMm3],
      absoluteDeltaMm3: volume === null ? null : volume - referenceMm3,
      relativeDelta: volume === null ? null : (volume - referenceMm3) / referenceMm3,
      numericallyWithinCurrentInterval: inInterval,
      acceptedAgainstCurrentReference: compatible ? inInterval : null,
      previousSnapshotComparison: oldCompatible && old && volume !== null ? { referenceMm3:old[0], intervalMm3:[old[1],old[2]], withinInterval:volume>=old[1]&&volume<=old[2], src:OLD_REFERENCE } : null,
      deviationMm: actual?.wonky?.deviationMm ?? null,
      approximationMeaning: representation === 'certified_mesh' ? 'Ausgewiesene Abweichung zur Trägerfläche, kein Hausdorff- oder Vollständigkeitsbeweis. Das Volumen stammt aus Trägerquadratur, nicht aus einer exakten B-rep.' : null,
      src: [REFERENCE, ...(actual ? [path] : ['tmp/repros/r20-feed-rack-2026-09-25/error.json'])] };
  });
  const built = parts.filter(p=>p.built).length;
  const compatible = parts.filter(p=>p.currentReferenceCompatible).length;
  return { module, buildStatus: built === parts.length ? 'built' : 'refused',
    snapshotStatus: !built ? 'not_built' : compatible === parts.length ? 'matching' : 'stale_source',
    referenceParts:parts.length, builtParts:built, exactParts:parts.filter(p=>p.representation==='exact_brep').length,
    certifiedMeshParts:parts.filter(p=>p.representation==='certified_mesh').length,
    comparableParts:compatible, matchingParts:parts.filter(p=>p.acceptedAgainstCurrentReference === true).length,
    fullyMatchesCurrentReference: compatible === parts.length && parts.every(p=>p.acceptedAgainstCurrentReference === true),
    parts, src:[REFERENCE,...(manifest?[path]:['tmp/repros/r20-feed-rack-2026-09-25/error.json'])],
  };
});
const allParts = moduleResults.flatMap(m=>m.parts);
const compared = allParts.filter(p=>p.currentReferenceCompatible);
const builtParts = allParts.filter(p=>p.built);
const exactCompared = compared.filter(p=>p.representation==='exact_brep');
const meshCompared = compared.filter(p=>p.representation==='certified_mesh');
const maxAbs = parts => parts.length ? Math.max(...parts.map(p=>Math.abs(p.absoluteDeltaMm3))) : null;
const maxRel = parts => parts.length ? Math.max(...parts.map(p=>Math.abs(p.relativeDelta))) : null;
const blendResults = ['edge','cores'].map(module => {
  const path=`var/site/r20/current/blends/${module}/tessellate-manifest.json`;
  const parts=Object.values(json(path).parts);
  return {module,status:'built',parts:parts.length,exactParts:parts.filter(p=>p.wonky?.exact).length,kind:'gemessen',src:[path],note:'Blends eingeschaltet; kein Volumenvergleich gegen die Blends-off-Referenz.'};
});
const r20 = {
  label:'R20-Builds und Onshape-Volumenvergleich', withBlends:false, kind:'gemessen',
  summary:{
    totalModules:moduleNames.length, builtModules:moduleResults.filter(m=>m.buildStatus==='built').length,
    currentSnapshotBuiltModules:moduleResults.filter(m=>m.snapshotStatus==='matching').length,
    matchingCurrentModules:moduleResults.filter(m=>m.fullyMatchesCurrentReference).length,
    totalReferenceParts:allParts.length, builtParts:builtParts.length,
    exactParts:builtParts.filter(p=>p.representation==='exact_brep').length,
    certifiedMeshParts:builtParts.filter(p=>p.representation==='certified_mesh').length,
    notBuiltParts:allParts.filter(p=>!p.built).length,
    staleReferenceParts:builtParts.filter(p=>!p.currentReferenceCompatible).length,
    comparableParts:compared.length, withinReferenceIntervalParts:compared.filter(p=>p.acceptedAgainstCurrentReference).length,
    currentComparableExactParts:exactCompared.length, currentComparableMeshParts:meshCompared.length,
    previousSnapshotComparableParts:allParts.filter(p=>p.previousSnapshotComparison).length,
    previousSnapshotWithinIntervalParts:allParts.filter(p=>p.previousSnapshotComparison?.withinInterval).length,
    maxExactAbsoluteDeltaMm3:maxAbs(exactCompared), maxMeshRelativeDelta:maxRel(meshCompared),
    src:[REFERENCE,OLD_REFERENCE,...moduleResults.flatMap(m=>m.src).filter(p=>p!==REFERENCE)],
  },
  limitations:[
    'Build-Belege sind gespeicherte Läufe, keine neu ausgeführte Gesamtabnahme auf main.',
    'Die sieben vorhandenen Module enthalten einen älteren tray-Quellstand. Die drei tray-Teile werden trotz numerischem Intervalltreffer nicht gegen die neue Referenz als bestanden gezählt.',
    'Volumen im Referenzintervall bedeutet nicht geometrische Gleichheit oder einen Hausdorff-Nachweis.',
    'Der ältere passende Snapshot bestätigt alle dort vergleichbaren gebauten Teile. feed mit PINION/RACK bleibt außerhalb dieses Erfolgszählers.',
    'Teilweise exakte Operationen im Inneren eines Modells machen den abschließenden Certified-Mesh-Körper nicht exakt.',
  ],
  modules:moduleResults,
  blends:[...blendResults,
    {module:'tray',status:'refused',kind:'offen',note:'Gespeicherter Blend-Lauf stoppt am Fillet-Overflow; D1/D2 sind noch in Arbeit.',src:['var/site/r20/current/blends/tray/error.json','local-only development status']},
    {module:'return',status:'refused',kind:'offen',note:'E1 beseitigt den alten Evaluator-Stopp; der Commit nennt danach eine Kantenabfrage auf einem Certified-Mesh-Körper als offenen Stopp. Kein durchgehender Blend-Erfolg belegt.',src:[srcCommit('6931dd2')]},
  ],
  feed:{status:'in_flight',note:'Auf main benannte Zylinder/Ebene-Nahkontakt-Ablehnung. Der jüngere Arbeitsstand passiert RACK und erreicht danach eine ebenfalls bestehende PINION-Volumen-Ablehnung; kein erfolgreicher feed-Gesamtbuild.',src:['tmp/repros/r20-feed-rack-2026-09-25/error.json','local-only development status']},
  src:[REFERENCE,OLD_REFERENCE,'local-only development status','var/site/r20/previous/summary.txt'],
};
const roadmap = {
  schema:'wonky/site/roadmap/v1',language:'de',head:SHORT,asOf:headRow.date,
  statusPolicy:{
    done:'Vollständiger genannter Paketumfang in main mit Commitbeleg. Kein pauschaler Abschluss des gesamten Themenbereichs.',
    in_flight:'Nicht integriert, aktive Korrektur/Prüfung oder nur Teilumfang eines Roadmap-Pakets gelandet.',
    open:'Kein ausreichender Implementierungsbeleg für den Paketumfang gefunden.',
    note:'Statusauswertung ist eine quellengebundene redaktionelle Einordnung, keine neue unabhängige Kernel-Verifikation. Quellen können älter als main sein.',
    src:['local design note','docs/digital-twin.md',logSource],
  },
  summary:{packageCount:packages.length,statusCounts,src:['local design note','docs/digital-twin.md:255-275','scripts/reports/site/history.mjs']},
  lanes:Object.entries(laneLabels).map(([id,title])=>({id,title,packageIds:packages.filter(p=>p.lane===id).map(p=>p.id)})),
  packages,calendar,r20,
  additionalCapabilities:[
    {title:'Fillet-Filter: exakte Formen verzögert aufbauen',status:'done',commit:'4cc7893',note:'Performance-Verbesserung, kein Abschluss der offenen D-Pakete.',src:[srcCommit('4cc7893')]},
    {title:'Projektweiter Workspace-Viewer',status:'done',commit:'833cad2',note:'Voraussetzung für H1, nicht dessen Bewegungsimplementierung.',src:[srcCommit('833cad2')]},
  ],
  unscheduled:[
    {title:'Kalibrierung und Hardware-in-the-loop',packageIds:['TW13','TW14'],note:'Abhängig von Messungen und Prüfstand, ohne belastbaren Termin.',src:['docs/digital-twin.md:251-253','docs/digital-twin.md:312']},
    {title:'Weitere Performance- und Orakelpakete',packageIds:['PN1','PN2','PN3','PN4','PN5','PN6','P1','P2','P3','P4','P5','P6'],note:'In der Roadmap als separate Lanes I/J genannt; nicht mit den A-H/TW-Statuszahlen vermischen.',src:['local design note']},
  ],
};

// Independent counting path for every distinct main test-file content. This both
// exercises the requested git-show method and cross-checks the batched blob parser.
const seenTests = new Set();
let checkedTestBlobs = 0;
for (const row of rows) for (const entry of trees.get(row.oid)) {
  if (!testPath.test(entry.path) || seenTests.has(entry.blob)) continue;
  const content = git('show', `${row.oid}:${entry.path}`);
  const direct = (content.match(/^\s*(test|it)\(/gm) ?? []).length;
  if (direct !== uniqueBlobs.get(entry.blob).testCases) throw new Error(`Test counter mismatch at ${row.hash}:${entry.path}`);
  seenTests.add(entry.blob); checkedTestBlobs++;
}
const expectedPackages = [...roadmapDoc.matchAll(/^\|\s*([A-H]\d+)\s*\|/gm), ...twinDoc.matchAll(/^\|\s*(TW\d+)\s*\|/gm)].map(m=>m[1]);
if (new Set(packages.map(p=>p.id)).size !== expectedPackages.length) throw new Error('Package loss or duplication');
if (Number(git('rev-list','--count',HEAD).trim()) !== commits.length) throw new Error('Commit count mismatch');
mkdirSync(OUT,{recursive:true});
for (const [name,data] of [['history',history],['roadmap',roadmap]]) {
  const encoded=JSON.stringify(data,null,2)+'\n';
  assertPublicSafe(encoded);
  writeFileSync(join(OUT,`${name}.json`),encoded);
}
console.log(JSON.stringify({head:SHORT,commits:commits.length,testCases:latest.testCases,testFiles:latest.testFiles,checkedTestBlobs,packageCount:packages.length,statusCounts,r20:r20.summary,outputs:['out/site/data/history.json','out/site/data/roadmap.json']},null,2));
