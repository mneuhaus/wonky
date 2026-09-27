#!/usr/bin/env node
import { assertNoPrivateTerms } from '../private-terms.mjs';
// Consumer: the public report site's Performance page. Gates numeric speed claims.
// Prevents mixed timing boundaries, excluded-run reuse and disclosure of raw paths.
// This derived artifact is replaced on regeneration; no benchmarks are executed.
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const sources = [];
const conditions = {};
const sourceBytes = new Map();
const load = (path) => JSON.parse((sourceBytes.get(path) ?? readFileSync(resolve(root, path))).toString('utf8'));
const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
function source(id, path, description) {
  const bytes = readFileSync(resolve(root, path));
  sourceBytes.set(path, bytes);
  sources.push({ id, path, sha256: createHash('sha256').update(bytes).digest('hex'), description });
  return id;
}
function commandSource(id, command, description) {
  sources.push({ id, command, description });
  return id;
}
const ref = (id, pointer = '') => ({ id, ...(pointer ? { pointer } : {}) });
const asRefs = (refs) => (Array.isArray(refs) ? refs : [refs]).map((entry) => typeof entry === 'string' ? ref(entry) : entry);
function metric(value, unit, refs, extra = {}) {
  assert(value === null || Number.isFinite(value), `Invalid metric: ${value}`);
  return { value, unit, kind: value === null ? 'offen' : 'gemessen', sources: asRefs(refs), ...extra };
}
function stats(value, refs, extra = {}) {
  if (!value) return metric(null, 'ms', refs, extra);
  return metric(value.medianMs, 'ms', refs, {
    statistic: 'Median', samples: value.samples, min: value.minMs, max: value.maxMs,
    ...(value.p25Ms == null ? {} : { p25: value.p25Ms, p75: value.p75Ms }),
    ...(value.rawMs ? { rawSamples: value.rawMs } : {}), ...extra,
  });
}
function ratio(a, b, refs, definition) {
  return metric(a != null && b > 0 ? a / b : null, 'Faktor', refs, {
    calculation: definition, derived: true,
  });
}
function median(xs) {
  const sorted = [...xs].sort((a, b) => a - b);
  if (!sorted.length) return null;
  const m = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[m] : (sorted[m - 1] + sorted[m]) / 2;
}
function cond(id, sources, details) {
  conditions[id] = { kind: 'gemessen', sources: asRefs(sources), ...details };
  return id;
}
function uptimeLoad(environment) {
  const match = environment?.uptime?.match(/load averages?:\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)/);
  return match ? match.slice(1).map(Number) : null;
}
function thermal(environment) {
  const match = environment?.thermal?.match(/thermalpressurelevel\s+(\d+)/);
  return match ? Number(match[1]) : null;
}

source('hardware-doc', 'docs/hardware-performance.md', 'Historischer Hardwarevergleich und Grenzen der Durchsatzmessung.');
source('hardware', 'out/hardware/report.json', 'Hardware-Messreihe nach Aufgabenoptimierung.');
source('hardware-before', 'out/hardware/report-before-scheduling.json', 'Messreihe vor Aufgabenoptimierung, kein aufgezeichneter Git-Commit.');
const h = load('out/hardware/report.json');
const hb = load('out/hardware/report-before-scheduling.json');
const hardwareCondition = cond('hardware', ['hardware', 'hardware-doc'], {
  machine: h.environment.cpu, logicalCpus: h.environment.logicalCpus, memoryBytes: h.environment.memoryBytes,
  target: 'Je Zeile: JS, ARM64 oder Metal', node: h.environment.node, bend: h.environment.bend,
  power: 'Netzbetrieb', load: 'Keine parallelen Projekttests; andere Anwendungen und Scheduling nicht kontrolliert.',
  thermal: 'macOS meldete keine thermische oder Performancewarnung; keine Temperaturmessung.',
  measuredAt: h.capturedAt, warmups: 3, samples: 7, clockResolutionMs: 1,
  boundary: 'Warme Rechenzeit je Paket unabhängiger Kernoperationen. Ohne Frontend, Hostvalidierung, Datentransport und Export.',
});
cond('hardware-before', ['hardware-before', 'hardware-doc'], {
  ...Object.fromEntries(Object.entries(conditions.hardware).filter(([key]) => !['sources', 'kind'].includes(key))),
  measuredAt: hb.capturedAt,
});
const targets = ['js', 'cpu-1', 'cpu-6', 'cpu-12', 'cpu-18', 'metal'];
function hardwareRun(report, sourceId, run) {
  const index = report.runs.indexOf(run);
  const point = stats(run.warm, ref(sourceId, `/runs/${index}/warm`), {
    conditionId: sourceId === 'hardware-before' ? 'hardware-before' : hardwareCondition, target: run.backend, valid: run.valid,
  });
  // Millisecond-quantized GPU results must remain a range, not a false precise speed factor.
  if (run.kind === 'comparison' && run.backend === 'metal' && run.depth === 14) {
    point.displayRange = [run.warm.minMs, run.warm.maxMs];
    point.note = 'Ganze Millisekunden; als Spanne darstellen, keinen präzisen JS/Metal-Faktor berechnen.';
  }
  return point;
}
const hardware = {
  title: 'JS, ARM64 und Metal: Durchsatz statt Gesamtmodell', conditionId: hardwareCondition,
  sources: [ref('hardware'), ref('hardware-doc')],
  rows: [
    { id: 'comparison', label: 'Zylindervergleiche', depth: 14, count: 16 },
    { id: 'boolean', label: 'Koaxiale Durchgangsloch-Booleans', depth: 12, count: 4 },
  ].map((work) => {
    const selected = h.runs.filter((run) => run.kind === work.id && run.depth === work.depth && run.count === work.count);
    assert.equal(selected.length, targets.length);
    return {
      id: work.id, label: work.label, kind: 'gemessen', sources: [ref('hardware', '/runs')],
      operationsPerBatch: selected[0].operationsPerBatch, tasks: 2 ** work.depth, operationsPerTask: work.count,
      timings: Object.fromEntries(targets.map((target) => [target, hardwareRun(h, 'hardware', selected.find((run) => run.backend === target))])),
    };
  }),
  taskGranularity: h.runs.filter((run) => run.backend === 'metal').map((run) => ({
    workload: run.kind, tasks: 2 ** run.depth, operationsPerTask: run.count,
    operationsPerBatch: run.operationsPerBatch, kind: 'gemessen', sources: [ref('hardware', `/runs/${h.runs.indexOf(run)}`)],
    compute: hardwareRun(h, 'hardware', run),
  })),
  startup: Object.fromEntries(Object.entries(h.startup).map(([target, value]) => [target,
    stats(value, ref('hardware', `/startup/${target}`), { conditionId: hardwareCondition, target,
      boundary: 'Frischer Prozess ohne Kernoperation, Laufzeit-/Geräteinitialisierung; OS-/Shadercache kann warm sein.' }),
  ])),
  compilation: Object.fromEntries(Object.entries(h.builds).map(([target, value]) => [target,
    metric(value.wallMs, 'ms', ref('hardware', `/builds/${target}/wallMs`), {
      conditionId: hardwareCondition, target, samples: 1, boundary: 'Einmalige Übersetzung, separat vom Rechenlauf.',
    }),
  ])),
  notes: ['Die produktive Modellierungs-CLI dieser Messung verwendet JS. Hardwarefaktoren dürfen nicht auf build123d- oder R20-Gesamtzeiten übertragen werden.'],
};
const schedulingSeries = h.runs.map((run) => {
  const before = hb.runs.find((v) => v.kind === run.kind && v.depth === run.depth && v.count === run.count && v.backend === run.backend);
  assert(before);
  return {
    id: `${run.kind}-${run.depth}-${run.count}-${run.backend}`, workload: run.kind, target: run.backend,
    kind: 'gemessen', sources: [ref('hardware-before', '/runs'), ref('hardware', '/runs')],
    operationsPerBatch: run.operationsPerBatch, tasks: 2 ** run.depth, operationsPerTask: run.count,
    points: [
      { label: 'Vor Aufgabenoptimierung', revision: null, sourceSha256: hb.sourceSha256, measuredAt: hb.capturedAt,
        measurement: hardwareRun(hb, 'hardware-before', before) },
      { label: 'Nach Aufgabenoptimierung', revision: null, sourceSha256: h.sourceSha256, measuredAt: h.capturedAt,
        measurement: hardwareRun(h, 'hardware', run) },
    ],
  };
});

