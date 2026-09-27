#!/usr/bin/env node
// The real r10b build is a required gate. Its known failure is never a pass.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { build } from '../src/index.mjs';
import { Interpreter } from '../src/interpreter.mjs';
import { parse } from '../src/parser.mjs';
import { resolveTopology } from '../src/queries.mjs';
import { toStep } from '../src/exporters.mjs';
import { Id } from '../src/values.mjs';
import { normalizeModelingPolicy } from '../src/modeling-policy.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const fixture = 'fixtures/r10b/r10b.fs';
const targetFeature = 'singleStepR10b';
const frozenSha256 = '219ee9630f37f9e54fe7e1b4e09094ab25748a811ed8f9e8b9ebf4892d8b8349';
const hash = data => createHash('sha256').update(data).digest('hex');
const location = loc => loc ? { line: loc.line, column: loc.column } : null;
const siteKey = (name, loc) => `${name}:${loc?.line}:${loc?.column}`;
const geometryCall = name => /^(?:op[A-Z]|sk[A-Z]|ev[A-Z]|f[A-Z])/.test(name) ||
  ['newSketchOnPlane', 'newInstantiator', 'addInstance', 'instantiate'].includes(name) || /::build$/.test(name);
const json = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n');

export function verifyFrozenSource(data, provenance) {
  const actual = { sha256: hash(data), bytes: data.length, lines: data.toString('utf8').split('\n').length - 1 };
  const expected = { sha256: provenance.sha256, bytes: provenance.bytes, lines: provenance.lines };
  return { path: fixture, expected, actual, passed: provenance.sha256 === frozenSha256 &&
    Object.keys(expected).every(key => expected[key] === actual[key]) };
}

function walk(node, visit, guards = []) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) { for (const child of node) walk(child, visit, guards); return; }
  visit(node, guards);
  for (const [key, child] of Object.entries(node)) {
    if (key === 'loc') continue;
    const guarded = (node.kind === 'if' && ['yes', 'no'].includes(key)) ||
      (['for', 'forC', 'while'].includes(node.kind) && key === 'body');
    walk(child, visit, guarded ? [...guards, { kind: node.kind, branch: key, ...location(node.loc) }] : guards);
  }
}

export function inventorySource(source, feature = targetFeature) {
  const program = parse(source);
  const functions = program.declarations.flatMap(declaration => {
    const ast = declaration.value?.kind === 'function' ? declaration.value :
      declaration.value?.kind === 'call' && declaration.value.callee.name === 'defineFeature' ?
        declaration.value.args.find(arg => arg.kind === 'function') : null;
    if (!ast) return [];
    const calls = [];
    walk(ast, (node, guards) => {
      if (node.kind === 'call') calls.push({ name: node.callee.kind === 'name' ? node.callee.name : null,
        calleeKind: node.callee.kind, ...location(node.loc), guards });
    });
    return [{ name: declaration.name, exported: declaration.exported, ...location(ast.loc), calls, ast }];
  });
  const byName = new Map(functions.map(fn => [fn.name, fn]));
  if (!byName.has(feature)) throw new Error(`Missing acceptance feature '${feature}'`);
  const reachable = new Set([feature]);
  for (const name of reachable) for (const call of byName.get(name).calls)
    if (byName.has(call.name)) reachable.add(call.name);
  const stages = byName.get(feature).ast.body.statements.flatMap(statement => {
    const call = statement.kind === 'expression' ? statement.value : null;
    return call?.kind === 'call' && byName.has(call.callee.name) ?
      [{ name: call.callee.name, ...location(call.loc) }] : [];
  });
  const calls = functions.flatMap(fn => fn.calls.map(call => ({ ...call, helper: fn.name, reachable: reachable.has(fn.name) })));
  return {
    schema: 'wonky-acceptance-inventory/1', feature, sourceSha256: hash(source), version: program.version,
    method: 'AST named-call reachability, including conditional branches; no execution or loop expansion is inferred',
    runtimeInvocationTotalExpected: null,
    runtimeInvocationTotalReason: 'Branches and loops depend on parameters, geometry and query results; static call-site counts are not invocation counts.',
    stages,
    functions: functions.map(({ ast, calls, ...fn }) => ({ ...fn, reachable: reachable.has(fn.name),
      localCallees: [...new Set(calls.filter(call => byName.has(call.name)).map(call => call.name))] })),
    operationCallSites: calls.filter(call => call.name && geometryCall(call.name)),
    otherReachableLibraryCalls: [...new Set(calls.filter(call => call.reachable && call.name &&
      !byName.has(call.name) && !geometryCall(call.name)).map(call => call.name))].sort(),
    unresolvedCallees: calls.filter(call => call.reachable && !call.name),
    imports: program.imports.map(spec => ({ ...spec, calledByReachableFunctions: spec.namespace ?
      calls.filter(call => call.reachable && call.name?.startsWith(spec.namespace + '::')).map(({ helper, name, line, column }) => ({ helper, name, line, column })) : null })),
  };
}

