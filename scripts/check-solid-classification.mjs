#!/usr/bin/env node
// Independent STEP observations validate Bend results; they never construct them.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { build } from '../src/index.mjs';
import { loadKernel, array, precisionForBodies } from '../src/kernel.mjs';
import { importOnshapeBody, transformAnalytic, encodeAnalytic } from '../src/analytic.mjs';
import { geometryRevision } from '../src/identity.mjs';
import { classifySolid } from '../src/solid-classification.mjs';
import { loadFaceClassifier } from '../src/face-classification.mjs';
import { real, vector, coords } from '../src/real.mjs';
import { toStep } from '../src/exporters.mjs';
import { verifyFrozenSource } from './check-acceptance.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const out = join(root, 'out/solid-classification-validation');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
const sourceFile = path => ({ path, sha256: hash(readFileSync(join(root, path))) });
const options = { linear: 1e-7, angular: 1e-10, inputTolerance: 0 };
const p10Path = 'fixtures/r10b/modules/base/ZtoDD.body.json';
const p10Hash = 'b78a8546970e360ee2a3a22661c87d4f9e835d24fe50cedeedde6a19add20dc9';
const rows = [[1, 0, 0], [0, 0.9063077870366499, -0.42261826174069944], [0, 0.42261826174069944, 0.9063077870366499]];
const offset = [0, 85.7915071334, -183.980480768];

function implementationSnapshot() {
  const files = ['bend.lock.json', 'package.json', 'package-lock.json', 'scripts/check-solid-classification.mjs',
    'scripts/validate-step.py', 'scripts/check-acceptance.mjs', 'fixtures/r10b/r10b.fs',
    'fixtures/r10b/provenance.json', 'fixtures/r10b/modules.json', p10Path,
    'examples/box.fs', 'examples/bracket.fs', 'examples/bored-spacer.fs'];
  for (const directory of ['src', 'kernel']) for (const file of readdirSync(join(root, directory), { recursive: true })) {
    if (/\.(mjs|bend)$/.test(file)) files.push(join(directory, file));
  }
  const entries = [...new Set(files)].sort().map(sourceFile);
  return { sha256: hash(JSON.stringify(entries)), kernelSha256: hash(JSON.stringify(entries.filter(item => item.path.startsWith('kernel/')))), files: entries };
}

const smallProbes = {
  box: [[20,10,2.5],[1,1,1],[39,19,4],[5,15,3],[-2,10,2.5],[42,10,2.5],[20,-2,2.5],[20,22,2.5],
    [20,10,-2],[20,10,7],[20,10,0],[20,10,5],[40,10,2.5],[0,10,2.5],[0,0,2.5],[40,20,5]],
  bracket: [[10,10,4],[40,6,4],[9,30,4],[17,35,7],[30,25,4],[19,13,4],[-2,10,4],[52,6,4],
    [10,5,-2],[10,5,10],[10,5,0],[10,5,8],[18,25,4],[30,12,4],[18,12,4],[50,12,8]],
  'bored-spacer': [[3,0,5],[-3,0,5],[0,3,2],[0,-4,8],[0,0,5],[1,0,5],[-6,0,5],[0,6,5],
    [3,0,-2],[3,0,12],[3,0,0],[3,0,10],[5,0,5],[2,0,5],[5,0,0],[2,0,10]],
};

function exportCase(id, model, inputs, points) {
  assert.equal(model.bodies.length, 1, 'This comparison suite requires exactly one Bend body per STEP');
  const prefix = join(out, id), modelBytes = JSON.stringify(model, null, 2) + '\n', step = toStep(model, id);
  writeFileSync(prefix + '.brep.json', modelBytes); writeFileSync(prefix + '.step', step);
  return { id, prefix, model, record: { id, prefix: relative(root, prefix), inputs,
    brepSha256: hash(modelBytes), stepSha256: hash(step), geometryRevisions: model.bodies.map(geometryRevision), points } };
}

