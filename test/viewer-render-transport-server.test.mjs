import test from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missingBend();
if (publicTreeSkip) {
  test("viewer-render-transport-server.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { mkdtemp, readFile, rm, writeFile } = await import("node:fs/promises");
const { tmpdir } = await import("node:os");
const { join } = await import("node:path");
const { gunzipSync } = await import("node:zlib");
const { request } = await import("node:http");
const { build } = await import("../src/index.mjs");
const { createReviewServer } = await import("../src/review-server.mjs");
const { DRAW_VERSION, drawEtag, drawQuery } = await import("../src/viewer/draw.mjs");
const { createDrawCache } = await import("../src/viewer/routes/draw.mjs");
const { decodeDrawPayload, drawModel } = await import("../viewer/render/draw-decode.js");
// render-transport server side: GET /api/models/:id/draw through the query
// pool (ETag, 304, gzip, 404) and explicit capability errors of the producer.













const example = async name => JSON.stringify(await build(
  await readFile(new URL(`../examples/${name}.fs`, import.meta.url), 'utf8')));
const spacerBytes = await example('bored-spacer');
const boxBytes = await example('box');

async function start(t) {
  const dir = await mkdtemp(join(tmpdir(), 'wonky-render-transport-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'spacer.brep.json');
  await writeFile(path, spacerBytes);
  const server = await createReviewServer({
    modelPaths: [path], reviewDirectory: join(dir, 'reviews'), port: 0, log: () => {},
  });
  t.after(() => server.close());
  const base = server.origin;
  const workspace = await (await fetch(base + '/api/workspace')).json();
  return { server, base, id: workspace.models[0].id };
}

// Raw GET without automatic decompression.
const raw = (url, headers = {}) => new Promise((resolve, reject) => {
  request(url, { headers }, response => {
    const chunks = [];
    response.on('data', chunk => chunks.push(chunk));
    response.on('end', () => resolve({
      status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks),
    }));
  }).on('error', reject).end();
});

test('GET /api/models/:id/draw serves the binary payload with ETag, 304 and gzip', async t => {
  const { base, id } = await start(t);
  const url = `${base}/api/models/${id}/draw`;
  const plain = await raw(url);
  assert.equal(plain.status, 200);
  assert.equal(plain.headers['content-type'], 'application/octet-stream');
  assert.equal(plain.headers.etag, drawEtag(id));
  assert.equal(plain.headers['x-wonky-draw-version'], String(DRAW_VERSION));
  assert.equal(Number(plain.headers['x-wonky-draw-bytes']), plain.body.byteLength);
  const decoded = decodeDrawPayload(plain.body);
  assert.equal(decoded.header.modelId, id);
  const model = drawModel(decoded);
  assert.equal(model.counts.faces, 4);
  assert.ok(model.header.faces.every(face => face.normalSource === 'exact'));
  const again = await raw(url, { 'if-none-match': drawEtag(id) });
  assert.equal(again.status, 304);
  assert.equal(again.body.byteLength, 0);
  const zipped = await raw(url, { 'accept-encoding': 'gzip, deflate' });
  assert.equal(zipped.headers['content-encoding'], 'gzip');
  assert.ok(zipped.body.byteLength < plain.body.byteLength);
  assert.deepEqual(gunzipSync(zipped.body), plain.body);
  const missing = await fetch(`${base}/api/models/${'0'.repeat(64)}/draw`);
  assert.equal(missing.status, 404);
  assert.equal((await missing.json()).error, 'Unknown model revision');
  const scene = await fetch(`${base}/api/models/${id}`);
  assert.equal(scene.status, 200, 'the JSON scene route is unchanged');
  assert.ok(!(await scene.text()).includes('\n'), 'served compact');
});

test('concurrent draw requests share one production; the cache is byte bounded', async () => {
  const cache = createDrawCache({ maxBytes: 10 });
  let produced = 0;
  const produce = async () => {
    produced++;
    return Buffer.alloc(8);
  };
  const [a, b] = await Promise.all([cache.get('x', produce), cache.get('x', produce)]);
  assert.equal(a, b);
  assert.equal(produced, 1);
  await cache.get('y', produce);
  assert.equal(cache.stats().entries, 1, 'the older entry leaves when the bound is exceeded');
  await cache.get('x', produce);
  assert.equal(produced, 3);
});

test('the draw producer raises explicit capability errors', async () => {
  await assert.rejects(drawQuery({ bodies: [] }, {}), error => error.status === 501
    && /no bodies/.test(error.message));
  const model = JSON.parse(boxBytes);
  model.bodies[0].edges[0].curve = { type: 'spline' };
  await assert.rejects(drawQuery(model, {}), error => error.status === 501
    && /Display preparation failed: Unsupported display edge spline/.test(error.message));
});

}
