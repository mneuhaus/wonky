import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPython } from '../src/python.mjs';
import { toStep } from '../src/exporters.mjs';
import { UnsupportedFeatureError } from '../src/errors.mjs';
import { cadbenchFixtures, cadbenchRoot, fixturePath, sha256 } from './cadbench-sources.mjs';
import { cadbenchImplementationSnapshot } from './cadbench.mjs';

const base = join(cadbenchFixtures, 'build123d');
const json = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
export function verifyBuild123dProbes() {
  const manifest = JSON.parse(readFileSync(join(base, 'manifest.json')));
  if (manifest.schema !== 'wonky-build123d-probes/1' || manifest.license !== 'Apache-2.0') throw new Error('Unsupported build123d probe manifest');
  for (const file of [...manifest.files, ...manifest.cases.map(row => ({ path: row.source, sha256: row.sourceSha256 }))])
    if (sha256(readFileSync(fixturePath(base, file.path))) !== file.sha256) throw new Error(`build123d probe SHA-256 mismatch: ${file.path}`);
  return manifest;
}

export function classifyBuild123dFailure(error) {
  if (error instanceof UnsupportedFeatureError)
    return /Python frontend|build123d\./.test(error.message) ? 'unsupported-api' : 'unsupported-geometry';
  return error.name === 'GeometryCheckError' ? 'wrong-geometry' : 'execution-error';
}

function check(model, expected) {
  const fail = message => { const error = new Error(message); error.name = 'GeometryCheckError'; throw error; };
  if (model.backend?.language !== 'Bend' || model.bodies.some(body => !body.validation.closed)) fail('Expected real validated Bend solids');
  if (expected.solids !== undefined && model.bodies.length !== expected.solids) fail(`Solid count ${model.bodies.length} != ${expected.solids}`);
  const values = model.bodies.map(body => body.validation.volumeMm3);
  const actual = { solids: model.bodies.length, volumeMm3: values.every(Number.isFinite) ? values.reduce((a, b) => a + b, 0) : null,
    boundsMm: model.bodies.every(body => body.validation.boundsMm) ? {
      min: [0, 1, 2].map(axis => Math.min(...model.bodies.map(body => body.validation.boundsMm.min[axis]))),
      max: [0, 1, 2].map(axis => Math.max(...model.bodies.map(body => body.validation.boundsMm.max[axis]))),
    } : null };
  const missing = [];
  if (expected.volumeMm3 === undefined) missing.push('reference volume and original equivalence oracle');
  else if (actual.volumeMm3 === null) missing.push('native volume');
  else if (Math.abs(actual.volumeMm3 - expected.volumeMm3) > (expected.volumeAbsoluteTolerance ?? 1e-6)) fail(`Volume ${actual.volumeMm3} != ${expected.volumeMm3}`);
  if (expected.boundsMm) {
    if (!actual.boundsMm) missing.push('native tight bounding box');
    else for (const side of ['min', 'max']) for (let axis = 0; axis < 3; axis++)
      if (Math.abs(actual.boundsMm[side][axis] - expected.boundsMm[side][axis]) > 1e-6) fail(`Bounding box ${side}[${axis}] differs`);
  }
  return { actual, missing };
}

