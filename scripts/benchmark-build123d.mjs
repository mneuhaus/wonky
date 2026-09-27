import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { arch, cpus, freemem, loadavg, platform, release, totalmem } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { performance } from 'node:perf_hooks';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const script = fileURLToPath(import.meta.url);
const fixtures = join(root, 'fixtures/performance-build123d');
const defaultPython = join(root, 'out/build123d-performance/reference-venv/bin/python');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = (path, value) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, JSON.stringify(value, null, 2) + '\n'); };
const errorRecord = error => ({ name: error.name, message: error.message, stack: error.stack });
const elapsed = start => performance.now() - start;

export function timingStatistics(values) {
  if (!values.length || values.some(value => !Number.isFinite(value) || value < 0)) throw new Error('Expected finite nonnegative timing samples');
  const sorted = [...values].sort((a, b) => a - b);
  const percentile = fraction => {
    const at = (sorted.length - 1) * fraction, low = Math.floor(at), high = Math.ceil(at);
    return sorted[low] + (sorted[high] - sorted[low]) * (at - low);
  };
  return { samples: values.length, medianMs: percentile(0.5), p25Ms: percentile(0.25), p75Ms: percentile(0.75),
    minMs: sorted[0], maxMs: sorted.at(-1), rawMs: [...values] };
}

function fixturePath(path, base = fixtures) {
  const result = resolve(base, path), distance = relative(base, result);
  if (!distance || distance.startsWith('..' + sep) || distance === '..' || resolve(result) === resolve(base))
    throw new Error(`Invalid fixture path: ${path}`);
  return result;
}

export function verifyPerformanceFixtures(base = fixtures) {
  const manifest = JSON.parse(readFileSync(join(base, 'manifest.json')));
  if (manifest.schema !== 'wonky-build123d-performance-fixtures/1' || !manifest.cases?.length) throw new Error('Unsupported performance fixture manifest');
  if (new Set(manifest.cases.map(row => row.id)).size !== manifest.cases.length) throw new Error('Duplicate performance fixture id');
  for (const row of manifest.cases) {
    if (!/^[a-z][a-z0-9-]+$/.test(row.id) || !['candidate', 'capability-probe'].includes(row.eligibility)) throw new Error('Invalid performance case');
    if (row.eligibility === 'candidate' && (!row.expected?.probes?.length || !row.expected.boundsMm || !Number.isFinite(row.expected.volumeMm3)))
      throw new Error(`Missing independent expected geometry: ${row.id}`);
  }
  for (const file of [...manifest.files, ...manifest.cases.map(row => ({ path: row.source, sha256: row.sourceSha256 }))])
    if (hash(readFileSync(fixturePath(file.path, base))) !== file.sha256) throw new Error(`Performance fixture SHA-256 mismatch: ${file.path}`);
  return manifest;
}

export function checkGeometryAgreement(actual, expected, tolerances, { probes = false, bounds = true } = {}) {
  const near = (value, reference, absolute, relativeTolerance, label) => {
    if (!Number.isFinite(value) || Math.abs(value - reference) > Math.max(absolute, Math.abs(reference) * relativeTolerance))
      throw new Error(`${label}: ${value} differs from ${reference}`);
  };
  if (actual.solids !== expected.solids) throw new Error(`Solid count: ${actual.solids} differs from ${expected.solids}`);
  near(actual.volumeMm3, expected.volumeMm3, tolerances.volumeAbsoluteMm3, tolerances.volumeRelative, 'Volume (mm³)');
  if (bounds) for (const side of ['min', 'max']) for (let axis = 0; axis < 3; axis++)
    near(actual.boundsMm?.[side]?.[axis], expected.boundsMm[side][axis], tolerances.boundsAbsoluteMm, 0, `Bounds ${side}[${axis}] (mm)`);
  if (probes) {
    if (actual.probes?.length !== expected.probes.length || new Set(actual.probes.map(point => point.id)).size !== expected.probes.length)
      throw new Error('Incomplete or duplicate point observations');
    for (const point of expected.probes)
      if (actual.probes.find(observed => observed.id === point.id)?.state !== point.classification)
        throw new Error(`Point membership differs: ${point.id}`);
  }
  return true;
}

