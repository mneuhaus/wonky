// Writes out/reports/urls.json: { "<report key>": "https://<id>.postplan.dev", … }
//   node scripts/reports/urls.mjs
//
// Source: the Postplan CLI's local file → draft map (~/.postplan/drafts.json),
// filled by `npx postplan upload out/reports/<key>.html`. hub.mjs reads urls.json
// and replaces its {{URL:<key>}} placeholders. Only public draft URLs end up in
// the file; the absolute local paths of drafts.json stay out of it.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname, basename } from 'node:path';
import { REPO } from './lib.mjs';

const DRAFTS = join(homedir(), '.postplan', 'drafts.json');
const OUT_DIR = join(REPO, 'out/reports');
const URLS = join(OUT_DIR, 'urls.json');
const PUBLIC_URL = /^https:\/\/[a-z0-9]+\.postplan\.dev\/?$/;

if (!existsSync(DRAFTS)) throw new Error('urls: no ~/.postplan/drafts.json yet, upload the reports first');
const files = JSON.parse(readFileSync(DRAFTS, 'utf8')).files ?? {};

const urls = {};
for (const [path, draft] of Object.entries(files)) {
  if (dirname(path) !== OUT_DIR || !path.endsWith('.html')) continue;
  const key = basename(path, '.html');
  if (key.startsWith('_')) continue; // test pages such as _csp-test
  if (!PUBLIC_URL.test(draft.publicUrl ?? '')) throw new Error(`urls: unexpected public URL for ${key}: ${draft.publicUrl}`);
  urls[key] = draft.publicUrl.replace(/\/$/, '');
}

const sorted = Object.fromEntries(Object.entries(urls).sort(([a], [b]) => a.localeCompare(b)));
writeFileSync(URLS, `${JSON.stringify(sorted, null, 2)}\n`);
console.log(`wrote out/reports/urls.json (${Object.keys(sorted).length} URLs: ${Object.keys(sorted).join(', ')})`);
