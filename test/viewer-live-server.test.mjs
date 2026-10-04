import test from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missingBend();
if (publicTreeSkip) {
  test("viewer-live-server.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { EventEmitter, once } = await import("node:events");
const { createServer: createNetServer } = await import("node:net");
const { execFile, execFileSync } = await import("node:child_process");
const { createHash } = await import("node:crypto");
const { monitorEventLoopDelay } = await import("node:perf_hooks");
const { watch: nativeWatch } = await import("node:fs");
const { copyFile, mkdtemp, readFile, rm, stat, writeFile } = await import("node:fs/promises");
const { tmpdir, loadavg } = await import("node:os");
const { join } = await import("node:path");
const { fileURLToPath } = await import("node:url");
const { promisify } = await import("node:util");
const { build } = await import("../src/index.mjs");
const { createReviewServer } = await import("../src/review-server.mjs");
const { createRegistry, createRevisionRing } = await import("../src/viewer/registry.mjs");
const { createSourceStore } = await import("../src/viewer/sources.mjs");
const { createEventHub, EVENT_NAMES } = await import("../src/viewer/events.mjs");
const { classifyFailure, failurePayload } = await import("../src/viewer/live/failure.mjs");
const { buildTimeText, createTerminal, formatSummary } = await import("../src/viewer/live/terminal.mjs");
const { buildNotices, locationTexts } = await import("../src/viewer/live/build-worker.mjs");
const { bindServer, derivePort, parsePortRange, tabMayReconnect } = await import("../src/viewer/live/port.mjs");
const { readWatchSet, watchSources } = await import("../src/viewer/live/watch.mjs");
const { createBuildPool, importClosure } = await import("../src/viewer/live/pool.mjs");
const { manifestFiles, sourceIdOf } = await import("../src/viewer/live/session.mjs");
// Live build server (package live-server, docs/viewer/live-server.md): revision
// ring and spool, failure payload, terminal lines, ports and tab reuse, SSE,
// watcher, build pool (start backoff, stale results) and the end-to-end live
// loop with a real warm build worker (CLI parity, --out, failures, r0 seed,
// event-loop lag, no leftover processes or watchers).


























const root = fileURLToPath(new URL('../', import.meta.url));
const sha256 = value => createHash('sha256').update(value).digest('hex');
const sleep = ms => new Promise(done => setTimeout(done, ms));
const run = promisify(execFile);

async function directory(t, prefix = 'wonky-live-') {
  const path = await mkdtemp(join(tmpdir(), prefix));
  // Retries: a hook may run while a closing server still writes its last-good cache.
  t.after(() => rm(path, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  return path;
}

const modelBytes = async (name, parameters = {}) => Buffer.from(JSON.stringify(await build(
  await readFile(join(root, 'examples', `${name}.fs`), 'utf8'), { parameters }), null, 2) + '\n');

// Child processes of this test process (macOS/Linux pgrep).
function children() {
  try {
    return execFileSync('pgrep', ['-P', String(process.pid)], { encoding: 'utf8' })
      .trim().split('\n').filter(Boolean).map(Number);
  } catch {
    return [];
  }
}
const alive = pid => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

async function until(check, { timeoutMs = 120000, stepMs = 25, what = 'condition' } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await sleep(stepMs);
  }
}

function recorder(server) {
  const events = [];
  server.events.subscribe(event => events.push({
    at: Date.now(), name: event.name, ...event.data,
  }));
  const find = (name, test = () => true) => events
    .find(event => event.name === name && test(event));
  return {
    events,
    find,
    wait: (name, test, options) => until(() => find(name, test), { what: name, ...options }),
  };
}

function textTerminal() {
  const lines = [];
  const terminal = createTerminal({
    write: text => lines.push(...text.split('\n').filter(Boolean)),
    errorWrite: text => lines.push(...text.split('\n').filter(Boolean)),
    cwd: root,
  });
  return { terminal, lines };
}

test('the revision ring evicts display and models by bytes, keeping pinned ones', async () => {
  const pinned = new Set(['b']);
  const spooled = [];
  const ring = createRevisionRing({
    displayBudgetBytes: 250,
    modelBudgetBytes: 150,
    isPinned: id => pinned.has(id),
    spool: async (id, bytes) => {
      spooled.push(id);
      return `/spool/${id}-${bytes.length}`;
    },
  });
  for (const id of ['a', 'b', 'c', 'd']) {
    ring.add({ id, bytes: Buffer.alloc(60), sceneText: 'x'.repeat(100) });
  }
  await ring.enforce();
  const stats = ring.stats();
  assert.ok(stats.displayBytes <= 250, `display ${stats.displayBytes}`);
  assert.ok(stats.modelBytes <= 150, `models ${stats.modelBytes}`);
  assert.equal(ring.get('b').sceneText.length, 100, 'pinned b keeps its scene');
  assert.ok(ring.get('b').bytes, 'pinned b stays in memory');
  assert.deepEqual(spooled, ['a', 'c'], 'oldest unpinned revisions spool first');
  assert.equal(ring.get('a').spoolPath, '/spool/a-60');
  assert.equal(ring.get('d').sceneText.length, 100, 'the newest revision keeps its display');
  ring.touch('a');
  pinned.add('a');
  await ring.enforce();
  assert.ok(ring.get('a').spooled, 'a spooled revision stays spooled until restored');
});

test('an evicted revision archives, inspects and saves from the spool', async t => {
  const dir = await directory(t);
  const reviewDirectory = join(dir, 'reviews');
  const sources = createSourceStore({ root, sourceDirectory: join(reviewDirectory, 'sources') });
  const registry = createRegistry({
    reviewDirectory, sources, spoolDirectory: join(dir, 'spool'),
    ring: { modelBudgetBytes: 1, displayBudgetBytes: 1 },
  });
  await registry.init();
  const bytes = [await modelBytes('box'), await modelBytes('bracket'),
    await modelBytes('bracket', { thickness: '12 * millimeter' })];
  const ids = bytes.map(sha256);
  registry.setServerPins('part', [ids[1]]);
  for (const [index, item] of bytes.entries()) {
    const { metadata } = await registry.registerLive({
      bytes: item, sceneText: '{}', label: `rev${index}`, sourcePath: join(dir, 'part.fs'),
      live: { sourceId: 'part', path: join(dir, 'part.fs'), revision: index + 1 },
    });
    assert.equal(metadata.id, ids[index]);
  }
  await registry.enforceRing();
  assert.equal(registry.ringStats().spooled, 2, 'both unpinned revisions left memory');
  assert.equal(registry.pinned(ids[1]), true);
  assert.equal(registry.list().find(model => model.id === ids[0]).live.revision, 1);
  const path = await registry.archive(ids[0]);
  assert.equal(path, join(reviewDirectory, 'models', `${ids[0]}.brep.json`));
  assert.equal(sha256(await readFile(path)), ids[0], 'archive has the exact bytes');
  assert.equal(await registry.archive(ids[0]), path, 'archive is idempotent');
  assert.equal(registry.model(ids[2]).bodies.length, 1, 'a spooled model reads back');
  assert.equal(typeof registry.inspector(ids[2]).summary, 'function');
  assert.equal(sha256(await registry.bytes(ids[0])), ids[0]);
  assert.deepEqual(registry.pin('client-a', [ids[0], 'f'.repeat(64)]), [ids[0]]);
  assert.equal(registry.pinned(ids[0]), true);
  registry.unpin('client-a');
  registry.setServerPins('part', []);
  await registry.enforceRing();
  assert.equal(registry.pinned(ids[1]), false);
  assert.ok(registry.ringStats().spooled >= 2);
  await registry.close();
});

test('failure payloads classify kinds and carry location, call chain and call site', () => {
  const text = 'line1\nline2\n  bad(\nline4\n';
  const source = { path: '/w/part.fs', sha256: 'x', language: 'featurescript', text };
  const syntax = failurePayload(Object.assign(new Error("Expected ';'"), {
    name: 'FeatureScriptError', line: 3, column: 3,
  }), { source, jobId: 7, revision: 2 });
  assert.equal(syntax.schema, 'wonky.live-build-failure/1');
  assert.equal(syntax.kind, 'input');
  assert.deepEqual(syntax.error.location, { file: '/w/part.fs', line: 3, column: 3 });
  assert.equal(syntax.error.sourceLine, '  bad(');
  assert.deepEqual(syntax.error.excerpt, { firstLine: 1, text: 'line1\nline2\n  bad(\nline4\n' });
  assert.equal(JSON.parse(JSON.stringify(syntax)).jobId, 7, 'plain, clonable object');
  const trace = {
    operations: [
      { sequence: 0, name: 'fCuboid', status: 'completed' },
      {
        sequence: 1, name: 'opBoolean', operationId: 'model/first/cut', status: 'failed',
        source: { span: { line: 13, column: 5 } },
        callStack: [
          { name: 'part', calledAt: null },
          { name: 'bore', calledAt: { line: 33, column: 5 } },
        ],
        error: { line: 13, column: 5 },
      },
    ],
  };
  const capability = failurePayload(Object.assign(new Error('general trimmed-face booleans'), {
    name: 'UnsupportedFeatureError', line: 13, column: 5, modelTrace: trace,
  }), { source });
  assert.equal(capability.kind, 'capability');
  assert.equal(capability.failedOperation.name, 'opBoolean');
  assert.equal(capability.completedOperations, 1);
  assert.deepEqual(capability.callSite, { file: '/w/part.fs', line: 33, column: 5 });
  assert.deepEqual(capability.callChain.map(link => [link.kind, link.name, link.location?.line]),
    [['at', 'bore', 13], ['called-from', 'part', 33]]);
  // A defineFeature wrapper frame has no call location in the source: skipped.
  trace.operations[1].callStack.unshift({ name: 'part', calledAt: null });
  const wrapped = failurePayload(Object.assign(new Error('x'), {
    name: 'UnsupportedFeatureError', line: 13, column: 5, modelTrace: trace,
  }), { source });
  assert.deepEqual(wrapped.callChain.map(link => [link.kind, link.name, link.location?.line]),
    [['at', 'bore', 13], ['called-from', 'part', 33]]);
  assert.deepEqual(wrapped.callSite, { file: '/w/part.fs', line: 33, column: 5 });
  assert.equal(classifyFailure(new Error(
    'Frozen module manifest does not match the FeatureScript source SHA-256')), 'provenance');
  const provenance = failurePayload(Object.assign(new Error(
    'Frozen module manifest does not match the FeatureScript source SHA-256'),
  { name: 'FeatureScriptError' }), { source, manifestPath: '/w/modules.json' });
  assert.equal(provenance.manifest, '/w/modules.json');
  assert.equal(classifyFailure(Object.assign(new Error('Python execution exceeded 30000 ms'),
    { name: 'PythonExecutionError' })), 'timeout');
  const python = failurePayload(Object.assign(
    new Error("ModuleNotFoundError: No module named 'params'"),
    { name: 'PythonExecutionError', line: 1, traceback: 'Traceback …' }), { source });
  assert.equal(python.kind, 'input');
  assert.equal(python.error.location.line, 1);
  assert.equal(python.error.traceback, 'Traceback …');
  assert.equal(classifyFailure(new TypeError('x is undefined')), 'internal');
  assert.equal(classifyFailure(new Error('Shading failed'), { phase: 'display' }), 'display');
});

// Regression (fix round 3, verify:live#3): an error raised in an imported
// module was located at the importing or calling line of the model, and
// Open in editor went there. The runner records the innermost project frame
// (sourceFile/sourceLine, or useSite for a capability error in a module).
test('Python failures in imported modules are located at the innermost project frame',
  async t => {
    const dir = await directory(t);
    const main = join(dir, 'main.py');
    const dims = join(dir, 'dims.py');
    const helper = join(dir, 'helper.py');
    const dimsText = 'OUTER_RADIUS = 10\nINNER_RADIUS = 3\nHEIGHT = 12\nraise ValueError("bad dims")\n';
    await writeFile(dims, dimsText);
    const runner = join(root, 'python/runner.py');
    const frame = (file, line, name) => `  File "${file}", line ${line}, in ${name}\n    code\n`;
    const source = { path: main, language: 'python', sha256: 'x',
      text: 'from build123d import *\nfrom dims import *\nimport helper\nx = helper.make(3)\n' };
    // Import-time raise in dims.py (the runner's import hook frame is not project code).
    const imported = Object.assign(new Error('ValueError: bad dims'), {
      name: 'PythonExecutionError', line: 2, sourceFile: dims, sourceLine: 4,
      sourceFiles: [{ module: 'dims', path: dims, sha256: sha256(dimsText) }],
      traceback: 'Traceback (most recent call last):\n' + frame(runner, 631, '<module>')
        + frame(main, 2, '<module>') + frame(runner, 475, '_import')
        + frame(dims, 4, '<module>') + 'ValueError: bad dims\n',
    });
    const texts = await locationTexts(imported, main);
    assert.deepEqual(Object.keys(texts), [dims], 'the module text, SHA-256 checked');
    const payload = failurePayload(imported, { source, texts });
    assert.deepEqual(payload.error.location, { file: dims, line: 4, column: null });
    assert.equal(payload.error.sourceLine, 'raise ValueError("bad dims")');
    assert.equal(payload.error.excerpt.firstLine, 2);
    assert.deepEqual(payload.callChain.map(link => [link.kind, link.name, link.location.file,
      link.location.line]), [['at', '<module>', dims, 4], ['called-from', '<module>', main, 2]]);
    assert.deepEqual(payload.callSite, { file: main, line: 2, column: null });
    // An edited module (bytes differ from the recorded SHA-256): no excerpt.
    await writeFile(dims, dimsText + '# edited\n');
    assert.deepEqual(await locationTexts(imported, main), {});
    // A helper function that raises, called from main.py:4.
    const called = failurePayload(Object.assign(new Error('RuntimeError: helper broke'), {
      name: 'PythonExecutionError', line: 4, sourceFile: helper, sourceLine: 4,
      sourceFiles: [{ module: 'helper', path: helper, sha256: 'y' }],
      traceback: 'Traceback (most recent call last):\n' + frame(runner, 631, '<module>')
        + frame(main, 4, '<module>') + frame(helper, 4, 'make') + 'RuntimeError: helper broke\n',
    }), { source });
    assert.deepEqual(called.error.location, { file: helper, line: 4, column: null });
    assert.deepEqual(called.callChain.map(link => [link.kind, link.name, link.location.line]),
      [['at', 'make', 4], ['called-from', '<module>', 4]]);
    assert.equal(called.callSite.file, main);
    // A capability error inside helper.py: the host latched it (no traceback).
    const capability = failurePayload(Object.assign(new Error(
      'build123d.Sphere is not implemented by the Python frontend (at helper.py:4:12)'), {
      name: 'UnsupportedFeatureError', line: 4, column: 5,
      useSite: { file: helper, line: 4, column: 12 },
    }), { source });
    assert.equal(capability.kind, 'capability');
    assert.deepEqual(capability.error.location, { file: helper, line: 4, column: 12 });
    assert.deepEqual(capability.callSite, { file: main, line: 4, column: 5 });
    assert.deepEqual(capability.callChain.map(link => [link.kind, link.location.line]),
      [['at', 4], ['called-from', 4]]);
    // An error in the model itself keeps its line and gets no chain.
    const own = failurePayload(Object.assign(new Error('NameError: x'), {
      name: 'PythonExecutionError', line: 3,
      traceback: 'Traceback (most recent call last):\n' + frame(runner, 631, '<module>')
        + frame(main, 3, '<module>') + 'NameError: x\n',
    }), { source });
    assert.deepEqual(own.error.location, { file: main, line: 3, column: null });
    assert.deepEqual(own.callChain, []);
    const { terminal, lines } = textTerminal();
    terminal.event('build-failed', { sourceId: 's', revision: 20, failure: called,
      lastGood: { revision: 19 } });
    assert.deepEqual(lines.map(line => line.replace(dir, '<dir>')), [
      'r20 FAILED input <dir>/helper.py:4 RuntimeError: helper broke',
      '   at make (<dir>/helper.py:4)',
      '   called from <dir>/main.py:4 in <module>',
      '   showing last good r19',
    ]);
  });

// Regression (fix round 3): show() calls ignored because a module-level
// result exists were not reported; the build time included the queue wait.
test('build notices, build time without the queue wait, worker start errors', () => {
  assert.deepEqual(buildNotices({ source: { result: 'result', ignoredCaptures: 2 } }).map(
    notice => [notice.kind, notice.count, notice.message]), [['ignored-captures', 2,
    "2 show/export calls ignored: the module-level 'result' is the result (Python result"
      + ' contract)']]);
  assert.deepEqual(buildNotices({ source: { result: 'result' } }), []);
  assert.equal(buildTimeText({ queuedMs: 196517, buildMs: 240, totalMs: 196757 }),
    '0.24 s (queued 196.5 s)');
  assert.equal(buildTimeText({ queuedMs: 3, buildMs: 214, totalMs: 217 }), '0.21 s');
  const { terminal, lines } = textTerminal();
  terminal.event('revision', {
    sourceId: 's', revision: 6, sameAs: null,
    timings: { queuedMs: 3321, buildMs: 4040, totalMs: 7361 },
    summary: { bodies: 1, faces: 4, logicalFaces: 4 },
    notices: buildNotices({ source: { result: 'result', ignoredCaptures: 1 } }),
  });
  terminal.event('worker-failed', {
    worker: 'build', failures: 3, windowMs: 60000,
    error: "SyntaxError: The requested module './kernel.mjs' does not provide an export named"
      + " 'extrudeInBend'",
    stderrTail: 'SyntaxError: …\n    at ModuleJob._instantiate (node:internal)\n'
      + '    at async main (build-worker.mjs:332:13)',
  });
  assert.deepEqual(lines, [
    'r6 ok 4.04 s (queued 3.3 s) · 1 body · 4 faces (4 logical)',
    "   note: 1 show/export call ignored: the module-level 'result' is the result (Python"
      + ' result contract)',
    'build worker failed to start 3 times within 60 s; waiting for the next save or rebuild',
    "   SyntaxError: The requested module './kernel.mjs' does not provide an export named"
      + " 'extrudeInBend'",
  ]);
});

test('terminal prints one line per event, failure chains, and NDJSON with SSE names', () => {
  const { terminal, lines } = textTerminal();
  const summary = {
    bodies: 1, faces: 8, logicalFaces: 8,
    bounds: { exactness: 'recorded', sizeMm: [50, 40, 8] },
  };
  terminal.hello({ sources: [{ id: 's', label: 'bracket', path: join(root, 'b.fs'), watched: [
    { path: join(root, 'b.fs'), role: 'source', exists: true },
    { path: join(root, 'modules.json'), role: 'manifest', exists: false },
  ] }] });
  terminal.event('revision', {
    sourceId: 's', revision: 1, timings: { totalMs: 214 }, summary, sameAs: null,
  });
  terminal.event('build-failed', {
    sourceId: 's', revision: 2, lastGood: { revision: 1 },
    failure: {
      kind: 'capability', failedOperation: { name: 'opBoolean' },
      error: {
        message: 'general trimmed-face booleans are not implemented',
        location: { file: join(root, 'b.fs'), line: 24, column: 17 },
      },
      callChain: [
        { kind: 'at', name: 'cut', location: { file: join(root, 'b.fs'), line: 42, column: 5 } },
        { kind: 'called-from', name: 'part',
          location: { file: join(root, 'b.fs'), line: 57, column: 3 } },
      ],
    },
  });
  terminal.event('build-cancelled', { sourceId: 's', revision: 3, supersededBy: { revision: 4 } });
  assert.deepEqual(lines, [
    'watching    b.fs',
    'r1 ok 0.21 s · 1 body · 8 faces (8 logical) · 50×40×8 mm recorded',
    'r2 FAILED capability b.fs:24:17 opBoolean: general trimmed-face booleans are not implemented',
    '   at cut (b.fs:42:5)',
    '   called from b.fs:57:3 in part',
    '   showing last good r1',
    'r3 cancelled (superseded by r4)',
  ]);
  assert.equal(formatSummary({ ...summary, bounds: {
    exactness: 'display', toleranceMm: 0.02, sizeMm: [10, 10, 5.5],
  } }), '1 body · 8 faces (8 logical) · ≈ 10×10×5.5 mm display ±0.02 mm');
  const out = [];
  const err = [];
  const json = createTerminal({ json: true, write: text => out.push(text),
    errorWrite: text => err.push(text) });
  json.hello({ session: 'x', sources: [] });
  json.notice('listening', { url: 'http://127.0.0.1:1/viewer/', derived: true });
  for (const name of EVENT_NAMES.filter(name => name !== 'hello')) {
    json.event(name, { revision: 1 });
  }
  const parsed = out.join('').trim().split('\n').map(line => JSON.parse(line));
  assert.deepEqual(parsed.map(line => line.event), EVENT_NAMES, 'stdout is NDJSON, SSE names');
  assert.equal(err.length, 1, 'terminal-only notices go to stderr');
});

test('ports: derived and stable, strict --port, next free on collision, tab reuse window',
  async t => {
    assert.equal(derivePort('/a/part.fs'), derivePort('/a/part.fs'));
    const derived = derivePort('/a/part.fs', { range: [4320, 4399] });
    assert.ok(derived >= 4320 && derived <= 4399);
    assert.deepEqual(parsePortRange('4320-4399'), [4320, 4399]);
    assert.throws(() => parsePortRange('4399-4320'), /WONKY_VIEW_PORT_RANGE/);
    const blocker = createNetServer();
    await new Promise(done => blocker.listen(0, '127.0.0.1', done));
    t.after(() => new Promise(done => blocker.close(done)));
    const busy = blocker.address().port;
    const strict = createNetServer();
    await assert.rejects(bindServer(strict, { port: busy }),
      error => error.message === `port ${busy} is in use` && error.code === 'EADDRINUSE');
    const next = createNetServer();
    const bound = await bindServer(next, { preferred: busy, range: [busy, busy + 20] });
    t.after(() => new Promise(done => next.close(done)));
    assert.notEqual(bound.port, busy);
    assert.ok(bound.derived);
    const now = Date.parse('2026-09-22T12:00:00Z');
    const marker = at => ({ shutdownAt: new Date(at).toISOString(), clients: 1 });
    assert.equal(tabMayReconnect(marker(now - 60000), now), true);
    assert.equal(tabMayReconnect(marker(now - 11 * 60000), now), false);
    assert.equal(tabMayReconnect({ ...marker(now - 1000), clients: 0 }, now), false);
    assert.equal(sourceIdOf('/x/My Part.fs').startsWith('my-part-'), true);
  });

test('SSE: hello first, live events, Last-Event-ID replay, heartbeat, close ends streams',
  async () => {
    const hub = createEventHub({ session: 'abc', heartbeatMs: 20, hello: () => ({ sources: [] }) });
    const stream = () => {
      const chunks = [];
      const listeners = {};
      return {
        chunks,
        req: { headers: {}, on: (name, fn) => { listeners[name] = fn; } },
        res: {
          writeHead(status, headers) {
            this.status = status;
            this.headers = headers;
          },
          write: chunk => chunks.push(chunk),
          end() {
            this.ended = true;
          },
          on() {},
        },
        close: () => listeners.close?.(),
      };
    };
    const first = stream();
    hub.connect(first.req, first.res, { clientId: 'c1' });
    assert.equal(first.res.status, 200);
    assert.match(first.res.headers['Content-Type'], /text\/event-stream/);
    assert.equal(first.chunks[0], 'retry: 2000\n\n');
    assert.match(first.chunks[1],
      /^id: abc:0\nevent: hello\ndata: \{"session":"abc","clientId":"c1"/);
    hub.publish('build-queued', { revision: 1 });
    hub.publish('revision', { revision: 1 });
    assert.match(first.chunks.at(-1), /^id: abc:2\nevent: revision\n/);
    await sleep(60);
    assert.ok(first.chunks.some(chunk => chunk.startsWith(': heartbeat')));
    assert.equal(hub.clients(), 1);
    const second = stream();
    second.req.headers['last-event-id'] = 'abc:1';
    hub.connect(second.req, second.res, { clientId: 'c2' });
    assert.deepEqual(second.chunks.slice(1).map(chunk => chunk.split('\n')[1]),
      ['event: revision']);
    const stale = stream();
    stale.req.headers['last-event-id'] = 'other:5';
    hub.connect(stale.req, stale.res);
    assert.match(stale.chunks[1], /event: hello/);
    const closed = [];
    hub.onConnection(event => closed.push(event));
    first.close();
    assert.deepEqual(closed, [{ type: 'close', clientId: 'c1' }]);
    hub.close();
    assert.equal(hub.clients(), 0);
    assert.ok(second.res.ended);
  });

test('the watcher hashes the whole set, fires per content change (100 ms apart) and closes',
  async t => {
    const dir = await directory(t);
    const file = join(dir, 'part.fs');
    const manifest = join(dir, 'modules.json');
    await writeFile(file, 'one');
    const initial = await readWatchSet([file, manifest]);
    assert.equal(initial.bytes.get(manifest), null, 'an absent manifest is part of the set');
    const changes = [];
    const watcher = watchSources([file, manifest], {
      debounceMs: 75, initialHash: initial.hash, initialBytes: initial.bytes,
      onChange: (hash, bytes, changed) => changes.push({ hash, text: String(bytes.get(file)),
        changed }),
    });
    t.after(() => watcher.close());
    assert.ok(watcher.handles() >= 2, 'directory and file watchers');
    await writeFile(file, 'one');
    await sleep(250);
    assert.equal(changes.length, 0, 'same bytes, no build');
    await writeFile(file, 'two');
    await until(() => changes.length === 1, { timeoutMs: 5000, what: 'first change' });
    await writeFile(join(dir, 'next.tmp'), 'three');
    await (await import('node:fs/promises')).rename(join(dir, 'next.tmp'), file);
    await until(() => changes.length === 2, { timeoutMs: 5000, what: 'rename save' });
    assert.equal(changes[1].text, 'three');
    await writeFile(manifest, '{}');
    await until(() => changes.length === 3, { timeoutMs: 5000, what: 'manifest' });
    assert.deepEqual(changes[2].changed, [manifest]);
    // Two saves 100 ms apart are two builds: late duplicate events of the
    // first save must not push its scan past the second save.
    await sleep(300);
    await writeFile(file, 'four');
    await sleep(100);
    await writeFile(file, 'five');
    await until(() => changes.length === 5, { timeoutMs: 5000, what: 'two quick saves' });
    assert.deepEqual(changes.slice(3).map(change => change.text), ['four', 'five']);
    watcher.close();
    assert.equal(watcher.handles(), 0);
    assert.deepEqual(manifestFiles(join(dir, 'modules.json'), JSON.stringify({
      schema: 'wonky-onshape-inputs/1',
      modules: [{ namespace: 'ns', bodies: [{ file: 'modules/ns/b.json' }] }],
    })), [join(dir, 'modules/ns/parts.json'), join(dir, 'modules/ns/b.json')]);
  });

test('an absent watched file is discovered without a directory notification and gains a direct watch', async t => {
  const dir = await directory(t);
  const source = join(dir, 'part.fs'), manifest = join(dir, 'modules.json');
  await writeFile(source, 'one');
  const initial = await readWatchSet([source, manifest]);
  const changes = [];
  const watcher = watchSources([source, manifest], {
    debounceMs: 10, pollMs: 25, initialHash: initial.hash, initialBytes: initial.bytes,
    // Drop directory hints; file watches, reads and polling remain real.
    watchImpl(path, options, callback) {
      if (path !== dir) return nativeWatch(path, options, callback);
      const handle = new EventEmitter(); handle.close = () => {};
      return handle;
    },
    onChange: (_hash, _bytes, changed) => changes.push(changed),
  });
  t.after(() => watcher.close());
  await writeFile(manifest, '{}');
  await until(() => changes.length === 1, { timeoutMs: 5000, what: 'manifest through polling' });
  assert.deepEqual(changes, [[manifest]]);
  assert.equal(watcher.handles(), 3, 'directory and two direct watches; polling retired');
  watcher.close();
  assert.equal(watcher.handles(), 0);
});

// Regression (fix round 3): a truncate-then-write save was built as a
// FAILED revision (the empty moment), then fixed by the next build.
test('the watcher notices a newly created missing input even if its directory event is lost', async t => {
  const dir = await directory(t);
  const file = join(dir, 'part.fs');
  const manifest = join(dir, 'modules.json');
  await writeFile(file, 'stable source');
  const initial = await readWatchSet([file, manifest]);
  const changes = [];
  const watcher = watchSources([file, manifest], {
    initialHash: initial.hash, initialBytes: initial.bytes, pollMs: 50,
    // Deliberately lose directory notifications; reads/writes and fallback
    // watchFile polling still use the real filesystem.
    watchImpl: path => {
      if (path === manifest) throw Object.assign(new Error('absent input'), {code:'ENOENT'});
      const handle = new EventEmitter();
      handle.close = () => {};
      return handle;
    },
    onChange: (hash, bytes, changed) => changes.push({hash, bytes, changed}),
  });
  t.after(() => watcher.close());
  await writeFile(manifest, '{}');
  await until(() => changes.length === 1, {timeoutMs:5000, what:'missing input polling'});
  assert.deepEqual(changes[0].changed, [manifest]);
  assert.equal(String(changes[0].bytes.get(manifest)), '{}');
  await writeFile(manifest, '{"revision":2}');
  await until(() => changes.length === 2, {timeoutMs:5000, what:'created input modification'});
  assert.equal(String(changes[1].bytes.get(manifest)), '{"revision":2}');
  watcher.close();
  assert.equal(watcher.handles(), 0);
});

test('closing one watcher preserves another watcher polling the same missing input', async t => {
  const dir = await directory(t);
  const file = join(dir, 'part.fs');
  const manifest = join(dir, 'modules.json');
  await writeFile(file, 'stable source');
  const initial = await readWatchSet([file, manifest]);
  const activeChanges = [], closedChanges = [];
  const makeWatcher = changes => watchSources([file, manifest], {
    initialHash: initial.hash, initialBytes: initial.bytes, pollMs: 50,
    watchImpl: path => {
      if (path === manifest) throw Object.assign(new Error('absent input'), {code:'ENOENT'});
      const handle = new EventEmitter();
      handle.close = () => {};
      return handle;
    },
    onChange: (hash, bytes, changed) => changes.push({hash, bytes, changed}),
  });
  const first = makeWatcher(closedChanges), second = makeWatcher(activeChanges);
  t.after(() => { first.close(); second.close(); });
  first.close();
  await writeFile(manifest, '{}');
  await until(() => activeChanges.length === 1, {timeoutMs:5000, what:'remaining watcher polling'});
  assert.deepEqual(activeChanges[0].changed, [manifest]);
  assert.equal(String(activeChanges[0].bytes.get(manifest)), '{}');
  assert.deepEqual(closedChanges, []);
  second.close();
  assert.equal(first.handles(), 0);
  assert.equal(second.handles(), 0);
});

test('the watcher waits out the empty moment of a truncate-then-write save', async t => {
  const dir = await directory(t);
  const file = join(dir, 'part.fs');
  await writeFile(file, 'one');
  const initial = await readWatchSet([file]);
  const changes = [];
  const watcher = watchSources([file], {
    debounceMs: 75, initialHash: initial.hash, initialBytes: initial.bytes,
    onChange: (_hash, bytes) => changes.push(String(bytes.get(file))),
  });
  t.after(() => watcher.close());
  await writeFile(file, '');
  await sleep(200);
  await writeFile(file, 'two');
  await until(() => changes.length >= 1, { timeoutMs: 5000, what: 'the save' });
  await sleep(300);
  assert.deepEqual(changes, ['two'], 'one change, with the final bytes');
  // A source that stays empty is reported after the retries (about 1 s).
  await writeFile(file, '');
  await until(() => changes.length === 2, { timeoutMs: 5000, what: 'an empty source' });
  assert.equal(changes[1], '');
});

test('the kernel fingerprint covers the worker import closure, not research sandboxes',
  async () => {
    const files = (await importClosure(['src/viewer/live/build-worker.mjs']))
      .map(file => file.slice(root.length));
    for (const expected of ['src/index.mjs', 'src/python.mjs', 'kernel/topology.bend',
      'kernel/ports/curved.bend', 'python/runner.py', 'bend.lock.json']) {
      assert.ok(files.includes(expected), expected);
    }
    assert.ok(!files.some(file => /^(src\/lang|kernel\/(lang|laws|proto))\//.test(file)));
  });

test('an early backoff wake-up retains a retry until the wall-clock deadline', async t => {
  const events = [];
  const realNow = Date.now;
  let frozen = null;
  t.mock.method(Date, 'now', () => frozen ?? realNow());
  const pool = createBuildPool({
    env: { WONKY_VIEW_TEST_WORKER_CRASH: '1' }, spare: false, maxWorkers: 1,
    backoff: { baseMs: 40, maxMs: 80 },
    onEvent: (name, data) => {
      events.push({ name, ...data });
      if (name === 'worker-backoff' && data.attempt === 1) frozen = realNow();
    },
  });
  t.after(() => pool.close());
  pool.submit({ type: 'build' }, {});
  await until(() => frozen !== null, { timeoutMs: 3000, what: 'first backoff' });
  // The real timer expires while the wall clock still precedes its deadline.
  await sleep(100);
  assert.equal(events.filter(event => event.name === 'worker-starting').length, 1);
  frozen = null;
  const failed = await until(() => pool.failed, { timeoutMs: 3000, what: 'rescheduled retry' });
  assert.equal(failed.failures, 3);
  assert.equal(events.filter(event => event.name === 'worker-backoff').length, 2);
  assert.deepEqual(pool.pids(), []);
});

async function checkStartCrashes(t, earlyBackoff = false) {
  const notifications = new EventEmitter();
  const pids = new Set();
  const signal = AbortSignal.timeout(60000);
  const failedEvent = once(notifications, 'worker-failed', { signal });
  let firedEarly = false;
  const retryTimers = new Set();
  const schedule = globalThis.setTimeout;
  const cancel = globalThis.clearTimeout;
  t.mock.method(globalThis, 'setTimeout', (callback, delay, ...args) => {
    // These short timers are the configured backoffs; the IPC exit fallback
    // is 250 ms. Track outstanding retries to check idle CPU without a sleep.
    const retry = delay <= 200;
    let timer;
    const invoke = () => {
      retryTimers.delete(timer);
      callback(...args);
    };
    let actualDelay = delay;
    if (earlyBackoff && delay === 40 && !firedEarly) {
      firedEarly = true;
      // Real children still crash over IPC; only the first backoff timer
      // is made to fire before its deadline, deterministically.
      actualDelay = 0;
    }
    timer = schedule(invoke, actualDelay);
    if (retry) retryTimers.add(timer);
    return timer;
  });
  t.mock.method(globalThis, 'clearTimeout', timer => {
    retryTimers.delete(timer);
    cancel(timer);
  });
  const events = [];
  const pool = createBuildPool({
    env: { WONKY_VIEW_TEST_WORKER_CRASH: '1' },
    backoff: { baseMs: 40, maxMs: 200 },
    onEvent: (name, data) => {
      events.push({ name, ...data });
      if (name === 'worker-starting') pids.add(data.pid);
      if (name === 'worker-exit') pids.delete(data.pid);
      notifications.emit(name, data);
    },
  });
  t.after(() => pool.close());
  pool.setWanted(true);
  pool.submit({ type: 'build' }, {});
  const [failed] = await failedEvent;
  assert.equal(failed.failures, 3);
  assert.match(failed.stderrTail, /injected start crash/);
  // The error itself, not the last stack frame (fix round 3).
  assert.equal(failed.error, 'Error: injected start crash (WONKY_VIEW_TEST_WORKER_CRASH=1)');
  assert.ok(events.filter(event => event.name === 'worker-backoff')
    .every(event => event.error === failed.error));
  // The spare and the job forked two workers at once; both failing is one attempt.
  assert.ok(events.filter(event => event.name === 'worker-starting').length > 3);
  assert.equal(events.filter(event => event.name === 'worker-backoff').length, 2);
  assert.deepEqual(events.filter(event => event.name === 'worker-backoff')
    .map(event => event.retryInMs), [40, 80]);
  const starts = events.filter(event => event.name === 'worker-starting').length;
  // Wait for every actual child exit, then exercise the failed latch. No
  // polling or arbitrary delay: exit handling must not start a replacement.
  while (pids.size) await once(notifications, 'worker-exit', { signal });
  pool.setWanted(false);
  pool.setWanted(true);
  pool.submit({ type: 'build' }, {});
  assert.equal(events.filter(event => event.name === 'worker-starting').length, starts,
    'no further starts after worker-failed (idle CPU)');
  assert.deepEqual(pool.pids(), []);
  assert.equal(retryTimers.size, 0, 'no pending retry after worker-failed (idle CPU)');
  if (earlyBackoff) assert.ok(firedEarly, 'the first retry timer fired early');
}

test('worker start crashes back off and end in worker-failed with the stderr tail',
  t => checkStartCrashes(t));

test('an early backoff timer still retries until worker-failed',
  t => checkStartCrashes(t, true));

test('a .brep.json-only session starts no build worker and no query worker', async t => {
  const dir = await directory(t);
  const path = join(dir, 'box.brep.json');
  await writeFile(path, await modelBytes('box'));
  const server = await createReviewServer({
    modelPaths: [path], port: 0, reviewDirectory: join(dir, 'reviews'),
    stateDirectory: join(dir, 'state'),
  });
  t.after(() => server.close());
  const base = server.origin;
  const workspace = await (await fetch(base + '/api/workspace')).json();
  await (await fetch(base + '/api/models/' + workspace.models[0].id)).json();
  const live = await (await fetch(base + '/api/live')).json();
  assert.deepEqual(live.sources, []);
  assert.equal(live.workers, null);
  assert.equal(server.buildPool, null);
  assert.deepEqual(server.pool.pids(), []);
  assert.deepEqual(children(), [], 'no child process of this test');
  const response = await fetch(base + '/api/events');
  const reader = response.body.getReader();
  const first = new TextDecoder().decode((await reader.read()).value);
  assert.match(first, /retry: 2000/);
  const hello = first.includes('event: hello') ? first
    : new TextDecoder().decode((await reader.read()).value);
  assert.match(hello, /event: hello\ndata: \{"session"/);
  await reader.cancel();
});

const SPIN = [
  'FeatureScript 3044;',
  'import(path : "onshape/std/geometry.fs", version : "3044.0");',
  'export function spin(context is Context, id is Id, definition is map)',
  '{',
  '    var total = 0;',
  '    for (var i = 0; i < definition.turns; i += 1) { total += 1; }',
  '    fCuboid(context, id + "block", { "corner1" : vector(0, 0, 0) * millimeter,',
  '        "corner2" : vector(10, 10, 10) * millimeter });',
  '}',
  '',
].join('\n');

test('a stale job result is dropped; only the latest job of a pool reports', async t => {
  const events = [];
  const pool = createBuildPool({ spare: false, maxWorkers: 1, onEvent: (name, data) => events
    .push({ name, ...data }) });
  t.after(() => pool.close());
  const job = (revision, turns) => ({
    type: 'build', revision, language: 'featurescript', sourcePath: '/virtual/spin.fs',
    bytes: Buffer.from(SPIN), options: { parameters: { turns: String(turns) },
      maxSteps: 400000000 }, label: 'spin',
  });
  const done = [];
  let running = false;
  const first = pool.submit(job(1, 600000), {
    onStart: () => {
      running = true;
    },
    onDone: result => done.push(['first', result.jobId]),
  });
  await until(() => running, { what: 'first job running' });
  pool.cancel(first.jobId, { graceMs: 60000 });
  const second = pool.submit(job(2, 10), {
    onDone: result => done.push(['second', result.jobId]),
  });
  await until(() => done.length === 1, { what: 'second result' });
  await until(() => events.find(event => event.name === 'result-dropped'),
    { what: 'dropped first result' });
  assert.deepEqual(done, [['second', second.jobId]]);
  assert.equal(events.find(event => event.name === 'result-dropped').jobId, first.jobId);
});

test('live loop: CLI parity, --out, failures keep the last good revision, r0, no leftovers',
  async t => {
    const dir = await directory(t);
    const source = join(dir, 'bracket.fs');
    const original = await readFile(join(root, 'examples', 'bracket.fs'), 'utf8');
    await writeFile(source, original);
    const prefix = join(dir, 'out', 'bracket');
    const options = {
      sources: [{ path: source }], port: 0, reviewDirectory: join(dir, 'reviews'),
      stateDirectory: join(dir, 'state'),
      build: { parameters: { thickness: '12 * millimeter' } },
      out: { prefix, format: 'all', deviationMm: 0.02 },
      live: { debounceMs: 30, pool: { spare: false } },
    };
    const { terminal, lines } = textTerminal();
    let server = await createReviewServer({ ...options, terminal });
    t.after(() => server.close());
    let events = recorder(server);
    const r1 = await events.wait('revision', event => event.revision === 1);
    const cli = join(dir, 'cli', 'bracket');
    await run(process.execPath, [join(root, 'bin/wonky.mjs'), source, '--param',
      'thickness=12 * millimeter', '--out', cli], { cwd: root });
    const cliBytes = await readFile(cli + '.brep.json');
    assert.equal(r1.modelId, sha256(cliBytes), 'live model id equals the CLI output id');
    await until(async () => (await stat(prefix + '.html').catch(() => null)), { what: '--out' });
    for (const extension of ['brep.json', 'step', 'stl', 'html']) {
      assert.deepEqual(await readFile(`${prefix}.${extension}`),
        await readFile(`${cli}.${extension}`), `--out .${extension} equals the CLI`);
    }
    assert.match(lines.find(line => line.startsWith('r1 ok ')),
      /^r1 ok \d+(\.\d+)? s( \(queued \d+(\.\d+)? s\))? · 1 body · 8 faces \(8 logical\) · 50×40×12 mm recorded$/);
    const outMtime = (await stat(prefix + '.brep.json')).mtimeMs;
    await writeFile(source, original.replace('skSolve(sketch);', 'skSolve(sketch)'));
    const failed = await events.wait('build-failed', event => event.revision === 2);
    assert.equal(failed.failure.kind, 'input');
    assert.deepEqual(failed.failure.error.location, { file: source, line: 31, column: 9 });
    assert.equal(failed.lastGood.revision, 1);
    assert.ok(lines.includes('   showing last good r1'));
    assert.match(lines.find(line => line.startsWith('r2 FAILED')),
      /^r2 FAILED input .*bracket\.fs:31:9 Expected ';', found 'opExtrude'$/);
    assert.equal((await stat(prefix + '.brep.json')).mtimeMs, outMtime, '--out untouched');
    const workspace = await (await fetch(server.origin + '/api/workspace')).json();
    assert.equal(workspace.models.filter(model => model.live).length, 1, 'nothing partial');
    const frozen = await (await fetch(`${server.origin}/api/source/${sha256(original)}`)).json();
    assert.equal(frozen.text, original, 'exact bytes of a source outside the repo');
    const pids = server.buildPool.pids();
    assert.ok(pids.length >= 1);
    const session = server.sessions[0];
    assert.ok(session.watcherHandles() > 0);
    // Fingerprint import-closure discovery starts asynchronously. A fast
    // first model under load can precede watcher installation.
    await until(() => server.buildPool.watcherHandles() > 0, { what: 'kernel fingerprint watchers' });
    assert.ok(server.buildPool.watcherHandles() > 0, 'the kernel fingerprint is watched');
    await server.close();
    assert.equal(session.watcherHandles(), 0, 'no source watcher after close()');
    assert.equal(server.buildPool.watcherHandles(), 0, 'no kernel watcher after close()');
    await until(() => pids.every(pid => !alive(pid)), { timeoutMs: 5000, what: 'workers exit' });
    assert.deepEqual(children(), [], 'no child processes after close()');

    await writeFile(source, original);
    server = await createReviewServer({ ...options, terminal });
    events = recorder(server);
    const r0 = await events.wait('revision', event => event.revision === 0);
    assert.equal(r0.previousSession, true);
    assert.equal(r0.modelId, r1.modelId, 'r0 is the previous --out model');
    assert.ok(lines.some(line => line.startsWith('r0 previous session · 1 body')));
    const again = await events.wait('revision', event => event.revision === 1);
    assert.equal(again.sameAs, 0);
    await server.close();
  });

// The spin source with its loop count in the text, so a save changes the
// build time (the calibration below scales it to the machine's load).
const spinSource = turns => SPIN.replace('definition.turns', String(turns));

test('builds run in a separate process while the server event loop makes progress', async t => {
  const dir = await directory(t);
  const source = join(dir, 'spin.fs');
  let turns = 1000000;
  await writeFile(source, spinSource(turns));
  const server = await createReviewServer({
    sources: [{ path: source }], port: 0, reviewDirectory: join(dir, 'reviews'),
    stateDirectory: join(dir, 'state'), build: { maxSteps: 4000000000 },
    live: { pool: { spare: false }, debounceMs: 30 },
  });
  t.after(() => server.close());
  const events = recorder(server);
  let revision = await events.wait('revision', event => event.revision === 1,
    { timeoutMs: 180000 });
  // Baseline: the same measurement over an idle stretch of the same length.
  const idle = monitorEventLoopDelay({ resolution: 10 });
  idle.enable();
  await sleep(4000);
  idle.disable();
  let measured;
  for (let attempt = 2; attempt <= 4; attempt++) {
    // Scale the loop to about 4.6 s of evaluation at the current load.
    turns = Math.max(1000000, Math.ceil(turns * 4600 / Math.max(revision.timings.evaluateMs, 50)));
    await writeFile(source, spinSource(turns));
    await events.wait('build-started', event => event.revision === attempt);
    const histogram = monitorEventLoopDelay({ resolution: 10 });
    histogram.enable();
    const started = Date.now();
    const startEvent = events.find('build-started', event => event.revision === attempt);
    assert.ok(Number.isInteger(startEvent.pid) && startEvent.pid !== process.pid,
      'the real FeatureScript build runs in a child process');
    let evaluationHeartbeats = 0;
    const heartbeat = setInterval(() => {
      if(server.sessions[0].job?.phase === 'evaluating') evaluationHeartbeats++;
    }, 10);
    t.after(() => clearInterval(heartbeat));
    revision = await events.wait('revision', event => event.revision === attempt,
      { timeoutMs: 180000 });
    clearInterval(heartbeat);
    histogram.disable();
    assert.ok(evaluationHeartbeats > 0, 'the parent event loop progresses during actual worker evaluation');
    measured = {
      buildMs: Date.now() - started, evaluateMs: revision.timings.evaluateMs, turns,
      p99: histogram.percentile(99) / 1e6, max: histogram.max / 1e6,
    };
    if (measured.buildMs >= 4000) break;
  }
  const { buildMs, evaluateMs, p99, max } = measured;
  t.diagnostic(`build ${buildMs} ms (evaluate ${evaluateMs} ms, ${turns} turns), event-loop `
    + `delay p99 ${p99.toFixed(1)} ms, max ${max.toFixed(1)} ms (idle 4 s before: p99 `
    + `${(idle.percentile(99) / 1e6).toFixed(1)} ms, max ${(idle.max / 1e6).toFixed(1)} ms), `
    + `load ${loadavg()[0].toFixed(1)}`);
  assert.ok(turns >= 1000000, 'the worker executes at least one million FeatureScript loop turns');
  // Lag is diagnostic: scheduling delays from unrelated load cannot fail
  // the gate. Child PID and concurrent evaluation heartbeats prove isolation.
});

test('the opener runs for a fresh start and not when a tab reconnects after a restart',
  async t => {
    const dir = await directory(t);
    const source = join(dir, 'box.fs');
    await copyFile(join(root, 'examples', 'box.fs'), source);
    const log = join(dir, 'opener.log');
    const opener = join(dir, 'opener.sh');
    await writeFile(opener, `#!/bin/sh\necho "$1" >> '${log}'\n`, { mode: 0o755 });
    const blocker = createNetServer();
    await new Promise(done => blocker.listen(0, '127.0.0.1', done));
    const free = blocker.address().port;
    const low = free > 65000 ? free - 31 : free + 1;
    await new Promise(done => blocker.close(done));
    const options = {
      sources: [{ path: source }], reviewDirectory: join(dir, 'reviews'),
      stateDirectory: join(dir, 'state'), derivePortFrom: source, portRange: [low, low + 30],
      open: true, opener, live: { pool: { spare: false } },
    };
    const openedLines = async () => (await readFile(log, 'utf8').catch(() => '')).split('\n')
      .filter(Boolean).length;
    let server = await createReviewServer(options);
    assert.deepEqual(await server.opened, { opened: true, command: opener });
    await until(async () => (await openedLines()) === 1, { timeoutMs: 5000, what: 'opener' });
    const port = server.port;
    const connect = base => fetch(base + '/api/events?client=tab1').then(response => {
      const reader = response.body.getReader();
      reader.read().catch(() => {});
      return reader;
    });
    const tab = await connect(server.origin);
    await until(() => server.events.clients() === 1, { what: 'tab connected' });
    await server.close();
    await tab.cancel().catch(() => {});
    server = await createReviewServer(options);
    t.after(() => server.close());
    assert.equal(server.port, port, 'a restart picks the same derived port');
    const again = await connect(server.origin);
    assert.deepEqual(await server.opened, { opened: false, reason: 'reconnected' });
    assert.equal(await openedLines(), 1, 'no second tab');
    await again.cancel().catch(() => {});
  });

}