export async function runBuild123dProbes({ out = join(cadbenchRoot, 'out/cadbench/build123d'), validateStep = true } = {}) {
  const manifest = verifyBuild123dProbes(); out = resolve(out); mkdirSync(out, { recursive: true });
  for (const row of manifest.cases) for (const extension of ['step', 'brep.json', 'failure.json']) rmSync(join(out, `${row.id}.${extension}`), { force: true });
  for (const name of ['step-validation.json', 'step-validation.log']) rmSync(join(out, name), { force: true });
  const report = { schema: 'wonky-build123d-probe-report/1', startedAt: new Date().toISOString(), scope: manifest.scope,
    implementation: cadbenchImplementationSnapshot(),
    upstream: { repository: manifest.repository, revision: manifest.revision, license: manifest.license,
      methodsInPinnedFile: manifest.upstreamTestMethodsInFile, selectedMethods: manifest.cases.length,
      originalSuiteExecuted: false, originalTestsPassed: null },
    runtime: 'Wonky Python compatibility shim -> actual Bend kernel; external build123d/OCCT construction is not used.',
    cases: [], stepValidation: { status: 'not-run' }, accepted: false };
  const prefixes = [];
  for (const item of manifest.cases) {
    const row = { ...item, status: 'execution-error' }; report.cases.push(row);
    try {
      const model = await buildPython(readFileSync(fixturePath(base, item.source), 'utf8'), { filename: fixturePath(base, item.source) });
      Object.assign(row, check(model, item.expected));
      const prefix = join(out, item.id), step = toStep(model, item.id);
      json(prefix + '.brep.json', model); writeFileSync(prefix + '.step', step); prefixes.push(prefix);
      row.exports = ['brep.json', 'step'].map(extension => ({ path: `${item.id}.${extension}`, sha256: sha256(readFileSync(`${prefix}.${extension}`)) }));
      row.status = row.missing.length ? 'incomplete-oracle' : 'kernel-passed';
    } catch (error) {
      row.status = classifyBuild123dFailure(error);
      row.error = { name: error.name, message: error.message, line: error.line ?? null };
      json(join(out, `${item.id}.failure.json`), { ...row.error, trace: error.modelTrace ?? null });
    }
  }
  if (validateStep && prefixes.length) {
    const args = ['run', 'scripts/validate-step.py', ...prefixes];
    const result = spawnSync('uv', args, { cwd: cadbenchRoot, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 120000 });
    writeFileSync(join(out, 'step-validation.log'), (result.stdout ?? '') + (result.stderr ?? '') + (result.error?.message ?? ''));
    report.stepValidation = { status: 'failed', command: ['uv', ...args], exitCode: result.status };
    try {
      if (result.status !== 0 || result.error) throw new Error('Independent STEP validation failed');
      const measurements = JSON.parse(result.stdout);
      if (!Array.isArray(measurements) || measurements.length !== prefixes.length ||
          prefixes.some(prefix => !measurements.some(row => row.file === prefix + '.step' && row.valid)))
        throw new Error('Incomplete independent STEP result');
      json(join(out, 'step-validation.json'), measurements);
      report.stepValidation.status = 'passed'; report.stepValidation.report = 'step-validation.json';
      for (const row of report.cases) {
        const measured = measurements.find(measured => measured.file === join(out, `${row.id}.step`));
        if (measured) row.independentStep = measured;
        if (row.status === 'kernel-passed') row.status = 'passed-adapted-geometry';
      }
    } catch (error) {
      report.stepValidation.error = error.message;
      for (const row of report.cases) if (['kernel-passed', 'incomplete-oracle'].includes(row.status)) row.status = 'validation-error';
    }
  }
  report.counts = Object.fromEntries([...new Set(report.cases.map(row => row.status))].sort().map(status =>
    [status, report.cases.filter(row => row.status === status).length]));
  const after = cadbenchImplementationSnapshot(); report.implementationStable = report.implementation.sha256 === after.sha256;
  if (!report.implementationStable) report.implementationAfter = after;
  report.accepted = report.implementationStable && report.stepValidation.status === 'passed' && report.cases.every(row => row.status === 'passed-adapted-geometry');
  report.finishedAt = new Date().toISOString(); json(join(out, 'report.json'), report);
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.length > 1 || (args.length && args[0] !== '--skip-step-validation')) throw new Error('Usage: node scripts/cadbench-build123d.mjs [--skip-step-validation]');
    const report = await runBuild123dProbes({ validateStep: !args.length });
    console.log(`build123d adapted probes: ${JSON.stringify(report.counts)}. Original suite not executed; no CADBench score.`);
    console.log(join(cadbenchRoot, 'out/cadbench/build123d/report.json')); process.exitCode = report.accepted ? 0 : 1;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
