// Child-process entry of a warm build worker (child_process.fork from pool.mjs,
// `serialization: 'advanced'`, own process group). Package: live-server.
//
// Startup: load the kernel and the frontends once, run a small warm-up build
// with display preparation, then send { type: 'ready' }. Per job:
//
//   { type: 'build', jobId, language, sourcePath, bytes, options, label, outputs, ... }
//   { type: 'prepare', jobId, bytes, label, sourcePath }      (a previous-session model)
//
// A build evaluates exactly the given source bytes, serializes like the CLI
// (`serializeModel(model)`, src/construction-history.mjs), prepares the display scene and the
// draw payload, renders the requested --out formats and answers
// { type: 'result', ok: true, ... } or { type: 'result', ok: false, failure }
// with the plain `wonky.live-build-failure/1` payload (failure.mjs). Phases are
// reported as { type: 'phase', phase, elapsedMs }.
//
// Lifecycle: the worker exits on IPC disconnect. A watchdog thread checks the
// parent pid every 250 ms; if the parent died while a synchronous build blocks
// this thread, it kills the whole process group (the worker and any Python
// child). A startup failure is reported as { type: 'start-failed', error:
// { name, message } } before the worker exits, so the pool shows the error
// itself rather than the last line of its stack trace.
// WONKY_VIEW_TEST_WORKER_CRASH=1 makes startup fail (tests only).
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { Worker } from 'node:worker_threads';
import { failurePayload, pythonLocation } from './failure.mjs';
import { serializeModel } from '../../construction-history.mjs';

export const BUILD_WORKER_ENV = 'WONKY_VIEW_BUILD_WORKER';

const sha256 = value => createHash('sha256').update(value).digest('hex');
const elapsed = since => Math.round((performance.now() - since) * 10) / 10;
const send = message => {
  if (process.connected) process.send(message);
};

export function startWatchdog() {
  const code = `
    const { workerData } = require('node:worker_threads');
    setInterval(() => {
      if (process.ppid === workerData.ppid) return;
      try { process.kill(-workerData.pid, 'SIGKILL'); } catch {}
      try { process.kill(workerData.pid, 'SIGKILL'); } catch {}
    }, 250);`;
  const watchdog = new Worker(code, {
    eval: true, workerData: { ppid: process.ppid, pid: process.pid },
  });
  watchdog.unref();
}

let modules;

// Optional package modules (logical faces, edge classes, draw payload) are
// loaded separately: while their owners work on them, a failing import
// becomes a note instead of a worker that cannot start.
async function optional(path) {
  try {
    return await import(path);
  } catch (error) {
    return { loadError: error.message };
  }
}

async function loadModules() {
  const [index, python, scene, kernel, policy, summary] = await Promise.all([
    import('../../index.mjs'), import('../../python.mjs'), import('../../review-scene.mjs'),
    import('../../kernel.mjs'), import('../../modeling-policy.mjs'),
    import('../../geometry-summary.mjs'),
  ]);
  const [logical, classes, draw] = await Promise.all([
    optional('../logical-faces.mjs'), optional('../edge-classes.mjs'), optional('../draw.mjs'),
  ]);
  return { index, python, scene, kernel, policy, summary, logical, classes, draw };
}

async function loadExporters(format) {
  const exporters = await import('../../exporters.mjs');
  const preview = format === 'all' ? await import('../../preview.mjs') : null;
  const print = format === 'print' ? await import('../../print-mesh.mjs') : null;
  return { ...exporters, toHtml: preview?.toHtml, toPrintStl: print?.toPrintStl };
}

async function evaluate(job, text) {
  const options = job.options ?? {};
  if (job.language === 'python') {
    return modules.python.buildPython(text, {
      filename: job.sourcePath,
      python: options.python,
      ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
      ...(options.maxRequests !== undefined ? { maxRequests: options.maxRequests } : {}),
    });
  }
  const modelingPolicy = modules.policy.normalizeModelingPolicy(options.modelingPolicy
    ?? { curvedContacts: 'strict' });
  return modules.index.build(text, {
    feature: options.feature,
    parameters: options.parameters ?? {},
    moduleManifest: options.moduleManifest,
    maxSteps: options.maxSteps,
    sourcePath: job.sourcePath,
    modelingPolicy,
  });
}

