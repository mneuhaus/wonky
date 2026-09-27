import test from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missingBend();
if (publicTreeSkip) {
  test("viewer-workspace.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { execFile } = await import("node:child_process");
const { createHash } = await import("node:crypto");
const { mkdir, mkdtemp, readFile, rm, writeFile } = await import("node:fs/promises");
const { homedir, tmpdir } = await import("node:os");
const { join } = await import("node:path");
const { fileURLToPath } = await import("node:url");
const { promisify } = await import("node:util");
const { manifestInputFiles } = await import("../src/modules.mjs");
const { createReviewServer } = await import("../src/viewer/server.mjs");
const { manifestFiles, watchSetOf } = await import("../src/viewer/live/session.mjs");
const { normalizeWorkspace, WorkspaceError } = await import("../src/viewer/workspace/load.mjs");
const { defaultCamera, fit, preset, viewProjection } = await import("../viewer/render/camera.js");
const { sceneDrawModel } = await import("../viewer/render/draw-decode.js");
const { createPanes } = await import("../viewer/render/panes.js");
const { createPicker, projectModel } = await import("../viewer/render/picking.js");
const { applyPoint, placedMatrix } = await import("../viewer/render/placement.js");
const { paneMembers } = await import("../viewer/render/renderer.js");
const { createSceneCache } = await import("../viewer/render/scene-cache.js");
const { reviewScene } = await import("../src/review-scene.mjs");
const { createViewer } = await import("../viewer/app.js");
const { loadFeatures } = await import("../viewer/core/feature-loader.js");
const { FEATURES } = await import("../viewer/features/index.js");
const { createFakeEnvironment } = await import("../scripts/viewer/test-support/fake-env.mjs");
const { FakeEventSource } = await import("../scripts/viewer/test-support/fake-event-source.mjs");
const { activeKey, nodeMembers, visibilityAfter } = await import("../viewer/features/workspace/tree.js");
// Viewer workspaces (docs/viewer/workspace.md): the workspace file loader,
// the studio manifest adapter, the CLI, the frozen-module watch set, one
// server for several models, placements in the renderer and the picker, the
// tree's node rules and the workspace feature in the fake browser. Reads only
// fixtures/viewer-workspace/ and examples/.




























const root = fileURLToPath(new URL('../', import.meta.url));
const fixtures = join(root, 'fixtures/viewer-workspace');
const run = promisify(execFile);
const sha256 = value => createHash('sha256').update(value).digest('hex');
const sleep = ms => new Promise(done => setTimeout(done, ms));

async function directory(t) {
  const path = await mkdtemp(join(tmpdir(), 'wonky-workspace-'));
  t.after(() => rm(path, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  return path;
}

async function until(check, { timeoutMs = 120000, what = 'condition' } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await sleep(25);
  }
}

// ---- T1: loader ----

const ENV = { HOME: '/home/marc', WONKY_ONSHAPE_STORE: '/stores/onshape' };
const FILE = '/projects/feeder/feeder.view.json';

const valid = () => ({
  schema: 'wonky.view-workspace/1',
  name: 'Feeder',
  defaults: { curvedContacts: 'tolerated-regularized', contactCapMm: 0.5 },
  limits: { maxWorkers: 3 },
  models: [
    { key: 'base', source: 'studios/base.fs', feature: 'base', params: { width: '8 * millimeter' },
      out: '../out/base' },
    { key: 'arm', label: 'Arm', source: '~/cad/arm.fs', feature: 'arm',
      modules: 'store:manifests/arm.fs.json',
      transform: { rotate: [{ axis: [0, 0, 1], deg: 90 }], translate: [10, 0, 0] } },
    { key: 'saved', source: 'saved.brep.json' },
  ],
  assemblies: [{ key: 'all', instances: [{ model: 'base' },
    { model: 'arm', transform: { translate: [0, 0, 5] } }] }],
});

test('a workspace file normalizes paths, defaults, params and rigid placements', () => {
  const space = normalizeWorkspace(valid(), { file: FILE, env: ENV });
  const [base, arm, saved] = space.models;
  assert.equal(base.source, '/projects/feeder/studios/base.fs');
  assert.equal(base.out.prefix, '/projects/out/base');
  assert.equal(base.out.format, 'all');
  assert.equal(base.build.feature, 'base');
  assert.deepEqual({ ...base.build.parameters }, { width: '8 * millimeter' });
  assert.deepEqual(base.build.modelingPolicy, arm.build.modelingPolicy);
  assert.equal(base.build.modelingPolicy.curvedContacts, 'tolerated-regularized',
    'defaults apply to every live model');
  assert.equal(arm.source, '/home/marc/cad/arm.fs');
  assert.equal(arm.build.moduleManifest, '/stores/onshape/manifests/arm.fs.json');
  assert.equal(arm.label, 'Arm');
  assert.deepEqual(arm.matrix, [0, -1, 0, 10, 1, 0, 0, 0, 0, 0, 1, 0]);
  assert.equal(saved.static, true);
  assert.equal(saved.build, null);
  assert.deepEqual(space.assemblies[0].instances.map(instance => [instance.id, instance.matrix]), [
    ['all/0', [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]],
    ['all/1', [0, -1, 0, 10, 1, 0, 0, 0, 0, 0, 1, 5]],
  ], 'instance placement = instance transform ∘ model transform');
  assert.equal(space.open, 'assembly:all');
  assert.equal(space.limits.maxWorkers, 3);
  assert.equal(space.limits.concurrency, 2);
});

test('an invalid workspace is refused with the JSON path of its first error', () => {
  const cases = [
    ['duplicate key', value => { value.models[1].key = 'base'; }, '$.models[1].key'],
    ['assembly key clashing with a model', value => { value.assemblies[0].key = 'arm'; },
      '$.assemblies[0].key'],
    ['unknown model field', value => { value.models[0].colour = 'red'; }, '$.models[0].colour'],
    ['unknown top-level field', value => { value.mates = []; }, '$.mates'],
    ['per-model option in defaults', value => { value.defaults.feature = 'x'; },
      '$.defaults.feature'],
    ['unknown instance model', value => { value.assemblies[0].instances[0].model = 'nope'; },
      '$.assemblies[0].instances[0].model'],
    ['scale 2', value => {
      value.models[0].transform = { matrix: [2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0] };
    }, '$.models[0].transform.matrix'],
    ['mirror', value => {
      value.models[0].transform = { matrix: [-1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0] };
    }, '$.models[0].transform.matrix'],
    ['bad last row', value => {
      value.models[0].transform = { matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 1, 1] };
    }, '$.models[0].transform.matrix'],
    ['same source, feature, params and modules', value => {
      value.models.push({ key: 'base-again', source: 'studios/base.fs', feature: 'base',
        params: { width: '8 * millimeter' } });
    }, '$.models[3]'],
    ['build option on a saved model', value => { value.models[2].feature = 'x'; },
      '$.models[2].feature'],
    ['unknown open node', value => { value.open = 'assembly:nope'; }, '$.open'],
  ];
  for (const [name, mutate, path] of cases) {
    const value = valid();
    mutate(value);
    assert.throws(() => normalizeWorkspace(value, { file: FILE, env: ENV }), error => {
      assert.ok(error instanceof WorkspaceError, name);
      assert.equal(error.jsonPath, path, name);
      return true;
    }, name);
  }
  const twice = valid();
  twice.models.push({ key: 'base-thick', source: 'studios/base.fs', feature: 'base',
    params: { width: '12 * millimeter' } });
  assert.equal(normalizeWorkspace(twice, { file: FILE, env: ENV }).models.length, 4,
    'the same file with other params is another model');
});

// ---- T2: CLI and studio manifest adapter ----

const cli = (args, env = {}) => run(process.execPath, [join(root, 'bin/wonky-view.mjs'), ...args],
  { cwd: root, env: { ...process.env, ...env } });

test('--print-workspace turns a studio manifest into a workspace; build flags are refused',
  async () => {
    const manifest = join(fixtures, 'studios/corpus/proj/build/studios/manifest.json');
    const env = { WONKY_CORPUS_ROOT: join(fixtures, 'studios/corpus'),
      WONKY_ONSHAPE_STORE: join(fixtures, 'studios/store') };
    const { stdout } = await cli([manifest, '--print-workspace'], env);
    const printed = JSON.parse(stdout);
    assert.equal(printed.schema, 'wonky.view-workspace/1');
    assert.deepEqual(printed.models.map(model => [model.key, model.feature, model.label,
      model.modules ?? null]), [
      ['alpha', 'projAlpha', 'Proj alpha', null],
      ['beta', 'projBeta', 'Proj beta', 'store:manifests/proj/build/studios/beta.fs.json'],
      ['gamma', 'projGamma', 'Proj gamma', null],
    ], 'module order, features, and a store manifest only where one exists');
    assert.equal(printed.models[1].source.replace(/^~(?=\/)/, homedir()), join(fixtures,
      'studios/corpus/proj/build/studios/beta.fs'), 'the studio file (home as ~)');
    assert.deepEqual(printed.assemblies.map(assembly => [assembly.key,
      assembly.instances.map(instance => instance.model)]), [['all', ['alpha', 'beta', 'gamma']]]);
    assert.equal(printed.open, 'assembly:all');
    // The printed file loads as a workspace of its own.
    const space = normalizeWorkspace(printed, { file: manifest, env });
    assert.equal(space.models[1].build.moduleManifest,
      join(fixtures, 'studios/store/manifests/proj/build/studios/beta.fs.json'));

    for (const [args, message] of [
      [[manifest, '--feature', 'projAlpha'], /--feature is not allowed next to a workspace/],
      [[manifest, '--out', 'x'], /--out is not allowed next to a workspace/],
      [[manifest, join(root, 'examples/box.fs')], /must be the only input/],
      [[join(root, 'examples/box.fs'), '--print-workspace'], /needs a workspace/],
    ]) {
      await assert.rejects(cli([...args, '--no-open', '--port', '0'], env), error => {
        assert.equal(error.code, 1, args.join(' '));
        assert.match(error.stderr, message);
        return true;
      });
    }
  });

// ---- T3: frozen module watch set (regression: schema 2 `store`) ----

test('the watcher watches exactly the files the module loader reads, under manifest.store',
  async t => {
    const dir = await directory(t);
    const store = join(dir, 'store');
    const manifestPath = join(store, 'manifests/proj/part.fs.json');
    await mkdir(join(store, 'manifests/proj'), { recursive: true });
    const manifest = {
      schema: 'wonky-onshape-inputs/2', store: '../..', hostDocument: '0'.repeat(24),
      modules: [{
        namespace: 'ns', path: 'a'.repeat(24), element: 'a'.repeat(24), microversion: 'b'.repeat(24),
        parts: { file: 'revisions/e@m/parts.json', sha256: '0'.repeat(64) },
        bodies: [{ partId: 'JHD', file: 'revisions/e@m/bodies/JHD.body.json',
          sha256: '0'.repeat(64) }],
      }],
    };
    const bytes = JSON.stringify(manifest);
    await writeFile(manifestPath, bytes);
    const expected = [join(store, 'revisions/e@m/parts.json'),
      join(store, 'revisions/e@m/bodies/JHD.body.json')];
    assert.deepEqual(manifestInputFiles(manifestPath), expected);
    assert.deepEqual(manifestFiles(manifestPath, bytes), expected,
      'store-relative, not <manifest dir>/revisions/…');
    const set = await watchSetOf(join(dir, 'part.fs'), 'featurescript',
      { moduleManifest: manifestPath });
    assert.deepEqual(set.filter(entry => entry.role === 'module').map(entry => entry.path),
      expected);
    assert.deepEqual(manifestFiles(manifestPath, '{"modules": []}'), [],
      'a manifest the loader refuses has no watch files (its build reports it)');
  });

// ---- T4/T5: one server, several models ----

test('one server builds two models of one file with their own features and rebuilds per model',
  async t => {
    const dir = await directory(t);
    const source = join(dir, 'two-features.fs');
    const text = await readFile(join(fixtures, 'two-features.fs'), 'utf8');
    await writeFile(source, text);
    const workspace = normalizeWorkspace({
      schema: 'wonky.view-workspace/1', name: 'Two',
      limits: { concurrency: 1, maxWorkers: 2 },
      models: [
        { key: 'plate', source: 'two-features.fs', feature: 'plate',
          params: { width: '30 * millimeter' } },
        { key: 'post', source: 'two-features.fs', feature: 'post',
          transform: { translate: [5, 5, 0] } },
      ],
      assemblies: [{ key: 'stack', instances: [{ model: 'plate' }, { model: 'post' }] }],
    }, { file: join(dir, 'two.view.json') });
    const server = await createReviewServer({
      workspace, port: 0, reviewDirectory: join(dir, 'reviews'),
      stateDirectory: join(dir, 'state'), live: { debounceMs: 30, pool: { spare: false } },
    });
    t.after(() => server.close());
    const events = [];
    server.events.subscribe(event => events.push({ name: event.name, ...event.data }));
    const revision = (key, number) => until(() => {
      const session = server.sessions.find(item => item.key === key);
      return events.find(event => event.name === 'revision' && event.sourceId === session.id
        && event.revision === number);
    }, { what: `${key} r${number}` });
    const plate1 = await revision('plate', 1);
    const post1 = await revision('post', 1);

    const ids = server.sessions.map(session => session.id);
    assert.equal(new Set(ids).size, 2, 'two source ids for one file');
    assert.ok(ids[0].endsWith('-plate') && ids[1].endsWith('-post'));
    for (const [feature, extra, event] of [['plate', ['--param', 'width=30 * millimeter'], plate1],
      ['post', [], post1]]) {
      const prefix = join(dir, 'cli', feature);
      await run(process.execPath, [join(root, 'bin/wonky.mjs'), source, '--feature', feature,
        ...extra, '--out', prefix, '--format', 'step'], { cwd: root });
      assert.equal(event.modelId, sha256(await readFile(`${prefix}.brep.json`)),
        `${feature}: live model id equals the CLI output of its feature`);
    }
    assert.notEqual(plate1.modelId, post1.modelId);

    const body = await (await fetch(`${server.origin}/api/workspace`)).json();
    assert.deepEqual(body.tree.models.map(model => [model.key, model.sourceId, model.modelId]),
      [['plate', ids[0], plate1.modelId], ['post', ids[1], post1.modelId]]);
    assert.deepEqual(body.tree.assemblies[0].instances.map(instance => instance.matrix[3]), [0, 5]);
    assert.equal(body.tree.implicit, false);
    const live = await (await fetch(`${server.origin}/api/live`)).json();
    assert.deepEqual(live.sources.map(item => item.key), ['plate', 'post']);
    const facts = await (await fetch(`${server.origin}/api/compare/revisions`)).json();
    const factOf = modelId => facts.revisions.find(item => item.modelId === modelId);
    assert.equal(factOf(plate1.modelId).model, 'plate');
    assert.equal(factOf(post1.modelId).source, `${source}#post`,
      'one file, two library groups');

    // Rebuild one model: only its source queues a build.
    const queuedBefore = events.filter(event => event.name === 'build-queued').length;
    const response = await fetch(`${server.origin}/api/live/${ids[1]}/rebuild`, {
      method: 'POST', headers: { Origin: server.origin }, body: '{}',
    });
    assert.equal(response.status, 202);
    await revision('post', 2);
    const queued = events.filter(event => event.name === 'build-queued').slice(queuedBefore);
    assert.deepEqual(queued.map(event => event.sourceId), [ids[1]]);

    // Saving the shared file rebuilds both models.
    await writeFile(source, `${text}\n// saved\n`);
    await revision('plate', 2);
    await revision('post', 3);
  });

// Fix round 1 (finding 1): a missing model source stopped the whole server.
test('a model whose source cannot be read fails alone; the server serves the others',
  async t => {
    const dir = await directory(t);
    const text = await readFile(join(fixtures, 'two-features.fs'), 'utf8');
    await writeFile(join(dir, 'plate.fs'), text);
    await mkdir(join(dir, 'folder.fs'));
    const workspaceOf = models => normalizeWorkspace({
      schema: 'wonky.view-workspace/1', name: 'Partly readable',
      limits: { concurrency: 1, maxWorkers: 1 }, models,
    }, { file: join(dir, 'ws.view.json') });
    const start = models => createReviewServer({
      workspace: workspaceOf(models), port: 0, reviewDirectory: join(dir, 'reviews'),
      stateDirectory: join(dir, 'state'), live: { debounceMs: 30, pool: { spare: false } },
    });
    const late = { key: 'late', source: 'late.fs', feature: 'post' };
    // Nothing the server could show: refused as before.
    await assert.rejects(start([late]), /Cannot read live source .*late\.fs/);

    const server = await start([{ key: 'plate', source: 'plate.fs', feature: 'plate' }, late,
      { key: 'folder', source: 'folder.fs', feature: 'post' }]);
    t.after(() => server.close());
    const events = [];
    server.events.subscribe(event => events.push({ name: event.name, ...event.data }));
    const idOf = key => server.sessions.find(session => session.key === key).id;
    const event = (name, key, revision) => until(() => events.find(item => item.name === name
      && item.sourceId === idOf(key) && item.revision === revision),
    { what: `${name} ${key} r${revision}` });
    await event('revision', 'plate', 1);
    const failures = await until(async () => {
      const { sources } = await (await fetch(`${server.origin}/api/live`)).json();
      const failed = sources.filter(source => source.state === 'failed');
      return failed.length === 2 && failed;
    }, { what: 'late and folder failed' });
    assert.deepEqual(failures.map(source => [source.key, source.lastFailure.kind,
      source.lastFailure.error.name]), [['late', 'input', 'MissingSourceError'],
      ['folder', 'input', 'UnreadableSourceError']]);

    // The missing source is watched: creating it builds the model.
    await writeFile(join(dir, 'late.fs'), text);
    const built = await event('revision', 'late', 2);
    const { tree } = await (await fetch(`${server.origin}/api/workspace`)).json();
    assert.equal(tree.models.find(model => model.key === 'late').modelId, built.modelId);
  });

test('plain inputs form an implicit workspace tree (one model per input, no assembly)',
  async t => {
    const dir = await directory(t);
    const path = join(dir, 'box.brep.json');
    const { build } = await import('../src/index.mjs');
    const bytes = Buffer.from(JSON.stringify(await build(await readFile(join(root,
      'examples/box.fs'), 'utf8')), null, 2) + '\n');
    await writeFile(path, bytes);
    const server = await createReviewServer({
      modelPaths: [path], port: 0, reviewDirectory: join(dir, 'reviews'),
      stateDirectory: join(dir, 'state'),
    });
    t.after(() => server.close());
    const { tree } = await (await fetch(`${server.origin}/api/workspace`)).json();
    assert.equal(tree.implicit, true);
    assert.deepEqual(tree.assemblies, []);
    assert.deepEqual(tree.models.map(model => [model.key, model.static, model.modelId]),
      [['box', true, sha256(bytes)]]);
  });

// ---- T8/T9: placements in the renderer matrix and the picker ----

// A 20 x 20 mm wall of thickness 1 at y = 0..1.
function wallScene(id) {
  const front = [[0, 0, 0], [20, 0, 0], [20, 0, 20], [0, 0, 20]];
  const back = front.map(([x, , z]) => [x, 1, z]);
  const quad = (points, normal) => [
    { points: [points[0], points[1], points[2]], normal },
    { points: [points[0], points[2], points[3]], normal },
  ];
  return {
    id, bounds: { min: [0, 0, 0], max: [20, 1, 20] },
    bodies: [{
      id: 'wall', faces: [
        { index: 0, surfaceType: 'plane', edgeIndices: [0], triangles: quad(front, [0, -1, 0]) },
        { index: 1, surfaceType: 'plane', edgeIndices: [1], triangles: quad(back, [0, 1, 0]) },
      ],
      edges: [{ index: 0, curveType: 'line', points: [front[0], front[1]] }],
      vertices: [{ index: 0, point: [20, 0, 20] }],
    }],
  };
}

const pane = (modelId, members) => ({
  x: 0, y: 0, width: 800, height: 600, clipX: 0, clipWidth: 800, modelId, side: 'after',
  ...(members ? { members } : {}),
});

// Rotation of 90° about Z, then a translation.
const PLACEMENT = [0, -1, 0, 30, 1, 0, 0, -4, 0, 0, 1, 5];

test('a placed member projects like the same geometry built at its placement', () => {
  const local = wallScene('local');
  const placedScene = structuredClone(local);
  const move = point => applyPoint(PLACEMENT, point);
  for (const face of placedScene.bodies[0].faces) {
    for (const triangle of face.triangles) {
      triangle.points = triangle.points.map(move);
      triangle.normal = [-triangle.normal[1], triangle.normal[0], triangle.normal[2]];
    }
  }
  placedScene.bodies[0].edges[0].points = placedScene.bodies[0].edges[0].points.map(move);
  placedScene.bodies[0].vertices[0].point = move(placedScene.bodies[0].vertices[0].point);
  placedScene.bounds = { min: [29, -4, 5], max: [30, 16, 25] };
  const model = sceneDrawModel(local);
  const reference = sceneDrawModel(placedScene);
  const screen = pane('local');
  const camera = fit(placedScene.bounds, preset('iso', defaultCamera(placedScene.bounds)),
    screen);
  const a = projectModel(model, screen, camera, PLACEMENT);
  const b = projectModel(reference, screen, camera);
  assert.ok(Math.abs(a.points.x[0] - b.points.x[0]) < 1e-6
    && Math.abs(a.points.y[0] - b.points.y[0]) < 1e-6, 'the picker places the vertex');
  // The renderer's member matrix maps (local - center) where the world matrix maps world.
  const world = viewProjection(camera, screen, placedScene.bounds, { relativeTo: [0, 0, 0] });
  const member = placedMatrix(viewProjection(camera, screen, placedScene.bounds,
    { relativeTo: applyPoint(PLACEMENT, model.center) }), PLACEMENT);
  const clip = (matrix, p) => [0, 1, 3].map(row => matrix[row] * p[0] + matrix[4 + row] * p[1]
    + matrix[8 + row] * p[2] + matrix[12 + row]);
  const vertex = [20, 0, 20];
  const [x1, y1, w1] = clip(member, vertex.map((value, axis) => value - model.center[axis]));
  const [x2, y2, w2] = clip(world, applyPoint(PLACEMENT, vertex));
  assert.ok(Math.abs(x1 / w1 - x2 / w2) < 1e-9 && Math.abs(y1 / w1 - y2 / w2) < 1e-9);
});

test('picking in an assembly returns the nearest visible member, never a hidden one', () => {
  const cache = createSceneCache();
  const ids = { back: 'a'.repeat(64), front: 'b'.repeat(64) };
  cache.scenes.set(ids.back, wallScene(ids.back));
  cache.scenes.set(ids.front, wallScene(ids.front));
  const state = { compare: false, mode: 'auto', after: ids.back, selectionSet: [] };
  Object.defineProperty(state, 'scenes', { get: () => cache.scenes });
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];
  // The front copy sits 10 mm nearer a camera looking from -Y.
  const nearer = [1, 0, 0, 0, 0, 1, 0, -10, 0, 0, 1, 0];
  let members = [
    { instance: 'a/0', key: 'back', modelId: ids.back, matrix: identity },
    { instance: 'a/1', key: 'front', modelId: ids.front, matrix: nearer },
  ];
  const canvas = { clientWidth: 800, clientHeight: 600 };
  const panes = createPanes({ canvas, state });
  panes.setMembers(() => members);
  const bounds = { min: [0, -10, 0], max: [20, 1, 20] };
  const camera = fit(bounds, preset('front', defaultCamera(bounds)), pane(ids.back));
  panes.camera = () => camera;
  const picker = createPicker({ state, panes });
  const at = () => picker.detail(400, 300, 'face');
  assert.equal(panes.viewPanes()[0].members.length, 2);
  let hit = at();
  assert.equal(hit.reference.modelId, ids.front);
  assert.equal(hit.instance, 'a/1');
  assert.ok(Math.abs(hit.point[1] - -10) < 1e-6, 'the hit point is in world coordinates');
  picker.setStyle({ models: { [ids.front]: { bodies: { wall: { visible: false } } } } });
  hit = at();
  assert.equal(hit.reference.modelId, ids.back, 'a hidden body of the nearer member');
  picker.setStyle(null);
  members = members.slice(0, 1);
  assert.equal(at().reference.modelId, ids.back, 'a hidden member');
  // Fix round 1 (finding 3): with every instance hidden the pane draws and
  // picks nothing; only a pane without workspace members (null) is the plain
  // one-model pane of state.after.
  members = [];
  assert.deepEqual(paneMembers(panes.viewPanes()[0]), [], 'the renderer draws no member');
  assert.equal(at(), null, 'a fully hidden assembly has nothing to pick');
  members = null;
  assert.deepEqual(paneMembers(panes.viewPanes()[0]).map(member => member.modelId), [ids.back]);
  assert.equal(at().reference.modelId, ids.back, 'a plain pane picks its model');
});

// ---- T10: tree node rules ----

test('workspace nodes: members, active model and instance visibility', () => {
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];
  const moved = [1, 0, 0, 5, 0, 1, 0, 0, 0, 0, 1, 0];
  const tree = {
    models: [{ key: 'a', matrix: identity }, { key: 'b', matrix: identity },
      { key: 'c', matrix: moved }],
    assemblies: [{ key: 'all', instances: [
      { id: 'all/0', model: 'a', matrix: identity }, { id: 'all/1', model: 'b', matrix: identity },
      { id: 'all/2', model: 'c', matrix: moved }] }],
  };
  const current = new Map([['a', 'A'], ['c', 'C']]);
  const all = { kind: 'assembly', key: 'all' };
  assert.equal(nodeMembers(tree, { kind: 'model', key: 'a' }, { current }), null,
    'a model at identity draws exactly as a plain viewer');
  assert.deepEqual(nodeMembers(tree, { kind: 'model', key: 'c' }, { current })
    .map(member => [member.instance, member.modelId]), [['model:c', 'C']]);
  assert.deepEqual(nodeMembers(tree, all, { current }).map(member => member.key), ['a', 'c'],
    'b has no good revision yet');
  assert.deepEqual(nodeMembers(tree, all, { current, hidden: new Set(['all/0']) })
    .map(member => member.key), ['c']);
  assert.equal(nodeMembers(tree, { kind: 'assembly', key: 'gone' }, { current }), null);

  assert.equal(activeKey(tree, all, { current }), 'a', 'first visible member with a revision');
  assert.equal(activeKey(tree, all, { current, selectionKey: 'c' }), 'c');
  assert.equal(activeKey(tree, all, { current, lastKey: 'c' }), 'c');
  assert.equal(activeKey(tree, all, { current, lastKey: 'c', hidden: new Set(['all/2']) }), 'a',
    'a hidden model is never active');

  const instances = tree.assemblies[0].instances;
  const isolated = visibilityAfter('isolate', instances, new Set(), 'all/1');
  assert.deepEqual([...isolated].sort(), ['all/0', 'all/2']);
  assert.deepEqual([...visibilityAfter('isolate', instances, isolated, 'all/1')], [],
    'isolating the isolated instance again shows all');
  assert.deepEqual([...visibilityAfter('toggle', instances, isolated, 'all/0')], ['all/2']);
});

