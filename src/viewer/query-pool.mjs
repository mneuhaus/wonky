// Query pool (frozen API):
//
//   pool.query(kind, modelId, payload, { timeoutMs, supersedeKey, signal }) -> Promise
//
// Latest wins per supersedeKey: a newer query with the same key aborts the
// older one (409 "Superseded"). A query past its timeout rejects with 504;
// in the worker transport the timeout starts once the worker is ready.
//
// Transport (live-server, spec 10.4): by default the handlers run in a
// separate, lazily started worker process (query-worker.mjs) with a model
// cache of 4, so nothing here blocks the server's event loop. The worker is
// its own process group, exits on IPC disconnect and is killed on close(). A
// query that times out while the worker is still busy with it kills the
// worker (a synchronous kernel call cannot be interrupted otherwise); the
// other queries of that worker then answer 503 and the next query starts a
// fresh one. Start failures: three within 60 s answer 503 with the stderr
// tail until the window passes.
//
// Passing `handlers` keeps the foundation's in-process transport (tests with
// injected handlers; they cannot be preempted, a late result is dropped).
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { CapabilityError, HttpError } from './http.mjs';
import {
  INTERNAL_HANDLERS, MODEL_CACHE_SIZE, QUERY_HANDLERS, QUERY_TIMEOUTS_MS, runQuery,
} from './query-worker.mjs';
import { killGroup, trackChild, untrackChild } from './live/pool.mjs';

const WORKER_PATH = fileURLToPath(new URL('./query-worker.mjs', import.meta.url));
const TAIL = 4096;
const WORKER_START_MS = 120000;

function inProcessPool({ registry, handlers }) {
  const latest = new Map();
  const running = new Set();
  return {
    transport: 'in-process',
    async query(kind, modelId, payload, { timeoutMs, supersedeKey, signal } = {}) {
      if (!handlers[kind]) throw new HttpError(400, `Unknown query kind ${kind}`);
      const model = registry.model(modelId);
      if (!model) throw new HttpError(404, 'Unknown model revision');
      const controller = new AbortController();
      if (supersedeKey !== undefined) {
        latest.get(supersedeKey)?.abort(new HttpError(409, 'Superseded by a newer query'));
        latest.set(supersedeKey, controller);
      }
      const forward = () => controller.abort(signal.reason ?? new HttpError(499, 'Query aborted'));
      if (signal?.aborted) forward();
      else signal?.addEventListener('abort', forward, { once: true });
      const limit = timeoutMs ?? QUERY_TIMEOUTS_MS[kind] ?? 30000;
      const timer = setTimeout(() => controller.abort(new HttpError(504,
        `Query ${kind} timed out after ${limit} ms`)), limit);
      running.add(controller);
      try {
        const aborted = new Promise((_resolve, reject) => {
          if (controller.signal.aborted) reject(controller.signal.reason);
          controller.signal.addEventListener('abort', () => reject(controller.signal.reason),
            { once: true });
        });
        const work = Promise.resolve().then(() => runQuery(kind, model, payload,
          { signal: controller.signal }, handlers));
        return await Promise.race([work, aborted]);
      } finally {
        clearTimeout(timer);
        running.delete(controller);
        signal?.removeEventListener('abort', forward);
        if (supersedeKey !== undefined && latest.get(supersedeKey) === controller) {
          latest.delete(supersedeKey);
        }
      }
    },
    pids: () => [],
    close() {
      const closed = new HttpError(503, 'Viewer server closed');
      for (const controller of running) controller.abort(closed);
      running.clear();
      latest.clear();
    },
  };
}

const errorFrom = ({ status = 500, message = 'Query failed' } = {}) => (status === 501
  ? new CapabilityError(message) : new HttpError(status, message));

