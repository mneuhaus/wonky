#!/usr/bin/env node
// Compares two computed-styles.json files written by qa/foundation.mjs
// (every element's layout and paint properties, per breakpoint and state).
//
//   node scripts/viewer/qa/compare-styles.mjs --a baseline/computed-styles.json \
//     --b after/computed-styles.json [--out report.json]
import { readFileSync, writeFileSync } from 'node:fs';
import { diffStyles } from './browser.mjs';

const args = process.argv.slice(2);
const option = name => args[args.indexOf(name) + 1];
const a = JSON.parse(readFileSync(option('--a'), 'utf8'));
const b = JSON.parse(readFileSync(option('--b'), 'utf8'));
const report = {};
let total = 0;
for (const state of Object.keys(a)) {
  const differences = b[state] ? diffStyles(a[state], b[state]) : [{ missing: 'state' }];
  report[state] = { elements: Object.keys(a[state]).length, differences };
  total += differences.length;
  console.log(`${differences.length ? 'DIFF' : 'same'} ${state}: ${Object.keys(a[state]).length}`
    + ` elements, ${differences.length} differences`);
  for (const difference of differences.slice(0, 8)) console.log('   ', JSON.stringify(difference));
}
if (args.includes('--out')) writeFileSync(option('--out'), JSON.stringify(report, null, 2) + '\n');
process.exitCode = total ? 1 : 0;
