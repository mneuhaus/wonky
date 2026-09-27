import test from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missingBend();
if (publicTreeSkip) {
  test("viewer-server.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { createServer: createNetServer } = await import("node:net");
const { request } = await import("node:http");
const { createHash } = await import("node:crypto");
const { mkdtemp, readFile, rm, stat, writeFile } = await import("node:fs/promises");
const { existsSync } = await import("node:fs");
const { tmpdir } = await import("node:os");
const { join } = await import("node:path");
const { build } = await import("../src/index.mjs");
const { createReviewServer, validateReview } = await import("../src/review-server.mjs");
const { createRouter, errorStatus } = await import("../src/viewer/router.mjs");
const { CapabilityError, HttpError } = await import("../src/viewer/http.mjs");
const { MIME_TYPES, resolveViewerPath } = await import("../src/viewer/static.mjs");
const { ROUTE_MODULES } = await import("../src/viewer/routes/index.mjs");
const { createQueryPool } = await import("../src/viewer/query-pool.mjs");
const { QUERY_HANDLERS } = await import("../src/viewer/query-worker.mjs");
const { mergeSettings, emptySettings } = await import("../src/viewer/settings.mjs");
const { createEventHub } = await import("../src/viewer/events.mjs");
const { logicalFaces } = await import("../src/viewer/logical-faces.mjs");
const { classifyEdges, EDGE_CLASS } = await import("../src/viewer/edge-classes.mjs");
const { buildDrawPayload } = await import("../src/viewer/draw.mjs");
// Viewer server foundation: router, static serving, Host allowlist, error
// mapping, bind-before-register, settings, archive, dynamic route loading and
// the frozen server-side stubs.























const sha256 = value => createHash('sha256').update(value).digest('hex');
const example = async name => JSON.stringify(await build(
  await readFile(new URL(`../examples/${name}.fs`, import.meta.url), 'utf8')));
const boxBytes = await example('box');

async function workspace(t) {
  const dir = await mkdtemp(join(tmpdir(), 'wonky-viewer-server-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'part.brep.json');
  await writeFile(path, boxBytes);
  return { dir, path, reviews: join(dir, 'reviews') };
}

async function start(t, options) {
  const server = await createReviewServer({ port: 0, ...options });
  t.after(() => server.close());
  return { server, base: server.url.replace('/viewer/', '') };
}

// node:http keeps the path and the Host header exactly as given.
function raw(base, path, { headers = {}, method = 'GET' } = {}) {
  const target = new URL(base);
  return new Promise((resolve, reject) => {
    const options = { host: target.hostname, port: target.port, path, method, headers };
    const req = request(options, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({
        status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString('utf8'),
      }));
    });
    req.on('error', reject);
    req.end();
  });
}

function fakeResponse() {
  return {
    status: null, headers: null, body: '', headersSent: false,
    writeHead(status, headers) {
      this.status = status;
      this.headers = headers;
      this.headersSent = true;
    },
    end(body = '') {
      this.body = String(body);
    },
  };
}

test('router matches in order, maps errors by route kind and reports unknown paths', async () => {
  const router = createRouter();
  const calls = [];
  router.add('GET', '/exact', () => calls.push('exact'));
  router.add('GET', /^\/items\/([0-9]+)$/, (_req, _res, { match }) => {
    calls.push('item ' + match[1]);
  });
  router.add('GET', /^\/items\/.*$/, () => calls.push('fallback'));
  router.add('GET', '/legacy-fail', () => {
    throw new Error('plain legacy failure');
  }, { legacy: true });
  router.add('GET', '/new-fail', () => {
    throw new Error('plain new failure');
  });
  router.add('GET', '/typed', () => {
    throw new HttpError(422, 'typed failure');
  });
  router.add('GET', '/missing', () => {
    throw Object.assign(new Error('gone'), { code: 'ENOENT' });
  }, { legacy: true });
  const run = async path => {
    const res = fakeResponse();
    const handled = await router.handle({ method: 'GET' }, res, new URL(path, 'http://x'));
    return { handled, res };
  };
  assert.equal((await run('/exact')).handled, true);
  await run('/items/42');
  await run('/items/abc');
  assert.deepEqual(calls, ['exact', 'item 42', 'fallback']);
  assert.equal((await run('/legacy-fail')).res.status, 400);
  assert.equal((await run('/new-fail')).res.status, 500);
  assert.equal((await run('/typed')).res.status, 422);
  assert.equal(JSON.parse((await run('/typed')).res.body).error, 'typed failure');
  assert.equal((await run('/missing')).res.status, 404);
  assert.equal((await run('/nothing')).handled, false);
  const post = fakeResponse();
  assert.equal(await router.handle({ method: 'POST' }, post, new URL('/exact', 'http://x')), false);
  assert.equal(errorStatus(new CapabilityError('later'), true), 501);
  assert.throws(() => router.add('GET', 5, () => {}), TypeError);
});

test('static paths are normalized and confined to viewer/ with a MIME allowlist', () => {
  const root = '/srv/viewer';
  assert.equal(resolveViewerPath(root, '/viewer/'), '/srv/viewer/index.html');
  assert.equal(resolveViewerPath(root, '/viewer/core/store.js'), '/srv/viewer/core/store.js');
  assert.equal(resolveViewerPath(root, '/viewer/styles/base%2Ecss'), '/srv/viewer/styles/base.css');
  for (const bad of ['/viewer/../src/x.js', '/viewer/..%2fsrc%2fx.js', '/viewer/a/../../x.js',
    '/viewer/.hidden.js', '/viewer/a//b.js', '/viewer/a%5Cb.js', '/viewer/a%00.js',
    '/viewer/x.mjs.map', '/viewer/core', '/viewer/%E0%A4%A.js', '/other/index.html']) {
    assert.throws(() => resolveViewerPath(root, bad), error => error.status === 404, bad);
  }
  assert.equal(MIME_TYPES['.js'], 'text/javascript; charset=utf-8');
  assert.equal(MIME_TYPES['.css'], 'text/css; charset=utf-8');
});

test('the server serves viewer files with MIME types; unknown and traversal paths are 404',
  async t => {
    const { path, reviews } = await workspace(t);
    const { base } = await start(t, { modelPaths: [path], reviewDirectory: reviews });
    const index = await fetch(base + '/viewer/');
    assert.equal(index.status, 200);
    assert.equal(index.headers.get('content-type'), 'text/html; charset=utf-8');
    assert.equal(index.headers.get('cache-control'), 'no-store');
    assert.equal(index.headers.get('x-content-type-options'), 'nosniff');
    const html = await index.text();
    const app = await fetch(base + '/viewer/app.js');
    assert.equal(app.headers.get('content-type'), 'text/javascript; charset=utf-8');
    const stylesheet = html.match(/<link rel="stylesheet" href="\.\/([^"]+)"/)[1];
    const css = await fetch(base + '/viewer/' + stylesheet);
    assert.equal(css.status, 200);
    assert.equal(css.headers.get('content-type'), 'text/css; charset=utf-8');
    assert.equal((await fetch(base + '/')).url, base + '/viewer/', 'root redirects to the viewer');
    for (const path of ['/viewer/nope.js', '/viewer/..%2fsrc%2freview-server.mjs',
      '/viewer/.env.js', '/viewer/features', '/viewer/index.txt']) {
      const response = await raw(base, path);
      assert.equal(response.status, 404, path);
      assert.equal(JSON.parse(response.text).error, 'Unknown viewer asset', path);
    }
    const normalized = await raw(base, '/viewer/../src/review-server.mjs');
    assert.equal(normalized.status, 404);
    assert.equal(JSON.parse(normalized.text).error, 'Unknown route');
    assert.equal((await fetch(base + '/viewer/index.html', { method: 'POST' })).status, 404);
  });

test('the Host allowlist admits only 127.0.0.1 and localhost on the bound port', async t => {
  const { path, reviews } = await workspace(t);
  const { base } = await start(t, { modelPaths: [path], reviewDirectory: reviews });
  const port = new URL(base).port;
  for (const host of [`attacker.example:${port}`, '127.0.0.1', `127.0.0.1:${Number(port) + 1}`,
    `localhost.attacker.example:${port}`]) {
    const response = await raw(base, '/api/workspace', { headers: { Host: host } });
    assert.equal(response.status, 403, host);
    assert.match(JSON.parse(response.text).error, /Host header rejected/);
  }
  for (const host of [`127.0.0.1:${port}`, `localhost:${port}`]) {
    const response = await raw(base, '/api/workspace', { headers: { Host: host } });
    assert.equal(response.status, 200, host);
  }
});

test('legacy routes keep 400 mapping; new routes use HttpError statuses', async t => {
  const { path, reviews } = await workspace(t);
  const { base } = await start(t, { modelPaths: [path], reviewDirectory: reviews });
  const unknownScene = await fetch(base + '/api/models/' + 'f'.repeat(64));
  assert.equal(unknownScene.status, 400);
  assert.match((await unknownScene.json()).error, /Unknown model revision/);
  assert.equal((await fetch(base + '/api/models/' + 'f'.repeat(64) + '/summary')).status, 404);
  const badReview = await fetch(base + '/api/feedback', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"title":',
  });
  assert.equal(badReview.status, 400);
  assert.equal((await fetch(base + '/api/feedback', {
    method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: 'x',
  })).status, 415);
  assert.equal((await fetch(base + '/api/models/' + 'f'.repeat(64) + '/archive',
    { method: 'POST' })).status, 404);
  assert.equal((await fetch(base + '/api/nope')).status, 404);
});

