import test from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missingBend();
if (publicTreeSkip) {
  test("viewer-topology.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { spawn } = await import("node:child_process");
const { createHash } = await import("node:crypto");
const { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } = await import("node:fs");
const { mkdtemp, rm, writeFile } = await import("node:fs/promises");
const { loadavg, tmpdir } = await import("node:os");
const { join } = await import("node:path");
const { performance } = await import("node:perf_hooks");
const { fileURLToPath, pathToFileURL } = await import("node:url");
const { Worker } = await import("node:worker_threads");
const { build } = await import("../src/index.mjs");
const { createReviewServer } = await import("../src/review-server.mjs");
const { createQueryPool } = await import("../src/viewer/query-pool.mjs");
const { classifyEdges } = await import("../src/viewer/edge-classes.mjs");
const { logicalFaces } = await import("../src/viewer/logical-faces.mjs");
const { topologyDocument } = await import("../src/viewer/routes/topology.mjs");
// GET /api/models/:id/topology, and the same classification in the process
// shapes of the live viewer: a forked child process with advanced
// serialization (build worker), a worker thread and the query pool (query
// worker). Package topology-classes.


















const root = fileURLToPath(new URL('../', import.meta.url));
const sha256 = value => createHash('sha256').update(value).digest('hex');
const r10bPath = join(root, 'out/r10b-retained.brep.json');

// Same cache as test/viewer-topology-classes.test.mjs.
const kernelFingerprint = (() => {
  const entries = [];
  for (const directory of ['kernel', 'kernel/ports', 'src']) {
    for (const file of readdirSync(join(root, directory)).sort()) {
      if (!/\.(bend|mjs)$/.test(file)) continue;
      const stat = statSync(join(root, directory, file));
      entries.push(`${directory}/${file}:${stat.size}:${stat.mtimeMs}`);
    }
  }
  return createHash('sha256').update(entries.join('\n')).digest('hex').slice(0, 12);
})();

async function kernelModelText(name, sourcePath) {
  const source = readFileSync(join(root, sourcePath), 'utf8');
  const key = createHash('sha256').update(source).update(kernelFingerprint).digest('hex')
    .slice(0, 16);
  const directory = join(root, 'tmp/viewer/topology-classes/cache');
  const path = join(directory, `${name}-${key}.brep.json`);
  if (existsSync(path)) return readFileSync(path, 'utf8');
  const text = JSON.stringify(await build(source, { sourcePath: `/fixtures/${name}.fs` }));
  mkdirSync(directory, { recursive: true });
  writeFileSync(path, text);
  return text;
}

const MODULES = {
  classes: pathToFileURL(join(root, 'src/viewer/edge-classes.mjs')).href,
  logical: pathToFileURL(join(root, 'src/viewer/logical-faces.mjs')).href,
};

// Runs classifyEdges + logicalFaces on the model file in a child process
// (child_process with serialization 'advanced', as the live build worker).
function inChildProcess(path) {
  const code = `
    import { readFileSync } from 'node:fs';
    import { performance } from 'node:perf_hooks';
    const { classifyEdges } = await import(${JSON.stringify(MODULES.classes)});
    const { logicalFaces } = await import(${JSON.stringify(MODULES.logical)});
    const model = JSON.parse(readFileSync(process.argv[1], 'utf8'));
    const started = performance.now();
    const classes = classifyEdges(model);
    const logical = logicalFaces(model, { classes });
    const ms = performance.now() - started;
    process.send({ classes, logical, ms }, () => process.disconnect());`;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', code, path], {
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'], serialization: 'advanced',
    });
    let message;
    child.on('message', value => { message = value; });
    child.on('error', reject);
    child.on('exit', status => (status === 0 && message ? resolve(message)
      : reject(new Error(`child exited with ${status}`))));
  });
}

// The same in a worker thread (structured clone across threads).
function inWorkerThread(path) {
  const code = `
    const { parentPort, workerData } = require('node:worker_threads');
    const { readFileSync } = require('node:fs');
    (async () => {
      const { classifyEdges } = await import(workerData.modules.classes);
      const { logicalFaces } = await import(workerData.modules.logical);
      const model = JSON.parse(readFileSync(workerData.path, 'utf8'));
      const started = performance.now();
      const classes = classifyEdges(model);
      const logical = logicalFaces(model, { classes });
      parentPort.postMessage({ classes, logical, ms: performance.now() - started });
    })();`;
  return new Promise((resolve, reject) => {
    const worker = new Worker(code, { eval: true, workerData: { path, modules: MODULES } });
    worker.once('message', value => {
      resolve(value);
      worker.terminate();
    });
    worker.once('error', reject);
  });
}