const counts = values => values.reduce((out, value) => { out[value] = (out[value] ?? 0) + 1; return out; }, {});
function bodySummary(body) {
  return { id: body.id, name: body.name ?? null, geometry: body.geometry ?? 'planar B-rep',
    primitive: body.primitive?.type ?? null, precision: body.precision ?? 'F32',
    vertices: body.vertices.length, edges: body.edges.length, faces: body.faces.length,
    surfaceTypes: counts(body.faces.map(face => face.surface.type)),
    curveTypes: counts(body.edges.map(edge => typeof edge.curve === 'string' ? edge.curve : edge.curve.type)),
    faceBoundaryLoops: body.faces.reduce((sum, face) => sum + face.loops.length, 0),
    validation: body.validation, provenance: body.provenance ?? null };
}

function errorSummary(error, fallback, source) {
  const line = error.line ?? fallback?.line ?? null, column = error.column ?? fallback?.column ?? null;
  return { name: error.name, message: error.message, line, column,
    sourceLine: line ? source.split('\n')[line - 1] : null };
}

// Observe the same build() used by the CLI. Wrappers are scoped to this one
// serial build, restored in finally, and never catch an error on the model's behalf.
// Expression observation also records absent builtins, before name resolution fails.
export async function traceBuild(source, options, inventory = inventorySource(source, options.feature)) {
  const originalExpression = Interpreter.prototype.expression, originalCall = Interpreter.prototype.call;
  const frames = [], events = [], failures = new Map(), helpers = new Set(inventory.functions.map(fn => fn.name));
  const stages = new Set(inventory.stages.map(stage => siteKey(stage.name, stage)));
  Interpreter.prototype.expression = function (node, env) {
    if (node.kind !== 'call' || node.callee.kind !== 'name') return originalExpression.call(this, node, env);
    const frame = { name: node.callee.name, ...location(node.loc) };
    const selected = geometryCall(frame.name) || stages.has(siteKey(frame.name, frame));
    const event = selected ? { sequence: events.length + 1, ...frame,
      kind: stages.has(siteKey(frame.name, frame)) ? 'required-stage' : 'operation', status: 'started',
      callPath: frames.filter(parent => helpers.has(parent.name)).map(({ name, line, column }) => ({ name, line, column })) } : null;
    if (event) events.push(event);
    frames.push({ ...frame, event });
    try {
      const result = originalExpression.call(this, node, env);
      if (event) event.status = 'completed';
      return result;
    } catch (error) {
      if (event) {
        event.status = 'failed'; event.error = errorSummary(error, frame, source);
        if (!failures.has(error)) failures.set(error, event);
      }
      throw error;
    } finally { frames.pop(); }
  };
  Interpreter.prototype.call = function (fn, args, loc) {
    const event = frames.at(-1)?.event;
    if (fn?.type === 'builtin' && event && event.name === fn.name) {
      const engine = args[0]?.engine;
      if (engine) event.solidBodiesBefore = [...engine.records.values()].filter(record => record.kind === 'solid').length;
      if (args[1] instanceof Id) event.operationId = String(args[1]);
      if (fn.name === 'opBoolean') {
        event.operationType = args[2]?.operationType?.name ?? null;
        try {
          const inputs = ['targets', 'tools'].flatMap(role => args[2][role] === undefined ? [] :
            resolveTopology(engine, args[2][role], loc).map(row => ({ role, body: row.record.body })));
          event.inputs = inputs.map(({ role, body }) => ({ role, ...bodySummary(body) }));
          // Nonenumerable: full geometry goes only in the separate diagnostic artifact.
          Object.defineProperty(event, 'operandBodies', { value: inputs });
        } catch (error) { event.inputInspectionError = errorSummary(error, loc, source); }
      }
      const result = originalCall.call(this, fn, args, loc);
      if (engine) event.solidBodiesAfter = [...engine.records.values()].filter(record => record.kind === 'solid').length;
      return result;
    }
    return originalCall.call(this, fn, args, loc);
  };
  try {
    const model = await build(source, options);
    return { model, error: null, events, firstFailure: null, failedOperands: null,
      completedOperationEvidence: model.operationEvidence };
  } catch (error) {
    const firstFailure = failures.get(error) ?? null;
    const failedOperands = firstFailure?.operandBodies ? { operation: firstFailure.operationType, operationId: firstFailure.operationId,
      location: location(firstFailure), callPath: firstFailure.callPath, bodies: firstFailure.operandBodies } : null;
    return { model: null, error: errorSummary(error, firstFailure, source), events, firstFailure, failedOperands,
      completedOperationEvidence: error.completedOperationEvidence ?? [] };
  } finally {
    Interpreter.prototype.expression = originalExpression; Interpreter.prototype.call = originalCall;
  }
}