test('the port is bound before any input is registered or snapshot written', async t => {
  const { path, reviews } = await workspace(t);
  const blocker = createNetServer();
  await new Promise(resolve => blocker.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => blocker.close(resolve)));
  await assert.rejects(
    createReviewServer({
      modelPaths: [path], reviewDirectory: reviews, port: blocker.address().port,
    }),
    error => error.code === 'EADDRINUSE');
  assert.equal(existsSync(reviews), false, 'no review directory, model or source snapshot written');
});

test('settings round-trip through GET/PUT, persist across restarts and reject bad patches',
  async t => {
    const { path, reviews } = await workspace(t);
    let { server, base } = await start(t, { modelPaths: [path], reviewDirectory: reviews });
    const put = (body, type = 'application/json') => fetch(base + '/api/settings', {
      method: 'PUT', headers: { 'Content-Type': type },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });
    assert.deepEqual(await (await fetch(base + '/api/settings')).json(), emptySettings());
    const patch = {
      global: { editor: 'vscode', edgeWidth: 1.5 },
      sources: { '/work/part.fs': { compare: false } },
      bodies: { '/work/part.fs': { plate: { visible: false, color: '#aa3300' } } },
    };
    const saved = await (await put(patch)).json();
    assert.deepEqual(saved, { schema: 'wonky.viewer-settings/1', ...patch });
    assert.deepEqual(await (await fetch(base + '/api/settings')).json(), saved);
    const removed = await (await put({ global: { editor: null },
      bodies: { '/work/part.fs': { plate: { color: null } } } })).json();
    assert.equal(removed.global.editor, undefined);
    assert.equal(removed.global.edgeWidth, 1.5);
    assert.deepEqual(removed.bodies['/work/part.fs'].plate, { visible: false });
    const file = JSON.parse(await readFile(join(reviews, 'viewer-settings.json'), 'utf8'));
    assert.deepEqual(file, removed);
    await server.close();
    ({ server, base } = await start(t, { modelPaths: [path], reviewDirectory: reviews }));
    assert.deepEqual(await (await fetch(base + '/api/settings')).json(), removed);
    assert.equal((await put('[1]')).status, 400);
    assert.equal((await put({ scopes: {} })).status, 400);
    assert.equal((await put({ global: { __proto__: null, constructor: 1 } })).status, 400);
    assert.equal((await put('{"global":')).status, 400);
    assert.equal((await put({ global: {} }, 'text/plain')).status, 415);
    assert.equal((await put({ global: { big: 'x'.repeat(300 * 1024) } })).status, 413);
    assert.equal((await fetch(base + '/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Origin: 'https://evil.invalid' },
      body: '{}',
    })).status, 403);
    assert.throws(() => mergeSettings(emptySettings(), { sources: { a: 5 } }), /must be an object/);
  });