const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

test('topology route: pocket plate 46 raw faces, 11 logical faces, 48 subdivision edges',
  async t => {
    const bytes = await kernelModelText('pocket-plate',
      'scripts/viewer/audit-data/pocket-plate.fs');
    const dir = await mkdtemp(join(tmpdir(), 'wonky-viewer-topology-'));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const path = join(dir, 'pocket-plate.brep.json');
    await writeFile(path, bytes);
    const server = await createReviewServer({
      port: 0, modelPaths: [path], reviewDirectory: join(dir, 'reviews'), log: () => {},
    });
    t.after(() => server.close());
    const base = server.url.replace('/viewer/', '');
    const id = sha256(bytes);
    const response = await fetch(`${base}/api/models/${id}/topology`);
    assert.equal(response.status, 200);
    const document = await response.json();
    assert.equal(document.schema, 'wonky.viewer-topology/1');
    assert.equal(document.modelId, id);
    assert.deepEqual(document.totals, {
      bodies: 1, faces: 46, logicalFaces: 11, edges: 92,
      classes: { sharp: 44, tangent: 0, seam: 0, subdivision: 48, unresolved: 0 },
    });
    assert.deepEqual(document.exactness,
      { classes: 'exact-parameters', logicalFaces: 'exact-parameters', origins: 'recorded' });
    const [body] = document.bodies;
    assert.equal(body.alias, 'B1');
    assert.equal(body.toleranceMm, 0.0003);
    assert.equal(body.logicalFaces.length, 11);
    assert.equal(body.logicalFaces.flatMap(group => group.fragments).length, 46);
    assert.match(body.logicalFaces[0].alias, /^B1\.L1$/);
    assert.ok(body.logicalFaces.every(group => group.fragments
      .every(alias => /^B1\.F[1-9][0-9]*$/.test(alias))));
    assert.equal(body.logicalFaces[0].support.fragment, body.logicalFaces[0].fragments[0]);
    assert.equal(body.edges.length, 92);
    const subdivision = body.edges.filter(edge => edge.class === 'subdivision');
    assert.equal(subdivision.length, 48);
    assert.ok(subdivision.every(edge => edge.origin === 'FaceSubdivision'
      && edge.support === 'identical' && edge.faces.length === 2));
    assert.ok(body.edges.filter(edge => edge.class === 'sharp')
      .every(edge => edge.normalAngleRad[0] > body.angularToleranceRad));
    assert.ok(document.computeMs < 200);

    const summary = await (await fetch(`${base}/api/models/${id}/topology?detail=summary`)).json();
    assert.deepEqual(summary.totals, document.totals);
    assert.equal(summary.bodies[0].edges, undefined);
    assert.equal((await fetch(`${base}/api/models/${id}/topology?detail=x`)).status, 400);
    const unknown = await fetch(`${base}/api/models/${'0'.repeat(64)}/topology`);
    assert.equal(unknown.status, 404);
    assert.equal((await unknown.json()).error, 'Unknown model revision');
  });

test('identical results in-process, in a build-worker child process, a worker thread and '
  + 'the query pool', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'wonky-viewer-topology-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const models = [
    ['pocket-plate', 'scripts/viewer/audit-data/pocket-plate.fs'],
    ['arc-slot', 'scripts/viewer/audit-data/arc-slot.fs'],
    ['bored-spacer', 'examples/bored-spacer.fs'],
  ];
  const paths = [];
  for (const [name, source] of models) {
    const path = join(dir, `${name}.brep.json`);
    await writeFile(path, await kernelModelText(name, source));
    paths.push(path);
  }
  if (existsSync(r10bPath)) paths.push(r10bPath);
  for (const path of paths) {
    const model = JSON.parse(readFileSync(path, 'utf8'));
    const expected = { classes: classifyEdges(model), logical: logicalFaces(model) };
    const child = await inChildProcess(path);
    assert.deepEqual({ classes: child.classes, logical: child.logical }, expected, path);
    const thread = await inWorkerThread(path);
    assert.deepEqual({ classes: thread.classes, logical: thread.logical }, expected, path);
    const fresh = JSON.parse(readFileSync(path, 'utf8'));
    const pool = createQueryPool({
      registry: { model: () => fresh },
      handlers: {
        topology: model => ({ classes: classifyEdges(model), logical: logicalFaces(model) }),
      },
    });
    assert.deepEqual(await pool.query('topology', 'id', {}), expected, path);
    pool.close();
    const topology = topologyDocument(fresh, 'id');
    assert.equal(topology.totals.logicalFaces,
      expected.logical.bodies.reduce((sum, body) => sum + body.groups.length, 0));
  }
});

