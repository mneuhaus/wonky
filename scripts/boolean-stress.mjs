#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFileSync, existsSync, mkdirSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { loadKernel, extrudeInBend, transformInBend } from '../src/kernel.mjs';
import { decodeAnalytic } from '../src/analytic.mjs';
import { booleanInBend } from '../src/boolean.mjs';
import { real, vector } from '../src/real.mjs';
import { toStep } from '../src/exporters.mjs';
import { UnsupportedFeatureError } from '../src/errors.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const json = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
const frame = { origin: [0, 0, 0], normal: [0, 0, 1], x: [1, 0, 0] };
function box(kernel, id, low, high) {
  return extrudeInBend(kernel, id, [[low[0], low[1]], [high[0], low[1]], [high[0], high[1]], [low[0], high[1]]],
    { ...frame, origin: [0, 0, low[2]] }, [0, 0, high[2] - low[2]]);
}
function comb(kernel, count) {
  const points = [[0, 0], [2 * count - 1, 0], [2 * count - 1, 3]];
  for (let tooth = count - 1; tooth >= 0; tooth--) {
    points.push([2 * tooth, 3]);
    if (tooth) points.push([2 * tooth, 1], [2 * tooth - 1, 1], [2 * tooth - 1, 3]);
  }
  return extrudeInBend(kernel, `comb-${count}`, points, frame, [0, 0, 8]);
}

// These are deliberate faceted profiles, not approximations of smooth curves.
// Expected volumes come from the profile dimensions, independently of outputs.
export function booleanStressCases({ full = false } = {}) {
  const cases = [];
  for (const count of full ? [2, 4, 8, 16, 32] : [2, 4, 8]) {
    for (const cut of full ? [0.999, 1, 1.001, 1.5, 2.999] : [0.999, 1, 1.5]) {
      const represented = Math.fround(cut);
      const area = represented < 1 ? (2 * count - 1) * (1 - represented) + 2 * count : count * (3 - represented);
      cases.push({ id: `comb-${count}-y-${cut}`, family: 'concave-multicomponent', operation: 'INTERSECTION',
        parameters: { teeth: count, requestedCutMm: cut, representedCutMm: represented, heightMm: 8 },
        expected: { components: represented < 1 ? 1 : count, volumeMm3: area * 8 },
        prepare: kernel => [comb(kernel, count), box(kernel, 'cut', [-1, represented, -1], [2 * count, 4, 9])] });
    }
  }
  const representative = cases.find(item => item.id === 'comb-4-y-1.5');
  cases.push({ ...representative, id: 'comb-4-swapped', family: 'operand-swap',
    prepare: kernel => representative.prepare(kernel).reverse() });
  cases.push({ ...representative, id: 'comb-4-rigid', family: 'rigid-transform',
    prepare: kernel => representative.prepare(kernel).map((body, index) => transformInBend(kernel, body, `moved-${index}`,
      [[0, 0, 1], [1, 0, 0], [0, 1, 0]], [16, -8, 32])) });
  const provenance = JSON.parse(readFileSync(join(root, 'fixtures/boolean-stress/provenance.json')));
  if (existsSync(join(root, 'fixtures/boolean-stress', provenance.file)) && existsSync(join(root, provenance.source))) {
  const frozen = readFileSync(join(root, 'fixtures/boolean-stress', provenance.file));
  if (sha(frozen) !== provenance.sha256 || sha(readFileSync(join(root, provenance.source))) !== provenance.sourceSha256) throw new Error('Frozen g7 stress input changed');
  cases.push({ id: 'r10b-g7-union', family: 'real-r10b-coplanar-overlap', operation: 'UNION',
    provenance, expected: { components: 1, volumeMm3: provenance.expected.volumeMm3 },
    prepare: () => JSON.parse(frozen).bodies.map(value => value.body) });
  cases.push({ id: 'r10b-g7-difference', family: 'real-r10b-coplanar-overlap', operation: 'SUBTRACTION',
    provenance, expected: { components: 1, volumeMm3: 47023.20153808594 - 4.790000915527344 * 120 },
    prepare: () => JSON.parse(frozen).bodies.map(value => value.body) });
  }
  for (const x of full ? [-2.999, -1, 0, 1, 2.999] : [1]) {
    const represented = Math.fround(x);
    cases.push({ id: `cylinder-plane-${x}`, family: 'analytic-partial-cylinder', operation: 'INTERSECTION',
      parameters: { radiusMm: 3, heightMm: 10, requestedCutMm: x, representedCutMm: represented },
      expected: { components: 1, volumeMm3: 10 * (9 * (Math.PI / 2 + Math.asin(represented / 3)) + represented * Math.sqrt(9 - represented * represented)) },
      prepare: kernel => [decodeAnalytic(kernel.analytic.frustum(vector([0, 0, 0]), vector([0, 0, 10]), vector([1, 0, 0]), real(3), real(3)), 'cylinder', kernel),
        box(kernel, 'cut', [-4, -4, -1], [Math.fround(x), 4, 11])] });
  }
  return cases;
}

