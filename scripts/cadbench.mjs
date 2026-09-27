import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from '../src/index.mjs';
import { toStep } from '../src/exporters.mjs';
import { UnsupportedFeatureError } from '../src/errors.mjs';
import { cadbenchRoot as root, cadbenchFixtures, fixturePath, sha256, verifyCadbenchFixtures } from './cadbench-sources.mjs';

const json = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
const counts = values => Object.fromEntries([...new Set(values)].sort().map(key => [key, values.filter(value => value === key).length]));
const errorRecord = error => ({ name: error.name, message: error.message, line: error.line ?? null, column: error.column ?? null });
function near(actual, expected, relativeTolerance, absoluteTolerance, name) {
  if (!Number.isFinite(actual) || Math.abs(actual - expected) > Math.max(absoluteTolerance, relativeTolerance * Math.abs(expected)))
    throw new Error(`${name}: measured ${actual}, expected ${expected}`);
}

export function checkCadbenchModel(model, expected) {
  if (model.backend?.language !== 'Bend') throw new Error('CADBench pilot requires the real Bend backend');
  if (model.bodies.length !== expected.solids) throw new Error(`Solid count differs: ${model.bodies.length} != ${expected.solids}`);
  if (model.bodies.some(body => !body.validation.closed || !Number.isFinite(body.validation.volumeMm3) || !body.validation.boundsMm))
    throw new Error('Closed topology, native volume and native bounds are required');
  const actual = { solids: model.bodies.length,
    volumeMm3: model.bodies.reduce((sum, body) => sum + body.validation.volumeMm3, 0),
    boundsMm: { min: [0, 1, 2].map(axis => Math.min(...model.bodies.map(body => body.validation.boundsMm.min[axis]))),
      max: [0, 1, 2].map(axis => Math.max(...model.bodies.map(body => body.validation.boundsMm.max[axis]))) },
    surfaces: counts(model.bodies.flatMap(body => body.faces.map(face => face.surface.type))),
    curves: counts(model.bodies.flatMap(body => body.edges.map(edge => edge.curve.type ?? edge.curve))),
    topology: model.bodies.map(body => ({ vertices: body.vertices.length, edges: body.edges.length, faces: body.faces.length })) };
  near(actual.volumeMm3, expected.volumeMm3, expected.relativeTolerance, 1e-5, 'Volume (mm^3)');
  for (const side of ['min', 'max']) for (let axis = 0; axis < 3; axis++)
    near(actual.boundsMm[side][axis], expected.boundsMm[side][axis], expected.relativeTolerance, expected.absoluteToleranceMm, `Bounds ${side}[${axis}] (mm)`);
  const surfaceTypes = Object.keys(actual.surfaces).sort();
  if (JSON.stringify(surfaceTypes) !== JSON.stringify([...expected.surfaceTypes].sort()))
    throw new Error(`Analytic surface types differ: ${surfaceTypes.join(', ')}`);
  return actual;
}

export function cadbenchImplementationSnapshot() {
  const walk = directory => readdirSync(join(root, directory), { withFileTypes: true }).flatMap(entry =>
    entry.isDirectory() ? walk(`${directory}/${entry.name}`) : [`${directory}/${entry.name}`]);
  const files = ['bend.lock.json', 'package-lock.json', 'scripts/cadbench.mjs', 'scripts/cadbench-sources.mjs', 'scripts/cadbench-build123d.mjs',
    'scripts/validate-step.py', ...walk('src'), ...walk('kernel'), ...walk('fixtures/cadbench')].sort();
  const entries = files.map(path => ({ path, sha256: sha256(readFileSync(join(root, path))) }));
  return { sha256: sha256(JSON.stringify(entries)), files: entries };
}