export function operationProgress(inventory, events) {
  const sites = inventory.operationCallSites.filter(call => call.reachable);
  return [...new Set(sites.map(call => call.name))].sort().map(name => {
    const runtime = events.filter(event => event.kind === 'operation' && event.name === name);
    return { name, reachableStaticCallSites: sites.filter(call => call.name === name).map(({ helper, line, column, guards }) => ({ helper, line, column, guards })),
      runtimeAttempts: runtime.length, runtimeCompleted: runtime.filter(event => event.status === 'completed').length,
      runtimeFailed: runtime.filter(event => event.status === 'failed').length,
      status: runtime.some(event => event.status === 'failed') ? 'failed' : runtime.length ? 'observed-completed-calls' : 'not-reached' };
  });
}

function implementationSnapshot() {
  const files = ['bend.lock.json', 'PROOF.bend', 'package.json', 'bin/wonky.mjs', 'scripts/check-acceptance.mjs', 'scripts/validate-step.py'];
  const collect = directory => {
    for (const item of readdirSync(join(root, directory), { withFileTypes: true })) {
      const path = join(directory, item.name);
      if (item.isDirectory()) collect(path);
      else if (/\.(?:mjs|bend|fs|json)$/.test(path)) files.push(path);
    }
  };
  for (const directory of ['src', 'kernel', 'examples', 'fixtures/r10b']) collect(directory);
  const sources = [...new Set(files)].sort().map(path => ({ path, sha256: hash(readFileSync(join(root, path))) }));
  return { sha256: hash(JSON.stringify(sources)), files: sources };
}