function implementationSnapshot() {
  const paths = ['bend.lock.json', 'scripts/boolean-stress.mjs', 'scripts/validate-step.py'];
  const collect = directory => {
    for (const entry of readdirSync(join(root, directory), { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) collect(path);
      else if (/\.(?:bend|mjs|json)$/.test(path)) paths.push(path);
    }
  };
  for (const directory of ['src', 'kernel', 'fixtures/boolean-stress']) collect(directory);
  const files = paths.sort().map(path => ({ path, sha256: sha(readFileSync(join(root, path))) }));
  return { sha256: sha(JSON.stringify(files)), files };
}

export async function runBooleanStress({ out = join(root, 'out/boolean-stress'), full = false, caseIds, validateStep = true } = {}) {
  out = resolve(out); mkdirSync(out, { recursive: true });
  const implementation = implementationSnapshot();
  const started = performance.now(), kernel = await loadKernel(), kernelLoadMs = performance.now() - started;
  let selected = booleanStressCases({ full });
  if (caseIds) {
    const ids = new Set(caseIds);
    if (caseIds.length !== ids.size || [...ids].some(id => !selected.some(item => item.id === id))) throw new Error('Unknown or repeated Boolean stress case');
    selected = selected.filter(item => ids.has(item.id));
  }
  const report = { schema: 'wonky-boolean-stress/1', startedAt: new Date().toISOString(),
    implementation,
    scope: 'Native Bend solid/solid operations on synthetic faceted and analytic shapes plus frozen actual r10b inputs; not an official CADBench score.',
    modelingPolicy: { curvedContacts: 'strict' },
    timing: { kernelLoadMs, target: 'JavaScript', isolated: false,
      scope: 'One observation per case in this process. Preparation, Boolean including host interop/native audit, and STEP serialization are separate; this is not a hardware speedup claim.' },
    independentValidationRequested: validateStep, cases: [] };
  const prefixes = [];
  for (const item of selected) {
    const { prepare, ...definition } = item;
    const row = { ...definition, status: 'started', independentValidation: 'not-run' }; report.cases.push(row);
    for (const extension of ['brep.json', 'step', 'failure-evidence.json']) rmSync(join(out, `${item.id}.${extension}`), { force: true });
    let stage = 'prepare';
    try {
      const before = performance.now(), inputs = prepare(kernel); row.prepareMs = performance.now() - before;
      const original = JSON.stringify(inputs);
      row.inputHash = sha(original);
      row.inputTopology = inputs.map(body => ({ vertices: body.vertices.length, edges: body.edges.length, faces: body.faces.length }));
      stage = 'boolean'; const operationStart = performance.now();
      let bodies;
      try { bodies = booleanInBend(kernel, ...inputs, item.operation, `stress/${item.id}`); }
      finally { row.booleanAndValidationMs = performance.now() - operationStart; }
      row.result = { components: bodies.length, volumeMm3: bodies.reduce((sum, body) => sum + body.validation.volumeMm3, 0),
        topology: bodies.map(body => ({ vertices: body.vertices.length, edges: body.edges.length, faces: body.faces.length })) };
      if (bodies.some(body => !body.validation.closed || !Number.isFinite(body.validation.volumeMm3))) throw new Error('Result lacks a closed validated B-rep and finite volume');
      const tolerance = Math.max(1e-7, Math.abs(item.expected.volumeMm3) * 2e-7);
      if (bodies.length !== item.expected.components || Math.abs(row.result.volumeMm3 - item.expected.volumeMm3) > tolerance) {
        row.status = 'reference-mismatch'; row.volumeToleranceMm3 = tolerance;
      } else row.status = 'native-resolved';
      const prefix = join(out, item.id), model = { schema: 'wonky-brep/1', units: 'millimeter', backend: { language: 'Bend', target: 'JavaScript' },
        modelingPolicy: report.modelingPolicy, operationEvidence: bodies.operationEvidence, bodies };
      json(`${prefix}.brep.json`, model);
      if (bodies.length) {
        stage = 'export'; const exportStart = performance.now();
        writeFileSync(`${prefix}.step`, toStep(model, item.id)); row.stepSerializationMs = performance.now() - exportStart;
        prefixes.push(prefix);
      } else row.independentValidation = 'empty-no-step';
    } catch (error) {
      row.status = error instanceof UnsupportedFeatureError ? 'unsupported' : 'error';
      row.error = { name: error.name, message: error.message, stage };
      if (error.operationEvidence) json(join(out, `${item.id}.failure-evidence.json`), error.operationEvidence);
    }
  }
  if (validateStep && prefixes.length) {
    const before = performance.now();
    const result = spawnSync('uv', ['run', 'scripts/validate-step.py', ...prefixes], { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
    report.independentValidationMs = performance.now() - before;
    writeFileSync(join(out, 'step-validation.log'), (result.stdout ?? '') + (result.stderr ?? ''));
    report.validatorExitCode = result.status;
    let validations = [];
    try { validations = JSON.parse(result.stdout); } catch { /* A reader failure is an explicit failed validation. */ }
    if (!Array.isArray(validations)) validations = [];
    json(join(out, 'step-validation.json'), validations);
    for (const prefix of prefixes) {
      const row = report.cases.find(item => join(out, item.id) === prefix);
      const validation = validations.find(value => value.file === prefix + '.step');
      row.independentValidation = validation?.valid === true ? 'passed' : 'failed';
      if (row.independentValidation === 'failed' && row.status === 'native-resolved') row.status = 'invalid-export';
    }
  }
  report.counts = {
    total: report.cases.length,
    nativeResolved: report.cases.filter(row => row.status === 'native-resolved').length,
    independentlyValidated: report.cases.filter(row => row.status === 'native-resolved' && row.independentValidation === 'passed').length,
    unsupported: report.cases.filter(row => row.status === 'unsupported').length,
    incorrect: report.cases.filter(row => ['error', 'reference-mismatch', 'invalid-export'].includes(row.status)).length,
  };
  report.implementationStable = implementationSnapshot().sha256 === implementation.sha256;
  report.complete = report.implementationStable && report.counts.nativeResolved === report.counts.total &&
    report.cases.every(row => ['passed', 'empty-no-step'].includes(row.independentValidation));
  report.finishedAt = new Date().toISOString(); json(join(out, 'report.json'), report);
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2); let out, full = false;
  try {
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--full') full = true;
      else if (args[i] === '--out' && args[i + 1] && !args[i + 1].startsWith('--')) out = args[++i];
      else throw new Error('Usage: node scripts/boolean-stress.mjs [--full] [--out <directory>]');
    }
    const report = await runBooleanStress({ out, full });
    console.log(JSON.stringify(report.counts));
    console.log(join(resolve(out ?? join(root, 'out/boolean-stress')), 'report.json'));
    process.exitCode = report.complete ? 0 : 1;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
