import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from '../src/index.mjs';
import { toStep } from '../src/exporters.mjs';
import { UnsupportedFeatureError } from '../src/errors.mjs';
import { sha256 } from './cadbench-sources.mjs';
import { cadbenchImplementationSnapshot } from './cadbench.mjs';

export const regressionRoot = fileURLToPath(new URL('../', import.meta.url));
export const regressionFixtures = join(regressionRoot, 'fixtures/public-boolean-regressions');
const json = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
const errorRecord = error => ({ name: error.name, message: error.message, line: error.line ?? null, column: error.column ?? null });
const finite = value => typeof value === 'number' && Number.isFinite(value);
const fail = (name, message) => { const error = new Error(message); error.name = name; throw error; };
const mismatch = message => fail('GeometryCheckError', message);
const incomplete = message => fail('IncompleteOracleError', message);
function fixturePath(base, path) {
  const full = resolve(base, path);
  if (isAbsolute(path) || !full.startsWith(resolve(base) + sep)) throw new Error(`Invalid regression fixture path: ${path}`);
  return full;
}
function near(actual, expected, tolerance, label) {
  if (!finite(actual)) incomplete(`${label}: no finite measurement`);
  if (Math.abs(actual - expected) > tolerance) mismatch(`${label}: measured ${actual}, expected ${expected} +/- ${tolerance}`);
}
function checkBounds(actual, expected, tolerance, label) {
  for (const side of ['min', 'max']) for (let axis = 0; axis < 3; axis++)
    near(actual?.[side]?.[axis], expected[side][axis], tolerance, `${label} ${side}[${axis}]`);
}

export function verifyPublicBooleanRegressions(base = regressionFixtures) {
  const manifest = JSON.parse(readFileSync(join(base, 'manifest.json'), 'utf8'));
  if (manifest.schema !== 'wonky-public-boolean-regressions/1' || manifest.license !== 'LGPL-2.1 with OCCT exception' ||
      manifest.repository !== 'https://github.com/Open-Cascade-SAS/OCCT' || !/^[a-f0-9]{40}$/.test(manifest.revision))
    throw new Error('Unsupported public Boolean provenance');
  if (!Array.isArray(manifest.cases) || manifest.cases.length < 3 || manifest.cases.length > 6 ||
      new Set(manifest.cases.map(row => row.id)).size !== manifest.cases.length) throw new Error('Expected 3–6 unique original cases');
  const files = [...manifest.files, ...manifest.supportFiles, ...manifest.cases.map(row => ({ path: row.source, sha256: row.sourceSha256 }))];
  if (new Set(files.map(file => file.path)).size !== files.length) throw new Error('Duplicate pinned regression file');
  for (const file of files)
    if (sha256(readFileSync(fixturePath(base, file.path))) !== file.sha256) throw new Error(`Regression SHA-256 mismatch: ${file.path}`);
  const probeIds = new Set();
  for (const row of manifest.cases) {
    if (!/^[a-z0-9-]+$/.test(row.id) || !row.modifications || row.feature !== 'main' ||
        !['INTERSECTION', 'UNION', 'SUBTRACTION'].includes(row.operation)) throw new Error('Invalid regression case metadata');
    const original = manifest.files.find(file => file.path === row.originalSource);
    if (!original || original.sha256 !== row.originalSourceSha256 || original.upstreamPath !== row.upstreamPath || original.url !== row.upstreamUrl)
      throw new Error(`Incomplete original operand provenance: ${row.id}`);
    const text = readFileSync(fixturePath(base, row.originalSource), 'utf8');
    const command = row.originalOracles.areaCommand;
    if (!text.split(/\r?\n/).some(line => line.trim() === command) ||
        Number(command.match(/^checkprops result -s (\S+)$/)?.[1]) !== row.originalOracles.areaMm2)
      throw new Error(`Original area assertion changed: ${row.id}`);
    const expected = row.expected;
    if (!Number.isInteger(expected.solids) || expected.solids < 1 || !expected.derivation ||
        ![expected.volumeMm3, expected.areaMm2, expected.volumeAbsoluteToleranceMm3, expected.areaAbsoluteToleranceMm2,
          expected.boundsAbsoluteToleranceMm, row.originalOracles.areaAbsoluteToleranceMm2].every(value => finite(value) && value > 0) ||
        !['min', 'max'].every(side => expected.boundsMm?.[side]?.length === 3 && expected.boundsMm[side].every(finite)) ||
        !Array.isArray(expected.probes) || expected.probes.length < 2) throw new Error(`Incomplete geometric oracles: ${row.id}`);
    for (const probe of expected.probes) {
      if (typeof probe.id !== 'string' || !probe.id.startsWith(row.id + '/') || probeIds.has(probe.id) ||
          !['Inside', 'Outside', 'Boundary'].includes(probe.classification) || probe.pointMm?.length !== 3 || !probe.pointMm.every(finite))
        throw new Error(`Invalid occupancy oracle: ${row.id}`);
      probeIds.add(probe.id);
    }
  }
  return manifest;
}

