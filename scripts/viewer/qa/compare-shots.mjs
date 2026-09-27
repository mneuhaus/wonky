#!/usr/bin/env node
// Pixel comparison of two screenshot directories (same file names).
//
//   node scripts/viewer/qa/compare-shots.mjs --a out/viewer/foundation/baseline \
//     --b out/viewer/foundation/after [--match view-] [--limit 0.001] [--out report.json]
//
// A pixel differs when any channel differs by more than --threshold (default 0).
// Exit code 1 when a file is missing or its differing fraction exceeds --limit.
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { diffImages, launch } from './browser.mjs';

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
};
const a = option('--a');
const b = option('--b');
const match = option('--match', '');
const limit = Number(option('--limit', '0.001'));
const threshold = Number(option('--threshold', '0'));
const out = option('--out', null);
const diffDirectory = option('--diff-dir', null);
if (diffDirectory) mkdirSync(diffDirectory, { recursive: true });

const files = readdirSync(a).filter(file => file.endsWith('.png') && file.includes(match)).sort();
const browser = await launch();
const page = await (await browser.newContext()).newPage();
const rows = [];
let failures = 0;
for (const file of files) {
  if (!existsSync(join(b, file))) {
    rows.push({ file, missing: true });
    failures++;
    console.log(`MISSING ${file}`);
    continue;
  }
  const diffPath = diffDirectory
    ? join(diffDirectory, file.replace(/\.png$/, '.diff.png'))
    : undefined;
  const result = await diffImages(page, join(a, file), join(b, file), { threshold, diffPath });
  const ok = result.sameSize && result.fraction <= limit;
  if (!ok) failures++;
  rows.push({ file, ok, ...result });
  const detail = result.sameSize
    ? `${(result.fraction * 100).toFixed(4)} % (${result.differing} px,`
      + ` max delta ${result.maxDelta})`
    : `size ${result.sizeA} vs ${result.sizeB}`;
  console.log(`${ok ? 'ok  ' : 'DIFF'} ${file} ${detail}`);
}
await browser.close();
if (out) writeFileSync(out, JSON.stringify({ a, b, limit, threshold, rows }, null, 2) + '\n');
console.log(`${files.length - failures}/${files.length} within ${limit * 100} %`);
process.exitCode = failures ? 1 : 0;
