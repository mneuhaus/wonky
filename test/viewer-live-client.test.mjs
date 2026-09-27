import test from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missingBend();
if (publicTreeSkip) {
  test("viewer-live-client.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { createHash } = await import("node:crypto");
const { mkdtemp, readFile, rm, writeFile } = await import("node:fs/promises");
const { tmpdir } = await import("node:os");
const { join } = await import("node:path");
const { build } = await import("../src/index.mjs");
const { reviewScene } = await import("../src/review-scene.mjs");
const { createReviewServer } = await import("../src/review-server.mjs");
const { resolveReferences } = await import("../src/viewer/carry.mjs");
const { createViewer } = await import("../viewer/app.js");
const { createEvents, parseEventId } = await import("../viewer/core/events.js");
const { loadFeatures } = await import("../viewer/core/feature-loader.js");
const { FEATURES } = await import("../viewer/features/index.js");
const { annotationModels, buildSeconds, carryMessage, createLiveModel, followMode, liveRevisionOf, noticesOf, pinIds, reduceLive, settle, shouldFollow, TRUST_ROWS, trustInput, trustState } = await import("../viewer/features/live/trust-state.js");
const { bannerDetail, bannerTitle, calledFrom, failureSummary, locationText, noticeDetail, noticeTitle, workerError } = await import("../viewer/features/live/banner.js");
const { chainLines, editorHref, failureMarkup, workerMarkup } = await import("../viewer/features/live/failure-drawer.js");
const { createFakeEnvironment } = await import("../scripts/viewer/test-support/fake-env.mjs");
const { FakeEventSource } = await import("../scripts/viewer/test-support/fake-event-source.mjs");
// Live client (package live-client): trust-state table (spec 7.4, one test per
// row), the live model reducer, the 250 ms settle rule, follow live, pins,
// carry messages, failure texts and drawer markup, the SSE client
// (reconnect, Last-Event-ID, duplicate drop), selection carry on the server
// (resolve route) and the live feature end to end in the fake browser
// environment (follow swap keeps the camera, carries the selection, pill
// "Current r2", follow off shows "r3 available", pause with annotations).




















const sha256 = value => createHash('sha256').update(value).digest('hex');
const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const C = 'c'.repeat(64);
const flush = () => new Promise(resolve => setImmediate(resolve));
async function until(check, what, rounds = 400) {
  for (let round = 0; round < rounds; round++) {
    if (check()) return;
    await flush();
  }
  assert.fail(`Timed out waiting for ${what}`);
}

// A capability failure inside a helper, as the build worker reports it.
const failure = {
  schema: 'wonky.live-build-failure/1', kind: 'capability', revision: 3, jobId: 5,
  source: { path: '/work/part.fs', language: 'featurescript' },
  error: {
    name: 'UnsupportedFeatureError', message: 'opBoolean supports …; general trimmed-face'
      + ' booleans are not implemented',
    location: { file: '/work/part.fs', line: 24, column: 17 }, sourceLine: '  opBoolean(',
    excerpt: { firstLine: 22, text: 'a\nb\n  opBoolean(\nc' },
  },
  failedOperation: { sequence: 4, name: 'opBoolean', operationId: 'model/cut', callStack: [] },
  callSite: { file: '/work/part.fs', line: 57, column: 5 },
  callChain: [
    { kind: 'at', name: 'cut', location: { file: '/work/part.fs', line: 24, column: 17 } },
    { kind: 'called-from', name: 'part', location: { file: '/work/part.fs', line: 57, column: 5 } },
  ],
  completedOperations: 4, timings: { evaluateMs: 812.4 }, lastGood: { revision: 2, modelId: B },
};

// ---- Trust-state table: one test per row (spec 7.4) ----
const base = {
  connected: true, live: true, workerFailed: false, dirty: false,
  displayed: { revision: 2, modelId: B }, good: { revision: 2, modelId: B },
  attempt: { revision: 2, status: 'ok' }, failure: null, loading: null,
};
const row = patch => trustState({ ...base, ...patch });

test('trust row 1: SSE disconnected', () => {
  const state = row({ connected: false, attempt: { revision: 3, status: 'building' } });
  assert.deepEqual([state.row, state.tone, state.text],
    ['disconnected', 'grey', 'Disconnected · showing r2 · reconnecting']);
});

test('trust row 2: build worker failed to start', () => {
  const state = row({ workerFailed: true, attempt: { revision: 3, status: 'queued' } });
  assert.deepEqual([state.row, state.tone, state.text],
    ['worker-failed', 'red', 'Build worker failed to start · showing r2']);
  assert.ok(state.actions.includes('rebuild'));
});

test('trust row 3: no good build, the attempt failed', () => {
  const state = row({ displayed: null, good: null, attempt: { revision: 1, status: 'failed' },
    failure: { ...failure, revision: 1 } });
  assert.deepEqual([state.row, state.tone, state.text],
    ['no-good-build', 'red', 'No successful build · r1 fails at part.fs:24']);
});

test('trust row 4: building or queued, with "showing rD" only when D ≠ G', () => {
  const building = row({ attempt: { revision: 3, status: 'building', phase: 'evaluating',
    elapsedMs: 1234 } });
  assert.deepEqual([building.row, building.tone, building.text],
    ['building', 'blue', 'Building r3 · evaluating · 1.2 s']);
  assert.deepEqual(building.actions, ['cancel']);
  const behind = row({ displayed: { revision: 1, modelId: A },
    attempt: { revision: 3, status: 'queued', phase: 'queued', elapsedMs: 40 } });
  assert.equal(behind.text, 'Building r3 · queued · 0.0 s · showing r1');
  const first = row({ displayed: null, good: null,
    attempt: { revision: 1, status: 'building', phase: 'warming worker', elapsedMs: 400 } });
  assert.equal(first.text, 'Building r1 · warming worker · 0.4 s');
});

test('trust row 5: source changed, build not yet queued', () => {
  const state = row({ dirty: true });
  assert.deepEqual([state.row, state.tone, state.text],
    ['dirty', 'blue', 'Source changed · showing r2']);
});

test('trust row 6: a newer revision downloading', () => {
  const state = row({ good: { revision: 3, modelId: C }, attempt: { revision: 3, status: 'ok' },
    loading: { revision: 3, modelId: C } });
  assert.deepEqual([state.row, state.tone, state.text],
    ['loading', 'blue', 'Loading r3 · showing r2']);
  const empty = row({ displayed: null });
  assert.equal(empty.text, 'Loading r2', 'nothing displayed yet: the good revision loads');
  const swapping = row({ good: { revision: 3, modelId: C }, displayed: { revision: 3, modelId: C },
    attempt: { revision: 3, status: 'ok' }, loading: { revision: 3, modelId: C } });
  assert.equal(swapping.text, 'Loading r3', 'mid-swap: never "Loading r3 · showing r3"');
});

test('trust row 7: the attempt failed and the last good is displayed', () => {
  const state = row({ attempt: { revision: 3, status: 'failed' }, failure });
  assert.deepEqual([state.row, state.tone, state.text],
    ['failed', 'amber', 'Last good r2 · r3 fails at part.fs:24']);
  assert.deepEqual(state.actions, ['details']);
  const cancelled = row({ attempt: { revision: 3, status: 'cancelled' } });
  assert.deepEqual([cancelled.row, cancelled.tone, cancelled.text],
    ['cancelled', 'amber', 'Last good r2 · r3 cancelled']);
});

test('trust row 8: an older revision is displayed (follow off, paused or picked)', () => {
  const state = row({ displayed: { revision: 1, modelId: A } });
  assert.deepEqual([state.row, state.tone, state.text],
    ['older', 'neutral', 'Viewing r1 · r2 is latest']);
  assert.deepEqual(state.actions, ['latest']);
});

test('trust row 9: current only when D = G = A, clean and connected', () => {
  const state = row({});
  assert.deepEqual([state.row, state.tone, state.text], ['current', 'green', 'Current r2']);
  const sameModel = row({ displayed: { revision: 0, modelId: B },
    good: { revision: 4, modelId: B }, attempt: { revision: 4, status: 'ok' } });
  assert.equal(sameModel.text, 'Current r4', 'a rebuild with identical output is current');
  for (const patch of [{ dirty: true }, { connected: false },
    { attempt: { revision: 3, status: 'building' } }, { attempt: { revision: 3, status: 'failed' } },
    { displayed: { revision: 1, modelId: A } }, { loading: { revision: 3 } }]) {
    assert.notEqual(row(patch).row, 'current', JSON.stringify(patch));
  }
});

test('trust row 10: a .brep.json input is a static file', () => {
  const state = row({ live: false, staticLabel: 'r1 · 14:05', attempt: null, good: null });
  assert.deepEqual([state.row, state.tone, state.text],
    ['static', 'neutral', 'Static file · r1 · 14:05']);
  assert.equal(row({ live: false, connected: false, staticLabel: 'r1' }).row, 'disconnected');
  assert.equal(row({ live: false, displayed: null, good: null, attempt: null }).row, 'static');
  const waiting = row({ displayed: null, good: null, attempt: null });
  assert.deepEqual([waiting.row, waiting.text], ['waiting', 'Waiting for the first build']);
  assert.deepEqual(TRUST_ROWS.slice(0, 11), ['disconnected', 'worker-failed', 'no-good-build',
    'building', 'dirty', 'loading', 'failed', 'cancelled', 'older', 'current', 'static']);
});

// ---- Live model from the events ----
const helloData = (overrides = {}) => ({
  session: 's1', clientId: 'tab', sources: [{
    id: 'part-abc', path: '/work/part.fs', label: 'part', language: 'featurescript',
    state: 'ok', watched: [], current: { revision: 2, status: 'ok', modelId: B, jobId: 2 },
    lastGood: { revision: 2, modelId: B, previousSession: false }, lastFailure: null, job: null,
    notes: [], ...overrides,
  }], workers: { failed: null },
});
const event = (model, name, data, time) => reduceLive(model, name,
  { sourceId: 'part-abc', path: '/work/part.fs', ...data }, time);

test('the live model follows hello and every build event', () => {
  const model = reduceLive(createLiveModel(), 'hello', helloData(), 1000);
  const input = time => trustInput(model, { connected: true, displayedId: B, now: time });
  assert.equal(trustState(input(1000)).text, 'Current r2');
  event(model, 'source-changed', { files: ['/work/part.fs'] }, 1100);
  assert.equal(trustState(input(1100)).row, 'dirty');
  event(model, 'build-queued', { jobId: 3, revision: 3, reason: 'save' }, 1110);
  event(model, 'build-started', { jobId: 3, revision: 3, worker: 'warm' }, 1120);
  event(model, 'build-phase', { jobId: 3, revision: 3, phase: 'evaluating', elapsedMs: 5 }, 1125);
  assert.equal(trustState(input(1620)).text, 'Building r3 · evaluating · 0.5 s');
  event(model, 'build-failed', { jobId: 3, revision: 3, failure, lastGood: failure.lastGood },
    1700);
  assert.equal(trustState(input(1700)).text, 'Last good r2 · r3 fails at part.fs:24');
  // A superseded build: cancelled, then the next job is queued at once.
  event(model, 'build-queued', { jobId: 4, revision: 4 }, 1800);
  event(model, 'build-cancelled', { jobId: 4, revision: 4, reason: 'superseded' }, 1810);
  event(model, 'build-queued', { jobId: 5, revision: 5 }, 1811);
  assert.equal(trustState(input(1811)).text, 'Building r5 · queued · 0.0 s');
  event(model, 'build-started', { jobId: 5, revision: 5, worker: 'warm' }, 1820);
  event(model, 'revision', { jobId: 5, revision: 5, modelId: C, timings: { totalMs: 210 } },
    1900);
  assert.equal(model.sources['part-abc'].failure, null, 'a success clears the failure');
  assert.equal(trustState(input(1900)).text, 'Viewing r2 · r5 is latest');
  assert.equal(trustState(trustInput(model, { connected: true, displayedId: C, now: 1900 })).text,
    'Current r5');
  // Cancel by the user keeps the last good model.
  event(model, 'build-queued', { jobId: 6, revision: 6 }, 2000);
  event(model, 'build-cancelled', { jobId: 6, revision: 6, reason: 'cancelled' }, 2100);
  assert.equal(trustState(trustInput(model, { connected: true, displayedId: C, now: 2100 })).text,
    'Last good r5 · r6 cancelled');
  assert.deepEqual(liveRevisionOf(model, C), { sourceId: 'part-abc', revision: 5, modelId: C });
});

test('hello restores a running build, a failure, a worker failure and r0 ordering', () => {
  const running = reduceLive(createLiveModel(), 'hello', helloData({
    job: { jobId: 3, revision: 3, state: 'building', phase: 'evaluating', elapsedMs: 700 },
  }), 5000);
  assert.equal(trustState(trustInput(running, { connected: true, displayedId: B, now: 5500 }))
    .text, 'Building r3 · evaluating · 1.2 s');
  const failing = reduceLive(createLiveModel(), 'hello', helloData({
    current: { revision: 3, status: 'failed', jobId: 3 }, lastFailure: failure,
  }), 0);
  assert.equal(failing.sources['part-abc'].failure.kind, 'capability');
  const worker = reduceLive(createLiveModel(), 'hello', { ...helloData(),
    workers: { failed: { failures: 3, windowMs: 60000, stderrTail: 'boom' } } }, 0);
  assert.equal(trustState(trustInput(worker, { connected: true, displayedId: B })).row,
    'worker-failed');
  event(worker, 'build-started', { jobId: 9, revision: 9 }, 1);
  assert.equal(worker.workerFailed, null, 'a started build means the pool recovered');
  // r0 (previous session) registered after r1 does not replace r1 as last good.
  const model = reduceLive(createLiveModel(), 'hello', helloData({
    current: null, lastGood: null,
    job: { jobId: 1, revision: 1, state: 'queued', elapsedMs: 0 },
  }), 0);
  event(model, 'revision', { jobId: 1, revision: 1, modelId: B }, 10);
  event(model, 'revision', { jobId: null, revision: 0, modelId: A, previousSession: true }, 11);
  assert.deepEqual(model.sources['part-abc'].lastGood,
    { revision: 1, modelId: B, previousSession: false });
});

test('the 250 ms settle rule keeps fast builds from flickering', () => {
  const current = { row: 'current', text: 'Current r1' };
  const building = { row: 'building', text: 'Building r2' };
  assert.deepEqual(settle(building, current, { busySince: 1000, now: 1100 }),
    { state: current, wakeAt: 1250 });
  assert.deepEqual(settle(building, current, { busySince: 1000, now: 1250 }),
    { state: building, wakeAt: null });
  assert.deepEqual(settle({ row: 'current', text: 'Current r2' }, current,
    { busySince: 1000, now: 1100 }).state.text, 'Current r2');
  assert.equal(settle(building, building, { busySince: 1000, now: 1010 }).state, building);
  assert.equal(settle(building, null, { busySince: 1000, now: 1010 }).state, building);
  assert.deepEqual([12, 210, 2650, 3600].map(buildSeconds), ['0.01 s', '0.21 s', '2.65 s',
    '3.6 s'], 'build time reads like the terminal line');
});

// ---- Follow, pins, carry messages ----
test('follow live: on, off, paused by annotations on a displayed revision', () => {
  const annotations = [{ view: { after: A, before: A }, target: { modelId: C } }];
  assert.deepEqual([...annotationModels(annotations)].sort(), [A, C]);
  assert.deepEqual([...annotationModels([{ view: { after: A, before: B, compare: false } },
    { view: { after: C, before: B, compare: true } }])].sort(), [A, B, C],
  'a single-mode view does not reference its hidden before model');
  assert.deepEqual([...annotationModels([{ view: { after: A, before: B } }])], [A]);
  assert.equal(followMode({ enabled: true, annotations: [], displayedIds: [A] }), 'on');
  assert.equal(followMode({ enabled: false, annotations, displayedIds: [A] }), 'off');
  assert.equal(followMode({ enabled: true, annotations, displayedIds: [A] }), 'paused');
  assert.equal(followMode({ enabled: true, annotations, displayedIds: [B] }), 'on');
  assert.equal(shouldFollow({ mode: 'on', displayedId: A, previousGoodId: A, targetId: B }), true);
  assert.equal(shouldFollow({ mode: 'off', displayedId: A, previousGoodId: A, targetId: B }), false);
  assert.equal(shouldFollow({ mode: 'paused', displayedId: A, previousGoodId: A, targetId: B }),
    false);
  assert.equal(shouldFollow({ mode: 'on', displayedId: C, previousGoodId: A, targetId: B }), false);
  assert.equal(shouldFollow({ mode: 'on', displayedId: C, previousGoodId: A, targetId: B,
    trailing: true }), true);
  assert.equal(shouldFollow({ mode: 'on', displayedId: null, targetId: B }), true);
});

test('pins: displayed, compare and annotated revisions, deduplicated and valid only', () => {
  assert.deepEqual(pinIds({ after: B, before: A, compare: false, annotations: [] }), [B]);
  assert.deepEqual(pinIds({
    after: B, before: A, compare: true, annotations: [{ target: { modelId: C } }],
    extra: ['not-an-id', B],
  }), [A, B, C]);
});

test('carry messages name what did not carry and why', () => {
  const exact = { status: 'exact', fromAlias: 'B1.F1' };
  assert.equal(carryMessage([exact], 'r3'), null);
  assert.equal(carryMessage([exact, { status: 'lost', fromAlias: 'B1.F3',
    stability: 'revision-local' }], 'r3'), 'B1.F3 has a revision-local identity; not carried to r3');
  assert.equal(carryMessage([
    { status: 'lost', fromAlias: 'B1.F3', stability: 'revision-local' },
    { status: 'lost', fromAlias: 'B1.F4', stability: 'revision-local' },
    { status: 'ambiguous', fromAlias: 'B2' },
    { status: 'lost', fromAlias: 'B1.E1', stability: 'semantic' },
  ], 'r4'), 'B1.F3 and B1.F4 have revision-local identities; not carried to r4. B2 matches'
    + ' several entities in r4; not carried. B1.E1 has no identity match in r4; not carried');
});

// ---- Failure texts and drawer ----
test('failure banner: file:line:col, operation and "called from" the call site', () => {
  assert.equal(locationText(failure.error.location), 'part.fs:24:17');
  assert.equal(failureSummary(failure), 'capability error at part.fs:24:17 in opBoolean');
  assert.equal(calledFrom(failure), 'called from part.fs:57');
  assert.equal(calledFrom({ ...failure, callSite: null }), null);
  assert.equal(bannerTitle({ failure, displayed: { revision: 2, modelId: B },
    good: { revision: 2, modelId: B } }), 'Showing last good r2. Source now fails: capability'
    + ' error at part.fs:24:17 in opBoolean, called from part.fs:57');
  assert.equal(bannerTitle({ failure, displayed: { revision: 1, modelId: A },
    good: { revision: 2, modelId: B } }).slice(0, 16), 'Showing r1. Sour');
  assert.match(bannerDetail(failure), /booleans are not implemented$/);
  assert.equal(bannerTitle({ failure: { ...failure, callSite: null }, displayed: null,
    good: null }), 'Showing the last model. Source now fails: capability error at'
    + ' part.fs:24:17 in opBoolean');
  const syntax = { kind: 'input', error: { message: "Expected ';'",
    location: { file: '/w/b.fs', line: 31, column: 9 } } };
  assert.equal(failureSummary(syntax), 'input error at b.fs:31:9');
});

test('failure drawer: excerpt, call chain, operation and zed:// editor links', () => {
  assert.equal(editorHref(failure.error.location, 'zed'), 'zed://file/work/part.fs:24:17');
  assert.equal(editorHref({ file: 'relative.fs', line: 1 }, 'zed'), null);
  assert.equal(editorHref(failure.error.location, 'nano'), null);
  assert.deepEqual(chainLines(failure).map(line => line.text),
    ['at cut (part.fs:24:17)', 'called from part.fs:57:5 in part']);
  const markup = failureMarkup(failure, { scheme: 'zed', lastGood: { revision: 2 } });
  assert.match(markup, /id="live-drawer-editor" class="button secondary" href="zed:\/\/file\/work\/part\.fs:24:17"/);
  assert.match(markup, /live-excerpt-current"><span class="live-excerpt-number">24<\/span>  opBoolean\(/);
  assert.match(markup, /href="zed:\/\/file\/work\/part\.fs:57:5">called from part\.fs:57:5 in part/);
  assert.match(markup, /opBoolean \(model\/cut\) #4/);
  assert.match(markup, /<dt>Completed operations<\/dt><dd>4<\/dd>/);
  assert.match(markup, /<dt>evaluate<\/dt><dd>812 ms<\/dd>/);
  assert.doesNotMatch(markup, /<script/);
  const worker = workerMarkup({ failures: 3, stderrTail: '<boom>', attempts: [{ at: 't', code: 3 }] });
  assert.match(worker, /&lt;boom&gt;/);
});

// Regressions (fix round 3, verify:live#3): a worker start failure showed the
// last stack frame and claimed a model on screen that was not there; show()
// calls the result contract ignored were not reported; a Python module frame
// has no function name for a latched capability error.
test('worker start errors, build notices and unnamed frames read right', () => {
  const tail = "file:///w/src/python.mjs:3\nimport { extrudeInBend } from './kernel.mjs';\n"
    + "SyntaxError: The requested module './kernel.mjs' does not provide an export named"
    + " 'extrudeInBend'\n    at ModuleJob._instantiate (node:internal/modules/esm/module_job:180:21)"
    + '\n    at async main (file:///w/src/viewer/live/build-worker.mjs:332:13)';
  const message = "SyntaxError: The requested module './kernel.mjs' does not provide an export"
    + " named 'extrudeInBend'";
  assert.equal(workerError({ stderrTail: tail }), message, 'not the last stack frame');
  assert.equal(workerError({ error: 'Error: boom', stderrTail: tail }), 'Error: boom');
  const none = workerMarkup({ failures: 3, error: message, stderrTail: tail });
  assert.match(none, /No model is shown until a build succeeds/);
  assert.doesNotMatch(none, /The model on screen/);
  assert.match(none, /live-drawer-message">SyntaxError: The requested module/);
  assert.match(workerMarkup({ failures: 3 }, { displayed: true }),
    /The model on screen is the last one that built/);
  const notices = [{ kind: 'ignored-captures', count: 2, message: "2 show/export calls ignored:"
    + " the module-level 'result' is the result (Python result contract)",
  detail: 'A module-level result or assembly wins over show() and export calls;'
    + ' see docs/python-frontend.md.' }];
  assert.equal(noticeTitle({ notices, displayed: { revision: 6 } }), "r6: 2 show/export calls"
    + " ignored: the module-level 'result' is the result (Python result contract)");
  assert.match(noticeDetail({ notices }), /wins over show\(\) and export calls/);
  const model = createLiveModel();
  reduceLive(model, 'hello', { session: 's', sources: [{ id: 'm', path: '/w/main.py',
    lastGood: { revision: 5, modelId: 'a'.repeat(64), notices } }] }, 0);
  assert.deepEqual(noticesOf(model.sources.m, 5), notices, 'hello carries the notices');
  reduceLive(model, 'revision', { sourceId: 'm', revision: 6, modelId: 'b'.repeat(64), notices },
    0);
  reduceLive(model, 'revision', { sourceId: 'm', revision: 7, modelId: 'c'.repeat(64),
    notices: [] }, 0);
  assert.deepEqual(noticesOf(model.sources.m, 6), notices);
  assert.deepEqual(noticesOf(model.sources.m, 7), []);
  assert.deepEqual(chainLines({ callChain: [
    { kind: 'at', name: null, location: { file: '/w/helper.py', line: 4, column: 12 } },
    { kind: 'called-from', name: null, location: { file: '/w/main.py', line: 12, column: 8 } },
  ] }).map(line => line.text), ['at helper.py:4:12', 'called from main.py:12:8']);
});

// ---- SSE client ----
test('SSE client: client id, events, duplicate drop, reconnect with Last-Event-ID', () => {
  FakeEventSource.instances = [];
  const timers = [];
  const env = {
    EventSource: FakeEventSource,
    setTimeout: (run, ms) => timers.push({ run, ms }),
    clearTimeout() {},
  };
  assert.equal(createEvents(env, { enabled: false }).connect({ clientId: 'x' }), false,
    'disabled under the legacy seam');
  assert.equal(createEvents({}, { enabled: true }).connect(), false, 'no EventSource');
  const events = createEvents(env, { enabled: true });
  const seen = [];
  const states = [];
  events.on('hello', data => seen.push(['hello', data.session]));
  events.on('revision', (data, meta) => seen.push(['revision', data.revision, meta.seq]));
  events.on('connection', ({ state }) => states.push(state));
  assert.equal(events.connect({ clientId: 'tab-1' }), true);
  const first = FakeEventSource.instances[0];
  assert.equal(first.url, '/api/events?client=tab-1');
  first.open();
  first.send('hello', { session: 's1' }, 's1:4');
  first.send('revision', { revision: 2 }, 's1:5');
  first.send('revision', { revision: 2 }, 's1:5');
  first.send('revision', { revision: 1 }, 's1:3');
  assert.deepEqual(seen, [['hello', 's1'], ['revision', 2, 5]], 'replayed duplicates dropped');
  // The browser retries on its own (CONNECTING): no new EventSource.
  first.fail(0);
  assert.equal(events.connected(), false);
  assert.equal(FakeEventSource.instances.length, 1);
  first.open();
  first.send('revision', { revision: 3 }, 's1:6');
  // Given up (CLOSED): reopened after backoff with the last event id.
  first.fail(2);
  assert.equal(timers.length, 1);
  assert.equal(timers[0].ms, 2000);
  timers[0].run();
  const second = FakeEventSource.instances[1];
  assert.equal(second.url, '/api/events?client=tab-1&lastEventId=s1%3A6');
  second.open();
  // A restarted server (new session) answers hello; its events pass.
  second.send('hello', { session: 's2' }, 's2:0');
  second.send('revision', { revision: 1 }, 's2:1');
  assert.deepEqual(seen.slice(2), [['revision', 3, 6], ['hello', 's2'], ['revision', 1, 1]]);
  assert.deepEqual(states, ['connecting', 'open', 'connecting', 'open', 'closed', 'open']);
  assert.deepEqual(parseEventId('s2:10'), { session: 's2', seq: 10 });
  events.close();
  assert.equal(second.closed, true);
});

// ---- Server: selection carry through recorded identity ----
const bracketSource = await readFile(new URL('../examples/bracket.fs', import.meta.url), 'utf8');
const slotSource = await readFile(
  new URL('../scripts/viewer/audit-data/arc-slot.fs', import.meta.url), 'utf8');
const models = {
  bracket8: await build(bracketSource),
  bracket10: await build(bracketSource, { parameters: { thickness: '10 * millimeter' } }),
  slot4: await build(slotSource),
  slot5: await build(slotSource.replace('"endDepth" : 4 * millimeter',
    '"endDepth" : 5 * millimeter')),
};
const face = (model, index, entityType = 'face') => ({
  bodyId: model.bodies[0].id, entityType, entityIndex: entityType === 'body' ? 0 : index,
});

test('carry: semantic identities carry exactly; revision-local ones are lost with a reason', () => {
  const { bracket8, bracket10, slot4, slot5 } = models;
  const slot = resolveReferences(slot4, slot5, [3, 4].map(index => face(slot4, index)));
  assert.deepEqual(slot.map(result => [result.status, result.alias, result.stability]),
    [['exact', 'B1.F4', 'semantic'], ['exact', 'B1.F5', 'semantic']]);
  const bracket = resolveReferences(bracket8, bracket10,
    [face(bracket8, 0), face(bracket8, 2), face(bracket8, 0, 'body'), face(bracket8, 0, 'edge')]);
  assert.deepEqual(bracket.map(result => [result.status, result.fromAlias, result.stability]), [
    ['exact', 'B1.F1', 'semantic'], ['lost', 'B1.F3', 'revision-local'],
    ['exact', 'B1', 'semantic'], ['lost', 'B1.E1', 'revision-local'],
  ]);
  assert.match(bracket[1].reason, /Revision-local topology cannot be matched/);
  assert.equal(resolveReferences(bracket8, bracket8, [face(bracket8, 2)])[0].status, 'exact',
    'the same geometry revision matches revision-local identities');
  assert.equal(resolveReferences(bracket8, bracket10, [{ bodyId: 'nope', entityType: 'face',
    entityIndex: 0 }])[0].status, 'lost');
  assert.equal(resolveReferences(bracket8, bracket10, [face(bracket8, 99)])[0].status, 'lost');
  assert.throws(() => resolveReferences(bracket8, bracket10, [{ bodyId: 'x', entityType: 'solid',
    entityIndex: 0 }]), /entityType must be one of/);
});

test('POST /api/models/:id/resolve answers exact, lost and explicit errors', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'wonky-live-client-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const paths = {};
  for (const name of ['slot4', 'slot5', 'bracket8', 'bracket10']) {
    paths[name] = join(dir, `${name}.brep.json`);
    await writeFile(paths[name], JSON.stringify(models[name]));
  }
  const ids = Object.fromEntries(await Promise.all(Object.entries(paths).map(async ([name,
    path]) => [name, sha256(await readFile(path))])));
  const server = await createReviewServer({
    modelPaths: Object.values(paths), root: dir, reviewDirectory: join(dir, 'reviews'), port: 0,
  });
  t.after(() => server.close());
  const base = server.url.replace('/viewer/', '');
  const post = (to, body) => fetch(`${base}/api/models/${to}/resolve`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base },
    body: JSON.stringify(body),
  }).then(async response => ({ status: response.status, data: await response.json() }));
  const slot = await post(ids.slot5, {
    from: ids.slot4, references: [{ modelId: ids.slot4, ...face(models.slot4, 3) }],
  });
  assert.equal(slot.status, 200);
  assert.equal(slot.data.schema, 'wonky.resolve/1');
  assert.deepEqual(slot.data.results[0].reference, {
    modelId: ids.slot5, bodyId: models.slot5.bodies[0].id, entityType: 'face', entityIndex: 3,
  });
  const bracket = await post(ids.bracket10, {
    from: ids.bracket8, references: [face(models.bracket8, 2)],
  });
  assert.equal(bracket.data.results[0].status, 'lost');
  assert.equal(bracket.data.results[0].fromAlias, 'B1.F3');
  assert.equal(bracket.data.results[0].reference, undefined);
  assert.equal((await post(ids.bracket10, { from: 'x', references: [] })).status, 400);
  assert.equal((await post(ids.bracket10, { from: 'f'.repeat(64), references: [] })).status,
    404);
  assert.equal((await post('f'.repeat(64), { from: ids.bracket8, references: [] })).status, 404);
  assert.equal((await post(ids.bracket10, { from: ids.bracket8,
    references: [{ modelId: ids.slot4, ...face(models.bracket8, 0) }] })).status, 400);
  assert.equal((await post(ids.bracket10, { from: ids.bracket8,
    references: new Array(65).fill(face(models.bracket8, 0)) })).status, 400);
});

// ---- The live feature in the fake browser environment ----
const { features: allFeatures, failures: loadFailures } = await loadFeatures(FEATURES);
assert.deepEqual(loadFailures, []);

async function sceneOf(model, id) {
  return reviewScene(model, { id, label: 'part', sha256: id, bodyCount: model.bodies.length });
}

test('live feature: follow swaps keep the camera, carry the selection, pill "Current r2"',
  async () => {
    const slot4 = sha256(JSON.stringify(models.slot4));
    const slot5 = sha256(JSON.stringify(models.slot5));
    const scenes = { [slot4]: await sceneOf(models.slot4, slot4),
      [slot5]: await sceneOf(models.slot5, slot5) };
    const listed = [];
    const live = (id, revision) => ({
      id, label: 'part', sha256: id, sourcePath: '/work/part.fs', bodyCount: 1,
      bounds: scenes[id].bounds,
      live: { sourceId: 'part-abc', path: '/work/part.fs', revision, revisions: [revision] },
    });
    const requests = [];
    let settingsDocument = { schema: 'wonky.viewer-settings/1', global: {}, sources: {},
      bodies: {} };
    const dispatch = (path, options = {}) => {
      requests.push(`${options.method ?? 'GET'} ${path}`);
      if (path === '/api/settings') {
        if (options.method === 'PUT') {
          const patch = JSON.parse(options.body);
          for (const [source, values] of Object.entries(patch.sources ?? {})) {
            settingsDocument.sources[source] = { ...settingsDocument.sources[source], ...values };
          }
        }
        return structuredClone(settingsDocument);
      }
      if (path === '/api/workspace') return { models: listed, reports: [], feedback: [] };
      if (path.startsWith('/api/compare?')) throw new Error('delta strip: not part of this test');
      if (path === '/api/compare/revisions') {
        return { revisions: listed.map(item => ({ modelId: item.id, kind: 'live',
          source: '/work/part.fs', revision: item.live.revision })) };
      }
      const model = /^\/api\/models\/([a-f0-9]{64})(\/resolve)?$/.exec(path);
      if (model?.[2]) {
        const body = JSON.parse(options.body);
        const from = body.from === slot4 ? models.slot4 : models.slot5;
        const to = model[1] === slot4 ? models.slot4 : models.slot5;
        return { results: resolveReferences(from, to, body.references).map(result => ({
          ...result, reference: result.status === 'exact' ? { modelId: model[1],
            bodyId: result.bodyId, entityType: result.entityType,
            entityIndex: result.entityIndex } : undefined,
        })) };
      }
      if (model) return scenes[model[1]];
      if (path.startsWith('/api/live/')) return {};
      return {};
    };
    const fake = createFakeEnvironment({ dispatch });
    fake.env.EventSource = FakeEventSource;
    FakeEventSource.instances = [];
    const viewer = createViewer(fake.env, { features: allFeatures, log: () => {} });
    const { state } = viewer.harness;
    const app = viewer.ctx.app;
    const stream = FakeEventSource.instances[0];
    assert.match(stream.url, /^\/api\/events\?client=[A-Za-z0-9_-]+$/);
    stream.open();
    const send = (name, data, seq) => stream.send(name,
      { sourceId: 'part-abc', path: '/work/part.fs', ...data }, `s1:${seq}`);
    stream.send('hello', { session: 's1', sources: [{ id: 'part-abc', path: '/work/part.fs',
      label: 'part', language: 'featurescript', state: 'queued',
      job: { jobId: 1, revision: 1, state: 'building', phase: 'evaluating', elapsedMs: 10 },
      current: null, lastGood: null }], workers: { failed: null } }, 's1:0');
    assert.equal(fake.node('#live-pill-text').textContent, 'Building r1 · evaluating · 0.0 s');
    // r1 builds: the first display (fitted by the camera policy).
    listed.push(live(slot4, 1));
    send('revision', { jobId: 1, revision: 1, modelId: slot4, timings: { totalMs: 180 } }, 1);
    await until(() => state.after === slot4 && !state.loading, 'first display');
    await until(() => fake.node('#live-pill-text').textContent === 'Current r1', 'Current r1');
    assert.equal(fake.node('#live-pill-extra').textContent, '· 0.18 s · part.fs');
    // Select two semantic faces, move the camera, then r2 arrives.
    const [first, second] = [3, 4].map(index => ({ modelId: slot4,
      bodyId: models.slot4.bodies[0].id, entityType: 'face', entityIndex: index }));
    app.select([first, second], false);
    viewer.ctx.store.update('test.camera', current => {
      current.view.camera = { ...current.view.camera, yaw: 0.7, pitch: 0.3 };
    });
    const camera = JSON.stringify(state.camera);
    // Regression (fix round): every followed swap flashed "Viewing r1 · r2 is
    // latest" (with Go to latest) before the loading row. Record every text
    // the chip and the pill get during a fast swap.
    const texts = [];
    for (const selector of ['#live-chip-text', '#live-pill-text']) {
      const node = fake.node(selector);
      let value = node.textContent;
      Object.defineProperty(node, 'textContent', {
        configurable: true,
        get: () => value,
        set: next => {
          value = next;
          texts.push(next);
        },
      });
    }
    send('source-changed', { files: ['/work/part.fs'] }, 2);
    send('build-queued', { jobId: 2, revision: 2, reason: 'save' }, 3);
    listed.push(live(slot5, 2));
    send('revision', { jobId: 2, revision: 2, modelId: slot5, timings: { totalMs: 3411,
      queuedMs: 3321, buildMs: 90 }, notices: [{ kind: 'ignored-captures', count: 1,
      message: "1 show/export call ignored: the module-level 'result' is the result",
      detail: 'A module-level result or assembly wins over show() and export calls.' }] }, 4);
    await until(() => state.after === slot5 && !state.loading
      && app.liveStatus().lastSwap?.to === slot5, 'swap to r2');
    assert.equal(JSON.stringify(state.camera), camera, 'the camera is unchanged');
    assert.deepEqual(state.selectionSet.map(reference => [reference.modelId, reference.entityIndex]),
      [[slot5, 3], [slot5, 4]], 'the arc-slot faces carried to r2');
    await until(() => fake.node('#live-pill-text').textContent === 'Current r2', 'Current r2');
    assert.equal(fake.node('#live-chip-text').textContent, 'Current r2');
    // Build time without the queue wait (fix round 3), and the build notice.
    assert.equal(fake.node('#live-pill-extra').textContent, '· 0.09 s (queued 3.32 s) · part.fs');
    assert.equal(fake.node('#live-banner').hidden, false, 'the notice banner shows');
    assert.equal(fake.node('#live-banner').dataset.tone, 'blue');
    assert.equal(fake.node('#live-banner-title').textContent,
      "r2: 1 show/export call ignored: the module-level 'result' is the result");
    assert.equal(fake.node('#live-banner-details').hidden, true);
    assert.deepEqual(texts.filter(text => !/^Current r[12]$/.test(text)), [],
      'a fast followed swap goes from Current r1 straight to Current r2');
    assert.equal(texts.at(-1), 'Current r2');
    assert.ok(requests.includes(`POST /api/models/${slot5}/resolve`));
    assert.equal(viewer.ctx.store.get().live.swap.to, slot5, 'derived data sees the swap');
    // Follow off (L): r3 waits and "r3 available" appears.
    fake.document.emit('keydown', { key: 'l' });
    await until(() => settingsDocument.sources['/work/part.fs']?.followLive === false,
      'follow off persisted');
    const slot6 = 'd'.repeat(64);
    scenes[slot6] = scenes[slot4];
    listed.push(live(slot6, 3));
    send('build-queued', { jobId: 3, revision: 3 }, 5);
    send('revision', { jobId: 3, revision: 3, modelId: slot6 }, 6);
    await until(() => fake.node('#live-available').textContent === 'r3 available · follow off (L)'
      && !fake.node('#live-available').hidden, 'r3 available chip');
    assert.equal(state.after, slot5, 'the view stays on r2');
    assert.equal(fake.node('#live-pill-text').textContent, 'Viewing r2 · r3 is latest');
    // Follow on again with an annotation on the displayed revision: paused.
    state.annotations.push({ tool: 'comment', text: 'check', points: [[0.5, 0.5]],
      view: { after: slot5, before: slot5 } });
    fake.document.emit('keydown', { key: 'l' });
    await until(() => settingsDocument.sources['/work/part.fs']?.followLive === true,
      'follow on persisted');
    viewer.ctx.store.update('test.annotations', () => {});
    await until(() => /follow paused: review annotations on r2/
      .test(fake.node('#live-available').textContent), 'paused note');
    assert.equal(state.after, slot5, 'paused: the view stays');
    // A failing build: amber banner with the call site, library row badge, drawer.
    send('build-queued', { jobId: 4, revision: 4 }, 7);
    send('build-failed', { jobId: 4, revision: 4, failure: { ...failure, revision: 4 },
      lastGood: { revision: 3, modelId: slot6 } }, 8);
    await until(() => !fake.node('#live-banner').hidden, 'failure banner');
    assert.equal(fake.node('#live-banner-title').textContent, 'Showing r2. Source now fails:'
      + ' capability error at part.fs:24:17 in opBoolean, called from part.fs:57');
    assert.equal(fake.node('#live-banner-editor').getAttribute('href'),
      'zed://file/work/part.fs:24:17');
    assert.match(fake.node('#library-content').innerHTML,
      /<span class="item-badge live-badge" data-tone="amber">r4 fails<\/span>/);
    viewer.ctx.commands.run('live.details');
    await until(() => /live-drawer/.test(fake.node('#report-content').innerHTML), 'drawer');
    assert.match(fake.node('#report-content').innerHTML, /called from part\.fs:57:5 in part/);
    viewer.dispose();
  });

// Regressions (fix round 2, verifier live and browser lenses): a rebuild that
// reproduces an earlier model is listed under its new revision (D1); the
// library learns about revisions of a source it does not display (L4); a
// reload keeps the displayed source even when it is not the first (L3); a
// server restart keeps showing the model until its source is back, and does
// not switch to the first source (L2).
test('live feature: same-model rebuilds, other sources, reload and restart keep the source',
  async () => {
    const ids = {
      slot4: sha256(JSON.stringify(models.slot4)), slot5: sha256(JSON.stringify(models.slot5)),
      bracket8: sha256(JSON.stringify(models.bracket8)),
      bracket10: sha256(JSON.stringify(models.bracket10)),
    };
    const scenes = {};
    for (const [name, id] of Object.entries(ids)) scenes[id] = await sceneOf(models[name], id);
    const sources = {
      part: { sourceId: 'part-abc', path: '/work/part.fs', label: 'part' },
      other: { sourceId: 'other-def', path: '/work/other.fs', label: 'other' },
    };
    let listed = [];
    const entry = (source, id, revision) => ({
      id, label: sources[source].label, sha256: id, sourcePath: sources[source].path,
      bodyCount: 1, bounds: scenes[id].bounds,
      live: { sourceId: sources[source].sourceId, path: sources[source].path, revision,
        revisions: [revision] },
    });
    const requests = [];
    const dispatch = (path, options = {}) => {
      requests.push(`${options.method ?? 'GET'} ${path}`);
      if (path === '/api/settings') {
        return { schema: 'wonky.viewer-settings/1', global: {}, sources: {}, bodies: {} };
      }
      if (path === '/api/workspace') {
        return { models: structuredClone(listed), reports: [], feedback: [] };
      }
      if (path.startsWith('/api/compare?')) throw new Error('delta strip: not part of this test');
      if (path === '/api/compare/revisions') {
        return { revisions: listed.map(item => ({ modelId: item.id, kind: 'live',
          source: item.sourcePath, revision: item.live.revision })) };
      }
      const model = /^\/api\/models\/([a-f0-9]{64})$/.exec(path);
      if (model) return scenes[model[1]];
      return {};
    };
    const fake = createFakeEnvironment({ dispatch });
    const store = new Map();
    fake.env.window.sessionStorage = {
      getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, value),
    };
    fake.env.EventSource = FakeEventSource;
    FakeEventSource.instances = [];
    let viewer = createViewer(fake.env, { features: allFeatures, log: () => {} });
    let stream = FakeEventSource.instances.at(-1);
    stream.open();
    const hello = (session, lastGood = {}) => stream.send('hello', { session,
      sources: Object.entries(sources).map(([name, source]) => ({ id: source.sourceId,
        path: source.path, label: source.label, language: 'featurescript', state: 'idle',
        job: null, current: lastGood[name] ?? null, lastGood: lastGood[name] ?? null })),
      workers: { failed: null } }, `${session}:0`);
    let seq = 1;
    const send = (session, source, name, data) => stream.send(name,
      { sourceId: sources[source].sourceId, path: sources[source].path, ...data },
      `${session}:${seq++}`);
    hello('s1');
    listed = [entry('part', ids.slot4, 1), entry('other', ids.bracket8, 1)];
    send('s1', 'part', 'revision', { jobId: 1, revision: 1, modelId: ids.slot4 });
    send('s1', 'other', 'revision', { jobId: 2, revision: 1, modelId: ids.bracket8 });
    let state = viewer.harness.state;
    await until(() => state.after === ids.slot4 && !state.loading, 'first display (part r1)');
    // L4: a new revision of the other source reaches the library.
    listed.push(entry('other', ids.bracket10, 2));
    send('s1', 'other', 'revision', { jobId: 3, revision: 2, modelId: ids.bracket10 });
    await until(() => state.workspace.models.some(item => item.id === ids.bracket10),
      'other r2 listed without a reload');
    assert.equal(state.after, ids.slot4, 'the view stays on part');
    // D1: part r2, r3 fails, r4 reproduces r2 (same model id, listed as r4).
    listed.push(entry('part', ids.slot5, 2));
    send('s1', 'part', 'revision', { jobId: 4, revision: 2, modelId: ids.slot5 });
    await until(() => state.after === ids.slot5 && !state.loading, 'follow to part r2');
    send('s1', 'part', 'build-queued', { jobId: 5, revision: 3 });
    send('s1', 'part', 'build-failed', { jobId: 5, revision: 3,
      failure: { ...failure, revision: 3, source: { path: '/work/part.fs' } },
      lastGood: { revision: 2, modelId: ids.slot5 } });
    const r2 = listed.find(item => item.id === ids.slot5);
    r2.live = { ...r2.live, revision: 4, revisions: [2, 4] };
    send('s1', 'part', 'build-queued', { jobId: 6, revision: 4 });
    send('s1', 'part', 'revision', { jobId: 6, revision: 4, modelId: ids.slot5, sameAs: 2 });
    await until(() => state.workspace.models.find(item => item.id === ids.slot5)?.live.revision
      === 4, 'the reproduced model is listed as r4');
    await until(() => fake.node('#live-pill-text').textContent === 'Current r4', 'Current r4');
    // L3: open the other source, reload: the tab shows the other source again.
    viewer.ctx.app.openModel(ids.bracket10);
    await until(() => state.after === ids.bracket10 && !state.loading, 'other source open');
    await until(() => JSON.parse(store.get('wonky.live.displayed')).modelId === ids.bracket10,
      'displayed source remembered');
    viewer.dispose();
    viewer = createViewer(fake.env, { features: allFeatures, log: () => {} });
    state = viewer.harness.state;
    stream = FakeEventSource.instances.at(-1);
    stream.open();
    hello('s1', { part: { revision: 4, modelId: ids.slot5 },
      other: { revision: 2, modelId: ids.bracket10 } });
    await until(() => state.after && !state.loading, 'startup after reload');
    assert.equal(state.after, ids.bracket10, 'the reload keeps the other source');
    // L2: a restarted server lists nothing yet; the tab keeps the model and
    // does not show "No models yet"; then part r0 comes first, other r0 later.
    listed = [];
    seq = 1;
    hello('s2');
    for (let round = 0; round < 20; round++) await flush();
    assert.equal(state.after, ids.bracket10, 'still showing the other source');
    assert.notEqual(fake.node('#viewport-message-title').textContent, 'No models yet',
      'no "No models yet" message');
    listed = [entry('part', ids.slot5, 0)];
    send('s2', 'part', 'revision', { jobId: null, revision: 0, modelId: ids.slot5,
      previousSession: true });
    for (let round = 0; round < 20; round++) await flush();
    assert.equal(state.after, ids.bracket10, 'the first source coming back first does not win');
    listed.push(entry('other', ids.bracket10, 0));
    send('s2', 'other', 'revision', { jobId: null, revision: 0, modelId: ids.bracket10,
      previousSession: true });
    await until(() => state.workspace.models.some(item => item.id === ids.bracket10),
      'the new session list');
    assert.equal(state.after, ids.bracket10);
    viewer.dispose();
  });

}
