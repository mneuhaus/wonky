#!/usr/bin/env node
// HTTP smoke of the viewer API rows API-01..15 (docs/viewer/feature-inventory.md).
//
//   node scripts/viewer/qa/api-smoke.mjs --base http://127.0.0.1:4350 --out FILE.json \
//     [--compare BASELINE.json] [--text FILE.txt]
//
// Records status, content type and a normalized body per request. Volatile
// values (port, review ids, timestamps, the private reviews directory) are
// replaced by placeholders so a baseline and a later run compare exactly.
// JSON bodies are compared after parsing, so whitespace changes (compact
// scenes) do not count as differences.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { isDeepStrictEqual } from 'node:util';

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
};
const base = option('--base', 'http://127.0.0.1:4350');
const outPath = option('--out', null);
const comparePath = option('--compare', null);
const textPath = option('--text', null);
const modelLabel = option('--model', 'bracket');
const port = new URL(base).port;
let reviewDirectory = '';

const normalize = value => {
  let text = typeof value === 'string' ? value : JSON.stringify(value);
  if (reviewDirectory) text = text.split(reviewDirectory).join('<reviews>');
  text = text.replaceAll(`127.0.0.1:${port}`, '127.0.0.1:<port>');
  text = text.replace(/WKR-[A-F0-9]{10}/g, 'WKR-<id>');
  text = text.replace(/\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z/g, '<time>');
  return typeof value === 'string' ? text : JSON.parse(text);
};
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

const rows = [];
// node:http keeps the path and Host header exactly as given (fetch normalizes both).
const rawRequest = (path, headers = {}) => new Promise((resolve, reject) => {
  const target = new URL(base);
  const req = request({ host: target.hostname, port: target.port, path, headers }, response => {
    const chunks = [];
    response.on('data', chunk => chunks.push(chunk));
    response.on('end', () => resolve({ status: response.statusCode,
      type: response.headers['content-type'] ?? '', bytes: Buffer.concat(chunks) }));
  });
  req.on('error', reject);
  req.end();
});
async function raw(id, path, headers) {
  const response = await rawRequest(path, headers);
  const parsed = response.type.startsWith('application/json')
    ? normalize(JSON.parse(response.bytes.toString('utf8'))) : { bytes: response.bytes.length };
  const host = headers?.Host ? ` (Host ${normalize(headers.Host)})` : '';
  rows.push({ id, method: 'GET', path: normalize(path) + host,
    status: response.status, type: response.type, bytes: response.bytes.length,
    bodySha256: digest(parsed), body: parsed });
}
async function call(id, method, path, { headers = {}, body, keep = true } = {}) {
  const response = await fetch(base + path, { method, headers, body, redirect: 'manual' });
  const type = response.headers.get('content-type') ?? '';
  const bytes = Buffer.from(await response.arrayBuffer());
  let parsed;
  if (type.startsWith('application/json')) parsed = normalize(JSON.parse(bytes.toString('utf8')));
  else if (type.startsWith('text/')) parsed = normalize(bytes.toString('utf8'));
  else parsed = { binarySha256: createHash('sha256').update(bytes).digest('hex') };
  const row = {
    id, method, path: normalize(path), status: response.status, type,
    location: response.headers.get('location') ?? undefined,
    cacheControl: response.headers.get('cache-control'),
    nosniff: response.headers.get('x-content-type-options'),
    bytes: bytes.length,
    bodySha256: digest(parsed),
    ...(keep ? { body: parsed } : {}),
  };
  rows.push(row);
  return { row, parsed, raw: bytes };
}

const workspace = (await call('API-04', 'GET', '/api/workspace', { keep: false })).parsed;
const model = workspace.models.find(item => item.label === modelLabel) ?? workspace.models[0];
const id = model.id;
await call('API-01', 'GET', '/');
for (const path of ['/viewer/', '/viewer/index.html', '/viewer/app.js', '/viewer/style.css']) {
  await call('API-02', 'GET', path, { keep: false });
}
await call('API-03', 'GET', '/viewer/nope.js');
await raw('API-03', '/viewer/../src/review-server.mjs');
await raw('API-03', '/viewer/%2e%2e/src/review-server.mjs');
await raw('API-03', '/viewer/..%2fsrc/review-server.mjs');
const scene = (await call('API-05', 'GET', `/api/models/${id}`, { keep: false })).parsed;
await call('API-06', 'GET', `/api/models/${'0'.repeat(64)}`);
for (const query of ['', '?level=bodies', '?format=text', '?level=bodies&format=text']) {
  await call('API-07', 'GET', `/api/models/${id}/summary${query}`, { keep: false });
}
await call('API-07', 'GET', `/api/models/${'0'.repeat(64)}/summary`);
for (const alias of ['B1', 'B1.F2', 'B1.E1', 'B1.V1', 'B1.F999']) {
  await call('API-08', 'GET', `/api/models/${id}/entities/${alias}`, { keep: false });
}
await call('API-08', 'GET', `/api/models/${'0'.repeat(64)}/entities/B1`);
const sourceSha = scene.sourceMap?.source?.sha256 ?? scene.bodies[0]?.source?.sha256;
if (sourceSha) await call('API-09', 'GET', `/api/source/${sourceSha}`, { keep: false });
await call('API-09', 'GET', `/api/source/${'0'.repeat(64)}`);
for (const report of workspace.reports) {
  const result = await call('API-10', 'GET', `/api/reports/${report.id}`, { keep: false });
  const images = (result.parsed.views ?? []).flatMap(view => Object.values(view.images ?? {}));
  if (images[0]?.url) await call('API-11', 'GET', images[0].url, { keep: false });
}
await call('API-10', 'GET', '/api/reports/nope');
await call('API-11', 'GET', '/api/reports/visual/images/nope.png');