export function benchmarkOptions(args) {
  const options = { out: join(root, 'out/build123d-performance/current'), python: defaultPython,
    warmups: 3, rounds: 7, startupRounds: 3, coldRounds: 3, timeoutMs: 120000, checkOnly: false, caseIds: [] };
  const numbers = new Map([['--warmups', 'warmups'], ['--rounds', 'rounds'], ['--startup-rounds', 'startupRounds'], ['--cold-rounds', 'coldRounds'], ['--timeout-ms', 'timeoutMs']]);
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flag === '--check') options.checkOnly = true;
    else if (['--out', '--python', '--case', ...numbers.keys()].includes(flag)) {
      const value = args[++i];
      if (!value || value.startsWith('--')) throw new Error(`${flag} needs a value`);
      if (numbers.has(flag)) {
        if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) throw new Error(`${flag} requires a positive integer`);
        options[numbers.get(flag)] = Number(value);
      } else if (flag === '--case') options.caseIds.push(value);
      else options[flag.slice(2)] = resolve(value);
    } else throw new Error(`Unknown build123d performance option: ${flag}`);
  }
  if (options.rounds < 3 || options.startupRounds < 3 || options.coldRounds < 3) throw new Error('Timing populations require at least three measured rounds');
  return options;
}

function implementationSnapshot() {
  const walk = directory => readdirSync(join(root, directory), { withFileTypes: true }).flatMap(entry =>
    entry.isDirectory() ? (entry.name === '__pycache__' ? [] : walk(`${directory}/${entry.name}`)) : [`${directory}/${entry.name}`]);
  const files = ['bend.lock.json', 'package-lock.json', 'scripts/benchmark-build123d.mjs', 'scripts/benchmark-build123d-reference.py',
    'scripts/cadbench-build123d.mjs', 'scripts/validate-step.py', ...['src', 'kernel', 'python', 'fixtures/performance-build123d'].flatMap(walk)].sort();
  const entries = files.map(path => ({ path, sha256: hash(readFileSync(join(root, path))) }));
  return { sha256: hash(JSON.stringify(entries)), files: entries };
}

function verifyReferenceEnvironment(metadata) {
  const normalize = name => name.toLowerCase().replace(/[-_.]+/g, '-');
  const actual = new Map(Object.entries(metadata.packages).map(([name, version]) => [normalize(name), version]));
  const pins = readFileSync(join(fixtures, 'reference.lock'), 'utf8').split('\n').map(line => /^([a-zA-Z0-9_.-]+)==([^\s;]+)$/.exec(line)).filter(Boolean);
  for (const [, name, version] of pins)
    if (actual.get(normalize(name)) !== version) throw new Error(`Reference environment differs from lock: ${name} requires ${version}, installed ${actual.get(normalize(name)) ?? 'missing'}`);
  if (!metadata.pythonVersion.startsWith('3.13.')) throw new Error('The frozen reference lock targets Python 3.13');
  return { status: 'passed', pinnedPackages: pins.length, lockSha256: hash(readFileSync(join(fixtures, 'reference.lock'))) };
}

function hostSnapshot() {
  const processors = cpus();
  const command = (program, args) => {
    const result = spawnSync(program, args, { encoding: 'utf8', timeout: 5000 });
    return result.status === 0 ? result.stdout.trim() : null;
  };
  return { at: new Date().toISOString(), platform: platform(), release: release(), arch: arch(),
    cpuModel: processors[0]?.model, logicalCpus: processors.length, cpuTimes: processors.map(cpu => cpu.times),
    totalMemoryBytes: totalmem(), freeMemoryBytes: freemem(), loadAverage: loadavg(), nodeVersion: process.version,
    uvVersion: command('uv', ['--version']), gitRevision: command('git', ['-C', root, 'rev-parse', 'HEAD']),
    systemModel: platform() === 'darwin' ? command('sysctl', ['-n', 'hw.model']) : null,
    thermalStatus: platform() === 'darwin' ? command('pmset', ['-g', 'therm']) : null,
    cpuGovernor: 'Not controlled; OS power management and unrelated background activity remain possible.' };
}