// ---- The workspace feature in the fake browser ----

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];
const A = 'a'.repeat(64);
const C = 'c'.repeat(64);

// One viewer with every feature over a fake server: models A and C are
// examples/box.fs (one body each; parts documents and draw payloads from the
// real partsDocument and drawQuery), `listed` is the /api/workspace model list
// (live entries via entry()); the caller sends the SSE stream. Settings PUTs
// merge like the server does; holdDraw(id) delays that draw payload until the
// returned release() (a large model's payload arrives last).
async function workspaceBrowser() {
  const { build } = await import('../src/index.mjs');
  const { mergeSettings } = await import('../src/viewer/settings.mjs');
  const { partsDocument } = await import('../src/viewer/parts.mjs');
  const { drawQuery, loadDrawKernel } = await import('../src/viewer/draw.mjs');
  await loadDrawKernel();
  const { features, failures } = await loadFeatures(FEATURES);
  assert.deepEqual(failures, []);
  const box = await build(await readFile(join(root, 'examples/box.fs'), 'utf8'));
  const scenes = new Map(await Promise.all([A, C].map(async id => [id,
    await reviewScene(box, { id, label: 'box', sha256: id, bodyCount: box.bodies.length })])));
  // Draw payloads as GET /api/models/:id/draw serves them (assembly members
  // that were never opened load only these).
  const draws = new Map(await Promise.all([A, C].map(async id => [id,
    (await drawQuery(box, { modelId: id, scene: scenes.get(id) })).buffer])));
  const entry = (id, sourceId, revision) => ({
    id, label: sourceId, sha256: id, sourcePath: `/work/${sourceId}.fs`, bodyCount: 1,
    bounds: scenes.get(id).bounds,
    live: { sourceId, path: `/work/${sourceId}.fs`, revision, revisions: [revision] },
  });
  const listed = [];
  const held = new Map();
  let settings = { schema: 'wonky.viewer-settings/1', global: {}, sources: {}, bodies: {} };
  const dispatch = async (path, options = {}) => {
    if (path === '/api/settings' && options.method === 'PUT') {
      settings = mergeSettings(settings, JSON.parse(options.body));
    }
    if (path === '/api/settings') return settings;
    if (path === '/api/workspace') return { models: listed, reports: [], feedback: [] };
    if (path.startsWith('/api/compare?')) throw new Error('delta strip: not part of this test');
    if (path === '/api/compare/revisions') {
      return { revisions: listed.map(item => ({ modelId: item.id, kind: 'live',
        source: item.sourcePath, revision: item.live.revision })) };
    }
    const parts = /^\/api\/models\/([a-f0-9]{64})\/parts$/.exec(path);
    if (parts) return partsDocument(box, parts[1]);
    const draw = /^\/api\/models\/([a-f0-9]{64})\/draw$/.exec(path);
    if (draw) {
      await held.get(draw[1]);
      return draws.get(draw[1]);
    }
    const model = /^\/api\/models\/([a-f0-9]{64})$/.exec(path);
    return model ? scenes.get(model[1]) : {};
  };
  const fake = createFakeEnvironment({ dispatch });
  fake.env.EventSource = FakeEventSource;
  FakeEventSource.instances = [];
  const viewer = createViewer(fake.env, { features, log: () => {} });
  const stream = FakeEventSource.instances[0];
  stream.open();
  return { viewer, fake, stream, listed, entry, state: viewer.harness.state, app: viewer.ctx.app,
    settings: () => settings,
    holdDraw(id) {
      let release;
      held.set(id, new Promise(done => { release = done; }));
      return release;
    } };
}
const liveSource = (id, modelId, revision = 1) => ({
  id, path: `/work/${id}.fs`, label: id, language: 'featurescript', state: 'ok',
  current: { revision, status: 'ok', jobId: revision }, lastGood: { revision, modelId },
});