source('build123d-doc', 'docs/build123d-performance.md', 'Same-source-Vergleich und API-Grenzen.');
source('build123d', 'out/build123d-performance/principal-1/report.json', 'Akzeptierter Vergleichslauf mit Einzelmessungen.');
const b = load('out/build123d-performance/principal-1/report.json');
assert.equal(b.accepted, true);
const buildCondition = cond('build123d', ['build123d', 'build123d-doc'], {
  machine: b.hostBefore.cpuModel, logicalCpus: b.hostBefore.logicalCpus, memoryBytes: b.hostBefore.totalMemoryBytes,
  target: 'Wonky Bend JS gegen echtes build123d/OCCT', node: b.hostBefore.nodeVersion,
  python: b.runtimes.reference.pythonVersion, bend: b.runtimes.wonky.bend,
  build123d: b.runtimes.reference.build123dVersion, occt: b.runtimes.reference.ocpVersion,
  measuredFrom: b.startedAt, measuredUntil: b.finishedAt,
  loadBefore: b.timingHostBefore.loadAverage, loadAfter: b.timingHostAfter.loadAverage,
  load: 'Nach Projekttests und pausierten Lastjobs; andere Anwendungen, Frequenz und Scheduling nicht kontrolliert.',
  warmups: b.options.warmups, samples: b.options.rounds,
  boundary: 'Warmer Build-API-Aufruf. Wonky startet je Aufruf einen isolierten Python-Shim, nutzt RPC und validiert; Referenz läuft im bereits importierten Python-Prozess.',
  thermal: 'Keine aufgezeichnete macOS-Thermal-/Performancewarnung.',
});
const build123d = {
  title: 'Gleiche Python-Datei, unterschiedliche API-Kosten', conditionId: buildCondition,
  accepted: b.accepted, implementationStable: b.implementationStable,
  revision: b.hostBefore.gitRevision, implementationSha256: b.implementationBefore.sha256,
  sources: [ref('build123d'), ref('build123d-doc')],
  models: b.cases.filter((row) => row.eligibility === 'candidate').map((row) => {
    const idx = b.cases.indexOf(row), pointer = `/cases/${idx}`;
    const phases = Object.fromEntries(['wonky', 'reference'].map((engine) => [engine,
      Object.fromEntries(['build', 'pythonCompile', 'sourceExecutionIncludingGeometry', 'geometryInterop', 'nativeRevalidation', 'stepExportAndWrite']
        .map((phase) => [phase, stats(row.statistics[engine][phase], ref('build123d', `${pointer}/statistics/${engine}/${phase}`), {
          conditionId: buildCondition, target: engine === 'wonky' ? 'Bend JS' : 'build123d/OCCT',
          ...(row.statistics[engine][phase] ? {} : { note: 'Nicht separat beobachtet; keine Subtraktionsschätzung.' }),
        })])),
    ]));
    return { id: row.id, label: row.id, file: `fixtures/performance-build123d/${row.source}`, status: row.status,
      sources: [ref('build123d', pointer)], phases,
      wonkyToReference: ratio(phases.wonky.build.value, phases.reference.build.value,
        ref('build123d', `${pointer}/statistics`), 'Median Wonky Build / Median Referenz Build; API-Verhältnis, kein reines Kernelverhältnis.'),
    };
  }),
  startup: Object.fromEntries(Object.entries(b.startup.statistics).map(([key, value]) => [key,
    stats(value, ref('build123d', `/startup/statistics/${key}`), { conditionId: buildCondition,
      boundary: 'Neuer Prozess bis bereit; persistenter Bend-Cache gemäß Population. Kein garantiert kalter OS-Cache.' }),
  ])),
  capabilityProbes: b.cases.filter((row) => row.eligibility !== 'candidate').map((row) => ({
    id: row.id, status: row.status, speedRatio: metric(null, 'Faktor', ref('build123d', `/cases/${b.cases.indexOf(row)}`)),
  })),
  notes: [
    'Die geometrische Vorprüfung unter parallelen Tests ist kein früherer Performance-Datenpunkt.',
    'Native CPU-/Metal-Gesamtmessungen für diese sechs Programme fehlen in diesen Quellen.',
    'Die Hauptmessung hat keinen aufgezeichneten Git-Commit; ihr Implementierungshash ist erhalten. Nicht dem Import-Commit zuschreiben.',
    'Revalidierungsphasen haben unterschiedliche Prüfumfänge. Exportzeiten ändern das Ergebnis des Build-Vergleichs nicht.',
  ],
};