function summarizeModel(model) {
  if (model.backend.language !== 'Bend' || model.bodies.some(body => !body.validation.closed)) throw new Error('Expected constructed, validated Bend solids');
  return { solids: model.bodies.length, volumeMm3: model.bodies.every(body => Number.isFinite(body.validation.volumeMm3)) ? model.bodies.reduce((sum, body) => sum + body.validation.volumeMm3, 0) : null,
    boundsMm: model.bodies.every(body => body.validation.boundsMm) ? {
      min: [0, 1, 2].map(axis => Math.min(...model.bodies.map(body => body.validation.boundsMm.min[axis]))),
      max: [0, 1, 2].map(axis => Math.max(...model.bodies.map(body => body.validation.boundsMm.max[axis]))),
    } : null,
    topology: { faces: model.bodies.reduce((sum, body) => sum + body.faces.length, 0),
      edges: model.bodies.reduce((sum, body) => sum + body.edges.length, 0), vertices: model.bodies.reduce((sum, body) => sum + body.vertices.length, 0) },
    requests: model.execution.requests, backend: model.backend, pythonVersion: model.source.pythonVersion };
}

async function bendWorker() {
  const workerStart = performance.now(), importStart = performance.now();
  const { buildPython } = await import('../src/python.mjs');
  const adapterImport = elapsed(importStart), kernelStart = performance.now();
  const { loadKernel } = await import('../src/kernel.mjs');
  const kernel = await loadKernel(), kernelLoad = elapsed(kernelStart), exportStart = performance.now();
  const { toStep } = await import('../src/exporters.mjs');
  const exporterImport = elapsed(exportStart);
  const { validateSolid } = await import('../src/brep.mjs');
  const { validateAnalytic } = await import('../src/analytic.mjs');
  const { classifyBuild123dFailure } = await import('./cadbench-build123d.mjs');
  const send = value => process.stdout.write('BENCH:' + JSON.stringify(value) + '\n');
  send({ type: 'ready', engine: 'wonky-shim-bend', nodeVersion: process.version,
    bend: JSON.parse(readFileSync(join(root, 'bend.lock.json'))).version, persistentCache: process.env.WONKY_BEND_CACHE !== '0',
    timingsMs: { adapterImport, kernelLoad, exporterImport, workerInitialization: elapsed(workerStart) } });
  for await (const line of createInterface({ input: process.stdin, crlfDelay: Infinity })) {
    const request = JSON.parse(line);
    if (request.action === 'exit') break;
    try {
      if (request.action !== 'run') throw new Error(`Unknown benchmark action: ${request.action}`);
      const source = readFileSync(request.sourcePath), sourceSha256 = hash(source);
      if (sourceSha256 !== request.sourceSha256) throw new Error(`Bend source SHA-256 mismatch: ${request.sourcePath}`);
      const start = performance.now();
      const model = await buildPython(source.toString('utf8'), { filename: request.sourcePath, python: request.python, timeoutMs: request.timeoutMs, trace: true });
      const build = elapsed(start), validationStart = performance.now();
      for (const body of model.bodies) body.geometry === 'analytic' ? validateAnalytic(body, kernel) : validateSolid(body);
      const nativeRevalidation = elapsed(validationStart), observationStart = performance.now();
      const actual = summarizeModel(model), observation = elapsed(observationStart);
      mkdirSync(dirname(request.prefix), { recursive: true });
      const exportStart = performance.now(), step = toStep(model, request.caseId);
      writeFileSync(request.prefix + '.step', step);
      const stepExportAndWrite = elapsed(exportStart);
      json(request.prefix + '.brep.json', model);
      send({ type: 'result', id: request.id, status: 'ok', sourceSha256, actual,
        timingsMs: { build, pythonCompile: null, sourceExecutionIncludingGeometry: null, geometryInterop: null,
          nativeRevalidation, observation, stepExportAndWrite },
        nativeValidation: 'Existing Wonky per-body validator; construction already performs required checks. Not equivalent to exact OCCT validity.',
        export: { path: request.prefix + '.step', bytes: Buffer.byteLength(step), sha256: hash(step) } });
    } catch (error) {
      const failure = { type: 'result', id: request.id, status: classifyBuild123dFailure(error), error: errorRecord(error), trace: error.modelTrace ?? null };
      json(request.prefix + '.failure.json', failure); send(failure);
    }
  }
}

