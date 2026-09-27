// Build worker pool: one busy worker per source (two at most) plus one warm
// spare, process-group kill.
// Package: live-server (spec 10.4, D1).
//
//   const pool = createBuildPool({ fingerprint, onEvent, ... })
//   const job = pool.submit(message, { onStart, onPhase, onDone })   -> { jobId }
//   pool.cancel(jobId, { graceMs, drain })   at most graceMs, then SIGKILL of the group;
//                                     drain (superseded): keep a busy worker while no warm
//                                     replacement is idle, bounded (see below)
//   pool.setWanted(true)              keep a warm spare (live sessions only)
//   pool.resume()                     after `worker-failed`: allow starts again
//   pool.status(), pool.pids(), pool.close()
//
// Workers are `child_process.fork` children with advanced serialization, each
// the leader of its own process group (`detached`), so a kill also ends a
// Python grandchild. At most one job per source runs at a time and at most
// `concurrency` (2) jobs overall, so a slow build of one source never holds
// back another source while a warm worker is idle. A cancelled job stops
// counting at once, so its successor starts on the spare immediately while
// the old one gets its grace period. Results of cancelled jobs are dropped.
// After the grace a superseded job's worker is killed only when enough warm
// workers are idle (the queue plus the spare); otherwise it drains: it keeps
// running the stale build and is killed as soon as a warm replacement is
// idle, or takes the next job itself when it finishes first. Killing it at
// once made a burst of saves use up every warm worker, so the final save
// waited for a cold start (fix round 2: 25.8 s instead of 0.4 s under load).
// Draining is bounded, so hanging stale builds can never hold the pool
// (fix round 3: ten superseded `time.sleep(600)` builds deadlocked it):
//   - a drained build is killed once it has run 1.5 times as long as the
//     last build of its source took (at least `minDrainMs`; before the first
//     build of the source: as long as the last worker start took, `drainMs`
//     before any): a build that runs that much longer than usual is taken to
//     hang, and it holds a worker and a CPU;
//   - a job that needs a worker start while all `maxWorkers` slots are taken
//     kills the most recently started drained build for the slot, so a new
//     save always gets a worker;
//   - a job's deadline (below) still applies after it was cancelled;
//   - an explicit cancel (`drain: false`) never drains.
// When every warm worker drains, the newest job takes whichever is ready
// first: a drained worker that finishes, or a fresh worker (a cold start).
// Missing workers are started in parallel unless a start failed recently.
// A job whose message carries `deadlineMs` (Python: its timeout plus a
// margin) that has not answered by then is failed as a timeout and its
// worker's process group is killed: that also ends an interpreter that
// outlived the kill of its direct child (uv run keeps python as a grandchild).
// Start failures back off 1, 2, 4 … 30 s; three within 60 s emit
// `worker-failed` and stop all starts until resume(). Workers forked in the
// same batch that all fail count as one attempt. A worker that fails to start
// reports its error over IPC (`start-failed`), so events carry the error
// message, not the last line of a stack trace. Workers are recycled
// after `maxBuilds` builds, above `maxRssBytes`, or when the kernel
// fingerprint differs from the one taken when they were forked.
// Every worker group is killed on close() and, synchronously, on process exit.
import { fork } from 'node:child_process';
import { createHash } from 'node:crypto';
import { watch } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { basename, dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { failurePayload, internalFailure } from './failure.mjs';

const WORKER_PATH = fileURLToPath(new URL('./build-worker.mjs', import.meta.url));
const PROJECT_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const TAIL = 4096;

const children = new Set();
let exitHook = false;

export function killGroup(pid) {
  if (!pid) return;
  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // Already gone.
    }
  }
}

// Kills every worker group this process started (exit, signals, crashes).
export function killAllWorkers() {
  for (const pid of children) killGroup(pid);
  children.clear();
}

export function trackChild(pid) {
  children.add(pid);
  if (!exitHook) {
    exitHook = true;
    process.on('exit', killAllWorkers);
  }
}

export const untrackChild = pid => children.delete(pid);

