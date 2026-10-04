// Per-source live session (spec 3.1, 10.4). Package: live-server.
//
//   const session = createLiveSession({ source, flags, out, registry, events, pool, ... })
//   await session.prepare()    real path, watch set, first hashed read; a source
//                              that cannot be read does not throw: its r1 fails
//                              (`session.unavailable` says why) and the watcher
//                              builds it once it reads
//   session.start()            previous-session seed r0, build r1, start watching
//   session.rebuild(reason)    -> { jobId }   build the current bytes again
//   session.cancel()           -> { jobId } | null
//   session.status()           the /api/live source entry
//   await session.close()
//
// Revisions are session-local attempt numbers: every queued build takes the
// next number (r1, r2 …); r0 is the previous session's last good model. Only
// the latest job of a source may register: a newer save supersedes the
// running job (build-cancelled at once, its process group killed after the
// pool's grace period) and results with a stale job id are dropped. A failure
// keeps the last good revision on screen; nothing partial is registered.
import { createHash } from 'node:crypto';
import { mkdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { readWatchSet, watchSources } from './watch.mjs';
import { writeOutputs } from './out.mjs';
import { manifestInputFiles } from '../../modules.mjs';
import { internalFailure, missingSourceFailure, unreadableSourceFailure } from './failure.mjs';

const sha256 = value => createHash('sha256').update(value).digest('hex');

export const LANGUAGES = Object.freeze({ '.fs': 'featurescript', '.py': 'python', '.step': 'step', '.stp': 'step' });

export function languageOf(path) {
  if (/\.brep\.json$/i.test(path)) return 'brep';
  return LANGUAGES[extname(path).toLowerCase()] ?? null;
}

// buildPython's default timeout (src/python.mjs) and the margin after which
// the pool gives up on an interpreter that did not exit.
export const PYTHON_TIMEOUT_MS = 30000;
export const PYTHON_DEADLINE_MARGIN_MS = 2000;

const slug = text => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  || 'source';

export const sourceIdOf = realPath => `${slug(basename(realPath, extname(realPath)))}-`
  + sha256(realPath).slice(0, 6);

// Files of a frozen module manifest: exactly the list the loader reads
// (src/modules.mjs manifestInputFiles), so schema 2 resolves against the
// manifest's `store` root. An unreadable or unsupported manifest has none;
// its build reports the error.
export function manifestFiles(manifestPath, bytes) {
  try {
    return manifestInputFiles(manifestPath, JSON.parse(bytes));
  } catch {
    return [];
  }
}

// Watch set (spec 10.4): .fs -> the source, its manifest (--modules or a
// sibling modules.json, watched even while absent) and the files the manifest
// lists; .py -> the source, plus (after each build, see pythonModules) the
// project files the build loaded, as recorded by the runner (D5).
export async function watchSetOf(path, language, { moduleManifest } = {}) {
  if (language !== 'featurescript') return [{ path, role: 'source' }];
  const manifest = moduleManifest ? resolve(moduleManifest) : join(dirname(path), 'modules.json');
  const entries = [{ path, role: 'source' }, { path: manifest, role: 'manifest' }];
  let bytes = null;
  try {
    bytes = await readFile(manifest);
  } catch {
    // Absent: watched, so creating it rebuilds.
  }
  if (bytes) {
    for (const file of manifestFiles(manifest, bytes)) entries.push({ path: file, role: 'module' });
  }
  return entries;
}

// Build options that change the model (the last-good cache key): a restart
// with another --feature or --param never seeds r0 from a different model.
export const buildIdentity = flags => JSON.stringify({
  feature: flags.feature ?? null,
  parameters: Object.fromEntries(Object.entries(flags.parameters ?? {}).sort()),
  moduleManifest: flags.moduleManifest ? resolve(flags.moduleManifest) : null,
  modelingPolicy: flags.modelingPolicy ?? null,
});

const lastGoodPaths = (stateDirectory, realPath, flags = {}) => {
  const key = sha256(`${realPath}\u0000${buildIdentity(flags)}`).slice(0, 16);
  const directory = join(stateDirectory, 'live-cache');
  return {
    directory,
    model: join(directory, `${key}.brep.json`),
    meta: join(directory, `${key}.json`),
  };
};

async function writeAtomic(path, contents) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  try {
    await writeFile(temporary, contents);
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

export function createLiveSession({
  source,
  key = null,
  idSuffix = null,
  flags = {},
  out = null,
  registry,
  events,
  pool,
  stateDirectory,
  graceMs = 250,
  debounceMs = 75,
  notice = () => {},
  now = () => Date.now(),
}) {
  const path = resolve(source.path);
  const language = source.language ?? languageOf(path);
  if (!['featurescript', 'python', 'step'].includes(language)) {
    throw new Error(`Unsupported live source ${path}: pass a .fs, .py, .step or .stp file`);
  }
  const label = basename(path, extname(path));
  let realPath = path;
  const idOf = file => sourceIdOf(file) + (idSuffix ? `-${idSuffix}` : '');
  let id = idOf(path);
  let watchEntries = [];
  let watcher = null;
  let initial = null;
  let seedFound = null;
  let known = new Map();
  let counter = 0;
  let job = null;
  let registering = null;
  let state = 'starting';
  let current = null;
  let lastGood = null;
  let lastFailure = null;
  // Why the source could not be read at start: `unreadable` is an error other
  // than ENOENT (a directory, no permission), `unavailable` the start error
  // the server reports when no model at all can be read.
  let unreadable = null;
  let unavailable = null;
  let kernelFingerprint = null;
  let closed = false;
  const notes = [];
  const byModel = new Map();
  // Result handling in flight (registration, --out, cache writes): close()
  // waits for it, so nothing writes after the server has stopped.
  const pending = new Set();
  let writes = Promise.resolve();
  const track = promise => {
    pending.add(promise);
    promise.finally(() => pending.delete(promise)).catch(() => {});
    return promise;
  };

  // Workspace identity of the revisions (library group, revision facts): the
  // path, or path#key when two workspace models build the same file.
  const liveIdentity = () => ({
    ...(key ? { key } : {}), ...(idSuffix ? { sourceKey: `${path}#${key ?? idSuffix}` } : {}),
  });

  const publish = (name, data) => {
    if (!closed) events.publish(name, { sourceId: id, path, ...data });
  };

  const manifestPath = bytes => {
    if (language !== 'featurescript') return undefined;
    if (flags.moduleManifest) return resolve(flags.moduleManifest);
    const sibling = join(dirname(path), 'modules.json');
    return bytes.get(sibling) ? sibling : undefined;
  };

  const optionsFor = bytes => ({
    feature: flags.feature,
    parameters: flags.parameters ?? {},
    moduleManifest: manifestPath(bytes),
    maxSteps: flags.maxSteps,
    modelingPolicy: flags.modelingPolicy,
    python: flags.python,
    timeoutMs: flags.timeoutMs,
    maxRequests: flags.maxRequests,
  });

  const updateNotes = bytes => {
    notes.length = 0;
    const manifest = manifestPath(bytes);
    if (manifest) {
      notes.push(`Manifest-bound source: every edit fails with kind provenance until ${manifest}`
        + ' is recaptured (spec D4)');
    }
  };

  // Python: watch every project file the build loaded (source.modules of the
  // model, or the files loaded before a failure). A success replaces the
  // module list; a failure only adds, since it may have stopped before an
  // import. Files already read by the build join the baseline when their
  // bytes still match the recorded SHA-256, so they never trigger a rebuild
  // of their own; a file edited during the build does.
  function pythonModules(files, { replace }) {
    if (language !== 'python' || !Array.isArray(files) || closed) return;
    const skip = new Set([path, realPath]);
    const recorded = files.filter(file => !skip.has(file.path));
    const previous = watchEntries.filter(entry => entry.role === 'module');
    const modules = new Map((replace ? [] : previous).map(entry => [entry.path, entry]));
    for (const file of recorded) modules.set(file.path, { path: file.path, role: 'module' });
    const entries = [watchEntries.find(entry => entry.role === 'source') ?? { path,
      role: 'source' }, ...[...modules.values()].sort((a, b) => a.path.localeCompare(b.path))];
    const paths = entries.map(entry => entry.path);
    if (paths.join('\n') === watchEntries.map(entry => entry.path).join('\n')) return;
    const added = new Set(paths.filter(file => !watchEntries.some(entry => entry.path === file)));
    watchEntries = entries;
    watcher?.update(paths, {
      adopt: new Map(recorded.filter(file => added.has(file.path))
        .map(file => [file.path, file.sha256])),
    });
  }

  // A superseded build may drain (keep its warm worker, bounded, see
  // pool.mjs); an explicit cancel stops it after the grace.
  function supersede(old, by) {
    pool.cancel(old.jobId, { graceMs, drain: !!by });
    current = { revision: old.revision, status: 'cancelled', jobId: old.jobId };
    publish('build-cancelled', {
      jobId: old.jobId, revision: old.revision, reason: by ? 'superseded' : 'cancelled',
      supersededBy: by ?? null, graceMs,
    });
  }

  function queueBuild(reason, set) {
    if (closed) return null;
    const bytes = set.bytes.get(path);
    const revision = ++counter;
    const jobId = pool.allocate();
    if (job) supersede(job, { jobId, revision });
    updateNotes(set.bytes);
    const options = optionsFor(set.bytes);
    job = {
      jobId, revision, reason, phase: 'queued', queuedAt: now(), startedAt: null,
      hash: set.hash, worker: null, pid: null, sourceBytes: bytes,
    };
    const mine = job;
    state = 'queued';
    publish('build-queued', { jobId, revision, reason, hash: set.hash });
    if (!bytes) {
      job = null;
      const context = { jobId, revision, sourceId: id, source: { language } };
      track(fail(mine, {
        failure: unreadable ? unreadableSourceFailure(path, unreadable, context)
          : missingSourceFailure(path, context),
      }));
      return { jobId, revision };
    }
    unreadable = null;
    pool.submit({
      type: 'build', sourceId: id, revision, language, sourcePath: path, bytes, options, label,
      // Python: the pool fails the job and kills its process group if the
      // interpreter outlives its timeout (see pool.mjs expire()).
      ...(language === 'python' ? {
        deadlineMs: (options.timeoutMs ?? PYTHON_TIMEOUT_MS) + PYTHON_DEADLINE_MARGIN_MS,
        options: { ...options, timeoutMs: options.timeoutMs ?? PYTHON_TIMEOUT_MS },
      } : {}),
      outputs: out ? { prefix: out.prefix, format: out.format, deviationMm: out.deviationMm }
        : null,
      lastGood: lastGood && { revision: lastGood.revision, modelId: lastGood.modelId },
    }, {
      onStart: info => {
        if (job !== mine) return;
        mine.startedAt = now();
        mine.worker = info.worker;
        mine.pid = info.pid;
        mine.phase = 'starting';
        state = 'building';
        publish('build-started', {
          jobId, revision, worker: info.worker, pid: info.pid, queuedMs: info.queuedMs,
          kernelFingerprint: info.fingerprint ?? null,
        });
      },
      onPhase: message => {
        if (job !== mine) return;
        mine.phase = message.phase;
        publish('build-phase', {
          jobId, revision, phase: message.phase,
          elapsedMs: mine.startedAt ? now() - mine.startedAt : 0,
        });
      },
      onDone: (result, info) => track(finish(mine, result, info, options)),
    }, { jobId });
    return { jobId, revision };
  }

  async function finish(finished, result, info = {}, options = {}) {
    if (job !== finished) {
      notice('dropped', { sourceId: id, jobId: result.jobId, revision: finished.revision });
      return;
    }
    job = null;
    pythonModules(result.sourceFiles, { replace: result.ok });
    if (!result.ok) {
      await fail(finished, result);
      return;
    }
    registering = finished;
    const started = now();
    let registered;
    try {
      registered = await registry.registerLive({
        bytes: result.bytes,
        sceneText: result.sceneText,
        sceneBytes: result.sceneBytes,
        bounds: result.bounds,
        draw: result.draw,
        label,
        sourcePath: path,
        frozen: new Map([[result.sourceSha256, { file: path, bytes: finished.sourceBytes }]]),
        live: {
          sourceId: id, path, ...liveIdentity(), revision: finished.revision,
          builtAt: new Date(now()).toISOString(),
          kernelFingerprint: info.fingerprint ?? null,
        },
      });
    } catch (error) {
      registering = null;
      await fail(finished, {
        failure: internalFailure(`Registering the built model failed: ${error.message}`, {
          jobId: finished.jobId, revision: finished.revision, sourceId: id,
          source: { path, language },
        }),
      });
      return;
    }
    registering = null;
    if (closed) return;
    const modelId = registered.metadata.id;
    const sameAs = byModel.get(modelId) ?? null;
    if (sameAs === null) byModel.set(modelId, finished.revision);
    kernelFingerprint = info.fingerprint ?? kernelFingerprint;
    // buildMs: from the worker start of the job to registration (what the
    // terminal and the pill call the build time); totalMs adds the queue wait.
    const timings = {
      queuedMs: finished.startedAt ? finished.startedAt - finished.queuedAt : null,
      ...result.timings,
      registerMs: now() - started,
      buildMs: now() - (finished.startedAt ?? finished.queuedAt),
      totalMs: now() - finished.queuedAt,
    };
    const notices = result.notices ?? [];
    lastGood = {
      revision: finished.revision, modelId, builtAt: registered.metadata.live.builtAt,
      previousSession: false, notices,
    };
    current = { revision: finished.revision, status: 'ok', modelId, jobId: finished.jobId };
    lastFailure = null;
    if (!job) state = 'ok';
    registry.setServerPins?.(id, [modelId]);
    publish('revision', {
      jobId: finished.jobId, revision: finished.revision, modelId, label, sameAs,
      previousSession: false, timings, summary: result.summary,
      displayNotes: result.displayNotes ?? [], notices,
      kernelFingerprint: info.fingerprint ?? null,
      worker: { pid: info.pid ?? null, builds: info.builds ?? null },
      output: result.execution ?? null,
    });
    publish('workspace-changed', { reason: 'revision', modelId, revision: finished.revision });
    // In registration order, so a slow write of r2 never lands after r3's.
    writes = writes.then(() => afterRevision(result, modelId, finished));
    await writes;
  }

  async function afterRevision(result, modelId, finished) {
    if (out && result.outputs) {
      try {
        const written = await writeOutputs(out.prefix, result, { format: out.format });
        notice('outputs', { sourceId: id, revision: finished.revision, ...written });
      } catch (error) {
        notice('error', { sourceId: id, message: `--out write failed: ${error.message}` });
      }
    }
    try {
      const cache = lastGoodPaths(stateDirectory, realPath, flags);
      await writeAtomic(cache.model, result.bytes);
      await writeAtomic(cache.meta, JSON.stringify({
        schema: 'wonky.view-last-good/1', path, realPath, modelId, revision: finished.revision,
        builtAt: new Date(now()).toISOString(), flags: { ...flags, python: undefined },
      }, null, 2) + '\n');
    } catch (error) {
      notice('error', { sourceId: id, message: `last-good cache not written: ${error.message}` });
    }
  }

  async function fail(finished, result) {
    const failure = { ...result.failure, lastGood: lastGood && { ...lastGood } };
    if (result.download?.bytes) {
      try {
        const file = join(stateDirectory, 'failed-display', `${result.download.modelId}.brep.json`);
        await writeAtomic(file, result.download.bytes);
        failure.download = { modelId: result.download.modelId, path: file };
      } catch {
        // The failure itself is still reported.
      }
    }
    if (closed) return;
    current = { revision: finished.revision, status: 'failed', jobId: finished.jobId };
    lastFailure = failure;
    if (!job) state = 'failed';
    publish('build-failed', {
      jobId: finished.jobId, revision: finished.revision, failure, lastGood: failure.lastGood,
    });
  }

  // r0: the previous session's model (--out, else the last-good cache). It is
  // read during prepare(), prepared by the build worker ahead of r1 (so the
  // view has a model while r1 builds) and never written back.
  async function findSeed() {
    const cache = lastGoodPaths(stateDirectory, realPath, flags);
    const candidates = [
      ...(out ? [{ file: `${out.prefix}.brep.json`, origin: '--out' }] : []),
      { file: cache.model, origin: 'last-good cache' },
    ];
    for (const candidate of candidates) {
      let bytes;
      try {
        bytes = await readFile(candidate.file);
      } catch {
        continue;
      }
      let model;
      try {
        model = JSON.parse(bytes);
      } catch {
        notice('note', { sourceId: id, message: `${candidate.file} is not valid JSON; no r0` });
        continue;
      }
      const recorded = model?.sourceMap?.source?.file ?? model?.source?.filename ?? null;
      if (recorded !== path) {
        notice('note', {
          sourceId: id, message: `${candidate.file} was built from another source; no r0`,
        });
        continue;
      }
      return { bytes, candidate };
    }
    return null;
  }

  function prepareSeed(bytes, candidate) {
    pool.submit({ type: 'prepare', sourceId: id, revision: 0, sourcePath: path, bytes, label }, {
      onDone: result => track((async () => {
        if (!result.ok || closed) {
          notice('note', { sourceId: id, message: `previous session model not shown: `
            + `${result.failure?.error?.message ?? 'worker failed'}` });
          return;
        }
        let registered;
        try {
          registered = await registry.registerLive({
            bytes: result.bytes, sceneText: result.sceneText, sceneBytes: result.sceneBytes,
            bounds: result.bounds, draw: result.draw, label, sourcePath: path,
            live: {
              sourceId: id, path, ...liveIdentity(), revision: 0, builtAt: null,
              previousSession: true,
              origin: candidate.origin, file: candidate.file,
            },
          });
        } catch (error) {
          notice('note', {
            sourceId: id, message: `previous session model rejected: ${error.message}`,
          });
          return;
        }
        if (closed) return;
        const modelId = registered.metadata.id;
        if (!byModel.has(modelId)) byModel.set(modelId, 0);
        if (!lastGood) {
          lastGood = { revision: 0, modelId, builtAt: null, previousSession: true };
          registry.setServerPins?.(id, [modelId]);
        }
        publish('revision', {
          jobId: null, revision: 0, modelId, label, sameAs: null, previousSession: true,
          origin: candidate.origin, file: candidate.file, summary: result.summary,
          displayNotes: result.displayNotes ?? [], timings: result.timings,
        });
        publish('workspace-changed', { reason: 'revision', modelId, revision: 0 });
      })()),
    });
  }

  const onChange = (hash, bytes, changed) => {
    if (closed) return;
    const manifest = watchEntries.find(entry => entry.role === 'manifest');
    if (manifest && changed.includes(manifest.path)) {
      watchSetOf(path, language, { moduleManifest: flags.moduleManifest }).then(entries => {
        const paths = entries.map(entry => entry.path);
        if (paths.join('\n') === watchEntries.map(entry => entry.path).join('\n')) return;
        watchEntries = entries;
        watcher?.update(paths);
      }, () => {});
    }
    known = bytes;
    publish('source-changed', { files: changed, hash });
    pool.resume();
    queueBuild('save', { hash, bytes });
  };

  const session = {
    get id() {
      return id;
    },
    key,
    path,
    language,
    label,
    get state() {
      return state;
    },
    get watched() {
      return watchEntries.map(entry => ({
        path: entry.path, role: entry.role,
        exists: Boolean((watcher?.bytes ?? known).get(entry.path)),
      }));
    },
    get current() {
      return current;
    },
    get lastGood() {
      return lastGood;
    },
    get lastFailure() {
      return lastFailure;
    },
    // The start error of a source that could not be read in prepare(), else null.
    get unavailable() {
      return unavailable;
    },
    get job() {
      const active = job ?? registering;
      return active && {
        jobId: active.jobId, revision: active.revision, reason: active.reason,
        state: active === registering ? 'registering' : active.startedAt ? 'building' : 'queued',
        phase: active.phase, worker: active.worker, pid: active.pid,
        queuedAt: new Date(active.queuedAt).toISOString(),
        elapsedMs: active.startedAt ? now() - active.startedAt : 0,
      };
    },
    // A source that cannot be read is one failed model, not a failed server
    // (a workspace keeps its other models): missing, it is watched like a
    // deleted source; unreadable, its first revision reports the error.
    async prepare() {
      let readError = null;
      try {
        realPath = await realpath(path);
      } catch (error) {
        readError = error;
        if (error.code !== 'ENOENT') unreadable = error;
      }
      id = idOf(realPath);
      watchEntries = await watchSetOf(path, language, { moduleManifest: flags.moduleManifest });
      try {
        initial = await readWatchSet(watchEntries.map(entry => entry.path));
      } catch (error) {
        readError ??= error;
        unreadable ??= error;
        initial = { hash: null, bytes: new Map(watchEntries.map(entry => [entry.path, null])) };
      }
      if (!initial.bytes.get(path)) {
        unavailable = new Error(`Cannot read live source ${path}: `
          + `${readError?.message ?? 'no bytes'}`, { cause: readError ?? undefined });
      }
      known = initial.bytes;
      updateNotes(initial.bytes);
      seedFound = await findSeed();
      return session;
    },
    start() {
      state = 'queued';
      if (seedFound) prepareSeed(seedFound.bytes, seedFound.candidate);
      seedFound = null;
      watcher = watchSources(watchEntries.map(entry => entry.path), {
        debounceMs, initialHash: initial.hash, initialBytes: initial.bytes, onChange,
        onError: error => notice('error', { sourceId: id, message: `watch: ${error.message}` }),
      });
      queueBuild('start', initial);
    },
    async rebuild(reason = 'rebuild') {
      const set = await readWatchSet(watchEntries.map(entry => entry.path));
      if (!set.bytes.get(path)) throw new Error(`Live source ${path} is missing`);
      pool.resume();
      return queueBuild(reason, set);
    },
    cancel() {
      if (!job) return null;
      const cancelled = job;
      job = null;
      supersede(cancelled, null);
      state = lastFailure ? 'failed' : lastGood ? 'ok' : 'cancelled';
      return { jobId: cancelled.jobId, revision: cancelled.revision };
    },
    status() {
      return {
        id, key, path, realPath, label, language, state,
        watched: session.watched,
        current, lastGood, lastFailure,
        job: session.job,
        kernelFingerprint,
        notes: [...notes],
        flags: {
          feature: flags.feature ?? null, parameters: flags.parameters ?? {},
          out: out ? { prefix: out.prefix, format: out.format } : null,
        },
      };
    },
    watcherHandles: () => watcher?.handles() ?? 0,
    // Stops watching and building; resolves once in-flight result handling
    // (registration, --out and cache writes) has finished.
    close() {
      closed = true;
      watcher?.close();
      if (job) pool.cancel(job.jobId, { graceMs: 0, drain: false });
      job = null;
      return Promise.allSettled([...pending]).then(() => {});
    },
  };
  return session;
}