const camera = { yaw: -0.6, pitch: -0.5, zoom: 1, pan: [0, 0] };
const view = { before: id, after: id, split: 0.5, compare: false, layout: 'wipe', aspect: 1.5 };
const review = {
  title: 'API smoke', notes: 'Smoke notes', models: [id], camera, comparison: view,
  annotations: [{
    tool: 'comment', text: 'Here', points: [[0.5, 0.5]], camera, view,
    target: { modelId: id, bodyId: scene.bodies[0].id, entityType: 'face', entityIndex: 0 },
  }],
};
const json = { 'Content-Type': 'application/json' };
const saved = await call('API-14', 'POST', '/api/feedback', {
  headers: json, body: JSON.stringify(review),
});
reviewDirectory = String(saved.raw).match(/"file":\s*"([^"]+)\/WKR-/)?.[1] ?? '';
rows.at(-1).body = normalize(JSON.parse(saved.raw.toString('utf8')));
rows.at(-1).bodySha256 = digest(rows.at(-1).body);
const reviewId = JSON.parse(saved.raw.toString('utf8')).id;
await call('API-12', 'GET', `/api/feedback/${reviewId}`);
await call('API-13', 'GET', `/api/feedback/${reviewId}/context`);
await call('API-12', 'GET', '/api/feedback/WKR-0000000000');
await call('API-14', 'POST', '/api/feedback', {
  headers: { 'Content-Type': 'text/plain' }, body: 'x',
});
await call('API-14', 'POST', '/api/feedback', {
  headers: json, body: JSON.stringify({ ...review, notes: 'x'.repeat(2 * 1024 * 1024 + 10) }),
});
await call('API-14', 'POST', '/api/feedback', {
  headers: json, body: JSON.stringify({ ...review, camera: { ...camera, zoom: 0 } }),
});
await call('API-14', 'POST', '/api/feedback', {
  headers: { ...json, Origin: 'https://elsewhere.invalid' }, body: JSON.stringify(review),
});
await call('API-15', 'GET', '/api/nope');
await raw('SRV-13', '/api/nope', { Host: `attacker.example:${port}` });
await raw('SRV-13', '/api/nope', { Host: `localhost:${port}` });
const workspaceAgain = await call('API-04', 'GET', '/api/workspace');
workspaceAgain.row.path = '/api/workspace (after save)';

const result = {
  schema: 'wonky.viewer-api-smoke/1', base: normalize(base), model: modelLabel, rows,
};
if (outPath) writeFileSync(outPath, JSON.stringify(result, null, 2) + '\n');
const lines = rows.map(row => [
  row.id.padEnd(7), row.method.padEnd(4), String(row.status).padEnd(4),
  row.type.split(';')[0].padEnd(24), row.bodySha256.slice(0, 12), row.path,
].join(' '));
let failures = 0;
if (comparePath) {
  const baseline = JSON.parse(readFileSync(comparePath, 'utf8'));
  lines.push('', `comparison with ${comparePath}:`);
  for (const [index, row] of rows.entries()) {
    const old = baseline.rows[index];
    const same = old && old.path === row.path && old.status === row.status
      && old.type === row.type && old.bodySha256 === row.bodySha256
      && old.location === row.location;
    const bodySame = old && isDeepStrictEqual(old.body, row.body);
    if (!same) failures++;
    lines.push(`${same ? 'same' : 'DIFF'} ${row.id} ${row.method} ${row.path}`
      + (same ? '' : ` (baseline ${old?.status} ${old?.type} ${old?.bodySha256?.slice(0, 12)}`
        + ` body ${bodySame ? 'equal' : 'differs'})`));
  }
}
const text = lines.join('\n') + '\n';
if (textPath) writeFileSync(textPath, text);
process.stdout.write(text);
process.exitCode = failures ? 1 : 0;