// Kernel fingerprint: size and mtime of every file a worker loads, i.e. the
// import closure of the worker entries: static and dynamic relative JS
// imports, `new URL('./x.bend' | './x.py' | './x.json', import.meta.url)`
// references and Bend `import ./x.bend as X` lines. Directories other
// workflows edit but builds never load (src/lang, kernel/proto …) are outside
// the closure and never recycle a worker.
//
//   const fingerprint = createKernelFingerprint({ entries })
//   await fingerprint()           cached hash (recomputed after a watched change)
//   fingerprint.watch(onChange)   fs.watch on the closure's directories; onChange()
//                                 after a change to one of its files -> unwatch()
const JS_IMPORT = new RegExp([
  String.raw`(?:import|export)\s[^'"]*?from\s*['"](\.{1,2}\/[^'"]+)['"]`,
  String.raw`import\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)`,
  String.raw`new URL\(\s*['"](\.{1,2}\/[^'"]+\.(?:bend|mjs|py|json))['"]`,
].join('|'), 'g');
const BEND_IMPORT = /^\s*import\s+(\S+\.bend)\s+as\s+\w+/gm;

export const WORKER_ENTRIES = Object.freeze([
  'src/viewer/live/build-worker.mjs', 'src/viewer/query-worker.mjs',
]);

export async function importClosure(entries, root = PROJECT_ROOT) {
  const seen = new Set();
  const pending = entries.map(entry => resolve(root, entry));
  while (pending.length) {
    const file = pending.pop();
    if (seen.has(file)) continue;
    let text;
    try {
      text = await readFile(file, 'utf8');
    } catch {
      continue;
    }
    seen.add(file);
    if (!/\.(m?js|bend)$/.test(file)) continue;
    const pattern = file.endsWith('.bend') ? BEND_IMPORT : JS_IMPORT;
    for (const match of text.matchAll(pattern)) {
      const specifier = match.slice(1).find(Boolean);
      pending.push(resolve(dirname(file), specifier));
    }
  }
  return [...seen].sort();
}

export function createKernelFingerprint({
  root = PROJECT_ROOT, entries = WORKER_ENTRIES, watchImpl = watch,
} = {}) {
  let files = null;
  let cached = null;
  let pending = null;
  let watchers = [];
  const compute = async () => {
    files = await importClosure(entries, root);
    const hash = createHash('sha256');
    for (const file of files) {
      try {
        const info = await stat(file);
        hash.update(`${relative(root, file)}\t${info.size}\t${info.mtimeMs}\n`);
      } catch {
        hash.update(`${relative(root, file)}\tmissing\n`);
      }
    }
    return hash.digest('hex').slice(0, 16);
  };
  const fingerprint = () => {
    if (cached) return Promise.resolve(cached);
    pending ??= compute().then(value => {
      cached = value;
      return value;
    }).finally(() => {
      pending = null;
    });
    return pending;
  };
  let generation = 0;
  const close = () => {
    for (const watcher of watchers) watcher.close();
    watchers = [];
  };
  // Also cancels a watch() still waiting for its first fingerprint.
  const unwatch = () => {
    generation++;
    close();
  };
  fingerprint.files = () => files ?? [];
  fingerprint.watch = async onChange => {
    const mine = ++generation;
    await fingerprint();
    if (mine !== generation) return unwatch;
    close();
    const byDirectory = new Map();
    for (const file of files) {
      if (!byDirectory.has(dirname(file))) byDirectory.set(dirname(file), new Set());
      byDirectory.get(dirname(file)).add(basename(file));
    }
    for (const [directory, names] of byDirectory) {
      try {
        const watcher = watchImpl(directory, { persistent: false }, (_event, name) => {
          if (name && !names.has(String(name))) return;
          cached = null;
          onChange();
        });
        watcher.on('error', () => watcher.close());
        watchers.push(watcher);
      } catch {
        // A directory that cannot be watched only delays recycling.
      }
    }
    return unwatch;
  };
  fingerprint.unwatch = unwatch;
  fingerprint.handles = () => watchers.length;
  return fingerprint;
}

const tail = text => (text.length > TAIL ? text.slice(-TAIL) : text);