// Fix round 1 (finding 2): opening a model that has no good revision kept the
// previous model (geometry, model bar, live status) on screen, and its first
// good revision did not open it.
test('a model node without a good revision shows no model and opens its first good one',
  async () => {
    const { viewer, fake, stream, listed, entry, state, app } = await workspaceBrowser();
    listed.push(entry(A, 'alpha', 1));
    const failure = { schema: 'wonky.live-build-failure/1', kind: 'evaluation', revision: 1,
      jobId: 2, source: { path: '/work/bad.fs', language: 'featurescript' },
      error: { name: 'Error', message: 'bad input' } };
    stream.send('hello', {
      session: 's1', workers: { failed: null },
      sources: [
        liveSource('alpha', A),
        { id: 'bad', path: '/work/bad.fs', label: 'bad', language: 'featurescript',
          state: 'failed', current: { revision: 1, status: 'failed', jobId: 2 },
          lastGood: null, lastFailure: failure },
      ],
      tree: { name: 'Two', implicit: false, open: 'model:alpha', assemblies: [],
        models: [
          { key: 'alpha', label: 'alpha', sourceId: 'alpha', modelId: A, matrix: IDENTITY },
          { key: 'bad', label: 'bad', sourceId: 'bad', modelId: null, matrix: IDENTITY },
        ] },
    }, 's1:0');
    const pill = () => fake.node('#live-pill-text').textContent;
    await until(() => state.after === A && !state.loading, { what: 'alpha shown' });
    await until(() => pill() === 'Current r1', { what: 'alpha current' });
    const camera = JSON.stringify(state.camera);

    await app.openWorkspaceNode('model:bad');
    assert.equal(state.after, null, 'no model instead of alpha');
    await until(() => pill() === 'No successful build · r1 fails', { what: 'bad status' });
    await sleep(20);
    assert.equal(state.after, null, 'the live feature does not open another source');
    assert.deepEqual(app.workspaceEmptyNode(), { key: 'bad', sourceId: 'bad' });

    // The repaired build opens in the node that waits for it.
    listed.push(entry(C, 'bad', 2));
    stream.send('build-queued', { sourceId: 'bad', path: '/work/bad.fs', jobId: 3,
      revision: 2, reason: 'save' }, 's1:1');
    stream.send('revision', { sourceId: 'bad', path: '/work/bad.fs', jobId: 3, revision: 2,
      modelId: C }, 's1:2');
    await until(() => state.after === C && !state.loading, { what: 'bad r2 shown' });
    await until(() => pill() === 'Current r2', { what: 'bad current' });
    assert.equal(app.workspaceEmptyNode(), null);
    assert.equal(JSON.stringify(state.camera), camera, 'switching keeps the camera');
    viewer.dispose?.();
  });