test('r10b-retained: classes and logical faces in < 200 ms (median of 5, each process shape)',
  { skip: !existsSync(r10bPath) && 'out/r10b-retained.brep.json not built' }, async t => {
    const text = readFileSync(r10bPath, 'utf8');
    const runs = [];
    for (let i = 0; i < 5; i++) {
      const model = JSON.parse(text);
      const started = performance.now();
      const classes = classifyEdges(model);
      logicalFaces(model, { classes });
      runs.push(performance.now() - started);
    }
    const child = [];
    const thread = [];
    for (let i = 0; i < 5; i++) {
      child.push((await inChildProcess(r10bPath)).ms);
      thread.push((await inWorkerThread(r10bPath)).ms);
    }
    const load = loadavg()[0].toFixed(1);
    t.diagnostic(`r10b-retained median ms: in-process ${median(runs).toFixed(1)}, `
      + `child process ${median(child).toFixed(1)}, worker thread ${median(thread).toFixed(1)}; `
      + `load ${load}`);
    for (const values of [runs, child, thread]) assert.ok(median(values) < 200, values.join());
    const document = topologyDocument(JSON.parse(text), 'r10b');
    assert.equal(document.totals.faces, 172);
    assert.equal(document.totals.classes.unresolved, 0);
  });

// The live build worker (live-server'project-component-32f60153_process.fork entry) runs
// classifyEdges and logicalFaces on every prepared revision and passes the
// classes into the draw payload. A `prepare` job on exact model bytes must
// yield the same edge classes and logical face count as in-process.
test('the live build worker computes the same logical faces (and classes in its draw '
  + 'payload)', async t => {
  const { createBuildPool } = await import('../src/viewer/live/pool.mjs');
  const { decodeDrawPayload } = await import('../viewer/render/draw-decode.js');
  const bytes = Buffer.from(await kernelModelText('pocket-plate',
    'scripts/viewer/audit-data/pocket-plate.fs'));
  const events = [];
  const pool = createBuildPool({ spare: false, fingerprintIntervalMs: 0,
    onEvent: (name, data) => events.push({ name, data }) });
  t.after(() => pool.close());
  const inputs = [['pocket-plate', bytes]];
  if (existsSync(r10bPath)) inputs.push(['r10b-retained', readFileSync(r10bPath)]);
  for (const [label, input] of inputs) {
    const result = await new Promise(resolve => pool.submit(
      { type: 'prepare', sourceId: 'topology-test', revision: 0, sourcePath: label,
        bytes: input, label },
      { onDone: resolve }));
    if (!result.ok && events.some(event => event.name === 'worker-failed')) {
      t.skip(`build worker unavailable: ${result.failure?.error?.message}`);
      return;
    }
    assert.equal(result.ok, true, JSON.stringify(result.failure?.error ?? null));
    const model = JSON.parse(input.toString('utf8'));
    const classes = classifyEdges(model);
    const logical = logicalFaces(model, { classes });
    assert.equal(result.summary.logicalFaces,
      logical.bodies.reduce((sum, body) => sum + body.groups.length, 0), label);
    const notes = result.displayNotes.filter(note => /^(edge classes|logical faces):/.test(note));
    assert.deepEqual(notes, [], `${label}: both ran in the worker without an error note`);
    if (!result.draw) {
      // buildDrawPayload returns null until the Bend display module is loaded
      // in that process (render-transport); the classes then only reach the
      // client through the query worker, compared in the QA script.
      t.diagnostic(`${label}: build worker sent no draw payload; classes not compared here`);
      continue;
    }
    const decoded = decodeDrawPayload(new Uint8Array(result.draw.buffer));
    const expected = classes.bodies.flatMap(body => [...body.classes]);
    assert.deepEqual([...decoded.arrays.edgeClass], expected, `${label}: edge classes`);
    assert.deepEqual(decoded.header.logicalFaces.map(group => group.alias),
      logical.bodies.flatMap(body => body.groups.map(group => group.alias)), label);
  }
});

}