async function startWorker(engine, options, log, { cache = true } = {}) {
  const start = performance.now();
  const command = engine === 'wonky' ? process.execPath : options.python;
  const args = engine === 'wonky' ? [script, '--worker'] : ['-I', '-B', '-u', join(root, 'scripts/benchmark-build123d-reference.py')];
  const child = spawn(command, args, { cwd: root, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, WONKY_BEND_CACHE: cache ? '1' : '0' } });
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity }), pending = new Map();
  let readyResolve, readyReject, nextId = 0, terminated = false;
  const ready = new Promise((resolveReady, rejectReady) => { readyResolve = resolveReady; readyReject = rejectReady; });
  const fail = error => { readyReject(error); for (const task of pending.values()) { clearTimeout(task.timer); task.reject(error); } pending.clear(); };
  const readyTimer = setTimeout(() => { fail(new Error(`${engine} worker startup exceeded ${options.timeoutMs} ms`)); child.kill('SIGKILL'); }, options.timeoutMs);
  child.stderr.on('data', data => appendFileSync(log, data));
  child.on('error', error => { clearTimeout(readyTimer); fail(error); });
  child.on('exit', (code, signal) => { clearTimeout(readyTimer); terminated = true; lines.close(); fail(new Error(`${engine} worker exited ${signal ?? code}`)); });
  lines.on('line', line => {
    if (!line.startsWith('BENCH:')) { appendFileSync(log, line + '\n'); return; }
    try {
      const message = JSON.parse(line.slice(6));
      if (message.type === 'ready') { clearTimeout(readyTimer); readyResolve({ ...message, processToReadyMs: elapsed(start), command, args }); }
      else if (message.type === 'result') {
        const task = pending.get(message.id);
        if (!task) throw new Error(`Unexpected benchmark response id: ${message.id}`);
        pending.delete(message.id); clearTimeout(task.timer); task.resolve({ ...message, controllerRoundTripMs: elapsed(task.start) });
      } else throw new Error('Unknown benchmark worker response');
    } catch (error) { fail(error); child.kill('SIGKILL'); }
  });
  const metadata = await ready;
  return { metadata,
    request(request) {
      if (terminated) return Promise.reject(new Error(`${engine} worker is no longer running`));
      const id = ++nextId;
      return new Promise((resolveTask, rejectTask) => {
        const timer = setTimeout(() => { pending.delete(id); rejectTask(new Error(`${engine} request exceeded ${options.timeoutMs} ms`)); child.kill('SIGKILL'); }, options.timeoutMs);
        pending.set(id, { resolve: resolveTask, reject: rejectTask, start: performance.now(), timer });
        child.stdin.write(JSON.stringify({ ...request, id }) + '\n');
      });
    },
    async close() {
      if (terminated) return;
      await new Promise(resolveClose => {
        const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
        child.once('exit', () => { clearTimeout(timer); resolveClose(); });
        child.stdin.end(JSON.stringify({ action: 'exit' }) + '\n');
      });
    } };
}

function requestFor(item, options, phase, engine, manifest) {
  return { action: 'run', caseId: item.id, sourcePath: fixturePath(item.source), sourceSha256: item.sourceSha256,
    python: options.python, timeoutMs: options.timeoutMs,
    prefix: join(options.out, phase, engine, item.id), probes: item.expected?.probes ?? [], pointToleranceMm: manifest.tolerances.pointMm };
}

function nativeGate(item, wonky, reference, manifest) {
  if (wonky.status !== 'ok' || reference.status !== 'ok') throw new Error('Both engines must construct and export a complete result');
  if (wonky.sourceSha256 !== item.sourceSha256 || reference.sourceSha256 !== item.sourceSha256) throw new Error('Executed source hashes differ');
  checkGeometryAgreement(wonky.actual, item.expected, manifest.tolerances);
  checkGeometryAgreement(reference.actual, item.expected, manifest.tolerances, { probes: true });
  checkGeometryAgreement(wonky.actual, reference.actual, manifest.tolerances);
  if (wonky.actual.pythonVersion !== reference.pythonVersion && reference.pythonVersion !== undefined) throw new Error('Python versions differ');
}

