#!/usr/bin/env node
// Checks the frozen viewer contracts recorded in docs/viewer/contracts.md:
//   - every DOM id is still produced (index.html or feature markup);
//   - the legacy state facade fields and harness functions still exist.
//
//   node scripts/viewer/check-contracts.mjs [--browser http://127.0.0.1:4350/viewer/]
// With --browser the ids are also checked in the live DOM after boot.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FACADE_FIELDS, HARNESS_FUNCTIONS } from '../../viewer/app.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const contracts = readFileSync(join(root, 'docs/viewer/contracts.md'), 'utf8');
const block = name => {
  const match = contracts.match(new RegExp('```' + name + '\\n([\\s\\S]*?)```'));
  if (!match) throw new Error(`docs/viewer/contracts.md has no ${name} block`);
  return match[1].split(/\s+/).filter(Boolean);
};
const walk = directory => readdirSync(directory).flatMap(name => {
  const path = join(directory, name);
  return statSync(path).isDirectory() ? walk(path) : [path];
});

const problems = [];
const ids = block('dom-ids');
const sources = walk(join(root, 'viewer')).filter(path => /\.(js|html)$/.test(path))
  .map(path => readFileSync(path, 'utf8')).join('\n');
for (const id of ids) {
  if (!sources.includes(`id="${id}"`)) problems.push(`DOM id #${id} is not produced anywhere`);
}
const sameSet = (label, documented, code) => {
  const missing = documented.filter(name => !code.includes(name));
  const extra = code.filter(name => !documented.includes(name));
  if (missing.length) problems.push(`${label} missing in code: ${missing.join(', ')}`);
  if (extra.length) problems.push(`${label} not documented: ${extra.join(', ')}`);
};
sameSet('facade fields', block('facade-fields'), [...FACADE_FIELDS]);
sameSet('harness functions', block('harness-functions'), [...HARNESS_FUNCTIONS]);

const index = process.argv.indexOf('--browser');
if (index >= 0) {
  const { launch, openViewer, waitIdle } = await import('./qa/browser.mjs');
  const browser = await launch();
  try {
    const { page } = await openViewer(browser, process.argv[index + 1]);
    await waitIdle(page);
    const missing = await page.evaluate(list => list.filter(id => !document.getElementById(id)),
      ids);
    for (const id of missing) problems.push(`DOM id #${id} missing in the live page`);
    const duplicates = await page.evaluate(list => list.filter(id => document
      .querySelectorAll(`[id="${id}"]`).length > 1), ids);
    for (const id of duplicates) problems.push(`DOM id #${id} occurs more than once`);
  } finally {
    await browser.close();
  }
}

if (problems.length) {
  console.error(problems.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`check-contracts: ${ids.length} DOM ids, ${FACADE_FIELDS.length} facade fields,`
    + ` ${HARNESS_FUNCTIONS.length} harness functions ok${index >= 0 ? ' (static and live)' : ''}`);
}