// Fix round 2 (finding 1): a placed model node drew its newest good revision
// while Follow off kept the older one in the model bar and the inspector.
test('a placed model node draws the revision it displays, also with Follow off', async () => {
  const { viewer, fake, stream, listed, entry, state, settings } = await workspaceBrowser();
  const drawn = () => paneMembers(viewer.ctx.panes.viewPanes()[0])
    .map(member => member.modelId);
  listed.push(entry(A, 'beta', 1));
  stream.send('hello', {
    session: 's1', workers: { failed: null }, sources: [liveSource('beta', A)],
    tree: { name: 'Placed', implicit: false, open: 'model:beta', assemblies: [],
      models: [{ key: 'beta', label: 'beta', sourceId: 'beta', modelId: A,
        matrix: [1, 0, 0, 30, 0, 1, 0, 0, 0, 0, 1, 0] }] },
  }, 's1:0');
  await until(() => state.after === A && !state.loading, { what: 'beta r1 shown' });
  assert.deepEqual(drawn(), [A]);
  fake.document.emit('keydown', { key: 'l' });
  await until(() => settings().sources['/work/beta.fs']?.followLive === false,
    { what: 'follow off persisted' });

  listed.push(entry(C, 'beta', 2));
  stream.send('revision', { sourceId: 'beta', path: '/work/beta.fs', jobId: 2, revision: 2,
    modelId: C }, 's1:1');
  await until(() => viewer.ctx.renderer.model(C), { what: 'r2 draw model loaded' });
  await until(() => fake.node('#live-pill-text').textContent === 'Viewing r1 · r2 is latest',
    { what: 'r2 waits' });
  assert.equal(state.after, A, 'Follow off keeps r1 displayed');
  assert.deepEqual(drawn(), [A], 'the placed member draws the displayed r1, not r2');

  viewer.ctx.commands.run('live.latest');
  await until(() => state.after === C && !state.loading, { what: 'r2 shown' });
  assert.deepEqual(drawn(), [C], 'showing r2 moves the placed member to r2');
  viewer.dispose?.();
});