function validateSteps(rows, options, manifest, phase) {
  if (!rows.length) return { status: 'not-run', reason: 'No common validated candidate geometry' };
  const pointFile = join(options.out, `${phase}-point-probes.json`);
  json(pointFile, { schema: 'wonky-solid-probes/1', toleranceMm: manifest.tolerances.pointMm,
    models: rows.map(({ item }) => ({ prefix: join(options.out, phase, 'wonky', item.id), points: item.expected.probes })) });
  const args = ['run', 'scripts/validate-step.py', '--points', pointFile, ...rows.map(({ item }) => join(options.out, phase, 'wonky', item.id))];
  const start = performance.now(), result = spawnSync('uv', args, { cwd: root, encoding: 'utf8', timeout: options.timeoutMs, maxBuffer: 16 * 1024 * 1024 });
  const wallMs = elapsed(start);
  writeFileSync(join(options.out, `${phase}-step-validation.log`), (result.stdout ?? '') + (result.stderr ?? '') + (result.error?.message ?? ''));
  if (result.status !== 0 || result.error) return { status: 'failed', command: ['uv', ...args], wallMs, error: result.error?.message ?? `Validator exit ${result.status}` };
  try {
    const measured = JSON.parse(result.stdout);
    if (!Array.isArray(measured) || measured.length !== rows.length || new Set(measured.map(row => row.file)).size !== rows.length) throw new Error('Incomplete STEP validation cohort');
    for (const { item } of rows) {
      const observation = measured.find(row => row.file === join(options.out, phase, 'wonky', item.id) + '.step');
      if (!observation?.valid || observation.pointClassification?.points?.length !== item.expected.probes.length) throw new Error(`Missing strict STEP result: ${item.id}`);
      checkGeometryAgreement({ solids: observation.solids, volumeMm3: observation.volumeMm3,
        probes: observation.pointClassification.points }, item.expected, manifest.tolerances, { probes: true, bounds: false });
    }
    json(join(options.out, `${phase}-step-validation.json`), measured);
    return { status: 'passed', command: ['uv', ...args], wallMs, scope: 'Fresh independent OCCT 8 process: startup/import, strict STEP reader validation, volume and point classification. No reader bounding-box claim.',
      artifact: `${phase}-step-validation.json` };
  } catch (error) { return { status: 'failed', wallMs, error: errorRecord(error) }; }
}

function summarizeSamples(samples) {
  const fields = Object.keys(samples[0].timingsMs);
  return Object.fromEntries(fields.map(field => [field, samples.every(sample => Number.isFinite(sample.timingsMs[field]))
    ? timingStatistics(samples.map(sample => sample.timingsMs[field])) : null]));
}

function writeSummary(report, path) {
  const lines = ['# Same-source build123d performance', '', report.scope, '',
    `Geometry gate: ${report.geometryGate}; implementation stable: ${report.implementationStable ?? 'pending'}.`, '',
    '| Case | Result | Wonky build median (ms) | Real build123d build median (ms) | Wonky / reference |',
    '|---|---|---:|---:|---:|',
    ...report.cases.map(row => `| ${row.id} | ${row.status} | ${row.statistics?.wonky?.build?.medianMs.toFixed(3) ?? '—'} | ${row.statistics?.reference?.build?.medianMs.toFixed(3) ?? '—'} | ${row.ratioWonkyToReference?.toFixed(2) ?? '—'} |`), '',
    'Ratio > 1 means Wonky took longer. This ratio is the exposed build API boundary: Wonky includes a fresh isolated Python shim process, RPC, Bend execution, eager checks and source tracking; the real reference keeps Python/build123d imported and includes compile+exec. It is not an isolated kernel speed ratio.', '',
    'Cold startup, cached startup, raw rounds, IQR/range, exports, repeated validity checks, independent validation, failures, versions, source hashes and host/load snapshots are in [report.json](report.json).', '',
    'The workloads are a selected diagnostic subset, not full build123d compatibility or a CADBench score. The Bend target is JavaScript; no native/GPU speed claim is made.', ''];
  writeFileSync(path, lines.join('\n'));
}