source('bakeoff-doc', 'docs/bakeoff.md', 'Boolean-Prototypen, Zielgrenzen und starke Begleitlast.');
source('bakeoff', 'out/bakeoff/judge2/results.json', 'Zweiter unabhängiger Boolean-Vergleich, nicht mit erstem Lauf zu einer Verbesserungskurve verbinden.');
const bake = load('out/bakeoff/judge2/results.json');
const bakeConditions = {};
for (const algorithm of ['corefine', 'exact-plane', 'sdf', 'recover']) {
  bakeConditions[algorithm] = {};
  for (const lane of ['native', 'js']) {
    const path = `out/bakeoff/judge2/${algorithm}/${algorithm === 'recover' ? 'corpus-manifold-' : 'corpus-'}${lane}/report.json`;
    const id = `bakeoff-${algorithm}-${lane}`;
    source(id, path, `${algorithm}, Korpuslauf ${lane}.`);
    const data = load(path);
    bakeConditions[algorithm][lane] = cond(id, id, {
      machine: data.environment.cpu, logicalCpus: data.environment.logicalCpus,
      target: lane === 'js' ? 'JS' : 'ARM64 cpu1/cpu18 und Metal', threadsN: data.environment.threadsN,
      bend: data.environment.bend, node: data.environment.node, repeat: data.repeat,
      measuredAt: data.capturedAt, loadBefore: data.loadavgStart, loadAfter: data.loadavgEnd,
      thermal: null, load: 'Historischer Lauf unter veränderlicher Begleitlast. Algorithmen wurden zu unterschiedlichen Zeiten gemessen.',
      boundary: 'Median Compute-Phase; Native mit ganzzahliger Millisekundenuhr. JS warm nach kaltem Erstlauf. Kein vollständiger Modell-/Exportpfad.',
    });
  }
}
function bakeTimings(values, pointer, algorithm) {
  return Object.fromEntries(['js', 'cpu1', 'cpuN', 'metal'].map((target) => [target,
    metric(typeof values[target] === 'number' ? values[target] : null, 'ms', ref('bakeoff', `${pointer}/${target}`), {
      conditionId: bakeConditions[algorithm][target === 'js' ? 'js' : 'native'], target,
      status: typeof values[target] === 'number' ? 'gemessen' : 'fehlgeschlagen-oder-fehlend',
      ...(target === 'js' ? {} : { clockResolutionMs: 1, zeroMeans: 'Unter Auflösung oder Abkürzung, nicht kostenlose Berechnung.' }),
    }),
  ]));
}
const bakeoff = {
  title: 'Boolean-Ansätze mit Korrektheitsgrenzen', revision: null,
  sources: [ref('bakeoff'), ref('bakeoff-doc')],
  approaches: ['corefine', 'exact-plane', 'sdf'].map((algorithm) => ({
    id: algorithm,
    description: { corefine: 'Mesh-Corefinement mit exakten Prädikaten', 'exact-plane': 'Exakte Ebenenklassifikation auf facettierten Eingaben', sdf: 'Toleranzgebundener SDF-Ansatz, nicht exakte CAD-Geometrie' }[algorithm],
    conditions: bakeConditions[algorithm],
    caseTimings: Object.entries(bake.caseTimes[algorithm]).filter(([id]) => !id.startsWith('r10b')).map(([id, values]) => ({
      id, verdict: values.verdict, sources: [ref('bakeoff', `/caseTimes/${algorithm}/${id}`)],
      timings: bakeTimings(values, `/caseTimes/${algorithm}/${id}`, algorithm),
    })),
    commonSetTotals: Object.fromEntries(['js', 'cpu1', 'cpuN', 'metal'].map((target) => [target, metric(
      bake.commonSums[algorithm][target], 'ms', ref('bakeoff', `/commonSums/${algorithm}`), {
        conditionId: bakeConditions[algorithm][target === 'js' ? 'js' : 'native'],
        statistic: 'Summe der fallweisen Mediane', cohort: bake.commonSet,
        cohortSize: bake.commonSet.length, missingCases: target === 'metal' ? bake.commonSums[algorithm].metalMissing : 0,
        comparable: !(target === 'metal' && bake.commonSums[algorithm].metalMissing),
        note: target === 'metal' && bake.commonSums[algorithm].metalMissing ? 'Unvollständige Summe: fehlgeschlagene Fälle nicht als Null oder vollständigen Lauf zeigen.' : 'Gemeinsamer bestandener Korpus; Lastbedingungen bleiben unterschiedlich.',
      }),
    ])),
  })),
  recover: {
    description: 'Separate Rekonstruktion getaggter Meshes zu analytischer B-rep; kein eigenständiger Boolean-Solver.',
    caseTimings: Object.entries(bake.recoverCaseTimes).filter(([id]) => !id.startsWith('r10b')).map(([id, values]) => ({
      id, status: values.status, sources: [ref('bakeoff', `/recoverCaseTimes/${id}`)],
      timings: bakeTimings(values, `/recoverCaseTimes/${id}`, 'recover'),
    })),
  },
  notes: [
    'Die Auswahlentscheidung ist Corefine plus Recover. Reine Mesh-Zeiten und B-rep-Rekonstruktion sind getrennte Grenzen.',
    'Der Korpus allein beweist keine allgemeine Robustheit. Adversariale Läufe fanden falsche Antworten und ungültige Geometrie.',
    'Erster und zweiter Judge-Lauf haben unterschiedliche Last und Korpora. Kein behaupteter Commit-Speedup aus diesen Wiederholungen.',
    'Extern abgeleitete Modellbezeichnungen sind in den öffentlichen Einzelzeilen ausgelassen.',
  ],
};

