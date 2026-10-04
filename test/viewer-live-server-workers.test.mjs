import test from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missingBend();
if (publicTreeSkip) {
  test("viewer-live-server-workers.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { createServer: createNetServer } = await import("node:net");
const { spawn } = await import("node:child_process");
const { createHash } = await import("node:crypto");
const { copyFile, mkdtemp, readFile, rm, writeFile } = await import("node:fs/promises");
const { tmpdir } = await import("node:os");
const { join } = await import("node:path");
const { fileURLToPath, pathToFileURL } = await import("node:url");
const { build } = await import("../src/index.mjs");
const { createBuildPool } = await import("../src/viewer/live/pool.mjs");
const { createLiveSession } = await import("../src/viewer/live/session.mjs");
const { createQueryPool } = await import("../src/viewer/query-pool.mjs");
const { EVENT_NAMES } = await import("../src/viewer/events.mjs");
const { observeTimeouts } = await import("./support/observe-timeouts.mjs");
// Live build server processes (package live-server, docs/viewer/live-server.md):
// build pool cancellation and recycling with a fake worker, the real build
// worker's parent watchdog (kill -9 of the parent), the query worker behind
// ctx.pool.query, the session's supersede/drop logic with a fake pool, the
// wonky-view CLI (strict --port, --json NDJSON, Ctrl-C cleanup) and the build
// worker's draw payload against the query worker's.
















const root = fileURLToPath(new URL('../', import.meta.url));
const sha256 = value => createHash('sha256').update(value).digest('hex');
const sleep = ms => new Promise(done => setTimeout(done, ms));

async function directory(t, prefix = 'wonky-live-workers-') {
  const path = await mkdtemp(join(tmpdir(), prefix));
  // Retries: a hook may run while a closing server still writes its last-good cache.
  t.after(() => rm(path, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  return path;
}

const alive = pid => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

async function until(check, { timeoutMs = 120000, stepMs = 20, what = 'condition' } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await sleep(stepMs);
  }
}

// A stand-in for build-worker.mjs: ready at once (or after FAKE_READY_MS, a
// cold start); a job answers at once (`ok`), after message.ms (`slow`),
// never (`hang`), or starts a grandchild in its process group first
// (`grandchild`, reported as a phase message with its pid).
const FAKE_WORKER = `
const { spawn } = require('node:child_process');
process.on('disconnect', () => process.exit(0));
process.on('message', message => {
  if (message.mode === 'hang') return;
  if (message.mode === 'slow') {
    setTimeout(() => process.send({ type: 'result', jobId: message.jobId, ok: true, rss: 1 }),
      message.ms);
    return;
  }
  if (message.mode === 'grandchild') {
    const child = spawn('sleep', ['60'], { stdio: 'ignore' });
    process.send({ type: 'phase', jobId: message.jobId, phase: message.phase || 'grandchild',
      pid: child.pid });
    return;
  }
  process.send({ type: 'result', jobId: message.jobId, ok: true,
    rss: Number(process.env.FAKE_RSS || 1) });
});
setTimeout(() => process.send({ type: 'ready', warmMs: 1, rss: 1 }),
  Number(process.env.FAKE_READY_MS || 0));
`;

async function fakeWorker(t) {
  const path = join(await directory(t), 'fake-worker.cjs');
  await writeFile(path, FAKE_WORKER);
  return path;
}

function recordEvents() {
  const events = [];
  return {
    events,
    onEvent: (name, data) => events.push({ at: Date.now(), name, ...data }),
    find: name => events.find(event => event.name === name),
  };
}

const idleWorkers = pool => pool.status().workers.filter(worker => worker.state === 'idle');

test('cancel: the spare takes the next job at once, the old group dies after the grace',
  async t => {
    const workerPath = await fakeWorker(t);
    const log = recordEvents();
    const pool = createBuildPool({ workerPath, onEvent: log.onEvent });
    t.after(() => pool.close());
    pool.setWanted(true);
    const first = { pid: null, grandchild: null };
    pool.submit({ type: 'build', mode: 'grandchild' }, {
      onStart: info => {
        first.pid = info.pid;
      },
      onPhase: message => {
        first.grandchild = message.pid;
      },
      onDone: () => assert.fail('a cancelled job never reports'),
    });
    await until(() => first.grandchild && idleWorkers(pool).length === 1,
      { what: 'job running and a warm spare' });
    const timers = observeTimeouts(t);
    const cancelledAt = Date.now();
    const jobId = pool.status().workers.find(worker => worker.pid === first.pid).jobId;
    pool.cancel(jobId, { graceMs: 120 });
    let startedAt = null;
    let secondPid = null;
    const done = new Promise(resolve => {
      pool.submit({ type: 'build', mode: 'ok' }, {
        onStart: info => {
          startedAt = Date.now();
          secondPid = info.pid;
        },
        onDone: resolve,
      });
    });
    assert.ok(secondPid !== null, 'the warm spare starts synchronously during submit');
    assert.ok((await done).ok);
    const waited = startedAt - cancelledAt;
    t.diagnostic(`the spare started after ${waited} ms`);
    assert.notEqual(secondPid, first.pid);
    await until(() => !alive(first.pid) && !alive(first.grandchild),
      { timeoutMs: 3000, what: 'the cancelled group to die' });
    const killed = log.find('job-killed');
    assert.equal(killed.jobId, jobId);
    const grace = timers.find(timer => timer.delay === 120);
    assert.ok(grace?.fired, 'kill follows the requested 120 ms grace callback');
    assert.equal(grace.cancelledBeforeFire, false);
    t.diagnostic(`kill after ${killed.at - cancelledAt} ms`);
  });

// Regression (fix round 2): every supersede killed its worker after the
// grace, so five saves in 550 ms used up the warm workers and the last save
// waited 23.9 s for a cold start. A cancelled worker now drains until a warm
// replacement is idle, and takes the next job itself if it finishes first.
test('a burst of saves of fast builds: the last one runs on a drained warm worker, not a cold one',
  async t => {
  const workerPath = await fakeWorker(t);
  const log = recordEvents();
  const pool = createBuildPool({
    workerPath, onEvent: log.onEvent, env: { FAKE_READY_MS: '2500' }, maxWorkers: 4,
  });
  t.after(() => pool.close());
  pool.setWanted(true);
  await until(() => idleWorkers(pool).length >= 1, { timeoutMs: 20000, what: 'a warm worker' });
  const burstAt = Date.now();
  let previous = null;
  let last = null;
  let lastStart = null;
  let readyBeforeLast;
  for (const delay of [0, 0, 100, 300, 550]) {
    await sleep(Math.max(0, burstAt + delay - Date.now()));
    if (previous) pool.cancel(previous);
    const jobId = pool.allocate();
    readyBeforeLast = new Set(log.events.filter(event => event.name === 'worker-ready').map(event => event.pid));
    const done = new Promise(resolve => pool.submit({ type: 'build', mode: 'slow', ms: 500 },
      { onStart: info => { lastStart = info; }, onDone: resolve }, { jobId }));
    previous = jobId;
    last = done;
  }
  const result = await last;
  const finishedMs = Date.now() - burstAt;
  assert.ok(result.ok);
  assert.ok(readyBeforeLast.has(lastStart.pid), 'the last save uses a worker already warm when queued');
  assert.equal(lastStart.worker, 'warm');
  t.diagnostic(`last save finished after ${finishedMs} ms`);
  assert.ok(log.events.some(event => event.name === 'job-draining'), 'a cancelled worker drained');
  // Once warm replacements are idle, no drained stale build keeps running.
  await until(() => pool.status().workers.every(worker => worker.jobId === null),
    { timeoutMs: 10000, what: 'no stale build left' });
  assert.ok(pool.status().workers.length <= 4);
});

// Regression (fix round 3, verify:live#3 high): ten superseded builds that
// hang (time.sleep(600)) all drained, draining workers counted against
// maxWorkers and were only reaped once another worker was idle, so the fix
// and every other source stayed queued forever. A job that needs a worker
// start now takes the slot of the most recently started drained build.
test('hanging superseded builds never deadlock the pool: the fix and another source build',
  async t => {
    const workerPath = await fakeWorker(t);
    const log = recordEvents();
    // The drain bound is out of reach here: only the slot rule can help.
    const pool = createBuildPool({
      workerPath, onEvent: log.onEvent, env: { FAKE_READY_MS: '150' }, maxWorkers: 4,
      drainMs: 600000, minDrainMs: 600000,
    });
    t.after(() => pool.close());
    pool.setWanted(true);
    await until(() => idleWorkers(pool).length >= 1, { timeoutMs: 20000, what: 'a warm worker' });
    let maxAlive = 0;
    const sample = setInterval(() => {
      maxAlive = Math.max(maxAlive, pool.pids().length);
    }, 10);
    t.after(() => clearInterval(sample));
    let previous = null;
    for (let save = 0; save < 10; save++) {
      if (previous) pool.cancel(previous, { graceMs: 50 });
      previous = pool.allocate();
      pool.submit({ type: 'build', sourceId: 'slowmain', mode: 'hang' },
        { onDone: () => assert.fail('a cancelled hanging build never reports') },
        { jobId: previous });
      await sleep(120);
    }
    pool.cancel(previous, { graceMs: 50 });
    const fixedAt = Date.now();
    const startsBeforeFix = log.events.filter(event => event.name === 'worker-starting').length;
    const fixed = new Promise(resolve => pool.submit({ type: 'build', sourceId: 'slowmain',
      mode: 'ok' }, { onDone: resolve }));
    const other = new Promise(resolve => pool.submit({ type: 'build', sourceId: 'other',
      mode: 'ok' }, { onDone: resolve }));
    const [a, b] = await Promise.race([Promise.all([fixed, other]),
      sleep(15000).then(() => assert.fail(`deadlock: ${JSON.stringify(pool.status())}`))]);
    assert.ok(a.ok && b.ok);
    assert.ok(log.events.filter(event => event.name === 'worker-starting').length - startsBeforeFix <= 2,
      'the fix needs at most two worker starts');
    t.diagnostic(`fix built after ${Date.now() - fixedAt} ms`);
    assert.ok(log.events.some(event => event.name === 'job-killed'
      && event.reason === 'slot needed'), 'a drained build gave its slot up');
    assert.ok(maxAlive <= 4, `never more than maxWorkers processes (${maxAlive})`);
  });

test('a drained build is killed after the drain bound; its deadline still applies', async t => {
  const workerPath = await fakeWorker(t);
  const log = recordEvents();
  // One slot and a wanted spare: a superseded build drains (nothing idle).
  const pool = createBuildPool({
    workerPath, onEvent: log.onEvent, maxWorkers: 1, drainMs: 300, minDrainMs: 300,
  });
  t.after(() => pool.close());
  pool.setWanted(true);
  await until(() => idleWorkers(pool).length === 1, { timeoutMs: 20000, what: 'a warm worker' });
  const timers = observeTimeouts(t);
  let startedAt = null;
  const first = pool.submit({ type: 'build', sourceId: 'a', mode: 'hang' }, {
    onStart: () => {
      startedAt = Date.now();
    },
    onDone: () => assert.fail('cancelled'),
  });
  await sleep(30);
  pool.cancel(first.jobId, { graceMs: 20 });
  const graceTimer = timers.find(timer => timer.delay === 20);
  await until(() => log.find('job-draining'), { timeoutMs: 3000, what: 'draining' });
  assert.equal(log.find('job-draining').limitMs >= 300, true);
  const killed = await until(() => log.events.find(event => event.name === 'job-killed'),
    { timeoutMs: 5000, what: 'the drain bound' });
  assert.equal(killed.reason, 'drain limit');
  const after = killed.at - startedAt;
  const drainTimer = timers.find(timer => timer.parent === graceTimer);
  assert.ok(graceTimer?.fired && drainTimer?.fired,
    'the cancellation callback schedules the drain callback that fires');
  assert.ok(drainTimer.delay <= 300 && drainTimer.scheduledAt + drainTimer.delay >= startedAt + 290,
    'the drain is scheduled at the 300 ms build deadline, never prematurely');
  t.diagnostic(`drain killed after ${after} ms`);
  // After a build of the source took about 400 ms, a stale build of it may
  // drain until 1.5 times that (600 ms from its start), not less.
  await until(() => idleWorkers(pool).length === 1, { timeoutMs: 20000, what: 'a fresh worker' });
  await new Promise(resolve => pool.submit({ type: 'build', sourceId: 'a', mode: 'slow',
    ms: 400 }, { onDone: resolve }));
  log.events.length = 0;
  let slowStart = null;
  const slow = pool.submit({ type: 'build', sourceId: 'a', mode: 'hang' }, {
    onStart: () => {
      slowStart = Date.now();
    },
    onDone: () => assert.fail('cancelled'),
  });
  await sleep(30);
  pool.cancel(slow.jobId, { graceMs: 20 });
  const learnedGrace = timers.findLast(timer => timer.delay === 20);
  const draining = await until(() => log.find('job-draining'), { timeoutMs: 3000,
    what: 'draining' });
  assert.ok(draining.limitMs >= 600, `drain limit ${draining.limitMs} ms`);
  const second = await until(() => log.find('job-killed'), { timeoutMs: 5000, what: 'kill' });
  assert.equal(second.reason, 'drain limit');
  const learnedDrain = timers.find(timer => timer.parent === learnedGrace);
  assert.ok(learnedDrain?.fired && learnedDrain.delay <= draining.limitMs
    && learnedDrain.scheduledAt + learnedDrain.delay >= slowStart + draining.limitMs - 10,
    'the actual drain callback is scheduled at the learned deadline');
  t.diagnostic(`learned drain kept ${second.at - slowStart} ms`);

  // A deadline outlives the cancel: with an unreachable drain bound, the
  // job's deadline still frees the worker.
  const bounded = createBuildPool({
    workerPath, onEvent: log.onEvent, maxWorkers: 1, drainMs: 600000, minDrainMs: 600000,
  });
  t.after(() => bounded.close());
  bounded.setWanted(true);
  await until(() => idleWorkers(bounded).length === 1, { timeoutMs: 20000, what: 'warm' });
  const stuck = bounded.submit({ type: 'build', sourceId: 'a', mode: 'hang', deadlineMs: 400 },
    { onDone: () => assert.fail('a cancelled job never reports, even at its deadline') });
  log.events.length = 0;
  bounded.cancel(stuck.jobId, { graceMs: 20 });
  const expired = await until(() => log.events.find(event => event.name === 'job-killed'),
    { timeoutMs: 5000, what: 'the deadline of a cancelled job' });
  assert.equal(expired.reason, 'deadline');
  await until(() => idleWorkers(bounded).length === 1, { timeoutMs: 20000, what: 'a fresh worker' });
});

test('an explicit cancel never drains: the runaway build dies after the grace', async t => {
  const workerPath = await fakeWorker(t);
  const log = recordEvents();
  const pool = createBuildPool({ workerPath, onEvent: log.onEvent, maxWorkers: 1 });
  t.after(() => pool.close());
  pool.setWanted(true);
  await until(() => idleWorkers(pool).length === 1, { timeoutMs: 20000, what: 'a warm worker' });
  const job = pool.submit({ type: 'build', sourceId: 'a', mode: 'hang' },
    { onDone: () => assert.fail('cancelled') });
  await sleep(30);
  const timers = observeTimeouts(t);
  const cancelledAt = Date.now();
  pool.cancel(job.jobId, { graceMs: 50, drain: false });
  const killed = await until(() => log.find('job-killed'), { timeoutMs: 3000, what: 'kill' });
  assert.ok(timers.find(timer => timer.delay === 50)?.fired, 'explicit cancellation kills on its 50 ms grace callback');
  t.diagnostic(`explicit cancel killed after ${killed.at - cancelledAt} ms`);
  assert.equal(log.find('job-draining'), undefined);
});

test('workers are recycled after N builds, above the RSS limit and on a kernel change',
  async t => {
    const workerPath = await fakeWorker(t);
    const byBuilds = recordEvents();
    const counted = createBuildPool({
      workerPath, spare: false, maxBuilds: 2, onEvent: byBuilds.onEvent,
    });
    t.after(() => counted.close());
    const run = pool => new Promise(resolve => pool.submit({ type: 'build', mode: 'ok' },
      { onStart: info => resolve(info.pid) }));
    const pid = await run(counted);
    assert.equal(await run(counted), pid, 'the same warm worker takes the second build');
    await until(() => byBuilds.find('worker-recycled'), { timeoutMs: 5000, what: 'recycle' });
    assert.equal(byBuilds.find('worker-recycled').reason, '2 builds');
    await until(() => !alive(pid), { timeoutMs: 3000, what: 'recycled worker exit' });
    assert.notEqual(await run(counted), pid, 'a fresh worker builds next');

    const byRss = recordEvents();
    const heavy = createBuildPool({
      workerPath, spare: false, maxRssBytes: 1e9, env: { FAKE_RSS: String(2e9) },
      onEvent: byRss.onEvent,
    });
    t.after(() => heavy.close());
    await run(heavy);
    await until(() => byRss.find('worker-recycled'), { timeoutMs: 5000, what: 'RSS recycle' });
    assert.equal(byRss.find('worker-recycled').reason, 'RSS 1907 MB');

    let value = 'kernel-a';
    let notify = null;
    const fingerprint = async () => value;
    fingerprint.watch = async onChange => {
      notify = onChange;
      return () => {};
    };
    const byKernel = recordEvents();
    const kernel = createBuildPool({
      workerPath, fingerprint, fingerprintQuietMs: 20, onEvent: byKernel.onEvent,
    });
    t.after(() => kernel.close());
    kernel.setWanted(true);
    await until(() => idleWorkers(kernel).length === 1 && notify
      && idleWorkers(kernel)[0].fingerprint === 'kernel-a', { what: 'warm spare' });
    const old = idleWorkers(kernel)[0].pid;
    value = 'kernel-b';
    notify();
    const recycled = await until(() => byKernel.find('worker-recycled'),
      { timeoutMs: 5000, what: 'kernel recycle' });
    assert.deepEqual([recycled.pid, recycled.reason], [old, 'kernel changed']);
    await until(() => idleWorkers(kernel).some(worker => worker.fingerprint === 'kernel-b'),
      { timeoutMs: 5000, what: 'a spare on the new kernel' });
    assert.equal(kernel.status().fingerprint, 'kernel-b');
  });

test('kill -9 of the parent during a long build: the real worker exits within 5 s',
  async t => {
    const dir = await directory(t);
    const parent = join(dir, 'parent.mjs');
    const spin = [
      'FeatureScript 3044;',
      'import(path : "onshape/std/geometry.fs", version : "3044.0");',
      'export function spin(context is Context, id is Id, definition is map)',
      '{',
      '    var total = 0;',
      '    for (var i = 0; i < 200000000; i += 1) { total += 1; }',
      '}',
      '',
    ].join('\n');
    await writeFile(parent, [
      `import { createBuildPool } from ${JSON.stringify(pathToFileURL(
        join(root, 'src/viewer/live/pool.mjs')).href)};`,
      'const pool = createBuildPool({ spare: false });',
      `pool.submit({ type: 'build', language: 'featurescript', sourcePath: '/virtual/spin.fs',`,
      `  bytes: Buffer.from(${JSON.stringify(spin)}), options: { maxSteps: 9000000000 },`,
      `  label: 'spin' }, {`,
      '  onPhase: message => console.log(JSON.stringify({ phase: message.phase })),',
      '  onStart: info => console.log(JSON.stringify({ worker: info.pid })),',
      '});',
      'setInterval(() => {}, 1000);',
      '',
    ].join('\n'));
    const child = spawn(process.execPath, [parent], { stdio: ['ignore', 'pipe', 'inherit'] });
    t.after(() => {
      if (alive(child.pid)) child.kill('SIGKILL');
    });
    let output = '';
    child.stdout.on('data', chunk => {
      output += chunk;
    });
    const worker = await until(() => /"phase":"evaluating"/.test(output)
      && Number(/"worker":(\d+)/.exec(output)?.[1]), { what: 'the build to run' });
    await sleep(500);
    assert.ok(alive(worker), 'the build is still running');
    const killedAt = Date.now();
    child.kill('SIGKILL');
    await until(() => !alive(worker), { timeoutMs: 5000, what: 'the orphaned worker to exit' });
    t.diagnostic(`worker ${worker} exited ${Date.now() - killedAt} ms after kill -9 of its parent`);
  });

test('the query worker answers ctx.pool.query off the event loop; latest wins; close kills it',
  async t => {
    const bytes = Buffer.from(JSON.stringify(await build(
      await readFile(join(root, 'examples', 'box.fs'), 'utf8')), null, 2) + '\n');
    const modelId = sha256(bytes);
    const registry = {
      has: id => id === modelId,
      bytes: async () => bytes,
      model: () => JSON.parse(bytes),
    };
    const pool = createQueryPool({ registry });
    t.after(() => pool.close());
    assert.equal(pool.transport, 'worker');
    assert.deepEqual(pool.pids(), [], 'started lazily');
    const scene = JSON.parse(await pool.query('scene', modelId, { metadata: { id: modelId } }));
    assert.equal(scene.bodies.length, 1);
    const [pid] = pool.pids();
    assert.ok(pid && pid !== process.pid, 'a separate process');
    const older = pool.query('draw', modelId, { modelId }, { supersedeKey: 'draw' });
    const newer = pool.query('draw', modelId, { modelId }, { supersedeKey: 'draw' });
    await assert.rejects(older, error => error.status === 409);
    const payload = await newer;
    assert.equal(payload.header.modelId, modelId);
    assert.ok(payload.buffer.byteLength > 0);
    await assert.rejects(pool.query('draw', 'f'.repeat(64), {}), error => error.status === 404);
    await assert.rejects(pool.query('nope', modelId, {}), error => error.status === 400);
    pool.close();
    await until(() => !alive(pid), { timeoutMs: 3000, what: 'close() to kill the worker' });
    await assert.rejects(pool.query('scene', modelId, {}), error => error.status === 503);
  });

// A query worker that never answers `draw` (a stuck kernel call).
const STUCK_QUERY_WORKER = `
process.on('disconnect', () => process.exit(0));
process.on('message', message => {
  if (message.type !== 'query' || message.kind === 'draw') return;
  process.send({ type: 'result', id: message.id, ok: true, value: process.pid });
});
process.send({ type: 'ready' });
`;

test('a timed-out query kills its worker; the next query gets a fresh one', async t => {
  const workerPath = join(await directory(t), 'stuck-query-worker.cjs');
  await writeFile(workerPath, STUCK_QUERY_WORKER);
  const modelId = 'a'.repeat(64);
  const registry = { has: id => id === modelId, bytes: async () => Buffer.from('{}') };
  const pool = createQueryPool({ registry, worker: { workerPath } });
  t.after(() => pool.close());
  const pid = await pool.query('section', modelId, {});
  assert.deepEqual(pool.pids(), [pid]);
  const timers = observeTimeouts(t);
  const started = Date.now();
  await assert.rejects(pool.query('draw', modelId, {}, { timeoutMs: 300 }),
    error => error.status === 504 && /timed out after 300 ms/.test(error.message));
  assert.ok(timers.find(timer => timer.delay === 300)?.fired, 'query expires on the requested deadline');
  t.diagnostic(`query expired after ${Date.now() - started} ms`);
  await until(() => !alive(pid), { timeoutMs: 3000, what: 'the stuck worker to die' });
  const fresh = await pool.query('section', modelId, {});
  assert.notEqual(fresh, pid, 'a fresh worker answers the next query');
});

// Starts slowly and loads modules on its first query, each longer than the
// 300 ms query timeout used below (integration, 2026-09-23).
const SLOW_START_WORKER = `
process.on('disconnect', () => process.exit(0));
let prepared = false;
process.on('message', message => {
  if (message.type !== 'query') return;
  const answer = () => process.send({ type: 'result', id: message.id, ok: true, value: 'done' });
  if (prepared) return answer();
  process.send({ type: 'preparing', id: message.id });
  setTimeout(() => {
    prepared = true;
    process.send({ type: 'started', id: message.id });
    answer();
  }, 600);
});
setTimeout(() => process.send({ type: 'ready' }), 600);
`;

test('the query timeout excludes the worker start and first-time module loads', async t => {
  const workerPath = join(await directory(t), 'slow-start-worker.cjs');
  await writeFile(workerPath, SLOW_START_WORKER);
  const modelId = 'b'.repeat(64);
  const registry = { has: id => id === modelId, bytes: async () => Buffer.from('{}') };
  const pool = createQueryPool({ registry, worker: { workerPath } });
  t.after(() => pool.close());
  const timers = observeTimeouts(t);
  const started = Date.now();
  assert.equal(await pool.query('thickness', modelId, {}, { timeoutMs: 300 }), 'done');
  assert.ok(timers.filter(timer => timer.delay === 300).length >= 2, 'query deadline is rearmed after preparation');
  assert.ok(timers.filter(timer => timer.delay === 300).every(timer => timer.cancelled && !timer.fired),
    'startup and preparation cannot consume the query deadline');
  t.diagnostic(`startup and preparation completed after ${Date.now() - started} ms`);
  assert.equal(await pool.query('thickness', modelId, {}, { timeoutMs: 300 }), 'done');
});

// Regression (fix round): one busy worker for all sources made an edit to one
// source wait for an unrelated slow build while the warm spare sat idle, and
// the waiting job was labelled "warming worker" / cold.
test('a slow build of one source never holds back another source; waits say why', async t => {
  const workerPath = await fakeWorker(t);
  const pool = createBuildPool({ workerPath });
  t.after(() => pool.close());
  pool.setWanted(true);
  const phases = [];
  const started = {};
  const submit = (sourceId, mode) => new Promise(resolve => {
    pool.submit({ type: 'build', sourceId, mode }, {
      onStart: info => {
        started[sourceId + mode] = info;
        if (mode === 'hang') resolve(info);
      },
      onPhase: message => phases.push({ sourceId, mode, phase: message.phase }),
      onDone: resolve,
    });
  });
  await submit('bracket', 'hang');
  await until(() => idleWorkers(pool).length === 1, { what: 'a warm spare' });
  const queuedAt = Date.now();
  assert.ok((await submit('spacer', 'ok')).ok);
  assert.ok(pool.status().workers.some(worker => worker.jobId !== null && worker.state === 'busy'),
    'spacer completes while the unrelated hanging bracket is still running');
  t.diagnostic(`spacer completed after ${Date.now() - queuedAt} ms`);
  assert.equal(started.spacerok.worker, 'warm');
  assert.deepEqual(phases.filter(entry => entry.sourceId === 'spacer'), [],
    'spacer never waited (no "warming worker")');
  // A third source waits only when two builds already run; it says so.
  await until(() => idleWorkers(pool).length === 1, { what: 'a new spare' });
  await submit('lid', 'hang');
  pool.submit({ type: 'build', sourceId: 'hinge', mode: 'ok' }, {
    onPhase: message => phases.push({ sourceId: 'hinge', phase: message.phase }),
  });
  assert.equal(pool.status().queued.length, 1);
  assert.deepEqual(phases.filter(entry => entry.sourceId === 'hinge'),
    [{ sourceId: 'hinge', phase: 'waiting for another build' }]);
  assert.equal(pool.status().workers.filter(worker => worker.jobId !== null).length, 2);
});

test('deadline: a job that outlives its Python timeout fails as timeout and its group dies',
  async t => {
    const workerPath = await fakeWorker(t);
    const log = recordEvents();
    const pool = createBuildPool({ workerPath, spare: false, onEvent: log.onEvent });
    t.after(() => pool.close());
    const running = {};
    const result = await new Promise(resolve => {
      pool.submit({
        type: 'build', sourceId: 'spacer', mode: 'grandchild', phase: 'evaluating',
        language: 'python', sourcePath: '/tmp/spacer.py', bytes: Buffer.from('while True: pass'),
        revision: 8, options: { timeoutMs: 100 }, deadlineMs: 400,
      }, {
        onStart: info => {
          running.pid = info.pid;
        },
        onPhase: message => {
          running.grandchild = message.pid;
        },
        onDone: resolve,
      });
    });
    assert.equal(result.ok, false);
    assert.equal(result.failure.kind, 'timeout');
    assert.match(result.failure.error.message, /^Python execution exceeded 100 ms/);
    assert.equal(result.failure.revision, 8);
    assert.equal(log.find('job-deadline').deadlineMs, 400);
    await until(() => !alive(running.pid) && !alive(running.grandchild),
      { timeoutMs: 3000, what: 'the worker group (with the stray interpreter) to die' });
    // The pool keeps working: the next job gets a fresh worker.
    const next = await new Promise(resolve => pool.submit({ type: 'build', mode: 'ok' },
      { onDone: resolve }));
    assert.ok(next.ok);
  });

// A fake pool: records submissions and lets the test answer them.
function fakePool() {
  let next = 1;
  const jobs = new Map();
  const cancelled = [];
  return {
    jobs,
    cancelled,
    allocate: () => next++,
    submit(message, handlers, { jobId = next++ } = {}) {
      jobs.set(jobId, { message, handlers });
      return { jobId };
    },
    cancel(jobId, options) {
      cancelled.push({ jobId, ...options });
      return true;
    },
    resume() {},
  };
}

test('session: a save supersedes at once, late results are dropped, a missing source fails',
  async t => {
    const dir = await directory(t);
    const path = join(dir, 'part.fs');
    await writeFile(path, 'one');
    const pool = fakePool();
    const published = [];
    const registered = [];
    const notices = [];
    const registry = {
      registerLive: async options => {
        registered.push(options);
        return { metadata: { id: sha256(options.bytes), live: { builtAt: 'now' } } };
      },
      setServerPins() {},
    };
    const session = createLiveSession({
      source: { path }, registry, pool, stateDirectory: join(dir, 'state'),
      events: { publish: (name, data) => published.push({ at: Date.now(), name, ...data }) },
      notice: (kind, data) => notices.push({ kind, ...data }), debounceMs: 20,
    });
    t.after(() => session.close());
    await session.prepare();
    session.start();
    const jobFor = revision => [...pool.jobs.entries()]
      .find(([, job]) => job.message.revision === revision);
    const [firstId, first] = jobFor(1);
    first.handlers.onStart({ pid: 1, worker: 'warm' });
    assert.deepEqual(published.map(event => event.name), ['build-queued', 'build-started']);
    const savedAt = Date.now();
    await writeFile(path, 'two');
    const cancelled = await until(() => published.find(event => event.name === 'build-cancelled'),
      { timeoutMs: 3000, what: 'build-cancelled' });
    const after = cancelled.at - savedAt;
    const cancellationIndex = published.indexOf(cancelled);
    const nextQueueIndex = published.findIndex(event => event.name === 'build-queued' && event.revision === 2);
    assert.ok(cancellationIndex < nextQueueIndex && nextQueueIndex >= 0,
      'the save cancels its predecessor before queuing the replacement');
    t.diagnostic(`save cancelled after ${after} ms`);
    assert.deepEqual([cancelled.jobId, cancelled.revision, cancelled.reason,
      cancelled.supersededBy.revision], [firstId, 1, 'superseded', 2]);
    assert.deepEqual(pool.cancelled, [{ jobId: firstId, graceMs: 250, drain: true }],
      'a superseded build may drain');
    const [secondId, second] = jobFor(2);
    assert.equal(String(second.message.bytes), 'two', 'exactly the hashed bytes go to the worker');
    const ok = text => ({ ok: true, bytes: Buffer.from(text), sourceSha256: sha256(text),
      summary: null, timings: {} });
    await first.handlers.onDone({ ...ok('late'), jobId: firstId }, {});
    await second.handlers.onDone({ ...ok('model-two'), jobId: secondId }, {});
    assert.deepEqual(registered.map(entry => entry.live.revision), [2], 'only r2 registers');
    assert.ok(notices.some(notice => notice.kind === 'dropped' && notice.revision === 1));
    assert.equal(session.status().current.revision, 2);
    assert.equal(session.status().lastGood.revision, 2);

    await rm(path);
    const failed = await until(() => published.find(event => event.name === 'build-failed'),
      { timeoutMs: 5000, what: 'missing source failure' });
    assert.equal(failed.failure.kind, 'input');
    assert.match(failed.failure.error.message, /is missing/);
    assert.equal(failed.lastGood.revision, 2);
    assert.equal(pool.jobs.size, 2, 'nothing was submitted for the missing source');
  });

// Regression (fix round): a .py session watched only its own file, so an edit
// to an imported module left a stale model shown as current.
test('session: Python modules the build loaded are watched; the timeout has a deadline',
  async t => {
    const dir = await directory(t);
    const path = join(dir, 'main.py');
    const dims = join(dir, 'dims.py');
    await writeFile(path, 'from dims import R');
    await writeFile(dims, 'R = 8');
    const pool = fakePool();
    const published = [];
    const session = createLiveSession({
      source: { path }, registry: {
        registerLive: async options => ({
          metadata: { id: sha256(options.bytes), live: { builtAt: 'now' } },
        }),
        setServerPins() {},
      }, pool, stateDirectory: join(dir, 'state'), debounceMs: 20,
      events: { publish: (name, data) => published.push({ name, ...data }) },
    });
    t.after(() => session.close());
    await session.prepare();
    session.start();
    const [firstId, first] = [...pool.jobs.entries()][0];
    assert.equal(first.message.deadlineMs, 32000);
    assert.equal(first.message.options.timeoutMs, 30000);
    const { realpath } = await import('node:fs/promises');
    const dimsReal = await realpath(dims);
    await first.handlers.onDone({
      ok: true, jobId: firstId, bytes: Buffer.from('m1'), sourceSha256: 'x', summary: null,
      timings: {}, sourceFiles: [{ path: await realpath(path), sha256: 'self' },
        { path: dimsReal, sha256: sha256('R = 8') }],
    }, {});
    assert.deepEqual(session.status().watched.map(entry => [entry.path, entry.role]),
      [[path, 'source'], [dimsReal, 'module']]);
    await sleep(250);
    assert.equal(pool.jobs.size, 1, 'adopting an unchanged module does not rebuild');
    await writeFile(dims, 'R = 13');
    const changed = await until(() => published.find(event => event.name === 'source-changed'),
      { timeoutMs: 3000, what: 'the module edit to rebuild' });
    assert.deepEqual(changed.files, [dimsReal]);
    assert.equal(pool.jobs.size, 2);
    assert.ok(!session.status().notes.some(note => /not supported/.test(note)));
    // The revision carries the build notices and the build time without the
    // queue wait; /api/live keeps the notices on lastGood (fix round 3).
    const [secondId, second] = [...pool.jobs.entries()][1];
    second.handlers.onStart({ pid: 1, worker: 'warm', queuedMs: 0 });
    const notices = [{ kind: 'ignored-captures', count: 2, message: 'ignored' }];
    await second.handlers.onDone({
      ok: true, jobId: secondId, bytes: Buffer.from('m2'), sourceSha256: 'x', summary: null,
      timings: {}, notices, sourceFiles: [],
    }, {});
    const revision = published.findLast(event => event.name === 'revision');
    assert.deepEqual(revision.notices, notices);
    assert.ok(Number.isFinite(revision.timings.buildMs)
      && revision.timings.buildMs <= revision.timings.totalMs);
    assert.deepEqual(session.status().lastGood.notices, notices);
    // An explicit cancel never drains (a runaway build is not kept alive).
    await writeFile(path, 'from dims import R\n# edit');
    await until(() => pool.jobs.size === 3, { timeoutMs: 3000, what: 'a third build' });
    session.cancel();
    assert.deepEqual(pool.cancelled.at(-1), { jobId: [...pool.jobs.keys()][2], graceMs: 250,
      drain: false });
  });

// Runs bin/wonky-view.mjs; resolves { code, stdout, stderr }.
function cli(args, { env = {}, cwd = root } = {}) {
  const child = spawn(process.execPath, [join(root, 'bin/wonky-view.mjs'), ...args], {
    cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', chunk => {
    stdout += chunk;
  });
  child.stderr.on('data', chunk => {
    stderr += chunk;
  });
  child.result = new Promise(resolve => child.on('exit', (code, signal) => resolve({
    code, signal, stdout, stderr,
  })));
  return child;
}

test('wonky-view: a busy --port exits 1; --json prints only NDJSON; Ctrl-C leaves nothing',
  async t => {
    const dir = await directory(t);
    const blocker = createNetServer();
    await new Promise(done => blocker.listen(0, '127.0.0.1', done));
    t.after(() => new Promise(done => blocker.close(done)));
    const busy = blocker.address().port;
    const source = join(dir, 'box.fs');
    await copyFile(join(root, 'examples', 'box.fs'), source);
    const strict = await cli([source, '--port', String(busy), '--no-open'], {
      env: { WONKY_VIEW_OPENER: '/bin/false' },
    }).result;
    assert.equal(strict.code, 1);
    assert.equal(strict.stderr.trim(), `wonky-view: port ${busy} is in use`);

    // Forty ports next to the busy one (ephemeral ports can sit near 65535).
    const low = busy > 65000 ? busy - 41 : busy + 1;
    const range = `${low}-${low + 39}`;
    const pids = new Set();
    const child = cli([source, '--json', '--no-open', '--reviews', join(dir, 'reviews')], {
      env: { WONKY_VIEW_PORT_RANGE: range },
    });
    t.after(() => {
      if (alive(child.pid)) child.kill('SIGKILL');
    });
    let text = '';
    child.stdout.on('data', chunk => {
      text += chunk;
    });
    await until(() => /"event":"revision"/.test(text), { timeoutMs: 180000, what: 'r1' });
    for (const match of text.matchAll(/"pid":(\d+)/g)) pids.add(Number(match[1]));
    assert.ok(pids.size >= 1, 'the build worker pid is in build-started');
    child.kill('SIGINT');
    const result = await child.result;
    assert.equal(result.code, 0);
    const events = result.stdout.trim().split('\n').map(line => JSON.parse(line));
    assert.equal(events[0].event, 'hello');
    for (const event of events) assert.ok(EVENT_NAMES.includes(event.event), event.event);
    assert.deepEqual([...new Set(events.map(event => event.event))].filter(name =>
      ['build-queued', 'build-started', 'revision'].includes(name)),
    ['build-queued', 'build-started', 'revision']);
    const revision = events.find(event => event.event === 'revision');
    assert.equal(revision.summary.bodies, 1);
    assert.match(result.stderr,
      /^wonky-view {2}http:\/\/127\.0\.0\.1:\d+\/viewer\/ {2}\(port from/m);
    const port = Number(/127\.0\.0\.1:(\d+)/.exec(result.stderr)[1]);
    assert.ok(port >= low && port <= low + 39, `derived port ${port} in ${range}`);
    await until(() => [...pids].every(pid => !alive(pid)), { timeoutMs: 5000,
      what: 'workers to exit after Ctrl-C' });
  });

test('a live revision serves the build worker draw payload, identical to the query worker one',
  async t => {
    const dir = await directory(t);
    const source = join(dir, 'bored-spacer.fs');
    await copyFile(join(root, 'examples', 'bored-spacer.fs'), source);
    const { createReviewServer } = await import('../src/review-server.mjs');
    const server = await createReviewServer({
      sources: [{ path: source }], port: 0, reviewDirectory: join(dir, 'reviews'),
      stateDirectory: join(dir, 'state'), live: { pool: { spare: false } },
    });
    t.after(() => server.close());
    const revision = await new Promise(resolve => server.events.subscribe(event => {
      if (event.name === 'revision' && event.data.revision === 1) resolve(event.data);
    }));
    const id = revision.modelId;
    assert.ok(server.registry.drawPayload(id), 'prepared by the build worker');
    const response = await fetch(`${server.origin}/api/models/${id}/draw`);
    assert.equal(response.status, 200);
    const served = Buffer.from(await response.arrayBuffer());
    assert.equal(served.subarray(0, 4).toString(), 'WKD1');
    const queried = await server.pool.query('draw', id, { modelId: id });
    assert.ok(served.equals(Buffer.from(queried.buffer)), 'same bytes for the same ETag');
    const compact = await (await fetch(`${server.origin}/api/models/${id}`)).text();
    assert.equal(server.registry.sceneText(id), compact, 'sceneText is the compact scene');
  });

}