// Project files a Python build loaded ({ path, sha256 }, real paths from the
// runner's import audit), so the session can watch them. Null for FeatureScript.
export function loadedFiles(records) {
  if (!Array.isArray(records)) return null;
  return records.filter(entry => typeof entry?.path === 'string')
    .map(entry => ({ path: entry.path, sha256: entry.sha256 ?? null }));
}

// Build notices: facts about a successful build the user must see because
// the model differs from what the source seems to ask for. The Python result
// contract (docs/python-frontend.md) lets a module-level `result` or
// `assembly` win over show()/export calls, which are then ignored.
export function buildNotices(model) {
  const notices = [];
  const ignored = model?.source?.ignoredCaptures;
  if (Number.isInteger(ignored) && ignored > 0) {
    const binding = model.source.result ?? 'result';
    notices.push({
      kind: 'ignored-captures',
      count: ignored,
      message: `${ignored} show/export call${ignored === 1 ? '' : 's'} ignored: the module-level`
        + ` '${binding}' is the result (Python result contract)`,
      detail: 'A module-level result or assembly wins over show() and export calls;'
        + ' see docs/python-frontend.md.',
    });
  }
  return notices;
}

const finite = values => values.every(value => Number.isFinite(value));

// The text of the project module a Python failure is located in, for its
// excerpt: read after the build and used only when its SHA-256 still equals
// the one the build recorded, so the excerpt shows the bytes that ran.
export async function locationTexts(error, sourcePath) {
  const file = pythonLocation(error, sourcePath)?.location?.file;
  if (!file || file === sourcePath) return {};
  const recorded = (Array.isArray(error?.sourceFiles) ? error.sourceFiles : [])
    .find(entry => entry?.path && resolve(dirname(sourcePath), entry.path) === file);
  if (!recorded?.sha256) return {};
  try {
    const bytes = await readFile(file);
    return sha256(bytes) === recorded.sha256 ? { [file]: bytes.toString('utf8') } : {};
  } catch {
    return {};
  }
}
const sum = values => values.reduce((total, value) => total + value, 0);

// Counts, recorded volume and bounds for the terminal line and the revision
// event. Bounds are `recorded` when every body carries validation.boundsMm,
// otherwise the display envelope with its tolerance.
export function summarize(model, scene, logical) {
  const bodies = model.bodies;
  const recorded = bodies.map(body => body.validation?.boundsMm);
  const exact = recorded.every(box => box && finite([...box.min ?? [], ...box.max ?? []])
    && box.min.length === 3 && box.max.length === 3);
  let bounds = null;
  if (exact) {
    bounds = {
      min: [0, 1, 2].map(axis => Math.min(...recorded.map(box => box.min[axis]))),
      max: [0, 1, 2].map(axis => Math.max(...recorded.map(box => box.max[axis]))),
      exactness: 'recorded',
    };
  } else if (scene?.bounds) {
    bounds = {
      min: scene.bounds.min, max: scene.bounds.max, exactness: 'display',
      toleranceMm: scene.display?.toleranceMm ?? null,
    };
  }
  if (bounds) bounds.sizeMm = bounds.max.map((value, axis) => value - bounds.min[axis]);
  const volumes = bodies.map(body => body.validation?.volumeMm3);
  return {
    bodies: bodies.length,
    faces: sum(bodies.map(body => body.faces.length)),
    logicalFaces: logical ? sum(logical.bodies.map(body => body.groups.length)) : null,
    edges: sum(bodies.map(body => body.edges.length)),
    vertices: sum(bodies.map(body => body.vertices.length)),
    volumeMm3: finite(volumes) ? sum(volumes) : null,
    volumeExactness: finite(volumes) ? 'recorded' : null,
    bounds,
  };
}