source('openscad', 'var/site/performance/openscad/out/bench/openscad/results.json', 'R20-CLI-Vergleich; nur akzeptierte aktuelle Samples, nicht previousStatus oder ausgeschlossene Versuche.');
source('openscad-runner', 'var/site/performance/openscad/scripts/bench/openscad/run.mjs', 'Acceptance nutzt truthy Werte; bei OpenSCAD ist accepted der SCAD-Quellpfad statt Boolean true.');
const osc = load('var/site/performance/openscad/out/bench/openscad/results.json');
const openCondition = cond('openscad', 'openscad', {
  machine: osc.machine.cpu, logicalCpus: osc.machine.logicalCpus, memoryBytes: osc.machine.memoryBytes,
  node: osc.machine.node, openscad: osc.openscad, revision: osc.revision,
  target: 'Wonky JS, OpenSCAD Manifold bzw. OpenSCAD CGAL',
  load: 'Quellrunner akzeptiert nur geprüfte Slots ohne konkurrierenden schweren Prozess. Ausgeschlossene Vorläufe bleiben ausgeschlossen.',
  thermal: null, deviationMm: osc.method.deviationMm,
  boundary: 'Frischer CLI-Prozess bis Exit inklusive Dateiausgabe. OpenSCAD schreibt STL, Wonky zusätzlich B-rep/STEP/Manifest und validiert.',
  cold: 'Wonky benötigt leeren persistenten Bend-Cache; OS-Cache nicht geleert. Referenz hatte bereits Geometrievorläufe.',
});
const openscad = {
  title: 'R20 gegen OpenSCAD: akzeptierte Teilergebnisse', complete: osc.done, conditionId: openCondition,
  revision: osc.revision, sources: [ref('openscad')],
  rows: osc.jobs.map((job, i) => {
    const pointer = `/jobs/${i}`;
    // The runner's cacheStable expression returns job.scad for reference jobs.
    // Preserve its documented acceptance semantics without publishing that path.
    const accepted = job.samples.filter((s) => !s.exclusion &&
      (s.accepted === true || (typeof s.accepted === 'string' && s.accepted === job.scad)));
    const warm = accepted.filter((s) => s.phase === 'warm');
    const cold = accepted.filter((s) => s.phase === 'cold');
    const successful = ['validated', 'validated-stl-step-refused'].includes(job.status);
    const validWarm = successful && warm.length >= 3;
    if (validWarm) assert(Math.abs(median(warm.map((s) => s.wallS)) - job.summary.warmMedianS) < 1e-8);
    return {
      id: job.id, parts: job.parts, engine: job.tool,
      scope: job.id.endsWith('-module') ? 'Gesamtes Modul; nicht gegen Einzelkörper vergleichen' : 'Einzelkörper',
      status: job.status ?? 'offen', sources: [ref('openscad', pointer)], conditionId: openCondition,
      warm: metric(validWarm ? median(warm.map((s) => s.wallS)) * 1000 : null, 'ms', ref('openscad', `${pointer}/samples`), {
        statistic: 'Median akzeptierter warmer CLI-Prozesse', samples: warm.length,
        rawSamples: validWarm ? warm.map((s) => s.wallS * 1000) : [],
        min: validWarm ? Math.min(...warm.map((s) => s.wallS * 1000)) : null,
        max: validWarm ? Math.max(...warm.map((s) => s.wallS * 1000)) : null,
        conditionId: openCondition, target: job.tool,
      }),
      cold: metric(successful && cold.length ? median(cold.map((s) => s.wallS)) * 1000 : null, 'ms', ref('openscad', `${pointer}/samples`), {
        samples: cold.length, conditionId: openCondition, target: job.tool,
        note: cold.length ? 'Erstlauf, kein kalter OS-Cache.' : 'Kein akzeptierter Kaltlauf. Belastete/fehlgeschlagene Versuche nicht ersetzen.',
      }),
      acceptedSampleCount: metric(accepted.length, 'Samples', [ref('openscad', `${pointer}/samples`), ref('openscad-runner')], { calculation: 'Anzahl akzeptierter Samples laut Runner, ohne exclusion; Boolean true oder dokumentierter SCAD-Pfadwert.' }),
      excludedSampleCount: metric(job.samples.length - accepted.length, 'Samples', [ref('openscad', `${pointer}/samples`), ref('openscad-runner')], { calculation: 'Alle Samples minus akzeptierte Samples.' }),
      loadRange: metric(accepted.length ? Math.max(...accepted.map((s) => s.maxLoad1)) : null, 'Load-1-Maximum', ref('openscad', `${pointer}/samples`), {
        min: accepted.length ? Math.min(...accepted.map((s) => s.maxLoad1)) : null,
        calculation: 'Maximum und Minimum der maxLoad1-Werte akzeptierter Samples',
      }),
      stepRefused: job.status === 'validated-stl-step-refused',
    };
  }),
  comparisons: [],
  notes: [
    'Nur akzeptierte STL-Ergebnisse. Die Messserie ist insgesamt nicht abgeschlossen.',
    'Gültige STL bei explizit verweigertem exaktem STEP ist keine erfolgreiche Ausgabe aller Formate.',
    'Unterschiedliche Produktgrenzen: beobachtete CLI-Verhältnisse, keine reinen Kernel-Speedups und kein Genauigkeitsgleichheitsbeweis.',
    'Die verworfenen vorherigen Messungen und previousStatus-Werte gehen in keine Zahl ein.',
  ],
};
for (const row of openscad.rows.filter((v) => v.id.endsWith('-wonky'))) {
  for (const engine of ['Manifold', 'CGAL']) {
    const other = openscad.rows.find((v) => v.id === `${row.parts[0]}-${engine}`);
    if (!other) continue;
    openscad.comparisons.push({ model: row.parts[0], reference: engine, conditionId: openCondition,
      wonkyToReference: ratio(row.warm.value, other.warm.value, [...row.warm.sources, ...other.warm.sources],
        'Median akzeptierter warmer Wonky-CLI-Zeit / OpenSCAD-CLI-Zeit. Unterschiedliche Ausgabe-/Validierungsarbeit.'),
      stepRefused: row.stepRefused,
    });
  }
}

