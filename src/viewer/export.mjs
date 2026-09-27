// Print export (STL + deviation manifest) for GET /api/models/:id/print.stl
// and print.json (spec 3.6, 9.2). Package: reviews-context.
//
// Frozen signature:
//   printExport(model, { body, deviationMm }) -> { stl: Buffer, manifest }
// plus { kernel } (the loaded Bend kernel) and the revision facts the
// manifest records (modelId, label, revision, snapshot, inspect).
//
// The mesh is src/print-mesh.mjs (import only): every circle is divided by a
// count Bend chooses for the requested chord deviation, and the achieved
// deviation is a computed bound. The STL is a display approximation of the
// exact B-rep for the slicer; the manifest states the deviation and names the
// archived snapshot that stays authoritative. A body the print mesh cannot
// cover raises its capability error, never a guess.
//
// createPrintExporter() runs exports in one worker thread that loads the
// kernel once, so the server's event loop never meshes (r10b-retained takes
// about 80 ms under load, above the 50 ms rule). The thread is unref'd and
// ends after `idleMs` without work.
import { createHash } from 'node:crypto';
import { isMainThread, parentPort, Worker, workerData } from 'node:worker_threads';
import { formatTolerance } from '../../viewer/core/format.js';
import { toPrintStl } from '../print-mesh.mjs';
import { HttpError } from './http.mjs';

export const PRINT_SCHEMA = 'wonky.viewer-print-export/1';
export const DEFAULT_DEVIATION_MM = 0.02;
export const DEVIATION_LIMITS_MM = Object.freeze([0.001, 1]);
const BODY_ALIAS = /^B([1-9][0-9]*)$/;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

// Chord deviation from a query value: default 0.02 mm, 400 outside the limits.
export function readDeviation(value) {
  if (value === null || value === undefined || value === '') return DEFAULT_DEVIATION_MM;
  const deviation = Number(value);
  const [min, max] = DEVIATION_LIMITS_MM;
  if (!Number.isFinite(deviation) || deviation < min || deviation > max) {
    throw new HttpError(400, `deviationMm must be a number from ${min} to ${max} mm`);
  }
  return deviation;
}

// The body a `body` query names (body id or alias B2); null for the whole
// revision; 404 when this revision has no such body.
export function selectBody(model, body) {
  if (body === null || body === undefined || body === '') return null;
  const alias = BODY_ALIAS.exec(body);
  const index = alias ? Number(alias[1]) - 1 : model.bodies.findIndex(item => item.id === body);
  if (!model.bodies[index]) throw new HttpError(404, `Unknown body ${body} in this revision`);
  return { body: model.bodies[index], bodyIndex: index };
}