async function renderOutputs(model, json, { prefix, format, deviationMm }) {
  const exporters = await loadExporters(format);
  const formats = [
    ['brep.json', () => json],
    ['step', () => exporters.toStep(model, basename(prefix))],
  ];
  if (format === 'all') {
    formats.push(['stl', () => exporters.toStl(model)], ['html', () => exporters.toHtml(model)]);
  }
  if (format === 'print') {
    const kernel = await modules.kernel.loadKernel();
    let printed;
    let failure;
    const meshed = () => {
      if (failure) throw failure;
      try {
        printed ??= exporters.toPrintStl(kernel, model, { deviationMm });
        return printed;
      } catch (error) {
        failure = error;
        throw error;
      }
    };
    formats.push(['stl', () => meshed().stl],
      ['print.json', () => JSON.stringify(meshed().manifest, null, 2) + '\n']);
  }
  return formats.map(([extension, render]) => {
    try {
      return { extension, contents: render() };
    } catch (error) {
      return { extension, error: error.message };
    }
  });
}

// Display preparation and everything derived from the serialized model.
async function display(job, json, modelId, phase, timings) {
  phase('display');
  const started = performance.now();
  const parsed = JSON.parse(json);
  // The same validation the server runs for a .brep.json input (exact bytes,
  // model id, structure); the server then creates its inspector lazily.
  modules.summary.createGeometryInspector(parsed, { modelBytes: Buffer.from(json), modelId });
  const metadata = {
    id: modelId, label: job.label, sha256: modelId, sourcePath: job.sourcePath,
    bodyCount: parsed.bodies.length,
    faceCount: parsed.bodies.reduce((count, body) => count + body.faces.length, 0),
  };
  const scene = await modules.scene.reviewScene(parsed, metadata);
  const notes = [];
  for (const [name, module] of [['edge classes', modules.classes],
    ['logical faces', modules.logical], ['draw payload', modules.draw]]) {
    if (module.loadError) notes.push(`${name}: ${module.loadError}`);
  }
  let classes = null;
  try {
    classes = modules.classes.classifyEdges?.(parsed, scene) ?? null;
  } catch (error) {
    notes.push(`edge classes: ${error.message}`);
  }
  let logical = null;
  try {
    logical = modules.logical.logicalFaces?.(parsed, classes ? { classes } : undefined) ?? null;
  } catch (error) {
    notes.push(`logical faces: ${error.message}`);
  }
  // `null` (no display kernel) leaves the payload to the query worker.
  let draw = null;
  try {
    draw = modules.draw.buildDrawPayload?.(parsed, scene, { logical, classes, modelId }) ?? null;
  } catch (error) {
    notes.push(`draw payload: ${error.message}`);
  }
  const sceneText = JSON.stringify(scene);
  timings.displayMs = elapsed(started);
  return {
    sceneText,
    sceneBytes: Buffer.byteLength(sceneText),
    bounds: scene.bounds,
    draw,
    summary: summarize(parsed, scene, logical),
    displayNotes: [...(scene.display?.notes ?? []), ...notes],
    parsed,
  };
}