source('fillet-counters', 'tmp/duel-harness/counters.json', 'Unveränderte Baseline-Zähler; keine Laufzeiten.');
commandSource('fillet-verdict', 'git show -s --format=%B 4cc7893', 'Integrationscommit mit unabhängig nachgemessenen Vorher-/Nachher-Werten.');
commandSource('fillet-parent', 'git rev-parse 4cc7893^', 'Integration auf dem Baseline-Commit.');
commandSource('fillet-closure', 'git diff --exit-code d4dce90 4cc7893^ -- kernel/fillet kernel/real.bend kernel/robust-predicates.bend', 'Audit der unveränderten Fillet-Quellen zwischen Profilrevision und Integrationsparent.');
const verdict = git('show', '-s', '--format=%B', '4cc7893');
const nativeMatch = verdict.match(/native cpu1 compute (\d+)\/(\d+)\/(\d+) → (\d+)\/(\d+)\/(\d+) ms/);
const jsMatch = verdict.match(/JS user time ([\d.]+)\/([\d.]+)\/([\d.]+) of baseline/);
const widthMatch = verdict.match(/width forms built (\d+)\/(\d+)\/(\d+) → (\d+)/);
const chordMatch = verdict.match(/chord forms (\d+)\/(\d+)\/(\d+) → (\d+)/);
assert(nativeMatch && jsMatch && widthMatch && chordMatch);
assert.equal(git('diff', '--name-only', 'd4dce90', '4cc7893^', '--', 'kernel/fillet', 'kernel/real.bend', 'kernel/robust-predicates.bend'), '');
const filletBaseRevision = git('rev-parse', '4cc7893^');
const filletRevision = git('rev-parse', '4cc7893');
const filletDate = git('show', '-s', '--format=%cs', '4cc7893');
const counters = load('tmp/duel-harness/counters.json');
const filletCondition = cond('fillet-judge', 'fillet-verdict', {
  machine: null, load: null, thermal: null, samples: null,
  target: 'Native cpu1 Compute bzw. JS-Nutzerzeit',
  boundary: 'Drei eingefrorene Fillet-Jobs, bytegleiche Ausgaben. Commit nennt keine vollständigen Maschinen-/Last-/Stichprobendaten.',
  caution: 'Keine ruhige M4-Mini-Messung behaupten. Profilbedingungen nicht auf den späteren Judge-Lauf übertragen.',
});
const counterCondition = cond('fillet-counters', 'fillet-counters', {
  machine: null, target: 'Instrumentierte JS-Zähler', load: uptimeLoad(counters[0].environment), thermal: thermal(counters[0].environment),
  boundary: 'Deterministische Ereigniszähler mit identischen Ausgabehashes; keine Zeitmessung oder Skalierung.',
});
const stepwiseSeries = [];
const fillet = {
  title: 'Lazy Exact Forms: belegter Verbesserungsschritt', revision: filletRevision,
  baselineRevision: filletBaseRevision, sources: [ref('fillet-verdict'), ref('fillet-counters')],
  conditionId: filletCondition,
  jobs: counters.map((row, i) => {
    const before = Number(nativeMatch[i + 1]), after = Number(nativeMatch[i + 4]), js = Number(jsMatch[i + 1]);
    const nativeSeries = {
      id: `fillet-native-${row.id}`, model: row.id, label: `${row.id}: native Rechenzeit`,
      target: 'cpu1', unit: 'ms', conditionId: filletCondition, interpolation: 'step',
      commitAttribution: 'Integrationsparent und Integrationscommit laut Verdict; Roh-Run-Revision des Judge nicht separat aufgezeichnet.',
      sources: [ref('fillet-verdict'), ref('fillet-parent'), ref('fillet-closure')],
      countermetric: 'Bytegleiche Ausgaben laut unabhängigem Judge; exakter Fallback und Filtergrenzen bleiben erhalten.',
      points: [
        { revision: filletBaseRevision, date: git('show', '-s', '--format=%cs', filletBaseRevision), label: 'Eager Baseline',
          measurement: metric(before, 'ms', 'fillet-verdict', { conditionId: filletCondition, target: 'cpu1' }) },
        { revision: filletRevision, date: filletDate, label: 'Lazy Exact Forms',
          measurement: metric(after, 'ms', 'fillet-verdict', { conditionId: filletCondition, target: 'cpu1' }) },
      ],
    };
    stepwiseSeries.push(nativeSeries);
    stepwiseSeries.push({
      id: `fillet-js-${row.id}`, model: row.id, label: `${row.id}: JS-Nutzerzeit relativ`,
      target: 'JS', unit: 'Baseline-Anteil', conditionId: filletCondition, interpolation: 'step',
      commitAttribution: nativeSeries.commitAttribution, sources: nativeSeries.sources,
      countermetric: nativeSeries.countermetric,
      points: [
        { revision: filletBaseRevision, date: nativeSeries.points[0].date, label: 'Eager Baseline',
          measurement: metric(1, 'Baseline-Anteil', 'fillet-verdict', { derived: true, calculation: 'Baseline / Baseline', conditionId: filletCondition }) },
        { revision: filletRevision, date: filletDate, label: 'Lazy Exact Forms',
          measurement: metric(js, 'Baseline-Anteil', 'fillet-verdict', { conditionId: filletCondition,
            note: 'Nutzerzeit-Anteil, nicht Sekunden und nicht Wall-Time.' }) },
      ],
    });
    return {
      id: row.id, sources: [ref('fillet-verdict'), ref('fillet-counters', `/${i}`)],
      nativeBefore: nativeSeries.points[0].measurement, nativeAfter: nativeSeries.points[1].measurement,
      nativeSpeedup: ratio(before, after, 'fillet-verdict', 'Native Baseline-Compute / Lazy-Compute'),
      nativeReductionPercent: metric((1 - after / before) * 100, '%', 'fillet-verdict', { derived: true, calculation: '(1 - nachher / vorher) * 100' }),
      jsUserTimeFraction: metric(js, 'Baseline-Anteil', 'fillet-verdict', { conditionId: filletCondition }),
      baselineCounters: Object.fromEntries(Object.entries(row.counters).map(([key, value]) => [key,
        metric(value, 'Ereignisse', ref('fillet-counters', `/${i}/counters/${key}`), { conditionId: counterCondition }),
      ])),
      judgeWidthForms: { before: metric(Number(widthMatch[i + 1]), 'Formen', 'fillet-verdict'), after: metric(Number(widthMatch[4]), 'Formen', 'fillet-verdict') },
      judgeChordForms: { before: metric(Number(chordMatch[i + 1]), 'Formen', 'fillet-verdict'), after: metric(Number(chordMatch[4]), 'Formen', 'fillet-verdict') },
    };
  }),
  notes: [
    'Widerspruch bei Chord-Zählern im Lochraster: Baseline-Datei zählt verworfene Formen, Judge-Commit nennt eine andere Zahl gebauter Formen. Beide Werte getrennt erhalten, keine Gleichsetzung.',
    'Keine weiteren Commit-Zwischenwerte interpolieren. Dies ist ein einzelner nachgewiesener Integrationsschritt, keine lange Messhistorie.',
  ],
};