export async function runBuild123dBenchmark(given = {}) {
  const options = { ...benchmarkOptions([]), ...given }; options.out = resolve(options.out); options.python = resolve(options.python);
  const manifest = verifyPerformanceFixtures();
  if (!existsSync(options.python)) throw new Error(`Missing isolated reference Python: ${options.python}. See docs/build123d-performance.md for uv setup.`);
  if (new Set(options.caseIds).size !== options.caseIds.length || options.caseIds.some(id => !manifest.cases.some(item => item.id === id))) throw new Error('Unknown or duplicate benchmark case selection');
  const selected = manifest.cases.filter(item => !options.caseIds.length || options.caseIds.includes(item.id));
  mkdirSync(options.out, { recursive: true });
  if (existsSync(join(options.out, 'report.json'))) throw new Error(`Output already contains a report: ${options.out}. Choose a new --out directory to preserve evidence.`);
  const report = { schema: 'wonky-build123d-performance/1', startedAt: new Date().toISOString(), scope: manifest.scope,
    mode: options.checkOnly ? 'geometry-check-only-no-performance-claim' : 'timing', options,
    sameCodeContract: manifest.sameCodeContract, fixtureManifestSha256: hash(readFileSync(join(fixtures, 'manifest.json'))),
    implementationBefore: implementationSnapshot(), hostBefore: hostSnapshot(), runtimes: {}, cases: [], startup: {}, geometryGate: 'pending', accepted: false,
    phaseDefinitions: {
      freshStartup: 'Process launch to ready; normal warm OS filesystem/page caches. Wonky cold disables persistent compiled Bend-JS cache; cached startup reuses it. Reference reimports real build123d/OCCT in every fresh Python process.',
      warmedBuild: 'Same source and Python version; sequential calls with loaded runtime, fresh source namespace. Wonky buildPython necessarily starts a fresh -I -S shim subprocess for every call; includes RPC, Bend geometry, eager validation and trace=true. Real build123d compiles and executes in a persistent Python process.',
      frontend: 'Real reference compile-only is observed directly. Wonky Python frontend, per-call interpreter startup, geometry and interop cannot be isolated using the existing adapter; their separate timings remain null, with no subtraction estimate.',
      nativeRevalidation: 'Repeated body validation after construction; different validator scopes, not an accuracy-equivalent timing contest. Does not remove eager checks from build timing.',
      export: 'STEP serialization/export plus disk write; Wonky includes mandatory exporter revalidation. B-rep JSON, hash reads and observations are outside this phase.',
      independentValidation: 'Existing scripts/validate-step.py in its pinned OCCT 8 environment. Fresh-process wall time includes import/reader overhead. Separate from modeling/export and no isolated reader timing claim.',
      ratio: 'Wonky warmed build API / real warmed build API. Includes asymmetric documented process/interop and validation overhead; not pure Bend/OCCT kernel time.',
    } };
  let wonky, reference;
  const save = () => { json(join(options.out, 'report.json'), report); writeSummary(report, join(options.out, 'report.md')); };
  try {
    wonky = await startWorker('wonky', options, join(options.out, 'wonky-worker.log'));
    reference = await startWorker('reference', options, join(options.out, 'reference-worker.log'));
    report.runtimes = { wonky: wonky.metadata, reference: reference.metadata };
    report.referenceEnvironment = verifyReferenceEnvironment(reference.metadata);
    const eligible = [];
    for (const item of selected) {
      const row = { id: item.id, eligibility: item.eligibility, size: item.size, source: item.source, sourceSha256: item.sourceSha256,
        complexity: item.complexity, expected: item.expected, status: 'pending', samples: { wonky: [], reference: [] }, warmupSamples: { wonky: [], reference: [] } };
      report.cases.push(row);
      const a = await wonky.request(requestFor(item, options, 'preflight', 'wonky', manifest));
      const b = await reference.request(requestFor(item, options, 'preflight', 'reference', manifest));
      row.preflight = { wonky: a, reference: b };
      if (b.status !== 'ok') json(join(options.out, 'preflight/reference', `${item.id}.failure.json`), b);
      if (item.eligibility === 'capability-probe') {
        row.status = a.status === 'ok' ? 'capability-now-supported-not-timed' : a.status;
        row.reason = item.reason; continue;
      }
      try {
        nativeGate(item, a, { ...b, pythonVersion: reference.metadata.pythonVersion }, manifest);
        row.status = 'native-agreement-awaiting-step'; eligible.push({ item, row });
      } catch (error) { row.status = a.status === 'ok' && b.status === 'ok' ? 'geometry-disagreement' : a.status === 'ok' ? 'reference-failed' : a.status; row.error = errorRecord(error); }
      save();
    }
    report.preflightStepValidation = validateSteps(eligible, options, manifest, 'preflight');
    report.geometryGate = report.preflightStepValidation.status;
    if (report.geometryGate !== 'passed') {
      for (const { row } of eligible) row.status = 'independent-validation-failed';
      throw new Error('Strict independent STEP/point agreement did not pass; no timing ratios produced');
    }
    for (const { row } of eligible) row.status = 'geometry-agreed';
    if (!options.checkOnly) {
      // These populations never run concurrently. Startup is intentionally
      // measured after correctness preparation, so this is not disk-cold I/O.
      report.startup.wonkyColdNoPersistentCache = [];
      report.startup.wonkyCached = [];
      report.startup.referenceFreshProcess = [];
      for (let round = 0; round < options.coldRounds; round++) {
        const worker = await startWorker('wonky', options, join(options.out, 'startup-wonky-cold.log'), { cache: false });
        report.startup.wonkyColdNoPersistentCache.push(worker.metadata); await worker.close(); save();
      }
      for (let round = 0; round < options.startupRounds; round++) {
        for (const engine of round % 2 ? ['reference', 'wonky'] : ['wonky', 'reference']) {
          const worker = await startWorker(engine, options, join(options.out, `startup-${engine}.log`));
          report.startup[engine === 'wonky' ? 'wonkyCached' : 'referenceFreshProcess'].push(worker.metadata); await worker.close();
        }
      }
      report.startup.statistics = Object.fromEntries(Object.entries(report.startup).map(([name, population]) => [name, timingStatistics(population.map(sample => sample.processToReadyMs))]));
      report.timingHostBefore = hostSnapshot();
      for (let round = 0; round < options.warmups + options.rounds; round++) {
        const warming = round < options.warmups;
        // Rotate case order and alternate engine order to reduce drift bias.
        const order = eligible.map((_, index) => eligible[(index + round) % eligible.length]);
        for (const { item, row } of order) {
          const samples = {};
          for (const engine of round % 2 ? ['reference', 'wonky'] : ['wonky', 'reference']) {
            samples[engine] = await (engine === 'wonky' ? wonky : reference).request(requestFor(item, options, 'measured', engine, manifest));
          }
          try { nativeGate(item, samples.wonky, { ...samples.reference, pythonVersion: reference.metadata.pythonVersion }, manifest); }
          catch (error) { row.status = 'measurement-failed'; row.error = errorRecord(error); row.failedSample = { round, warming, ...samples }; throw error; }
          for (const engine of ['wonky', 'reference']) (warming ? row.warmupSamples : row.samples)[engine].push({ round, ...samples[engine] });
        }
        save();
      }
      report.timingHostAfter = hostSnapshot();
      report.finalStepValidation = validateSteps(eligible, options, manifest, 'measured');
      if (report.finalStepValidation.status !== 'passed') throw new Error('Final timed artifacts failed independent STEP validation');
      for (const { row } of eligible) {
        row.statistics = { wonky: summarizeSamples(row.samples.wonky), reference: summarizeSamples(row.samples.reference) };
        row.ratioWonkyToReference = row.statistics.wonky.build.medianMs / row.statistics.reference.build.medianMs;
        row.status = 'measured-geometry-agreed';
      }
    }
    const after = implementationSnapshot(); report.implementationStable = after.sha256 === report.implementationBefore.sha256;
    if (!report.implementationStable) {
      report.implementationAfter = after;
      for (const row of report.cases) { delete row.ratioWonkyToReference; row.status = row.statistics ? 'source-changed-no-comparison' : row.status; }
      throw new Error('Implementation changed during benchmark; no timing comparison accepted');
    }
    report.accepted = selected.filter(item => item.eligibility === 'candidate').length === eligible.length && eligible.length > 0;
  } catch (error) { report.failure = errorRecord(error); report.accepted = false; }
  finally {
    if (wonky) await wonky.close();
    if (reference) await reference.close();
    report.hostAfter = hostSnapshot(); report.finishedAt = new Date().toISOString(); save();
  }
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === script) {
  try {
    if (process.argv[2] === '--worker') await bendWorker();
    else if (process.argv.length === 3 && process.argv[2] === '--help') console.log('Usage: node scripts/benchmark-build123d.mjs [--check] [--out DIR] [--python PATH] [--case ID] [--warmups 3] [--rounds 7] [--startup-rounds 3] [--cold-rounds 3]\nSetup: see docs/build123d-performance.md. Default: six common workloads plus explicit capability probes. --check validates identical-source geometry without a performance claim. Reusing report directories is refused.');
    else {
      const options = benchmarkOptions(process.argv.slice(2)), report = await runBuild123dBenchmark(options);
      console.log(JSON.stringify({ accepted: report.accepted, geometryGate: report.geometryGate, cases: report.cases.map(row => ({ id: row.id, status: row.status, ratio: row.ratioWonkyToReference })), failure: report.failure?.message }, null, 2));
      console.log(join(options.out, 'report.json')); process.exitCode = report.accepted ? 0 : 1;
    }
  } catch (error) { console.error(error.stack ?? error.message); process.exitCode = 1; }
}