export function classifyPublicBooleanFailure(error) {
  if (error instanceof UnsupportedFeatureError) return /not defined or not implemented|^Import |^Unresolved Onshape module|^Field .*not supported/.test(error.message)
    ? 'unsupported-api' : 'unsupported-geometry';
  if (error.name === 'GeometryCheckError') return 'wrong-geometry';
  if (error.name === 'IncompleteOracleError') return 'incomplete-oracle';
  if (error.name === 'StepValidationError') return 'validation-error';
  return 'execution-error';
}

export function checkPublicBooleanModel(model, expected) {
  if (model.backend?.language !== 'Bend' || model.source?.language !== 'FeatureScript') mismatch('Expected FeatureScript evaluated by Bend');
  if (model.bodies.length !== expected.solids || model.bodies.some(body => !body.validation.closed)) mismatch('Expected the reference number of closed solids');
  const values = model.bodies.map(body => body.validation);
  const actual = { solids: model.bodies.length,
    volumeMm3: values.every(value => finite(value.volumeMm3)) ? values.reduce((sum, value) => sum + value.volumeMm3, 0) : null,
    areaMm2: values.every(value => finite(value.areaMm2)) ? values.reduce((sum, value) => sum + value.areaMm2, 0) : null,
    boundsMm: values.every(value => value.boundsMm) ? {
      min: [0, 1, 2].map(axis => Math.min(...values.map(value => value.boundsMm.min[axis]))),
      max: [0, 1, 2].map(axis => Math.max(...values.map(value => value.boundsMm.max[axis]))),
    } : null,
    topology: model.bodies.map(body => ({ vertices: body.vertices.length, edges: body.edges.length, faces: body.faces.length })),
    precision: model.backend.precision };
  if (model.bodies.some(body => body.faces.some(face => face.surface.type !== 'plane') ||
      body.edges.some(edge => (edge.curve.type ?? edge.curve) !== 'line'))) mismatch('Original planar/line geometry was not retained');
  const missing = [];
  if (actual.volumeMm3 === null) missing.push('native volume');
  else near(actual.volumeMm3, expected.volumeMm3, expected.volumeAbsoluteToleranceMm3, 'Native volume');
  if (!actual.boundsMm) missing.push('native tight bounds');
  else checkBounds(actual.boundsMm, expected.boundsMm, expected.boundsAbsoluteToleranceMm, 'Native bounds');
  if (actual.areaMm2 !== null) near(actual.areaMm2, expected.areaMm2, expected.areaAbsoluteToleranceMm2, 'Native area');
  return { actual, missing };
}

export function checkPublicBooleanStep(measured, row) {
  if (!measured?.valid) fail('StepValidationError', measured?.error?.message ?? 'Missing valid independent STEP result');
  const expected = row.expected;
  if (measured.solids !== expected.solids) mismatch('Independent solid count differs');
  near(measured.areaMm2, row.originalOracles.areaMm2, row.originalOracles.areaAbsoluteToleranceMm2, 'Original OCCT area value');
  near(measured.areaMm2, expected.areaMm2, expected.areaAbsoluteToleranceMm2, 'Derived exact area');
  near(measured.volumeMm3, expected.volumeMm3, expected.volumeAbsoluteToleranceMm3, 'Independent volume');
  checkBounds(measured.boundsMm, expected.boundsMm, expected.boundsAbsoluteToleranceMm, 'Independent bounds');
  const observed = measured.pointClassification?.points;
  if (!Array.isArray(observed) || observed.length !== expected.probes.length || new Set(observed.map(point => point.id)).size !== observed.length)
    incomplete('Incomplete independent occupancy oracle');
  for (const probe of expected.probes) {
    const point = observed.find(point => point.id === probe.id);
    if (!point || JSON.stringify(point.pointMm) !== JSON.stringify(probe.pointMm)) incomplete(`Missing or moved probe: ${probe.id}`);
    if (point.state !== probe.classification) mismatch(`Occupancy ${probe.id}: ${point.state} != ${probe.classification}`);
  }
}

