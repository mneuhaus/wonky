// Query handlers by kind (frozen map) and the query worker process.
//
// Each handler has the signature (model, payload, { signal }) -> result and
// lives in its package's module. query-pool.mjs runs them in a separate,
// lazily started worker process (live-server, spec 10.4): this file is that
// process's entry when forked with WONKY_VIEW_QUERY_WORKER=1. Tests that pass
// their own handlers run them in-process through runQuery().
//
// Worker protocol (advanced serialization):
//   parent -> { type: 'query', id, kind, modelId, payload, bytes? }
//             { type: 'cancel', id }
//   worker -> { type: 'ready' }
//             { type: 'preparing', id }   (first query of a kind loads its modules)
//             { type: 'started', id }     (modules loaded; the timeout starts now)
//             { type: 'result', id, ok: true, value }
//             { type: 'result', id, ok: false, error: { status, name, message } }
//             { type: 'result', id, ok: false, missing: true }   (resend with bytes)
// The worker keeps the last 4 parsed models (LRU by model id); the parent
// mirrors that order and sends a model's exact bytes only when it is absent.
import { drawQuery, loadDrawKernel } from './draw.mjs';
import { printabilityQuery } from './printability.mjs';
import { sectionQuery } from './section.mjs';
import { thicknessQuery } from './thickness.mjs';
import { diffBoundsQuery } from './diff.mjs';

export const QUERY_HANDLERS = Object.freeze({
  draw: drawQuery,
  printability: printabilityQuery,
  section: sectionQuery,
  thickness: thicknessQuery,
  diffBounds: diffBoundsQuery,
});

export const QUERY_TIMEOUTS_MS = Object.freeze({
  draw: 60000,
  printability: 30000,
  section: 10000,
  thickness: 10000,
  diffBounds: 30000,
  scene: 60000,
});

// Server-internal kinds (not part of the frozen public map): the JSON display
// scene of a live revision whose scene left the revision ring.
export const INTERNAL_HANDLERS = Object.freeze({
  async scene(model, { metadata }) {
    const { reviewScene } = await import('../review-scene.mjs');
    return JSON.stringify(await reviewScene(model, metadata));
  },
});

export const MODEL_CACHE_SIZE = 4;

// One-time module loads per kind (Bend modules; seconds under load). The
// worker runs them before the query's timeout starts, so a cold first query
// is not cut off while it is still loading code (integration, 2026-09-23).
export const PREPARE = Object.freeze({
  draw: () => loadDrawKernel(),
  printability: () => import('../curve-band.mjs'),
  section: () => import('../section.mjs'),
  // The thickness query loads its ray and classifier kernels itself; on Rust it answers
  // 'unsupported' and must not load Bend code, so nothing is prepared ahead of it.
  thickness: () => import('./thickness.mjs'),
  diffBounds: () => import('../curve-band.mjs'),
});

export function runQuery(kind, model, payload, { signal } = {}, handlers = QUERY_HANDLERS) {
  const handler = handlers[kind];
  if (!handler) throw new Error(`Unknown query kind ${kind}`);
  return handler(model, payload, { signal });
}

async function serve() {
  const { startWatchdog } = await import('./live/build-worker.mjs');
  process.on('disconnect', () => process.exit(0));
  startWatchdog();
  if (process.env.WONKY_VIEW_TEST_WORKER_CRASH === '1') {
    process.stderr.write('wonky-view query worker: injected start crash\n');
    process.exit(3);
  }
  const cache = new Map();
  const controllers = new Map();
  const prepared = new Map();
  const handlers = { ...QUERY_HANDLERS, ...INTERNAL_HANDLERS };
  const reply = message => {
    if (process.connected) process.send(message);
  };
  process.on('message', async message => {
    if (message?.type === 'cancel') {
      controllers.get(message.id)?.abort();
      return;
    }
    if (message?.type !== 'query') return;
    const { id, kind, modelId, payload, bytes } = message;
    if (bytes) {
      const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      cache.delete(modelId);
      cache.set(modelId, JSON.parse(buffer));
      while (cache.size > MODEL_CACHE_SIZE) cache.delete(cache.keys().next().value);
    }
    const model = cache.get(modelId);
    if (!model) {
      reply({ type: 'result', id, ok: false, missing: true });
      return;
    }
    cache.delete(modelId);
    cache.set(modelId, model);
    const controller = new AbortController();
    controllers.set(id, controller);
    try {
      if (PREPARE[kind] && prepared.get(kind) !== true) {
        reply({ type: 'preparing', id });
        if (!prepared.has(kind)) {
          prepared.set(kind, PREPARE[kind]().then(() => prepared.set(kind, true), error => {
            prepared.delete(kind);
            throw error;
          }));
        }
        await prepared.get(kind);
        reply({ type: 'started', id });
      }
      const value = await runQuery(kind, model, payload, { signal: controller.signal }, handlers);
      reply({ type: 'result', id, ok: true, value });
    } catch (error) {
      reply({
        type: 'result', id, ok: false,
        error: { status: error?.status ?? 500, name: error?.name, message: String(error?.message) },
      });
    } finally {
      controllers.delete(id);
    }
  });
  // Every handler needs the Bend kernel; loading it before 'ready' keeps the
  // one-time load (seconds on a loaded machine) out of the query timeouts,
  // which start when the worker is ready (query-pool.mjs).
  await (await import('../kernel.mjs')).loadKernel();
  reply({ type: 'ready', pid: process.pid });
}

if (process.send && process.env.WONKY_VIEW_QUERY_WORKER === '1') {
  serve().catch(error => {
    process.stderr.write(`wonky-view query worker failed to start: ${error.stack ?? error}\n`);
    process.exit(1);
  });
}
