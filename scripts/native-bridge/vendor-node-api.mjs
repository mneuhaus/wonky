#!/usr/bin/env node
// Copies the four Node-API headers of the running Node into src/native/include/
// and records where they came from (PROVENANCE.json with sha256 per file), so the
// native build does not depend on ~/Library/Caches/node-gyp existing.
//
// Source order: <node prefix>/include/node (ships with the Node binary), then
// the node-gyp cache for exactly this Node version. Nothing else is guessed.
//
//   node scripts/native-bridge/vendor-node-api.mjs [--check]
//     --check  verify the vendored copies against their recorded source; exit 1 on drift
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const target = join(root, 'src/native/include');
export const HEADERS = ['node_api.h', 'js_native_api.h', 'js_native_api_types.h', 'node_api_types.h'];
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

function sources() {
  const prefix = dirname(dirname(realpathSync(process.execPath)));
  return [join(prefix, 'include/node'), join(process.env.HOME ?? '', 'Library/Caches/node-gyp', process.versions.node, 'include/node')];
}

export function vendor() {
  const from = sources().find(dir => HEADERS.every(h => existsSync(join(dir, h))));
  if (!from) throw new Error(`Node-API headers for Node ${process.versions.node} not found in: ${sources().join(', ')}`);
  mkdirSync(target, { recursive: true });
  const files = HEADERS.map(name => {
    copyFileSync(join(from, name), join(target, name));
    const bytes = readFileSync(join(target, name));
    return { name, sha256: sha256(bytes), bytes: bytes.length };
  });
  const provenance = { schema: 'wonky-node-api-headers/1', generator: 'scripts/native-bridge/vendor-node-api.mjs',
    node: process.versions.node, napi: Number(process.versions.napi), source: from, files };
  writeFileSync(join(target, 'PROVENANCE.json'), JSON.stringify(provenance, null, 1) + '\n');
  return provenance;
}

export function check() {
  const provenance = JSON.parse(readFileSync(join(target, 'PROVENANCE.json'), 'utf8'));
  const drift = provenance.files.filter(f => sha256(readFileSync(join(target, f.name))) !== f.sha256).map(f => f.name);
  return { ok: drift.length === 0, drift, provenance };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv.includes('--check')) {
    const result = check();
    console.log(JSON.stringify({ ok: result.ok, drift: result.drift, node: result.provenance.node, source: result.provenance.source }));
    if (!result.ok) process.exitCode = 1;
  } else {
    const p = vendor();
    console.log(JSON.stringify({ into: relative(root, target), source: p.source, node: p.node, napi: p.napi, files: p.files.map(f => `${f.name} ${f.sha256.slice(0, 12)}`) }));
  }
}
