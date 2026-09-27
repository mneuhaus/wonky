// Viewer server lifecycle.
//
// Bind first, then register: a busy port fails with EADDRINUSE before any
// snapshot is written. Requests that arrive while the inputs are still being
// registered wait for startup to finish. Every request passes the Host
// allowlist (SRV-13) and the same-origin check (SRV-10) before routing.
//
// Live sources (live-server, spec 3.1 and 10.4): `.fs`/`.py` inputs become live
// sessions that watch their files and build in a warm worker pool; `.brep.json`
// inputs keep the static behavior and start no build worker. The port is
// strict when `port` is given, otherwise derived from `derivePortFrom` (the
// first input's real path) with the next free port on collision.
// close() stops the watchers, kills every worker group, ends the event streams,
// closes the socket, writes the tab-reuse marker and removes the spool.
import { createServer } from 'node:http';
import { realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { checkHost, checkOrigin, HttpError, send } from './http.mjs';
import { createRouter, errorStatus } from './router.mjs';
import { createRegistry, inputLabel } from './registry.mjs';
import { createReports } from './reports.mjs';
import { createReviewStore } from './reviews.mjs';
import { createSourceStore } from './sources.mjs';
import { createSettingsStore } from './settings.mjs';
import { createEventHub } from './events.mjs';
import { createQueryPool } from './query-pool.mjs';
import { loadRoutes, ROUTE_MODULES } from './routes/index.mjs';
import { viewerDirectoryOf } from './static.mjs';
import { createBuildPool, createKernelFingerprint } from './live/pool.mjs';
import { createLiveSession } from './live/session.mjs';
import { DEFAULT_LIMITS, implicitWorkspace } from './workspace/load.mjs';
import {
  bindServer, DEFAULT_PORT_RANGE, derivePort, openBrowser, readSessionMarker, tabMayReconnect,
  waitForReconnect, writeSessionMarker,
} from './live/port.mjs';

const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
const MODEL_ID = /^[a-f0-9]{64}$/;
const PIN_GRACE_MS = 60000;

const closeServer = server => new Promise((done, fail) => {
  server.close(error => (error ? fail(error) : done()));
  server.closeIdleConnections?.();
});

// Every model id a review payload references (models, comparison, views,
// annotation targets), for archive-on-save of live revisions (spec D7).
export function referencedModels(value) {
  const ids = new Set();
  const add = id => {
    if (typeof id === 'string' && MODEL_ID.test(id)) ids.add(id);
  };
  for (const id of Array.isArray(value?.models) ? value.models : []) add(id);
  add(value?.comparison?.before);
  add(value?.comparison?.after);
  for (const annotation of Array.isArray(value?.annotations) ? value.annotations : []) {
    add(annotation?.view?.before);
    add(annotation?.view?.after);
    add(annotation?.target?.modelId);
  }
  return [...ids];
}

export async function createReviewServer({
  modelPaths = [],
  sources: liveInputs = [],
  build: flags = {},
  out = null,
  // A normalized workspace (src/viewer/workspace/load.mjs). Without one, the
  // plain inputs above form the implicit workspace (one model per input,
  // the same build flags and --out for every live source).
  workspace = null,
  root = projectRoot,
  reviewDirectory = join(root, 'reviews'),
  port,
  derivePortFrom,
  portRange = DEFAULT_PORT_RANGE,
  stateDirectory = join(root, 'tmp', 'viewer'),
  open = false,
  opener,
  routeModules = ROUTE_MODULES,
  log = message => console.error(message),
  terminal = null,
  onListening,
  live: liveOptions = {},
} = {}) {
  if (!workspace && (!Array.isArray(modelPaths) || !Array.isArray(liveInputs)
    || !modelPaths.length && !liveInputs.length)) {
    throw new Error('Pass at least one model or source');
  }
  const space = workspace ?? implicitWorkspace({
    modelPaths, sources: liveInputs, build: flags, out,
  });
  const limits = { ...DEFAULT_LIMITS, ...space.limits };
  const MiB = 1024 * 1024;
  const liveModels = space.models.filter(model => !model.static);
  // Two models of one file get distinct source ids (sourceId-key).
  const realOf = path => {
    try {
      return realpathSync(path);
    } catch {
      return path;
    }
  };
  const pathCounts = new Map();
  for (const model of liveModels) {
    const real = realOf(model.source);
    pathCounts.set(real, (pathCounts.get(real) ?? 0) + 1);
  }
  let origin;
  let router;
  let markReady;
  let markFailed;
  const ready = new Promise((done, fail) => {
    markReady = done;
    markFailed = fail;
  });
  ready.catch(() => {});

  const server = createServer(async (req, res) => {
    try {
      await ready;
      checkHost(req, origin);
      const url = new URL(req.url, origin);
      checkOrigin(req, origin);
      if (!(await router.handle(req, res, url))) send(res, 404, { error: 'Unknown route' });
    } catch (error) {
      if (res.headersSent) res.destroy(error);
      else send(res, error instanceof HttpError ? error.status : errorStatus(error, true),
        { error: error.message });
    }
  });
  const derived = (port === undefined || port === null) && derivePortFrom;
  const binding = await bindServer(server, derived
    ? { preferred: derivePort(derivePortFrom, { range: portRange }), range: portRange }
    : { port: port ?? 4310 });
  origin = `http://127.0.0.1:${binding.port}`;
  const url = origin + '/viewer/';
  const listening = { url, origin, port: binding.port, ...binding, reviewDirectory };
  onListening?.(listening);
  terminal?.notice('listening', listening);

  const inputs = space.models.filter(model => model.static).map(model => resolve(model.source));
  const events = createEventHub();
  const sources = createSourceStore({ root, sourceDirectory: join(reviewDirectory, 'sources') });
  const registry = createRegistry({
    reviewDirectory, sources, log,
    ring: {
      displayBudgetBytes: limits.displayBudgetMb * MiB,
      modelBudgetBytes: limits.modelBudgetMb * MiB,
      ...liveOptions.ring,
    },
    spoolDirectory: join(stateDirectory, 'spool', events.session),
  });
  const reports = createReports({ root });
  const reviewStore = createReviewStore({ reviewDirectory, registry, origin: () => origin });
  // Saving a review archives the live revisions it references first (D7), so
  // the review's snapshot paths exist after the server stops.
  const reviews = Object.create(reviewStore);
  reviews.save = async value => {
    for (const id of referencedModels(value)) {
      if (registry.isLive(id)) await registry.archive(id);
    }
    const saved = await reviewStore.save(value);
    events.publish('workspace-changed', { reason: 'review-saved', review: saved.id });
    return saved;
  };
  const settings = createSettingsStore({ reviewDirectory });
  const pool = createQueryPool({
    registry,
    ...(liveOptions.queryHandlers ? { handlers: liveOptions.queryHandlers } : {}),
    worker: liveOptions.queryWorker,
  });
  if (pool.transport === 'worker') {
    registry.setSceneBuilder((id, metadata) => pool.query('scene', id, { metadata }));
  }

  const sessions = [];
  let buildPool = null;
  const notice = (kind, data) => terminal?.notice(kind, data);
  if (liveModels.length) {
    // Exporters preloaded in the warm workers: the widest --out format.
    const formats = liveModels.map(model => model.out?.format).filter(Boolean);
    const outputs = formats.includes('all') ? 'all' : formats[0];
    buildPool = createBuildPool({
      fingerprint: createKernelFingerprint(),
      env: {
        ...(outputs ? { WONKY_VIEW_OUTPUTS: outputs } : {}),
        ...liveOptions.workerEnv,
      },
      concurrency: limits.concurrency,
      maxWorkers: limits.maxWorkers,
      maxRssBytes: limits.workerRssMb * MiB,
      ...liveOptions.pool,
      onEvent(name, data) {
        if (name === 'worker-failed') events.publish('worker-failed', data);
        else if (name === 'worker-backoff' || name === 'worker-recycled') notice(name, data);
        liveOptions.onPoolEvent?.(name, data);
      },
    });
    for (const model of liveModels) {
      sessions.push(createLiveSession({
        source: { path: model.source, language: model.language },
        key: model.key,
        idSuffix: pathCounts.get(realOf(model.source)) > 1 ? model.key : null,
        flags: model.build ?? {}, out: model.out, registry, events, pool: buildPool,
        stateDirectory, notice, graceMs: liveOptions.graceMs, debounceMs: liveOptions.debounceMs,
      }));
    }
  }
  const sessionOf = key => sessions.find(session => session.key === key) ?? null;
  // The model the newest registration of a static input path has.
  const staticModelId = path => registry.list().filter(metadata => metadata.sourcePath === path)
    .at(-1)?.id ?? null;
  // GET /api/workspace `tree` and the SSE hello (docs/viewer/workspace.md, 2).
  const tree = () => ({
    name: space.name, file: space.file, implicit: !!space.implicit,
    open: space.open ?? (space.assemblies.length ? `assembly:${space.assemblies[0].key}`
      : `model:${space.models[0].key}`),
    models: space.models.map(model => {
      const session = sessionOf(model.key);
      return {
        key: model.key, label: model.label, path: model.source, language: model.language,
        static: model.static, sourceId: session?.id ?? null,
        sourceKey: session && pathCounts.get(realOf(model.source)) > 1
          ? `${session.path}#${model.key}` : resolve(model.source),
        modelId: session ? session.lastGood?.modelId ?? null : staticModelId(resolve(model.source)),
        feature: model.build?.feature ?? null,
        matrix: model.matrix,
      };
    }),
    assemblies: space.assemblies.map(assembly => ({
      key: assembly.key, label: assembly.label,
      instances: assembly.instances.map(instance => ({ ...instance })),
    })),
    limits,
  });
  const status = () => sessions.map(session => session.status());
  registry.attachSources(status);
  events.setHello(() => ({
    url, port: binding.port, portDerived: binding.derived,
    sources: status(),
    static: inputs,
    tree: tree(),
    workers: buildPool?.status() ?? null,
  }));
  if (terminal) events.subscribe(event => terminal.event(event.name, event.data));

  // Client pins end 60 s after the client's last event stream closed.
  const pinTimers = new Map();
  events.onConnection(({ type, clientId }) => {
    clearTimeout(pinTimers.get(clientId));
    pinTimers.delete(clientId);
    if (type !== 'close' || events.clientIds().includes(clientId)) return;
    const timer = setTimeout(() => {
      pinTimers.delete(clientId);
      if (!events.clientIds().includes(clientId)) registry.unpin(clientId);
    }, PIN_GRACE_MS);
    timer.unref?.();
    pinTimers.set(clientId, timer);
  });

  const live = {
    status,
    session: id => sessions.find(session => session.id === id) ?? null,
    workers: () => (buildPool ? { build: buildPool.status(), query: pool.pids() } : null),
  };
  const workspaceApi = { tree };

  const shutdown = async () => {
    const closing = sessions.map(session => session.close());
    for (const timer of pinTimers.values()) clearTimeout(timer);
    await buildPool?.close();
    await Promise.all(closing);
    pool.close();
    events.close();
  };

  try {
    await registry.init();
    for (const path of inputs) {
      await registry.register(await readFile(path), inputLabel(path), path);
    }
    // Previously reviewed revisions stay resolvable after an output file changes.
    await registry.loadArchive();
    await reports.refresh();
    router = createRouter();
    const ctx = {
      registry, events, sources, reports, settings, pool, origin, reviewDirectory,
      reviews, inputs, root, viewerDirectory: viewerDirectoryOf(projectRoot), live,
      workspace: workspaceApi,
    };
    await loadRoutes(router, ctx, { modules: routeModules, log });
    for (const session of sessions) await session.prepare();
    // A source that cannot be read fails its own model only; a server with
    // nothing it could show (every live source unreadable, no saved model)
    // refuses to start as before.
    const unavailable = sessions.map(session => session.unavailable).filter(Boolean);
    if (unavailable.length && unavailable.length === sessions.length && !inputs.length) {
      throw unavailable[0];
    }
  } catch (error) {
    markFailed(error);
    await shutdown();
    await closeServer(server).catch(() => {});
    await registry.close().catch(() => {});
    throw error;
  }
  markReady();
  terminal?.hello(events.hello(null));
  buildPool?.setWanted(true);
  for (const session of sessions) session.start();

  const sessionDirectory = join(stateDirectory, 'sessions');
  const opened = open && sessions.length ? (async () => {
    const marker = await readSessionMarker(sessionDirectory, binding.port);
    if (tabMayReconnect(marker)
      && await waitForReconnect(() => events.clients() > 0, liveOptions.reconnect)) {
      notice('tab', { reused: true, url });
      return { opened: false, reason: 'reconnected' };
    }
    if (events.clients() > 0) return { opened: false, reason: 'connected' };
    const command = openBrowser(url, { opener });
    notice('tab', { reused: false, url, command });
    return { opened: true, command };
  })() : Promise.resolve({ opened: false, reason: open ? 'no live source' : 'not requested' });

  let closing;
  return {
    server,
    url,
    origin,
    port: binding.port,
    portDerived: binding.derived,
    reviewDirectory,
    models: registry.models,
    registry,
    events,
    pool,
    buildPool,
    sessions,
    workspace: workspaceApi,
    opened,
    // Idempotent: a second close() resolves once the first has finished.
    close() {
      closing ??= (async () => {
        const clients = events.clients();
        await shutdown();
        await closeServer(server);
        if (sessions.length) {
          await writeSessionMarker(sessionDirectory, binding.port, {
            shutdownAt: new Date().toISOString(), clients, pid: process.pid, url,
            sources: sessions.map(session => session.path),
          }).catch(() => {});
        }
        await registry.close().catch(() => {});
      })();
      return closing;
    },
  };
}