async function runJob(job) {
  const clock = performance.now();
  const timings = {};
  const phase = name => send({
    type: 'phase', jobId: job.jobId, phase: name, elapsedMs: elapsed(clock),
  });
  const bytes = Buffer.from(job.bytes.buffer, job.bytes.byteOffset, job.bytes.byteLength);
  const text = bytes.toString('utf8');
  const source = {
    path: job.sourcePath, sha256: sha256(text), language: job.language, text,
  };
  const failure = async (error, failedPhase, extra = {}) => {
    timings.totalMs = elapsed(clock);
    const texts = job.language === 'python' ? await locationTexts(error, job.sourcePath) : {};
    send({
      type: 'result', jobId: job.jobId, ok: false, rss: process.memoryUsage().rss,
      failure: failurePayload(error, {
        source, jobId: job.jobId, revision: job.revision ?? null, sourceId: job.sourceId ?? null,
        timings, lastGood: job.lastGood ?? null, phase: failedPhase,
        manifestPath: job.options?.moduleManifest ?? null, texts,
      }),
      sourceFiles: loadedFiles(error?.sourceFiles),
      ...extra,
    });
  };
  let model;
  let json;
  if (job.type === 'prepare') {
    json = text;
  } else {
    phase('evaluating');
    const started = performance.now();
    try {
      model = await evaluate(job, text);
    } catch (error) {
      timings.evaluateMs = elapsed(started);
      await failure(error, 'evaluating');
      return;
    }
    timings.evaluateMs = elapsed(started);
    phase('serializing');
    const serializing = performance.now();
    json = serializeModel(model);
    timings.serializeMs = elapsed(serializing);
  }
  const modelBytes = Buffer.from(json);
  const modelId = sha256(modelBytes);
  let prepared;
  try {
    prepared = await display(job, json, modelId, phase, timings);
  } catch (error) {
    await failure(error, 'display', { download: { modelId, bytes: modelBytes } });
    return;
  }
  let outputs = null;
  if (job.outputs && model) {
    phase('outputs');
    const started = performance.now();
    outputs = await renderOutputs(model, json, job.outputs);
    timings.outputsMs = elapsed(started);
  }
  timings.totalMs = elapsed(clock);
  const { parsed, ...rest } = prepared;
  send({
    type: 'result', jobId: job.jobId, ok: true, modelId, bytes: modelBytes, ...rest,
    sourceSha256: source.sha256, sourceFiles: loadedFiles(model?.source?.modules),
    notices: buildNotices(model),
    execution: model?.execution
      ? { stdout: model.execution.stdout, stderr: model.execution.stderr } : null,
    outputs, timings, rss: process.memoryUsage().rss,
  });
}

// A small build plus display preparation, so the first real job does not pay
// for lazy module and code-path loading. A failure here is reported, not fatal.
async function warmUp() {
  try {
    const path = new URL('../../../examples/bored-spacer.fs', import.meta.url);
    const text = await readFile(path, 'utf8');
    const model = await modules.index.build(text, { sourcePath: null });
    const json = serializeModel(model);
    await display({ label: 'warm-up', sourcePath: null }, json, sha256(Buffer.from(json)),
      () => {}, {});
    return null;
  } catch (error) {
    return error.message;
  }
}

async function main() {
  process.on('disconnect', () => process.exit(0));
  startWatchdog();
  if (process.env.WONKY_VIEW_TEST_WORKER_CRASH === '1') {
    throw new Error('injected start crash (WONKY_VIEW_TEST_WORKER_CRASH=1)');
  }
  const started = performance.now();
  modules = await loadModules();
  await modules.kernel.loadKernel();
  // The draw payload needs the Bend display module (exact normals).
  try {
    await modules.draw.loadDrawKernel?.();
  } catch (error) {
    modules.draw = { loadError: `display kernel: ${error.message}` };
  }
  const warmUpError = await warmUp();
  if (process.env.WONKY_VIEW_OUTPUTS) await loadExporters(process.env.WONKY_VIEW_OUTPUTS);
  let chain = Promise.resolve();
  process.on('message', message => {
    if (message?.type !== 'build' && message?.type !== 'prepare') return;
    chain = chain.then(() => runJob(message)).catch(error => {
      send({
        type: 'result', jobId: message.jobId, ok: false, rss: process.memoryUsage().rss,
        failure: failurePayload(error, { jobId: message.jobId, phase: 'internal' }),
      });
    });
  });
  send({
    type: 'ready', pid: process.pid, warmMs: elapsed(started), warmUpError,
    rss: process.memoryUsage().rss,
  });
}

if (process.send && process.env[BUILD_WORKER_ENV] === '1') {
  main().catch(error => {
    process.stderr.write(`wonky-view build worker failed to start: ${error.stack ?? error}\n`);
    const exit = () => process.exit(1);
    if (!process.connected) exit();
    else {
      process.send({
        type: 'start-failed',
        error: { name: error?.name ?? 'Error', message: String(error?.message ?? error) },
      }, exit);
    }
  });
}