source('parallel-profile', 'var/site/performance/parallel/out/perf/fillet-mesh/phase-shares.json', 'Sampling-Anteile; überlappende Gruppen, keine additiven Einsparungen.');
source('parallel-summary', 'var/site/performance/parallel/out/perf/fillet-mesh/summary.json', 'Revision, Wiederholungen und Umgebung der Fillet-Profile.');
source('parallel-mesh', 'var/site/performance/parallel/out/perf/fillet-mesh/mesh-summary.json', 'Mesh-Sampling und explizite Mesh-Verweigerung.');
source('parallel-pipeline', 'var/site/performance/parallel/out/perf/pipeline/profile-analysis.json', 'Leichtes R20-Datums-Modul; einzelner gecachter JS-Prozess.');
source('parallel-invocation', 'var/site/performance/parallel/out/perf/pipeline/invocation.json', 'Aufrufrevision und Profilannahmen.');
source('parallel-environment', 'var/site/performance/parallel/out/perf/pipeline/environment.log', 'M5-Pro-Hardware und Last-/Thermalstatus vor und nach dem Datums-Profil.');
for (const part of ['map-boolean', 'map-fillet-mesh', 'map-numerics', 'map-pipeline', 'measure']) {
  source(`parallel-${part}`, `var/site/performance/status/${part}.json`, `Recherche-/Messcheckpoint ${part}; keine Rohtexte veröffentlichen.`);
}
const phaseShares = load('var/site/performance/parallel/out/perf/fillet-mesh/phase-shares.json');
const profileSummary = load('var/site/performance/parallel/out/perf/fillet-mesh/summary.json');
const meshSummary = load('var/site/performance/parallel/out/perf/fillet-mesh/mesh-summary.json');
const pipeline = load('var/site/performance/parallel/out/perf/pipeline/profile-analysis.json');
const invocation = load('var/site/performance/parallel/out/perf/pipeline/invocation.json');
const pipelineEnvironment = sourceBytes.get('var/site/performance/parallel/out/perf/pipeline/environment.log').toString('utf8');
const pipelineLoads = [...pipelineEnvironment.matchAll(/load averages:\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)/g)].map((match) => match.slice(1).map(Number));
const pipelineThermals = [...pipelineEnvironment.matchAll(/thermalpressurelevel\s+(\d+)/g)].map((match) => Number(match[1]));
const parallelCondition = cond('parallel-profile', ['parallel-summary', 'parallel-mesh', 'parallel-map-fillet-mesh', 'parallel-environment'], {
  machine: 'Apple M5 Pro', target: 'JS-Sampling, kein Native-/Metal-Skalierungsbenchmark', revision: invocation.revision,
  load: 'Je Profil gespeichert; Profile nicht mit späteren Judge-Laufzeiten zusammenrechnen.',
  boundary: 'Warme instrumentierte Sampling-Batches inklusive GC; Inspector-Stacks aus Gruppen-Nenner ausgeschlossen. Gruppen überlappen.',
});
const pipelineCondition = cond('parallel-pipeline', ['parallel-pipeline', 'parallel-invocation', 'parallel-map-pipeline', 'parallel-environment'], {
  machine: 'Apple M5 Pro', target: 'JS', revision: invocation.revision,
  model: 'R20 Datums, ohne aktive Blends', load: 'Einzelprofil; keine ruhige Wiederholungsmessung.',
  loadBefore: pipelineLoads[0] ?? null, loadAfter: pipelineLoads[1] ?? null,
  thermalBefore: pipelineThermals[0] ?? null, thermalAfter: pipelineThermals[1] ?? null,
  boundary: 'Ein leichter echter Modellaufruf; kompilierte Module bereits gecacht. Kein vorausgehender warmer Geometriebau.',
});
const parallelism = {
  title: 'Erst unnötige Arbeit entfernen, dann parallelisieren', revision: invocation.revision,
  profiles: phaseShares.map((profile, i) => {
    const env = profileSummary.workloads.find((w) => w.id === profile.id) ?? meshSummary.rows.find((w) => w.id === profile.id);
    const environmentRef = profileSummary.workloads.includes(env) ? 'parallel-summary' : 'parallel-mesh';
    return {
      id: profile.id, conditionId: parallelCondition, sources: [ref('parallel-profile', `/${i}`)],
      environment: env ? { kind: 'gemessen', sources: [ref(environmentRef)],
        loadBefore: uptimeLoad(env.before), loadAfter: uptimeLoad(env.after), thermalBefore: thermal(env.before), thermalAfter: thermal(env.after),
        repetitions: env.reps ?? null } : null,
      denominator: 'Alle Ausführungssamples einschließlich GC, ohne Inspector-Stacks. Gruppen überlappen und dürfen nicht addiert werden.',
      groups: Object.fromEntries(Object.entries(profile.groups).filter(([, v]) => v.ms > 0).map(([key, value]) => [key,
        metric(value.percent, '% Sampling-Anteil', ref('parallel-profile', `/${i}/groups/${key}`), {
          kind: 'geschätzt', conditionId: parallelCondition,
          note: 'Profilattribution geschätzt; kein exakt gemessener Optimierungsgewinn.',
        }),
      ])),
    };
  }),
  pipeline: {
    conditionId: pipelineCondition, sources: [ref('parallel-pipeline')],
    buckets: pipeline.buckets.map((row, i) => ({ label: row.bucket,
      share: metric(row.percent, '% Sampling-Anteil', ref('parallel-pipeline', `/buckets/${i}/percent`), { kind: 'geschätzt', conditionId: pipelineCondition }),
    })),
    boundaries: pipeline.boundaries.map((row, i) => ({ label: row.name,
      time: metric(row.ms, 'ms', ref('parallel-pipeline', `/boundaries/${i}/ms`), {
        samples: 1, conditionId: pipelineCondition, note: 'Verschachtelte Grenzen, nicht addieren. Einzelprofil, keine Benchmark-Population.',
      }),
    })),
    cacheWork: Object.fromEntries(Object.entries(pipeline.cacheWork).filter(([, v]) => typeof v === 'number').map(([key, value]) => [key,
      metric(value, 'Besuche/Dateien', ref('parallel-pipeline', `/cacheWork/${key}`), {
        kind: 'geschätzt', conditionId: pipelineCondition,
        note: 'Aus Cachemanifesten und Fingerprint-Aufrufen abgeleitet, keine gezählten Systemaufrufe.',
      }),
    ])),
  },
  findings: [
    { id: 'lazy-exact-forms', status: 'done', sources: [ref('parallel-map-fillet-mesh'), ref('fillet-verdict')],
      text: 'Exakte Width-/Chord-Formen erst bei unentschiedenem Filter bauen. Der spätere Integrationsschritt ist separat belegt.' },
    { id: 'trig-reuse', status: 'open', sources: [ref('parallel-map-fillet-mesh'), ref('parallel-profile')],
      text: 'Wiederholte Winkelberechnung beim Tessellieren vermeiden; Sampling zeigt einen Schwerpunkt, noch keinen nachgemessenen Speedup.' },
    { id: 'topology-scans', status: 'open', sources: [ref('parallel-map-fillet-mesh'), ref('fillet-counters')],
      text: 'Wiederholte lineare Kanten-/Inzidenzsuche und doppelte Mesh-Topologietabellen reduzieren.' },
    { id: 'independent-work', status: 'open', sources: [ref('parallel-map-boolean'), ref('parallel-map-numerics')],
      text: 'Unabhängige Refinement- und Recovery-Arbeit parallelisieren; abhängige Featureketten, erste Verweigerung und numerische Reihenfolge erhalten.' },
    { id: 'pipeline-loading', status: 'open', sources: [ref('parallel-pipeline'), ref('parallel-map-pipeline')],
      text: 'Im leichten Datums-Einzelprofil dominiert das Laden gecachter JS-Module. Kein Profil des vollständigen R20-Modells.' },
  ],
  experimentStatus: {
    done: load('var/site/performance/status/measure.json').done,
    sources: [ref('parallel-measure')],
    text: 'Messcheckpoint offen; keine vollständige bestätigte Serie der Parallelisierungs-Hypothesen vorhanden.',
  },
};

