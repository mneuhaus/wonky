#!/usr/bin/env node
// Read only the CLI's already-published mapping; this script never uploads.
// node scripts/reports/site/urls.mjs
// node scripts/reports/site/build.mjs --urls out/site/data/urls.json
import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname, basename } from 'node:path';
import { REPO, readJson, assertPublicSafe } from '../lib.mjs';

const out = join(REPO, 'out/site');
const { navigation } = readJson('out/site/data/build.json');
const expected = new Set(navigation.map(p => p.key));
const { files = {} } = JSON.parse(readFileSync(join(homedir(), '.postplan/drafts.json'), 'utf8'));
const urls = {};
for (const [path, draft] of Object.entries(files)) {
  const key = basename(path, '.html');
  if (dirname(path) !== out || !path.endsWith('.html') || !expected.has(key)) continue;
  if (!/^https:\/\/[a-z0-9]+\.postplan\.dev\/?$/.test(draft.publicUrl ?? '')) throw new Error(`Invalid public URL for ${key}`);
  urls[key] = draft.publicUrl.replace(/\/$/, '');
}
const missing = [...expected].filter(key => !urls[key]);
if (missing.length) throw new Error(`First upload these pages, then regenerate all links: ${missing.join(', ')}`);
const json = `${JSON.stringify(Object.fromEntries(Object.entries(urls).sort(([a], [b]) => a.localeCompare(b))), null, 2)}\n`;
assertPublicSafe(json);
writeFileSync(join(out, 'data/urls.json'), json);
console.log(`Recorded ${expected.size} existing public page URLs; no upload performed.`);
