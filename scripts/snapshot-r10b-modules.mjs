// Acquire immutable input B-reps only. No feature evaluation, construction,
// document mutation, mesh substitution, or direct Onshape connection occurs.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from '../src/parser.mjs';

const root = fileURLToPath(new URL('../fixtures/r10b/', import.meta.url));
const document = 'onshape-id-b768d669';
const base = new URL(process.env.WONKY_ONSHAPE_BRIDGE ?? 'http://127.0.0.1:8317');
if (!['localhost', '127.0.0.1'].includes(base.hostname)) throw new Error('Use the local session bridge; direct API connections are disabled.');
const ast = parse(readFileSync(join(root, 'r10b.fs'), 'utf8'));
const imports = ast.imports.filter(spec => spec.namespace);
const required = new Map(imports.map(spec => [spec.namespace, new Set()]));
function walk(node) {
  if (!node || typeof node !== 'object') return;
  if (node.kind === 'call' && node.callee.name === 'addInstance') {
    const alias = node.args[1]?.name?.split('::')[0];
    const query = node.args[2]?.fields?.find(([key]) => key.value === 'partQuery')?.[1];
    const name = query?.key?.value;
    if (!required.has(alias) || typeof name !== 'string') throw new Error('Cannot statically identify an imported r10b part');
    required.get(alias).add(name);
  }
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) for (const child of value) walk(child);
    else if (value && typeof value === 'object') walk(value);
  }
}
walk(ast);
const hashes = value => createHash('sha256').update(value).digest('hex');
const requests = [];
async function get(path) {
  const response = await fetch(new URL(path, base), { signal: AbortSignal.timeout(45000) });
  const text = await response.text(), remaining = response.headers.get('x-rate-limit-remaining');
  requests.push({ at: new Date().toISOString(), method: 'GET', path, status: response.status, remaining });
  writeFileSync(join(root, 'snapshot-requests.json'), JSON.stringify(requests, null, 2) + '\n');
  if (!response.ok) throw new Error(`Bridge ${response.status}: ${path}`);
  if (remaining !== null && Number(remaining) < 20) throw new Error(`Low endpoint budget: ${remaining}. Stop the batch.`);
  return { text, data: JSON.parse(text) };
}
const health = await get('/_bridge/health');
if (!health.data.ok) throw new Error('Onshape bridge is unavailable');
const session = await get('/api/users/sessioninfo');
if (session.data.isGuest !== false) throw new Error('The bridge must use a signed-in user session');
const meterPath = '/api/v14/metrics/api/summary?startDate=2026-09-01T00:00:00.000Z';
const before = (await get(meterPath)).data;
await get('/_bridge/limits');
const manifest = { schema: 'wonky-onshape-inputs/1', document, capturedAt: new Date().toISOString(), sourceSha256: hashes(readFileSync(join(root, 'r10b.fs'))), modules: [], status: 'incomplete' };
try {
  for (const spec of imports) {
    const folder = join(root, 'modules', spec.namespace); mkdirSync(folder, { recursive: true });
    const partPath = `/api/parts/d/${document}/m/${spec.version}/e/${spec.path}`;
    const partsFile = join(folder, 'parts.json');
    const parts = existsSync(partsFile) ? JSON.parse(readFileSync(partsFile, 'utf8')) : (await get(partPath)).data;
    if (!Array.isArray(parts) || parts.some(p => p.microversionId !== spec.version || p.elementId !== spec.path)) throw new Error(`Part metadata revision mismatch for ${spec.namespace}`);
    if (!existsSync(partsFile)) writeFileSync(partsFile, JSON.stringify(parts, null, 2) + '\n');
    const module = { namespace: spec.namespace, element: spec.path, microversion: spec.version, partsSha256: hashes(readFileSync(partsFile)), bodies: [] };
    manifest.modules.push(module);
    for (const name of required.get(spec.namespace)) {
      const matches = parts.filter(p => p.name === name);
      if (matches.length !== 1) throw new Error(`Expected one source part '${name}', found ${matches.length}`);
      const part = matches[0], filename = `${encodeURIComponent(part.partId)}.body.json`, bodyFile = join(folder, filename);
      const apiPath = `${partPath}/partid/${encodeURIComponent(part.partId)}/bodydetails`;
      let raw;
      if (existsSync(bodyFile)) raw = readFileSync(bodyFile, 'utf8');
      else { raw = (await get(apiPath)).text; writeFileSync(bodyFile, raw); }
      const body = JSON.parse(raw);
      if (body.documentMicroversion !== spec.version || body.bodies?.length !== 1) throw new Error(`B-rep revision/count mismatch: ${name}`);
      const b = body.bodies[0];
      module.bodies.push({ name, partId: part.partId, file: `modules/${spec.namespace}/${filename}`, sha256: hashes(raw), apiPath,
        vertices: b.vertices.length, edges: b.edges.length, faces: b.faces.length,
        surfaceTypes: [...new Set(b.faces.map(f => f.surface.type))], curveTypes: [...new Set(b.edges.map(e => e.curve.type))] });
      writeFileSync(join(root, 'modules.json'), JSON.stringify(manifest, null, 2) + '\n');
      console.log(`${spec.namespace}: ${name} — ${b.faces.length} faces; revision verified`);
    }
  }
  manifest.status = 'complete';
} finally {
  const after = (await get(meterPath)).data;
  manifest.metering = { startDate: before.startDate, endDate: before.endDate,
    keyCountBefore: before.keyCount, keyCountAfter: after.keyCount, clientCountBefore: before.clientCount, clientCountAfter: after.clientCount };
  writeFileSync(join(root, 'modules.json'), JSON.stringify(manifest, null, 2) + '\n');
  if (before.startDate !== after.startDate || before.keyCount !== after.keyCount || before.clientCount !== after.clientCount) throw new Error('Onshape metering changed during input capture; inspect the bridge transport.');
}
console.log(`Captured ${manifest.modules.reduce((n, m) => n + m.bodies.length, 0)} immutable input B-reps.`);