commandSource('mini-inventory', 'find out/bench-mini -type f', 'Lokale Verfügbarkeit geprüft; fehlender Ordner ist fehlende Evidenz.');
const miniDir = resolve(root, 'out/bench-mini');
// Bounded inventory only: never crawl a home directory or silently ingest arbitrary exports.
function inventory(path, depth = 0) {
  if (!existsSync(path)) return [];
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const child = resolve(path, entry.name);
    return entry.isFile() ? [child.slice(root.length)] : entry.isDirectory() && depth < 4 ? inventory(child, depth + 1) : [];
  });
}
const miniFiles = inventory(miniDir);
const mini = {
  title: 'Reference benchmark host', status: miniFiles.length ? 'unreviewed-results' : 'missing',
  kind: 'offen', sources: [ref('mini-inventory')],
  files: miniFiles, timings: null,
  note: miniFiles.length ? 'Neue Dateien vorhanden; vor Veröffentlichung separat auf Maschine, Last und Messgrenze prüfen.' : 'Kein Benchmark-Ergebnis im vorgesehenen Ordner. Keine Zahlen oder hochgerechneten M5-Werte einsetzen.',
};

const data = {
  schema: 'wonky.report-site.performance/v1', language: 'de',
  generatedTime: execFileSync('date', ['+%H:%M'], { encoding: 'utf8' }).trim(),
  artifactPurpose: {
    consumer: 'Öffentliche Performance-Seite des Wonky-Report-Websites',
    gatedFeature: 'Nachvollziehbare Geschwindigkeitsvergleiche und Commit-Schrittgrafiken',
    defectClass: 'Vermischte Messgrenzen, ungültige Wiederverwendung verworfener Läufe und öffentliche Rohdatenlecks',
    deletionCondition: 'Bei Regeneration vollständig ersetzen; ohne Website-Verbraucher entfernen.',
  },
  provenanceConvention: 'Jede Metrik nennt Quellen und ggf. JSON-Pointer. Statistik-Nebenwerte erben dieselbe Quelle. Bedingungszahlen erben sources ihres Objekts. Gemessen schließt explizit berechnete Quotienten aus Messwerten ein; Sampling-Anteile sind geschätzt. Fehlend ist null, niemals Nullzeit.',
  publicSafe: true, sources, conditions,
  hardware, build123d, bakeoff, openscad, fillet, parallelism, mini,
  stepwiseSeries,
  snapshotSeries: {
    title: 'Aufgabenoptimierung: Vorher-/Nachher-Snapshots ohne Commit-Zuordnung',
    note: 'Kein Git-Commit in den historischen Rohdaten. Diese Reihe nicht als Commit-Verlauf beschriften.',
    rows: schedulingSeries,
  },
  missing: [
    { id: 'quiet-mini', sources: [ref('mini-inventory')], text: mini.note },
    { id: 'native-build123d', sources: [ref('build123d-doc')], text: 'Akzeptierte komplette CPU-/Metal-Modellpipeline-Messungen fehlen.' },
    { id: 'openscad-complete', sources: [ref('openscad')], text: 'OpenSCAD-Serie unvollständig; fehlende Wonky-Kaltläufe und fehlgeschlagene Jobs bleiben offen.' },
    { id: 'long-commit-history', sources: [ref('fillet-verdict'), ref('hardware'), ref('build123d')],
      text: 'Ein expliziter Fillet-Verbesserungsschritt ist commitbezogen belegt. Kein mehrstufiger Gesamtmodell-Verlauf aus unvereinbaren Benchmarks konstruieren.' },
    { id: 'fillet-environment', sources: [ref('fillet-verdict')], text: 'Maschine, Begleitlast und Stichprobengröße des Judge-Laufs sind im Commit nicht ausgewiesen.' },
  ],
};