async function buildCases(report) {
  const cases = [];
  for (const [id, points] of Object.entries(smallProbes)) {
    const path = `examples/${id}.fs`, source = readFileSync(join(root, path), 'utf8');
    const model = await build(source, { sourcePath: join(root, path) });
    cases.push(exportCase(id, model, [sourceFile(path)], points.map((pointMm, i) => ({ id: `${id}.${i + 1}`, pointMm }))));
  }
  const frozen = readFileSync(join(root, 'fixtures/r10b/r10b.fs'));
  report.frozenSource = verifyFrozenSource(frozen, JSON.parse(readFileSync(join(root, 'fixtures/r10b/provenance.json'))));
  assert.equal(report.frozenSource.passed, true, 'Frozen r10b source/provenance changed');
  const manifest = JSON.parse(readFileSync(join(root, 'fixtures/r10b/modules.json'))), module = manifest.modules.find(row => row.namespace === 'base');
  const entry = module.bodies.find(row => row.partId === 'ZtoDD'), bytes = readFileSync(join(root, p10Path));
  assert.equal(manifest.sourceSha256, report.frozenSource.actual.sha256);
  assert.equal(entry.sha256, p10Hash); assert.equal(hash(bytes), p10Hash, 'Frozen P10 input changed');
  const kernel = await loadKernel(), F = await loadFaceClassifier(), source = JSON.parse(bytes).bodies[0];
  const imported = importOnshapeBody(kernel, source, 'P10', { document: manifest.document, element: module.element,
    microversion: module.microversion, sha256: p10Hash, source: p10Path });
  const body = transformAnalytic(kernel, imported, 'g0', rows, offset, { source: { file: 'fixtures/r10b/r10b.fs',
    sha256: report.frozenSource.actual.sha256, span: { line: 215, column: 1 } } });
  const native = encodeAnalytic(body), edges = array(native.edges), vertices = array(native.vertices);
  const points = [{ id: 'p10-g0.remote-positive', pointMm: [500,500,500] }, { id: 'p10-g0.remote-negative', pointMm: [-500,-500,-500] }];
  for (const edge of [248, 254]) {
    const e = edges[edge], domain = F.auto_domain(e, vertices[e.start], vertices[e.end]);
    assert.equal(domain.$, 'Some');
    const t = body.edges[edge].curveRange ? real(body.edges[edge].curveRange.reduce((a,b) => a+b) / 2)
      : domain.value.$ === 'Interval' ? kernel.real.div(kernel.real.add(domain.value.first, domain.value.last), real(2)) : real(.7);
    points.push({ id: `p10-g0.edge-${edge}`, pointMm: coords(kernel.analytic.curve_point(e.curve, t)), selection: { edge } });
  }
  const face = body.faces[0], faceVertices = [...new Set(face.loops.flat().map(use => use.forward ? body.edges[use.edge].start : body.edges[use.edge].end))];
  const center = kernel.precise.scale(faceVertices.reduce((sum, i) => kernel.precise.add(sum, vertices[i]), vector([0,0,0])), real(1 / faceVertices.length));
  for (const distanceMm of [-1, 0, 1]) points.push({ id: `p10-g0.face-0-offset-${distanceMm}`,
    pointMm: coords(kernel.precise.add(center, kernel.precise.scale(vector(face.surface.normal), real(distanceMm)))),
    selection: { face: 0, method: 'Mean of referenced vertices, offset along the face normal; all calculations in Bend', distanceMm } });
  points.push({ id: 'p10-g0.source-vertex-0', pointMm: body.vertices[0], selection: { vertex: 0 } });
  const { version } = JSON.parse(readFileSync(join(root, 'bend.lock.json')));
  const model = { schema: 'wonky-brep/1', units: 'millimeter', backend: { language: 'Bend', version, target: 'JavaScript', precision: precisionForBodies([body]) }, bodies: [body] };
  report.p10Placement = { source: 'fixtures/r10b/r10b.fs', line: 215, sourceLine: frozen.toString('utf8').split('\n')[214], rows, offsetMm: offset,
    scope: 'Fresh frozen P10 import and the actual g0 placement only; no r10b Boolean result or completed assembly is claimed' };
  cases.push(exportCase('p10-g0', model, [sourceFile(p10Path), sourceFile('fixtures/r10b/r10b.fs'), sourceFile('fixtures/r10b/modules.json')], points));
  return cases;
}

export function compareObservations(points) {
  const counts = { matched: 0, mismatch: 0, unresolved: 0, oracleUnknown: 0, error: 0 };
  const results = points.map(point => {
    if (!['Inside', 'Outside', 'Boundary', 'Unknown'].includes(point.oracleState)) throw new Error('Missing or invalid STEP observation');
    const outcome = point.bend.$ === 'Unresolved' ? 'unresolved' : point.bend.$ === 'Error' ? 'error'
      : point.oracleState === 'Unknown' ? 'oracleUnknown'
      : ['Inside', 'Outside', 'Boundary'].includes(point.bend.$) ? point.bend.$ === point.oracleState ? 'matched' : 'mismatch' : 'error';
    counts[outcome]++; return { ...point, outcome };
  });
  const accepted = points.length > 0 && counts.matched === points.length;
  return { accepted, status: accepted ? 'passed' : counts.mismatch || counts.error ? 'failed' : 'incomplete', counts, points: results };
}

function oracle(command) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command[0], command.slice(1), { cwd: root });
    let stdout = '', stderr = '';
    child.stdout.on('data', data => { stdout += data; }); child.stderr.on('data', data => { stderr += data; });
    child.on('error', reject);
    child.on('close', code => { writeFileSync(join(out, 'step-oracle.log'), stdout + stderr);
      if (code !== 0) reject(new Error(`Independent STEP validator exited ${code}; see step-oracle.log`));
      else { try { resolvePromise(JSON.parse(stdout)); } catch (error) { reject(error); } }
    });
  });
}

