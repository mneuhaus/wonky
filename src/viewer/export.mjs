// Print export (STL + deviation manifest) for GET /api/models/:id/print.stl
// and print.json (spec 3.6, 9.2). Package: reviews-context.
//
// Frozen signature:
//   printExport(model, { body, deviationMm }) -> { stl: Buffer, manifest }
// plus { kernel } (the loaded Bend kernel) and the revision facts the
// manifest records (modelId, label, revision, snapshot, inspect).
//
// The mesh of a Rust (WC0) record is the Rust mesh path (host op OP_MESH,
// wonky-mesh/1, the tessellation bin/wonky.mjs writes as STL), with the
// requested deviation as its stated bound (0 for planar-only bodies). Other
// records use src/print-mesh.mjs (import only): every circle is divided by a
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
import { UnsupportedFeatureError } from '../errors.mjs';
import { rustMesh } from '../native/rust-host.mjs';
import { toPrintStl } from '../print-mesh.mjs';
import { isRustRecord, recordWords } from '../rust-review-scene.mjs';
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

function deviationStatement(requestedMm, achievedMm, rust) {
  if (achievedMm === 0) {
    return 'Planar bodies without circular edges are meshed from their own faces: 0 mm'
      + ' chord deviation.';
  }
  return `Every facet lies within ${formatTolerance(achievedMm, 4)} mm of the exact B-rep`
    + ` surface (chord deviation bound ${rust ? 'stated by the Rust mesh path' : 'computed by Bend'};`
    + ` requested at most ${requestedMm} mm).`;
}

const cross = (u, v) => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];

// ASCII STL of Rust records from the Rust mesh path, in the print-mesh/1 manifest
// shape. The mesh path refuses by name what it cannot cover (no fallback mesh).
function rustPrintStl(kernel, model, { deviationMm }) {
  const lines = [], manifest = { schema: 'wonky.print-mesh/1', deviationMm, bodies: [] };
  for (const body of model.bodies) {
    const mesh = rustMesh(kernel, [recordWords(body)], deviationMm).bodies[0];
    const point = i => [mesh.vertices[3 * i], mesh.vertices[3 * i + 1], mesh.vertices[3 * i + 2]];
    const name = body.id.replace(/[^A-Za-z0-9_-]/g, '_');
    lines.push(`solid ${name}`);
    for (let t = 0; t < mesh.triangles.length; t += 3) {
      const [a, b, c] = [0, 1, 2].map(k => point(mesh.triangles[t + k]));
      const n = cross(a.map((v, i) => b[i] - v), a.map((v, i) => c[i] - v)), length = Math.hypot(...n);
      if (!(length > 0)) throw new Error(`Rust mesh of '${body.id}' has a degenerate triangle`);
      lines.push(`  facet normal ${n.map(v => (v / length).toPrecision(9)).join(' ')}`, '    outer loop',
        ...[a, b, c].map(p => `      vertex ${p.map(v => v.toPrecision(9)).join(' ')}`), '    endloop', '  endfacet');
    }
    lines.push(`endsolid ${name}`);
    const planar = body.faces.every(face => face.surface?.type === 'plane')
      && body.edges.every(edge => edge.curve === 'line');
    manifest.bodies.push({ id: body.id, chordCount: null, triangles: mesh.triangles.length / 3,
      achievedDeviationMm: planar ? 0 : deviationMm, exactVolumeMm3: body.validation?.volumeMm3 ?? null,
      meshSource: 'rust-mesh' });
  }
  return { stl: lines.join('\n') + '\n', manifest };
}

export function printExport(model, {
  body = null, deviationMm = DEFAULT_DEVIATION_MM, kernel, modelId = null, label = null,
  revision = null, snapshot = null, inspect = null,
} = {}) {
  if (!kernel) throw new Error('Print export needs the loaded kernel');
  const selected = selectBody(model, body);
  const subset = selected ? { ...model, bodies: [selected.body] } : model;
  const rust = subset.bodies.length > 0 && subset.bodies.every(isRustRecord);
  if (!rust && subset.bodies.some(isRustRecord)) {
    throw new UnsupportedFeatureError('Print export: a model mixes Rust WC0 bodies and legacy bodies');
  }
  const printed = rust ? rustPrintStl(kernel, subset, { deviationMm }) : toPrintStl(kernel, subset, { deviationMm });
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
      statement: deviationStatement(deviationMm, achievedMm, rust),
    },
    snapshot, inspect,
    printMesh: printed.manifest,
    note: 'The STL approximates the exact B-rep for slicing. The archived snapshot stays'
      + ' authoritative; exact measurements come from it, never from this mesh.',
  };
  return { stl, manifest };
}

// A capability refusal (UnsupportedFeatureError or a subclass such as the Rust
// kernel's named refusals) is 422; the worker marks it, since only fields cross.
const errorOf = ({ name, message, status, capability }) => {
  if (capability || name === 'UnsupportedFeatureError') {
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
      const capability = error instanceof UnsupportedFeatureError;
      parentPort.postMessage({ id, ok: false, error: { name, message: String(message), status, capability } });
    }
  });
}

if (!isMainThread && workerData?.wonkyPrintWorker) serve();