export const slug = text => String(text ?? '').toLowerCase().replace(/\.brep\.json$/, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'model';

// "bracket-r3-3f2a1b9c.stl", "frame-3f2a1b9c-b2-tab.stl"
export function printFileName({ label, modelId, revision = null, body = null }) {
  return [
    slug(label), Number.isInteger(revision) ? `r${revision}` : null,
    String(modelId ?? 'model').slice(0, 8),
    body ? slug(`${body.alias} ${body.name ?? body.id}`) : null,
  ].filter(Boolean).join('-') + '.stl';
}

function deviationStatement(requestedMm, achievedMm) {
  if (achievedMm === 0) {
    return 'Planar bodies without circular edges are meshed from their own faces: 0 mm'
      + ' chord deviation.';
  }
  return `Every facet lies within ${formatTolerance(achievedMm, 4)} mm of the exact B-rep`
    + ` surface (chord deviation bound computed by Bend; requested at most ${requestedMm} mm).`;
}

export function printExport(model, {
  body = null, deviationMm = DEFAULT_DEVIATION_MM, kernel, modelId = null, label = null,
  revision = null, snapshot = null, inspect = null,
} = {}) {
  if (!kernel) throw new Error('Print export needs the loaded Bend kernel');
  const selected = selectBody(model, body);
  const subset = selected ? { ...model, bodies: [selected.body] } : model;
  const printed = toPrintStl(kernel, subset, { deviationMm });
  const stl = Buffer.from(printed.stl, 'utf8');
  const achievedMm = Math.max(0, ...printed.manifest.bodies.map(entry => entry
    .achievedDeviationMm));
  const bodies = (selected ? [selected] : model.bodies.map((item, index) => ({
    body: item, bodyIndex: index,
  }))).map(item => ({
    alias: `B${item.bodyIndex + 1}`, id: item.body.id, name: item.body.name ?? null,
  }));
  const manifest = {
    schema: PRINT_SCHEMA,
    modelId, label, revision,
    scope: selected ? 'body' : 'revision',
    bodies,
    units: 'mm',
    file: {
      name: printFileName({ label, modelId, revision, body: selected ? bodies[0] : null }),
      bytes: stl.length, sha256: sha256(stl),
    },
    deviation: {
      requestedMm: deviationMm,
      achievedMm,
      exactness: 'display-approximation',
      statement: deviationStatement(deviationMm, achievedMm),
    },
    snapshot, inspect,
    printMesh: printed.manifest,
    note: 'The STL approximates the exact B-rep for slicing. The archived snapshot stays'
      + ' authoritative; exact measurements come from it, never from this mesh.',
  };
  return { stl, manifest };
}

const errorOf = ({ name, message, status }) => {
  if (name === 'UnsupportedFeatureError') {
    return Object.assign(new HttpError(422, message), { capability: true });
  }
  if (Number.isInteger(status)) return new HttpError(status, message);
  return new Error(message);
};

export function createPrintExporter({
  idleMs = 60000, timeoutMs = 120000, workerUrl = new URL(import.meta.url),
} = {}) {
  let worker = null;
  let idle = null;
  let next = 0;
  const pending = new Map();

  const fail = error => {
    for (const job of pending.values()) {
      clearTimeout(job.timer);
      job.reject(error);
    }
    pending.clear();
  };
  function stop(reason) {
    clearTimeout(idle);
    const current = worker;
    worker = null;
    fail(reason);
    current?.terminate();
  }
  function scheduleIdle() {
    clearTimeout(idle);
    if (pending.size) return;
    idle = setTimeout(() => stop(new HttpError(503, 'Print export worker stopped')), idleMs);
    idle.unref?.();
  }
  function start() {
    const thread = new Worker(workerUrl, { workerData: { wonkyPrintWorker: true } });
    thread.unref();
    thread.on('message', ({ id, ok, stl, manifest, error }) => {
      const job = pending.get(id);
      if (!job) return;
      pending.delete(id);
      clearTimeout(job.timer);
      if (ok) job.resolve({ stl: Buffer.from(stl), manifest });
      else job.reject(errorOf(error));
      scheduleIdle();
    });
    thread.on('error', error => {
      if (worker === thread) stop(error);
    });
    thread.on('exit', code => {
      if (worker !== thread) return;
      worker = null;
      fail(new Error(`Print export worker exited with code ${code}`));
    });
    return thread;
  }

  return {
    // bytes: the exact .brep.json bytes; options: printExport options.
    run(bytes, options) {
      worker ??= start();
      clearTimeout(idle);
      const id = ++next;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => stop(new HttpError(504,
          `Print export timed out after ${timeoutMs} ms`)), timeoutMs);
        timer.unref?.();
        pending.set(id, { resolve, reject, timer });
        worker.postMessage({ id, bytes: new Uint8Array(bytes), options });
      });
    },
    running: () => worker !== null,
    close: () => stop(new HttpError(503, 'Print export closed')),
  };
}

// Worker thread entry: loads the kernel once and answers print jobs.
async function serve() {
  const { loadKernel } = await import('../kernel.mjs');
  let kernel = null;
  parentPort.on('message', async ({ id, bytes, options }) => {
    try {
      kernel ??= await loadKernel();
      const model = JSON.parse(Buffer.from(bytes).toString('utf8'));
      const { stl, manifest } = printExport(model, { ...options, kernel });
      const copy = new Uint8Array(stl);
      parentPort.postMessage({ id, ok: true, stl: copy, manifest }, [copy.buffer]);
    } catch (error) {
      const { name = 'Error', message, status } = error ?? {};
      parentPort.postMessage({ id, ok: false, error: { name, message: String(message), status } });
    }
  });
}

if (!isMainThread && workerData?.wonkyPrintWorker) serve();