// Fix round 2 (finding 2): an assembly member whose first good revision came
// after the assembly opened stayed "Loading parts…" and out of the count.
test('an assembly member built later lists its parts and joins the parts count', async () => {
  const { viewer, fake, stream, listed, entry, state, app, holdDraw } = await workspaceBrowser();
  listed.push(entry(A, 'alpha', 1));
  stream.send('hello', {
    session: 's1', workers: { failed: null },
    sources: [liveSource('alpha', A), { id: 'late', path: '/work/late.fs', label: 'late',
      language: 'featurescript', state: 'building',
      current: { revision: 1, status: 'building', jobId: 2 }, lastGood: null }],
    tree: { name: 'Late', implicit: false, open: 'assembly:all',
      models: [
        { key: 'alpha', label: 'alpha', sourceId: 'alpha', modelId: A, matrix: IDENTITY },
        { key: 'late', label: 'late', sourceId: 'late', modelId: null, matrix: IDENTITY },
      ],
      assemblies: [{ key: 'all', label: 'all', instances: [
        { id: 'all/0', model: 'alpha', matrix: IDENTITY },
        { id: 'all/1', model: 'late', matrix: IDENTITY }] }] },
  }, 's1:0');
  app.showPartsTab();
  const panel = () => fake.node('#parts-panel').innerHTML;
  const count = () => fake.node('#parts-count').textContent;
  await until(() => state.after === A && count() === '1', { what: 'alpha listed' });

  // As with R20: the library lists late r1 before its draw payload arrives.
  const release = holdDraw(C);
  listed.push(entry(C, 'late', 1));
  stream.send('revision', { sourceId: 'late', path: '/work/late.fs', jobId: 2, revision: 1,
    modelId: C }, 's1:1');
  await until(() => state.workspace?.models?.some(item => item.id === C),
    { what: 'late r1 listed' });
  await sleep(20);
  release();
  await until(() => app.workspaceMembers().length === 2, { what: 'late drawn' });
  await until(() => count() === '2', { timeoutMs: 5000, what: 'late in the parts count' });
  assert.match(panel(), new RegExp(`data-model-id="${C}"`));
  assert.doesNotMatch(panel(), /Loading parts/);
  viewer.dispose?.();
});