test('archive answers the exact immutable snapshot, idempotently', async t => {
  const { path, reviews } = await workspace(t);
  const { base } = await start(t, { modelPaths: [path], reviewDirectory: reviews });
  const id = sha256(boxBytes);
  const archive = () => fetch(base + `/api/models/${id}/archive`, { method: 'POST' });
  const first = await (await archive()).json();
  assert.deepEqual(first, { path: join(reviews, 'models', id + '.brep.json'), modelId: id });
  assert.equal(sha256(await readFile(first.path)), id);
  const mtime = (await stat(first.path)).mtimeMs;
  assert.deepEqual(await (await archive()).json(), first);
  assert.equal((await stat(first.path)).mtimeMs, mtime, 'archive never rewrites the snapshot');
});

test('scenes are served compact with identical content; archived snapshots display lazily',
  async t => {
    const { dir, path, reviews } = await workspace(t);
    let { server, base } = await start(t, { modelPaths: [path], reviewDirectory: reviews });
    const id = sha256(boxBytes);
    const text = await (await fetch(base + '/api/models/' + id)).text();
    assert.ok(!text.includes('\n'), 'compact JSON');
    const scene = JSON.parse(text);
    assert.equal(scene.sha256, id);
    assert.ok(scene.bodies[0].faces.every(face => face.triangles.length));
    await server.close();
    const other = join(dir, 'other.brep.json');
    await writeFile(other, await example('bracket'));
    ({ server, base } = await start(t, { modelPaths: [other], reviewDirectory: reviews }));
    const listed = (await (await fetch(base + '/api/workspace')).json()).models;
    const archived = listed.find(model => model.id === id);
    assert.equal(archived.label, `Saved revision ${id.slice(0, 8)}`);
    assert.equal(archived.bounds, undefined, 'display not prepared before the first request');
    const lazy = await (await fetch(base + '/api/models/' + id)).json();
    assert.equal(lazy.label, `Saved revision ${id.slice(0, 8)}`);
    assert.deepEqual({ ...lazy, label: scene.label, sourcePath: scene.sourcePath }, scene);
    const again = (await (await fetch(base + '/api/workspace')).json()).models;
    assert.deepEqual(again.find(model => model.id === id).bounds, scene.bounds);
  });