export async function runCadbench({ out = join(root, 'out/cadbench/pilot'), caseIds, validateStep = true,
  fixtures = cadbenchFixtures } = {}) {
  const { provenance, corpus, policy, pilot } = verifyCadbenchFixtures(fixtures);
  if (typeof validateStep !== 'boolean') throw new TypeError('validateStep must be boolean');
  if (caseIds !== undefined && (!Array.isArray(caseIds) || !caseIds.length || new Set(caseIds).size !== caseIds.length ||
      caseIds.some(id => !pilot.cases.some(row => row.id === id)))) throw new Error('Unknown, duplicate or empty CADBench case selection');
  const selected = pilot.cases.filter(row => caseIds === undefined || caseIds.includes(row.id));
  out = resolve(out); mkdirSync(out, { recursive: true });
  for (const row of pilot.cases) for (const extension of ['brep.json', 'step', 'failure.json'])
    rmSync(join(out, `cadbench-${row.id}.${extension}`), { force: true });
  for (const name of ['step-validation.json', 'step-validation.log', 'point-probes.json']) rmSync(join(out, name), { force: true });
  const report = { schema: 'wonky-cadbench-report/1', startedAt: new Date().toISOString(), scope: pilot.scope,
    source: { dataset: provenance.dataset.url, revision: provenance.dataset.revision,
      provenanceSha256: sha256(readFileSync(join(fixtures, 'provenance.json'))) },
    implementation: cadbenchImplementationSnapshot(), modelingPolicy: { curvedContacts: 'strict' },
    official: { benchmark: policy.dataset, version: policy.tag, contentHash: policy.dataset_content_hash,
      totalTasks: policy.task_count, attemptedTasks: 0, scoredTasks: 0, reward: null, submissionEligible: false,
      status: 'not-run', reason: 'This local Bend pilot does not produce answer.FCStd/answer.py or run the isolated Harbor verifier.' },
    local: { selection: pilot.selection, selectedCases: selected.length, pilotCases: pilot.cases.length, cases: [] },
    stepValidation: { status: validateStep ? 'pending' : 'not-run', reason: validateStep ? null : 'Explicitly disabled; local results lack independent STEP validation.' },
    accepted: false };
  const prefixes = [], probes = [];
  for (const item of selected) {
    const sourceRow = corpus.find(row => row.id === item.upstreamId);
    const row = { id: item.id, upstreamId: item.upstreamId, upstreamName: sourceRow.name,
      officialTask: `gnucleus-ai/freecad-${item.upstreamId}`, officialTaskDigest: policy.task_digests[`gnucleus-ai/freecad-${item.upstreamId}`],
      adaptation: item.adaptation, source: item.source, sourceSha256: item.sourceSha256,
      expected: item.expected, status: 'failed', validation: 'not-run' };
    report.local.cases.push(row);
    const prefix = join(out, `cadbench-${item.id}`);
    try {
      const model = await build(readFileSync(fixturePath(fixtures, item.source), 'utf8'), {
        feature: item.feature, id: `cadbench-${item.id}`, sourcePath: fixturePath(fixtures, item.source), modelingPolicy: report.modelingPolicy,
      });
      row.actual = checkCadbenchModel(model, item.expected);
      const step = toStep(model, `cadbench-${item.id}`);
      json(prefix + '.brep.json', model); writeFileSync(prefix + '.step', step);
      row.exports = ['brep.json', 'step'].map(extension => ({ path: `cadbench-${item.id}.${extension}`,
        sha256: sha256(readFileSync(`${prefix}.${extension}`)) }));
      row.operationEvidenceCount = model.operationEvidence.length;
      row.status = 'kernel-passed'; row.validation = 'native topology, nominal volume/bounds and analytic surface types; face subdivision is recorded';
      prefixes.push(prefix); probes.push({ prefix, points: item.expected.probes.map(({ id, pointMm }) => ({ id, pointMm })) });
    } catch (error) {
      row.status = error instanceof UnsupportedFeatureError ? 'unsupported' : 'failed'; row.error = errorRecord(error);
      const evidence = error.completedOperationEvidence ?? [];
      json(prefix + '.failure.json', { ...row.error, operationEvidence: evidence });
      row.failureArtifact = `cadbench-${item.id}.failure.json`;
    }
  }
  if (validateStep && prefixes.length) {
    const pointFile = join(out, 'point-probes.json');
    json(pointFile, { schema: 'wonky-solid-probes/1', toleranceMm: 1e-7, models: probes });
    const args = ['run', 'scripts/validate-step.py', '--points', pointFile, ...prefixes];
    const result = spawnSync('uv', args, { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 120000 });
    writeFileSync(join(out, 'step-validation.log'), (result.stdout ?? '') + (result.stderr ?? '') + (result.error?.message ?? ''));
    report.stepValidation = { status: 'failed', command: ['uv', ...args], exitCode: result.status, log: 'step-validation.log' };
    try {
      if (result.status !== 0 || result.error) throw new Error('Independent STEP validator failed; see step-validation.log');
      const measured = JSON.parse(result.stdout);
      if (!Array.isArray(measured) || measured.length !== prefixes.length || new Set(measured.map(row => row.file)).size !== prefixes.length)
        throw new Error('Independent STEP validator returned an incomplete or duplicate cohort');
      json(join(out, 'step-validation.json'), measured);
      for (const row of report.local.cases.filter(row => row.status === 'kernel-passed')) {
        const item = measured.find(item => item.file === join(out, `cadbench-${row.id}.step`));
        if (!item?.valid) throw new Error(`Missing independent STEP result: ${row.id}`);
        near(item.volumeMm3, row.expected.volumeMm3, row.expected.relativeTolerance, 1e-5, `Independent volume: ${row.id}`);
        const observations = item.pointClassification?.points;
        if (!observations || observations.length !== row.expected.probes.length || new Set(observations.map(point => point.id)).size !== observations.length)
          throw new Error(`Incomplete independent probe results: ${row.id}`);
        for (const expected of row.expected.probes)
          if (observations.find(point => point.id === expected.id)?.state !== expected.classification)
            throw new Error(`Independent point classification differs: ${expected.id}`);
        row.independentStep = item; row.validation = 'native checks plus independent STEP topology/volume and inside/outside probes';
      }
      for (const row of report.local.cases.filter(row => row.status === 'kernel-passed')) row.status = 'passed';
      report.stepValidation.status = 'passed'; report.stepValidation.report = 'step-validation.json';
    } catch (error) {
      report.stepValidation.error = errorRecord(error);
      for (const row of report.local.cases.filter(row => row.status === 'kernel-passed')) {
        row.status = 'failed'; row.error = errorRecord(error);
      }
    }
  } else if (validateStep) report.stepValidation = { status: 'not-run', reason: 'No completed candidate exports.' };
  const after = cadbenchImplementationSnapshot(); report.implementationStable = report.implementation.sha256 === after.sha256;
  if (!report.implementationStable) report.implementationAfter = after;
  report.local.counts = counts(report.local.cases.map(row => row.status));
  report.local.completePilot = selected.length === pilot.cases.length;
  report.inventory = corpus.map(row => ({ id: row.id, name: row.name, officialStatus: 'not-run',
    officialTaskDigest: policy.task_digests[`gnucleus-ai/freecad-${row.id}`],
    localAdaptation: report.local.cases.find(item => item.upstreamId === row.id)?.status ?? 'not-attempted' }));
  report.accepted = report.implementationStable && report.stepValidation.status === 'passed' && report.local.cases.every(row => row.status === 'passed');
  report.finishedAt = new Date().toISOString();
  json(join(out, 'report.json'), report);
  const lines = ['# CADBench local Bend pilot', '', report.scope, '',
    `Official ${policy.tag}: **0/${policy.task_count} tasks scored**; no official reward or submission.`, '',
    `Local selection: ${selected.length}/${pilot.cases.length} pilot cases. Independent STEP validation: ${report.stepValidation.status}.`, '',
    '| Local case | Source row | Status | Finding |', '|---|---|---|---|',
    ...report.local.cases.map(row => `| ${row.id} | ${row.upstreamId} | ${row.status} | ${(row.error?.message ?? `${row.actual.volumeMm3} mm³`).replaceAll('|', '\\|')} |`), '',
    `Implementation stable during run: ${report.implementationStable}. Full evidence: [report.json](report.json).`, '',
    'The remaining public source rows are not attempted. This selected pilot is not an estimate of full-benchmark accuracy.', ''];
  writeFileSync(join(out, 'report.md'), lines.join('\n'));
  return report;
}