// Fix round 3: after model alpha hid its body and model beta was opened, the
// assembly listed alpha's hidden body with a pressed eye ("Hide"), and that
// eye showed the body again. Both members are examples/box.fs, so their bodies
// share one id, as alpha's and beta's model/plate do in the verifier's run.
test('an assembly lists a member body hidden in its model view as hidden', async () => {
  const { viewer, fake, stream, listed, entry, state, app } = await workspaceBrowser();
  listed.push(entry(A, 'alpha', 1), entry(C, 'beta', 1));
  stream.send('hello', {
    session: 's1', workers: { failed: null },
    sources: [liveSource('alpha', A), liveSource('beta', C)],
    tree: { name: 'Pair', implicit: false, open: 'assembly:all',
      models: [
        { key: 'alpha', label: 'alpha', sourceId: 'alpha', modelId: A, matrix: IDENTITY },
        { key: 'beta', label: 'beta', sourceId: 'beta', modelId: C, matrix: IDENTITY },
      ],
      assemblies: [{ key: 'all', label: 'all', instances: [
        { id: 'all/0', model: 'alpha', matrix: IDENTITY },
        { id: 'all/1', model: 'beta', matrix: IDENTITY }] }] },
  }, 's1:0');
  app.showPartsTab();
  const panel = fake.node('#parts-panel');
  const count = () => fake.node('#parts-count').textContent;
  // The eye of a member's first row: [aria-pressed, title].
  const eyeOf = modelId => {
    const group = panel.innerHTML.split('<section').find(part => part
      .includes(`data-model-id="${modelId}"`)) ?? '';
    const eye = /class="part-eye"[^>]*aria-pressed="(\w+)"[^>]*title="([^"]*)"/.exec(group);
    return eye ? [eye[1], eye[2]] : null;
  };
  await until(() => app.workspaceMembers().length === 2 && count() === '2',
    { what: 'both members listed' });
  const camera = JSON.stringify(state.camera);

  await app.openWorkspaceNode('model:alpha');
  await until(() => state.after === A && !state.loading, { what: 'alpha open' });
  // The eye's path (the fake panel keeps one click handler, the workspace's).
  assert.equal(app.setBodyVisible(app.partsDocument(A).bodies[0].id, false, A), 1);
  await until(() => app.partsState().rows[0]?.visible === false,
    { timeoutMs: 10000, what: 'alpha body hidden' });

  await app.openWorkspaceNode('model:beta');
  await until(() => state.after === C && !state.loading, { what: 'beta open' });
  await app.openWorkspaceNode('assembly:all');
  await until(() => eyeOf(A) && eyeOf(C), { timeoutMs: 10000, what: 'assembly rows' });
  assert.deepEqual(eyeOf(A), ['false', 'Show model/box'],
    'alpha lists its hidden body as hidden');
  assert.deepEqual(eyeOf(C), ['true', 'Hide model/box (Y)'], 'beta keeps its visible body');
  fake.flushFrames();
  assert.deepEqual(eyeOf(A), ['false', 'Show model/box'], 'a drawn frame keeps the row');
  assert.doesNotMatch(panel.innerHTML, /viewport is empty/, 'beta is still drawn');
  assert.equal(app.setBodyVisible(app.partsDocument(C).bodies[0].id, false, C), 1);
  await until(() => eyeOf(C)?.[0] === 'false', { timeoutMs: 10000, what: 'beta body hidden' });
  assert.equal(panel.innerHTML.match(/viewport is empty/g)?.length, 1,
    'the assembly says once that nothing is drawn');
  assert.equal(JSON.stringify(state.camera), camera, 'switching keeps the camera');
  viewer.dispose?.();
});

}