test('route modules load in isolation; a broken module answers 500 and the server starts',
  async t => {
    const { path, reviews } = await workspace(t);
    const logs = [];
    const hello = 'data:text/javascript,' + encodeURIComponent(
      'export function register(router) { router.add("GET", "/api/hello", (req, res) => {'
      + ' res.writeHead(200, {"Content-Type": "text/plain"}); res.end("hello"); }); }');
    const syntax = 'data:text/javascript,' + encodeURIComponent('export function register( {');
    const throwing = 'data:text/javascript,' + encodeURIComponent(
      'export function register(router) { router.add("GET", "/api/half", () => {});'
      + ' throw new Error("register exploded"); }');
    const { base } = await start(t, {
      modelPaths: [path], reviewDirectory: reviews, log: message => logs.push(message),
      routeModules: [
        ...ROUTE_MODULES,
        { name: 'hello', url: hello, planned: [['GET', '/api/hello']] },
        {
          name: 'broken', url: syntax,
          planned: [['GET', '/api/broken'], ['POST', /^\/api\/broken\//]],
        },
        { name: 'throwing', url: throwing, planned: [['GET', '/api/half']] },
      ],
    });
    assert.equal(await (await fetch(base + '/api/hello')).text(), 'hello');
    for (const [method, route, name] of [['GET', '/api/broken', 'broken'],
      ['POST', '/api/broken/x', 'broken'], ['GET', '/api/half', 'throwing']]) {
      const response = await fetch(base + route, { method });
      assert.equal(response.status, 500, route);
      assert.equal((await response.json()).error, `route module ${name} failed to load`);
    }
    const workspaceResponse = await fetch(base + '/api/workspace');
    assert.equal(workspaceResponse.status, 200, 'the rest of the server works');
    assert.deepEqual(logs.map(line => line.match(/route module (\w+)/)[1]), ['broken', 'throwing']);
    assert.deepEqual(ROUTE_MODULES.map(entry => entry.name), ['core', 'settings', 'reviews', 'live',
      'draw', 'topology', 'geometry', 'measure', 'compare', 'resolve', 'history', 'selection',
      'export', 'parts', 'printability', 'section', 'diff', 'thickness']);
  });

test('the query pool runs frozen handlers with latest-wins, timeouts and capability errors',
  async () => {
    assert.deepEqual(Object.keys(QUERY_HANDLERS), ['draw', 'printability', 'section', 'thickness',
      'diffBounds']);
    const registry = { model: id => (id === 'known' ? { bodies: [] } : undefined) };
    const gates = [];
    const pool = createQueryPool({
      registry,
      handlers: {
        ...QUERY_HANDLERS,
        slow: (_model, payload) => new Promise(resolve => gates.push(() => resolve(payload))),
      },
    });
    const first = pool.query('slow', 'known', 1, { supersedeKey: 'k' });
    const second = pool.query('slow', 'known', 2, { supersedeKey: 'k' });
    await assert.rejects(first, error => error.status === 409);
    await new Promise(resolve => setImmediate(resolve));
    gates.forEach(open => open());
    assert.equal(await second, 2);
    await assert.rejects(pool.query('slow', 'known', 3, { timeoutMs: 5 }),
      error => error.status === 504);
    await assert.rejects(pool.query('nope', 'known', {}), error => error.status === 400);
    await assert.rejects(pool.query('draw', 'unknown', {}), error => error.status === 404);
    // fdm implements printability: a model without bodies has nothing to check.
    assert.deepEqual((await pool.query('printability', 'known', {})).bodies, []);
    for (const kind of Object.keys(QUERY_HANDLERS).filter(kind => kind !== 'printability')) {
      await assert.rejects(pool.query(kind, 'known', {}), error => error.status === 501, kind);
    }
    const controller = new AbortController();
    const aborted = pool.query('slow', 'known', 4, { signal: controller.signal });
    controller.abort(new HttpError(499, 'client gone'));
    await assert.rejects(aborted, error => error.status === 499);
    pool.close();
  });

test('frozen signatures: logical faces, edge classes, draw payload and events', async () => {
  const model = JSON.parse(boxBytes);
  const logical = logicalFaces(model);
  assert.equal(logical.bodies.length, model.bodies.length);
  assert.deepEqual([...logical.bodies[0].logicalOf], model.bodies[0].faces.map((_f, i) => i));
  // topology-classes implemented both: a box has one logical face per face
  // on an exact plane and 12 sharp edges.
  assert.equal(logical.bodies[0].groups[0].alias, 'B1.L1');
  assert.deepEqual(logical.bodies[0].groups[0].fragments, [0]);
  assert.equal(logical.bodies[0].groups[0].support.type, 'plane');
  const classes = classifyEdges(model, null);
  assert.ok(classes.bodies[0].classes.every(code => code === EDGE_CLASS.sharp));
  assert.equal(classes.bodies[0].classes.length, model.bodies[0].edges.length);
  assert.equal(buildDrawPayload(model, null, {}), null);
  const hub = createEventHub({ session: 's1' });
  const seen = [];
  hub.subscribe(event => seen.push(event.id));
  hub.publish('hello', {});
  hub.publish('revision', { modelId: 'x' });
  assert.deepEqual(seen, ['s1:1', 's1:2']);
  assert.deepEqual(hub.recent('s1:1').map(event => event.name), ['revision']);
  assert.throws(() => hub.publish('made-up'), /Unknown viewer event/);
  assert.equal(typeof validateReview, 'function');
});

}