function verifyDependencies(source, inventory) {
  const manifestPath = join(root, 'fixtures/r10b/modules.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const files = manifest.modules.flatMap(module => [
    { path: `modules/${module.namespace}/parts.json`, expectedSha256: module.partsSha256 },
    ...module.bodies.map(body => ({ path: body.file, expectedSha256: body.sha256 })),
  ]).map(file => {
    const fullPath = resolve(dirname(manifestPath), file.path);
    if (!fullPath.startsWith(dirname(manifestPath) + '/')) throw new Error('Frozen input path escapes its manifest directory');
    const actualSha256 = hash(readFileSync(fullPath));
    return { ...file, actualSha256, passed: actualSha256 === file.expectedSha256 };
  });
  const revisionsMatch = inventory.imports.filter(spec => spec.namespace).every(spec =>
    manifest.modules.some(module => module.namespace === spec.namespace && module.element === spec.path && module.microversion === spec.version));
  return { manifest: relative(root, manifestPath), manifestSha256: hash(readFileSync(manifestPath)), files,
    capturedBodyCount: manifest.modules.reduce((sum, module) => sum + module.bodies.length, 0),
    passed: manifest.schema === 'wonky-onshape-inputs/1' && manifest.sourceSha256 === hash(source) && revisionsMatch && files.every(file => file.passed) };
}

const referenceCases = [
  { name: 'box', path: 'examples/box.fs', expected: { bodies: 1, volumeMm3: 4000 } },
  { name: 'bracket', path: 'examples/bracket.fs', expected: { bodies: 1, volumeMm3: 8832 } },
  { name: 'conical-spacer', path: 'examples/conical-spacer.fs', expected: { bodies: 1, volumeMm3: 448 * Math.PI } },
  { name: 'bored-spacer', path: 'examples/bored-spacer.fs', expected: { bodies: 1, volumeMm3: 210 * Math.PI } },
  { name: 'r10b-retained', path: fixture, feature: 'r10bRetainedContext', expected: { bodies: 5, sourceFaceAreaValidation: true } },
];

function exportModel(model, prefix) {
  if (!model.bodies.length || model.bodies.some(body => !body.validation?.closed)) throw new Error('Model does not contain only validated closed bodies');
  const step = toStep(model, prefix.split('/').at(-1));
  json(prefix + '.brep.json', model); writeFileSync(prefix + '.step', step);
}