export async function runSolidClassificationValidation() {
  mkdirSync(out, { recursive: true });
  const before = implementationSnapshot(), report = { schema: 'wonky-solid-classification-validation/1', accepted: false, status: 'running',
    startedAt: new Date().toISOString(), options, scope: 'Deterministic probes against independently read exported STEP; Unresolved is never a geometric match or pass',
    implementation: { before }, models: [] };
  try {
    const cases = await buildCases(report), probeFile = join(out, 'probes.json');
    const probes = { schema: 'wonky-solid-probes/1', toleranceMm: options.linear,
      models: cases.map(({ prefix, record }) => ({ prefix: relative(root, prefix), points: record.points })) };
    json(probeFile, probes); report.probes = sourceFile(relative(root, probeFile));
    const command = ['uv', 'run', 'scripts/validate-step.py', '--points', relative(root, probeFile), ...cases.map(row => relative(root, row.prefix))];
    report.oracleCommand = command;
    const observations = await oracle(command);
    assert.equal(observations.length, cases.length);
    json(join(out, 'step-oracle.json'), observations);
    for (const { model, record } of cases) {
      const validation = observations.find(item => item.file === record.prefix + '.step');
      assert.equal(validation?.valid, true); assert.equal(validation.solids, 1);
      const observed = validation.pointClassification;
      assert.equal(observed.brepSha256, record.brepSha256); assert.equal(observed.stepSha256, record.stepSha256);
      assert.equal(observed.probesSha256, report.probes.sha256); assert.equal(observed.points.length, record.points.length);
      const observedById = new Map(observed.points.map(point => [point.id, point]));
      assert.equal(observedById.size, record.points.length);
      const points = [];
      for (const point of record.points) {
        const expected = observedById.get(point.id); assert.deepEqual(expected?.pointMm, point.pointMm);
        let bend;
        try { bend = await classifySolid(model.bodies[0], point.pointMm, options); }
        catch (error) { bend = { $: 'Error', name: error.name, message: error.message }; }
        points.push({ ...point, bend, oracleState: expected.state, oraclePerSolid: expected.perSolid });
      }
      assert.equal(hash(JSON.stringify(model, null, 2) + '\n'), record.brepSha256, 'Classification mutated its input model');
      const result = { ...record, stepValidation: validation, ...compareObservations(points) };
      report.models.push(result);
      console.error(`${record.id}: ${result.status}; ${JSON.stringify(result.counts)}`);
    }
    const compared = compareObservations(report.models.flatMap(model => model.points));
    report.accepted = compared.accepted; report.status = compared.status; report.counts = compared.counts;
    const selected = compared.points.find(point => point.outcome === 'matched');
    assert.ok(selected, 'Negative control requires one independently confirmed result');
    const incorrect = structuredClone(selected); incorrect.bend.$ = selected.oracleState === 'Inside' ? 'Outside' : 'Inside';
    const rejected = compareObservations([incorrect]);
    assert.equal(rejected.accepted, false); assert.equal(rejected.counts.mismatch, 1); assert.equal(rejected.status, 'failed');
    report.negativeControl = { passed: true, method: 'One actual resolved Bend result is deliberately replaced by the wrong state and passed through the same comparator',
      original: selected, rejected };
  } catch (error) { report.status = 'error'; report.accepted = false; report.error = { name: error.name, message: error.message }; }
  report.implementation.after = implementationSnapshot();
  report.implementation.stable = before.sha256 === report.implementation.after.sha256;
  if (!report.implementation.stable) { report.accepted = false; report.status = 'error'; report.sourceChange = 'Relevant input or implementation bytes changed during the run'; }
  report.finishedAt = new Date().toISOString();
  json(join(out, 'report.json'), report);
  const lines = ['# Solid classification versus exported STEP', '', `Status: ${report.status}; all probes accepted: ${report.accepted}`, '',
    `Implementation SHA-256: ${before.sha256}; stable during run: ${report.implementation.stable}`,
    `Kernel SHA-256: ${before.kernelSha256}`, '',
    '| Model | Match | Mismatch | Unresolved | Oracle unknown | Error |', '|---|---:|---:|---:|---:|---:|',
    ...report.models.map(model => `| ${model.id} | ${Object.values(model.counts).join(' | ')} |`), '',
    `Negative control rejected the intentionally wrong result: ${report.negativeControl?.passed ?? false}`, '',
    'Unresolved probes are incomplete evidence. This is not full r10b acceptance or a Boolean construction proof.', '',
    ...report.models.flatMap(model => model.points.filter(point => point.outcome !== 'matched').map(point => `- ${point.id}: ${point.outcome}; Bend ${JSON.stringify(point.bend)}, STEP ${point.oracleState}`)),
    ...(report.error ? [`Error: ${report.error.message}`] : [])];
  writeFileSync(join(out, 'report.md'), lines.join('\n') + '\n');
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--help')) console.log('Usage: node scripts/check-solid-classification.mjs\nWrites only out/solid-classification-validation/. Exit 0: all probes match; 2: unresolved evidence; 1: mismatch or execution/input failure.');
  else if (process.argv.length > 2) { console.error('Unexpected arguments; use --help'); process.exitCode = 1; }
  else {
    const report = await runSolidClassificationValidation();
    console.log(JSON.stringify({ status: report.status, accepted: report.accepted, counts: report.counts, error: report.error, report: relative(root, join(out, 'report.json')) }));
    process.exitCode = report.accepted ? 0 : report.status === 'incomplete' ? 2 : 1;
  }
}