// Publication check is intentionally on the allowlisted derived payload, not on raw artifacts.
const privateSourceIds = new Set(sources.filter(s => s.path?.startsWith('var/site/')).map(s => s.id));
function publicSources(value) {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value.sources)) value.sources = value.sources.filter(s => !privateSourceIds.has(s.id));
  for (const child of Object.values(value)) if (child && typeof child === 'object') publicSources(child);
}
publicSources(data);
data.sources = sources.filter(s => !privateSourceIds.has(s.id));
const serialized = JSON.stringify(data, null, 2) + '\n';
assert(!/(?:\/Users\/|\/home\/|file:\/\/|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|\b[a-f0-9]{24}\b)/i.test(serialized), 'Public-safe check failed');
assert(!/(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|bearer\s)/i.test(serialized), 'Unexpected credential-like field');
  assertNoPrivateTerms(serialized, 'performance data');
const sourceIds = new Set(sources.map((s) => s.id));
function validate(value) {
  if (!value || typeof value !== 'object') return;
  if (value.sources) for (const source of value.sources) assert(sourceIds.has(source.id), `Unknown source ${source.id}`);
  if ('value' in value && 'unit' in value) {
    assert(value.sources?.length, 'Unsourced metric');
    assert(['gemessen', 'geschätzt', 'offen'].includes(value.kind));
    assert(value.value === null || Number.isFinite(value.value));
  }
  if (value.conditionId) assert(conditions[value.conditionId], `Unknown condition ${value.conditionId}`);
  for (const child of Object.values(value)) validate(child);
}
validate(data);
const output = resolve(root, 'out/site/data/performance.json');
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, serialized);
console.log(`out/site/data/performance.json: ${Buffer.byteLength(serialized)} bytes; ${stepwiseSeries.length} commit series; ${openscad.rows.filter((r) => r.warm.value != null).length} accepted warm CLI rows; mini ${mini.status}`);