export function cadbenchOptions(args) {
  const options = {}, ids = [];
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flag === '--skip-step-validation') options.validateStep = false;
    else if (flag === '--out' || flag === '--case') {
      const value = args[++i];
      if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
      if (flag === '--out') options.out = resolve(value); else ids.push(value);
    } else throw new Error(`Unknown CADBench option: ${flag}`);
  }
  if (ids.length) options.caseIds = ids;
  return options;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.length === 1 && args[0] === '--help') {
      console.log('Usage: node scripts/cadbench.mjs [--out <directory>] [--case <id>] [--skip-step-validation]\nRuns the local five-case Bend pilot, including unsupported cases. Default exit 1 currently reflects real capability gaps.\n--case may be repeated for diagnosis; --skip-step-validation cannot produce a validated pass. No official CADBench score, paid API calls, or uploads.');
    } else if (args.length === 1 && args[0] === '--list') {
      for (const row of verifyCadbenchFixtures().pilot.cases) console.log(`${row.id}\t${row.upstreamId}\t${row.adaptation}`);
    } else {
      const options = cadbenchOptions(args), report = await runCadbench(options);
      console.log(`Official CADBench v2: 0/${report.official.totalTasks} scored. Local: ${JSON.stringify(report.local.counts)}. STEP: ${report.stepValidation.status}.`);
      console.log(join(options.out ?? join(root, 'out/cadbench/pilot'), 'report.json'));
      process.exitCode = report.accepted ? 0 : 1;
    }
  } catch (error) { console.error(`CADBench: ${error.message}`); process.exitCode = 1; }
}