export async function runAcceptance({ out = join(root, 'out/acceptance'), modelingPolicy: requestedPolicy } = {}) {
  const modelingPolicy = normalizeModelingPolicy(requestedPolicy);
  out = resolve(out); mkdirSync(out, { recursive: true });
  const report = { schema: 'wonky-acceptance/1', accepted: false, startedAt: new Date().toISOString(),
    modelingPolicy,
    scope: 'Default singleStepR10b evaluation and independent STEP validation, with successful reference models; not proof of general CAD-kernel completeness or Onshape result equivalence.',
    environment: { node: process.version, platform: process.platform, arch: process.arch },
    references: [], target: { feature: targetFeature, status: 'not-run', completed: false },
    stepValidation: { status: 'not-run' } };
  const prefixes = [];
  for (const name of [...referenceCases.map(item => item.name), targetFeature])
    for (const extension of ['brep.json', 'step']) rmSync(join(out, `${name}.${extension}`), { force: true });
  for (const name of ['first-failure-operands.json', 'completed-operation-evidence.json', 'step-validation.json', 'step-validation.log', 'inventory.json']) rmSync(join(out, name), { force: true });
  try {
    report.implementation = implementationSnapshot();
    const sourceData = readFileSync(join(root, fixture)), source = sourceData.toString('utf8');
    report.frozenSource = verifyFrozenSource(sourceData, JSON.parse(readFileSync(join(root, 'fixtures/r10b/provenance.json'), 'utf8')));
    if (!report.frozenSource.passed) throw new Error('Frozen r10b source hash, byte count or line count changed');
    const inventory = inventorySource(source);
    json(join(out, 'inventory.json'), inventory); report.inventory = 'inventory.json';
    report.frozenInputs = verifyDependencies(source, inventory);
    if (!report.frozenInputs.passed) throw new Error('Frozen module source binding, revision or file hash changed');
    const moduleManifest = join(root, 'fixtures/r10b/modules.json');
    for (const item of referenceCases) {
      const row = { ...item, status: 'failed', stepValidation: 'not-run' }; report.references.push(row);
      try {
        const text = readFileSync(join(root, item.path), 'utf8');
        row.sourceSha256 = hash(text);
        const model = await build(text, { feature: item.feature, moduleManifest: item.path === fixture ? moduleManifest : undefined, modelingPolicy });
        row.actual = { bodies: model.bodies.length, volumeMm3: model.bodies.every(body => body.validation.volumeMm3 !== null) ?
          model.bodies.reduce((sum, body) => sum + body.validation.volumeMm3, 0) : null };
        if (row.actual.bodies !== item.expected.bodies) throw new Error('Reference body count differs');
        if (item.expected.volumeMm3 !== undefined && (!Number.isFinite(row.actual.volumeMm3) ||
          Math.abs(row.actual.volumeMm3 - item.expected.volumeMm3) > 2e-5 * item.expected.volumeMm3)) throw new Error('Reference volume differs');
        if (item.expected.sourceFaceAreaValidation && model.bodies.some(body => body.referenceMeasurements?.faceAreasMm2?.length !== body.faces.length))
          throw new Error('Retained input lacks complete source face-area references');
        const prefix = join(out, item.name); exportModel(model, prefix); prefixes.push(prefix);
        row.status = 'built-and-exported'; row.exports = [`${item.name}.brep.json`, `${item.name}.step`];
      } catch (error) { row.error = errorSummary(error, null, ''); }
    }
    const target = await traceBuild(source, { feature: targetFeature, moduleManifest, modelingPolicy }, inventory);
    report.target = { feature: targetFeature, status: target.error ? 'failed' : 'built', completed: false,
      error: target.error, firstFailure: target.firstFailure,
      expectedStages: inventory.stages.length,
      stages: inventory.stages.map(stage => ({ ...stage, status: target.events.find(event => event.kind === 'required-stage' &&
        siteKey(event.name, event) === siteKey(stage.name, stage))?.status ?? 'not-reached' })),
      operations: operationProgress(inventory, target.events), runtimeInvocationTotalExpected: null, events: target.events };
    report.target.completedStages = report.target.stages.filter(stage => stage.status === 'completed').length;
    const operationEvents = target.events.filter(event => event.kind === 'operation');
    report.target.runtimeOperations = { attempted: operationEvents.length,
      completed: operationEvents.filter(event => event.status === 'completed').length,
      failed: operationEvents.filter(event => event.status === 'failed').length };
    if (target.completedOperationEvidence.length) {
      json(join(out, 'completed-operation-evidence.json'), { schema: 'wonky-completed-operation-evidence/1',
        sourceSha256: hash(source), modelingPolicy,
        purpose: 'Recorded native operation evidence; this artifact does not establish a completed singleStepR10b model.',
        operationEvidence: target.completedOperationEvidence });
      report.target.completedOperationEvidence = 'completed-operation-evidence.json';
      report.target.completedOperationEvidenceCount = target.completedOperationEvidence.length;
    }
    if (target.failedOperands) {
      json(join(out, 'first-failure-operands.json'), { schema: 'wonky-acceptance-operands/1', sourceSha256: hash(source),
        purpose: 'Exact inputs to the first failed operation; these are not a completed singleStepR10b model.', ...target.failedOperands });
      report.target.firstFailureOperands = 'first-failure-operands.json';
    }
    if (target.model) {
      report.target.operationEvidence = target.model.operationEvidence;
      try {
        const prefix = join(out, targetFeature); exportModel(target.model, prefix); prefixes.push(prefix);
        report.target.status = 'built-and-exported'; report.target.bodies = target.model.bodies.length;
        report.target.exports = [`${targetFeature}.brep.json`, `${targetFeature}.step`];
      } catch (error) { report.target.status = 'failed'; report.target.error = errorSummary(error, null, source); }
    }
    if (prefixes.length) {
      const command = ['uv', 'run', 'scripts/validate-step.py', ...prefixes];
      const result = spawnSync(command[0], command.slice(1), { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
      writeFileSync(join(out, 'step-validation.log'), (result.stdout ?? '') + (result.stderr ?? '') + (result.error ? String(result.error) : ''));
      report.stepValidation = { status: 'failed', command, exitCode: result.status, signal: result.signal, log: 'step-validation.log' };
      if (result.status === 0 && !result.error) {
        const validated = JSON.parse(result.stdout);
        if (!Array.isArray(validated) || validated.length !== prefixes.length ||
          prefixes.some(prefix => !validated.some(row => row.file === prefix + '.step' && row.valid === true))) throw new Error('STEP validator did not report every requested export');
        json(join(out, 'step-validation.json'), validated);
        report.stepValidation.status = 'passed'; report.stepValidation.report = 'step-validation.json';
        for (const row of report.references) if (row.status === 'built-and-exported') { row.status = 'passed'; row.stepValidation = 'passed'; }
        if (report.target.status === 'built-and-exported' && report.target.completedStages === report.target.expectedStages) {
          report.target.status = 'passed'; report.target.completed = true;
        }
      }
    }
  } catch (error) { report.error = errorSummary(error, null, ''); }
  try {
    const after = implementationSnapshot();
    report.implementationStable = report.implementation?.sha256 === after.sha256;
    if (!report.implementationStable) report.implementationAfter = after;
  } catch (error) { report.implementationStable = false; report.finalSnapshotError = error.message; }
  report.accepted = !report.error && report.implementationStable && report.frozenSource?.passed && report.frozenInputs?.passed &&
    report.references.length === referenceCases.length && report.references.every(row => row.status === 'passed') &&
    report.target.completed && report.target.status === 'passed' && report.stepValidation.status === 'passed';
  report.finishedAt = new Date().toISOString();
  json(join(out, 'report.json'), report);
  return report;
}

export function acceptanceOptions(args) {
  let out = join(root, 'out/acceptance'), curvedContacts, contactCapMm;
  const value = (i, flag) => {
    if (!args[i+1] || args[i+1].startsWith('--')) throw new Error(`${flag} requires a value`);
    return args[i+1];
  };
  for (let i=0; i<args.length; i++) {
    const arg = args[i];
    if (arg === '--out') { out = resolve(value(i, arg)); i++; }
    else if (arg === '--curved-contacts') { curvedContacts = value(i, arg); i++; }
    else if (arg === '--contact-cap-mm') { contactCapMm = Number(value(i, arg)); i++; }
    else throw new Error(`Unknown acceptance option '${arg}'; use --help`);
  }
  if (contactCapMm !== undefined && curvedContacts !== 'tolerated-regularized') throw new Error('--contact-cap-mm requires --curved-contacts tolerated-regularized');
  const modelingPolicy = normalizeModelingPolicy({ curvedContacts: curvedContacts ?? 'strict',
    ...(contactCapMm !== undefined ? { contactCapMm } : {}) });
  return { out, modelingPolicy };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.length === 1 && args[0] === '--help') {
      console.log('Usage: node scripts/check-acceptance.mjs [--out <directory>] [--curved-contacts strict|tolerated-regularized] [--contact-cap-mm <number>]\nDefault policy is strict. tolerated-regularized requires an explicit nonnegative finite contact cap in mm.\nRuns frozen-input checks, reference exports, full singleStepR10b and independent STEP validation.\nExit 0 requires all gates to pass. A known r10b capability failure exits 1.');
    } else {
      const options = acceptanceOptions(args), out = options.out;
      const report = await runAcceptance(options);
      console.log(`Acceptance ${report.accepted ? 'PASSED' : 'FAILED'}; reference models ${report.references.filter(row => row.status === 'passed').length}/${referenceCases.length}; r10b stages ${report.target.completedStages ?? 0}/${report.target.expectedStages ?? '?'}.`);
      if (report.target.error) console.error(`${fixture}:${report.target.error.line ?? '?'}:${report.target.error.column ?? '?'}: ${report.target.error.name}: ${report.target.error.message}`);
      if (report.error) console.error(report.error.message);
      console.log(join(out, 'report.json'));
      process.exitCode = report.accepted ? 0 : 1;
    }
  } catch (error) { console.error(`Acceptance runner: ${error.message}`); process.exitCode = 1; }
}