function workerPool({
  registry, workerPath = WORKER_PATH, env = {}, backoff = {}, onEvent = () => {},
}) {
  const { limit = 3, windowMs = 60000 } = backoff;
  const kinds = new Set([...Object.keys(QUERY_HANDLERS), ...Object.keys(INTERNAL_HANDLERS)]);
  const pending = new Map();
  const latest = new Map();
  const failures = [];
  let worker = null;
  let nextId = 1;
  let closed = false;

  const stopWorker = (target, error) => {
    if (!target) return;
    if (worker === target) worker = null;
    target.dead = true;
    killGroup(target.pid);
    untrackChild(target.pid);
    for (const query of [...pending.values()]) {
      if (query.worker === target) query.finish(false, error);
    }
  };

  function spawnWorker() {
    const child = fork(workerPath, [], {
      serialization: 'advanced', detached: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      env: { ...process.env, ...env, WONKY_VIEW_QUERY_WORKER: '1' },
    });
    const record = { child, pid: child.pid, cached: [], stderr: '', dead: false };
    trackChild(child.pid);
    const capture = chunk => {
      record.stderr = (record.stderr + chunk).slice(-TAIL);
    };
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', capture);
    child.stderr.on('data', capture);
    child.on('error', error => capture(`${error.message}\n`));
    record.ready = new Promise((resolve, reject) => {
      child.on('message', message => {
        if (message?.type === 'ready') {
          record.isReady = true;
          onEvent('query-worker-ready', { pid: child.pid });
          resolve(record);
          return;
        }
        if (message?.type === 'result') pending.get(message.id)?.answer(message);
        if (message?.type === 'preparing') pending.get(message.id)?.pause();
        if (message?.type === 'started') pending.get(message.id)?.arm();
      });
      child.on('exit', (code, signal) => {
        untrackChild(child.pid);
        const tail = record.stderr.trim();
        if (!record.isReady && !record.dead) {
          failures.push(Date.now());
          reject(new HttpError(503, `Query worker failed to start (${signal ?? code})`
            + (tail ? `: ${tail.split('\n').at(-1)}` : '')));
        }
        if (!record.dead) {
          stopWorker(record, new HttpError(503, `Query worker exited (${signal ?? code})`
            + (tail ? `: ${tail.split('\n').at(-1)}` : '')));
        }
      });
    });
    record.ready.catch(() => {});
    return record;
  }

  async function ensureWorker() {
    const now = Date.now();
    while (failures.length && now - failures[0] > windowMs) failures.shift();
    if (failures.length >= limit) {
      throw new HttpError(503, `Query worker failed to start ${failures.length} times within `
        + `${windowMs / 1000} s`);
    }
    worker ??= spawnWorker();
    return worker.ready;
  }

  // Mirrors the worker's LRU so a model's bytes cross IPC only when needed.
  const remember = (target, modelId) => {
    target.cached = target.cached.filter(id => id !== modelId);
    target.cached.push(modelId);
    while (target.cached.length > MODEL_CACHE_SIZE) target.cached.shift();
  };

  async function send(query, forceBytes = false) {
    const target = await ensureWorker();
    if (query.done) return;
    query.worker = target;
    const bytes = forceBytes || !target.cached.includes(query.modelId)
      ? await registry.bytes(query.modelId) : undefined;
    if (query.done || target.dead) return;
    remember(target, query.modelId);
    target.child.send({
      type: 'query', id: query.id, kind: query.kind, modelId: query.modelId,
      payload: query.payload, bytes,
    });
    if (!query.preparing) query.arm?.();
  }

  return {
    transport: 'worker',
    query(kind, modelId, payload, { timeoutMs, supersedeKey, signal } = {}) {
      if (closed) return Promise.reject(new HttpError(503, 'Viewer server closed'));
      if (!kinds.has(kind)) return Promise.reject(new HttpError(400, `Unknown query kind ${kind}`));
      if (!registry.has(modelId)) {
        return Promise.reject(new HttpError(404, 'Unknown model revision'));
      }
      const id = nextId++;
      return new Promise((resolve, reject) => {
        const limitMs = timeoutMs ?? QUERY_TIMEOUTS_MS[kind] ?? 30000;
        const query = { id, kind, modelId, payload, worker: null, done: false, resent: false };
        const onAbort = () => query.cancel(signal.reason ?? new HttpError(499, 'Query aborted'));
        query.finish = (ok, value) => {
          if (query.done) return;
          query.done = true;
          clearTimeout(query.timer);
          clearTimeout(query.startTimer);
          pending.delete(id);
          signal?.removeEventListener('abort', onAbort);
          if (supersedeKey !== undefined && latest.get(supersedeKey) === query) {
            latest.delete(supersedeKey);
          }
          if (ok) resolve(value);
          else reject(value);
        };
        query.cancel = error => {
          if (query.done) return;
          if (query.worker && !query.worker.dead) query.worker.child.send({ type: 'cancel', id });
          query.finish(false, error);
        };
        query.answer = message => {
          if (message.missing && !query.resent) {
            query.resent = true;
            send(query, true).catch(error => query.finish(false, error));
          } else if (message.ok) {
            query.finish(true, message.value);
          } else {
            query.finish(false, errorFrom(message.error));
          }
        };
        pending.set(id, query);
        if (supersedeKey !== undefined) {
          latest.get(supersedeKey)?.cancel(new HttpError(409, 'Superseded by a newer query'));
          latest.set(supersedeKey, query);
        }
        // The timeout covers the query itself, not the worker's start: it is
        // armed when the query reaches a ready worker (send), so a cold start
        // on a loaded machine cannot turn every first query into a 504.
        // A worker that never becomes ready still ends the query (503).
        const notReady = what => () => query.finish(false, new HttpError(503,
          `Query worker ${what} after ${WORKER_START_MS / 1000} s`));
        query.startTimer = setTimeout(notReady('not ready'), WORKER_START_MS);
        // The worker loads a kind's modules on its first query ('preparing');
        // the timeout restarts once they are loaded ('started').
        query.pause = () => {
          clearTimeout(query.timer);
          query.timer = null;
          query.preparing = true;
          clearTimeout(query.startTimer);
          query.startTimer = setTimeout(notReady('still loading kernel modules'), WORKER_START_MS);
        };
        query.arm = () => {
          if (query.done) return;
          clearTimeout(query.startTimer);
          query.timer ??= setTimeout(() => {
            const target = query.worker;
            query.finish(false, new HttpError(504, `Query ${kind} timed out after ${limitMs} ms`));
            stopWorker(target, new HttpError(503,
              `Query worker restarted after a ${kind} query timed out; retry`));
          }, limitMs);
        };
        if (signal?.aborted) {
          onAbort();
          return;
        }
        signal?.addEventListener('abort', onAbort, { once: true });
        send(query).catch(error => query.finish(false, error instanceof HttpError ? error
          : new HttpError(503, error.message)));
      });
    },
    pids: () => (worker && !worker.dead ? [worker.pid] : []),
    close() {
      closed = true;
      const target = worker;
      worker = null;
      for (const query of [...pending.values()]) {
        query.finish(false, new HttpError(503, 'Viewer server closed'));
      }
      if (target) {
        target.dead = true;
        killGroup(target.pid);
        untrackChild(target.pid);
      }
    },
  };
}

export function createQueryPool({ registry, handlers, worker = {} } = {}) {
  if (handlers) return inProcessPool({ registry, handlers });
  return workerPool({ registry, ...worker });
}