export function createBuildPool({
  workerPath = WORKER_PATH,
  env = {},
  execArgv = [],
  graceMs = 250,
  concurrency = 2,
  maxWorkers = 4,
  spare = true,
  maxBuilds = 200,
  maxRssBytes = 1.5 * 1024 ** 3,
  fingerprint = async () => null,
  fingerprintQuietMs = 3000,
  // Drain bound (from the job's start) when neither a build of the source
  // nor a worker start was measured yet; see drainLimit().
  drainMs = 5000,
  minDrainMs = 1000,
  backoff = {},
  onEvent = () => {},
} = {}) {
  const { baseMs = 1000, maxMs = 30000, limit = 3, windowMs = 60000 } = backoff;
  const workers = new Set();
  const queue = [];
  const jobs = new Map();
  const failures = [];
  let nextJobId = 1;
  let consecutive = 0;
  let blockedUntil = 0;
  let backoffTimer = null;
  let failed = null;
  let wanted = false;
  let closed = false;
  let current = null;
  let settled = null;
  let settleTimer = null;
  let watching = false;
  let startMs = null;
  // Duration of the last build of each source (worker start to result).
  const runMs = new Map();
  let batch = 0;
  let failedBatch = -1;

  const count = state => [...workers].filter(worker => worker.state === state).length;
  const running = () => [...workers].filter(worker => worker.job && !worker.job.cancelled);
  const active = () => running().length;
  // Jobs of one source never run side by side (a session supersedes its own
  // job; the previous-session prepare job and r1 share a source).
  const sourceOf = job => job.message.sourceId ?? '';
  const runnableIndex = () => {
    if (active() >= concurrency) return -1;
    const busy = new Set(running().map(worker => sourceOf(worker.job)));
    return queue.findIndex(job => !busy.has(sourceOf(job)));
  };
  const alive = () => [...workers].filter(worker => worker.state !== 'dead').length;
  const drainers = () => [...workers].filter(worker => worker.draining
    && worker.state === 'busy' && worker.job?.cancelled);
  // How long (from its start) a drained build may keep its worker: 1.5 times
  // the last build of its source, else a worker start, at least minDrainMs.
  const drainLimit = job => Math.max(minDrainMs, runMs.has(sourceOf(job))
    ? 1.5 * runMs.get(sourceOf(job)) : startMs ?? drainMs);
  // Idle workers the pool wants: one per runnable queued job, plus the spare.
  const idleNeeded = () => (runnableIndex() >= 0 ? 1 : 0) + (wanted && spare ? 1 : 0);

  function kill(worker, reason) {
    if (worker.state === 'dead') return;
    worker.killed = reason;
    worker.state = 'retiring';
    killGroup(worker.pid);
  }

  const stale = worker => Boolean(settled && worker.fingerprint
    && worker.fingerprint !== settled);

  // Recycling compares against the fingerprint that stayed unchanged for
  // fingerprintQuietMs, so a burst of edits recycles once, not per file.
  function retireStale() {
    for (const worker of workers) {
      if (!stale(worker)) continue;
      if (worker.state === 'idle') {
        kill(worker, 'kernel changed');
        onEvent('worker-recycled', { pid: worker.pid, reason: 'kernel changed' });
      } else if (worker.state === 'busy') {
        worker.stale = true;
      }
    }
  }

  async function refreshFingerprint() {
    let value;
    try {
      value = await fingerprint();
    } catch {
      return;
    }
    if (closed || value === current) return;
    current = value;
    settled ??= value;
    if (settled === value) return;
    settled = value;
    retireStale();
    ensure();
  }

  // A burst of edits recomputes and recycles once, after it went quiet.
  const changed = () => {
    clearTimeout(settleTimer);
    settleTimer = setTimeout(refreshFingerprint, fingerprintQuietMs);
    settleTimer.unref?.();
  };

  function start() {
    const worker = {
      pid: null, state: 'starting', builds: 0, job: null, stderr: '', stale: false,
      fingerprint: null, startedAt: Date.now(), readyAt: null, rss: null, killed: null,
      draining: false, startError: null, batch,
    };
    let child;
    try {
      child = fork(workerPath, [], {
        serialization: 'advanced',
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
        env: { ...process.env, ...env, WONKY_VIEW_BUILD_WORKER: '1' },
        execArgv,
      });
    } catch (error) {
      worker.stderr = error.message;
      startFailed(worker, null, null);
      return;
    }
    worker.child = child;
    worker.pid = child.pid;
    workers.add(worker);
    trackChild(child.pid);
    // Fresh at fork time: the watcher invalidates the cached value on a change.
    fingerprint().then(value => {
      worker.fingerprint = value;
    }, () => {});
    const capture = chunk => {
      worker.stderr = tail(worker.stderr + chunk);
    };
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', capture);
    child.stderr.on('data', capture);
    child.on('message', message => onMessage(worker, message));
    child.on('error', error => capture(`${error.message}\n`));
    child.on('exit', (code, signal) => {
      // A start failure's `start-failed` message may still be in the IPC
      // channel: handle the exit once the channel is drained.
      if (worker.state !== 'starting' || !child.connected) {
        onExit(worker, code, signal);
        return;
      }
      let done = false;
      const settle = () => {
        if (done) return;
        done = true;
        onExit(worker, code, signal);
      };
      child.once('disconnect', settle);
      setTimeout(settle, 250).unref?.();
    });
    onEvent('worker-starting', { pid: child.pid });
  }

  // The error a worker reported before it exited, else the last stderr line
  // that reads like an error (not a stack frame).
  function startErrorOf(worker) {
    if (worker.startError) return worker.startError;
    const lines = worker.stderr.split('\n').map(line => line.trim()).filter(Boolean);
    return lines.findLast(line => /^[A-Za-z]*Error\b|^wonky-view/.test(line))
      ?? lines.findLast(line => !line.startsWith('at ')) ?? null;
  }

  function startFailed(worker, code, signal) {
    const now = Date.now();
    // Workers forked in the same batch fail for the same reason: one attempt.
    if (worker.batch === failedBatch) return;
    failedBatch = worker.batch;
    batch++;
    const error = startErrorOf(worker);
    failures.push({ at: now, code, signal, error, stderrTail: worker.stderr.trim() || null });
    while (failures.length && now - failures[0].at > windowMs) failures.shift();
    consecutive++;
    if (failures.length >= limit) {
      failed = {
        at: new Date(now).toISOString(),
        failures: failures.length,
        windowMs,
        error,
        stderrTail: worker.stderr.trim() || null,
        attempts: failures.map(entry => ({
          at: new Date(entry.at).toISOString(), code: entry.code, signal: entry.signal,
          error: entry.error,
        })),
      };
      onEvent('worker-failed', { worker: 'build', ...failed });
      return;
    }
    const delay = Math.min(maxMs, baseMs * 2 ** (consecutive - 1));
    blockedUntil = now + delay;
    onEvent('worker-backoff', {
      worker: 'build', attempt: consecutive, code, signal, retryInMs: delay, error,
      stderrTail: worker.stderr.trim() || null,
    });
    clearTimeout(backoffTimer);
    backoffTimer = setTimeout(() => {
      backoffTimer = null;
      ensure();
    }, delay);
  }

  function onMessage(worker, message) {
    if (message?.type === 'start-failed') {
      const error = message.error ?? {};
      worker.startError = [error.name, error.message].filter(Boolean).join(': ') || null;
      return;
    }
    if (message?.type === 'ready') {
      if (worker.state !== 'starting') return;
      worker.state = 'idle';
      worker.readyAt = Date.now();
      startMs = worker.readyAt - worker.startedAt;
      worker.rss = message.rss ?? null;
      consecutive = 0;
      onEvent('worker-ready', {
        pid: worker.pid, warmMs: message.warmMs, warmUpError: message.warmUpError ?? null,
      });
      dispatch();
      return;
    }
    const job = worker.job;
    if (message?.type === 'phase') {
      if (job && !job.cancelled && job.jobId === message.jobId) {
        // The deadline bounds evaluation only; display work after it is not
        // part of the Python budget.
        if (message.phase !== 'evaluating') clearTimeout(job.deadlineTimer);
        job.handlers.onPhase?.(message);
      }
      return;
    }
    if (message?.type !== 'result') return;
    worker.job = null;
    worker.draining = false;
    worker.builds++;
    worker.rss = message.rss ?? worker.rss;
    if (job) {
      clearTimeout(job.killTimer);
      clearTimeout(job.deadlineTimer);
      clearTimeout(job.drainTimer);
      if (job.startedAt && job.message.type === 'build') {
        runMs.set(sourceOf(job), Date.now() - job.startedAt);
      }
    }
    if (job && !job.cancelled && job.jobId === message.jobId) {
      jobs.delete(job.jobId);
      job.state = 'done';
      job.handlers.onDone?.(message, {
        pid: worker.pid, fingerprint: worker.fingerprint, builds: worker.builds,
      });
    } else {
      onEvent('result-dropped', { jobId: message.jobId, pid: worker.pid });
    }
    if (worker.state === 'busy') {
      const reason = worker.builds >= maxBuilds ? `${worker.builds} builds`
        : (worker.rss ?? 0) > maxRssBytes ? `RSS ${Math.round(worker.rss / 1048576)} MB`
          : worker.stale || stale(worker) ? 'kernel changed' : null;
      if (reason) {
        kill(worker, reason);
        onEvent('worker-recycled', { pid: worker.pid, reason });
      } else {
        worker.state = 'idle';
      }
    }
    dispatch();
  }

  function onExit(worker, code, signal) {
    const state = worker.state;
    worker.state = 'dead';
    workers.delete(worker);
    untrackChild(worker.pid);
    const job = worker.job;
    worker.job = null;
    worker.draining = false;
    if (job) {
      clearTimeout(job.killTimer);
      clearTimeout(job.deadlineTimer);
      clearTimeout(job.drainTimer);
    }
    onEvent('worker-exit', { pid: worker.pid, code, signal, reason: worker.killed });
    if (closed) return;
    if (!worker.killed && state === 'starting') {
      startFailed(worker, code, signal);
    } else if (job && !job.cancelled) {
      jobs.delete(job.jobId);
      job.state = 'done';
      const how = signal ? `on ${signal}` : `with code ${code}`;
      job.handlers.onDone?.({
        type: 'result', jobId: job.jobId, ok: false, crashed: true,
        failure: internalFailure(`Build worker exited ${how} during the build`, {
          stderrTail: worker.stderr.trim() || null, jobId: job.jobId,
          revision: job.message.revision ?? null, sourceId: job.message.sourceId ?? null,
          source: { path: job.message.sourcePath, language: job.message.language },
          phase: 'evaluating',
        }),
      }, { pid: worker.pid, fingerprint: worker.fingerprint });
    }
    dispatch();
  }

  function ensure() {
    if (closed || failed || Date.now() < blockedUntil) return;
    // After a start failure, one start at a time (the backoff counts attempts).
    if (consecutive > 0 && count('starting') > 0) return;
    let missing = idleNeeded() - count('idle') - count('starting');
    if (consecutive > 0) missing = Math.min(missing, 1);
    while (missing > 0 && alive() < maxWorkers) {
      start();
      missing--;
    }
    // A queued job (not the spare) that finds every slot taken gets one:
    // workers being killed free theirs soon; beyond that, the most recently
    // started drained builds give theirs up.
    let short = (runnableIndex() >= 0 ? 1 : 0) - count('idle') - count('starting')
      - count('retiring');
    const victims = drainers().sort((a, b) => b.job.startedAt - a.job.startedAt);
    while (short-- > 0 && victims.length) {
      const worker = victims.shift();
      kill(worker, 'slot needed');
      onEvent('job-killed', { jobId: worker.job.jobId, pid: worker.pid, reason: 'slot needed' });
    }
  }

  // Kill draining workers (cancelled build still running) once enough warm
  // workers are idle; until then they may still serve the next job.
  function reap() {
    for (const worker of drainers()) {
      if (count('idle') < idleNeeded()) return;
      kill(worker, 'cancelled');
      onEvent('job-killed', { jobId: worker.job.jobId, pid: worker.pid, drained: true });
    }
  }

  // A drained build that outlived the drain bound gives its worker up.
  function drainExpired(job, worker) {
    if (closed || worker.job !== job || !worker.draining) return;
    kill(worker, 'drain limit');
    onEvent('job-killed', { jobId: job.jobId, pid: worker.pid, reason: 'drain limit' });
    dispatch();
  }

  function assign(job, worker) {
    worker.state = 'busy';
    worker.job = job;
    job.state = 'running';
    job.worker = worker;
    job.startedAt = Date.now();
    // Cold: the job waited for a worker that became ready after it was queued.
    const cold = job.waited && worker.builds === 0 && (worker.readyAt ?? 0) >= job.queuedAt;
    job.handlers.onStart?.({
      jobId: job.jobId, pid: worker.pid, worker: cold ? 'cold' : 'warm',
      queuedMs: job.startedAt - job.queuedAt, fingerprint: worker.fingerprint,
    });
    if (Number.isFinite(job.message.deadlineMs)) {
      job.deadlineTimer = setTimeout(() => expire(job, worker), job.message.deadlineMs);
      job.deadlineTimer.unref?.();
    }
    worker.child.send({ ...job.message, jobId: job.jobId });
  }

  // The job outlived its deadline: fail it as a timeout and kill the worker's
  // process group (the worker and any interpreter it started).
  function expire(job, worker) {
    if (closed || worker.job !== job) return;
    if (job.cancelled) {
      // Nobody waits for its result; the deadline only frees the worker.
      kill(worker, 'deadline');
      onEvent('job-killed', { jobId: job.jobId, pid: worker.pid, reason: 'deadline' });
      dispatch();
      return;
    }
    worker.job = null;
    jobs.delete(job.jobId);
    job.state = 'done';
    const limit = job.message.options?.timeoutMs ?? null;
    const message = limit
      ? `Python execution exceeded ${limit} ms; the interpreter did not exit, so wonky-view`
        + ' killed its process group'
      : `Build exceeded ${job.message.deadlineMs} ms; wonky-view killed the worker`;
    kill(worker, 'deadline');
    onEvent('job-deadline', {
      jobId: job.jobId, pid: worker.pid, deadlineMs: job.message.deadlineMs,
    });
    const text = job.message.bytes ? Buffer.from(job.message.bytes).toString('utf8') : undefined;
    job.handlers.onDone?.({
      type: 'result', jobId: job.jobId, ok: false,
      failure: failurePayload({ name: 'PythonExecutionError', message }, {
        source: { path: job.message.sourcePath ?? null, language: job.message.language ?? null,
          text },
        jobId: job.jobId, revision: job.message.revision ?? null,
        sourceId: job.message.sourceId ?? null, lastGood: job.message.lastGood ?? null,
        phase: 'evaluating', timings: { totalMs: Date.now() - job.startedAt },
      }),
    }, { pid: worker.pid, fingerprint: worker.fingerprint });
    dispatch();
  }

  function dispatch() {
    if (closed) return;
    for (;;) {
      const index = runnableIndex();
      const worker = [...workers].find(candidate => candidate.state === 'idle');
      if (index < 0 || !worker) break;
      assign(queue.splice(index, 1)[0], worker);
    }
    ensure();
    reap();
    // Queued jobs say why they wait: another build holds the slot (or runs
    // for the same source), or no warm worker is ready yet (a cold start).
    const busy = new Set(running().map(worker => sourceOf(worker.job)));
    const full = active() >= concurrency;
    const warming = count('starting') > 0 || count('retiring') > 0 || failed
      || Date.now() < blockedUntil;
    for (const job of queue) {
      const phase = full || busy.has(sourceOf(job)) ? 'waiting for another build'
        : warming ? 'warming worker' : null;
      if (!phase || job.notified === phase) continue;
      if (phase === 'warming worker') job.waited = true;
      job.notified = phase;
      job.handlers.onPhase?.({ jobId: job.jobId, phase, elapsedMs: 0 });
    }
  }

  return {
    // Job ids are unique per pool; sessions allocate one before superseding.
    allocate: () => nextJobId++,
    submit(message, handlers = {}, { jobId = nextJobId++ } = {}) {
      if (closed) throw new Error('Build pool is closed');
      const job = {
        jobId, message, handlers, state: 'queued', queuedAt: Date.now(), cancelled: false,
        waited: false, notified: null, killTimer: null, deadlineTimer: null, drainTimer: null,
        worker: null,
      };
      jobs.set(jobId, job);
      queue.push(job);
      dispatch();
      return { jobId };
    },
    // drain: a superseded job may keep its worker while no warm replacement
    // is idle (bounded); an explicit cancel is killed after the grace.
    cancel(jobId, { graceMs: grace = graceMs, drain = true } = {}) {
      const job = jobs.get(jobId);
      if (!job) return false;
      jobs.delete(jobId);
      job.cancelled = true;
      if (job.state === 'queued') {
        clearTimeout(job.deadlineTimer);
        queue.splice(queue.indexOf(job), 1);
      } else if (job.state === 'running') {
        const worker = job.worker;
        job.killTimer = setTimeout(() => {
          if (worker.job !== job) return;
          const limitMs = drainLimit(job);
          const leftMs = job.startedAt + limitMs - Date.now();
          if (!drain || leftMs <= 0 || count('idle') >= idleNeeded()) {
            kill(worker, 'cancelled');
            onEvent('job-killed', { jobId, pid: worker.pid });
            return;
          }
          // No warm replacement: keep the worker until one is idle, or until
          // the build has run much longer than builds of its source take.
          worker.draining = true;
          job.drainTimer = setTimeout(() => drainExpired(job, worker), leftMs);
          job.drainTimer.unref?.();
          onEvent('job-draining', { jobId, pid: worker.pid, limitMs });
          dispatch();
        }, grace);
      }
      dispatch();
      return true;
    },
    setWanted(value) {
      wanted = Boolean(value);
      if (wanted && !watching) {
        watching = true;
        refreshFingerprint();
        fingerprint.watch?.(changed).catch(() => {});
      }
      ensure();
    },
    resume() {
      if (!failed && !backoffTimer) return;
      failed = null;
      failures.length = 0;
      consecutive = 0;
      blockedUntil = 0;
      clearTimeout(backoffTimer);
      backoffTimer = null;
      dispatch();
    },
    get failed() {
      return failed;
    },
    status: () => ({
      workers: [...workers].map(worker => ({
        pid: worker.pid, state: worker.state, builds: worker.builds, rss: worker.rss,
        fingerprint: worker.fingerprint, jobId: worker.job?.jobId ?? null,
        cancelled: !!worker.job?.cancelled, draining: !!worker.draining,
      })),
      queued: queue.map(job => job.jobId),
      failed,
      backoffUntil: blockedUntil > Date.now() ? new Date(blockedUntil).toISOString() : null,
      fingerprint: settled,
    }),
    pids: () => [...workers].map(worker => worker.pid).filter(Boolean),
    // Open fs.watch handles of the kernel fingerprint (0 after close()).
    watcherHandles: () => fingerprint.handles?.() ?? 0,
    async close() {
      if (closed) return;
      closed = true;
      clearTimeout(backoffTimer);
      clearTimeout(settleTimer);
      fingerprint.unwatch?.();
      queue.length = 0;
      for (const worker of workers) {
        clearTimeout(worker.job?.killTimer);
        clearTimeout(worker.job?.deadlineTimer);
        clearTimeout(worker.job?.drainTimer);
      }
      for (const job of jobs.values()) {
        clearTimeout(job.killTimer);
        clearTimeout(job.deadlineTimer);
      }
      jobs.clear();
      const exits = [...workers].map(worker => new Promise(done => {
        if (!worker.child || worker.child.exitCode !== null || worker.child.signalCode) {
          done();
          return;
        }
        worker.child.once('exit', done);
        setTimeout(done, 2000).unref?.();
      }));
      for (const worker of workers) kill(worker, 'closed');
      await Promise.all(exits);
    },
  };
}