function implementationSnapshot(manifest, fixtures) {
  // Reuse the existing source-revision snapshot; add this runner and its pinned inputs.
  const common = cadbenchImplementationSnapshot();
  const additions = ['manifest.json', ...manifest.files.map(file => file.path), ...manifest.supportFiles.map(file => file.path),
    ...manifest.cases.map(row => row.source)].map(path => ({ path: join(fixtures, path), sha256: sha256(readFileSync(join(fixtures, path))) }));
  additions.push({ path: 'scripts/public-boolean-regressions.mjs', sha256: sha256(readFileSync(new URL(import.meta.url))) });
  return { sha256: sha256(JSON.stringify([common.sha256, additions])), shared: common, additions };
}

export async function runPublicBooleanRegressions({ out = join(regressionRoot, 'out/public-boolean-regressions/run'),
  caseIds, validateStep = true, fixtures = regressionFixtures } = {}) {
  const manifest = verifyPublicBooleanRegressions(fixtures);
  if (typeof validateStep !== 'boolean') throw new TypeError('validateStep must be boolean');
  if (caseIds !== undefined && (!Array.isArray(caseIds) || !caseIds.length || new Set(caseIds).size !== caseIds.length ||
      caseIds.some(id => !manifest.cases.some(row => row.id === id)))) throw new Error('Unknown, duplicate or empty regression case selection');
  const selected = manifest.cases.filter(row => caseIds === undefined || caseIds.includes(row.id));
  out = resolve(out); mkdirSync(out, { recursive: true });
  for (const row of manifest.cases) for (const extension of ['step', 'brep.json', 'failure.json']) rmSync(join(out, `${row.id}.${extension}`), { force: true });
  for (const file of ['report.json', 'step-validation.json', 'step-validation.log', 'point-probes.json']) rmSync(join(out, file), { force: true });
  const report = { schema: 'wonky-public-boolean-report/1', startedAt: new Date().toISOString(), scope: manifest.scope,
    upstream: { repository: manifest.repository, revision: manifest.revision, license: manifest.license,
      selectedCases: selected.length, cohortCases: manifest.cases.length, originalSuiteExecuted: false, originalTestsPassed: null },
    manifestSha256: sha256(readFileSync(join(fixtures, 'manifest.json'))), implementation: implementationSnapshot(manifest, fixtures),
    runtime: 'FeatureScript -> actual Bend construction and Booleans -> STEP; OCP only reads and measures exported test artifacts.',
    modelingPolicy: { curvedContacts: 'strict' }, cases: [],
    stepValidation: { status: validateStep ? 'pending' : 'not-run' }, accepted: false };
  const probes = [], prefixes = [];
  for (const item of selected) {
    const row = { ...item, status: 'execution-error' }; report.cases.push(row);
    const prefix = join(out, item.id);
    try {
      const model = await build(readFileSync(fixturePath(fixtures, item.source), 'utf8'), {
        feature: item.feature, id: item.id, sourcePath: fixturePath(fixtures, item.source), modelingPolicy: report.modelingPolicy,
      });
      Object.assign(row, checkPublicBooleanModel(model, item.expected));
      const step = toStep(model, item.id);
      json(prefix + '.brep.json', model); writeFileSync(prefix + '.step', step);
      row.exports = ['brep.json', 'step'].map(extension => ({ path: `${item.id}.${extension}`, sha256: sha256(readFileSync(`${prefix}.${extension}`)) }));
      row.operationEvidence = model.operationEvidence;
      row.status = row.missing.length ? 'incomplete-oracle' : 'kernel-passed';
      prefixes.push(prefix); probes.push({ prefix, points: item.expected.probes.map(({ id, pointMm }) => ({ id, pointMm })) });
    } catch (error) {
      row.status = classifyPublicBooleanFailure(error); row.error = errorRecord(error);
      for (const extension of ['step', 'brep.json']) rmSync(prefix + '.' + extension, { force: true });
      json(prefix + '.failure.json', { ...row.error, operationEvidence: error.completedOperationEvidence ?? [], sourceTrace: error.modelTrace ?? null });
      row.failureArtifact = `${item.id}.failure.json`;
    }
  }
  if (validateStep && prefixes.length) {
    const pointFile = join(out, 'point-probes.json');
    json(pointFile, { schema: 'wonky-solid-probes/1', toleranceMm: 1e-7, models: probes });
    // uv keys environments by script path. APFS clones in each fresh checkout
    // repeat macOS dylib loading; hardlinks reuse the cached library files.
    // Cold launch measured 60.22s (dyld/fcntl), versus <1s warm: allow
    // 2 minutes including startup, as cadbench does, without retrying checks.
    const args = ['run', '--link-mode', 'hardlink', fixturePath(fixtures, 'measure-step.py'), '--validator', join(regressionRoot, 'scripts/validate-step.py'), '--points', pointFile, ...prefixes];
    const result = spawnSync('uv', args, { cwd: regressionRoot, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 120000 });
    writeFileSync(join(out, 'step-validation.log'), (result.stdout ?? '') + (result.stderr ?? '') + (result.error?.message ?? ''));
    report.stepValidation = { status: 'failed', command: ['uv', ...args], exitCode: result.status, log: 'step-validation.log' };
    const built = report.cases.filter(row => row.exports);
    try {
      if (result.error || ![0, 1].includes(result.status))
        throw new Error(`Independent STEP process failed: ${result.error?.message ?? `exit ${result.status}, signal ${result.signal}`}`);
      const measured = JSON.parse(result.stdout);
      if (!Array.isArray(measured) || measured.length !== prefixes.length || new Set(measured.map(row => row.file)).size !== prefixes.length ||
          prefixes.some(prefix => !measured.some(row => row.file === prefix + '.step'))) throw new Error('Incomplete independent STEP cohort');
      json(join(out, 'step-validation.json'), measured);
      report.stepValidation.report = 'step-validation.json';
      for (const row of built) {
        row.independentStep = measured.find(item => item.file === join(out, row.id + '.step'));
        try {
          checkPublicBooleanStep(row.independentStep, row);
          for (const file of row.exports)
            if (sha256(readFileSync(join(out, file.path))) !== file.sha256) throw new Error(`Export changed during validation: ${file.path}`);
          if (row.status === 'kernel-passed') row.status = 'passed-adapted-geometry';
        } catch (error) { row.status = classifyPublicBooleanFailure(error); row.error = errorRecord(error); }
      }
      report.stepValidation.status = built.every(row => ['passed-adapted-geometry', 'incomplete-oracle'].includes(row.status) && !row.error) ? 'passed' : 'failed';
    } catch (error) {
      report.stepValidation.error = errorRecord(error);
      for (const row of built) { row.status = 'validation-error'; row.error = errorRecord(error); }
    }
  } else if (validateStep) report.stepValidation = { status: 'not-run', reason: 'No Boolean result was constructed; operand-only diagnostics cannot pass a case.' };
  report.counts = Object.fromEntries([...new Set(report.cases.map(row => row.status))].sort().map(status =>
    [status, report.cases.filter(row => row.status === status).length]));
  const after = implementationSnapshot(manifest, fixtures);
  report.implementationStable = after.sha256 === report.implementation.sha256;
  if (!report.implementationStable) report.implementationAfter = after;
  report.accepted = report.implementationStable && report.stepValidation.status === 'passed' && report.cases.every(row => row.status === 'passed-adapted-geometry');
  report.finishedAt = new Date().toISOString(); json(join(out, 'report.json'), report);
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = {}, caseIds = [], args = process.argv.slice(2);
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--skip-step-validation') options.validateStep = false;
      else if (args[i] === '--out' && args[i + 1]) options.out = args[++i];
      else if (args[i] === '--case' && args[i + 1]) caseIds.push(args[++i]);
      else throw new Error('Usage: node scripts/public-boolean-regressions.mjs [--out <directory>] [--case <id>] [--skip-step-validation]');
    }
    if (caseIds.length) options.caseIds = caseIds;
    const report = await runPublicBooleanRegressions(options);
    console.log(`Public OCCT adaptations: ${JSON.stringify(report.counts)}. Original suite not executed.`);
    console.log(join(resolve(options.out ?? join(regressionRoot, 'out/public-boolean-regressions/run')), 'report.json'));
    process.exitCode = report.accepted ? 0 : 1;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
